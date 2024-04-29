// SPDX-License-Identifier: MIT
pragma solidity 0.8.18;

import "./interfaces/IDIAOracleV2.sol";
import "../access/Governable_0_8_18.sol";

contract DIAPriceFeed is Governable_0_8_18{

    uint256 public constant BASIS_POINTS_DIVISOR = 10000;

    address immutable ORACLE;
    string public key;
    uint256 public age;
    uint256 public conf;
    bool public isMaximizing;

    constructor(address _oracle, string memory _key, uint256 _age, uint256 _conf, bool _isMaximizing){
        ORACLE = _oracle;
        key = _key;
        age = _age;
        conf = _conf;
        isMaximizing = _isMaximizing;
    }

    function setConf(uint256 _conf) external onlyGov {
        conf = _conf;
    }

    function setKey(string memory _key) external onlyGov {
        key = _key;
    }

    function setAge(uint256 _age) external onlyGov {
        age = _age;
    }

    function setIsMaximizing(bool _isMaximizing) external onlyGov {
        isMaximizing = _isMaximizing;
    }
   
    function latestAnswer(bool maximize) external view returns(uint256){
        (uint128 latestPrice, uint128 timestampOflatestPrice) = IDIAOracleV2(ORACLE).getValue(key); 

        require(checkPriceAge(timestampOflatestPrice), "age");

        if(isMaximizing){
            uint256 maximizedPrice = getMaximizedPrice(maximize,latestPrice);
            return maximizedPrice;
        }

        return latestPrice;
    }

    function getMaximizedPrice(bool maximize, uint128 latestPrice) private view returns(uint256){
        uint256 maximizePrice;
        uint256 confOfPrice = latestPrice * (BASIS_POINTS_DIVISOR - conf) / BASIS_POINTS_DIVISOR;
        confOfPrice = latestPrice - confOfPrice;

        if(maximize){
        maximizePrice = latestPrice + confOfPrice;
        }
        else{
        maximizePrice = latestPrice - confOfPrice;
        }

        return maximizePrice;
    }

    function latestAnswer() external view returns(uint256){
        (uint128 latestPrice, uint128 timestampOflatestPrice) = IDIAOracleV2(ORACLE).getValue(key); 

        require(checkPriceAge(timestampOflatestPrice), "age");

        return latestPrice;
    }
   
    function checkPriceAge(uint128 _timestampOflatestPrice) private view returns (bool inTime){
         if((block.timestamp - _timestampOflatestPrice) < age){
             inTime = true;
         } else {
             inTime = false;
         }
    }
}