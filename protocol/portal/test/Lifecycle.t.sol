// SPDX-License-Identifier: Apache-2.0
pragma solidity 0.8.30;

import {DataStructures} from "@aztec/DataStructures.sol";
import {Errors} from "@aztec/Errors.sol";
import {IInbox} from "@aztec/IInbox.sol";
import {YACA} from "../src/YACA.sol";
import {YacanaPortal} from "../src/YacanaPortal.sol";
import {FakeRollup, Harness} from "./Harness.sol";

/// Registration, retirement, deposits, redemption and the token's one minter.
contract LifecycleTest is Harness {
  function testRegistrationIsWriteOnceAndIndexChecked() public {
    vm.startPrank(operators);
    vm.expectRevert(abi.encodeWithSelector(YacanaPortal.AlreadyRegistered.selector, V1));
    portal.registerVersion(V1, 0, MINER, uint64(block.timestamp));
    vm.expectRevert(abi.encodeWithSelector(YacanaPortal.VersionIndexMismatch.selector, V2, 0));
    portal.registerVersion(V2, 0, MINER2, uint64(block.timestamp));
    vm.stopPrank();
  }

  function testRegistrationOutOfOrderWorks() public {
    flipTo(V2);
    flipTo(V3);
    vm.startPrank(operators);
    portal.registerVersion(V3, 2, MINER2, uint64(block.timestamp));
    portal.registerVersion(V2, 1, MINER2, uint64(block.timestamp));
    vm.stopPrank();
    assertEq(portal.registeredCount(), 3);
    // Registering V3 synced its own index and the ones after it; V1's flip (index 1) was recorded too.
    assertGt(portal.flipAt(V1), 0);
  }

  function testTheLaunchTimeIsBoundedAroundTheRegistration() public {
    flipTo(V2);
    vm.startPrank(operators);
    vm.expectRevert(
      abi.encodeWithSelector(YacanaPortal.LaunchOutOfWindow.selector, uint64(block.timestamp - 8 days))
    );
    portal.registerVersion(V2, 1, MINER2, uint64(block.timestamp - 8 days));
    vm.expectRevert(
      abi.encodeWithSelector(YacanaPortal.LaunchOutOfWindow.selector, uint64(block.timestamp + 91 days))
    );
    portal.registerVersion(V2, 1, MINER2, uint64(block.timestamp + 91 days));
    portal.registerVersion(V2, 1, MINER2, uint64(block.timestamp + 90 days));
    vm.stopPrank();
    // Before its launch the cap is the allowance alone.
    assertEq(portal.cap(V2), ALLOWANCE);
  }

  function testOnlyTheOperatorsRegister() public {
    vm.prank(alice);
    vm.expectRevert(abi.encodeWithSelector(YacanaPortal.NotOperators.selector, alice));
    portal.registerVersion(V2, 1, MINER2, uint64(block.timestamp));
  }

  function testRetireNeedsARecordedFlipAndSendsOnce() public {
    vm.expectRevert(abi.encodeWithSelector(YacanaPortal.FlipUnrecorded.selector, V1));
    portal.retire(V1);
    flipTo(V2);
    // retire() syncs first, so the flip is recorded inside the same call.
    vm.prank(alice);
    portal.retire(V1);
    assertEq(v1.INBOX().getTotalMessagesInserted(), 1);
    vm.expectRevert(abi.encodeWithSelector(YacanaPortal.RetireAlreadySent.selector, V1));
    portal.retire(V1);
  }

  function testRetireIsAllowedWhilePaused() public {
    flipTo(V2);
    vm.prank(operators);
    portal.pause(V1, 1 days);
    portal.retire(V1);
    assertTrue(portal.versionInfo(V1).retireSent);
  }

  function testDepositBurnsIntoTheLiveVersion() public {
    YacanaPortal.ForwardArgs memory a = publishedExit(v1, MINER, 5 ether, 3);
    portal.forward(V1, a);
    vm.prank(alice);
    uint256 index = portal.deposit(2 ether, bytes32(uint256(0x5ec)), V1, block.timestamp + 1 hours);
    // The Inbox numbers messages by their place in its insertion order: none came before this one.
    assertEq(index, 0);
    assertEq(portal.YACA_TOKEN().balanceOf(alice), 3 ether);
    assertEq(portal.versionInfo(V1).inbound, 2 ether);
    assertEq(v1.INBOX().getTotalMessagesInserted(), 1);
  }

  function testDepositRefusesAVersionThatIsNoLongerLive() public {
    portal.forward(V1, publishedExit(v1, MINER, 5 ether, 3));
    flipTo(V2);
    vm.prank(alice);
    vm.expectRevert(abi.encodeWithSelector(YacanaPortal.NotCanonical.selector, V1));
    portal.deposit(1 ether, bytes32(uint256(1)), V1, block.timestamp + 1 hours);
  }

  function testDepositRefusesAPastDeadlineAPauseAndAClose() public {
    portal.forward(V1, publishedExit(v1, MINER, 5 ether, 3));
    vm.startPrank(alice);
    vm.expectRevert(abi.encodeWithSelector(YacanaPortal.DeadlineExpired.selector, block.timestamp - 1));
    portal.deposit(1 ether, bytes32(uint256(1)), V1, block.timestamp - 1);
    vm.stopPrank();
    vm.prank(operators);
    portal.pause(V1, 1 days);
    vm.prank(alice);
    vm.expectRevert(abi.encodeWithSelector(YacanaPortal.VersionPaused.selector, V1));
    portal.deposit(1 ether, bytes32(uint256(1)), V1, block.timestamp + 1 hours);
    vm.warp(block.timestamp + 2 days);
    vm.prank(operators);
    portal.closeDeposits(V1);
    vm.prank(alice);
    vm.expectRevert(abi.encodeWithSelector(YacanaPortal.DepositsAreClosed.selector, V1));
    portal.deposit(1 ether, bytes32(uint256(1)), V1, block.timestamp + 1 hours);
  }

  function testDepositRefusesAnUnregisteredVersion() public {
    vm.prank(alice);
    vm.expectRevert(abi.encodeWithSelector(YacanaPortal.NotRegistered.selector, V2));
    portal.deposit(1 ether, bytes32(uint256(1)), V2, block.timestamp + 1 hours);
  }

  function testRedeemMintsToTheSignedRecipient() public {
    YacanaPortal.ForwardArgs memory a = publishedAhead(v1, MINER, 5 ether, 3);
    uint64 expiry = uint64(block.timestamp + 1 hours);
    bytes memory sig = signRedeem(redeemKey, V1, a, alice, expiry);
    portal.redeem(V1, a, alice, expiry, sig);
    assertEq(portal.YACA_TOKEN().balanceOf(alice), 5 ether);
    assertEq(portal.versionInfo(V1).exited, 5 ether);
  }

  function testRedeemRefusesAWrongSignerAnExpiredSignatureAndAReplay() public {
    YacanaPortal.ForwardArgs memory a = publishedAhead(v1, MINER, 5 ether, 3);
    uint64 expiry = uint64(block.timestamp + 1 hours);
    bytes memory wrong = signRedeem(0xBAD, V1, a, alice, expiry);
    vm.expectRevert(abi.encodeWithSelector(YacanaPortal.NotAuthorised.selector, redeemer));
    portal.redeem(V1, a, alice, expiry, wrong);
    bytes memory stale = signRedeem(redeemKey, V1, a, alice, uint64(block.timestamp - 1));
    vm.expectRevert(
      abi.encodeWithSelector(YacanaPortal.SignatureExpired.selector, uint64(block.timestamp - 1))
    );
    portal.redeem(V1, a, alice, uint64(block.timestamp - 1), stale);
    bytes memory sig = signRedeem(redeemKey, V1, a, alice, expiry);
    portal.redeem(V1, a, alice, expiry, sig);
    vm.expectRevert();
    portal.redeem(V1, a, alice, expiry, sig);
  }

  function testARedeemedLeafCannotBeForwarded() public {
    YacanaPortal.ForwardArgs memory a = publishedAhead(v1, MINER, 5 ether, 3);
    registerV2(flipTo(V2));
    uint64 expiry = uint64(block.timestamp + 1 hours);
    portal.redeem(V1, a, alice, expiry, signRedeem(redeemKey, V1, a, alice, expiry));
    vm.prank(forwarder);
    vm.expectRevert();
    portal.forward(V1, a);
  }

  function testAForwardedLeafCannotBeRedeemed() public {
    YacanaPortal.ForwardArgs memory a = publishedAhead(v1, MINER, 5 ether, 3);
    registerV2(flipTo(V2));
    vm.prank(forwarder);
    portal.forward(V1, a);
    uint64 expiry = uint64(block.timestamp + 1 hours);
    bytes memory sig = signRedeem(redeemKey, V1, a, alice, expiry);
    vm.expectRevert();
    portal.redeem(V1, a, alice, expiry, sig);
  }

  function testRedeemIsUnderTheCapAndThePause() public {
    YacanaPortal.ForwardArgs memory a = publishedAhead(v1, MINER, ALLOWANCE + 1, 3);
    uint64 expiry = uint64(block.timestamp + 10 days);
    bytes memory sig = signRedeem(redeemKey, V1, a, alice, expiry);
    vm.expectRevert(
      abi.encodeWithSelector(YacanaPortal.WaitsForHeadroom.selector, V1, ALLOWANCE + 1, ALLOWANCE)
    );
    portal.redeem(V1, a, alice, expiry, sig);
    vm.prank(operators);
    portal.pause(V1, 1 days);
    vm.expectRevert(abi.encodeWithSelector(YacanaPortal.VersionPaused.selector, V1));
    portal.redeem(V1, a, alice, expiry, sig);
  }

  function testRedeemClosesPastTheDeadline() public {
    YacanaPortal.ForwardArgs memory a = publishedAhead(v1, MINER, 1 ether, 3);
    flipTo(V2);
    portal.noteTransition(1);
    flipTo(V3);
    portal.noteTransition(2);
    vm.warp(portal.deadline(V1) + 1);
    uint64 expiry = uint64(block.timestamp + 1 hours);
    bytes memory sig = signRedeem(redeemKey, V1, a, alice, expiry);
    vm.expectRevert(abi.encodeWithSelector(YacanaPortal.DeadlinePassed.selector, V1));
    portal.redeem(V1, a, alice, expiry, sig);
  }

  function testARejectedInboxSendRestoresTheDepositorsBalanceAndInbound() public {
    // A deposit whose Inbox send reverts (a secret hash past the field) undoes the burn too.
    portal.forward(V1, publishedExit(v1, MINER, 5 ether, 3));
    vm.prank(alice);
    vm.expectRevert();
    portal.deposit(2 ether, bytes32(type(uint256).max), V1, block.timestamp + 1 hours);
    assertEq(portal.YACA_TOKEN().balanceOf(alice), 5 ether);
    assertEq(portal.versionInfo(V1).inbound, 0);
  }

  function testOperatorsCannotBeZero() public {
    vm.prank(operators);
    vm.expectRevert(YacanaPortal.ZeroOperators.selector);
    portal.setOperators(address(0));
  }

  function testRedeemWorksBeforeAnyFlip() public {
    // A send-ahead whose flip never comes is never stranded.
    YacanaPortal.ForwardArgs memory a = publishedAhead(v1, MINER, 1 ether, 3);
    uint64 expiry = uint64(block.timestamp + 1 hours);
    portal.redeem(V1, a, alice, expiry, signRedeem(redeemKey, V1, a, alice, expiry));
    assertEq(portal.YACA_TOKEN().balanceOf(alice), 1 ether);
  }

  function testTheTokenMintsAndBurnsForThePortalOnly() public {
    YACA token = portal.YACA_TOKEN();
    assertEq(token.PORTAL(), address(portal));
    vm.prank(alice);
    vm.expectRevert(abi.encodeWithSelector(YACA.NotPortal.selector, alice));
    token.mint(alice, 1);
    vm.prank(alice);
    vm.expectRevert(abi.encodeWithSelector(YACA.NotPortal.selector, alice));
    token.burnFrom(alice, 1);
  }

  function testSupplyEqualsMintedMinusBurned() public {
    portal.forward(V1, publishedExit(v1, MINER, 5 ether, 3));
    portal.forward(V1, publishedExit(v1, MINER, 2 ether, 4));
    vm.prank(alice);
    portal.deposit(3 ether, bytes32(uint256(1)), V1, block.timestamp + 1 hours);
    assertEq(portal.YACA_TOKEN().totalSupply(), 4 ether);
    assertEq(portal.versionInfo(V1).exited - portal.versionInfo(V1).inbound, 4 ether);
  }

  function testOperatorsCanHandOver() public {
    vm.prank(operators);
    portal.setOperators(alice);
    vm.prank(operators);
    vm.expectRevert(abi.encodeWithSelector(YacanaPortal.NotOperators.selector, operators));
    portal.setForwarder(alice, true);
    vm.prank(alice);
    portal.setForwarder(alice, true);
    assertTrue(portal.forwarders(alice));
  }

  function testInboxMessagesAreVersionChecked() public {
    // The Inbox itself refuses a recipient on another version: a message the portal addresses to
    // the wrong version cannot land anywhere.
    IInbox inbox = flipTo(V2).INBOX();
    vm.expectRevert(abi.encodeWithSelector(Errors.Inbox__VersionMismatch.selector, V1, V2));
    inbox.sendL2Message(DataStructures.L2Actor(MINER, V1), bytes32(uint256(1)), bytes32(uint256(2)));
  }
}
