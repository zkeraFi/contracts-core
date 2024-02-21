import * as hre from "hardhat";
import { ethers } from "ethers";
import { Deployer } from "@matterlabs/hardhat-zksync-deploy";
import { getDeployerWallet } from "../shared/accounts";
import { getProvider } from "../shared/network";
import { deployContract, getJsonField, sendTxn } from "../shared/deploy";
import { getNetworkConfig } from "../shared/zkEraConfig";
import { OrderBookV2__factory, PositionRouterV2__factory, ZkeMulticall__factory } from "../../typechain";

async function main() {
  const provider = getProvider();
  // const [wallet, user0, user1, user2, user3] = getRichWallets(provider);
  const deployerWallet = getDeployerWallet(provider);
  const deployer = new Deployer(hre, deployerWallet);
  const config = getNetworkConfig();

  const posRouterAddress = (await getJsonField("positionRouterV2")) as string;
  const orderBookAddress = (await getJsonField("orderBookV2")) as string;

  const posRouter = PositionRouterV2__factory.connect(posRouterAddress, deployerWallet);
  const orderBook = OrderBookV2__factory.connect(orderBookAddress, deployerWallet);
  const minExecutionFee = ethers.utils.parseEther("0.00042"); //~ $2

  // const zkeMulticallAddress = (await getJsonField("zkeMulticall")) as string;

  // const zkeMulticall = ZkeMulticall__factory.connect(
  //   zkeMulticallAddress,
  //   deployerWallet
  // );

  const zkeMulticall = await deployContract(
    deployer,
    "ZkeMulticall",
    [posRouterAddress, orderBookAddress,minExecutionFee],
    "zkeMulticall",
    false
  );

  await sendTxn(posRouter.setHandler(zkeMulticall.address, true), "posRouter.setHandler");
  await sendTxn(orderBook.setHandler(zkeMulticall.address, true), "orderBook.setHandler");
  // await sendTxn(zkeMulticall.setMinExecutionFee(minExecutionFee), "zkeMulticall.setMinExecutionFee");
  // await sendTxn(zkeMulticall.setGov("0x720986753900A12884773858F63F98713FDf1FfF"), "zkeMulticall.setMinExecutionFee");
  // console.log(zkeMulticall.address);
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
