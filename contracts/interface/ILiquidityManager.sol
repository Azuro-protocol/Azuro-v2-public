// SPDX-License-Identifier: GPL-3.0

pragma solidity ^0.8.9;

interface ILiquidityManager {
    /**
     * @notice The hook that is called after the withdrawal of liquidity.
     * @param  account Owner of the deposit token.
     * @param  depNum Deposit token's ID.
     * @param  balance The remaining deposit balance.
     */
    function afterWithdrawLiquidity(
        address account,
        uint48 depNum,
        uint128 balance
    ) external;

    /**
     * @notice The hook that is called before adding liquidity.
     * @param  account Liquidity provider's address.
     * @param  depNum Deposit token ID.
     * @param  balance The amount of deposit.
     */
    function beforeAddLiquidity(
        address account,
        uint48 depNum,
        uint128 balance
    ) external;
}
