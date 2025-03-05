import { EMessageType, IServerMessage } from "@/components/Sim/types";

import {
  ISimulationAggregatedData,
  ISimulationAggregatedDataState,
  ISimulationBlock,
  ISimulationIntermediateDataState,
} from "@/contexts/SimContext/types";

const trackDataGenerated = (aggregationNodeDataRef: ISimulationAggregatedDataState, intermediate: ISimulationIntermediateDataState, nodeId: string, type: string, id: string, bytes: number) => {
  const data = getNodeData(aggregationNodeDataRef, nodeId);
  data.generated[type] = (data.generated[type] ?? 0) + 1;
  intermediate.bytes.set(`${type}-${id}`, bytes);
}

const trackDataSent = (aggregationNodeDataRef: ISimulationAggregatedDataState, intermediate: ISimulationIntermediateDataState, nodeId: string, type: string, id: string) => {
  const data = getNodeData(aggregationNodeDataRef, nodeId);
  const bytes = intermediate.bytes.get(`${type}-${id}`) ?? 0;
  if (!data.sent[type]) {
    data.sent[type] = { count: 0, bytes: 0 };
  }
  data.sent[type].count += 1;
  data.sent[type].bytes += bytes;
  data.bytesSent += bytes;
};

const trackDataReceived = (aggregationNodeDataRef: ISimulationAggregatedDataState, intermediate: ISimulationIntermediateDataState, nodeId: string, type: string, id: string) => {
  const data = getNodeData(aggregationNodeDataRef, nodeId);
  const bytes = intermediate.bytes.get(`${type}-${id}`) ?? 0;
  if (!data.received[type]) {
    data.received[type] = { count: 0, bytes: 0 };
  }
  data.received[type].count += 1;
  data.received[type].bytes += bytes;
  data.bytesReceived += bytes;
};

const getNodeData = (aggregationNodeDataRef: ISimulationAggregatedDataState, nodeId: string): ISimulationAggregatedData => {
  let oldData = aggregationNodeDataRef.nodes.get(nodeId);
  if (oldData) {
    return oldData;
  }
  const data = {
    bytesSent: 0,
    bytesReceived: 0,
    generated: {},
    sent: {},
    received: {},
  };
  aggregationNodeDataRef.nodes.set(nodeId, data);
  return data;
};

export const processMessage = (
  json: IServerMessage,
  aggregatedData: ISimulationAggregatedDataState,
  intermediate: ISimulationIntermediateDataState,
) => {
  const { message } = json;

  if (message.type === EMessageType.TransactionGenerated) {
    trackDataGenerated(aggregatedData, intermediate, message.publisher, "tx", message.id, message.bytes);
    intermediate.txs.push({ id: Number(message.id), bytes: message.bytes });
  } else if (message.type === EMessageType.TransactionSent) {
    trackDataSent(aggregatedData, intermediate, message.sender, "tx", message.id);
  } else if (message.type === EMessageType.TransactionReceived) {
    trackDataReceived(aggregatedData, intermediate, message.recipient, "tx", message.id);
  } else if (message.type === EMessageType.IBGenerated) {
    const bytes = message.transactions.reduce((sum, tx) => sum + (intermediate.bytes.get(`tx-${tx}`) ?? 0), message.header_bytes);
    trackDataGenerated(aggregatedData, intermediate, message.producer, "ib", message.id, bytes);
    intermediate.ibs.set(message.id, {
      slot: message.slot,
      headerBytes: message.header_bytes,
      txs: message.transactions,
    });
  } else if (message.type === EMessageType.IBSent) {
    trackDataSent(aggregatedData, intermediate, message.sender, "ib", message.id);
  } else if (message.type === EMessageType.IBReceived) {
    trackDataReceived(aggregatedData, intermediate, message.recipient, "ib", message.id);
  } else if (message.type === EMessageType.RBGenerated) {
    let bytes = message.transactions.reduce((sum, tx) => sum + (intermediate.bytes.get(`tx-${tx}`) ?? 0), message.header_bytes);
    const block: ISimulationBlock = {
      slot: message.slot,
      headerBytes: message.header_bytes,
      txs: message.transactions.map(id => intermediate.txs[id]),
      cert: null,
    };
    for (const id of message.transactions) {
      intermediate.praosTxs.add(id);
    }
    if (message.endorsement != null) {
      bytes += message.endorsement.bytes;
      const ebId = message.endorsement.eb.id;
      const eb = intermediate.ebs.get(ebId)!;
      const ibs = eb.ibs.map(id => {
        const ib = intermediate.ibs.get(id)!;
        for (const tx of ib.txs) {
          if (!intermediate.praosTxs.has(tx)) {
            intermediate.leiosTxs.add(tx);
          }
        }
        const txs = ib.txs.map(tx => intermediate.txs[tx]);
        return {
          id,
          slot: ib.slot,
          headerBytes: ib.headerBytes,
          txs,
        };
      })
      block.cert = {
        bytes: message.endorsement.bytes,
        eb: {
          id: ebId,
          slot: eb.slot,
          bytes: eb.bytes,
          ibs,
        }
      }
    }
    trackDataGenerated(aggregatedData, intermediate, message.producer, "pb", message.id, bytes);
    aggregatedData.global.praosTxOnChain = intermediate.praosTxs.size;
    aggregatedData.global.leiosTxOnChain = intermediate.leiosTxs.size;
    aggregatedData.blocks.push(block);
  } else if (message.type === EMessageType.RBSent) {
    trackDataSent(aggregatedData, intermediate, message.sender, "pb", message.id);
  } else if (message.type === EMessageType.RBReceived) {
    trackDataReceived(aggregatedData, intermediate, message.recipient, "pb", message.id);
  } else if (message.type === EMessageType.EBGenerated) {
    trackDataGenerated(aggregatedData, intermediate, message.producer, "eb", message.id, message.bytes);
    intermediate.ebs.set(message.id, {
      slot: message.slot,
      bytes: message.bytes,
      ibs: message.input_blocks.map(ib => ib.id),
    });
  } else if (message.type === EMessageType.EBSent) {
    trackDataSent(aggregatedData, intermediate, message.sender, "eb", message.id);
  } else if (message.type === EMessageType.EBReceived) {
    trackDataReceived(aggregatedData, intermediate, message.recipient, "eb", message.id);
  } else if (message.type === EMessageType.VTBundleGenerated) {
    trackDataGenerated(aggregatedData, intermediate, message.producer, "votes", message.id, message.bytes);
  } else if (message.type === EMessageType.VTBundleSent) {
    trackDataSent(aggregatedData, intermediate, message.sender, "votes", message.id);
  } else if (message.type === EMessageType.VTBundleReceived) {
    trackDataReceived(aggregatedData, intermediate, message.recipient, "votes", message.id);
  }
};
