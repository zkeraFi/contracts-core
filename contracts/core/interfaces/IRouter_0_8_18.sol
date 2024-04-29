// SPDX-License-Identifier: MIT

pragma solidity 0.8.18;

interface IRouter_0_8_18 {
    function approvedPlugins(address user, address plugin) external view returns (bool);
    function approvePlugin(address _plugin) external;

    function addPlugin(address _plugin) external;
    function pluginTransfer(address _token, address _account, address _receiver, uint256 _amount) external;
    function pluginIncreasePosition(address _account, address _collateralToken, address _indexToken, uint256 _sizeDelta, bool _isLong) external;
    function pluginDecreasePosition(address _account, address _collateralToken, address _indexToken, uint256 _collateralDelta, uint256 _sizeDelta, bool _isLong, address _receiver) external returns (uint256);
    function swap(address[] memory _path, uint256 _amountIn, uint256 _minOut, address _receiver) payable external;
    function swapTokensToETH(address[] memory _path, uint256 _amountIn, uint256 _minOut, address _receiver) payable external;
    function swapETHToTokens(address[] memory _path, uint256 _minOut, address _receiver) payable external;
}
