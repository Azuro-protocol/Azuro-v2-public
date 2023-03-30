// SPDX-License-Identifier: GPL-3.0
/**
 * @dev interface for canonical wrapped native contract based on WETH9.sol
 */
pragma solidity ^0.8.9;

interface IWNative {
    function deposit() external payable;

    function transfer(address to, uint256 value) external returns (bool);

    function withdraw(uint256) external;
}
