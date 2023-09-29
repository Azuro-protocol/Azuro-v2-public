// SPDX-License-Identifier: GPL-3.0

pragma solidity ^0.8.9;

interface ICondition {
    enum ConditionState {
        CREATED,
        RESOLVED,
        CANCELED,
        PAUSED
    }

    struct Condition {
        uint256 gameId;
        uint128[] payouts;
        uint128[] virtualFunds;
        uint128 totalNetBets;
        uint128 reinforcement;
        uint128 fund;
        uint64 margin;
        uint64 endsAt;
        uint48 lastDepositId;
        uint8 winningOutcomesCount;
        ConditionState state;
        address oracle;
        bool isExpressForbidden;
    }
}
