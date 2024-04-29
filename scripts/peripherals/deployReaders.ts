import * as hre from 'hardhat';
 
import { getDeployerWallet } from '../shared/accounts';
import { getProvider } from '../shared/network';

import { PythReader__factory, RewardReader__factory } from '../../typechain';
import { deployContract, sendTxn } from '../shared/deploy';
import { BigNumber } from 'ethers';

export default async function main() {
  const provider = getProvider();
  // const [wallet, user0, user1, user2, user3] = getRichWallets(provider);
  const deployerWallet = hre.ethers.provider.getSigner(0);
   
  
  const reader =  await deployContract( "Reader", [], "reader");
  const rewardReader =  await deployContract( "RewardReader", [], "rewardReader");
  const vaultReader =  await deployContract("VaultReader", [], "vaultReader")
  const orderBookReader =  await deployContract( "OrderBookReader", [], "orderBookReader");
  const pythReaderDeployed =  await deployContract( "PythReader", [], "pythReader");
}
 main()
  .then(() => process.exit(0))
  .catch(error => {
    console.error(error)
    process.exit(1)
  })
