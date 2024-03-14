// SPDX-License-Identifier: GPL-3.0

pragma solidity ^0.8.9;

/// @title Common math tools
library Math {
    /**
     * @notice Get non-negative difference of `minuend` and `subtracted`.
     * @return `minuend - subtracted`if it is non-negative or 0
     */
    function diffOrZero(
        uint256 minuend,
        uint256 subtracted
    ) internal pure returns (uint256) {
        return minuend > subtracted ? minuend - subtracted : 0;
    }

    /**
     * @notice Get the biggest item of `a`.
     */
    function max(uint128[] memory a) internal pure returns (uint128 max_) {
        max_ = a[0];
        uint256 length = a.length;
        for (uint256 i = 1; i < length; ++i) {
            uint128 value = a[i];
            if (value > max_) max_ = value;
        }
    }

    /**
     * @notice Get the sum of items of `a`.
     */
    function sum(uint128[] memory a) internal pure returns (uint128 sum_) {
        uint256 length = a.length;
        for (uint256 i = 0; i < length; ++i) {
            sum_ += a[i];
        }
    }

    /**
     * @notice Get the sum of `n` max items of `a`.
     */
    function maxSum(
        uint128[] memory a,
        uint256 n
    ) internal pure returns (uint256 sum_) {
        if (n == 1) return max(a);

        uint256 length = a.length;

        uint128[] memory sorted = new uint128[](length);
        for (uint256 i = 0; i < length; ++i) {
            sorted[i] = a[i];
        }
        sort(sorted, 0, length - 1);

        for (uint256 i = 0; i < n; ++i) {
            sum_ += sorted[length - 1 - i];
        }
    }

    /**
     * @notice Sort the items of `a` in increasing order.
     */
    function sort(
        uint128[] memory a,
        uint256 left,
        uint256 right
    ) internal pure {
        if (left >= right) return;
        uint256 p = a[(left + right) / 2];
        uint256 i = left;
        uint256 j = right;
        while (i < j) {
            while (a[i] < p) ++i;
            while (a[j] > p) --j;
            if (a[i] > a[j]) (a[i], a[j]) = (a[j], a[i]);
            else ++i;
        }

        if (j > left) sort(a, left, j - 1);
        sort(a, j + 1, right);
    }
}
