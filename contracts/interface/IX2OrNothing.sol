// SPDX-License-Identifier: GPL-3.0
pragma solidity ^0.8.9;

import "./IOwnable.sol";

interface IX2OrNothing is IOwnable {
    /**
     * @dev This enum represents a bet type.
     */
    enum BetType {
        COMMON,
        PAYOUT,
        REDEEM
    }

    /**
     * @dev This struct represents a single game played by a player.
     */
    struct Game {
        uint256 requestId; // Request ID of Chainlink request
        uint256 winProbability; // Probability of winning
        uint128 amount; // Amount of the bet
        uint128 possiblePayout; // Amount of the potential payout
        uint128 payout; // Amount of the actual payout
        uint64 refundAfter; // Refund date
    }

    event GameResultFulfilled(
        uint256 indexed requestId,
        address indexed player,
        uint128 amount,
        uint128 payout
    );
    event LiquidityWithdrawn(address indexed user, uint128 amount);

    event NewBet(
        address indexed player,
        uint256 indexed requestId,
        uint128 amount,
        BetType betType
    );
    event BetPayout(
        address indexed player,
        uint256 indexed requestId,
        uint128 payout
    );

    event MarginChanged(uint64 newMargin);
    event PayoutMultiplierChanged(uint64 newPayoutMultiplier);
    event MinBetChanged(uint128 newMinBet);
    event ResultPeriodChanged(uint64 newResultPeriod);
    event VrfChanged(
        address indexed newVrf,
        uint64 newCondumerId,
        uint16 newRequestConfirmations,
        bytes32 newKeyHash
    );

    error AwaitingVRF(uint256 requestID);
    error AwaitingWithdraw();
    error GameNotExist();

    error IncorrectConsumerId();
    error IncorrectMargin();
    error IncorrectMinBet();
    error IncorrectResultPeriod();
    error IncorrectPayoutMultiplier();
    error IncorrectVrf();
    error IncorrectRequestConfirmations();

    error BetTooBig();
    error SmallBet();
    error ZeroPayout();
    error ZeroLiquidity();

    /**
     * @dev Initializes the contract
     * @param core_ address of the IPrematchCoreExtended contract
     * @param vrf address of the VRF coordinator contract
     * @param consumerId_ consumer ID used for VRF requests
     * @param keyHash_ key hash used for VRF requests
     * @param requestConfirmations_ number of VRF request confirmations
     * @param callbackGasLimit_ gas limit for VRF request callbacks
     * @param payoutMultiplier_ payout multiplier for winning bets
     * @param margin_ margin percentage
     * @param minBet_ minimum bet amount
     * @param resultPeriod_ time after which bets can be refunded
     */
    function initialize(
        address core_,
        address vrf,
        uint64 consumerId_,
        bytes32 keyHash_,
        uint16 requestConfirmations_,
        uint32 callbackGasLimit_,
        uint64 payoutMultiplier_,
        uint64 margin_,
        uint128 minBet_,
        uint64 resultPeriod_
    ) external;

    function changeMargin(uint64 newMargin) external;

    function changePayoutMultiplier(uint64 newPayoutMultiplier) external;

    function changeMinBet(uint128 newMinBet) external;

    function changeResultPeriod(uint64 newResultPeriod) external;

    function changeVrf(
        address newVrf,
        uint64 newConsumerId,
        uint16 newRequestConfirmations,
        bytes32 newKeyHash
    ) external;

    function betPayout() external;

    function betRedeem(uint256 tokenId) external;

    function bet(uint128 amount) external;

    function withdrawPayout() external;
}
