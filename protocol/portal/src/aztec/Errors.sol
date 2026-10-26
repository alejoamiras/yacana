// SPDX-License-Identifier: Apache-2.0
// Copyright 2024 Aztec Labs.
pragma solidity >=0.8.27;

import {Epoch} from "@aztec/TimeLib.sol";

// The message boxes' errors (aztec-packages v6.0.0, `Errors.sol`), the subset the portal and its
// tests match on; selectors are those of the originals since the signatures are identical.
library Errors {
  error Inbox__Unauthorized();
  error Inbox__ActorTooLarge(bytes32 actor);
  error Inbox__VersionMismatch(uint256 expected, uint256 actual);
  error Inbox__ContentTooLarge(bytes32 content);
  error Inbox__SecretHashTooLarge(bytes32 secretHash);
  error Inbox__BucketOutOfWindow(uint256 seq, uint256 current);
  error Inbox__WouldOverwriteUnconsumedBucket(uint64 evictedBucketSeq);
  error Inbox__NoBucketAtOrBeforeTotal(uint256 upperBound, uint256 oldestLiveTotal);

  error Outbox__Unauthorized();
  error Outbox__InvalidChainId();
  error Outbox__VersionMismatch(uint256 expected, uint256 actual);
  error Outbox__InvalidRecipient(address expected, address actual);
  error Outbox__AlreadyNullified(Epoch epoch, uint256 leafIndex);
  error Outbox__NothingToConsumeAtEpoch(Epoch epoch);
  error Outbox__PathTooLong();
  error Outbox__LeafIndexOutOfBounds(uint256 leafIndex, uint256 pathLength);
  error Outbox__InvalidNumCheckpointsInEpoch(uint256 numCheckpointsInEpoch);

  error MerkleLib__InvalidRoot(bytes32 expected, bytes32 actual, bytes32 leaf, uint256 leafIndex);
  error MerkleLib__InvalidIndexForPathLength();
}
