// SPDX-License-Identifier: GPL-3.0

pragma solidity ^0.8.9;

interface ISafeOracle {
    enum ConditionState {
        CREATED,
        PROPOSED,
        DISPUTED,
        RESOLVED
    }

    struct Condition {
        uint256 insurance;
        bytes solution;
        address oracle;
        uint64 stateExpiresAt;
        address disputer;
        ConditionState state;
    }

    event DisputePeriodChanged(uint256 newDisputePeriod);
    event InsuranceChanged(uint256 newInsurance);

    event Canceled(address indexed core, uint256 indexed conditionId);
    event Compromised(address indexed core, uint256 indexed conditionId);
    event Created(
        address indexed core,
        uint256 indexed conditionId,
        address oracle,
        uint64 proposeDeadline
    );
    event Disputed(
        address indexed core,
        uint256 indexed conditionId,
        address disputer
    );
    event Proposed(
        address indexed core,
        uint256 indexed conditionId,
        bytes solution,
        uint64 proposedAt
    );
    event Resolved(
        address indexed core,
        uint256 indexed conditionId,
        bytes solution
    );

    error CantAcceptSolution();
    error CantPropose();
    error CantResolve();
    error ConditionAlreadyCreated();
    error ConditionAlreadyResolved();
    error ConditionCanceled();
    error ConditionDoesNotExist();
    error ConditionNotCanceled();
    error DisputeNotAllowed();
    error IncorrectDisputePeriod();
    error IncorrectProposeDeadline();
    error IncorrectSolution();
    error InsufficientBalance();
    error OnlyOracle(address);
    error SameSolutionAsProposed();

    function createCondition(
        address core,
        uint256 gameId,
        uint256 conditionId,
        uint64[2] calldata odds,
        uint64[2] calldata outcomes,
        uint128 reinforcement,
        uint64 margin,
        uint64 proposeDeadline
    ) external;

    function approve(address core, uint256 conditionId) external;

    function cancelCondition(address core, uint256 conditionId) external;

    function resolveCondition(
        address core,
        uint256 conditionId,
        uint64 outcomeWin
    ) external;

    function dispute(address core, uint256 conditionId) external;

    function applyProposal(address core, uint256 conditionId) external;

    function applyCancelCondition(address core, uint256 conditionId) external;

    function handleCanceledCondition(address core, uint256 conditionId)
        external;

    function withdraw(uint256 amount) external;

    function balanceOf(address account) external view returns (uint256);
}
