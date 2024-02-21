import * as hre from 'hardhat';
import { Deployer } from '@matterlabs/hardhat-zksync-deploy';
import { getDeployerWallet } from '../shared/accounts';
import { getProvider } from '../shared/network';
import { PythReader__factory, RewardReader__factory } from '../../typechain';
import { deployContract, sendTxn } from '../shared/deploy';

export default async function main() {
  const provider = getProvider();
  // const [wallet, user0, user1, user2, user3] = getRichWallets(provider);
  const deployerWallet = getDeployerWallet(provider);
  const deployer = new Deployer(hre, deployerWallet);
  
  const reader = await deployContract(deployer, "Reader", [], "reader");
  const rewardReader = await deployContract(deployer, "RewardReader", [], "rewardReader");
  const vaultReader = await deployContract(deployer,"VaultReader", [], "vaultReader")
  const orderBookReader = await deployContract(deployer, "OrderBookReader", [], "orderBookReader");
  const pythReaderDeployed = await deployContract(deployer, "PythReader", [], "pythReader");

  console.log(pythReaderDeployed)
  
}
 main()
  .then(() => process.exit(0))
  .catch(error => {
    console.error(error)
    process.exit(1)
  })
