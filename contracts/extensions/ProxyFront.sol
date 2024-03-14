// SPDX-License-Identifier: GPL-3.0

pragma solidity ^0.8.9;

import "../interface/ICoreBase.sol";
import "../interface/ILP.sol";
import "../interface/IProxyFront.sol";
import "../utils/OwnableUpgradeable.sol";
import "@uniswap/lib/contracts/libraries/TransferHelper.sol";

/**
 * @title  ProxyFront is a proxy contract designed to facilitate interaction with a Liquidity Pool contract.
 * @notice The contract provides functions for making bets and withdrawing payouts in batches.
 */
contract ProxyFront is OwnableUpgradeable, IProxyFront {
    receive() external payable {}

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    function initialize() external virtual initializer {
        __Ownable_init();
    }

    /**
     * @notice The batch version of {ILP-bet}
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

        TransferHelper.safeTransferFrom(
            token,
            msg.sender,
            address(this),
            totalAmount
        );

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
     * @notice The batch version of {ILP-withdrawPayout}
     * @param  data An array of input data structures for withdrawing payouts using the `withdrawPayout` function.
     */
    function withdrawPayouts(WithdrawPayoutData[] calldata data) external {
        for (uint256 i = 0; i < data.length; ++i) {
            ICoreBase core = ICoreBase(data[i].core);
            core.lp().withdrawPayout(data[i].core, data[i].tokenId);
        }
    }
}
