// SPDX-License-Identifier: GPL-3.0
pragma solidity ^0.8.9;

import "../interface/ILP.sol";
import "../interface/IPrematchCore.sol";
import "../interface/IX2OrNothing.sol";
import "../libraries/FixedMath.sol";
import "../utils/OwnableUpgradeable.sol";
import "../utils/VRFConsumer.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@uniswap/lib/contracts/libraries/TransferHelper.sol";

/**
 * @title X2OrNothing
 * @notice This contract represents the implementation of the X2 or Nothing betting game.
 * If a player wins, their bet is increased, and if they lose, they lose their bet.
 */
contract X2OrNothing is VRFConsumer, OwnableUpgradeable, IX2OrNothing {
    using FixedMath for *;

    IPrematchCore public core;
    ILP public lp;

    address public payableToken;
    uint128 public lockedLiquidity; // Amount of liquidity locked in the contract
    uint128 public minBet; // Minimum bet amount
    uint64 public resultPeriod; // Time after which bets can be refunded
    uint64 public payoutMultiplier; // Payout multiplier for winning bets
    uint64 public margin; // Margin percentage

    mapping(address => Game) public games; // Mapping of player addresses to their games
    mapping(uint256 => address) public players; // Mapping of request IDs to player addresses

    /**
     * @notice See {IX2OrNothing-initialize}.
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
    ) external virtual initializer {
        __Ownable_init();
        __VRFConsumerBaseV2_init(vrf);

        core = IPrematchCore(core_);
        lp = core.lp();
        coordinator = VRFCoordinatorV2Interface(vrf);

        payableToken = lp.token();
        consumerId = consumerId_;
        keyHash = keyHash_;
        requestConfirmations = requestConfirmations_;
        callbackGasLimit = callbackGasLimit_;
        payoutMultiplier = payoutMultiplier_;
        margin = margin_;
        minBet = minBet_;
        resultPeriod = resultPeriod_;

        numWords = 1;
    }

    /**
     * @notice Changes the margin percentage
     * @param newMargin the new margin percentage
     */
    function changeMargin(uint64 newMargin) external onlyOwner {
        if (newMargin == 0 || newMargin > FixedMath.ONE)
            revert IncorrectMargin();
        margin = newMargin;
        emit MarginChanged(newMargin);
    }

    /**
     * @notice Changes the minimum bet amount
     * @param newMinBet the new minimum bet amount
     */
    function changeMinBet(uint128 newMinBet) external onlyOwner {
        if (newMinBet == 0) revert IncorrectMinBet();
        minBet = newMinBet;
        emit MinBetChanged(newMinBet);
    }

    /**
     * @notice Changes the payout multiplier
     * @param newPayoutMultiplier the new payout multiplier
     */
    function changePayoutMultiplier(
        uint64 newPayoutMultiplier
    ) external onlyOwner {
        if (newPayoutMultiplier == 0) revert IncorrectPayoutMultiplier();
        payoutMultiplier = newPayoutMultiplier;
        emit PayoutMultiplierChanged(newPayoutMultiplier);
    }

    /**
     * @notice Changes the result period in seconds
     * @param newResultPeriod the new result period in seconds
     */
    function changeResultPeriod(uint64 newResultPeriod) external onlyOwner {
        if (newResultPeriod == 0) revert IncorrectResultPeriod();
        resultPeriod = newResultPeriod;
        emit ResultPeriodChanged(newResultPeriod);
    }

    /**
     * @notice Changes the vrf
     * @param newVrf the new vrf coordinator
     * @param newConsumerId the new consumer id
     */
    function changeVrf(
        address newVrf,
        uint64 newConsumerId,
        uint16 newRequestConfirmations,
        bytes32 newKeyHash
    ) external onlyOwner {
        if (newVrf == address(0)) revert IncorrectVrf();
        if (newConsumerId == 0) revert IncorrectConsumerId();
        if (
            newRequestConfirmations < MINREQUESTCONFIRMATIONS ||
            newRequestConfirmations > MAXREQUESTCONFIRMATIONS
        ) revert IncorrectRequestConfirmations();

        coordinator = VRFCoordinatorV2Interface(newVrf);
        consumerId = newConsumerId;
        requestConfirmations = newRequestConfirmations;
        keyHash = newKeyHash;
        emit VrfChanged(
            newVrf,
            newConsumerId,
            newRequestConfirmations,
            newKeyHash
        );
    }

    /**
     * @notice Withdraws all available liquidity from the contact
     * @param to withdraw the liquidity to
     */
    function withdrawAllAvailableLiquidity(address to) public onlyOwner {
        uint128 availableLiquidity = getAvailableLiquidity();
        if (availableLiquidity == 0) revert ZeroLiquidity();

        TransferHelper.safeTransfer(payableToken, to, availableLiquidity);
        emit LiquidityWithdrawn(to, availableLiquidity);
    }

    /**
     * @notice Places a new bet
     * @param amount to bet
     */
    function bet(uint128 amount) external {
        TransferHelper.safeTransferFrom(
            payableToken,
            msg.sender,
            address(this),
            amount
        );

        _putBet(msg.sender, amount, BetType.COMMON);
    }

    /**
     * @notice Place a previous won bet amount
     */
    function betPayout() external {
        Game storage game = games[msg.sender];

        if (game.requestId == 0) revert GameNotExist();
        if (game.payout == 0) revert AwaitingVRF(game.requestId);

        uint128 amount = game.payout;

        _clearGame(game.requestId);

        _putBet(msg.sender, amount, BetType.PAYOUT);
    }

    /**
     * @notice Place a redeem bet amount
     * @param tokenId the ID of redeem nft
     */
    function betRedeem(uint256 tokenId) external {
        uint128 amount = core.viewPayout(tokenId);

        lp.withdrawPayout(address(core), tokenId);
        TransferHelper.safeTransferFrom(
            payableToken,
            msg.sender,
            address(this),
            amount
        );

        _putBet(msg.sender, amount, BetType.REDEEM);
    }

    /**
     * @notice Withdraw the payout for a won or refunded bet
     */
    function withdrawPayout() external {
        Game storage game = games[msg.sender];
        uint256 requestId = game.requestId;

        if (requestId == 0) revert GameNotExist();

        uint128 payout = _viewPayout(game);

        if (payout == 0) revert ZeroPayout();

        _clearGame(requestId);

        TransferHelper.safeTransfer(payableToken, msg.sender, payout);

        emit BetPayout(msg.sender, requestId, payout);
    }

    /**
     * @notice Returns the amount of available liquidity in the contract
     * @return the available liquidity amount
     */
    function getAvailableLiquidity() public view returns (uint128) {
        return
            uint128(
                IERC20(payableToken).balanceOf(address(this)) - lockedLiquidity
            );
    }

    /**
     * @notice Clears the user's current game
     * @param requestId the ID of the Chainlink request
     */
    function _clearGame(uint256 requestId) internal {
        address playerAddress = players[requestId];
        Game storage game = games[playerAddress];

        lockedLiquidity -= game.possiblePayout;

        delete players[requestId];
        delete games[playerAddress];
    }

    /**
     * @notice Fulfills the requested number of random words for the game's result
     * @param requestId the ID of the Chainlink request
     * @param randomWords_ the random words to fulfill the request
     */
    function fulfillRandomWords(
        uint256 requestId,
        uint256[] memory randomWords_
    ) internal override {
        address player = players[requestId];
        Game storage game = games[player];

        uint256 randomValue = (randomWords_[0] % FixedMath.ONE) + 1;
        uint128 payout;

        if (randomValue <= game.winProbability) {
            payout = game.possiblePayout;
        }

        emit GameResultFulfilled(requestId, player, game.amount, payout);

        if (payout != 0) {
            game.payout = payout;
        } else {
            _clearGame(requestId);
        }
    }

    /**
     * @notice Places a new bet
     * @param bettor the address of the bettor
     * @param amount the amount to bet
     * @param betType the bet type
     */
    function _putBet(address bettor, uint128 amount, BetType betType) internal {
        _checkBetAmount(amount);
        Game storage game = games[bettor];

        if (game.payout != 0) revert AwaitingWithdraw();
        if (game.requestId != 0) revert AwaitingVRF(game.requestId);

        uint256 requestId = requestRandomWords();

        uint128 possiblePayout = uint128(amount.mul(payoutMultiplier));
        uint256 winProbability = (FixedMath.ONE - margin).div(payoutMultiplier);

        lockedLiquidity += possiblePayout;
        games[bettor] = Game(
            requestId,
            winProbability,
            amount,
            possiblePayout,
            0,
            uint64(block.timestamp + resultPeriod)
        );
        players[requestId] = bettor;

        emit NewBet(bettor, requestId, amount, betType);
    }

    /**
     * @notice Checks if the specified bet amount is valid
     * @param amount the bet amount to check
     */
    function _checkBetAmount(uint128 amount) internal view {
        if (amount < minBet) revert SmallBet();

        if (getAvailableLiquidity() < amount.mul(payoutMultiplier))
            revert BetTooBig();
    }

    /**
     * @notice Returns the payout amount for a given bet amount and side
     * @param game the user's game
     * @return payout amount
     */
    function _viewPayout(
        Game storage game
    ) internal view returns (uint128 payout) {
        if (game.payout != 0) {
            payout = game.payout;
        } else if (game.refundAfter <= block.timestamp) {
            payout = game.amount;
        }
    }
}
