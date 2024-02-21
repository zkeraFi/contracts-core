import * as hre from 'hardhat';
import { Deployer } from '@matterlabs/hardhat-zksync-deploy';
import { getDeployerWallet } from '../shared/accounts';
import { getProvider } from '../shared/network';
import { deployContract, sendTxn } from '../shared/deploy';
import { WeeklyVestingV2__factory, ZKE__factory } from '../../typechain';




async function main() {
  const provider = getProvider();
  // const [wallet, user0, user1, user2, user3] = getRichWallets(provider);
  const deployerWallet = getDeployerWallet(provider);
  const deployer = new Deployer(hre, deployerWallet);

  const zkeAddress = ""
  const option1Address = ""
  const option2Address = "" //MigrateVesting
  const option3Address = ""

//   const option1 = await deployContract(deployer, "WeeklyVestingV2", [option1Address]);
//   const option2 = await deployContract(deployer, "WeeklyVestingV2", [option2Address]);
//   const option3 = await deployContract(deployer, "WeeklyVestingV2", [option3Address]);

  const option1Contract = WeeklyVestingV2__factory.connect("", deployerWallet);
  const option2Contract = WeeklyVestingV2__factory.connect("", deployerWallet);
  const option3Contract = WeeklyVestingV2__factory.connect("", deployerWallet);
  
  const option1TotalPurchased = await option1Contract.totalZkePurchased();
  const option2TotalPurchased = await option2Contract.totalZkePurchased();
  const option3TotalPurchased = await option3Contract.totalZkePurchased();
    
  console.log("option1TotalPurchased ", option1TotalPurchased.toString())    
  console.log("option2TotalPurchased ", option2TotalPurchased.toString())    
  console.log("option3TotalPurchased ", option3TotalPurchased.toString())  
  const zkeContract = ZKE__factory.connect(zkeAddress, deployerWallet);
  await sendTxn(zkeContract.transfer(option1Contract.address, option1TotalPurchased), "zkeContract.transfer(option1Contract.address, option1TotalPurchased)");
  await sendTxn(zkeContract.transfer(option2Contract.address, option2TotalPurchased), "zkeContract.transfer(option2Contract.address, option2TotalPurchased)");
  await sendTxn(zkeContract.transfer(option3Contract.address, option3TotalPurchased), "zkeContract.transfer(option3Contract.address, option3TotalPurchased)");
}

main()
  .then(() => process.exit(0))
  .catch(error => {
    console.error(error)
    process.exit(1)
  })
