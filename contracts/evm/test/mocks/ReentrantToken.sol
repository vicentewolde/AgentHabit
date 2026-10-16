// SPDX-License-Identifier: Apache-2.0
pragma solidity 0.8.37;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/// @notice A malicious token that calls back into a target during its next transfer and bubbles
/// up whatever the callback reverts with.
contract ReentrantToken is ERC20 {
    address private target;
    bytes private payload;
    bool private armed;

    constructor() ERC20("Reentrant Token", "REE") {}

    function decimals() public pure override returns (uint8) {
        return 6;
    }

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }

    function arm(address target_, bytes calldata payload_) external {
        target = target_;
        payload = payload_;
        armed = true;
    }

    function _update(address from, address to, uint256 value) internal override {
        super._update(from, to, value);
        if (armed && from != address(0)) {
            armed = false;
            (bool ok, bytes memory reason) = target.call(payload);
            if (!ok) {
                assembly {
                    revert(add(reason, 32), mload(reason))
                }
            }
        }
    }
}
