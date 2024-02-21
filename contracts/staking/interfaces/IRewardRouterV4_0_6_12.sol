// SPDX-License-Identifier: MIT

pragma solidity 0.6.12;

interface IRewardRouterV4_0_6_12 {
    function feeZlpTracker() external view returns (address);
    function stakedZlpTracker() external view returns (address);

    function feeDegenLPTracker() external view returns (address);
    function stakedDegenLPTracker() external view returns (address);
}
