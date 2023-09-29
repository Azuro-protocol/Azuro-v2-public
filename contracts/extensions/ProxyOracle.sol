// SPDX-License-Identifier: GPL-3.0

pragma solidity ^0.8.9;

import "../interface/IAccess.sol";
import "../interface/ILP.sol";
import "../interface/IPrematchCore.sol";
import "../interface/IProxyOracle.sol";
import "../utils/OwnableUpgradeable.sol";

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

    function initialize(
        address access_,
        address lp_
    ) external virtual initializer {
        __Ownable_init();
        access = IAccess(access_);
        lp = ILP(lp_);
        reinforcementLimit = type(uint128).max;
    }

    /**
     * @notice Owner: Change maximum condition reinforcement limit to `reinforcementLimit_`.
     */
    function changeReinforcementLimit(
        uint128 reinforcementLimit_
    ) external onlyOwner {
        reinforcementLimit = reinforcementLimit_;
        emit ReinforcementLimitChanged(reinforcementLimit_);
    }

    /**
     * @notice The batch version of {ILP-createGame}.
     * @param  data an array of input data structures for creating games using {ILP-createGame}
     */
    function createGames(
        CreateGameData[] calldata data
    ) external restricted(this.createGames.selector) {
        for (uint256 i = 0; i < data.length; ++i) {
            lp.createGame(data[i].gameId, data[i].startsAt, data[i].data);
        }
    }

    /**
     * @notice The batch version of {ILP-cancelGame}.
     * @param  gameIds IDs of the games to be canceled
     */
    function cancelGames(
        uint256[] calldata gameIds
    ) external restricted(this.cancelGames.selector) {
        for (uint256 i = 0; i < gameIds.length; ++i) {
            lp.cancelGame(gameIds[i]);
        }
    }

    /**
     * @notice The batch version of {ILP-shiftGame}.
     * @param  data an array of input data structures for changing games start using {ILP-shiftGame}
     */
    function shiftGames(
        ShiftGameData[] calldata data
    ) external restricted(this.shiftGames.selector) {
        for (uint256 i = 0; i < data.length; ++i) {
            lp.shiftGame(data[i].gameId, data[i].startsAt);
        }
    }

    /**
     * @notice The batch version of {IPrematchCore-changeMargin}.
     * @param  core the address of the Core using for creating conditions
     * @param  data an array of input data structures for changing conditions margin using {IPrematchCore-changeMargin}
     */
    function changeMargins(
        address core,
        changeMarginData[] calldata data
    ) external restricted(this.changeMargins.selector) {
        IPrematchCore core_ = IPrematchCore(core);
        for (uint256 i = 0; i < data.length; ++i)
            core_.changeMargin(data[i].conditionId, data[i].margin);
    }

    /**
     * @notice The batch version of {IPrematchCore-changeReinforcement}.
     * @param  core the address of the Core using for creating conditions
     * @param  data an array of input data structures for changing conditions reinforcement using {IPrematchCore-changeReinforcement}
     */
    function changeReinforcements(
        address core,
        changeReinforcementData[] calldata data
    ) external restricted(this.changeReinforcements.selector) {
        IPrematchCore core_ = IPrematchCore(core);
        uint256 reinforcementLimit_ = reinforcementLimit;
        uint128 reinforcement;
        for (uint256 i = 0; i < data.length; ++i) {
            reinforcement = data[i].reinforcement;
            if (reinforcement > reinforcementLimit_)
                revert TooLargeReinforcement();
            core_.changeReinforcement(data[i].conditionId, reinforcement);
        }
    }

    /**
     * @notice The batch version of {IPrematchCore-createCondition}.
     * @param  core the address of the Core using for creating conditions
     * @param  data an array of input data structures for creating conditions using {IPrematchCore-createCondition}
     */
    function createConditions(
        address core,
        CreateConditionData[] calldata data
    ) external restricted(this.createConditions.selector) {
        IPrematchCore core_ = IPrematchCore(core);
        uint256 reinforcementLimit_ = reinforcementLimit;
        for (uint256 i = 0; i < data.length; ++i) {
            CreateConditionData memory data_ = data[i];

            uint128 reinforcement = data_.reinforcement;
            if (reinforcement > reinforcementLimit_)
                revert TooLargeReinforcement();

            core_.createCondition(
                data_.gameId,
                data_.conditionId,
                data_.odds,
                data_.outcomes,
                reinforcement,
                data_.margin,
                data_.winningOutcomesCount,
                data_.isExpressForbidden
            );
        }
    }

    /**
     * @notice The batch version of {IPrematchCore-cancelCondition}.
     * @param  core the address of the Core using for canceling conditions
     * @param  conditionIds IDs of the conditions to be canceled
     */
    function cancelConditions(
        address core,
        uint256[] calldata conditionIds
    ) external restricted(this.cancelConditions.selector) {
        IPrematchCore core_ = IPrematchCore(core);
        for (uint256 i = 0; i < conditionIds.length; ++i) {
            core_.cancelCondition(conditionIds[i]);
        }
    }

    /**
     * @notice The batch version of {IPrematchCore-changeOdds}.
     * @param  core the address of the Core using for changing odds
     * @param  data an array of input data structures for changing odds using {IPrematchCore-changeOdds}.
     */
    function changeOdds(
        address core,
        ChangeOddsData[] calldata data
    ) external restricted(this.changeOdds.selector) {
        IPrematchCore core_ = IPrematchCore(core);
        for (uint256 i = 0; i < data.length; ++i) {
            core_.changeOdds(data[i].conditionId, data[i].odds);
        }
    }

    /**
     * @notice The batch version of {IPrematchCore-resolveConditions}.
     * @param  core the address of the Core using for resolving conditions
     * @param  data an array of input data structures for resolving conditions using {IPrematchCore-resolveConditions}.
     */
    function resolveConditions(
        address core,
        ResolveConditionData[] calldata data
    ) external restricted(this.resolveConditions.selector) {
        IPrematchCore core_ = IPrematchCore(core);
        for (uint256 i = 0; i < data.length; ++i) {
            core_.resolveCondition(
                data[i].conditionId,
                data[i].winningOutcomes
            );
        }
    }

    /**
     * @notice The batch version of {IPrematchCore-stopConditions}.
     * @param  core the address of the Core using for stopping conditions
     * @param  data an array of input data structures for stopping conditions using {IPrematchCore-stopConditions}.
     */
    function stopConditions(
        address core,
        StopConditionData[] calldata data
    ) external restricted(this.stopConditions.selector) {
        IPrematchCore core_ = IPrematchCore(core);
        for (uint256 i = 0; i < data.length; ++i) {
            core_.stopCondition(data[i].conditionId, data[i].flag);
        }
    }
}
