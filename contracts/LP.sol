// SPDX-License-Identifier: GPL-3.0

pragma solidity ^0.8.9;

import "./interface/IAccess.sol";
import "./interface/ICoreBase.sol";
import "./interface/ILP.sol";
import "./interface/IOwnable.sol";
import "./interface/IBet.sol";
import "./interface/ILiquidityManager.sol";
import "./libraries/FixedMath.sol";
import "./libraries/SafeCast.sol";
import "./utils/LiquidityTree.sol";
import "./utils/OwnableUpgradeable.sol";
import "@uniswap/lib/contracts/libraries/TransferHelper.sol";
import "@openzeppelin/contracts-upgradeable/token/ERC721/extensions/ERC721EnumerableUpgradeable.sol";

/// @title Azuro Liquidity Pool managing
contract LP is
    LiquidityTree,
    OwnableUpgradeable,
    ERC721EnumerableUpgradeable,
    ILP
{
    using FixedMath for *;
    using SafeCast for uint256;
    using SafeCast for uint128;

    IOwnable public factory;
    IAccess public access;

    address public token;
    address public dataProvider;

    uint128 public minDepo; // Minimum amount of liquidity deposit
    uint128 public lockedLiquidity; // Liquidity reserved by conditions

    uint64 public claimTimeout; // Withdraw reward timeout
    uint64 public withdrawTimeout; // Deposit-withdraw liquidity timeout

    mapping(address => CoreData) public cores;

    mapping(uint256 => Game) public games;

    uint64[3] public fees;

    mapping(address => Reward) public rewards;
    // withdrawAfter[depositId] = timestamp indicating when the liquidity deposit withdrawal will be available.
    mapping(uint48 => uint64) public withdrawAfter;
    mapping(address => uint128) private unusedVariable;

    ILiquidityManager public liquidityManager;

    address public affiliate;

    /**
     * @notice Check if Core `core` belongs to this Liquidity Pool and is active.
     */
    modifier isActive(address core) {
        _checkCoreActive(core);
        _;
    }

    /**
     * @notice Check if Core `core` belongs to this Liquidity Pool.
     */
    modifier isCore(address core) {
        checkCore(core);
        _;
    }

    /**
     * @notice Throw if caller is not the Pool Factory.
     */
    modifier onlyFactory() {
        if (msg.sender != address(factory)) revert OnlyFactory();
        _;
    }

    /**
     * @notice Throw if caller have no access to function with selector `selector`.
     */
    modifier restricted(bytes4 selector) {
        checkAccess(msg.sender, address(this), selector);
        _;
    }

    receive() external payable {
        require(msg.sender == token);
    }

    function initialize(
        address access_,
        address dataProvider_,
        address affiliate_,
        address token_,
        uint128 minDepo_,
        uint64 daoFee,
        uint64 dataProviderFee,
        uint64 affiliateFee
    ) external virtual override initializer {
        if (minDepo_ == 0) revert IncorrectMinDepo();

        __Ownable_init();
        __ERC721_init("Azuro LP NFT token", "LP-AZR");
        __liquidityTree_init();
        factory = IOwnable(msg.sender);
        access = IAccess(access_);
        dataProvider = dataProvider_;
        affiliate = affiliate_;
        token = token_;
        fees[0] = daoFee;
        fees[1] = dataProviderFee;
        fees[2] = affiliateFee;
        _checkFee();
        minDepo = minDepo_;
    }

    /**
     * @notice Owner: Set `newAffiliate` as Affiliate.
     */
    function changeAffiliate(address newAffiliate) external onlyOwner {
        affiliate = newAffiliate;
        emit AffiliateChanged(newAffiliate);
    }

    /**
     * @notice Owner: Set `newClaimTimeout` as claim timeout.
     */
    function changeClaimTimeout(uint64 newClaimTimeout) external onlyOwner {
        claimTimeout = newClaimTimeout;
        emit ClaimTimeoutChanged(newClaimTimeout);
    }

    /**
     * @notice Owner: Set `newDataProvider` as Data Provider.
     */
    function changeDataProvider(address newDataProvider) external onlyOwner {
        dataProvider = newDataProvider;
        emit DataProviderChanged(newDataProvider);
    }

    /**
     * @notice Owner: Set `newFee` as type `feeType` fee.
     * @param  newFee fee share where `FixedMath.ONE` is 100% of the Liquidity Pool profit
     */
    function changeFee(FeeType feeType, uint64 newFee) external onlyOwner {
        fees[uint256(feeType)] = newFee;
        _checkFee();
        emit FeeChanged(feeType, newFee);
    }

    /**
     * @notice Owner: Set `newLiquidityManager` as liquidity manager contract address.
     */
    function changeLiquidityManager(
        address newLiquidityManager
    ) external onlyOwner {
        liquidityManager = ILiquidityManager(newLiquidityManager);
        emit LiquidityManagerChanged(newLiquidityManager);
    }

    /**
     * @notice Owner: Set `newMinDepo` as minimum liquidity deposit.
     */
    function changeMinDepo(uint128 newMinDepo) external onlyOwner {
        if (newMinDepo == 0) revert IncorrectMinDepo();
        minDepo = newMinDepo;
        emit MinDepoChanged(newMinDepo);
    }

    /**
     * @notice Owner: Set `withdrawTimeout` as liquidity deposit withdrawal timeout.
     */
    function changeWithdrawTimeout(
        uint64 newWithdrawTimeout
    ) external onlyOwner {
        withdrawTimeout = newWithdrawTimeout;
        emit WithdrawTimeoutChanged(newWithdrawTimeout);
    }

    /**
     * @notice Owner: Update Core `core` settings.
     */
    function updateCoreSettings(
        address core,
        CoreState state,
        uint64 reinforcementAbility,
        uint128 minBet
    ) external onlyOwner isCore(core) {
        if (minBet == 0) revert IncorrectMinBet();
        if (reinforcementAbility > FixedMath.ONE)
            revert IncorrectReinforcementAbility();
        if (state == CoreState.UNKNOWN) revert IncorrectCoreState();

        CoreData storage coreData = cores[core];
        coreData.minBet = minBet;
        coreData.reinforcementAbility = reinforcementAbility;
        coreData.state = state;

        emit CoreSettingsUpdated(core, state, reinforcementAbility, minBet);
    }

    /**
     * @notice See {ILP-cancelGame}.
     */
    function cancelGame(
        uint256 gameId
    ) external restricted(this.cancelGame.selector) {
        Game storage game = _getGame(gameId);
        if (game.canceled) revert GameAlreadyCanceled();

        lockedLiquidity -= game.lockedLiquidity;
        game.canceled = true;
        emit GameCanceled(gameId);
    }

    /**
     * @notice See {ILP-createGame}.
     */
    function createGame(
        uint256 gameId,
        uint64 startsAt,
        bytes calldata data
    ) external restricted(this.createGame.selector) {
        Game storage game = games[gameId];
        if (game.startsAt > 0) revert GameAlreadyCreated();
        if (gameId == 0) revert IncorrectGameId();
        if (startsAt < block.timestamp) revert IncorrectTimestamp();

        game.startsAt = startsAt;

        emit NewGame(gameId, startsAt, data);
    }

    /**
     * @notice See {ILP-shiftGame}.
     */
    function shiftGame(
        uint256 gameId,
        uint64 startsAt
    ) external restricted(this.shiftGame.selector) {
        if (startsAt == 0) revert IncorrectTimestamp();
        _getGame(gameId).startsAt = startsAt;
        emit GameShifted(gameId, startsAt);
    }

    /**
     * @notice Deposit liquidity in the Liquidity Pool.
     * @notice Emits deposit token to `msg.sender`.
     * @param  amount The token's amount to deposit.
     * @param  data The additional data for processing in the Liquidity Manager contract.
     * @return depositId The deposit ID.
     */
    function addLiquidity(
        uint128 amount,
        bytes calldata data
    ) external returns (uint48 depositId) {
        if (amount < minDepo) revert SmallDepo();

        _deposit(amount);

        depositId = _nodeAddLiquidity(amount);

        if (address(liquidityManager) != address(0))
            liquidityManager.beforeAddLiquidity(
                msg.sender,
                depositId,
                amount,
                data
            );

        withdrawAfter[depositId] = uint64(block.timestamp) + withdrawTimeout;
        _mint(msg.sender, depositId);

        emit LiquidityAdded(msg.sender, depositId, amount);
    }

    /**
     * @notice Donate and share liquidity between liquidity deposits.
     * @param  amount The amount of liquidity to share between deposits.
     * @param  depositId The ID of the last deposit that shares the donation.
     */
    function donateLiquidity(uint128 amount, uint48 depositId) external {
        if (amount == 0) revert SmallDonation();
        if (depositId >= nextNode) revert DepositDoesNotExist();

        _deposit(amount);
        _addLimit(amount, depositId);

        emit LiquidityDonated(msg.sender, depositId, amount);
    }

    /**
     * @notice Withdraw payout for liquidity deposit.
     * @param  depositId The ID of the liquidity deposit.
     * @param  percent The payout share to withdraw, where `FixedMath.ONE` is 100% of the deposit balance.
     * @return withdrawnAmount The amount of withdrawn liquidity.
     */
    function withdrawLiquidity(
        uint48 depositId,
        uint40 percent
    ) external returns (uint128 withdrawnAmount) {
        uint64 time = uint64(block.timestamp);
        uint64 _withdrawAfter = withdrawAfter[depositId];
        if (time < _withdrawAfter)
            revert WithdrawalTimeout(_withdrawAfter - time);
        if (msg.sender != ownerOf(depositId)) revert LiquidityNotOwned();

        withdrawAfter[depositId] = time + withdrawTimeout;
        uint128 topNodeAmount = getReserve();
        uint128 balance = nodeWithdrawView(depositId);
        withdrawnAmount = _nodeWithdrawPercent(depositId, percent);

        if (address(liquidityManager) != address(0))
            liquidityManager.afterWithdrawLiquidity(
                depositId,
                nodeWithdrawView(depositId)
            );

        // burn the token if the deposit is fully withdrawn
        if (withdrawnAmount == balance) _burn(depositId);

        if (withdrawnAmount > 0) {
            // check withdrawAmount allowed in ("node #1" - "active condition reinforcements")
            if (withdrawnAmount > (topNodeAmount - lockedLiquidity))
                revert LiquidityIsLocked();

            _withdraw(msg.sender, withdrawnAmount);
        }
        emit LiquidityRemoved(msg.sender, depositId, withdrawnAmount);
    }

    /**
     * @notice Reward the Factory owner (DAO) or Data Provider with total amount of charged fees.
     * @return claimedAmount claimed reward amount
     */
    function claimReward() external returns (uint128 claimedAmount) {
        Reward storage reward = rewards[msg.sender];
        if ((block.timestamp - reward.claimedAt) < claimTimeout)
            revert ClaimTimeout(reward.claimedAt + claimTimeout);

        int128 rewardAmount = reward.amount;
        if (rewardAmount > 0) {
            reward.amount = 0;
            reward.claimedAt = uint64(block.timestamp);

            claimedAmount = uint128(rewardAmount);
            _withdraw(msg.sender, claimedAmount);
        }
    }

    /**
     * @notice Make new bet.
     * @notice Emits bet token to `msg.sender`.
     * @notice See {ILP-bet}.
     */
    function bet(
        address core,
        uint128 amount,
        uint64 expiresAt,
        IBet.BetData calldata betData
    ) external override returns (uint256) {
        _deposit(amount);
        return _bet(msg.sender, core, amount, expiresAt, betData);
    }

    /**
     * @notice Make new bet for `bettor`.
     * @notice Emits bet token to `bettor`.
     * @param  bettor wallet for emitting bet token
     * @param  core address of the Core the bet is intended
     * @param  amount amount of tokens to bet
     * @param  expiresAt the time before which bet should be made
     * @param  betData customized bet data
     */
    function betFor(
        address bettor,
        address core,
        uint128 amount,
        uint64 expiresAt,
        IBet.BetData calldata betData
    ) external override returns (uint256) {
        _deposit(amount);
        return _bet(bettor, core, amount, expiresAt, betData);
    }

    /**
     * @notice Core: Withdraw payout for bet token `tokenId` from the Core `core`.
     * @return amount The amount of withdrawn payout.
     */
    function withdrawPayout(
        address core,
        uint256 tokenId
    ) external override isCore(core) returns (uint128 amount) {
        address account;
        (account, amount) = IBet(core).resolvePayout(tokenId);
        if (amount > 0) _withdraw(account, amount);

        emit BettorWin(core, account, tokenId, amount);
    }

    /**
     * @notice Active Core: Check if Core `msg.sender` can create condition for game `gameId`.
     */
    function addCondition(
        uint256 gameId
    ) external view override isActive(msg.sender) returns (uint64) {
        Game storage game = _getGame(gameId);
        if (game.canceled) revert GameCanceled_();

        return game.startsAt;
    }

    /**
     * @notice Active Core: Change amount of liquidity reserved by the game `gameId`.
     * @param  gameId the game ID
     * @param  deltaReserve value of the change in the amount of liquidity used by the game as a reinforcement
     */
    function changeLockedLiquidity(
        uint256 gameId,
        int128 deltaReserve
    ) external override isActive(msg.sender) {
        if (deltaReserve > 0) {
            uint128 _deltaReserve = uint128(deltaReserve);
            if (gameId > 0) {
                games[gameId].lockedLiquidity += _deltaReserve;
            }

            CoreData storage coreData = _getCore(msg.sender);
            coreData.lockedLiquidity += _deltaReserve;
            lockedLiquidity += _deltaReserve;

            uint256 reserve = getReserve();
            if (
                lockedLiquidity > reserve ||
                coreData.lockedLiquidity >
                coreData.reinforcementAbility.mul(reserve)
            ) revert NotEnoughLiquidity();
        } else
            _reduceLockedLiquidity(msg.sender, gameId, uint128(-deltaReserve));
    }

    /**
     * @notice Factory: Indicate `core` as new active Core.
     */
    function addCore(address core) external override onlyFactory {
        CoreData storage coreData = _getCore(core);
        coreData.minBet = 1;
        coreData.reinforcementAbility = uint64(FixedMath.ONE);
        coreData.state = CoreState.ACTIVE;

        emit CoreSettingsUpdated(
            core,
            CoreState.ACTIVE,
            uint64(FixedMath.ONE),
            1
        );
    }

    /**
     * @notice Core: Finalize changes in the balance of Liquidity Pool
     *         after the game `gameId` condition's resolve.
     * @param  gameId the game ID
     * @param  lockedReserve amount of liquidity reserved by condition
     * @param  finalReserve amount of liquidity that was not demand according to the condition result
     * @param  depositId The ID of the last deposit that shares the income. In case of loss, all deposits bear the loss
     *         collectively.
     */
    function addReserve(
        uint256 gameId,
        uint128 lockedReserve,
        uint128 finalReserve,
        uint48 depositId
    ) external override isCore(msg.sender) {
        Reward storage daoReward = rewards[factory.owner()];
        Reward storage dataProviderReward = rewards[dataProvider];
        Reward storage affiliateReward = rewards[affiliate];

        if (finalReserve > lockedReserve) {
            uint128 profit = finalReserve - lockedReserve;
            // add profit to liquidity (reduced by dao/data provider/affiliates rewards)
            profit -= (_chargeReward(daoReward, profit, FeeType.DAO) +
                _chargeReward(
                    dataProviderReward,
                    profit,
                    FeeType.DATA_PROVIDER
                ) +
                _chargeReward(affiliateReward, profit, FeeType.AFFILIATES));

            _addLimit(profit, depositId);
        } else {
            // remove loss from liquidityTree excluding canceled conditions (when finalReserve = lockedReserve)
            if (lockedReserve - finalReserve > 0) {
                uint128 loss = lockedReserve - finalReserve;
                // remove all loss (reduced by data dao/data provider/affiliates losses) from liquidity
                loss -= (_chargeFine(daoReward, loss, FeeType.DAO) +
                    _chargeFine(
                        dataProviderReward,
                        loss,
                        FeeType.DATA_PROVIDER
                    ) +
                    _chargeFine(affiliateReward, loss, FeeType.AFFILIATES));

                _remove(loss);
            }
        }
        if (lockedReserve > 0)
            _reduceLockedLiquidity(msg.sender, gameId, lockedReserve);
    }

    /**
     * @notice Checks if the deposit token exists (not burned).
     */
    function isDepositExists(
        uint256 depositId
    ) external view override returns (bool) {
        return _exists(depositId);
    }

    /**
     * @notice Get the start time of the game `gameId` and whether it was canceled.
     */
    function getGameInfo(
        uint256 gameId
    ) external view override returns (uint64, bool) {
        Game storage game = games[gameId];
        return (game.startsAt, game.canceled);
    }

    /**
     * @notice Get the max amount of liquidity that can be locked by Core `core` conditions.
     */
    function getLockedLiquidityLimit(
        address core
    ) external view returns (uint128) {
        return uint128(_getCore(core).reinforcementAbility.mul(getReserve()));
    }

    /**
     * @notice Get the total amount of liquidity in the Pool.
     */
    function getReserve() public view returns (uint128 reserve) {
        return treeNode[1].amount;
    }

    /**
     * @notice Get the ID of the most recently made deposit.
     */
    function getLastDepositId()
        external
        view
        override
        returns (uint48 depositId)
    {
        return (nextNode - 1);
    }

    /**
     * @notice Check if game `gameId` is canceled.
     */
    function isGameCanceled(
        uint256 gameId
    ) external view override returns (bool) {
        return games[gameId].canceled;
    }

    /**
     * @notice Get bet token `tokenId` payout.
     * @param  core address of the Core where bet was placed
     * @param  tokenId bet token ID
     * @return payout winnings of the token owner
     */
    function viewPayout(
        address core,
        uint256 tokenId
    ) external view isCore(core) returns (uint128) {
        return IBet(core).viewPayout(tokenId);
    }

    /**
     * @notice Throw if `account` have no access to function with selector `selector` of `target`.
     */
    function checkAccess(
        address account,
        address target,
        bytes4 selector
    ) public {
        access.checkAccess(account, target, selector);
    }

    /**
     * @notice Throw if `core` not belongs to the Liquidity Pool's Cores.
     */
    function checkCore(address core) public view {
        if (_getCore(core).state == CoreState.UNKNOWN) revert UnknownCore();
    }

    /**
     * @notice Make new bet.
     * @param  bettor wallet for emitting bet token
     * @param  core address of the Core the bet is intended
     * @param  amount amount of tokens to bet
     * @param  expiresAt the time before which bet should be made
     * @param  betData customized bet data
     */
    function _bet(
        address bettor,
        address core,
        uint128 amount,
        uint64 expiresAt,
        IBet.BetData memory betData
    ) internal isActive(core) returns (uint256) {
        if (block.timestamp >= expiresAt) revert BetExpired();
        if (amount < _getCore(core).minBet) revert SmallBet();
        // owner is default affiliate
        if (betData.affiliate == address(0)) betData.affiliate = owner();
        return IBet(core).putBet(bettor, amount, betData);
    }

    /**
     * @dev Deduct a fine from a reward balance.
     * @param reward The reward from which the fine is deducted.
     * @param loss The loss used for calculating the fine.
     * @param feeType The fee type for calculating the fine.
     * @return _reduceDelta(reward.amount, _getShare(loss, feeType)) before reward balance changing.
     */
    function _chargeFine(
        Reward storage reward,
        uint128 loss,
        FeeType feeType
    ) internal returns (uint128) {
        int128 share = _getShare(loss, feeType);
        uint128 reduceDelta = _reduceDelta(reward.amount, share);
        reward.amount -= share;

        return reduceDelta;
    }

    /**
     * @notice Charge a reward to a reward balance.
     * @param reward The reward balance to which the reward is added.
     * @param profit The profit used for calculating the reward.
     * @param feeType The fee type for calculating the reward.
     * @return _addDelta(reward.amount, _getShare(loss, feeType)) before reward balance changing.
     */
    function _chargeReward(
        Reward storage reward,
        uint128 profit,
        FeeType feeType
    ) internal returns (uint128) {
        int128 share = _getShare(profit, feeType);
        uint128 addDelta = _addDelta(reward.amount, share);
        reward.amount += share;

        return addDelta;
    }

    /**
     * @notice Deposit `amount` of `token` tokens from `account` balance to the contract.
     */
    function _deposit(uint128 amount) internal {
        TransferHelper.safeTransferFrom(
            token,
            msg.sender,
            address(this),
            amount
        );
    }

    function _reduceLockedLiquidity(
        address core,
        uint256 gameId,
        uint128 deltaReserve
    ) internal {
        if (gameId > 0) {
            games[gameId].lockedLiquidity -= deltaReserve;
        }
        _getCore(core).lockedLiquidity -= deltaReserve;
        lockedLiquidity -= deltaReserve;
    }

    /**
     * @notice Withdraw `amount` of tokens to `account` balance.
     */
    function _withdraw(address account, uint128 amount) internal {
        TransferHelper.safeTransfer(token, account, amount);
    }

    /**
     * @notice Throw if `core` not belongs to the Liquidity Pool's active Cores.
     */
    function _checkCoreActive(address core) internal view {
        if (_getCore(core).state != CoreState.ACTIVE) revert CoreNotActive();
    }

    /**
     * @notice Throw if set fees are incorrect.
     */
    function _checkFee() internal view {
        if (
            _getFee(FeeType.DAO) +
                _getFee(FeeType.DATA_PROVIDER) +
                _getFee(FeeType.AFFILIATES) >
            FixedMath.ONE
        ) revert IncorrectFee();
    }

    function _getCore(address core) internal view returns (CoreData storage) {
        return cores[core];
    }

    /**
     * @notice Get current fee type `feeType` profit share.
     */
    function _getFee(FeeType feeType) internal view returns (uint64) {
        return fees[uint256(feeType)];
    }

    /**
     * @notice Get game by it's ID.
     */
    function _getGame(uint256 gameId) internal view returns (Game storage) {
        Game storage game = games[gameId];
        if (game.startsAt == 0) revert GameNotExists();

        return game;
    }

    function _getShare(
        uint128 amount,
        FeeType feeType
    ) internal view returns (int128) {
        return _getFee(feeType).mul(amount).toUint128().toInt128();
    }

    /**
     * @notice Calculate the positive delta between `a` and `a + b`.
     */
    function _addDelta(int128 a, int128 b) internal pure returns (uint128) {
        if (a < 0) {
            int128 c = a + b;
            return (c > 0) ? uint128(c) : 0;
        } else return uint128(b);
    }

    /**
     * @notice Calculate the positive delta between `a - b` and `a`.
     */
    function _reduceDelta(int128 a, int128 b) internal pure returns (uint128) {
        return (a < 0 ? 0 : uint128(a > b ? b : a));
    }
}
