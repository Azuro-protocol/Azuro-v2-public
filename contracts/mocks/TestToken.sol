// SPDX-License-Identifier: GPL-3.0

pragma solidity ^0.8.9;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/token/ERC20/ERC20.sol";

contract TestERC20 is Ownable, ERC20 {
    uint256 public contestsStartDate;
    uint256 public contestsDuration;
    uint256 private claimableAmount = 100e18;
    mapping(address => uint256) private lastClaim;
    mapping(address => bool) private privilegedAccounts;

    event Deposit(address indexed dst, uint256 wad);
    event Withdrawal(address indexed src, uint256 wad);

    receive() external payable {
        deposit();
    }

    function deposit() public payable {
        _mint(msg.sender, msg.value);
        emit Deposit(msg.sender, msg.value);
    }

    function withdraw(uint256 wad) public {
        _burn(msg.sender, wad);
        payable(msg.sender).transfer(wad);
        emit Withdrawal(msg.sender, wad);
    }

    function mint(address account, uint256 amount) external onlyOwner {
        _mint(account, amount);
    }

    function setContestStartDate(uint256 startDate) external onlyOwner {
        contestsStartDate = startDate;
    }

    function setContestDuration(uint256 _contestsDuration) external onlyOwner {
        contestsDuration = _contestsDuration;
    }

    function addPrivilegedAccounts(address account, bool active)
        external
        onlyOwner
    {
        privilegedAccounts[account] = active;
    }

    function claim(address account) external {
        require(availableToClaim(account), "not available tokens for claim");
        lastClaim[account] = block.timestamp;
        _mint(account, claimableAmount);
    }

    function availableToClaim(address account) public view returns (bool) {
        /*
        if (block.timestamp < contestsStartDate || block.timestamp > contestsStartDate + contestsDuration) {
            return false;
        }
        **/
        if (lastClaim[account] == 0) {
            return true;
        }
        if (
            (lastClaim[account] - contestsStartDate) / 1 days <
            (block.timestamp - contestsStartDate) / 1 days
        ) {
            return true;
        }
        return false;
    }

    function burn(address account, uint256 amount) external onlyOwner {
        _burn(account, amount);
    }

    function withdraw() external onlyOwner {
        address payable payer = payable(msg.sender);
        payer.transfer((address(this).balance));
    }

    constructor() ERC20("USDT test token", "USDT") {}

    function transfer(address recipient, uint256 amount)
        public
        override
        returns (bool)
    {
        if (
            block.timestamp > contestsStartDate &&
            block.timestamp < contestsStartDate + contestsDuration
        ) {
            require(
                privilegedAccounts[msg.sender] || privilegedAccounts[recipient],
                "Not allowed transfer"
            );
        }
        return super.transfer(recipient, amount);
    }

    function transferFrom(
        address sender,
        address recipient,
        uint256 amount
    ) public override returns (bool) {
        if (
            block.timestamp > contestsStartDate &&
            block.timestamp < contestsStartDate + contestsDuration
        ) {
            require(
                privilegedAccounts[sender] || privilegedAccounts[recipient],
                "Not allowed transfer"
            );
        }
        return super.transferFrom(sender, recipient, amount);
    }
}
