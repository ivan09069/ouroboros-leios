{-# LANGUAGE ConstraintKinds #-}
{-# LANGUAGE DuplicateRecordFields #-}
{-# LANGUAGE MultiParamTypeClasses #-}
{-# LANGUAGE RecordWildCards #-}
{-# LANGUAGE TupleSections #-}

module TaskMultiQueue where

import Control.Monad
import Control.Monad.Class.MonadAsync
import Control.Monad.Class.MonadFork (MonadFork (forkIO))
import Control.Monad.Class.MonadThrow
import Control.Tracer
import Data.Array
import qualified Data.Map.Strict as Map
import GHC.Natural
import STMCompat
import SimTypes
import TimeCompat
import WorkerPool

type IsLabel lbl = (Ix lbl, Bounded lbl)

newtype TaskMultiQueue lbl m = TaskMultiQueue (Array lbl (TBQueue m (CPUTask, m ())))

newTaskMultiQueue' :: (MonadSTM m, Ix l) => (l, l) -> Natural -> STM m (TaskMultiQueue l m)
newTaskMultiQueue' (a, b) n =
  TaskMultiQueue . listArray (a, b) <$> mapM (const $ newTBQueue n) (range (a, b))

newTaskMultiQueue :: forall l m. (MonadSTM m, IsLabel l) => Natural -> STM m (TaskMultiQueue l m)
newTaskMultiQueue = newTaskMultiQueue' (minBound, maxBound)

writeTMQueue :: (MonadSTM m, IsLabel l) => TaskMultiQueue l m -> l -> (CPUTask, m ()) -> STM m ()
writeTMQueue (TaskMultiQueue mq) lbl = writeTBQueue (mq ! lbl)

readTMQueue :: forall m l. (MonadSTM m, IsLabel l) => TaskMultiQueue l m -> l -> STM m (CPUTask, m ())
readTMQueue (TaskMultiQueue mq) lbl = readTBQueue (mq ! lbl)

flushTMQueue :: forall m l. (MonadSTM m, IsLabel l) => TaskMultiQueue l m -> STM m [(l, [(CPUTask, m ())])]
flushTMQueue (TaskMultiQueue mq) = forM (assocs mq) (\(l, q) -> (l,) <$> flushTBQueue q)

runInfParallelBlocking ::
  forall m l.
  (MonadSTM m, MonadDelay m, IsLabel l, MonadMonotonicTimeNSec m, MonadFork m) =>
  Tracer m CPUTask ->
  TaskMultiQueue l m ->
  m ()
runInfParallelBlocking tracer mq = do
  xs <- atomically $ do
    xs <- concatMap snd <$> flushTMQueue mq
    when (null xs) retry
    return xs
  mapM_ (traceWith tracer . fst) xs
  now <- getMonotonicTime
  -- forking to do the waiting so we can go back to fetch more tasks.
  -- on the worst case this forks for each task, which might degrade sim performance.
  -- Andrea: a small experiment with short-leios-p2p-1 shows up to 16 tasks at once.
  --         OTOH only 14% of the time we had more than 1 task.
  void $ forkIO $ do
    let tasksByEnd = Map.fromListWith (<>) [(addTime cpuTaskDuration now, [m]) | (CPUTask{..}, m) <- xs]

    forM_ (Map.toAscList tasksByEnd) $ \(end, ms) -> do
      waitUntil end
      sequence_ ms

processCPUTasks ::
  (MonadSTM m, MonadDelay m, MonadMonotonicTimeNSec m, MonadFork m, MonadAsync m, MonadCatch m, IsLabel lbl) =>
  NumCores ->
  Tracer m CPUTask ->
  TaskMultiQueue lbl m ->
  m ()
processCPUTasks Infinite tracer queue = forever $ runInfParallelBlocking tracer queue
processCPUTasks (Finite n) tracer queue = newBoundedWorkerPool n [taskSource l | l <- range (minBound, maxBound)]
 where
  taskSource l = do
    (cpu, m) <- readTMQueue queue l
    var <- newEmptyTMVar
    let action = do
          traceWith tracer cpu
          threadDelay (cpuTaskDuration cpu)
          m
    -- TODO: read from var and log exception.
    return $ Task action var

defaultQueueBound :: NumCores -> Natural
defaultQueueBound processingCores = do
  fromIntegral $ case processingCores of
    Infinite -> 100
    Finite n -> n * 2
