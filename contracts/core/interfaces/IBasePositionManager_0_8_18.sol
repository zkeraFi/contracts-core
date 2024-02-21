// SPDX-License-Identifier: MIT

pragma solidity 0.8.18;

interface IBasePositionManager_0_8_18 {
    function maxGlobalLongSizes(address _token) external view returns (uint256);
    function maxGlobalShortSizes(address _token) external view returns (uint256);
}
