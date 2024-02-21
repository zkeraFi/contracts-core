// SPDX-License-Identifier: MIT

pragma solidity 0.8.18;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "../core/OrderBookV2.sol";
import "../core/PositionRouterV2.sol";
import "@openzeppelin/contracts/security/ReentrancyGuard.sol";

contract ZkeMulticall is ReentrancyGuard {
    address public gov;
    PositionRouterV2 public positionRouter;
    OrderBookV2 public orderBook;
    uint256 public minExecutionFee;
    bool public migrated = false;

    event UpdateGov(address gov);
    event UpdatePositionRouter(address positionRouter);
    event UpdateOrderBook(address orderBook);
    event SetMinExecutionFee(uint256 minExecutionFee);

    modifier onlyGov() {
        require(msg.sender == gov, "ZkeMulticall: forbidden");
        _;
    }

    constructor(
        PositionRouterV2 _positionRouter,
        OrderBookV2 _orderBook,
        uint256 _minExecutionFee
    ) {
        gov = msg.sender;
        positionRouter = _positionRouter;
        orderBook = _orderBook;
        minExecutionFee = _minExecutionFee;
    }

    function multicall(
        bytes[] calldata data
    ) external payable nonReentrant returns (bytes[] memory results) {
        results = new bytes[](data.length);

        for (uint256 i; i < data.length; i++) {
            (bool success, bytes memory result) = address(this).delegatecall(
                data[i]
            );

            require(success, string(result));

            results[i] = result;
        }

        return results;
    }

    function migration(bytes[] calldata data) external payable onlyGov {
        require(!migrated);
        for (uint256 i; i < data.length; i++) {
            (bool success, bytes memory result) = address(this).delegatecall(
                data[i]
            );

            require(success, string(result));
        }
        migrated = true;
    }

    function setGov(address _gov) external onlyGov {
        gov = _gov;

        emit UpdateGov(_gov);
    }

    function setPositionRouter(
        PositionRouterV2 _positionRouter
    ) external onlyGov {
        positionRouter = _positionRouter;

        emit UpdatePositionRouter(address(_positionRouter));
    }

    function setOrderBook(OrderBookV2 _orderBook) external onlyGov {
        orderBook = _orderBook;

        emit UpdateOrderBook(address(_orderBook));
    }

    function setMinExecutionFee(uint256 _minExecutionFee) external onlyGov {
        minExecutionFee = _minExecutionFee;
        emit SetMinExecutionFee(_minExecutionFee);
    }

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
    ) external payable returns (bytes32) {
        return
            positionRouter.createIncreasePositionByAccount{
                value: _executionFee
            }(
                _path,
                _indexToken,
                _amountIn,
                _minOut,
                _sizeDelta,
                _isLong,
                _acceptablePrice,
                _executionFee,
                _referralCode,
                _callbackTarget,
                msg.sender
            );
    }

    function createIncreasePositionETH(
        address[] memory _path,
        uint256 _amountIn,
        address _indexToken,
        uint256 _minOut,
        uint256 _sizeDelta,
        bool _isLong,
        uint256 _acceptablePrice,
        uint256 _executionFee,
        bytes32 _referralCode,
        address _callbackTarget
    ) external payable returns (bytes32) {
        return
            positionRouter.createIncreasePositionETHByAccount{
                value: _amountIn + _executionFee
            }(
                _path,
                _indexToken,
                _minOut,
                _sizeDelta,
                _isLong,
                _acceptablePrice,
                _executionFee,
                _referralCode,
                _callbackTarget,
                msg.sender
            );
    }

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
    ) external payable returns (bytes32) {
        return
            positionRouter.createDecreasePositionByAccount{
                value: _executionFee
            }(
                _path,
                _indexToken,
                _collateralDelta,
                _sizeDelta,
                _isLong,
                _receiver,
                _acceptablePrice,
                _minOut,
                _executionFee,
                _withdrawETH,
                _callbackTarget,
                msg.sender
            );
    }

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
        bytes[] calldata priceUpdateData,
        uint256 fee
    ) external payable {
        uint256 _value = _shouldWrap
            ? _executionFee + fee + _amountIn
            : _executionFee + fee;
        orderBook.createIncreaseOrderByAccount{value: _value}(
            _path,
            _amountIn,
            _indexToken,
            _minOut,
            _sizeDelta,
            _collateralToken,
            _isLong,
            _triggerPrice,
            _triggerAboveThreshold,
            _executionFee,
            _shouldWrap,
            priceUpdateData,
            msg.sender
        );
    }

    function updateIncreaseOrder(
        uint256 _orderIndex,
        uint256 _sizeDelta,
        uint256 _triggerPrice,
        bool _triggerAboveThreshold
    ) external payable {
        orderBook.updateIncreaseOrderByAccount(
            _orderIndex,
            _sizeDelta,
            _triggerPrice,
            _triggerAboveThreshold,
            msg.sender
        );
    }

    function cancelIncreaseOrder(uint256 _orderIndex) external payable {
        orderBook.cancelIncreaseOrderByAccount(_orderIndex, msg.sender);
    }

    function createDecreaseOrder(
        address _indexToken,
        uint256 _sizeDelta,
        address _collateralToken,
        uint256 _collateralDelta,
        bool _isLong,
        uint256 _triggerPrice,
        bool _triggerAboveThreshold
    ) external payable {
        orderBook.createDecreaseOrderByAccount{value: minExecutionFee}(
            _indexToken,
            _sizeDelta,
            _collateralToken,
            _collateralDelta,
            _isLong,
            _triggerPrice,
            _triggerAboveThreshold,
            msg.sender
        );
    }

    function createDecreaseOrderMigration(
        address _indexToken,
        uint256 _sizeDelta,
        address _collateralToken,
        uint256 _collateralDelta,
        bool _isLong,
        uint256 _triggerPrice,
        bool _triggerAboveThreshold,
        address _from
    ) external payable {
        require(!migrated);
        orderBook.createDecreaseOrderByAccount{value: minExecutionFee}(
            _indexToken,
            _sizeDelta,
            _collateralToken,
            _collateralDelta,
            _isLong,
            _triggerPrice,
            _triggerAboveThreshold,
            _from
        );
    }

    function updateDecreaseOrder(
        uint256 _orderIndex,
        uint256 _collateralDelta,
        uint256 _sizeDelta,
        uint256 _triggerPrice,
        bool _triggerAboveThreshold
    ) external payable {
        orderBook.updateDecreaseOrderByAccount(
            _orderIndex,
            _collateralDelta,
            _sizeDelta,
            _triggerPrice,
            _triggerAboveThreshold,
            msg.sender
        );
    }

    function cancelDecreaseOrder(uint256 _orderIndex) external payable {
        orderBook.cancelDecreaseOrderByAccount(_orderIndex, msg.sender);
    }

    function withdrawToken(
        address _token,
        uint256 _amount,
        address _to
    ) external onlyGov {
        IERC20(_token).transfer(_to, _amount);
    }

    function withdrawETH(uint256 _amount, address _to) external onlyGov {
        (bool success, ) = _to.call{value: _amount}("");
        require(success, "WETH: withdraw failed");
    }
}
