// SPDX-License-Identifier: Apache-2.0
pragma solidity 0.8.37;

import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {Test} from "forge-std/Test.sol";

import {Commitment} from "../src/Commitment.sol";
import {FeeToken} from "./mocks/FeeToken.sol";
import {MockUSDC} from "./mocks/MockUSDC.sol";
import {ReentrantToken} from "./mocks/ReentrantToken.sol";

/// @notice EVM-only properties: fuzzed amounts and times, reentrancy with a malicious token, a
/// fee-charging token, events and the immutable config. The shared semantics live in Cases.t.sol.
contract CommitmentTest is Test {
    uint256 private constant MIN_AMOUNT = 20e6;
    uint256 private constant MAX_AMOUNT = 50e6;
    uint64 private constant MIN_GOAL = 10_000;
    uint64 private constant MAX_GOAL = 300_000;
    uint64 private constant ANCHOR = 1_000_000;
    uint64 private constant WEEK = 604_800;
    uint64 private constant GRACE = 172_800;
    uint64 private constant STALE = 604_800;

    address private user = makeAddr("user");
    address private oracle = makeAddr("oracle");

    MockUSDC private usdc;
    Commitment private commitment;

    function setUp() public {
        usdc = new MockUSDC();
        commitment = _deploy(address(usdc));
        usdc.mint(user, 1_000e6);
        vm.prank(user);
        usdc.approve(address(commitment), type(uint256).max);
    }

    function _deploy(address token) private returns (Commitment) {
        return new Commitment(token, oracle, MIN_AMOUNT, MAX_AMOUNT, MIN_GOAL, MAX_GOAL, ANCHOR, WEEK, GRACE, STALE);
    }

    function _commitWeekOne(uint256 amount, uint64 goal) private {
        vm.warp(ANCHOR + 10);
        vm.prank(user);
        commitment.commit(user, 1, amount, goal);
    }

    // --- Fuzz: amounts and times -------------------------------------------------------------

    function testFuzz_CommitAndSettleKeepTheBalanceInvariant(
        uint256 amount,
        uint64 goal,
        bool met,
        uint64 commitOffset,
        uint64 settleOffset
    ) public {
        amount = bound(amount, MIN_AMOUNT, MAX_AMOUNT);
        goal = uint64(bound(goal, MIN_GOAL, MAX_GOAL));
        commitOffset = uint64(bound(commitOffset, 0, WEEK - 1));
        settleOffset = uint64(bound(settleOffset, GRACE, STALE - 1));
        uint256 before = usdc.balanceOf(user);

        vm.warp(ANCHOR + commitOffset);
        vm.prank(user);
        commitment.commit(user, 1, amount, goal);
        assertEq(usdc.balanceOf(address(commitment)), amount);

        vm.warp(uint256(ANCHOR) + 2 * WEEK + settleOffset);
        vm.prank(oracle);
        commitment.settle(user, 1, met);

        assertEq(usdc.balanceOf(address(commitment)), commitment.totalForfeited());
        assertEq(usdc.balanceOf(user), met ? before : before - amount);
        assertEq(commitment.totalForfeited(), met ? 0 : amount);
    }

    function testFuzz_CommitRejectsAmountsOutsideTheLimits(uint256 amount) public {
        vm.assume(amount < MIN_AMOUNT || amount > MAX_AMOUNT);
        vm.warp(ANCHOR + 10);
        vm.prank(user);
        vm.expectRevert(Commitment.AmountOutOfRange.selector);
        commitment.commit(user, 1, amount, MIN_GOAL);
    }

    function testFuzz_CommitRejectsGoalsOutsideTheLimits(uint64 goal) public {
        vm.assume(goal < MIN_GOAL || goal > MAX_GOAL);
        vm.warp(ANCHOR + 10);
        vm.prank(user);
        vm.expectRevert(Commitment.GoalOutOfRange.selector);
        commitment.commit(user, 1, MIN_AMOUNT, goal);
    }

    function testFuzz_CurrentWeekMatchesTheFormula(uint64 now_) public {
        vm.warp(now_);
        if (now_ < ANCHOR) {
            vm.expectRevert(Commitment.BeforeAnchor.selector);
            commitment.currentWeek();
        } else {
            assertEq(commitment.currentWeek(), (now_ - ANCHOR) / WEEK);
        }
    }

    function testFuzz_CommitOnlyAcceptsNextWeek(uint64 now_, uint64 weekId) public {
        now_ = uint64(bound(now_, ANCHOR, uint256(ANCHOR) + 520 * WEEK));
        vm.warp(now_);
        uint64 next = (now_ - ANCHOR) / WEEK + 1;
        vm.prank(user);
        if (weekId != next) vm.expectRevert(Commitment.WrongWeek.selector);
        commitment.commit(user, weekId, MIN_AMOUNT, MIN_GOAL);
    }

    function testFuzz_SettleOnlyInsideItsWindow(uint64 offset) public {
        _commitWeekOne(MIN_AMOUNT, MIN_GOAL);
        uint256 weekEnd = uint256(ANCHOR) + 2 * WEEK;
        offset = uint64(bound(offset, 0, 4 * WEEK));
        vm.warp(weekEnd + offset);
        vm.prank(oracle);
        if (offset < GRACE || offset >= STALE) vm.expectRevert(Commitment.OutsideSettleWindow.selector);
        commitment.settle(user, 1, true);
    }

    function testFuzz_ReleaseOnlyFromStaleAfter(uint64 offset) public {
        _commitWeekOne(MAX_AMOUNT, MIN_GOAL);
        uint256 weekEnd = uint256(ANCHOR) + 2 * WEEK;
        offset = uint64(bound(offset, 0, 520 * WEEK));
        vm.warp(weekEnd + offset);
        if (offset < STALE) vm.expectRevert(Commitment.NotStaleYet.selector);
        commitment.releaseIfStale(user, 1);
    }

    // --- Reentrancy with a malicious token -------------------------------------------------

    function test_ReentrancyDuringCommitReverts() public {
        ReentrantToken evil = new ReentrantToken();
        Commitment target = _deploy(address(evil));
        evil.mint(user, 1_000e6);
        vm.prank(user);
        evil.approve(address(target), type(uint256).max);
        evil.arm(address(target), abi.encodeCall(Commitment.commit, (user, 1, MIN_AMOUNT, MIN_GOAL)));

        vm.warp(ANCHOR + 10);
        vm.prank(user);
        vm.expectRevert(ReentrancyGuard.ReentrancyGuardReentrantCall.selector);
        target.commit(user, 1, MIN_AMOUNT, MIN_GOAL);
        assertEq(uint8(target.getPosition(user, 1).state), uint8(Commitment.State.None));
    }

    function test_ReentrancyDuringSettleReverts() public {
        ReentrantToken evil = new ReentrantToken();
        Commitment target = _deploy(address(evil));
        evil.mint(user, 1_000e6);
        vm.prank(user);
        evil.approve(address(target), type(uint256).max);
        vm.warp(ANCHOR + 10);
        vm.prank(user);
        target.commit(user, 1, MIN_AMOUNT, MIN_GOAL);

        evil.arm(address(target), abi.encodeCall(Commitment.releaseIfStale, (user, 1)));
        vm.warp(uint256(ANCHOR) + 2 * WEEK + GRACE);
        vm.prank(oracle);
        vm.expectRevert(ReentrancyGuard.ReentrancyGuardReentrantCall.selector);
        target.settle(user, 1, true);
        assertEq(uint8(target.getPosition(user, 1).state), uint8(Commitment.State.Active));
    }

    function test_ReentrancyDuringReleaseReverts() public {
        ReentrantToken evil = new ReentrantToken();
        Commitment target = _deploy(address(evil));
        evil.mint(user, 1_000e6);
        vm.prank(user);
        evil.approve(address(target), type(uint256).max);
        vm.warp(ANCHOR + 10);
        vm.prank(user);
        target.commit(user, 1, MIN_AMOUNT, MIN_GOAL);

        evil.arm(address(target), abi.encodeCall(Commitment.releaseIfStale, (user, 1)));
        vm.warp(uint256(ANCHOR) + 2 * WEEK + STALE);
        vm.expectRevert(ReentrancyGuard.ReentrancyGuardReentrantCall.selector);
        target.releaseIfStale(user, 1);
        assertEq(evil.balanceOf(address(target)), MIN_AMOUNT);
    }

    // --- Token behaviour ---------------------------------------------------------------------

    function test_CommitRefusesATokenThatChargesAFee() public {
        FeeToken fee = new FeeToken();
        Commitment target = _deploy(address(fee));
        fee.mint(user, 1_000e6);
        vm.prank(user);
        fee.approve(address(target), type(uint256).max);

        vm.warp(ANCHOR + 10);
        vm.prank(user);
        vm.expectRevert(Commitment.BalanceMismatch.selector);
        target.commit(user, 1, MIN_AMOUNT, MIN_GOAL);
    }

    function test_ABlacklistedRefundRevertsWithTheTokensReason() public {
        _commitWeekOne(MIN_AMOUNT, MIN_GOAL);
        usdc.setBlacklisted(user, true);
        vm.warp(uint256(ANCHOR) + 2 * WEEK + GRACE);
        vm.prank(oracle);
        vm.expectRevert(bytes("Blacklistable: account is blacklisted"));
        commitment.settle(user, 1, true);
    }

    // --- Events and reads ----------------------------------------------------------------------

    function test_EmitsAnEventForEveryMove() public {
        vm.warp(ANCHOR + 10);
        vm.expectEmit(address(commitment));
        emit Commitment.Committed(user, 1, MIN_AMOUNT, MIN_GOAL);
        vm.prank(user);
        commitment.commit(user, 1, MIN_AMOUNT, MIN_GOAL);

        vm.warp(uint256(ANCHOR) + 2 * WEEK + GRACE);
        vm.expectEmit(address(commitment));
        emit Commitment.Settled(user, 1, false, MIN_AMOUNT);
        vm.prank(oracle);
        commitment.settle(user, 1, false);

        vm.warp(uint256(ANCHOR) + 2 * WEEK + 10);
        vm.prank(user);
        commitment.commit(user, 3, MAX_AMOUNT, MAX_GOAL);
        vm.warp(uint256(ANCHOR) + 4 * WEEK + STALE);
        vm.expectEmit(address(commitment));
        emit Commitment.ReleasedStale(user, 3, MAX_AMOUNT);
        commitment.releaseIfStale(user, 3);
    }

    function test_ConfigReturnsTheConstructorArguments() public view {
        Commitment.Config memory config = commitment.config();
        assertEq(config.token, address(usdc));
        assertEq(config.oracle, oracle);
        assertEq(config.minAmount, MIN_AMOUNT);
        assertEq(config.maxAmount, MAX_AMOUNT);
        assertEq(config.minGoalM, MIN_GOAL);
        assertEq(config.maxGoalM, MAX_GOAL);
        assertEq(config.weekAnchor, ANCHOR);
        assertEq(config.weekLen, WEEK);
        assertEq(config.grace, GRACE);
        assertEq(config.staleAfter, STALE);
    }

    function test_PositionsStoreAmountGoalAndState() public {
        _commitWeekOne(MAX_AMOUNT, 42_195);
        Commitment.Position memory position = commitment.getPosition(user, 1);
        assertEq(position.amount, MAX_AMOUNT);
        assertEq(position.goalM, 42_195);
        assertEq(uint8(position.state), uint8(Commitment.State.Active));
    }
}
