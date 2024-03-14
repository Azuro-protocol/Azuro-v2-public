// SPDX-License-Identifier: GPL-3.0

pragma solidity ^0.8.9;

import "./IBet.sol";
import "./ICoreBase.sol";
import "./IOwnable.sol";

interface IBetExpress is IBet, IOwnable {
    struct Bet {
        uint64 odds;
        uint128 amount;
        uint48 lastDepositId;
        bool isClaimed;
        ICoreBase.CoreBetData[] subBets;
        uint64[] conditionOdds;
    }

    event NewBet(
        address indexed bettor,
        address indexed affiliate,
        uint256 indexed betId,
        Bet bet
    );
    event NewBetMargins(uint256 indexed betId, uint64[] margins);
    event MaxOddsChanged(uint256 newMaxOdds);
    event ReinforcementChanged(uint128 newReinforcement);

    error AlreadyPaid();
    error ConditionNotFinished(uint256 conditionId);
    error ConditionNotRunning(uint256 conditionId);
    error IncorrectMaxOdds();
    error LargeOdds();
    error OnlyLp();
    error SameGameIdsNotAllowed();
    error TooFewSubbets();
    error TooLargeReinforcement(uint256 conditionId);
    error WrongToken();
    error ConditionNotForExpress();

    function initialize(address lp, address core) external;
}
