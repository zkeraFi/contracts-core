// SPDX-License-Identifier: MIT

pragma solidity 0.8.18;

interface IRewardRouterV4 {
    function feeZlpTracker() external view returns (address);
    function stakedZlpTracker() external view returns (address);

    function feeDegenLPTracker() external view returns (address);
    function stakedDegenLPTracker() external view returns (address);
}
