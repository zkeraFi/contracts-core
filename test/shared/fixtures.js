const { ethers } = require("hardhat");
const { expandDecimals } = require("./utilities");
const { toUsd } = require("./units");
const { errors } = require("../core/Vault/helpers");

async function deployContract(name, args, options) {
  const contractFactory = await ethers.getContractFactory(name, options)
  return await contractFactory.deploy(...args)
}

async function deployContractWithBlockInfo(name, args, options) {
  const proxyBlockInfo = await deployProxyBlockInfo();
  const contractFactory = await ethers.getContractFactory(name, options);
  return await contractFactory.deploy(...args, proxyBlockInfo.address);
}

async function deployVault() {
  const proxyBlockInfo = await deployProxyBlockInfo();
  const vaultDelegatePartOne = await deployContract("VaultDelegatePartOne", [])
  const vaultDelegatePartTwo = await deployContract("VaultDelegatePartTwo", [])
  const vaultDelegatePartThree = await deployContract("VaultDelegatePartThree", [])
  const vault = await deployContract("Vault", [vaultDelegatePartOne.address, vaultDelegatePartTwo.address, vaultDelegatePartThree.address, proxyBlockInfo.address])
  return vault;
}

async function deployProxyBlockInfo() {
  const implDefault = await deployContract("BlockInfoDefault", [])
  const proxy = await deployContract("BlockInfoProxy", [])
  await proxy.setImplementation(implDefault.address)
  return proxy;
}

async function deployZlpManager(args) {
  const proxyBlockInfo = await deployProxyBlockInfo();
  const zlpManager = await deployContract("ZlpManager", [...args, proxyBlockInfo.address])
  return zlpManager;
}

async function deployVaultPriceFeed() {
  const proxyBlockInfo = await deployProxyBlockInfo();
  const priceFeed = await deployContract("VaultPriceFeed", [proxyBlockInfo.address])
  return priceFeed;
}

async function deployFastPriceFeed(args) {
  const proxyBlockInfo = await deployProxyBlockInfo();
  const priceFeed = await deployContract("FastPriceFeed", [...args, proxyBlockInfo.address])
  return priceFeed;
}

async function deployTimelock(args) {
  const proxyBlockInfo = await deployProxyBlockInfo();
  const timelock = await deployContract("Timelock", [...args, proxyBlockInfo.address])
  return timelock;
}

async function deployZkeTimelock(args) {
  const proxyBlockInfo = await deployProxyBlockInfo();
  const zkeTimelock = await deployContract("ZkeTimelock", [...args, proxyBlockInfo.address])
  return zkeTimelock;
}

async function deployBonusDistributor(args) {
  const proxyBlockInfo = await deployProxyBlockInfo();
  const bonusDistr = await deployContract("BonusDistributor", [...args, proxyBlockInfo.address])
  return bonusDistr;
}

async function deployRewardDistributor(args) {
  const proxyBlockInfo = await deployProxyBlockInfo();
  const rewardDistr = await deployContract("RewardDistributor", [...args, proxyBlockInfo.address])
  return rewardDistr;
}

async function deployVester(args) {
  const proxyBlockInfo = await deployProxyBlockInfo();
  const vester = await deployContract("Vester", [...args, proxyBlockInfo.address])
  return vester;
}

async function deployTimeDistributor(args) {
  const proxyBlockInfo = await deployProxyBlockInfo();
  const timeDistr = await deployContract("TimeDistributor", [proxyBlockInfo.address])
  return timeDistr;
}

async function contractAt(name, address) {
  const contractFactory = await ethers.getContractFactory(name)
  return await contractFactory.attach(address)
}

