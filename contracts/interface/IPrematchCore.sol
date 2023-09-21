// SPDX-License-Identifier: GPL-3.0

pragma solidity ^0.8.9;

import "./ICoreBase.sol";

interface IPrematchCore is ICoreBase {
    event NewBet(
        address indexed bettor,
        address indexed affiliate,
        uint256 indexed conditionId,
        uint256 tokenId,
        uint64 outcomeId,
        uint128 amount,
        uint256 odds,
        uint128[] funds
    );

    /**
     * @notice Indicate outcomes `winningOutcomes` as happened in condition `conditionId`.
     * @notice See {CoreBase-_resolveCondition}.
     */
    function resolveCondition(
        uint256 conditionId,
        uint64[] calldata winningOutcomes
    ) external;
}
