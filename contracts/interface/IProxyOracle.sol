// SPDX-License-Identifier: GPL-3.0

pragma solidity ^0.8.9;

interface IProxyOracle {
    struct ChangeOddsData {
        uint256 conditionId;
        uint64[2] odds;
    }

    struct CreateConditionData {
        uint256 gameId;
        uint256 conditionId;
        uint64[2] odds;
        uint64[2] outcomes;
        uint128 reinforcement;
        uint64 margin;
    }

    struct CreateGameData {
        uint256 gameId;
        bytes32 ipfsHash;
        uint64 startsAt;
    }

    struct ResolveConditionData {
        uint256 conditionId;
        uint64 outcomeWin;
    }

    struct ShiftGameData {
        uint256 gameId;
        uint64 startsAt;
    }

    struct StopConditionData {
        uint256 conditionId;
        bool flag;
    }

    event ReinforcementLimitChanged(uint256);

    error TooLargeReinforcement();
}
