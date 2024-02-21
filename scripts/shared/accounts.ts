import * as hre from 'hardhat';
import { ethers } from 'ethers';
import { Deployer } from '@matterlabs/hardhat-zksync-deploy';
import { Wallet, Contract, utils, Provider } from 'zksync-web3';
import { NetworkConfig } from 'hardhat/types';

import dotenv from 'dotenv';
dotenv.config();


export interface Account {
    address: string;
    privateKey: string;
}


const richAccounts: Account[] = [
    {
        "address": "0x4F9133D1d3F50011A6859807C837bdCB31Aaab13",
        "privateKey": "0xe667e57a9b8aaa6709e51ff7d093f1c5b73b63f9987e4ab4aa9a5c699e024ee8"
    },
    {
        "address": "0xa61464658AfeAf65CccaaFD3a512b69A83B77618",
        "privateKey": "0xac1e735be8536c6534bb4f17f06f6afc73b2b5ba84ac2cfb12f7461b20c0bbe3"
    },
    {
        "address": "0x0D43eB5B8a47bA8900d84AA36656c92024e9772e",
        "privateKey": "0xd293c684d884d56f8d6abd64fc76757d3664904e309a0645baf8522ab6366d9e"
    },
    {
        "address": "0xA13c10C0D5bd6f79041B9835c63f91de35A15883",
        "privateKey": "0x850683b40d4a740aa6e745f889a6fdc8327be76e122f5aba645a5b02d0248db8"
    },
    {
        "address": "0x8002cD98Cfb563492A6fB3E7C8243b7B9Ad4cc92",
        "privateKey": "0xf12e28c0eb1ef4ff90478f6805b68d63737b7f33abfa091601140805da450d93"
    },
    {
        "address": "0xbd29A1B981925B94eEc5c4F1125AF02a2Ec4d1cA",
        "privateKey": "0x28a574ab2de8a00364d5dd4b07c4f2f574ef7fcc2a86a197f65abaec836d1959"
    },
    {
        "address": "0xedB6F5B4aab3dD95C7806Af42881FF12BE7e9daa",
        "privateKey": "0x74d8b3a188f7260f67698eb44da07397a298df5427df681ef68c45b34b61f998"
    },
    {
        "address": "0xe706e60ab5Dc512C36A4646D719b889F398cbBcB",
        "privateKey": "0xbe79721778b48bcc679b78edac0ce48306a8578186ffcb9f2ee455ae6efeace1"
    },
    {
        "address": "0xE90E12261CCb0F3F7976Ae611A29e84a6A85f424",
        "privateKey": "0x3eb15da85647edd9a1159a4a13b9e7c56877c4eb33f614546d4db06a51868b1c"
    }
]



const MAINNET_DEPLOYER_PK = process.env.MAINNET_DEPLOYER_PK;
const TESTNET_DEPLOYER_PK = process.env.TESTNET_DEPLOYER_PK;
const TESTNET_KEEPER_PK = process.env.TESTNET_KEEPER_PK;
const MAINNET_KEEPER_PK = process.env.MAINNET_KEEPER_PK;

if (!MAINNET_DEPLOYER_PK || !TESTNET_DEPLOYER_PK || !TESTNET_KEEPER_PK || !MAINNET_KEEPER_PK) {
    console.log("MAINNET_DEPLOYER_PK", MAINNET_DEPLOYER_PK);
    console.log("TESTNET_DEPLOYER_PK", TESTNET_DEPLOYER_PK);
    console.log("TESTNET_KEEPER_PK", TESTNET_KEEPER_PK);

    throw new Error('please specify env variables');
}

const networksDeployerPk = new Map<string, string>([
    ["zkTestnet", TESTNET_DEPLOYER_PK],
    ["zkSepolia", TESTNET_DEPLOYER_PK],
    ["zkMainnet", MAINNET_DEPLOYER_PK],
    ["keeper", MAINNET_KEEPER_PK]
]);

export function getRichWallets(provider: Provider): Wallet[] {
    return richAccounts.map(account => new Wallet(account.privateKey, provider));
}

export function getDeployerWallet(provider: Provider): Wallet {
    const pk = networksDeployerPk.get(hre.network.name);
    if(!pk){
        throw new Error('can`t resolve pk for this network');
    }
    const wallet = new Wallet(pk, provider);
    return wallet;
}

export function getKeeperWallet(provider: Provider): Wallet {
    const pk = networksDeployerPk.get("keeper");
    if(!pk){
        throw new Error('can`t resolve pk for this network');
    }
    const wallet = new Wallet(pk, provider);
    return wallet;
}


