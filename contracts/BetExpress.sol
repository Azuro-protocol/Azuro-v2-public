// SPDX-License-Identifier: GPL-3.0

pragma solidity ^0.8.9;

import "./interface/IBetExpress.sol";
import "./interface/ILP.sol";
import "./libraries/CoreTools.sol";
import "./libraries/FixedMath.sol";
import "./libraries/SafeCast.sol";
import "./utils/OwnableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/token/ERC721/ERC721Upgradeable.sol";

contract BetExpress is ERC721Upgradeable, OwnableUpgradeable, IBetExpress {
    using FixedMath for *;
    using SafeCast for *;

    uint256 public lastBetId;
    ILP public lp;
    ICoreBase public core;
    uint128 public reinforcement;
    string public baseURI;

    // Condition ID -> The amount of reserves locked by bets with the condition
    mapping(uint256 => uint256) public lockedReserves;
    mapping(uint256 => Bet) private _bets;

    uint256 public maxOdds;

    /**
     * @notice Only permits calls by the Liquidity Pool.
     */
    modifier onlyLp() {
        _checkOnlyLp();
        _;
    }

    function initialize(
        address lp_,
        address core_
    ) external override initializer {
        __ERC721_init("BetExpress", "EXPR");
        __Ownable_init();

        lp = ILP(lp_);
        core = ICoreBase(core_);
        maxOdds = FixedMath.ONE * 1000;
    }

    /**
     * @notice Owner: sets 'uri' as base NFT URI
     * @param uri base URI string
     */
    function setBaseURI(string calldata uri) external onlyOwner {
        baseURI = uri;
    }

    /**
     * @notice Owner: Set `newReinforcement` as the new maximum amount of reserves that can be locked by all bets
     *         for the same condition.
     */
    function changeReinforcement(uint128 newReinforcement) external onlyOwner {
        reinforcement = newReinforcement;
        emit ReinforcementChanged(newReinforcement);
    }

    /**
     * @notice Owner: Set `newMaxOdds` as the new maximum odds that can be accepted for a bet.
     */
    function changeMaxOdds(uint256 newMaxOdds) external onlyOwner {
        if (newMaxOdds < FixedMath.ONE) revert IncorrectMaxOdds();

        maxOdds = newMaxOdds;
        emit MaxOddsChanged(newMaxOdds);
    }

    /**
     * @notice Liquidity Pool: See {IBet-putBet}.
     */
    function putBet(
        address bettor,
        uint128 amount,
        BetData calldata betData
    ) external override onlyLp returns (uint256 betId) {
        ICoreBase.CoreBetData[] memory subBets = abi.decode(
            betData.data,
            (ICoreBase.CoreBetData[])
        );
        (
            uint64[] memory conditionOdds,
            uint256 expressOdds,
            uint256[] memory outcomesIndexes,
            uint128[][] memory virtualFunds,
            uint8[] memory winningOutcomesCounts
        ) = _calcOdds(subBets, amount);
        if (expressOdds < betData.minOdds) revert SmallOdds();
        if (expressOdds > maxOdds) revert LargeOdds();

        betId = ++lastBetId;
        Bet storage bet = _bets[betId];

        bet.odds = expressOdds.toUint64();
        bet.amount = amount;
        bet.lastDepositId = lp.getLastDepositId();
        bet.conditionOdds = conditionOdds;

        uint256 oddsSum;
        uint256 length = subBets.length;
        for (uint256 i = 0; i < length; ++i) {
            bet.subBets.push(subBets[i]);
            oddsSum += conditionOdds[i];
        }
        _shiftOdds(
            expressOdds,
            oddsSum,
            amount,
            subBets,
            conditionOdds,
            outcomesIndexes,
            virtualFunds,
            winningOutcomesCounts
        );

        uint128 deltaPayout = expressOdds.mul(amount).toUint128() - amount;
        for (uint256 i = 0; i < length; ++i) {
            uint256 conditionId = subBets[i].conditionId;
            uint256 lockedReserve = lockedReserves[conditionId] +
                (deltaPayout * (conditionOdds[i] - FixedMath.ONE)) /
                (oddsSum - length * FixedMath.ONE);
            if (lockedReserve > reinforcement)
                revert TooLargeReinforcement(conditionId);
            lockedReserves[conditionId] = lockedReserve;
        }

        lp.changeLockedLiquidity(0, deltaPayout.toInt128());

        _safeMint(bettor, betId);
        emit NewBet(bettor, betData.affiliate, betId, bet);
    }

    /**
     * @notice Liquidity Pool: Resolves the payout of the express bet with ID 'betId'.
     * @param  tokenId The express bet token ID.
     * @return account winning account.
     * @return payout amount of winnings.
     */
    function resolvePayout(
        uint256 tokenId
    ) external override onlyLp returns (address account, uint128 payout) {
        Bet storage bet = _bets[tokenId];

        account = ownerOf(tokenId);
        payout = _viewPayout(bet);

        uint128 amount = bet.amount;
        bet.isClaimed = true;

        uint128 fullPayout = amount.mul(bet.odds).toUint128();
        lp.addReserve(
            0,
            fullPayout - amount,
            fullPayout - payout,
            bet.lastDepositId
        );
    }

    /**
     * @notice Calculate the odds of a bet with an amount for the sub-bet subBets.
     * @param  subBets The CoreBetData array. See {ICoreBase.CoreBetData}.
     * @param  amount The amount of tokens to bet.
     * @return conditionOdds The betting odds for each sub-bet.
     * @return expressOdds The resulting betting odds.
     */
    function calcOdds(
        ICoreBase.CoreBetData[] calldata subBets,
        uint128 amount
    )
        external
        view
        returns (uint64[] memory conditionOdds, uint256 expressOdds)
    {
        (conditionOdds, expressOdds, , , ) = _calcOdds(subBets, amount);
    }

    /**
     * @notice Calc the payout for express bet with ID 'betId'.
     * @notice Returns the payout even if it has already been paid.
     * @param  tokenId The express bet token ID.
     * @return The pending or redeemed payout of the bet owner.
     */
    function calcPayout(uint256 tokenId) external view returns (uint128) {
        return _calcPayout(_bets[tokenId]);
    }

    /**
     * @notice Get information about express bet with ID 'betId'
     * @param  betId The express bet token ID.
     * @return betInfo The express bet information.
     */
    function getBet(uint256 betId) external view returns (Bet memory betInfo) {
        return _bets[betId];
    }

    /**
     * @notice Get the payout for express bet `tokenId`.
     * @param  tokenId The express bet token ID.
     * @return The pending payout of the bet owner.
     */
    function viewPayout(
        uint256 tokenId
    ) external view virtual override returns (uint128) {
        return _viewPayout(_bets[tokenId]);
    }

    /**
     * @notice Change odds on express' conditions proportionally to considered win payouts on them
     * @notice The purpose is to avoid value abuse
     */
    function _shiftOdds(
        uint256 expressOdds,
        uint256 oddsSum,
        uint128 amount,
        ICoreBase.CoreBetData[] memory subBets,
        uint64[] memory conditionOdds,
        uint256[] memory outcomesIndexes,
        uint128[][] memory virtualFunds,
        uint8[] memory winningOutcomesCounts
    ) internal {
        uint256 length = subBets.length;
        uint256 divider = oddsSum - length * FixedMath.ONE;
        uint256 smoothMultiplier = _smoothMultiplier(expressOdds);

        for (uint256 i = 0; i < length; ++i) {
            uint256 subWinPayout = amount.mul(conditionOdds[i] - FixedMath.ONE);
            virtualFunds[i][outcomesIndexes[i]] += ((subWinPayout *
                smoothMultiplier) / divider).toUint128();
            uint256[] memory odds = CoreTools.calcOdds(
                virtualFunds[i],
                0,
                winningOutcomesCounts[i]
            );

            core.changeOdds(subBets[i].conditionId, odds);
        }
    }

    function _baseURI() internal view override returns (string memory) {
        return baseURI;
    }

    /**
     * @notice Check if condition can accept bets
     */
    function _conditionIsRunning(
        ICondition.Condition memory condition,
        uint256 conditionId
    ) internal view {
        if (condition.state != ICondition.ConditionState.CREATED)
            revert ConditionNotRunning(conditionId);
        (uint64 startsAt, bool gameIsCanceled) = lp.getGameInfo(
            condition.gameId
        );
        if (gameIsCanceled || block.timestamp >= startsAt)
            revert ConditionNotRunning(conditionId);
    }

    /**
     * @notice Calculate the odds of a bet with an amount for the sub-bet subBets.
     * @notice This method additionally returns `outcomesIndexes` and `virtualFunds` that can assist in subsequent
     *         calculations.
     * @param amount The amount of tokens to bet.
     * @param subBets The CoreBetData array. See {ICoreBase.CoreBetData}.
     * @return conditionOdds The betting odds for each sub-bet.
     * @return expressOdds The resulting betting odds.
     * @return outcomesIndexes The predicted outcome index for each sub-bet.
     * @return virtualFunds The condition virtual funds for each sub-bet.
     * @return winningOutcomesCounts The condition number of winning outcomes for each sub-bet
     */
    function _calcOdds(
        ICoreBase.CoreBetData[] memory subBets,
        uint128 amount
    )
        internal
        view
        returns (
            uint64[] memory conditionOdds,
            uint256 expressOdds,
            uint256[] memory outcomesIndexes,
            uint128[][] memory virtualFunds,
            uint8[] memory winningOutcomesCounts
        )
    {
        uint256 length = subBets.length;
        if (length < 2) revert TooFewSubbets();

        expressOdds = FixedMath.ONE;
        uint256 oddsSum;

        conditionOdds = new uint64[](length);
        outcomesIndexes = new uint256[](length);
        virtualFunds = new uint128[][](length);
        winningOutcomesCounts = new uint8[](length);
        uint64[] memory conditionMargins = new uint64[](length);

        {
            uint256[] memory gameIds = new uint256[](length);
            for (uint256 i = 0; i < length; ++i) {
                ICoreBase.CoreBetData memory subBet = subBets[i];

                ICondition.Condition memory condition = core.getCondition(
                    subBet.conditionId
                );
                if (condition.isExpressForbidden)
                    revert ConditionNotForExpress();
                _conditionIsRunning(condition, subBet.conditionId);
                {
                    uint256 gameId = condition.gameId;
                    for (uint256 j = 0; j < i; ++j) {
                        if (gameIds[j] == gameId)
                            revert SameGameIdsNotAllowed();
                    }
                    gameIds[i] = gameId;
                }
                uint256 outcomeIndex = core.getOutcomeIndex(
                    subBet.conditionId,
                    subBet.outcomeId
                );
                uint256 odds = CoreTools.calcOdds(
                    condition.virtualFunds,
                    0,
                    condition.winningOutcomesCount
                )[outcomeIndex];

                expressOdds = expressOdds.mul(odds);
                oddsSum += odds;
                outcomesIndexes[i] = outcomeIndex;
                virtualFunds[i] = condition.virtualFunds;
                conditionMargins[i] = condition.margin;
                winningOutcomesCounts[i] = condition.winningOutcomesCount;
            }
        }

        {
            uint128 subBetAmount = (((expressOdds - FixedMath.ONE) * amount) /
                (oddsSum - length * FixedMath.ONE)).toUint128();

            expressOdds = FixedMath.ONE;
            for (uint256 i = 0; i < length; ++i) {
                uint256 outcomeIndex = outcomesIndexes[i];
                virtualFunds[i][outcomeIndex] += subBetAmount;
                uint256 adjustedOdds = CoreTools.calcOdds(
                    virtualFunds[i],
                    conditionMargins[i],
                    winningOutcomesCounts[i]
                )[outcomeIndex];
                virtualFunds[i][outcomeIndex] -= subBetAmount;

                conditionOdds[i] = adjustedOdds.toUint64();
                expressOdds = expressOdds.mul(adjustedOdds);
            }
        }
    }

    /**
     * @notice Calc the payout for express bet.
     * @notice Returns the payout even if it has already been paid.
     * @param  bet The express bet struct.
     * @return The pending or redeemed payout of the bet owner.
     */
    function _calcPayout(Bet storage bet) internal view returns (uint128) {
        uint128 amount = bet.amount;
        ICoreBase.CoreBetData[] storage subBets = bet.subBets;
        uint256 length = subBets.length;
        uint256 winningOdds = FixedMath.ONE;

        if (length == 0) revert BetNotExists();

        for (uint256 i = 0; i < length; ++i) {
            ICoreBase.CoreBetData storage subBet = subBets[i];
            ICondition.Condition memory condition = core.getCondition(
                subBet.conditionId
            );

            if (condition.state == ICondition.ConditionState.RESOLVED) {
                if (core.isOutcomeWinning(subBet.conditionId, subBet.outcomeId))
                    winningOdds = winningOdds.mul(bet.conditionOdds[i]);
                else return 0;
            } else if (
                !(condition.state == ICondition.ConditionState.CANCELED ||
                    lp.isGameCanceled(condition.gameId))
            ) {
                revert ConditionNotFinished(subBet.conditionId);
            }
        }

        if (winningOdds > FixedMath.ONE) {
            return amount.mul(winningOdds).toUint128();
        } else {
            return amount;
        }
    }

    function _checkOnlyLp() internal view {
        if (msg.sender != address(lp)) revert OnlyLp();
    }

    /**
     * @notice Get the available payout for express bet.
     * @param  bet The express bet struct.
     * @return The pending payout of the bet owner.
     */
    function _viewPayout(Bet storage bet) internal view returns (uint128) {
        if (bet.isClaimed) revert AlreadyPaid();
        return _calcPayout(bet);
    }

    /**
     * @notice This formula is chosen empirically for smooth multiplier distribution.
     * It is smoothly decreasing from 1 to 0, having the most descending part approx. on (1.5; 4)
     * The purpose is to make low-odds expresses less profitable, so the margin is higher on lower odds.
     * Another use is for shifting odds - the higher the odds, the less we shift them on conditions
     * (to prevent odds manipulation)
     * https://www.wolframalpha.com/input?i2d=true&i=Divide%5Bx%2Cx2-x%2B1%5D
     * @notice f(x) = x / (x^2 - x + 1)
     * lim (x->1) f(x) = 1
     * lim (x->+inf) f(x) = 0
     */
    function _smoothMultiplier(uint256 x) internal pure returns (uint256) {
        return x.div(x.mul(x) - x + FixedMath.ONE);
    }
}
