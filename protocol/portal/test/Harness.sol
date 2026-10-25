// SPDX-License-Identifier: Apache-2.0
pragma solidity 0.8.30;

import {Test} from "forge-std/Test.sol";
import {ERC20} from "@oz/token/ERC20/ERC20.sol";
import {DataStructures} from "@aztec/DataStructures.sol";
import {Hash} from "@aztec/Hash.sol";
import {IInbox} from "@aztec/IInbox.sol";
import {IOutbox} from "@aztec/IOutbox.sol";
import {IHaveVersion, IRegistry} from "@aztec/IRegistry.sol";
import {Epoch} from "@aztec/TimeLib.sol";
import {Inbox} from "@aztec-test/Inbox.sol";
import {Outbox} from "@aztec-test/Outbox.sol";
import {YacanaHashes} from "../src/YacanaHashes.sol";
import {YacanaPortal} from "../src/YacanaPortal.sol";

/// One rollup version under test: the real Outbox and Inbox with this contract as their rollup, so
/// roots are inserted and messages consumed exactly as on the network.
contract FakeRollup is IHaveVersion {
  uint256 public immutable VERSION;
  Outbox public immutable OUTBOX;
  Inbox public immutable INBOX;

  constructor(uint256 version, ERC20 feeAsset) {
    VERSION = version;
    OUTBOX = new Outbox(address(this), version);
    INBOX = new Inbox(address(this), feeAsset, version, 512);
  }

  function getVersion() external view returns (uint256) {
    return VERSION;
  }

  function getInbox() external view returns (IInbox) {
    return INBOX;
  }

  function getOutbox() external view returns (IOutbox) {
    return OUTBOX;
  }

  function insertRoot(Epoch epoch, uint256 numCheckpoints, bytes32 root) external {
    OUTBOX.insert(epoch, numCheckpoints, root);
  }
}

/// The Registry as the portal reads it: a version history the test appends to.
contract FakeRegistry is IRegistry {
  uint256[] internal history;
  mapping(uint256 => IHaveVersion) internal rollups;

  function addRollup(IHaveVersion rollup) external {
    uint256 version = rollup.getVersion();
    rollups[version] = rollup;
    history.push(version);
    emit CanonicalRollupUpdated(address(rollup), version);
  }

  function updateRewardDistributor(address) external {}

  function getCanonicalRollup() external view returns (IHaveVersion) {
    return rollups[history[history.length - 1]];
  }

  function getRollup(uint256 version) external view returns (IHaveVersion) {
    return rollups[version];
  }

  function numberOfVersions() external view returns (uint256) {
    return history.length;
  }

  function getGovernance() external pure returns (address) {
    return address(0);
  }

  function getRewardDistributor() external pure returns (address) {
    return address(0);
  }

  function getVersion(uint256 index) external view returns (uint256) {
    return history[index];
  }
}

contract Fee is ERC20("fee", "FEE") {}

