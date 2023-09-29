// SPDX-License-Identifier: GPL-3.0

pragma solidity ^0.8.9;

import "./CoreBase.sol";
import "./interface/IPrematchCore.sol";
import "./libraries/FixedMath.sol";
import "./utils/OwnableUpgradeable.sol";

/// @title Azuro internal core managing pre-match conditions and processing bets on them
contract PrematchCore is CoreBase, IPrematchCore {
    using FixedMath for *;
    using SafeCast for uint256;

    /**
     * @notice See {ICoreBase-createCondition}.
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
    ) external override restricted(this.createCondition.selector) {
        _createCondition(
            gameId,
            conditionId,
            odds,
            outcomes,
            reinforcement,
            margin,
            winningOutcomesCount,
            isExpressForbidden
        );
        if (lp.addCondition(gameId) <= block.timestamp)
            revert GameAlreadyStarted();
    }

    /**
     * @notice Liquidity Pool: See {IBet-putBet}.
     */
    function putBet(
        address bettor,
        uint128 amount,
        IBet.BetData calldata betData
    ) external override onlyLp returns (uint256 tokenId) {
        CoreBetData memory data = abi.decode(betData.data, (CoreBetData));
        Condition storage condition = _getCondition(data.conditionId);
        _conditionIsRunning(condition);

        uint256 outcomeIndex = getOutcomeIndex(
            data.conditionId,
            data.outcomeId
        );

        uint128[] memory virtualFunds = condition.virtualFunds;
        virtualFunds[outcomeIndex] += amount;

        uint64 odds = CoreTools
        .calcOdds(
            virtualFunds,
            condition.margin,
            condition.winningOutcomesCount
        )[outcomeIndex].toUint64();
        if (odds < betData.minOdds) revert CoreTools.IncorrectOdds();

        uint128 payout = odds.mul(amount).toUint128();
        {
            uint256 virtualFund = Math.sum(virtualFunds);
            uint256 oppositeVirtualFund = virtualFund -
                virtualFunds[outcomeIndex];
            uint256 deltaPayout = payout - amount;
            uint256 length = virtualFunds.length;
            for (uint256 i = 0; i < length; ++i) {
                if (i != outcomeIndex) {
                    virtualFunds[i] -= uint128(
                        (deltaPayout * virtualFunds[i]) / oppositeVirtualFund
                    );
                    CoreTools.calcProbability(
                        virtualFunds[i],
                        virtualFund,
                        condition.winningOutcomesCount
                    );
                }
            }
        }

        condition.virtualFunds = virtualFunds;
        _changeFunds(condition, outcomeIndex, amount, payout);

        tokenId = azuroBet.mint(bettor);
        {
            Bet storage bet = bets[tokenId];
            bet.conditionId = data.conditionId;
            bet.amount = amount;
            bet.payout = payout;
            bet.outcome = data.outcomeId;
        }

        emit NewBet(
            bettor,
            betData.affiliate,
            data.conditionId,
            tokenId,
            data.outcomeId,
            amount,
            odds,
            virtualFunds
        );
    }

    /**
     * @notice Indicate outcome `outcomeWin` as happened in condition `conditionId`.
     * @notice Only condition creator can resolve it.
     * @param  conditionId the match or condition ID
     * @param  winningOutcomes_ the IDs of the winning outcomes of the condition
     */
    function resolveCondition(
        uint256 conditionId,
        uint64[] calldata winningOutcomes_
    ) external override resolveConditionBase(conditionId, winningOutcomes_) {}
}
