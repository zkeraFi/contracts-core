// SPDX-License-Identifier: MIT
pragma solidity 0.8.18;

interface IPositionRouter_0_8_18 {
    function increasePositionRequestKeysStart() external view returns (uint256);

    function decreasePositionRequestKeysStart() external view returns (uint256);

    function increasePositionRequestKeys(
        uint256 index
    ) external view returns (bytes32);

    function decreasePositionRequestKeys(
        uint256 index
    ) external view returns (bytes32);

    function executeIncreasePositions(
        uint256 _count,
        address payable _executionFeeReceiver,
        bytes[] calldata priceUpdateData
    ) external payable;

    function executeDecreasePositions(
        uint256 _count,
        address payable _executionFeeReceiver,
        bytes[] calldata priceUpdateData
    ) external payable;

    function getRequestQueueLengths()
        external
        view
        returns (uint256, uint256, uint256, uint256);

    function getIncreasePositionRequestPath(
        bytes32 _key
    ) external view returns (address[] memory);

    function getDecreasePositionRequestPath(
        bytes32 _key
    ) external view returns (address[] memory);

    function createIncreasePosition(
        address[] memory _path,
        address _indexToken,
        uint256 _amountIn,
        uint256 _minOut,
        uint256 _sizeDelta,
        bool _isLong,
        uint256 _acceptablePrice,
        uint256 _executionFee,
        bytes32 _referralCode,
        address _callbackTarget
    ) external payable returns (bytes32);

    function createIncreasePositionByAccount(
        address[] memory _path,
        address _indexToken,
        uint256 _amountIn,
        uint256 _minOut,
        uint256 _sizeDelta,
        bool _isLong,
        uint256 _acceptablePrice,
        uint256 _executionFee,
        bytes32 _referralCode,
        address _callbackTarget,
        address _from
    ) external payable returns (bytes32);

    

    function createIncreasePositionETH(
        address[] memory _path,
        address _indexToken,
        uint256 _minOut,
        uint256 _sizeDelta,
        bool _isLong,
        uint256 _acceptablePrice,
        uint256 _executionFee,
        bytes32 _referralCode,
        address _callbackTarget
    ) external payable returns (bytes32);

    function createIncreasePositionETHByAccount(
        address[] memory _path,
        address _indexToken,
        uint256 _minOut,
        uint256 _sizeDelta,
        bool _isLong,
        uint256 _acceptablePrice,
        uint256 _executionFee,
        bytes32 _referralCode,
        address _callbackTarget,
        address _from
    ) external payable returns (bytes32);

    function createDecreasePosition(
        address[] memory _path,
        address _indexToken,
        uint256 _collateralDelta,
        uint256 _sizeDelta,
        bool _isLong,
        address _receiver,
        uint256 _acceptablePrice,
        uint256 _minOut,
        uint256 _executionFee,
        bool _withdrawETH,
        address _callbackTarget
    ) external payable returns (bytes32);

    function createDecreasePositionByAccount(
        address[] memory _path,
        address _indexToken,
        uint256 _collateralDelta,
        uint256 _sizeDelta,
        bool _isLong,
        address _receiver,
        uint256 _acceptablePrice,
        uint256 _minOut,
        uint256 _executionFee,
        bool _withdrawETH,
        address _callbackTarget,
        address _from
    ) external payable returns (bytes32);
}
