// SPDX-License-Identifier: GPL-3.0

pragma solidity ^0.8.9;

import "./IBet.sol";
import "./IOwnable.sol";
import "@openzeppelin/contracts-upgradeable/token/ERC721/extensions/IERC721EnumerableUpgradeable.sol";

interface ILP is IOwnable, IERC721EnumerableUpgradeable {
    enum FeeType {
        DAO,
        DATA_PROVIDER,
        AFFILIATES
    }

    enum CoreState {
        UNKNOWN,
        ACTIVE,
        INACTIVE
    }

    struct Condition {
        address core;
        uint256 conditionId;
    }

    struct CoreData {
        CoreState state;
        uint64 reinforcementAbility;
        uint128 minBet;
        uint128 lockedLiquidity;
    }

    struct Game {
        bytes32 unusedVariable;
        uint128 lockedLiquidity;
        uint64 startsAt;
        bool canceled;
    }

    struct Reward {
        int128 amount;
        uint64 claimedAt;
    }

    event CoreSettingsUpdated(
        address indexed core,
        CoreState state,
        uint64 reinforcementAbility,
        uint128 minBet
    );

    event AffiliateChanged(address newAffilaite);
    event BettorWin(
        address indexed core,
        address indexed bettor,
        uint256 tokenId,
        uint256 amount
    );
    event ClaimTimeoutChanged(uint64 newClaimTimeout);
    event DataProviderChanged(address newDataProvider);
    event FeeChanged(FeeType feeType, uint64 fee);
    event GameCanceled(uint256 indexed gameId);
    event GameShifted(uint256 indexed gameId, uint64 newStart);
    event LiquidityAdded(
        address indexed account,
        uint48 indexed depositId,
        uint256 amount
    );
    event LiquidityDonated(
        address indexed account,
        uint48 indexed depositId,
        uint256 amount
    );
    event LiquidityManagerChanged(address newLiquidityManager);
    event LiquidityRemoved(
        address indexed account,
        uint48 indexed depositId,
        uint256 amount
    );
    event MinBetChanged(address core, uint128 newMinBet);
    event MinDepoChanged(uint128 newMinDepo);
    event NewGame(uint256 indexed gameId, uint64 startsAt, bytes data);
    event ReinforcementAbilityChanged(uint128 newReinforcementAbility);
    event WithdrawTimeoutChanged(uint64 newWithdrawTimeout);

    error OnlyFactory();

    error SmallDepo();
    error SmallDonation();

    error BetExpired();
    error CoreNotActive();
    error ClaimTimeout(uint64 waitTime);
    error DepositDoesNotExist();
    error GameAlreadyCanceled();
    error GameAlreadyCreated();
    error GameCanceled_();
    error GameNotExists();
    error IncorrectCoreState();
    error IncorrectFee();
    error IncorrectGameId();
    error IncorrectMinBet();
    error IncorrectMinDepo();
    error IncorrectReinforcementAbility();
    error IncorrectTimestamp();
    error LiquidityNotOwned();
    error LiquidityIsLocked();
    error NoLiquidity();
    error NotEnoughLiquidity();
    error SmallBet();
    error UnknownCore();
    error WithdrawalTimeout(uint64 waitTime);

    function initialize(
        address access,
        address dataProvider,
        address affiliate,
        address token,
        uint128 minDepo,
        uint64 daoFee,
        uint64 dataProviderFee,
        uint64 affiliateFee
    ) external;

    function addCore(address core) external;

    function addLiquidity(
        uint128 amount,
        bytes calldata data
    ) external returns (uint48);

    function withdrawLiquidity(
        uint48 depositId,
        uint40 percent
    ) external returns (uint128);

    function viewPayout(
        address core,
        uint256 tokenId
    ) external view returns (uint128 payout);

    function betFor(
        address bettor,
        address core,
        uint128 amount,
        uint64 expiresAt,
        IBet.BetData calldata betData
    ) external returns (uint256 tokenId);

    /**
     * @notice Make new bet.
     * @notice Emits bet token to `msg.sender`.
     * @param  core address of the Core the bet is intended
     * @param  amount amount of tokens to bet
     * @param  expiresAt the time before which bet should be made
     * @param  betData customized bet data
     */
    function bet(
        address core,
        uint128 amount,
        uint64 expiresAt,
        IBet.BetData calldata betData
    ) external returns (uint256 tokenId);

    function changeDataProvider(address newDataProvider) external;

    function claimReward() external returns (uint128);

    function getReserve() external view returns (uint128);

    function addReserve(
        uint256 gameId,
        uint128 lockedReserve,
        uint128 profitReserve,
        uint48 depositId
    ) external;

    function addCondition(uint256 gameId) external view returns (uint64);

    function withdrawPayout(
        address core,
        uint256 tokenId
    ) external returns (uint128);

    function changeLockedLiquidity(
        uint256 gameId,
        int128 deltaReserve
    ) external;

    /**
     * @notice Indicate the game `gameId` as canceled.
     * @param  gameId the game ID
     */
    function cancelGame(uint256 gameId) external;

    /**
     * @notice Create new game.
     * @param  gameId the match or condition ID according to oracle's internal numbering
     * @param  startsAt timestamp when the game starts
     * @param  data the additional data to emit in the `NewGame` event
     */
    function createGame(
        uint256 gameId,
        uint64 startsAt,
        bytes calldata data
    ) external;

    /**
     * @notice Set `startsAt` as new game `gameId` start time.
     * @param  gameId the game ID
     * @param  startsAt new timestamp when the game starts
     */
    function shiftGame(uint256 gameId, uint64 startsAt) external;

    function getGameInfo(
        uint256 gameId
    ) external view returns (uint64 startsAt, bool canceled);

    function getLockedLiquidityLimit(
        address core
    ) external view returns (uint128);

    function isGameCanceled(
        uint256 gameId
    ) external view returns (bool canceled);

    function checkAccess(
        address account,
        address target,
        bytes4 selector
    ) external;

    function checkCore(address core) external view;

    function getLastDepositId() external view returns (uint48 depositId);

    function isDepositExists(uint256 depositId) external view returns (bool);

    function token() external view returns (address);

    function fees(uint256) external view returns (uint64);
}
