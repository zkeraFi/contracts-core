import * as hre from "hardhat";
import { ethers } from "ethers";
import { Deployer } from "@matterlabs/hardhat-zksync-deploy";
import { getDeployerWallet } from "../shared/accounts";
import { getProvider } from "../shared/network";
import { deployContract } from "../shared/deploy";

async function main() {
  const provider = getProvider();
  // const [wallet, user0, user1, user2, user3] = getRichWallets(provider);
  const deployerWallet = getDeployerWallet(provider);
  const deployer = new Deployer(hre, deployerWallet);

  const zkeMultisig = await deployContract(
    deployer,
    "ZkeMultisig",
    [[deployerWallet.address],1],
    "zkeMultisig"
  );
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
