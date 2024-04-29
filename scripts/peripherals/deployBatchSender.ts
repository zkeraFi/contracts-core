import * as hre from "hardhat";
import { ethers } from "ethers";
import { getDeployerWallet } from "../shared/accounts";
import { getProvider } from "../shared/network";
import { deployContract } from "../shared/deploy";

async function main() {
  const provider = getProvider();
  // const [wallet, user0, user1, user2, user3] = getRichWallets(provider);
  const deployerWallet = hre.ethers.provider.getSigner(0);
   

  const BatchSender = await deployContract(
    "BatchSender",
    [],
    "batchSender"
  );

  console.log(BatchSender.address);
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
