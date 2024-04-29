// SPDX-License-Identifier: MIT
pragma solidity 0.8.18;

interface IDIAOracleV2{
    event OracleUpdate(string key, uint128 value, uint128 timestamp);

    function getValue(string memory) external view returns (uint128, uint128);
}