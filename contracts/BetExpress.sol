// SPDX-License-Identifier: GPL-3.0

pragma solidity ^0.8.9;

import "./interface/IAffiliate.sol";
import "./interface/IBetExpress.sol";
import "./interface/ICoreBase.sol";
import "./interface/ILP.sol";
import "./libraries/CoreTools.sol";
import "./libraries/FixedMath.sol";
import "./libraries/SafeCast.sol";
import "./utils/OwnableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/token/ERC721/ERC721Upgradeable.sol";

contract BetExpress is
    ERC721Upgradeable,
    OwnableUpgradeable,
    IBetExpress,
    IAffiliate
{
    using FixedMath for *;
    using SafeCast for *;

    uint256 public lastBetId;
    uint128 public margin;
    ILP public lp;
    ICoreBase public core;
    uint64 public maxReinforcementShare;
    string public baseURI;

    // Condition ID -> The amount of reserves locked by bets with the condition
    mapping(uint256 => uint256) public reinforcements;
    mapping(address => uint256) public affRewards;
    mapping(uint256 => Bet) private _bets;

    /**
     * @notice Only permits calls by the Liquidity Pool.
     */
    modifier onlyLp() {
        _checkOnlyLp();
        _;
    }

    function initialize(address lp_, address core_)
        external
        override
        initializer
    {
        __ERC721_init("BetExpress", "EXPR");
        __Ownable_init();

        lp = ILP(lp_);
        core = ICoreBase(core_);
    }

    /**
     * @notice Owner: sets 'uri' as base NFT URI
     * @param uri base URI string
     */
    function setBaseURI(string calldata uri) external onlyOwner {
        baseURI = uri;
    }

    /**
     * @notice Set common parameters for express bets
     * @param  margin_ basic marginality commission value
     * @param  maxReinforcementShare_ the maximum amount of reserves locked by all bets with the same condition
     */
    function setParams(uint128 margin_, uint64 maxReinforcementShare_)
        external
        onlyOwner
    {
        if (margin_ > FixedMath.ONE) revert IncorrectMargin();
        margin = margin_;
        if (maxReinforcementShare_ > FixedMath.ONE)
            revert IncorrectMaxReinforcementShare();
        maxReinforcementShare = maxReinforcementShare_;

        emit ParamsUpdated(margin_, maxReinforcementShare_);
    }

    /**
     * @notice Liquidity Pool: See {IBet-putBet}.
     */
    function putBet(
        address bettor,
        uint128 amount,
        BetData calldata betData
    ) external override onlyLp returns (uint256 betId) {
        SubBet[] memory subBets = abi.decode(betData.data, (SubBet[]));

        uint256 expressOdds = FixedMath.ONE;
        uint256 oddsSum;
        uint256 length = subBets.length;
        uint256[] memory outcomesIndexes = new uint256[](length);
        uint64[] memory conditionOdds = new uint64[](length);
        uint128[2][] memory virtualFunds = new uint128[2][](length);

        if (length < 2) revert TooFewSubbets();

        betId = ++lastBetId;
        Bet storage bet = _bets[betId];

        uint256[] memory gameIds = new uint256[](length);

        for (uint256 i = 0; i < length; i++) {
            SubBet memory subBet = subBets[i];

            ICondition.Condition memory condition = core.getCondition(
                subBet.conditionId
            );
            _conditionIsRunning(condition, subBet.conditionId);
            {
                uint256 gameId = condition.gameId;
                for (uint256 j = 0; j < i; j++) {
                    if (gameIds[j] == gameId) revert SameGameIdsNotAllowed();
                }
                gameIds[i] = gameId;
            }
            uint256 outcomeIndex = CoreTools.getOutcomeIndex(
                condition,
                subBet.outcomeId
            );
            uint256 odds = CoreTools.calcOdds(
                condition.virtualFunds,
                0,
                outcomeIndex,
                0
            );
            uint64 adjustedOdds = CoreTools.marginAdjustedOdds(
                odds,
                _calcMargin(margin, odds)
            );

            expressOdds = expressOdds.mul(adjustedOdds);
            oddsSum += adjustedOdds;
            virtualFunds[i] = condition.virtualFunds;
            outcomesIndexes[i] = outcomeIndex;
            conditionOdds[i] = adjustedOdds;
            bet.subBets.push(subBet);
        }

        bet.affiliate = betData.affiliate;
        bet.odds = expressOdds.toUint64();
        bet.amount = amount;
        bet.leaf = lp.getLeaf();
        bet.conditionOdds = conditionOdds;

        _shiftOdds(
            expressOdds,
            oddsSum,
            amount,
            subBets,
            conditionOdds,
            virtualFunds,
            outcomesIndexes
        );

        uint128 deltaPayout = expressOdds.mul(amount).toUint128() - amount;
        uint256 maxReinforcement = maxReinforcementShare.mul(
            lp.getLockedLiquidityLimit(address(this))
        );
        for (uint256 i = 0; i < subBets.length; i++) {
            uint256 conditionId = subBets[i].conditionId;
            uint256 reinforcement = reinforcements[conditionId] +
                (deltaPayout * conditionOdds[i]) /
                oddsSum;
            if (reinforcement > maxReinforcement)
                revert TooLargeReinforcement(conditionId);
            reinforcements[conditionId] = reinforcement;
        }

        lp.changeLockedLiquidity(0, deltaPayout.toInt128());

        _safeMint(bettor, betId);
        emit NewBet(betId, bet);
    }

    /**
     * @notice Liquidity Pool: Resolve affiliate's contribution to total profit that is not rewarded yet.
     * @param  affiliate address indicated as an affiliate when placing bets
     * @return reward contribution amount
     */
    function resolveAffiliateReward(address affiliate, bytes calldata)
        external
        override
        onlyLp
        returns (uint256 reward)
    {
        reward = affRewards[affiliate];
        delete affRewards[affiliate];
    }

    /**
     * @notice Liquidity Pool: Resolve BetExpress token ID `tokenId` payout.
     * @param  tokenId BetExpress token ID
     * @return account winning account
     * @return payout amount of winnings
     */
    function resolvePayout(uint256 tokenId)
        external
        override
        onlyLp
        returns (address account, uint128 payout)
    {
        Bet storage bet = _bets[tokenId];

        account = ownerOf(tokenId);
        payout = viewPayout(tokenId);

        uint128 amount = bet.amount;
        bet.amount = 0;

        uint128 fullPayout = amount.mul(bet.odds).toUint128();
        uint128 reward = lp.addReserve(
            0,
            fullPayout - amount,
            fullPayout - payout,
            bet.leaf
        );

        affRewards[bet.affiliate] += reward;
    }

    /**
     * @notice Get information about BetExpress with ID 'betId'
     * @param  betId BetExpress token ID
     * @return betInfo BetExpress information
     */
    function getBet(uint256 betId) external view returns (Bet memory betInfo) {
        return _bets[betId];
    }

    /**
     * @notice Get BetExpress token ID `tokenId` payout.
     * @param  tokenId BetExpress token ID
     * @return payout of the token owner
     */
    function viewPayout(uint256 tokenId)
        public
        view
        virtual
        override
        returns (uint128)
    {
        Bet storage bet = _bets[tokenId];
        uint128 amount = bet.amount;
        SubBet[] storage subBets = bet.subBets;
        uint256 length = subBets.length;
        uint256 winningOdds = FixedMath.ONE;

        if (length == 0) revert BetNotExists();
        if (amount == 0) revert AlreadyResolved();

        for (uint256 i = 0; i < length; i++) {
            SubBet storage subBet = subBets[i];
            ICondition.Condition memory condition = core.getCondition(
                subBet.conditionId
            );

            if (condition.state == ICondition.ConditionState.RESOLVED) {
                if (condition.outcomeWin != subBet.outcomeId) {
                    // lose
                    return 0;
                } else {
                    // win
                    winningOdds = winningOdds.mul(bet.conditionOdds[i]);
                }
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

    /**
     * @notice Change odds on express' conditions proportionally to considered win payouts on them
     * @notice The purpose is to avoid value abuse
     */
    function _shiftOdds(
        uint256 expressOdds,
        uint256 oddsSum,
        uint128 amount,
        SubBet[] memory subBets,
        uint64[] memory conditionOdds,
        uint128[2][] memory virtualFunds,
        uint256[] memory outcomesIndexes
    ) internal {
        uint256 length = subBets.length;
        uint256 divider = oddsSum - length * FixedMath.ONE;
        uint256 smoothMultiplier = _smoothMultiplier(expressOdds);

        if (divider == 0) revert TooSmallOdds();

        for (uint256 i = 0; i < length; i++) {
            uint256 subWinPayout = amount.mul(conditionOdds[i] - FixedMath.ONE);
            uint256 index = outcomesIndexes[i];

            uint64 newOdds = CoreTools
                .calcOdds(
                    virtualFunds[i],
                    ((subWinPayout * smoothMultiplier) / divider).toUint128(),
                    index,
                    0
                )
                .toUint64();

            uint64[2] memory odds;

            uint64 oppositeOdds = newOdds
                .div(newOdds - FixedMath.ONE)
                .toUint64();

            odds[index] = newOdds;
            odds[1 - index] = oppositeOdds;

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

    function _checkOnlyLp() internal view {
        if (msg.sender != address(lp)) revert OnlyLp();
    }

    /**
     * @notice Get bookmaker commission value, adjusted by multiplier
     * The resulting margin is in (margin_; 2 * margin_)
     */
    function _calcMargin(uint256 margin_, uint256 odds)
        internal
        pure
        returns (uint256)
    {
        return margin_.mul(FixedMath.ONE + _smoothMultiplier(odds));
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
