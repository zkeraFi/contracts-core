// SPDX-License-Identifier: MIT

pragma solidity 0.8.18;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/utils/Address.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/security/ReentrancyGuard.sol";
import "@pythnetwork/pyth-sdk-solidity/IPyth.sol";

import "../tokens/interfaces/IWETH_0_8_18.sol";
import "./interfaces/IRouter_0_8_18.sol";
import "./interfaces/IVault_0_8_18.sol";
import "./interfaces/IOrderBook_0_8_18.sol";

contract OrderBookV2 is ReentrancyGuard, IOrderBook_0_8_18 {
    using SafeERC20 for IERC20;
    using Address for address payable;

    uint256 public constant PRICE_PRECISION = 1e30;
    uint256 public constant USDG_PRECISION = 1e18;

    struct IncreaseOrder {
        address account;
        address purchaseToken;
        uint256 purchaseTokenAmount;
        address collateralToken;
        address indexToken;
        uint256 sizeDelta;
        bool isLong;
        uint256 triggerPrice;
        bool triggerAboveThreshold;
        uint256 executionFee;
    }
    struct DecreaseOrder {
        address account;
        address collateralToken;
        uint256 collateralDelta;
        address indexToken;
        uint256 sizeDelta;
        bool isLong;
        uint256 triggerPrice;
        bool triggerAboveThreshold;
        uint256 executionFee;
    }
    struct SwapOrder {
        address account;
        address[] path;
        uint256 amountIn;
        uint256 minOut;
        uint256 triggerRatio;
        bool triggerAboveThreshold;
        bool shouldUnwrap;
        uint256 executionFee;
    }

    mapping(address => mapping(uint256 => IncreaseOrder)) public increaseOrders;
    mapping(address => uint256) public increaseOrdersIndex;
    mapping(address => mapping(uint256 => DecreaseOrder)) public decreaseOrders;
    mapping(address => uint256) public decreaseOrdersIndex;
    mapping(address => mapping(uint256 => SwapOrder)) public swapOrders;
    mapping(address => uint256) public swapOrdersIndex;
    mapping(address => bool) public isHandler;

    address public gov;
    address public weth;
    address public usdg;
    address public router;
    address public vault;
    IPyth pyth;
    uint256 public minExecutionFee;
    uint256 public minPurchaseTokenAmountUsd;
    bool public isInitialized = false;

    event CreateIncreaseOrder(
        address indexed account,
        uint256 orderIndex,
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
    event CancelIncreaseOrder(
        address indexed account,
        uint256 orderIndex,
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
    event ExecuteIncreaseOrder(
        address indexed account,
        uint256 orderIndex,
        address purchaseToken,
        uint256 purchaseTokenAmount,
        address collateralToken,
        address indexToken,
        uint256 sizeDelta,
        bool isLong,
        uint256 triggerPrice,
        bool triggerAboveThreshold,
        uint256 executionFee,
        uint256 executionPrice
    );
    event UpdateIncreaseOrder(
        address indexed account,
        uint256 orderIndex,
        address collateralToken,
        address indexToken,
        bool isLong,
        uint256 sizeDelta,
        uint256 triggerPrice,
        bool triggerAboveThreshold
    );
    event CreateDecreaseOrder(
        address indexed account,
        uint256 orderIndex,
        address collateralToken,
        uint256 collateralDelta,
        address indexToken,
        uint256 sizeDelta,
        bool isLong,
        uint256 triggerPrice,
        bool triggerAboveThreshold,
        uint256 executionFee
    );
    event CancelDecreaseOrder(
        address indexed account,
        uint256 orderIndex,
        address collateralToken,
        uint256 collateralDelta,
        address indexToken,
        uint256 sizeDelta,
        bool isLong,
        uint256 triggerPrice,
        bool triggerAboveThreshold,
        uint256 executionFee
    );
    event ExecuteDecreaseOrder(
        address indexed account,
        uint256 orderIndex,
        address collateralToken,
        uint256 collateralDelta,
        address indexToken,
        uint256 sizeDelta,
        bool isLong,
        uint256 triggerPrice,
        bool triggerAboveThreshold,
        uint256 executionFee,
        uint256 executionPrice
    );
    event UpdateDecreaseOrder(
        address indexed account,
        uint256 orderIndex,
        address collateralToken,
        uint256 collateralDelta,
        address indexToken,
        uint256 sizeDelta,
        bool isLong,
        uint256 triggerPrice,
        bool triggerAboveThreshold
    );
    event CreateSwapOrder(
        address indexed account,
        uint256 orderIndex,
        address[] path,
        uint256 amountIn,
        uint256 minOut,
        uint256 triggerRatio,
        bool triggerAboveThreshold,
        bool shouldUnwrap,
        uint256 executionFee
    );
    event CancelSwapOrder(
        address indexed account,
        uint256 orderIndex,
        address[] path,
        uint256 amountIn,
        uint256 minOut,
        uint256 triggerRatio,
        bool triggerAboveThreshold,
        bool shouldUnwrap,
        uint256 executionFee
    );
    event UpdateSwapOrder(
        address indexed account,
        uint256 ordexIndex,
        address[] path,
        uint256 amountIn,
        uint256 minOut,
        uint256 triggerRatio,
        bool triggerAboveThreshold,
        bool shouldUnwrap,
        uint256 executionFee
    );
    event ExecuteSwapOrder(
        address indexed account,
        uint256 orderIndex,
        address[] path,
        uint256 amountIn,
        uint256 minOut,
        uint256 amountOut,
        uint256 triggerRatio,
        bool triggerAboveThreshold,
        bool shouldUnwrap,
        uint256 executionFee
    );

    event Initialize(
        address router,
        address vault,
        address weth,
        address usdg,
        uint256 minExecutionFee,
        uint256 minPurchaseTokenAmountUsd
    );
    event UpdateMinExecutionFee(uint256 minExecutionFee);
    event UpdateMinPurchaseTokenAmountUsd(uint256 minPurchaseTokenAmountUsd);
    event UpdateGov(address gov);
    event SetHandler(address handler, bool isHandler);
    event SetPyth(address pyth);

    modifier onlyGov() {
        require(msg.sender == gov, "OrderBook: forbidden");
        _;
    }

    modifier onlyHandler() {
        require(isHandler[msg.sender], "OrderBook: forbidden");
        _;
    }

    constructor() {
        gov = msg.sender;
    }

    function initialize(
        address _router,
        address _vault,
        address _weth,
        address _usdg,
        uint256 _minExecutionFee,
        uint256 _minPurchaseTokenAmountUsd,
        IPyth _pyth
    ) external onlyGov {
        require(!isInitialized, "OrderBook: already initialized");
        isInitialized = true;

        router = _router;
        vault = _vault;
        weth = _weth;
        usdg = _usdg;
        minExecutionFee = _minExecutionFee;
        minPurchaseTokenAmountUsd = _minPurchaseTokenAmountUsd;
        pyth = _pyth;

        emit Initialize(
            _router,
            _vault,
            _weth,
            _usdg,
            _minExecutionFee,
            _minPurchaseTokenAmountUsd
        );
    }

    receive() external payable {
        require(msg.sender == weth, "OrderBook: invalid sender");
    }

    function setPyth(IPyth _pyth) external onlyGov {
        pyth = _pyth;
        emit SetPyth(address(_pyth));
    }

    function setHandler(address _handler, bool _isActive) external onlyGov {
        isHandler[_handler] = _isActive;
        emit SetHandler(_handler, _isActive);
    }

    function setMinExecutionFee(uint256 _minExecutionFee) external onlyGov {
        minExecutionFee = _minExecutionFee;

        emit UpdateMinExecutionFee(_minExecutionFee);
    }

    function setMinPurchaseTokenAmountUsd(
        uint256 _minPurchaseTokenAmountUsd
    ) external onlyGov {
        minPurchaseTokenAmountUsd = _minPurchaseTokenAmountUsd;

        emit UpdateMinPurchaseTokenAmountUsd(_minPurchaseTokenAmountUsd);
    }

    function setGov(address _gov) external onlyGov {
        gov = _gov;

        emit UpdateGov(_gov);
    }

    function getSwapOrder(
        address _account,
        uint256 _orderIndex
    )
        public
        view
        override
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
        )
    {
        SwapOrder memory order = swapOrders[_account][_orderIndex];
        return (
            order.path.length > 0 ? order.path[0] : address(0),
            order.path.length > 1 ? order.path[1] : address(0),
            order.path.length > 2 ? order.path[2] : address(0),
            order.amountIn,
            order.minOut,
            order.triggerRatio,
            order.triggerAboveThreshold,
            order.shouldUnwrap,
            order.executionFee
        );
    }

    function createSwapOrder(
        address[] memory _path,
        uint256 _amountIn,
        uint256 _minOut,
        uint256 _triggerRatio, // tokenB / tokenA
        bool _triggerAboveThreshold,
        uint256 _executionFee,
        bool _shouldWrap,
        bool _shouldUnwrap
    ) external payable nonReentrant {
        _proceedCreateSwapOrder(
            _path,
            _amountIn,
            _minOut,
            _triggerRatio,
            _triggerAboveThreshold,
            _executionFee,
            _shouldWrap,
            _shouldUnwrap,
            msg.sender
        );
    }

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
    ) external payable nonReentrant onlyHandler {
        _proceedCreateSwapOrder(
            _path,
            _amountIn,
            _minOut,
            _triggerRatio,
            _triggerAboveThreshold,
            _executionFee,
            _shouldWrap,
            _shouldUnwrap,
            _from
        );
    }

    function _createSwapOrder(
        address _account,
        address[] memory _path,
        uint256 _amountIn,
        uint256 _minOut,
        uint256 _triggerRatio,
        bool _triggerAboveThreshold,
        bool _shouldUnwrap,
        uint256 _executionFee
    ) private {
        uint256 _orderIndex = swapOrdersIndex[_account];
        SwapOrder memory order = SwapOrder(
            _account,
            _path,
            _amountIn,
            _minOut,
            _triggerRatio,
            _triggerAboveThreshold,
            _shouldUnwrap,
            _executionFee
        );
        swapOrdersIndex[_account] = _orderIndex + 1;
        swapOrders[_account][_orderIndex] = order;

        emit CreateSwapOrder(
            _account,
            _orderIndex,
            _path,
            _amountIn,
            _minOut,
            _triggerRatio,
            _triggerAboveThreshold,
            _shouldUnwrap,
            _executionFee
        );
    }

    function cancelMultiple(
        uint256[] memory _swapOrderIndexes,
        uint256[] memory _increaseOrderIndexes,
        uint256[] memory _decreaseOrderIndexes
    ) external {
        for (uint256 i = 0; i < _swapOrderIndexes.length; i++) {
            cancelSwapOrder(_swapOrderIndexes[i]);
        }
        for (uint256 i = 0; i < _increaseOrderIndexes.length; i++) {
            cancelIncreaseOrder(_increaseOrderIndexes[i]);
        }
        for (uint256 i = 0; i < _decreaseOrderIndexes.length; i++) {
            cancelDecreaseOrder(_decreaseOrderIndexes[i]);
        }
    }

    function cancelMultipleByAccount(
        uint256[] memory _swapOrderIndexes,
        uint256[] memory _increaseOrderIndexes,
        uint256[] memory _decreaseOrderIndexes,
        address _from
    ) external onlyHandler {
        for (uint256 i = 0; i < _swapOrderIndexes.length; i++) {
            cancelSwapOrderByAccount(_swapOrderIndexes[i], _from);
        }
        for (uint256 i = 0; i < _increaseOrderIndexes.length; i++) {
            cancelIncreaseOrderByAccount(_increaseOrderIndexes[i], _from);
        }
        for (uint256 i = 0; i < _decreaseOrderIndexes.length; i++) {
            cancelDecreaseOrderByAccount(_decreaseOrderIndexes[i], _from);
        }
    }

    function cancelSwapOrder(uint256 _orderIndex) public nonReentrant {
        _proceedCancelSwapOrder(_orderIndex, msg.sender);
    }

    function cancelSwapOrderByAccount(
        uint256 _orderIndex,
        address _from
    ) public nonReentrant onlyHandler {
        _proceedCancelSwapOrder(_orderIndex, _from);
    }

    function getUsdgMinPrice(
        address _otherToken
    ) public view returns (uint256) {
        // USDG_PRECISION is the same as 1 USDG
        uint256 redemptionAmount = IVault_0_8_18(vault).getRedemptionAmount(
            _otherToken,
            USDG_PRECISION
        );
        uint256 otherTokenPrice = IVault_0_8_18(vault).getMinPrice(_otherToken);

        uint256 otherTokenDecimals = IVault_0_8_18(vault).tokenDecimals(
            _otherToken
        );
        return
            (redemptionAmount * otherTokenPrice) / (10 ** otherTokenDecimals);
    }

    function validateSwapOrderPriceWithTriggerAboveThreshold(
        address[] memory _path,
        uint256 _triggerRatio
    ) public view returns (bool) {
        require(
            _path.length == 2 || _path.length == 3,
            "OrderBook: invalid _path.length"
        );

        // limit orders don't need this validation because minOut is enough
        // so this validation handles scenarios for stop orders only
        // when a user wants to swap when a price of tokenB increases relative to tokenA
        address tokenA = _path[0];
        address tokenB = _path[_path.length - 1];
        uint256 tokenAPrice;
        uint256 tokenBPrice;

        // 1. USDG doesn't have a price feed so we need to calculate it based on redepmtion amount of a specific token
        // That's why USDG price in USD can vary depending on the redepmtion token
        // 2. In complex scenarios with path=[USDG, BNB, BTC] we need to know how much BNB we'll get for provided USDG
        // to know how much BTC will be received
        // That's why in such scenario BNB should be used to determine price of USDG
        if (tokenA == usdg) {
            // with both _path.length == 2 or 3 we need usdg price against _path[1]
            tokenAPrice = getUsdgMinPrice(_path[1]);
        } else {
            tokenAPrice = IVault_0_8_18(vault).getMinPrice(tokenA);
        }

        if (tokenB == usdg) {
            tokenBPrice = PRICE_PRECISION;
        } else {
            tokenBPrice = IVault_0_8_18(vault).getMaxPrice(tokenB);
        }

        uint256 currentRatio = (tokenBPrice * PRICE_PRECISION) / tokenAPrice;

        bool isValid = currentRatio > _triggerRatio;
        return isValid;
    }

    function updateSwapOrder(
        uint256 _orderIndex,
        uint256 _minOut,
        uint256 _triggerRatio,
        bool _triggerAboveThreshold
    ) external nonReentrant {
        _proceedUpdateSwapOrder(
            _orderIndex,
            _minOut,
            _triggerRatio,
            _triggerAboveThreshold,
            msg.sender
        );
    }

    function updateSwapOrderByAccount(
        uint256 _orderIndex,
        uint256 _minOut,
        uint256 _triggerRatio,
        bool _triggerAboveThreshold,
        address _from
    ) external nonReentrant onlyHandler {
        _proceedUpdateSwapOrder(
            _orderIndex,
            _minOut,
            _triggerRatio,
            _triggerAboveThreshold,
            _from
        );
    }

    function executeSwapOrder(
        address _account,
        uint256 _orderIndex,
        address payable _feeReceiver
    ) external override nonReentrant {
        _executeSwapOrder(_account, _orderIndex, _feeReceiver);
    }

    function executeSwapOrder(
        address _account,
        uint256 _orderIndex,
        address payable _feeReceiver,
        bytes[] calldata priceUpdateData
    ) external payable override nonReentrant {
        _updatePrice(priceUpdateData);
        _executeSwapOrder(_account, _orderIndex, _feeReceiver);
    }

    function _proceedCreateSwapOrder(
        address[] memory _path,
        uint256 _amountIn,
        uint256 _minOut,
        uint256 _triggerRatio, // tokenB / tokenA
        bool _triggerAboveThreshold,
        uint256 _executionFee,
        bool _shouldWrap,
        bool _shouldUnwrap,
        address _from
    ) internal {
        require(
            _path.length == 2 || _path.length == 3,
            "OrderBook: invalid _path.length"
        );
        require(
            _path[0] != _path[_path.length - 1],
            "OrderBook: invalid _path"
        );
        require(_amountIn > 0, "OrderBook: invalid _amountIn");
        require(
            _executionFee >= minExecutionFee,
            "OrderBook: insufficient execution fee"
        );

        // always need this call because of mandatory executionFee user has to transfer in ETH
        _transferInETH(msg.value);

        if (_shouldWrap) {
            require(_path[0] == weth, "OrderBook: only weth could be wrapped");
            require(
                msg.value == _executionFee + _amountIn,
                "OrderBook: incorrect value transferred"
            );
        } else {
            require(
                msg.value == _executionFee,
                "OrderBook: incorrect execution fee transferred"
            );
            IRouter_0_8_18(router).pluginTransfer(
                _path[0],
                _from,
                address(this),
                _amountIn
            );
        }

        _createSwapOrder(
            _from,
            _path,
            _amountIn,
            _minOut,
            _triggerRatio,
            _triggerAboveThreshold,
            _shouldUnwrap,
            _executionFee
        );
    }

    function _proceedCancelSwapOrder(
        uint256 _orderIndex,
        address _from
    ) internal {
        SwapOrder memory order = swapOrders[_from][_orderIndex];
        require(order.account != address(0), "OrderBook: non-existent order");

        delete swapOrders[_from][_orderIndex];

        if (order.path[0] == weth) {
            _transferOutETH(
                order.executionFee + order.amountIn,
                payable(_from)
            );
        } else {
            IERC20(order.path[0]).safeTransfer(_from, order.amountIn);
            _transferOutETH(order.executionFee, payable(_from));
        }

        emit CancelSwapOrder(
            _from,
            _orderIndex,
            order.path,
            order.amountIn,
            order.minOut,
            order.triggerRatio,
            order.triggerAboveThreshold,
            order.shouldUnwrap,
            order.executionFee
        );
    }

    function _proceedUpdateSwapOrder(
        uint256 _orderIndex,
        uint256 _minOut,
        uint256 _triggerRatio,
        bool _triggerAboveThreshold,
        address _from
    ) internal {
        SwapOrder storage order = swapOrders[_from][_orderIndex];
        require(order.account != address(0), "OrderBook: non-existent order");

        order.minOut = _minOut;
        order.triggerRatio = _triggerRatio;
        order.triggerAboveThreshold = _triggerAboveThreshold;

        emit UpdateSwapOrder(
            _from,
            _orderIndex,
            order.path,
            order.amountIn,
            _minOut,
            _triggerRatio,
            _triggerAboveThreshold,
            order.shouldUnwrap,
            order.executionFee
        );
    }

    function _proceedCreateIncreaseOrder(
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
    ) internal {
        uint256 newMsgValue = _updatePrice(priceUpdateData);
        // always need this call because of mandatory executionFee user has to transfer in ETH
        _transferInETH(newMsgValue);

        require(
            _executionFee >= minExecutionFee,
            "OrderBook: insufficient execution fee"
        );
        if (_shouldWrap) {
            require(_path[0] == weth, "OrderBook: only weth could be wrapped");
            require(
                newMsgValue == _executionFee + _amountIn,
                "OrderBook: incorrect value transferred"
            );
        } else {
            require(
                newMsgValue == _executionFee,
                "OrderBook: incorrect execution fee transferred"
            );
            IRouter_0_8_18(router).pluginTransfer(
                _path[0],
                _from,
                address(this),
                _amountIn
            );
        }

        address _purchaseToken = _path[_path.length - 1];
        uint256 _purchaseTokenAmount;
        if (_path.length > 1) {
            require(_path[0] != _purchaseToken, "OrderBook: invalid _path");
            IERC20(_path[0]).safeTransfer(vault, _amountIn);
            _purchaseTokenAmount = _swap(_path, _minOut, address(this));
        } else {
            _purchaseTokenAmount = _amountIn;
        }

        {
            uint256 _purchaseTokenAmountUsd = IVault_0_8_18(vault)
                .tokenToUsdMin(_purchaseToken, _purchaseTokenAmount);
            require(
                _purchaseTokenAmountUsd >= minPurchaseTokenAmountUsd,
                "OrderBook: insufficient collateral"
            );
        }

        _createIncreaseOrder(
            _from,
            _purchaseToken,
            _purchaseTokenAmount,
            _collateralToken,
            _indexToken,
            _sizeDelta,
            _isLong,
            _triggerPrice,
            _triggerAboveThreshold,
            _executionFee
        );
    }

    function _proceedCancelIncreaseOrder(
        uint256 _orderIndex,
        address _from
    ) internal {
        IncreaseOrder memory order = increaseOrders[_from][_orderIndex];
        require(order.account != address(0), "OrderBook: non-existent order");

        delete increaseOrders[_from][_orderIndex];

        if (order.purchaseToken == weth) {
            _transferOutETH(
                order.executionFee + order.purchaseTokenAmount,
                payable(_from)
            );
        } else {
            IERC20(order.purchaseToken).safeTransfer(
                _from,
                order.purchaseTokenAmount
            );
            _transferOutETH(order.executionFee, payable(_from));
        }

        emit CancelIncreaseOrder(
            order.account,
            _orderIndex,
            order.purchaseToken,
            order.purchaseTokenAmount,
            order.collateralToken,
            order.indexToken,
            order.sizeDelta,
            order.isLong,
            order.triggerPrice,
            order.triggerAboveThreshold,
            order.executionFee
        );
    }

    function _proceedCreateDecreaseOrder(
        address _indexToken,
        uint256 _sizeDelta,
        address _collateralToken,
        uint256 _collateralDelta,
        bool _isLong,
        uint256 _triggerPrice,
        bool _triggerAboveThreshold,
        address _from
    ) internal {
        _transferInETH(msg.value);

        require(
            msg.value >= minExecutionFee,
            "OrderBook: insufficient execution fee"
        );

        _createDecreaseOrder(
            _from,
            _collateralToken,
            _collateralDelta,
            _indexToken,
            _sizeDelta,
            _isLong,
            _triggerPrice,
            _triggerAboveThreshold,
            msg.value
        );
    }

    function _proceedCancelDecreaseOrder(
        uint256 _orderIndex,
        address _from
    ) internal {
        DecreaseOrder memory order = decreaseOrders[_from][_orderIndex];
        require(order.account != address(0), "OrderBook: non-existent order");

        delete decreaseOrders[_from][_orderIndex];
        _transferOutETH(order.executionFee, payable(_from));

        emit CancelDecreaseOrder(
            order.account,
            _orderIndex,
            order.collateralToken,
            order.collateralDelta,
            order.indexToken,
            order.sizeDelta,
            order.isLong,
            order.triggerPrice,
            order.triggerAboveThreshold,
            order.executionFee
        );
    }

    function _executeSwapOrder(
        address _account,
        uint256 _orderIndex,
        address payable _feeReceiver
    ) internal {
        SwapOrder memory order = swapOrders[_account][_orderIndex];
        require(order.account != address(0), "OrderBook: non-existent order");

        if (order.triggerAboveThreshold) {
            // gas optimisation
            // order.minAmount should prevent wrong price execution in case of simple limit order
            require(
                validateSwapOrderPriceWithTriggerAboveThreshold(
                    order.path,
                    order.triggerRatio
                ),
                "OrderBook: invalid price for execution"
            );
        }

        delete swapOrders[_account][_orderIndex];

        IERC20(order.path[0]).safeTransfer(vault, order.amountIn);

        uint256 _amountOut;
        if (order.path[order.path.length - 1] == weth && order.shouldUnwrap) {
            _amountOut = _swap(order.path, order.minOut, address(this));
            _transferOutETH(_amountOut, payable(order.account));
        } else {
            _amountOut = _swap(order.path, order.minOut, order.account);
        }

        // pay executor
        _transferOutETH(order.executionFee, _feeReceiver);

        emit ExecuteSwapOrder(
            _account,
            _orderIndex,
            order.path,
            order.amountIn,
            order.minOut,
            _amountOut,
            order.triggerRatio,
            order.triggerAboveThreshold,
            order.shouldUnwrap,
            order.executionFee
        );
    }

    function validatePositionOrderPrice(
        bool _triggerAboveThreshold,
        uint256 _triggerPrice,
        address _indexToken,
        bool _maximizePrice,
        bool _raise
    ) public view returns (uint256, bool) {
        uint256 currentPrice = _maximizePrice
            ? IVault_0_8_18(vault).getMaxPrice(_indexToken)
            : IVault_0_8_18(vault).getMinPrice(_indexToken);
        bool isPriceValid = _triggerAboveThreshold
            ? currentPrice > _triggerPrice
            : currentPrice < _triggerPrice;
        if (_raise) {
            require(isPriceValid, "OrderBook: invalid price for execution");
        }
        return (currentPrice, isPriceValid);
    }

    function getDecreaseOrder(
        address _account,
        uint256 _orderIndex
    )
        public
        view
        override
        returns (
            address collateralToken,
            uint256 collateralDelta,
            address indexToken,
            uint256 sizeDelta,
            bool isLong,
            uint256 triggerPrice,
            bool triggerAboveThreshold,
            uint256 executionFee
        )
    {
        DecreaseOrder memory order = decreaseOrders[_account][_orderIndex];
        return (
            order.collateralToken,
            order.collateralDelta,
            order.indexToken,
            order.sizeDelta,
            order.isLong,
            order.triggerPrice,
            order.triggerAboveThreshold,
            order.executionFee
        );
    }

    function getIncreaseOrder(
        address _account,
        uint256 _orderIndex
    )
        public
        view
        override
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
        )
    {
        IncreaseOrder memory order = increaseOrders[_account][_orderIndex];
        return (
            order.purchaseToken,
            order.purchaseTokenAmount,
            order.collateralToken,
            order.indexToken,
            order.sizeDelta,
            order.isLong,
            order.triggerPrice,
            order.triggerAboveThreshold,
            order.executionFee
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
        bytes[] calldata priceUpdateData
    ) external payable nonReentrant {
        _proceedCreateIncreaseOrder(
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
    ) external payable nonReentrant onlyHandler {
        _proceedCreateIncreaseOrder(
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
            _from
        );
    }

    function _createIncreaseOrder(
        address _account,
        address _purchaseToken,
        uint256 _purchaseTokenAmount,
        address _collateralToken,
        address _indexToken,
        uint256 _sizeDelta,
        bool _isLong,
        uint256 _triggerPrice,
        bool _triggerAboveThreshold,
        uint256 _executionFee
    ) private {
        uint256 _orderIndex = increaseOrdersIndex[_account];
        IncreaseOrder memory order = IncreaseOrder(
            _account,
            _purchaseToken,
            _purchaseTokenAmount,
            _collateralToken,
            _indexToken,
            _sizeDelta,
            _isLong,
            _triggerPrice,
            _triggerAboveThreshold,
            _executionFee
        );
        increaseOrdersIndex[_account] = _orderIndex + 1;
        increaseOrders[_account][_orderIndex] = order;

        emit CreateIncreaseOrder(
            _account,
            _orderIndex,
            _purchaseToken,
            _purchaseTokenAmount,
            _collateralToken,
            _indexToken,
            _sizeDelta,
            _isLong,
            _triggerPrice,
            _triggerAboveThreshold,
            _executionFee
        );
    }

    function updateIncreaseOrder(
        uint256 _orderIndex,
        uint256 _sizeDelta,
        uint256 _triggerPrice,
        bool _triggerAboveThreshold
    ) external nonReentrant {
        _proceedUpdateIncreaseOrder(
            _orderIndex,
            _sizeDelta,
            _triggerPrice,
            _triggerAboveThreshold,
            msg.sender
        );
    }

    function updateIncreaseOrderByAccount(
        uint256 _orderIndex,
        uint256 _sizeDelta,
        uint256 _triggerPrice,
        bool _triggerAboveThreshold,
        address _from
    ) external nonReentrant onlyHandler {
        _proceedUpdateIncreaseOrder(
            _orderIndex,
            _sizeDelta,
            _triggerPrice,
            _triggerAboveThreshold,
            _from
        );
    }

    function _proceedUpdateIncreaseOrder(
        uint256 _orderIndex,
        uint256 _sizeDelta,
        uint256 _triggerPrice,
        bool _triggerAboveThreshold,
        address _from
    ) internal {
        IncreaseOrder storage order = increaseOrders[_from][_orderIndex];
        require(order.account != address(0), "OrderBook: non-existent order");

        order.triggerPrice = _triggerPrice;
        order.triggerAboveThreshold = _triggerAboveThreshold;
        order.sizeDelta = _sizeDelta;

        emit UpdateIncreaseOrder(
            _from,
            _orderIndex,
            order.collateralToken,
            order.indexToken,
            order.isLong,
            _sizeDelta,
            _triggerPrice,
            _triggerAboveThreshold
        );
    }

    function _proceedUpdateDecreaseOrder(
        uint256 _orderIndex,
        uint256 _collateralDelta,
        uint256 _sizeDelta,
        uint256 _triggerPrice,
        bool _triggerAboveThreshold,
        address _from
    ) internal {
        DecreaseOrder storage order = decreaseOrders[_from][_orderIndex];
        require(order.account != address(0), "OrderBook: non-existent order");

        order.triggerPrice = _triggerPrice;
        order.triggerAboveThreshold = _triggerAboveThreshold;
        order.sizeDelta = _sizeDelta;
        order.collateralDelta = _collateralDelta;

        emit UpdateDecreaseOrder(
            _from,
            _orderIndex,
            order.collateralToken,
            _collateralDelta,
            order.indexToken,
            _sizeDelta,
            order.isLong,
            _triggerPrice,
            _triggerAboveThreshold
        );
    }

    function cancelIncreaseOrder(uint256 _orderIndex) public nonReentrant {
        _proceedCancelIncreaseOrder(_orderIndex, msg.sender);
    }

    function cancelIncreaseOrderByAccount(
        uint256 _orderIndex,
        address _from
    ) public nonReentrant onlyHandler {
        _proceedCancelIncreaseOrder(_orderIndex, _from);
    }

    function executeIncreaseOrder(
        address _address,
        uint256 _orderIndex,
        address payable _feeReceiver,
        bytes[] calldata priceUpdateData
    ) external payable override nonReentrant onlyHandler {
        _updatePrice(priceUpdateData);
        _executeIncreaseOrder(_address, _orderIndex, _feeReceiver);
    }

    function executeIncreaseOrder(
        address _address,
        uint256 _orderIndex,
        address payable _feeReceiver
    ) external override nonReentrant onlyHandler {
        _executeIncreaseOrder(_address, _orderIndex, _feeReceiver);
    }

    function _executeIncreaseOrder(
        address _address,
        uint256 _orderIndex,
        address payable _feeReceiver
    ) internal {
        IncreaseOrder memory order = increaseOrders[_address][_orderIndex];
        require(order.account != address(0), "OrderBook: non-existent order");

        // increase long should use max price
        // increase short should use min price
        (uint256 currentPrice, ) = validatePositionOrderPrice(
            order.triggerAboveThreshold,
            order.triggerPrice,
            order.indexToken,
            order.isLong,
            true
        );

        delete increaseOrders[_address][_orderIndex];

        IERC20(order.purchaseToken).safeTransfer(
            vault,
            order.purchaseTokenAmount
        );

        if (order.purchaseToken != order.collateralToken) {
            address[] memory path = new address[](2);
            path[0] = order.purchaseToken;
            path[1] = order.collateralToken;

            uint256 amountOut = _swap(path, 0, address(this));
            IERC20(order.collateralToken).safeTransfer(vault, amountOut);
        }

        IRouter_0_8_18(router).pluginIncreasePosition(
            order.account,
            order.collateralToken,
            order.indexToken,
            order.sizeDelta,
            order.isLong
        );

        // pay executor
        _transferOutETH(order.executionFee, _feeReceiver);

        emit ExecuteIncreaseOrder(
            order.account,
            _orderIndex,
            order.purchaseToken,
            order.purchaseTokenAmount,
            order.collateralToken,
            order.indexToken,
            order.sizeDelta,
            order.isLong,
            order.triggerPrice,
            order.triggerAboveThreshold,
            order.executionFee,
            currentPrice
        );
    }

    function createDecreaseOrder(
        address _indexToken,
        uint256 _sizeDelta,
        address _collateralToken,
        uint256 _collateralDelta,
        bool _isLong,
        uint256 _triggerPrice,
        bool _triggerAboveThreshold
    ) external payable nonReentrant {
        _proceedCreateDecreaseOrder(
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

    function createDecreaseOrderByAccount(
        address _indexToken,
        uint256 _sizeDelta,
        address _collateralToken,
        uint256 _collateralDelta,
        bool _isLong,
        uint256 _triggerPrice,
        bool _triggerAboveThreshold,
        address _from
    ) external payable nonReentrant onlyHandler {
        _proceedCreateDecreaseOrder(
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

    function _createDecreaseOrder(
        address _account,
        address _collateralToken,
        uint256 _collateralDelta,
        address _indexToken,
        uint256 _sizeDelta,
        bool _isLong,
        uint256 _triggerPrice,
        bool _triggerAboveThreshold,
        uint256 msgValue
    ) private {
        uint256 _orderIndex = decreaseOrdersIndex[_account];
        DecreaseOrder memory order = DecreaseOrder(
            _account,
            _collateralToken,
            _collateralDelta,
            _indexToken,
            _sizeDelta,
            _isLong,
            _triggerPrice,
            _triggerAboveThreshold,
            msgValue
        );
        decreaseOrdersIndex[_account] = _orderIndex + 1;
        decreaseOrders[_account][_orderIndex] = order;

        emit CreateDecreaseOrder(
            _account,
            _orderIndex,
            _collateralToken,
            _collateralDelta,
            _indexToken,
            _sizeDelta,
            _isLong,
            _triggerPrice,
            _triggerAboveThreshold,
            msgValue
        );
    }

    function executeDecreaseOrder(
        address _address,
        uint256 _orderIndex,
        address payable _feeReceiver,
        bytes[] calldata priceUpdateData
    ) external payable override nonReentrant onlyHandler{
        _updatePrice(priceUpdateData);
        _executeDecreaseOrder(_address, _orderIndex, _feeReceiver);
    }

    function executeDecreaseOrder(
        address _address,
        uint256 _orderIndex,
        address payable _feeReceiver
    ) external override nonReentrant onlyHandler{
        _executeDecreaseOrder(_address, _orderIndex, _feeReceiver);
    }

    function _executeDecreaseOrder(
        address _address,
        uint256 _orderIndex,
        address payable _feeReceiver
    ) internal {
        DecreaseOrder memory order = decreaseOrders[_address][_orderIndex];
        require(order.account != address(0), "OrderBook: non-existent order");

        // decrease long should use min price
        // decrease short should use max price
        (uint256 currentPrice, ) = validatePositionOrderPrice(
            order.triggerAboveThreshold,
            order.triggerPrice,
            order.indexToken,
            !order.isLong,
            true
        );

        delete decreaseOrders[_address][_orderIndex];

        uint256 amountOut = IRouter_0_8_18(router).pluginDecreasePosition(
            order.account,
            order.collateralToken,
            order.indexToken,
            order.collateralDelta,
            order.sizeDelta,
            order.isLong,
            address(this)
        );

        // transfer released collateral to user
        if (order.collateralToken == weth) {
            _transferOutETH(amountOut, payable(order.account));
        } else {
            IERC20(order.collateralToken).safeTransfer(
                order.account,
                amountOut
            );
        }

        // pay executor
        _transferOutETH(order.executionFee, _feeReceiver);

        emit ExecuteDecreaseOrder(
            order.account,
            _orderIndex,
            order.collateralToken,
            order.collateralDelta,
            order.indexToken,
            order.sizeDelta,
            order.isLong,
            order.triggerPrice,
            order.triggerAboveThreshold,
            order.executionFee,
            currentPrice
        );
    }

    function cancelDecreaseOrder(uint256 _orderIndex) public nonReentrant {
        _proceedCancelDecreaseOrder(_orderIndex, msg.sender);
    }

    function cancelDecreaseOrderByAccount(
        uint256 _orderIndex,
        address _from
    ) public nonReentrant onlyHandler {
        _proceedCancelDecreaseOrder(_orderIndex, _from);
    }

    function updateDecreaseOrder(
        uint256 _orderIndex,
        uint256 _collateralDelta,
        uint256 _sizeDelta,
        uint256 _triggerPrice,
        bool _triggerAboveThreshold
    ) external nonReentrant {
        _proceedUpdateDecreaseOrder(
            _orderIndex,
            _collateralDelta,
            _sizeDelta,
            _triggerPrice,
            _triggerAboveThreshold,
            msg.sender
        );
    }

    function updateDecreaseOrderByAccount(
        uint256 _orderIndex,
        uint256 _collateralDelta,
        uint256 _sizeDelta,
        uint256 _triggerPrice,
        bool _triggerAboveThreshold,
        address _from
    ) external nonReentrant onlyHandler {
        _proceedUpdateDecreaseOrder(
            _orderIndex,
            _collateralDelta,
            _sizeDelta,
            _triggerPrice,
            _triggerAboveThreshold,
            _from
        );
    }

    function _transferInETH(uint256 _value) private {
        if (_value != 0) {
            IWETH_0_8_18(weth).deposit{value: _value}();
        }
    }

    function _transferOutETH(
        uint256 _amountOut,
        address payable _receiver
    ) private {
        IWETH_0_8_18(weth).withdraw(_amountOut);
        _receiver.sendValue(_amountOut);
    }

    function _swap(
        address[] memory _path,
        uint256 _minOut,
        address _receiver
    ) private returns (uint256) {
        if (_path.length == 2) {
            return _vaultSwap(_path[0], _path[1], _minOut, _receiver);
        }
        if (_path.length == 3) {
            uint256 midOut = _vaultSwap(_path[0], _path[1], 0, address(this));
            IERC20(_path[1]).safeTransfer(vault, midOut);
            return _vaultSwap(_path[1], _path[2], _minOut, _receiver);
        }

        revert("OrderBook: invalid _path.length");
    }

    function _vaultSwap(
        address _tokenIn,
        address _tokenOut,
        uint256 _minOut,
        address _receiver
    ) private returns (uint256) {
        uint256 amountOut;

        if (_tokenOut == usdg) {
            // buyUSDG
            amountOut = IVault_0_8_18(vault).buyUSDG(_tokenIn, _receiver);
        } else if (_tokenIn == usdg) {
            // sellUSDG
            amountOut = IVault_0_8_18(vault).sellUSDG(_tokenOut, _receiver);
        } else {
            // swap
            amountOut = IVault_0_8_18(vault).swap(
                _tokenIn,
                _tokenOut,
                _receiver
            );
        }

        require(amountOut >= _minOut, "OrderBook: insufficient amountOut");
        return amountOut;
    }

    function _updatePrice(
        bytes[] calldata priceUpdateData
    ) private returns (uint256) {
        uint256 fee = pyth.getUpdateFee(priceUpdateData);
        require(msg.value >= fee, "OrderBookV2: use correct price update fee");
        pyth.updatePriceFeeds{value: fee}(priceUpdateData);
        return msg.value - fee;
    }
}
