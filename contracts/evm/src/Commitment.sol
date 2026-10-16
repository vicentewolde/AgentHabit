// SPDX-License-Identifier: Apache-2.0
pragma solidity 0.8.37;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/// @title AgentHabit commitment contract for Avalanche (spec 4.2, P-3).
/// @notice A user locks USDC for next week's running goal. The oracle settles it: met returns the
/// deposit, missed keeps it in this contract forever. If the oracle never settles, anyone can
/// return the deposit to its owner. Same semantics as `contracts/stellar/commitment`; both pass
/// the shared case table in `contracts/fixtures/cases.json`.
/// @dev No admin, no withdrawal, no upgrade, no pause: every parameter is fixed at deployment.
/// Validation order, the same on both chains: week exists, authorization, position state, time
/// window, amount and goal limits, token.
contract Commitment is ReentrancyGuard {
    using SafeERC20 for IERC20;

    enum State {
        None,
        Active,
        Returned,
        Forfeited,
        ReleasedStale
    }

    struct Position {
        uint256 amount;
        uint64 goalM;
        State state;
    }

    struct Config {
        address token;
        address oracle;
        uint256 minAmount;
        uint256 maxAmount;
        uint64 minGoalM;
        uint64 maxGoalM;
        uint64 weekAnchor;
        uint64 weekLen;
        uint64 grace;
        uint64 staleAfter;
    }

    // Names fixed by the case table; Soroban numbers the same errors 101 to 111 (A-12).
    error BeforeAnchor();
    error InvalidConfig();
    error AlreadyCommitted();
    error PositionNotFound();
    error PositionNotActive();
    error WrongWeek();
    error OutsideSettleWindow();
    error NotStaleYet();
    error AmountOutOfRange();
    error GoalOutOfRange();
    error BalanceMismatch();
    error Unauthorized();

    event Committed(address indexed user, uint64 indexed weekId, uint256 amount, uint64 goalM);
    event Settled(address indexed user, uint64 indexed weekId, bool met, uint256 amount);
    event ReleasedStale(address indexed user, uint64 indexed weekId, uint256 amount);

    IERC20 private immutable TOKEN;
    address private immutable ORACLE;
    uint256 private immutable MIN_AMOUNT;
    uint256 private immutable MAX_AMOUNT;
    uint64 private immutable MIN_GOAL_M;
    uint64 private immutable MAX_GOAL_M;
    uint64 private immutable WEEK_ANCHOR;
    uint64 private immutable WEEK_LEN;
    uint64 private immutable GRACE;
    uint64 private immutable STALE_AFTER;

    /// @notice Sum of every forfeited deposit. It never leaves the contract (A-5).
    uint256 public totalForfeited;

    mapping(address user => mapping(uint64 weekId => Position)) private positions;

    constructor(
        address token,
        address oracle,
        uint256 minAmount,
        uint256 maxAmount,
        uint64 minGoalM,
        uint64 maxGoalM,
        uint64 weekAnchor,
        uint64 weekLen,
        uint64 grace,
        uint64 staleAfter
    ) {
        if (
            minAmount == 0 || minAmount > maxAmount || minGoalM == 0 || minGoalM > maxGoalM || weekLen == 0
                || grace == 0 || grace >= staleAfter
        ) {
            revert InvalidConfig();
        }
        TOKEN = IERC20(token);
        ORACLE = oracle;
        MIN_AMOUNT = minAmount;
        MAX_AMOUNT = maxAmount;
        MIN_GOAL_M = minGoalM;
        MAX_GOAL_M = maxGoalM;
        WEEK_ANCHOR = weekAnchor;
        WEEK_LEN = weekLen;
        GRACE = grace;
        STALE_AFTER = staleAfter;
    }

    /// @notice Locks `amount` for `weekId`, which must be next week (A-8). `user` must be the
    /// caller and must have approved this contract for `amount`.
    function commit(address user, uint64 weekId, uint256 amount, uint64 goalM) external nonReentrant {
        uint256 current = _currentWeek();
        if (msg.sender != user) revert Unauthorized();
        Position storage position = positions[user][weekId];
        if (position.state != State.None) revert AlreadyCommitted();
        if (uint256(weekId) != current + 1) revert WrongWeek();
        if (amount < MIN_AMOUNT || amount > MAX_AMOUNT) revert AmountOutOfRange();
        if (goalM < MIN_GOAL_M || goalM > MAX_GOAL_M) revert GoalOutOfRange();

        // Effects before the interaction; the whole call reverts if the token misbehaves.
        position.amount = amount;
        position.goalM = goalM;
        position.state = State.Active;

        uint256 balanceBefore = TOKEN.balanceOf(address(this));
        TOKEN.safeTransferFrom(user, address(this), amount);
        // Guards against a token that charges a fee on transfer: FiatToken is a proxy.
        if (TOKEN.balanceOf(address(this)) != balanceBefore + amount) revert BalanceMismatch();

        emit Committed(user, weekId, amount, goalM);
    }

    /// @notice The oracle settles a week inside `[week_end + grace, week_end + stale_after)`.
    /// `met` returns the deposit; otherwise it stays here. The distance never goes on-chain (A-4).
    function settle(address user, uint64 weekId, bool met) external nonReentrant {
        if (msg.sender != ORACLE) revert Unauthorized();
        Position storage position = _activePosition(user, weekId);
        uint256 end = _weekEnd(weekId);
        if (block.timestamp < end + GRACE || block.timestamp >= end + STALE_AFTER) {
            revert OutsideSettleWindow();
        }

        uint256 amount = position.amount;
        if (met) {
            position.state = State.Returned;
            // A refused refund (blacklist) reverts whole and the position stays Active.
            TOKEN.safeTransfer(user, amount);
        } else {
            position.state = State.Forfeited;
            totalForfeited += amount;
        }

        emit Settled(user, weekId, met, amount);
    }

    /// @notice Anyone returns a deposit the oracle did not settle, from `week_end + stale_after`
    /// on and with no deadline. The money only ever goes to the position's owner.
    function releaseIfStale(address user, uint64 weekId) external nonReentrant {
        Position storage position = _activePosition(user, weekId);
        if (block.timestamp < _weekEnd(weekId) + STALE_AFTER) revert NotStaleYet();

        uint256 amount = position.amount;
        position.state = State.ReleasedStale;
        TOKEN.safeTransfer(user, amount);

        emit ReleasedStale(user, weekId, amount);
    }

    /// @notice `floor((now − week_anchor) / week_len)`; fails with `BeforeAnchor` before the anchor.
    function currentWeek() external view returns (uint64) {
        return uint64(_currentWeek());
    }

    function getPosition(address user, uint64 weekId) external view returns (Position memory) {
        return positions[user][weekId];
    }

    function config() external view returns (Config memory) {
        return Config({
            token: address(TOKEN),
            oracle: ORACLE,
            minAmount: MIN_AMOUNT,
            maxAmount: MAX_AMOUNT,
            minGoalM: MIN_GOAL_M,
            maxGoalM: MAX_GOAL_M,
            weekAnchor: WEEK_ANCHOR,
            weekLen: WEEK_LEN,
            grace: GRACE,
            staleAfter: STALE_AFTER
        });
    }

    function _currentWeek() private view returns (uint256) {
        if (block.timestamp < WEEK_ANCHOR) revert BeforeAnchor();
        return (block.timestamp - WEEK_ANCHOR) / WEEK_LEN;
    }

    /// @dev `week_anchor + (w + 1) · week_len` in 256 bits: it cannot overflow for a `uint64` week.
    function _weekEnd(uint64 weekId) private view returns (uint256) {
        return uint256(WEEK_ANCHOR) + (uint256(weekId) + 1) * WEEK_LEN;
    }

    function _activePosition(address user, uint64 weekId) private view returns (Position storage position) {
        position = positions[user][weekId];
        if (position.state == State.None) revert PositionNotFound();
        if (position.state != State.Active) revert PositionNotActive();
    }
}
