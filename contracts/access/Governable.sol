// SPDX-License-Identifier: MIT

pragma solidity 0.6.12;

contract Governable {
    address public gov;

    event SetGov(address oldGov, address newGov);

    constructor() public {
        gov = msg.sender;
    }

    modifier onlyGov() {
        require(msg.sender == gov, "Governable: forbidden");
        _;
    }

    function setGov(address _gov) external onlyGov {
        address oldGov = gov;
        gov = _gov;
        emit SetGov(oldGov, _gov);
    }
}
