// SPDX-License-Identifier: GPL-3.0

pragma solidity ^0.8.9;

import "./IOwnable.sol";
import "./ICondition.sol";
import "./IBet.sol";
import "./IAffiliate.sol";

interface ICoreBase is ICondition, IOwnable, IBet, IAffiliate {
    struct AffiliateParams {
        uint256 start;
        uint256 count;
    }

    struct Bet {
        uint256 conditionId;
        uint128 amount;
        uint128 payout;
        uint64 outcome;
        bool isPaid;
    }

    struct CoreBetData {
        uint256 conditionId; // The match or game ID
        uint64 outcomeId; // ID of predicted outcome
        uint64 minOdds; // Minimum allowed betting odds
    }

    event ConditionCreated(uint256 indexed gameId, uint256 indexed conditionId);
    event ConditionResolved(
        uint256 indexed conditionId,
        uint8 state,
        uint64 outcomeWin,
        int128 lpProfit
    );
    event ConditionStopped(uint256 indexed conditionId, bool flag);

    event OddsChanged(uint256 indexed conditionId, uint64[2] newOdds);

    error OnlyLp();

    error AlreadyPaid();
    error IncorrectConditionId();
    error IncorrectMargin();
    error IncorrectTimestamp();
    error NoPendingReward();
    error OnlyOracle(address);
    error SameOutcomes();
    error SmallOdds();
    error StartOutOfRange(uint256 pendingRewardsCount);
    error ZeroOdds();

    error ActionNotAllowed();
    error CantChangeFlag();
    error ConditionAlreadyCreated();
    error ConditionAlreadyResolved();
    error ConditionNotExists();
    error ConditionNotFinished();
    error GameAlreadyStarted();
    error ResolveTooEarly(uint64 waitTime);

    function initialize(address azuroBet, address lp) external;

    function calcOdds(
        uint256 conditionId,
        uint128 amount,
        uint64 outcome
    ) external view returns (uint64 odds);

    /**
     * @notice Change the current condition `conditionId` odds.
     */
    function changeOdds(uint256 conditionId, uint64[2] calldata newOdds)
        external;

    function getCondition(uint256 conditionId)
        external
        view
        returns (Condition memory);

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
     * @param  odds start odds for [team 1, team 2]
     * @param  outcomes unique outcomes for the condition [outcome 1, outcome 2]
     * @param  reinforcement maximum amount of liquidity intended to condition reinforcement
     * @param  margin bookmaker commission
     */
    function createCondition(
        uint256 gameId,
        uint256 conditionId,
        uint64[2] calldata odds,
        uint64[2] calldata outcomes,
        uint128 reinforcement,
        uint64 margin
    ) external;

    function isConditionCanceled(uint256 conditionId)
        external
        view
        returns (bool);
}
