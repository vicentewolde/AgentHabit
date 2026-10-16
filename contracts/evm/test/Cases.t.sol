// SPDX-License-Identifier: Apache-2.0
pragma solidity 0.8.37;

import {Test} from "forge-std/Test.sol";

import {Commitment} from "../src/Commitment.sol";
import {MockUSDC} from "./mocks/MockUSDC.sol";

/// @notice Runs the shared case table (`contracts/fixtures/cases.json`, generated from
/// packages/core) against the EVM contract. The Soroban runner reads the same file (A-3).
contract CasesTest is Test {
    uint256 private constant DECIMALS = 1e6;
    uint256 private constant STARTING_BALANCE = 1_000 * DECIMALS;

    // Fields in the JSON keys' alphabetical order: `vm.parseJson` decodes by position, so a
    // field may be renamed (`err` for the reserved-to-be `error`) but never reordered.
    struct Step {
        string action;
        string actor;
        string amount;
        string err;
        string forfeited;
        string goal_m;
        string met;
        string owner;
        string owner_balance;
        string result;
        string state;
        string time;
        string week_id;
    }

    struct Case {
        string name;
        Step[] steps;
    }

    struct ConstructorCase {
        string err;
        string grace;
        string max_amount_usdc;
        string max_goal_m;
        string min_amount_usdc;
        string min_goal_m;
        string name;
        string stale_after;
        string week_anchor;
        string week_len;
    }

    struct ContractError {
        string code;
        string name;
    }

    struct Before {
        uint256 ownerBalance;
        uint256 forfeited;
    }

    string private json;

    address private user = makeAddr("user");
    address private stranger = makeAddr("stranger");
    address private oracle = makeAddr("oracle");

    MockUSDC private token;
    Commitment private commitment;

    // The table's config, parsed once: every cheatcode call copies the whole file.
    uint256 private minAmount;
    uint256 private maxAmount;
    uint64 private minGoalM;
    uint64 private maxGoalM;
    uint64 private weekAnchor;
    uint64 private weekLen;
    uint64 private grace;
    uint64 private staleAfter;

    // Positions touched by the running case, for the balance invariant.
    address[] private touchedOwners;
    uint64[] private touchedWeeks;

    function setUp() public {
        json = vm.readFile(string.concat(vm.projectRoot(), "/../fixtures/cases.json"));
        minAmount = _config(".min_amount_usdc") * DECIMALS;
        maxAmount = _config(".max_amount_usdc") * DECIMALS;
        minGoalM = uint64(_config(".min_goal_m"));
        maxGoalM = uint64(_config(".max_goal_m"));
        weekAnchor = uint64(_config(".week_anchor"));
        weekLen = uint64(_config(".week_len"));
        grace = uint64(_config(".grace"));
        staleAfter = uint64(_config(".stale_after"));
    }

    function test_EveryErrorInTheTableIsAContractError() public view {
        ContractError[] memory errors = abi.decode(vm.parseJson(json, ".contract_errors"), (ContractError[]));
        assertGt(errors.length, 0, "no errors");
        for (uint256 i = 0; i < errors.length; i++) {
            assertTrue(_selectorOf(errors[i].name) != bytes4(0), string.concat("unknown error ", errors[i].name));
        }
    }

    function test_ConstructorCases() public {
        ConstructorCase[] memory cases = abi.decode(vm.parseJson(json, ".constructor_cases"), (ConstructorCase[]));
        assertGt(cases.length, 0, "no constructor cases");
        for (uint256 i = 0; i < cases.length; i++) {
            ConstructorCase memory c = cases[i];
            MockUSDC usdc = new MockUSDC();
            try new Commitment(
                address(usdc),
                oracle,
                vm.parseUint(c.min_amount_usdc) * DECIMALS,
                vm.parseUint(c.max_amount_usdc) * DECIMALS,
                uint64(vm.parseUint(c.min_goal_m)),
                uint64(vm.parseUint(c.max_goal_m)),
                uint64(vm.parseUint(c.week_anchor)),
                uint64(vm.parseUint(c.week_len)),
                uint64(vm.parseUint(c.grace)),
                uint64(vm.parseUint(c.stale_after))
            ) returns (
                Commitment
            ) {
                assertEq(c.err, "", c.name);
            } catch (bytes memory reason) {
                assertEq(_classify(reason), c.err, c.name);
            }
        }
    }

    function test_SharedCaseTable() public {
        Case[] memory cases = abi.decode(vm.parseJson(json, ".cases"), (Case[]));
        assertGt(cases.length, 0, "no cases");
        for (uint256 i = 0; i < cases.length; i++) {
            _runCase(cases[i]);
        }
    }

    function _runCase(Case memory c) private {
        token = new MockUSDC();
        commitment = new Commitment(
            address(token), oracle, minAmount, maxAmount, minGoalM, maxGoalM, weekAnchor, weekLen, grace, staleAfter
        );
        delete touchedOwners;
        delete touchedWeeks;
        address[2] memory owners = [user, stranger];
        for (uint256 o = 0; o < owners.length; o++) {
            token.mint(owners[o], STARTING_BALANCE);
            vm.prank(owners[o]);
            token.approve(address(commitment), type(uint256).max);
        }

        for (uint256 s = 0; s < c.steps.length; s++) {
            _runStep(string.concat(c.name, " step ", vm.toString(s)), c.steps[s]);
        }
    }

    function _runStep(string memory label, Step memory step) private {
        address owner = _actor(step.owner);
        uint64 weekId = uint64(vm.parseUint(step.week_id));
        vm.warp(vm.parseUint(step.time));

        Before memory before = Before(token.balanceOf(owner), commitment.totalForfeited());
        (string memory failure, string memory result) = _execute(label, step, owner, weekId);

        assertEq(failure, step.err, string.concat(label, ": error"));
        assertEq(result, step.result, string.concat(label, ": result"));
        _checkPosition(label, step, owner, weekId, before);
        _assertBalanceInvariant(label);
    }

    function _execute(string memory label, Step memory step, address owner, uint64 weekId)
        private
        returns (string memory failure, string memory result)
    {
        address actor = _actor(step.actor);
        if (_eq(step.action, "commit")) {
            _touch(owner, weekId);
            uint256 amount = _amount(step.amount);
            uint64 goal = uint64(vm.parseUint(step.goal_m));
            vm.prank(actor);
            try commitment.commit(owner, weekId, amount, goal) {}
            catch (bytes memory reason) {
                failure = _classify(reason);
            }
        } else if (_eq(step.action, "settle")) {
            _touch(owner, weekId);
            bool met = _eq(step.met, "true");
            vm.prank(actor);
            try commitment.settle(owner, weekId, met) {}
            catch (bytes memory reason) {
                failure = _classify(reason);
            }
        } else if (_eq(step.action, "release_if_stale")) {
            _touch(owner, weekId);
            vm.prank(actor);
            try commitment.releaseIfStale(owner, weekId) {}
            catch (bytes memory reason) {
                failure = _classify(reason);
            }
        } else if (_eq(step.action, "current_week")) {
            try commitment.currentWeek() returns (uint64 week) {
                result = vm.toString(uint256(week));
            } catch (bytes memory reason) {
                failure = _classify(reason);
            }
        } else if (_eq(step.action, "block")) {
            token.setBlacklisted(owner, true);
        } else if (_eq(step.action, "unblock")) {
            token.setBlacklisted(owner, false);
        } else {
            revert(string.concat(label, ": unknown action ", step.action));
        }
    }

    function _checkPosition(string memory label, Step memory step, address owner, uint64 weekId, Before memory before)
        private
        view
    {
        Commitment.Position memory position = commitment.getPosition(owner, weekId);
        assertEq(_stateName(position.state), step.state, string.concat(label, ": state"));

        uint256 ownerAfter = token.balanceOf(owner);
        if (_eq(step.owner_balance, "credited")) {
            assertEq(ownerAfter, before.ownerBalance + position.amount, string.concat(label, ": credited"));
        } else if (_eq(step.owner_balance, "debited")) {
            assertEq(ownerAfter + position.amount, before.ownerBalance, string.concat(label, ": debited"));
        } else {
            assertEq(ownerAfter, before.ownerBalance, string.concat(label, ": owner balance"));
        }

        uint256 expectedForfeited = _eq(step.forfeited, "increased") ? position.amount : 0;
        assertEq(commitment.totalForfeited() - before.forfeited, expectedForfeited, string.concat(label, ": forfeited"));
    }

    /// balance(contract) = Σ Active amounts + total_forfeited, after every step.
    function _assertBalanceInvariant(string memory label) private view {
        uint256 active;
        for (uint256 i = 0; i < touchedOwners.length; i++) {
            if (_seenBefore(i)) continue;
            Commitment.Position memory position = commitment.getPosition(touchedOwners[i], touchedWeeks[i]);
            if (position.state == Commitment.State.Active) active += position.amount;
        }
        assertEq(
            token.balanceOf(address(commitment)),
            active + commitment.totalForfeited(),
            string.concat(label, ": balance invariant")
        );
    }

    function _seenBefore(uint256 i) private view returns (bool) {
        for (uint256 j = 0; j < i; j++) {
            if (touchedOwners[j] == touchedOwners[i] && touchedWeeks[j] == touchedWeeks[i]) return true;
        }
        return false;
    }

    function _touch(address owner, uint64 weekId) private {
        touchedOwners.push(owner);
        touchedWeeks.push(weekId);
    }

    /// Contract errors by name; any other revert came from the token through SafeERC20.
    function _classify(bytes memory reason) private pure returns (string memory) {
        if (reason.length < 4) return "TokenFailure";
        bytes4 selector = bytes4(reason);
        string[12] memory names = [
            "BeforeAnchor",
            "InvalidConfig",
            "AlreadyCommitted",
            "PositionNotFound",
            "PositionNotActive",
            "WrongWeek",
            "OutsideSettleWindow",
            "NotStaleYet",
            "AmountOutOfRange",
            "GoalOutOfRange",
            "BalanceMismatch",
            "Unauthorized"
        ];
        for (uint256 i = 0; i < names.length; i++) {
            if (selector == _selectorOf(names[i])) return names[i];
        }
        return "TokenFailure";
    }

    function _selectorOf(string memory name) private pure returns (bytes4) {
        if (_eq(name, "BeforeAnchor")) return Commitment.BeforeAnchor.selector;
        if (_eq(name, "InvalidConfig")) return Commitment.InvalidConfig.selector;
        if (_eq(name, "AlreadyCommitted")) return Commitment.AlreadyCommitted.selector;
        if (_eq(name, "PositionNotFound")) return Commitment.PositionNotFound.selector;
        if (_eq(name, "PositionNotActive")) return Commitment.PositionNotActive.selector;
        if (_eq(name, "WrongWeek")) return Commitment.WrongWeek.selector;
        if (_eq(name, "OutsideSettleWindow")) return Commitment.OutsideSettleWindow.selector;
        if (_eq(name, "NotStaleYet")) return Commitment.NotStaleYet.selector;
        if (_eq(name, "AmountOutOfRange")) return Commitment.AmountOutOfRange.selector;
        if (_eq(name, "GoalOutOfRange")) return Commitment.GoalOutOfRange.selector;
        if (_eq(name, "BalanceMismatch")) return Commitment.BalanceMismatch.selector;
        if (_eq(name, "Unauthorized")) return Commitment.Unauthorized.selector;
        return bytes4(0);
    }

    function _amount(string memory ref) private view returns (uint256) {
        uint256 min = minAmount;
        uint256 max = maxAmount;
        if (_eq(ref, "min")) return min;
        if (_eq(ref, "max")) return max;
        if (_eq(ref, "mid")) return (min + max) / 2;
        if (_eq(ref, "below_min")) return min - 1;
        if (_eq(ref, "above_max")) return max + 1;
        if (_eq(ref, "zero")) return 0;
        revert(string.concat("unknown amount ", ref));
    }

    function _config(string memory key) private view returns (uint256) {
        return vm.parseJsonUint(json, string.concat(".config", key));
    }

    function _actor(string memory name) private view returns (address) {
        if (_eq(name, "user")) return user;
        if (_eq(name, "stranger")) return stranger;
        if (_eq(name, "oracle")) return oracle;
        revert(string.concat("unknown actor ", name));
    }

    function _stateName(Commitment.State state) private pure returns (string memory) {
        if (state == Commitment.State.None) return "None";
        if (state == Commitment.State.Active) return "Active";
        if (state == Commitment.State.Returned) return "Returned";
        if (state == Commitment.State.Forfeited) return "Forfeited";
        return "ReleasedStale";
    }

    function _eq(string memory a, string memory b) private pure returns (bool) {
        return keccak256(bytes(a)) == keccak256(bytes(b));
    }
}
