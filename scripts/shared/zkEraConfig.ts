import * as hre from 'hardhat';

interface telosTestnetConfig {
    dia: string,
    usdc: string,
    usdcPriceFeedId: string,
    wethPriceFeedId: string,
    btcPriceFeedId: string,
    pepePriceFeedId: string,
    weth: string,
    wbtc: string,
    pepe:string,
    eth:string,
    ethPriceFeedId: string
}

function telosTestnet(): telosTestnetConfig {
    return {
        dia:"0x261cF410d0A83193D647E47c35178288D99E12Dd",
        usdc: "0x8FDd28E4B44466Af31969E27EF8cC7cD279F2073", // 6 decimals
        weth: "0x2A9B33c362020c0D14c6D0B25b4C515D1C1B74FF", 
        wbtc: "0x64A60e84aC6e6f03Feb22Bc6cB222F672C25D937", // 8 decimals
        pepe: "0x140CfCc4349058ff81E74B342A2cE804f659C735",
        eth: "0xDd5E12053b085b5b96383c0CE246c06c3Be99943",
        usdcPriceFeedId: "USDC/USD",
        wethPriceFeedId: "TLOS/USD",
        ethPriceFeedId: "ETH/USD",
        btcPriceFeedId: "BTC/USD",
        pepePriceFeedId: "PEPE/USD"
    };
}

function telos(): telosTestnetConfig {
    return {
        dia:"0xf774801c9f1b11e70966ce65ec7f95d7730f380d",
        usdc: "0x8D97Cea50351Fb4329d591682b148D43a0C3611b", // 6 decimals
        weth: "0xD102cE6A4dB07D247fcc28F366A623Df0938CA9E", 
        wbtc: "0x7627b27594bc71e6Ab0fCE755aE8931EB1E12DAC", // 8 decimals
        pepe: "",
        eth: "0xA0fB8cd450c8Fd3a11901876cD5f17eB47C6bc50",
        usdcPriceFeedId: "USDC/USD",
        wethPriceFeedId: "TLOS/USD",
        ethPriceFeedId: "ETH/USD",
        btcPriceFeedId: "BTC/USD",
        pepePriceFeedId: "PEPE/USD"
    };
}

export function getNetworkConfig(): telosTestnetConfig {
    if(hre.network.name.indexOf("telosTestnet") != -1){
        return telosTestnet()
    }
    if(hre.network.name.indexOf("telos") != -1){
        return telos()
    }
    throw new Error("network config for this network is not specified");
}