// SPDX-License-Identifier: MIT

pragma solidity 0.8.18;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/utils/Address.sol";
import "@openzeppelin/contracts/security/ReentrancyGuard.sol";

import "../tokens/interfaces/IWETH_0_8_18.sol";
import "./interfaces/IRouter_0_8_18.sol";
import "./interfaces/IVault_0_8_18.sol";
import "./interfaces/IShortsTracker_0_8_18.sol";
// import "./interfaces/IOrderBook_0_8_18.sol";
import "./interfaces/IBasePositionManager_0_8_18.sol";

import "../access/Governable_0_8_18.sol";
import "../peripherals/interfaces/ITimelock_0_8_18.sol";
import "../referrals/interfaces/IReferralStorage_0_8_18.sol";

import "./PositionUtils_0_8_18.sol";

contract BasePositionManager_0_8_18 is IBasePositionManager_0_8_18, ReentrancyGuard, Governable_0_8_18 {
    using SafeERC20 for IERC20;
    using Address for address payable;

    uint256 public constant BASIS_POINTS_DIVISOR = 10000;

    address public admin;

    address public vault;
    address public shortsTracker;
    address public router;
    address public weth;

    uint256 public ethTransferGasLimit = 500 * 1000;

    // to prevent using the deposit and withdrawal of collateral as a zero fee swap,
    // there is a small depositFee charged if a collateral deposit results in the decrease
    // of leverage for an existing position
    // increasePositionBufferBps allows for a small amount of decrease of leverage
    uint256 public depositFee;
    uint256 public increasePositionBufferBps = 100;

    address public referralStorage;

    mapping (address => uint256) public feeReserves;

    mapping (address => uint256) public override maxGlobalLongSizes;
    mapping (address => uint256) public override maxGlobalShortSizes;

    event SetDepositFee(uint256 depositFee);
    event SetEthTransferGasLimit(uint256 ethTransferGasLimit);
    event SetIncreasePositionBufferBps(uint256 increasePositionBufferBps);
    event SetReferralStorage(address referralStorage);
    event SetAdmin(address admin);
    event WithdrawFees(address token, address receiver, uint256 amount);

    event SetMaxGlobalSizes(
        address[] tokens,
        uint256[] longSizes,
        uint256[] shortSizes
    );

    event IncreasePositionReferral(
        address account,
        uint256 sizeDelta,
        uint256 marginFeeBasisPoints,
        bytes32 referralCode,
        address referrer
    );

    event DecreasePositionReferral(
        address account,
        uint256 sizeDelta,
        uint256 marginFeeBasisPoints,
        bytes32 referralCode,
        address referrer
    );

    modifier onlyAdmin() {
        require(msg.sender == admin, "forbidden");
        _;
    }

    constructor(
        address _vault,
        address _router,
        address _shortsTracker,
        address _weth,
        uint256 _depositFee
    ) {
        vault = _vault;
        router = _router;
        weth = _weth;
        depositFee = _depositFee;
        shortsTracker = _shortsTracker;

        admin = msg.sender;
    }

    receive() external payable {
        
    }

    function setAdmin(address _admin) external onlyGov {
        admin = _admin;
        emit SetAdmin(_admin);
    }

    function setEthTransferGasLimit(uint256 _ethTransferGasLimit) external onlyAdmin {
        ethTransferGasLimit = _ethTransferGasLimit;
        emit SetEthTransferGasLimit(_ethTransferGasLimit);
    }

    function setDepositFee(uint256 _depositFee) external onlyAdmin {
        depositFee = _depositFee;
        emit SetDepositFee(_depositFee);
    }

    function setIncreasePositionBufferBps(uint256 _increasePositionBufferBps) external onlyAdmin {
        increasePositionBufferBps = _increasePositionBufferBps;
        emit SetIncreasePositionBufferBps(_increasePositionBufferBps);
    }

    function setReferralStorage(address _referralStorage) external onlyAdmin {
        referralStorage = _referralStorage;
        emit SetReferralStorage(_referralStorage);
    }

    function setMaxGlobalSizes(
        address[] memory _tokens,
        uint256[] memory _longSizes,
        uint256[] memory _shortSizes
    ) external onlyAdmin {
        for (uint256 i = 0; i < _tokens.length; i++) {
            address token = _tokens[i];
            maxGlobalLongSizes[token] = _longSizes[i];
            maxGlobalShortSizes[token] = _shortSizes[i];
        }

        emit SetMaxGlobalSizes(_tokens, _longSizes, _shortSizes);
    }

    function withdrawFees(address _token, address _receiver) external onlyAdmin {
        uint256 amount = feeReserves[_token];
        if (amount == 0) { return; }

        feeReserves[_token] = 0;
        IERC20(_token).safeTransfer(_receiver, amount);

        emit WithdrawFees(_token, _receiver, amount);
    }

    function approve(address _token, address _spender, uint256 _amount) external onlyGov {
        IERC20(_token).approve(_spender, _amount);
    }

    function sendValue(address payable _receiver, uint256 _amount) external onlyGov {
        _receiver.sendValue(_amount);
    }

    function _validateMaxGlobalSize(address _indexToken, bool _isLong, uint256 _sizeDelta) internal view {
        if (_sizeDelta == 0) {
            return;
        }

        if (_isLong) {
            uint256 maxGlobalLongSize = maxGlobalLongSizes[_indexToken];
            if (maxGlobalLongSize > 0 && IVault_0_8_18(vault).guaranteedUsd(_indexToken) + _sizeDelta > maxGlobalLongSize) {
                revert("max longs exceeded");
            }
        } else {
            uint256 maxGlobalShortSize = maxGlobalShortSizes[_indexToken];
            if (maxGlobalShortSize > 0 && IVault_0_8_18(vault).globalShortSizes(_indexToken) + _sizeDelta> maxGlobalShortSize) {
                revert("max shorts exceeded");
            }
        }
    }

    function _increasePosition(address _account, address _collateralToken, address _indexToken, uint256 _sizeDelta, bool _isLong, uint256 _price) internal {
        _validateMaxGlobalSize(_indexToken, _isLong, _sizeDelta);

        PositionUtils_0_8_18.increasePosition(
            vault,
            router,
            shortsTracker,
            _account,
            _collateralToken,
            _indexToken,
            _sizeDelta,
            _isLong,
            _price
        );

        _emitIncreasePositionReferral(_account, _sizeDelta);
    }

    function _decreasePosition(address _account, address _collateralToken, address _indexToken, uint256 _collateralDelta, uint256 _sizeDelta, bool _isLong, address _receiver, uint256 _price) internal returns (uint256) {
        address _vault = vault;

        uint256 markPrice = _isLong ? IVault_0_8_18(_vault).getMinPrice(_indexToken) : IVault_0_8_18(_vault).getMaxPrice(_indexToken);
        if (_isLong) {
            require(markPrice >= _price, "markPrice < price");
        } else {
            require(markPrice <= _price, "markPrice > price");
        }

        address timelock = IVault_0_8_18(_vault).gov();

        // should be called strictly before position is updated in Vault
        IShortsTracker_0_8_18(shortsTracker).updateGlobalShortData(_account, _collateralToken, _indexToken, _isLong, _sizeDelta, markPrice, false);

        ITimelock_0_8_18(timelock).enableLeverage(_vault);
        uint256 amountOut = IRouter_0_8_18(router).pluginDecreasePosition(_account, _collateralToken, _indexToken, _collateralDelta, _sizeDelta, _isLong, _receiver);
        ITimelock_0_8_18(timelock).disableLeverage(_vault);

        _emitDecreasePositionReferral(
            _account,
            _sizeDelta
        );

        return amountOut;
    }

    function _swap(address[] memory _path, uint256 _minOut, address _receiver) internal returns (uint256) {
        if (_path.length == 2) {
            return _vaultSwap(_path[0], _path[1], _minOut, _receiver);
        }
        revert("invalid _path.length");
    }

    function _vaultSwap(address _tokenIn, address _tokenOut, uint256 _minOut, address _receiver) internal returns (uint256) {
        uint256 amountOut = IVault_0_8_18(vault).swap(_tokenIn, _tokenOut, _receiver);
        require(amountOut >= _minOut, "insufficient amountOut");
        return amountOut;
    }

    function _transferInETH(uint256 _value) internal {
        if (_value != 0) {
            IWETH_0_8_18(weth).deposit{value: _value}();
        }
    }

    function _transferOutETHWithGasLimitFallbackToWeth(uint256 _amountOut, address payable _receiver) internal {
        IWETH_0_8_18 _weth = IWETH_0_8_18(weth);
        _weth.withdraw(_amountOut);

        (bool success, /* bytes memory data */) = _receiver.call{ value: _amountOut, gas: ethTransferGasLimit }("");

        if (success) { return; }

        // if the transfer failed, re-wrap the token and send it to the receiver
        _weth.deposit{ value: _amountOut }();
        _weth.transfer(address(_receiver), _amountOut);
    }

    function _collectFees(
        address _account,
        address[] memory _path,
        uint256 _amountIn,
        address _indexToken,
        bool _isLong,
        uint256 _sizeDelta
    ) internal returns (uint256) {
        bool shouldDeductFee = PositionUtils_0_8_18.shouldDeductFee(
            vault,
            _account,
            _path,
            _amountIn,
            _indexToken,
            _isLong,
            _sizeDelta,
            increasePositionBufferBps
        );

        if (shouldDeductFee) {
            uint256 afterFeeAmount = _amountIn * (BASIS_POINTS_DIVISOR - depositFee) / BASIS_POINTS_DIVISOR;
            uint256 feeAmount = _amountIn - afterFeeAmount;
            address feeToken = _path[_path.length - 1];
            feeReserves[feeToken] = feeReserves[feeToken] + feeAmount;
            return afterFeeAmount;
        }

        return _amountIn;
    }

    function _emitIncreasePositionReferral(address _account, uint256 _sizeDelta) internal {
        address _referralStorage = referralStorage;
        if (_referralStorage == address(0)) { return; }


        (bytes32 referralCode, address referrer) = IReferralStorage_0_8_18(_referralStorage).getTraderReferralInfo(_account);
        if (referralCode == bytes32(0)) { return; }

        address timelock = IVault_0_8_18(vault).gov();

        emit IncreasePositionReferral(
            _account,
            _sizeDelta,
            ITimelock_0_8_18(timelock).marginFeeBasisPoints(),
            referralCode,
            referrer
        );
    }

    function _emitDecreasePositionReferral(address _account, uint256 _sizeDelta) internal {
        address _referralStorage = referralStorage;
        if (_referralStorage == address(0)) { return; }

        (bytes32 referralCode, address referrer) = IReferralStorage_0_8_18(_referralStorage).getTraderReferralInfo(_account);
        if (referralCode == bytes32(0)) { return; }

        address timelock = IVault_0_8_18(vault).gov();

        emit DecreasePositionReferral(
            _account,
            _sizeDelta,
            ITimelock_0_8_18(timelock).marginFeeBasisPoints(),
            referralCode,
            referrer
        );
    }
}
