// SPDX-License-Identifier: GPL-3.0

pragma solidity ^0.8.9;

interface ILiquidityManager {
    /**
     * @notice The hook that is called after the withdrawal of liquidity.
     * @param  depositId The ID of the liquidity deposit.
     * @param  balance The remaining balance of the liquidity deposit.
     */
    function afterWithdrawLiquidity(uint48 depositId, uint128 balance) external;

    /**
     * @notice The hook that is called before adding liquidity.
     * @param  account The address of the liquidity provider.
     * @param  depositId The ID of the liquidity deposit.
     * @param  balance The amount of the liquidity deposit.
     * @param  data The additional data to process.
     */
    function beforeAddLiquidity(
        address account,
        uint48 depositId,
        uint128 balance,
        bytes calldata data
    ) external;
}
