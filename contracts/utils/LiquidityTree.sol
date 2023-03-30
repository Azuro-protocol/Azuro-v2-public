// SPDX-License-Identifier: GPL-3.0

pragma solidity ^0.8.9;

import "../libraries/FixedMath.sol";

contract LiquidityTree {
    using FixedMath for uint40;

    struct Node {
        uint64 updateId; // last update number
        uint128 amount; // node amount
    }

    uint48 constant LIQUIDITYNODES = 1_099_511_627_776; // begining of data nodes (top at node #1)
    uint48 constant LIQUIDITYLASTNODE = LIQUIDITYNODES * 2 - 1;

    uint48 public nextNode; // next unused node number for adding liquidity

    uint64 public updateId; // update number, used instead of timestamp for splitting changes time on the same nodes

    // liquidity (segment) tree
    mapping(uint48 => Node) public treeNode;

    error LeafNotExist();
    error IncorrectPercent();

    /**
     * @dev initializing LIQUIDITYNODES and nextNode. 
     * @dev LIQUIDITYNODES is count of liquidity (segment) tree leaves contains single liquidity addings
     * @dev liquidity (segment) tree build as array of 2*LIQUIDITYNODES count, top node has id #1 (id #0 not used)
     * @dev liquidity (segment) tree leaves is array [LIQUIDITYNODES, 2*LIQUIDITYNODES-1]
     * @dev liquidity (segment) tree node index N has left child index 2*N and right child index 2N+1
     * @dev +--------------------------------------------+
            |                  1 (top node)              |
            +------------------------+-------------------+
            |             2          |         3         |
            +-------------+----------+---------+---------+
            | 4 (nextNode)|     5    |    6    |    7    |
            +-------------+----------+---------+---------+
     */
    function __liquidityTree_init() internal {
        nextNode = LIQUIDITYNODES;
        updateId++; // start from non zero
    }

    /**
     * @dev leaf withdraw preview, emulates push value from updated node to leaf
     * @param leaf - withdrawing leaf
     */
    function nodeWithdrawView(uint48 leaf)
        public
        view
        returns (uint128 withdrawAmount)
    {
        if (leaf < LIQUIDITYNODES || leaf > LIQUIDITYLASTNODE) return 0;
        if (treeNode[leaf].updateId == 0) return 0;

        // get last-updated top node
        (uint48 updatedNode, uint48 start, uint48 end) = _getUpdatedNode(
            1,
            treeNode[1].updateId,
            LIQUIDITYNODES,
            LIQUIDITYLASTNODE,
            1,
            LIQUIDITYNODES,
            LIQUIDITYLASTNODE,
            leaf
        );

        return
            _getPushView(
                updatedNode,
                start,
                end,
                leaf,
                treeNode[updatedNode].amount
            );
    }

    /**
     * @dev add amount only for limited leaves in tree [first_leaf, leaf]
     * @param amount value to add
     */
    function _addLimit(uint128 amount, uint48 leaf) internal {
        // get last-updated top node
        (uint48 updatedNode, uint48 start, uint48 end) = _getUpdatedNode(
            1,
            treeNode[1].updateId,
            LIQUIDITYNODES,
            LIQUIDITYLASTNODE,
            1,
            LIQUIDITYNODES,
            LIQUIDITYLASTNODE,
            leaf
        );
        uint64 updateId_ = updateId;
        // push changes from last-updated node down to the leaf, if leaf is not up to date
        _push(updatedNode, start, end, leaf, ++updateId_);
        _pushLazy(
            1,
            LIQUIDITYNODES,
            LIQUIDITYLASTNODE,
            LIQUIDITYNODES,
            leaf,
            amount,
            false,
            ++updateId_
        );

        updateId = updateId_;
    }

    /**
     * @dev change amount by adding value or reducing value
     * @param node - node for changing
     * @param amount - amount value for changing
     * @param isSub - true - reduce by amount, true - add by amount
     * @param updateId_ - update number
     */
    function _changeAmount(
        uint48 node,
        uint128 amount,
        bool isSub,
        uint64 updateId_
    ) internal {
        treeNode[node].updateId = updateId_;
        if (isSub) {
            treeNode[node].amount -= amount;
        } else {
            treeNode[node].amount += amount;
        }
    }

    /**
     * @dev add liquidity amount from the leaf up to top node
     * @param amount - adding amount
     */
    function _nodeAddLiquidity(uint128 amount)
        internal
        returns (uint48 resNode)
    {
        resNode = nextNode++;
        _updateUp(resNode, amount, false, ++updateId);
    }

    /**
     * @dev withdraw part of liquidity from the leaf, due possible many changes in leaf's parent nodes
     * @dev it is needed firstly to update its amount and then withdraw
     * @dev used steps:
     * @dev 1 - get last updated parent most near to the leaf
     * @dev 2 - push all changes from found parent to the leaf - that updates leaf's amount
     * @dev 3 - execute withdraw of leaf amount and update amount changing up to top parents
     * @param leaf -
     * @param percent - percent of leaf amount 1*10^12 is 100%, 5*10^11 is 50%
     */
    function _nodeWithdrawPercent(uint48 leaf, uint40 percent)
        internal
        returns (uint128 withdrawAmount)
    {
        if (treeNode[leaf].updateId == 0) revert LeafNotExist();
        if (percent > FixedMath.ONE) revert IncorrectPercent();

        // get last-updated top node
        (uint48 updatedNode, uint48 start, uint48 end) = _getUpdatedNode(
            1,
            treeNode[1].updateId,
            LIQUIDITYNODES,
            LIQUIDITYLASTNODE,
            1,
            LIQUIDITYNODES,
            LIQUIDITYLASTNODE,
            leaf
        );
        uint64 updateId_ = updateId;
        // push changes from last-updated node down to the leaf, if leaf is not up to date
        _push(updatedNode, start, end, leaf, ++updateId_);

        // remove amount (percent of amount) from leaf to it's parents
        withdrawAmount = uint128(percent.mul(treeNode[leaf].amount));
        _updateUp(leaf, withdrawAmount, true, ++updateId_);

        updateId = updateId_;
    }

    /**
     * @dev push changes from last "lazy update" down to leaf
     * @param node - last node from lazy update
     * @param start - leaf search start
     * @param end - leaf search end
     * @param leaf - last node to update
     * @param updateId_ update number
     */
    function _push(
        uint48 node,
        uint48 start,
        uint48 end,
        uint48 leaf,
        uint64 updateId_
    ) internal {
        // if node is leaf, stop
        if (node == leaf) {
            return;
        }
        uint48 lChild = node * 2;
        uint48 rChild = node * 2 + 1;
        uint128 amount = treeNode[node].amount;
        uint256 lAmount = treeNode[lChild].amount;
        uint256 rAmount = treeNode[rChild].amount;
        uint256 sumAmounts = lAmount + rAmount;
        if (sumAmounts == 0) return;
        uint128 setLAmount = uint128((amount * lAmount) / sumAmounts);

        // update left and right child
        _setAmount(lChild, setLAmount, updateId_);
        _setAmount(rChild, amount - setLAmount, updateId_);

        uint48 mid = (start + end) / 2;

        if (start <= leaf && leaf <= mid) {
            _push(lChild, start, mid, leaf, updateId_);
        } else {
            _push(rChild, mid + 1, end, leaf, updateId_);
        }
    }

    /**
     * @dev push lazy (lazy propagation) amount value from top node to child nodes contained leafs from 0 to r
     * @param node - start from node
     * @param start - node left element
     * @param end - node right element
     * @param l - left leaf child
     * @param r - right leaf child
     * @param amount - amount to add/reduce stored amounts
     * @param isSub - true means negative to reduce
     * @param updateId_ update number
     */
    function _pushLazy(
        uint48 node,
        uint48 start,
        uint48 end,
        uint48 l,
        uint48 r,
        uint128 amount,
        bool isSub,
        uint64 updateId_
    ) internal {
        if ((start == l && end == r) || (start == end)) {
            // if node leafs equal to leaf interval then stop
            _changeAmount(node, amount, isSub, updateId_);
            return;
        }

        uint48 mid = (start + end) / 2;

        if (start <= r && r <= mid) {
            // [l,r] in [start,mid] - all leafs in left child
            _pushLazy(node * 2, start, mid, l, r, amount, isSub, updateId_);
        } else {
            uint256 lAmount = treeNode[node * 2].amount;
            // get right amount excluding unused leaves when adding amounts
            uint256 rAmount = treeNode[node * 2 + 1].amount -
                (
                    !isSub
                        ? _getLeavesAmount(
                            node * 2 + 1,
                            mid + 1,
                            end,
                            r + 1,
                            end
                        )
                        : 0
                );
            uint256 sumAmounts = lAmount + rAmount;
            if (sumAmounts == 0) return;
            uint128 forLeftAmount = uint128((amount * lAmount) / sumAmounts);

            // l in [start,mid] - part in left child
            _pushLazy(
                node * 2,
                start,
                mid,
                l,
                mid,
                forLeftAmount,
                isSub,
                updateId_
            );

            // r in [mid+1,end] - part in right child
            _pushLazy(
                node * 2 + 1,
                mid + 1,
                end,
                mid + 1,
                r,
                amount - forLeftAmount,
                isSub,
                updateId_
            );
        }
        _changeAmount(node, amount, isSub, updateId_);
    }

    /**
     * @dev remove amount from whole tree, starting from top node #1
     * @param amount value to remove
     */
    function _remove(uint128 amount) internal {
        if (treeNode[1].amount >= amount) {
            _pushLazy(
                1,
                LIQUIDITYNODES,
                LIQUIDITYLASTNODE,
                LIQUIDITYNODES,
                nextNode - 1,
                amount,
                true,
                ++updateId
            );
        }
    }

    /**
     * @dev reset node amount, used in push
     * @param node for set
     * @param amount value
     * @param updateId_ update number
     */
    function _setAmount(
        uint48 node,
        uint128 amount,
        uint64 updateId_
    ) internal {
        if (treeNode[node].amount != amount) {
            treeNode[node].updateId = updateId_;
            treeNode[node].amount = amount;
        }
    }

    /**
     * @dev update up amounts from leaf up to top node #1, used in adding/removing values on leaves
     * @param child node for update
     * @param amount value for update
     * @param isSub true - reduce, false - add
     * @param updateId_ update number
     */
    function _updateUp(
        uint48 child,
        uint128 amount,
        bool isSub,
        uint64 updateId_
    ) internal {
        _changeAmount(child, amount, isSub, updateId_);
        // if not top parent
        if (child != 1) {
            _updateUp(child > 1 ? child / 2 : 1, amount, isSub, updateId_);
        }
    }

    /**
     * @dev for current node get sum amount of exact leaves list
     * @param node node to get sum amount
     * @param start - node left element
     * @param end - node right element
     * @param l - left leaf of the list
     * @param r - right leaf of the list
     * @return amount sum of leaves list
     */
    function _getLeavesAmount(
        uint48 node,
        uint48 start,
        uint48 end,
        uint48 l,
        uint48 r
    ) internal view returns (uint128 amount) {
        if ((start == l && end == r) || (start == end)) {
            // if node leafs equal to leaf interval then stop and return amount value
            return (treeNode[node].amount);
        }

        uint48 mid = (start + end) / 2;

        if (start <= l && l <= mid) {
            amount += _getLeavesAmount(node * 2, start, mid, l, mid);
            amount += _getLeavesAmount(node * 2 + 1, mid + 1, end, mid + 1, r);
        } else {
            amount += _getLeavesAmount(node * 2 + 1, mid + 1, end, l, r);
        }

        return amount;
    }

    /**
     * @dev   emulating push changes from last "lazy update" down to leaf
     * @param node - last node from lazy update
     * @param start - leaf search start
     * @param end - leaf search end
     * @param leaf - last node to update
     * @param amount - pushed (calced) amount for the node
     */
    function _getPushView(
        uint48 node,
        uint48 start,
        uint48 end,
        uint48 leaf,
        uint128 amount
    ) internal view returns (uint128 withdrawAmount) {
        // if node is leaf, stop
        if (node == leaf) {
            return amount;
        }

        uint48 lChild = node * 2;
        uint48 rChild = node * 2 + 1;
        uint256 lAmount = treeNode[lChild].amount;
        uint256 sumAmounts = lAmount + treeNode[rChild].amount;
        if (sumAmounts == 0) return 0;
        uint128 setLAmount = uint128((amount * lAmount) / sumAmounts);

        uint48 mid = (start + end) / 2;

        if (start <= leaf && leaf <= mid) {
            return _getPushView(lChild, start, mid, leaf, setLAmount);
        } else {
            return
                _getPushView(rChild, mid + 1, end, leaf, amount - setLAmount);
        }
    }

    /**
     * @dev top node is ever most updated, trying to find lower node not older then top node
     * @dev get nearest to leaf (lowest) last-updated node from the parents, runing down from top to leaf
     * @param parent top node
     * @param parentUpdate top node update
     * @param parentBegin top node most left leaf
     * @param parentEnd top node most right leaf
     * @param node node parent for the leaf
     * @param start node most left leaf
     * @param end node most right leaf
     * @param leaf target leaf
     * @return resParent found most updated leaf parent
     * @return resBegin found parent most left leaf
     * @return resEnd found parent most right leaf
     */
    function _getUpdatedNode(
        uint48 parent,
        uint64 parentUpdate,
        uint48 parentBegin,
        uint48 parentEnd,
        uint48 node,
        uint48 start,
        uint48 end,
        uint48 leaf
    )
        internal
        view
        returns (
            uint48 resParent,
            uint48 resBegin,
            uint48 resEnd
        )
    {
        // if node is older than it's parent, stop and return parent
        if (treeNode[node].updateId < parentUpdate) {
            return (parent, parentBegin, parentEnd);
        }
        if (node == leaf) {
            return (leaf, start, end);
        }

        uint48 mid = (start + end) / 2;

        if (start <= leaf && leaf <= mid) {
            // work on left child
            (resParent, resBegin, resEnd) = _getUpdatedNode(
                node,
                parentUpdate,
                start,
                end,
                node * 2,
                start,
                mid,
                leaf
            );
        } else {
            // work on right child
            (resParent, resBegin, resEnd) = _getUpdatedNode(
                node,
                parentUpdate,
                start,
                end,
                node * 2 + 1,
                mid + 1,
                end,
                leaf
            );
        }
    }
}
