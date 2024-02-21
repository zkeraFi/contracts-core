import * as hre from 'hardhat';
import { OrderBookV2__factory, ReferralStorage__factory, Router__factory, ShortsTracker__factory, Timelock__factory, Vault__factory, WETH__factory } from "../../typechain";
import { getProvider } from "../shared/network";
import { getDeployerWallet } from "../shared/accounts";
import { getNetworkConfig } from "../shared/zkEraConfig";
import { KEEPER_WALLET, KEEPER_WALLET2 } from "../shared/constants";
import { deployContract, getJsonField, sendTxn } from "../shared/deploy";
import { Deployer } from '@matterlabs/hardhat-zksync-deploy';


export default async function main() {
  const provider = getProvider();
  // const [wallet, user0, user1, user2, user3] = getRichWallets(provider);
  const deployerWallet = getDeployerWallet(provider);
  const deployer = new Deployer(hre, deployerWallet);
  const config = getNetworkConfig();
  const depositFee = 30 // 0.3%
  
  const routerAddress = await getJsonField("router") as string;
  const shortsTrackerAddress = await getJsonField("shortsTracker") as string;
  const timelockAddress = await getJsonField("timelock") as string;
  const vaultAddress = await getJsonField("vault") as string;
  const blockInfoProxyAddress = await getJsonField("blockInfoProxy") as string;
  const orderBookAddress = await getJsonField("orderBookV2") as string;
  const referralStorageAddress = await getJsonField("referralStorage") as string;

  const vault = Vault__factory.connect(vaultAddress, deployerWallet);
  const timelock = Timelock__factory.connect(timelockAddress, deployerWallet);
  const weth = WETH__factory.connect(config.weth, deployerWallet);
  const router = Router__factory.connect(routerAddress, deployerWallet);
  const shortsTracker = ShortsTracker__factory.connect(shortsTrackerAddress, deployerWallet);
  const referralStorage = ReferralStorage__factory.connect(referralStorageAddress, deployerWallet);
  const orderBook = OrderBookV2__factory.connect(orderBookAddress, deployerWallet);

  const orderKeepers = [
    { address: KEEPER_WALLET },
    {address:KEEPER_WALLET2}
  ]
  const liquidators = [
    { address: KEEPER_WALLET },
    {address:KEEPER_WALLET2}
  ]

  // const positionManagerAddress = await getJsonField("positionManagerV2") as string;
  // const positionManager = PositionManagerV2__factory.connect(positionManagerAddress, deployerWallet);  
  let positionManager = await deployContract(deployer,
    "PositionManagerV2",
    [vault.address, router.address, shortsTracker.address, weth.address, depositFee, orderBook.address, config.pyth],
    "positionManagerV2")

  // positionManager only reads from referralStorage so it does not need to be set as a handler of referralStorage
  if ((await positionManager.referralStorage()).toLowerCase() != referralStorage.address.toLowerCase()) {
    await sendTxn(positionManager.setReferralStorage(referralStorage.address), "positionManager.setReferralStorage")
  }
  if (await positionManager.shouldValidateIncreaseOrder()) {
    await sendTxn(positionManager.setShouldValidateIncreaseOrder(false), "positionManager.setShouldValidateIncreaseOrder(false)")
  }

  for (let i = 0; i < orderKeepers.length; i++) {
    const orderKeeper = orderKeepers[i]
    if (!(await positionManager.isOrderKeeper(orderKeeper.address))) {
      await sendTxn(positionManager.setOrderKeeper(orderKeeper.address, true), "positionManager.setOrderKeeper(orderKeeper)")
    }
  }

  for (let i = 0; i < liquidators.length; i++) {
    const liquidator = liquidators[i]
    if (!(await positionManager.isLiquidator(liquidator.address))) {
      await sendTxn(positionManager.setLiquidator(liquidator.address, true), "positionManager.setLiquidator(liquidator)")
    }
  }

  if (!(await timelock.isHandler(positionManager.address))) {
    await sendTxn(timelock.setContractHandler(positionManager.address, true), "timelock.setContractHandler(positionManager)")
  }

  
  //%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%

  if (!(await vault.isLiquidator(positionManager.address))) {
    await sendTxn(timelock.setLiquidator(vault.address, positionManager.address, true), "timelock.setLiquidator(vault, positionManager, true)")
    // await sendTxn(vault.setLiquidator(positionManager.address, true), "vault.setLiquidator(positionManager, true)")
  }
  if (!(await shortsTracker.isHandler(positionManager.address))) {
    // await sendTxn(shortsTracker.setHandler(positionManager.address, true), "shortsTracker.setContractHandler(positionManager.address, true)")
    await sendTxn(timelock.signalSetHandler(shortsTracker.address,positionManager.address,true), "timelockContract.signalSetHandler")
    await sendTxn(timelock.setHandler(shortsTracker.address,positionManager.address,true), "timelockContract.setHandler")
  }
  if (!(await router.plugins(positionManager.address))) {
    await sendTxn(router.addPlugin(positionManager.address), "router.addPlugin(positionManager)")
  }
}



   main()
  .then(() => process.exit(0))
  .catch(error => {
    console.error(error)
    process.exit(1)
  })
