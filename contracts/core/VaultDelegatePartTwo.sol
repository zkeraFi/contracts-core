// SPDX-License-Identifier: MIT

pragma solidity 0.6.12;

import "../libraries/math/SafeMath.sol";
import "../libraries/token/IERC20.sol";
import "../libraries/token/SafeERC20.sol";
import "../libraries/utils/ReentrancyGuard.sol";

import "../oracle/interfaces/IBlockInfo.sol";
import "../tokens/interfaces/IUSDG.sol";
import "./interfaces/IVault.sol";
import "./interfaces/IVaultUtils.sol";
import "./interfaces/IVaultPriceFeed.sol";

contract VaultDelegatePartTwo is ReentrancyGuard {
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

    IBlockInfo public blockInfo;
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
    uint256 private constant NO_RESULT = 0;

    // once the parameters are verified to be working correctly,
    // gov should be set to a timelock contract or a governance contract
    constructor() public {
    }
    
    function getNextFundingRate(address _token) public view returns (uint256) {
        uint256 blockTimestamp = blockInfo.getBlockTimestamp();
        if (lastFundingTimes[_token].add(fundingInterval) > blockTimestamp) { return 0; }

        uint256 intervals = blockTimestamp.sub(lastFundingTimes[_token]).div(fundingInterval);
        uint256 poolAmount = poolAmounts[_token];
        if (poolAmount == 0) { return 0; }

        uint256 _fundingRateFactor = stableTokens[_token] ? stableFundingRateFactor : fundingRateFactor;
        return _fundingRateFactor.mul(reservedAmounts[_token]).mul(intervals).div(poolAmount);
    }
    function getRedemptionAmount(address _token, uint256 _usdgAmount) public view returns (uint256) {
        uint256 price = getMaxPrice(_token);
        uint256 redemptionAmount = _usdgAmount.mul(PRICE_PRECISION).div(price);
        return adjustForDecimals(redemptionAmount, usdg, _token);
    }

    function tokenToUsdMin(address _token, uint256 _tokenAmount) public view returns (uint256) {
        if (_tokenAmount == 0) { return 0; }
        uint256 price = getMinPrice(_token);
        uint256 decimals = tokenDecimals[_token];
        return _tokenAmount.mul(price).div(10 ** decimals);
    }
    function updateCumulativeFundingRate(address _collateralToken, address _indexToken) public {
        bool shouldUpdate = vaultUtils.updateCumulativeFundingRate(_collateralToken, _indexToken);
        uint256 blockTimestamp = blockInfo.getBlockTimestamp();
        if (!shouldUpdate) {
            return;
        }

        if (lastFundingTimes[_collateralToken] == 0) {
            lastFundingTimes[_collateralToken] = blockTimestamp.div(fundingInterval).mul(fundingInterval);
            return;
        }

        if (lastFundingTimes[_collateralToken].add(fundingInterval) > blockTimestamp) {
            return;
        }

        uint256 fundingRate = getNextFundingRate(_collateralToken);
        cumulativeFundingRates[_collateralToken] = cumulativeFundingRates[_collateralToken].add(fundingRate);
        lastFundingTimes[_collateralToken] = blockTimestamp.div(fundingInterval).mul(fundingInterval);

        emit UpdateFundingRate(_collateralToken, cumulativeFundingRates[_collateralToken]);
    }

    function buyUSDG(address _token, address _receiver) external returns (uint256, uint256) {
        if (inManagerMode) {
            if(!isManager[msg.sender]) return (54, NO_RESULT);
        }
        if(!whitelistedTokens[_token]) return (16, NO_RESULT);
        useSwapPricing = true;

        uint256 tokenAmount = _transferIn(_token);
        if(tokenAmount == 0) { return (17, NO_RESULT); }

        updateCumulativeFundingRate(_token, _token);

        uint256 price = getMinPrice(_token);

        uint256 usdgAmount = tokenAmount.mul(price).div(PRICE_PRECISION);
        usdgAmount = adjustForDecimals(usdgAmount, _token, usdg);
        if(usdgAmount == 0) { return (18, NO_RESULT); }

        uint256 feeBasisPoints = vaultUtils.getBuyUsdgFeeBasisPoints(_token, usdgAmount);
        uint256 amountAfterFees = _collectSwapFees(_token, tokenAmount, feeBasisPoints);
        uint256 mintAmount = amountAfterFees.mul(price).div(PRICE_PRECISION);
        mintAmount = adjustForDecimals(mintAmount, _token, usdg);

        uint256 errorCode;
        errorCode = _increaseUsdgAmount(_token, mintAmount);
        if(errorCode != NO_ERROR) { return (errorCode, NO_RESULT ); }

        errorCode = _increasePoolAmount(_token, amountAfterFees);
        if(errorCode != NO_ERROR) { return (errorCode, NO_RESULT ); }

        IUSDG(usdg).mint(_receiver, mintAmount);

        emit BuyUSDG(_receiver, _token, tokenAmount, mintAmount, feeBasisPoints);

        useSwapPricing = false;
        return (NO_ERROR, mintAmount);
    }


    function sellUSDG(address _token, address _receiver) external returns (uint256, uint256) {
        if (inManagerMode) {
            if(!isManager[msg.sender]) { return (54, NO_RESULT); }
        }
        if(!whitelistedTokens[_token]) return (19, NO_RESULT);
        useSwapPricing = true;

        uint256 usdgAmount = _transferIn(usdg);
        if(usdgAmount == 0) return (20, NO_RESULT);

        updateCumulativeFundingRate(_token, _token);

        uint256 redemptionAmount = getRedemptionAmount(_token, usdgAmount);
        if(redemptionAmount == 0) return (21, NO_RESULT);

        _decreaseUsdgAmount(_token, usdgAmount);
        uint256 errorCode = _decreasePoolAmount(_token, redemptionAmount);
        if(errorCode != NO_ERROR) return (errorCode, NO_RESULT);

        IUSDG(usdg).burn(address(this), usdgAmount);

        // the _transferIn call increased the value of tokenBalances[usdg]
        // usually decreases in token balances are synced by calling _transferOut
        // however, for usdg, the tokens are burnt, so _updateTokenBalance should
        // be manually called to record the decrease in tokens
        _updateTokenBalance(usdg);

        uint256 feeBasisPoints = vaultUtils.getSellUsdgFeeBasisPoints(_token, usdgAmount);
        uint256 amountOut = _collectSwapFees(_token, redemptionAmount, feeBasisPoints);
        if(amountOut == 0) return (22, NO_RESULT);
        _validate(amountOut > 0, 22);

        _transferOut(_token, amountOut, _receiver);

        emit SellUSDG(_receiver, _token, usdgAmount, amountOut, feeBasisPoints);

        useSwapPricing = false;
        return (NO_ERROR, amountOut);
    }

    function swap(address _tokenIn, address _tokenOut, address _receiver) external returns (uint256, uint256) {
        if(!isSwapEnabled) return (23, NO_RESULT);
        if(!whitelistedTokens[_tokenIn]) return (24, NO_RESULT);
        if(!whitelistedTokens[_tokenOut]) return (25, NO_RESULT);
        if(_tokenIn == _tokenOut) return (26, NO_RESULT);

        useSwapPricing = true;

        updateCumulativeFundingRate(_tokenIn, _tokenIn);
        updateCumulativeFundingRate(_tokenOut, _tokenOut);

        uint256 amountIn = _transferIn(_tokenIn);
        if(amountIn == 0) return (27, NO_RESULT);

        uint256 priceIn = getMinPrice(_tokenIn);
        uint256 priceOut = getMaxPrice(_tokenOut);

        uint256 amountOut = amountIn.mul(priceIn).div(priceOut);
        amountOut = adjustForDecimals(amountOut, _tokenIn, _tokenOut);

        // adjust usdgAmounts by the same usdgAmount as debt is shifted between the assets
        uint256 usdgAmount = amountIn.mul(priceIn).div(PRICE_PRECISION);
        usdgAmount = adjustForDecimals(usdgAmount, _tokenIn, usdg);

        uint256 feeBasisPoints = vaultUtils.getSwapFeeBasisPoints(_tokenIn, _tokenOut, usdgAmount);
        uint256 amountOutAfterFees = _collectSwapFees(_tokenOut, amountOut, feeBasisPoints);

        uint256 errorCode;
        errorCode = _increaseUsdgAmount(_tokenIn, usdgAmount);
        if(errorCode != NO_ERROR) return (errorCode, NO_RESULT);
        _decreaseUsdgAmount(_tokenOut, usdgAmount);

        errorCode = _increasePoolAmount(_tokenIn, amountIn);
        if(errorCode != NO_ERROR) return (errorCode, NO_RESULT);
        errorCode = _decreasePoolAmount(_tokenOut, amountOut);
        if(errorCode != NO_ERROR) return (errorCode, NO_RESULT);

        _validateBufferAmount(_tokenOut);

        _transferOut(_tokenOut, amountOutAfterFees, _receiver);

        emit Swap(_receiver, _tokenIn, _tokenOut, amountIn, amountOut, amountOutAfterFees, feeBasisPoints);

        useSwapPricing = false;
        return (NO_ERROR, amountOutAfterFees);
    }

    function adjustForDecimals(uint256 _amount, address _tokenDiv, address _tokenMul) public view returns (uint256) {
        uint256 decimalsDiv = _tokenDiv == usdg ? USDG_DECIMALS : tokenDecimals[_tokenDiv];
        uint256 decimalsMul = _tokenMul == usdg ? USDG_DECIMALS : tokenDecimals[_tokenMul];
        return _amount.mul(10 ** decimalsMul).div(10 ** decimalsDiv);
    }

    function getMaxPrice(address _token) public view returns (uint256) {
        return IVaultPriceFeed(priceFeed).getPrice(_token, true, includeAmmPrice, useSwapPricing);
    }

     function getMinPrice(address _token) public view returns (uint256) {
        return IVaultPriceFeed(priceFeed).getPrice(_token, false, includeAmmPrice, useSwapPricing);
    }

    function _updateTokenBalance(address _token) private {
        uint256 nextBalance = IERC20(_token).balanceOf(address(this));
        tokenBalances[_token] = nextBalance;
    }
    function _decreasePoolAmount(address _token, uint256 _amount) private returns (uint256){
        poolAmounts[_token] = poolAmounts[_token].sub(_amount, "Vault: poolAmount exceeded");
        if(reservedAmounts[_token] > poolAmounts[_token]) return 50;
        emit DecreasePoolAmount(_token, _amount);

        return NO_ERROR;
    }

    function _collectSwapFees(address _token, uint256 _amount, uint256 _feeBasisPoints) private returns (uint256) {
        uint256 afterFeeAmount = _amount.mul(BASIS_POINTS_DIVISOR.sub(_feeBasisPoints)).div(BASIS_POINTS_DIVISOR);
        uint256 feeAmount = _amount.sub(afterFeeAmount);
        feeReserves[_token] = feeReserves[_token].add(feeAmount);
        emit CollectSwapFees(_token, tokenToUsdMin(_token, feeAmount), feeAmount);
        return afterFeeAmount;
    }

    function _transferIn(address _token) private returns (uint256) {
        uint256 prevBalance = tokenBalances[_token];
        uint256 nextBalance = IERC20(_token).balanceOf(address(this));
        tokenBalances[_token] = nextBalance;

        return nextBalance.sub(prevBalance);
    }

    function _transferOut(address _token, uint256 _amount, address _receiver) private {
        IERC20(_token).safeTransfer(_receiver, _amount);
        tokenBalances[_token] = IERC20(_token).balanceOf(address(this));
    }

    function _increasePoolAmount(address _token, uint256 _amount) private returns (uint256) {
        poolAmounts[_token] = poolAmounts[_token].add(_amount);
        uint256 balance = IERC20(_token).balanceOf(address(this));
        if(poolAmounts[_token] > balance) { return 49; }
        emit IncreasePoolAmount(_token, _amount);
        return NO_ERROR;
    }
    function _increaseUsdgAmount(address _token, uint256 _amount) private returns (uint256) {
        usdgAmounts[_token] = usdgAmounts[_token].add(_amount);
        uint256 maxUsdgAmount = maxUsdgAmounts[_token];
        if (maxUsdgAmount != 0) {
            if(usdgAmounts[_token] > maxUsdgAmount) { return 51; }
        }
        emit IncreaseUsdgAmount(_token, _amount);
        return NO_ERROR;
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

    function _validateBufferAmount(address _token) private view {
        if (poolAmounts[_token] < bufferAmounts[_token]) {
            revert("Vault: poolAmount < buffer");
        }
    }

    function _validateManager() private view {
        if (inManagerMode) {
            _validate(isManager[msg.sender], 54);
        }
    }

    function _validate(bool _condition, uint256 _errorCode) private view {
        require(_condition, errors[_errorCode]);
    }
}
