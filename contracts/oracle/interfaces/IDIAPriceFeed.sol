// SPDX-License-Identifier: MIT
pragma solidity 0.6.12;

interface IDIAPriceFeed{
    function latestAnswer(bool maximize) external view returns(uint256);
    function latestAnswer() external view returns(uint256);
}