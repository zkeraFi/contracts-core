// SPDX-License-Identifier: MIT

pragma solidity 0.6.12;

import "../tokens/MintableBaseToken.sol";

contract ZKE is MintableBaseToken {
    
    constructor() public MintableBaseToken("ZKE", "ZKE", 50000000000000000000000000 /* 50m */) {
    }

    function id() external pure returns (string memory _name) {
        return "ZKE";
    }
}
