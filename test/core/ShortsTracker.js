const { expect, use } = require("chai")
const { solidity } = require("ethereum-waffle")
const { toUsd } = require("../shared/units")
const { deployContract, deployVault, deployProxyBlockInfo, deployVaultPriceFeed, deployZlpManager } = require("../shared/fixtures")

use(solidity)

describe("ShortsTracker", function () {
  const provider = waffle.provider
  const [wallet, user0, user1, _, __, eth, btc] = provider.getWallets()
  let shortsTracker
  let vault

  beforeEach(async function () {
      const proxyBlockInfo = await deployProxyBlockInfo();
      const vaultDelegatePartOne = await deployContract("VaultDelegatePartOne", [])
      const vaultDelegatePartTwo = await deployContract("VaultDelegatePartTwo", [])
      const vaultDelegatePartThree = await deployContract("VaultDelegatePartThree", [])
      vault = await deployContract("Vault", [vaultDelegatePartOne.address, vaultDelegatePartTwo.address, vaultDelegatePartThree.address, proxyBlockInfo.address])
    shortsTracker = await deployContract("ShortsTracker", [vault.address])
    await shortsTracker.setHandler(user0.address, true)
  })

  it("inits", async function () {
    expect(await shortsTracker.gov()).to.eq(wallet.address)
    expect(await shortsTracker.vault()).to.eq(vault.address)
  })

  it("setIsGlobalShortDataReady", async function () {
    expect(await shortsTracker.isGlobalShortDataReady()).to.be.false

    await expect(shortsTracker.connect(user1).setIsGlobalShortDataReady(true)).to.be.revertedWith("Governable: forbidden")

    await shortsTracker.setIsGlobalShortDataReady(true)
    expect(await shortsTracker.isGlobalShortDataReady()).to.be.true

    await shortsTracker.setIsGlobalShortDataReady(false)
    expect(await shortsTracker.isGlobalShortDataReady()).to.be.false
  })

  it("setInitData", async function () {
    await expect(shortsTracker.connect(user1).setInitData([], [])).to.be.revertedWith("Governable: forbidden")

    expect(await shortsTracker.globalShortAveragePrices(eth.address)).to.eq(0)
    expect(await shortsTracker.globalShortAveragePrices(btc.address)).to.eq(0)

    shortsTracker.setInitData([eth.address, btc.address], [100, 200])

    expect(await shortsTracker.globalShortAveragePrices(eth.address)).to.eq(100)
    expect(await shortsTracker.globalShortAveragePrices(btc.address)).to.eq(200)
  })
})
