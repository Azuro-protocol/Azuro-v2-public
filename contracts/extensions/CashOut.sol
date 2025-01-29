// SPDX-License-Identifier: GPL-3.0

pragma solidity ^0.8.9;

import "../interface/IBet.sol";
import "../interface/IBetExpress.sol";
import "../interface/ICoreBase.sol";
import "../libraries/FixedMath.sol";
import "../utils/OwnableUpgradeable.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC721/IERC721.sol";
import "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import "@openzeppelin/contracts-upgradeable/security/PausableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/cryptography/EIP712Upgradeable.sol";
import "@uniswap/lib/contracts/libraries/TransferHelper.sol";

interface Core {
    function bets(uint256) external view returns (ICoreBase.Bet memory);
}

interface ICashOut {
    struct CashOutOrder {
        string attention;
        uint256 chainId;
        CashOutItem[] items;
        uint64 expiresAt;
    }

    struct CashOutItem {
        uint256 betId;
        address bettingContract;
        uint64 minOdds;
    }

    event BetCashedOut(
        address indexed bettingContract,
        address indexed betOwner,
        uint256 betId,
        uint64 odds,
        uint256 payout
    );
    event BettingContractUpdated(address bettingContract, address betToken);
    event OracleUpdated(address account, bool isOracle);

    error BetAlreadyPaid();
    error BetAlreadyResolved();
    error BetOwnerSignatureExpired();
    error BettingContractNotAllowed();
    error InsufficientBalance();
    error InvalidBetOwnerSignature();
    error InvalidChainId();
    error InvalidOdds();
    error InvalidOddsCount();
    error InvalidOracleSignature();
    error NothingChanged();

    function pause() external;

    function unpause() external;

    function updateBettingContract(
        address bettingContract,
        address betToken
    ) external;

    function updateOracle(address account, bool isOracle_) external;

    function withdrawToken(address token, address to, uint256 value) external;

    function cashOutBets(
        CashOutOrder calldata order,
        uint64[] calldata odds,
        bytes calldata betOwnerSignature,
        bytes calldata oracleSignature
    ) external;
}

/**
 * @title CashOut: Enables users to cash out their bets by signatures.
 */
