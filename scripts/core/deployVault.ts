import * as hre from 'hardhat';
import { ethers } from 'ethers';
import { Deployer } from '@matterlabs/hardhat-zksync-deploy';
import { getDeployerWallet } from '../shared/accounts';
import { getProvider } from '../shared/network';
import { deployContract, sendTxn } from '../shared/deploy';
import { VaultPriceFeed__factory, USDG__factory, VaultErrorController__factory, ZlpManager__factory } from '../../typechain';
import { expandDecimals } from '../shared/utilities';
import { errors } from '../shared/helpers';
import { getNetworkConfig } from '../shared/zkEraConfig';


const VERIFY = true;

function toUsd(value: number): ethers.BigNumber {
    const normalizedValue = parseInt((value * Math.pow(10, 10)).toString())
    return ethers.BigNumber.from(normalizedValue).mul(ethers.BigNumber.from(10).pow(20))
}

export async function main() {
    const provider = getProvider();
    // const [wallet, user0, user1, user2, user3] = getRichWallets(provider);
    const deployerWallet = getDeployerWallet(provider);
    const deployer = new Deployer(hre, deployerWallet);

    const config = getNetworkConfig();

    // const blockInfoProxyAddress = await getJsonField("blockInfoProxy") as string;
    // const blockInfoProxy = BlockInfoProxy__factory.connect(blockInfoProxyAddress, deployerWallet);
    
    const vaultDelegatePartOne =  await deployContract(deployer, "VaultDelegatePartOne", [], "vaultDelegatePartOne");
    const vaultDelegatePartTwo =  await deployContract(deployer, "VaultDelegatePartTwo", [], "vaultDelegatePartTwo");
    const vaultDelegatePartThree =  await deployContract(deployer, "VaultDelegatePartThree", [], "vaultDelegatePartThree");

    const blockInfoProxy = await deployContract(deployer, "BlockInfoProxy", [], "blockInfoProxy")
    const blockInfoDefaultImpl = await deployContract(deployer, "BlockInfoDefault", [], "blockInfoDefaultImpl")

    await sendTxn(blockInfoProxy.setImplementation(blockInfoDefaultImpl.address),
    "proxyContract.setImplementation(implDefault.address)");

    const vault = await deployContract(deployer, "Vault", [
        vaultDelegatePartOne.address,
        vaultDelegatePartTwo.address,
        vaultDelegatePartThree.address,
        blockInfoProxy.address
    ], "vault");

    const usdg = await deployContract(deployer, "USDG", [vault.address], "usdg")
    const usdgContract = USDG__factory.connect(usdg.address, deployerWallet);
    // const nativeToken = await deployContract(deployer, "WETH", ["Wrapped Ether", "WETH", 18])

    const router = await deployContract(deployer, "Router", [vault.address, usdg.address, config.weth, config.pyth], "router")

    const vaultPriceFeed = await deployContract(deployer, "VaultPriceFeed", [blockInfoProxy.address], "vaultPriceFeed")
    const vaultPriceFeedContract = VaultPriceFeed__factory.connect(vaultPriceFeed.address, deployerWallet);

    await sendTxn(vaultPriceFeedContract.setMaxStrictPriceDeviation(expandDecimals(1, 28)), "vaultPriceFeed.setMaxStrictPriceDeviation") // 0.05 USD
    await sendTxn(vaultPriceFeedContract.setIsAmmEnabled(false), "vaultPriceFeed.setIsAmmEnabled")

    const zlp = await deployContract(deployer, "ZLP", [], "zlp")
    await sendTxn(zlp.setInPrivateTransferMode(true), "zlp.setInPrivateTransferMode")

    const shortsTracker = await deployContract(deployer, "ShortsTracker", [vault.address], "shortsTracker")

    // const vaultAddress = await getJsonField("vault") as string;
    // const vault = Vault__factory.connect(vaultAddress, deployerWallet);
    // const usdgContractAddress = await getJsonField("usdg") as string;
    // const usdgContract = USDG__factory.connect(usdgContractAddress, deployerWallet);
    // const zlpContractAddress = await getJsonField("zlp") as string;
    // const zlpContract = ZLP__factory.connect(zlpContractAddress, deployerWallet);
    // const shortsTrackerAddress = await getJsonField("shortsTracker") as string;
    // const shortsTracker = ShortsTracker__factory.connect(shortsTrackerAddress, deployerWallet);
    // const vaultPriceFeedAddress = await getJsonField("vaultPriceFeed") as string;
    // const vaultPriceFeed = VaultPriceFeed__factory.connect(vaultPriceFeedAddress, deployerWallet);
    // const routerAddress = await getJsonField("router") as string;
    // const router = Router__factory.connect(routerAddress, deployerWallet);
    
    const zlpManager = await deployContract(deployer, "ZlpManager",
        [vault.address, usdgContract.address, zlp.address, shortsTracker.address, 15 * 60, blockInfoProxy.address], "zlpManager")
    const zlpManagerContract = ZlpManager__factory.connect(zlpManager.address, deployerWallet);
    await sendTxn(zlpManagerContract.setInPrivateMode(true), "zlpManager.setInPrivateMode")

    await sendTxn(zlp.setMinter(zlpManager.address, true), "zlp.setMinter")
    await sendTxn(usdgContract.addVault(zlpManager.address), "usdg.addVault(zlpManager)")

    await sendTxn(vault.initialize(
        router.address, // router
        usdgContract.address, // usdg
        vaultPriceFeed.address, // priceFeed
        toUsd(2), // liquidationFeeUsd
        100, // fundingRateFactor
        100 // stableFundingRateFactor
    ), "vault.initialize")

    await sendTxn(vault.setFundingRate(60 * 60, 100, 100), "vault.setFundingRate")

    await sendTxn(vault.setInManagerMode(true), "vault.setInManagerMode")
    await sendTxn(vault.setManager(zlpManager.address, true), "vault.setManager")
    
    await sendTxn(vault.setFees(
        60, // _taxBasisPoints
        5, // _stableTaxBasisPoints
        25, // _mintBurnFeeBasisPoints
        30, // _swapFeeBasisPoints
        1, // _stableSwapFeeBasisPoints
        10, // _marginFeeBasisPoints
        toUsd(2), // _liquidationFeeUsd
        24 * 60 * 60, // _minProfitTime
        true // _hasDynamicFees
    ), "vault.setFees")

    const vaultErrorController = await deployContract(deployer, "VaultErrorController", [], "vaultErrorController")
    const vaultErrorControllerContract = VaultErrorController__factory.connect(vaultErrorController.address, deployerWallet);
    await sendTxn(vault.setErrorController(vaultErrorController.address), "vault.setErrorController")
    await sendTxn(vaultErrorControllerContract.setErrors(vault.address, errors), "vaultErrorController.setErrors")

    const vaultUtils = await deployContract(deployer, "VaultUtils", [vault.address], "vaultUtils")
    await sendTxn(vault.setVaultUtils(vaultUtils.address), "vault.setVaultUtils")
}

 main()
    .then(() => process.exit(0))
    .catch(error => {
        console.error(error)
        process.exit(1)
    })



