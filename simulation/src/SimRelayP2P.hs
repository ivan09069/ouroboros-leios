{-# LANGUAGE FlexibleContexts #-}
{-# LANGUAGE NamedFieldPuns #-}
{-# LANGUAGE ScopedTypeVariables #-}

module SimRelayP2P where

import Control.Monad.Class.MonadAsync (
  Concurrently (Concurrently, runConcurrently),
 )
import Control.Monad.IOSim as IOSim (IOSim, runSimTrace)
import Control.Tracer as Tracer (
  Contravariant (contramap),
  Tracer,
  traceWith,
 )
import Data.Foldable (sequenceA_)
import Data.List (unfoldr)
import qualified Data.Map.Strict as Map
import System.Random (StdGen, split)
import TimeCompat

import Chan
import Chan.TCP (newConnectionTCP)
import SimRelay
import SimTCPLinks (labelDirToLabelLink, selectTimedEvents, simTracer)
import SimTypes
import Topology

traceRelayP2P ::
  StdGen ->
  P2PNetwork ->
  (DiffTime -> Maybe Bytes -> TcpConnProps) ->
  (StdGen -> RelayNodeConfig) ->
  RelaySimTrace
traceRelayP2P
  rng0
  P2PNetwork
    { p2pNodes
    , p2pLinks
    , p2pWorld
    }
  tcpprops
  relayConfig =
    selectTimedEvents $
      runSimTrace $ do
        traceWith tracer $
          RelaySimEventSetup
            p2pWorld
            p2pNodes
            (Map.keysSet p2pLinks)
        tcplinks <-
          sequence
            [ do
              (inChan, outChan) <-
                newConnectionTCP
                  (linkTracer na nb)
                  (tcpprops (secondsToDiffTime latency) bw)
              return ((na, nb), (inChan, outChan))
            | ((na, nb), (latency, bw)) <- Map.toList p2pLinks
            ]
        let tcplinksInChan =
              Map.fromListWith
                (++)
                [ (nfrom, [inChan])
                | ((nfrom, _nto), (inChan, _outChan)) <- tcplinks
                ]
            tcplinksOutChan =
              Map.fromListWith
                (++)
                [ (nto, [outChan])
                | ((_nfrom, nto), (_inChan, outChan)) <- tcplinks
                ]
        -- Note that the incomming edges are the output ends of the
        -- channels and vice versa. That's why it looks backwards.
        runConcurrently $
          sequenceA_
            [ Concurrently $
              relayNode
                (nodeTracer nid)
                (relayConfig rng)
                (Map.findWithDefault [] nid tcplinksOutChan)
                (Map.findWithDefault [] nid tcplinksInChan)
            | (nid, rng) <-
                zip
                  (Map.keys p2pNodes)
                  (unfoldr (Just . split) rng0)
            ]
   where
    tracer :: Tracer (IOSim s) RelaySimEvent
    tracer = simTracer

    nodeTracer :: NodeId -> Tracer (IOSim s) (RelayNodeEvent TestBlock)
    nodeTracer n =
      contramap (RelaySimEventNode . LabelNode n) tracer

    linkTracer ::
      NodeId ->
      NodeId ->
      Tracer
        (IOSim s)
        (LabelTcpDir (TcpEvent TestBlockRelayMessage))
    linkTracer nfrom nto =
      contramap (RelaySimEventTcp . labelDirToLabelLink nfrom nto) tracer
