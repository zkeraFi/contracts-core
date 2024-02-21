// SPDX-License-Identifier: MIT
pragma experimental ABIEncoderV2;
pragma solidity 0.6.12;

interface IPyth_0_6_12 {
    // Get update data from pyth api and update price using IPyth contract.
    // Should update IPyth contract state
    function updatePriceFeeds(bytes[] calldata priceUpdateData) external payable;

    // Returns the required fee to update an array of price updates.
    function getUpdateFee(
        bytes[] calldata updateData
    ) external view returns (uint feeAmount);
}
