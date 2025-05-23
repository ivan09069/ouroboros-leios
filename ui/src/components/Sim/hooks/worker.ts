import { ISimulationAggregatedDataState, ISimulationIntermediateDataState } from '@/contexts/SimContext/types';
import * as cbor from 'cbor';
import { ReadableStream } from 'stream/web';
import { IServerMessage } from '../types';
import { processMessage } from './utils';

export type TWorkerRequest =
  { type: "START", tracePath: string, batchSize: number } |
  { type: "STOP" };

export type TWorkerResponse =
  { type: "EVENT", tracePath: string, aggregatedData: ISimulationAggregatedDataState } |
  { type: "DONE", tracePath: string };

const createEventStream = async (path: string, signal: AbortSignal): Promise<ReadableStream<IServerMessage>> => {
  const res = await fetch(path, { signal });
  if (!res.body) {
    throw new Error("body not streamed");
  }
  const transform = path.endsWith('.cbor') ? createCborTransformer() : createJsonTransformer();
  return res.body.pipeThrough(transform) as unknown as ReadableStream<IServerMessage>;
}

const createJsonTransformer = (): TransformStream<Uint8Array, IServerMessage> => {
  let buffer = "";
  const decoder = new TextDecoder();
  return new TransformStream({
    transform(chunk, controller) {
      buffer += decoder.decode(chunk);
      for (let nl = buffer.indexOf('\n'); nl != -1; nl = buffer.indexOf('\n')) {
        if (nl) {
          const message = JSON.parse(buffer.substring(0, nl));
          controller.enqueue(message);
        }
        buffer = buffer.substring(nl + 1);
      }
    }
  });
}

const createCborTransformer = (): TransformStream<Uint8Array, IServerMessage> => {
  let buffer: Buffer | null = null;
  return new TransformStream({
    transform(chunk, controller) {
      buffer = buffer ? Buffer.concat([buffer, chunk]) : Buffer.from(chunk);
      while (buffer != null) {
        try {
          const { value, unused } = cbor.decodeFirstSync(buffer, { extendedResults: true });
          buffer = unused as Buffer;
          controller.enqueue(value);
        } catch (error: any) {
          if (error.message === 'Insufficient data') {
            break;
          } else {
            throw error;
          }
        }
      }
    }
  })
}

const consumeStream = async (
  stream: ReadableStream<IServerMessage>,
  tracePath: string,
  batchSize: number,
) => {
  const aggregatedData: ISimulationAggregatedDataState = {
    progress: 0,
    nodes: new Map(),
    global: {
      praosTxOnChain: 0,
      leiosTxOnChain: 0,
    },
    blocks: [],
    lastNodesUpdated: [],
  };
  const intermediate: ISimulationIntermediateDataState = {
    txs: [],
    leiosTxs: new Set(),
    praosTxs: new Set(),
    ibs: new Map(),
    ebs: new Map(),
    bytes: new Map(),
  };

  const nodesUpdated = new Set<string>();
  let batchEvents = 0;
  for await (const { time_s, message } of stream) {
    if (message.type.endsWith("Received") && "recipient" in message) {
      nodesUpdated.add(message.recipient);
    }
    if (message.type.endsWith("Sent") && "sender" in message) {
      nodesUpdated.add(message.sender);
    }
    if (message.type.endsWith("Generated") && "id" in message) {
      nodesUpdated.add(message.id);
    }
    processMessage({ time_s, message }, aggregatedData, intermediate);
    aggregatedData.progress = time_s;
    batchEvents++;
    if (batchEvents === batchSize) {
      postMessage({
        type: "EVENT",
        tracePath,
        aggregatedData: {
          ...aggregatedData,
          lastNodesUpdated: [...nodesUpdated.values()],
        }
      } as TWorkerResponse);

      nodesUpdated.clear();
      batchEvents = 0;
    }
  }
  if (batchEvents) {
    postMessage({
      type: "EVENT",
      tracePath,
      aggregatedData: {
        ...aggregatedData,
        lastNodesUpdated: [...nodesUpdated.values()],
      }
    } as TWorkerResponse);
  }
  postMessage({ type: "DONE", tracePath });
}

let controller = new AbortController();
onmessage = (e: MessageEvent<TWorkerRequest>) => {
  controller.abort();
  const request = e.data;
  if (request.type === "STOP" || !request.tracePath) {
    return;
  }

  controller = new AbortController();
  createEventStream(request.tracePath, controller.signal)
    .then(stream => consumeStream(stream, request.tracePath, request.batchSize))
    .catch(err => {
      if (err.name !== "AbortError") {
        throw err;
      }
    });
}