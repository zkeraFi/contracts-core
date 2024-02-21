// SPDX-License-Identifier: MIT
pragma solidity 0.8.18;

import "@pythnetwork/pyth-sdk-solidity/IPyth.sol";
import "@pythnetwork/pyth-sdk-solidity/PythStructs.sol";
import "./interfaces/IPythPriceFeed_0_8_18.sol";
import "../access/Governable_0_8_18.sol";

contract PythPriceFeedV2 is IPythPriceFeed_0_8_18, Governable_0_8_18 {
    uint256 public constant BASIS_POINTS_DIVISOR = 10000;
    bytes32 public override priceFeedId;
    uint8 public constant decimals = 8;
    IPyth public pyth;
    uint256 public confDiveder = 8;

    // default value 1 minute. 
    // See pyth docs:
        /*
        /// @notice Returns the price that is no older than `age` seconds of the current time.
        /// @dev This function is a sanity-checked version of `getPriceUnsafe` which is useful in
        /// applications that require a sufficiently-recent price. Reverts if the price wasn't updated sufficiently
        /// recently.
        /// @return price - please read the documentation of PythStructs.Price to understand how to use this safely.
        function getPriceNoOlderThan(
            bytes32 id,
            uint age
        ) external view returns (PythStructs.Price memory price);
        */
    // Due to the specific error on zkEra with block timestamp there are possible situations when transaction fails onChain spending gas
    uint256 public age; 

    //// get _pythContract https://docs.pyth.network/pythnet-price-feeds/evm
    constructor(address _pythContract, bytes32 _priceFeedId, uint256 _age) {
        pyth = IPyth(_pythContract);
        priceFeedId = _priceFeedId;
        age = _age;
    }

    function setAge(uint256 _age) external onlyGov {
        age = _age;
    }

    function setConfDiveder(uint256 _confDiveder) external onlyGov {
        confDiveder = _confDiveder;
    }

    // Reverts if the price has not been updated within the last `pyth.getValidTimePeriod()` seconds.
    function latestAnswer(bool maximize) external view override returns (uint256) {
        PythStructs.Price memory rawPrice = pyth.getPriceNoOlderThan(priceFeedId, age);
        if (rawPrice.price < 0 || rawPrice.expo > 0 || rawPrice.expo < -255) {
            revert("PythPriceFeed: invalid price");
        }
        (uint256 price, uint256 conf) = convertToUint256(rawPrice, decimals);
        conf = conf * BASIS_POINTS_DIVISOR / confDiveder / BASIS_POINTS_DIVISOR;
        if(maximize) {
            return price + conf;
        } else {
            return price - conf;
        }
    }

    // Reverts if the price has not been updated within the last `pyth.getValidTimePeriod()` seconds.
    function latestAnswer() external view override returns (uint256) {
      PythStructs.Price memory rawPrice = pyth.getPriceNoOlderThan(priceFeedId, age);
      if (rawPrice.price < 0 || rawPrice.expo > 0 || rawPrice.expo < -255) {
          revert("PythPriceFeed: invalid price");
      }
      (uint256 price,) = convertToUint256(rawPrice, decimals);
      return price;
    }

    function updateAnswer(bytes[] calldata priceUpdateData) external payable override {
        uint256 fee = pyth.getUpdateFee(priceUpdateData);
        require(msg.value == fee, "PythPriceFeed: use correct price update fee");
        pyth.updatePriceFeeds{ value: fee }(priceUpdateData);
    }

    function convertToUint256(
        PythStructs.Price memory rawPrice,
        uint8 targetDecimals
    ) private pure returns (/*price*/ uint256, /*conf*/ uint256) {
        if (rawPrice.price < 0 || rawPrice.expo > 0 || rawPrice.expo < -255) {
            revert("PythPriceFeed: invalid price");
        }

        uint32 priceDecimals = uint32(-1 * rawPrice.expo);
        uint32 powerOfTen;

        if (targetDecimals >= priceDecimals) {
            powerOfTen = uint32(targetDecimals - priceDecimals);
        } else {
            powerOfTen = uint32(priceDecimals - targetDecimals);
        }
        return (
          uint256(uint64(rawPrice.price)) * 10 ** powerOfTen,
          uint256(rawPrice.conf) * 10 ** powerOfTen
        );
    }
}
