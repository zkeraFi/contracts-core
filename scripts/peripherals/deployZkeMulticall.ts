import * as hre from "hardhat";
import { ethers } from "ethers";
import { getDeployerWallet } from "../shared/accounts";
import { getProvider } from "../shared/network";
import { deployContract, getJsonField, sendTxn } from "../shared/deploy";
import { getNetworkConfig } from "../shared/zkEraConfig";
import { OrderBookV2__factory, PositionRouterV2__factory } from "../../typechain";

async function main() {
  const provider = getProvider();
  // const [wallet, user0, user1, user2, user3] = getRichWallets(provider);
  const deployerWallet = hre.ethers.provider.getSigner(0);
   
  const config = getNetworkConfig();

  const posRouterAddress = (await getJsonField("positionRouterV2")) as string;
  const orderBookAddress = (await getJsonField("orderBookV2")) as string;

  const posRouter = PositionRouterV2__factory.connect(posRouterAddress, deployerWallet);
  const orderBook = OrderBookV2__factory.connect(orderBookAddress, deployerWallet);
  const minExecutionFee = ethers.utils.parseEther("0.0009");
  const ZkeMulticall = await deployContract(
    "ZkeMulticall",
    [posRouter.address, orderBook.address,minExecutionFee],
    "zkeMulticall"
  );

  await sendTxn(posRouter.setHandler(ZkeMulticall.address, true), "posRouter.setHandler");
  await sendTxn(orderBook.setHandler(ZkeMulticall.address, true), "orderBook.setHandler");

  console.log(ZkeMulticall.address);
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
