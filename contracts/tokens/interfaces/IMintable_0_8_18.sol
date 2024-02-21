// SPDX-License-Identifier: MIT

pragma solidity 0.8.18;

interface IMintable_0_8_18 {
    function isMinter(address _account) external returns (bool);
    function setMinter(address _minter, bool _isActive) external;
    function mint(address _account, uint256 _amount) external returns (bool);
    function burn(address _account, uint256 _amount) external returns (bool);
}
