import * as hre from 'hardhat';

interface ZkNetworkConfig {
    pyth: string,
    usdc: string,
    usdcPriceFeedId: string,
    btcPriceFeedId: string,
    weth: string,
    wbtc: string,
    ethPriceFeedId: string,
    connectionEndpoint: string
}

function zkEraSepoliaConfig(): ZkNetworkConfig {
    return {
        pyth: "0x056f829183Ec806A78c26C98961678c24faB71af",
        usdc: "0xf0Fc093D61444b29f0063c365BE2A49c427fB92d",
        weth: "0x32375B523fcD7C768Ee0E75D3b98de1B4e5c2db3",
        wbtc: "0x9427f769BBB8f07aC432225A98Ceb5315A473613",
        usdcPriceFeedId: "0xeaa020c61cc479712813461ce153894a96a6c00b21ed0cfc2798d1f9a9e9c94a",
        ethPriceFeedId: "0xff61491a931112ddf1bd8147cd1b641375f79f5825126d665480874634fd0ace",
        btcPriceFeedId: "0xe62df6c8b4a85fe1a67db44dc12de5db330f7ac66b72dc658afedf0f4a415b43",
        connectionEndpoint: "https://hermes.pyth.network"
    };
}

function zkEraTestnetConfig(): ZkNetworkConfig {
    return {
        pyth: "0xC38B1dd611889Abc95d4E0a472A667c3671c08DE",
        usdc: "0xbb30022950dc346136b4286628C1a6bcf93C1AAb",
        weth: "0xc023d6bAE4DbA3E2cB0575be2A5C2Ba6571DFfcf",
        wbtc: "0x5796F3E984eCF25C2Da3601D27830fA6131Cfded",
        usdcPriceFeedId: "0x41f3625971ca2ed2263e78573fe5ce23e13d2558ed3f2e47ab0f84fb9e7ae722",
        ethPriceFeedId: "0xca80ba6dc32e08d06f1aa886011eed1d77c77be9eb761cc10d72b7d0a2fd57a6",
        btcPriceFeedId: "0xf9c0172ba10dfa4d19088d94f5bf61d3b54d5bd7483a322a982e1373ee8ea31b",
        connectionEndpoint: "https://hermes-beta.pyth.network"
    };
}

function zkEraMainnet(): ZkNetworkConfig {
    return {
        pyth: "0xf087c864AEccFb6A2Bf1Af6A0382B0d0f6c5D834",
        usdc: "0x3355df6D4c9C3035724Fd0e3914dE96A5a83aaf4", // 6 decimals
        weth: "0x5AEa5775959fBC2557Cc8789bC1bf90A239D9a91", 
        wbtc: "0xBBeB516fb02a01611cBBE0453Fe3c580D7281011", // 8 decimals
        usdcPriceFeedId: "0xeaa020c61cc479712813461ce153894a96a6c00b21ed0cfc2798d1f9a9e9c94a",
        ethPriceFeedId: "0xff61491a931112ddf1bd8147cd1b641375f79f5825126d665480874634fd0ace",
        btcPriceFeedId: "0xe62df6c8b4a85fe1a67db44dc12de5db330f7ac66b72dc658afedf0f4a415b43",
        connectionEndpoint: "https://hermes.pyth.network"
    };
}

export function getNetworkConfig(): ZkNetworkConfig {
    if(hre.network.name.indexOf("zkMainnet") != -1){
        return zkEraMainnet()
    } else if(hre.network.name.indexOf("zkTestnet") != -1){
        return zkEraTestnetConfig();
    } else if(hre.network.name.indexOf("zkSepolia") != -1){
        return zkEraSepoliaConfig();
    }
    throw new Error("network config for this network is not specified");
}