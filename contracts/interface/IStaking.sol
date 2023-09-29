// SPDX-License-Identifier: GPL-3.0

pragma solidity ^0.8.9;

interface IStaking {
    struct Stake {
        address owner;
        uint256 withdrawAmount;
        uint48 withdrawAfter;
    }

    event InterestRateChanged(uint64 newInterestRate);
    event Staked(
        uint256 indexed stakeId,
        address indexed account,
        uint256 amount,
        uint256 withdrawAmount,
        uint48 withdrawAfter
    );
    event Withdrawn(
        uint256 indexed stakeId,
        address indexed account,
        uint256 withdrawAmount
    );

    error StakeNotOwned();
    error StakingPeriodNotOver();
}

interface IStakingConnector {
    struct Deposit {
        address owner; // The address of the deposit owner.
        uint128 amount; // The initial amount of liquidity deposited.
        uint128 balance; // The current liquidity balance within the deposit.
    }

    struct OracleResponse {
        uint256 chainId;
        uint256 nonce;
        address lp;
        address account;
        uint256 stakedAmount;
    }

    event DepositRateChanged(uint64 newDepositRate);
    event OracleChanged(address newOracle);

    error InsufficientDepositLimit();
    error InvalidNonce();
    error InvalidSignature();
    error OnlyLp();
    error OracleResponseDoesNotMatch();
}
