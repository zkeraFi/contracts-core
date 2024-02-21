// SPDX-License-Identifier: MIT

pragma solidity 0.6.12;

interface IBlockInfo {
    /**
     * Returns (blockNumber, blockTimestamp)
     */
    function getBlockInfo() external view returns(uint256, uint256);
    function getBlockTimestamp() external view returns(uint256);
    function getBlockNumber() external view returns(uint256);
}
