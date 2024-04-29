import * as hre from 'hardhat';
 
import { getDeployerWallet } from '../shared/accounts';
import { getProvider } from '../shared/network';
import { deployContract, sendTxn } from '../shared/deploy';
import { WeeklyVestingV2__factory, ZKE__factory } from '../../typechain';




async function main() {
  const provider = getProvider();
  // const [wallet, user0, user1, user2, user3] = getRichWallets(provider);
  const deployerWallet = hre.ethers.provider.getSigner(0);
   

  const zkeAddress = "0x7b3e1236c39ddD2e61cF6Da6ac6D11193238ccB0"
  const option1Address = "0x5b1bFb4558b70139cb2d90A70AA49Cd4FFBEAcC9"
  const option2Address = "0x6096eD5aD61A3C0922e9BF1485fb44aF35fD8Ad9" //MigrateVesting
  const option3Address = "0xE025C9db68D440EDA3fAD61Dcb23c4f61B8d73E1"

//   const option1 =  await deployContract( "WeeklyVestingV2", [option1Address]);
//   const option2 =  await deployContract( "WeeklyVestingV2", [option2Address]);
//   const option3 =  await deployContract( "WeeklyVestingV2", [option3Address]);

  const option1Contract = WeeklyVestingV2__factory.connect("0x3A7cDA0746F384101bf7A05B1A7cC07D554B4716", deployerWallet);
  const option2Contract = WeeklyVestingV2__factory.connect("0xB28ad19CaEf53aca7263c5cBf526EBBD0f1a9053", deployerWallet);
  const option3Contract = WeeklyVestingV2__factory.connect("0x068eC68e1e68333430E62745697cC6EE0e62292E", deployerWallet);
  
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
