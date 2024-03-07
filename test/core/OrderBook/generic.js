const { expect, use } = require("chai")
const { solidity } = require("ethereum-waffle")
const { deployContract,deployVault, deployTimeDistributor, deployVaultPriceFeed } = require("../../shared/fixtures")
const { expandDecimals, } = require("../../shared/utilities")
const { toChainlinkPrice } = require("../../shared/chainlink")
const { initVault, getBnbConfig, getBtcConfig, getDaiConfig } = require("../Vault/helpers")
const { priceFeedIds, priceUpdateData } = require("../../shared/pyth")

use(solidity)

const BTC_PRICE = 60000;
const BNB_PRICE = 300;

describe("OrderBookV2", function () {
    const provider = waffle.provider
    const [wallet, user0, user1, user2, user3] = provider.getWallets()

    let orderBook;
    let defaults;
    let tokenDecimals;
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
            [eth.address]: 8,
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

        await dai.mint(user0.address, expandDecimals(20000000, 18))
        await dai.connect(user0).transfer(vault.address, expandDecimals(2000000, 18))
        await vault.directPoolDeposit(dai.address);

        await btc.mint(user0.address, expandDecimals(1000, 8))
        await btc.connect(user0).transfer(vault.address, expandDecimals(100, 8))
        await vault.directPoolDeposit(btc.address);

        await eth.mint(user0.address, expandDecimals(10000, 18))
        await eth.connect(user0).transfer(vault.address, expandDecimals(10000, 18))
        await vault.directPoolDeposit(eth.address);
    });

    it("setGov", async () => {
        await expect(orderBook.connect(user0).setGov(user1.address)).to.be.revertedWith("OrderBook: forbidden")

        expect(await orderBook.gov()).eq(wallet.address)

        await orderBook.setGov(user0.address)
        expect(await orderBook.gov()).eq(user0.address)

        await orderBook.connect(user0).setGov(user1.address)
        expect(await orderBook.gov()).eq(user1.address)
    });

    it("set*", async() => {
        const cases = [
            ['setMinExecutionFee', 600000],
            ['setMinPurchaseTokenAmountUsd', 1]
        ];
        for (const [name, arg] of cases) {
            await expect(orderBook.connect(user1)[name](arg)).to.be.revertedWith("OrderBook: forbidden");
            await expect(orderBook[name](arg));
        }
    })

    it("initialize, already initialized", async () => {
        await expect(orderBook.connect(user1).initialize(
            router.address,
            vault.address,
            eth.address,
            usdg.address,
            1,
            expandDecimals(5, 30), // minPurchseTokenAmountUsd
            pyth.address
        )).to.be.revertedWith("OrderBook: forbidden");

        await expect(orderBook.initialize(
            router.address,
            vault.address,
            eth.address,
            usdg.address,
            1,
            expandDecimals(5, 30), // minPurchseTokenAmountUsd
            pyth.address
        )).to.be.revertedWith("OrderBook: already initialized");
    });
});
