// SPDX-License-Identifier: Apache-2.0
// Copyright 2024 Aztec Labs.
pragma solidity >=0.8.27;

// The protocol constants the message boxes check (aztec-packages v6.0.0, `ConstantsGen.sol`).
library Constants {
  uint256 internal constant MAX_FIELD_VALUE =
    21_888_242_871_839_275_222_246_405_745_257_275_088_548_364_400_416_034_343_698_204_186_575_808_495_616;
  uint256 internal constant MAX_L1_TO_L2_MSGS_PER_BLOCK = 256;
  uint256 internal constant INITIAL_CHECKPOINT_NUMBER = 1;
  uint256 internal constant MAX_CHECKPOINTS_PER_EPOCH = 32;
  uint256 internal constant FEE_JUICE_ADDRESS = 3;
  uint256 internal constant DOM_SEP__INBOX_ROLLING_HASH = 3_737_216_265;
}
