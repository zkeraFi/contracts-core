const { expect, use } = require("chai")
const { solidity } = require("ethereum-waffle")
const { deployContract, deployVault, deployTimeDistributor, deployVaultPriceFeed, deployZlpManager } = require("../shared/fixtures")
const { expandDecimals, getBlockTime, increaseTime, mineBlock, reportGasUsed, newWallet } = require("../shared/utilities")
const { toChainlinkPrice } = require("../shared/chainlink")
const { toUsd, toNormalizedPrice } = require("../shared/units")
const { initVault, getBnbConfig, getBtcConfig, getDaiConfig } = require("./Vault/helpers")
const { priceFeedIds, priceUpdateData } = require("../shared/pyth")

use(solidity)

describe("ZlpManager", function () {
  const provider = waffle.provider
  const [wallet, rewardRouter, user0, user1, user2, user3] = provider.getWallets()
  let vault
  let zlpManager
  let zlp
  let usdg
  let router
  let vaultPriceFeed
  let bnb
  let bnbPriceFeed
  let btc
  let btcPriceFeed
  let eth
  let ethPriceFeed
  let dai
  let daiPriceFeed
  let distributor0
  let yieldTracker0
  let reader
  let shortsTracker
  let pyth

  beforeEach(async () => {
    pyth = await deployContract("Pyth", [])
    bnb = await deployContract("Token", [])
    bnbPriceFeed = await deployContract("PythPriceFeedV2", [pyth.address,priceFeedIds.bnb,10000])

    btc = await deployContract("Token", [])
    btcPriceFeed = await deployContract("PythPriceFeedV2", [pyth.address,priceFeedIds.btc,10000])

    eth = await deployContract("Token", [])
    ethPriceFeed = await deployContract("PythPriceFeedV2", [pyth.address,priceFeedIds.eth,10000])

    dai = await deployContract("Token", [])
    daiPriceFeed = await deployContract("PythPriceFeedV2", [pyth.address,priceFeedIds.dai,10000])

    vault = await deployVault()
    usdg = await deployContract("USDG", [vault.address])
    router = await deployContract("Router", [vault.address, usdg.address, bnb.address, pyth.address])
    vaultPriceFeed = await deployVaultPriceFeed()
    zlp = await deployContract("ZLP", [])

    await initVault(vault, router, usdg, vaultPriceFeed)

    shortsTracker = await deployContract("ShortsTracker", [vault.address])
    await shortsTracker.setIsGlobalShortDataReady(true)

    zlpManager = await deployZlpManager([
      vault.address,
      usdg.address,
      zlp.address,
      shortsTracker.address,
      24 * 60 * 60
    ])
    await zlpManager.setShortsTrackerAveragePriceWeight(10000)

    distributor0 = await deployTimeDistributor([])
    yieldTracker0 = await deployContract("YieldTracker", [usdg.address])

    await yieldTracker0.setDistributor(distributor0.address)
    await distributor0.setDistribution([yieldTracker0.address], [1000], [bnb.address])

    await bnb.mint(distributor0.address, 5000)
    await usdg.setYieldTrackers([yieldTracker0.address])

    reader = await deployContract("Reader", [])

    await vaultPriceFeed.setTokenConfig(bnb.address, bnbPriceFeed.address, 8, false)
    await vaultPriceFeed.setTokenConfig(btc.address, btcPriceFeed.address, 8, false)
    await vaultPriceFeed.setTokenConfig(eth.address, ethPriceFeed.address, 8, false)
    await vaultPriceFeed.setTokenConfig(dai.address, daiPriceFeed.address, 8, false)

    await pyth.updatePrice(priceFeedIds.dai, toChainlinkPrice(1))
    await vault.setTokenConfig(...getDaiConfig(dai, daiPriceFeed))

    await pyth.updatePrice(priceFeedIds.btc, toChainlinkPrice(60000))
    await vault.setTokenConfig(...getBtcConfig(btc, btcPriceFeed))

    await pyth.updatePrice(priceFeedIds.bnb, toChainlinkPrice(300))
    await vault.setTokenConfig(...getBnbConfig(bnb, bnbPriceFeed))

    await zlp.setInPrivateTransferMode(true)
    await zlp.setMinter(zlpManager.address, true)

    await vault.setInManagerMode(true)
  })

  it("inits", async () => {
    expect(await zlpManager.gov()).eq(wallet.address)
    expect(await zlpManager.vault()).eq(vault.address)
    expect(await zlpManager.usdg()).eq(usdg.address)
    expect(await zlpManager.zlp()).eq(zlp.address)
    expect(await zlpManager.cooldownDuration()).eq(24 * 60 * 60)
  })

  it("setGov", async () => {
    await expect(zlpManager.connect(user0).setGov(user1.address))
      .to.be.revertedWith("Governable: forbidden")

    expect(await zlpManager.gov()).eq(wallet.address)

    await zlpManager.setGov(user0.address)
    expect(await zlpManager.gov()).eq(user0.address)

    await zlpManager.connect(user0).setGov(user1.address)
    expect(await zlpManager.gov()).eq(user1.address)
  })

  it("setHandler", async () => {
    await expect(zlpManager.connect(user0).setHandler(user1.address, true))
      .to.be.revertedWith("Governable: forbidden")

    expect(await zlpManager.gov()).eq(wallet.address)
    await zlpManager.setGov(user0.address)
    expect(await zlpManager.gov()).eq(user0.address)

    expect(await zlpManager.isHandler(user1.address)).eq(false)
    await zlpManager.connect(user0).setHandler(user1.address, true)
    expect(await zlpManager.isHandler(user1.address)).eq(true)
  })

  it("setCooldownDuration", async () => {
    await expect(zlpManager.connect(user0).setCooldownDuration(1000))
      .to.be.revertedWith("Governable: forbidden")

    await zlpManager.setGov(user0.address)

    await expect(zlpManager.connect(user0).setCooldownDuration(48 * 60 * 60 + 1))
      .to.be.revertedWith("ZlpManager: invalid _cooldownDuration")

    expect(await zlpManager.cooldownDuration()).eq(24 * 60 * 60)
    await zlpManager.connect(user0).setCooldownDuration(48 * 60 * 60)
    expect(await zlpManager.cooldownDuration()).eq(48 * 60 * 60)
  })

  it("setAumAdjustment", async () => {
    await expect(zlpManager.connect(user0).setAumAdjustment(29, 17))
      .to.be.revertedWith("Governable: forbidden")

    await zlpManager.setGov(user0.address)

    expect(await zlpManager.aumAddition()).eq(0)
    expect(await zlpManager.aumDeduction()).eq(0)
    expect(await zlpManager.getAum(true)).eq(0)
    await zlpManager.connect(user0).setAumAdjustment(29, 17)
    expect(await zlpManager.aumAddition()).eq(29)
    expect(await zlpManager.aumDeduction()).eq(17)
    expect(await zlpManager.getAum(true)).eq(12)
  })

  it("setShortsTrackerAveragePriceWeight", async () => {
    await expect(zlpManager.connect(user0).setShortsTrackerAveragePriceWeight(5000))
      .to.be.revertedWith("Governable: forbidden")

    expect(await zlpManager.shortsTrackerAveragePriceWeight()).eq(10000)
    expect(await zlpManager.gov()).eq(wallet.address)
    await zlpManager.connect(wallet).setShortsTrackerAveragePriceWeight(5000)
    expect(await zlpManager.shortsTrackerAveragePriceWeight()).eq(5000)
  })

  it("setShortsTracker", async () => {
    await expect(zlpManager.connect(user0).setShortsTracker(user2.address))
      .to.be.revertedWith("Governable: forbidden")

    expect(await zlpManager.shortsTracker()).eq(shortsTracker.address)
    expect(await zlpManager.gov()).eq(wallet.address)
    await zlpManager.connect(wallet).setShortsTracker(user2.address)
    expect(await zlpManager.shortsTracker()).eq(user2.address)
  })

  it("addLiquidity, removeLiquidity", async () => {
    await dai.mint(user0.address, expandDecimals(100, 18))
    await dai.connect(user0).approve(zlpManager.address, expandDecimals(100, 18))

    await expect(zlpManager.connect(user0).addLiquidity(
      dai.address,
      expandDecimals(100, 18),
      expandDecimals(101, 18),
      expandDecimals(101, 18)
    )).to.be.revertedWith("Vault: forbidden")

    await vault.setManager(zlpManager.address, true)

    await expect(zlpManager.connect(user0).addLiquidity(
      dai.address,
      expandDecimals(100, 18),
      expandDecimals(101, 18),
      expandDecimals(101, 18)
    )).to.be.revertedWith("ZlpManager: insufficient USDG output")

    await pyth.updatePrice(priceFeedIds.bnb, toChainlinkPrice(300))
    await pyth.updatePrice(priceFeedIds.bnb, toChainlinkPrice(300))
    await pyth.updatePrice(priceFeedIds.bnb, toChainlinkPrice(400))

    expect(await dai.balanceOf(user0.address)).eq(expandDecimals(100, 18))
    expect(await dai.balanceOf(vault.address)).eq(0)
    expect(await usdg.balanceOf(zlpManager.address)).eq(0)
    expect(await zlp.balanceOf(user0.address)).eq(0)
    expect(await zlpManager.lastAddedAt(user0.address)).eq(0)
    expect(await zlpManager.getAumInUsdg(true)).eq(0)

    const tx0 = await zlpManager.connect(user0).addLiquidity(
      dai.address,
      expandDecimals(100, 18),
      expandDecimals(99, 18),
      expandDecimals(99, 18)
    )
    await reportGasUsed(provider, tx0, "addLiquidity gas used")

    let blockTime = await getBlockTime(provider)

    expect(await dai.balanceOf(user0.address)).eq(0)
    expect(await dai.balanceOf(vault.address)).eq(expandDecimals(100, 18))
    expect(await usdg.balanceOf(zlpManager.address)).eq("99700000000000000000") // 99.7
    expect(await zlp.balanceOf(user0.address)).eq("99700000000000000000")
    expect(await zlp.totalSupply()).eq("99700000000000000000")
    expect(await zlpManager.lastAddedAt(user0.address)).eq(blockTime)
    expect(await zlpManager.getAumInUsdg(true)).eq("99700000000000000000")
    expect(await zlpManager.getAumInUsdg(false)).eq("99700000000000000000")

    await bnb.mint(user1.address, expandDecimals(1, 18))
    await bnb.connect(user1).approve(zlpManager.address, expandDecimals(1, 18))

    await zlpManager.connect(user1).addLiquidity(
      bnb.address,
      expandDecimals(1, 18),
      expandDecimals(299, 18),
      expandDecimals(299, 18)
    )
    blockTime = await getBlockTime(provider)

    expect(await usdg.balanceOf(zlpManager.address)).eq("498500000000000000000") // 498.8
    expect(await zlp.balanceOf(user0.address)).eq("99700000000000000000") // 99.7
    expect(await zlp.balanceOf(user1.address)).eq("398800000000000000000") // 299.1
    expect(await zlp.totalSupply()).eq("498500000000000000000")
    expect(await zlpManager.lastAddedAt(user1.address)).eq(blockTime)
    expect(await zlpManager.getAumInUsdg(true)).eq("498500000000000000000")
    expect(await zlpManager.getAumInUsdg(false)).eq("498500000000000000000")

    await expect(zlp.connect(user1).transfer(user2.address, expandDecimals(1, 18)))
      .to.be.revertedWith("BaseToken: msg.sender not whitelisted")

    await pyth.updatePrice(priceFeedIds.bnb, toChainlinkPrice(400))
    await pyth.updatePrice(priceFeedIds.bnb, toChainlinkPrice(400))
    await pyth.updatePrice(priceFeedIds.bnb, toChainlinkPrice(500))

    expect(await zlpManager.getAumInUsdg(true)).eq("598200000000000000000") // 598.2
    expect(await zlpManager.getAumInUsdg(false)).eq("598200000000000000000") // 498.5

    await pyth.updatePrice(priceFeedIds.btc, toChainlinkPrice(60000))
    await pyth.updatePrice(priceFeedIds.btc, toChainlinkPrice(60000))
    await pyth.updatePrice(priceFeedIds.btc, toChainlinkPrice(60000))

    await btc.mint(user2.address, "1000000") // 0.01 BTC, $500
    await btc.connect(user2).approve(zlpManager.address, expandDecimals(1, 18))

    await expect(zlpManager.connect(user2).addLiquidity(
      btc.address,
      "1000000",
      expandDecimals(599, 18),
      expandDecimals(399, 18)
    )).to.be.revertedWith("ZlpManager: insufficient USDG output")

    await expect(zlpManager.connect(user2).addLiquidity(
      btc.address,
      "1000000",
      expandDecimals(598, 18),
      expandDecimals(600, 18)
    )).to.be.revertedWith("ZlpManager: insufficient ZLP output")

    await zlpManager.connect(user2).addLiquidity(
      btc.address,
      "1000000",
      expandDecimals(598, 18),
      expandDecimals(398, 18)
    )

    blockTime = await getBlockTime(provider)

    expect(await usdg.balanceOf(zlpManager.address)).eq("1096700000000000000000") 
    expect(await zlp.balanceOf(user0.address)).eq("99700000000000000000") 
    expect(await zlp.balanceOf(user1.address)).eq("398800000000000000000") 
    expect(await zlp.balanceOf(user2.address)).eq("498500000000000000000") 
    expect(await zlp.totalSupply()).eq("997000000000000000000")
    expect(await zlpManager.lastAddedAt(user2.address)).eq(blockTime)
    expect(await zlpManager.getAumInUsdg(true)).eq("1196400000000000000000") 
    expect(await zlpManager.getAumInUsdg(false)).eq("1196400000000000000000") 

    await expect(zlpManager.connect(user0).removeLiquidity(
      dai.address,
      "99700000000000000000",
      expandDecimals(123, 18),
      user0.address
    )).to.be.revertedWith("ZlpManager: cooldown duration not yet passed")

    await increaseTime(provider, 24 * 60 * 60 + 1)
    await mineBlock(provider)

    await expect(zlpManager.connect(user0).removeLiquidity(
      dai.address,
      expandDecimals(73, 18),
      expandDecimals(100, 18),
      user0.address
    )).to.be.reverted //Vault: poolAmount exceeded
    expect(await dai.balanceOf(user0.address)).eq(0)
    expect(await zlp.balanceOf(user0.address)).eq("99700000000000000000") // 99.7

    await zlpManager.connect(user0).removeLiquidity(
      dai.address,
      expandDecimals(72, 18),
      0,
      user0.address
    )

    expect(await dai.balanceOf(user0.address)).eq("86140800000000000000") // 98.703, 72 * 1096.7 / 797.6 => 99
    expect(await bnb.balanceOf(user0.address)).eq(0)
    expect(await zlp.balanceOf(user0.address)).eq("27700000000000000000") // 27.7

    await zlpManager.connect(user0).removeLiquidity(
      bnb.address,
      "27700000000000000000", // 27.7, 27.7 * 1096.7 / 797.6 => 38.0875
      0, 
      user0.address
    )

    expect(await dai.balanceOf(user0.address)).eq("86140800000000000000")
    expect(await bnb.balanceOf(user0.address)).eq("66280560000000000")
    expect(await zlp.balanceOf(user0.address)).eq(0)

    expect(await zlp.totalSupply()).eq("897300000000000000000") 
    expect(await zlpManager.getAumInUsdg(true)).eq("1076760000000000000000") 
    expect(await zlpManager.getAumInUsdg(false)).eq("1076760000000000000000") // 967.23

    expect(await bnb.balanceOf(user1.address)).eq(0)
    expect(await zlp.balanceOf(user1.address)).eq("398800000000000000000")

    await zlpManager.connect(user1).removeLiquidity(
      bnb.address,
      "299100000000000000000", // 299.1, 299.1 * 967.23 / 697.9 => 414.527142857
      0,
      user1.address
    )

    expect(await bnb.balanceOf(user1.address)).eq("715686480000000000")
    expect(await zlp.balanceOf(user1.address)).eq("99700000000000000000")

    expect(await zlp.totalSupply()).eq("598200000000000000000")
    expect(await zlpManager.getAumInUsdg(true)).eq("717840000000000000000")
    expect(await zlpManager.getAumInUsdg(false)).eq("717840000000000000000") 

    expect(await btc.balanceOf(user2.address)).eq(0)
    expect(await zlp.balanceOf(user2.address)).eq("498500000000000000000") 

    expect(await vault.poolAmounts(dai.address)).eq("13300000000000000000") 
    expect(await vault.poolAmounts(bnb.address)).eq("212680000000000000") 
    expect(await vault.poolAmounts(btc.address)).eq("997000") 

    await usdg.addVault(zlpManager.address)

    const tx1 = await zlpManager.connect(user2).removeLiquidity(
      btc.address,
      expandDecimals(375, 18),
      0, 
      user2.address
    )
    await reportGasUsed(provider, tx1, "removeLiquidity gas used")

    expect(await btc.balanceOf(user2.address)).eq("747750")
    expect(await zlp.balanceOf(user2.address)).eq("123500000000000000000") // 23.8
  })

  it("addLiquidityForAccount, removeLiquidityForAccount", async () => {
    await vault.setManager(zlpManager.address, true)
    await zlpManager.setInPrivateMode(true)
    await zlpManager.setHandler(rewardRouter.address, true)

    await dai.mint(user3.address, expandDecimals(100, 18))
    await dai.connect(user3).approve(zlpManager.address, expandDecimals(100, 18))

    await expect(zlpManager.connect(user0).addLiquidityForAccount(
      user3.address,
      user0.address,
      dai.address,
      expandDecimals(100, 18),
      expandDecimals(101, 18),
      expandDecimals(101, 18)
    )).to.be.revertedWith("ZlpManager: forbidden")

    await expect(zlpManager.connect(rewardRouter).addLiquidityForAccount(
      user3.address,
      user0.address,
      dai.address,
      expandDecimals(100, 18),
      expandDecimals(101, 18),
      expandDecimals(101, 18)
    )).to.be.revertedWith("ZlpManager: insufficient USDG output")

    expect(await dai.balanceOf(user3.address)).eq(expandDecimals(100, 18))
    expect(await dai.balanceOf(user0.address)).eq(0)
    expect(await dai.balanceOf(vault.address)).eq(0)
    expect(await usdg.balanceOf(zlpManager.address)).eq(0)
    expect(await zlp.balanceOf(user0.address)).eq(0)
    expect(await zlpManager.lastAddedAt(user0.address)).eq(0)
    expect(await zlpManager.getAumInUsdg(true)).eq(0)

    await zlpManager.connect(rewardRouter).addLiquidityForAccount(
      user3.address,
      user0.address,
      dai.address,
      expandDecimals(100, 18),
      expandDecimals(99, 18),
      expandDecimals(99, 18)
    )

    let blockTime = await getBlockTime(provider)

    expect(await dai.balanceOf(user3.address)).eq(0)
    expect(await dai.balanceOf(user0.address)).eq(0)
    expect(await dai.balanceOf(vault.address)).eq(expandDecimals(100, 18))
    expect(await usdg.balanceOf(zlpManager.address)).eq("99700000000000000000") // 99.7
    expect(await zlp.balanceOf(user0.address)).eq("99700000000000000000")
    expect(await zlp.totalSupply()).eq("99700000000000000000")
    expect(await zlpManager.lastAddedAt(user0.address)).eq(blockTime)
    expect(await zlpManager.getAumInUsdg(true)).eq("99700000000000000000")

    await bnb.mint(user1.address, expandDecimals(1, 18))
    await bnb.connect(user1).approve(zlpManager.address, expandDecimals(1, 18))

    await increaseTime(provider, 24 * 60 * 60 + 1)
    await mineBlock(provider)

    await zlpManager.connect(rewardRouter).addLiquidityForAccount(
      user1.address,
      user1.address,
      bnb.address,
      expandDecimals(1, 18),
      expandDecimals(299, 18),
      expandDecimals(299, 18)
    )
    blockTime = await getBlockTime(provider)

    expect(await usdg.balanceOf(zlpManager.address)).eq("398800000000000000000") // 398.8
    expect(await zlp.balanceOf(user0.address)).eq("99700000000000000000")
    expect(await zlp.balanceOf(user1.address)).eq("299100000000000000000")
    expect(await zlp.totalSupply()).eq("398800000000000000000")
    expect(await zlpManager.lastAddedAt(user1.address)).eq(blockTime)
    expect(await zlpManager.getAumInUsdg(true)).eq("398800000000000000000")

    await expect(zlpManager.connect(user1).removeLiquidityForAccount(
      user1.address,
      bnb.address,
      "99700000000000000000",
      expandDecimals(290, 18),
      user1.address
    )).to.be.revertedWith("ZlpManager: forbidden")

    await expect(zlpManager.connect(rewardRouter).removeLiquidityForAccount(
      user1.address,
      bnb.address,
      "99700000000000000000",
      expandDecimals(290, 18),
      user1.address
    )).to.be.revertedWith("ZlpManager: cooldown duration not yet passed")

    await zlpManager.connect(rewardRouter).removeLiquidityForAccount(
      user0.address,
      dai.address,
      "79760000000000000000", // 79.76
      "79000000000000000000", // 79
      user0.address
    )

    expect(await dai.balanceOf(user0.address)).eq("79520720000000000000")
    expect(await bnb.balanceOf(user0.address)).eq(0)
    expect(await zlp.balanceOf(user0.address)).eq("19940000000000000000") // 19.94
  })

  context("Different avg price in Vault and ShortsTracker", async () => {
    beforeEach(async () => {

      await dai.mint(vault.address, expandDecimals(100000, 18))
      await vault.directPoolDeposit(dai.address)

      let aum = await zlpManager.getAum(true)
      expect(aum, "aum 0").to.equal(toUsd(100000))

      await pyth.updatePrice(priceFeedIds.btc, toChainlinkPrice(60000))
      await dai.mint(user0.address, expandDecimals(1000, 18))
      await dai.connect(user0).approve(router.address, expandDecimals(1000, 18))
      // vault globalShortSizes(BTC) will be 2000 and globalShortAveragePrices(BTC) will be 60000
      await router.connect(user0).increasePosition([dai.address], btc.address, expandDecimals(1000, 18), 0, toUsd(2000), false, toUsd(60000), priceUpdateData)

      // set different average price to ShortsTracker
      await shortsTracker.setIsGlobalShortDataReady(false)
      await shortsTracker.setInitData([btc.address], [toUsd(61000)])
      await shortsTracker.setIsGlobalShortDataReady(false)
    })

    it("ZlpManager ignores ShortsTracker if flag is off", async () => {
      expect(await shortsTracker.isGlobalShortDataReady()).to.be.false

      expect(await vault.globalShortSizes(btc.address), "size 0").to.equal(toUsd(2000))
      expect(await vault.globalShortAveragePrices(btc.address), "avg price 0").to.equal(toUsd(60000))

      await pyth.updatePrice(priceFeedIds.btc, toChainlinkPrice(54000))
      expect((await vault.getGlobalShortDelta(btc.address))[1], "delta 0").to.equal(toUsd(200))
      expect((await shortsTracker.getGlobalShortDelta(btc.address))[1], "delta 1").to.equal("229508196721311475409836065573770")

      // aum should be $100,000 pool - $200 shorts pnl = 99,800
      expect(await zlpManager.getAum(true), "aum 1").to.equal(toUsd(99800))
    })

    it("ZlpManager switches gradually to ShortsTracker average price", async () => {
      expect(await vault.globalShortSizes(btc.address), "size 0").to.equal(toUsd(2000))
      expect(await vault.globalShortAveragePrices(btc.address), "avg price 0").to.equal(toUsd(60000))

      await zlpManager.setShortsTrackerAveragePriceWeight(0)
      expect(await shortsTracker.globalShortAveragePrices(btc.address), "avg price 1").to.equal(toUsd(61000))

      await pyth.updatePrice(priceFeedIds.btc, toChainlinkPrice(54000))

      await shortsTracker.setIsGlobalShortDataReady(true)
      // with flag enabled it should be the same because shortsTrackerAveragePriceWeight is 0
      expect(await zlpManager.getAum(true), "aum 2").to.equal(toUsd(99800))

      // according to ShortsTracker data pnl is ~$229.51
      // gradually configure ZlpManager to use ShortsTracker for aum calculation
      await zlpManager.setShortsTrackerAveragePriceWeight(1000) // 10% for ShortsTracker, 90% for Vault
      // 100,000 - (200 * 90% + 229.51 * 10%) = 99,797.05
      expect(await zlpManager.getAum(true), "aum 3").to.equal("99797004991680532445923460898502496")

      await zlpManager.setShortsTrackerAveragePriceWeight(5000) // 50% for ShortsTracker, 50% for Vault
      // 100,000 - (200 * 50% + 229.51 * 50%) = 99,785.25
      expect(await zlpManager.getAum(true), "aum 4").to.equal("99785123966942148760330578512396695")

      await zlpManager.setShortsTrackerAveragePriceWeight(10000) // 100% for ShortsTracker
      // 100,000 - (200 * 0 + 229.51 * 100%) = 99,770.49
      expect(await zlpManager.getAum(true), "aum 5").to.equal("99770491803278688524590163934426230")
    })

    it("ZlpManager switches back to Vault average price after flag is turned off", async () => {
      await pyth.updatePrice(priceFeedIds.btc, toChainlinkPrice(54000))
      await zlpManager.setShortsTrackerAveragePriceWeight(10000)

      // flag is disabled, aum is calculated with Vault values
      expect(await zlpManager.getAum(true), "aum 0").to.equal(toUsd(99800))

      // enable ShortsTracker
      await shortsTracker.setIsGlobalShortDataReady(true)
      expect(await zlpManager.getAum(true), "aum 1").to.equal("99770491803278688524590163934426230")

      // back to vault
      await shortsTracker.setIsGlobalShortDataReady(false)
      expect(await zlpManager.getAum(true), "aum 2").to.equal(toUsd(99800))
    })
  })
})
