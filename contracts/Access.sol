// SPDX-License-Identifier: GPL-3.0
pragma solidity ^0.8.9;

import "./interface/IAccess.sol";
import "./libraries/SafeCast.sol";
import "./utils/OwnableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/token/ERC721/extensions/ERC721EnumerableUpgradeable.sol";

/// @title Azuro Access token helps manage access to sensitive contract functionality.
contract Access is OwnableUpgradeable, ERC721EnumerableUpgradeable, IAccess {
    using SafeCast for string;

    uint256 public nextRole;
    uint256 public nextTokenId;

    // Mapping from role ID to role name
    mapping(uint256 => bytes32) public roles;

    // Mapping from token ID to role ID
    mapping(uint256 => uint8) public tokenRoles;

    /*
     * @notice Mapping from function ID to vector of role IDs the function is included in.
     * @notice Every role represented by bit in 256 bits (32 bytes) role vector.
     *         Access is granted by matching bits of role vectors associated with caller and called function.
     */
    mapping(bytes32 => uint256) public functionRoles;

    /*
     * @notice Mapping from account to vector of role IDs the account is associated with.
     * @notice Every role represented by bit in 256 bits (32 bytes) access vector.
     *         Access is granted by matching bits of role vectors associated with caller and called function.
     */
    mapping(address => uint256) public userRoles;

    function initialize() external initializer {
        __Ownable_init_unchained();
        __ERC721_init("Azuro Access token", "ACCESS");
    }

    /**
     * @notice Register new role `roleName`.
     * @notice Warning: the number of possible roles in one implementation is limited to 256.
     * @param  roleName role name is stored as bytes32 type, so use short name to fit 32 bytes with UTF-8 encoding.
     */
    function addRole(string calldata roleName) external onlyOwner {
        if (nextRole > type(uint8).max) revert MaxRolesReached();
        bytes32 _role = roleName.toBytes32();
        roles[nextRole] = _role;
        emit RoleAdded(_role, nextRole++);
    }

    /**
     * @notice Bind role with contract-function.
     * @notice See {_bindRole}.
     */
    function bindRole(RoleData calldata roleData) external onlyOwner {
        _bindRole(roleData);
    }

    /**
     * @notice Bind role with contract-function by provided list.
     * @param  rolesData array. See {IAccess-RoleData}
     */
    function bindRoles(RoleData[] calldata rolesData) external onlyOwner {
        uint256 rolesCount = rolesData.length;
        for (uint256 index = 0; index < rolesCount; index++) {
            _bindRole(rolesData[index]);
        }
    }

    /**
     * @notice Grant role `roleId` to `account`.
     */
    function grantRole(address account, uint8 roleId) external onlyOwner {
        uint256 _nextTokenId = nextTokenId++;
        tokenRoles[_nextTokenId] = roleId;
        _mint(account, _nextTokenId);
    }

    /**
     * @notice Change role `roleId` name to `roleName`.
     */
    function renameRole(uint8 roleId, string calldata roleName)
        external
        onlyOwner
    {
        bytes32 _role = roleName.toBytes32();
        roles[roleId] = _role;
        emit RoleRenamed(_role, roleId);
    }

    /**
     * @notice Unbind role from contract-function.
     * @notice See {IAccess-RoleData}.
     */
    function unbindRole(RoleData calldata roleData) external onlyOwner {
        bytes32 funcId = getFunctionId(roleData.target, roleData.selector);
        uint256 oldRole = functionRoles[funcId];
        uint256 newRole = oldRole & ~(1 << roleData.roleId);

        if (oldRole == newRole) return;

        functionRoles[funcId] = newRole;
        emit RoleUnbound(funcId, roleData.roleId);
    }

    /**
     * @dev Burns `tokenId`. See {ERC721-_burn}.
     * - The caller must own `tokenId` or be an approved operator or access owner.
     */
    function burn(uint256 tokenId) public virtual {
        if (
            !_isApprovedOrOwner(_msgSender(), tokenId) &&
            !(owner() == _msgSender())
        ) revert NotTokenOwner();
        _burn(tokenId);
    }

    /**
     * @notice Throw if `account` have no access to function with selector `selector` of contract `target`.
     */
    function checkAccess(
        address account,
        address target,
        bytes4 selector
    ) external view override {
        if (
            (functionRoles[getFunctionId(target, selector)] &
                userRoles[account]) == 0
        ) revert AccessNotGranted();
    }

    /**
     * @notice Check if account `account` have role `roleId`.
     */
    function roleGranted(address account, uint8 roleId)
        public
        view
        returns (bool)
    {
        uint256 roleBit = 1 << roleId;
        return (userRoles[account] & roleBit) == roleBit;
    }

    /**
     * @notice Get ID of function with selector `selector` of contract `target`.
     */
    function getFunctionId(address target, bytes4 selector)
        public
        pure
        returns (bytes32)
    {
        return bytes32(abi.encodePacked(target)) | (bytes32(selector) >> 224);
    }

    /**
     * @dev Hook that is called after any (single) transfer of tokens. This includes minting and burning.
     * See {ERC721BurnableUpgradeable-_afterTokenTransfer}.
     */
    function _afterTokenTransfer(
        address from,
        address to,
        uint256 firstTokenId
    ) internal virtual override {
        uint8 roleId = tokenRoles[firstTokenId];
        // not burn
        if (to != address(0)) {
            if (roleGranted(to, roleId)) revert RoleAlreadyGranted();
            _grantRole(to, roleId);
        }
        // not mint
        if (from != address(0)) _revokeRole(from, roleId);
    }

    /**
     * @notice Bind role with contract-function.
     * @param  role see {IAccess.RoleData}
     */
    function _bindRole(RoleData calldata role) internal {
        bytes32 funcId = getFunctionId(role.target, role.selector);
        uint256 oldRole = functionRoles[funcId];
        uint256 newRole = oldRole | (1 << role.roleId);

        if (oldRole == newRole) return;

        functionRoles[funcId] = newRole;
        emit RoleBound(funcId, role.roleId);
    }

    /**
     * @notice Grant role `roleId` to `account`.
     */
    function _grantRole(address account, uint8 roleId) internal {
        userRoles[account] = userRoles[account] | (1 << roleId);
        emit RoleGranted(account, roleId);
    }

    /**
     * @notice Revoke a role `roleId` from account `account`.
     */
    function _revokeRole(address account, uint8 roleId) internal {
        userRoles[account] = userRoles[account] & ~(1 << roleId);
        emit RoleRevoked(account, roleId);
    }
}
