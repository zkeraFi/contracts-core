import * as hre from 'hardhat';
 
import { getDeployerWallet } from '../shared/accounts';
import { getProvider } from '../shared/network';
import { deployContract, getJsonField, getJsonFieldV2, sendTxn } from '../shared/deploy';

import { getNetworkConfig } from '../shared/zkEraConfig';
import { DIAPriceFeed__factory, Timelock__factory, Vault__factory, VaultPriceFeed__factory } from '../../typechain';
import { bigNumberify, expandDecimals } from '../shared/utilities';

function toChainlinkPrice(value: number) {
    const price = bigNumberify(value).pow(Math.pow(10, 8))
    return price
}

type TokenConfig = [string, number, number, number, number, boolean, boolean];

function getEthConfig(weth: string): TokenConfig {
    return [
        weth, // _token
        18, // _tokenDecimals
        15000, // _tokenWeight
        0, // _minProfitBps
        0, // _maxUsdgAmount
        false, // _isStable
        true // _isShortable
    ]
}

function getTlosConfig(tlos: string): TokenConfig {
    return [
        tlos, // _token
        18, // _tokenDecimals
        30000, // _tokenWeight
        0, // _minProfitBps
        0, // _maxUsdgAmount
        false, // _isStable
        true // _isShortable
    ]
}

function getBtcConfig(btc: string): TokenConfig {
    return [
        btc, // _token
        8, // _tokenDecimals
        10000, // _tokenWeight
        0, // _minProfitBps
        0, // _maxUsdgAmount
        false, // _isStable
        true // _isShortable
    ]
}

function getUsdcConfig(usdc: string): TokenConfig {
    return [
        usdc, // _token
        6, // _tokenDecimals
        45000, // _tokenWeight
        0, // _minProfitBps
        0, // _maxUsdgAmount
        true, // _isStable
        false // _isShortable
    ]
}


