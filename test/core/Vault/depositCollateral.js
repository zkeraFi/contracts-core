const { expect, use } = require("chai")
const { solidity } = require("ethereum-waffle")
const { deployContract, deployVault, deployTimeDistributor, deployVaultPriceFeed, deployZlpManager } = require("../../shared/fixtures")
const { expandDecimals, getBlockTime, increaseTime, mineBlock, reportGasUsed } = require("../../shared/utilities")
const { toChainlinkPrice } = require("../../shared/chainlink")
const { toUsd, toNormalizedPrice } = require("../../shared/units")
const { initVault, getBnbConfig, getBtcConfig, getDaiConfig, validateVaultBalance } = require("./helpers")
const { priceFeedIds } = require("../../shared/pyth")

use(solidity)

describe("Vault.depositCollateral", function () {
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

  it("deposit collateral", async () => {
    await pyth.updatePrice(priceFeedIds.btc, toChainlinkPrice(60000))
    await vault.setTokenConfig(...getBtcConfig(btc, btcPriceFeed))

    await pyth.updatePrice(priceFeedIds.btc, toChainlinkPrice(40000))
    await pyth.updatePrice(priceFeedIds.btc, toChainlinkPrice(50000))

    await btc.mint(user0.address, expandDecimals(1, 8))

    await pyth.updatePrice(priceFeedIds.btc, toChainlinkPrice(40000))
    await pyth.updatePrice(priceFeedIds.btc, toChainlinkPrice(41000))
    await pyth.updatePrice(priceFeedIds.btc, toChainlinkPrice(40000))

    await btc.connect(user0).transfer(vault.address, 117500 - 1) // 0.001174 BTC => 47

    await expect(vault.connect(user0).increasePosition(user0.address, btc.address, btc.address, toUsd(47), true))
      .to.be.revertedWith("Vault: reserve exceeds pool")

    expect(await vault.feeReserves(btc.address)).eq(0)
    expect(await vault.usdgAmounts(btc.address)).eq(0)
    expect(await vault.poolAmounts(btc.address)).eq(0)

    expect(await vault.getRedemptionCollateralUsd(btc.address)).eq(0)
    await vault.buyUSDG(btc.address, user1.address)
    expect(await vault.getRedemptionCollateralUsd(btc.address)).eq(toUsd("46.8584"))

    expect(await vault.feeReserves(btc.address)).eq(353) // (117500 - 1) * 0.3% => 353
    expect(await vault.usdgAmounts(btc.address)).eq("46858400000000000000") // (117500 - 1 - 353) * 40000
    expect(await vault.poolAmounts(btc.address)).eq(117500 - 1 - 353)

    await btc.connect(user0).transfer(vault.address, 117500 - 1)
    await expect(vault.connect(user0).increasePosition(user0.address, btc.address, btc.address, toUsd(100), true))
      .to.be.revertedWith("Vault: reserve exceeds pool")

    await vault.buyUSDG(btc.address, user1.address)

    expect(await vault.getRedemptionCollateralUsd(btc.address)).eq(toUsd("93.7168"))

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

    expect(await zlpManager.getAumInUsdg(false)).eq("93716800000000000000") // 93.7168
    expect(await zlpManager.getAumInUsdg(true)).eq("93716800000000000000") // 96.05972

    const tx0 = await vault.connect(user0).increasePosition(user0.address, btc.address, btc.address, toUsd(47), true)
    await reportGasUsed(provider, tx0, "increasePosition gas used")

    expect(await zlpManager.getAumInUsdg(false)).eq("93717000000000000000") // 93.7182
    expect(await zlpManager.getAumInUsdg(true)).eq("93717000000000000000") // 95.10998

    expect(await vault.poolAmounts(btc.address)).eq("256675")
    expect(await vault.reservedAmounts(btc.address)).eq(117500)
    expect(await vault.guaranteedUsd(btc.address)).eq(toUsd(38.047))
    expect(await vault.getRedemptionCollateralUsd(btc.address)).eq("93716800000000000000000000000000") // (256792 - 117500) sats * 40000 => 51.7968, 47 / 40000 * 41000 => ~45.8536

    position = await vault.getPosition(user0.address, btc.address, btc.address, true)
    expect(position[0]).eq(toUsd(47)) // size
    expect(position[1]).eq(toUsd(8.953)) // collateral, 0.000225 BTC => 9, 9 - 0.047 => 8.953
    expect(position[2]).eq(toNormalizedPrice(40000)) 
    expect(position[3]).eq(0) // entryFundingRate
    expect(position[4]).eq(117500) // reserveAmount

    expect(await vault.feeReserves(btc.address)).eq(823) // fee is 0.047 USD => 0.00000114 BTC
    expect(await vault.usdgAmounts(btc.address)).eq("93716800000000000000") // (117500 - 1 - 353) * 40000 * 2
    expect(await vault.poolAmounts(btc.address)).eq(256675)

    let leverage = await vault.getPositionLeverage(user0.address, btc.address, btc.address, true)
    expect(leverage).eq(52496) // ~5.2x

    await btc.connect(user0).transfer(vault.address, 22500)

    expect(await zlpManager.getAumInUsdg(false)).eq("93717000000000000000") // 93.7182
    expect(await zlpManager.getAumInUsdg(true)).eq("93717000000000000000") // 95.10998

    const tx1 = await vault.connect(user0).increasePosition(user0.address, btc.address, btc.address, 0, true)
    await reportGasUsed(provider, tx1, "deposit collateral gas used")

    expect(await zlpManager.getAumInUsdg(false)).eq("93717000000000000000") // 93.7182
    expect(await zlpManager.getAumInUsdg(true)).eq("93717000000000000000") // 95.33498

    position = await vault.getPosition(user0.address, btc.address, btc.address, true)
    expect(position[0]).eq(toUsd(47)) // size
    expect(position[1]).eq(toUsd(8.953 + 9)) // collateral
    expect(position[2]).eq(toNormalizedPrice(40000)) 
    expect(position[3]).eq(0) // entryFundingRate
    expect(position[4]).eq(117500) // reserveAmount

    expect(await vault.feeReserves(btc.address)).eq(823) // fee is 0.047 USD => 0.00000114 BTC
    expect(await vault.usdgAmounts(btc.address)).eq("93716800000000000000") // (117500 - 1 - 353) * 40000 * 2
    expect(await vault.poolAmounts(btc.address)).eq(279175)

    leverage = await vault.getPositionLeverage(user0.address, btc.address, btc.address, true)
    expect(leverage).eq(26179) // ~2.6x

    await pyth.updatePrice(priceFeedIds.btc, toChainlinkPrice(50000))
    await pyth.updatePrice(priceFeedIds.btc, toChainlinkPrice(51000))
    await pyth.updatePrice(priceFeedIds.btc, toChainlinkPrice(50000))

    expect(await zlpManager.getAumInUsdg(false)).eq("109884500000000000000") // 109.886
    expect(await zlpManager.getAumInUsdg(true)).eq("109884500000000000000") // 111.50278

    await btc.connect(user0).transfer(vault.address, 100)
    await vault.connect(user0).increasePosition(user0.address, btc.address, btc.address, 0, true)

    expect(await zlpManager.getAumInUsdg(false)).eq("109884500000000000000") // 109.886
    expect(await zlpManager.getAumInUsdg(true)).eq("109884500000000000000") // 111.50378

    position = await vault.getPosition(user0.address, btc.address, btc.address, true)
    expect(position[0]).eq(toUsd(47)) // size
    expect(position[1]).eq(toUsd(8.953 + 9 + 0.05)) // collateral
    expect(position[2]).eq(toNormalizedPrice(40000))
    expect(position[3]).eq(0) // entryFundingRate
    expect(position[4]).eq(117500) // reserveAmount

    expect(await vault.feeReserves(btc.address)).eq(823) // fee is 0.047 USD => 0.00000114 BTC
    expect(await vault.usdgAmounts(btc.address)).eq("93716800000000000000") // (117500 - 1 - 353) * 40000 * 2
    expect(await vault.poolAmounts(btc.address)).eq(279275)

    leverage = await vault.getPositionLeverage(user0.address, btc.address, btc.address, true)
    expect(leverage).eq(26106) // ~2.6x

    await validateVaultBalance(expect, vault, btc)
  })
})
