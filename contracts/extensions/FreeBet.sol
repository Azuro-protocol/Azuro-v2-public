// SPDX-License-Identifier: GPL-3.0
pragma solidity ^0.8.9;

import "../interface/IAccess.sol";
import "../interface/ILP.sol";
import "../interface/IOwnable.sol";
import "../utils/OwnableUpgradeable.sol";
import "@openzeppelin/contracts/proxy/beacon/BeaconProxy.sol";
import "@openzeppelin/contracts/proxy/beacon/UpgradeableBeacon.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import "@uniswap/lib/contracts/libraries/TransferHelper.sol";

interface IFreeBet is IOwnable {
    struct FreeBet_ {
        address owner;
        address core;
        uint256 azuroBetId;
        uint128 amount;
        uint128 payout;
    }

    struct FreeBetData {
        uint256 chainId;
        uint256 freeBetId;
        address owner;
        uint128 amount;
        uint64 minOdds;
        uint64 expiresAt;
    }

    event AffiliateChanged(address newAffiliate);
    event BettorWin(
        address indexed core,
        address indexed bettor,
        uint256 indexed freeBetId,
        uint256 amount
    );
    event NewBet(
        uint256 indexed freeBetId,
        address core,
        address indexed bettor,
        uint256 indexed azuroBetId,
        uint128 amount,
        uint64 minOdds,
        uint64 expiresAt
    );
    event LpChanged(address indexed newLp);
    event ManagerChanged(address newManager);
    event PayoutsResolved(uint256[] azuroBetId);

    error AlreadyResolved();
    error BetAlreadyClaimed();
    error BetDoesNotExist();
    error BetExpired();
    error InsufficientContractBalance();
    error IncorrectChainId();
    error InvalidSignature();
    error OnlyFreeBetOwner();
    error OnlyManager();
    error SmallMinOdds();

    function initialize(
        address lpAddress,
        address affiliate,
        address manager
    ) external;
}

