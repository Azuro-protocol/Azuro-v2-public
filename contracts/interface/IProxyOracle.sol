// SPDX-License-Identifier: GPL-3.0

pragma solidity ^0.8.9;

interface IProxyOracle {
    struct ChangeOddsData {
        uint256 conditionId;
        uint256[] odds;
    }

    struct CreateConditionData {
        uint256 gameId;
        uint256 conditionId;
        uint256[] odds;
        uint64[] outcomes;
        uint128 reinforcement;
        uint64 margin;
        uint8 winningOutcomesCount;
        bool isExpressForbidden;
    }

    struct CreateGameData {
        uint256 gameId;
        uint64 startsAt;
        bytes data;
    }

    struct ResolveConditionData {
        uint256 conditionId;
        uint64[] winningOutcomes;
    }

    struct ShiftGameData {
        uint256 gameId;
        uint64 startsAt;
    }

    struct StopConditionData {
        uint256 conditionId;
        bool flag;
    }

    struct changeMarginData {
        uint256 conditionId;
        uint64 margin;
    }

    struct changeReinforcementData {
        uint256 conditionId;
        uint128 reinforcement;
    }

    event ReinforcementLimitChanged(uint256);

    error TooLargeReinforcement();
}
