import * as hre from 'hardhat';
 
import { getDeployerWallet } from '../shared/accounts';
import { getProvider } from '../shared/network';
import { deployContractV2 as deployContract, getJsonFieldV2 as getJsonField, sendTxn } from '../shared/deploy';

import { expandDecimals } from '../shared/utilities';
import { getNetworkConfig } from '../shared/zkEraConfig';
import { ethers } from 'ethers';
import { Router__factory } from '../../typechain';



export default async function main() {
  const provider = getProvider();
  // const [wallet, user0, user1, user2, user3] = getRichWallets(provider);
  const deployerWallet = hre.ethers.provider.getSigner(0);
   

  const config = getNetworkConfig();
  const routerAddress = await getJsonField("router") as string;
  const vaultAddress = await getJsonField("vault") as string;
  const usdgAddress = await getJsonField("usdg") as string;
  const posManagerAddress = (await getJsonField("positionManagerV2")) as string;
  const routerContract = Router__factory.connect(routerAddress, deployerWallet);

  const orderBook =  await deployContract( "OrderBookV2", [], "orderBookV2",false);

  const minExecutionFee = ethers.utils.parseEther("0.0009"); //~ $2
  
  await sendTxn(orderBook.initialize(
    routerAddress, // router
    vaultAddress, // vault
    config.weth, // weth
    usdgAddress, // usdg
    minExecutionFee,
    expandDecimals(10, 30) // min purchase token amount usd
  ), "orderBook.initialize");

  await sendTxn(routerContract.addPlugin(orderBook.address), "router.addPlugin");
  // await sendTxn(orderBook.setHandler(posManagerAddress, true), "orderBook.setHandler(posManagerAddress)");
}

 main()
  .then(() => process.exit(0))
  .catch(error => {
    console.error(error)
    process.exit(1)
  })
