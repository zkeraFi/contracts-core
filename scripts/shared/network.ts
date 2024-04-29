import * as hre from 'hardhat';
import {  NetworkConfig } from 'hardhat/types';

export function getCurrentNetworkURL(): string{
    const network: NetworkConfig = hre.config.networks[hre.network.name] 
    const url = (network as any).url;
    if (url === undefined) throw Error("undefined network url");
    return url as string;
}

export function getNetworkURL(networkName: string): string{
    const network: NetworkConfig = hre.config.networks[networkName] 
    const url = (network as any).url;
    if (url === undefined) throw Error("undefined network url");
    return url as string;
}

export function getProvider(): any{
    const currentNetworkUrl = getCurrentNetworkURL();
    console.log("currentNetworkUrl:", currentNetworkUrl)
    return hre.ethers.provider;
}