/// @title This tool enables the granting of free bets to any user through an airdrop distribution using a Merkle tree.
contract FreeBet is OwnableUpgradeable, IFreeBet {
    using ECDSA for bytes32;

    mapping(uint256 => FreeBet_) public freeBets;

    uint256 public lockedReserve;

    address public affiliate;
    address public manager;
    address public token;

    ILP public lp;

    /**
     * @notice Throw if caller is not a Manager.
     */
    modifier onlyManager() {
        if (msg.sender != manager) revert OnlyManager();
        _;
    }

    receive() external payable {
        require(msg.sender == token);
    }

    function initialize(
        address lpAddress,
        address affiliate_,
        address manager_
    ) external initializer {
        __Ownable_init();

        ILP lp_ = ILP(lpAddress);
        token = lp_.token();
        lp = lp_;
        affiliate = affiliate_;
        manager = manager_;
    }

    /**
     * @notice Owner: Set affiliate address for each bet made through free bet redeem.
     */
    function setAffiliate(address affiliate_) external onlyOwner {
        affiliate = affiliate_;
        emit AffiliateChanged(affiliate_);
    }

    /**
     * @notice Owner: Bound the contract with Liquidity Pool 'lp'.
     */
    function setLp(address lp_) external onlyOwner {
        lp = ILP(lp_);
        emit LpChanged(lp_);
    }

    /**
     * @notice Owner: Set a manager. The manager is responsible for issuing new free bets and withdrawing funds locked
     *         in the smart contract
     */
    function setManager(address manager_) external onlyOwner {
        manager = manager_;
        emit ManagerChanged(manager_);
    }

    /**
     * @notice Withdraw unlocked token reserves.
     * @param  amount amount to withdraw
     */
    function withdrawReserve(uint256 amount) external onlyManager {
        _checkInsufficient(amount);

        TransferHelper.safeTransfer(token, msg.sender, amount);
    }

    /**
     * @notice Make free bet.
     * @notice See {ILP-bet}.
     * @param  freeBetData the Manager's response that contains the free bet data as well as additional
     *         data necessary to ensure that the manager's signature will not be reused for another bet.
     * @param  signature the Manager's signature on `freeBetData`.
     * @return azuroBetId Minted AzuroBet token ID
     */
    function bet(
        FreeBetData calldata freeBetData,
        bytes memory signature,
        address core,
        uint256 conditionId,
        uint64 outcomeId,
        uint64 deadline,
        uint64 minOdds
    ) external returns (uint256 azuroBetId) {
        _verifySignature(freeBetData, signature);
        _checkInsufficient(freeBetData.amount);

        FreeBet_ storage freeBet = freeBets[freeBetData.freeBetId];
        if (freeBetData.chainId != _getChainId()) revert IncorrectChainId();
        if (freeBetData.owner != msg.sender) revert OnlyFreeBetOwner();
        if (freeBetData.expiresAt <= block.timestamp) revert BetExpired();
        if (freeBet.owner != address(0)) revert BetAlreadyClaimed();
        if (minOdds < freeBetData.minOdds) revert SmallMinOdds();

        freeBet.owner = msg.sender;
        freeBet.core = core;
        freeBet.amount = freeBetData.amount;

        TransferHelper.safeApprove(token, address(lp), freeBetData.amount);
        azuroBetId = lp.bet(
            core,
            freeBetData.amount,
            deadline,
            IBet.BetData(affiliate, minOdds, abi.encode(conditionId, outcomeId))
        );
        freeBet.azuroBetId = azuroBetId;

        emit NewBet(
            freeBetData.freeBetId,
            core,
            msg.sender,
            azuroBetId,
            freeBetData.amount,
            freeBetData.minOdds,
            freeBetData.expiresAt
        );
    }

    /**
     * @notice Resolve the payout for already redeemed free bets with IDs `freeBetIds`.
     */
    function resolvePayout(uint256[] calldata freeBetIds) external {
        uint256 length = freeBetIds.length;
        for (uint256 i = 0; i < length; ++i) {
            uint256 freeBetId = freeBetIds[i];
            uint256 payout = _resolvePayout(freeBetId);
            freeBets[freeBetId].payout = uint128(payout);
            lockedReserve += payout;
        }
        emit PayoutsResolved(freeBetIds);
    }

    /**
     * @notice Withdraw the payout for already redeemed free bet with ID `freeBetId`.
     */
    function withdrawPayout(uint256 freeBetId) external {
        FreeBet_ storage freeBet = freeBets[freeBetId];
        address bettor = freeBet.owner;
        if (bettor == address(0)) revert BetDoesNotExist();

        uint256 payout;
        if (freeBet.amount == 0) {
            // was resolved
            payout = freeBet.payout;
            if (payout > 0) {
                freeBet.payout = 0;
                lockedReserve -= payout;
            }
        } else {
            // was not resolved
            payout = _resolvePayout(freeBetId);
        }

        if (payout > 0) TransferHelper.safeTransfer(token, bettor, payout);

        emit BettorWin(freeBet.core, bettor, freeBetId, payout);
    }

    /**
     * @notice Resolve the payout for already redeemed free bet with ID `freeBetId`.
     */
    function _resolvePayout(
        uint256 freeBetId
    ) internal returns (uint256 payout) {
        FreeBet_ storage freeBet = freeBets[freeBetId];
        uint256 betAmount = freeBet.amount;
        if (betAmount == 0) revert AlreadyResolved();

        freeBet.amount = 0;
        uint256 fullPayout = lp.withdrawPayout(
            freeBet.core,
            freeBet.azuroBetId
        );

        payout = (fullPayout > betAmount) ? (fullPayout - betAmount) : 0;
    }

    /**
     * @notice Gets the current chain ID.
     * @return The chain ID.
     */
    function _getChainId() internal view returns (uint256) {
        uint256 chainId;
        assembly {
            chainId := chainid()
        }
        return chainId;
    }

    /**
     * @notice Verifies the signature of the oracle response.
     * @param freeBetData The manager response to be verified.
     * @param signature The signature to be validated.
     */
    function _verifySignature(
        FreeBetData memory freeBetData,
        bytes memory signature
    ) internal view {
        bytes32 message = keccak256(abi.encode(freeBetData));
        bytes32 hash = message.toEthSignedMessageHash();
        address signer = hash.recover(signature);

        if (manager != signer) revert InvalidSignature();
    }

    /**
     * @notice Throw if the contract free reserves of tokens `tokens` are less than `amount`.
     */
    function _checkInsufficient(uint256 amount) internal view {
        if (IERC20(token).balanceOf(address(this)) < lockedReserve + amount)
            revert InsufficientContractBalance();
    }
}

/// @title Azuro FreeBet contract factory.
contract FreeBetFactory is OwnableUpgradeable {
    address public freeBetBeacon;
    IAccess public access;

    event NewFreeBet(
        address indexed freeBetAddress,
        address indexed lpAddress,
        address affiliate,
        address manager
    );

    /**
     * @notice Throw if caller have no access to function with selector `selector`.
     */
    modifier restricted(bytes4 selector) {
        access.checkAccess(msg.sender, address(this), selector);
        _;
    }

    function initialize(address accessAddress) external initializer {
        __Ownable_init();

        access = IAccess(accessAddress);

        UpgradeableBeacon freeBetBeacon_ = new UpgradeableBeacon(
            address(new FreeBet())
        );
        freeBetBeacon_.transferOwnership(msg.sender);
        freeBetBeacon = address(freeBetBeacon_);
    }

    /**
     * @notice Deploy a new FreeBet contract.
     * @param lpAddress Liquidity Pool's address for which FreeBets will be issued.
     * @param affiliate Address to be used as the affiliate address in minted FreeBets.
     * @param manager Address that manages the FreeBets.
     */
    function createFreeBet(
        address lpAddress,
        address affiliate,
        address manager
    ) external restricted(this.createFreeBet.selector) {
        address freeBetAddress = address(new BeaconProxy(freeBetBeacon, ""));
        IFreeBet freeBet = IFreeBet(freeBetAddress);
        freeBet.initialize(lpAddress, affiliate, manager);
        freeBet.transferOwnership(msg.sender);

        emit NewFreeBet(freeBetAddress, lpAddress, affiliate, manager);
    }
}
