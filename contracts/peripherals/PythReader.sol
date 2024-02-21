// SPDX-License-Identifier: MIT

pragma experimental ABIEncoderV2;

import "../libraries/math/SafeMath.sol";
import "../libraries/token/IERC20.sol";
import "../oracle/interfaces/IBlockInfo.sol";
import "../core/interfaces/IVault.sol";
import "../core/interfaces/IBasePositionManager.sol";
import "../core/interfaces/IZlpManager.sol";

contract PythReader {
    using SafeMath for uint256;
    uint256 public constant BASIS_POINTS_DIVISOR = 10000;
    uint256 private constant PRICE_PRECISION = 10 ** 30;
    uint256 private constant ZLP_PRECISION = 10 ** 18;
    uint256 private constant USDG_DECIMALS = 18;
    uint256 public constant POSITION_PROPS_LENGTH = 9;

    //all _tokens should be whitelisted
    function getAum(
        IZlpManager _zlpManager,
        address[] memory _tokens,
        uint256[] memory _prices
    ) public view returns (uint256) {
        IVault vault = _zlpManager.vault();

        require(
            vault.whitelistedTokenCount() == _tokens.length &&
                _tokens.length == _prices.length,
            "PythHelper: _tokens.length != whitelistedTokenCount"
        );
        uint256 aum = _zlpManager.aumAddition();
        uint256 shortProfits = 0;

        for (uint256 i = 0; i < _tokens.length; i++) {
            address token = _tokens[i];

            if (!vault.whitelistedTokens(token)) {
                continue;
            }

            uint256 price = _prices[i];
            uint256 poolAmount = vault.poolAmounts(token);
            uint256 decimals = vault.tokenDecimals(token);

            if (vault.stableTokens(token)) {
                aum = aum.add(poolAmount.mul(price).div(10 ** decimals));
            } else {
                // add global short profit / loss
                uint256 size = vault.globalShortSizes(token);

                if (size > 0) {
                    (uint256 delta, bool hasProfit) = _zlpManager
                        .getGlobalShortDelta(token, price, size);
                    if (!hasProfit) {
                        // add losses from shorts
                        aum = aum.add(delta);
                    } else {
                        shortProfits = shortProfits.add(delta);
                    }
                }

                aum = aum.add(vault.guaranteedUsd(token));

                uint256 reservedAmount = vault.reservedAmounts(token);
                aum = aum.add(
                    poolAmount.sub(reservedAmount).mul(price).div(
                        10 ** decimals
                    )
                );
            }
        }

        uint256 aumDeduction = _zlpManager.aumDeduction();
        aum = shortProfits > aum ? 0 : aum.sub(shortProfits);
        return aumDeduction > aum ? 0 : aum.sub(aumDeduction);
    }

    function getAums(
        IZlpManager _zlpManager,
        address[] memory _tokens,
        uint256[] memory _maxPrices,
        uint256[] memory _minPrices
    ) public view returns (uint256[] memory) {
        uint256[] memory amounts = new uint256[](2);
        amounts[0] = getAum(_zlpManager, _tokens, _maxPrices);
        amounts[1] = getAum(_zlpManager, _tokens, _minPrices);

        return amounts;
    }

    function getPrice(
        IZlpManager _zlpManager,
        address[] memory _tokens,
        uint256[] memory _prices
    ) external view returns (uint256) {
        uint256 aum = getAum(_zlpManager, _tokens, _prices);
        uint256 supply = IERC20(_zlpManager.zlp()).totalSupply();
        return aum.mul(ZLP_PRECISION).div(supply);
    }

    function getVaultTokenInfoV5(
        address _vault,
        address _positionManager,
        address _weth,
        uint256 _usdgAmount,
        address[] memory _tokens,
        uint256[] memory _minPrices,
        uint256[] memory _maxPrices
    ) public view returns (uint256[] memory) {
        uint256 propsLength = 15;

        IVault vault = IVault(_vault);
        IBasePositionManager positionManager = IBasePositionManager(
            _positionManager
        );

        uint256[] memory amounts = new uint256[](_tokens.length * propsLength);
        for (uint256 i = 0; i < _tokens.length; i++) {
            address token = _tokens[i];
            if (token == address(0)) {
                token = _weth;
            }

            amounts[i * propsLength] = vault.poolAmounts(token);
            amounts[i * propsLength + 1] = vault.reservedAmounts(token);
            amounts[i * propsLength + 2] = vault.usdgAmounts(token);
            amounts[i * propsLength + 3] = getRedemptionAmount(
                vault,
                token,
                _usdgAmount,
                _maxPrices[i]
            );
            amounts[i * propsLength + 4] = vault.tokenWeights(token);
            amounts[i * propsLength + 5] = vault.bufferAmounts(token);
            amounts[i * propsLength + 6] = vault.maxUsdgAmounts(token);
            amounts[i * propsLength + 7] = vault.globalShortSizes(token);
            amounts[i * propsLength + 8] = positionManager.maxGlobalShortSizes(
                token
            );
            amounts[i * propsLength + 9] = positionManager.maxGlobalLongSizes(
                token
            );
            amounts[i * propsLength + 10] = _minPrices[i];
            amounts[i * propsLength + 11] = _maxPrices[i];
            amounts[i * propsLength + 12] = vault.guaranteedUsd(token);
            amounts[i * propsLength + 13] = _minPrices[i];
            amounts[i * propsLength + 14] = _maxPrices[i];
        }

        return amounts;
    }

    function getRedemptionAmount(
        IVault _vault,
        address _token,
        uint256 _usdgAmount,
        uint256 _maxPrice
    ) public view returns (uint256) {
        uint256 redemptionAmount = _usdgAmount.mul(PRICE_PRECISION).div(
            _maxPrice
        );
        return
            adjustForDecimals(_vault, redemptionAmount, _vault.usdg(), _token);
    }

    function adjustForDecimals(
        IVault _vault,
        uint256 _amount,
        address _tokenDiv,
        address _tokenMul
    ) private view returns (uint256) {
        uint256 decimalsDiv = _tokenDiv == _vault.usdg()
            ? USDG_DECIMALS
            : _vault.tokenDecimals(_tokenDiv);
        uint256 decimalsMul = _tokenMul == _vault.usdg()
            ? USDG_DECIMALS
            : _vault.tokenDecimals(_tokenMul);
        return _amount.mul(10 ** decimalsMul).div(10 ** decimalsDiv);
    }

    struct Position {
        uint256 size;
        uint256 collateral;
        uint256 averagePrice;
        uint256 entryFundingRate;
        uint256 reserveAmount;
        uint256 realisedPnl;
        bool hasRealisedProfit;
        uint256 lastIncreasedTime;
    }

    function getPosition(
        IVault _vault,
        address _account,
        address _collateralToken,
        address _indexToken,
        bool _isLong
    ) internal view returns (Position memory) {
        Position memory position;
        {
            (
                uint256 size,
                uint256 collateral,
                uint256 averagePrice,
                uint256 entryFundingRate,
                uint256 reserveAmount,
                uint256 realisedPnl,
                bool hasRealisedProfit,
                uint256 lastIncreasedTime
            ) = _vault.getPosition(
                    _account,
                    _collateralToken,
                    _indexToken,
                    _isLong
                );
            position.size = size;
            position.collateral = collateral;
            position.averagePrice = averagePrice;
            position.entryFundingRate = entryFundingRate;
            position.reserveAmount = reserveAmount;
            position.realisedPnl = realisedPnl;
            position.hasRealisedProfit = hasRealisedProfit;
            position.lastIncreasedTime = lastIncreasedTime;
        }
        return position;
    }

    struct LiquidationArgs {
        IVault _vault;
        address _account;
        address _collateralToken;
        address _indexToken;
        bool _isLong;
        bool _raise;
        uint256 _indexTokenPrice;
    }

    function validateLiquidation(
        IVault _vault,
        address _account,
        address _collateralToken,
        address _indexToken,
        bool _isLong,
        bool _raise,
        uint256 _indexTokenPrice
    ) external view returns (uint256, uint256) {
        Position memory position = getPosition(
            _vault,
            _account,
            _collateralToken,
            _indexToken,
            _isLong
        );

        LiquidationArgs memory args = LiquidationArgs({
            _vault: _vault,
            _account: _account,
            _collateralToken: _collateralToken,
            _indexToken: _indexToken,
            _isLong: _isLong,
            _raise: _raise,
            _indexTokenPrice: _indexTokenPrice
        });

        (bool hasProfit, uint256 delta) = getDelta(
            _vault,
            _indexToken,
            position.size,
            position.averagePrice,
            _isLong,
            position.lastIncreasedTime,
            _indexTokenPrice
        );

        uint256 remainingCollateral = _calculateCollateral(
            hasProfit,
            position.collateral,
            delta
        );
        uint256 marginFees = _calculateMarginFees(
            _vault.vaultUtils(),
            _account,
            _collateralToken,
            _indexToken,
            _isLong,
            position
        );

        return
            _handleLiquidation(
                args,
                hasProfit,
                delta,
                remainingCollateral,
                marginFees,
                position
            );
    }

    function _calculateCollateral(
        bool hasProfit,
        uint256 collateral,
        uint256 delta
    ) internal pure returns (uint256) {
        return !hasProfit ? collateral.sub(delta) : collateral;
    }

    function _calculateMarginFees(
        IVaultUtils vaultUtils,
        address _account,
        address _collateralToken,
        address _indexToken,
        bool _isLong,
        Position memory position
    ) internal view returns (uint256) {
        uint256 marginFees = vaultUtils.getFundingFee(
            _account,
            _collateralToken,
            _indexToken,
            _isLong,
            position.size,
            position.entryFundingRate
        );

        return
            marginFees.add(
                vaultUtils.getPositionFee(
                    _account,
                    _collateralToken,
                    _indexToken,
                    _isLong,
                    position.size
                )
            );
    }

    function _handleLiquidation(
        LiquidationArgs memory args,
        bool hasProfit,
        uint256 delta,
        uint256 remainingCollateral,
        uint256 marginFees,
        Position memory position
    ) internal view returns (uint256, uint256) {
        if (!hasProfit && position.collateral < delta) {
            if (args._raise) {
                revert("Vault: losses exceed collateral");
            }
            return (1, marginFees);
        }

        if (remainingCollateral < marginFees) {
            if (args._raise) {
                revert("Vault: fees exceed collateral");
            }
            // cap the fees to the remainingCollateral
            return (1, remainingCollateral);
        }

        if (
            remainingCollateral <
            marginFees.add(args._vault.liquidationFeeUsd())
        ) {
            if (args._raise) {
                revert("Vault: liquidation fees exceed collateral");
            }
            return (1, marginFees);
        }

        if (
            remainingCollateral.mul(args._vault.maxLeverage()) <
            position.size.mul(BASIS_POINTS_DIVISOR)
        ) {
            if (args._raise) {
                revert("Vault: maxLeverage exceeded");
            }
            return (2, marginFees);
        }

        return (0, marginFees);
    }

    function _processPosition(
        IVault _vault,
        address _account,
        address _collateralToken,
        address _indexToken,
        bool _isLong,
        uint256 _indexTokenPrice
    ) internal view returns (uint256[9] memory) {
        uint256[9] memory positionInfo;

        Position memory position = getPosition(
            _vault,
            _account,
            _collateralToken,
            _indexToken,
            _isLong
        );

        positionInfo[0] = position.size;
        positionInfo[1] = position.collateral;
        positionInfo[2] = position.averagePrice;
        positionInfo[3] = position.entryFundingRate;
        positionInfo[4] = position.hasRealisedProfit ? 1 : 0;
        positionInfo[5] = position.realisedPnl;
        positionInfo[6] = position.lastIncreasedTime;

        if (position.averagePrice > 0) {
            (bool hasProfit, uint256 delta) = getDelta(
                _vault,
                _indexToken,
                position.size,
                position.averagePrice,
                _isLong,
                position.lastIncreasedTime,
                _indexTokenPrice
            );
            positionInfo[7] = hasProfit ? 1 : 0;
            positionInfo[8] = delta;
        }

        return positionInfo;
    }

    function getPositions(
        IVault _vault,
        address _account,
        address[] memory _collateralTokens,
        address[] memory _indexTokens,
        bool[] memory _isLong,
        uint256[] memory _indexTokensPrices
    ) public view returns (uint256[] memory) {
        uint256[] memory amounts = new uint256[](
            _collateralTokens.length * POSITION_PROPS_LENGTH
        );

        for (uint256 i = 0; i < _collateralTokens.length; i++) {
            uint256[9] memory positionInfo = _processPosition(
                _vault,
                _account,
                _collateralTokens[i],
                _indexTokens[i],
                _isLong[i],
                _indexTokensPrices[i]
            );

            for (uint256 j = 0; j < POSITION_PROPS_LENGTH; j++) {
                amounts[i * POSITION_PROPS_LENGTH + j] = positionInfo[j];
            }
        }

        return amounts;
    }

    function getMultiPositions(
        IVault _vault,
        address[] memory _accounts,
        address[] memory _collateralTokens,
        address[] memory _indexTokens,
        bool[] memory _isLong,
        uint256[] memory _indexTokensPrices
    ) public view returns (uint256[][] memory) {
        uint256[][] memory multiAmounts = new uint256[][](_accounts.length);

        for (uint256 a = 0; a < _accounts.length; a++) {
            uint256[] memory amounts = new uint256[](
                _collateralTokens.length * POSITION_PROPS_LENGTH
            );
            for (uint256 i = 0; i < _collateralTokens.length; i++) {
                uint256[9] memory positionInfo = _processPosition(
                    _vault,
                    _accounts[a],
                    _collateralTokens[i],
                    _indexTokens[i],
                    _isLong[i],
                    _indexTokensPrices[i]
                );

                for (uint256 j = 0; j < POSITION_PROPS_LENGTH; j++) {
                    amounts[i * POSITION_PROPS_LENGTH + j] = positionInfo[j];
                }
            }
            multiAmounts[a] = amounts;
        }

        return multiAmounts;
    }

    function getDelta(
        IVault _vault,
        address _indexToken,
        uint256 _size,
        uint256 _averagePrice,
        bool _isLong,
        uint256 _lastIncreasedTime,
        uint256 _indexTokenPrice
    ) public view returns (bool, uint256) {
        require(_averagePrice > 0, "Vault: invalid _averagePrice 38");
        uint256 price = _indexTokenPrice; //_isLong ? getMinPrice(_indexToken) : getMaxPrice(_indexToken);
        uint256 priceDelta = _averagePrice > price
            ? _averagePrice.sub(price)
            : price.sub(_averagePrice);
        uint256 delta = _size.mul(priceDelta).div(_averagePrice);

        bool hasProfit;

        if (_isLong) {
            hasProfit = price > _averagePrice;
        } else {
            hasProfit = _averagePrice > price;
        }

        // if the minProfitTime has passed then there will be no min profit threshold
        // the min profit threshold helps to prevent front-running issues

        uint256 minBps = IBlockInfo(_vault.blockInfo()).getBlockTimestamp() >
            _lastIncreasedTime.add(_vault.minProfitTime())
            ? 0
            : _vault.minProfitBasisPoints(_indexToken);
        if (hasProfit && delta.mul(BASIS_POINTS_DIVISOR) <= _size.mul(minBps)) {
            delta = 0;
        }

        return (hasProfit, delta);
    }
}
