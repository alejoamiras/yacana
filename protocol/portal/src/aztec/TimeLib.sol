// SPDX-License-Identifier: Apache-2.0
// Copyright 2024 Aztec Labs.
pragma solidity >=0.8.27;

// The rollup's time units (aztec-packages v6.0.0, `shared/libraries/TimeMath.sol`): the portal only
// carries an Epoch through to the Outbox and reads a Timestamp back from the rollup.
type Timestamp is uint256;

type Slot is uint256;

type Epoch is uint256;
