// SPDX-License-Identifier: GPL-3.0

pragma solidity ^0.8.9;

import "./interface/IAccess.sol";
import "./interface/ILP.sol";
import "./interface/IProxyOracle.sol";
import "./utils/OwnableUpgradeable.sol";

/**
 * @notice Operation of oracles management tool.
 */
contract ProxyOracle is OwnableUpgradeable, IProxyOracle {
    IAccess public access;
    ILP public lp;
    uint128 reinforcementLimit;

    /**
     * @notice Throw if caller have no access to function with selector `selector`.
     */
    modifier restricted(bytes4 selector) {
        access.checkAccess(msg.sender, address(this), selector);
        _;
    }

    function initialize(address access_, address lp_)
        external
        virtual
        initializer
    {
        __Ownable_init();
        access = IAccess(access_);
        lp = ILP(lp_);
        reinforcementLimit = type(uint128).max;
    }

    /**
     * @notice Owner: Change maximum condition reinforcement limit to `reinforcementLimit_`.
     */
    function changeReinforcementLimit(uint128 reinforcementLimit_)
        external
        onlyOwner
    {
        reinforcementLimit = reinforcementLimit_;
        emit ReinforcementLimitChanged(reinforcementLimit_);
    }

    /**
     * @notice The batch version of {ILP-createGame}.
     * @param  data an array of input data structures for creating games using {ILP-createGame}
     */
    function createGames(CreateGameData[] calldata data)
        external
        restricted(this.createGames.selector)
    {
        for (uint256 i = 0; i < data.length; ++i) {
            lp.createGame(data[i].gameId, data[i].ipfsHash, data[i].startsAt);
        }
    }

    /**
     * @notice The batch version of {ILP-cancelGame}.
     * @param  gameIds IDs of the games to be canceled
     */
    function cancelGames(uint256[] calldata gameIds)
        external
        restricted(this.cancelGames.selector)
    {
        for (uint256 i = 0; i < gameIds.length; ++i) {
            lp.cancelGame(gameIds[i]);
        }
    }

    /**
     * @notice The batch version of {ILP-shiftGame}.
     * @param  data an array of input data structures for changing games start using {ILP-shiftGame}
     */
    function shiftGames(ShiftGameData[] calldata data)
        external
        restricted(this.shiftGames.selector)
    {
        for (uint256 i = 0; i < data.length; ++i) {
            lp.shiftGame(data[i].gameId, data[i].startsAt);
        }
    }

    /**
     * @notice The batch version of {ICore-createCondition}.
     * @param  core the address of the Core using for creating conditions
     * @param  data an array of input data structures for creating conditions using {ICore-createCondition}
     */
    function createConditions(address core, CreateConditionData[] calldata data)
        external
        restricted(this.createConditions.selector)
    {
        // TODO: check if saving data[i] is more cheaper
        ICore core_ = ICore(core);
        uint256 reinforcementLimit_ = reinforcementLimit;
        for (uint256 i = 0; i < data.length; ++i) {
            uint128 reinforcement = data[i].reinforcement;
            if (reinforcement > reinforcementLimit_)
                revert TooLargeReinforcement();
            core_.createCondition(
                data[i].gameId,
                data[i].conditionId,
                data[i].odds,
                data[i].outcomes,
                reinforcement,
                data[i].margin
            );
        }
    }

    /**
     * @notice The batch version of {ICore-cancelCondition}.
     * @param  core the address of the Core using for canceling conditions
     * @param  conditionIds IDs of the conditions to be canceled
     */
    function cancelConditions(address core, uint256[] calldata conditionIds)
        external
        restricted(this.cancelConditions.selector)
    {
        ICore core_ = ICore(core);
        for (uint256 i = 0; i < conditionIds.length; ++i) {
            core_.cancelCondition(conditionIds[i]);
        }
    }

    /**
     * @notice The batch version of {ICore-changeOdds}.
     * @param  core the address of the Core using for changing odds
     * @param  data an array of input data structures for changing odds using {ICore-changeOdds}.
     */
    function changeOdds(address core, ChangeOddsData[] calldata data)
        external
        restricted(this.changeOdds.selector)
    {
        ICore core_ = ICore(core);
        for (uint256 i = 0; i < data.length; ++i) {
            core_.changeOdds(data[i].conditionId, data[i].odds);
        }
    }

    /**
     * @notice The batch version of {ICore-resolveConditions}.
     * @param  core the address of the Core using for resolving conditions
     * @param  data an array of input data structures for resolving conditions using {ICore-resolveConditions}.
     */
    function resolveConditions(
        address core,
        ResolveConditionData[] calldata data
    ) external restricted(this.resolveConditions.selector) {
        ICore core_ = ICore(core);
        for (uint256 i = 0; i < data.length; ++i) {
            core_.resolveCondition(data[i].conditionId, data[i].outcomeWin);
        }
    }

    /**
     * @notice The batch version of {ICore-stopConditions}.
     * @param  core the address of the Core using for stopping conditions
     * @param  data an array of input data structures for stopping conditions using {ICore-stopConditions}.
     */
    function stopConditions(address core, StopConditionData[] calldata data)
        external
        restricted(this.stopConditions.selector)
    {
        ICore core_ = ICore(core);
        for (uint256 i = 0; i < data.length; ++i) {
            core_.stopCondition(data[i].conditionId, data[i].flag);
        }
    }
}
