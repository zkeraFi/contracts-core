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


const VERIFY = true;

function toUsd(value: number): ethers.BigNumber {
    const normalizedValue = parseInt((value * Math.pow(10, 10)).toString())
    return ethers.BigNumber.from(normalizedValue).mul(ethers.BigNumber.from(10).pow(20))
}

export async function main() {
    const provider = getProvider();
    const config = getNetworkConfig();

    // const blockInfoProxyAddress = await getJsonField("blockInfoProxy") as string;
    // const blockInfoProxy = BlockInfoProxy__factory.connect(blockInfoProxyAddress, deployerWallet);

    // const WTLOS =  await deployContract("WTLOS", [], "wtlos");
    // const WETH =  await deployContract("WETH", [], "weth");
    const usdc =  await deployContract("Token", ["USDC","USDC",6], "usdc")
    // const USDC =  await deployContract("USDC", [], "usdc");
    // const WBTC =  await deployContract("WBTC", [], "wbtc");
    // const PEPE =  await deployContract("PEPE", [], "pepe");
}

 main()
    .then(() => process.exit(0))
    .catch(error => {
        console.error(error)
        process.exit(1)
    })



