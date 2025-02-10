{-# LANGUAGE InstanceSigs #-}
{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE RecordWildCards #-}
{-# LANGUAGE TypeApplications #-}

module Test.Config where

import Control.Exception
import Control.Monad
import Data.Aeson
import qualified Data.Aeson.KeyMap as KM
import Data.Bifunctor (Bifunctor (..))
import qualified Data.ByteString.Char8 as BS8
import Data.Default
import Data.String
import qualified Data.Text as T
import qualified Data.Yaml as Yaml
import JSONCompat
import LeiosProtocol.Config
import Paths_ouroboros_leios_sim (getDataFileName)
import SimTypes (World (..), WorldDimensions, WorldShape (..))
import System.Directory (doesFileExist)
import Test.QuickCheck (Arbitrary (..), Gen, NonNegative (..), Positive (..), Property, ioProperty)
import Test.QuickCheck.Arbitrary (arbitraryBoundedEnum)
import Test.QuickCheck.Gen (Gen (..))
import Test.QuickCheck.Random (QCGen (..))
import Test.Tasty (TestTree, testGroup)
import Test.Tasty.HUnit
import Test.Tasty.QuickCheck (Small (..), testProperty)

tests :: TestTree
tests =
  testGroup
    "Config"
    [ testCaseSteps "test_defaultConfigOnDiskMatchesDef" test_defaultConfigOnDiskMatchesDef
    ]

test_defaultConfigOnDiskMatchesDef :: (String -> IO ()) -> Assertion
test_defaultConfigOnDiskMatchesDef step = do
  step "Checking default config file exists."
  defaultConfigFile <- getDataFileName "test/data/simulation/config.default.yaml"
  assertBool (unwords ["File", defaultConfigFile, "does not exist"]) =<< doesFileExist defaultConfigFile

  step $ unlines ["Attempting to read default config file:", defaultConfigFile]
  diskConfig <- readConfig defaultConfigFile

  step "Checking on-disk config matches def."
  let defConfig = def :: Config
      diffJSONObjects (Object km) (Object km1) =
        Object
          ( KM.map snd . KM.filter (not . fst) $
              KM.intersectionWith (\l r -> (l == r, toJSON [l, r])) km km1
          )
      diffJSONObjects _ _ = String (T.pack "Not objects")
  assertEqual
    ( unlines
        [ "Default config file does not match Default.def"
        , "diff:"
        , BS8.unpack $ Yaml.encode $ diffJSONObjects (toJSON defConfig) (toJSON diskConfig)
        ]
    )
    defConfig
    diskConfig

  step "Checking all the keys in def are also on disk."
  diskConfigValue <- Yaml.decodeFileEither defaultConfigFile
  case (toJSON defConfig, diskConfigValue) of
    (Object defKM, Right (Object diskKM)) -> do
      let otherDiff = diskKM `KM.difference` defKM
      unless (null otherDiff) $ do
        step $
          unlines
            [ "WARNING: parameters on disk not generated by toJSON def."
            , "Could be some we just don't use, or could be missing from ToJSON instance."
            , (BS8.unpack $ Yaml.encode $ Object $ diskKM `KM.difference` defKM)
            ]
      let diff = defKM `KM.difference` diskKM
      assertBool
        ( unlines
            [ "Config parameters missing on disk:"
            , BS8.unpack $ Yaml.encode (Object diff)
            ]
        )
        (null diff)
    (_, Left err) -> assertFailure $ "Config not yaml: " ++ displayException err
    _otherwise -> assertFailure "Config not an Object."
