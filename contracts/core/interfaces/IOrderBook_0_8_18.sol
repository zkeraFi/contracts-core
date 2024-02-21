// SPDX-License-Identifier: MIT

pragma solidity 0.8.18;

interface IOrderBook_0_8_18 {
    function getSwapOrder(
        address _account,
        uint256 _orderIndex
    )
        external
        view
        returns (
            address path0,
            address path1,
            address path2,
            uint256 amountIn,
            uint256 minOut,
            uint256 triggerRatio,
            bool triggerAboveThreshold,
            bool shouldUnwrap,
            uint256 executionFee
        );

    function getIncreaseOrder(
        address _account,
        uint256 _orderIndex
    )
        external
        view
        returns (
            address purchaseToken,
            uint256 purchaseTokenAmount,
            address collateralToken,
            address indexToken,
            uint256 sizeDelta,
            bool isLong,
            uint256 triggerPrice,
            bool triggerAboveThreshold,
            uint256 executionFee
        );

    function getDecreaseOrder(
        address _account,
        uint256 _orderIndex
    )
        external
        view
        returns (
            address collateralToken,
            uint256 collateralDelta,
            address indexToken,
            uint256 sizeDelta,
            bool isLong,
            uint256 triggerPrice,
            bool triggerAboveThreshold,
            uint256 executionFee
        );

    function executeSwapOrder(address, uint256, address payable) external;

    function executeSwapOrder(
        address,
        uint256,
        address payable,
        bytes[] calldata priceUpdateData
    ) external payable;

    function executeDecreaseOrder(
        address,
        uint256,
        address payable,
        bytes[] calldata priceUpdateData
    ) external payable;

    function executeIncreaseOrder(
        address,
        uint256,
        address payable,
        bytes[] calldata priceUpdateData
    ) external payable;

    function executeDecreaseOrder(address, uint256, address payable) external;

    function executeIncreaseOrder(address, uint256, address payable) external;

    function createSwapOrder(
        address[] memory _path,
        uint256 _amountIn,
        uint256 _minOut,
        uint256 _triggerRatio,
        bool _triggerAboveThreshold,
        uint256 _executionFee,
        bool _shouldWrap,
        bool _shouldUnwrap
    ) external payable;

    function createSwapOrderByAccount(
        address[] memory _path,
        uint256 _amountIn,
        uint256 _minOut,
        uint256 _triggerRatio, // tokenB / tokenA
        bool _triggerAboveThreshold,
        uint256 _executionFee,
        bool _shouldWrap,
        bool _shouldUnwrap,
        address _from
    ) external payable;

    function cancelSwapOrder(uint256 _orderIndex) external;

    function cancelSwapOrderByAccount(
        uint256 _orderIndex,
        address _from
    ) external;

    function updateSwapOrder(
        uint256 _orderIndex,
        uint256 _minOut,
        uint256 _triggerRatio,
        bool _triggerAboveThreshold
    ) external;

    function updateSwapOrderByAccount(
        uint256 _orderIndex,
        uint256 _minOut,
        uint256 _triggerRatio,
        bool _triggerAboveThreshold,
        address _from
    ) external;

    function createIncreaseOrder(
        address[] memory _path,
        uint256 _amountIn,
        address _indexToken,
        uint256 _minOut,
        uint256 _sizeDelta,
        address _collateralToken,
        bool _isLong,
        uint256 _triggerPrice,
        bool _triggerAboveThreshold,
        uint256 _executionFee,
        bool _shouldWrap,
        bytes[] calldata priceUpdateData
    ) external payable;

    function createIncreaseOrderByAccount(
        address[] memory _path,
        uint256 _amountIn,
        address _indexToken,
        uint256 _minOut,
        uint256 _sizeDelta,
        address _collateralToken,
        bool _isLong,
        uint256 _triggerPrice,
        bool _triggerAboveThreshold,
        uint256 _executionFee,
        bool _shouldWrap,
        bytes[] calldata priceUpdateData,
        address _from
    ) external payable;

    function updateIncreaseOrder(
        uint256 _orderIndex,
        uint256 _sizeDelta,
        uint256 _triggerPrice,
        bool _triggerAboveThreshold
    ) external;

    function updateIncreaseOrderByAccount(
        uint256 _orderIndex,
        uint256 _sizeDelta,
        uint256 _triggerPrice,
        bool _triggerAboveThreshold,
        address _from
    ) external;

    function cancelIncreaseOrder(uint256 _orderIndex) external;

    function cancelIncreaseOrderByAccount(
        uint256 _orderIndex,
        address _from
    ) external;

    function createDecreaseOrder(
        address _indexToken,
        uint256 _sizeDelta,
        address _collateralToken,
        uint256 _collateralDelta,
        bool _isLong,
        uint256 _triggerPrice,
        bool _triggerAboveThreshold
    ) external payable;

    function createDecreaseOrderByAccount(
        address _indexToken,
        uint256 _sizeDelta,
        address _collateralToken,
        uint256 _collateralDelta,
        bool _isLong,
        uint256 _triggerPrice,
        bool _triggerAboveThreshold,
        address _from
    ) external payable;

    function cancelDecreaseOrder(uint256 _orderIndex) external;

    function cancelDecreaseOrderByAccount(
        uint256 _orderIndex,
        address _from
    ) external;

    function updateDecreaseOrder(
        uint256 _orderIndex,
        uint256 _collateralDelta,
        uint256 _sizeDelta,
        uint256 _triggerPrice,
        bool _triggerAboveThreshold
    ) external;

    function updateDecreaseOrderByAccount(
        uint256 _orderIndex,
        uint256 _collateralDelta,
        uint256 _sizeDelta,
        uint256 _triggerPrice,
        bool _triggerAboveThreshold,
        address _from
    ) external;

    function cancelMultiple(
        uint256[] memory _swapOrderIndexes,
        uint256[] memory _increaseOrderIndexes,
        uint256[] memory _decreaseOrderIndexes
    ) external;

    function cancelMultipleByAccount(
        uint256[] memory _swapOrderIndexes,
        uint256[] memory _increaseOrderIndexes,
        uint256[] memory _decreaseOrderIndexes,
        address _from
    ) external;
}
