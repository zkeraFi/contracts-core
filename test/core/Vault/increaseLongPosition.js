const { expect, use } = require("chai")
const { solidity } = require("ethereum-waffle")
const { deployContract, deployVault, deployTimeDistributor, deployVaultPriceFeed, deployZlpManager } = require("../../shared/fixtures")
const { expandDecimals, getBlockTime, increaseTime, mineBlock, reportGasUsed } = require("../../shared/utilities")
const { toChainlinkPrice } = require("../../shared/chainlink")
const { toUsd, toNormalizedPrice } = require("../../shared/units")
const { initVault, getBnbConfig, getBtcConfig, getDaiConfig, validateVaultBalance } = require("./helpers")
const { priceFeedIds } = require("../../shared/pyth")

use(solidity)

describe("Vault.increaseLongPosition", function () {
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

    const initVaultResult = await initVault(vault, router, usdg, vaultPriceFeed)

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

  it("increasePosition long validations", async () => {
    await pyth.updatePrice(priceFeedIds.dai, toChainlinkPrice(1))
    await vault.setMaxGasPrice("20000000000") // 20 gwei
    await vault.setTokenConfig(...getDaiConfig(dai, daiPriceFeed))
    await expect(vault.connect(user1).increasePosition(user0.address, btc.address, btc.address, 0, true))
      .to.be.revertedWith("Vault: invalid msg.sender")
    await expect(vault.connect(user1).increasePosition(user0.address, btc.address, btc.address, 0, true, { gasPrice: "21000000000" }))
      .to.be.revertedWith("Vault: maxGasPrice exceeded")
    await vault.setMaxGasPrice(0)
    await vault.setIsLeverageEnabled(false)
    await expect(vault.connect(user1).increasePosition(user0.address, btc.address, btc.address, 0, true, { gasPrice: "21000000000" }))
      .to.be.revertedWith("Vault: leverage not enabled")
    await vault.setIsLeverageEnabled(true)
    await vault.connect(user0).addRouter(user1.address)
    await expect(vault.connect(user1).increasePosition(user0.address, btc.address, eth.address, 0, true))
      .to.be.revertedWith("Vault: mismatched tokens")
    await expect(vault.connect(user0).increasePosition(user0.address, btc.address, eth.address, toUsd(1000), true))
      .to.be.revertedWith("Vault: mismatched tokens")
    await expect(vault.connect(user0).increasePosition(user0.address, dai.address, dai.address, toUsd(1000), true))
      .to.be.revertedWith("Vault: _collateralToken must not be a stableToken")
    await expect(vault.connect(user0).increasePosition(user0.address, btc.address, btc.address, toUsd(1000), true))
      .to.be.revertedWith("Vault: _collateralToken not whitelisted")

    await pyth.updatePrice(priceFeedIds.btc, toChainlinkPrice(60000))
    await vault.setTokenConfig(...getBtcConfig(btc, btcPriceFeed))

    await pyth.updatePrice(priceFeedIds.btc, toChainlinkPrice(40000))

    console.log(1)
    await expect(vault.connect(user0).increasePosition(user0.address, btc.address, btc.address, toUsd(1000), true))
      .to.be.revertedWith("Vault: insufficient collateral for fees")
    await expect(vault.connect(user0).increasePosition(user0.address, btc.address, btc.address, 0, true))
      .to.be.revertedWith("Vault: invalid position.size")

    await btc.mint(user0.address, expandDecimals(1, 8))
    await btc.connect(user0).transfer(vault.address, 2500 - 1)

    await expect(vault.connect(user0).increasePosition(user0.address, btc.address, btc.address, toUsd(1000), true))
      .to.be.revertedWith("Vault: insufficient collateral for fees")

    await btc.connect(user0).transfer(vault.address, 1)

    await expect(vault.connect(user0).increasePosition(user0.address, btc.address, btc.address, toUsd(1000), true))
      .to.be.reverted //Vault: losses exceed collateral

    await pyth.updatePrice(priceFeedIds.btc, toChainlinkPrice(40000))
    await pyth.updatePrice(priceFeedIds.btc, toChainlinkPrice(40000))
    await pyth.updatePrice(priceFeedIds.btc, toChainlinkPrice(40000))

    await expect(vault.connect(user0).increasePosition(user0.address, btc.address, btc.address, toUsd(1000), true))
      .to.be.reverted //Vault: fees exceed collateral

    await btc.connect(user0).transfer(vault.address, 10000)

    await expect(vault.connect(user0).increasePosition(user0.address, btc.address, btc.address, toUsd(1000), true))
      .to.be.reverted //Vault: liquidation fees exceed collateral

    await btc.connect(user0).transfer(vault.address, 10000)

    await expect(vault.connect(user0).increasePosition(user0.address, btc.address, btc.address, toUsd(500), true))
      .to.be.reverted //Vault: maxLeverage exceeded

    await expect(vault.connect(user0).increasePosition(user0.address, btc.address, btc.address, toUsd(8), true))
      .to.be.revertedWith("Vault: _size must be more than _collateral")

    await expect(vault.connect(user0).increasePosition(user0.address, btc.address, btc.address, toUsd(47), true))
      .to.be.revertedWith("Vault: reserve exceeds pool")
  })

  it("increasePosition long", async () => {
    await pyth.updatePrice(priceFeedIds.btc, toChainlinkPrice(60000))
    await vault.setTokenConfig(...getBtcConfig(btc, btcPriceFeed))

    await pyth.updatePrice(priceFeedIds.btc, toChainlinkPrice(40000))
    await pyth.updatePrice(priceFeedIds.btc, toChainlinkPrice(50000))

    await btc.mint(user0.address, expandDecimals(1, 8))

    await pyth.updatePrice(priceFeedIds.btc, toChainlinkPrice(40000))
    await pyth.updatePrice(priceFeedIds.btc, toChainlinkPrice(41000))
    await pyth.updatePrice(priceFeedIds.btc, toChainlinkPrice(40000))

    await btc.connect(user0).transfer(vault.address, 117500 - 1) // 0.001174 BTC => 47

    await expect(vault.connect(user0).increasePosition(user0.address, btc.address, btc.address, toUsd(118), true))
      .to.be.revertedWith("Vault: reserve exceeds pool")

    expect(await vault.feeReserves(btc.address)).eq(0)
    expect(await vault.usdgAmounts(btc.address)).eq(0)
    expect(await vault.poolAmounts(btc.address)).eq(0)

    expect(await zlpManager.getAumInUsdg(true)).eq(0)
    expect(await vault.getRedemptionCollateralUsd(btc.address)).eq(0)
    await vault.buyUSDG(btc.address, user1.address)
    expect(await vault.getRedemptionCollateralUsd(btc.address)).eq(toUsd("46.8584"))
    expect(await zlpManager.getAumInUsdg(true)).eq("46858400000000000000") // 48.02986
    expect(await zlpManager.getAumInUsdg(false)).eq("46858400000000000000") // 46.8584

    expect(await vault.feeReserves(btc.address)).eq(353) // (117500 - 1) * 0.3% => 353
    expect(await vault.usdgAmounts(btc.address)).eq("46858400000000000000") // (117500 - 1 - 353) * 40000
    expect(await vault.poolAmounts(btc.address)).eq(117500 - 1 - 353)

    await btc.connect(user0).transfer(vault.address, 117500 - 1)
    await expect(vault.connect(user0).increasePosition(user0.address, btc.address, btc.address, toUsd(200), true))
      .to.be.revertedWith("Vault: reserve exceeds pool")

    await vault.buyUSDG(btc.address, user1.address)

    expect(await vault.getRedemptionCollateralUsd(btc.address)).eq(toUsd("93.7168"))
    expect(await zlpManager.getAumInUsdg(true)).eq("93716800000000000000") // 96.05972
    expect(await zlpManager.getAumInUsdg(false)).eq("93716800000000000000") // 93.7168

    expect(await vault.feeReserves(btc.address)).eq(353 * 2) // (117500 - 1) * 0.3% * 2
    expect(await vault.usdgAmounts(btc.address)).eq("93716800000000000000") // (117500 - 1 - 353) * 40000 * 2
    expect(await vault.poolAmounts(btc.address)).eq((117500 - 1 - 353) * 2)

    await expect(vault.connect(user0).increasePosition(user0.address, btc.address, btc.address, toUsd(47), true))
      .to.be.revertedWith("Vault: insufficient collateral for fees")

    await btc.connect(user0).transfer(vault.address, 22500)

    expect(await vault.reservedAmounts(btc.address)).eq(0)
    expect(await vault.guaranteedUsd(btc.address)).eq(0)

    let position = await vault.getPosition(user0.address, btc.address, btc.address, true)
    expect(position[0]).eq(0) // size
    expect(position[1]).eq(0) // collateral
    expect(position[2]).eq(0) // averagePrice
    expect(position[3]).eq(0) // entryFundingRate
    expect(position[4]).eq(0) // reserveAmount
    expect(position[5]).eq(0) // realisedPnl
    expect(position[6]).eq(true) // hasProfit
    expect(position[7]).eq(0) // lastIncreasedTime

    const tx = await vault.connect(user0).increasePosition(user0.address, btc.address, btc.address, toUsd(47), true)
    await reportGasUsed(provider, tx, "increasePosition gas used")

    const blockTime = await getBlockTime(provider)

    expect(await vault.poolAmounts(btc.address)).eq(256675)
    expect(await vault.reservedAmounts(btc.address)).eq(117500)
    expect(await vault.guaranteedUsd(btc.address)).eq(toUsd(38.047))
    expect(await vault.getRedemptionCollateralUsd(btc.address)).eq("93716800000000000000000000000000")
    expect(await zlpManager.getAumInUsdg(true)).eq("93717000000000000000") // 95.10998
    expect(await zlpManager.getAumInUsdg(false)).eq("93717000000000000000") // 93.7182

    position = await vault.getPosition(user0.address, btc.address, btc.address, true)
    expect(position[0]).eq(toUsd(47)) // size
    expect(position[1]).eq(toUsd(8.953)) // collateral, 0.000225 BTC => 9, 9 - 0.047 => 8.953
    expect(position[2]).eq(toNormalizedPrice(40000)) 
    expect(position[3]).eq(0) // entryFundingRate
    expect(position[4]).eq(117500) // reserveAmount
    expect(position[5]).eq(0) // realisedPnl
    expect(position[6]).eq(true) // hasProfit
    expect(position[7]).eq(blockTime) // lastIncreasedTime

    expect(await vault.feeReserves(btc.address)).eq(823) // fee is 0.047 USD => 0.00000114 BTC
    expect(await vault.usdgAmounts(btc.address)).eq("93716800000000000000") // (117500 - 1 - 353) * 40000 * 2
    expect(await vault.poolAmounts(btc.address)).eq(256675)

    expect(await vault.globalShortSizes(btc.address)).eq(0)
    expect(await vault.globalShortAveragePrices(btc.address)).eq(0)

    await validateVaultBalance(expect, vault, btc)
  })

  it("increasePosition long aum", async () => {
    await pyth.updatePrice(priceFeedIds.btc, toChainlinkPrice(100000))
    await pyth.updatePrice(priceFeedIds.btc, toChainlinkPrice(100000))
    await pyth.updatePrice(priceFeedIds.btc, toChainlinkPrice(100000))
    await vault.setTokenConfig(...getBtcConfig(btc, btcPriceFeed))

    await btc.mint(user0.address, expandDecimals(1, 8))
    await btc.connect(user0).transfer(vault.address, expandDecimals(1, 8))

    expect(await vault.feeReserves(btc.address)).eq(0)
    expect(await vault.usdgAmounts(btc.address)).eq(0)
    expect(await vault.poolAmounts(btc.address)).eq(0)

    expect(await zlpManager.getAumInUsdg(true)).eq(0)
    expect(await vault.getRedemptionCollateralUsd(btc.address)).eq(0)
    await vault.buyUSDG(btc.address, user1.address)
    expect(await vault.getRedemptionCollateralUsd(btc.address)).eq(toUsd(99700))
    expect(await zlpManager.getAumInUsdg(true)).eq(expandDecimals(99700, 18))

    expect(await vault.feeReserves(btc.address)).eq("300000") // 0.003 BTC
    expect(await vault.usdgAmounts(btc.address)).eq(expandDecimals(99700, 18))
    expect(await vault.poolAmounts(btc.address)).eq("99700000") // 0.997

    await btc.mint(user0.address, expandDecimals(5, 7))
    await btc.connect(user0).transfer(vault.address, expandDecimals(5, 7))

    expect(await vault.reservedAmounts(btc.address)).eq(0)
    expect(await vault.guaranteedUsd(btc.address)).eq(0)

    let position = await vault.getPosition(user0.address, btc.address, btc.address, true)
    expect(position[0]).eq(0) // size
    expect(position[1]).eq(0) // collateral
    expect(position[2]).eq(0) // averagePrice
    expect(position[3]).eq(0) // entryFundingRate
    expect(position[4]).eq(0) // reserveAmount
    expect(position[5]).eq(0) // realisedPnl
    expect(position[6]).eq(true) // hasProfit
    expect(position[7]).eq(0) // lastIncreasedTime

    const tx = await vault.connect(user0).increasePosition(user0.address, btc.address, btc.address, toUsd(80000), true)
    await reportGasUsed(provider, tx, "increasePosition gas used")

    const blockTime = await getBlockTime(provider)

    expect(await vault.poolAmounts(btc.address)).eq("149620000") // 1.4962 BTC
    expect(await vault.reservedAmounts(btc.address)).eq("80000000") // 0.8 BTC
    expect(await vault.guaranteedUsd(btc.address)).eq(toUsd(30080)) // 80000 - 49920
    expect(await vault.getRedemptionCollateralUsd(btc.address)).eq(toUsd(99700))
    expect(await zlpManager.getAumInUsdg(true)).eq(expandDecimals(99700, 18))
    expect(await zlpManager.getAumInUsdg(false)).eq(expandDecimals(99700, 18))

    position = await vault.getPosition(user0.address, btc.address, btc.address, true)
    expect(position[0]).eq(toUsd(80000)) // size
    expect(position[1]).eq(toUsd(49920)) // collateral
    expect(position[2]).eq(toNormalizedPrice(100000)) // averagePrice
    expect(position[3]).eq(0) // entryFundingRate
    expect(position[4]).eq("80000000") // 0.8 BTC
    expect(position[5]).eq(0) // realisedPnl
    expect(position[6]).eq(true) // hasProfit
    expect(position[7]).eq(blockTime) // lastIncreasedTime

    await pyth.updatePrice(priceFeedIds.btc, toChainlinkPrice(150000))
    await pyth.updatePrice(priceFeedIds.btc, toChainlinkPrice(150000))
    await pyth.updatePrice(priceFeedIds.btc, toChainlinkPrice(150000))

    let delta = await vault.getPositionDelta(user0.address, btc.address, btc.address, true)
    expect(delta[0]).eq(true)
    expect(delta[1]).eq(toUsd(40000))
    expect(await zlpManager.getAumInUsdg(true)).eq(expandDecimals(134510, 18)) // 30080 + (1.4962-0.8)*150000
    expect(await zlpManager.getAumInUsdg(false)).eq(expandDecimals(134510, 18)) // 30080 + (1.4962-0.8)*150000

    await pyth.updatePrice(priceFeedIds.btc, toChainlinkPrice(50000))
    await pyth.updatePrice(priceFeedIds.btc, toChainlinkPrice(50000))
    await pyth.updatePrice(priceFeedIds.btc, toChainlinkPrice(75000))

    delta = await vault.getPositionDelta(user0.address, btc.address, btc.address, true)
    expect(delta[0]).eq(false)
    expect(delta[1]).eq(toUsd(20000))
    expect(await zlpManager.getAumInUsdg(true)).eq(expandDecimals(82295, 18)) // 30080 + (1.4962-0.8)*75000
    expect(await zlpManager.getAumInUsdg(false)).eq(expandDecimals(82295, 18)) // 30080 + (1.4962-0.8)*50000

    await vault.connect(user0).decreasePosition(user0.address, btc.address, btc.address, 0, toUsd(80000), true, user2.address)

    position = await vault.getPosition(user0.address, btc.address, btc.address, true)
    expect(position[0]).eq(0) // size
    expect(position[1]).eq(0) // collateral
    expect(position[2]).eq(0) // averagePrice
    expect(position[3]).eq(0) // entryFundingRate
    expect(position[4]).eq(0) // reserveAmount
    expect(position[5]).eq(0) // realisedPnl
    expect(position[6]).eq(true) // hasProfit
    expect(position[7]).eq(0) // lastIncreasedTime

    expect(await vault.poolAmounts(btc.address)).eq("109726667")
    expect(await vault.reservedAmounts(btc.address)).eq(0) // 0.8 BTC
    expect(await vault.guaranteedUsd(btc.address)).eq(toUsd(0))
    expect(await vault.getRedemptionCollateralUsd(btc.address)).eq("82295000250000000000000000000000000")
    expect(await zlpManager.getAumInUsdg(true)).eq("82295000250000000000000") // 102295.0005
    expect(await zlpManager.getAumInUsdg(false)).eq("82295000250000000000000") // 68196.667

    expect(await vault.globalShortSizes(btc.address)).eq(0)
    expect(await vault.globalShortAveragePrices(btc.address)).eq(0)

    await validateVaultBalance(expect, vault, btc)
  })
})
