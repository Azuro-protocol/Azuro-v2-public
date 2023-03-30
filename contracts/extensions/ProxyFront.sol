// SPDX-License-Identifier: GPL-3.0

pragma solidity ^0.8.9;

import "../interface/ILPExtended.sol";
import "../interface/IProxyFront.sol";
import "../interface/IWNative.sol";
import "../utils/OwnableUpgradeable.sol";
import "@uniswap/lib/contracts/libraries/TransferHelper.sol";

/**
 * @title  ProxyFront is a proxy contract designed to facilitate interaction with a Liquidity Provider contract.
 * @notice The contract provides functions for making bets and withdrawing payouts in batches.
 */
contract ProxyFront is IProxyFront {
    /**
     * @notice The batch version of {ILP-bet} with additional feature to pay for bet in native tokens.
     * @param  lp The address of the LP contract to use for making bets.
     * @param  data An array of input data structures for making bets using the `bet` function of the specified LP.
     * @param  isNative A boolean flag whether to place bet in native tokens or not.
     */
    function bet(
        address lp,
        BetData[] calldata data,
        bool isNative
    ) external payable {
        uint256 totalAmount;
        for (uint256 i = 0; i < data.length; ++i) {
            totalAmount += data[i].amount;
        }

        ILPExtended lp_ = ILPExtended(lp);
        address token = lp_.token();
        if (isNative) {
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
     * @notice The batch version of {ILP-withdrawPayout}.
     * @param  lp The address of the LP contract to use for withdrawing payouts.
     * @param  data An array of input data structures for withdrawing payouts using the `withdrawPayout` function of the specified LP.
     * @param  isNative A boolean flag whether to withdraw payouts in native tokens or not.
     */
    function withdrawPayouts(
        address lp,
        WithdrawPayoutData[] calldata data,
        bool isNative
    ) external {
        ILPExtended lp_ = ILPExtended(lp);
        for (uint256 i = 0; i < data.length; ++i) {
            lp_.withdrawPayout(data[i].core, data[i].tokenId, isNative);
        }
    }
}
