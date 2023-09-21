// SPDX-License-Identifier: GPL-3.0

pragma solidity ^0.8.9;

import "../interface/ILiquidityManager.sol";
import "../interface/IStaking.sol";
import "../libraries/FixedMath.sol";
import "../utils/OwnableUpgradeable.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import "@uniswap/lib/contracts/libraries/TransferHelper.sol";

/**
 * @title  Staking - a smart contract for staking tokens and earning interest over a specified staking period.
 */
contract Staking is OwnableUpgradeable, IStaking {
    using FixedMath for *;

    uint48 public constant STAKING_PERIOD = 31536000; // One year

    mapping(uint256 => Stake) public stakes;

    uint256 public lastStakeId;
    uint256 public lockedReserve;
    address public token;
    uint64 public interestRate;

    /**
     * @notice Initializes the Staking contract.
     * @param  token_ The address of the token being staked.
     * @param  interestRate_ The interest rate for staking.
     */
    function initialize(address token_, uint64 interestRate_)
        external
        initializer
    {
        __Ownable_init();
        token = token_;
        interestRate = interestRate_;
    }

    /**
     * @notice Owner: Sets the new interest rate for staking.
     * @param  newInterestRate The new interest rate where `FixedMath.ONE` is 100% interest rate per year.
     */
    function changeInterestRate(uint64 newInterestRate) external onlyOwner {
        interestRate = newInterestRate;
        emit InterestRateChanged(newInterestRate);
    }

    /**
     * @notice Stakes `amount` of `token` tokens for one year, with interest `interestRate`.
     * @notice The actual interest may be lower if there are insufficient funds on the smart contract at the time of
     *         staking to cover the full interest for the amount of tokens.
     * @param  amount The amount of tokens to be staked.
     */
    function stake(uint256 amount) external {
        TransferHelper.safeTransferFrom(
            token,
            msg.sender,
            address(this),
            amount
        );

        uint256 withdrawAmount = amount.mul(FixedMath.ONE + interestRate);
        uint48 withdrawAfter = uint48(block.timestamp) + STAKING_PERIOD;

        uint256 balance = IERC20(token).balanceOf(address(this));
        if (balance < lockedReserve + withdrawAmount) {
            withdrawAmount = balance - lockedReserve;
        }

        uint256 stakeId = ++lastStakeId;
        stakes[stakeId] = Stake(msg.sender, withdrawAmount, withdrawAfter);
        lockedReserve += withdrawAmount;

        emit Staked(stakeId, msg.sender, amount, withdrawAmount, withdrawAfter);
    }

    /**
     * @notice Withdraws tokens from a stake `stakeId`, including interest, after the staking period is over.
     * @param  stakeId The ID of the stake.
     */
    function withdraw(uint256 stakeId) external {
        Stake storage stake_ = stakes[stakeId];
        if (msg.sender != stake_.owner) {
            revert StakeNotOwned();
        }
        if (block.timestamp < stake_.withdrawAfter) {
            revert StakingPeriodNotOver();
        }

        uint256 withdrawAmount = stake_.withdrawAmount;
        lockedReserve -= withdrawAmount;
        delete stakes[stakeId];

        TransferHelper.safeTransfer(token, msg.sender, withdrawAmount);

        emit Withdrawn(stakeId, msg.sender, withdrawAmount);
    }
}

/**
 * @title  StakingConnector
 * @notice A contract that manages liquidity and staking of a specified token with interest. It includes logic to
 *         restrict access to adding liquidity to the Liquidity Pool for users who do not possess sufficient stake.
 */
contract StakingConnector is
    OwnableUpgradeable,
    ILiquidityManager,
    IStakingConnector
{
    using ECDSA for bytes32;

    mapping(uint48 => Deposit) public deposits;
    mapping(address => uint256) public deposited;
    mapping(address => uint256) public nonces;

    address public lp;
    address public oracle;

    /**
     * @notice Throws an error if the caller is not the Liquidity Provider.
     */
    modifier onlyLp() {
        if (msg.sender != address(lp)) revert OnlyLp();
        _;
    }

    /**
     * @notice Initializes the StakingConnector contract.
     * @param lp_ The address of the Liquidity Provider.
     * @param oracle_ The address of the oracle responsible for approving liquidity deposits.
     */
    function initialize(address lp_, address oracle_) external initializer {
        __Ownable_init();
        lp = lp_;
        oracle = oracle_;
    }

    /**
     * @notice Owner: Sets the new oracle.
     * @param newOracle The address of the oracle responsible for approving liquidity deposits.
     */
    function changeOracle(address newOracle) external onlyOwner {
        oracle = newOracle;
        emit OracleChanged(newOracle);
    }

    /**
     * @notice LiquidityPool: See {ILiquidityManager-afterWithdrawLiquidity}.
     * @notice This function is called after withdrawing liquidity from the Liquidity Pool.
     * @notice Updates the deposited amount for the liquidity provider after withdrawing liquidity from the Liquidity Pool.
     * @param depositId The ID of the deposit associated with the liquidity withdrawal.
     * @param balance The new balance of the deposit after the withdrawal.
     */
    function afterWithdrawLiquidity(uint48 depositId, uint128 balance)
        external
        onlyLp
    {
        Deposit storage deposit = deposits[depositId];
        address owner = deposit.owner;
        if (owner == address(0)) return;

        uint128 amount = deposit.amount;
        uint128 newBalance = balance > amount ? amount : balance;

        deposited[owner] = deposited[owner] + newBalance - deposit.balance;
        deposit.balance = newBalance;
    }

    /**
     * @notice LiquidityPool: See {ILiquidityManager-beforeAddLiquidity}.
     * @notice This function is called before adding liquidity to the StakingPool.
     * @notice Verifies the oracle passed in the data field and checks the deposit limit before adding liquidity to the
     *         StakingPool.
     * @param account The address of the liquidity provider.
     * @param depositId The ID of the deposit associated with the liquidity addition.
     * @param balance The balance of the liquidity being added.
     * @param data The oracle response and signature used for verification.
     */
    function beforeAddLiquidity(
        address account,
        uint48 depositId,
        uint128 balance,
        bytes calldata data
    ) external onlyLp {
        (OracleResponse memory oracleResponse, bytes memory signature) = abi
            .decode(data, (OracleResponse, bytes));

        _verifySignature(account, oracleResponse, signature);

        if (
            oracleResponse.account != account ||
            oracleResponse.lp != lp ||
            oracleResponse.chainId != _getChainId()
        ) revert OracleResponseDoesNotMatch();

        uint256 nonce = nonces[account]++;
        if (oracleResponse.nonce != nonce) revert InvalidNonce();

        deposited[account] += balance;
        if (oracleResponse.depositLimit < deposited[account])
            revert InsufficientDepositLimit();

        deposits[depositId] = Deposit(account, balance, balance);
    }

    /**
     * @notice Verifies the signature of the oracle response.
     * @param account The address of the liquidity provider.
     * @param oracleResponse The oracle response to be verified.
     * @param signature The signature to be validated.
     */
    function _verifySignature(
        address account,
        OracleResponse memory oracleResponse,
        bytes memory signature
    ) internal view {
        bytes32 message = keccak256(abi.encode(oracleResponse));
        bytes32 hash = message.toEthSignedMessageHash();
        address signer = hash.recover(signature);

        if (oracle != signer) revert InvalidSignature();
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
}