contract CashOut is
    OwnableUpgradeable,
    PausableUpgradeable,
    EIP712Upgradeable,
    ICashOut
{
    using FixedMath for *;
    using ECDSA for bytes32;

    mapping(address => address) public betTokens;
    mapping(address => bool) public isOracle;

    IERC20 public payoutToken;

    function initialize(IERC20 payoutToken_) external initializer {
        __Ownable_init();
        __Pausable_init();
        __EIP712_init("Cash Out", "1.0.0");
        payoutToken = payoutToken_;
    }

    /**
     * @notice Owner: Pauses the contract, disabling cashing out bets.
     */
    function pause() external onlyOwner {
        _pause();
    }

    /**
     * @notice Owner: Unpauses the contract, enabling previously disabled cashing out bets.
     */
    function unpause() external onlyOwner {
        _unpause();
    }

    /**
     * @notice Owner: Updates the betting engine and its associated bet token.
     * @notice Set the bet token address to 0x0 to disable the betting engine.
     * @param bettingContract The address of the betting engine.
     * @param betToken The address of the bet token.
     */
    function updateBettingContract(
        address bettingContract,
        address betToken
    ) external onlyOwner {
        if (betTokens[bettingContract] == betToken) revert NothingChanged();

        betTokens[bettingContract] = betToken;

        emit BettingContractUpdated(bettingContract, betToken);
    }

    /**
     * @notice Owner: Updates the oracle status for a specific account.
     * @param account The address of the account.
     * @param isOracle_ Whether the account is an oracle (true or false).
     */
    function updateOracle(address account, bool isOracle_) external onlyOwner {
        if (isOracle[account] == isOracle_) revert NothingChanged();

        isOracle[account] = isOracle_;

        emit OracleUpdated(account, isOracle_);
    }

    /**
     * @notice Owner: Withdraws tokens from the contract.
     * @param token The address of the token to withdraw.
     * @param to The address to send the withdrawn tokens.
     * @param value The amount of tokens to withdraw.
     */
    function withdrawToken(
        address token,
        address to,
        uint256 value
    ) external onlyOwner {
        TransferHelper.safeTransfer(address(token), to, value);
    }

    /**
     * @notice Processes multiple cash-out requests for bets belonging to a single owner.
     * @param order The `CashOutOrder` struct containing:
     *  - `attention`: Additional information or comments.
     *  - `chainId`: The ID of the blockchain where the bets were placed.
     *  - `items`: An array of `CashOutItem` structs, each representing a bet to be cashed out.
     *    Each item includes:
     *      - `betId`: The ID of the bet to be cashed out.
     *      - `bettingContract`: The address of the betting engine contract where the bet is placed.
     *      - `minOdds`: The minimum odds allowed for cashing out the bet.
     *  - `expiresAt`: The timestamp after which the cash-out order is no longer valid.
     * @param odds An array of odds at the time of cash-out, corresponding to each item in the `order.items` array.
     * @param betOwnerSignature The signature of the bet owner authorizing the cash-out.
     * @param oracleSignature The signature of an authorized oracle.
     */
    function cashOutBets(
        CashOutOrder calldata order,
        uint64[] calldata odds,
        bytes calldata betOwnerSignature,
        bytes calldata oracleSignature
    ) external whenNotPaused {
        if (order.chainId != block.chainid) revert InvalidChainId();
        if (order.expiresAt <= block.timestamp)
            revert BetOwnerSignatureExpired();

        uint256 numOfItems = order.items.length;
        if (odds.length == 0 || odds.length != numOfItems)
            revert InvalidOddsCount();

        address oracle = keccak256(abi.encode(order, odds, betOwnerSignature))
            .toEthSignedMessageHash()
            .recover(oracleSignature);
        if (!isOracle[oracle]) revert InvalidOracleSignature();

        bytes32 digest = _hashTypedDataV4(_hashCashOutOrder(order));
        address betOwner = digest.recover(betOwnerSignature);

        uint256 payout;
        for (uint256 i; i < numOfItems; ++i) {
            payout += _processCashOut(betOwner, order.items[i], odds[i]);
        }

        if (payout > payoutToken.balanceOf(address(this)))
            revert InsufficientBalance();

        TransferHelper.safeTransfer(address(payoutToken), betOwner, payout);
    }

    /**
     * @notice Processes a cash-out request for a specific bet.
     * @param betOwner The address of the bet owner.
     * @param item The `CashOutItem` struct containing:
     *  - `betId`: The ID of the bet to be cashed out.
     *  - `bettingContract`: The address of the betting engine contract where the bet is registered.
     *  - `minOdds`: The minimum allowed odds for the cash-out.
     * @param odds The odds at the time of cash-out, which must meet or exceed the `minOdds`.
     * @return payout The calculated payout amount for the bet cash-out.
     */
    function _processCashOut(
        address betOwner,
        CashOutItem calldata item,
        uint64 odds
    ) internal returns (uint256 payout) {
        if (odds < item.minOdds) revert InvalidOdds();

        address betToken = betTokens[item.bettingContract];
        if (betToken == address(0)) revert BettingContractNotAllowed();
        if (betOwner != IERC721(betToken).ownerOf(item.betId))
            revert InvalidBetOwnerSignature();

        try IBet(item.bettingContract).viewPayout(item.betId) {
            revert BetAlreadyResolved();
        } catch (bytes memory error) {
            if (bytes4(error) == IBet.AlreadyPaid.selector) {
                revert BetAlreadyPaid();
            }
        }

        uint128 betAmount;
        if (item.bettingContract == betToken) {
            IBetExpress.Bet memory bet = IBetExpress(item.bettingContract)
                .getBet(item.betId);
            betAmount = bet.amount;
        } else {
            ICoreBase.Bet memory bet = Core(item.bettingContract).bets(
                item.betId
            );
            betAmount = bet.amount;
        }

        payout = betAmount.mul(odds);

        IERC721(betToken).transferFrom(betOwner, address(this), item.betId);

        emit BetCashedOut(
            item.bettingContract,
            betOwner,
            item.betId,
            odds,
            payout
        );
    }

    function _hashCashOutOrder(
        CashOutOrder calldata order
    ) internal pure returns (bytes32) {
        uint256 numOfItems = order.items.length;
        bytes32[] memory itemsHashes = new bytes32[](numOfItems);
        for (uint256 i = 0; i < numOfItems; ++i) {
            itemsHashes[i] = _hashCashOutItem(order.items[i]);
        }

        return
            keccak256(
                abi.encode(
                    keccak256(
                        "CashOutOrder(string attention,uint256 chainId,CashOutItem[] items,uint64 expiresAt)CashOutItem(uint256 betId,address bettingContract,uint64 minOdds)"
                    ),
                    keccak256(bytes(order.attention)),
                    order.chainId,
                    keccak256(abi.encodePacked(itemsHashes)),
                    order.expiresAt
                )
            );
    }

    function _hashCashOutItem(
        CashOutItem calldata item
    ) internal pure returns (bytes32) {
        return
            keccak256(
                abi.encode(
                    keccak256(
                        "CashOutItem(uint256 betId,address bettingContract,uint64 minOdds)"
                    ),
                    item.betId,
                    item.bettingContract,
                    item.minOdds
                )
            );
    }
}
