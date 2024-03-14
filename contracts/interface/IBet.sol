// SPDX-License-Identifier: GPL-3.0

pragma solidity ^0.8.9;

interface IBet {
    struct BetData {
        address affiliate; // address indicated as an affiliate when placing bet
        uint64 minOdds;
        bytes data; // core-specific customized bet data
    }

    error BetNotExists();
    error SmallOdds();

    /**
     * @notice Register new bet.
     * @param  bettor wallet for emitting bet token
     * @param  amount amount of tokens to bet
     * @param  betData customized bet data
     */
    function putBet(
        address bettor,
        uint128 amount,
        BetData calldata betData
    ) external returns (uint256 tokenId);

    function resolvePayout(
        uint256 tokenId
    ) external returns (address account, uint128 payout);

    function viewPayout(uint256 tokenId) external view returns (uint128 payout);
}
