// SPDX-License-Identifier: GPL-3.0

pragma solidity ^0.8.9;

import "./interface/IAzuroBet.sol";
import "./interface/ICoreBase.sol";
import "./interface/ILP.sol";
import "./libraries/AffiliateHelper.sol";
import "./libraries/CoreTools.sol";
import "./libraries/FixedMath.sol";
import "./libraries/SafeCast.sol";
import "./libraries/Math.sol";
import "./utils/OwnableUpgradeable.sol";

/// @title Base contract for Azuro cores
abstract contract CoreBase is OwnableUpgradeable, ICoreBase {
    using FixedMath for uint256;
    using SafeCast for uint256;
    using SafeCast for uint128;

    mapping(uint256 => Bet) public bets;
    mapping(uint256 => Condition) public conditions;

    IAzuroBet public azuroBet;
    ILP public lp;

    AffiliateHelper.Contributions internal contributions;
    AffiliateHelper.ContributedConditionIds internal contributedConditionIds;
    AffiliateHelper.AffiliatedProfits internal affiliatedProfits;

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

        uint256 gameId = condition.gameId;
        if (_isConditionResolved(condition) || _isConditionCanceled(condition))
            revert ConditionAlreadyResolved();

        condition.state = ConditionState.CANCELED;

        AffiliateHelper.delAffiliatedProfit(affiliatedProfits, conditionId);

        uint128 lockedReserve = _calcReserve(
            condition.reinforcement,
            condition.funds
        );
        if (lockedReserve > 0)
            lp.changeLockedLiquidity(gameId, -lockedReserve.toInt128());

        emit ConditionResolved(
            conditionId,
            uint8(ConditionState.CANCELED),
            0,
            0
        );
    }

    /**
     * @notice See {ICoreBase-changeOdds}.
     */
    function changeOdds(uint256 conditionId, uint64[2] calldata newOdds)
        external
        restricted(this.changeOdds.selector)
    {
        Condition storage condition = _getCondition(conditionId);
        _conditionIsRunning(condition);

        _applyOdds(condition, newOdds);
        emit OddsChanged(conditionId, newOdds);
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
     * @notice Liquidity Pool: Resolve affiliate's contribution to total profit that is not rewarded yet.
     * @param  affiliate address indicated as an affiliate when placing bets
     * @param data core pre-match affiliate params
     * @return reward contribution amount
     */
    function resolveAffiliateReward(address affiliate, bytes calldata data)
        external
        virtual
        override
        onlyLp
        returns (uint256 reward)
    {
        uint256[] storage conditionIds = contributedConditionIds.map[affiliate];

        AffiliateParams memory decoded = abi.decode(data, (AffiliateParams));

        uint256 start = decoded.start;
        if (conditionIds.length == 0) revert NoPendingReward();
        if (start >= conditionIds.length)
            revert StartOutOfRange(conditionIds.length);

        uint256 conditionId;
        Condition storage condition;
        AffiliateHelper.Contribution memory contribution;
        uint256 payout;

        uint256 end = (decoded.count != 0 &&
            start + decoded.count < conditionIds.length)
            ? start + decoded.count
            : conditionIds.length;
        while (start < end) {
            conditionId = conditionIds[start];
            condition = conditions[conditionId];
            if (_isConditionResolved(condition)) {
                uint256 affiliatesReward = condition.affiliatesReward;
                if (affiliatesReward > 0) {
                    contribution = contributions.map[affiliate][conditionId];
                    uint256 outcomeWinIndex = condition.outcomeWin ==
                        condition.outcomes[0]
                        ? 0
                        : 1;
                    payout = contribution.payouts[outcomeWinIndex];
                    if (contribution.totalNetBets > payout) {
                        reward +=
                            ((contribution.totalNetBets - payout) *
                                affiliatesReward) /
                            affiliatedProfits.map[conditionId][outcomeWinIndex];
                    }
                }
            } else if (!_isConditionCanceled(condition)) {
                start++;
                continue;
            }
            delete contributions.map[affiliate][conditionId];
            conditionIds[start] = conditionIds[conditionIds.length - 1];
            conditionIds.pop();
            end--;
        }
        return reward;
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
        odds = CoreTools
            .calcOdds(
                condition.virtualFunds,
                amount,
                _getOutcomeIndex(condition, outcome),
                condition.margin
            )
            .toUint64();
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
     * @notice Get the count of conditions contributed by `affiliate` that are not rewarded yet.
     */
    function getContributedConditionsCount(address affiliate)
        external
        view
        returns (uint256)
    {
        return contributedConditionIds.map[affiliate].length;
    }

    function isConditionCanceled(uint256 conditionId)
        public
        view
        returns (bool)
    {
        return _isConditionCanceled(_getCondition(conditionId));
    }

    /**
     * @notice Get AzuroBet token `tokenId` payout for `account`.
     * @param  tokenId AzuroBet token ID
     * @return winnings of the token owner
     */
    function viewPayout(uint256 tokenId) public view virtual returns (uint128) {
        Bet storage bet = bets[tokenId];
        if (bet.conditionId == 0) revert BetNotExists();
        if (bet.isPaid) revert AlreadyPaid();

        Condition storage condition = _getCondition(bet.conditionId);
        if (_isConditionResolved(condition)) {
            if (bet.outcome == condition.outcomeWin) return bet.payout;
            else return 0;
        }
        if (_isConditionCanceled(condition)) return bet.amount;

        revert ConditionNotFinished();
    }

    /**
     * @notice Register new condition.
     * @param  gameId the game ID the condition belongs
     * @param  conditionId the match or condition ID according to oracle's internal numbering
     * @param  odds start odds for [team 1, team 2]
     * @param  outcomes unique outcomes for the condition [outcome 1, outcome 2]
     * @param  reinforcement maximum amount of liquidity intended to condition reinforcement
     * @param  margin bookmaker commission
     */
    function _createCondition(
        uint256 gameId,
        uint256 conditionId,
        uint64[2] calldata odds,
        uint64[2] calldata outcomes,
        uint128 reinforcement,
        uint64 margin
    ) internal {
        if (conditionId == 0) revert IncorrectConditionId();
        if (outcomes[0] == outcomes[1]) revert SameOutcomes();
        if (margin > FixedMath.ONE) revert IncorrectMargin();

        Condition storage newCondition = conditions[conditionId];
        if (newCondition.gameId != 0) revert ConditionAlreadyCreated();

        newCondition.funds = [reinforcement, reinforcement];
        _applyOdds(newCondition, odds);
        newCondition.reinforcement = reinforcement;
        newCondition.gameId = gameId;
        newCondition.margin = margin;
        newCondition.outcomes = outcomes;
        newCondition.oracle = msg.sender;
        newCondition.leaf = lp.getLeaf();

        emit ConditionCreated(gameId, conditionId);
    }

    /**
     * @notice Indicate outcome `outcomeWin` as happened in condition `conditionId`.
     * @notice Only condition creator can resolve it.
     * @param  conditionId the match or condition ID
     * @param  outcomeWin ID of happened condition's outcome
     */
    function _resolveCondition(uint256 conditionId, uint64 outcomeWin)
        internal
    {
        Condition storage condition = _getCondition(conditionId);
        address oracle = condition.oracle;
        if (msg.sender != oracle) revert OnlyOracle(oracle);
        {
            (uint64 timeOut, bool gameIsCanceled) = lp.getGameInfo(
                condition.gameId
            );
            if (
                // TODO: Use only `_isConditionCanceled` to check if condition or its game is canceled
                gameIsCanceled ||
                condition.state == ConditionState.CANCELED ||
                _isConditionResolved(condition)
            ) revert ConditionAlreadyResolved();

            timeOut += 1 minutes;
            if (block.timestamp < timeOut) revert ResolveTooEarly(timeOut);
        }
        uint256 outcomeIndex = _getOutcomeIndex(condition, outcomeWin);
        uint256 oppositeIndex = 1 - outcomeIndex;

        condition.outcomeWin = outcomeWin;
        condition.state = ConditionState.RESOLVED;

        uint128 lockedReserve;
        uint128 profitReserve;
        {
            uint128 reinforcement = condition.reinforcement;
            uint128[2] memory funds = condition.funds;
            lockedReserve = _calcReserve(reinforcement, funds);
            profitReserve =
                lockedReserve +
                funds[oppositeIndex] -
                reinforcement;
        }

        uint128 affiliatesReward = lp.addReserve(
            condition.gameId,
            lockedReserve,
            profitReserve,
            condition.leaf
        );
        if (affiliatesReward > 0) condition.affiliatesReward = affiliatesReward;

        AffiliateHelper.delAffiliatedProfitOutcome(
            affiliatedProfits,
            conditionId,
            oppositeIndex
        );

        emit ConditionResolved(
            conditionId,
            uint8(ConditionState.RESOLVED),
            outcomeWin,
            profitReserve.toInt128() - lockedReserve.toInt128()
        );
    }

    /**
     * @notice Calculate the distribution of available fund into [outcome1Fund, outcome2Fund] compliant to odds `odds`
     *         and set it as condition virtual funds.
     */
    function _applyOdds(Condition storage condition, uint64[2] calldata odds)
        internal
    {
        if (odds[0] == 0 || odds[1] == 0) revert ZeroOdds();

        uint128 fund = Math.min(condition.funds[0], condition.funds[1]);
        uint128 fund0 = uint128(
            (uint256(fund) * odds[1]) / (odds[0] + odds[1])
        );
        condition.virtualFunds = [fund0, fund - fund0];
    }

    /**
     * @notice Change condition funds and update the locked reserve amount according to the new funds value.
     */
    function _changeFunds(
        Condition storage condition,
        uint128[2] memory funds,
        uint128[2] memory newFunds
    ) internal {
        uint128 reinforcement = condition.reinforcement;
        lp.changeLockedLiquidity(
            condition.gameId,
            _calcReserve(reinforcement, newFunds).toInt128() -
                _calcReserve(reinforcement, funds).toInt128()
        );
        condition.funds = newFunds;
    }

    /**
     * @notice Resolve AzuroBet token `tokenId` payout.
     * @param  tokenId AzuroBet token ID
     * @return winning account
     * @return amount of winnings
     */
    function _resolvePayout(uint256 tokenId)
        internal
        returns (address, uint128)
    {
        uint128 amount = viewPayout(tokenId);

        bets[tokenId].isPaid = true;
        return (azuroBet.ownerOf(tokenId), amount);
    }

    /**
     * @notice Add information about the bet made from an affiliate.
     * @param  affiliate_ address indicated as an affiliate when placing bet
     * @param  conditionId the match or condition ID
     * @param  betAmount amount of tokens is bet from the affiliate
     * @param  payout possible bet winnings
     * @param  outcomeIndex index of predicted outcome
     */
    function _updateContribution(
        address affiliate_,
        uint256 conditionId,
        uint128 betAmount,
        uint128 payout,
        uint256 outcomeIndex
    ) internal {
        AffiliateHelper.updateContribution(
            contributions,
            contributedConditionIds,
            affiliatedProfits,
            affiliate_,
            conditionId,
            betAmount,
            payout,
            outcomeIndex
        );
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
            revert ActionNotAllowed();
        (uint64 startsAt, bool gameIsCanceled) = lp.getGameInfo(
            condition.gameId
        );
        if (gameIsCanceled || block.timestamp >= startsAt)
            revert ActionNotAllowed();
    }

    /**
     * @notice Calculate the amount of liquidity to be reserved.
     */
    function _calcReserve(uint128 reinforcement, uint128[2] memory funds)
        internal
        pure
        returns (uint128)
    {
        return
            Math
                .max(
                    Math.diffOrZero(reinforcement, funds[0]),
                    Math.diffOrZero(reinforcement, funds[1])
                )
                .toUint128();
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
     * @notice Get condition's index of outcome `outcome`.
     * @dev    Throw if the condition haven't outcome `outcome` as possible
     * @param  condition the condition pointer
     * @param  outcome outcome ID
     */
    function _getOutcomeIndex(Condition storage condition, uint64 outcome)
        internal
        pure
        returns (uint256)
    {
        return CoreTools.getOutcomeIndex(condition, outcome);
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
