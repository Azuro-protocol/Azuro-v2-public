// SPDX-License-Identifier: GPL-3.0

pragma solidity ^0.8.9;

/// @title Common math tools
library Math {
    /**
     * @notice Get non-negative difference of `minuend` and `subtracted`.
     * @return `minuend - subtracted`if it is non-negative or 0
     */
    function diffOrZero(uint256 minuend, uint256 subtracted)
        internal
        pure
        returns (uint256)
    {
        return minuend > subtracted ? minuend - subtracted : 0;
    }

    /**
     * @notice Get max of `a` and `b`.
     */
    function max(uint256 a, uint256 b) internal pure returns (uint256) {
        return a > b ? a : b;
    }

    /**
     * @notice Get min of `a` and `b`.
     */
    function min(uint128 a, uint128 b) internal pure returns (uint128) {
        return a < b ? a : b;
    }
}
