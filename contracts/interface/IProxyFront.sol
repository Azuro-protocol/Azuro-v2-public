// SPDX-License-Identifier: GPL-3.0

pragma solidity ^0.8.9;

import "./IBet.sol";

interface IProxyFront {
    struct BetData {
        address core;
        uint128 amount;
        uint64 expiresAt;
        IBet.BetData extraData;
    }

    struct WithdrawPayoutData {
        address core;
        uint256 tokenId;
    }

    error IncorrectValue();

    function bet(
        address lp,
        BetData[] calldata data,
        bool isNative
    ) external payable;

    function withdrawPayouts(
        address lp,
        WithdrawPayoutData[] calldata data,
        bool isNative
    ) external;
}
