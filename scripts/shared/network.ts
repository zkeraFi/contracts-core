import * as hre from 'hardhat';
import { NetworkConfig } from 'hardhat/types';
import { Provider } from 'zksync-web3';

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

export function getProvider(): Provider{
    const currentNetworkUrl = getCurrentNetworkURL();
    console.log("currentNetworkUrl:", currentNetworkUrl)
    return new Provider(currentNetworkUrl);
}