// SPDX-License-Identifier: GPL-3.0

pragma solidity ^0.8.9;

import "../interface/ICoreBase.sol";
import "../interface/ILP.sol";
import "../interface/IProxyFront.sol";
import "../interface/IWNative.sol";
import "../libraries/SafeCast.sol";
import "@uniswap/lib/contracts/libraries/TransferHelper.sol";

/**
 * @title  ProxyFront is a proxy contract designed to facilitate interaction with a Liquidity Pool contract.
 * @notice The contract provides functions for making bets and withdrawing payouts in batches.
 */
contract ProxyFront is IProxyFront {
    using SafeCast for *;

    receive() external payable {}

    /**
     * @notice An alternative version {ILP-withdrawLiquidity} that allows for deposit liquidity to the Liquidity Pool
     *         in the native currency of the network.
     * @notice To deposit the native currency, you need to send the deposit amount in {msg.value}.
     * @param  lp The address of the LP contract to use for withdrawal liquidity.
     */
    function addLiquidityNative(address lp, bytes calldata data)
        external
        payable
    {
        ILP lp_ = ILP(lp);
        address token = lp_.token();
        IWNative(token).deposit{value: msg.value}();

        TransferHelper.safeApprove(token, lp, msg.value);
        uint48 depositId = lp_.addLiquidity((msg.value).toUint128(), data);
        lp_.transferFrom(address(this), msg.sender, depositId);
    }

    /**
     * @notice The batch version of {ILP-bet} with additional feature to pay for bet in the native currency of the
     *         network.
     * @notice To pay bets in the native currency, you need to send the total amount of bids in {msg.value}.
     * @param  lp The address of the LP contract to use for making bets.
     * @param  data An array of input data structures for making bets using the `bet` function of the specified LP.
     */
    function bet(address lp, BetData[] calldata data) external payable {
        uint256 totalAmount;
        for (uint256 i = 0; i < data.length; ++i) {
            totalAmount += data[i].amount;
        }

        ILP lp_ = ILP(lp);
        address token = lp_.token();
        if (msg.value > 0) {
            if (msg.value != totalAmount) revert IncorrectValue();
            IWNative(token).deposit{value: msg.value}();
        } else {
            TransferHelper.safeTransferFrom(
                token,
                msg.sender,
                address(this),
                totalAmount
            );
        }

        TransferHelper.safeApprove(token, lp, totalAmount);
        for (uint256 i = 0; i < data.length; ++i) {
            lp_.betFor(
                msg.sender,
                data[i].core,
                data[i].amount,
                data[i].expiresAt,
                data[i].extraData
            );
        }
    }

    /**
     * @notice An alternative version {ILP-withdrawLiquidity} that allows for withdrawal of liquidity in the
     *         native currency of the network.
     * @param  lp The address of the LP contract to use for withdrawal liquidity.
     * @param  depositId The ID of the liquidity deposit.
     * @param  percent The % of the liquidity to withdraw, where `FixedMath.ONE` represents 100% of the deposit.
     */
    function withdrawLiquidityNative(
        address lp,
        uint48 depositId,
        uint40 percent
    ) external payable {
        ILP lp_ = ILP(lp);
        lp_.transferFrom(msg.sender, address(this), depositId);

        uint256 withdrawnAmount = lp_.withdrawLiquidity(depositId, percent);
        _withdrawNative(lp_.token(), msg.sender, withdrawnAmount);

        if (lp_.isDepositExists(depositId))
            lp_.transferFrom(address(this), msg.sender, depositId);
    }

    /**
     * @notice The batch version of {ILP-withdrawPayout} with additional feature to withdraw payout in the native
     *         currency of the network.
     * @param  data An array of input data structures for withdrawing payouts using the `withdrawPayout` function.
     */
    function withdrawPayouts(WithdrawPayoutData[] calldata data) external {
        for (uint256 i = 0; i < data.length; ++i) {
            ICoreBase core = ICoreBase(data[i].core);
            ILP lp = core.lp();
            uint256 payout = lp.withdrawPayout(data[i].core, data[i].tokenId);
            if (data[i].isNative && payout > 0) {
                address account = core.azuroBet().ownerOf(data[i].tokenId);
                address token = lp.token();
                //slither-disable-next-line arbitrary-send-erc20
                TransferHelper.safeTransferFrom(
                    token,
                    account,
                    address(this),
                    payout
                );
                _withdrawNative(token, account, payout);
            }
        }
    }

    /**
     * @notice Unwraps the specified amount of wrapped native currency of the network represented as token and sends it
     *         to `to` address.
     */
    function _withdrawNative(
        address token,
        address to,
        uint256 amount
    ) internal {
        IWNative(token).withdraw(amount);
        TransferHelper.safeTransferETH(to, amount);
    }
}
