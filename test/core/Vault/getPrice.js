const { expect, use } = require("chai")
const { solidity } = require("ethereum-waffle")
const { deployContract, deployVault, deployTimeDistributor, deployVaultPriceFeed } = require("../../shared/fixtures")
const { expandDecimals, getBlockTime, increaseTime, mineBlock, reportGasUsed, newWallet } = require("../../shared/utilities")
const { toChainlinkPrice } = require("../../shared/chainlink")
const { toUsd, toNormalizedPrice } = require("../../shared/units")
const { initVault, getDaiConfig, getBnbConfig, getBtcConfig } = require("./helpers")
const { priceFeedIds } = require("../../shared/pyth")

use(solidity)

describe("Vault.getPrice", function () {
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
  let usdc
  let usdcPriceFeed
  let distributor0
  let yieldTracker0
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

    usdc = await deployContract("Token", [])
    usdcPriceFeed = await deployContract("PythPriceFeedV2", [pyth.address,priceFeedIds.usdc,10000])

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
    await vaultPriceFeed.setTokenConfig(usdc.address, usdcPriceFeed.address, 8, true)
  })

  it("getPrice", async () => {
    await pyth.updatePrice(priceFeedIds.dai, toChainlinkPrice(1))
    await vault.setTokenConfig(...getDaiConfig(dai, daiPriceFeed))
    expect(await vaultPriceFeed.getPrice(dai.address, true, true, true)).eq(expandDecimals(1, 30))

    await pyth.updatePrice(priceFeedIds.dai, toChainlinkPrice(1.1))
    expect(await vaultPriceFeed.getPrice(dai.address, true, true, true)).eq(expandDecimals(11, 29))

    await pyth.updatePrice(priceFeedIds.usdc, toChainlinkPrice(1))
    await vault.setTokenConfig(
      usdc.address, // _token
      18, // _tokenDecimals
      10000, // _tokenWeight
      75, // _minProfitBps,
      0, // _maxUsdgAmount
      false, // _isStable
      true // _isShortable
    )

    expect(await vaultPriceFeed.getPrice(usdc.address, true, true, true)).eq(expandDecimals(1, 30))
    await pyth.updatePrice(priceFeedIds.usdc, toChainlinkPrice(1.1))
    expect(await vaultPriceFeed.getPrice(usdc.address, true, true, true)).eq(expandDecimals(11, 29))

    await vaultPriceFeed.setMaxStrictPriceDeviation(expandDecimals(1, 29))
    expect(await vaultPriceFeed.getPrice(usdc.address, true, true, true)).eq(expandDecimals(1, 30))

    await pyth.updatePrice(priceFeedIds.usdc, toChainlinkPrice(1.11))
    expect(await vaultPriceFeed.getPrice(usdc.address, true, true, true)).eq(expandDecimals(111, 28))
    expect(await vaultPriceFeed.getPrice(usdc.address, false, true, true)).eq(expandDecimals(1, 30))

    await pyth.updatePrice(priceFeedIds.usdc, toChainlinkPrice(0.9))
    expect(await vaultPriceFeed.getPrice(usdc.address, true, true, true)).eq(expandDecimals(100, 28))
    expect(await vaultPriceFeed.getPrice(usdc.address, false, true, true)).eq(expandDecimals(1, 30))

    await vaultPriceFeed.setSpreadBasisPoints(usdc.address, 20)
    expect(await vaultPriceFeed.getPrice(usdc.address, false, true, true)).eq(expandDecimals(1, 30))

    await vaultPriceFeed.setSpreadBasisPoints(usdc.address, 0)
    await pyth.updatePrice(priceFeedIds.usdc, toChainlinkPrice(0.89))
    await pyth.updatePrice(priceFeedIds.usdc, toChainlinkPrice(0.89))
    expect(await vaultPriceFeed.getPrice(usdc.address, true, true, true)).eq(expandDecimals(1, 30))
    expect(await vaultPriceFeed.getPrice(usdc.address, false, true, true)).eq(expandDecimals(89, 28))

    await vaultPriceFeed.setSpreadBasisPoints(usdc.address, 20)
    expect(await vaultPriceFeed.getPrice(usdc.address, false, true, true)).eq(expandDecimals(89, 28))

    await vaultPriceFeed.setUseV2Pricing(true)
    expect(await vaultPriceFeed.getPrice(usdc.address, false, true, true)).eq(expandDecimals(89, 28))

    await vaultPriceFeed.setSpreadBasisPoints(btc.address, 0)
    await pyth.updatePrice(priceFeedIds.btc, toChainlinkPrice(40000))
    expect(await vaultPriceFeed.getPrice(btc.address, true, true, true)).eq(expandDecimals(40000, 30))

    await vaultPriceFeed.setSpreadBasisPoints(btc.address, 20)
    expect(await vaultPriceFeed.getPrice(btc.address, false, true, true)).eq(expandDecimals(39920, 30))
  })
})
