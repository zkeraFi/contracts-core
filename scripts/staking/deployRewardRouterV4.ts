import * as hre from 'hardhat';
import { Deployer } from '@matterlabs/hardhat-zksync-deploy';
import { getDeployerWallet } from '../shared/accounts';
import { getProvider } from '../shared/network';
import { deployContract, getJsonField, sendTxn } from '../shared/deploy';
import { BonusDistributor__factory, EsZKE__factory, MintableBaseToken__factory, RewardDistributor__factory, RewardRouterV4__factory, RewardTracker__factory, Vester__factory, ZKE__factory, ZLP__factory, ZlpManager__factory } from '../../typechain';
import { getNetworkConfig } from '../shared/zkEraConfig';

const VESTING_DURATION = 365 * 24 * 60 * 60

export default async function main() {
  const provider = getProvider();
  // const [wallet, user0, user1, user2, user3] = getRichWallets(provider);
  const deployerWallet = getDeployerWallet(provider);
  const deployer = new Deployer(hre, deployerWallet);
  const config = getNetworkConfig();

  const zlpAddress = await getJsonField("zlp") as string
  const zlp = ZLP__factory.connect(zlpAddress, deployerWallet);

  const degenLPAddress = await getJsonField("degenLP") as string
  const degenLP = DegenLP__factory.connect(degenLPAddress, deployerWallet);

  const zlpManagerAddress = await getJsonField("zlpManager") as string
  
  const zlpManager = ZlpManager__factory.connect(zlpManagerAddress, deployerWallet);

  const degenLPManagerAddress = await getJsonField("zlpManager") as string
  
  const degenLPManager = ZlpManager__factory.connect(degenLPManagerAddress, deployerWallet);
  
  const blockInfo = await getJsonField("blockInfoProxy") as string

  const zke = await deployContract(deployer, "ZKE", [], "zke");
  const esZke = await deployContract(deployer, "EsZKE", [], "esZke");
  const bnZke = await deployContract(deployer, "MintableBaseToken", ["Bonus ZKE", "bnZKE", 0], "bnZke");
  const zkeAddress = await getJsonField("zke") as string;
  const esZkeAddress = await getJsonField("esZke") as string;
  const bnZkeAddress = await getJsonField("bnZke") as string;
  // const zke = ZKE__factory.connect(zkeAddress, deployerWallet);
  // const esZke = EsZKE__factory.connect(esZkeAddress, deployerWallet);
  // const bnZke = MintableBaseToken__factory.connect(bnZkeAddress, deployerWallet);

  await sendTxn(esZke.setInPrivateTransferMode(true), "esZke.setInPrivateTransferMode")
  await sendTxn(zlp.setInPrivateTransferMode(true), "zlp.setInPrivateTransferMode")

  const stakedZkeTracker = await deployContract(deployer, "RewardTracker", ["Staked ZKE", "sZKE"], "stakedZkeTracker")
  const stakedZkeDistributor = await deployContract(deployer, "RewardDistributor", [esZke.address, stakedZkeTracker.address, blockInfo], "stakedZkeDistributor")
  await sendTxn(stakedZkeTracker.initialize([zke.address, esZke.address], stakedZkeDistributor.address), "stakedZkeTracker.initialize")
  await sendTxn(stakedZkeDistributor.updateLastDistributionTime(), "stakedZkeDistributor.updateLastDistributionTime")

  const bonusZkeTracker = await deployContract(deployer, "RewardTracker", ["Staked + Bonus ZKE", "sbZKE"], "bonusZkeTracker")
  const bonusZkeDistributor = await deployContract(deployer, "BonusDistributor", [bnZke.address, bonusZkeTracker.address, blockInfo], "bonusZkeDistributor")
  await sendTxn(bonusZkeTracker.initialize([stakedZkeTracker.address], bonusZkeDistributor.address), "bonusZkeTracker.initialize")
  await sendTxn(bonusZkeDistributor.updateLastDistributionTime(), "bonusZkeDistributor.updateLastDistributionTime")

  const feeZkeTracker = await deployContract(deployer, "RewardTracker", ["Staked + Bonus + Fee ZKE", "sbfZKE"], "feeZkeTracker")
  const feeZkeDistributor = await deployContract(deployer, "RewardDistributor", [config.weth, feeZkeTracker.address, blockInfo], "feeZkeDistributor")
  await sendTxn(feeZkeTracker.initialize([bonusZkeTracker.address, bnZke.address], feeZkeDistributor.address), "feeZkeTracker.initialize")
  await sendTxn(feeZkeDistributor.updateLastDistributionTime(), "feeZkeDistributor.updateLastDistributionTime")

  const feeZlpTracker = await deployContract(deployer, "RewardTracker", ["Fee ZLP", "fZLP"], "feeZlpTracker")
  const feeZlpDistributor = await deployContract(deployer, "RewardDistributor", [config.weth, feeZlpTracker.address, blockInfo], "feeZlpDistributor")
  await sendTxn(feeZlpTracker.initialize([zlp.address], feeZlpDistributor.address), "feeZlpTracker.initialize")
  await sendTxn(feeZlpDistributor.updateLastDistributionTime(), "feeZlpDistributor.updateLastDistributionTime")

  const stakedZlpTracker = await deployContract(deployer, "RewardTracker", ["Fee + Staked ZLP", "fsZLP"], "stakedZlpTracker")
  const stakedZlpDistributor = await deployContract(deployer, "RewardDistributor", [esZke.address, stakedZlpTracker.address, blockInfo], "stakedZlpDistributor")
  await sendTxn(stakedZlpTracker.initialize([feeZlpTracker.address], stakedZlpDistributor.address), "stakedZlpTracker.initialize")
  await sendTxn(stakedZlpDistributor.updateLastDistributionTime(), "stakedZlpDistributor.updateLastDistributionTime")







  // const rewardRouterAddress = await getJsonFieldV2("rewardRouter") as string;
  // const rewardRouter = RewardRouterV4__factory.connect(rewardRouterAddress, deployerWallet);

  // const stakedZkeTrackerAddress = await getJsonField("stakedZkeTracker") as string;
  // const stakedZkeTracker = RewardTracker__factory.connect(stakedZkeTrackerAddress, deployerWallet);

  // const feeZkeTrackerAddress = await getJsonField("feeZkeTracker") as string;
  // const feeZkeTracker = RewardTracker__factory.connect(feeZkeTrackerAddress, deployerWallet);

  // const feeZlpTrackerAddress = await getJsonField("feeZlpTracker") as string;
  // const feeZlpTracker = RewardTracker__factory.connect(feeZlpTrackerAddress, deployerWallet);

  // const stakedZlpTrackerAddress = await getJsonField("stakedZlpTracker") as string;
  // const stakedZlpTracker = RewardTracker__factory.connect(stakedZlpTrackerAddress, deployerWallet);

  // const bonusZkeTrackerAddress = await getJsonField("bonusZkeTracker") as string;
  // const bonusZkeTracker = RewardTracker__factory.connect(bonusZkeTrackerAddress, deployerWallet);

  // const bonusZkeDistributorAddress = await getJsonField("bonusZkeDistributor") as string;
  // const bonusZkeDistributor = BonusDistributor__factory.connect(bonusZkeDistributorAddress, deployerWallet);

  // const stakedZkeDistributorAddress = await getJsonField("stakedZkeDistributor") as string;
  // const stakedZkeDistributor = RewardDistributor__factory.connect(stakedZkeDistributorAddress, deployerWallet);

  // const stakedZlpDistributorAddress = await getJsonField("stakedZlpDistributor") as string;
  // const stakedZlpDistributor = RewardDistributor__factory.connect(stakedZlpDistributorAddress, deployerWallet);

  // const zkeVesterAddress = await getJsonField("zkeVester") as string;
  // const zkeVester = Vester__factory.connect(zkeVesterAddress, deployerWallet);

  // const zlpVesterAddress = await getJsonField("zlpVester") as string;
  // const zlpVester = Vester__factory.connect(zlpVesterAddress, deployerWallet);












  const feeDegenLPTracker = await deployContract(deployer, "RewardTracker", ["Fee degenLP", "fDegenLP"], "feeDegenLPTracker")
  const feeDegenLPDistributor = await deployContract(deployer, "RewardDistributor", [config.weth, feeDegenLPTracker.address, blockInfo], "feeDegenLPDistributor")
  await sendTxn(feeDegenLPTracker.initialize([degenLP.address], feeDegenLPDistributor.address), "feeDegenLPTracker.initialize")
  await sendTxn(feeDegenLPDistributor.updateLastDistributionTime(), "feeDegenLPDistributor.updateLastDistributionTime")

  const stakedDegenLPTracker = await deployContract(deployer, "RewardTracker", ["Fee + Staked degenLP", "fsDegenLP"], "stakedDegenLPTracker")
  const stakedDegenLPDistributor = await deployContract(deployer, "RewardDistributor", [esZke.address, stakedDegenLPTracker.address, blockInfo], "stakedDegenLPDistributor")
  await sendTxn(stakedDegenLPTracker.initialize([feeDegenLPTracker.address], stakedDegenLPDistributor.address), "stakedDegenLPTracker.initialize")
  await sendTxn(stakedDegenLPDistributor.updateLastDistributionTime(), "stakedDegenLPDistributor.updateLastDistributionTime")



  // const feeDegenLPTrackerAddress = await getJsonField("feeDegenLPTracker") as string;
  // const feeDegenLPTracker = RewardTracker__factory.connect(feeDegenLPTrackerAddress, deployerWallet);

  // const feeDegenLPDistributorAddress = await getJsonField("feeDegenLPDistributor") as string;
  // const feeDegenLPDistributor = RewardDistributor__factory.connect(feeDegenLPDistributorAddress, deployerWallet);

  // const stakedDegenLPTrackerAddress = await getJsonField("stakedDegenLPTracker") as string;
  // const stakedDegenLPTracker = RewardTracker__factory.connect(stakedDegenLPTrackerAddress, deployerWallet);

  // const stakedDegenLPDistributorAddress = await getJsonField("stakedDegenLPDistributor") as string;
  // const stakedDegenLPDistributor = RewardDistributor__factory.connect(stakedDegenLPDistributorAddress, deployerWallet);

  // const degenLPVesterAddress = await getJsonField("degenLPVester") as string;
  // const degenLPVester = RewardTracker__factory.connect(degenLPVesterAddress, deployerWallet);


  await sendTxn(stakedZkeTracker.setInPrivateTransferMode(true), "stakedZkeTracker.setInPrivateTransferMode")
  await sendTxn(stakedZkeTracker.setInPrivateStakingMode(true), "stakedZkeTracker.setInPrivateStakingMode")
  await sendTxn(bonusZkeTracker.setInPrivateTransferMode(true), "bonusZkeTracker.setInPrivateTransferMode")
  await sendTxn(bonusZkeTracker.setInPrivateStakingMode(true), "bonusZkeTracker.setInPrivateStakingMode")
  await sendTxn(bonusZkeTracker.setInPrivateClaimingMode(true), "bonusZkeTracker.setInPrivateClaimingMode")
  await sendTxn(feeZkeTracker.setInPrivateTransferMode(true), "feeZkeTracker.setInPrivateTransferMode")
  await sendTxn(feeZkeTracker.setInPrivateStakingMode(true), "feeZkeTracker.setInPrivateStakingMode")

  await sendTxn(feeZlpTracker.setInPrivateTransferMode(true), "feeZlpTracker.setInPrivateTransferMode")
  await sendTxn(feeZlpTracker.setInPrivateStakingMode(true), "feeZlpTracker.setInPrivateStakingMode")
  await sendTxn(stakedZlpTracker.setInPrivateTransferMode(true), "stakedZlpTracker.setInPrivateTransferMode")
  await sendTxn(stakedZlpTracker.setInPrivateStakingMode(true), "stakedZlpTracker.setInPrivateStakingMode")

     await sendTxn(feeDegenLPTracker.setInPrivateTransferMode(true), "feeZlpTracker.setInPrivateTransferMode")
     await sendTxn(feeDegenLPTracker.setInPrivateStakingMode(true), "feeZlpTracker.setInPrivateStakingMode")
     await sendTxn(stakedDegenLPTracker.setInPrivateTransferMode(true), "stakedZlpTracker.setInPrivateTransferMode")
     await sendTxn(stakedDegenLPTracker.setInPrivateStakingMode(true), "stakedZlpTracker.setInPrivateStakingMode")

  const zkeVester = await deployContract(deployer, "Vester", [
    "Vested ZKE", // _name
    "vZKE", // _symbol
    VESTING_DURATION, // _vestingDuration
    esZke.address, // _esToken
    feeZkeTracker.address, // _pairToken
    zke.address, // _claimableToken
    stakedZkeTracker.address, // _rewardTracker
    blockInfo //_blockInfo
  ], "zkeVester")

  const zlpVester = await deployContract(deployer, "Vester", [
    "Vested ZLP", // _name
    "vZLP", // _symbol
    VESTING_DURATION, // _vestingDuration
    esZke.address, // _esToken
    stakedZlpTracker.address, // _pairToken
    zke.address, // _claimableToken
    stakedZlpTracker.address, // _rewardTracker
    blockInfo
  ], "zlpVester")

  const degenLPVester = await deployContract(deployer, "Vester", [
    "Vested degenLP", // _name
    "vDegenLP", // _symbol
    VESTING_DURATION, // _vestingDuration
    esZke.address, // _esToken
    stakedDegenLPTracker.address, // _pairToken
    zke.address, // _claimableToken
    stakedDegenLPTracker.address, // _rewardTracker
    blockInfo
  ], "degenLPVester")

  const rewardRouter = await deployContract(deployer, "RewardRouterV4", [], "rewardRouter")
  await sendTxn(rewardRouter.initialize(
    config.weth,
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
    degenLP.address,
    feeDegenLPTracker.address,
    stakedDegenLPTracker.address,
    degenLPManager.address,
    degenLPVester.address,
    config.pyth
  ), "rewardRouter.initialize")


// console.log(rewardRouter.address)
  await sendTxn(zlpManager.setHandler(rewardRouter.address, true), "zlpManager.setHandler(rewardRouter)")
  await sendTxn(degenLPManager.setHandler(rewardRouter.address, true), "zlpManager.setHandler(rewardRouter)")

  // // allow rewardRouter to stake in stakedZkeTracker
  await sendTxn(stakedZkeTracker.setHandler(rewardRouter.address, true), "stakedZkeTracker.setHandler(rewardRouter)")
  // // allow bonusZkeTracker to stake stakedZkeTracker
  await sendTxn(stakedZkeTracker.setHandler(bonusZkeTracker.address, true), "stakedZkeTracker.setHandler(bonusZkeTracker)")
  // // allow rewardRouter to stake in bonusZkeTracker
  await sendTxn(bonusZkeTracker.setHandler(rewardRouter.address, true), "bonusZkeTracker.setHandler(rewardRouter)")
  // // allow bonusZkeTracker to stake feeZkeTracker
  await sendTxn(bonusZkeTracker.setHandler(feeZkeTracker.address, true), "bonusZkeTracker.setHandler(feeZkeTracker)")
  await sendTxn(bonusZkeDistributor.setBonusMultiplier(10000), "bonusZkeDistributor.setBonusMultiplier")
  // allow rewardRouter to stake in feeZkeTracker
  await sendTxn(feeZkeTracker.setHandler(rewardRouter.address, true), "feeZkeTracker.setHandler(rewardRouter)")
  // allow stakedZkeTracker to stake esZke
  await sendTxn(esZke.setHandler(stakedZkeTracker.address, true), "esZke.setHandler(stakedZkeTracker)")
  // allow feeZkeTracker to stake bnZke
  await sendTxn(bnZke.setHandler(feeZkeTracker.address, true), "bnZke.setHandler(feeZkeTracker")
  // allow rewardRouter to burn bnZke
  await sendTxn(bnZke.setMinter(rewardRouter.address, true), "bnZke.setMinter(rewardRouter")

  // allow stakedZlpTracker to stake feeZlpTracker
  await sendTxn(feeZlpTracker.setHandler(stakedZlpTracker.address, true), "feeZlpTracker.setHandler(stakedZlpTracker)")
  // allow feeZlpTracker to stake zlp
  await sendTxn(zlp.setHandler(feeZlpTracker.address, true), "zlp.setHandler(feeZlpTracker)")

  // allow stakedDegenLPTracker to stake feeDegenLPTracker
  await sendTxn(feeDegenLPTracker.setHandler(stakedDegenLPTracker.address, true), "feeDegenLPTracker.setHandler(stakedDegenLPTracker)")
  // allow feeDegenLPTracker to stake degenLP
  await sendTxn(degenLP.setHandler(feeDegenLPTracker.address, true), "degenLP.setHandler(feeDegenLPTracker)")

  // allow rewardRouter to stake in feeZlpTracker
  await sendTxn(feeZlpTracker.setHandler(rewardRouter.address, true), "feeZlpTracker.setHandler(rewardRouter)")
  // allow rewardRouter to stake in stakedZlpTracker
  await sendTxn(stakedZlpTracker.setHandler(rewardRouter.address, true), "stakedZlpTracker.setHandler(rewardRouter)")

  // allow rewardRouter to stake in feeDegenLPTracker
  await sendTxn(feeDegenLPTracker.setHandler(rewardRouter.address, true), "feeDegenLPTracker.setHandler(rewardRouter)")
  // allow rewardRouter to stake in stakedDegenLPTracker
  await sendTxn(stakedDegenLPTracker.setHandler(rewardRouter.address, true), "stakedDegenLPTracker.setHandler(rewardRouter)")

  await sendTxn(esZke.setHandler(rewardRouter.address, true), "esZke.setHandler(rewardRouter)")
  await sendTxn(esZke.setHandler(stakedZkeDistributor.address, true), "esZke.setHandler(stakedZkeDistributor)")
  await sendTxn(esZke.setHandler(stakedZlpDistributor.address, true), "esZke.setHandler(stakedZlpDistributor)")
  await sendTxn(esZke.setHandler(stakedZlpTracker.address, true), "esZke.setHandler(stakedZlpTracker)")
  await sendTxn(esZke.setHandler(stakedDegenLPDistributor.address, true), "esZke.setHandler(stakedDegenLPDistributor)")
  await sendTxn(esZke.setHandler(stakedDegenLPTracker.address, true), "esZke.setHandler(stakedDegenLPTracker)")
  await sendTxn(esZke.setHandler(zkeVester.address, true), "esZke.setHandler(zkeVester)")
  await sendTxn(esZke.setHandler(zlpVester.address, true), "esZke.setHandler(zlpVester)")
  await sendTxn(esZke.setHandler(degenLPVester.address, true), "esZke.setHandler(degenLPVester)")

  await sendTxn(esZke.setMinter(zkeVester.address, true), "esZke.setMinter(zkeVester)")
  await sendTxn(esZke.setMinter(zlpVester.address, true), "esZke.setMinter(zlpVester)")
  await sendTxn(esZke.setMinter(degenLPVester.address, true), "esZke.setMinter(degenLPVester)")

  await sendTxn(zkeVester.setHandler(rewardRouter.address, true), "zkeVester.setHandler(rewardRouter)")
  await sendTxn(zlpVester.setHandler(rewardRouter.address, true), "zlpVester.setHandler(rewardRouter)")
  await sendTxn(degenLPVester.setHandler(rewardRouter.address, true), "degenLPVester.setHandler(rewardRouter)")

  await sendTxn(feeZkeTracker.setHandler(zkeVester.address, true), "feeZkeTracker.setHandler(zkeVester)")
  await sendTxn(stakedZlpTracker.setHandler(zlpVester.address, true), "stakedZlpTracker.setHandler(zlpVester)")
  await sendTxn(stakedDegenLPTracker.setHandler(degenLPVester.address, true), "stakedDegenLPTracker.setHandler(degenLPVester)")
}

 main()
  .then(() => process.exit(0))
  .catch(error => {
    console.error(error)
    process.exit(1)
  })
