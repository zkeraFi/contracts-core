// SPDX-License-Identifier: MIT

pragma solidity 0.8.18;

import "@openzeppelin/contracts/utils/Address.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

import "./interfaces/IRouter_0_8_18.sol";
import "./interfaces/IPositionRouter_0_8_18.sol";
import "./interfaces/IPositionRouterCallbackReceiver_0_8_18.sol";
import "../oracle/interfaces/IBlockInfo_0_8_18.sol";

import "./BasePositionManager_0_8_18.sol";

contract PositionRouterV2 is BasePositionManager_0_8_18, IPositionRouter_0_8_18 {
    using SafeERC20 for IERC20;
    using Address for address;

    struct IncreasePositionRequest {
        address account;
        address[] path;
        address indexToken;
        uint256 amountIn;
        uint256 minOut;
        uint256 sizeDelta;
        bool isLong;
        uint256 acceptablePrice;
        uint256 executionFee;
        uint256 blockNumber;
        uint256 blockTime;
        bool hasCollateralInETH;
        address callbackTarget;
    }

    struct DecreasePositionRequest {
        address account;
        address[] path;
        address indexToken;
        uint256 collateralDelta;
        uint256 sizeDelta;
        bool isLong;
        address receiver;
        uint256 acceptablePrice;
        uint256 minOut;
        uint256 executionFee;
        uint256 blockNumber;
        uint256 blockTime;
        bool withdrawETH;
        address callbackTarget;
    }

    uint256 public minExecutionFee;

    uint256 public minBlockDelayKeeper;
    uint256 public minTimeDelayPublic;
    uint256 public maxTimeDelay;

    bool public isLeverageEnabled = true;

    bytes32[] public override increasePositionRequestKeys;
    bytes32[] public override decreasePositionRequestKeys;

    uint256 public override increasePositionRequestKeysStart;
    uint256 public override decreasePositionRequestKeysStart;

    uint256 public callbackGasLimit;
    mapping(address => uint256) public customCallbackGasLimits;

    mapping(address => bool) public isPositionKeeper;

    mapping(address => uint256) public increasePositionsIndex;
    mapping(bytes32 => IncreasePositionRequest) public increasePositionRequests;

    mapping(address => uint256) public decreasePositionsIndex;
    mapping(bytes32 => DecreasePositionRequest) public decreasePositionRequests;

    IBlockInfo_0_8_18 public blockInfo;

    mapping (address => bool) public isHandler;

    event CreateIncreasePosition(
        address indexed account,
        address[] path,
        address indexToken,
        uint256 amountIn,
        uint256 minOut,
        uint256 sizeDelta,
        bool isLong,
        uint256 acceptablePrice,
        uint256 executionFee,
        uint256 index,
        uint256 queueIndex,
        uint256 blockNumber,
        uint256 blockTime,
        uint256 gasPrice
    );

    event ExecuteIncreasePosition(
        address indexed account,
        address[] path,
        address indexToken,
        uint256 amountIn,
        uint256 minOut,
        uint256 sizeDelta,
        bool isLong,
        uint256 acceptablePrice,
        uint256 executionFee,
        uint256 blockGap,
        uint256 timeGap
    );

    event CancelIncreasePosition(
        address indexed account,
        address[] path,
        address indexToken,
        uint256 amountIn,
        uint256 minOut,
        uint256 sizeDelta,
        bool isLong,
        uint256 acceptablePrice,
        uint256 executionFee,
        uint256 blockGap,
        uint256 timeGap
    );

    event CreateDecreasePosition(
        address indexed account,
        address[] path,
        address indexToken,
        uint256 collateralDelta,
        uint256 sizeDelta,
        bool isLong,
        address receiver,
        uint256 acceptablePrice,
        uint256 minOut,
        uint256 executionFee,
        uint256 index,
        uint256 queueIndex,
        uint256 blockNumber,
        uint256 blockTime
    );

    event ExecuteDecreasePosition(
        address indexed account,
        address[] path,
        address indexToken,
        uint256 collateralDelta,
        uint256 sizeDelta,
        bool isLong,
        address receiver,
        uint256 acceptablePrice,
        uint256 minOut,
        uint256 executionFee,
        uint256 blockGap,
        uint256 timeGap
    );

    event CancelDecreasePosition(
        address indexed account,
        address[] path,
        address indexToken,
        uint256 collateralDelta,
        uint256 sizeDelta,
        bool isLong,
        address receiver,
        uint256 acceptablePrice,
        uint256 minOut,
        uint256 executionFee,
        uint256 blockGap,
        uint256 timeGap
    );

    event SetPositionKeeper(address indexed account, bool isActive);
    event SetMinExecutionFee(uint256 minExecutionFee);
    event SetIsLeverageEnabled(bool isLeverageEnabled);
    event SetDelayValues(
        uint256 minBlockDelayKeeper,
        uint256 minTimeDelayPublic,
        uint256 maxTimeDelay
    );
    event SetRequestKeysStartValues(
        uint256 increasePositionRequestKeysStart,
        uint256 decreasePositionRequestKeysStart
    );
    event SetCallbackGasLimit(uint256 callbackGasLimit);
    event SetCustomCallbackGasLimit(
        address callbackTarget,
        uint256 callbackGasLimit
    );
    event Callback(
        address callbackTarget,
        bool success,
        uint256 callbackGasLimit
    );

    modifier onlyPositionKeeper() {
        require(isPositionKeeper[msg.sender], "403");
        _;
    }

    modifier onlyHandler() {
        require(isHandler[msg.sender], "PositionRouter: forbidden");
        _;
    }

    constructor(
        address _vault,
        address _router,
        address _weth,
        address _shortsTracker,
        uint256 _depositFee,
        uint256 _minExecutionFee,
        IBlockInfo_0_8_18 _blockInfo
    )
        BasePositionManager_0_8_18(
            _vault,
            _router,
            _shortsTracker,
            _weth,
            _depositFee
        )
    {
        minExecutionFee = _minExecutionFee;
        blockInfo = _blockInfo;
    }

    function setPositionKeeper(
        address _account,
        bool _isActive
    ) external onlyAdmin {
        isPositionKeeper[_account] = _isActive;
        emit SetPositionKeeper(_account, _isActive);
    }

    function setHandler(address _handler, bool _isActive) external onlyGov {
        isHandler[_handler] = _isActive;
    }

    function setCallbackGasLimit(uint256 _callbackGasLimit) external onlyAdmin {
        callbackGasLimit = _callbackGasLimit;
        emit SetCallbackGasLimit(_callbackGasLimit);
    }

    function setCustomCallbackGasLimit(
        address _callbackTarget,
        uint256 _callbackGasLimit
    ) external onlyAdmin {
        customCallbackGasLimits[_callbackTarget] = _callbackGasLimit;
        emit SetCustomCallbackGasLimit(_callbackTarget, _callbackGasLimit);
    }

    function setMinExecutionFee(uint256 _minExecutionFee) external onlyAdmin {
        minExecutionFee = _minExecutionFee;
        emit SetMinExecutionFee(_minExecutionFee);
    }

    function setIsLeverageEnabled(bool _isLeverageEnabled) external onlyAdmin {
        isLeverageEnabled = _isLeverageEnabled;
        emit SetIsLeverageEnabled(_isLeverageEnabled);
    }

    function setDelayValues(
        uint256 _minBlockDelayKeeper,
        uint256 _minTimeDelayPublic,
        uint256 _maxTimeDelay
    ) external onlyAdmin {
        minBlockDelayKeeper = _minBlockDelayKeeper;
        minTimeDelayPublic = _minTimeDelayPublic;
        maxTimeDelay = _maxTimeDelay;
        emit SetDelayValues(
            _minBlockDelayKeeper,
            _minTimeDelayPublic,
            _maxTimeDelay
        );
    }

    function setRequestKeysStartValues(
        uint256 _increasePositionRequestKeysStart,
        uint256 _decreasePositionRequestKeysStart
    ) external onlyAdmin {
        increasePositionRequestKeysStart = _increasePositionRequestKeysStart;
        decreasePositionRequestKeysStart = _decreasePositionRequestKeysStart;

        emit SetRequestKeysStartValues(
            _increasePositionRequestKeysStart,
            _decreasePositionRequestKeysStart
        );
    }

    function executeIncreasePositions(
        uint256 _endIndex,
        address payable _executionFeeReceiver
    ) external payable override onlyPositionKeeper {

        uint256 index = increasePositionRequestKeysStart;
        uint256 length = increasePositionRequestKeys.length;

        if (index >= length) {
            return;
        }

        if (_endIndex > length) {
            _endIndex = length;
        }

        while (index < _endIndex) {
            bytes32 key = increasePositionRequestKeys[index];

            // if the request was executed then delete the key from the array
            // if the request was not executed then break from the loop, this can happen if the
            // minimum number of blocks has not yet passed
            // an error could be thrown if the request is too old or if the slippage is
            // higher than what the user specified, or if there is insufficient liquidity for the position
            // in case an error was thrown, cancel the request
            try
                this.executeIncreasePosition(key, _executionFeeReceiver)
            returns (bool _wasExecuted) {
                if (!_wasExecuted) {
                    break;
                }
            } catch {
                // wrap this call in a try catch to prevent invalid cancels from blocking the loop
                try
                    this.cancelIncreasePosition(key, _executionFeeReceiver)
                returns (bool _wasCancelled) {
                    if (!_wasCancelled) {
                        break;
                    }
                } catch {}
            }

            delete increasePositionRequestKeys[index];
            index++;
        }

        increasePositionRequestKeysStart = index;
    }

    function executeDecreasePositions(
        uint256 _endIndex,
        address payable _executionFeeReceiver
    ) external payable override onlyPositionKeeper {

        uint256 index = decreasePositionRequestKeysStart;
        uint256 length = decreasePositionRequestKeys.length;

        if (index >= length) {
            return;
        }

        if (_endIndex > length) {
            _endIndex = length;
        }

        while (index < _endIndex) {
            bytes32 key = decreasePositionRequestKeys[index];

            // if the request was executed then delete the key from the array
            // if the request was not executed then break from the loop, this can happen if the
            // minimum number of blocks has not yet passed
            // an error could be thrown if the request is too old
            // in case an error was thrown, cancel the request
            try
                this.executeDecreasePosition(key, _executionFeeReceiver)
            returns (bool _wasExecuted) {
                if (!_wasExecuted) {
                    break;
                }
            } catch {
                // wrap this call in a try catch to prevent invalid cancels from blocking the loop
                try
                    this.cancelDecreasePosition(key, _executionFeeReceiver)
                returns (bool _wasCancelled) {
                    if (!_wasCancelled) {
                        break;
                    }
                } catch {}
            }

            delete decreasePositionRequestKeys[index];
            index++;
        }

        decreasePositionRequestKeysStart = index;
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
    ) external payable nonReentrant returns (bytes32) {
        return
            _proceedIncreasePosition(
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
    ) external payable nonReentrant onlyHandler returns (bytes32) {
        return
            _proceedIncreasePosition(
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
                _from
            );
    }

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
    ) external payable nonReentrant returns (bytes32) {
        return
            _proceedCreateIncreasePositionETH(
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
    ) external payable nonReentrant onlyHandler returns (bytes32) {
        return
            _proceedCreateIncreasePositionETH(
                _path,
                _indexToken,
                _minOut,
                _sizeDelta,
                _isLong,
                _acceptablePrice,
                _executionFee,
                _referralCode,
                _callbackTarget,
                _from
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
    ) external payable nonReentrant returns (bytes32) {
        return
            _proceedCreateDecreasePosition(
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
    ) external payable nonReentrant onlyHandler returns (bytes32) {
        return
            _proceedCreateDecreasePosition(
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
                _from
            );
    }

    function getRequestQueueLengths()
        external
        view
        override
        returns (uint256, uint256, uint256, uint256)
    {
        return (
            increasePositionRequestKeysStart,
            increasePositionRequestKeys.length,
            decreasePositionRequestKeysStart,
            decreasePositionRequestKeys.length
        );
    }

    function executeIncreasePosition(
        bytes32 _key,
        address payable _executionFeeReceiver
    ) public nonReentrant returns (bool) {
        return _executeIncreasePosition(_key, _executionFeeReceiver);
    }

    function _executeIncreasePosition(
        bytes32 _key,
        address payable _executionFeeReceiver
    ) internal returns (bool) {
        IncreasePositionRequest memory request = increasePositionRequests[_key];
        // if the request was already executed or cancelled, return true so that the executeIncreasePositions loop will continue executing the next request
        if (request.account == address(0)) {
            return true;
        }

        bool shouldExecute = _validateExecution(
            request.blockNumber,
            request.blockTime,
            request.account
        );
        if (!shouldExecute) {
            return false;
        }

        delete increasePositionRequests[_key];

        if (request.amountIn > 0) {
            uint256 amountIn = request.amountIn;

            if (request.path.length > 1) {
                IERC20(request.path[0]).safeTransfer(vault, request.amountIn);
                amountIn = _swap(request.path, request.minOut, address(this));
            }

            uint256 afterFeeAmount = _collectFees(
                request.account,
                request.path,
                amountIn,
                request.indexToken,
                request.isLong,
                request.sizeDelta
            );
            IERC20(request.path[request.path.length - 1]).safeTransfer(
                vault,
                afterFeeAmount
            );
        }

        _increasePosition(
            request.account,
            request.path[request.path.length - 1],
            request.indexToken,
            request.sizeDelta,
            request.isLong,
            request.acceptablePrice
        );

        _transferOutETHWithGasLimitFallbackToWeth(
            request.executionFee,
            _executionFeeReceiver
        );

        (uint256 blockNumber, uint256 blockTimestamp) = blockInfo
            .getBlockInfo();
        emit ExecuteIncreasePosition(
            request.account,
            request.path,
            request.indexToken,
            request.amountIn,
            request.minOut,
            request.sizeDelta,
            request.isLong,
            request.acceptablePrice,
            request.executionFee,
            blockNumber - request.blockNumber,
            blockTimestamp - request.blockTime
        );

        _callRequestCallback(request.callbackTarget, _key, true, true);

        return true;
    }

    function cancelIncreasePosition(
        bytes32 _key,
        address payable _executionFeeReceiver
    ) public nonReentrant returns (bool) {
        IncreasePositionRequest memory request = increasePositionRequests[_key];
        // if the request was already executed or cancelled, return true so that the executeIncreasePositions loop will continue executing the next request
        if (request.account == address(0)) {
            return true;
        }

        bool shouldCancel = _validateCancellation(
            request.blockNumber,
            request.blockTime,
            request.account
        );
        if (!shouldCancel) {
            return false;
        }

        delete increasePositionRequests[_key];

        if (request.hasCollateralInETH) {
            _transferOutETHWithGasLimitFallbackToWeth(
                request.amountIn,
                payable(request.account)
            );
        } else {
            IERC20(request.path[0]).safeTransfer(
                request.account,
                request.amountIn
            );
        }

        _transferOutETHWithGasLimitFallbackToWeth(
            request.executionFee,
            _executionFeeReceiver
        );

        (uint256 blockNumber, uint256 blockTimestamp) = blockInfo
            .getBlockInfo();
        emit CancelIncreasePosition(
            request.account,
            request.path,
            request.indexToken,
            request.amountIn,
            request.minOut,
            request.sizeDelta,
            request.isLong,
            request.acceptablePrice,
            request.executionFee,
            blockNumber - request.blockNumber,
            blockTimestamp - request.blockTime
        );

        _callRequestCallback(request.callbackTarget, _key, false, true);

        return true;
    }

    function executeDecreasePosition(
        bytes32 _key,
        address payable _executionFeeReceiver
    ) public nonReentrant returns (bool) {
        return _executeDecreasePosition(_key, _executionFeeReceiver);
    }

    function _executeDecreasePosition(
        bytes32 _key,
        address payable _executionFeeReceiver
    ) internal returns (bool) {
        DecreasePositionRequest memory request = decreasePositionRequests[_key];
        // if the request was already executed or cancelled, return true so that the executeDecreasePositions loop will continue executing the next request
        if (request.account == address(0)) {
            return true;
        }

        bool shouldExecute = _validateExecution(
            request.blockNumber,
            request.blockTime,
            request.account
        );
        if (!shouldExecute) {
            return false;
        }

        delete decreasePositionRequests[_key];

        _processRequest(request);
        _emitEventAndCallback(request, _key);

        _transferOutETHWithGasLimitFallbackToWeth(
            request.executionFee,
            _executionFeeReceiver
        );

        return true;
    }

    function _processRequest(
        DecreasePositionRequest memory request
    ) internal returns (uint256) {
        uint256 amountOut = _decreasePosition(
            request.account,
            request.path[0],
            request.indexToken,
            request.collateralDelta,
            request.sizeDelta,
            request.isLong,
            address(this),
            request.acceptablePrice
        );

        if (amountOut > 0) {
            if (request.path.length > 1) {
                IERC20(request.path[0]).safeTransfer(vault, amountOut);
                amountOut = _swap(request.path, request.minOut, address(this));
            }

            if (request.withdrawETH) {
                _transferOutETHWithGasLimitFallbackToWeth(
                    amountOut,
                    payable(request.receiver)
                );
            } else {
                IERC20(request.path[request.path.length - 1]).safeTransfer(
                    request.receiver,
                    amountOut
                );
            }
        }

        return amountOut;
    }

    function _emitEventAndCallback(
        DecreasePositionRequest memory request,
        bytes32 _key
    ) internal {
        emit ExecuteDecreasePosition(
            request.account,
            request.path,
            request.indexToken,
            request.collateralDelta,
            request.sizeDelta,
            request.isLong,
            request.receiver,
            request.acceptablePrice,
            request.minOut,
            request.executionFee,
            blockInfo.getBlockNumber() - request.blockNumber,
            blockInfo.getBlockTimestamp() - request.blockTime
        );

        _callRequestCallback(request.callbackTarget, _key, true, false);
    }

    function cancelDecreasePosition(
        bytes32 _key,
        address payable _executionFeeReceiver
    ) public nonReentrant returns (bool) {
        DecreasePositionRequest memory request = decreasePositionRequests[_key];
        // if the request was already executed or cancelled, return true so that the executeDecreasePositions loop will continue executing the next request
        if (request.account == address(0)) {
            return true;
        }

        bool shouldCancel = _validateCancellation(
            request.blockNumber,
            request.blockTime,
            request.account
        );
        if (!shouldCancel) {
            return false;
        }

        delete decreasePositionRequests[_key];

        _transferOutETHWithGasLimitFallbackToWeth(
            request.executionFee,
            _executionFeeReceiver
        );

        _emitEventAndCallbackForCancel(request, _key);

        return true;
    }

    function _emitEventAndCallbackForCancel(
        DecreasePositionRequest memory request,
        bytes32 _key
    ) internal {
        emit CancelDecreasePosition(
            request.account,
            request.path,
            request.indexToken,
            request.collateralDelta,
            request.sizeDelta,
            request.isLong,
            request.receiver,
            request.acceptablePrice,
            request.minOut,
            request.executionFee,
            blockInfo.getBlockNumber() - request.blockNumber,
            blockInfo.getBlockTimestamp() - request.blockTime
        );

        _callRequestCallback(request.callbackTarget, _key, false, false);
    }

    function getRequestKey(
        address _account,
        uint256 _index
    ) public pure returns (bytes32) {
        return keccak256(abi.encodePacked(_account, _index));
    }

    function getIncreasePositionRequestPath(
        bytes32 _key
    ) public view override returns (address[] memory) {
        IncreasePositionRequest memory request = increasePositionRequests[_key];
        return request.path;
    }

    function getDecreasePositionRequestPath(
        bytes32 _key
    ) public view override returns (address[] memory) {
        DecreasePositionRequest memory request = decreasePositionRequests[_key];
        return request.path;
    }

    function _setTraderReferralCode(
        bytes32 _referralCode,
        address _caller
    ) internal {
        if (_referralCode != bytes32(0) && referralStorage != address(0)) {
            IReferralStorage_0_8_18(referralStorage).setTraderReferralCode(
                _caller,
                _referralCode
            );
        }
    }

    function _validateExecution(
        uint256 _positionBlockNumber,
        uint256 _positionBlockTime,
        address _account
    ) internal view returns (bool) {
        if (
            _positionBlockTime + maxTimeDelay <= blockInfo.getBlockTimestamp()
        ) {
            revert("expired");
        }

        return
            _validateExecutionOrCancellation(
                _positionBlockNumber,
                _positionBlockTime,
                _account
            );
    }

    function _validateCancellation(
        uint256 _positionBlockNumber,
        uint256 _positionBlockTime,
        address _account
    ) internal view returns (bool) {
        return
            _validateExecutionOrCancellation(
                _positionBlockNumber,
                _positionBlockTime,
                _account
            );
    }

    function _validateExecutionOrCancellation(
        uint256 _positionBlockNumber,
        uint256 _positionBlockTime,
        address _account
    ) internal view returns (bool) {
        bool isKeeperCall = msg.sender == address(this) ||
            isPositionKeeper[msg.sender];

        if (!isLeverageEnabled && !isKeeperCall) {
            revert("403");
        }

        if (isKeeperCall) {
            return
                _positionBlockNumber + minBlockDelayKeeper <=
                blockInfo.getBlockNumber();
        }

        require(msg.sender == _account, "403");

        require(
            _positionBlockTime + minTimeDelayPublic <=
                blockInfo.getBlockTimestamp(),
            "delay"
        );

        return true;
    }

    function _proceedIncreasePosition(
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
    ) internal returns (bytes32) {
        require(_executionFee >= minExecutionFee, "fee");
        require(_path.length == 1 || _path.length == 2, "len");
        require(msg.value == _executionFee, "val");

        _transferInETH(msg.value);

        _setTraderReferralCode(_referralCode, _from);

        if (_amountIn > 0) {
            IRouter_0_8_18(router).pluginTransfer(
                _path[0],
                _from,
                address(this),
                _amountIn
            );
        }

        return
            _createIncreasePosition(
                _from,
                _path,
                _indexToken,
                _amountIn,
                _minOut,
                _sizeDelta,
                _isLong,
                _acceptablePrice,
                _executionFee,
                false,
                _callbackTarget
            );
    }

    function _proceedCreateIncreasePositionETH(
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
    ) internal returns (bytes32) {
        require(_executionFee >= minExecutionFee, "fee");
        require(msg.value >= _executionFee, "val");
        require(_path.length == 1 || _path.length == 2, "len");
        require(_path[0] == weth, "path");
        _transferInETH(msg.value);
        _setTraderReferralCode(_referralCode, _from);

        uint256 amountIn = msg.value - _executionFee;

        return
            _createIncreasePosition(
                _from,
                _path,
                _indexToken,
                amountIn,
                _minOut,
                _sizeDelta,
                _isLong,
                _acceptablePrice,
                _executionFee,
                true,
                _callbackTarget
            );
    }

    function _proceedCreateDecreasePosition(
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
    ) internal returns (bytes32) {
        require(_executionFee >= minExecutionFee, "fee");
        require(msg.value == _executionFee, "val");
        require(_path.length == 1 || _path.length == 2, "len");

        if (_withdrawETH) {
            require(_path[_path.length - 1] == weth, "path");
        }

        _transferInETH(msg.value);

        return
            _createDecreasePosition(
                _from,
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
                _callbackTarget
            );
    }

    function _createIncreasePosition(
        address _account,
        address[] memory _path,
        address _indexToken,
        uint256 _amountIn,
        uint256 _minOut,
        uint256 _sizeDelta,
        bool _isLong,
        uint256 _acceptablePrice,
        uint256 _executionFee,
        bool _hasCollateralInETH,
        address _callbackTarget
    ) internal returns (bytes32) {
        IncreasePositionRequest memory request = _createRequest(
            _account,
            _path,
            _indexToken,
            _amountIn,
            _minOut,
            _sizeDelta,
            _isLong,
            _acceptablePrice,
            _executionFee,
            _hasCollateralInETH,
            _callbackTarget
        );

        (uint256 index, bytes32 requestKey) = _storeIncreasePositionRequest(
            request
        );
        _emitCreateIncreasePositionEvent(request, index, requestKey);

        return requestKey;
    }

    function _createRequest(
        address _account,
        address[] memory _path,
        address _indexToken,
        uint256 _amountIn,
        uint256 _minOut,
        uint256 _sizeDelta,
        bool _isLong,
        uint256 _acceptablePrice,
        uint256 _executionFee,
        bool _hasCollateralInETH,
        address _callbackTarget
    ) internal view returns (IncreasePositionRequest memory request) {
        (uint256 blockNumber, uint256 blockTimestamp) = blockInfo
            .getBlockInfo();
        request = IncreasePositionRequest(
            _account,
            _path,
            _indexToken,
            _amountIn,
            _minOut,
            _sizeDelta,
            _isLong,
            _acceptablePrice,
            _executionFee,
            blockNumber,
            blockTimestamp,
            _hasCollateralInETH,
            _callbackTarget
        );
    }

    function _emitCreateIncreasePositionEvent(
        IncreasePositionRequest memory request,
        uint256 index,
        bytes32 requestKey
    ) internal {
        emit CreateIncreasePosition(
            request.account,
            request.path,
            request.indexToken,
            request.amountIn,
            request.minOut,
            request.sizeDelta,
            request.isLong,
            request.acceptablePrice,
            request.executionFee,
            index,
            increasePositionRequestKeys.length - 1,
            request.blockNumber,
            request.blockTime,
            tx.gasprice
        );
    }

    function _storeIncreasePositionRequest(
        IncreasePositionRequest memory _request
    ) internal returns (uint256, bytes32) {
        address account = _request.account;
        uint256 index = increasePositionsIndex[account] + 1;
        increasePositionsIndex[account] = index;
        bytes32 key = getRequestKey(account, index);

        increasePositionRequests[key] = _request;
        increasePositionRequestKeys.push(key);

        return (index, key);
    }

    function _storeDecreasePositionRequest(
        DecreasePositionRequest memory _request
    ) internal returns (uint256, bytes32) {
        address account = _request.account;
        uint256 index = decreasePositionsIndex[account] + 1;
        decreasePositionsIndex[account] = index;
        bytes32 key = getRequestKey(account, index);

        decreasePositionRequests[key] = _request;
        decreasePositionRequestKeys.push(key);

        return (index, key);
    }

    function _createDecreasePosition(
        address _account,
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
    ) internal returns (bytes32) {
        DecreasePositionRequest memory request = _createDecreaseRequest(
            _account,
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
            _callbackTarget
        );

        (uint256 index, bytes32 requestKey) = _storeDecreasePositionRequest(
            request
        );
        _emitCreateDecreasePositionEvent(request, index);

        return requestKey;
    }

    function _createDecreaseRequest(
        address _account,
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
    ) internal view returns (DecreasePositionRequest memory request) {
        request = DecreasePositionRequest(
            _account,
            _path,
            _indexToken,
            _collateralDelta,
            _sizeDelta,
            _isLong,
            _receiver,
            _acceptablePrice,
            _minOut,
            _executionFee,
            blockInfo.getBlockNumber(),
            blockInfo.getBlockTimestamp(),
            _withdrawETH,
            _callbackTarget
        );
    }

    function _emitCreateDecreasePositionEvent(
        DecreasePositionRequest memory request,
        uint256 index
    ) internal {
        emit CreateDecreasePosition(
            request.account,
            request.path,
            request.indexToken,
            request.collateralDelta,
            request.sizeDelta,
            request.isLong,
            request.receiver,
            request.acceptablePrice,
            request.minOut,
            request.executionFee,
            index,
            decreasePositionRequestKeys.length - 1,
            request.blockNumber,
            request.blockTime
        );
    }

    function _callRequestCallback(
        address _callbackTarget,
        bytes32 _key,
        bool _wasExecuted,
        bool _isIncrease
    ) internal {
        if (_callbackTarget == address(0)) {
            return;
        }

        if (!_callbackTarget.isContract()) {
            return;
        }

        uint256 _gasLimit = callbackGasLimit;

        uint256 _customCallbackGasLimit = customCallbackGasLimits[
            _callbackTarget
        ];

        if (_customCallbackGasLimit > _gasLimit) {
            _gasLimit = _customCallbackGasLimit;
        }

        if (_gasLimit == 0) {
            return;
        }

        bool success;
        try
            IPositionRouterCallbackReceiver_0_8_18(_callbackTarget)
                .gmxPositionCallback{gas: _gasLimit}(
                _key,
                _wasExecuted,
                _isIncrease
            )
        {
            success = true;
        } catch {}

        emit Callback(_callbackTarget, success, _gasLimit);
    }
}
