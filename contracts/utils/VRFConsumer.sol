// SPDX-License-Identifier: GPL-3.0
pragma solidity ^0.8.9;

import "@chainlink/contracts/src/v0.8/dev/VRFConsumerBaseV2Upgradeable.sol";
import "@chainlink/contracts/src/v0.8/interfaces/VRFCoordinatorV2Interface.sol";

abstract contract VRFConsumer is VRFConsumerBaseV2Upgradeable {
    uint16 public constant MAXREQUESTCONFIRMATIONS = 200;
    uint16 public constant MINREQUESTCONFIRMATIONS = 3;

    VRFCoordinatorV2Interface public coordinator;

    uint64 public consumerId;
    bytes32 public keyHash;
    uint32 public numWords;
    uint32 public callbackGasLimit;
    uint16 public requestConfirmations;

    function requestRandomWords() internal returns (uint256 requestId) {
        requestId = coordinator.requestRandomWords(
            keyHash,
            consumerId,
            requestConfirmations,
            callbackGasLimit,
            numWords
        );

        return requestId;
    }
}
