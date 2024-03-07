const { expect, use } = require("chai")
const { solidity } = require("ethereum-waffle")
const { deployContract, deployVault, deployTimeDistributor, deployVaultPriceFeed, deployZlpManager } = require("../../shared/fixtures")
const { expandDecimals, getBlockTime, increaseTime, mineBlock, reportGasUsed } = require("../../shared/utilities")
const { toChainlinkPrice } = require("../../shared/chainlink")
const { toUsd, toNormalizedPrice } = require("../../shared/units")
const { initVault, getBnbConfig, getBtcConfig, getDaiConfig, validateVaultBalance } = require("./helpers")
const { priceFeedIds } = require("../../shared/pyth")

use(solidity)

describe("Vault.decreaseLongPosition", function () {
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
  let vaultUtils

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

    const { vaultUtils: _vaultUtils } = await initVault(vault, router, usdg, vaultPriceFeed)
    vaultUtils = _vaultUtils

    distributor0 = await deployTimeDistributor([])
    yieldTracker0 = await deployContract("YieldTracker", [usdg.address])

    await yieldTracker0.setDistributor(distributor0.address)
    await distributor0.setDistribution([yieldTracker0.address], [1000], [eth.address])

    await eth.mint(distributor0.address, 5000)
    await usdg.setYieldTrackers([yieldTracker0.address])

    await vaultPriceFeed.setTokenConfig(eth.address, ethPriceFeed.address, 8, false)
    await vaultPriceFeed.setTokenConfig(btc.address, btcPriceFeed.address, 8, false)
    await vaultPriceFeed.setTokenConfig(dai.address, daiPriceFeed.address, 8, false)

    await vault.setFees(
      50, // _taxBasisPoints
      20, // _stableTaxBasisPoints
      30, // _mintBurnFeeBasisPoints
      30, // _swapFeeBasisPoints
      4, // _stableSwapFeeBasisPoints
      10, // _marginFeeBasisPoints
      toUsd(5), // _liquidationFeeUsd
      60 * 60, // _minProfitTime
      false // _hasDynamicFees
    )

    zlp = await deployContract("ZLP", [])
    zlpManager = await deployZlpManager([vault.address, usdg.address, zlp.address, ethers.constants.AddressZero, 24 * 60 * 60])
  })

  it("decreasePosition long", async () => {
    await pyth.updatePrice(priceFeedIds.dai, toChainlinkPrice(1))
    await vault.setTokenConfig(...getDaiConfig(dai, daiPriceFeed))

    await expect(vault.connect(user1).decreasePosition(user0.address, btc.address, btc.address, 0, 0, true, user2.address))
      .to.be.revertedWith("Vault: invalid msg.sender")

    await pyth.updatePrice(priceFeedIds.btc, toChainlinkPrice(40000))
    await vault.setTokenConfig(...getBtcConfig(btc, btcPriceFeed))

    await pyth.updatePrice(priceFeedIds.btc, toChainlinkPrice(41000))
    await pyth.updatePrice(priceFeedIds.btc, toChainlinkPrice(40000))

    await expect(vault.connect(user0).decreasePosition(user0.address, btc.address, btc.address, 0, toUsd(1000), true, user2.address))
      .to.be.reverted //Vault: empty position

    await btc.mint(user1.address, expandDecimals(1, 8))
    await btc.connect(user1).transfer(vault.address, 250000) // 0.0025 BTC => 100 USD
    await vault.buyUSDG(btc.address, user1.address)

    await btc.mint(user0.address, expandDecimals(1, 8))
    await btc.connect(user1).transfer(vault.address, 25000) // 0.00025 BTC => 10 USD
    await expect(vault.connect(user0).increasePosition(user0.address, btc.address, btc.address, toUsd(110), true))
      .to.be.revertedWith("Vault: reserve exceeds pool")

    expect(await zlpManager.getAumInUsdg(false)).eq("99700000000000000000") // 99.7
    expect(await zlpManager.getAumInUsdg(true)).eq("99700000000000000000") // 102.1925

    await vault.connect(user0).increasePosition(user0.address, btc.address, btc.address, toUsd(90), true)

    expect(await zlpManager.getAumInUsdg(false)).eq("99700000000000000000") // 99.7024
    expect(await zlpManager.getAumInUsdg(true)).eq("99700000000000000000") // 100.19271

    let position = await vault.getPosition(user0.address, btc.address, btc.address, true)
    expect(position[0]).eq(toUsd(90)) // size
    expect(position[1]).eq(toUsd(9.91)) // collateral, 10 - 90 * 0.1%
    expect(position[2]).eq(toNormalizedPrice(40000)) // averagePrice //qweqwe
    expect(position[3]).eq(0) // entryFundingRate
    expect(position[4]).eq(225000) // reserveAmount, 0.00225 * 40,000 => 90

    // test that minProfitBasisPoints works as expected
    await pyth.updatePrice(priceFeedIds.btc, toChainlinkPrice(41000 - 1))
    await pyth.updatePrice(priceFeedIds.btc, toChainlinkPrice(41000 - 1))
    await pyth.updatePrice(priceFeedIds.btc, toChainlinkPrice(41000 - 1))
    let delta = await vault.getPositionDelta(user0.address, btc.address, btc.address, true)
    expect(delta[0]).eq(true)
    expect(delta[1]).eq("2247750000000000000000000000000") // ~0.00219512195 USD

    await pyth.updatePrice(priceFeedIds.btc, toChainlinkPrice(41000 + 307)) // 41000 * 0.75% => 307.5
    await pyth.updatePrice(priceFeedIds.btc, toChainlinkPrice(41000 + 307))
    await pyth.updatePrice(priceFeedIds.btc, toChainlinkPrice(41000 + 307))
    delta = await vault.getPositionDelta(user0.address, btc.address, btc.address, true)
    expect(delta[0]).eq(true)
    expect(delta[1]).eq("2940750000000000000000000000000")

    await pyth.updatePrice(priceFeedIds.btc, toChainlinkPrice(41000 + 308))
    await pyth.updatePrice(priceFeedIds.btc, toChainlinkPrice(41000 + 308))
    await pyth.updatePrice(priceFeedIds.btc, toChainlinkPrice(41000 + 308))
    delta = await vault.getPositionDelta(user0.address, btc.address, btc.address, true)
    expect(delta[0]).eq(true)
    expect(delta[1]).eq("2943000000000000000000000000000") // ~0.676 USD

    await pyth.updatePrice(priceFeedIds.btc, toChainlinkPrice(41000))
    await pyth.updatePrice(priceFeedIds.btc, toChainlinkPrice(40000))
    await pyth.updatePrice(priceFeedIds.btc, toChainlinkPrice(45100))

    delta = await vault.getPositionDelta(user0.address, btc.address, btc.address, true)
    expect(delta[0]).eq(true)
    expect(delta[1]).eq("11475000000000000000000000000000") // ~2.1951

    await pyth.updatePrice(priceFeedIds.btc, toChainlinkPrice(46100))
    delta = await vault.getPositionDelta(user0.address, btc.address, btc.address, true)
    expect(delta[0]).eq(true)
    expect(delta[1]).eq("13725000000000000000000000000000") // ~2.1951

    await pyth.updatePrice(priceFeedIds.btc, toChainlinkPrice(47100))
    delta = await vault.getPositionDelta(user0.address, btc.address, btc.address, true)
    expect(delta[0]).eq(true)
    expect(delta[1]).eq("15975000000000000000000000000000")

    let leverage = await vault.getPositionLeverage(user0.address, btc.address, btc.address, true)
    expect(leverage).eq(90817) // ~9X leverage

    await expect(vault.connect(user0).decreasePosition(user0.address, btc.address, btc.address, 0, toUsd(100), true, user2.address))
      .to.be.reverted //Vault: position size exceeded

    await expect(vault.connect(user0).decreasePosition(user0.address, btc.address, btc.address, toUsd(8.91), toUsd(50), true, user2.address))
      .to.be.reverted //Vault: liquidation fees exceed collateral

    expect(await vault.feeReserves(btc.address)).eq(975)
    expect(await vault.reservedAmounts(btc.address)).eq(225000)
    expect(await vault.guaranteedUsd(btc.address)).eq(toUsd(80.09))
    expect(await vault.poolAmounts(btc.address)).eq(274025)
    expect(await btc.balanceOf(user2.address)).eq(0)

    expect(await zlpManager.getAumInUsdg(false)).eq("103180775000000000000") // 102.202981
    expect(await zlpManager.getAumInUsdg(true)).eq("103180775000000000000") // 103.183601

    const tx = await vault.connect(user0).decreasePosition(user0.address, btc.address, btc.address, toUsd(3), toUsd(50), true, user2.address)
    await reportGasUsed(provider, tx, "decreasePosition gas used")

    expect(await zlpManager.getAumInUsdg(false)).eq("103180923000000000000") // 103.917746
    expect(await zlpManager.getAumInUsdg(true)).eq("103180923000000000000") // 107.058666

    leverage = await vault.getPositionLeverage(user0.address, btc.address, btc.address, true)
    expect(leverage).eq(57887) // ~5.8X leverage

    position = await vault.getPosition(user0.address, btc.address, btc.address, true)
    expect(position[0]).eq(toUsd(40)) // size
    expect(position[1]).eq(toUsd(9.91 - 3)) // collateral
    expect(position[2]).eq(toNormalizedPrice(40000))
    expect(position[3]).eq(0) // entryFundingRate
    expect(position[4]).eq(225000 / 90 * 40) // reserveAmount, 0.00225 * 40,000 => 90
    expect(position[5]).eq("8875000000000000000000000000000") // pnl
    expect(position[6]).eq(true)

    expect(await vault.feeReserves(btc.address)).eq(1081) // 0.00000106 * 45100 => ~0.05 USD
    expect(await vault.reservedAmounts(btc.address)).eq(225000 / 90 * 40)
    expect(await vault.guaranteedUsd(btc.address)).eq(toUsd(33.09))
    expect(await vault.poolAmounts(btc.address)).eq(248813)
    expect(await btc.balanceOf(user2.address)).eq(25106) // 0.00016878 * 47100 => 7.949538 USD

    await validateVaultBalance(expect, vault, btc, 1)
  })

  it("decreasePosition long aum", async () => {
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
    await vault.connect(user0).increasePosition(user0.address, eth.address, eth.address, toUsd(1000), true)

    expect(await zlpManager.getAumInUsdg(false)).eq("4985000000000000000000") // 4985
    expect(await zlpManager.getAumInUsdg(true)).eq("4985000000000000000000") // 4985

    await pyth.updatePrice(priceFeedIds.eth, toChainlinkPrice(750))
    await pyth.updatePrice(priceFeedIds.eth, toChainlinkPrice(750))
    await pyth.updatePrice(priceFeedIds.eth, toChainlinkPrice(750))

    expect(await zlpManager.getAumInUsdg(false)).eq("7227000000000000000000") // 7227
    expect(await zlpManager.getAumInUsdg(true)).eq("7227000000000000000000") // 7227

    await vault.connect(user0).decreasePosition(user0.address, eth.address, eth.address, toUsd(0), toUsd(500), true, user2.address)

    expect(await zlpManager.getAumInUsdg(false)).eq("7227000000000000000250") // 7227.00000000000000025
    expect(await zlpManager.getAumInUsdg(true)).eq("7227000000000000000250") // 7227.00000000000000025

    await vault.connect(user0).decreasePosition(user0.address, eth.address, eth.address, toUsd(250), toUsd(100), true, user2.address)

    expect(await zlpManager.getAumInUsdg(false)).eq("7227000000000000000250") // 7227.00000000000000025
    expect(await zlpManager.getAumInUsdg(true)).eq("7227000000000000000250") // 7227.00000000000000025
  })

  it("decreasePosition long minProfitBasisPoints", async () => {
    await pyth.updatePrice(priceFeedIds.dai, toChainlinkPrice(1))
    await vault.setTokenConfig(...getDaiConfig(dai, daiPriceFeed))

    await expect(vault.connect(user1).decreasePosition(user0.address, btc.address, btc.address, 0, 0, true, user2.address))
      .to.be.revertedWith("Vault: invalid msg.sender")

    await pyth.updatePrice(priceFeedIds.btc, toChainlinkPrice(40000))
    await vault.setTokenConfig(...getBtcConfig(btc, btcPriceFeed))

    await pyth.updatePrice(priceFeedIds.btc, toChainlinkPrice(41000))
    await pyth.updatePrice(priceFeedIds.btc, toChainlinkPrice(40000))

    await expect(vault.connect(user0).decreasePosition(user0.address, btc.address, btc.address, 0, toUsd(1000), true, user2.address))
      .to.be.reverted //Vault: empty position

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

    // test that minProfitBasisPoints works as expected
    await pyth.updatePrice(priceFeedIds.btc, toChainlinkPrice(41000 - 1))
    await pyth.updatePrice(priceFeedIds.btc, toChainlinkPrice(41000 - 1))
    await pyth.updatePrice(priceFeedIds.btc, toChainlinkPrice(41000 - 1))
    let delta = await vault.getPositionDelta(user0.address, btc.address, btc.address, true)
    expect(delta[0]).eq(true)
    expect(delta[1]).eq("2247750000000000000000000000000") // ~0.00219512195 USD

    await pyth.updatePrice(priceFeedIds.btc, toChainlinkPrice(41000 + 307)) // 41000 * 0.75% => 307.5
    await pyth.updatePrice(priceFeedIds.btc, toChainlinkPrice(41000 + 307))
    await pyth.updatePrice(priceFeedIds.btc, toChainlinkPrice(41000 + 307))
    delta = await vault.getPositionDelta(user0.address, btc.address, btc.address, true)
    expect(delta[0]).eq(true)
    expect(delta[1]).eq("2940750000000000000000000000000")

    await increaseTime(provider, 50 * 60)
    await mineBlock(provider)

    delta = await vault.getPositionDelta(user0.address, btc.address, btc.address, true)
    expect(delta[0]).eq(true)
    expect(delta[1]).eq("2940750000000000000000000000000")

    await increaseTime(provider, 10 * 60 + 10)
    await mineBlock(provider)

    delta = await vault.getPositionDelta(user0.address, btc.address, btc.address, true)
    expect(delta[0]).eq(true)
    expect(delta[1]).eq("2940750000000000000000000000000") // 0.67390243902
  })

  it("decreasePosition long with loss", async () => {
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

    await pyth.updatePrice(priceFeedIds.btc, toChainlinkPrice(40790))
    await pyth.updatePrice(priceFeedIds.btc, toChainlinkPrice(40690))
    await pyth.updatePrice(priceFeedIds.btc, toChainlinkPrice(40590))

    expect(await vault.feeReserves(btc.address)).eq(975)
    expect(await vault.reservedAmounts(btc.address)).eq(225000)
    expect(await vault.guaranteedUsd(btc.address)).eq(toUsd(80.09))
    expect(await vault.poolAmounts(btc.address)).eq(274025)
    expect(await btc.balanceOf(user2.address)).eq(0)

    let delta = await vault.getPositionDelta(user0.address, btc.address, btc.address, true)
    expect(delta[0]).eq(true)
    expect(delta[1]).eq("1327500000000000000000000000000")

    const tx = await vault.connect(user0).decreasePosition(user0.address, btc.address, btc.address, toUsd(0), toUsd(50), true, user2.address)
    await reportGasUsed(provider, tx, "decreasePosition gas used")

    position = await vault.getPosition(user0.address, btc.address, btc.address, true)
    expect(position[0]).eq(toUsd(40)) // size
    expect(position[1]).eq("9910000000000000000000000000000") // collateral
    expect(position[2]).eq(toNormalizedPrice(40000))
    expect(position[3]).eq(0) // entryFundingRate
    expect(position[4]).eq(100000) // reserveAmount, 0.00100 * 40,000 => 40
    expect(position[5]).eq("737500000000000000000000000000") // pnl
    expect(position[6]).eq(true)

    expect(await vault.feeReserves(btc.address)).eq(1098) // 0.00000122 * 40790 => ~0.05 USD
    expect(await vault.reservedAmounts(btc.address)).eq(100000)
    expect(await vault.guaranteedUsd(btc.address)).eq("30090000000000000000000000000000")
    expect(await vault.poolAmounts(btc.address)).eq(272209)
    expect(await btc.balanceOf(user2.address)).eq(1693)

    await vault.connect(user0).decreasePosition(user0.address, btc.address, btc.address, toUsd(0), toUsd(40), true, user2.address)

    position = await vault.getPosition(user0.address, btc.address, btc.address, true)
    expect(position[0]).eq(0) // size
    expect(position[1]).eq(0) // collateral
    expect(position[2]).eq(0) // averagePrice
    expect(position[3]).eq(0) // entryFundingRate
    expect(position[4]).eq(0) // reserveAmount
    expect(position[5]).eq(0) // pnl
    expect(position[6]).eq(true)

    expect(await vault.feeReserves(btc.address)).eq(1196) // 0.00000098 * 40790 => ~0.04 USD
    expect(await vault.reservedAmounts(btc.address)).eq(0)
    expect(await vault.guaranteedUsd(btc.address)).eq(0)
    expect(await vault.poolAmounts(btc.address)).eq(246341)
    expect(await btc.balanceOf(user2.address)).eq(27462) // 0.00021868 * 40790 => ~8.92 USD

    await validateVaultBalance(expect, vault, btc)
  })

  it("decreasePosition negative collateral", async () => {
    await pyth.updatePrice(priceFeedIds.dai, toChainlinkPrice(1))
    await vault.setTokenConfig(...getDaiConfig(dai, daiPriceFeed))

    await pyth.updatePrice(priceFeedIds.btc, toChainlinkPrice(40000))
    await vault.setTokenConfig(...getBtcConfig(btc, btcPriceFeed))

    await pyth.updatePrice(priceFeedIds.btc, toChainlinkPrice(40000))
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

    await pyth.updatePrice(priceFeedIds.btc, toChainlinkPrice(80000))
    await pyth.updatePrice(priceFeedIds.btc, toChainlinkPrice(80000))
    await pyth.updatePrice(priceFeedIds.btc, toChainlinkPrice(80000))

    expect(await vault.feeReserves(btc.address)).eq(975)
    expect(await vault.reservedAmounts(btc.address)).eq(225000)
    expect(await vault.guaranteedUsd(btc.address)).eq(toUsd(80.09))
    expect(await vault.poolAmounts(btc.address)).eq(274025)
    expect(await btc.balanceOf(user2.address)).eq(0)

    let delta = await vault.getPositionDelta(user0.address, btc.address, btc.address, true)
    expect(delta[0]).eq(true)
    expect(delta[1]).eq(toUsd(90))

    expect(await vault.cumulativeFundingRates(btc.address)).eq(0)

    await increaseTime(provider, 100 * 24 * 60 * 60)

    await vault.updateCumulativeFundingRate(btc.address, btc.address)
    expect(await vault.cumulativeFundingRates(btc.address)).eq(147796)

    await expect(vault.connect(user0).decreasePosition(user0.address, btc.address, btc.address, 0, toUsd(10), true, user2.address))
      .to.be.reverted //SafeMath: subtraction overflow

    await vault.connect(user0).decreasePosition(user0.address, btc.address, btc.address, 0, toUsd(50), true, user2.address)

    position = await vault.getPosition(user0.address, btc.address, btc.address, true)
    expect(position[0]).eq(toUsd(40)) // size
    expect(position[1]).eq(toUsd(9.91)) // collateral
    expect(position[2]).eq(toNormalizedPrice(40000)) // averagePrice
    expect(position[3]).eq(147796) // entryFundingRate
    expect(position[4]).eq(100000) // reserveAmount, 0.00100 * 40,000 => 40
    expect(position[5]).eq(toUsd(50)) // pnl
    expect(position[6]).eq(true)

    await validateVaultBalance(expect, vault, btc, 1)
  })
})