/// Everything a portal test starts from: one registered version, a policy of three coins per hour
/// and a day's allowance, the operators and a forwarder, and helpers that build a two-leaf epoch
/// tree so a message can be consumed against a real root with a real sibling path.
abstract contract Harness is Test {
  uint128 internal constant PER_HOUR = 3 ether;
  uint128 internal constant ALLOWANCE = 72 ether;
  uint64 internal constant EXIT_FLOOR = 180 days;
  uint64 internal constant PAUSE_MAX = 30 days;
  uint64 internal constant PAUSE_BUDGET = 60 days;
  bytes32 internal constant MINER = bytes32(uint256(0x1234));
  bytes32 internal constant MINER2 = bytes32(uint256(0x5678));

  address internal operators = makeAddr("operators");
  address internal forwarder = makeAddr("forwarder");
  address internal alice = makeAddr("alice");
  uint256 internal redeemKey = 0xA11CE;
  address internal redeemer = vm.addr(0xA11CE);

  Fee internal fee;
  FakeRegistry internal registry;
  FakeRollup internal v1;
  YacanaPortal internal portal;
  uint256 internal V1 = 1821665230;
  uint256 internal V2 = 2941665231;
  uint256 internal V3 = 3061665232;

  function setUp() public virtual {
    vm.warp(1_000_000);
    fee = new Fee();
    registry = new FakeRegistry();
    v1 = new FakeRollup(V1, fee);
    registry.addRollup(v1);
    portal = new YacanaPortal(
      registry,
      operators,
      YacanaPortal.Policy({
        perHour: PER_HOUR,
        allowance: ALLOWANCE,
        exitFloor: EXIT_FLOOR,
        pauseMax: PAUSE_MAX,
        pauseBudget: PAUSE_BUDGET,
        launchBackdate: 7 days,
        launchAhead: 90 days,
        leafGas: 400_000
      }),
      "Yacana",
      "YACA"
    );
    vm.prank(operators);
    portal.registerVersion(V1, 0, MINER, uint64(block.timestamp));
    vm.prank(operators);
    portal.setForwarder(forwarder, true);
  }

  // ---- messages and witnesses ----------------------------------------------------------------

  function messageOf(uint256 version, bytes32 miner, bytes32 content) internal view returns (DataStructures.L2ToL1Msg memory) {
    return DataStructures.L2ToL1Msg({
      sender: DataStructures.L2Actor(miner, version),
      recipient: DataStructures.L1Actor(address(portal), block.chainid),
      content: content
    });
  }

  function leafOf(DataStructures.L2ToL1Msg memory m) internal pure returns (bytes32) {
    return Hash.sha256ToField(
      abi.encodePacked(m.sender.actor, m.sender.version, m.recipient.actor, m.recipient.chainId, m.content)
    );
  }

  /// A one-level tree of two leaves; the witness of the leaf at `index` is its sibling.
  function rootOf(bytes32 left, bytes32 right) internal pure returns (bytes32) {
    return Hash.sha256ToField(bytes.concat(left, right));
  }

  /// Publishes `leaf` (paired with a filler) as the root of `epoch` on `rollup`, returning the
  /// path that proves it at index 0.
  function publish(FakeRollup rollup, Epoch epoch, bytes32 leaf) internal returns (bytes32[] memory path) {
    bytes32 filler = keccak256(abi.encode("filler", epoch, leaf));
    rollup.insertRoot(epoch, 1, rootOf(leaf, filler));
    path = new bytes32[](1);
    path[0] = filler;
  }

  function exitArgs(address recipient, uint256 amount, bytes32 tag, Epoch epoch, bytes32[] memory path)
    internal
    pure
    returns (YacanaPortal.ForwardArgs memory)
  {
    return YacanaPortal.ForwardArgs({
      kind: 1,
      amount: amount,
      aux: tag,
      recipientOrRedeemKey: recipient,
      epoch: epoch,
      numCheckpointsInEpoch: 1,
      leafIndex: 0,
      path: path,
      sig: "",
      expiry: 0
    });
  }

  function aheadArgs(uint256 amount, bytes32 secretHash, address key, Epoch epoch, bytes32[] memory path)
    internal
    pure
    returns (YacanaPortal.ForwardArgs memory)
  {
    return YacanaPortal.ForwardArgs({
      kind: 2,
      amount: amount,
      aux: secretHash,
      recipientOrRedeemKey: key,
      epoch: epoch,
      numCheckpointsInEpoch: 1,
      leafIndex: 0,
      path: path,
      sig: "",
      expiry: 0
    });
  }

  /// An exit to Ethereum of `amount`, published on `rollup` at `epoch`, ready to forward.
  function publishedExit(FakeRollup rollup, bytes32 miner, uint256 amount, uint64 epoch)
    internal
    returns (YacanaPortal.ForwardArgs memory)
  {
    bytes32 tag = keccak256(abi.encode("tag", epoch, amount));
    bytes32 content = YacanaHashes.exitContent(alice, amount, tag);
    bytes32[] memory path = publish(rollup, Epoch.wrap(epoch), leafOf(messageOf(rollup.VERSION(), miner, content)));
    return exitArgs(alice, amount, tag, Epoch.wrap(epoch), path);
  }

  /// A send-ahead of `amount` under the test redeem key, published on `rollup` at `epoch`.
  function publishedAhead(FakeRollup rollup, bytes32 miner, uint256 amount, uint64 epoch)
    internal
    returns (YacanaPortal.ForwardArgs memory)
  {
    bytes32 secretHash = bytes32(uint256(keccak256(abi.encode("secret", epoch, amount))) >> 8);
    bytes32 content = YacanaHashes.sendAheadContent(amount, secretHash, redeemer);
    bytes32[] memory path = publish(rollup, Epoch.wrap(epoch), leafOf(messageOf(rollup.VERSION(), miner, content)));
    return aheadArgs(amount, secretHash, redeemer, Epoch.wrap(epoch), path);
  }

  // ---- signatures ------------------------------------------------------------------------------

  function domainSeparator() internal view returns (bytes32) {
    return keccak256(
      abi.encode(
        keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"),
        keccak256("YacanaPortal"),
        keccak256("1"),
        block.chainid,
        address(portal)
      )
    );
  }

  function signForward(uint256 key, uint256 version, YacanaPortal.ForwardArgs memory a, uint256 target, uint64 expiry)
    internal
    view
    returns (bytes memory)
  {
    bytes32 content = YacanaHashes.sendAheadContent(a.amount, a.aux, a.recipientOrRedeemKey);
    uint256 leafId = (1 << a.path.length) + a.leafIndex;
    bytes32 structHash = keccak256(
      abi.encode(
        keccak256(
          "Forward(uint256 version,uint256 epoch,uint256 leafId,bytes32 contentHash,uint256 target,uint256 expiry)"
        ),
        version,
        Epoch.unwrap(a.epoch),
        leafId,
        content,
        target,
        expiry
      )
    );
    (uint8 v, bytes32 r, bytes32 s) =
      vm.sign(key, keccak256(abi.encodePacked("\x19\x01", domainSeparator(), structHash)));
    return abi.encodePacked(r, s, v);
  }

  function signRedeem(uint256 key, uint256 version, YacanaPortal.ForwardArgs memory a, address recipient, uint64 expiry)
    internal
    view
    returns (bytes memory)
  {
    bytes32 content = YacanaHashes.sendAheadContent(a.amount, a.aux, a.recipientOrRedeemKey);
    uint256 leafId = (1 << a.path.length) + a.leafIndex;
    bytes32 structHash = keccak256(
      abi.encode(
        keccak256(
          "Redeem(uint256 version,uint256 epoch,uint256 leafId,bytes32 contentHash,address recipient,uint256 expiry)"
        ),
        version,
        Epoch.unwrap(a.epoch),
        leafId,
        content,
        uint256(uint160(recipient)),
        expiry
      )
    );
    (uint8 v, bytes32 r, bytes32 s) =
      vm.sign(key, keccak256(abi.encodePacked("\x19\x01", domainSeparator(), structHash)));
    return abi.encodePacked(r, s, v);
  }

  // ---- the flip --------------------------------------------------------------------------------

  /// A new version in the Registry; returns its rollup. The portal learns of it on its next call.
  function flipTo(uint256 version) internal returns (FakeRollup) {
    FakeRollup next = new FakeRollup(version, fee);
    registry.addRollup(next);
    return next;
  }

  function registerV2(FakeRollup r) internal {
    registerV2At(r, uint64(block.timestamp));
  }

  function registerV2At(FakeRollup, uint64 launchAt) internal {
    vm.prank(operators);
    portal.registerVersion(V2, 1, MINER2, launchAt);
  }
}
