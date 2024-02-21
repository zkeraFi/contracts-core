import * as hre from 'hardhat';
import { getDeployerWallet } from '../shared/accounts';
import { getProvider } from '../shared/network';
import { deployContract, getJsonField, sendTxn } from '../shared/deploy';
import { 
   Router__factory,
    ShortsTracker__factory, 
     Timelock__factory, ReferralStorage__factory } from '../../typechain';
import { 
   getNetworkConfig } from '../shared/zkEraConfig';
import { KEEPER_WALLET, KEEPER_WALLET2 } from '../shared/constants';
import { ethers } from 'hardhat';
import { Deployer } from '@matterlabs/hardhat-zksync-deploy';

export default async function main() {
  const provider = getProvider();
  // const [wallet, user0, user1, user2, user3] = getRichWallets(provider);
  const deployerWallet = getDeployerWallet(provider);
  const deployer = new Deployer(hre, deployerWallet);

  const config = getNetworkConfig();
  const routerAddress = await getJsonField("router") as string;
  const shortsTrackerAddress = await getJsonField("shortsTracker") as string;
  const timelockAddress = await getJsonField("timelock") as string;
  const vaultAddress = await getJsonField("vault") as string;
  const blockInfoProxyAddress = await getJsonField("blockInfoProxy") as string;

  const routerContract = Router__factory.connect(routerAddress, deployerWallet);
  const shortsTrackerContract = ShortsTracker__factory.connect(shortsTrackerAddress, deployerWallet);
  const timelockContract = Timelock__factory.connect(timelockAddress, deployerWallet);

  const depositFee = "30" // 0.3%
  const minExecutionFee = ethers.utils.parseEther("0.0009"); // ~$2

  // await deployContract(deployer, "PositionUtils_0_8_18", [], "PositionUtils_0_8_18");


  //%%%%%%%%%%%%%%%%%%%%
  const referralStorageAddress = await getJsonField("referralStorage") as string;
  const referralStorage = ReferralStorage__factory.connect(referralStorageAddress, deployerWallet);
  // const referralStorage = await deployContract(deployer, "ReferralStorage", [], "referralStorage");
  const positionRouterArgs = [vaultAddress, routerAddress, config.weth, shortsTrackerAddress, depositFee, minExecutionFee, blockInfoProxyAddress, config.pyth]
  // const positionRouterAddress = await getJsonField("positionRouterV2") as string;
  // const positionRouter = PositionRouterV2__factory.connect(positionRouterAddress, deployerWallet);
  const positionRouter = await deployContract(deployer, "PositionRouterV2", positionRouterArgs, "positionRouterV2");

    
    await sendTxn(positionRouter.setReferralStorage(referralStorage.address), "positionRouter.setReferralStorage")
    await sendTxn(referralStorage.setHandler(positionRouter.address, true), "referralStorage.setHandler(positionRouter.address, true")
    await sendTxn(referralStorage.setHandler(timelockContract.address, true), "referralStorage.setHandler(timelockContract.address, true")
    await sendTxn(timelockContract.signalSetHandler(referralStorage.address, positionRouter.address, true), "referralStorage.signalSetHandler(positionRouter)")
    
     await sendTxn(shortsTrackerContract.setHandler(positionRouter.address, true), "shortsTrackerTimelock.signalSetHandler(positionRouter)")
    // await sendTxn(timelockContract.signalSetHandler(shortsTrackerContract.address,positionRouter.address,true), "timelockContract.signalSetHandler")
    // await sendTxn(timelockContract.setHandler(shortsTrackerContract.address,positionRouter.address,true), "timelockContract.setHandler")

    await sendTxn(routerContract.addPlugin(positionRouter.address), "router.addPlugin")
    
    await sendTxn(positionRouter.setDelayValues(0, 180, 30 * 60), "positionRouter.setDelayValues")
    await sendTxn(timelockContract.setContractHandler(positionRouter.address, true), "timelock.setContractHandler(positionRouter)")
    await sendTxn(positionRouter.setPositionKeeper(KEEPER_WALLET, true), "positionRouter.setPositionKeeper(KEEPER_WALLET, true)")
    await sendTxn(positionRouter.setPositionKeeper(KEEPER_WALLET2, true), "positionRouter.setPositionKeeper(KEEPER_WALLET, true)")
    //%%%%%%%%%%%%%%%%%%%%
}

 main()
  .then(() => process.exit(0))
  .catch(error => {
    console.error(error)
    process.exit(1)
  })


