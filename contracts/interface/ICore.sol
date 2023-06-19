// SPDX-License-Identifier: GPL-3.0

pragma solidity ^0.8.9;

import "./ICoreBase.sol";

interface ICore is ICoreBase {
    event NewBet(
        address indexed bettor,
        address indexed affiliate,
        uint256 indexed conditionId,
        uint256 tokenId,
        uint64 outcomeId,
        uint128 amount,
        uint64 odds,
        uint128[2] funds
    );

    function resolveCondition(uint256 conditionId, uint64 outcomeWin) external;
}
