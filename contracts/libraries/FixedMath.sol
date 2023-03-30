// SPDX-License-Identifier: GPL-3.0

pragma solidity ^0.8.9;

/// @title Fixed-point math tools
library FixedMath {
    uint256 constant ONE = 1e12;

    function mul(uint256 self, uint256 other) internal pure returns (uint256) {
        return (self * other) / ONE;
    }

    function div(uint256 self, uint256 other) internal pure returns (uint256) {
        return (self * ONE) / other;
    }

    function sqr(uint256 self) internal pure returns (uint256) {
        return (self * self) / ONE;
    }

    function sqrt(uint256 self) internal pure returns (uint256) {
        self *= ONE;
        uint256 previous = self;
        uint256 next = (self + 1) / 2;
        while (next < previous) {
            previous = next;
            next = (self / next + next) / 2;
        }
        return previous;
    }
}