async function deployAll(admin, keeper) {
  // common

  function getEthConfig(weth) {
    return [
      weth, // _token
      18, // _tokenDecimals
      30000, // _tokenWeight
      0, // _minProfitBps
      0, // _maxUsdgAmount
      false, // _isStable
      true // _isShortable
    ]
  }

  function getBtcConfig(btc) {
    return [
      btc, // _token
      8, // _tokenDecimals
      25000, // _tokenWeight
      0, // _minProfitBps
      0, // _maxUsdgAmount
      false, // _isStable
      true // _isShortable
    ]
  }

  function getUsdcConfig(usdc) {
    return [
      usdc, // _token
      6, // _tokenDecimals
      45000, // _tokenWeight
      0, // _minProfitBps
      0, // _maxUsdgAmount
      true, // _isStable
      false // _isShortable
    ]
  }


  const eth = await deployContract("WETH", ["WETH", "WETH", 18]);
  const pyth = await deployContract("Pyth", []);

  // vault
  const blockInfoProxy = await deployProxyBlockInfo();
  const vaultDelegatePartOne = await deployContract("VaultDelegatePartOne", []);
  const vaultDelegatePartTwo = await deployContract("VaultDelegatePartTwo", []);
  const vaultDelegatePartThree = await deployContract("VaultDelegatePartThree", []);
  const vault = await deployContract("Vault", [vaultDelegatePartOne.address, vaultDelegatePartTwo.address, vaultDelegatePartThree.address, blockInfoProxy.address]);

  const usdg = await deployContract("USDG", [vault.address]);
  const router = await deployContract("Router", [vault.address, usdg.address, eth.address, pyth.address]);

  const vaultPriceFeed = await deployContract("VaultPriceFeed", [blockInfoProxy.address]);

  await vaultPriceFeed.setMaxStrictPriceDeviation(expandDecimals(1, 28));
  await vaultPriceFeed.setIsAmmEnabled(false);


  const zlp = await deployContract("ZLP", []);
  await zlp.setInPrivateTransferMode(true);

  const shortsTracker = await deployContract("ShortsTracker", [vault.address]);



  const zlpManager = await deployContract("ZlpManager",
    [vault.address, usdg.address, zlp.address, shortsTracker.address, 15 * 60, blockInfoProxy.address]);

  await zlpManager.setInPrivateMode(true);

  await zlp.setMinter(zlpManager.address, true);
  await usdg.addVault(zlpManager.address);

  await vault.initialize(
    router.address, // router
    usdg.address, // usdg
    vaultPriceFeed.address, // priceFeed
    toUsd(2), // liquidationFeeUsd
    100, // fundingRateFactor
    100 // stableFundingRateFactor
  );

  await vault.setFundingRate(60 * 60, 100, 100)

  await vault.setInManagerMode(true)
  await vault.setManager(zlpManager.address, true)

  await vault.setFees(
    60, // _taxBasisPoints
    5, // _stableTaxBasisPoints
    25, // _mintBurnFeeBasisPoints
    30, // _swapFeeBasisPoints
    1, // _stableSwapFeeBasisPoints
    10, // _marginFeeBasisPoints
    toUsd(2), // _liquidationFeeUsd
    24 * 60 * 60, // _minProfitTime
    true // _hasDynamicFees
  )

  const vaultErrorController = await deployContract("VaultErrorController", [])

  await vault.setErrorController(vaultErrorController.address)
  await vaultErrorController.setErrors(vault.address, errors)

  const vaultUtils = await deployContract("VaultUtils", [vault.address])
  await vault.setVaultUtils(vaultUtils.address)



  // RewardsRouter
  const VESTING_DURATION = 365 * 24 * 60 * 60

  const zke = await deployContract("ZKE", []);
  const esZke = await deployContract("EsZKE", []);
  const bnZke = await deployContract("MintableBaseToken", ["Bonus ZKE", "bnZKE", 0]);



  await esZke.setInPrivateTransferMode(true)
  await zlp.setInPrivateTransferMode(true)

  const stakedZkeTracker = await deployContract("RewardTracker", ["Staked ZKE", "sZKE"])
  const stakedZkeDistributor = await deployContract("RewardDistributor", [esZke.address, stakedZkeTracker.address, blockInfoProxy.address])
  await stakedZkeTracker.initialize([zke.address, esZke.address], stakedZkeDistributor.address)
  await stakedZkeDistributor.updateLastDistributionTime()

  const bonusZkeTracker = await deployContract("RewardTracker", ["Staked + Bonus ZKE", "sbZKE"])
  const bonusZkeDistributor = await deployContract("BonusDistributor", [bnZke.address, bonusZkeTracker.address, blockInfoProxy.address])
  await bonusZkeTracker.initialize([stakedZkeTracker.address], bonusZkeDistributor.address)
  await bonusZkeDistributor.updateLastDistributionTime()

  const feeZkeTracker = await deployContract("RewardTracker", ["Staked + Bonus + Fee ZKE", "sbfZKE"])
  const feeZkeDistributor = await deployContract("RewardDistributor", [eth.address, feeZkeTracker.address, blockInfoProxy.address])
  await feeZkeTracker.initialize([bonusZkeTracker.address, bnZke.address], feeZkeDistributor.address)
  await feeZkeDistributor.updateLastDistributionTime()

  const feeZlpTracker = await deployContract("RewardTracker", ["Fee ZLP", "fZLP"])
  const feeZlpDistributor = await deployContract("RewardDistributor", [eth.address, feeZlpTracker.address, blockInfoProxy.address])
  await feeZlpTracker.initialize([zlp.address], feeZlpDistributor.address)
  await feeZlpDistributor.updateLastDistributionTime()

  const stakedZlpTracker = await deployContract("RewardTracker", ["Fee + Staked ZLP", "fsZLP"])
  const stakedZlpDistributor = await deployContract("RewardDistributor", [esZke.address, stakedZlpTracker.address, blockInfoProxy.address])
  await stakedZlpTracker.initialize([feeZlpTracker.address], stakedZlpDistributor.address)
  await stakedZlpDistributor.updateLastDistributionTime()

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


  const zkeVester = await deployContract("Vester", [
    "Vested ZKE", // _name
    "vZKE", // _symbol
    VESTING_DURATION, // _vestingDuration
    esZke.address, // _esToken
    feeZkeTracker.address, // _pairToken
    zke.address, // _claimableToken
    stakedZkeTracker.address, // _rewardTracker
    blockInfoProxy.address //_blockInfo
  ])

  const zlpVester = await deployContract("Vester", [
    "Vested ZLP", // _name
    "vZLP", // _symbol
    VESTING_DURATION, // _vestingDuration
    esZke.address, // _esToken
    stakedZlpTracker.address, // _pairToken
    zke.address, // _claimableToken
    stakedZlpTracker.address, // _rewardTracker
    blockInfoProxy.address
  ])

  const rewardRouter = await deployContract("RewardRouterV4", [])
  await rewardRouter.initialize(
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
    zlpVester.address,
    pyth.address
  )

  await zlpManager.setHandler(rewardRouter.address, true)

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

  // allow stakedZlpTracker to stake feeZlpTracker
  await feeZlpTracker.setHandler(stakedZlpTracker.address, true)
  // allow feeZlpTracker to stake zlp
  await zlp.setHandler(feeZlpTracker.address, true)

  // allow rewardRouter to stake in feeZlpTracker
  await feeZlpTracker.setHandler(rewardRouter.address, true)
  // allow rewardRouter to stake in stakedZlpTracker
  await stakedZlpTracker.setHandler(rewardRouter.address, true)

  await esZke.setHandler(rewardRouter.address, true)
  await esZke.setHandler(stakedZkeDistributor.address, true)
  await esZke.setHandler(stakedZlpDistributor.address, true)
  await esZke.setHandler(stakedZlpTracker.address, true)
  await esZke.setHandler(zkeVester.address, true)
  await esZke.setHandler(zlpVester.address, true)

  await esZke.setMinter(zkeVester.address, true)
  await esZke.setMinter(zlpVester.address, true)

  await zkeVester.setHandler(rewardRouter.address, true)
  await zlpVester.setHandler(rewardRouter.address, true)

  await feeZkeTracker.setHandler(zkeVester.address, true)
  await stakedZlpTracker.setHandler(zlpVester.address, true)

  // timelock

  const maxTokenSupply = expandDecimals("50000000", 18);
  const initialBuffer = 0; //1 sec

  const timelock = await deployContract(
    "Timelock",
    [
      admin, // admin
      initialBuffer, // buffer
      admin, // tokenManager
      admin, // mintReceiver
      zlpManager.address, // zlpManager
      ethers.constants.AddressZero, // rewardRouter
      maxTokenSupply, // maxTokenSupply
      10, // marginFeeBasisPoints 0.1%
      500, // maxMarginFeeBasisPoints 5%
      blockInfoProxy.address,
    ]
  );

  await timelock.setShouldToggleIsLeverageEnabled(true);

  await timelock.setContractHandler(admin, true);

  await timelock.setKeeper(admin, true);



  // PositionRouter

  const depositFee = "30" // 0.3%
  const minExecutionFee = ethers.utils.parseEther("0.0009"); // ~$2

  const referralStorage = await deployContract("ReferralStorage", [])
  const positionUtils = await deployContract("PositionUtils_0_8_18", []);

  const positionRouterArgs = [vault.address, router.address, eth.address, shortsTracker.address, depositFee, minExecutionFee, blockInfoProxy.address, pyth.address]

  const positionRouter = await deployContract("PositionRouterV2", positionRouterArgs, {
    libraries: {
      PositionUtils_0_8_18: positionUtils.address
    }
  });


  await positionRouter.setReferralStorage(referralStorage.address)
  await referralStorage.setHandler(positionRouter.address, true)
  await referralStorage.setHandler(timelock.address, true)
  await timelock.signalSetHandler(referralStorage.address, positionRouter.address, true)

  await shortsTracker.setHandler(positionRouter.address, true)
  // await timelock.signalSetHandler(shortsTracker.address, positionRouter.address, true)
  // await timelock.setHandler(shortsTracker.address, positionRouter.address, true)

  await router.addPlugin(positionRouter.address)

  await positionRouter.setDelayValues(0, 180, 30 * 60)
  await timelock.setContractHandler(positionRouter.address, true)
  await positionRouter.setPositionKeeper(admin, true)



  // OrderBook

  const orderBook = await deployContract("OrderBookV2", []);

  await orderBook.initialize(
    router.address, // router
    vault.address, // vault
    eth.address, // weth
    usdg.address, // usdg
    minExecutionFee,
    expandDecimals(10, 30), // min purchase token amount usd
    pyth.address
  )

  await router.addPlugin(orderBook.address)


  // PositionManager

  const positionManager = await deployContract("PositionManagerV2",
    [vault.address, router.address, shortsTracker.address, eth.address, depositFee, orderBook.address, pyth.address], {
    libraries: {
      PositionUtils_0_8_18: positionUtils.address
    }
  })


  await positionManager.setReferralStorage(referralStorage.address)


  await positionManager.setShouldValidateIncreaseOrder(false)


  await positionManager.setOrderKeeper(admin, true)
  await positionManager.setLiquidator(admin, true)

  await positionManager.setOrderKeeper(keeper, true)
  await positionManager.setLiquidator(keeper, true)


  await timelock.setContractHandler(positionManager.address, true)




  await vault.setLiquidator(positionManager.address, true)



  await shortsTracker.setHandler(positionManager.address, true)
  // await timelock.signalSetHandler(shortsTracker.address, positionManager.address, true)
  // await timelock.setHandler(shortsTracker.address, positionManager.address, true)

  // await shortsTracker.setGov(timelock.address);


  await router.addPlugin(positionManager.address)



  // Pyth
  const ethPriceFeedId = "0xff61491a931112ddf1bd8147cd1b641375f79f5825126d665480874634fd0ace";
  const usdcPriceFeedId = "0xeaa020c61cc479712813461ce153894a96a6c00b21ed0cfc2798d1f9a9e9c94a";
  const btcPriceFeedId = "0xe62df6c8b4a85fe1a67db44dc12de5db330f7ac66b72dc658afedf0f4a415b43";

  const priceIds = [
    ethPriceFeedId,
    usdcPriceFeedId,
    btcPriceFeedId
  ];
  const age = 18000
  const usdc = await deployContract("USDC", [])
  const wbtc = await deployContract("WBTC", [])


  const ethPythPriceFeed = await deployContract("PythPriceFeedV2", [pyth.address, ethPriceFeedId, age]);
  const usdcPythPriceFeed = await deployContract("PythPriceFeedV2", [pyth.address, usdcPriceFeedId, age]);
  const btcPythPriceFeed = await deployContract("PythPriceFeedV2", [pyth.address, btcPriceFeedId, age]);

  const PRICE_DECIMALS = 8;

  await vaultPriceFeed.setTokenConfig(wbtc.address, btcPythPriceFeed.address, PRICE_DECIMALS, false)
  await vaultPriceFeed.setTokenConfig(eth.address, ethPythPriceFeed.address, PRICE_DECIMALS, false)
  await vaultPriceFeed.setTokenConfig(usdc.address, usdcPythPriceFeed.address, PRICE_DECIMALS, false)

  await vault.setTokenConfig(...getBtcConfig(wbtc.address))
  await vault.setTokenConfig(...getUsdcConfig(usdc.address))
  await vault.setTokenConfig(...getEthConfig(eth.address))

  await vault.setGov(timelock.address);

 

  return {
    eth, wbtc, usdc, pyth, vault, timelock, positionRouter, router, shortsTracker, zlpManager, rewardRouter, orderBook, blockInfoProxy, usdg, vaultUtils, positionManager, referralStorage, positionUtils
  };
}

module.exports = {
  deployContract,
  deployContractWithBlockInfo,
  deployVault,
  deployProxyBlockInfo,
  deployVaultPriceFeed,
  deployZlpManager,
  deployFastPriceFeed,
  deployTimelock,
  deployZkeTimelock,
  deployBonusDistributor,
  deployRewardDistributor,
  deployVester,
  deployTimeDistributor,
  contractAt,
  deployAll
}
