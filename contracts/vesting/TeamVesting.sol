// SPDX-License-Identifier: MIT
pragma solidity 0.8.18;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "./../oracle/interfaces/IBlockInfo_0_8_18.sol";

contract TeamVesting is Ownable {
    uint256 public vestingWeeks;
    uint256 public vestingStart;
    IERC20 public zke;
    IBlockInfo_0_8_18 blockInfo;

    uint256 public totalZkeAllocated;
    uint256 public totalZkeClaimed;
    uint256 private constant ZKE_DECIMALS = 18;

    struct Participant {
        uint256 zkeAllocated;
        uint256 zkeClaimed;
        uint256 lastClaimed;
    }

    mapping(address => Participant) private _participants;
    mapping(address => bool) private _pausedClaiming;

    event ZkeAllocated(address indexed team, uint256 amount);
    event ZkeClaimed(address indexed team, uint256 amount);

    constructor (IERC20 _zke, uint256 _vestingWeeks, uint256 _vestingStart, IBlockInfo_0_8_18 _blockInfo) {
        zke = _zke;
        vestingWeeks = _vestingWeeks;
        vestingStart= _vestingStart;
        blockInfo = _blockInfo;
    }


    function pausedClaiming(address account) public view returns(bool) {
        return _pausedClaiming[account];
    }

    function participants(address account) public view returns (uint256,uint256,uint256) {
        Participant memory participant = _participants[account];

        return (participant.zkeAllocated, participant.zkeClaimed, participant.lastClaimed);
    }

    function setVestingStart(uint256 _vestingStart) onlyOwner external {
        vestingStart = _vestingStart;
    }

    function setVestingWeeks(uint256 _vestingWeeks) onlyOwner external {
        vestingWeeks = _vestingWeeks;
    }

    function allocateTokens(address team, uint256 tokenAmount) onlyOwner external {
        Participant storage participant = _participants[team];
        require(participant.zkeClaimed == 0, "Cannot allocate after first claim");
        
        totalZkeAllocated -= participant.zkeAllocated;
        participant.zkeAllocated = tokenAmount;
        totalZkeAllocated += tokenAmount;

        emit ZkeAllocated(team, tokenAmount);
    }

    function claimTokens() external {
        require(!pausedClaiming(msg.sender), "Claiming is paused for this team");
        uint256 blockTimestamp = blockInfo.getBlockTimestamp();
        require(blockTimestamp >= vestingStart, "Vesting has not started yet");

        Participant storage participant = _participants[msg.sender];

        uint256 tokensAvailable = getAvailableTokens(msg.sender);
        require(tokensAvailable > 0, "No tokens available to claim");

        participant.zkeClaimed += tokensAvailable;
        totalZkeClaimed += tokensAvailable;
        participant.lastClaimed = blockTimestamp;
        zke.transfer(msg.sender, tokensAvailable);

        emit ZkeClaimed(msg.sender, tokensAvailable);
    }

    function getAvailableTokens(address user) public view returns (uint256) {
        uint256 blockTimestamp = blockInfo.getBlockTimestamp();
        if (blockTimestamp < vestingStart) {
            return 0;
        }
        (uint256 zkeAllocated, uint256 zkeClaimed, uint256 lastClaimed) = participants(user);

        bool firstClaim = lastClaimed == 0;
        uint256 vestedWeeks = (blockTimestamp - vestingStart ) / (86400 * 7);
        uint256 claimedWeeks = firstClaim ? 0 : (lastClaimed - vestingStart) / (86400 * 7);
        uint256 weeksPassed = vestedWeeks - claimedWeeks;

        if (weeksPassed == 0) {
            return 0;
        }

        uint256 tokensPerWeek = zkeAllocated / vestingWeeks;
        uint256 tokensToClaim = tokensPerWeek * weeksPassed;

        return
            (zkeClaimed + tokensToClaim > zkeAllocated)
                ? zkeAllocated - zkeClaimed
                : tokensToClaim;
    }

    function max(uint256 a, uint256 b) private pure returns (uint256) {
        return a > b ? a : b;
    }

    function withdrawTokens(
        address _tokenAddress,
        uint256 _amount
    ) external onlyOwner {
        IERC20 _token = IERC20(_tokenAddress);
        _token.transfer(owner(), _amount);
    }

    function pauseClaiming(address user) onlyOwner external {
        _pausedClaiming[user] = true;
    }

    function unpauseClaiming(address user) onlyOwner external {
        _pausedClaiming[user] = false;
    }
}
