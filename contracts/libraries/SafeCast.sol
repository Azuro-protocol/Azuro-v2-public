// SPDX-License-Identifier: GPL-3.0

pragma solidity ^0.8.9;

library SafeCast {
    enum Type {
        BYTES32,
        INT128,
        UINT64,
        UINT128
    }
    error SafeCastError(Type to);

    function toBytes32(string calldata value) internal pure returns (bytes32) {
        bytes memory value_ = bytes(value);
        if (value_.length > 32) revert SafeCastError(Type.BYTES32);
        return bytes32(value_);
    }

    function toInt128(uint128 value) internal pure returns (int128) {
        if (value > uint128(type(int128).max))
            revert SafeCastError(Type.INT128);
        return int128(value);
    }

    function toUint64(uint256 value) internal pure returns (uint64) {
        if (value > type(uint64).max) revert SafeCastError(Type.UINT64);
        return uint64(value);
    }

    function toUint128(uint256 value) internal pure returns (uint128) {
        if (value > type(uint128).max) revert SafeCastError(Type.UINT128);
        return uint128(value);
    }
}
