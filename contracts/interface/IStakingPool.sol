// SPDX-License-Identifier: GPL-3.0

pragma solidity ^0.8.9;

interface IStakingPool {
    struct Deposit {
        uint128 amount;
        uint128 balance;
        address owner;
    }

    struct Stake {
        uint256 withdrawAmount;
        uint256 depositLimit;
        uint48 withdrawAfter;
        address owner;
    }

    event DepositRateChanged(uint64 newDepositRate);
    event InterestRateChanged(uint64 newInterestRate);
    event MinStakePeriodChanged(uint64 newMinStakePeriod);
    event Staked(
        uint256 indexed stakeId,
        address indexed account,
        uint256 amount,
        uint256 withdrawAmount,
        uint48 withdrawAfter,
        uint256 depositLimit
    );
    event Withdrawn(
        uint256 indexed stakeId,
        address indexed account,
        uint256 withdrawAmount,
        uint256 depositLimit
    );

    error NotEnoughStake();
    error NotEnoughStakeToReinforceDeposits();
    error OnlyLp();
    error StakeNotOwned();
    error StakingPeriodNotOver();
    error TooShortStakePeriod();
}
