const { expect, use } = require("chai")
const { solidity } = require("ethereum-waffle")
const { deployContract, deployVester, deployBonusDistributor, deployRewardDistributor } = require("../shared/fixtures")
const { expandDecimals, getBlockTime, increaseTime, mineBlock, reportGasUsed, print } = require("../shared/utilities")
const { toChainlinkPrice } = require("../shared/chainlink")
const { toUsd, toNormalizedPrice } = require("../shared/units")

use(solidity)

const secondsPerYear = 365 * 24 * 60 * 60
const { AddressZero } = ethers.constants

describe("Vester", function () {
  const provider = waffle.provider
  const [wallet, user0, user1, user2, user3, user4] = provider.getWallets()
  let zke
  let esZke
  let bnZke
  let eth

  beforeEach(async () => {
    zke = await deployContract("ZKE", []);
    esZke = await deployContract("EsZKE", []);
    bnZke = await deployContract("MintableBaseToken", ["Bonus ZKE", "bnZKE", 0]);
    eth = await deployContract("Token", [])

    await esZke.setMinter(wallet.address, true)
    await zke.setMinter(wallet.address, true)
  })

  it("inits", async () => {
    const vester = await deployVester([
      "Vested ZKE",
      "veZKE",
      secondsPerYear,
      esZke.address,
      AddressZero,
      zke.address,
      AddressZero
    ])

    expect(await vester.name()).eq("Vested ZKE")
    expect(await vester.symbol()).eq("veZKE")
    expect(await vester.vestingDuration()).eq(secondsPerYear)
    expect(await vester.esToken()).eq(esZke.address)
    expect(await vester.pairToken()).eq(AddressZero)
    expect(await vester.claimableToken()).eq(zke.address)
    expect(await vester.rewardTracker()).eq(AddressZero)
    expect(await vester.hasPairToken()).eq(false)
    expect(await vester.hasRewardTracker()).eq(false)
    expect(await vester.hasMaxVestableAmount()).eq(false)
  })

  it("setTransferredAverageStakedAmounts", async () => {
    const vester = await deployVester([
      "Vested ZKE",
      "veZKE",
      secondsPerYear,
      esZke.address,
      AddressZero,
      zke.address,
      AddressZero
    ])

    await expect(vester.setTransferredAverageStakedAmounts(user0.address, 200))
      .to.be.revertedWith("Vester: forbidden")

    await vester.setHandler(wallet.address, true)

    expect(await vester.transferredAverageStakedAmounts(user0.address)).eq(0)
    await vester.setTransferredAverageStakedAmounts(user0.address, 200)
    expect(await vester.transferredAverageStakedAmounts(user0.address)).eq(200)
  })

  it("setTransferredCumulativeRewards", async () => {
    const vester = await deployVester([
      "Vested ZKE",
      "veZKE",
      secondsPerYear,
      esZke.address,
      AddressZero,
      zke.address,
      AddressZero
    ])

    await expect(vester.setTransferredCumulativeRewards(user0.address, 200))
      .to.be.revertedWith("Vester: forbidden")

    await vester.setHandler(wallet.address, true)

    expect(await vester.transferredCumulativeRewards(user0.address)).eq(0)
    await vester.setTransferredCumulativeRewards(user0.address, 200)
    expect(await vester.transferredCumulativeRewards(user0.address)).eq(200)
  })

  it("setCumulativeRewardDeductions", async () => {
    const vester = await deployVester([
      "Vested ZKE",
      "veZKE",
      secondsPerYear,
      esZke.address,
      AddressZero,
      zke.address,
      AddressZero
    ])

    await expect(vester.setCumulativeRewardDeductions(user0.address, 200))
      .to.be.revertedWith("Vester: forbidden")

    await vester.setHandler(wallet.address, true)

    expect(await vester.cumulativeRewardDeductions(user0.address)).eq(0)
    await vester.setCumulativeRewardDeductions(user0.address, 200)
    expect(await vester.cumulativeRewardDeductions(user0.address)).eq(200)
  })

  it("setBonusRewards", async () => {
    const vester = await deployVester([
      "Vested ZKE",
      "veZKE",
      secondsPerYear,
      esZke.address,
      AddressZero,
      zke.address,
      AddressZero
    ])

    await expect(vester.setBonusRewards(user0.address, 200))
      .to.be.revertedWith("Vester: forbidden")

    await vester.setHandler(wallet.address, true)

    expect(await vester.bonusRewards(user0.address)).eq(0)
    await vester.setBonusRewards(user0.address, 200)
    expect(await vester.bonusRewards(user0.address)).eq(200)
  })

  it("deposit, claim, withdraw", async () => {
    const vester = await deployVester([
      "Vested ZKE",
      "veZKE",
      secondsPerYear,
      esZke.address,
      AddressZero,
      zke.address,
      AddressZero
    ])
    await esZke.setMinter(vester.address, true)

    await expect(vester.connect(user0).deposit(0))
      .to.be.revertedWith("Vester: invalid _amount")

    await expect(vester.connect(user0).deposit(expandDecimals(1000, 18)))
      .to.be.revertedWith("BaseToken: transfer amount exceeds allowance")

    await esZke.connect(user0).approve(vester.address, expandDecimals(1000, 18))

    await expect(vester.connect(user0).deposit(expandDecimals(1000, 18)))
      .to.be.revertedWith("BaseToken: transfer amount exceeds balance")

    expect(await vester.balanceOf(user0.address)).eq(0)
    expect(await vester.getTotalVested(user0.address)).eq(0)
    expect(await vester.cumulativeClaimAmounts(user0.address)).eq(0)
    expect(await vester.claimedAmounts(user0.address)).eq(0)
    expect(await vester.claimable(user0.address)).eq(0)
    expect(await vester.pairAmounts(user0.address)).eq(0)
    expect(await vester.lastVestingTimes(user0.address)).eq(0)

    await esZke.mint(user0.address, expandDecimals(1000, 18))
    await vester.connect(user0).deposit(expandDecimals(1000, 18))

    let blockTime = await getBlockTime(provider)

    expect(await vester.balanceOf(user0.address)).eq(expandDecimals(1000, 18))
    expect(await vester.getTotalVested(user0.address)).eq(expandDecimals(1000, 18))
    expect(await vester.cumulativeClaimAmounts(user0.address)).eq(0)
    expect(await vester.claimedAmounts(user0.address)).eq(0)
    expect(await vester.claimable(user0.address)).eq(0)
    expect(await vester.pairAmounts(user0.address)).eq(0)
    expect(await vester.lastVestingTimes(user0.address)).eq(blockTime)

    await increaseTime(provider, 24 * 60 * 60)
    await mineBlock(provider)

    expect(await esZke.balanceOf(user0.address)).eq(0)
    expect(await zke.balanceOf(user0.address)).eq(0)
    expect(await vester.balanceOf(user0.address)).eq(expandDecimals(1000, 18))
    expect(await vester.getTotalVested(user0.address)).eq(expandDecimals(1000, 18))
    expect(await vester.cumulativeClaimAmounts(user0.address)).eq(0)
    expect(await vester.claimedAmounts(user0.address)).eq(0)
    expect(await vester.claimable(user0.address)).gt("2730000000000000000") // 1000 / 365 => ~2.739
    expect(await vester.claimable(user0.address)).lt("2750000000000000000")
    expect(await vester.pairAmounts(user0.address)).eq(0)
    expect(await vester.lastVestingTimes(user0.address)).eq(blockTime)

    await expect(vester.connect(user0).claim())
      .to.be.revertedWith("BaseToken: transfer amount exceeds balance")

    await zke.mint(vester.address, expandDecimals(2000, 18))

    await vester.connect(user0).claim()
    blockTime = await getBlockTime(provider)

    expect(await esZke.balanceOf(user0.address)).eq(0)
    expect(await zke.balanceOf(user0.address)).gt("2730000000000000000")
    expect(await zke.balanceOf(user0.address)).lt("2750000000000000000")

    let zkeAmount = await zke.balanceOf(user0.address)
    expect(await vester.balanceOf(user0.address)).eq(expandDecimals(1000, 18).sub(zkeAmount))

    expect(await vester.getTotalVested(user0.address)).eq(expandDecimals(1000, 18))
    expect(await vester.cumulativeClaimAmounts(user0.address)).eq(zkeAmount)
    expect(await vester.claimedAmounts(user0.address)).eq(zkeAmount)
    expect(await vester.claimable(user0.address)).eq(0)
    expect(await vester.pairAmounts(user0.address)).eq(0)
    expect(await vester.lastVestingTimes(user0.address)).eq(blockTime)

    await increaseTime(provider, 48 * 60 * 60)
    await mineBlock(provider)

    expect(await vester.cumulativeClaimAmounts(user0.address)).eq(zkeAmount)
    expect(await vester.claimedAmounts(user0.address)).eq(zkeAmount)
    expect(await vester.claimable(user0.address)).gt("5478000000000000000") // 1000 / 365 * 2 => ~5.479
    expect(await vester.claimable(user0.address)).lt("5480000000000000000")

    await increaseTime(provider, (parseInt(365 / 2 - 1)) * 24 * 60 * 60)
    await mineBlock(provider)

    expect(await vester.cumulativeClaimAmounts(user0.address)).eq(zkeAmount)
    expect(await vester.claimedAmounts(user0.address)).eq(zkeAmount)
    expect(await vester.claimable(user0.address)).gt(expandDecimals(500, 18)) // 1000 / 2 => 500
    expect(await vester.claimable(user0.address)).lt(expandDecimals(502, 18))

    await vester.connect(user0).claim()
    blockTime = await getBlockTime(provider)

    expect(await esZke.balanceOf(user0.address)).eq(0)
    expect(await zke.balanceOf(user0.address)).gt(expandDecimals(503, 18))
    expect(await zke.balanceOf(user0.address)).lt(expandDecimals(505, 18))

    zkeAmount = await zke.balanceOf(user0.address)
    expect(await vester.balanceOf(user0.address)).eq(expandDecimals(1000, 18).sub(zkeAmount))

    expect(await vester.getTotalVested(user0.address)).eq(expandDecimals(1000, 18))
    expect(await vester.cumulativeClaimAmounts(user0.address)).eq(zkeAmount)
    expect(await vester.claimedAmounts(user0.address)).eq(zkeAmount)
    expect(await vester.claimable(user0.address)).eq(0)
    expect(await vester.pairAmounts(user0.address)).eq(0)
    expect(await vester.lastVestingTimes(user0.address)).eq(blockTime)

    await increaseTime(provider, 24 * 60 * 60)
    await mineBlock(provider)

    // vesting rate should be the same even after claiming
    expect(await vester.claimable(user0.address)).gt("2730000000000000000") // 1000 / 365 => ~2.739
    expect(await vester.claimable(user0.address)).lt("2750000000000000000")

    await esZke.mint(user0.address, expandDecimals(500, 18))
    await esZke.connect(user0).approve(vester.address, expandDecimals(500, 18))
    await vester.connect(user0).deposit(expandDecimals(500, 18))

    await increaseTime(provider, 24 * 60 * 60)
    await mineBlock(provider)

    expect(await vester.claimable(user0.address)).gt("6840000000000000000") // 1000 / 365 + 1500 / 365 => 6.849
    expect(await vester.claimable(user0.address)).lt("6860000000000000000")

    expect(await esZke.balanceOf(user0.address)).eq(0)
    expect(await zke.balanceOf(user0.address)).eq(zkeAmount)

    await vester.connect(user0).withdraw()

    expect(await esZke.balanceOf(user0.address)).gt(expandDecimals(989, 18))
    expect(await esZke.balanceOf(user0.address)).lt(expandDecimals(990, 18))
    expect(await zke.balanceOf(user0.address)).gt(expandDecimals(510, 18))
    expect(await zke.balanceOf(user0.address)).lt(expandDecimals(512, 18))

    expect(await vester.balanceOf(user0.address)).eq(0)
    expect(await vester.getTotalVested(user0.address)).eq(0)
    expect(await vester.cumulativeClaimAmounts(user0.address)).eq(0)
    expect(await vester.claimedAmounts(user0.address)).eq(0)
    expect(await vester.claimable(user0.address)).eq(0)
    expect(await vester.pairAmounts(user0.address)).eq(0)
    expect(await vester.lastVestingTimes(user0.address)).eq(0)

    await esZke.connect(user0).approve(vester.address, expandDecimals(1000, 18))
    await esZke.mint(user0.address, expandDecimals(1000, 18))
    await vester.connect(user0).deposit(expandDecimals(1000, 18))
    blockTime = await getBlockTime(provider)

    await increaseTime(provider, 24 * 60 * 60)
    await mineBlock(provider)

    expect(await vester.balanceOf(user0.address)).eq(expandDecimals(1000, 18))
    expect(await vester.getTotalVested(user0.address)).eq(expandDecimals(1000, 18))
    expect(await vester.cumulativeClaimAmounts(user0.address)).eq(0)
    expect(await vester.claimedAmounts(user0.address)).eq(0)
    expect(await vester.claimable(user0.address)).gt("2730000000000000000") // 1000 / 365 => ~2.739
    expect(await vester.claimable(user0.address)).lt("2750000000000000000")
    expect(await vester.pairAmounts(user0.address)).eq(0)
    expect(await vester.lastVestingTimes(user0.address)).eq(blockTime)

    await vester.connect(user0).claim()
  })

  it("depositForAccount, claimForAccount", async () => {
    const vester = await deployVester([
      "Vested ZKE",
      "veZKE",
      secondsPerYear,
      esZke.address,
      AddressZero,
      zke.address,
      AddressZero
    ])
    await esZke.setMinter(vester.address, true)
    await vester.setHandler(wallet.address, true)

    await esZke.connect(user0).approve(vester.address, expandDecimals(1000, 18))

    expect(await vester.balanceOf(user0.address)).eq(0)
    expect(await vester.getTotalVested(user0.address)).eq(0)
    expect(await vester.cumulativeClaimAmounts(user0.address)).eq(0)
    expect(await vester.claimedAmounts(user0.address)).eq(0)
    expect(await vester.claimable(user0.address)).eq(0)
    expect(await vester.pairAmounts(user0.address)).eq(0)
    expect(await vester.lastVestingTimes(user0.address)).eq(0)

    await esZke.mint(user0.address, expandDecimals(1000, 18))

    await expect(vester.connect(user2).depositForAccount(user0.address, expandDecimals(1000, 18)))
      .to.be.revertedWith("Vester: forbidden")

    await vester.setHandler(user2.address, true)
    await vester.connect(user2).depositForAccount(user0.address, expandDecimals(1000, 18))

    let blockTime = await getBlockTime(provider)

    expect(await vester.balanceOf(user0.address)).eq(expandDecimals(1000, 18))
    expect(await vester.getTotalVested(user0.address)).eq(expandDecimals(1000, 18))
    expect(await vester.cumulativeClaimAmounts(user0.address)).eq(0)
    expect(await vester.claimedAmounts(user0.address)).eq(0)
    expect(await vester.claimable(user0.address)).eq(0)
    expect(await vester.pairAmounts(user0.address)).eq(0)
    expect(await vester.lastVestingTimes(user0.address)).eq(blockTime)

    await increaseTime(provider, 24 * 60 * 60)
    await mineBlock(provider)

    expect(await esZke.balanceOf(user0.address)).eq(0)
    expect(await zke.balanceOf(user0.address)).eq(0)
    expect(await vester.balanceOf(user0.address)).eq(expandDecimals(1000, 18))
    expect(await vester.getTotalVested(user0.address)).eq(expandDecimals(1000, 18))
    expect(await vester.cumulativeClaimAmounts(user0.address)).eq(0)
    expect(await vester.claimedAmounts(user0.address)).eq(0)
    expect(await vester.claimable(user0.address)).gt("2730000000000000000") // 1000 / 365 => ~2.739
    expect(await vester.claimable(user0.address)).lt("2750000000000000000")
    expect(await vester.pairAmounts(user0.address)).eq(0)
    expect(await vester.lastVestingTimes(user0.address)).eq(blockTime)

    await expect(vester.connect(user0).claim())
      .to.be.revertedWith("BaseToken: transfer amount exceeds balance")

    await zke.mint(vester.address, expandDecimals(2000, 18))

    await expect(vester.connect(user3).claimForAccount(user0.address, user4.address))
      .to.be.revertedWith("Vester: forbidden")

    await vester.setHandler(user3.address, true)

    await vester.connect(user3).claimForAccount(user0.address, user4.address)
    blockTime = await getBlockTime(provider)

    expect(await esZke.balanceOf(user4.address)).eq(0)
    expect(await zke.balanceOf(user4.address)).gt("2730000000000000000")
    expect(await zke.balanceOf(user4.address)).lt("2750000000000000000")

    expect(await esZke.balanceOf(user0.address)).eq(0)
    expect(await zke.balanceOf(user0.address)).eq(0)
    expect(await vester.balanceOf(user0.address)).gt(expandDecimals(996, 18))
    expect(await vester.balanceOf(user0.address)).lt(expandDecimals(998, 18))
    expect(await vester.getTotalVested(user0.address)).eq(expandDecimals(1000, 18))
    expect(await vester.cumulativeClaimAmounts(user0.address)).gt("2730000000000000000")
    expect(await vester.cumulativeClaimAmounts(user0.address)).lt("2750000000000000000")
    expect(await vester.claimedAmounts(user0.address)).gt("2730000000000000000")
    expect(await vester.claimedAmounts(user0.address)).lt("2750000000000000000")
    expect(await vester.claimable(user0.address)).eq(0)
    expect(await vester.pairAmounts(user0.address)).eq(0)
    expect(await vester.lastVestingTimes(user0.address)).eq(blockTime)
  })

  it("handles multiple deposits", async () => {
    const vester = await deployVester([
      "Vested ZKE",
      "veZKE",
      secondsPerYear,
      esZke.address,
      AddressZero,
      zke.address,
      AddressZero
    ])
    await esZke.setMinter(vester.address, true)
    await vester.setHandler(wallet.address, true)

    await esZke.connect(user0).approve(vester.address, expandDecimals(1000, 18))

    expect(await vester.balanceOf(user0.address)).eq(0)
    expect(await vester.getTotalVested(user0.address)).eq(0)
    expect(await vester.cumulativeClaimAmounts(user0.address)).eq(0)
    expect(await vester.claimedAmounts(user0.address)).eq(0)
    expect(await vester.claimable(user0.address)).eq(0)
    expect(await vester.pairAmounts(user0.address)).eq(0)
    expect(await vester.lastVestingTimes(user0.address)).eq(0)

    await esZke.mint(user0.address, expandDecimals(1000, 18))
    await vester.connect(user0).deposit(expandDecimals(1000, 18))

    let blockTime = await getBlockTime(provider)

    expect(await vester.balanceOf(user0.address)).eq(expandDecimals(1000, 18))
    expect(await vester.getTotalVested(user0.address)).eq(expandDecimals(1000, 18))
    expect(await vester.cumulativeClaimAmounts(user0.address)).eq(0)
    expect(await vester.claimedAmounts(user0.address)).eq(0)
    expect(await vester.claimable(user0.address)).eq(0)
    expect(await vester.pairAmounts(user0.address)).eq(0)
    expect(await vester.lastVestingTimes(user0.address)).eq(blockTime)

    await increaseTime(provider, 24 * 60 * 60)
    await mineBlock(provider)

    expect(await esZke.balanceOf(user0.address)).eq(0)
    expect(await zke.balanceOf(user0.address)).eq(0)
    expect(await vester.balanceOf(user0.address)).eq(expandDecimals(1000, 18))
    expect(await vester.getTotalVested(user0.address)).eq(expandDecimals(1000, 18))
    expect(await vester.cumulativeClaimAmounts(user0.address)).eq(0)
    expect(await vester.claimedAmounts(user0.address)).eq(0)
    expect(await vester.claimable(user0.address)).gt("2730000000000000000") // 1000 / 365 => ~2.739
    expect(await vester.claimable(user0.address)).lt("2750000000000000000")
    expect(await vester.pairAmounts(user0.address)).eq(0)
    expect(await vester.lastVestingTimes(user0.address)).eq(blockTime)

    await expect(vester.connect(user0).claim())
      .to.be.revertedWith("BaseToken: transfer amount exceeds balance")

    await zke.mint(vester.address, expandDecimals(2000, 18))

    await increaseTime(provider, 24 * 60 * 60)
    await mineBlock(provider)

    expect(await vester.balanceOf(user0.address)).eq(expandDecimals(1000, 18))

    await esZke.mint(user0.address, expandDecimals(500, 18))
    await esZke.connect(user0).approve(vester.address, expandDecimals(500, 18))
    await vester.connect(user0).deposit(expandDecimals(500, 18))
    blockTime = await getBlockTime(provider)

    expect(await vester.balanceOf(user0.address)).gt(expandDecimals(1494, 18))
    expect(await vester.balanceOf(user0.address)).lt(expandDecimals(1496, 18))
    expect(await vester.getTotalVested(user0.address)).eq(expandDecimals(1500, 18))
    expect(await vester.cumulativeClaimAmounts(user0.address)).gt("5470000000000000000") // 5.47, 1000 / 365 * 2 => ~5.48
    expect(await vester.cumulativeClaimAmounts(user0.address)).lt("5490000000000000000") // 5.49
    expect(await vester.claimedAmounts(user0.address)).eq(0)
    expect(await vester.claimable(user0.address)).gt("5470000000000000000")
    expect(await vester.claimable(user0.address)).lt("5490000000000000000")
    expect(await vester.pairAmounts(user0.address)).eq(0)
    expect(await vester.lastVestingTimes(user0.address)).eq(blockTime)

    await vester.connect(user0).withdraw()

    expect(await esZke.balanceOf(user0.address)).gt(expandDecimals(1494, 18))
    expect(await esZke.balanceOf(user0.address)).lt(expandDecimals(1496, 18))
    expect(await zke.balanceOf(user0.address)).gt("5470000000000000000")
    expect(await zke.balanceOf(user0.address)).lt("5490000000000000000")
    expect(await vester.balanceOf(user0.address)).eq(0)
    expect(await vester.getTotalVested(user0.address)).eq(0)
    expect(await vester.cumulativeClaimAmounts(user0.address)).eq(0) // 5.47, 1000 / 365 * 2 => ~5.48
    expect(await vester.claimedAmounts(user0.address)).eq(0)
    expect(await vester.claimable(user0.address)).eq(0)
    expect(await vester.pairAmounts(user0.address)).eq(0)
    expect(await vester.lastVestingTimes(user0.address)).eq(0)
  })

  it("handles pairing", async () => {
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

    await stakedZkeTracker.setInPrivateTransferMode(true)
    await stakedZkeTracker.setInPrivateStakingMode(true)
    await bonusZkeTracker.setInPrivateTransferMode(true)
    await bonusZkeTracker.setInPrivateStakingMode(true)
    await bonusZkeTracker.setInPrivateClaimingMode(true)
    await feeZkeTracker.setInPrivateTransferMode(true)
    await feeZkeTracker.setInPrivateStakingMode(true)

    await esZke.setMinter(wallet.address, true)
    await esZke.mint(stakedZkeDistributor.address, expandDecimals(50000 * 12, 18))
    await stakedZkeDistributor.setTokensPerInterval("20667989410000000") // 0.02066798941 esZke per second

    const rewardRouter = await deployContract("RewardRouter", [])
    await rewardRouter.initialize(
      eth.address,
      zke.address,
      esZke.address,
      bnZke.address,
      AddressZero,
      stakedZkeTracker.address,
      bonusZkeTracker.address,
      feeZkeTracker.address,
      AddressZero,
      AddressZero,
      AddressZero
    )

    // allow rewardRouter to stake in stakedZkeTracker
    await stakedZkeTracker.setHandler(rewardRouter.address, true)
    // allow bonusZkeTracker to stake stakedZkeTracker
    await stakedZkeTracker.setHandler(bonusZkeTracker.address, true)
    // allow rewardRouter to stake in bonusZkeTracker
    await bonusZkeTracker.setHandler(rewardRouter.address, true)
    // allow bonusZkeTracker to stake feeZkeTracker
    await bonusZkeTracker.setHandler(feeZkeTracker.address, true)
    await bonusZkeDistributor.setBonusMultiplier(10000)
    // allow rewardRouter to stake in feeZkeTracker
    await feeZkeTracker.setHandler(rewardRouter.address, true)
    // allow stakedZkeTracker to stake esZke
    await esZke.setHandler(stakedZkeTracker.address, true)
    // allow feeZkeTracker to stake bnZke
    await bnZke.setHandler(feeZkeTracker.address, true)
    // allow rewardRouter to burn bnZke
    await bnZke.setMinter(rewardRouter.address, true)

    const vester = await deployVester([
      "Vested ZKE",
      "veZKE",
      secondsPerYear,
      esZke.address,
      feeZkeTracker.address,
      zke.address,
      stakedZkeTracker.address
    ])
    await esZke.setMinter(vester.address, true)
    await vester.setHandler(wallet.address, true)

    expect(await vester.name()).eq("Vested ZKE")
    expect(await vester.symbol()).eq("veZKE")
    expect(await vester.vestingDuration()).eq(secondsPerYear)
    expect(await vester.esToken()).eq(esZke.address)
    expect(await vester.pairToken()).eq(feeZkeTracker.address)
    expect(await vester.claimableToken()).eq(zke.address)
    expect(await vester.rewardTracker()).eq(stakedZkeTracker.address)
    expect(await vester.hasPairToken()).eq(true)
    expect(await vester.hasRewardTracker()).eq(true)
    expect(await vester.hasMaxVestableAmount()).eq(true)

    // allow vester to transfer feeZkeTracker tokens
    await feeZkeTracker.setHandler(vester.address, true)
    // allow vester to transfer esZke tokens
    await esZke.setHandler(vester.address, true)

    await zke.mint(vester.address, expandDecimals(2000, 18))

    await zke.mint(user0.address, expandDecimals(1000, 18))
    await zke.mint(user1.address, expandDecimals(500, 18))
    await zke.connect(user0).approve(stakedZkeTracker.address, expandDecimals(1000, 18))
    await zke.connect(user1).approve(stakedZkeTracker.address, expandDecimals(500, 18))

    await rewardRouter.connect(user0).stakeZke(expandDecimals(1000, 18))
    await rewardRouter.connect(user1).stakeZke(expandDecimals(500, 18))

    await increaseTime(provider, 24 * 60 * 60)
    await mineBlock(provider)

    expect(await stakedZkeTracker.claimable(user0.address)).gt(expandDecimals(1190, 18))
    expect(await stakedZkeTracker.claimable(user0.address)).lt(expandDecimals(1191, 18))
    expect(await stakedZkeTracker.claimable(user1.address)).gt(expandDecimals(594, 18))
    expect(await stakedZkeTracker.claimable(user1.address)).lt(expandDecimals(596, 18))

    expect(await vester.getMaxVestableAmount(user0.address)).eq(0)
    expect(await vester.getMaxVestableAmount(user1.address)).eq(0)

    expect(await esZke.balanceOf(user0.address)).eq(0)
    expect(await esZke.balanceOf(user1.address)).eq(0)
    expect(await esZke.balanceOf(user2.address)).eq(0)
    expect(await esZke.balanceOf(user3.address)).eq(0)

    await stakedZkeTracker.connect(user0).claim(user2.address)
    await stakedZkeTracker.connect(user1).claim(user3.address)

    expect(await esZke.balanceOf(user0.address)).eq(0)
    expect(await esZke.balanceOf(user1.address)).eq(0)
    expect(await esZke.balanceOf(user2.address)).gt(expandDecimals(1190, 18))
    expect(await esZke.balanceOf(user2.address)).lt(expandDecimals(1191, 18))
    expect(await esZke.balanceOf(user3.address)).gt(expandDecimals(594, 18))
    expect(await esZke.balanceOf(user3.address)).lt(expandDecimals(596, 18))

    expect(await vester.getMaxVestableAmount(user0.address)).gt(expandDecimals(1190, 18))
    expect(await vester.getMaxVestableAmount(user0.address)).lt(expandDecimals(1191, 18))
    expect(await vester.getMaxVestableAmount(user1.address)).gt(expandDecimals(594, 18))
    expect(await vester.getMaxVestableAmount(user1.address)).lt(expandDecimals(596, 18))
    expect(await vester.getMaxVestableAmount(user2.address)).eq(0)
    expect(await vester.getMaxVestableAmount(user3.address)).eq(0)

    expect(await vester.getPairAmount(user0.address, expandDecimals(1, 18))).gt("830000000000000000") // 0.83, 1000 / 1190 => ~0.84
    expect(await vester.getPairAmount(user0.address, expandDecimals(1, 18))).lt("850000000000000000") // 0.85
    expect(await vester.getPairAmount(user1.address, expandDecimals(1, 18))).gt("830000000000000000") // 0.83, 500 / 595 => ~0.84
    expect(await vester.getPairAmount(user1.address, expandDecimals(1, 18))).lt("850000000000000000") // 0.85
    expect(await vester.getPairAmount(user2.address, expandDecimals(1, 18))).eq(0)
    expect(await vester.getPairAmount(user3.address, expandDecimals(1, 18))).eq(0)

    await increaseTime(provider, 24 * 60 * 60)
    await mineBlock(provider)

    await stakedZkeTracker.connect(user0).claim(user2.address)
    await stakedZkeTracker.connect(user1).claim(user3.address)

    expect(await vester.getMaxVestableAmount(user0.address)).gt(expandDecimals(2380, 18))
    expect(await vester.getMaxVestableAmount(user0.address)).lt(expandDecimals(2382, 18))
    expect(await vester.getMaxVestableAmount(user1.address)).gt(expandDecimals(1189, 18))
    expect(await vester.getMaxVestableAmount(user1.address)).lt(expandDecimals(1191, 18))

    expect(await vester.getPairAmount(user0.address, expandDecimals(1, 18))).gt("410000000000000000") // 0.41, 1000 / 2380 => ~0.42
    expect(await vester.getPairAmount(user0.address, expandDecimals(1, 18))).lt("430000000000000000") // 0.43
    expect(await vester.getPairAmount(user1.address, expandDecimals(1, 18))).gt("410000000000000000") // 0.41, 1000 / 2380 => ~0.42
    expect(await vester.getPairAmount(user1.address, expandDecimals(1, 18))).lt("430000000000000000") // 0.43

    await esZke.mint(user0.address, expandDecimals(2385, 18))
    await expect(vester.connect(user0).deposit(expandDecimals(2385, 18)))
      .to.be.revertedWith("RewardTracker: transfer amount exceeds balance")

    await zke.mint(user0.address, expandDecimals(500, 18))
    await zke.connect(user0).approve(stakedZkeTracker.address, expandDecimals(500, 18))
    await rewardRouter.connect(user0).stakeZke(expandDecimals(500, 18))

    await expect(vester.connect(user0).deposit(expandDecimals(2385, 18)))
      .to.be.revertedWith("Vester: max vestable amount exceeded")

    await zke.mint(user2.address, expandDecimals(1, 18))
    await expect(vester.connect(user2).deposit(expandDecimals(1, 18)))
      .to.be.revertedWith("Vester: max vestable amount exceeded")

    expect(await esZke.balanceOf(user0.address)).eq(expandDecimals(2385, 18))
    expect(await esZke.balanceOf(vester.address)).eq(0)
    expect(await feeZkeTracker.balanceOf(user0.address)).eq(expandDecimals(1500, 18))
    expect(await feeZkeTracker.balanceOf(vester.address)).eq(0)

    await vester.connect(user0).deposit(expandDecimals(2380, 18))

    expect(await esZke.balanceOf(user0.address)).eq(expandDecimals(5, 18))
    expect(await esZke.balanceOf(vester.address)).eq(expandDecimals(2380, 18))
    expect(await feeZkeTracker.balanceOf(user0.address)).gt(expandDecimals(499, 18))
    expect(await feeZkeTracker.balanceOf(user0.address)).lt(expandDecimals(501, 18))
    expect(await feeZkeTracker.balanceOf(vester.address)).gt(expandDecimals(999, 18))
    expect(await feeZkeTracker.balanceOf(vester.address)).lt(expandDecimals(1001, 18))

    await rewardRouter.connect(user1).unstakeZke(expandDecimals(499, 18))

    await increaseTime(provider, 24 * 60 * 60)
    await mineBlock(provider)

    await stakedZkeTracker.connect(user0).claim(user2.address)
    await stakedZkeTracker.connect(user1).claim(user3.address)

    expect(await vester.getMaxVestableAmount(user0.address)).gt(expandDecimals(4164, 18))
    expect(await vester.getMaxVestableAmount(user0.address)).lt(expandDecimals(4166, 18))
    expect(await vester.getMaxVestableAmount(user1.address)).gt(expandDecimals(1190, 18))
    expect(await vester.getMaxVestableAmount(user1.address)).lt(expandDecimals(1192, 18))

    // (1000 * 2380 / 4164) + (1500 * 1784 / 4164) => 1214.21709894
    // 1214.21709894 / 4164 => ~0.29

    expect(await vester.getPairAmount(user0.address, expandDecimals(1, 18))).gt("280000000000000000") // 0.28
    expect(await vester.getPairAmount(user0.address, expandDecimals(1, 18))).lt("300000000000000000") // 0.30
    expect(await vester.getPairAmount(user1.address, expandDecimals(1, 18))).gt("410000000000000000") // 0.41, 1000 / 2380 => ~0.42
    expect(await vester.getPairAmount(user1.address, expandDecimals(1, 18))).lt("430000000000000000") // 0.43

    await increaseTime(provider, 30 * 24 * 60 * 60)
    await mineBlock(provider)

    await vester.connect(user0).withdraw()

    expect(await feeZkeTracker.balanceOf(user0.address)).eq(expandDecimals(1500, 18))
    expect(await zke.balanceOf(user0.address)).gt(expandDecimals(201, 18)) // 2380 / 12 = ~198
    expect(await zke.balanceOf(user0.address)).lt(expandDecimals(203, 18))
    expect(await esZke.balanceOf(user0.address)).gt(expandDecimals(2182, 18)) // 5 + 2380 - 202  = 2183
    expect(await esZke.balanceOf(user0.address)).lt(expandDecimals(2183, 18))
  })

  it("handles existing pair tokens", async () => {
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

    await stakedZkeTracker.setInPrivateTransferMode(true)
    await stakedZkeTracker.setInPrivateStakingMode(true)
    await bonusZkeTracker.setInPrivateTransferMode(true)
    await bonusZkeTracker.setInPrivateStakingMode(true)
    await bonusZkeTracker.setInPrivateClaimingMode(true)
    await feeZkeTracker.setInPrivateTransferMode(true)
    await feeZkeTracker.setInPrivateStakingMode(true)

    await esZke.setMinter(wallet.address, true)
    await esZke.mint(stakedZkeDistributor.address, expandDecimals(50000 * 12, 18))
    await stakedZkeDistributor.setTokensPerInterval("20667989410000000") // 0.02066798941 esZke per second

    const rewardRouter = await deployContract("RewardRouter", [])
    await rewardRouter.initialize(
      eth.address,
      zke.address,
      esZke.address,
      bnZke.address,
      AddressZero,
      stakedZkeTracker.address,
      bonusZkeTracker.address,
      feeZkeTracker.address,
      AddressZero,
      AddressZero,
      AddressZero
    )

    // allow rewardRouter to stake in stakedZkeTracker
    await stakedZkeTracker.setHandler(rewardRouter.address, true)
    // allow bonusZkeTracker to stake stakedZkeTracker
    await stakedZkeTracker.setHandler(bonusZkeTracker.address, true)
    // allow rewardRouter to stake in bonusZkeTracker
    await bonusZkeTracker.setHandler(rewardRouter.address, true)
    // allow bonusZkeTracker to stake feeZkeTracker
    await bonusZkeTracker.setHandler(feeZkeTracker.address, true)
    await bonusZkeDistributor.setBonusMultiplier(10000)
    // allow rewardRouter to stake in feeZkeTracker
    await feeZkeTracker.setHandler(rewardRouter.address, true)
    // allow stakedZkeTracker to stake esZke
    await esZke.setHandler(stakedZkeTracker.address, true)
    // allow feeZkeTracker to stake bnZke
    await bnZke.setHandler(feeZkeTracker.address, true)
    // allow rewardRouter to burn bnZke
    await bnZke.setMinter(rewardRouter.address, true)

    const vester = await deployVester([
      "Vested ZKE",
      "veZKE",
      secondsPerYear,
      esZke.address,
      feeZkeTracker.address,
      zke.address,
      stakedZkeTracker.address
    ])
    await esZke.setMinter(vester.address, true)
    await vester.setHandler(wallet.address, true)

    expect(await vester.name()).eq("Vested ZKE")
    expect(await vester.symbol()).eq("veZKE")
    expect(await vester.vestingDuration()).eq(secondsPerYear)
    expect(await vester.esToken()).eq(esZke.address)
    expect(await vester.pairToken()).eq(feeZkeTracker.address)
    expect(await vester.claimableToken()).eq(zke.address)
    expect(await vester.rewardTracker()).eq(stakedZkeTracker.address)
    expect(await vester.hasPairToken()).eq(true)
    expect(await vester.hasRewardTracker()).eq(true)
    expect(await vester.hasMaxVestableAmount()).eq(true)

    // allow vester to transfer feeZkeTracker tokens
    await feeZkeTracker.setHandler(vester.address, true)
    // allow vester to transfer esZke tokens
    await esZke.setHandler(vester.address, true)

    await zke.mint(vester.address, expandDecimals(2000, 18))

    await zke.mint(user0.address, expandDecimals(1000, 18))
    await zke.mint(user1.address, expandDecimals(500, 18))
    await zke.connect(user0).approve(stakedZkeTracker.address, expandDecimals(1000, 18))
    await zke.connect(user1).approve(stakedZkeTracker.address, expandDecimals(500, 18))

    await rewardRouter.connect(user0).stakeZke(expandDecimals(1000, 18))
    await rewardRouter.connect(user1).stakeZke(expandDecimals(500, 18))

    await increaseTime(provider, 24 * 60 * 60)
    await mineBlock(provider)

    expect(await stakedZkeTracker.claimable(user0.address)).gt(expandDecimals(1190, 18))
    expect(await stakedZkeTracker.claimable(user0.address)).lt(expandDecimals(1191, 18))
    expect(await stakedZkeTracker.claimable(user1.address)).gt(expandDecimals(594, 18))
    expect(await stakedZkeTracker.claimable(user1.address)).lt(expandDecimals(596, 18))

    expect(await vester.getMaxVestableAmount(user0.address)).eq(0)
    expect(await vester.getMaxVestableAmount(user1.address)).eq(0)

    expect(await esZke.balanceOf(user0.address)).eq(0)
    expect(await esZke.balanceOf(user1.address)).eq(0)
    expect(await esZke.balanceOf(user2.address)).eq(0)
    expect(await esZke.balanceOf(user3.address)).eq(0)

    await stakedZkeTracker.connect(user0).claim(user2.address)
    await stakedZkeTracker.connect(user1).claim(user3.address)

    expect(await esZke.balanceOf(user0.address)).eq(0)
    expect(await esZke.balanceOf(user1.address)).eq(0)
    expect(await esZke.balanceOf(user2.address)).gt(expandDecimals(1190, 18))
    expect(await esZke.balanceOf(user2.address)).lt(expandDecimals(1191, 18))
    expect(await esZke.balanceOf(user3.address)).gt(expandDecimals(594, 18))
    expect(await esZke.balanceOf(user3.address)).lt(expandDecimals(596, 18))

    expect(await vester.getMaxVestableAmount(user0.address)).gt(expandDecimals(1190, 18))
    expect(await vester.getMaxVestableAmount(user0.address)).lt(expandDecimals(1191, 18))
    expect(await vester.getMaxVestableAmount(user1.address)).gt(expandDecimals(594, 18))
    expect(await vester.getMaxVestableAmount(user1.address)).lt(expandDecimals(596, 18))
    expect(await vester.getMaxVestableAmount(user2.address)).eq(0)
    expect(await vester.getMaxVestableAmount(user3.address)).eq(0)

    expect(await vester.getPairAmount(user0.address, expandDecimals(1, 18))).gt("830000000000000000") // 0.83, 1000 / 1190 => ~0.84
    expect(await vester.getPairAmount(user0.address, expandDecimals(1, 18))).lt("850000000000000000") // 0.85
    expect(await vester.getPairAmount(user1.address, expandDecimals(1, 18))).gt("830000000000000000") // 0.83, 500 / 595 => ~0.84
    expect(await vester.getPairAmount(user1.address, expandDecimals(1, 18))).lt("850000000000000000") // 0.85
    expect(await vester.getPairAmount(user2.address, expandDecimals(1, 18))).eq(0)
    expect(await vester.getPairAmount(user3.address, expandDecimals(1, 18))).eq(0)

    await increaseTime(provider, 24 * 60 * 60)
    await mineBlock(provider)

    await stakedZkeTracker.connect(user0).claim(user2.address)
    await stakedZkeTracker.connect(user1).claim(user3.address)

    expect(await esZke.balanceOf(user2.address)).gt(expandDecimals(2380, 18))
    expect(await esZke.balanceOf(user2.address)).lt(expandDecimals(2382, 18))
    expect(await esZke.balanceOf(user3.address)).gt(expandDecimals(1189, 18))
    expect(await esZke.balanceOf(user3.address)).lt(expandDecimals(1191, 18))

    expect(await vester.getMaxVestableAmount(user0.address)).gt(expandDecimals(2380, 18))
    expect(await vester.getMaxVestableAmount(user0.address)).lt(expandDecimals(2382, 18))
    expect(await vester.getMaxVestableAmount(user1.address)).gt(expandDecimals(1189, 18))
    expect(await vester.getMaxVestableAmount(user1.address)).lt(expandDecimals(1191, 18))

    expect(await vester.getPairAmount(user0.address, expandDecimals(1, 18))).gt("410000000000000000") // 0.41, 1000 / 2380 => ~0.42
    expect(await vester.getPairAmount(user0.address, expandDecimals(1, 18))).lt("430000000000000000") // 0.43
    expect(await vester.getPairAmount(user1.address, expandDecimals(1, 18))).gt("410000000000000000") // 0.41, 1000 / 2380 => ~0.42
    expect(await vester.getPairAmount(user1.address, expandDecimals(1, 18))).lt("430000000000000000") // 0.43

    expect(await vester.getPairAmount(user0.address, expandDecimals(2380, 18))).gt(expandDecimals(999, 18))
    expect(await vester.getPairAmount(user0.address, expandDecimals(2380, 18))).lt(expandDecimals(1000, 18))
    expect(await vester.getPairAmount(user1.address, expandDecimals(1189, 18))).gt(expandDecimals(499, 18))
    expect(await vester.getPairAmount(user1.address, expandDecimals(1189, 18))).lt(expandDecimals(500, 18))

    expect(await feeZkeTracker.balanceOf(user0.address)).eq(expandDecimals(1000, 18))
    await esZke.mint(user0.address, expandDecimals(2380, 18))
    await vester.connect(user0).deposit(expandDecimals(2380, 18))

    expect(await feeZkeTracker.balanceOf(user0.address)).gt(0)
    expect(await feeZkeTracker.balanceOf(user0.address)).lt(expandDecimals(1, 18))

    await increaseTime(provider, 24 * 60 * 60)
    await mineBlock(provider)

    expect(await stakedZkeTracker.claimable(user0.address)).gt(expandDecimals(1190, 18))
    expect(await stakedZkeTracker.claimable(user0.address)).lt(expandDecimals(1191, 18))

    expect(await vester.getMaxVestableAmount(user0.address)).gt(expandDecimals(2380, 18))
    expect(await vester.getMaxVestableAmount(user0.address)).lt(expandDecimals(2382, 18))

    await stakedZkeTracker.connect(user0).claim(user2.address)

    expect(await vester.getMaxVestableAmount(user0.address)).gt(expandDecimals(3571, 18))
    expect(await vester.getMaxVestableAmount(user0.address)).lt(expandDecimals(3572, 18))

    expect(await vester.getPairAmount(user0.address, expandDecimals(3570, 18))).gt(expandDecimals(999, 18))
    expect(await vester.getPairAmount(user0.address, expandDecimals(3570, 18))).lt(expandDecimals(1000, 18))

    const feeZkeTrackerBalance = await feeZkeTracker.balanceOf(user0.address)

    await esZke.mint(user0.address, expandDecimals(1190, 18))
    await vester.connect(user0).deposit(expandDecimals(1190, 18))

    expect(feeZkeTrackerBalance).eq(await feeZkeTracker.balanceOf(user0.address))

    await expect(rewardRouter.connect(user0).unstakeZke(expandDecimals(2, 18)))
      .to.be.revertedWith("RewardTracker: burn amount exceeds balance")

    await vester.connect(user0).withdraw()

    await rewardRouter.connect(user0).unstakeZke(expandDecimals(2, 18))
  })
})
