// SPDX-License-Identifier: GPL-3.0

pragma solidity ^0.8.9;

import "../interface/IStakingPool.sol";
import "../interface/ILiquidityManager.sol";
import "../libraries/FixedMath.sol";
import "../utils/OwnableUpgradeable.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@uniswap/lib/contracts/libraries/TransferHelper.sol";

/**
 * @title StakingPool - an Liquidity Manager contract that enables users to stake a specified token with interest and includes
 *        logic that restricts access to adding liquidity to the Liquidity Pool for those who do not possess sufficient stake.
 **/
contract StakingPool is OwnableUpgradeable, ILiquidityManager, IStakingPool {
    using FixedMath for *;

    uint48 constant ONE_YEAR = 31536000;

    mapping(uint48 => Deposit) public deposits;
    mapping(address => uint256) public deposited;
    mapping(address => uint256) public depositLimits;
    mapping(uint256 => Stake) public stakes;

    uint256 public lastStakeId;
    uint256 public lockedReserve;

    address public lp;
    address public token;

    uint64 public depositRate;
    uint64 public interestRate;
    uint64 public minStakePeriod;

    /**
     * @notice Throws an error if the caller is not the Liquidity Provider.
     */
    modifier onlyLp() {
        if (msg.sender != address(lp)) revert OnlyLp();
        _;
    }

    function initialize(address lp_, address token_) external initializer {
        __Ownable_init();
        lp = lp_;
        token = token_;
    }

    /**
     * @notice Owner: Set `newDepositRate` as a deposit rate.
     * @param  newDepositRate The new deposit rate. For every staked `token` tokens, the staker receives the opportunity
     *         to stake up to `newDepositRate` * stakePeriod / `ONE_YEAR` / `FixedMath.ONE` tokens in the Liquidity Pool.
     */
    function changeDepositRate(uint64 newDepositRate) external onlyOwner {
        depositRate = newDepositRate;
        emit DepositRateChanged(newDepositRate);
    }

    /**
     * @notice Owner: Set the new interest rate for the StakingPool.
     * @param  newInterestRate The new interest rate where `FixedMath.ONE` is 100% interest rate.
     */
    function changeInterestRate(uint64 newInterestRate) external onlyOwner {
        interestRate = newInterestRate;
        emit InterestRateChanged(newInterestRate);
    }

    /**
     * @notice Owner: Set `newMinStakePeriod` as the minimum stake period.
     * @param  newMinStakePeriod The new minimum stake period in seconds.
     */
    function changeMinStakePeriod(uint64 newMinStakePeriod) external onlyOwner {
        minStakePeriod = newMinStakePeriod;
        emit MinStakePeriodChanged(newMinStakePeriod);
    }

    /**
     * @notice LiquidityPool: See {ILiquidityManager-afterWithdrawLiquidity}.
     * @notice This function is called after withdrawing liquidity from the Liquidity Pool. It updates the deposited amount
     *         for the liquidity provider based on the new deposit balance.
     */
    function afterWithdrawLiquidity(
        address account,
        uint48 depNum,
        uint128 balance
    ) external onlyLp {
        Deposit storage deposit = deposits[depNum];
        address owner = deposit.owner;
        if (owner == address(0)) return;

        uint128 amount = deposit.amount;
        uint128 newBalance = balance > amount ? amount : balance;

        deposited[owner] = deposited[owner] + newBalance - deposit.balance;
        deposit.balance = newBalance;
    }

    /**
     * @notice LiquidityPool: See {ILiquidityManager-beforeAddLiquidity}.
     * @notice This function is called before adding liquidity to the StakingPool. It verifies that the amount of liquidity
     *         being added is within the deposit limit for the account and stores the deposit information.
     */
    function beforeAddLiquidity(
        address account,
        uint48 depNum,
        uint128 balance
    ) external onlyLp {
        deposited[account] += balance;
        if (deposited[account] > depositLimits[account])
            revert NotEnoughStake();

        deposits[depNum] = Deposit(balance, balance, account);
    }

    /**
     * @notice Stake `amount` of `token` tokens for `period` seconds of time, with interest `interestRate`.
     * @notice The staker will receive the opportunity to add `amount * interestRateInPercent / FixedMath.ONE` tokens
     *         to the Liquidity Pool `lp` before the stake is withdrawn.
     * @param  amount The amount of tokens to be staked.
     * @param  period The duration of the stake in seconds.
     */
    function stake(uint256 amount, uint48 period) external {
        if (period < minStakePeriod) revert TooShortStakePeriod();

        TransferHelper.safeTransferFrom(
            token,
            msg.sender,
            address(this),
            amount
        );

        uint256 withdrawAmount = amount.mul(
            FixedMath.ONE + (uint256(interestRate) * period) / ONE_YEAR
        );
        uint256 depositLimit = (amount.mul(depositRate) * period) / ONE_YEAR;
        uint48 withdrawAfter = uint48(block.timestamp) + period;

        uint256 balance = IERC20(token).balanceOf(address(this));
        if (balance < lockedReserve + withdrawAmount)
            withdrawAmount = balance - lockedReserve;

        uint256 stakeId = ++lastStakeId;
        stakes[stakeId] = Stake(
            withdrawAmount,
            depositLimit,
            withdrawAfter,
            msg.sender
        );
        depositLimits[msg.sender] += depositLimit;
        lockedReserve += withdrawAmount;

        emit Staked(
            stakeId,
            msg.sender,
            amount,
            withdrawAfter,
            period,
            depositLimits[msg.sender]
        );
    }

    /**
     * @notice Withdraw tokens from a stake `stake`, including interest, after the staking period is over.
     * @param  stakeId The ID of the stake.
     */
    function withdraw(uint256 stakeId) external {
        Stake storage stake_ = stakes[stakeId];
        if (msg.sender != stake_.owner) revert StakeNotOwned();
        if (block.timestamp < stake_.withdrawAfter)
            revert StakingPeriodNotOver();

        uint256 depositLimit = depositLimits[msg.sender] - stake_.depositLimit;
        depositLimits[msg.sender] = depositLimit;
        if (depositLimit < deposited[msg.sender])
            revert NotEnoughStakeToReinforceDeposits();

        uint256 withdrawAmount = stake_.withdrawAmount;
        lockedReserve -= withdrawAmount;
        delete stakes[stakeId];

        TransferHelper.safeTransfer(token, msg.sender, withdrawAmount);

        emit Withdrawn(stakeId, msg.sender, withdrawAmount, depositLimit);
    }
}
