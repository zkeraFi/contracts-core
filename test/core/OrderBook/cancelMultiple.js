const { expect, use } = require("chai")
const { solidity } = require("ethereum-waffle")
const { deployContract,deployVault, deployVaultPriceFeed, deployTimeDistributor } = require("../../shared/fixtures")
const { expandDecimals, reportGasUsed, gasUsed } = require("../../shared/utilities")
const { toChainlinkPrice } = require("../../shared/chainlink")
const { toUsd, toNormalizedPrice } = require("../../shared/units")
const { initVault, getBnbConfig, getBtcConfig, getDaiConfig } = require("../Vault/helpers")
const {
    getDefault,
    validateOrderFields,
    getTxFees,
    positionWrapper,
    defaultCreateIncreaseOrderFactory,
    defaultCreateDecreaseOrderFactory,
    defaultCreateSwapOrderFactory,
    PRICE_PRECISION
} = require('./helpers');
const { priceFeedIds } = require("../../shared/pyth")

use(solidity);

const BTC_PRICE = 60000;
const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";
const BNB_PRICE = 300;

describe("OrderBook, cancelMultiple", function () {
    const provider = waffle.provider
    const [wallet, user0, user1, user2, user3] = provider.getWallets()

    let orderBook;
    let increaseOrderDefaults;
    let decreaseOrderDefaults;
    let swapOrderDefaults;
    let tokenDecimals;
    let defaultCreateIncreaseOrder;
    let pyth;

    beforeEach(async () => {
        pyth = await deployContract("Pyth", [])
        eth = await deployContract("Token", [])
        ethPriceFeed = await deployContract("PythPriceFeedV2", [pyth.address,priceFeedIds.eth,10000])

        btc = await deployContract("Token", [])
        btcPriceFeed = await deployContract("PythPriceFeedV2", [pyth.address,priceFeedIds.btc,10000])

        eth = await deployContract("Token", [])
        ethPriceFeed = await deployContract("PythPriceFeedV2", [pyth.address,priceFeedIds.eth,10000])

        dai = await deployContract("Token", [])
        daiPriceFeed = await deployContract("PythPriceFeedV2", [pyth.address,priceFeedIds.dai,10000])

        busd = await deployContract("Token", [])

        vault = await deployVault()
        usdg = await deployContract("USDG", [vault.address])
        router = await deployContract("Router", [vault.address, usdg.address, eth.address,pyth.address])
        vaultPriceFeed = await deployVaultPriceFeed()

        await initVault(vault, router, usdg, vaultPriceFeed)

        distributor0 = await deployTimeDistributor([])
        yieldTracker0 = await deployContract("YieldTracker", [usdg.address])

        await yieldTracker0.setDistributor(distributor0.address)
        await distributor0.setDistribution([yieldTracker0.address], [1000], [eth.address])

        await eth.mint(distributor0.address, 5000)
        await usdg.setYieldTrackers([yieldTracker0.address])

        reader = await deployContract("Reader", [])

        await vaultPriceFeed.setTokenConfig(eth.address, ethPriceFeed.address, 8, false)
        await vaultPriceFeed.setTokenConfig(btc.address, btcPriceFeed.address, 8, false)
        await vaultPriceFeed.setTokenConfig(eth.address, ethPriceFeed.address, 8, false)
        await vaultPriceFeed.setTokenConfig(dai.address, daiPriceFeed.address, 8, false)

        tokenDecimals = {
            [eth.address]: 18,
            [dai.address]: 18,
            [btc.address]: 8
        };

        await pyth.updatePrice(priceFeedIds.dai, toChainlinkPrice(1))
        await vault.setTokenConfig(...getDaiConfig(dai, daiPriceFeed))

        await pyth.updatePrice(priceFeedIds.btc, toChainlinkPrice(BTC_PRICE))
        await vault.setTokenConfig(...getBtcConfig(btc, btcPriceFeed))

        await pyth.updatePrice(priceFeedIds.eth, toChainlinkPrice(BNB_PRICE))
        await vault.setTokenConfig(...getBnbConfig(eth, ethPriceFeed))

        orderBook = await deployContract("OrderBookV2", [])
        const minExecutionFee = 500000;
        await orderBook.initialize(
            router.address,
            vault.address,
            eth.address,
            usdg.address,
            minExecutionFee,
            expandDecimals(5, 30), // minPurchseTokenAmountUsd
            pyth.address
        );
        await orderBook.setHandler(wallet.address,true);
        await router.addPlugin(orderBook.address);
        await router.connect(user0).approvePlugin(orderBook.address);

        await btc.mint(user0.address, expandDecimals(1000, 8))
        await btc.connect(user0).approve(router.address, expandDecimals(100, 8))

        await dai.mint(user0.address, expandDecimals(10000000, 18))
        await dai.connect(user0).approve(router.address, expandDecimals(1000000, 18))

        await eth.mint(user0.address, expandDecimals(10000000, 18))
        await eth.connect(user0).approve(router.address, expandDecimals(1000000, 18))

        await dai.mint(user0.address, expandDecimals(20000000, 18))
        await dai.connect(user0).transfer(vault.address, expandDecimals(2000000, 18))
        await vault.directPoolDeposit(dai.address);

        await btc.mint(user0.address, expandDecimals(1000, 8))
        await btc.connect(user0).transfer(vault.address, expandDecimals(100, 8))
        await vault.directPoolDeposit(btc.address);

        await eth.mint(user0.address, expandDecimals(50000, 18))
        await eth.connect(user0).transfer(vault.address, expandDecimals(10000, 18))
        await vault.directPoolDeposit(eth.address);

        increaseOrderDefaults = {
            path: [btc.address],
            sizeDelta: toUsd(100000),
            amountIn: expandDecimals(1, 8),
            minOut: 0,
            triggerPrice: toUsd(53000),
            triggerAboveThreshold: true,
            executionFee: expandDecimals(1, 9).mul(1500000),
            collateralToken: btc.address,
            collateralDelta: toUsd(BTC_PRICE),
            user: user0,
            isLong: true,
            shouldWrap: false
        };

        decreaseOrderDefaults = {
            path: [btc.address],
            sizeDelta: toUsd(100000),
            amountIn: expandDecimals(1, 8),
            minOut: 0,
            triggerPrice: toUsd(53000),
            triggerAboveThreshold: true,
            executionFee: expandDecimals(1, 9).mul(1500000),
            collateralToken: btc.address,
            collateralDelta: toUsd(BTC_PRICE),
            user: user0,
            isLong: true
        };

        swapOrderDefaults = {
            path: [dai.address, btc.address],
            sizeDelta: toUsd(100000),
            minOut: 0,
            amountIn: expandDecimals(1000, 18),
            triggerPrice: toUsd(53000),
            triggerAboveThreshold: true,
            executionFee: expandDecimals(1, 9).mul(1500000),
            collateralToken: btc.address,
            collateralDelta: toUsd(BTC_PRICE),
            user: user0,
            isLong: true,
            shouldWrap: false,
            shouldUnwrap: true
        };

        defaultCreateIncreaseOrder = defaultCreateIncreaseOrderFactory(orderBook, increaseOrderDefaults)
        defaultCreateDecreaseOrder = defaultCreateDecreaseOrderFactory(orderBook, decreaseOrderDefaults)
        defaultCreateSwapOrder = defaultCreateSwapOrderFactory(orderBook, swapOrderDefaults, tokenDecimals)
    });

    it("cancelMultiple", async () => {
        async function expectOrderAccountEquals(type, address, index) {
            const method = type + "Orders"
            const order = await orderBook[method](user0.address, index)
            expect(order.account).to.be.equal(address)
        }

        const triggerRatio = toUsd(1).mul(PRICE_PRECISION).div(toUsd(58000));
        await defaultCreateSwapOrder({ triggerRatio })
        expectOrderAccountEquals("swap", user0.address, 0)

        await defaultCreateIncreaseOrder()
        expectOrderAccountEquals("increase", user0.address, 0)

        await defaultCreateDecreaseOrder()
        await defaultCreateDecreaseOrder()
        expectOrderAccountEquals("decrease", user0.address, 1)

        await orderBook.connect(user0).cancelMultiple([0], [], []) // delete swap order
        expectOrderAccountEquals("swap", ZERO_ADDRESS, 0)
        expectOrderAccountEquals("decrease", user0.address, 1)
        expectOrderAccountEquals("increase", user0.address, 0)

        await orderBook.connect(user0).cancelMultiple([], [0], [1]) // delete increase and decrease
        expectOrderAccountEquals("swap", ZERO_ADDRESS, 0)
        expectOrderAccountEquals("decrease", ZERO_ADDRESS, 1)
        expectOrderAccountEquals("decrease", user0.address, 0)
        expectOrderAccountEquals("increase", ZERO_ADDRESS, 0)

        await expect(orderBook.connect(user0).cancelMultiple([0], [], []))
            .to.be.revertedWith("OrderBook: non-existent order")
    })
})
