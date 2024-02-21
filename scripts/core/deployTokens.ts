import * as hre from 'hardhat';
import { ethers } from 'ethers';
import { Deployer } from '@matterlabs/hardhat-zksync-deploy';
import { getDeployerWallet, getRichWallets } from '../shared/accounts';
import { getProvider } from '../shared/network';
import { deployContract } from '../shared/deploy';
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
    
    const WETH =  await deployContract(deployer, "WETH", ["WETH","WETH",18], "weth");
    const USDC =  await deployContract(deployer, "USDC", [], "usdc");
    const WBTC =  await deployContract(deployer, "WBTC", [], "wbtc");
}

 main()
    .then(() => process.exit(0))
    .catch(error => {
        console.error(error)
        process.exit(1)
    })



