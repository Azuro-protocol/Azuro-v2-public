// SPDX-License-Identifier: GPL-3.0

pragma solidity ^0.8.9;

import "./CoreBase.sol";
import "./interface/IPrematchCore.sol";
import "./libraries/FixedMath.sol";
import "./utils/OwnableUpgradeable.sol";

/// @title Azuro internal core managing pre-match conditions and processing bets on them
contract PrematchCore is CoreBase, IPrematchCore {
    using FixedMath for uint64;
    using SafeCast for uint256;

    /**
     * @notice See {ICoreBase-createCondition}.
     */
    function createCondition(
        uint256 gameId,
        uint256 conditionId,
        uint64[2] calldata odds,
        uint64[2] calldata outcomes,
        uint128 reinforcement,
        uint64 margin
    ) external override restricted(this.createCondition.selector) {
        _createCondition(
            gameId,
            conditionId,
            odds,
            outcomes,
            reinforcement,
            margin
        );
        if (lp.addCondition(gameId) <= block.timestamp)
            revert GameAlreadyStarted();
    }

    /**
     * @notice Liquidity Pool: See {ICoreBase-putBet}.
     */
    function putBet(
        address bettor,
        uint128 amount,
        IBet.BetData calldata betData
    ) external override onlyLp returns (uint256 tokenId) {
        CoreBetData memory data = abi.decode(betData.data, (CoreBetData));
        Condition storage condition = _getCondition(data.conditionId);
        _conditionIsRunning(condition);

        uint256 outcomeIndex = _getOutcomeIndex(condition, data.outcomeId);

        uint128[2] memory virtualFunds = condition.virtualFunds;
        uint64 odds = CoreTools
            .calcOdds(virtualFunds, amount, outcomeIndex, condition.margin)
            .toUint64();
        if (odds < data.minOdds) revert SmallOdds();

        uint128 payout = odds.mul(amount).toUint128();
        uint128 deltaPayout = payout - amount;

        virtualFunds[outcomeIndex] += amount;
        virtualFunds[1 - outcomeIndex] -= deltaPayout;
        condition.virtualFunds = virtualFunds;

        {
            uint128[2] memory funds = condition.funds;
            _changeFunds(
                condition,
                funds,
                outcomeIndex == 0
                    ? [funds[0] + amount, funds[1] - deltaPayout]
                    : [funds[0] - deltaPayout, funds[1] + amount]
            );
        }

        _updateContribution(
            betData.affiliate,
            data.conditionId,
            amount,
            payout,
            outcomeIndex
        );

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
     * @notice See {CoreBase-_resolveCondition}.
     */
    function resolveCondition(uint256 conditionId, uint64 outcomeWin)
        external
        override
    {
        _resolveCondition(conditionId, outcomeWin);
    }

    /**
     * @notice Liquidity Pool: Resolve AzuroBet token `tokenId` payout.
     * @param  tokenId AzuroBet token ID
     * @return winning account
     * @return amount of winnings
     */
    function resolvePayout(uint256 tokenId)
        external
        override
        onlyLp
        returns (address, uint128)
    {
        return _resolvePayout(tokenId);
    }
}
