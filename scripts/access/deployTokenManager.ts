import * as hre from 'hardhat';
 
import { getDeployerWallet } from '../shared/accounts';
import { getProvider } from '../shared/network';
import { deployContract, sendTxn } from '../shared/deploy';

async function main() {
  const provider = getProvider();
  const deployerWallet = hre.ethers.provider.getSigner(0);
   
  const tokenManager =  await deployContract("TokenManager", [1], "tokenManager")

  const signers = [
    "0x41768A138dD2D033Cf863c6957245FF8A2CBb98d" // Nev
  ]

  await sendTxn(tokenManager.initialize(signers), "tokenManager.initialize")
}

main()
  .then(() => process.exit(0))
  .catch(error => {
    console.error(error)
    process.exit(1)
  })
