// SPDX-License-Identifier: GPL-3.0

pragma solidity ^0.8.9;

import "./interface/IAzuroBet.sol";
import "./utils/OwnableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/token/ERC721/ERC721Upgradeable.sol";

/// @title Azuro bet ERC721 enumerable token
contract AzuroBet is OwnableUpgradeable, ERC721Upgradeable, IAzuroBet {
    address public core;

    uint256 public lastTokenId;

    // Mapping from owner to list of owned token IDs
    mapping(address => mapping(uint256 => uint256)) private _ownedTokens;
    // Mapping from token ID to index of the owner tokens list
    mapping(uint256 => uint256) private _ownedTokensIndex;

    // Base URI for computing {tokenURI}
    string public baseURI;

    /**
     * @notice Throw if caller is not the Core.
     */
    modifier onlyCore() {
        if (msg.sender != core) revert OnlyCore();
        _;
    }

    function initialize(address core_) external virtual initializer {
        __Ownable_init();
        __ERC721_init("AzuroBet-NFT", "BET");
        core = core_;
    }

    /**
     * @notice See {IERC165-supportsInterface}.
     */
    function supportsInterface(bytes4 interfaceId)
        public
        view
        override(IERC165Upgradeable, ERC721Upgradeable)
        returns (bool)
    {
        return
            interfaceId == type(IERC721EnumerableUpgradeable).interfaceId ||
            super.supportsInterface(interfaceId);
    }

    /**
     * @notice Owner: Set `uri` as baseURI.
     */
    function setBaseURI(string calldata uri) external onlyOwner {
        baseURI = uri;
    }

    /**
     * @notice Core: See {ERC721Upgradeable-_burn}.
     */
    function burn(uint256 tokenId) external override onlyCore {
        super._burn(tokenId);
    }

    /**
     * @notice Core: See {ERC721Upgradeable-_mint}.
     * @return tokenId minted token id
     */
    function mint(address account)
        external
        override
        onlyCore
        returns (uint256 tokenId)
    {
        tokenId = ++lastTokenId;
        super._mint(account, tokenId);
    }

    /**
     * @notice Get all IDs of tokens owned by `owner_`.
     */
    function getTokensByOwner(address owner_)
        external
        view
        returns (uint256[] memory tokenIds)
    {
        return getTokensByOwner(owner_, 0, balanceOf(owner_));
    }

    /**
     * @notice See {IERC721EnumerableUpgradeable-tokenByIndex}.
     * @notice The function included only to support ERC721EnumerableUpgradeable interface.
     */
    function tokenByIndex(uint256 index)
        external
        view
        override
        returns (uint256)
    {
        require(index < lastTokenId, "ERC721: global index out of bounds");
        return index + 1;
    }

    /**
     * @notice See {IERC721EnumerableUpgradeable-tokenOfOwnerByIndex}.
     */
    function tokenOfOwnerByIndex(address owner_, uint256 index)
        external
        view
        override
        returns (uint256)
    {
        require(index < balanceOf(owner_), "ERC721: owner index out of bounds");
        return _ownedTokens[owner_][index];
    }

    /**
     * @notice See {IERC721EnumerableUpgradeable-totalSupply}.
     */
    function totalSupply() external view override returns (uint256) {
        return lastTokenId;
    }

    /**
     * @notice Get IDs of tokens owned by `owner_`.
     * @param  start the index of the first element of the list of owned tokens to start from
     * @param  count the maximum number of IDs to get
     */
    function getTokensByOwner(
        address owner_,
        uint256 start,
        uint256 count
    ) public view returns (uint256[] memory tokenIds) {
        uint256 tokens_ = balanceOf(owner_);
        require(start < tokens_, "ERC721: start index out of bounds");

        uint256 maxCount = tokens_ - start;
        if (count > maxCount) count = maxCount;

        tokenIds = new uint256[](count);
        for (uint256 i = 0; i < count; i++) {
            tokenIds[i] = _ownedTokens[owner_][start + i];
        }
    }

    /**
     * @notice Add token to this extension's ownership-tracking data structures.
     * @param  to address representing the new owner of the given token ID
     * @param  tokenId uint256 ID of the token to be added to the tokens list of the given address
     */
    function _addTokenToOwnerEnumeration(address to, uint256 tokenId) internal {
        uint256 length = super.balanceOf(to);
        _ownedTokens[to][length] = tokenId;
        _ownedTokensIndex[tokenId] = length;
    }

    /**
     * @notice Hook that is called before any token transfer includes minting and burning.
     * @param  from token sender
     * @param  to token recipient
     * @param  tokenId transferring token ID
     */
    function _beforeTokenTransfer(
        address from,
        address to,
        uint256 tokenId
    ) internal virtual override {
        super._beforeTokenTransfer(from, to, tokenId);
        if (from != to) {
            if (from != address(0)) {
                _removeTokenFromOwnerEnumeration(from, tokenId);
            }
            if (to != address(0)) {
                _addTokenToOwnerEnumeration(to, tokenId);
            }
        }
    }

    /**
     * @notice Remove a token from this extension's ownership-tracking data structures.
     * @param  from address representing the previous owner of the given token ID
     * @param  tokenId ID of the token to be removed from the tokens list of the given address
     */
    function _removeTokenFromOwnerEnumeration(address from, uint256 tokenId)
        internal
    {
        uint256 lastTokenIndex = balanceOf(from) - 1;
        uint256 tokenIndex = _ownedTokensIndex[tokenId];

        // When the token to delete is the last token, the swap operation is unnecessary
        if (tokenIndex != lastTokenIndex) {
            uint256 lastTokenId_ = _ownedTokens[from][lastTokenIndex];

            _ownedTokens[from][tokenIndex] = lastTokenId_; // Move the last token to the slot of the to-delete token
            _ownedTokensIndex[lastTokenId_] = tokenIndex; // Update the moved token's index
        }

        // This also deletes the contents at the last position of the array
        delete _ownedTokensIndex[tokenId];
        delete _ownedTokens[from][lastTokenIndex];
    }

    /**
     * @notice See {ERC721Upgradeable-_baseURI}.
     */
    function _baseURI() internal view override returns (string memory) {
        return baseURI;
    }
}
