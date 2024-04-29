import {
  BlockInfoProxy__factory,
  RewardRouterV4__factory,
  TokenManager__factory,
  ZKE__factory,
  ZlpManager__factory,
} from "../../typechain";
import * as hre from "hardhat";
import { getDeployerWallet } from "../shared/accounts";
import { getProvider } from "../shared/network";
import { deployContractV2 as deployContract, getJsonFieldV2 as getJsonField, sendTxn } from "../shared/deploy";
import { expandDecimals } from "../shared/utilities";
import { getNetworkConfig } from "../shared/zkEraConfig";
import { KEEPER_WALLET, KEEPER_WALLET2 } from "../shared/constants";

export default async function main() {
  const provider = getProvider();
  // const [wallet, user0, user1, user2, user3] = getRichWallets(provider);
  const deployerWallet = hre.ethers.provider.getSigner(0);
   
  const config = getNetworkConfig();

  const blockInfoProxyAddress = (await getJsonField(
    "blockInfoProxy"
  )) as string;
  const zlpManagerAddress = (await getJsonField("zlpManager")) as string;
  const zkeAddress = (await getJsonField("zke")) as string;
  const rewardRouterAddress = (await getJsonField("rewardRouter")) as string;

  const proxyContract = BlockInfoProxy__factory.connect(
    blockInfoProxyAddress,
    deployerWallet
  );
  const zlpManager = ZlpManager__factory.connect(
    zlpManagerAddress,
    deployerWallet
  );
  const zke = ZKE__factory.connect(zkeAddress, deployerWallet);
  const rewardRouterContract = RewardRouterV4__factory.connect(
    rewardRouterAddress,
    deployerWallet
  );

  const maxTokenSupply = expandDecimals("50000000", 18);
const addrDeployer = await deployerWallet.getAddress();
  console.log(addrDeployer)
  // const { vault, tokenManager, zlpManager, rewardRouter, positionRouter, positionManager, zke }

  // const tokenManagerAddress = await getJsonField("tokenManager") as string;
  // const tokenManager = TokenManager__factory.connect(tokenManagerAddress, deployerWallet);
  // const zkeMultisig = (await getJsonField("zkeMultisig")) as string;
  const admin = addrDeployer;
  const tokenManager = addrDeployer;
  const mintReceiver = tokenManager;

  const initialBuffer = 1; //1 sec
  // const buffer = 24 * 60 * 60
  const timelock = await deployContract(
    "Timelock",
    [
      admin, // admin
      initialBuffer, // buffer
      tokenManager, // tokenManager
      mintReceiver, // mintReceiver
      zlpManager.address, // zlpManager
      rewardRouterContract.address, // rewardRouter
      maxTokenSupply, // maxTokenSupply
      10, // marginFeeBasisPoints 0.2%
      500, // maxMarginFeeBasisPoints 5%
      proxyContract.address,
    ],
    "timelock"
  );

  // const deployedTimelock = await contractAt("Timelock", timelock.address, signer)

  await sendTxn(
    timelock.setShouldToggleIsLeverageEnabled(true),
    "deployedTimelock.setShouldToggleIsLeverageEnabled(true)"
  );

  const keeperWallet = KEEPER_WALLET;
  const handlers = [
    addrDeployer,
    keeperWallet
  ];

  for (let i = 0; i < handlers.length; i++) {
    const handler = handlers[i];
    await sendTxn(
      timelock.setContractHandler(handler, true),
      `deployedTimelock.setContractHandler(${handler})`
    );
  }

  const keepers = [keeperWallet];

  for (let i = 0; i < keepers.length; i++) {
    const keeper = keepers[i];
    await sendTxn(
      timelock.setKeeper(keeper, true),
      `deployedTimelock.setKeeper(${keeper})`
    );
  }

  // await sendTxn(timelock.signalApprove(zke.address, admin, "1000000000000000000"), "deployedTimelock.signalApprove")
}

 main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
