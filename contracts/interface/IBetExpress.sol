// SPDX-License-Identifier: GPL-3.0

pragma solidity ^0.8.9;

import "./IBet.sol";
import "./IOwnable.sol";

interface IBetExpress is IBet, IOwnable {
    struct Bet {
        address affiliate;
        uint64 odds;
        uint128 amount;
        uint48 leaf;
        SubBet[] subBets;
        uint64[] conditionOdds;
    }
    struct SubBet {
        uint256 conditionId;
        uint64 outcomeId;
    }

    event NewBet(uint256 indexed betId, Bet bet);
    event ParamsUpdated(uint128 margin, uint64 maxReinforcementShare);

    error AlreadyResolved();
    error ConditionNotFinished(uint256 conditionId);
    error ConditionNotRunning(uint256 conditionId);
    error IncorrectMargin();
    error IncorrectMaxReinforcementShare();
    error OnlyLp();
    error SameGameIdsNotAllowed();
    error TooFewSubbets();
    error TooLargeReinforcement(uint256 conditionId);
    error TooSmallOdds();
    error WrongToken();

    function initialize(address lp, address core) external;
}
