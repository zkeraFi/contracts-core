// SPDX-License-Identifier: MIT
pragma solidity 0.8.0;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "../libraries/access/access_0_8_0/Ownable_0_8_0.sol";

contract WeeklyVesting is Ownable_0_8_0 {
    uint256 public vestingWeeks;
    uint256 public tokenPrice;
    uint256 public maxZkeVesting;
    uint256 public vestingStart;
    IERC20 public zke;
    IERC20 public usdc;

    uint256 public totalZkePurchased;
    uint256 private constant ZKE_DECIMALS = 18;

    struct Participant {
        uint256 zkePurchased;
        uint256 zkeClaimed;
        uint256 lastClaimed;
    }

    mapping(address => Participant) public participants;
    mapping(address => bool) public pausedClaiming;

    event ZkePurchased(address indexed buyer, uint256 amount);
    event ZkeClaimed(address indexed claimer, uint256 amount);

    constructor(
        IERC20 _zke,
        IERC20 _usdc,
        uint256 _vestingWeeks,
        uint256 _tokenPrice,
        uint256 _maxZkeVesting,
        uint256 _vestingStart
    ) {
        zke = _zke;
        usdc = _usdc;
        vestingWeeks = _vestingWeeks;
        tokenPrice = _tokenPrice;
        maxZkeVesting = _maxZkeVesting;
        vestingStart = _vestingStart;
    }

    function setVestingStart(uint256 _vestingStart) external {
        _checkOwner();
        require(block.timestamp < vestingStart, "Vesting has already started");
        require(_vestingStart > vestingStart, "You can not start vesting retroactively");
        vestingStart = _vestingStart;
    }

    function setVestingWeeks(uint256 _vestingWeeks) external {
        _checkOwner();
        vestingWeeks = _vestingWeeks;
    }

    function setTokenPrice(uint256 _tokenPrice) external {
        _checkOwner();
        tokenPrice = _tokenPrice;
    }

    function setMaxZkeVesting(uint256 _maxZkeVesting) external {
        _checkOwner();
        maxZkeVesting = _maxZkeVesting;
    }

    function buyTokens(uint256 tokenAmount) external {
        require(
            block.timestamp < vestingStart,
            "Token purchase not allowed after vesting starts"
        );
        require(
            totalZkePurchased + tokenAmount <= maxZkeVesting,
            "Exceeds maximum ZKE vesting limit"
        );

        uint256 requiredUsdc = (tokenAmount * tokenPrice) /
            (10 ** ZKE_DECIMALS);

        require(requiredUsdc > 0, "tokenAmount too small");
        usdc.transferFrom(msg.sender, address(this), requiredUsdc);

        Participant storage participant = participants[msg.sender];
        participant.zkePurchased += tokenAmount;

        totalZkePurchased += tokenAmount;

        emit ZkePurchased(msg.sender, tokenAmount);
    }

    function claimTokens() external {
        require(!pausedClaiming[msg.sender], "Claiming is paused for this user");
        require(block.timestamp >= vestingStart, "Vesting has not started yet");

        Participant storage participant = participants[msg.sender];

        uint256 tokensAvailable = getAvailableTokens(msg.sender);
        require(tokensAvailable > 0, "No tokens available to claim");

        participant.zkeClaimed += tokensAvailable;
        participant.lastClaimed = block.timestamp;
        zke.transfer(msg.sender, tokensAvailable);

        emit ZkeClaimed(msg.sender, tokensAvailable);
    }

    function getAvailableTokens(address user) public view returns (uint256) {
        if (block.timestamp < vestingStart) {
            return 0;
        }

        Participant storage participant = participants[user];
        uint256 weeksPassed = (block.timestamp -
            max(participant.lastClaimed, vestingStart)) / (86400 * 7);

        if (weeksPassed == 0) {
            return 0;
        }

        uint256 tokensPerWeek = participant.zkePurchased / vestingWeeks;
        uint256 tokensToClaim = tokensPerWeek * weeksPassed;

        return
            (participant.zkeClaimed + tokensToClaim > participant.zkePurchased)
                ? participant.zkePurchased - participant.zkeClaimed
                : tokensToClaim;
    }

    function max(uint256 a, uint256 b) private pure returns (uint256) {
        return a > b ? a : b;
    }

    function withdrawTokens(
        address _tokenAddress,
        uint256 _amount
    ) external {
        _checkOwner();
        IERC20 _token = IERC20(_tokenAddress);
        _token.transfer(owner(), _amount);
    }

    function pauseClaiming(address user) external {
        _checkOwner();
        pausedClaiming[user] = true;
    }

    function unpauseClaiming(address user) external {
        _checkOwner();
        pausedClaiming[user] = false;
    }
}
