const { expect, use } = require("chai")
const { solidity } = require("ethereum-waffle")
const { deployContract, deployVault, deployTimeDistributor, deployVaultPriceFeed, deployZlpManager } = require("../../shared/fixtures")
const { expandDecimals, getBlockTime, increaseTime, mineBlock, reportGasUsed } = require("../../shared/utilities")
const { toChainlinkPrice } = require("../../shared/chainlink")
const { toUsd, toNormalizedPrice } = require("../../shared/units")
const { initVault, getBnbConfig, getBtcConfig, getDaiConfig } = require("./helpers")
const { priceFeedIds } = require("../../shared/pyth")

use(solidity)

describe("Vault.increaseShortPosition", function () {
  const provider = waffle.provider
  const [wallet, user0, user1, user2, user3] = provider.getWallets()
  let vault
  let zlpManager
  let vaultPriceFeed
  let zlp
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
    zlp = await deployContract("ZLP", [])
    usdg = await deployContract("USDG", [vault.address])
    router = await deployContract("Router", [vault.address, usdg.address, eth.address,pyth.address])
    vaultPriceFeed = await deployVaultPriceFeed()

    const initVaultResult = await initVault(vault, router, usdg, vaultPriceFeed)
    zlpManager = await deployZlpManager([vault.address, usdg.address, zlp.address, ethers.constants.AddressZero, 24 * 60 * 60])

    distributor0 = await deployTimeDistributor([])
    yieldTracker0 = await deployContract("YieldTracker", [usdg.address])

    await yieldTracker0.setDistributor(distributor0.address)
    await distributor0.setDistribution([yieldTracker0.address], [1000], [eth.address])

    await eth.mint(distributor0.address, 5000)
    await usdg.setYieldTrackers([yieldTracker0.address])

    await vaultPriceFeed.setTokenConfig(eth.address, ethPriceFeed.address, 8, false)
    await vaultPriceFeed.setTokenConfig(btc.address, btcPriceFeed.address, 8, false)
    await vaultPriceFeed.setTokenConfig(dai.address, daiPriceFeed.address, 8, false)
  })

  it("increasePosition short validations", async () => {
    await pyth.updatePrice(priceFeedIds.eth, toChainlinkPrice(300))
    await vault.setTokenConfig(...getBnbConfig(eth, ethPriceFeed))
    await expect(vault.connect(user1).increasePosition(user0.address, dai.address, btc.address, 0, false))
      .to.be.revertedWith("Vault: invalid msg.sender")
    await expect(vault.connect(user0).increasePosition(user0.address, dai.address, btc.address, toUsd(1000), false))
      .to.be.revertedWith("Vault: _collateralToken not whitelisted")
    await expect(vault.connect(user0).increasePosition(user0.address, eth.address, eth.address, toUsd(1000), false))
      .to.be.revertedWith("Vault: _collateralToken must be a stableToken")
    await pyth.updatePrice(priceFeedIds.dai, toChainlinkPrice(1))
    await vault.setTokenConfig(...getDaiConfig(dai, daiPriceFeed))

    await expect(vault.connect(user0).increasePosition(user0.address, dai.address, dai.address, toUsd(1000), false))
      .to.be.revertedWith("Vault: _indexToken must not be a stableToken")

    await expect(vault.connect(user0).increasePosition(user0.address, dai.address, btc.address, toUsd(1000), false))
      .to.be.revertedWith("Vault: _indexToken not shortable")

    await pyth.updatePrice(priceFeedIds.btc, toChainlinkPrice(60000))
    await vault.setTokenConfig(
      btc.address, // _token
      8, // _tokenDecimals
      10000, // _tokenWeight
      75, // _minProfitBps
      0, // _maxUsdgAmount
      false, // _isStable
      false // _isShortable
    )

    await expect(vault.connect(user0).increasePosition(user0.address, dai.address, btc.address, toUsd(1000), false))
      .to.be.revertedWith("Vault: _indexToken not shortable")

    await vault.setTokenConfig(...getBtcConfig(btc, btcPriceFeed))

    await pyth.updatePrice(priceFeedIds.btc, toChainlinkPrice(40000))
    await pyth.updatePrice(priceFeedIds.btc, toChainlinkPrice(50000))

    await expect(vault.connect(user0).increasePosition(user0.address, dai.address, btc.address, toUsd(1000), false))
      .to.be.revertedWith("Vault: insufficient collateral for fees")
    await expect(vault.connect(user0).increasePosition(user0.address, dai.address, btc.address, 0, false))
      .to.be.revertedWith("Vault: invalid position.size")

    await dai.mint(user0.address, expandDecimals(1000, 18))
    await dai.connect(user0).transfer(vault.address, expandDecimals(9, 17))

    await expect(vault.connect(user0).increasePosition(user0.address, dai.address, btc.address, toUsd(1000), false))
      .to.be.revertedWith("Vault: insufficient collateral for fees")

    await dai.connect(user0).transfer(vault.address, expandDecimals(4, 18))

    await expect(vault.connect(user0).increasePosition(user0.address, dai.address, btc.address, toUsd(1000), false))
      .to.be.reverted //Vault: losses exceed collateral

    await pyth.updatePrice(priceFeedIds.btc, toChainlinkPrice(40000))
    await pyth.updatePrice(priceFeedIds.btc, toChainlinkPrice(41000))
    await pyth.updatePrice(priceFeedIds.btc, toChainlinkPrice(40000))

    await expect(vault.connect(user0).increasePosition(user0.address, dai.address, btc.address, toUsd(100), false))
      .to.be.reverted //Vault: liquidation fees exceed collateral

    await dai.connect(user0).transfer(vault.address, expandDecimals(6, 18))

    await expect(vault.connect(user0).increasePosition(user0.address, dai.address, btc.address, toUsd(8), false))
      .to.be.revertedWith("Vault: _size must be more than _collateral")

    await pyth.updatePrice(priceFeedIds.btc, toChainlinkPrice(40000))
    await pyth.updatePrice(priceFeedIds.btc, toChainlinkPrice(40000))
    await pyth.updatePrice(priceFeedIds.btc, toChainlinkPrice(40000))

    await expect(vault.connect(user0).increasePosition(user0.address, dai.address, btc.address, toUsd(600), false))
      .to.be.reverted //Vault: maxLeverage exceeded

    await expect(vault.connect(user0).increasePosition(user0.address, dai.address, btc.address, toUsd(100), false))
      .to.be.revertedWith("Vault: reserve exceeds pool")
  })

  it("increasePosition short", async () => {
    await vault.setMaxGlobalShortSize(btc.address, toUsd(300))

    let globalDelta = await vault.getGlobalShortDelta(btc.address)
    expect(await globalDelta[0]).eq(false)
    expect(await globalDelta[1]).eq(0)
    expect(await zlpManager.getAumInUsdg(true)).eq(0)
    expect(await zlpManager.getAumInUsdg(false)).eq(0)

    await vault.setFees(
      50, // _taxBasisPoints
      10, // _stableTaxBasisPoints
      4, // _mintBurnFeeBasisPoints
      30, // _swapFeeBasisPoints
      4, // _stableSwapFeeBasisPoints
      10, // _marginFeeBasisPoints
      toUsd(5), // _liquidationFeeUsd
      0, // _minProfitTime
      false // _hasDynamicFees
    )

    await pyth.updatePrice(priceFeedIds.btc, toChainlinkPrice(60000))
    await vault.setTokenConfig(...getBtcConfig(btc, btcPriceFeed))

    await pyth.updatePrice(priceFeedIds.eth, toChainlinkPrice(1000))
    await vault.setTokenConfig(...getBnbConfig(eth, ethPriceFeed))

    await pyth.updatePrice(priceFeedIds.dai, toChainlinkPrice(1))
    await vault.setTokenConfig(...getDaiConfig(dai, daiPriceFeed))

    await pyth.updatePrice(priceFeedIds.btc, toChainlinkPrice(40000))
    await pyth.updatePrice(priceFeedIds.btc, toChainlinkPrice(40000))
    await pyth.updatePrice(priceFeedIds.btc, toChainlinkPrice(40000))

    await dai.mint(user0.address, expandDecimals(1000, 18))
    await dai.connect(user0).transfer(vault.address, expandDecimals(500, 18))

    await expect(vault.connect(user0).increasePosition(user0.address, dai.address, btc.address, toUsd(99), false))
      .to.be.revertedWith("Vault: _size must be more than _collateral")

    await expect(vault.connect(user0).increasePosition(user0.address, dai.address, btc.address, toUsd(501), false))
      .to.be.revertedWith("Vault: reserve exceeds pool")

    expect(await vault.feeReserves(dai.address)).eq(0)
    expect(await vault.usdgAmounts(dai.address)).eq(0)
    expect(await vault.poolAmounts(dai.address)).eq(0)

    expect(await vault.getRedemptionCollateralUsd(dai.address)).eq(0)
    await vault.buyUSDG(dai.address, user1.address)
    expect(await vault.getRedemptionCollateralUsd(dai.address)).eq("499800000000000000000000000000000")

    expect(await vault.feeReserves(dai.address)).eq("200000000000000000") // 0.2
    expect(await vault.usdgAmounts(dai.address)).eq("499800000000000000000") // 499.8
    expect(await vault.poolAmounts(dai.address)).eq("499800000000000000000") // 499.8

    globalDelta = await vault.getGlobalShortDelta(btc.address)
    expect(await globalDelta[0]).eq(false)
    expect(await globalDelta[1]).eq(0)
    expect(await zlpManager.getAumInUsdg(true)).eq("499800000000000000000")
    expect(await zlpManager.getAumInUsdg(false)).eq("499800000000000000000")

    await dai.connect(user0).transfer(vault.address, expandDecimals(20, 18))
    await expect(vault.connect(user0).increasePosition(user0.address, dai.address, btc.address, toUsd(501), false))
      .to.be.revertedWith("Vault: reserve exceeds pool")

    expect(await vault.reservedAmounts(btc.address)).eq(0)
    expect(await vault.guaranteedUsd(btc.address)).eq(0)

    let position = await vault.getPosition(user0.address, dai.address, btc.address, false)
    expect(position[0]).eq(0) // size
    expect(position[1]).eq(0) // collateral
    expect(position[2]).eq(0) // averagePrice
    expect(position[3]).eq(0) // entryFundingRate
    expect(position[4]).eq(0) // reserveAmount
    expect(position[5]).eq(0) // realisedPnl
    expect(position[6]).eq(true) // hasProfit
    expect(position[7]).eq(0) // lastIncreasedTime

    await pyth.updatePrice(priceFeedIds.btc, toChainlinkPrice(41000))
    const tx = await vault.connect(user0).increasePosition(user0.address, dai.address, btc.address, toUsd(90), false)
    await reportGasUsed(provider, tx, "increasePosition gas used")

    expect(await vault.poolAmounts(dai.address)).eq("499800000000000000000")
    expect(await vault.reservedAmounts(dai.address)).eq(expandDecimals(90, 18))
    expect(await vault.guaranteedUsd(dai.address)).eq(0)
    expect(await vault.getRedemptionCollateralUsd(dai.address)).eq("499800000000000000000000000000000")

    const blockTime = await getBlockTime(provider)

    position = await vault.getPosition(user0.address, dai.address, btc.address, false)
    expect(position[0]).eq(toUsd(90)) // size
    expect(position[1]).eq(toUsd(19.91)) // collateral
    expect(position[2]).eq(toNormalizedPrice(41000)) // averagePrice
    expect(position[3]).eq(0) // entryFundingRate
    expect(position[4]).eq(expandDecimals(90, 18)) // reserveAmount
    expect(position[5]).eq(0) // realisedPnl
    expect(position[6]).eq(true) // hasProfit
    expect(position[7]).eq(blockTime) // lastIncreasedTime

    expect(await vault.feeReserves(dai.address)).eq("290000000000000000") // 0.29
    expect(await vault.usdgAmounts(dai.address)).eq("499800000000000000000") // 499.8
    expect(await vault.poolAmounts(dai.address)).eq("499800000000000000000") // 499.8

    expect(await vault.globalShortSizes(btc.address)).eq(toUsd(90))
    expect(await vault.globalShortAveragePrices(btc.address)).eq(toNormalizedPrice(41000))

    globalDelta = await vault.getGlobalShortDelta(btc.address)
    expect(await globalDelta[0]).eq(false)
    expect(await globalDelta[1]).eq(0)
    expect(await zlpManager.getAumInUsdg(true)).eq("499800000000000000000")
    expect(await zlpManager.getAumInUsdg(false)).eq("499800000000000000000")

    let delta = await vault.getPositionDelta(user0.address, dai.address, btc.address, false)
    expect(delta[0]).eq(false)
    expect(delta[1]).eq(0)

    await pyth.updatePrice(priceFeedIds.btc, toChainlinkPrice(42000))
    await pyth.updatePrice(priceFeedIds.btc, toChainlinkPrice(42000))
    await pyth.updatePrice(priceFeedIds.btc, toChainlinkPrice(42000))

    delta = await vault.getPositionDelta(user0.address, dai.address, btc.address, false)
    expect(delta[0]).eq(false)
    expect(delta[1]).eq("2195121951219512195121951219512")

    globalDelta = await vault.getGlobalShortDelta(btc.address)
    expect(await globalDelta[0]).eq(false)
    expect(await globalDelta[1]).eq("2195121951219512195121951219512")
    expect(await zlpManager.getAumInUsdg(true)).eq("501995121951219512195") // 499.8 + 4.5
    expect(await zlpManager.getAumInUsdg(false)).eq("501995121951219512195") // 499.8 + 4.5

    await vault.connect(user0).decreasePosition(user0.address, dai.address, btc.address, toUsd(3), toUsd(50), false, user2.address)

    position = await vault.getPosition(user0.address, dai.address, btc.address, false)
    expect(position[0]).eq(toUsd(40)) // size
    expect(position[1]).eq("15690487804878048780487804878049") // collateral
    expect(position[2]).eq(toNormalizedPrice(41000))
    expect(position[3]).eq(0) // entryFundingRate
    expect(position[4]).eq(expandDecimals(40, 18)) // reserveAmount
    expect(position[5]).eq("1219512195121951219512195121951") // realisedPnl
    expect(position[6]).eq(false) // hasProfit
    expect(position[7]).eq(blockTime) // lastIncreasedTime

    delta = await vault.getPositionDelta(user0.address, dai.address, btc.address, false)
    expect(delta[0]).eq(false)
    expect(delta[1]).eq("975609756097560975609756097560")

    expect(await vault.feeReserves(dai.address)).eq("340000000000000000") // 0.18
    expect(await vault.usdgAmounts(dai.address)).eq("499800000000000000000") // 499.8
    expect(await vault.poolAmounts(dai.address)).eq("501019512195121951219") // 502.3

    expect(await vault.globalShortSizes(btc.address)).eq(toUsd(40))
    expect(await vault.globalShortAveragePrices(btc.address)).eq(toNormalizedPrice(41000))

    globalDelta = await vault.getGlobalShortDelta(btc.address)
    expect(await globalDelta[0]).eq(false)
    expect(await globalDelta[1]).eq("975609756097560975609756097560")
    expect(await zlpManager.getAumInUsdg(true)).eq("501995121951219512194") // 499.8 + 4.5
    expect(await zlpManager.getAumInUsdg(false)).eq("501995121951219512194") // 499.8 + 4.5

    await dai.mint(vault.address, expandDecimals(50, 18))
    await vault.connect(user1).increasePosition(user1.address, dai.address, btc.address, toUsd(200), false)

    expect(await vault.globalShortSizes(btc.address)).eq(toUsd(240))
    expect(await vault.globalShortAveragePrices(btc.address)).eq("41829959514170040485829959514170209")

    globalDelta = await vault.getGlobalShortDelta(btc.address)
    expect(await globalDelta[0]).eq(false)
    expect(await globalDelta[1]).eq("975609756097560975609756097560")
    expect(await zlpManager.getAumInUsdg(true)).eq("501995121951219512194") // 502.3 + 2
    expect(await zlpManager.getAumInUsdg(false)).eq("501995121951219512194") // 502.3 + 2

    await pyth.updatePrice(priceFeedIds.btc, toChainlinkPrice(40000))
    await pyth.updatePrice(priceFeedIds.btc, toChainlinkPrice(40000))
    await pyth.updatePrice(priceFeedIds.btc, toChainlinkPrice(41000))

    delta = await vault.getPositionDelta(user0.address, dai.address, btc.address, false)
    expect(delta[0]).eq(false)
    expect(delta[1]).eq(0)

    delta = await vault.getPositionDelta(user1.address, dai.address, btc.address, false)
    expect(delta[0]).eq(true)
    expect(delta[1]).eq("4761904761904761904761904761904") // 4.76

    globalDelta = await vault.getGlobalShortDelta(btc.address)
    expect(await globalDelta[0]).eq(true)
    expect(await globalDelta[1]).eq("4761904761904761904761904761905")
    expect(await zlpManager.getAumInUsdg(true)).eq("496257607433217189314") // 502.3 + 1 - 4.76 => 498.53
    expect(await zlpManager.getAumInUsdg(false)).eq("496257607433217189314") // 492.77619047619047619

    await dai.mint(vault.address, expandDecimals(20, 18))
    await vault.connect(user2).increasePosition(user2.address, dai.address, btc.address, toUsd(60), false)

    expect(await vault.globalShortSizes(btc.address)).eq(toUsd(300))
    expect(await vault.globalShortAveragePrices(btc.address)).eq("41661290322580645161290322580645194")

    globalDelta = await vault.getGlobalShortDelta(btc.address)
    expect(await globalDelta[0]).eq(true)
    expect(await globalDelta[1]).eq("4761904761904761904761904761904")
    expect(await zlpManager.getAumInUsdg(true)).eq("496257607433217189314") // 500.038095238095238095
    expect(await zlpManager.getAumInUsdg(false)).eq("496257607433217189314") // 492.77619047619047619

    await dai.mint(vault.address, expandDecimals(20, 18))

    await expect(vault.connect(user2).increasePosition(user2.address, dai.address, btc.address, toUsd(60), false))
      .to.be.reverted //Vault: max shorts exceeded

    await vault.connect(user2).increasePosition(user2.address, dai.address, eth.address, toUsd(60), false)
  })
})
