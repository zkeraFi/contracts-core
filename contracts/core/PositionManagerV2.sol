// SPDX-License-Identifier: MIT

pragma solidity 0.8.18;

import "./interfaces/IRouter_0_8_18.sol";
import "./interfaces/IVault_0_8_18.sol";
import "./interfaces/IOrderBook_0_8_18.sol";
import "./interfaces/IShortsTracker_0_8_18.sol";
import "@pythnetwork/pyth-sdk-solidity/IPyth.sol";

import "../peripherals/interfaces/ITimelock_0_8_18.sol";
import "./BasePositionManager_0_8_18.sol";

contract PositionManagerV2 is BasePositionManager_0_8_18 {
    using SafeERC20 for IERC20;
    address public orderBook;
    bool public inLegacyMode;

    bool public shouldValidateIncreaseOrder = true;

    mapping (address => bool) public isOrderKeeper;
    mapping (address => bool) public isPartner;
    mapping (address => bool) public isLiquidator;

    IPyth public pyth;

    event SetOrderKeeper(address indexed account, bool isActive);
    event SetLiquidator(address indexed account, bool isActive);
    event SetPartner(address account, bool isActive);
    event SetInLegacyMode(bool inLegacyMode);
    event SetShouldValidateIncreaseOrder(bool shouldValidateIncreaseOrder);

    modifier onlyOrderKeeper() {
        require(isOrderKeeper[msg.sender], "PositionManager: forbidden");
        _;
    }

    modifier onlyLiquidator() {
        require(isLiquidator[msg.sender], "PositionManager: forbidden");
        _;
    }

    modifier onlyPartnersOrLegacyMode() {
        require(isPartner[msg.sender] || inLegacyMode, "PositionManager: forbidden");
        _;
    }

    constructor(
        address _vault,
        address _router,
        address _shortsTracker,
        address _weth,
        uint256 _depositFee,
        address _orderBook,
        IPyth _pyth
    ) BasePositionManager_0_8_18(_vault, _router, _shortsTracker, _weth, _depositFee) {
        orderBook = _orderBook;
        pyth = _pyth;
    }

    function setPyth(IPyth _pyth) external onlyAdmin {
        pyth = _pyth;
    }

    function setOrderKeeper(address _account, bool _isActive) external onlyAdmin {
        isOrderKeeper[_account] = _isActive;
        emit SetOrderKeeper(_account, _isActive);
    }

    function setLiquidator(address _account, bool _isActive) external onlyAdmin {
        isLiquidator[_account] = _isActive;
        emit SetLiquidator(_account, _isActive);
    }

    function setPartner(address _account, bool _isActive) external onlyAdmin {
        isPartner[_account] = _isActive;
        emit SetPartner(_account, _isActive);
    }

    function setInLegacyMode(bool _inLegacyMode) external onlyAdmin {
        inLegacyMode = _inLegacyMode;
        emit SetInLegacyMode(_inLegacyMode);
    }

    function setShouldValidateIncreaseOrder(bool _shouldValidateIncreaseOrder) external onlyAdmin {
        shouldValidateIncreaseOrder = _shouldValidateIncreaseOrder;
        emit SetShouldValidateIncreaseOrder(_shouldValidateIncreaseOrder);
    }

    function increasePosition(
        address[] memory _path,
        address _indexToken,
        uint256 _amountIn,
        uint256 _minOut,
        uint256 _sizeDelta,
        bool _isLong,
        uint256 _price,
        bytes[] calldata priceUpdateData
    ) external payable nonReentrant onlyPartnersOrLegacyMode {
        _updatePrice(priceUpdateData);
        require(_path.length == 1 || _path.length == 2, "PositionManager: invalid _path.length");

        if (_amountIn > 0) {
            if (_path.length == 1) {
                IRouter_0_8_18(router).pluginTransfer(_path[0], msg.sender, address(this), _amountIn);
            } else {
                IRouter_0_8_18(router).pluginTransfer(_path[0], msg.sender, vault, _amountIn);
                _amountIn = _swap(_path, _minOut, address(this));
            }

            uint256 afterFeeAmount = _collectFees(msg.sender, _path, _amountIn, _indexToken, _isLong, _sizeDelta);
            IERC20(_path[_path.length - 1]).safeTransfer(vault, afterFeeAmount);
        }

        _increasePosition(msg.sender, _path[_path.length - 1], _indexToken, _sizeDelta, _isLong, _price);
    }

    function increasePositionETH(
        address[] memory _path,
        address _indexToken,
        uint256 _minOut,
        uint256 _sizeDelta,
        bool _isLong,
        uint256 _price,
        bytes[] calldata priceUpdateData
    ) external payable nonReentrant onlyPartnersOrLegacyMode {
        uint256 newMsgValue = _updatePrice(priceUpdateData);
        require(_path.length == 1 || _path.length == 2, "PositionManager: invalid _path.length");
        require(_path[0] == weth, "PositionManager: invalid _path");

        if (newMsgValue > 0) {
            _transferInETH(newMsgValue);
            uint256 _amountIn = newMsgValue;

            if (_path.length > 1) {
                IERC20(weth).safeTransfer(vault, newMsgValue);
                _amountIn = _swap(_path, _minOut, address(this));
            }

            uint256 afterFeeAmount = _collectFees(msg.sender, _path, _amountIn, _indexToken, _isLong, _sizeDelta);
            IERC20(_path[_path.length - 1]).safeTransfer(vault, afterFeeAmount);
        }

        _increasePosition(msg.sender, _path[_path.length - 1], _indexToken, _sizeDelta, _isLong, _price);
    }

    function decreasePosition(
        address _collateralToken,
        address _indexToken,
        uint256 _collateralDelta,
        uint256 _sizeDelta,
        bool _isLong,
        address _receiver,
        uint256 _price,
        bytes[] calldata priceUpdateData
    ) external payable nonReentrant onlyPartnersOrLegacyMode {
        _updatePrice(priceUpdateData);
        _decreasePosition(msg.sender, _collateralToken, _indexToken, _collateralDelta, _sizeDelta, _isLong, _receiver, _price);
    }

    function decreasePositionETH(
        address _collateralToken,
        address _indexToken,
        uint256 _collateralDelta,
        uint256 _sizeDelta,
        bool _isLong,
        address payable _receiver,
        uint256 _price,
        bytes[] calldata priceUpdateData
    ) external payable nonReentrant onlyPartnersOrLegacyMode {
        _updatePrice(priceUpdateData);
        require(_collateralToken == weth, "PositionManager: invalid _collateralToken");

        uint256 amountOut = _decreasePosition(msg.sender, _collateralToken, _indexToken, _collateralDelta, _sizeDelta, _isLong, address(this), _price);
        _transferOutETHWithGasLimitFallbackToWeth(amountOut, _receiver);
    }

    function decreasePositionAndSwap(
        address[] memory _path,
        address _indexToken,
        uint256 _collateralDelta,
        uint256 _sizeDelta,
        bool _isLong,
        address _receiver,
        uint256 _price,
        uint256 _minOut,
        bytes[] calldata priceUpdateData
    ) external payable nonReentrant onlyPartnersOrLegacyMode {
        require(_path.length == 2, "PositionManager: invalid _path.length");
        _updatePrice(priceUpdateData);

        uint256 amount = _decreasePosition(msg.sender, _path[0], _indexToken, _collateralDelta, _sizeDelta, _isLong, address(this), _price);
        IERC20(_path[0]).safeTransfer(vault, amount);
        _swap(_path, _minOut, _receiver);
    }

    function decreasePositionAndSwapETH(
        address[] memory _path,
        address _indexToken,
        uint256 _collateralDelta,
        uint256 _sizeDelta,
        bool _isLong,
        address payable _receiver,
        uint256 _price,
        uint256 _minOut,
        bytes[] calldata priceUpdateData
    ) external payable nonReentrant onlyPartnersOrLegacyMode {
        require(_path.length == 2, "PositionManager: invalid _path.length");
        require(_path[_path.length - 1] == weth, "PositionManager: invalid _path");
        _updatePrice(priceUpdateData);

        uint256 amount = _decreasePosition(msg.sender, _path[0], _indexToken, _collateralDelta, _sizeDelta, _isLong, address(this), _price);
        IERC20(_path[0]).safeTransfer(vault, amount);
        uint256 amountOut = _swap(_path, _minOut, address(this));
        _transferOutETHWithGasLimitFallbackToWeth(amountOut, _receiver);
    }

    function liquidatePosition(
        address _account,
        address _collateralToken,
        address _indexToken,
        bool _isLong,
        address _feeReceiver,
        bytes[] calldata priceUpdateData
    ) external payable nonReentrant onlyLiquidator {
        _updatePrice(priceUpdateData);
        address _vault = vault;
        address timelock = IVault_0_8_18(_vault).gov();
        (uint256 size, , , , , , , ) = IVault_0_8_18(vault).getPosition(_account, _collateralToken, _indexToken, _isLong);

        uint256 markPrice = _isLong ? IVault_0_8_18(_vault).getMinPrice(_indexToken) : IVault_0_8_18(_vault).getMaxPrice(_indexToken);
        // should be called strictly before position is updated in Vault
        IShortsTracker_0_8_18(shortsTracker).updateGlobalShortData(_account, _collateralToken, _indexToken, _isLong, size, markPrice, false);

        ITimelock_0_8_18(timelock).enableLeverage(_vault);
        IVault_0_8_18(_vault).liquidatePosition(_account, _collateralToken, _indexToken, _isLong, _feeReceiver);
        ITimelock_0_8_18(timelock).disableLeverage(_vault);
    }

    function executeSwapOrder(address _account, uint256 _orderIndex, address payable _feeReceiver, bytes[] calldata priceUpdateData) external payable onlyOrderKeeper {
        _updatePrice(priceUpdateData);
        IOrderBook_0_8_18(orderBook).executeSwapOrder(_account, _orderIndex, _feeReceiver);
    }

    function executeIncreaseOrder(address _account, uint256 _orderIndex, address payable _feeReceiver, bytes[] calldata priceUpdateData) external payable onlyOrderKeeper {
        _updatePrice(priceUpdateData);
        _validateIncreaseOrder(_account, _orderIndex);

        address _vault = vault;
        address timelock = IVault_0_8_18(_vault).gov();

        (
            /*address purchaseToken*/,
            /*uint256 purchaseTokenAmount*/,
            address collateralToken,
            address indexToken,
            uint256 sizeDelta,
            bool isLong,
            /*uint256 triggerPrice*/,
            /*bool triggerAboveThreshold*/,
            /*uint256 executionFee*/
        ) = IOrderBook_0_8_18(orderBook).getIncreaseOrder(_account, _orderIndex);

        uint256 markPrice = isLong ? IVault_0_8_18(_vault).getMaxPrice(indexToken) : IVault_0_8_18(_vault).getMinPrice(indexToken);
        // should be called strictly before position is updated in Vault
        IShortsTracker_0_8_18(shortsTracker).updateGlobalShortData(_account, collateralToken, indexToken, isLong, sizeDelta, markPrice, true);

        ITimelock_0_8_18(timelock).enableLeverage(_vault);
        IOrderBook_0_8_18(orderBook).executeIncreaseOrder(_account, _orderIndex, _feeReceiver);
        ITimelock_0_8_18(timelock).disableLeverage(_vault);

        _emitIncreasePositionReferral(_account, sizeDelta);
    }

    function executeDecreaseOrder(address _account, uint256 _orderIndex, address payable _feeReceiver, bytes[] calldata priceUpdateData) external payable onlyOrderKeeper {
        _updatePrice(priceUpdateData);
        address _vault = vault;
        address timelock = IVault_0_8_18(_vault).gov();
        (
            address collateralToken,
            /*uint256 collateralDelta*/,
            address indexToken,
            uint256 sizeDelta,
            bool isLong,
            /*uint256 triggerPrice*/,
            /*bool triggerAboveThreshold*/,
            /*uint256 executionFee*/
        ) = IOrderBook_0_8_18(orderBook).getDecreaseOrder(_account, _orderIndex);

        uint256 markPrice = isLong ? IVault_0_8_18(_vault).getMinPrice(indexToken) : IVault_0_8_18(_vault).getMaxPrice(indexToken);
        // should be called strictly before position is updated in Vault
        IShortsTracker_0_8_18(shortsTracker).updateGlobalShortData(_account, collateralToken, indexToken, isLong, sizeDelta, markPrice, false);

        ITimelock_0_8_18(timelock).enableLeverage(_vault);
        IOrderBook_0_8_18(orderBook).executeDecreaseOrder(_account, _orderIndex, _feeReceiver);
        ITimelock_0_8_18(timelock).disableLeverage(_vault);

        _emitDecreasePositionReferral(_account, sizeDelta);
    }

    function _validateIncreaseOrder(address _account, uint256 _orderIndex) internal view {
        (
            address _purchaseToken,
            uint256 _purchaseTokenAmount,
            address _collateralToken,
            address _indexToken,
            uint256 _sizeDelta,
            bool _isLong,
            , // triggerPrice
            , // triggerAboveThreshold
            // executionFee
        ) = IOrderBook_0_8_18(orderBook).getIncreaseOrder(_account, _orderIndex);

        _validateMaxGlobalSize(_indexToken, _isLong, _sizeDelta);

        if (!shouldValidateIncreaseOrder) { return; }

        // shorts are okay
        if (!_isLong) { return; }

        // if the position size is not increasing, this is a collateral deposit
        require(_sizeDelta > 0, "PositionManager: long deposit");

        IVault_0_8_18 _vault = IVault_0_8_18(vault);
        (uint256 size, uint256 collateral, , , , , , ) = _vault.getPosition(_account, _collateralToken, _indexToken, _isLong);

        // if there is no existing position, do not charge a fee
        if (size == 0) { return; }

        uint256 nextSize = size + _sizeDelta;
        uint256 collateralDelta = _vault.tokenToUsdMin(_purchaseToken, _purchaseTokenAmount);
        uint256 nextCollateral = collateral + collateralDelta;

        uint256 prevLeverage = size* BASIS_POINTS_DIVISOR / collateral;
        // allow for a maximum of a increasePositionBufferBps decrease since there might be some swap fees taken from the collateral
        uint256 nextLeverageWithBuffer = nextSize * (BASIS_POINTS_DIVISOR + increasePositionBufferBps) / nextCollateral;

        require(nextLeverageWithBuffer >= prevLeverage, "PositionManager: long leverage decrease");
    }

    function _updatePrice(bytes[] calldata priceUpdateData) private returns(uint256) {
        uint256 fee = pyth.getUpdateFee(priceUpdateData);
        require(msg.value >= fee, "PositionManager:: use correct price update fee");
        pyth.updatePriceFeeds{ value: fee }(priceUpdateData);
        return msg.value - fee;
    }
}
