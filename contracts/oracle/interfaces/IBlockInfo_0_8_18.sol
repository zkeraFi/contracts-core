// SPDX-License-Identifier: MIT

pragma solidity 0.8.18;

interface IBlockInfo_0_8_18 {
    /**
     * Returns (blockNumber, blockTimestamp)
     */
    function getBlockInfo() external view returns(uint256, uint256);
    function getBlockTimestamp() external view returns(uint256);
    function getBlockNumber() external view returns(uint256);
}
