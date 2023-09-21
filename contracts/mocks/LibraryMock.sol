// SPDX-License-Identifier: GPL-3.0

pragma solidity ^0.8.9;

import "../libraries/CoreTools.sol";

contract LibraryMock {
    function calcOdds(
        uint128[] memory funds,
        uint256 margin,
        uint256 winningOutcomesCount
    ) external pure returns (uint256[] memory) {
        return CoreTools.calcOdds(funds, margin, winningOutcomesCount);
    }
}
