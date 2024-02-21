// SPDX-License-Identifier: MIT

pragma solidity 0.8.18;

interface IPythPriceFeed_0_8_18 {
    // one of the evm priceFeeds from  https://pyth.network/developers/price-feed-ids#pyth-evm-testnet
    function priceFeedId() external view returns (bytes32);

    // get validated by publishTime price +/- confidence interval
    function latestAnswer(bool maximize) external view returns (uint256);

    // get validated by publishTime average price
    function latestAnswer() external view returns (uint256);

    // get update data from pyth api and update price using IPyth contract.
    // should update IPyth contract state
    function updateAnswer(bytes[] calldata priceUpdateData) external payable;
}
