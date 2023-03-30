// SPDX-License-Identifier: GPL-3.0

pragma solidity ^0.8.9;

import "./FixedMath.sol";
import "../interface/ICondition.sol";
import "./SafeCast.sol";

/// @title Specific tools for Azuro Cores
library CoreTools {
    using FixedMath for uint256;
    using SafeCast for uint256;

    error LargeFundsRatio();
    error WrongOutcome();

    /**
     * @notice Get commission adjusted betting odds.
     * @param  odds pure betting odds
     * @param  margin bookmaker commission
     * @return newOdds commission adjusted betting odds
     */
    function marginAdjustedOdds(uint256 odds, uint256 margin)
        internal
        pure
        returns (uint64)
    {
        uint256 oppositeOdds = FixedMath.ONE.div(
            FixedMath.ONE - FixedMath.ONE.div(odds)
        );
        uint256 a = ((margin + FixedMath.ONE) *
            (oppositeOdds - FixedMath.ONE)) / (odds - FixedMath.ONE);
        uint256 b = margin +
            ((oppositeOdds - FixedMath.ONE) * margin) /
            (odds - FixedMath.ONE);

        return
            ((FixedMath.sqrt(b.sqr() + 4 * a.mul(FixedMath.ONE - margin)) - b)
                .div(2 * a) + FixedMath.ONE).toUint64();
    }

    /**
     * @notice Calculate the odds of bet with amount `amount` for outcome `outcome` of condition `conditionId`.
     * @param  amount amount of tokens to bet
     * @param  outcomeIndex ID of predicted outcome
     * @param  margin bookmaker commission
     * @return odds betting odds
     */
    function calcOdds(
        uint128[2] memory funds,
        uint128 amount,
        uint256 outcomeIndex,
        uint256 margin
    ) internal pure returns (uint256) {
        uint256 odds = uint256(funds[0] + funds[1] + amount).div(
            funds[outcomeIndex] + amount
        );
        if (odds == FixedMath.ONE) revert LargeFundsRatio();

        if (margin > 0) {
            return marginAdjustedOdds(odds, margin);
        } else {
            return odds;
        }
    }

    function getOutcomeIndex(
        ICondition.Condition memory condition,
        uint64 outcome
    ) internal pure returns (uint256) {
        if (outcome == condition.outcomes[0]) return 0;
        if (outcome == condition.outcomes[1]) return 1;
        revert WrongOutcome();
    }
}
