const { expect, use } = require("chai")
const { solidity } = require("ethereum-waffle")
const { deployContract, deployVault, deployTimeDistributor, deployVaultPriceFeed, deployZlpManager } = require("../../shared/fixtures")
const { expandDecimals, getBlockTime, increaseTime, mineBlock, reportGasUsed, newWallet } = require("../../shared/utilities")
const { toChainlinkPrice } = require("../../shared/chainlink")
const { toUsd, toNormalizedPrice } = require("../../shared/units")
const { initVault, getBnbConfig, getBtcConfig, getDaiConfig } = require("./helpers")
const { priceFeedIds } = require("../../shared/pyth")

use(solidity)

describe("Vault.liquidateLongPosition", function () {
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
    await vaultPriceFeed.setTokenConfig(dai.address, daiPriceFeed.address, 8, false)

    zlp = await deployContract("ZLP", [])
    zlpManager = await deployZlpManager([vault.address, usdg.address, zlp.address, ethers.constants.AddressZero, 24 * 60 * 60])
  })

  it("liquidate long", async () => {
    await pyth.updatePrice(priceFeedIds.dai, toChainlinkPrice(1))
    await vault.setTokenConfig(...getDaiConfig(dai, daiPriceFeed))

    await pyth.updatePrice(priceFeedIds.btc, toChainlinkPrice(40000))
    await vault.setTokenConfig(...getBtcConfig(btc, btcPriceFeed))

    await pyth.updatePrice(priceFeedIds.btc, toChainlinkPrice(41000))
    await pyth.updatePrice(priceFeedIds.btc, toChainlinkPrice(40000))

    await expect(vault.connect(user0).liquidatePosition(user0.address, btc.address, btc.address, true, user2.address))
      .to.be.reverted //Vault: empty position

    await btc.mint(user1.address, expandDecimals(1, 8))
    await btc.connect(user1).transfer(vault.address, 250000) // 0.0025 BTC => 100 USD
    await vault.buyUSDG(btc.address, user1.address)

    await btc.mint(user0.address, expandDecimals(1, 8))
    await btc.connect(user1).transfer(vault.address, 25000) // 0.00025 BTC => 10 USD

    expect(await zlpManager.getAumInUsdg(false)).eq("99700000000000000000") // 99.7
    expect(await zlpManager.getAumInUsdg(true)).eq("99700000000000000000") // 102.1925

    await vault.connect(user0).increasePosition(user0.address, btc.address, btc.address, toUsd(90), true)

    expect(await zlpManager.getAumInUsdg(false)).eq("99700000000000000000") // 99.7024
    expect(await zlpManager.getAumInUsdg(true)).eq("99700000000000000000") // 100.19271

    let position = await vault.getPosition(user0.address, btc.address, btc.address, true)
    expect(position[0]).eq(toUsd(90)) // size
    expect(position[1]).eq(toUsd(9.91)) // collateral, 10 - 90 * 0.1%
    expect(position[2]).eq(toNormalizedPrice(40000)) // averagePrice
    expect(position[3]).eq(0) // entryFundingRate
    expect(position[4]).eq(225000) // reserveAmount, 0.00225 * 40,000 => 90

    expect((await vault.validateLiquidation(user0.address, btc.address, btc.address, true, false))[0]).eq(0)

    await pyth.updatePrice(priceFeedIds.btc, toChainlinkPrice(43500))
    await pyth.updatePrice(priceFeedIds.btc, toChainlinkPrice(43500))
    await pyth.updatePrice(priceFeedIds.btc, toChainlinkPrice(43500))

    let delta = await vault.getPositionDelta(user0.address, btc.address, btc.address, true)
    expect(delta[0]).eq(true)
    expect(delta[1]).eq("7875000000000000000000000000000") // ~5.48
    expect((await vault.validateLiquidation(user0.address, btc.address, btc.address, true, false))[0]).eq(0)

    await pyth.updatePrice(priceFeedIds.btc, toChainlinkPrice(39000))
    delta = await vault.getPositionDelta(user0.address, btc.address, btc.address, true)
    expect(delta[0]).eq(false)
    expect(delta[1]).eq("2250000000000000000000000000000") // ~4.39
    expect((await vault.validateLiquidation(user0.address, btc.address, btc.address, true, false))[0]).eq(0)

    await expect(vault.liquidatePosition(user0.address, btc.address, btc.address, true, user2.address))
      .to.be.reverted //"Vault: position cannot be liquidated

    await pyth.updatePrice(priceFeedIds.btc, toChainlinkPrice(32700))
    delta = await vault.getPositionDelta(user0.address, btc.address, btc.address, true)
    expect(delta[0]).eq(false)
    expect(delta[1]).eq("16425000000000000000000000000000") // ~5.04
    expect((await vault.validateLiquidation(user0.address, btc.address, btc.address, true, false))[0]).eq(1)

    position = await vault.getPosition(user0.address, btc.address, btc.address, true)
    expect(position[0]).eq(toUsd(90)) // size
    expect(position[1]).eq(toUsd(9.91)) // collateral, 10 - 90 * 0.1%
    expect(position[2]).eq(toNormalizedPrice(40000))
    expect(position[3]).eq(0) // entryFundingRate
    expect(position[4]).eq(225000) // reserveAmount, 0.00225 * 40,000 => 90

    expect(await vault.feeReserves(btc.address)).eq(975)
    expect(await vault.reservedAmounts(btc.address)).eq(225000)
    expect(await vault.guaranteedUsd(btc.address)).eq(toUsd(80.09))
    expect(await vault.poolAmounts(btc.address)).eq(274025)
    expect(await btc.balanceOf(user2.address)).eq(0)

    expect(await vault.inPrivateLiquidationMode()).eq(false)
    await vault.setInPrivateLiquidationMode(true)
    expect(await vault.inPrivateLiquidationMode()).eq(true)

    await expect(vault.connect(user1).liquidatePosition(user0.address, btc.address, btc.address, true, user2.address))
      .to.be.reverted //Vault: invalid liquidator

    expect(await vault.isLiquidator(user1.address)).eq(false)
    await vault.setLiquidator(user1.address, true)
    expect(await vault.isLiquidator(user1.address)).eq(true)

    expect(await zlpManager.getAumInUsdg(false)).eq("96121175000000000000") // 99.064997
    expect(await zlpManager.getAumInUsdg(true)).eq("96121175000000000000") // 101.418485

    const tx = await vault.connect(user1).liquidatePosition(user0.address, btc.address, btc.address, true, user2.address)
    await reportGasUsed(provider, tx, "liquidatePosition gas used")

    expect(await zlpManager.getAumInUsdg(false)).eq("84516420000000000000") // 101.522097
    expect(await zlpManager.getAumInUsdg(true)).eq("84516420000000000000") // 114.113985

    position = await vault.getPosition(user0.address, btc.address, btc.address, true)
    expect(position[0]).eq(0) // size
    expect(position[1]).eq(0) // collateral
    expect(position[2]).eq(0) // averagePrice
    expect(position[3]).eq(0) // entryFundingRate
    expect(position[4]).eq(0) // reserveAmount

    expect(await vault.feeReserves(btc.address)).eq(1250)
    expect(await vault.reservedAmounts(btc.address)).eq(0)
    expect(await vault.guaranteedUsd(btc.address)).eq(0)
    expect(await vault.poolAmounts(btc.address)).eq(258460)
    expect(await btc.balanceOf(user2.address)).eq(15290) // 0.00011494 * 43500 => ~5

    expect(await btc.balanceOf(vault.address)).eq(259710)

    const balance = await btc.balanceOf(vault.address)
    const poolAmount = await vault.poolAmounts(btc.address)
    const feeReserve = await vault.feeReserves(btc.address)
    expect(poolAmount.add(feeReserve).sub(balance)).eq(0)

    await vault.withdrawFees(btc.address, user0.address)

    await btc.mint(vault.address, 1000)
    await vault.buyUSDG(btc.address, user1.address)
  })

  it("automatic stop-loss", async () => {
    await pyth.updatePrice(priceFeedIds.dai, toChainlinkPrice(1))
    await vault.setTokenConfig(...getDaiConfig(dai, daiPriceFeed))

    await pyth.updatePrice(priceFeedIds.btc, toChainlinkPrice(40000))
    await vault.setTokenConfig(...getBtcConfig(btc, btcPriceFeed))

    await pyth.updatePrice(priceFeedIds.btc, toChainlinkPrice(41000))
    await pyth.updatePrice(priceFeedIds.btc, toChainlinkPrice(40000))

    await expect(vault.connect(user0).liquidatePosition(user0.address, btc.address, btc.address, true, user2.address))
      .to.be.reverted //Vault: empty position

    await btc.mint(user1.address, expandDecimals(1, 8))
    await btc.connect(user1).transfer(vault.address, 5000000) // 0.05 BTC => 2000 USD
    await vault.buyUSDG(btc.address, user1.address)

    await btc.mint(user1.address, expandDecimals(1, 8))
    await btc.connect(user1).transfer(vault.address, 250000) // 0.0025 BTC => 100 USD
    await vault.connect(user0).increasePosition(user0.address, btc.address, btc.address, toUsd(1000), true)

    let position = await vault.getPosition(user0.address, btc.address, btc.address, true)
    expect(position[0]).eq(toUsd(1000)) // size
    expect(position[1]).eq(toUsd(99)) // collateral, 100 - 1000 * 0.1%
    expect(position[2]).eq(toNormalizedPrice(40000)) // averagePrice
    expect(position[3]).eq(0) // entryFundingRate
    expect(position[4]).eq("2500000") // reserveAmount, 0.025 * 40,000 => 1000

    expect((await vault.validateLiquidation(user0.address, btc.address, btc.address, true, false))[0]).eq(0)

    await pyth.updatePrice(priceFeedIds.btc, toChainlinkPrice(43500))

    let delta = await vault.getPositionDelta(user0.address, btc.address, btc.address, true)
    expect(delta[0]).eq(true)
    expect(delta[1]).eq("87500000000000000000000000000000")
    expect((await vault.validateLiquidation(user0.address, btc.address, btc.address, true, false))[0]).eq(0)

    await pyth.updatePrice(priceFeedIds.btc, toChainlinkPrice(39000))
    delta = await vault.getPositionDelta(user0.address, btc.address, btc.address, true)
    expect(delta[0]).eq(false)
    expect(delta[1]).eq("25000000000000000000000000000000")
    expect((await vault.validateLiquidation(user0.address, btc.address, btc.address, true, false))[0]).eq(0)

    await expect(vault.liquidatePosition(user0.address, btc.address, btc.address, true, user2.address))
      .to.be.reverted //Vault: position cannot be liquidated

    await pyth.updatePrice(priceFeedIds.btc, toChainlinkPrice(36360))

    delta = await vault.getPositionDelta(user0.address, btc.address, btc.address, true)
    expect(delta[0]).eq(false)
    expect(delta[1]).eq("91000000000000000000000000000000") // ~96
    expect((await vault.validateLiquidation(user0.address, btc.address, btc.address, true, false))[0]).eq(2)

    position = await vault.getPosition(user0.address, btc.address, btc.address, true)
    expect(position[0]).eq(toUsd(1000)) // size
    expect(position[1]).eq(toUsd(99)) // collateral, 100 - 1000 * 0.1%
    expect(position[2]).eq(toNormalizedPrice(40000))
    expect(position[3]).eq(0) // entryFundingRate
    expect(position[4]).eq("2500000") // reserveAmount, 0.025 * 40,000 => 1000

    expect(await vault.feeReserves(btc.address)).eq("17500")
    expect(await vault.reservedAmounts(btc.address)).eq("2500000")
    expect(await vault.guaranteedUsd(btc.address)).eq(toUsd(901))
    expect(await vault.poolAmounts(btc.address)).eq(5232500)
    expect(await btc.balanceOf(wallet.address)).eq(0)
    expect(await btc.balanceOf(user0.address)).eq(0)
    expect(await btc.balanceOf(user1.address)).eq("194750000")
    expect(await btc.balanceOf(user2.address)).eq(0)

    const tx = await vault.liquidatePosition(user0.address, btc.address, btc.address, true, user2.address)
    await reportGasUsed(provider, tx, "liquidatePosition gas used")

    position = await vault.getPosition(user0.address, btc.address, btc.address, true)
    expect(position[0]).eq(0) // size
    expect(position[1]).eq(0) // collateral
    expect(position[2]).eq(0) // averagePrice
    expect(position[3]).eq(0) // entryFundingRate
    expect(position[4]).eq(0) // reserveAmount

    expect(await vault.feeReserves(btc.address)).eq(20250)
    expect(await vault.reservedAmounts(btc.address)).eq(0)
    expect(await vault.guaranteedUsd(btc.address)).eq(0)
    expect(await vault.poolAmounts(btc.address)).eq(5210498)
    expect(await btc.balanceOf(wallet.address)).eq(0)
    expect(await btc.balanceOf(user0.address)).eq("19251") 
    expect(await btc.balanceOf(user1.address)).eq("194750000")
    expect(await btc.balanceOf(user2.address)).eq(0)

    expect(await btc.balanceOf(vault.address)).eq(5230749)

    const balance = await btc.balanceOf(vault.address)
    const poolAmount = await vault.poolAmounts(btc.address)
    const feeReserve = await vault.feeReserves(btc.address)
    expect(poolAmount.add(feeReserve).sub(balance)).eq(-1)

    await vault.withdrawFees(btc.address, user0.address)

    await btc.mint(vault.address, 1000)
    await vault.buyUSDG(btc.address, user1.address)
  })
})
