// SPDX-License-Identifier: GPL-3.0

pragma solidity ^0.8.9;

interface IAffiliate {
    function resolveAffiliateReward(address affiliate, bytes calldata data)
        external
        returns (uint256 contribution);
}
