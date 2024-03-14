// SPDX-License-Identifier: GPL-3.0

pragma solidity ^0.8.9;

import "./FixedMath.sol";
import "./Math.sol";
import "./SafeCast.sol";

/// @title Specific tools for Azuro Cores
library CoreTools {
    uint256 constant MAX_ODDS = FixedMath.ONE * 100;
    uint256 constant MAX_ITERATIONS = 25;
    uint256 constant PRECISION = 1e7;

    using FixedMath for *;
    using SafeCast for uint256;

    error IncorrectOdds();

    /**
     * @notice Get commission adjusted betting odds.
     * @param  probabilities the probabilities of each outcome of a condition
     * @param  margin bookmaker commission
     * @return odds commission adjusted betting odds for each outcome
     * @param  winningOutcomesCount the number of winning outcomes of the condition
     */
    function marginAdjustedOdds(
        uint256[] memory probabilities,
        uint256 margin,
        uint256 winningOutcomesCount
    ) internal pure returns (uint256[] memory odds) {
        uint256 length = probabilities.length;
        odds = new uint256[](length);
        uint256[] memory spreads = new uint256[](length);
        for (uint256 i = 0; i < length; ++i) {
            spreads[i] = (FixedMath.ONE - probabilities[i]).mul(margin);
        }

        uint256 error = margin;
        uint256 iteration;
        uint256 spreadMultiplier = winningOutcomesCount * FixedMath.ONE;
        for (; iteration < MAX_ITERATIONS; ++iteration) {
            uint256 oddsSpread;
            {
                uint256 spread;
                for (uint256 i = 0; i < length; ++i) {
                    uint256 odds_ = (FixedMath.ONE - spreads[i]).div(
                        probabilities[i]
                    );
                    odds[i] = odds_;
                    spread += FixedMath.ONE.div(odds_);
                }

                oddsSpread = FixedMath.ONE - spreadMultiplier.div(spread);
            }

            if (FixedMath.ratio(margin, oddsSpread) - FixedMath.ONE < PRECISION)
                break;
            assert(margin > oddsSpread);

            uint256 newError = margin - oddsSpread;
            if (newError == error) {
                assert(margin.div(oddsSpread) - FixedMath.ONE < 1e9); // Raise an assertion error if the difference between the expected and actual margin is greater than 0.1%
                break;
            }

            error = newError;

            for (uint256 i = 0; i < length; ++i)
                spreads[i] += (FixedMath.ONE - spreads[i] - probabilities[i])
                    .mul(
                        FixedMath.sigmoid(
                            (error * spreads[i])
                                .div(FixedMath.ONE - FixedMath.ONE.div(odds[i]))
                                .div(FixedMath.ONE - margin) / (oddsSpread)
                        )
                    );
        }

        assert(iteration < MAX_ITERATIONS);
    }

    /**
     * @notice Calculate the betting odds with bookmaker commission `margin` for each outcome of a condition.
     * @param  funds allocated to each outcome of the condition
     * @param  margin bookmaker commission
     * @param  winningOutcomesCount the number of winning outcomes of the condition
     */
    function calcOdds(
        uint128[] memory funds,
        uint256 margin,
        uint256 winningOutcomesCount
    ) internal pure returns (uint256[] memory odds) {
        uint128 fund = Math.sum(funds);
        uint256 length = funds.length;
        if (margin > 0) {
            uint256[] memory probabilities = new uint256[](length);
            for (uint256 i = 0; i < length; ++i) {
                probabilities[i] = calcProbability(
                    funds[i],
                    fund,
                    winningOutcomesCount
                );
            }
            odds = marginAdjustedOdds(
                probabilities,
                margin,
                winningOutcomesCount
            );
        } else {
            odds = new uint256[](length);
            for (uint256 i = 0; i < length; ++i) {
                uint256 odds_ = (fund).div(funds[i] * winningOutcomesCount);
                if (odds_ <= FixedMath.ONE) revert IncorrectOdds();

                odds[i] = odds_;
            }
        }

        for (uint256 i = 0; i < length; ++i) {
            uint256 odds_ = odds[i];
            if (odds_ > MAX_ODDS) odds[i] = MAX_ODDS;
        }

        return odds;
    }

    /**
     * @notice Calculate the probability of an outcome based on its fund and the total fund of a condition.
     */
    function calcProbability(
        uint256 outcomeFund,
        uint256 fund,
        uint256 winningOutcomesCount
    ) internal pure returns (uint256 probability) {
        probability = (outcomeFund * winningOutcomesCount).div(fund);
        if (probability < 1000 || probability >= FixedMath.ONE)
            revert IncorrectOdds(); // This constraint helps to avoid errors in marginAdjustedOdds call
    }
}
