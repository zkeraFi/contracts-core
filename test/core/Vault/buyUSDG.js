const { expect, use } = require("chai")
const { solidity } = require("ethereum-waffle")
const { deployContract, deployVault, deployTimeDistributor, deployVaultPriceFeed, deployZlpManager } = require("../../shared/fixtures")
const { expandDecimals, getBlockTime, increaseTime, mineBlock, reportGasUsed } = require("../../shared/utilities")
const { toChainlinkPrice } = require("../../shared/chainlink")
const { toUsd, toNormalizedPrice } = require("../../shared/units")
const { initVault, getBnbConfig, getBtcConfig, getDaiConfig, validateVaultBalance } = require("./helpers")
const { priceFeedIds } = require("../../shared/pyth")

use(solidity)

describe("Vault.buyUSDG", function () {
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
let pyth;
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

    await initVault(vault, router, usdg, vaultPriceFeed)

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

  it("buyUSDG", async () => {
    await expect(vault.buyUSDG(eth.address, wallet.address))
      .to.be.revertedWith("Vault: _token not whitelisted")

    await expect(vault.connect(user0).buyUSDG(eth.address, user1.address))
      .to.be.revertedWith("Vault: _token not whitelisted")

    await pyth.updatePrice(priceFeedIds.eth, toChainlinkPrice(300))
    await vault.setTokenConfig(...getBnbConfig(eth, ethPriceFeed))

    await expect(vault.connect(user0).buyUSDG(eth.address, user1.address))
      .to.be.revertedWith("Vault: invalid tokenAmount")

    expect(await usdg.balanceOf(user0.address)).eq(0)
    expect(await usdg.balanceOf(user1.address)).eq(0)
    expect(await vault.feeReserves(eth.address)).eq(0)
    expect(await vault.usdgAmounts(eth.address)).eq(0)
    expect(await vault.poolAmounts(eth.address)).eq(0)

    await eth.mint(user0.address, 100)
    await eth.connect(user0).transfer(vault.address, 100)
    const tx = await vault.connect(user0).buyUSDG(eth.address, user1.address, { gasPrice: "10000000000" })
    await reportGasUsed(provider, tx, "buyUSDG gas used")

    expect(await usdg.balanceOf(user0.address)).eq(0)
    expect(await usdg.balanceOf(user1.address)).eq(29700)
    expect(await vault.feeReserves(eth.address)).eq(1)
    expect(await vault.usdgAmounts(eth.address)).eq(29700)
    expect(await vault.poolAmounts(eth.address)).eq(100 - 1)

    await validateVaultBalance(expect, vault, eth)

    expect(await zlpManager.getAumInUsdg(true)).eq(29700)
  })

  it("buyUSDG allows gov to mint", async () => {
    await vault.setInManagerMode(true)
    await expect(vault.buyUSDG(eth.address, wallet.address))
      .to.be.revertedWith("Vault: forbidden")

    await pyth.updatePrice(priceFeedIds.eth, toChainlinkPrice(300))
    await vault.setTokenConfig(...getBnbConfig(eth, ethPriceFeed))

    await eth.mint(wallet.address, 100)
    await eth.transfer(vault.address, 100)

    expect(await usdg.balanceOf(wallet.address)).eq(0)
    expect(await vault.feeReserves(eth.address)).eq(0)
    expect(await vault.usdgAmounts(eth.address)).eq(0)
    expect(await vault.poolAmounts(eth.address)).eq(0)

    await expect(vault.connect(user0).buyUSDG(eth.address, wallet.address))
      .to.be.revertedWith("Vault: forbidden")

    await vault.setManager(user0.address, true)
    await vault.connect(user0).buyUSDG(eth.address, wallet.address)

    expect(await usdg.balanceOf(wallet.address)).eq(29700)
    expect(await vault.feeReserves(eth.address)).eq(1)
    expect(await vault.usdgAmounts(eth.address)).eq(29700)
    expect(await vault.poolAmounts(eth.address)).eq(100 - 1)

    await validateVaultBalance(expect, vault, eth)
  })

  it("buyUSDG uses min price", async () => {
    await expect(vault.connect(user0).buyUSDG(eth.address, user1.address))
      .to.be.revertedWith("Vault: _token not whitelisted")

    await pyth.updatePrice(priceFeedIds.eth, toChainlinkPrice(300))
    await pyth.updatePrice(priceFeedIds.eth, toChainlinkPrice(200))
    await pyth.updatePrice(priceFeedIds.eth, toChainlinkPrice(250))

    await vault.setTokenConfig(...getBnbConfig(eth, ethPriceFeed))

    expect(await usdg.balanceOf(user0.address)).eq(0)
    expect(await usdg.balanceOf(user1.address)).eq(0)
    expect(await vault.feeReserves(eth.address)).eq(0)
    expect(await vault.usdgAmounts(eth.address)).eq(0)
    expect(await vault.poolAmounts(eth.address)).eq(0)
    await eth.mint(user0.address, 100)
    await eth.connect(user0).transfer(vault.address, 100)
    await vault.connect(user0).buyUSDG(eth.address, user1.address)
    expect(await usdg.balanceOf(user0.address)).eq(0)
    expect(await usdg.balanceOf(user1.address)).eq(24750)
    expect(await vault.feeReserves(eth.address)).eq(1)
    expect(await vault.usdgAmounts(eth.address)).eq(24750)
    expect(await vault.poolAmounts(eth.address)).eq(100 - 1)

    await validateVaultBalance(expect, vault, eth)
  })

  it("buyUSDG updates fees", async () => {
    await expect(vault.connect(user0).buyUSDG(eth.address, user1.address))
      .to.be.revertedWith("Vault: _token not whitelisted")

    await pyth.updatePrice(priceFeedIds.eth, toChainlinkPrice(300))
    await vault.setTokenConfig(...getBnbConfig(eth, ethPriceFeed))

    expect(await usdg.balanceOf(user0.address)).eq(0)
    expect(await usdg.balanceOf(user1.address)).eq(0)
    expect(await vault.feeReserves(eth.address)).eq(0)
    expect(await vault.usdgAmounts(eth.address)).eq(0)
    expect(await vault.poolAmounts(eth.address)).eq(0)
    await eth.mint(user0.address, 10000)
    await eth.connect(user0).transfer(vault.address, 10000)
    await vault.connect(user0).buyUSDG(eth.address, user1.address)
    expect(await usdg.balanceOf(user0.address)).eq(0)
    expect(await usdg.balanceOf(user1.address)).eq(9970 * 300)
    expect(await vault.feeReserves(eth.address)).eq(30)
    expect(await vault.usdgAmounts(eth.address)).eq(9970 * 300)
    expect(await vault.poolAmounts(eth.address)).eq(10000 - 30)

    await validateVaultBalance(expect, vault, eth)
  })

  it("buyUSDG uses mintBurnFeeBasisPoints", async () => {
    await pyth.updatePrice(priceFeedIds.dai, toChainlinkPrice(1))
    await vault.setTokenConfig(...getDaiConfig(dai, daiPriceFeed))

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

    expect(await usdg.balanceOf(user0.address)).eq(0)
    expect(await usdg.balanceOf(user1.address)).eq(0)
    expect(await vault.feeReserves(eth.address)).eq(0)
    expect(await vault.usdgAmounts(eth.address)).eq(0)
    expect(await vault.poolAmounts(eth.address)).eq(0)
    await dai.mint(user0.address, expandDecimals(10000, 18))
    await dai.connect(user0).transfer(vault.address, expandDecimals(10000, 18))
    await vault.connect(user0).buyUSDG(dai.address, user1.address)
    expect(await usdg.balanceOf(user0.address)).eq(0)
    expect(await usdg.balanceOf(user1.address)).eq(expandDecimals(10000 - 4, 18))
    expect(await vault.feeReserves(dai.address)).eq(expandDecimals(4, 18))
    expect(await vault.usdgAmounts(dai.address)).eq(expandDecimals(10000 - 4, 18))
    expect(await vault.poolAmounts(dai.address)).eq(expandDecimals(10000 - 4, 18))
  })

  it("buyUSDG adjusts for decimals", async () => {
    await pyth.updatePrice(priceFeedIds.btc, toChainlinkPrice(60000))
    await vault.setTokenConfig(...getBtcConfig(btc, btcPriceFeed))

    await expect(vault.connect(user0).buyUSDG(btc.address, user1.address))
      .to.be.revertedWith("Vault: invalid tokenAmount")

    expect(await usdg.balanceOf(user0.address)).eq(0)
    expect(await usdg.balanceOf(user1.address)).eq(0)
    expect(await vault.feeReserves(btc.address)).eq(0)
    expect(await vault.usdgAmounts(eth.address)).eq(0)
    expect(await vault.poolAmounts(eth.address)).eq(0)
    await btc.mint(user0.address, expandDecimals(1, 8))
    await btc.connect(user0).transfer(vault.address, expandDecimals(1, 8))
    await vault.connect(user0).buyUSDG(btc.address, user1.address)
    expect(await usdg.balanceOf(user0.address)).eq(0)
    expect(await vault.feeReserves(btc.address)).eq(300000)
    expect(await usdg.balanceOf(user1.address)).eq(expandDecimals(60000, 18).sub(expandDecimals(180, 18))) // 0.3% of 60,000 => 180
    expect(await vault.usdgAmounts(btc.address)).eq(expandDecimals(60000, 18).sub(expandDecimals(180, 18)))
    expect(await vault.poolAmounts(btc.address)).eq(expandDecimals(1, 8).sub(300000))

    await validateVaultBalance(expect, vault, btc)
  })
})
