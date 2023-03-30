// SPDX-License-Identifier: GPL-3.0

pragma solidity ^0.8.9;

import "./interface/IAccess.sol";
import "./interface/IAzuroBet.sol";
import "./interface/ICoreBase.sol";
import "./interface/ILP.sol";
import "./interface/IBetExpress.sol";
import "./utils/OwnableUpgradeable.sol";
import "@openzeppelin/contracts/proxy/beacon/BeaconProxy.sol";

/// @title Azuro Liquidity Pool factory
contract Factory is OwnableUpgradeable {
    struct CoreBeacons {
        address core;
        address azuroBet;
    }

    address public accessBeacon;
    address public lpBeacon;
    mapping(string => CoreBeacons) public coreBeacons; // Core type name -> beacons

    mapping(address => bool) public registeredLPs;

    event CoreTypeUpdated(
        string indexed coreType,
        address coreBeacon,
        address azuroBetBeacon
    );
    event NewCore(
        address indexed lp,
        address indexed core,
        string indexed coreType
    );
    event NewPool(
        address indexed lp,
        address indexed core,
        string indexed coreType,
        address access
    );

    error UnknownCoreType();
    error UnknownLP();

    function initialize(address accessBeacon_, address lpBeacon_)
        external
        virtual
        initializer
    {
        __Ownable_init();
        accessBeacon = accessBeacon_;
        lpBeacon = lpBeacon_;
    }

    /**
     * @notice Owner: Update or disable Core type.
     * @param  coreType Core type name
     * @param  coreBeacon address of Core beacon, pass as zero address to disable the Core type
     * @param  azuroBetBeacon address of AzuroBet beacon that will be used in the Core type
     */
    function updateCoreType(
        string calldata coreType,
        address coreBeacon,
        address azuroBetBeacon
    ) external onlyOwner {
        coreBeacons[coreType] = CoreBeacons(coreBeacon, azuroBetBeacon);

        emit CoreTypeUpdated(coreType, coreBeacon, azuroBetBeacon);
    }

    /**
     * @notice Deploy and tune new Liquidity Pool.
     * @param  token Liquidity Pool's token in which bets will be made
     * @param  minDepo minimum liquidity deposit
     * @param  daoFee share of the profits due to the DAO
     * @param  dataProviderFee share of the profits due to Data Provider
     * @param  affiliateFee share of the profits due to affiliates
     * @param  coreType name of the Core type to plug in first
     */
    function createPool(
        address token,
        uint128 minDepo,
        uint64 daoFee,
        uint64 dataProviderFee,
        uint64 affiliateFee,
        string calldata coreType
    ) external {
        address accessAddress = address(new BeaconProxy(accessBeacon, ""));
        IAccess access = IAccess(accessAddress);
        access.initialize();
        access.transferOwnership(msg.sender);

        address lpAddress = address(new BeaconProxy(lpBeacon, ""));
        ILP lp = ILP(lpAddress);
        lp.initialize(
            accessAddress,
            msg.sender,
            token,
            minDepo,
            daoFee,
            dataProviderFee,
            affiliateFee
        );
        lp.transferOwnership(msg.sender);
        registeredLPs[lpAddress] = true;

        emit NewPool(
            lpAddress,
            _plugCore(lpAddress, coreType),
            coreType,
            accessAddress
        );
    }

    /**
     * @notice Liquidity Pool owner: Plug new Core to the Liquidity Pool.
     * @param  lp address of owned Liquidity Pool
     * @param  coreType name of Core type to plug in
     */
    function plugCore(address lp, string calldata coreType) external {
        checkLP(lp);
        ILP(lp).checkOwner(msg.sender);

        emit NewCore(lp, _plugCore(lp, coreType), coreType);
    }

    /**
     * @notice Liquidity Pool owner: Plug new Core to the Liquidity Pool.
     * @notice 'oddsManager' role must be granted to an express contract manually after this
     * @param  lp address of owned Liquidity Pool
     * @param  coreType name of Core type to plug in
     */
    function plugExpress(
        address lp,
        address core,
        string calldata coreType
    ) external {
        checkLP(lp);
        ILP(lp).checkOwner(msg.sender);
        ILP(lp).checkCore(core);

        address expressAddress = address(
            new BeaconProxy(_getBeacons(coreType).core, "")
        );
        IBetExpress express = IBetExpress(expressAddress);

        express.initialize(lp, core);
        express.transferOwnership(msg.sender);

        ILP(lp).addCore(expressAddress);

        emit NewCore(lp, expressAddress, coreType);
    }

    function checkLP(address lp) public view {
        if (!registeredLPs[lp]) revert UnknownLP();
    }

    /**
     * @notice Plug new Core to the Liquidity Pool.
     * @param  lp address of registered Liquidity Pool
     * @param  coreType Core type name
     * @return coreAddress address of new plugged core
     */
    function _plugCore(address lp, string calldata coreType)
        internal
        returns (address coreAddress)
    {
        CoreBeacons memory beacons = _getBeacons(coreType);
        coreAddress = address(new BeaconProxy(beacons.core, ""));
        ICoreBase core = ICoreBase(coreAddress);

        address azuroBetAddress = address(
            new BeaconProxy(beacons.azuroBet, "")
        );
        IAzuroBet azuroBet = IAzuroBet(azuroBetAddress);

        core.initialize(azuroBetAddress, lp);
        core.transferOwnership(msg.sender);

        azuroBet.initialize(coreAddress);
        azuroBet.transferOwnership(msg.sender);

        ILP(lp).addCore(coreAddress);
    }

    /**
     * @notice Get beacons for Core `coreType`.
     */
    function _getBeacons(string calldata coreType)
        internal
        view
        returns (CoreBeacons storage beacons)
    {
        beacons = coreBeacons[coreType];
        if (beacons.core == address(0)) revert UnknownCoreType();
    }
}
