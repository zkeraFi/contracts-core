import * as hre from 'hardhat';
import { Deployer } from '@matterlabs/hardhat-zksync-deploy';
import { getDeployerWallet } from '../shared/accounts';
import { getProvider } from '../shared/network';
import { deployContract, sendTxn } from '../shared/deploy';

async function main() {
  const provider = getProvider();
  const deployerWallet = getDeployerWallet(provider);
  const deployer = new Deployer(hre, deployerWallet);
  const tokenManager = await deployContract(deployer, "TokenManager", [1],"tokenManager")

  const signers = [""]

  await sendTxn(tokenManager.initialize(signers), "tokenManager.initialize")
}

main()
  .then(() => process.exit(0))
  .catch(error => {
    console.error(error)
    process.exit(1)
  })
