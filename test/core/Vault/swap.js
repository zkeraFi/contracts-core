const { expect, use } = require("chai")
const { solidity } = require("ethereum-waffle")
const { deployContract, deployVault, deployTimeDistributor, deployVaultPriceFeed, deployZlpManager } = require("../../shared/fixtures")
const { expandDecimals, getBlockTime, increaseTime, mineBlock, reportGasUsed } = require("../../shared/utilities")
const { toChainlinkPrice } = require("../../shared/chainlink")
const { toUsd, toNormalizedPrice } = require("../../shared/units")
const { initVault, getBnbConfig, getBtcConfig, getEthConfig, getDaiConfig } = require("./helpers")
const { priceFeedIds } = require("../../shared/pyth")

use(solidity)

describe("Vault.swap", function () {
  const provider = waffle.provider
  const [wallet, user0, user1, user2, user3] = provider.getWallets()
  let vault
  let vaultPriceFeed
  let usdg
  let router
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

  let zlpManager
  let zlp

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

    await initVault(vault, router, usdg, vaultPriceFeed)

    distributor0 = await deployTimeDistributor([])
    yieldTracker0 = await deployContract("YieldTracker", [usdg.address])

    await yieldTracker0.setDistributor(distributor0.address)
    await distributor0.setDistribution([yieldTracker0.address], [1000], [bnb.address])

    await bnb.mint(distributor0.address, 5000)
    await usdg.setYieldTrackers([yieldTracker0.address])

    await vaultPriceFeed.setTokenConfig(bnb.address, bnbPriceFeed.address, 8, false)
    await vaultPriceFeed.setTokenConfig(btc.address, btcPriceFeed.address, 8, false)
    await vaultPriceFeed.setTokenConfig(eth.address, ethPriceFeed.address, 8, false)
    await vaultPriceFeed.setTokenConfig(dai.address, daiPriceFeed.address, 8, false)

    zlp = await deployContract("ZLP", [])
    zlpManager = await deployZlpManager([vault.address, usdg.address, zlp.address, ethers.constants.AddressZero, 24 * 60 * 60])
  })

  it("swap", async () => {
    await expect(vault.connect(user1).swap(bnb.address, btc.address, user2.address))
      .to.be.revertedWith("Vault: _tokenIn not whitelisted")

    await vault.setIsSwapEnabled(false)

    await expect(vault.connect(user1).swap(bnb.address, btc.address, user2.address))
      .to.be.revertedWith("Vault: swaps not enabled")

    await vault.setIsSwapEnabled(true)

    await pyth.updatePrice(priceFeedIds.bnb, toChainlinkPrice(300))

    await vault.setTokenConfig(...getBnbConfig(bnb, bnbPriceFeed))

    await expect(vault.connect(user1).swap(bnb.address, btc.address, user2.address))
      .to.be.revertedWith("Vault: _tokenOut not whitelisted")

    await expect(vault.connect(user1).swap(bnb.address, bnb.address, user2.address))
      .to.be.revertedWith("Vault: invalid tokens")

    await pyth.updatePrice(priceFeedIds.btc, toChainlinkPrice(60000))

    await vault.setTokenConfig(...getBtcConfig(btc, btcPriceFeed))

    await bnb.mint(user0.address, expandDecimals(200, 18))
    await btc.mint(user0.address, expandDecimals(1, 8))

    expect(await zlpManager.getAumInUsdg(false)).eq(0)

    await bnb.connect(user0).transfer(vault.address, expandDecimals(200, 18))
    await vault.connect(user0).buyUSDG(bnb.address, user0.address)

    expect(await zlpManager.getAumInUsdg(false)).eq(expandDecimals(59820, 18)) // 60,000 * 99.7%

    await btc.connect(user0).transfer(vault.address, expandDecimals(1, 8))
    await vault.connect(user0).buyUSDG(btc.address, user0.address)

    expect(await zlpManager.getAumInUsdg(false)).eq(expandDecimals(119640, 18)) // 59,820 + (60,000 * 99.7%)

    expect(await usdg.balanceOf(user0.address)).eq(expandDecimals(120000, 18).sub(expandDecimals(360, 18))) // 120,000 * 0.3% => 360

    expect(await vault.feeReserves(bnb.address)).eq("600000000000000000") // 200 * 0.3% => 0.6
    expect(await vault.usdgAmounts(bnb.address)).eq(expandDecimals(200 * 300, 18).sub(expandDecimals(180, 18))) // 60,000 * 0.3% => 180
    expect(await vault.poolAmounts(bnb.address)).eq(expandDecimals(200, 18).sub("600000000000000000"))

    expect(await vault.feeReserves(btc.address)).eq("300000") // 1 * 0.3% => 0.003
    expect(await vault.usdgAmounts(btc.address)).eq(expandDecimals(200 * 300, 18).sub(expandDecimals(180, 18)))
    expect(await vault.poolAmounts(btc.address)).eq(expandDecimals(1, 8).sub("300000"))

    await pyth.updatePrice(priceFeedIds.bnb, toChainlinkPrice(400))
    await pyth.updatePrice(priceFeedIds.bnb, toChainlinkPrice(600))
    await pyth.updatePrice(priceFeedIds.bnb, toChainlinkPrice(500))

    expect(await zlpManager.getAumInUsdg(false)).eq("159520000000000000000000") // 59,820 / 300 * 400 + 59820

    await pyth.updatePrice(priceFeedIds.btc, toChainlinkPrice(90000))
    await pyth.updatePrice(priceFeedIds.btc, toChainlinkPrice(100000))
    await pyth.updatePrice(priceFeedIds.btc, toChainlinkPrice(80000))

    expect(await zlpManager.getAumInUsdg(false)).eq("179460000000000000000000") // 59,820 / 300 * 400 + 59820 / 60000 * 80000

    await bnb.mint(user1.address, expandDecimals(100, 18))
    await bnb.connect(user1).transfer(vault.address, expandDecimals(100, 18))

    expect(await btc.balanceOf(user1.address)).eq(0)
    expect(await btc.balanceOf(user2.address)).eq(0)

    const tx = await vault.connect(user1).swap(bnb.address, btc.address, user2.address)

    await reportGasUsed(provider, tx, "swap gas used")

    expect(await zlpManager.getAumInUsdg(false)).eq("179460000000000000000000") // 159520 + (100 * 400) - 32000

    expect(await btc.balanceOf(user1.address)).eq(0)
    expect(await btc.balanceOf(user2.address)).eq("62312500")

    expect(await vault.feeReserves(bnb.address)).eq("600000000000000000") // 200 * 0.3% => 0.6
    expect(await vault.usdgAmounts(bnb.address)).eq("109820000000000000000000")
    expect(await vault.poolAmounts(bnb.address)).eq(expandDecimals(100, 18).add(expandDecimals(200, 18)).sub("600000000000000000"))

    expect(await vault.feeReserves(btc.address)).eq("487500") // 1 * 0.3% => 0.003, 0.4 * 0.3% => 0.0012
    expect(await vault.usdgAmounts(btc.address)).eq("9820000000000000000000")
    expect(await vault.poolAmounts(btc.address)).eq("37200000") // 59700000, 0.597 BTC, 0.597 * 100,000 => 59700

    await pyth.updatePrice(priceFeedIds.bnb, toChainlinkPrice(400))
    await pyth.updatePrice(priceFeedIds.bnb, toChainlinkPrice(500))
    await pyth.updatePrice(priceFeedIds.bnb, toChainlinkPrice(450))

    expect(await bnb.balanceOf(user0.address)).eq(0)
    expect(await bnb.balanceOf(user3.address)).eq(0)
    await usdg.connect(user0).transfer(vault.address, expandDecimals(50000, 18))

    await vault.sellUSDG(bnb.address, user3.address)
    expect(await bnb.balanceOf(user0.address)).eq(0)
    expect(await bnb.balanceOf(user3.address)).eq("110777777777777777777") // 99.7, 50000 / 500 * 99.7%
  })

  it("caps max USDG amount", async () => {
    await pyth.updatePrice(priceFeedIds.bnb, toChainlinkPrice(600))
    await pyth.updatePrice(priceFeedIds.eth, toChainlinkPrice(3000))

    const bnbConfig = getBnbConfig(bnb, bnbPriceFeed)
    const ethConfig = getBnbConfig(eth, ethPriceFeed)

    bnbConfig[4] = expandDecimals(299000, 18)
    await vault.setTokenConfig(...bnbConfig)

    ethConfig[4] = expandDecimals(30000, 18)
    await vault.setTokenConfig(...ethConfig)

    await bnb.mint(user0.address, expandDecimals(499, 18))
    await bnb.connect(user0).transfer(vault.address, expandDecimals(499, 18))
    await vault.connect(user0).buyUSDG(bnb.address, user0.address)

    await eth.mint(user0.address, expandDecimals(10, 18))
    await eth.connect(user0).transfer(vault.address, expandDecimals(10, 18))
    await vault.connect(user0).buyUSDG(eth.address, user1.address)

    await bnb.mint(user0.address, expandDecimals(1, 18))
    await bnb.connect(user0).transfer(vault.address, expandDecimals(1, 18))

    await expect(vault.connect(user0).buyUSDG(bnb.address, user0.address))
      .to.be.revertedWith("Vault: max USDG exceeded")

    bnbConfig[4] = expandDecimals(299100, 18)
    await vault.setTokenConfig(...bnbConfig)

    await vault.connect(user0).buyUSDG(bnb.address, user0.address)

    await bnb.mint(user0.address, expandDecimals(1, 18))
    await bnb.connect(user0).transfer(vault.address, expandDecimals(1, 18))
    await expect(vault.connect(user0).swap(bnb.address, eth.address, user1.address))
      .to.be.revertedWith("Vault: max USDG exceeded")

    bnbConfig[4] = expandDecimals(299700, 18)
    await vault.setTokenConfig(...bnbConfig)
    await vault.connect(user0).swap(bnb.address, eth.address, user1.address)
  })

  it("does not cap max USDG debt", async () => {
    await pyth.updatePrice(priceFeedIds.bnb, toChainlinkPrice(600))
    await vault.setTokenConfig(...getBnbConfig(bnb, bnbPriceFeed))

    await pyth.updatePrice(priceFeedIds.eth, toChainlinkPrice(3000))
    await vault.setTokenConfig(...getEthConfig(eth, ethPriceFeed))

    await bnb.mint(user0.address, expandDecimals(100, 18))
    await bnb.connect(user0).transfer(vault.address, expandDecimals(100, 18))
    await vault.connect(user0).buyUSDG(bnb.address, user0.address)

    await eth.mint(user0.address, expandDecimals(10, 18))

    expect(await eth.balanceOf(user0.address)).eq(expandDecimals(10, 18))
    expect(await bnb.balanceOf(user1.address)).eq(0)

    await eth.connect(user0).transfer(vault.address, expandDecimals(10, 18))
    await vault.connect(user0).swap(eth.address, bnb.address, user1.address)

    expect(await eth.balanceOf(user0.address)).eq(0)
    expect(await bnb.balanceOf(user1.address)).eq("49850000000000000000")

    await pyth.updatePrice(priceFeedIds.bnb, toChainlinkPrice(300))
    await pyth.updatePrice(priceFeedIds.bnb, toChainlinkPrice(300))
    await pyth.updatePrice(priceFeedIds.bnb, toChainlinkPrice(300))

    await eth.mint(user0.address, expandDecimals(1, 18))
    await eth.connect(user0).transfer(vault.address, expandDecimals(1, 18))
    await vault.connect(user0).swap(eth.address, bnb.address, user1.address)
  })

  it("ensures poolAmount >= buffer", async () => {
    await pyth.updatePrice(priceFeedIds.bnb, toChainlinkPrice(600))
    await vault.setTokenConfig(...getBnbConfig(bnb, bnbPriceFeed))

    await pyth.updatePrice(priceFeedIds.eth, toChainlinkPrice(3000))
    await vault.setTokenConfig(...getEthConfig(eth, ethPriceFeed))

    await bnb.mint(user0.address, expandDecimals(100, 18))
    await bnb.connect(user0).transfer(vault.address, expandDecimals(100, 18))
    await vault.connect(user0).buyUSDG(bnb.address, user0.address)

    await vault.setBufferAmount(bnb.address, "94700000000000000000") // 94.7

    expect(await vault.poolAmounts(bnb.address)).eq("99700000000000000000") // 99.7
    expect(await vault.poolAmounts(eth.address)).eq(0)
    expect(await bnb.balanceOf(user1.address)).eq(0)
    expect(await eth.balanceOf(user1.address)).eq(0)

    await eth.mint(user0.address, expandDecimals(1, 18))
    await eth.connect(user0).transfer(vault.address, expandDecimals(1, 18))
    await vault.connect(user0).swap(eth.address, bnb.address, user1.address)

    expect(await vault.poolAmounts(bnb.address)).eq("94700000000000000000") // 94.7
    expect(await vault.poolAmounts(eth.address)).eq(expandDecimals(1, 18))
    expect(await bnb.balanceOf(user1.address)).eq("4985000000000000000") // 4.985
    expect(await eth.balanceOf(user1.address)).eq(0)

    await eth.mint(user0.address, expandDecimals(1, 18))
    await eth.connect(user0).transfer(vault.address, expandDecimals(1, 18))
    await expect(vault.connect(user0).swap(eth.address, bnb.address, user1.address))
      .to.be.reverted //Vault: poolAmount < buffer
  })
})
