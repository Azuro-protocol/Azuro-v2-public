// SPDX-License-Identifier: GPL-3.0

pragma solidity ^0.8.9;

import "../libraries/CoreTools.sol";

contract LibraryMock {
    function marginAdjustedOdds(uint256 odds, uint256 margin)
        external
        pure
        returns (uint256)
    {
        return CoreTools.marginAdjustedOdds(odds, margin);
    }

    function calcOdds(
        uint128[2] memory funds,
        uint128 amount,
        uint256 outcomeIndex,
        uint256 margin
    ) external pure returns (uint256) {
        return CoreTools.calcOdds(funds, amount, outcomeIndex, margin);
    }
}
