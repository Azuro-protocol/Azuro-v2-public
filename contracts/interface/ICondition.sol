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
        uint128[2] funds;
        uint128[2] virtualFunds;
        uint128 reinforcement;
        uint128 affiliatesReward;
        uint64[2] outcomes;
        uint64 outcomeWin;
        uint64 margin;
        address oracle;
        ConditionState state;
        uint48 leaf;
    }
}