export default async function main() {
    const provider = getProvider();
    // const [wallet, user0, user1, user2, user3] = getRichWallets(provider);
    const deployerWallet = hre.ethers.provider.getSigner(0);
     
    const vaultAddress = await getJsonField("vault") as string
    const vaultPriceFeedAddress = await getJsonField("vaultPriceFeed") as string

    const config = getNetworkConfig();
    const vault = Vault__factory.connect(vaultAddress, deployerWallet);
    const timelockAddress = await getJsonField("timelock") as string
    const timelock = Timelock__factory.connect(timelockAddress, deployerWallet);
    const vaultPriceFeed = VaultPriceFeed__factory.connect(vaultPriceFeedAddress, deployerWallet);

    // const usdc =  await deployContract( "USDC", [], "usdc") //ONLY TESTNET
    // const wbtc =  await deployContract( "WBTC", [], "wbtc") //ONLY TESTNET
    // const wagmi =  await deployContract( "WAGMI", [], "wagmi") //ONLY TESTNET
    // const usdc = USDC__factory.connect(config.usdc, deployerWallet);

    const ethPriceFeedId = config.ethPriceFeedId;
    const wethPriceFeedId = config.wethPriceFeedId;
    const usdcPriceFeedId = config.usdcPriceFeedId;
    const btcPriceFeedId = config.btcPriceFeedId;

    const age = 120

    const wethPriceFeed =  await deployContract( "DIAPriceFeed", [config.dia, wethPriceFeedId, age, 5, false], "wethPriceFeed");
    const ethPriceFeed =  await deployContract( "DIAPriceFeed", [config.dia, ethPriceFeedId, age, 5, false], "ethPriceFeed");
    const btcPriceFeed =  await deployContract( "DIAPriceFeed", [config.dia, btcPriceFeedId, age, 5, false], "btcPriceFeed");
    const usdcPriceFeed =  await deployContract( "DIAPriceFeed", [config.dia, usdcPriceFeedId, age, 5, false], "usdcPriceFeed");





    // const wethPriceFeedAddress = await getJsonField("wethPriceFeed") as string;
    // const wethPriceFeed = DIAPriceFeed__factory.connect(wethPriceFeedAddress, deployerWallet);

    // const ethPriceFeedAddress = await getJsonField("ethPriceFeed") as string;
    // const ethPriceFeed = DIAPriceFeed__factory.connect(ethPriceFeedAddress, deployerWallet);

    // const btcPriceFeedAddress = await getJsonField("btcPriceFeed") as string;
    // const btcPriceFeed = DIAPriceFeed__factory.connect(btcPriceFeedAddress, deployerWallet);

    // const usdcPriceFeedAddress = await getJsonField("usdcPriceFeed") as string;
    // const usdcPriceFeed = DIAPriceFeed__factory.connect(usdcPriceFeedAddress, deployerWallet);


    // validateNewPriceFeed
    // const maxPriceWeth = await wethPriceFeed['latestAnswer(bool)'](true);
    // const minPriceWeth = await wethPriceFeed['latestAnswer(bool)'](false);

    // console.log(`maxPriceTlos ${maxPriceWeth.toString()}`);
    // console.log(`minPriceTlos ${minPriceWeth.toString()}`);

    // const maxPriceEth = await ethPriceFeed['latestAnswer(bool)'](true);
    // const minPriceEth = await ethPriceFeed['latestAnswer(bool)'](false);

    // console.log(`maxPriceEth ${maxPriceEth.toString()}`);
    // console.log(`minPriceEth ${minPriceEth.toString()}`);

    // const maxPriceBtc = await btcPriceFeed['latestAnswer(bool)'](true);
    // const minPriceBtc = await btcPriceFeed['latestAnswer(bool)'](false);

    // console.log(`maxPriceBtc ${maxPriceBtc.toString()}`);
    // console.log(`minPriceBtc ${minPriceBtc.toString()}`);

    // const maxPriceUsdc = await usdcPriceFeed['latestAnswer(bool)'](true);
    // const minPriceUsdc = await usdcPriceFeed['latestAnswer(bool)'](false);

    // console.log(`maxPriceUsdc ${maxPriceUsdc.toString()}`);
    // console.log(`minPriceUsdc ${minPriceUsdc.toString()}`);


    // update vault and vaultPriceFeed config
  // await sendTxn(timelock.signalVaultSetTokenConfig(vaultAddress, ...getWagmiConfig(config.wagmi)), "timelock.signalVaultSetTokenConfig(vaultAddress, ...getWagmiConfig(config.wagmi)");
    // await sendTxn(timelock.signalVaultSetTokenConfig(vaultAddress, ...getEthConfig(config.weth)), "timelock.signalVaultSetTokenConfig(vaultAddress, ...getEthConfig(config.weth)");

     // await sendTxn(timelock.vaultSetTokenConfig(vaultAddress,  ...getWagmiConfig(config.wagmi)), "vaultSetTokenConfig wagmi");
    // await sendTxn(timelock.vaultSetTokenConfig(vaultAddress, ...getEthConfig(config.weth)), "vaultSetTokenConfig weth");

    const PRICE_DECIMALS = 8;


    await sendTxn(vaultPriceFeed.setTokenConfig(config.wbtc, btcPriceFeed.address, PRICE_DECIMALS, false), "vaultPriceFeed.setTokenConfig(config.wbtc, btcPythPriceFeedV2Address, PRICE_DECIMALS, false)")
    await sendTxn(vaultPriceFeed.setTokenConfig(config.weth, wethPriceFeed.address, PRICE_DECIMALS, false), "vaultPriceFeed.setTokenConfig(config.weth, ethPythPriceFeedV2Address, PRICE_DECIMALS, false)")
    await sendTxn(vaultPriceFeed.setTokenConfig(config.usdc, usdcPriceFeed.address, PRICE_DECIMALS, false), "vaultPriceFeed.setTokenConfig(config.usdc, usdcPythPriceFeedAddress, PRICE_DECIMALS, false)")
    await sendTxn(vaultPriceFeed.setTokenConfig(config.eth, ethPriceFeed.address, PRICE_DECIMALS, false), "vaultPriceFeed.setTokenConfig(config.eth, ethPythPriceFeedAddress, PRICE_DECIMALS, false)")

    await sendTxn(vault.setTokenConfig(...getBtcConfig(config.wbtc)), "vault.setTokenConfig(...getBtcConfig(wbtc))")
    await sendTxn(vault.setTokenConfig(...getUsdcConfig(config.usdc)), "vault.setTokenConfig(...getUsdcConfig(usdc))")
    await sendTxn(vault.setTokenConfig(...getTlosConfig(config.weth)), "vault.getEthConfig(...getUsdcConfig(weth))")
    await sendTxn(vault.setTokenConfig(...getEthConfig(config.eth)), "vault.getEthConfig(...getUsdcConfig(weth))")

}

main()
    .then(() => process.exit(0))
    .catch(error => {
        console.error(error)
        process.exit(1)
    })
