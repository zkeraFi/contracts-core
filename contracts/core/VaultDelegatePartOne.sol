// SPDX-License-Identifier: MIT

pragma solidity 0.6.12;

import "../libraries/math/SafeMath.sol";
import "../libraries/token/IERC20.sol";
import "../libraries/token/SafeERC20.sol";
import "../libraries/utils/ReentrancyGuard.sol";

import "../tokens/interfaces/IUSDG.sol";
import "./interfaces/IVault.sol";
import "./interfaces/IVaultUtils.sol";
import "./interfaces/IVaultPriceFeed.sol";

contract VaultDelegatePartOne is ReentrancyGuard {
    using SafeMath for uint256;
    using SafeERC20 for IERC20;

    struct Position {
        uint256 size;
        uint256 collateral;
        uint256 averagePrice;
        uint256 entryFundingRate;
        uint256 reserveAmount;
        int256 realisedPnl;
        uint256 lastIncreasedTime;
    }

    uint256 public constant BASIS_POINTS_DIVISOR = 10000;
    uint256 public constant FUNDING_RATE_PRECISION = 1000000;
    uint256 public constant PRICE_PRECISION = 10 ** 30;
    uint256 public constant MIN_LEVERAGE = 10000; // 1x
    uint256 public constant USDG_DECIMALS = 18;
    uint256 public constant MAX_FEE_BASIS_POINTS = 500; // 5%
    uint256 public constant MAX_LIQUIDATION_FEE_USD = 100 * PRICE_PRECISION; // 100 USD
    uint256 public constant MIN_FUNDING_RATE_INTERVAL = 1 hours;
    uint256 public constant MAX_FUNDING_RATE_FACTOR = 10000; // 1%

    bool public isInitialized;
    bool public isSwapEnabled = true;
    bool public isLeverageEnabled = true;

    IVaultUtils public vaultUtils;

    address public errorController;

    address public router;
    address public priceFeed;

    address public usdg;
    address public gov;

    uint256 public whitelistedTokenCount;

    uint256 public maxLeverage = 50 * 10000; // 50x

    uint256 public liquidationFeeUsd;
    uint256 public taxBasisPoints = 50; // 0.5%
    uint256 public stableTaxBasisPoints = 20; // 0.2%
    uint256 public mintBurnFeeBasisPoints = 30; // 0.3%
    uint256 public swapFeeBasisPoints = 30; // 0.3%
    uint256 public stableSwapFeeBasisPoints = 4; // 0.04%
    uint256 public marginFeeBasisPoints = 10; // 0.1%

    uint256 public minProfitTime;
    bool public hasDynamicFees = false;

    uint256 public fundingInterval = 8 hours;
    uint256 public fundingRateFactor;
    uint256 public stableFundingRateFactor;
    uint256 public totalTokenWeights;

    bool public includeAmmPrice = true;
    bool public useSwapPricing = false;

    bool public inManagerMode = false;
    bool public inPrivateLiquidationMode = false;

    uint256 public maxGasPrice;

    mapping(address => mapping(address => bool)) public approvedRouters;
    mapping(address => bool) public isLiquidator;
    mapping(address => bool) public isManager;

    address[] public allWhitelistedTokens;

    mapping(address => bool) public whitelistedTokens;
    mapping(address => uint256) public tokenDecimals;
    mapping(address => uint256) public minProfitBasisPoints;
    mapping(address => bool) public stableTokens;
    mapping(address => bool) public shortableTokens;

    // tokenBalances is used only to determine _transferIn values
    mapping(address => uint256) public tokenBalances;

    // tokenWeights allows customisation of index composition
    mapping(address => uint256) public tokenWeights;

    // usdgAmounts tracks the amount of USDG debt for each whitelisted token
    mapping(address => uint256) public usdgAmounts;

    // maxUsdgAmounts allows setting a max amount of USDG debt for a token
    mapping(address => uint256) public maxUsdgAmounts;

    // poolAmounts tracks the number of received tokens that can be used for leverage
    // this is tracked separately from tokenBalances to exclude funds that are deposited as margin collateral
    mapping(address => uint256) public poolAmounts;

    // reservedAmounts tracks the number of tokens reserved for open leverage positions
    mapping(address => uint256) public reservedAmounts;

    // bufferAmounts allows specification of an amount to exclude from swaps
    // this can be used to ensure a certain amount of liquidity is available for leverage positions
    mapping(address => uint256) public bufferAmounts;

    // guaranteedUsd tracks the amount of USD that is "guaranteed" by opened leverage positions
    // this value is used to calculate the redemption values for selling of USDG
    // this is an estimated amount, it is possible for the actual guaranteed value to be lower
    // in the case of sudden price decreases, the guaranteed value should be corrected
    // after liquidations are carried out
    mapping(address => uint256) public guaranteedUsd;

    // cumulativeFundingRates tracks the funding rates based on utilization
    mapping(address => uint256) public cumulativeFundingRates;
    // lastFundingTimes tracks the last time funding was updated for a token
    mapping(address => uint256) public lastFundingTimes;

    // positions tracks all open positions
    mapping(bytes32 => Position) public positions;

    // feeReserves tracks the amount of fees per token
    mapping(address => uint256) public feeReserves;

    mapping(address => uint256) public globalShortSizes;
    mapping(address => uint256) public globalShortAveragePrices;
    mapping(address => uint256) public maxGlobalShortSizes;

    mapping(uint256 => string) public errors;

    event BuyUSDG(
        address account,
        address token,
        uint256 tokenAmount,
        uint256 usdgAmount,
        uint256 feeBasisPoints
    );
    event SellUSDG(
        address account,
        address token,
        uint256 usdgAmount,
        uint256 tokenAmount,
        uint256 feeBasisPoints
    );
    event Swap(
        address account,
        address tokenIn,
        address tokenOut,
        uint256 amountIn,
        uint256 amountOut,
        uint256 amountOutAfterFees,
        uint256 feeBasisPoints
    );

    event IncreasePosition(
        bytes32 key,
        address account,
        address collateralToken,
        address indexToken,
        uint256 collateralDelta,
        uint256 sizeDelta,
        bool isLong,
        uint256 price,
        uint256 fee
    );
    event DecreasePosition(
        bytes32 key,
        address account,
        address collateralToken,
        address indexToken,
        uint256 collateralDelta,
        uint256 sizeDelta,
        bool isLong,
        uint256 price,
        uint256 fee
    );
    event LiquidatePosition(
        bytes32 key,
        address account,
        address collateralToken,
        address indexToken,
        bool isLong,
        uint256 size,
        uint256 collateral,
        uint256 reserveAmount,
        int256 realisedPnl,
        uint256 markPrice
    );
    event UpdatePosition(
        bytes32 key,
        uint256 size,
        uint256 collateral,
        uint256 averagePrice,
        uint256 entryFundingRate,
        uint256 reserveAmount,
        int256 realisedPnl,
        uint256 markPrice
    );
    event ClosePosition(
        bytes32 key,
        uint256 size,
        uint256 collateral,
        uint256 averagePrice,
        uint256 entryFundingRate,
        uint256 reserveAmount,
        int256 realisedPnl
    );

    event UpdateFundingRate(address token, uint256 fundingRate);
    event UpdatePnl(bytes32 key, bool hasProfit, uint256 delta);

    event CollectSwapFees(address token, uint256 feeUsd, uint256 feeTokens);
    event CollectMarginFees(address token, uint256 feeUsd, uint256 feeTokens);

    event DirectPoolDeposit(address token, uint256 amount);
    event IncreasePoolAmount(address token, uint256 amount);
    event DecreasePoolAmount(address token, uint256 amount);
    event IncreaseUsdgAmount(address token, uint256 amount);
    event DecreaseUsdgAmount(address token, uint256 amount);
    event IncreaseReservedAmount(address token, uint256 amount);
    event DecreaseReservedAmount(address token, uint256 amount);
    event IncreaseGuaranteedUsd(address token, uint256 amount);
    event DecreaseGuaranteedUsd(address token, uint256 amount);

    uint256 private constant NO_ERROR = 1000;

    // once the parameters are verified to be working correctly,
    // gov should be set to a timelock contract or a governance contract
    constructor() public {}

    function setFees(
        uint256 _taxBasisPoints,
        uint256 _stableTaxBasisPoints,
        uint256 _mintBurnFeeBasisPoints,
        uint256 _swapFeeBasisPoints,
        uint256 _stableSwapFeeBasisPoints,
        uint256 _marginFeeBasisPoints,
        uint256 _liquidationFeeUsd,
        uint256 _minProfitTime,
        bool _hasDynamicFees
        
    ) external returns (uint256) {
        if(msg.sender != gov) { return 53;}
        if(_taxBasisPoints > MAX_FEE_BASIS_POINTS) { return 3;}
        if(_stableTaxBasisPoints > MAX_FEE_BASIS_POINTS) { return 4;}
        if(_mintBurnFeeBasisPoints > MAX_FEE_BASIS_POINTS) { return 5;}
        if(_swapFeeBasisPoints > MAX_FEE_BASIS_POINTS ) {return 6;}
        if(_stableSwapFeeBasisPoints > MAX_FEE_BASIS_POINTS) {return 7;}
        if(_marginFeeBasisPoints > MAX_FEE_BASIS_POINTS) {return 8;}
        if(_liquidationFeeUsd > MAX_LIQUIDATION_FEE_USD) {return 9;}

        taxBasisPoints = _taxBasisPoints;
        stableTaxBasisPoints = _stableTaxBasisPoints;
        mintBurnFeeBasisPoints = _mintBurnFeeBasisPoints;
        swapFeeBasisPoints = _swapFeeBasisPoints;
        stableSwapFeeBasisPoints = _stableSwapFeeBasisPoints;
        marginFeeBasisPoints = _marginFeeBasisPoints;
        liquidationFeeUsd = _liquidationFeeUsd;
        minProfitTime = _minProfitTime;
        hasDynamicFees = _hasDynamicFees;

        return NO_ERROR;
    }

    function setFundingRate(
        uint256 _fundingInterval,
        uint256 _fundingRateFactor,
        uint256 _stableFundingRateFactor
    ) external {
        _onlyGov();
        _validate(_fundingInterval >= MIN_FUNDING_RATE_INTERVAL, 10);
        _validate(_fundingRateFactor <= MAX_FUNDING_RATE_FACTOR, 11);
        _validate(_stableFundingRateFactor <= MAX_FUNDING_RATE_FACTOR, 12);
        fundingInterval = _fundingInterval;
        fundingRateFactor = _fundingRateFactor;
        stableFundingRateFactor = _stableFundingRateFactor;
    }

    function setTokenConfig(
        address _token,
        uint256 _tokenDecimals,
        uint256 _tokenWeight,
        uint256 _minProfitBps,
        uint256 _maxUsdgAmount,
        bool _isStable,
        bool _isShortable
    ) external returns (uint256) {
        if(msg.sender != gov) { return 53;}
        // increment token count for the first time
        if (!whitelistedTokens[_token]) {
            whitelistedTokenCount = whitelistedTokenCount.add(1);
            allWhitelistedTokens.push(_token);
        }

        uint256 _totalTokenWeights = totalTokenWeights;
        _totalTokenWeights = _totalTokenWeights.sub(tokenWeights[_token]);

        whitelistedTokens[_token] = true;
        tokenDecimals[_token] = _tokenDecimals;
        tokenWeights[_token] = _tokenWeight;
        minProfitBasisPoints[_token] = _minProfitBps;
        maxUsdgAmounts[_token] = _maxUsdgAmount;
        stableTokens[_token] = _isStable;
        shortableTokens[_token] = _isShortable;

        totalTokenWeights = _totalTokenWeights.add(_tokenWeight);

        return NO_ERROR;
    }

    function setUsdgAmount(address _token, uint256 _amount) external returns (uint256){
        if(msg.sender != gov) { return 53;}

        uint256 usdgAmount = usdgAmounts[_token];
        if (_amount > usdgAmount) {
            _increaseUsdgAmount(_token, _amount.sub(usdgAmount));
            return NO_ERROR;
        }

        _decreaseUsdgAmount(_token, usdgAmount.sub(_amount));
        return NO_ERROR;
    }

    // deposit into the pool without minting USDG tokens
    // useful in allowing the pool to become over-collaterised
    function directPoolDeposit(address _token) external {
        _validate(whitelistedTokens[_token], 14);
        uint256 tokenAmount = _transferIn(_token);
        _validate(tokenAmount > 0, 15);
        _increasePoolAmount(_token, tokenAmount);
        emit DirectPoolDeposit(_token, tokenAmount);
    }

    function getMaxPrice(address _token) public view returns (uint256) {
        return IVaultPriceFeed(priceFeed).getPrice(_token, true, includeAmmPrice, useSwapPricing);
    }

    function _transferIn(address _token) private returns (uint256) {
        uint256 prevBalance = tokenBalances[_token];
        uint256 nextBalance = IERC20(_token).balanceOf(address(this));
        tokenBalances[_token] = nextBalance;

        return nextBalance.sub(prevBalance);
    }

    function _increasePoolAmount(address _token, uint256 _amount) private {
        poolAmounts[_token] = poolAmounts[_token].add(_amount);
        uint256 balance = IERC20(_token).balanceOf(address(this));
        _validate(poolAmounts[_token] <= balance, 49);
        emit IncreasePoolAmount(_token, _amount);
    }
    function _increaseUsdgAmount(address _token, uint256 _amount) private {
        usdgAmounts[_token] = usdgAmounts[_token].add(_amount);
        uint256 maxUsdgAmount = maxUsdgAmounts[_token];
        if (maxUsdgAmount != 0) {
            _validate(usdgAmounts[_token] <= maxUsdgAmount, 51);
        }
        emit IncreaseUsdgAmount(_token, _amount);
    }

    function _decreaseUsdgAmount(address _token, uint256 _amount) private {
        uint256 value = usdgAmounts[_token];
        // since USDG can be minted using multiple assets
        // it is possible for the USDG debt for a single asset to be less than zero
        // the USDG debt is capped to zero for this case
        if (value <= _amount) {
            usdgAmounts[_token] = 0;
            emit DecreaseUsdgAmount(_token, value);
            return;
        }
        usdgAmounts[_token] = value.sub(_amount);
        emit DecreaseUsdgAmount(_token, _amount);
    }

    // we have this validation as a function instead of a modifier to reduce contract size
    function _onlyGov() private view {
        _validate(msg.sender == gov, 53);
    }

    function _validate(bool _condition, uint256 _errorCode) private pure returns (uint256) {
        return _condition ? 0 : _errorCode;
        // require(_condition, errors[_errorCode]);
    }
}
