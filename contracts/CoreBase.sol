// SPDX-License-Identifier: GPL-3.0

pragma solidity ^0.8.9;

import "./interface/IAzuroBet.sol";
import "./interface/ICoreBase.sol";
import "./libraries/CoreTools.sol";
import "./libraries/FixedMath.sol";
import "./libraries/SafeCast.sol";
import "./libraries/Math.sol";
import "./utils/OwnableUpgradeable.sol";

/// @title Base contract for Azuro cores
abstract contract CoreBase is OwnableUpgradeable, ICoreBase {
    uint256 public constant MAX_OUTCOMES_COUNT = 20;

    using FixedMath for *;
    using SafeCast for *;

    mapping(uint256 => Bet) public bets;
    mapping(uint256 => Condition) public conditions;
    // Condition ID => outcome ID => Condition outcome index + 1
    mapping(uint256 => mapping(uint256 => uint256)) public outcomeNumbers;
    // Condition ID => outcome ID => is winning
    mapping(uint256 => mapping(uint256 => bool)) public winningOutcomes;

    IAzuroBet public azuroBet;
    ILP public lp;

    /**
     * @notice Throw if caller is not the Liquidity Pool.
     */
    modifier onlyLp() {
        _checkOnlyLp();
        _;
    }

    /**
     * @notice Throw if caller have no access to function with selector `selector`.
     */
    modifier restricted(bytes4 selector) {
        lp.checkAccess(msg.sender, address(this), selector);
        _;
    }

    function initialize(address azuroBet_, address lp_)
        external
        virtual
        override
        initializer
    {
        __Ownable_init();
        azuroBet = IAzuroBet(azuroBet_);
        lp = ILP(lp_);
    }

    /**
     * @notice See {ICoreBase-cancelCondition}.
     */
    function cancelCondition(uint256 conditionId) external {
        Condition storage condition = _getCondition(conditionId);
        if (msg.sender != condition.oracle)
            lp.checkAccess(
                msg.sender,
                address(this),
                this.cancelCondition.selector
            );

        if (_isConditionResolved(condition) || _isConditionCanceled(condition))
            revert ConditionAlreadyResolved();

        _resolveCondition(
            condition,
            conditionId,
            ConditionState.CANCELED,
            new uint64[](0),
            condition.totalNetBets
        );
    }

    /**
     * @notice See {ICoreBase-changeMargin}.
     */
    function changeMargin(uint256 conditionId, uint64 newMargin)
        external
        restricted(this.changeMargin.selector)
    {
        Condition storage condition = _getCondition(conditionId);
        _conditionIsRunning(condition);

        if (newMargin > FixedMath.ONE) revert IncorrectMargin();

        condition.margin = newMargin;

        emit MarginChanged(conditionId, newMargin);
    }

    /**
     * @notice See {ICoreBase-changeOdds}.
     */
    function changeOdds(uint256 conditionId, uint256[] calldata newOdds)
        external
        restricted(this.changeOdds.selector)
    {
        Condition storage condition = _getCondition(conditionId);
        _conditionIsRunning(condition);
        if (newOdds.length != condition.payouts.length)
            revert OutcomesAndOddsCountDiffer();

        _applyOdds(condition, newOdds);
        emit OddsChanged(conditionId, newOdds);
    }

    /**
     * @notice See {ICoreBase-changeReinforcement}.
     */
    function changeReinforcement(uint256 conditionId, uint128 newReinforcement)
        external
        restricted(this.changeReinforcement.selector)
    {
        Condition storage condition = _getCondition(conditionId);
        _conditionIsRunning(condition);

        uint128 reinforcement = condition.reinforcement;
        uint128 newFund = condition.fund;

        if (newReinforcement == reinforcement) revert NothingChanged();

        if (newReinforcement > reinforcement) {
            newFund += newReinforcement - reinforcement;
        } else {
            if (newFund < reinforcement - newReinforcement)
                revert InsufficientFund();
            newFund -= reinforcement - newReinforcement;
        }

        if (
            newFund <
            Math.maxSum(condition.payouts, condition.winningOutcomesCount)
        ) revert IncorrectReinforcement();

        condition.reinforcement = newReinforcement;
        condition.fund = newFund;

        _applyOdds(
            condition,
            CoreTools.calcOdds(
                condition.virtualFunds,
                condition.margin,
                condition.winningOutcomesCount
            )
        );
        emit ReinforcementChanged(conditionId, newReinforcement);
    }

    /**
     * @notice See {ICoreBase-stopCondition}.
     */
    function stopCondition(uint256 conditionId, bool flag)
        external
        restricted(this.stopCondition.selector)
    {
        Condition storage condition = _getCondition(conditionId);
        // only CREATED state can be stopped
        // only PAUSED state can be restored
        ConditionState state = condition.state;
        if (
            (state != ConditionState.CREATED && flag) ||
            (state != ConditionState.PAUSED && !flag) ||
            lp.isGameCanceled(condition.gameId)
        ) revert CantChangeFlag();

        condition.state = flag ? ConditionState.PAUSED : ConditionState.CREATED;

        emit ConditionStopped(conditionId, flag);
    }

    /**
     * @notice Calculate the odds of bet with amount `amount` for outcome `outcome` of condition `conditionId`.
     * @param  conditionId the match or condition ID
     * @param  amount amount of tokens to bet
     * @param  outcome predicted outcome
     * @return odds betting odds
     */
    function calcOdds(
        uint256 conditionId,
        uint128 amount,
        uint64 outcome
    ) external view override returns (uint64 odds) {
        Condition storage condition = _getCondition(conditionId);
        uint256 outcomeIndex = getOutcomeIndex(conditionId, outcome);

        uint128[] memory virtualFunds = condition.virtualFunds;
        virtualFunds[outcomeIndex] += amount;
        odds = CoreTools
        .calcOdds(
            virtualFunds,
            condition.margin,
            condition.winningOutcomesCount
        )[outcomeIndex].toUint64();
    }

    /**
     * @notice Get condition by it's ID.
     * @param  conditionId the match or condition ID
     * @return the condition struct
     */
    function getCondition(uint256 conditionId)
        external
        view
        returns (Condition memory)
    {
        return conditions[conditionId];
    }

    /**
     * @notice Get condition's `conditionId` index of outcome `outcome`.
     */
    function getOutcomeIndex(uint256 conditionId, uint64 outcome)
        public
        view
        returns (uint256)
    {
        uint256 outcomeNumber = outcomeNumbers[conditionId][outcome];
        if (outcomeNumber == 0) revert WrongOutcome();

        return outcomeNumber - 1;
    }

    /**
     * @notice Check if `outcome` is winning outcome of condition `conditionId`.
     */
    function isOutcomeWinning(uint256 conditionId, uint64 outcome)
        public
        view
        returns (bool)
    {
        return winningOutcomes[conditionId][outcome];
    }

    /**
     * @notice Check if condition or game it is bound with is cancelled or not.
     */
    function isConditionCanceled(uint256 conditionId)
        public
        view
        returns (bool)
    {
        return _isConditionCanceled(_getCondition(conditionId));
    }

    /**
     * @notice Get the AzuroBet token `tokenId` payout amount.
     * @param  tokenId AzuroBet token ID
     * @return payout for the token
     */
    function viewPayout(uint256 tokenId) public view virtual returns (uint128) {
        Bet storage bet = bets[tokenId];
        if (bet.conditionId == 0) revert BetNotExists();
        if (bet.isPaid) revert AlreadyPaid();

        uint256 conditionId = bet.conditionId;
        Condition storage condition = _getCondition(conditionId);
        if (_isConditionResolved(condition)) {
            if (isOutcomeWinning(bet.conditionId, bet.outcome))
                return bet.payout;
            else return 0;
        }
        if (_isConditionCanceled(condition)) return bet.amount;

        revert ConditionNotFinished();
    }

    /**
     * @notice Register new condition.
     * @param  gameId the game ID the condition belongs
     * @param  conditionId the match or condition ID according to oracle's internal numbering
     * @param  odds start odds for [team 1, ..., team N]
     * @param  outcomes unique outcomes for the condition [outcome 1, ..., outcome N]
     * @param  reinforcement maximum amount of liquidity intended to condition reinforcement
     * @param  margin bookmaker commission
     * @param  winningOutcomesCount the number of winning outcomes for the condition
     */
    function _createCondition(
        uint256 gameId,
        uint256 conditionId,
        uint256[] calldata odds,
        uint64[] calldata outcomes,
        uint128 reinforcement,
        uint64 margin,
        uint8 winningOutcomesCount
    ) internal {
        if (conditionId == 0) revert IncorrectConditionId();
        if (margin > FixedMath.ONE) revert IncorrectMargin();

        uint256 length = outcomes.length;
        if (length < 2 || length > MAX_OUTCOMES_COUNT)
            revert IncorrectOutcomesCount();
        if (odds.length != length) revert OutcomesAndOddsCountDiffer();
        if (winningOutcomesCount == 0 || winningOutcomesCount >= length)
            revert IncorrectWinningOutcomesCount();

        Condition storage condition = conditions[conditionId];
        if (condition.gameId != 0) revert ConditionAlreadyCreated();

        condition.payouts = new uint128[](length);
        condition.virtualFunds = new uint128[](length);
        for (uint256 i = 0; i < length; ++i) {
            uint64 outcome = outcomes[i];
            if (outcomeNumbers[conditionId][outcome] != 0)
                revert DuplicateOutcomes(outcome);
            outcomeNumbers[conditionId][outcome] = i + 1;
        }

        condition.reinforcement = reinforcement;
        condition.fund = reinforcement;
        condition.gameId = gameId;
        condition.margin = margin;
        condition.winningOutcomesCount = winningOutcomesCount;
        condition.oracle = msg.sender;
        condition.lastDepositId = lp.getLastDepositId();
        _applyOdds(condition, odds);

        emit ConditionCreated(gameId, conditionId, outcomes);
    }

    /**
     * @notice Resolves a condition by updating its state and outcome information, updating Liquidity Pool liquidity and
     *         calculating and distributing payouts and rewards to relevant parties.
     * @param  condition the condition pointer
     * @param  conditionId the condition ID
     * @param  result the ConditionState enum value representing the result of the condition
     * @param  winningOutcomes_ the IDs of the winning outcomes of the condition. Set as empty array if the condition is canceled
     * @param  payout the payout amount to be distributed between bettors
     */
    function _resolveCondition(
        Condition storage condition,
        uint256 conditionId,
        ConditionState result,
        uint64[] memory winningOutcomes_,
        uint128 payout
    ) internal {
        condition.state = result;
        for (uint256 i = 0; i < winningOutcomes_.length; ++i) {
            winningOutcomes[conditionId][winningOutcomes_[i]] = true;
        }

        uint128 lockedReserve;
        uint128 profitReserve;
        {
            uint128[] memory payouts = condition.payouts;
            uint128 fund = condition.fund;
            uint128 reinforcement = condition.reinforcement;
            lockedReserve = _calcReserve(
                fund,
                condition.reinforcement,
                payouts,
                condition.totalNetBets,
                condition.winningOutcomesCount
            );
            profitReserve = lockedReserve + fund - reinforcement - payout;
        }

        lp.addReserve(
            condition.gameId,
            lockedReserve,
            profitReserve,
            condition.lastDepositId
        );

        emit ConditionResolved(
            conditionId,
            uint8(result),
            winningOutcomes_,
            profitReserve.toInt128() - lockedReserve.toInt128()
        );
    }

    /**
     * @notice Calculate the distribution of available fund into [outcome1Fund,..., outcomeNFund] compliant to odds `odds`
     *         and set it as condition virtual funds.
     */
    function _applyOdds(Condition storage condition, uint256[] memory odds)
        internal
    {
        uint256 length = odds.length;
        uint256 normalizer;
        for (uint256 i = 0; i < length; ++i) {
            uint256 odds_ = odds[i];
            if (odds_ == 0) revert ZeroOdds();
            normalizer += FixedMath.ONE.div(odds_);
        }

        uint256 fund = condition.fund -
            Math.maxSum(condition.payouts, condition.winningOutcomesCount);
        uint256 maxVirtualFund = fund / condition.winningOutcomesCount;
        // Multiplying by "FixedMath.ONE" reduces the gas cost of the loop below
        uint256 normalizedFund = (fund * FixedMath.ONE).div(normalizer);
        for (uint256 i = 0; i < length; ++i) {
            uint256 virtualFund = normalizedFund / odds[i];
            if (virtualFund >= maxVirtualFund) revert CoreTools.IncorrectOdds();

            condition.virtualFunds[i] = uint128(virtualFund);
        }
    }

    /**
     * @notice Change condition funds and update the locked reserve amount according to the new funds value.
     */
    function _changeFunds(
        Condition storage condition,
        uint256 outcomeIndex,
        uint128 amount,
        uint128 payout
    ) internal {
        uint128[] memory payouts = condition.payouts;
        uint128 reinforcement = condition.reinforcement;
        uint128 totalNetBets = condition.totalNetBets;
        uint128 fund = condition.fund;
        uint8 winningOutcomesCount = condition.winningOutcomesCount;
        int128 reserve = _calcReserve(
            fund,
            reinforcement,
            payouts,
            totalNetBets,
            winningOutcomesCount
        ).toInt128();

        fund += amount;
        payouts[outcomeIndex] += payout;
        totalNetBets += amount;
        lp.changeLockedLiquidity(
            condition.gameId,
            _calcReserve(
                fund,
                reinforcement,
                payouts,
                totalNetBets,
                winningOutcomesCount
            ).toInt128() - reserve
        );

        condition.fund = fund;
        condition.payouts[outcomeIndex] = payouts[outcomeIndex];
        condition.totalNetBets = totalNetBets;
    }

    /**
     * @notice Throw if the condition can't accept any bet now.
     * @notice This can happen because the condition is started, resolved or stopped or
     *         the game the condition is bounded with is canceled.
     * @param  condition the condition pointer
     */
    function _conditionIsRunning(Condition storage condition)
        internal
        view
        virtual
    {
        if (condition.state != ConditionState.CREATED)
            revert ConditionNotRunning();
        (uint64 startsAt, bool gameIsCanceled) = lp.getGameInfo(
            condition.gameId
        );
        if (gameIsCanceled || block.timestamp >= startsAt)
            revert ConditionNotRunning();
    }

    /**
     * @notice Calculate the amount of liquidity to be reserved.
     */
    function _calcReserve(
        uint128 fund,
        uint128 reinforcement,
        uint128[] memory payouts,
        uint256 totalNetBets,
        uint8 winningOutcomesCount
    ) internal pure returns (uint128) {
        uint256 maxPayout = Math.maxSum(payouts, winningOutcomesCount);
        if (totalNetBets > maxPayout) maxPayout = totalNetBets;
        return
            (
                (fund > reinforcement)
                    ? Math.diffOrZero(maxPayout, fund - reinforcement)
                    : maxPayout + reinforcement - fund
            ).toUint128();
    }

    function _checkOnlyLp() internal view {
        if (msg.sender != address(lp)) revert OnlyLp();
    }

    /**
     * @notice Get condition by it's ID.
     */
    function _getCondition(uint256 conditionId)
        internal
        view
        returns (Condition storage)
    {
        Condition storage condition = conditions[conditionId];
        if (condition.gameId == 0) revert ConditionNotExists();

        return condition;
    }

    /**
     * @notice Check if condition or game it is bound with is cancelled or not.
     */
    function _isConditionCanceled(Condition storage condition)
        internal
        view
        returns (bool)
    {
        return
            lp.isGameCanceled(condition.gameId) ||
            condition.state == ConditionState.CANCELED;
    }

    /**
     * @notice Check if condition is resolved or not.
     */
    function _isConditionResolved(Condition storage condition)
        internal
        view
        returns (bool)
    {
        return condition.state == ConditionState.RESOLVED;
    }
}
