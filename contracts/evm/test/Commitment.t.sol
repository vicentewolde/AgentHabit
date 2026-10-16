// SPDX-License-Identifier: Apache-2.0
pragma solidity 0.8.37;

import {Test} from "forge-std/Test.sol";

import {Commitment} from "../src/Commitment.sol";

contract CommitmentTest is Test {
    function test_TheEmptyContractDeploys() public {
        Commitment commitment = new Commitment();

        assertGt(address(commitment).code.length, 0);
    }
}
