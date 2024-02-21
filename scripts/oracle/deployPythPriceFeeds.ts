import * as hre from 'hardhat';
import { Deployer } from '@matterlabs/hardhat-zksync-deploy';
import { getDeployerWallet } from '../shared/accounts';
import { getProvider } from '../shared/network';
import { deployContract, getJsonField, sendTxn } from '../shared/deploy';

import { getNetworkConfig } from '../shared/zkEraConfig';
import { IPyth__factory, IPythEventsV2__factory, PythPriceFeedV2__factory, Timelock__factory, Vault__factory, VaultPriceFeed__factory } from '../../typechain';
import { bigNumberify } from '../shared/utilities';
import { EvmPriceServiceConnection } from '@pythnetwork/pyth-evm-js';

function toChainlinkPrice(value: number) {
    const price = bigNumberify(value).pow(Math.pow(10, 8))
    return price
}

type TokenConfig = [string, number, number, number, number, boolean, boolean];

function getEthConfig(weth: string): TokenConfig {
    return [
        weth, // _token
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
        25000, // _tokenWeight
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
    const deployerWallet = getDeployerWallet(provider);
    const deployer = new Deployer(hre, deployerWallet);

    const vaultAddress = await getJsonField("vault") as string
    const vaultPriceFeedAddress = await getJsonField("vaultPriceFeed") as string

    const config = getNetworkConfig();
    const vault = Vault__factory.connect(vaultAddress, deployerWallet);
    const timelockAddress = await getJsonField("timelock") as string
    const timelock = Timelock__factory.connect(timelockAddress, deployerWallet);
    const vaultPriceFeed = VaultPriceFeed__factory.connect(vaultPriceFeedAddress, deployerWallet);

    // const usdc = await deployContract(deployer, "USDC", [], "usdc") //ONLY TESTNET
    // const wbtc = await deployContract(deployer, "WBTC", [], "wbtc") //ONLY TESTNET
    // const wagmi = await deployContract(deployer, "WAGMI", [], "wagmi") //ONLY TESTNET
    // const usdc = USDC__factory.connect(config.usdc, deployerWallet);

    const ethPriceFeedId = config.ethPriceFeedId;
    const usdcPriceFeedId = config.usdcPriceFeedId;
    const btcPriceFeedId = config.btcPriceFeedId;

    const priceIds = [
        ethPriceFeedId,
        usdcPriceFeedId,
        btcPriceFeedId
    ];

    const age = 120
    const connection = new EvmPriceServiceConnection(
        config.connectionEndpoint
    );

    // update priceFeed example
    const pyth = IPyth__factory.connect(config.pyth, deployerWallet);
    const pythEv = IPythEventsV2__factory.createInterface();
    let priceUpdateData = await connection.getPriceFeedsUpdateData(priceIds);
    let updateFee = await pyth.getUpdateFee(priceUpdateData)
    console.log("usdcPriceFeedId:", usdcPriceFeedId);

    // const ethPythPriceFeedV2 = await deployContract(deployer, "PythPriceFeedV2", [config.pyth, ethPriceFeedId, age], "ethPythPriceFeedV2");
    // const btcPythPriceFeedV2 = await deployContract(deployer, "PythPriceFeedV2", [config.pyth, btcPriceFeedId, age], "btcPythPriceFeedV2");
    // const usdcPythPriceFeedV2 = await deployContract(deployer, "PythPriceFeedV2", [config.pyth, usdcPriceFeedId, age], "usdcPythPriceFeedV2");


    const usdcPythPriceFeedAddress = await getJsonField("usdcPythPriceFeedV2") as string;
    const usdcPythPriceFeedV2 = PythPriceFeedV2__factory.connect(usdcPythPriceFeedAddress, deployerWallet);

    const ethPythPriceFeedV2Address = await getJsonField("ethPythPriceFeedV2") as string;
    const ethPythPriceFeedV2 = PythPriceFeedV2__factory.connect(ethPythPriceFeedV2Address, deployerWallet);

    const btcPythPriceFeedV2Address = await getJsonField("btcPythPriceFeedV2") as string;
    const btcPythPriceFeedV2 = PythPriceFeedV2__factory.connect(btcPythPriceFeedV2Address, deployerWallet);

    //console.log(priceUpdateData)

    // validateNewPriceFeed
    await sendTxn(ethPythPriceFeedV2.updateAnswer(priceUpdateData, { value: updateFee }), "ethPythPriceFeedV2.updateAnswer(priceUpdateData, {value: updateFee})");
    const maxPriceEth = await ethPythPriceFeedV2['latestAnswer(bool)'](true);
    const minPriceEth = await ethPythPriceFeedV2['latestAnswer(bool)'](false);

    console.log(`maxPriceEth ${maxPriceEth.toString()}`);
    console.log(`minPriceEth ${minPriceEth.toString()}`);

    await sendTxn(btcPythPriceFeedV2.updateAnswer(priceUpdateData, { value: updateFee }), "btcPythPriceFeedV2.updateAnswer(priceUpdateData, {value: updateFee})");
    const maxPriceBtc = await btcPythPriceFeedV2['latestAnswer(bool)'](true);
    const minPriceBtc = await btcPythPriceFeedV2['latestAnswer(bool)'](false);

    console.log(`maxPriceBtc ${maxPriceBtc.toString()}`);
    console.log(`minPriceBtc ${minPriceBtc.toString()}`);

    await sendTxn(usdcPythPriceFeedV2.updateAnswer(priceUpdateData, { value: updateFee }), "usdcPythPriceFeedV2.updateAnswer(priceUpdateData, {value: updateFee})");
    const maxPriceUsdc = await usdcPythPriceFeedV2['latestAnswer(bool)'](true);
    const minPriceUsdc = await usdcPythPriceFeedV2['latestAnswer(bool)'](false);

    console.log(`maxPriceUsdc ${maxPriceUsdc.toString()}`);
    console.log(`minPriceUsdc ${minPriceUsdc.toString()}`);

    // *****  Validate priceFeed works:     *****

    const validTimePeriod = await pyth.getValidTimePeriod();
    console.log("validTimePeriod ", validTimePeriod.toString());


    const PRICE_DECIMALS = 8;

    await sendTxn(vaultPriceFeed.setTokenConfig(config.wbtc, btcPythPriceFeedV2.address, PRICE_DECIMALS, false), "vaultPriceFeed.setTokenConfig(config.wbtc, btcPythPriceFeedV2Address, PRICE_DECIMALS, false)")
    await sendTxn(vaultPriceFeed.setTokenConfig(config.weth, ethPythPriceFeedV2.address, PRICE_DECIMALS, false), "vaultPriceFeed.setTokenConfig(config.weth, ethPythPriceFeedV2Address, PRICE_DECIMALS, false)")
    await sendTxn(vaultPriceFeed.setTokenConfig(config.usdc, usdcPythPriceFeedV2.address, PRICE_DECIMALS, false), "vaultPriceFeed.setTokenConfig(config.usdc, usdcPythPriceFeedAddress, PRICE_DECIMALS, false)")

    await sendTxn(vault.setTokenConfig(...getBtcConfig(config.wbtc)), "vault.setTokenConfig(...getBtcConfig(wbtc))")
    await sendTxn(vault.setTokenConfig(...getUsdcConfig(config.usdc)), "vault.setTokenConfig(...getUsdcConfig(usdc))")
    await sendTxn(vault.setTokenConfig(...getEthConfig(config.weth)), "vault.getEthConfig(...getUsdcConfig(weth))")
}

main()
    .then(() => process.exit(0))
    .catch(error => {
        console.error(error)
        process.exit(1)
    })
