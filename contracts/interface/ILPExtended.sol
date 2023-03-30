// SPDX-License-Identifier: GPL-3.0

pragma solidity ^0.8.9;

import "./ILP.sol";

interface ILPExtended is ILP {
    function fees(uint256) external view returns (uint64);

    function token() external view returns (address);
}
