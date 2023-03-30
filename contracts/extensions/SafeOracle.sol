// SPDX-License-Identifier: GPL-3.0

pragma solidity ^0.8.9;

import "../interface/ICoreBase.sol";
import "../interface/ILPExtended.sol";
import "../interface/ISafeOracle.sol";
import "../utils/OwnableUpgradeable.sol";
import "@uniswap/lib/contracts/libraries/TransferHelper.sol";

interface ICoreBaseExtended is ICoreBase {
    function lp() external view returns (address);
}

interface IFactory {
    function checkLP(address lp) external view;
}

/**
 * @notice Azuro dispute system.
 */
contract SafeOracle is OwnableUpgradeable, ISafeOracle {
    uint256 public constant DECISION_PERIOD = 259200; // 3 days

    IFactory public factory;
    address public token;
    uint256 public insurance;
    uint256 public disputePeriod;

    mapping(address => mapping(uint256 => Condition)) public conditions;
    mapping(address => uint256) private _balances;

    /**
     * @notice Throw if condition `conditionId` is canceled.
     */
    modifier conditionNotCanceled(address core, uint256 conditionId) {
        _conditionNotCanceled(core, conditionId);
        _;
    }

    /**
     * @notice Propose condition `conditionId` solution.
     *         Owner: Resolve condition `conditionId`.
     * @dev    Every function that makes decisions should have this modifier.
     */
    modifier resolver(
        address core,
        uint256 conditionId,
        bytes memory solution
    ) {
        _conditionNotCanceled(core, conditionId);
        _;
        if (msg.sender == owner()) _resolve(core, conditionId, solution);
        else _propose(core, conditionId, solution);
    }

    function initialize(
        address factory_,
        address token_,
        uint256 insurance_,
        uint256 disputePeriod_
    ) external virtual initializer {
        if (disputePeriod_ == 0) revert IncorrectDisputePeriod();

        __Ownable_init();
        factory = IFactory(factory_);
        token = token_;
        insurance = insurance_;
        disputePeriod = disputePeriod_;
    }

    /**
     * @notice Owner: Set `newDisputePeriod` as dispute period.
     */
    function changeDisputePeriod(uint256 newDisputePeriod) external onlyOwner {
        if (newDisputePeriod == 0) revert IncorrectDisputePeriod();
        disputePeriod = newDisputePeriod;
        emit DisputePeriodChanged(newDisputePeriod);
    }

    /**
     * @notice Owner: Set `newInsurance` as new insurance.
     */
    function changeInsurance(uint256 newInsurance) external onlyOwner {
        insurance = newInsurance;
        emit InsuranceChanged(newInsurance);
    }

    /**
     * @notice Register new condition on the core `core` on behalf of SafeOracle.
     *         Takes `insurance` of `token` tokens as collateral. Collateral will be credited to the balance back if
     *         an Oracle propose a correct solution of the condition before `proposeDeadline`.
     * @notice SafeOracle contract address should be preliminarily marked as an Oracle for the associated Liquidity Pool.
     * @notice See {CoreBase-_createCondition} for common _createCondition parameters description.
     * @param  core the core on which to register the condition
     * @param  proposeDeadline the timestamp by which an Oracle undertakes to propose solution
     */
    function createCondition(
        address core,
        uint256 gameId,
        uint256 conditionId,
        uint64[2] calldata odds,
        uint64[2] calldata outcomes,
        uint128 reinforcement,
        uint64 margin,
        uint64 proposeDeadline
    ) external {
        if (proposeDeadline < block.timestamp)
            revert IncorrectProposeDeadline();
        address lpAddress = ICoreBaseExtended(core).lp();
        factory.checkLP(lpAddress);

        ILPExtended lp = ILPExtended(lpAddress);
        lp.checkAccess(
            msg.sender,
            core,
            ICoreBaseExtended(core).createCondition.selector
        );
        lp.checkCore(core);
        if (ICoreBase(core).getCondition(conditionId).gameId != 0)
            revert ConditionAlreadyCreated();

        Condition storage condition = conditions[core][conditionId];
        condition.oracle = msg.sender;
        condition.stateExpiresAt = proposeDeadline;

        uint256 insurance_ = insurance;
        condition.insurance = insurance_;
        _payInsurance(insurance_);

        ICoreBaseExtended(core).createCondition(
            gameId,
            conditionId,
            odds,
            outcomes,
            reinforcement,
            margin
        );

        emit Created(core, conditionId, msg.sender, proposeDeadline);
    }

    /**
     * @notice Owner: Reject the dispute and apply Oracle's proposed solution for the condition `conditionId`.
     */
    function approve(address core, uint256 conditionId)
        external
        onlyOwner
        resolver(core, conditionId, "")
    {
        if (conditions[core][conditionId].state != ConditionState.DISPUTED)
            revert CantResolve();
    }

    /**
     * @notice Owner: Caller for {CoreBase-cancelCondition}.
     */
    function cancelCondition(address core, uint256 conditionId)
        external
        onlyOwner
        resolver(
            core,
            conditionId,
            abi.encodeWithSignature("cancelCondition(uint256)", conditionId)
        )
    {}

    /**
     * @notice Oracle/Owner: Caller for {Core-resolveCondition}.
     */
    function resolveCondition(
        address core,
        uint256 conditionId,
        uint64 outcomeWin
    )
        external
        resolver(
            core,
            conditionId,
            abi.encodeWithSignature(
                "resolveCondition(uint256,uint64)",
                conditionId,
                outcomeWin
            )
        )
    {}

    /**
     * @notice Register dispute for the condition `conditionId`.
     * @notice Takes 1/2 of condition's insurance as collateral. Disputer gets full insurance if an Oracle proposes
     *         incorrect solution of the condition `conditionId`. Collateral will be credited to the balance
     *         back if the DAO does not consider dispute before `decisionPeriod` after proposal.
     */
    function dispute(address core, uint256 conditionId)
        external
        conditionNotCanceled(core, conditionId)
    {
        Condition storage condition = _getCondition(core, conditionId);
        if (
            condition.state != ConditionState.PROPOSED ||
            block.timestamp >= condition.stateExpiresAt
        ) revert DisputeNotAllowed();

        condition.state = ConditionState.DISPUTED;
        condition.disputer = msg.sender;

        _payInsurance(condition.insurance / 2);

        emit Disputed(core, conditionId, msg.sender);
    }

    /**
     * @notice Apply an Oracle's proposed solution to the condition `conditionId` if it is not disputed and its dispute deadline is passed.
     */
    function applyProposal(address core, uint256 conditionId)
        external
        conditionNotCanceled(core, conditionId)
    {
        Condition storage condition = _getCondition(core, conditionId);

        if (
            !(condition.state == ConditionState.PROPOSED &&
                block.timestamp >= condition.stateExpiresAt)
        ) revert CantAcceptSolution();

        bytes memory solution = condition.solution;
        (bool success, ) = core.call(condition.solution);
        if (success) {
            condition.state = ConditionState.RESOLVED;
            _balances[condition.oracle] += condition.insurance;

            emit Resolved(core, conditionId, solution);
        } else {
            condition.state = ConditionState.CREATED;
            condition.stateExpiresAt = uint64(block.timestamp);
            condition.solution = "";

            emit Compromised(core, conditionId);
        }
    }

    /**
     * @notice Cancel condition `conditionId` if something went wrong.
     * @notice This function allows to cancel condition if the DAO didn't provide a decision after:
     *         a) Condition propose deadline + `DECISION_PERIOD` if solution is not proposed.
     *         b) Condition dispute deadline + `DECISION_PERIOD` if proposed solution is disputed.
     * @notice Refund back oracle and disputer stake.
     */
    function applyCancelCondition(address core, uint256 conditionId)
        external
        conditionNotCanceled(core, conditionId)
    {
        Condition storage condition = _getCondition(core, conditionId);
        if (block.timestamp < condition.stateExpiresAt + DECISION_PERIOD)
            revert CantAcceptSolution();

        ConditionState state = condition.state;
        uint256 insurance_ = condition.insurance;
        if (state == ConditionState.DISPUTED)
            _balances[condition.disputer] += insurance_ / 2;
        else if (state != ConditionState.CREATED) revert CantAcceptSolution();

        _balances[condition.oracle] += insurance_;
        condition.state = ConditionState.RESOLVED;

        (bool success, ) = core.call(
            abi.encodeWithSignature("cancelCondition(uint256)", conditionId)
        );
        assert(success);

        emit Canceled(core, conditionId);
    }

    /**
     * @notice Handle canceled condition.
     *         a) If solution hasn't yet been proposed and the propose deadline has not been passed, the oracle refunds its stake back.
     *         b) If proposed solution is disputed, the dao receives oracle's stake and the disputer refunds its stake back.
     */
    function handleCanceledCondition(address core, uint256 conditionId)
        external
    {
        Condition storage condition = _getCondition(core, conditionId);
        if (!ICoreBaseExtended(core).isConditionCanceled(conditionId))
            revert ConditionNotCanceled();

        ConditionState state = condition.state;
        uint256 insurance_ = condition.insurance;
        if (state == ConditionState.CREATED)
            _balances[
                block.timestamp >= condition.stateExpiresAt
                    ? owner()
                    : condition.oracle
            ] += insurance_;
        else {
            _balances[owner()] += insurance_;
            if (state == ConditionState.DISPUTED) {
                _balances[condition.disputer] += insurance_ / 2;
            } else if (state != ConditionState.PROPOSED)
                revert ConditionAlreadyResolved();
        }

        condition.state = ConditionState.RESOLVED;

        emit Canceled(core, conditionId);
    }

    /**
     * @notice Withdraw `amount` of `token` tokens stored on the contract balance.
     */
    function withdraw(uint256 amount) external {
        if (amount > _balances[msg.sender]) revert InsufficientBalance();
        _balances[msg.sender] -= amount;
        TransferHelper.safeTransfer(token, msg.sender, amount);
    }

    /**
     * @notice Returns the amount of owned by `account` `token` tokens stored on the contract balance.
     */
    function balanceOf(address account) external view returns (uint256) {
        return _balances[account];
    }

    /**
     * @notice Get condition by it's ID.
     */
    function getCondition(address core, uint256 conditionId)
        external
        view
        returns (Condition memory condition)
    {
        return _getCondition(core, conditionId);
    }

    /**
     * @notice Pay `amount` as insurance.
     * @notice Transfers missing funds to the contract if it stores insufficient amount of `token` tokens owned by `msg.sender`.
     */
    function _payInsurance(uint256 amount) internal {
        uint256 balance = _balances[msg.sender];
        if (balance < amount) {
            if (balance > 0) {
                amount -= balance;
                _balances[msg.sender] = 0;
            }
            TransferHelper.safeTransferFrom(
                token,
                msg.sender,
                address(this),
                amount
            );
        } else {
            _balances[msg.sender] = balance - amount;
        }
    }

    /**
     * @notice Propose condition `conditionId`.
     * @param  solution solution to propose.
     */
    function _propose(
        address core,
        uint256 conditionId,
        bytes memory solution
    ) internal {
        Condition storage condition = _getCondition(core, conditionId);
        address oracle = condition.oracle;
        if (msg.sender != oracle) revert OnlyOracle(oracle);
        if (
            condition.state != ConditionState.CREATED ||
            block.timestamp >= condition.stateExpiresAt
        ) revert CantPropose();

        uint64 disputeDeadline = uint64(block.timestamp + disputePeriod);
        condition.solution = solution;
        condition.stateExpiresAt = disputeDeadline;
        condition.state = ConditionState.PROPOSED;

        emit Proposed(core, conditionId, solution, disputeDeadline);
    }

    /**
     * @notice Resolve condition `conditionId` with solution `solution` or a solution proposed by its Oracle.
     * @notice If an Oracle solution is applied credit condition's insurance to the balance back,
     *         else Disputer get its insurance. Regardless of the decision case DAO gets 1/2 of the insurance.
     * @param  solution solution to apply. If it is empty applies a solution proposed by an Oracle.
     */
    function _resolve(
        address core,
        uint256 conditionId,
        bytes memory solution
    ) internal {
        Condition storage condition = _getCondition(core, conditionId);
        uint256 stateExpiresAt = condition.stateExpiresAt;
        if (block.timestamp >= stateExpiresAt + DECISION_PERIOD)
            revert CantResolve();

        ConditionState state = condition.state;
        uint256 insurance_ = condition.insurance;
        if (
            state == ConditionState.CREATED && block.timestamp >= stateExpiresAt
        ) _balances[owner()] += insurance_;
        else if (state == ConditionState.DISPUTED) {
            _balances[owner()] += insurance_ / 2;
            if (solution.length > 0) {
                if (keccak256(solution) == keccak256(condition.solution))
                    revert SameSolutionAsProposed();
                _balances[condition.disputer] += insurance_;
            } else {
                solution = condition.solution;
                _balances[condition.oracle] += insurance_;
            }
        } else revert CantResolve();

        condition.state = ConditionState.RESOLVED;

        (bool success, ) = core.call(solution);
        if (!success) revert IncorrectSolution();

        emit Resolved(core, conditionId, solution);
    }

    /**
     * @notice Throw if condition `conditionId` is canceled.
     */
    function _conditionNotCanceled(address core, uint256 conditionId)
        internal
        view
    {
        if (ICoreBaseExtended(core).isConditionCanceled(conditionId))
            revert ConditionCanceled();
    }

    /**
     * @notice Get condition by it's ID.
     */
    function _getCondition(address core, uint256 conditionId)
        internal
        view
        returns (Condition storage condition)
    {
        condition = conditions[core][conditionId];
        if (condition.oracle == address(0)) revert ConditionDoesNotExist();
    }
}
