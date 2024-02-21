const { expect, use } = require("chai")
const { solidity } = require("ethereum-waffle")
const { deployContract, deployRewardDistributor, deployBonusDistributor } = require("../shared/fixtures")
const { expandDecimals, getBlockTime, increaseTime, mineBlock, reportGasUsed, print } = require("../shared/utilities")
const { toChainlinkPrice } = require("../shared/chainlink")
const { toUsd, toNormalizedPrice } = require("../shared/units")

use(solidity)

describe("BonusDistributor", function () {
  const provider = waffle.provider
  const [wallet, rewardRouter, user0, user1, user2, user3] = provider.getWallets()
  let zke
  let esZke
  let bnZke
  let stakedZkeTracker
  let stakedZkeDistributor
  let bonusZkeTracker
  let bonusZkeDistributor

  beforeEach(async () => {
    zke = await deployContract("ZKE", []);
    esZke = await deployContract("EsZKE", []);
    bnZke = await deployContract("MintableBaseToken", ["Bonus ZKE", "bnZKE", 0]);

    stakedZkeTracker = await deployContract("RewardTracker", ["Staked ZKE", "stZKE"])
    stakedZkeDistributor = await deployRewardDistributor([esZke.address, stakedZkeTracker.address])
    await stakedZkeDistributor.updateLastDistributionTime()

    bonusZkeTracker = await deployContract("RewardTracker", ["Staked + Bonus ZKE", "sbZKE"])
    bonusZkeDistributor = await deployBonusDistributor([bnZke.address, bonusZkeTracker.address])
    await bonusZkeDistributor.updateLastDistributionTime()

    await stakedZkeTracker.initialize([zke.address, esZke.address], stakedZkeDistributor.address)
    await bonusZkeTracker.initialize([stakedZkeTracker.address], bonusZkeDistributor.address)

    await stakedZkeTracker.setInPrivateTransferMode(true)
    await stakedZkeTracker.setInPrivateStakingMode(true)
    await bonusZkeTracker.setInPrivateTransferMode(true)
    await bonusZkeTracker.setInPrivateStakingMode(true)

    await stakedZkeTracker.setHandler(rewardRouter.address, true)
    await stakedZkeTracker.setHandler(bonusZkeTracker.address, true)
    await bonusZkeTracker.setHandler(rewardRouter.address, true)
    await bonusZkeDistributor.setBonusMultiplier(10000)
  })

  it("distributes bonus", async () => {
    await esZke.setMinter(wallet.address, true)
    await esZke.mint(stakedZkeDistributor.address, expandDecimals(50000, 18))
    await bnZke.setMinter(wallet.address, true)
    await bnZke.mint(bonusZkeDistributor.address, expandDecimals(1500, 18))
    await stakedZkeDistributor.setTokensPerInterval("20667989410000000") // 0.02066798941 esZke per second
    await zke.setMinter(wallet.address, true)
    await zke.mint(user0.address, expandDecimals(1000, 18))

    await zke.connect(user0).approve(stakedZkeTracker.address, expandDecimals(1001, 18))
    await expect(stakedZkeTracker.connect(rewardRouter).stakeForAccount(user0.address, user0.address, zke.address, expandDecimals(1001, 18)))
      .to.be.revertedWith("BaseToken: transfer amount exceeds balance")
    await stakedZkeTracker.connect(rewardRouter).stakeForAccount(user0.address, user0.address, zke.address, expandDecimals(1000, 18))
    await expect(bonusZkeTracker.connect(rewardRouter).stakeForAccount(user0.address, user0.address, stakedZkeTracker.address, expandDecimals(1001, 18)))
      .to.be.revertedWith("RewardTracker: transfer amount exceeds balance")
    await bonusZkeTracker.connect(rewardRouter).stakeForAccount(user0.address, user0.address, stakedZkeTracker.address, expandDecimals(1000, 18))

    await increaseTime(provider, 24 * 60 * 60)
    await mineBlock(provider)

    expect(await stakedZkeTracker.claimable(user0.address)).gt(expandDecimals(1785, 18)) // 50000 / 28 => ~1785
    expect(await stakedZkeTracker.claimable(user0.address)).lt(expandDecimals(1786, 18))
    expect(await bonusZkeTracker.claimable(user0.address)).gt("2730000000000000000") // 2.73, 1000 / 365 => ~2.74
    expect(await bonusZkeTracker.claimable(user0.address)).lt("2750000000000000000") // 2.75

    await esZke.mint(user1.address, expandDecimals(500, 18))
    await esZke.connect(user1).approve(stakedZkeTracker.address, expandDecimals(500, 18))
    await stakedZkeTracker.connect(rewardRouter).stakeForAccount(user1.address, user1.address, esZke.address, expandDecimals(500, 18))
    await bonusZkeTracker.connect(rewardRouter).stakeForAccount(user1.address, user1.address, stakedZkeTracker.address, expandDecimals(500, 18))

    await increaseTime(provider, 24 * 60 * 60)
    await mineBlock(provider)

    expect(await stakedZkeTracker.claimable(user0.address)).gt(expandDecimals(1785 + 1190, 18))
    expect(await stakedZkeTracker.claimable(user0.address)).lt(expandDecimals(1786 + 1191, 18))

    expect(await stakedZkeTracker.claimable(user1.address)).gt(expandDecimals(595, 18))
    expect(await stakedZkeTracker.claimable(user1.address)).lt(expandDecimals(596, 18))

    expect(await bonusZkeTracker.claimable(user0.address)).gt("5470000000000000000") // 5.47, 1000 / 365 * 2 => ~5.48
    expect(await bonusZkeTracker.claimable(user0.address)).lt("5490000000000000000") // 5.49

    expect(await bonusZkeTracker.claimable(user1.address)).gt("1360000000000000000") // 1.36, 500 / 365 => ~1.37
    expect(await bonusZkeTracker.claimable(user1.address)).lt("1380000000000000000") // 1.38
  })
})
