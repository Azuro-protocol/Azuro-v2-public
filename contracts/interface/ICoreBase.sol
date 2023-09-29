// SPDX-License-Identifier: GPL-3.0

pragma solidity ^0.8.9;

import "./IBet.sol";
import "./ICondition.sol";
import "./ILP.sol";
import "./IOwnable.sol";
import "./IAzuroBet.sol";

interface ICoreBase is ICondition, IOwnable, IBet {
    struct Bet {
        uint256 conditionId;
        uint128 amount;
        uint128 payout;
        uint64 outcome;
        uint64 timestamp;
        bool isPaid;
    }

    struct CoreBetData {
        uint256 conditionId; // The match or game ID
        uint64 outcomeId; // ID of predicted outcome
    }

    event ConditionCreated(
        uint256 indexed gameId,
        uint256 indexed conditionId,
        uint64[] outcomes
    );
    event ConditionResolved(
        uint256 indexed conditionId,
        uint8 state,
        uint64[] winningOutcomes,
        int128 lpProfit
    );
    event ConditionStopped(uint256 indexed conditionId, bool flag);

    event ReinforcementChanged(
        uint256 indexed conditionId,
        uint128 newReinforcement
    );
    event MarginChanged(uint256 indexed conditionId, uint64 newMargin);
    event OddsChanged(uint256 indexed conditionId, uint256[] newOdds);

    error OnlyLp();

    error AlreadyPaid();
    error DuplicateOutcomes(uint64 outcome);
    error IncorrectConditionId();
    error IncorrectMargin();
    error IncorrectReinforcement();
    error NothingChanged();
    error IncorrectTimestamp();
    error IncorrectWinningOutcomesCount();
    error IncorrectOutcomesCount();
    error NoPendingReward();
    error OnlyOracle(address);
    error OutcomesAndOddsCountDiffer();
    error StartOutOfRange(uint256 pendingRewardsCount);
    error WrongOutcome();
    error ZeroOdds();

    error CantChangeFlag();
    error ConditionAlreadyCreated();
    error ConditionAlreadyResolved();
    error ConditionNotFinished();
    error ConditionNotExists();
    error ConditionNotRunning();
    error GameAlreadyStarted();
    error InsufficientFund();
    error ResolveTooEarly(uint64 waitTime);

    function lp() external view returns (ILP);

    function azuroBet() external view returns (IAzuroBet);

    function initialize(address azuroBet, address lp) external;

    function calcOdds(
        uint256 conditionId,
        uint128 amount,
        uint64 outcome
    ) external view returns (uint64 odds);

    /**
     * @notice Change the current condition `conditionId` margin.
     */
    function changeMargin(uint256 conditionId, uint64 newMargin) external;

    /**
     * @notice Change the current condition `conditionId` odds.
     */
    function changeOdds(
        uint256 conditionId,
        uint256[] calldata newOdds
    ) external;

    /**
     * @notice Change the current condition `conditionId` reinforcement.
     */
    function changeReinforcement(
        uint256 conditionId,
        uint128 newReinforcement
    ) external;

    function getCondition(
        uint256 conditionId
    ) external view returns (Condition memory);

    /**
     * @notice Indicate the condition `conditionId` as canceled.
     * @notice The condition creator can always cancel it regardless of granted access tokens.
     */
    function cancelCondition(uint256 conditionId) external;

    /**
     * @notice Indicate the status of condition `conditionId` bet lock.
     * @param  conditionId the match or condition ID
     * @param  flag if stop receiving bets for the condition or not
     */
    function stopCondition(uint256 conditionId, bool flag) external;

    /**
     * @notice Register new condition.
     * @param  gameId the game ID the condition belongs
     * @param  conditionId the match or condition ID according to oracle's internal numbering
     * @param  odds start odds for [team 1, ..., team N]
     * @param  outcomes unique outcomes for the condition [outcome 1, ..., outcome N]
     * @param  reinforcement maximum amount of liquidity intended to condition reinforcement
     * @param  margin bookmaker commission
     * @param  winningOutcomesCount the number of winning outcomes of the Condition
     * @param  isExpressForbidden true - not allowed to use in express bets
     */
    function createCondition(
        uint256 gameId,
        uint256 conditionId,
        uint256[] calldata odds,
        uint64[] calldata outcomes,
        uint128 reinforcement,
        uint64 margin,
        uint8 winningOutcomesCount,
        bool isExpressForbidden
    ) external;

    function getOutcomeIndex(
        uint256 conditionId,
        uint64 outcome
    ) external view returns (uint256);

    function isOutcomeWinning(
        uint256 conditionId,
        uint64 outcome
    ) external view returns (bool);

    function isConditionCanceled(
        uint256 conditionId
    ) external view returns (bool);
}
