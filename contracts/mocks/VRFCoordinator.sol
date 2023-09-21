// SPDX-License-Identifier: GPL-3.0
pragma solidity ^0.8.9;

import "@chainlink/contracts/src/v0.8/mocks/VRFCoordinatorV2Mock.sol";

contract VRFCoordinator is VRFCoordinatorV2Mock {
    constructor() VRFCoordinatorV2Mock(0, 1) {}
}
