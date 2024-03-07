const { expect, use } = require("chai")
const { solidity } = require("ethereum-waffle")
const { deployContract, deployVault, deployTimeDistributor, deployVaultPriceFeed, deployZlpManager } = require("../../shared/fixtures")
const { expandDecimals, getBlockTime, increaseTime, mineBlock, reportGasUsed } = require("../../shared/utilities")
const { toChainlinkPrice } = require("../../shared/chainlink")
const { toUsd, toNormalizedPrice } = require("../../shared/units")
const { initVault, getBnbConfig, getBtcConfig, getDaiConfig } = require("./helpers")
const { priceFeedIds } = require("../../shared/pyth")

use(solidity)

describe("Vault.withdrawCollateral", function () {
  const provider = waffle.provider
  const [wallet, user0, user1, user2, user3] = provider.getWallets()
  let vault
  let vaultPriceFeed
  let usdg
  let router
  let eth
  let ethPriceFeed
  let btc
  let btcPriceFeed
  let dai
  let daiPriceFeed
  let distributor0
  let yieldTracker0

  let zlpManager
  let zlp

  let pyth

  beforeEach(async () => {
    pyth = await deployContract("Pyth", [])
    eth = await deployContract("Token", [])
    ethPriceFeed = await deployContract("PythPriceFeedV2", [pyth.address,priceFeedIds.eth,10000])

    btc = await deployContract("Token", [])
    btcPriceFeed = await deployContract("PythPriceFeedV2", [pyth.address,priceFeedIds.btc,10000])

    dai = await deployContract("Token", [])
    daiPriceFeed = await deployContract("PythPriceFeedV2", [pyth.address,priceFeedIds.dai,10000])

    vault = await deployVault()
    usdg = await deployContract("USDG", [vault.address])
    router = await deployContract("Router", [vault.address, usdg.address, eth.address,pyth.address])
    vaultPriceFeed = await deployVaultPriceFeed()

    const _ = await initVault(vault, router, usdg, vaultPriceFeed)

    distributor0 = await deployTimeDistributor([])
    yieldTracker0 = await deployContract("YieldTracker", [usdg.address])

    await yieldTracker0.setDistributor(distributor0.address)
    await distributor0.setDistribution([yieldTracker0.address], [1000], [eth.address])

    await eth.mint(distributor0.address, 5000)
    await usdg.setYieldTrackers([yieldTracker0.address])

    await vaultPriceFeed.setTokenConfig(eth.address, ethPriceFeed.address, 8, false)
    await vaultPriceFeed.setTokenConfig(btc.address, btcPriceFeed.address, 8, false)
    await vaultPriceFeed.setTokenConfig(dai.address, daiPriceFeed.address, 8, false)

    zlp = await deployContract("ZLP", [])
    zlpManager = await deployZlpManager([vault.address, usdg.address, zlp.address, ethers.constants.AddressZero, 24 * 60 * 60])
  })

  it("withdraw collateral", async () => {
    await pyth.updatePrice(priceFeedIds.dai, toChainlinkPrice(1))
    await vault.setTokenConfig(...getDaiConfig(dai, daiPriceFeed))

    await pyth.updatePrice(priceFeedIds.btc, toChainlinkPrice(40000))
    await vault.setTokenConfig(...getBtcConfig(btc, btcPriceFeed))

    await pyth.updatePrice(priceFeedIds.btc, toChainlinkPrice(41000))
    await pyth.updatePrice(priceFeedIds.btc, toChainlinkPrice(40000))

    await btc.mint(user1.address, expandDecimals(1, 8))
    await btc.connect(user1).transfer(vault.address, 250000) // 0.0025 BTC => 100 USD
    await vault.buyUSDG(btc.address, user1.address)

    await btc.mint(user0.address, expandDecimals(1, 8))
    await btc.connect(user1).transfer(vault.address, 25000) // 0.00025 BTC => 10 USD
    await expect(vault.connect(user0).increasePosition(user0.address, btc.address, btc.address, toUsd(110), true))
      .to.be.revertedWith("Vault: reserve exceeds pool")

    await vault.connect(user0).increasePosition(user0.address, btc.address, btc.address, toUsd(90), true)

    let position = await vault.getPosition(user0.address, btc.address, btc.address, true)
    expect(position[0]).eq(toUsd(90)) // size
    expect(position[1]).eq(toUsd(9.91)) // collateral, 10 - 90 * 0.1%
    expect(position[2]).eq(toNormalizedPrice(40000)) // averagePrice
    expect(position[3]).eq(0) // entryFundingRate
    expect(position[4]).eq(225000) // reserveAmount, 0.00225 * 40,000 => 90

    await pyth.updatePrice(priceFeedIds.btc, toChainlinkPrice(45100))
    await pyth.updatePrice(priceFeedIds.btc, toChainlinkPrice(46100))
    await pyth.updatePrice(priceFeedIds.btc, toChainlinkPrice(47100))

    let leverage = await vault.getPositionLeverage(user0.address, btc.address, btc.address, true)
    expect(leverage).eq(90817) // ~9X leverage

    expect(await vault.feeReserves(btc.address)).eq(975)
    expect(await vault.reservedAmounts(btc.address)).eq(225000)
    expect(await vault.guaranteedUsd(btc.address)).eq(toUsd(80.09))
    expect(await vault.poolAmounts(btc.address)).eq(274025)
    expect(await btc.balanceOf(user2.address)).eq(0)

    const tx0 = await vault.connect(user0).decreasePosition(user0.address, btc.address, btc.address, toUsd(3), toUsd(50), true, user2.address)
    await reportGasUsed(provider, tx0, "decreasePosition gas used")

    leverage = await vault.getPositionLeverage(user0.address, btc.address, btc.address, true)
    expect(leverage).eq(57887) // ~5.8X leverage

    position = await vault.getPosition(user0.address, btc.address, btc.address, true)
    expect(position[0]).eq(toUsd(40)) // size
    expect(position[1]).eq(toUsd(9.91 - 3)) // collateral
    expect(position[2]).eq(toNormalizedPrice(40000)) // averagePrice
    expect(position[3]).eq(0) // entryFundingRate
    expect(position[4]).eq(225000 / 90 * 40) // reserveAmount, 0.00225 * 40,000 => 90
    expect(position[5]).eq("8875000000000000000000000000000") // pnl
    expect(position[6]).eq(true)

    expect(await vault.feeReserves(btc.address)).eq(1081) // 0.00000106 * 45100 => ~0.05 USD
    expect(await vault.reservedAmounts(btc.address)).eq(225000 / 90 * 40)
    expect(await vault.guaranteedUsd(btc.address)).eq(toUsd(33.09))
    expect(await vault.poolAmounts(btc.address)).eq("248813")
    expect(await btc.balanceOf(user2.address)).eq(25106) // 0.00016878 * 47100 => 7.949538 USD

    await expect(vault.connect(user0).decreasePosition(user0.address, btc.address, btc.address, toUsd(3), 0, true, user2.address))
      .to.be.reverted // Vault: liquidation fees exceed collateral

    const tx1 = await vault.connect(user0).decreasePosition(user0.address, btc.address, btc.address, toUsd(1), 0, true, user2.address)
    await reportGasUsed(provider, tx1, "withdraw collateral gas used")

    position = await vault.getPosition(user0.address, btc.address, btc.address, true)
    expect(position[0]).eq(toUsd(40)) // size
    expect(position[1]).eq(toUsd(9.91 - 3 - 1)) // collateral
    expect(position[2]).eq(toNormalizedPrice(40000))
    expect(position[3]).eq(0) // entryFundingRate
    expect(position[4]).eq(225000 / 90 * 40) // reserveAmount, 0.00225 * 40,000 => 90
    expect(position[5]).eq("8875000000000000000000000000000") // pnl
    expect(position[6]).eq(true)

    expect(await vault.feeReserves(btc.address)).eq(1081) // 0.00000106 * 45100 => ~0.05 USD
    expect(await vault.reservedAmounts(btc.address)).eq(225000 / 90 * 40)
    expect(await vault.guaranteedUsd(btc.address)).eq(toUsd(34.09))
    expect(await vault.poolAmounts(btc.address)).eq(246690) // 0.00002123* 47100 => 1 USD
    expect(await btc.balanceOf(user2.address)).eq(27229)
  })

  it("withdraw during cooldown duration", async () => {
    await pyth.updatePrice(priceFeedIds.dai, toChainlinkPrice(1))
    await vault.setTokenConfig(...getDaiConfig(dai, daiPriceFeed))

    await pyth.updatePrice(priceFeedIds.btc, toChainlinkPrice(40000))
    await vault.setTokenConfig(...getBtcConfig(btc, btcPriceFeed))

    await pyth.updatePrice(priceFeedIds.btc, toChainlinkPrice(41000))
    await pyth.updatePrice(priceFeedIds.btc, toChainlinkPrice(40000))

    await btc.mint(user1.address, expandDecimals(1, 8))
    await btc.connect(user1).transfer(vault.address, 250000) // 0.0025 BTC => 100 USD
    await vault.buyUSDG(btc.address, user1.address)

    await btc.mint(user0.address, expandDecimals(1, 8))
    await btc.connect(user1).transfer(vault.address, 25000) // 0.00025 BTC => 10 USD
    await expect(vault.connect(user0).increasePosition(user0.address, btc.address, btc.address, toUsd(110), true))
      .to.be.revertedWith("Vault: reserve exceeds pool")

    await vault.connect(user0).increasePosition(user0.address, btc.address, btc.address, toUsd(90), true)
    await pyth.updatePrice(priceFeedIds.btc, toChainlinkPrice(45100))
    await pyth.updatePrice(priceFeedIds.btc, toChainlinkPrice(46100))
    await pyth.updatePrice(priceFeedIds.btc, toChainlinkPrice(47100))

    // it's okay to withdraw AND decrease size with at least same proportion (e.g. if leverage is decreased or the same)
    await vault.connect(user0).decreasePosition(user0.address, btc.address, btc.address, toUsd(1), toUsd(10), true, user2.address)

    // it's also okay to fully close position
    let position = await vault.getPosition(user0.address, btc.address, btc.address, true)
    await vault.connect(user0).decreasePosition(user0.address, btc.address, btc.address, position[1], position[0], true, user2.address)

    await btc.connect(user1).transfer(vault.address, 25000) // 0.00025 BTC => 10 USD
    await vault.connect(user0).increasePosition(user0.address, btc.address, btc.address, toUsd(30), true)
  })

  it("withdraw collateral long", async () => {
    await pyth.updatePrice(priceFeedIds.dai, toChainlinkPrice(1))
    await vault.setTokenConfig(...getDaiConfig(dai, daiPriceFeed))

    await pyth.updatePrice(priceFeedIds.eth, toChainlinkPrice(500))
    await vault.setTokenConfig(...getBnbConfig(eth, ethPriceFeed))

    await pyth.updatePrice(priceFeedIds.eth, toChainlinkPrice(500))
    await pyth.updatePrice(priceFeedIds.eth, toChainlinkPrice(500))

    await eth.mint(vault.address, expandDecimals(10, 18))
    await vault.buyUSDG(eth.address, user1.address)

    expect(await zlpManager.getAumInUsdg(false)).eq("4985000000000000000000") // 4985
    expect(await zlpManager.getAumInUsdg(true)).eq("4985000000000000000000") // 4985

    await eth.mint(vault.address, expandDecimals(1, 18))
    await vault.connect(user0).increasePosition(user0.address, eth.address, eth.address, toUsd(2000), true)

    expect(await zlpManager.getAumInUsdg(false)).eq("4985000000000000000000") // 4985
    expect(await zlpManager.getAumInUsdg(true)).eq("4985000000000000000000") // 4985

    await pyth.updatePrice(priceFeedIds.eth, toChainlinkPrice(750))
    await pyth.updatePrice(priceFeedIds.eth, toChainlinkPrice(750))
    await pyth.updatePrice(priceFeedIds.eth, toChainlinkPrice(750))

    expect(await zlpManager.getAumInUsdg(false)).eq("6726500000000000000000") // 6726.5
    expect(await zlpManager.getAumInUsdg(true)).eq("6726500000000000000000") // 6726.5

    await eth.mint(vault.address, expandDecimals(1, 18))
    await vault.connect(user0).increasePosition(user0.address, eth.address, eth.address, toUsd(0), true)

    expect(await zlpManager.getAumInUsdg(false)).eq("6726500000000000000000") // 6726.5
    expect(await zlpManager.getAumInUsdg(true)).eq("6726500000000000000000") // 6726.5

    await vault.connect(user0).decreasePosition(user0.address, eth.address, eth.address, toUsd(500), toUsd(0), true, user2.address)

    expect(await zlpManager.getAumInUsdg(false)).eq("6726500000000000000500") // 6726.5000000000000005
    expect(await zlpManager.getAumInUsdg(true)).eq("6726500000000000000500") // 6726.5000000000000005

    await pyth.updatePrice(priceFeedIds.eth, toChainlinkPrice(400))
    await pyth.updatePrice(priceFeedIds.eth, toChainlinkPrice(400))
    await pyth.updatePrice(priceFeedIds.eth, toChainlinkPrice(400))

    expect(await zlpManager.getAumInUsdg(false)).eq("4171733333333333333600") // 4171.7333333333333336
    expect(await zlpManager.getAumInUsdg(true)).eq("4171733333333333333600") // 4171.7333333333333336

    await vault.connect(user0).decreasePosition(user0.address, eth.address, eth.address, toUsd(250), toUsd(0), true, user2.address)

    expect(await zlpManager.getAumInUsdg(false)).eq("4171733333333333333600") // 4171.7333333333333336
    expect(await zlpManager.getAumInUsdg(true)).eq("4171733333333333333600") // 4171.7333333333333336

    await vault.connect(user0).decreasePosition(user0.address, eth.address, eth.address, toUsd(0), toUsd(250), true, user2.address)

    expect(await zlpManager.getAumInUsdg(false)).eq("4171733333333333333600") // 4171.7333333333333336
    expect(await zlpManager.getAumInUsdg(true)).eq("4171733333333333333600") // 4171.7333333333333336
  })

  it("withdraw collateral short", async () => {
    await pyth.updatePrice(priceFeedIds.dai, toChainlinkPrice(1))
    await vault.setTokenConfig(...getDaiConfig(dai, daiPriceFeed))

    await pyth.updatePrice(priceFeedIds.eth, toChainlinkPrice(500))
    await vault.setTokenConfig(...getBnbConfig(eth, ethPriceFeed))

    await pyth.updatePrice(priceFeedIds.eth, toChainlinkPrice(500))
    await pyth.updatePrice(priceFeedIds.eth, toChainlinkPrice(500))

    await dai.mint(vault.address, expandDecimals(8000, 18))
    await vault.buyUSDG(dai.address, user1.address)

    expect(await zlpManager.getAumInUsdg(false)).eq("7976000000000000000000") // 7976
    expect(await zlpManager.getAumInUsdg(true)).eq("7976000000000000000000") // 7976

    await dai.mint(vault.address, expandDecimals(500, 18))
    await vault.connect(user0).increasePosition(user0.address, dai.address, eth.address, toUsd(2000), false)

    expect(await zlpManager.getAumInUsdg(false)).eq("7976000000000000000000") // 7976
    expect(await zlpManager.getAumInUsdg(true)).eq("7976000000000000000000") // 7976

    await pyth.updatePrice(priceFeedIds.eth, toChainlinkPrice(525))
    await pyth.updatePrice(priceFeedIds.eth, toChainlinkPrice(525))
    await pyth.updatePrice(priceFeedIds.eth, toChainlinkPrice(525))

    expect(await zlpManager.getAumInUsdg(false)).eq("8076000000000000000000") // 8076
    expect(await zlpManager.getAumInUsdg(true)).eq("8076000000000000000000") // 8076

    await dai.mint(vault.address, expandDecimals(500, 18))
    await vault.connect(user0).increasePosition(user0.address, dai.address, eth.address, toUsd(0), false)

    expect(await zlpManager.getAumInUsdg(false)).eq("8076000000000000000000") // 8076
    expect(await zlpManager.getAumInUsdg(true)).eq("8076000000000000000000") // 8076

    await vault.connect(user0).decreasePosition(user0.address, dai.address, eth.address, toUsd(500), toUsd(0), false, user2.address)

    expect(await zlpManager.getAumInUsdg(false)).eq("8076000000000000000000") // 8076
    expect(await zlpManager.getAumInUsdg(true)).eq("8076000000000000000000") // 8076

    await pyth.updatePrice(priceFeedIds.eth, toChainlinkPrice(475))
    await pyth.updatePrice(priceFeedIds.eth, toChainlinkPrice(475))
    await pyth.updatePrice(priceFeedIds.eth, toChainlinkPrice(475))

    expect(await zlpManager.getAumInUsdg(false)).eq("7876000000000000000000") // 7876
    expect(await zlpManager.getAumInUsdg(true)).eq("7876000000000000000000") // 7876

    await vault.connect(user0).decreasePosition(user0.address, dai.address, eth.address, toUsd(0), toUsd(500), false, user2.address)

    expect(await zlpManager.getAumInUsdg(false)).eq("7876000000000000000000") // 7876
    expect(await zlpManager.getAumInUsdg(true)).eq("7876000000000000000000") // 7876
  })
})
