import * as hre from 'hardhat';
import { ethers } from 'ethers';
import { NetworkConfig } from 'hardhat/types';
import { getDeployerWallet, getRichWallets } from '../shared/accounts';
import { getProvider } from '../shared/network';
import { deployContract, getJsonField, sendTxn } from '../shared/deploy';
import { BlockInfoProxy__factory, BlockInfoDefault__factory, Vault__factory, VaultPriceFeed__factory, ZLP__factory, USDG__factory, VaultErrorController__factory, ZlpManager__factory, ShortsTracker__factory, Router__factory } from '../../typechain';
import { expandDecimals } from '../shared/utilities';
import { errors } from '../shared/helpers';
import { getNetworkConfig } from '../shared/zkEraConfig';

function toUsd(value: number): ethers.BigNumber {
    const normalizedValue = parseInt((value * Math.pow(10, 10)).toString())
    return ethers.BigNumber.from(normalizedValue).mul(ethers.BigNumber.from(10).pow(20))
}

export async function main() {
    const provider = getProvider();
    const deployerWallet = hre.ethers.provider.getSigner(0);

    const config = getNetworkConfig();

    const blockInfoProxyAddress = await getJsonField("blockInfoProxy") as string;
    const blockInfoProxy = BlockInfoProxy__factory.connect(blockInfoProxyAddress, deployerWallet);

    // const vaultDelegatePartOneAddress = await getJsonField("vaultDelegatePartOne") as string;
    // const vaultDelegatePartOne = BlockInfoProxy__factory.connect(vaultDelegatePartOneAddress, deployerWallet);

    // const vaultDelegatePartTwoAddress = await getJsonField("vaultDelegatePartTwo") as string;
    // const vaultDelegatePartTwo = BlockInfoProxy__factory.connect(vaultDelegatePartTwoAddress, deployerWallet);

    // const vaultDelegatePartThreeAddress = await getJsonField("vaultDelegatePartThree") as string;
    // const vaultDelegatePartThree = BlockInfoProxy__factory.connect(vaultDelegatePartThreeAddress, deployerWallet);
    
    const vaultDelegatePartOne =  await deployContract("VaultDelegatePartOne", [], "vaultDelegatePartOne");
    const vaultDelegatePartTwo =  await deployContract("VaultDelegatePartTwo", [], "vaultDelegatePartTwo");
    const vaultDelegatePartThree =  await deployContract("VaultDelegatePartThree", [], "vaultDelegatePartThree");

    // const blockInfoProxy = await deployContract("BlockInfoProxy", [], "blockInfoProxy")
    // const blockInfoDefaultImpl = await deployContract("BlockInfoDefault", [], "blockInfoDefaultImpl")

    // await sendTxn(blockInfoProxy.setImplementation(blockInfoDefaultImpl.address),
    // "proxyContract.setImplementation(implDefault.address)");

    // const vaultAddress = await getJsonField("vault") as string;
    // const vault = Vault__factory.connect(vaultAddress, deployerWallet);

    const vault = await deployContract("Vault", [
        vaultDelegatePartOne.address,
        vaultDelegatePartTwo.address,
        vaultDelegatePartThree.address,
        blockInfoProxy.address
    ], "vault");

    
    // const usdgAddress = await getJsonField("usdg") as string;
    // const usdgContract = USDG__factory.connect(usdgAddress, deployerWallet);
    const usdgContract = await deployContract("USDG", [vault.address], "usdg")

    const router = await deployContract("Router", [vault.address, usdgContract.address, config.weth], "router")

    const vaultPriceFeed = await deployContract("VaultPriceFeed", [blockInfoProxy.address], "vaultPriceFeed")
    const vaultPriceFeedContract = VaultPriceFeed__factory.connect(vaultPriceFeed.address, deployerWallet);

    await sendTxn(vaultPriceFeedContract.setMaxStrictPriceDeviation(expandDecimals(1, 28)), "vaultPriceFeed.setMaxStrictPriceDeviation") // 0.05 USD
    await sendTxn(vaultPriceFeedContract.setIsAmmEnabled(false), "vaultPriceFeed.setIsAmmEnabled")

    // const zlpContractAddress = await getJsonField("zlp") as string;
    // const zlp = ZLP__factory.connect(zlpContractAddress, deployerWallet);
    const zlp = await deployContract("ZLP", [], "zlp")
    await sendTxn(zlp.setInPrivateTransferMode(true), "zlp.setInPrivateTransferMode")

    // const degenLP = await deployContract("DegenLP", [], "degenLP")
    // await sendTxn(degenLP.setInPrivateTransferMode(true), "degenLP.setInPrivateTransferMode")

    const shortsTracker = await deployContract("ShortsTracker", [vault.address], "shortsTracker")

    // const vaultAddress = await getJsonField("vault") as string;
    // const vault = Vault__factory.connect(vaultAddress, deployerWallet);
    // const usdgContractAddress = await getJsonField("usdg") as string;
    // const usdgContract = USDG__factory.connect(usdgContractAddress, deployerWallet);
    
    // const shortsTrackerAddress = await getJsonField("shortsTracker") as string;
    // const shortsTracker = ShortsTracker__factory.connect(shortsTrackerAddress, deployerWallet);
    // const vaultPriceFeedAddress = await getJsonField("vaultPriceFeed") as string;
    // const vaultPriceFeed = VaultPriceFeed__factory.connect(vaultPriceFeedAddress, deployerWallet);
    // const routerAddress = await getJsonField("router") as string;
    // const router = Router__factory.connect(routerAddress, deployerWallet);
    
    const zlpManager = await deployContract("ZlpManager",
        [vault.address, usdgContract.address, zlp.address, shortsTracker.address, 15 * 60, blockInfoProxy.address], "zlpManager")
    // const zlpManager = await deployContract("ZlpManager",
        // [vault.address, usdgContract.address, degenLP.address, shortsTracker.address, 15 * 60, blockInfoProxy.address], "zlpManager")

    const zlpManagerContract = ZlpManager__factory.connect(zlpManager.address, deployerWallet);
    await sendTxn(zlpManagerContract.setInPrivateMode(true), "zlpManager.setInPrivateMode")

    await sendTxn(zlp.setMinter(zlpManager.address, true), "zlp.setMinter")
    // await sendTxn(degenLP.setMinter(zlpManager.address, true), "zlp.setMinter")

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

    const vaultErrorController = await deployContract("VaultErrorController", [], "vaultErrorController")
    const vaultErrorControllerContract = VaultErrorController__factory.connect(vaultErrorController.address, deployerWallet);
    await sendTxn(vault.setErrorController(vaultErrorController.address), "vault.setErrorController")
    await sendTxn(vaultErrorControllerContract.setErrors(vault.address, errors), "vaultErrorController.setErrors")

    const vaultUtils = await deployContract("VaultUtils", [vault.address], "vaultUtils")
    await sendTxn(vault.setVaultUtils(vaultUtils.address), "vault.setVaultUtils")
}

 main()
    .then(() => process.exit(0))
    .catch(error => {
        console.error(error)
        process.exit(1)
    })



