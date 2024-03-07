const { expect, use } = require("chai")
const { solidity } = require("ethereum-waffle")
const { deployContract, deployVault, deployProxyBlockInfo, deployVaultPriceFeed } = require("../../shared/fixtures")
const { expandDecimals, getBlockTime, increaseTime, mineBlock, reportGasUsed } = require("../../shared/utilities")
const { toChainlinkPrice } = require("../../shared/chainlink")
const { toUsd, toNormalizedPrice } = require("../../shared/units")
const { initVault, getBnbConfig, getBtcConfig, getDaiConfig } = require("./helpers")

describe("VaultUtils", function () {
  const provider = waffle.provider
  const [wallet, user0] = provider.getWallets()
  let vault
  let vaultUtils
  let vaultPriceFeed
  let usdg
  let router
  let eth

  beforeEach(async () => {
    eth = await deployContract("Token", [])

    vault = await deployVault()
    usdg = await deployContract("USDG", [vault.address])
    router = await deployContract("Router", [vault.address, usdg.address, eth.address,pyth.address])
    vaultPriceFeed = await deployVaultPriceFeed()

    const _ = await initVault(vault, router, usdg, vaultPriceFeed)
    vaultUtils = _.vaultUtils
  })
})
