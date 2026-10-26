// SPDX-License-Identifier: Apache-2.0
pragma solidity 0.8.30;

import {Vm} from "forge-std/Vm.sol";
import {Hash} from "@aztec/Hash.sol";
import {Epoch} from "@aztec/TimeLib.sol";
import {YacanaHashes} from "../src/YacanaHashes.sol";
import {YacanaPortal} from "../src/YacanaPortal.sol";
import {FakeRollup, Harness} from "./Harness.sol";

/// The gas bounds the portal and its clients name, against their worst cases: a batched leaf whose
/// every write is new and whose witness is as deep as any the page accepts, and an Inbox write that
/// opens a bucket its estimate did not. Each test runs isolated, so every call starts cold.
contract GasTest is Harness {
  /// The page's witness parser refuses deeper paths (`MAX_PATH_LENGTH`, packages/bridge/src/witness.ts).
  uint256 internal constant DEEPEST = 64;
  /// The clients' `INBOX_BUCKET_GAS` (packages/bridge/src/inbox.ts).
  uint256 internal constant INBOX_BUCKET_GAS = 45_000;
  Epoch internal constant EPOCH = Epoch.wrap(3);

  /// forge-config: default.isolate = true
  function testAnExitWithTheDeepestWitnessFitsALeaf() public {
    bytes32 tag = keccak256("deep exit");
    bytes32 leaf = leafOf(messageOf(V1, MINER, YacanaHashes.exitContent(alice, 1 ether, tag)));
    YacanaPortal.ForwardArgs[] memory batch = new YacanaPortal.ForwardArgs[](1);
    batch[0] = exitArgs(alice, 1 ether, tag, EPOCH, publishDeep(v1, leaf));
    batch[0].leafIndex = (1 << DEEPEST) - 1;
    forwardAlone(batch);
    assertEq(portal.YACA_TOKEN().balanceOf(alice), 1 ether);
    assertTrue(v1.OUTBOX().hasMessageBeenConsumedAtEpoch(EPOCH, (1 << (DEEPEST + 1)) - 1));
  }

  /// forge-config: default.isolate = true
  function testASignedSendAheadOpeningItsTargetsFirstBucketFitsALeaf() public {
    FakeRollup v2 = flipTo(V2);
    registerV2(v2);
    bytes32 secretHash = bytes32(uint256(keccak256("deep secret")) >> 8);
    bytes32 leaf = leafOf(messageOf(V1, MINER, YacanaHashes.sendAheadContent(1 ether, secretHash, redeemer)));
    YacanaPortal.ForwardArgs[] memory batch = new YacanaPortal.ForwardArgs[](1);
    batch[0] = aheadArgs(1 ether, secretHash, redeemer, EPOCH, publishDeep(v1, leaf));
    batch[0].leafIndex = (1 << DEEPEST) - 1;
    batch[0].expiry = uint64(block.timestamp + 1 hours);
    batch[0].sig = signForward(redeemKey, V1, batch[0], V2, batch[0].expiry);
    assertEq(v2.INBOX().getCurrentBucketSeq(), 0);
    forwardAlone(batch);
    assertEq(v2.INBOX().getCurrentBucketSeq(), 1);
    assertEq(v2.INBOX().getTotalMessagesInserted(), 1);
    assertTrue(v1.OUTBOX().hasMessageBeenConsumedAtEpoch(EPOCH, (1 << (DEEPEST + 1)) - 1));
  }

  /// An estimate run at a block that already holds a message appends to that block's bucket; the
  /// deposit lands in a later block and opens one, on the first lap a slot never written.
  /// forge-config: default.isolate = true
  function testOpeningABucketCostsADepositAtMostTheClientsMargin() public {
    portal.forward(V1, publishedExit(v1, MINER, 5 ether, 3));
    depositGas();
    uint256 appended = depositGas();
    vm.warp(vm.getBlockTimestamp() + 12);
    uint256 opened = depositGas();
    assertEq(v1.INBOX().getCurrentBucketSeq(), 2);
    assertGt(opened, appended);
    // The portal's frame passes the Inbox 63/64 of what it holds, so the margin covers 64/63 of the gap.
    assertLe((opened - appended) * 64 / 63, INBOX_BUCKET_GAS);
  }

  /// Publishes `leaf` as the last leaf of an epoch tree `DEEPEST` levels deep; returns its witness.
  function publishDeep(FakeRollup rollup, bytes32 leaf) internal returns (bytes32[] memory path) {
    path = new bytes32[](DEEPEST);
    bytes32 node = leaf;
    for (uint256 h = 0; h < DEEPEST; h++) {
      path[h] = keccak256(abi.encode("sibling", h));
      node = Hash.sha256ToField(bytes.concat(path[h], node));
    }
    rollup.insertRoot(EPOCH, 1, node);
  }

  /// The batch from a holder who is not a listed forwarder, so a send-ahead pays for its signature.
  function forwardAlone(YacanaPortal.ForwardArgs[] memory batch) internal {
    vm.recordLogs();
    vm.prank(alice);
    portal.forwardMany(V1, batch);
    Vm.Log[] memory logs = vm.getRecordedLogs();
    for (uint256 i = 0; i < logs.length; i++) {
      assertTrue(logs[i].topics.length == 0 || logs[i].topics[0] != YacanaPortal.LeafFailed.selector, "LeafFailed");
    }
  }

  function depositGas() internal returns (uint256 used) {
    vm.prank(alice);
    used = gasleft();
    portal.deposit(1 ether, bytes32(uint256(1)), V1, vm.getBlockTimestamp() + 1 hours);
    used -= gasleft();
  }
}
