import * as hre from "hardhat";
import { ethers } from "ethers";
import { Deployer } from "@matterlabs/hardhat-zksync-deploy";
import { getDeployerWallet } from "../shared/accounts";
import { getProvider } from "../shared/network";
import { deployContract } from "../shared/deploy";

async function main() {
  const provider = getProvider();
  // const [wallet, user0, user1, user2, user3] = getRichWallets(provider);
  const deployerWallet = hre.ethers.provider.getSigner(0);
   

  const timelock = "0xCb8E330e67b612e1Ef6C7513CC5Da370c1B3879b";
  const vault = "0x20232E8724B7dEb228E788448773A4D3C9FfB684";
  const positionRouter = "0xcea728F18285a116675442488717D9a79841816B";

  const FeeRouter = await deployContract(
    deployer,
    "FeeRouter",
    [timelock, vault, [positionRouter]],
    "feeRouter"
  );

  console.log(FeeRouter.address);
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
