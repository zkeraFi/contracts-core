const { expect, use } = require("chai")
const { solidity } = require("ethereum-waffle")
const { deployContract, deployProxyBlockInfo, deployVester, deployRewardDistributor, deployVault, deployVaultPriceFeed, deployZlpManager, deployTimelock, deployBonusDistributor } = require("../shared/fixtures")
const { expandDecimals, getBlockTime, increaseTime, mineBlock, reportGasUsed, print, newWallet } = require("../shared/utilities")
const { toChainlinkPrice } = require("../shared/chainlink")
const { toUsd, toNormalizedPrice } = require("../shared/units")
const { initVault, getBnbConfig, getBtcConfig, getDaiConfig } = require("../core/Vault/helpers")
const { randomBytes } = require("ethers/lib/utils")

use(solidity)

describe("RewardRouterV4", function () {
  const provider = waffle.provider
  const [wallet, user0, user1, user2, user3, user4, tokenManager] = provider.getWallets()

  const vestingDuration = 365 * 24 * 60 * 60

  let timelock

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
  let busd
  let busdPriceFeed

  let zke
  let esZke
  let bnZke

  let stakedZkeTracker
  let stakedZkeDistributor
  let bonusZkeTracker
  let bonusZkeDistributor
  let feeZkeTracker
  let feeZkeDistributor

  let feeZlpTracker
  let feeZlpDistributor
  let stakedZlpTracker
  let stakedZlpDistributor

  let zkeVester
  let zlpVester

  let rewardRouter

  let pyth

  beforeEach(async () => {

    pyth = await deployContract("Pyth", [])

    bnb = await deployContract("Token", [])
    bnbPriceFeed = await deployContract("PriceFeed", [])

    btc = await deployContract("Token", [])
    btcPriceFeed = await deployContract("PriceFeed", [])

    eth = await deployContract("Token", [])
    ethPriceFeed = await deployContract("PriceFeed", [])

    dai = await deployContract("Token", [])
    daiPriceFeed = await deployContract("PriceFeed", [])

    busd = await deployContract("Token", [])
    busdPriceFeed = await deployContract("PriceFeed", [])

    vault = await deployVault()
    usdg = await deployContract("USDG", [vault.address])
    router = await deployContract("Router", [vault.address, usdg.address, bnb.address, pyth.address])
    vaultPriceFeed = await deployVaultPriceFeed()
    zlp = await deployContract("ZLP", [])

    await initVault(vault, router, usdg, vaultPriceFeed)
    zlpManager = await deployZlpManager([vault.address, usdg.address, zlp.address, ethers.constants.AddressZero, 24 * 60 * 60])

    timelock = await deployTimelock([
      wallet.address, // _admin
      10, // _buffer
      tokenManager.address, // _tokenManager
      tokenManager.address, // _mintReceiver
      zlpManager.address, // _zlpManager
      user0.address, // _rewardRouter
      expandDecimals(1000000, 18), // _maxTokenSupply
      10, // marginFeeBasisPoints
      100 // maxMarginFeeBasisPoints
    ])

    await vaultPriceFeed.setTokenConfig(bnb.address, bnbPriceFeed.address, 8, false)
    await vaultPriceFeed.setTokenConfig(btc.address, btcPriceFeed.address, 8, false)
    await vaultPriceFeed.setTokenConfig(eth.address, ethPriceFeed.address, 8, false)
    await vaultPriceFeed.setTokenConfig(dai.address, daiPriceFeed.address, 8, false)

    await daiPriceFeed.setLatestAnswer(toChainlinkPrice(1))
    await vault.setTokenConfig(...getDaiConfig(dai, daiPriceFeed))

    await btcPriceFeed.setLatestAnswer(toChainlinkPrice(60000))
    await vault.setTokenConfig(...getBtcConfig(btc, btcPriceFeed))

    await bnbPriceFeed.setLatestAnswer(toChainlinkPrice(300))
    await vault.setTokenConfig(...getBnbConfig(bnb, bnbPriceFeed))

    await zlp.setInPrivateTransferMode(true)
    await zlp.setMinter(zlpManager.address, true)
    await zlpManager.setInPrivateMode(true)

    zke = await deployContract("ZKE", []);
    esZke = await deployContract("EsZKE", []);
    bnZke = await deployContract("MintableBaseToken", ["Bonus ZKE", "bnZKE", 0]);

    // ZKE
    stakedZkeTracker = await deployContract("RewardTracker", ["Staked ZKE", "sZKE"])
    stakedZkeDistributor = await deployRewardDistributor([esZke.address, stakedZkeTracker.address])
    await stakedZkeTracker.initialize([zke.address, esZke.address], stakedZkeDistributor.address)
    await stakedZkeDistributor.updateLastDistributionTime()

    bonusZkeTracker = await deployContract("RewardTracker", ["Staked + Bonus ZKE", "sbZKE"])
    bonusZkeDistributor = await deployBonusDistributor([bnZke.address, bonusZkeTracker.address])
    await bonusZkeTracker.initialize([stakedZkeTracker.address], bonusZkeDistributor.address)
    await bonusZkeDistributor.updateLastDistributionTime()

    feeZkeTracker = await deployContract("RewardTracker", ["Staked + Bonus + Fee ZKE", "sbfZKE"])
    feeZkeDistributor = await deployRewardDistributor([eth.address, feeZkeTracker.address])
    await feeZkeTracker.initialize([bonusZkeTracker.address, bnZke.address], feeZkeDistributor.address)
    await feeZkeDistributor.updateLastDistributionTime()

    // ZLP
    feeZlpTracker = await deployContract("RewardTracker", ["Fee ZLP", "fZLP"])
    feeZlpDistributor = await deployRewardDistributor([eth.address, feeZlpTracker.address])
    await feeZlpTracker.initialize([zlp.address], feeZlpDistributor.address)
    await feeZlpDistributor.updateLastDistributionTime()

    stakedZlpTracker = await deployContract("RewardTracker", ["Fee + Staked ZLP", "fsZLP"])
    stakedZlpDistributor = await deployRewardDistributor([esZke.address, stakedZlpTracker.address])
    await stakedZlpTracker.initialize([feeZlpTracker.address], stakedZlpDistributor.address)
    await stakedZlpDistributor.updateLastDistributionTime()

    zkeVester = await deployVester([
      "Vested ZKE", // _name
      "vZKE", // _symbol
      vestingDuration, // _vestingDuration
      esZke.address, // _esToken
      feeZkeTracker.address, // _pairToken
      zke.address, // _claimableToken
      stakedZkeTracker.address, // _rewardTracker
    ])

    zlpVester = await deployVester([
      "Vested ZLP", // _name
      "vZLP", // _symbol
      vestingDuration, // _vestingDuration
      esZke.address, // _esToken
      stakedZlpTracker.address, // _pairToken
      zke.address, // _claimableToken
      stakedZlpTracker.address, // _rewardTracker
    ])

    await stakedZkeTracker.setInPrivateTransferMode(true)
    await stakedZkeTracker.setInPrivateStakingMode(true)
    await bonusZkeTracker.setInPrivateTransferMode(true)
    await bonusZkeTracker.setInPrivateStakingMode(true)
    await bonusZkeTracker.setInPrivateClaimingMode(true)
    await feeZkeTracker.setInPrivateTransferMode(true)
    await feeZkeTracker.setInPrivateStakingMode(true)

    await feeZlpTracker.setInPrivateTransferMode(true)
    await feeZlpTracker.setInPrivateStakingMode(true)
    await stakedZlpTracker.setInPrivateTransferMode(true)
    await stakedZlpTracker.setInPrivateStakingMode(true)

    await esZke.setInPrivateTransferMode(true)

    rewardRouter = await deployContract("RewardRouterV3", [])
    await rewardRouter.initialize(
      bnb.address,
      zke.address,
      esZke.address,
      bnZke.address,
      zlp.address,
      stakedZkeTracker.address,
      bonusZkeTracker.address,
      feeZkeTracker.address,
      feeZlpTracker.address,
      stakedZlpTracker.address,
      zlpManager.address,
      zkeVester.address,
      zlpVester.address,
      pyth.address
    )

    // allow bonusZkeTracker to stake stakedZkeTracker
    await stakedZkeTracker.setHandler(bonusZkeTracker.address, true)
    // allow bonusZkeTracker to stake feeZkeTracker
    await bonusZkeTracker.setHandler(feeZkeTracker.address, true)
    await bonusZkeDistributor.setBonusMultiplier(10000)
    // allow feeZkeTracker to stake bnZke
    await bnZke.setHandler(feeZkeTracker.address, true)

    // allow stakedZlpTracker to stake feeZlpTracker
    await feeZlpTracker.setHandler(stakedZlpTracker.address, true)
    // allow feeZlpTracker to stake zlp
    await zlp.setHandler(feeZlpTracker.address, true)

    // mint esZke for distributors
    await esZke.setMinter(wallet.address, true)
    await esZke.mint(stakedZkeDistributor.address, expandDecimals(50000, 18))
    await stakedZkeDistributor.setTokensPerInterval("20667989410000000") // 0.02066798941 esZke per second
    await esZke.mint(stakedZlpDistributor.address, expandDecimals(50000, 18))
    await stakedZlpDistributor.setTokensPerInterval("20667989410000000") // 0.02066798941 esZke per second

    // mint bnZke for distributor
    await bnZke.setMinter(wallet.address, true)
    await bnZke.mint(bonusZkeDistributor.address, expandDecimals(1500, 18))

    await esZke.setHandler(tokenManager.address, true)
    await zkeVester.setHandler(wallet.address, true)

    await esZke.setHandler(rewardRouter.address, true)
    await esZke.setHandler(stakedZkeDistributor.address, true)
    await esZke.setHandler(stakedZlpDistributor.address, true)
    await esZke.setHandler(stakedZkeTracker.address, true)
    await esZke.setHandler(stakedZlpTracker.address, true)
    await esZke.setHandler(zkeVester.address, true)
    await esZke.setHandler(zlpVester.address, true)

    await zlpManager.setHandler(rewardRouter.address, true)
    await stakedZkeTracker.setHandler(rewardRouter.address, true)
    await bonusZkeTracker.setHandler(rewardRouter.address, true)
    await feeZkeTracker.setHandler(rewardRouter.address, true)
    await feeZlpTracker.setHandler(rewardRouter.address, true)
    await stakedZlpTracker.setHandler(rewardRouter.address, true)

    await esZke.setHandler(rewardRouter.address, true)
    await bnZke.setMinter(rewardRouter.address, true)
    await esZke.setMinter(zkeVester.address, true)
    await esZke.setMinter(zlpVester.address, true)

    await zkeVester.setHandler(rewardRouter.address, true)
    await zlpVester.setHandler(rewardRouter.address, true)

    await feeZkeTracker.setHandler(zkeVester.address, true)
    await stakedZlpTracker.setHandler(zlpVester.address, true)

    await zlpManager.setGov(timelock.address)
    await stakedZkeTracker.setGov(timelock.address)
    await bonusZkeTracker.setGov(timelock.address)
    await feeZkeTracker.setGov(timelock.address)
    await feeZlpTracker.setGov(timelock.address)
    await stakedZlpTracker.setGov(timelock.address)
    await stakedZkeDistributor.setGov(timelock.address)
    await stakedZlpDistributor.setGov(timelock.address)
    await esZke.setGov(timelock.address)
    await bnZke.setGov(timelock.address)
    await zkeVester.setGov(timelock.address)
    await zlpVester.setGov(timelock.address)
  })

  it("inits", async () => {
    expect(await rewardRouter.isInitialized()).eq(true)

    expect(await rewardRouter.weth()).eq(bnb.address)
    expect(await rewardRouter.zke()).eq(zke.address)
    expect(await rewardRouter.esZke()).eq(esZke.address)
    expect(await rewardRouter.bnZke()).eq(bnZke.address)

    expect(await rewardRouter.zlp()).eq(zlp.address)

    expect(await rewardRouter.stakedZkeTracker()).eq(stakedZkeTracker.address)
    expect(await rewardRouter.bonusZkeTracker()).eq(bonusZkeTracker.address)
    expect(await rewardRouter.feeZkeTracker()).eq(feeZkeTracker.address)

    expect(await rewardRouter.feeZlpTracker()).eq(feeZlpTracker.address)
    expect(await rewardRouter.stakedZlpTracker()).eq(stakedZlpTracker.address)

    expect(await rewardRouter.zlpManager()).eq(zlpManager.address)

    expect(await rewardRouter.zkeVester()).eq(zkeVester.address)
    expect(await rewardRouter.zlpVester()).eq(zlpVester.address)

    await expect(rewardRouter.initialize(
      bnb.address,
      zke.address,
      esZke.address,
      bnZke.address,
      zlp.address,
      stakedZkeTracker.address,
      bonusZkeTracker.address,
      feeZkeTracker.address,
      feeZlpTracker.address,
      stakedZlpTracker.address,
      zlpManager.address,
      zkeVester.address,
      zlpVester.address,
      pyth.address
    )).to.be.revertedWith("RewardRouter: already initialized")
  })

  it("stakeZkeForAccount, stakeZke, stakeEsZke, unstakeZke, unstakeEsZke, claimEsZke, claimFees, compound, batchCompoundForAccounts", async () => {
    await eth.mint(feeZkeDistributor.address, expandDecimals(100, 18))
    await feeZkeDistributor.setTokensPerInterval("41335970000000") // 0.00004133597 ETH per second

    await zke.setMinter(wallet.address, true)
    await zke.mint(user0.address, expandDecimals(1500, 18))
    expect(await zke.balanceOf(user0.address)).eq(expandDecimals(1500, 18))

    await zke.connect(user0).approve(stakedZkeTracker.address, expandDecimals(1000, 18))
    await expect(rewardRouter.connect(user0).stakeZkeForAccount(user1.address, expandDecimals(1000, 18)))
      .to.be.revertedWith("Governable: forbidden")

    await rewardRouter.setGov(user0.address)
    await rewardRouter.connect(user0).stakeZkeForAccount(user1.address, expandDecimals(800, 18))
    expect(await zke.balanceOf(user0.address)).eq(expandDecimals(700, 18))

    await zke.mint(user1.address, expandDecimals(200, 18))
    expect(await zke.balanceOf(user1.address)).eq(expandDecimals(200, 18))
    await zke.connect(user1).approve(stakedZkeTracker.address, expandDecimals(200, 18))
    await rewardRouter.connect(user1).stakeZke(expandDecimals(200, 18))
    expect(await zke.balanceOf(user1.address)).eq(0)

    expect(await stakedZkeTracker.stakedAmounts(user0.address)).eq(0)
    expect(await stakedZkeTracker.depositBalances(user0.address, zke.address)).eq(0)
    expect(await stakedZkeTracker.stakedAmounts(user1.address)).eq(expandDecimals(1000, 18))
    expect(await stakedZkeTracker.depositBalances(user1.address, zke.address)).eq(expandDecimals(1000, 18))

    expect(await bonusZkeTracker.stakedAmounts(user0.address)).eq(0)
    expect(await bonusZkeTracker.depositBalances(user0.address, stakedZkeTracker.address)).eq(0)
    expect(await bonusZkeTracker.stakedAmounts(user1.address)).eq(expandDecimals(1000, 18))
    expect(await bonusZkeTracker.depositBalances(user1.address, stakedZkeTracker.address)).eq(expandDecimals(1000, 18))

    expect(await feeZkeTracker.stakedAmounts(user0.address)).eq(0)
    expect(await feeZkeTracker.depositBalances(user0.address, bonusZkeTracker.address)).eq(0)
    expect(await feeZkeTracker.stakedAmounts(user1.address)).eq(expandDecimals(1000, 18))
    expect(await feeZkeTracker.depositBalances(user1.address, bonusZkeTracker.address)).eq(expandDecimals(1000, 18))

    await increaseTime(provider, 24 * 60 * 60)
    await mineBlock(provider)

    expect(await stakedZkeTracker.claimable(user0.address)).eq(0)
    expect(await stakedZkeTracker.claimable(user1.address)).gt(expandDecimals(1785, 18)) // 50000 / 28 => ~1785
    expect(await stakedZkeTracker.claimable(user1.address)).lt(expandDecimals(1786, 18))

    expect(await bonusZkeTracker.claimable(user0.address)).eq(0)
    expect(await bonusZkeTracker.claimable(user1.address)).gt("2730000000000000000") // 2.73, 1000 / 365 => ~2.74
    expect(await bonusZkeTracker.claimable(user1.address)).lt("2750000000000000000") // 2.75

    expect(await feeZkeTracker.claimable(user0.address)).eq(0)
    expect(await feeZkeTracker.claimable(user1.address)).gt("3560000000000000000") // 3.56, 100 / 28 => ~3.57
    expect(await feeZkeTracker.claimable(user1.address)).lt("3580000000000000000") // 3.58

    await timelock.signalMint(esZke.address, tokenManager.address, expandDecimals(500, 18))
    await increaseTime(provider, 20)
    await mineBlock(provider)

    await timelock.processMint(esZke.address, tokenManager.address, expandDecimals(500, 18))
    await esZke.connect(tokenManager).transferFrom(tokenManager.address, user2.address, expandDecimals(500, 18))
    await rewardRouter.connect(user2).stakeEsZke(expandDecimals(500, 18))

    expect(await stakedZkeTracker.stakedAmounts(user0.address)).eq(0)
    expect(await stakedZkeTracker.depositBalances(user0.address, zke.address)).eq(0)
    expect(await stakedZkeTracker.stakedAmounts(user1.address)).eq(expandDecimals(1000, 18))
    expect(await stakedZkeTracker.depositBalances(user1.address, zke.address)).eq(expandDecimals(1000, 18))
    expect(await stakedZkeTracker.stakedAmounts(user2.address)).eq(expandDecimals(500, 18))
    expect(await stakedZkeTracker.depositBalances(user2.address, esZke.address)).eq(expandDecimals(500, 18))

    expect(await bonusZkeTracker.stakedAmounts(user0.address)).eq(0)
    expect(await bonusZkeTracker.depositBalances(user0.address, stakedZkeTracker.address)).eq(0)
    expect(await bonusZkeTracker.stakedAmounts(user1.address)).eq(expandDecimals(1000, 18))
    expect(await bonusZkeTracker.depositBalances(user1.address, stakedZkeTracker.address)).eq(expandDecimals(1000, 18))
    expect(await bonusZkeTracker.stakedAmounts(user2.address)).eq(expandDecimals(500, 18))
    expect(await bonusZkeTracker.depositBalances(user2.address, stakedZkeTracker.address)).eq(expandDecimals(500, 18))

    expect(await feeZkeTracker.stakedAmounts(user0.address)).eq(0)
    expect(await feeZkeTracker.depositBalances(user0.address, bonusZkeTracker.address)).eq(0)
    expect(await feeZkeTracker.stakedAmounts(user1.address)).eq(expandDecimals(1000, 18))
    expect(await feeZkeTracker.depositBalances(user1.address, bonusZkeTracker.address)).eq(expandDecimals(1000, 18))
    expect(await feeZkeTracker.stakedAmounts(user2.address)).eq(expandDecimals(500, 18))
    expect(await feeZkeTracker.depositBalances(user2.address, bonusZkeTracker.address)).eq(expandDecimals(500, 18))

    await increaseTime(provider, 24 * 60 * 60)
    await mineBlock(provider)

    expect(await stakedZkeTracker.claimable(user0.address)).eq(0)
    expect(await stakedZkeTracker.claimable(user1.address)).gt(expandDecimals(1785 + 1190, 18))
    expect(await stakedZkeTracker.claimable(user1.address)).lt(expandDecimals(1786 + 1191, 18))
    expect(await stakedZkeTracker.claimable(user2.address)).gt(expandDecimals(595, 18))
    expect(await stakedZkeTracker.claimable(user2.address)).lt(expandDecimals(596, 18))

    expect(await bonusZkeTracker.claimable(user0.address)).eq(0)
    expect(await bonusZkeTracker.claimable(user1.address)).gt("5470000000000000000") // 5.47, 1000 / 365 * 2 => ~5.48
    expect(await bonusZkeTracker.claimable(user1.address)).lt("5490000000000000000")
    expect(await bonusZkeTracker.claimable(user2.address)).gt("1360000000000000000") // 1.36, 500 / 365 => ~1.37
    expect(await bonusZkeTracker.claimable(user2.address)).lt("1380000000000000000")

    expect(await feeZkeTracker.claimable(user0.address)).eq(0)
    expect(await feeZkeTracker.claimable(user1.address)).gt("5940000000000000000") // 5.94, 3.57 + 100 / 28 / 3 * 2 => ~5.95
    expect(await feeZkeTracker.claimable(user1.address)).lt("5960000000000000000")
    expect(await feeZkeTracker.claimable(user2.address)).gt("1180000000000000000") // 1.18, 100 / 28 / 3 => ~1.19
    expect(await feeZkeTracker.claimable(user2.address)).lt("1200000000000000000")

    expect(await esZke.balanceOf(user1.address)).eq(0)
    await rewardRouter.connect(user1).claimEsZke()
    expect(await esZke.balanceOf(user1.address)).gt(expandDecimals(1785 + 1190, 18))
    expect(await esZke.balanceOf(user1.address)).lt(expandDecimals(1786 + 1191, 18))

    expect(await eth.balanceOf(user1.address)).eq(0)
    await rewardRouter.connect(user1).claimFees()
    expect(await eth.balanceOf(user1.address)).gt("5940000000000000000")
    expect(await eth.balanceOf(user1.address)).lt("5960000000000000000")

    expect(await esZke.balanceOf(user2.address)).eq(0)
    await rewardRouter.connect(user2).claimEsZke()
    expect(await esZke.balanceOf(user2.address)).gt(expandDecimals(595, 18))
    expect(await esZke.balanceOf(user2.address)).lt(expandDecimals(596, 18))

    expect(await eth.balanceOf(user2.address)).eq(0)
    await rewardRouter.connect(user2).claimFees()
    expect(await eth.balanceOf(user2.address)).gt("1180000000000000000")
    expect(await eth.balanceOf(user2.address)).lt("1200000000000000000")

    await increaseTime(provider, 24 * 60 * 60)
    await mineBlock(provider)

    const tx0 = await rewardRouter.connect(user1).compound()
    await reportGasUsed(provider, tx0, "compound gas used")

    await increaseTime(provider, 24 * 60 * 60)
    await mineBlock(provider)

    const tx1 = await rewardRouter.connect(user0).batchCompoundForAccounts([user1.address, user2.address])
    await reportGasUsed(provider, tx1, "batchCompoundForAccounts gas used")

    expect(await stakedZkeTracker.stakedAmounts(user1.address)).gt(expandDecimals(3643, 18))
    expect(await stakedZkeTracker.stakedAmounts(user1.address)).lt(expandDecimals(3645, 18))
    expect(await stakedZkeTracker.depositBalances(user1.address, zke.address)).eq(expandDecimals(1000, 18))
    expect(await stakedZkeTracker.depositBalances(user1.address, esZke.address)).gt(expandDecimals(2643, 18))
    expect(await stakedZkeTracker.depositBalances(user1.address, esZke.address)).lt(expandDecimals(2645, 18))

    expect(await bonusZkeTracker.stakedAmounts(user1.address)).gt(expandDecimals(3643, 18))
    expect(await bonusZkeTracker.stakedAmounts(user1.address)).lt(expandDecimals(3645, 18))

    expect(await feeZkeTracker.stakedAmounts(user1.address)).gt(expandDecimals(3657, 18))
    expect(await feeZkeTracker.stakedAmounts(user1.address)).lt(expandDecimals(3659, 18))
    expect(await feeZkeTracker.depositBalances(user1.address, bonusZkeTracker.address)).gt(expandDecimals(3643, 18))
    expect(await feeZkeTracker.depositBalances(user1.address, bonusZkeTracker.address)).lt(expandDecimals(3645, 18))
    expect(await feeZkeTracker.depositBalances(user1.address, bnZke.address)).gt("14100000000000000000") // 14.1
    expect(await feeZkeTracker.depositBalances(user1.address, bnZke.address)).lt("14300000000000000000") // 14.3

    expect(await zke.balanceOf(user1.address)).eq(0)
    await rewardRouter.connect(user1).unstakeZke(expandDecimals(300, 18))
    expect(await zke.balanceOf(user1.address)).eq(expandDecimals(300, 18))

    expect(await stakedZkeTracker.stakedAmounts(user1.address)).gt(expandDecimals(3343, 18))
    expect(await stakedZkeTracker.stakedAmounts(user1.address)).lt(expandDecimals(3345, 18))
    expect(await stakedZkeTracker.depositBalances(user1.address, zke.address)).eq(expandDecimals(700, 18))
    expect(await stakedZkeTracker.depositBalances(user1.address, esZke.address)).gt(expandDecimals(2643, 18))
    expect(await stakedZkeTracker.depositBalances(user1.address, esZke.address)).lt(expandDecimals(2645, 18))

    expect(await bonusZkeTracker.stakedAmounts(user1.address)).gt(expandDecimals(3343, 18))
    expect(await bonusZkeTracker.stakedAmounts(user1.address)).lt(expandDecimals(3345, 18))

    expect(await feeZkeTracker.stakedAmounts(user1.address)).gt(expandDecimals(3357, 18))
    expect(await feeZkeTracker.stakedAmounts(user1.address)).lt(expandDecimals(3359, 18))
    expect(await feeZkeTracker.depositBalances(user1.address, bonusZkeTracker.address)).gt(expandDecimals(3343, 18))
    expect(await feeZkeTracker.depositBalances(user1.address, bonusZkeTracker.address)).lt(expandDecimals(3345, 18))
    expect(await feeZkeTracker.depositBalances(user1.address, bnZke.address)).gt("13000000000000000000") // 13
    expect(await feeZkeTracker.depositBalances(user1.address, bnZke.address)).lt("13100000000000000000") // 13.1

    const esZkeBalance1 = await esZke.balanceOf(user1.address)
    const esZkeUnstakeBalance1 = await stakedZkeTracker.depositBalances(user1.address, esZke.address)
    await rewardRouter.connect(user1).unstakeEsZke(esZkeUnstakeBalance1)
    expect(await esZke.balanceOf(user1.address)).eq(esZkeBalance1.add(esZkeUnstakeBalance1))

    expect(await stakedZkeTracker.stakedAmounts(user1.address)).eq(expandDecimals(700, 18))
    expect(await stakedZkeTracker.depositBalances(user1.address, zke.address)).eq(expandDecimals(700, 18))
    expect(await stakedZkeTracker.depositBalances(user1.address, esZke.address)).eq(0)

    expect(await bonusZkeTracker.stakedAmounts(user1.address)).eq(expandDecimals(700, 18))

    expect(await feeZkeTracker.stakedAmounts(user1.address)).gt(expandDecimals(702, 18))
    expect(await feeZkeTracker.stakedAmounts(user1.address)).lt(expandDecimals(703, 18))
    expect(await feeZkeTracker.depositBalances(user1.address, bonusZkeTracker.address)).eq(expandDecimals(700, 18))
    expect(await feeZkeTracker.depositBalances(user1.address, bnZke.address)).gt("2720000000000000000") // 2.72
    expect(await feeZkeTracker.depositBalances(user1.address, bnZke.address)).lt("2740000000000000000") // 2.74

    await expect(rewardRouter.connect(user1).unstakeEsZke(expandDecimals(1, 18)))
      .to.be.revertedWith("RewardTracker: _amount exceeds depositBalance")
  })

  it("mintAndStakeZlp, unstakeAndRedeemZlp, compound, batchCompoundForAccounts", async () => {
    await eth.mint(feeZlpDistributor.address, expandDecimals(100, 18))
    await feeZlpDistributor.setTokensPerInterval("41335970000000") // 0.00004133597 ETH per second

    await bnb.mint(user1.address, expandDecimals(1, 18))
    await bnb.connect(user1).approve(zlpManager.address, expandDecimals(1, 18))
    const tx0 = await rewardRouter.connect(user1).mintAndStakeZlp(
      bnb.address,
      expandDecimals(1, 18),
      expandDecimals(299, 18),
      expandDecimals(299, 18),
      [randomBytes(1)],{value:expandDecimals(1,1)}
    )
    await reportGasUsed(provider, tx0, "mintAndStakeZlp gas used")

    expect(await feeZlpTracker.stakedAmounts(user1.address)).eq(expandDecimals(2991, 17))
    expect(await feeZlpTracker.depositBalances(user1.address, zlp.address)).eq(expandDecimals(2991, 17))

    expect(await stakedZlpTracker.stakedAmounts(user1.address)).eq(expandDecimals(2991, 17))
    expect(await stakedZlpTracker.depositBalances(user1.address, feeZlpTracker.address)).eq(expandDecimals(2991, 17))

    await bnb.mint(user1.address, expandDecimals(2, 18))
    await bnb.connect(user1).approve(zlpManager.address, expandDecimals(2, 18))
    await rewardRouter.connect(user1).mintAndStakeZlp(
      bnb.address,
      expandDecimals(2, 18),
      expandDecimals(299, 18),
      expandDecimals(299, 18),
      [randomBytes(1)],{value:expandDecimals(1,1)}
    )

    await increaseTime(provider, 24 * 60 * 60 + 1)
    await mineBlock(provider)

    expect(await feeZlpTracker.claimable(user1.address)).gt("3560000000000000000") // 3.56, 100 / 28 => ~3.57
    expect(await feeZlpTracker.claimable(user1.address)).lt("3580000000000000000") // 3.58

    expect(await stakedZlpTracker.claimable(user1.address)).gt(expandDecimals(1785, 18)) // 50000 / 28 => ~1785
    expect(await stakedZlpTracker.claimable(user1.address)).lt(expandDecimals(1786, 18))

    await bnb.mint(user2.address, expandDecimals(1, 18))
    await bnb.connect(user2).approve(zlpManager.address, expandDecimals(1, 18))
    await rewardRouter.connect(user2).mintAndStakeZlp(
      bnb.address,
      expandDecimals(1, 18),
      expandDecimals(299, 18),
      expandDecimals(299, 18),
      [randomBytes(1)],{value:expandDecimals(1,1)}
    )

    await expect(rewardRouter.connect(user2).unstakeAndRedeemZlp(
      bnb.address,
      expandDecimals(299, 18),
      "990000000000000000", // 0.99
      user2.address,
      [randomBytes(1)],{value:expandDecimals(1,1)}
    )).to.be.revertedWith("ZlpManager: cooldown duration not yet passed")

    expect(await feeZlpTracker.stakedAmounts(user1.address)).eq("897300000000000000000") // 897.3
    expect(await stakedZlpTracker.stakedAmounts(user1.address)).eq("897300000000000000000")
    expect(await bnb.balanceOf(user1.address)).eq(0)

    const tx1 = await rewardRouter.connect(user1).unstakeAndRedeemZlp(
      bnb.address,
      expandDecimals(299, 18),
      "990000000000000000", // 0.99
      user1.address,
      [randomBytes(1)],{value:expandDecimals(1,1)}
    )
    await reportGasUsed(provider, tx1, "unstakeAndRedeemZlp gas used")

    expect(await feeZlpTracker.stakedAmounts(user1.address)).eq("598300000000000000000") // 598.3
    expect(await stakedZlpTracker.stakedAmounts(user1.address)).eq("598300000000000000000")
    expect(await bnb.balanceOf(user1.address)).eq("993676666666666666") // ~0.99

    await increaseTime(provider, 24 * 60 * 60)
    await mineBlock(provider)

    expect(await feeZlpTracker.claimable(user1.address)).gt("5940000000000000000") // 5.94, 3.57 + 100 / 28 / 3 * 2 => ~5.95
    expect(await feeZlpTracker.claimable(user1.address)).lt("5960000000000000000")
    expect(await feeZlpTracker.claimable(user2.address)).gt("1180000000000000000") // 1.18, 100 / 28 / 3 => ~1.19
    expect(await feeZlpTracker.claimable(user2.address)).lt("1200000000000000000")

    expect(await stakedZlpTracker.claimable(user1.address)).gt(expandDecimals(1785 + 1190, 18))
    expect(await stakedZlpTracker.claimable(user1.address)).lt(expandDecimals(1786 + 1191, 18))
    expect(await stakedZlpTracker.claimable(user2.address)).gt(expandDecimals(595, 18))
    expect(await stakedZlpTracker.claimable(user2.address)).lt(expandDecimals(596, 18))

    expect(await esZke.balanceOf(user1.address)).eq(0)
    await rewardRouter.connect(user1).claimEsZke()
    expect(await esZke.balanceOf(user1.address)).gt(expandDecimals(1785 + 1190, 18))
    expect(await esZke.balanceOf(user1.address)).lt(expandDecimals(1786 + 1191, 18))

    expect(await eth.balanceOf(user1.address)).eq(0)
    await rewardRouter.connect(user1).claimFees()
    expect(await eth.balanceOf(user1.address)).gt("5940000000000000000")
    expect(await eth.balanceOf(user1.address)).lt("5960000000000000000")

    expect(await esZke.balanceOf(user2.address)).eq(0)
    await rewardRouter.connect(user2).claimEsZke()
    expect(await esZke.balanceOf(user2.address)).gt(expandDecimals(595, 18))
    expect(await esZke.balanceOf(user2.address)).lt(expandDecimals(596, 18))

    expect(await eth.balanceOf(user2.address)).eq(0)
    await rewardRouter.connect(user2).claimFees()
    expect(await eth.balanceOf(user2.address)).gt("1180000000000000000")
    expect(await eth.balanceOf(user2.address)).lt("1200000000000000000")

    await increaseTime(provider, 24 * 60 * 60)
    await mineBlock(provider)

    const tx2 = await rewardRouter.connect(user1).compound()
    await reportGasUsed(provider, tx2, "compound gas used")

    await increaseTime(provider, 24 * 60 * 60)
    await mineBlock(provider)

    const tx3 = await rewardRouter.batchCompoundForAccounts([user1.address, user2.address])
    await reportGasUsed(provider, tx1, "batchCompoundForAccounts gas used")

    expect(await stakedZkeTracker.stakedAmounts(user1.address)).gt(expandDecimals(4165, 18))
    expect(await stakedZkeTracker.stakedAmounts(user1.address)).lt(expandDecimals(4167, 18))
    expect(await stakedZkeTracker.depositBalances(user1.address, zke.address)).eq(0)
    expect(await stakedZkeTracker.depositBalances(user1.address, esZke.address)).gt(expandDecimals(4165, 18))
    expect(await stakedZkeTracker.depositBalances(user1.address, esZke.address)).lt(expandDecimals(4167, 18))

    expect(await bonusZkeTracker.stakedAmounts(user1.address)).gt(expandDecimals(4165, 18))
    expect(await bonusZkeTracker.stakedAmounts(user1.address)).lt(expandDecimals(4167, 18))

    expect(await feeZkeTracker.stakedAmounts(user1.address)).gt(expandDecimals(4179, 18))
    expect(await feeZkeTracker.stakedAmounts(user1.address)).lt(expandDecimals(4180, 18))
    expect(await feeZkeTracker.depositBalances(user1.address, bonusZkeTracker.address)).gt(expandDecimals(4165, 18))
    expect(await feeZkeTracker.depositBalances(user1.address, bonusZkeTracker.address)).lt(expandDecimals(4167, 18))
    expect(await feeZkeTracker.depositBalances(user1.address, bnZke.address)).gt("12900000000000000000") // 12.9
    expect(await feeZkeTracker.depositBalances(user1.address, bnZke.address)).lt("13100000000000000000") // 13.1

    expect(await feeZlpTracker.stakedAmounts(user1.address)).eq("598300000000000000000") // 598.3
    expect(await stakedZlpTracker.stakedAmounts(user1.address)).eq("598300000000000000000")
    expect(await bnb.balanceOf(user1.address)).eq("993676666666666666") // ~0.99
  })

  it("mintAndStakeZlpETH, unstakeAndRedeemZlpETH", async () => {
    const receiver0 = newWallet()
    await expect(rewardRouter.connect(user0).mintAndStakeZlpETH(expandDecimals(300, 18), expandDecimals(300, 18), { value: 0 }))
      .to.be.revertedWith("RewardRouter: invalid msg.value")

    await expect(rewardRouter.connect(user0).mintAndStakeZlpETH(expandDecimals(300, 18), expandDecimals(300, 18), { value: expandDecimals(1, 18) }))
      .to.be.revertedWith("ZlpManager: insufficient USDG output")

    await expect(rewardRouter.connect(user0).mintAndStakeZlpETH(expandDecimals(299, 18), expandDecimals(300, 18), { value: expandDecimals(1, 18) }))
      .to.be.revertedWith("ZlpManager: insufficient ZLP output")

    expect(await bnb.balanceOf(user0.address)).eq(0)
    expect(await bnb.balanceOf(vault.address)).eq(0)
    expect(await bnb.totalSupply()).eq(0)
    expect(await provider.getBalance(bnb.address)).eq(0)
    expect(await stakedZlpTracker.balanceOf(user0.address)).eq(0)

    await rewardRouter.connect(user0).mintAndStakeZlpETH(expandDecimals(299, 18), expandDecimals(299, 18), { value: expandDecimals(1, 18) })

    expect(await bnb.balanceOf(user0.address)).eq(0)
    expect(await bnb.balanceOf(vault.address)).eq(expandDecimals(1, 18))
    expect(await provider.getBalance(bnb.address)).eq(expandDecimals(1, 18))
    expect(await bnb.totalSupply()).eq(expandDecimals(1, 18))
    expect(await stakedZlpTracker.balanceOf(user0.address)).eq("299100000000000000000") // 299.1

    await expect(rewardRouter.connect(user0).unstakeAndRedeemZlpETH(expandDecimals(300, 18), expandDecimals(1, 18), receiver0.address))
      .to.be.revertedWith("RewardTracker: _amount exceeds stakedAmount")

    await expect(rewardRouter.connect(user0).unstakeAndRedeemZlpETH("299100000000000000000", expandDecimals(1, 18), receiver0.address))
      .to.be.revertedWith("ZlpManager: cooldown duration not yet passed")

    await increaseTime(provider, 24 * 60 * 60 + 10)

    await expect(rewardRouter.connect(user0).unstakeAndRedeemZlpETH("299100000000000000000", expandDecimals(1, 18), receiver0.address))
      .to.be.revertedWith("ZlpManager: insufficient output")

    await rewardRouter.connect(user0).unstakeAndRedeemZlpETH("299100000000000000000", "990000000000000000", receiver0.address)
    expect(await provider.getBalance(receiver0.address)).eq("994009000000000000") // 0.994009
    expect(await bnb.balanceOf(vault.address)).eq("5991000000000000") // 0.005991
    expect(await provider.getBalance(bnb.address)).eq("5991000000000000")
    expect(await bnb.totalSupply()).eq("5991000000000000")
  })

  it("zke: signalTransfer, acceptTransfer", async () =>{
    await zke.setMinter(wallet.address, true)
    await zke.mint(user1.address, expandDecimals(200, 18))
    expect(await zke.balanceOf(user1.address)).eq(expandDecimals(200, 18))
    await zke.connect(user1).approve(stakedZkeTracker.address, expandDecimals(200, 18))
    await rewardRouter.connect(user1).stakeZke(expandDecimals(200, 18))
    expect(await zke.balanceOf(user1.address)).eq(0)

    await zke.mint(user2.address, expandDecimals(200, 18))
    expect(await zke.balanceOf(user2.address)).eq(expandDecimals(200, 18))
    await zke.connect(user2).approve(stakedZkeTracker.address, expandDecimals(400, 18))
    await rewardRouter.connect(user2).stakeZke(expandDecimals(200, 18))
    expect(await zke.balanceOf(user2.address)).eq(0)

    await rewardRouter.connect(user2).signalTransfer(user1.address)

    await increaseTime(provider, 24 * 60 * 60)
    await mineBlock(provider)

    await rewardRouter.connect(user2).signalTransfer(user1.address)
    await rewardRouter.connect(user1).claim()

    await expect(rewardRouter.connect(user2).signalTransfer(user1.address))
      .to.be.revertedWith("RewardRouter: stakedZkeTracker.averageStakedAmounts > 0")

    await rewardRouter.connect(user2).signalTransfer(user3.address)

    await expect(rewardRouter.connect(user3).acceptTransfer(user1.address))
      .to.be.revertedWith("RewardRouter: transfer not signalled")

    await zkeVester.setBonusRewards(user2.address, expandDecimals(100, 18))

    expect(await stakedZkeTracker.depositBalances(user2.address, zke.address)).eq(expandDecimals(200, 18))
    expect(await stakedZkeTracker.depositBalances(user2.address, esZke.address)).eq(0)
    expect(await feeZkeTracker.depositBalances(user2.address, bnZke.address)).eq(0)
    expect(await stakedZkeTracker.depositBalances(user3.address, zke.address)).eq(0)
    expect(await stakedZkeTracker.depositBalances(user3.address, esZke.address)).eq(0)
    expect(await feeZkeTracker.depositBalances(user3.address, bnZke.address)).eq(0)
    expect(await zkeVester.transferredAverageStakedAmounts(user3.address)).eq(0)
    expect(await zkeVester.transferredCumulativeRewards(user3.address)).eq(0)
    expect(await zkeVester.bonusRewards(user2.address)).eq(expandDecimals(100, 18))
    expect(await zkeVester.bonusRewards(user3.address)).eq(0)
    expect(await zkeVester.getCombinedAverageStakedAmount(user2.address)).eq(0)
    expect(await zkeVester.getCombinedAverageStakedAmount(user3.address)).eq(0)
    expect(await zkeVester.getMaxVestableAmount(user2.address)).eq(expandDecimals(100, 18))
    expect(await zkeVester.getMaxVestableAmount(user3.address)).eq(0)
    expect(await zkeVester.getPairAmount(user2.address, expandDecimals(892, 18))).eq(0)
    expect(await zkeVester.getPairAmount(user3.address, expandDecimals(892, 18))).eq(0)

    await rewardRouter.connect(user3).acceptTransfer(user2.address)

    expect(await stakedZkeTracker.depositBalances(user2.address, zke.address)).eq(0)
    expect(await stakedZkeTracker.depositBalances(user2.address, esZke.address)).eq(0)
    expect(await feeZkeTracker.depositBalances(user2.address, bnZke.address)).eq(0)
    expect(await stakedZkeTracker.depositBalances(user3.address, zke.address)).eq(expandDecimals(200, 18))
    expect(await stakedZkeTracker.depositBalances(user3.address, esZke.address)).gt(expandDecimals(892, 18))
    expect(await stakedZkeTracker.depositBalances(user3.address, esZke.address)).lt(expandDecimals(893, 18))
    expect(await feeZkeTracker.depositBalances(user3.address, bnZke.address)).gt("547000000000000000") // 0.547
    expect(await feeZkeTracker.depositBalances(user3.address, bnZke.address)).lt("549000000000000000") // 0.548
    expect(await zkeVester.transferredAverageStakedAmounts(user3.address)).eq(expandDecimals(200, 18))
    expect(await zkeVester.transferredCumulativeRewards(user3.address)).gt(expandDecimals(892, 18))
    expect(await zkeVester.transferredCumulativeRewards(user3.address)).lt(expandDecimals(893, 18))
    expect(await zkeVester.bonusRewards(user2.address)).eq(0)
    expect(await zkeVester.bonusRewards(user3.address)).eq(expandDecimals(100, 18))
    expect(await zkeVester.getCombinedAverageStakedAmount(user2.address)).eq(expandDecimals(200, 18))
    expect(await zkeVester.getCombinedAverageStakedAmount(user3.address)).eq(expandDecimals(200, 18))
    expect(await zkeVester.getMaxVestableAmount(user2.address)).eq(0)
    expect(await zkeVester.getMaxVestableAmount(user3.address)).gt(expandDecimals(992, 18))
    expect(await zkeVester.getMaxVestableAmount(user3.address)).lt(expandDecimals(993, 18))
    expect(await zkeVester.getPairAmount(user2.address, expandDecimals(992, 18))).eq(0)
    expect(await zkeVester.getPairAmount(user3.address, expandDecimals(992, 18))).gt(expandDecimals(199, 18))
    expect(await zkeVester.getPairAmount(user3.address, expandDecimals(992, 18))).lt(expandDecimals(200, 18))

    await zke.connect(user3).approve(stakedZkeTracker.address, expandDecimals(400, 18))
    await rewardRouter.connect(user3).signalTransfer(user4.address)
    await rewardRouter.connect(user4).acceptTransfer(user3.address)

    expect(await stakedZkeTracker.depositBalances(user3.address, zke.address)).eq(0)
    expect(await stakedZkeTracker.depositBalances(user3.address, esZke.address)).eq(0)
    expect(await feeZkeTracker.depositBalances(user3.address, bnZke.address)).eq(0)
    expect(await stakedZkeTracker.depositBalances(user4.address, zke.address)).eq(expandDecimals(200, 18))
    expect(await stakedZkeTracker.depositBalances(user4.address, esZke.address)).gt(expandDecimals(892, 18))
    expect(await stakedZkeTracker.depositBalances(user4.address, esZke.address)).lt(expandDecimals(893, 18))
    expect(await feeZkeTracker.depositBalances(user4.address, bnZke.address)).gt("547000000000000000") // 0.547
    expect(await feeZkeTracker.depositBalances(user4.address, bnZke.address)).lt("549000000000000000") // 0.548
    expect(await zkeVester.transferredAverageStakedAmounts(user4.address)).gt(expandDecimals(200, 18))
    expect(await zkeVester.transferredAverageStakedAmounts(user4.address)).lt(expandDecimals(201, 18))
    expect(await zkeVester.transferredCumulativeRewards(user4.address)).gt(expandDecimals(892, 18))
    expect(await zkeVester.transferredCumulativeRewards(user4.address)).lt(expandDecimals(894, 18))
    expect(await zkeVester.bonusRewards(user3.address)).eq(0)
    expect(await zkeVester.bonusRewards(user4.address)).eq(expandDecimals(100, 18))
    expect(await stakedZkeTracker.averageStakedAmounts(user3.address)).gt(expandDecimals(1092, 18))
    expect(await stakedZkeTracker.averageStakedAmounts(user3.address)).lt(expandDecimals(1094, 18))
    expect(await zkeVester.transferredAverageStakedAmounts(user3.address)).eq(0)
    expect(await zkeVester.getCombinedAverageStakedAmount(user3.address)).gt(expandDecimals(1092, 18))
    expect(await zkeVester.getCombinedAverageStakedAmount(user3.address)).lt(expandDecimals(1094, 18))
    expect(await zkeVester.getCombinedAverageStakedAmount(user4.address)).gt(expandDecimals(200, 18))
    expect(await zkeVester.getCombinedAverageStakedAmount(user4.address)).lt(expandDecimals(201, 18))
    expect(await zkeVester.getMaxVestableAmount(user3.address)).eq(0)
    expect(await zkeVester.getMaxVestableAmount(user4.address)).gt(expandDecimals(992, 18))
    expect(await zkeVester.getMaxVestableAmount(user4.address)).lt(expandDecimals(993, 18))
    expect(await zkeVester.getPairAmount(user3.address, expandDecimals(992, 18))).eq(0)
    expect(await zkeVester.getPairAmount(user4.address, expandDecimals(992, 18))).gt(expandDecimals(199, 18))
    expect(await zkeVester.getPairAmount(user4.address, expandDecimals(992, 18))).lt(expandDecimals(200, 18))

    await expect(rewardRouter.connect(user4).acceptTransfer(user3.address))
      .to.be.revertedWith("RewardRouter: transfer not signalled")
  })

  it("zke, zlp: signalTransfer, acceptTransfer", async () =>{
    await zke.setMinter(wallet.address, true)
    await zke.mint(zkeVester.address, expandDecimals(10000, 18))
    await zke.mint(zlpVester.address, expandDecimals(10000, 18))
    await eth.mint(feeZlpDistributor.address, expandDecimals(100, 18))
    await feeZlpDistributor.setTokensPerInterval("41335970000000") // 0.00004133597 ETH per second

    await bnb.mint(user1.address, expandDecimals(1, 18))
    await bnb.connect(user1).approve(zlpManager.address, expandDecimals(1, 18))
    await rewardRouter.connect(user1).mintAndStakeZlp(
      bnb.address,
      expandDecimals(1, 18),
      expandDecimals(299, 18),
      expandDecimals(299, 18),
      [randomBytes(1)],{value:expandDecimals(1,1)}
    )

    await bnb.mint(user2.address, expandDecimals(1, 18))
    await bnb.connect(user2).approve(zlpManager.address, expandDecimals(1, 18))
    await rewardRouter.connect(user2).mintAndStakeZlp(
      bnb.address,
      expandDecimals(1, 18),
      expandDecimals(299, 18),
      expandDecimals(299, 18),
      [randomBytes(1)],{value:expandDecimals(1,1)}
    )

    await zke.mint(user1.address, expandDecimals(200, 18))
    expect(await zke.balanceOf(user1.address)).eq(expandDecimals(200, 18))
    await zke.connect(user1).approve(stakedZkeTracker.address, expandDecimals(200, 18))
    await rewardRouter.connect(user1).stakeZke(expandDecimals(200, 18))
    expect(await zke.balanceOf(user1.address)).eq(0)

    await zke.mint(user2.address, expandDecimals(200, 18))
    expect(await zke.balanceOf(user2.address)).eq(expandDecimals(200, 18))
    await zke.connect(user2).approve(stakedZkeTracker.address, expandDecimals(400, 18))
    await rewardRouter.connect(user2).stakeZke(expandDecimals(200, 18))
    expect(await zke.balanceOf(user2.address)).eq(0)

    await rewardRouter.connect(user2).signalTransfer(user1.address)

    await increaseTime(provider, 24 * 60 * 60)
    await mineBlock(provider)

    await rewardRouter.connect(user2).signalTransfer(user1.address)
    await rewardRouter.connect(user1).compound()

    await expect(rewardRouter.connect(user2).signalTransfer(user1.address))
      .to.be.revertedWith("RewardRouter: stakedZkeTracker.averageStakedAmounts > 0")

    await rewardRouter.connect(user2).signalTransfer(user3.address)

    await expect(rewardRouter.connect(user3).acceptTransfer(user1.address))
      .to.be.revertedWith("RewardRouter: transfer not signalled")

    await zkeVester.setBonusRewards(user2.address, expandDecimals(100, 18))

    expect(await stakedZkeTracker.depositBalances(user2.address, zke.address)).eq(expandDecimals(200, 18))
    expect(await stakedZkeTracker.depositBalances(user2.address, esZke.address)).eq(0)
    expect(await stakedZkeTracker.depositBalances(user3.address, zke.address)).eq(0)
    expect(await stakedZkeTracker.depositBalances(user3.address, esZke.address)).eq(0)

    expect(await feeZkeTracker.depositBalances(user2.address, bnZke.address)).eq(0)
    expect(await feeZkeTracker.depositBalances(user3.address, bnZke.address)).eq(0)

    expect(await feeZlpTracker.depositBalances(user2.address, zlp.address)).eq("299100000000000000000") // 299.1
    expect(await feeZlpTracker.depositBalances(user3.address, zlp.address)).eq(0)

    expect(await stakedZlpTracker.depositBalances(user2.address, feeZlpTracker.address)).eq("299100000000000000000") // 299.1
    expect(await stakedZlpTracker.depositBalances(user3.address, feeZlpTracker.address)).eq(0)

    expect(await zkeVester.transferredAverageStakedAmounts(user3.address)).eq(0)
    expect(await zkeVester.transferredCumulativeRewards(user3.address)).eq(0)
    expect(await zkeVester.bonusRewards(user2.address)).eq(expandDecimals(100, 18))
    expect(await zkeVester.bonusRewards(user3.address)).eq(0)
    expect(await zkeVester.getCombinedAverageStakedAmount(user2.address)).eq(0)
    expect(await zkeVester.getCombinedAverageStakedAmount(user3.address)).eq(0)
    expect(await zkeVester.getMaxVestableAmount(user2.address)).eq(expandDecimals(100, 18))
    expect(await zkeVester.getMaxVestableAmount(user3.address)).eq(0)
    expect(await zkeVester.getPairAmount(user2.address, expandDecimals(892, 18))).eq(0)
    expect(await zkeVester.getPairAmount(user3.address, expandDecimals(892, 18))).eq(0)

    await rewardRouter.connect(user3).acceptTransfer(user2.address)

    expect(await stakedZkeTracker.depositBalances(user2.address, zke.address)).eq(0)
    expect(await stakedZkeTracker.depositBalances(user2.address, esZke.address)).eq(0)
    expect(await stakedZkeTracker.depositBalances(user3.address, zke.address)).eq(expandDecimals(200, 18))
    expect(await stakedZkeTracker.depositBalances(user3.address, esZke.address)).gt(expandDecimals(1785, 18))
    expect(await stakedZkeTracker.depositBalances(user3.address, esZke.address)).lt(expandDecimals(1786, 18))

    expect(await feeZkeTracker.depositBalances(user2.address, bnZke.address)).eq(0)
    expect(await feeZkeTracker.depositBalances(user3.address, bnZke.address)).gt("547000000000000000") // 0.547
    expect(await feeZkeTracker.depositBalances(user3.address, bnZke.address)).lt("549000000000000000") // 0.548

    expect(await feeZlpTracker.depositBalances(user2.address, zlp.address)).eq(0)
    expect(await feeZlpTracker.depositBalances(user3.address, zlp.address)).eq("299100000000000000000") // 299.1

    expect(await stakedZlpTracker.depositBalances(user2.address, feeZlpTracker.address)).eq(0)
    expect(await stakedZlpTracker.depositBalances(user3.address, feeZlpTracker.address)).eq("299100000000000000000") // 299.1

    expect(await zkeVester.transferredAverageStakedAmounts(user3.address)).eq(expandDecimals(200, 18))
    expect(await zkeVester.transferredCumulativeRewards(user3.address)).gt(expandDecimals(892, 18))
    expect(await zkeVester.transferredCumulativeRewards(user3.address)).lt(expandDecimals(893, 18))
    expect(await zkeVester.bonusRewards(user2.address)).eq(0)
    expect(await zkeVester.bonusRewards(user3.address)).eq(expandDecimals(100, 18))
    expect(await zkeVester.getCombinedAverageStakedAmount(user2.address)).eq(expandDecimals(200, 18))
    expect(await zkeVester.getCombinedAverageStakedAmount(user3.address)).eq(expandDecimals(200, 18))
    expect(await zkeVester.getMaxVestableAmount(user2.address)).eq(0)
    expect(await zkeVester.getMaxVestableAmount(user3.address)).gt(expandDecimals(992, 18))
    expect(await zkeVester.getMaxVestableAmount(user3.address)).lt(expandDecimals(993, 18))
    expect(await zkeVester.getPairAmount(user2.address, expandDecimals(992, 18))).eq(0)
    expect(await zkeVester.getPairAmount(user3.address, expandDecimals(992, 18))).gt(expandDecimals(199, 18))
    expect(await zkeVester.getPairAmount(user3.address, expandDecimals(992, 18))).lt(expandDecimals(200, 18))
    expect(await zkeVester.getPairAmount(user1.address, expandDecimals(892, 18))).gt(expandDecimals(199, 18))
    expect(await zkeVester.getPairAmount(user1.address, expandDecimals(892, 18))).lt(expandDecimals(200, 18))

    await rewardRouter.connect(user1).compound()

    await expect(rewardRouter.connect(user3).acceptTransfer(user1.address))
      .to.be.revertedWith("RewardRouter: transfer not signalled")

    await increaseTime(provider, 24 * 60 * 60)
    await mineBlock(provider)

    await rewardRouter.connect(user1).claim()
    await rewardRouter.connect(user2).claim()
    await rewardRouter.connect(user3).claim()

    expect(await zkeVester.getCombinedAverageStakedAmount(user1.address)).gt(expandDecimals(1092, 18))
    expect(await zkeVester.getCombinedAverageStakedAmount(user1.address)).lt(expandDecimals(1094, 18))
    expect(await zkeVester.getCombinedAverageStakedAmount(user3.address)).gt(expandDecimals(1092, 18))
    expect(await zkeVester.getCombinedAverageStakedAmount(user3.address)).lt(expandDecimals(1094, 18))

    expect(await zkeVester.getMaxVestableAmount(user2.address)).eq(0)
    expect(await zkeVester.getMaxVestableAmount(user3.address)).gt(expandDecimals(1885, 18))
    expect(await zkeVester.getMaxVestableAmount(user3.address)).lt(expandDecimals(1887, 18))
    expect(await zkeVester.getMaxVestableAmount(user1.address)).gt(expandDecimals(1785, 18))
    expect(await zkeVester.getMaxVestableAmount(user1.address)).lt(expandDecimals(1787, 18))

    expect(await zkeVester.getPairAmount(user2.address, expandDecimals(992, 18))).eq(0)
    expect(await zkeVester.getPairAmount(user3.address, expandDecimals(1885, 18))).gt(expandDecimals(1092, 18))
    expect(await zkeVester.getPairAmount(user3.address, expandDecimals(1885, 18))).lt(expandDecimals(1094, 18))
    expect(await zkeVester.getPairAmount(user1.address, expandDecimals(1785, 18))).gt(expandDecimals(1092, 18))
    expect(await zkeVester.getPairAmount(user1.address, expandDecimals(1785, 18))).lt(expandDecimals(1094, 18))

    await rewardRouter.connect(user1).compound()
    await rewardRouter.connect(user3).compound()

    expect(await feeZkeTracker.balanceOf(user1.address)).gt(expandDecimals(1992, 18))
    expect(await feeZkeTracker.balanceOf(user1.address)).lt(expandDecimals(1993, 18))

    await zkeVester.connect(user1).deposit(expandDecimals(1785, 18))

    expect(await feeZkeTracker.balanceOf(user1.address)).gt(expandDecimals(1991 - 1092, 18)) // 899
    expect(await feeZkeTracker.balanceOf(user1.address)).lt(expandDecimals(1993 - 1092, 18)) // 901

    expect(await feeZkeTracker.depositBalances(user1.address, bnZke.address)).gt(expandDecimals(4, 18))
    expect(await feeZkeTracker.depositBalances(user1.address, bnZke.address)).lt(expandDecimals(6, 18))

    await rewardRouter.connect(user1).unstakeZke(expandDecimals(200, 18))
    await expect(rewardRouter.connect(user1).unstakeEsZke(expandDecimals(699, 18)))
      .to.be.revertedWith("RewardTracker: burn amount exceeds balance")

    await rewardRouter.connect(user1).unstakeEsZke(expandDecimals(599, 18))

    await increaseTime(provider, 24 * 60 * 60)
    await mineBlock(provider)

    expect(await feeZkeTracker.balanceOf(user1.address)).gt(expandDecimals(97, 18))
    expect(await feeZkeTracker.balanceOf(user1.address)).lt(expandDecimals(99, 18))

    expect(await esZke.balanceOf(user1.address)).gt(expandDecimals(599, 18))
    expect(await esZke.balanceOf(user1.address)).lt(expandDecimals(601, 18))

    expect(await zke.balanceOf(user1.address)).eq(expandDecimals(200, 18))

    await zkeVester.connect(user1).withdraw()

    expect(await feeZkeTracker.balanceOf(user1.address)).gt(expandDecimals(1190, 18)) // 1190 - 98 => 1092
    expect(await feeZkeTracker.balanceOf(user1.address)).lt(expandDecimals(1191, 18))

    expect(await esZke.balanceOf(user1.address)).gt(expandDecimals(2378, 18))
    expect(await esZke.balanceOf(user1.address)).lt(expandDecimals(2380, 18))

    expect(await zke.balanceOf(user1.address)).gt(expandDecimals(204, 18))
    expect(await zke.balanceOf(user1.address)).lt(expandDecimals(206, 18))

    expect(await zlpVester.getMaxVestableAmount(user3.address)).gt(expandDecimals(1785, 18))
    expect(await zlpVester.getMaxVestableAmount(user3.address)).lt(expandDecimals(1787, 18))

    expect(await zlpVester.getPairAmount(user3.address, expandDecimals(1785, 18))).gt(expandDecimals(298, 18))
    expect(await zlpVester.getPairAmount(user3.address, expandDecimals(1785, 18))).lt(expandDecimals(300, 18))

    expect(await stakedZlpTracker.balanceOf(user3.address)).eq("299100000000000000000")

    expect(await esZke.balanceOf(user3.address)).gt(expandDecimals(1785, 18))
    expect(await esZke.balanceOf(user3.address)).lt(expandDecimals(1787, 18))

    expect(await zke.balanceOf(user3.address)).eq(0)

    await zlpVester.connect(user3).deposit(expandDecimals(1785, 18))

    expect(await stakedZlpTracker.balanceOf(user3.address)).gt(0)
    expect(await stakedZlpTracker.balanceOf(user3.address)).lt(expandDecimals(1, 18))

    expect(await esZke.balanceOf(user3.address)).gt(0)
    expect(await esZke.balanceOf(user3.address)).lt(expandDecimals(1, 18))

    expect(await zke.balanceOf(user3.address)).eq(0)

    await expect(rewardRouter.connect(user3).unstakeAndRedeemZlp(
      bnb.address,
      expandDecimals(1, 18),
      0,
      user3.address,
      [randomBytes(1)],{value:expandDecimals(1,1)}
    )).to.be.revertedWith("RewardTracker: burn amount exceeds balance")

    await increaseTime(provider, 24 * 60 * 60)
    await mineBlock(provider)

    await zlpVester.connect(user3).withdraw()

    expect(await stakedZlpTracker.balanceOf(user3.address)).eq("299100000000000000000")

    expect(await esZke.balanceOf(user3.address)).gt(expandDecimals(1785 - 5, 18))
    expect(await esZke.balanceOf(user3.address)).lt(expandDecimals(1787 - 5, 18))

    expect(await zke.balanceOf(user3.address)).gt(expandDecimals(4, 18))
    expect(await zke.balanceOf(user3.address)).lt(expandDecimals(6, 18))

    expect(await feeZkeTracker.balanceOf(user1.address)).gt(expandDecimals(1190, 18))
    expect(await feeZkeTracker.balanceOf(user1.address)).lt(expandDecimals(1191, 18))

    expect(await esZke.balanceOf(user1.address)).gt(expandDecimals(2379, 18))
    expect(await esZke.balanceOf(user1.address)).lt(expandDecimals(2381, 18))

    expect(await zke.balanceOf(user1.address)).gt(expandDecimals(204, 18))
    expect(await zke.balanceOf(user1.address)).lt(expandDecimals(206, 18))

    await zkeVester.connect(user1).deposit(expandDecimals(365 * 2, 18))

    expect(await feeZkeTracker.balanceOf(user1.address)).gt(expandDecimals(743, 18)) // 1190 - 743 => 447
    expect(await feeZkeTracker.balanceOf(user1.address)).lt(expandDecimals(754, 18))

    expect(await zkeVester.claimable(user1.address)).eq(0)

    await increaseTime(provider, 48 * 60 * 60)
    await mineBlock(provider)

    expect(await zkeVester.claimable(user1.address)).gt("3900000000000000000") // 3.9
    expect(await zkeVester.claimable(user1.address)).lt("4100000000000000000") // 4.1

    await zkeVester.connect(user1).deposit(expandDecimals(365, 18))

    expect(await feeZkeTracker.balanceOf(user1.address)).gt(expandDecimals(522, 18)) // 743 - 522 => 221
    expect(await feeZkeTracker.balanceOf(user1.address)).lt(expandDecimals(524, 18))

    await increaseTime(provider, 48 * 60 * 60)
    await mineBlock(provider)

    expect(await zkeVester.claimable(user1.address)).gt("9900000000000000000") // 9.9
    expect(await zkeVester.claimable(user1.address)).lt("10100000000000000000") // 10.1

    expect(await zke.balanceOf(user1.address)).gt(expandDecimals(204, 18))
    expect(await zke.balanceOf(user1.address)).lt(expandDecimals(206, 18))

    await zkeVester.connect(user1).claim()

    expect(await zke.balanceOf(user1.address)).gt(expandDecimals(214, 18))
    expect(await zke.balanceOf(user1.address)).lt(expandDecimals(216, 18))

    await zkeVester.connect(user1).deposit(expandDecimals(365, 18))
    expect(await zkeVester.balanceOf(user1.address)).gt(expandDecimals(1449, 18)) // 365 * 4 => 1460, 1460 - 10 => 1450
    expect(await zkeVester.balanceOf(user1.address)).lt(expandDecimals(1451, 18))
    expect(await zkeVester.getVestedAmount(user1.address)).eq(expandDecimals(1460, 18))

    expect(await feeZkeTracker.balanceOf(user1.address)).gt(expandDecimals(303, 18)) // 522 - 303 => 219
    expect(await feeZkeTracker.balanceOf(user1.address)).lt(expandDecimals(304, 18))

    await increaseTime(provider, 48 * 60 * 60)
    await mineBlock(provider)

    expect(await zkeVester.claimable(user1.address)).gt("7900000000000000000") // 7.9
    expect(await zkeVester.claimable(user1.address)).lt("8100000000000000000") // 8.1

    await zkeVester.connect(user1).withdraw()

    expect(await feeZkeTracker.balanceOf(user1.address)).gt(expandDecimals(1190, 18))
    expect(await feeZkeTracker.balanceOf(user1.address)).lt(expandDecimals(1191, 18))

    expect(await zke.balanceOf(user1.address)).gt(expandDecimals(222, 18))
    expect(await zke.balanceOf(user1.address)).lt(expandDecimals(224, 18))

    expect(await esZke.balanceOf(user1.address)).gt(expandDecimals(2360, 18))
    expect(await esZke.balanceOf(user1.address)).lt(expandDecimals(2362, 18))

    await zkeVester.connect(user1).deposit(expandDecimals(365, 18))

    await increaseTime(provider, 500 * 24 * 60 * 60)
    await mineBlock(provider)

    expect(await zkeVester.claimable(user1.address)).eq(expandDecimals(365, 18))

    await zkeVester.connect(user1).withdraw()

    expect(await zke.balanceOf(user1.address)).gt(expandDecimals(222 + 365, 18))
    expect(await zke.balanceOf(user1.address)).lt(expandDecimals(224 + 365, 18))

    expect(await esZke.balanceOf(user1.address)).gt(expandDecimals(2360 - 365, 18))
    expect(await esZke.balanceOf(user1.address)).lt(expandDecimals(2362 - 365, 18))

    expect(await zkeVester.transferredAverageStakedAmounts(user2.address)).eq(0)
    expect(await zkeVester.transferredAverageStakedAmounts(user3.address)).eq(expandDecimals(200, 18))
    expect(await stakedZkeTracker.cumulativeRewards(user2.address)).gt(expandDecimals(892, 18))
    expect(await stakedZkeTracker.cumulativeRewards(user2.address)).lt(expandDecimals(893, 18))
    expect(await stakedZkeTracker.cumulativeRewards(user3.address)).gt(expandDecimals(892, 18))
    expect(await stakedZkeTracker.cumulativeRewards(user3.address)).lt(expandDecimals(893, 18))
    expect(await zkeVester.transferredCumulativeRewards(user3.address)).gt(expandDecimals(892, 18))
    expect(await zkeVester.transferredCumulativeRewards(user3.address)).lt(expandDecimals(893, 18))
    expect(await zkeVester.bonusRewards(user2.address)).eq(0)
    expect(await zkeVester.bonusRewards(user3.address)).eq(expandDecimals(100, 18))
    expect(await zkeVester.getCombinedAverageStakedAmount(user2.address)).eq(expandDecimals(200, 18))
    expect(await zkeVester.getCombinedAverageStakedAmount(user3.address)).gt(expandDecimals(1092, 18))
    expect(await zkeVester.getCombinedAverageStakedAmount(user3.address)).lt(expandDecimals(1093, 18))
    expect(await zkeVester.getMaxVestableAmount(user2.address)).eq(0)
    expect(await zkeVester.getMaxVestableAmount(user3.address)).gt(expandDecimals(1884, 18))
    expect(await zkeVester.getMaxVestableAmount(user3.address)).lt(expandDecimals(1886, 18))
    expect(await zkeVester.getPairAmount(user2.address, expandDecimals(992, 18))).eq(0)
    expect(await zkeVester.getPairAmount(user3.address, expandDecimals(992, 18))).gt(expandDecimals(574, 18))
    expect(await zkeVester.getPairAmount(user3.address, expandDecimals(992, 18))).lt(expandDecimals(575, 18))
    expect(await zkeVester.getPairAmount(user1.address, expandDecimals(892, 18))).gt(expandDecimals(545, 18))
    expect(await zkeVester.getPairAmount(user1.address, expandDecimals(892, 18))).lt(expandDecimals(546, 18))

    const esZkeBatchSender = await deployContract("EsZkeBatchSender", [esZke.address])

    await timelock.signalSetHandler(esZke.address, esZkeBatchSender.address, true)
    await timelock.signalSetHandler(zkeVester.address, esZkeBatchSender.address, true)
    await timelock.signalSetHandler(zlpVester.address, esZkeBatchSender.address, true)
    await timelock.signalMint(esZke.address, wallet.address, expandDecimals(1000, 18))

    await increaseTime(provider, 20)
    await mineBlock(provider)

    await timelock.setHandler(esZke.address, esZkeBatchSender.address, true)
    await timelock.setHandler(zkeVester.address, esZkeBatchSender.address, true)
    await timelock.setHandler(zlpVester.address, esZkeBatchSender.address, true)
    await timelock.processMint(esZke.address, wallet.address, expandDecimals(1000, 18))

    await esZkeBatchSender.connect(wallet).send(
      zkeVester.address,
      4,
      [user2.address, user3.address],
      [expandDecimals(100, 18), expandDecimals(200, 18)]
    )

    expect(await zkeVester.transferredAverageStakedAmounts(user2.address)).gt(expandDecimals(37648, 18))
    expect(await zkeVester.transferredAverageStakedAmounts(user2.address)).lt(expandDecimals(37649, 18))
    expect(await zkeVester.transferredAverageStakedAmounts(user3.address)).gt(expandDecimals(12810, 18))
    expect(await zkeVester.transferredAverageStakedAmounts(user3.address)).lt(expandDecimals(12811, 18))
    expect(await zkeVester.transferredCumulativeRewards(user2.address)).eq(expandDecimals(100, 18))
    expect(await zkeVester.transferredCumulativeRewards(user3.address)).gt(expandDecimals(892 + 200, 18))
    expect(await zkeVester.transferredCumulativeRewards(user3.address)).lt(expandDecimals(893 + 200, 18))
    expect(await zkeVester.bonusRewards(user2.address)).eq(0)
    expect(await zkeVester.bonusRewards(user3.address)).eq(expandDecimals(100, 18))
    expect(await zkeVester.getCombinedAverageStakedAmount(user2.address)).gt(expandDecimals(3971, 18))
    expect(await zkeVester.getCombinedAverageStakedAmount(user2.address)).lt(expandDecimals(3972, 18))
    expect(await zkeVester.getCombinedAverageStakedAmount(user3.address)).gt(expandDecimals(7943, 18))
    expect(await zkeVester.getCombinedAverageStakedAmount(user3.address)).lt(expandDecimals(7944, 18))
    expect(await zkeVester.getMaxVestableAmount(user2.address)).eq(expandDecimals(100, 18))
    expect(await zkeVester.getMaxVestableAmount(user3.address)).gt(expandDecimals(1884 + 200, 18))
    expect(await zkeVester.getMaxVestableAmount(user3.address)).lt(expandDecimals(1886 + 200, 18))
    expect(await zkeVester.getPairAmount(user2.address, expandDecimals(100, 18))).gt(expandDecimals(3971, 18))
    expect(await zkeVester.getPairAmount(user2.address, expandDecimals(100, 18))).lt(expandDecimals(3972, 18))
    expect(await zkeVester.getPairAmount(user3.address, expandDecimals(1884 + 200, 18))).gt(expandDecimals(7936, 18))
    expect(await zkeVester.getPairAmount(user3.address, expandDecimals(1884 + 200, 18))).lt(expandDecimals(7937, 18))

    expect(await zlpVester.transferredAverageStakedAmounts(user4.address)).eq(0)
    expect(await zlpVester.transferredCumulativeRewards(user4.address)).eq(0)
    expect(await zlpVester.bonusRewards(user4.address)).eq(0)
    expect(await zlpVester.getCombinedAverageStakedAmount(user4.address)).eq(0)
    expect(await zlpVester.getMaxVestableAmount(user4.address)).eq(0)
    expect(await zlpVester.getPairAmount(user4.address, expandDecimals(10, 18))).eq(0)

    await esZkeBatchSender.connect(wallet).send(
      zlpVester.address,
      320,
      [user4.address],
      [expandDecimals(10, 18)]
    )

    expect(await zlpVester.transferredAverageStakedAmounts(user4.address)).eq(expandDecimals(3200, 18))
    expect(await zlpVester.transferredCumulativeRewards(user4.address)).eq(expandDecimals(10, 18))
    expect(await zlpVester.bonusRewards(user4.address)).eq(0)
    expect(await zlpVester.getCombinedAverageStakedAmount(user4.address)).eq(expandDecimals(3200, 18))
    expect(await zlpVester.getMaxVestableAmount(user4.address)).eq(expandDecimals(10, 18))
    expect(await zlpVester.getPairAmount(user4.address, expandDecimals(10, 18))).eq(expandDecimals(3200, 18))

    await esZkeBatchSender.connect(wallet).send(
      zlpVester.address,
      320,
      [user4.address],
      [expandDecimals(10, 18)]
    )

    expect(await zlpVester.transferredAverageStakedAmounts(user4.address)).eq(expandDecimals(6400, 18))
    expect(await zlpVester.transferredCumulativeRewards(user4.address)).eq(expandDecimals(20, 18))
    expect(await zlpVester.bonusRewards(user4.address)).eq(0)
    expect(await zlpVester.getCombinedAverageStakedAmount(user4.address)).eq(expandDecimals(6400, 18))
    expect(await zlpVester.getMaxVestableAmount(user4.address)).eq(expandDecimals(20, 18))
    expect(await zlpVester.getPairAmount(user4.address, expandDecimals(10, 18))).eq(expandDecimals(3200, 18))
  })

  it("handleRewards", async () => {
    const timelockV2 = wallet

    // use new rewardRouter, use eth for weth
    const rewardRouterV3 = await deployContract("RewardRouterV3", [])
    await rewardRouterV3.initialize(
      eth.address,
      zke.address,
      esZke.address,
      bnZke.address,
      zlp.address,
      stakedZkeTracker.address,
      bonusZkeTracker.address,
      feeZkeTracker.address,
      feeZlpTracker.address,
      stakedZlpTracker.address,
      zlpManager.address,
      zkeVester.address,
      zlpVester.address
    )

    await timelock.signalSetGov(zlpManager.address, timelockV2.address)
    await timelock.signalSetGov(stakedZkeTracker.address, timelockV2.address)
    await timelock.signalSetGov(bonusZkeTracker.address, timelockV2.address)
    await timelock.signalSetGov(feeZkeTracker.address, timelockV2.address)
    await timelock.signalSetGov(feeZlpTracker.address, timelockV2.address)
    await timelock.signalSetGov(stakedZlpTracker.address, timelockV2.address)
    await timelock.signalSetGov(stakedZkeDistributor.address, timelockV2.address)
    await timelock.signalSetGov(stakedZlpDistributor.address, timelockV2.address)
    await timelock.signalSetGov(esZke.address, timelockV2.address)
    await timelock.signalSetGov(bnZke.address, timelockV2.address)
    await timelock.signalSetGov(zkeVester.address, timelockV2.address)
    await timelock.signalSetGov(zlpVester.address, timelockV2.address)

    await increaseTime(provider, 20)
    await mineBlock(provider)

    await timelock.setGov(zlpManager.address, timelockV2.address)
    await timelock.setGov(stakedZkeTracker.address, timelockV2.address)
    await timelock.setGov(bonusZkeTracker.address, timelockV2.address)
    await timelock.setGov(feeZkeTracker.address, timelockV2.address)
    await timelock.setGov(feeZlpTracker.address, timelockV2.address)
    await timelock.setGov(stakedZlpTracker.address, timelockV2.address)
    await timelock.setGov(stakedZkeDistributor.address, timelockV2.address)
    await timelock.setGov(stakedZlpDistributor.address, timelockV2.address)
    await timelock.setGov(esZke.address, timelockV2.address)
    await timelock.setGov(bnZke.address, timelockV2.address)
    await timelock.setGov(zkeVester.address, timelockV2.address)
    await timelock.setGov(zlpVester.address, timelockV2.address)

    await esZke.setHandler(rewardRouterV3.address, true)
    await esZke.setHandler(stakedZkeDistributor.address, true)
    await esZke.setHandler(stakedZlpDistributor.address, true)
    await esZke.setHandler(stakedZkeTracker.address, true)
    await esZke.setHandler(stakedZlpTracker.address, true)
    await esZke.setHandler(zkeVester.address, true)
    await esZke.setHandler(zlpVester.address, true)

    await zlpManager.setHandler(rewardRouterV3.address, true)
    await stakedZkeTracker.setHandler(rewardRouterV3.address, true)
    await bonusZkeTracker.setHandler(rewardRouterV3.address, true)
    await feeZkeTracker.setHandler(rewardRouterV3.address, true)
    await feeZlpTracker.setHandler(rewardRouterV3.address, true)
    await stakedZlpTracker.setHandler(rewardRouterV3.address, true)

    await esZke.setHandler(rewardRouterV3.address, true)
    await bnZke.setMinter(rewardRouterV3.address, true)
    await esZke.setMinter(zkeVester.address, true)
    await esZke.setMinter(zlpVester.address, true)

    await zkeVester.setHandler(rewardRouterV3.address, true)
    await zlpVester.setHandler(rewardRouterV3.address, true)

    await feeZkeTracker.setHandler(zkeVester.address, true)
    await stakedZlpTracker.setHandler(zlpVester.address, true)

    await eth.deposit({ value: expandDecimals(10, 18) })

    await zke.setMinter(wallet.address, true)
    await zke.mint(zkeVester.address, expandDecimals(10000, 18))
    await zke.mint(zlpVester.address, expandDecimals(10000, 18))

    await eth.mint(feeZlpDistributor.address, expandDecimals(50, 18))
    await feeZlpDistributor.setTokensPerInterval("41335970000000") // 0.00004133597 ETH per second

    await eth.mint(feeZkeDistributor.address, expandDecimals(50, 18))
    await feeZkeDistributor.setTokensPerInterval("41335970000000") // 0.00004133597 ETH per second

    await bnb.mint(user1.address, expandDecimals(1, 18))
    await bnb.connect(user1).approve(zlpManager.address, expandDecimals(1, 18))
    await rewardRouterV3.connect(user1).mintAndStakeZlp(
      bnb.address,
      expandDecimals(1, 18),
      expandDecimals(299, 18),
      expandDecimals(299, 18)
    )

    await zke.mint(user1.address, expandDecimals(200, 18))
    expect(await zke.balanceOf(user1.address)).eq(expandDecimals(200, 18))
    await zke.connect(user1).approve(stakedZkeTracker.address, expandDecimals(200, 18))
    await rewardRouterV3.connect(user1).stakeZke(expandDecimals(200, 18))
    expect(await zke.balanceOf(user1.address)).eq(0)

    await increaseTime(provider, 24 * 60 * 60)
    await mineBlock(provider)

    expect(await zke.balanceOf(user1.address)).eq(0)
    expect(await esZke.balanceOf(user1.address)).eq(0)
    expect(await bnZke.balanceOf(user1.address)).eq(0)
    expect(await zlp.balanceOf(user1.address)).eq(0)
    expect(await eth.balanceOf(user1.address)).eq(0)

    expect(await stakedZkeTracker.depositBalances(user1.address, zke.address)).eq(expandDecimals(200, 18))
    expect(await stakedZkeTracker.depositBalances(user1.address, esZke.address)).eq(0)
    expect(await feeZkeTracker.depositBalances(user1.address, bnZke.address)).eq(0)

    await rewardRouterV3.connect(user1).handleRewards(
      true, // _shouldClaimZke
      true, // _shouldStakeZke
      true, // _shouldClaimEsZke
      true, // _shouldStakeEsZke
      true, // _shouldStakeMultiplierPoints
      true, // _shouldClaimWeth
      false // _shouldConvertWethToEth
    )

    expect(await zke.balanceOf(user1.address)).eq(0)
    expect(await esZke.balanceOf(user1.address)).eq(0)
    expect(await bnZke.balanceOf(user1.address)).eq(0)
    expect(await zlp.balanceOf(user1.address)).eq(0)
    expect(await eth.balanceOf(user1.address)).gt(expandDecimals(7, 18))
    expect(await eth.balanceOf(user1.address)).lt(expandDecimals(8, 18))

    expect(await stakedZkeTracker.depositBalances(user1.address, zke.address)).eq(expandDecimals(200, 18))
    expect(await stakedZkeTracker.depositBalances(user1.address, esZke.address)).gt(expandDecimals(3571, 18))
    expect(await stakedZkeTracker.depositBalances(user1.address, esZke.address)).lt(expandDecimals(3572, 18))
    expect(await feeZkeTracker.depositBalances(user1.address, bnZke.address)).gt("540000000000000000") // 0.54
    expect(await feeZkeTracker.depositBalances(user1.address, bnZke.address)).lt("560000000000000000") // 0.56

    await increaseTime(provider, 24 * 60 * 60)
    await mineBlock(provider)

    const ethBalance0 = await provider.getBalance(user1.address)

    await rewardRouterV3.connect(user1).handleRewards(
      false, // _shouldClaimZke
      false, // _shouldStakeZke
      false, // _shouldClaimEsZke
      false, // _shouldStakeEsZke
      false, // _shouldStakeMultiplierPoints
      true, // _shouldClaimWeth
      true // _shouldConvertWethToEth
    )

    const ethBalance1 = await provider.getBalance(user1.address)

    expect(await ethBalance1.sub(ethBalance0)).gt(expandDecimals(7, 18))
    expect(await ethBalance1.sub(ethBalance0)).lt(expandDecimals(8, 18))
    expect(await zke.balanceOf(user1.address)).eq(0)
    expect(await esZke.balanceOf(user1.address)).eq(0)
    expect(await bnZke.balanceOf(user1.address)).eq(0)
    expect(await zlp.balanceOf(user1.address)).eq(0)
    expect(await eth.balanceOf(user1.address)).gt(expandDecimals(7, 18))
    expect(await eth.balanceOf(user1.address)).lt(expandDecimals(8, 18))

    expect(await stakedZkeTracker.depositBalances(user1.address, zke.address)).eq(expandDecimals(200, 18))
    expect(await stakedZkeTracker.depositBalances(user1.address, esZke.address)).gt(expandDecimals(3571, 18))
    expect(await stakedZkeTracker.depositBalances(user1.address, esZke.address)).lt(expandDecimals(3572, 18))
    expect(await feeZkeTracker.depositBalances(user1.address, bnZke.address)).gt("540000000000000000") // 0.54
    expect(await feeZkeTracker.depositBalances(user1.address, bnZke.address)).lt("560000000000000000") // 0.56

    await rewardRouterV3.connect(user1).handleRewards(
      false, // _shouldClaimZke
      false, // _shouldStakeZke
      true, // _shouldClaimEsZke
      false, // _shouldStakeEsZke
      false, // _shouldStakeMultiplierPoints
      false, // _shouldClaimWeth
      false // _shouldConvertWethToEth
    )

    expect(await ethBalance1.sub(ethBalance0)).gt(expandDecimals(7, 18))
    expect(await ethBalance1.sub(ethBalance0)).lt(expandDecimals(8, 18))
    expect(await zke.balanceOf(user1.address)).eq(0)
    expect(await esZke.balanceOf(user1.address)).gt(expandDecimals(3571, 18))
    expect(await esZke.balanceOf(user1.address)).lt(expandDecimals(3572, 18))
    expect(await bnZke.balanceOf(user1.address)).eq(0)
    expect(await zlp.balanceOf(user1.address)).eq(0)
    expect(await eth.balanceOf(user1.address)).gt(expandDecimals(7, 18))
    expect(await eth.balanceOf(user1.address)).lt(expandDecimals(8, 18))

    expect(await stakedZkeTracker.depositBalances(user1.address, zke.address)).eq(expandDecimals(200, 18))
    expect(await stakedZkeTracker.depositBalances(user1.address, esZke.address)).gt(expandDecimals(3571, 18))
    expect(await stakedZkeTracker.depositBalances(user1.address, esZke.address)).lt(expandDecimals(3572, 18))
    expect(await feeZkeTracker.depositBalances(user1.address, bnZke.address)).gt("540000000000000000") // 0.54
    expect(await feeZkeTracker.depositBalances(user1.address, bnZke.address)).lt("560000000000000000") // 0.56

    await zkeVester.connect(user1).deposit(expandDecimals(365, 18))
    await zlpVester.connect(user1).deposit(expandDecimals(365 * 2, 18))

    expect(await ethBalance1.sub(ethBalance0)).gt(expandDecimals(7, 18))
    expect(await ethBalance1.sub(ethBalance0)).lt(expandDecimals(8, 18))
    expect(await zke.balanceOf(user1.address)).eq(0)
    expect(await esZke.balanceOf(user1.address)).gt(expandDecimals(3571 - 365 * 3, 18))
    expect(await esZke.balanceOf(user1.address)).lt(expandDecimals(3572 - 365 * 3, 18))
    expect(await bnZke.balanceOf(user1.address)).eq(0)
    expect(await zlp.balanceOf(user1.address)).eq(0)
    expect(await eth.balanceOf(user1.address)).gt(expandDecimals(7, 18))
    expect(await eth.balanceOf(user1.address)).lt(expandDecimals(8, 18))

    expect(await stakedZkeTracker.depositBalances(user1.address, zke.address)).eq(expandDecimals(200, 18))
    expect(await stakedZkeTracker.depositBalances(user1.address, esZke.address)).gt(expandDecimals(3571, 18))
    expect(await stakedZkeTracker.depositBalances(user1.address, esZke.address)).lt(expandDecimals(3572, 18))
    expect(await feeZkeTracker.depositBalances(user1.address, bnZke.address)).gt("540000000000000000") // 0.54
    expect(await feeZkeTracker.depositBalances(user1.address, bnZke.address)).lt("560000000000000000") // 0.56

    await increaseTime(provider, 24 * 60 * 60)
    await mineBlock(provider)

    await rewardRouterV3.connect(user1).handleRewards(
      true, // _shouldClaimZke
      false, // _shouldStakeZke
      false, // _shouldClaimEsZke
      false, // _shouldStakeEsZke
      false, // _shouldStakeMultiplierPoints
      false, // _shouldClaimWeth
      false // _shouldConvertWethToEth
    )

    expect(await ethBalance1.sub(ethBalance0)).gt(expandDecimals(7, 18))
    expect(await ethBalance1.sub(ethBalance0)).lt(expandDecimals(8, 18))
    expect(await zke.balanceOf(user1.address)).gt("2900000000000000000") // 2.9
    expect(await zke.balanceOf(user1.address)).lt("3100000000000000000") // 3.1
    expect(await esZke.balanceOf(user1.address)).gt(expandDecimals(3571 - 365 * 3, 18))
    expect(await esZke.balanceOf(user1.address)).lt(expandDecimals(3572 - 365 * 3, 18))
    expect(await bnZke.balanceOf(user1.address)).eq(0)
    expect(await zlp.balanceOf(user1.address)).eq(0)
    expect(await eth.balanceOf(user1.address)).gt(expandDecimals(7, 18))
    expect(await eth.balanceOf(user1.address)).lt(expandDecimals(8, 18))

    expect(await stakedZkeTracker.depositBalances(user1.address, zke.address)).eq(expandDecimals(200, 18))
    expect(await stakedZkeTracker.depositBalances(user1.address, esZke.address)).gt(expandDecimals(3571, 18))
    expect(await stakedZkeTracker.depositBalances(user1.address, esZke.address)).lt(expandDecimals(3572, 18))
    expect(await feeZkeTracker.depositBalances(user1.address, bnZke.address)).gt("540000000000000000") // 0.54
    expect(await feeZkeTracker.depositBalances(user1.address, bnZke.address)).lt("560000000000000000") // 0.56
  })

  it("StakedZlp", async () => {
    await eth.mint(feeZlpDistributor.address, expandDecimals(100, 18))
    await feeZlpDistributor.setTokensPerInterval("41335970000000") // 0.00004133597 ETH per second

    await bnb.mint(user1.address, expandDecimals(1, 18))
    await bnb.connect(user1).approve(zlpManager.address, expandDecimals(1, 18))
    await rewardRouter.connect(user1).mintAndStakeZlp(
      bnb.address,
      expandDecimals(1, 18),
      expandDecimals(299, 18),
      expandDecimals(299, 18),
      [randomBytes(1)],{value:expandDecimals(1,1)}
    )

    expect(await feeZlpTracker.stakedAmounts(user1.address)).eq(expandDecimals(2991, 17))
    expect(await feeZlpTracker.depositBalances(user1.address, zlp.address)).eq(expandDecimals(2991, 17))

    expect(await stakedZlpTracker.stakedAmounts(user1.address)).eq(expandDecimals(2991, 17))
    expect(await stakedZlpTracker.depositBalances(user1.address, feeZlpTracker.address)).eq(expandDecimals(2991, 17))

    const proxyBlockInfo = await deployProxyBlockInfo();
    const stakedZlp = await deployContract("StakedZlp", [zlp.address, zlpManager.address, stakedZlpTracker.address, feeZlpTracker.address, proxyBlockInfo.address])

    await expect(stakedZlp.connect(user2).transferFrom(user1.address, user3.address, expandDecimals(2991, 17)))
      .to.be.revertedWith("StakedZlp: transfer amount exceeds allowance")

    await stakedZlp.connect(user1).approve(user2.address, expandDecimals(2991, 17))

    await expect(stakedZlp.connect(user2).transferFrom(user1.address, user3.address, expandDecimals(2991, 17)))
      .to.be.revertedWith("StakedZlp: cooldown duration not yet passed")

    await increaseTime(provider, 24 * 60 * 60 + 10)
    await mineBlock(provider)

    await expect(stakedZlp.connect(user2).transferFrom(user1.address, user3.address, expandDecimals(2991, 17)))
      .to.be.revertedWith("RewardTracker: forbidden")

    await timelock.signalSetHandler(stakedZlpTracker.address, stakedZlp.address, true)
    await increaseTime(provider, 20)
    await mineBlock(provider)
    await timelock.setHandler(stakedZlpTracker.address, stakedZlp.address, true)

    await expect(stakedZlp.connect(user2).transferFrom(user1.address, user3.address, expandDecimals(2991, 17)))
      .to.be.revertedWith("RewardTracker: forbidden")

    await timelock.signalSetHandler(feeZlpTracker.address, stakedZlp.address, true)
    await increaseTime(provider, 20)
    await mineBlock(provider)
    await timelock.setHandler(feeZlpTracker.address, stakedZlp.address, true)

    expect(await feeZlpTracker.stakedAmounts(user1.address)).eq(expandDecimals(2991, 17))
    expect(await feeZlpTracker.depositBalances(user1.address, zlp.address)).eq(expandDecimals(2991, 17))

    expect(await stakedZlpTracker.stakedAmounts(user1.address)).eq(expandDecimals(2991, 17))
    expect(await stakedZlpTracker.depositBalances(user1.address, feeZlpTracker.address)).eq(expandDecimals(2991, 17))

    expect(await feeZlpTracker.stakedAmounts(user3.address)).eq(0)
    expect(await feeZlpTracker.depositBalances(user3.address, zlp.address)).eq(0)

    expect(await stakedZlpTracker.stakedAmounts(user3.address)).eq(0)
    expect(await stakedZlpTracker.depositBalances(user3.address, feeZlpTracker.address)).eq(0)

    await stakedZlp.connect(user2).transferFrom(user1.address, user3. address, expandDecimals(2991, 17))

    expect(await feeZlpTracker.stakedAmounts(user1.address)).eq(0)
    expect(await feeZlpTracker.depositBalances(user1.address, zlp.address)).eq(0)

    expect(await stakedZlpTracker.stakedAmounts(user1.address)).eq(0)
    expect(await stakedZlpTracker.depositBalances(user1.address, feeZlpTracker.address)).eq(0)

    expect(await feeZlpTracker.stakedAmounts(user3.address)).eq(expandDecimals(2991, 17))
    expect(await feeZlpTracker.depositBalances(user3.address, zlp.address)).eq(expandDecimals(2991, 17))

    expect(await stakedZlpTracker.stakedAmounts(user3.address)).eq(expandDecimals(2991, 17))
    expect(await stakedZlpTracker.depositBalances(user3.address, feeZlpTracker.address)).eq(expandDecimals(2991, 17))

    await expect(stakedZlp.connect(user2).transferFrom(user3.address, user1.address, expandDecimals(3000, 17)))
      .to.be.revertedWith("StakedZlp: transfer amount exceeds allowance")

    await stakedZlp.connect(user3).approve(user2.address, expandDecimals(3000, 17))

    await expect(stakedZlp.connect(user2).transferFrom(user3.address, user1.address, expandDecimals(3000, 17)))
      .to.be.revertedWith("RewardTracker: _amount exceeds stakedAmount")

    await stakedZlp.connect(user2).transferFrom(user3.address, user1.address, expandDecimals(1000, 17))

    expect(await feeZlpTracker.stakedAmounts(user1.address)).eq(expandDecimals(1000, 17))
    expect(await feeZlpTracker.depositBalances(user1.address, zlp.address)).eq(expandDecimals(1000, 17))

    expect(await stakedZlpTracker.stakedAmounts(user1.address)).eq(expandDecimals(1000, 17))
    expect(await stakedZlpTracker.depositBalances(user1.address, feeZlpTracker.address)).eq(expandDecimals(1000, 17))

    expect(await feeZlpTracker.stakedAmounts(user3.address)).eq(expandDecimals(1991, 17))
    expect(await feeZlpTracker.depositBalances(user3.address, zlp.address)).eq(expandDecimals(1991, 17))

    expect(await stakedZlpTracker.stakedAmounts(user3.address)).eq(expandDecimals(1991, 17))
    expect(await stakedZlpTracker.depositBalances(user3.address, feeZlpTracker.address)).eq(expandDecimals(1991, 17))

    await stakedZlp.connect(user3).transfer(user1.address, expandDecimals(1500, 17))

    expect(await feeZlpTracker.stakedAmounts(user1.address)).eq(expandDecimals(2500, 17))
    expect(await feeZlpTracker.depositBalances(user1.address, zlp.address)).eq(expandDecimals(2500, 17))

    expect(await stakedZlpTracker.stakedAmounts(user1.address)).eq(expandDecimals(2500, 17))
    expect(await stakedZlpTracker.depositBalances(user1.address, feeZlpTracker.address)).eq(expandDecimals(2500, 17))

    expect(await feeZlpTracker.stakedAmounts(user3.address)).eq(expandDecimals(491, 17))
    expect(await feeZlpTracker.depositBalances(user3.address, zlp.address)).eq(expandDecimals(491, 17))

    expect(await stakedZlpTracker.stakedAmounts(user3.address)).eq(expandDecimals(491, 17))
    expect(await stakedZlpTracker.depositBalances(user3.address, feeZlpTracker.address)).eq(expandDecimals(491, 17))

    await expect(stakedZlp.connect(user3).transfer(user1.address, expandDecimals(492, 17)))
      .to.be.revertedWith("RewardTracker: _amount exceeds stakedAmount")

    expect(await bnb.balanceOf(user1.address)).eq(0)

    await rewardRouter.connect(user1).unstakeAndRedeemZlp(
      bnb.address,
      expandDecimals(2500, 17),
      "830000000000000000", // 0.83
      user1.address,
      [randomBytes(1)],{value:expandDecimals(1,1)}
    )

    expect(await bnb.balanceOf(user1.address)).eq("830833333333333333")

    await usdg.addVault(zlpManager.address)

    expect(await bnb.balanceOf(user3.address)).eq("0")

    await rewardRouter.connect(user3).unstakeAndRedeemZlp(
      bnb.address,
      expandDecimals(491, 17),
      "160000000000000000", // 0.16
      user3.address,
      [randomBytes(1)],{value:expandDecimals(1,1)}
    )

    expect(await bnb.balanceOf(user3.address)).eq("163175666666666666")
  })

  it("FeeZlp", async () => {
    await eth.mint(feeZlpDistributor.address, expandDecimals(100, 18))
    await feeZlpDistributor.setTokensPerInterval("41335970000000") // 0.00004133597 ETH per second

    await bnb.mint(user1.address, expandDecimals(1, 18))
    await bnb.connect(user1).approve(zlpManager.address, expandDecimals(1, 18))
    await rewardRouter.connect(user1).mintAndStakeZlp(
      bnb.address,
      expandDecimals(1, 18),
      expandDecimals(299, 18),
      expandDecimals(299, 18),
      [randomBytes(1)],{value:expandDecimals(1,1)}
    )

    expect(await feeZlpTracker.stakedAmounts(user1.address)).eq(expandDecimals(2991, 17))
    expect(await feeZlpTracker.depositBalances(user1.address, zlp.address)).eq(expandDecimals(2991, 17))

    expect(await stakedZlpTracker.stakedAmounts(user1.address)).eq(expandDecimals(2991, 17))
    expect(await stakedZlpTracker.depositBalances(user1.address, feeZlpTracker.address)).eq(expandDecimals(2991, 17))

    const proxyBlockInfo = await deployProxyBlockInfo()
    const zlpBalance = await deployContract("ZlpBalance", [zlpManager.address, stakedZlpTracker.address, proxyBlockInfo.address])

    await expect(zlpBalance.connect(user2).transferFrom(user1.address, user3.address, expandDecimals(2991, 17)))
      .to.be.revertedWith("ZlpBalance: transfer amount exceeds allowance")

    await zlpBalance.connect(user1).approve(user2.address, expandDecimals(2991, 17))

    await expect(zlpBalance.connect(user2).transferFrom(user1.address, user3.address, expandDecimals(2991, 17)))
      .to.be.revertedWith("ZlpBalance: cooldown duration not yet passed")

    await increaseTime(provider, 24 * 60 * 60 + 10)
    await mineBlock(provider)

    await expect(zlpBalance.connect(user2).transferFrom(user1.address, user3.address, expandDecimals(2991, 17)))
      .to.be.revertedWith("RewardTracker: transfer amount exceeds allowance")

    await timelock.signalSetHandler(stakedZlpTracker.address, zlpBalance.address, true)
    await increaseTime(provider, 20)
    await mineBlock(provider)
    await timelock.setHandler(stakedZlpTracker.address, zlpBalance.address, true)

    expect(await feeZlpTracker.stakedAmounts(user1.address)).eq(expandDecimals(2991, 17))
    expect(await feeZlpTracker.depositBalances(user1.address, zlp.address)).eq(expandDecimals(2991, 17))

    expect(await stakedZlpTracker.stakedAmounts(user1.address)).eq(expandDecimals(2991, 17))
    expect(await stakedZlpTracker.depositBalances(user1.address, feeZlpTracker.address)).eq(expandDecimals(2991, 17))
    expect(await stakedZlpTracker.balanceOf(user1.address)).eq(expandDecimals(2991, 17))

    expect(await feeZlpTracker.stakedAmounts(user3.address)).eq(0)
    expect(await feeZlpTracker.depositBalances(user3.address, zlp.address)).eq(0)

    expect(await stakedZlpTracker.stakedAmounts(user3.address)).eq(0)
    expect(await stakedZlpTracker.depositBalances(user3.address, feeZlpTracker.address)).eq(0)
    expect(await stakedZlpTracker.balanceOf(user3.address)).eq(0)

    await zlpBalance.connect(user2).transferFrom(user1.address, user3.address, expandDecimals(2991, 17))

    expect(await feeZlpTracker.stakedAmounts(user1.address)).eq(expandDecimals(2991, 17))
    expect(await feeZlpTracker.depositBalances(user1.address, zlp.address)).eq(expandDecimals(2991, 17))

    expect(await stakedZlpTracker.stakedAmounts(user1.address)).eq(expandDecimals(2991, 17))
    expect(await stakedZlpTracker.depositBalances(user1.address, feeZlpTracker.address)).eq(expandDecimals(2991, 17))
    expect(await stakedZlpTracker.balanceOf(user1.address)).eq(0)

    expect(await feeZlpTracker.stakedAmounts(user3.address)).eq(0)
    expect(await feeZlpTracker.depositBalances(user3.address, zlp.address)).eq(0)

    expect(await stakedZlpTracker.stakedAmounts(user3.address)).eq(0)
    expect(await stakedZlpTracker.depositBalances(user3.address, feeZlpTracker.address)).eq(0)
    expect(await stakedZlpTracker.balanceOf(user3.address)).eq(expandDecimals(2991, 17))

    await expect(rewardRouter.connect(user1).unstakeAndRedeemZlp(
      bnb.address,
      expandDecimals(2991, 17),
      "0",
      user1.address,
      [randomBytes(1)],{value:expandDecimals(1,1)}
    )).to.be.revertedWith("RewardTracker: burn amount exceeds balance")

    await zlpBalance.connect(user3).approve(user2.address, expandDecimals(3000, 17))

    await expect(zlpBalance.connect(user2).transferFrom(user3.address, user1.address, expandDecimals(2992, 17)))
      .to.be.revertedWith("RewardTracker: transfer amount exceeds balance")

    await zlpBalance.connect(user2).transferFrom(user3.address, user1.address, expandDecimals(2991, 17))

    expect(await bnb.balanceOf(user1.address)).eq(0)

    await rewardRouter.connect(user1).unstakeAndRedeemZlp(
      bnb.address,
      expandDecimals(2991, 17),
      "0",
      user1.address,
      [randomBytes(1)],{value:expandDecimals(1,1)}
    )

    expect(await bnb.balanceOf(user1.address)).eq("994009000000000000")
  })
})
