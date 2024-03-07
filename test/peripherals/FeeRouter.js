const { expect, use } = require("chai")
const { solidity } = require("ethereum-waffle")
const { deployContract, deployTimeDistributor, deployVault, deployProxyBlockInfo, deployVaultPriceFeed, deployZlpManager, deployTimelock } = require("../shared/fixtures")
const { expandDecimals, getBlockTime, increaseTime, mineBlock, reportGasUsed, newWallet } = require("../shared/utilities")
const { toChainlinkPrice } = require("../shared/chainlink")
const { toUsd } = require("../shared/units")
const { initVault, getBnbConfig, getBtcConfig, getDaiConfig, getEthConfig } = require("../core/Vault/helpers")
const { priceFeedIds, priceUpdateData } = require("../shared/pyth")

use(solidity)

describe("FeeRouter", function () {
    const { AddressZero, HashZero } = ethers.constants
    const provider = waffle.provider
    const [wallet, positionKeeper, minter, user0, user1, user2, user3, user4, tokenManager, mintReceiver, signer0, signer1, updater0, updater1] = provider.getWallets()
    const depositFee = 50
    const minExecutionFee = 4000
    let vault
    let timelock
    let usdg
    let router
    let PositionUtils_0_8_18
    let positionRouter
    let referralStorage
    let bnb
    let bnbPriceFeed
    let btc
    let btcPriceFeed
    let eth
    let ethPriceFeed
    let dai
    let daiPriceFeed
    let distributor0
    let yieldTracker0
    let distributor1
    let yieldTracker1
    let shortsTracker
    let FeeRouter;
    let pyth

    beforeEach(async () => {
        pyth = await deployContract("Pyth", [])
        bnb = await deployContract("Token", [])
        bnbPriceFeed = await deployContract("PythPriceFeedV2", [pyth.address,priceFeedIds.bnb,10000])
        await bnb.connect(minter).deposit({ value: expandDecimals(100, 18) })

        btc = await deployContract("Token", [])
        btcPriceFeed = await deployContract("PythPriceFeedV2", [pyth.address,priceFeedIds.btc,10000])

        eth = await deployContract("Token", [])
        ethPriceFeed = await deployContract("PythPriceFeedV2", [pyth.address,priceFeedIds.eth,10000])
        await eth.connect(minter).deposit({ value: expandDecimals(30, 18) })

        dai = await deployContract("Token", [])
        daiPriceFeed = await deployContract("PythPriceFeedV2", [pyth.address,priceFeedIds.dai,10000])

        vault = await deployVault()
        timelock = await deployTimelock([
            wallet.address, // _admin
            5 * 24 * 60 * 60, // _buffer
            wallet.address, // _tokenManager
            ethers.constants.AddressZero, // _mintReceiver
            ethers.constants.AddressZero, // _zlpManager
            ethers.constants.AddressZero, // _rewardRouter
            expandDecimals(1000, 18), // _maxTokenSupply
            10, // marginFeeBasisPoints 0.1%
            500, // maxMarginFeeBasisPoints 5%
        ])

        usdg = await deployContract("USDG", [vault.address])
        router = await deployContract("Router", [vault.address, usdg.address, bnb.address, pyth.address])

        shortsTracker = await deployContract("ShortsTracker", [vault.address])
        await shortsTracker.setIsGlobalShortDataReady(true)

        PositionUtils_0_8_18 = await deployContract("PositionUtils_0_8_18", [])

        const proxyBlockInfo = await deployProxyBlockInfo()
        positionRouter = await deployContract("PositionRouterV2", [vault.address, router.address, bnb.address, shortsTracker.address, depositFee, minExecutionFee, proxyBlockInfo.address,pyth.address], {
            libraries: {
                PositionUtils_0_8_18: PositionUtils_0_8_18.address
            }
        })
        await shortsTracker.setHandler(positionRouter.address, true)

        referralStorage = await deployContract("ReferralStorage", [])
        const vaultPriceFeed = await deployVaultPriceFeed()
        await positionRouter.setReferralStorage(referralStorage.address)
        await referralStorage.setHandler(positionRouter.address, true)

        await initVault(vault, router, usdg, vaultPriceFeed)

        distributor0 = await deployTimeDistributor([])
        yieldTracker0 = await deployContract("YieldTracker", [usdg.address])

        await yieldTracker0.setDistributor(distributor0.address)
        await distributor0.setDistribution([yieldTracker0.address], [1000], [bnb.address])

        await bnb.mint(distributor0.address, 5000)


        distributor1 = await deployTimeDistributor([])
        yieldTracker1 = await deployContract("YieldTracker", [usdg.address])

        await yieldTracker1.setDistributor(distributor1.address)
        await distributor1.setDistribution([yieldTracker1.address], [1000], [eth.address])

        await eth.mint(distributor1.address, 3000)

        await usdg.setYieldTrackers([yieldTracker0.address, yieldTracker1.address])

        reader = await deployContract("Reader", [])

        await vaultPriceFeed.setTokenConfig(bnb.address, bnbPriceFeed.address, 8, false)
        await vaultPriceFeed.setTokenConfig(btc.address, btcPriceFeed.address, 8, false)
        await vaultPriceFeed.setTokenConfig(eth.address, ethPriceFeed.address, 8, false)
        await vaultPriceFeed.setTokenConfig(dai.address, daiPriceFeed.address, 8, false)

        await pyth.updatePrice(priceFeedIds.dai, toChainlinkPrice(1))
        await vault.setTokenConfig(...getDaiConfig(dai, daiPriceFeed))

        await pyth.updatePrice(priceFeedIds.btc, toChainlinkPrice(60000))
        await vault.setTokenConfig(...getBtcConfig(btc, btcPriceFeed))

        await pyth.updatePrice(priceFeedIds.bnb, toChainlinkPrice(300))
        await vault.setTokenConfig(...getBnbConfig(bnb, bnbPriceFeed))

        await pyth.updatePrice(priceFeedIds.eth, toChainlinkPrice(1000))
        await vault.setTokenConfig(...getEthConfig(eth, ethPriceFeed))

        await vault.setIsLeverageEnabled(false)
        await vault.setGov(timelock.address)

        FeeRouter = await deployContract("FeeRouter", [timelock.address, vault.address, [positionRouter.address]]);


    })

    it("inits", async () => {
        expect(await positionRouter.vault()).eq(vault.address)
        expect(await positionRouter.router()).eq(router.address)
        expect(await positionRouter.weth()).eq(bnb.address)
        expect(await positionRouter.depositFee()).eq(depositFee)
        expect(await positionRouter.minExecutionFee()).eq(minExecutionFee)
        expect(await positionRouter.admin()).eq(wallet.address)
        expect(await positionRouter.gov()).eq(wallet.address)


        expect(await FeeRouter.timelock()).eq(timelock.address)
        expect(await FeeRouter.vault()).eq(vault.address)
        expect(await FeeRouter.routers(0)).eq(positionRouter.address)
    })


    const testWithdrawFees = async (_receiver) => {
        await positionRouter.setDelayValues(0, 300, 500)
        await bnb.mint(vault.address, expandDecimals(30, 18))
        await vault.buyUSDG(bnb.address, user1.address)
        await eth.mint(vault.address, expandDecimals(10, 18))
        await vault.buyUSDG(eth.address, user3.address)
        await timelock.setContractHandler(positionRouter.address, true)
        await timelock.setShouldToggleIsLeverageEnabled(true)

        const referralCode = "0x0000000000000000000000000000000000000000000000000000000000000123"

        let params = [
            [dai.address, bnb.address], // _path
            bnb.address, // _indexToken
            expandDecimals(600, 18), // _amountIn
            expandDecimals(1, 18), // _minOut
            toUsd(6000), // _sizeDelta
            true, // _isLong
            toUsd(300), // _acceptablePrice
        ]

        await router.addPlugin(positionRouter.address)
        await router.connect(user0).approvePlugin(positionRouter.address)

        await dai.mint(user0.address, expandDecimals(600, 18))
        await dai.connect(user0).approve(router.address, expandDecimals(600, 18))

        let key = await positionRouter.getRequestKey(user0.address, 1)

        const executionFeeReceiver = newWallet()
        await positionRouter.setPositionKeeper(positionKeeper.address, true)

        await positionRouter.connect(user0).createIncreasePosition(...params.concat([4000, referralCode, AddressZero]), { value: 4000 })
        await positionRouter.connect(positionKeeper)["executeIncreasePosition(bytes32,address,bytes[])"](key, executionFeeReceiver.address, priceUpdateData)
        expect(await provider.getBalance(executionFeeReceiver.address)).eq(4000)

        params = [
            [dai.address, bnb.address], // _path
            bnb.address, // _indexToken
            expandDecimals(600, 18), // _amountIn
            expandDecimals(1, 18), // _minOut
            toUsd(0), // _sizeDelta
            true, // _isLong
            toUsd(300), // _acceptablePrice
        ]

        await dai.mint(user0.address, expandDecimals(600, 18))
        await dai.connect(user0).approve(router.address, expandDecimals(600, 18))

        await positionRouter.connect(user0).createIncreasePosition(...params.concat([4000, referralCode, AddressZero]), { value: 4000 })
        key = await positionRouter.getRequestKey(user0.address, 2)

        expect(await positionRouter.feeReserves(bnb.address)).eq(0)
        await positionRouter.connect(positionKeeper)["executeIncreasePosition(bytes32,address,bytes[])"](key, executionFeeReceiver.address, priceUpdateData)
        expect(await provider.getBalance(executionFeeReceiver.address)).eq(8000)
        expect(await positionRouter.feeReserves(dai.address)).eq(0)
        expect(await positionRouter.feeReserves(bnb.address)).eq("9970000000000000") // 0.00997

        const feeReservesBnb = await positionRouter.feeReserves(bnb.address)
        const feeReservesVBnb = await vault.feeReserves(bnb.address)



        let params2 = [
            [dai.address, eth.address], // _path
            eth.address, // _indexToken
            expandDecimals(1200, 18), // _amountIn
            expandDecimals(1, 18), // _minOut
            toUsd(6000), // _sizeDelta
            true, // _isLong
            toUsd(1000), // _acceptablePrice
        ]

        await router.connect(user2).approvePlugin(positionRouter.address)

        await dai.mint(user2.address, expandDecimals(1200, 18))
        await dai.connect(user2).approve(router.address, expandDecimals(1200, 18))

        let key2 = await positionRouter.getRequestKey(user2.address, 1)

        await positionRouter.connect(user2).createIncreasePosition(...params2.concat([4000, referralCode, AddressZero]), { value: 4000 })
        await positionRouter.connect(positionKeeper)["executeIncreasePosition(bytes32,address,bytes[])"](key2, executionFeeReceiver.address, priceUpdateData)

        params2 = [
            [dai.address, eth.address], // _path
            eth.address, // _indexToken
            expandDecimals(1200, 18), // _amountIn
            expandDecimals(1, 18), // _minOut
            toUsd(0), // _sizeDelta
            true, // _isLong
            toUsd(1000), // _acceptablePrice
        ]

        await dai.mint(user2.address, expandDecimals(1200, 18))
        await dai.connect(user2).approve(router.address, expandDecimals(1200, 18))

        await positionRouter.connect(user2).createIncreasePosition(...params2.concat([4000, referralCode, AddressZero]), { value: 4000 })
        key = await positionRouter.getRequestKey(user2.address, 2)

        await positionRouter.connect(positionKeeper)["executeIncreasePosition(bytes32,address,bytes[])"](key2, executionFeeReceiver.address, priceUpdateData)

        const feeReservesEth = await positionRouter.feeReserves(eth.address)
        const feeReservesVEth = await vault.feeReserves(eth.address)


        await positionRouter.setAdmin(FeeRouter.address);
        await timelock.setAdmin(FeeRouter.address);

        await expect(FeeRouter.connect(user1).withdrawFees([bnb.address, eth.address], _receiver)).to.be.revertedWith("Governable: forbidden");
        await expect(FeeRouter.withdrawFees([], _receiver)).to.be.revertedWith("FeeRouter: invalid _tokens");
        await expect(FeeRouter.withdrawFees([bnb.address, eth.address], AddressZero)).to.be.revertedWith("ERC20: transfer to the zero address");
        const tx = await FeeRouter.withdrawFees([bnb.address, eth.address], _receiver);

        await expect(tx)
            .to.emit(FeeRouter, "WithdrawFees")
            .withArgs([bnb.address, eth.address], _receiver);



        const feeReservesBnb2 = await positionRouter.feeReserves(bnb.address)
        const feeReservesVBnb2 = await vault.feeReserves(bnb.address)

        expect(feeReservesBnb2).to.eq(0);
        expect(feeReservesVBnb2).to.eq(0);

        const balanceBnb = await bnb.balanceOf(_receiver);

        expect(balanceBnb).to.eq(feeReservesBnb.add(feeReservesVBnb));


        const feeReservesEth2 = await positionRouter.feeReserves(eth.address)
        const feeReservesVEth2 = await vault.feeReserves(eth.address)

        expect(feeReservesEth2).to.eq(0);
        expect(feeReservesVEth2).to.eq(0);

        const balanceEth = await eth.balanceOf(_receiver);

        expect(balanceEth).to.eq(feeReservesEth.add(feeReservesVEth));


        return [balanceBnb, balanceEth]
    }
    it("withdrawFees", async () => {
        await testWithdrawFees(user4.address);
    })

    it("withdrawTokens", async () => {
        const balances = await testWithdrawFees(FeeRouter.address);
        console.log(balances[0].toString(), balances[1].toString());
        const receiver = newWallet()

        await expect(FeeRouter.connect(user1).withdrawTokens([bnb.address, eth.address], receiver.address)).to.be.revertedWith("Governable: forbidden");
        await expect(FeeRouter.withdrawTokens([], receiver.address)).to.be.revertedWith("FeeRouter: invalid _tokens");
        await expect(FeeRouter.withdrawTokens([bnb.address, eth.address], AddressZero)).to.be.revertedWith("ERC20: transfer to the zero address");
        const tx = await FeeRouter.withdrawTokens([bnb.address, eth.address], receiver.address)

        await expect(tx)
            .to.emit(FeeRouter, "WithdrawTokens")
            .withArgs([bnb.address, eth.address], receiver.address);

        const balanceBnb = await bnb.balanceOf(receiver.address);
        const balanceEth = await eth.balanceOf(receiver.address);

        expect(balanceBnb).to.eq(balances[0]);
        expect(balanceEth).to.eq(balances[1]);
    })

    it("withdrawEth", async () => {

        await wallet.sendTransaction({
            to: FeeRouter.address,
            value: expandDecimals(5, 18)
        });
        const balanceContract = await provider.getBalance(FeeRouter.address);
        expect(balanceContract).to.eq(expandDecimals(5, 18));

        const receiver = newWallet()

        await expect(FeeRouter.connect(user1).withdrawEth(AddressZero)).to.be.revertedWith("Governable: forbidden");
        await expect(FeeRouter.withdrawEth(AddressZero)).to.be.revertedWith("FeeRouter: invalid _receiver");
        const tx = await FeeRouter.withdrawEth(receiver.address)

        await expect(tx)
            .to.emit(FeeRouter, "WithdrawEth")
            .withArgs(receiver.address);

        const balance = await provider.getBalance(receiver.address);
        const balanceContract2 = await provider.getBalance(FeeRouter.address);

        expect(balance).to.eq(expandDecimals(5, 18));
        expect(balanceContract2).to.eq(0);
    })

    it("updateState", async () => {
        const newTimelock = newWallet()
        const newVault = newWallet()
        const newRouter = newWallet()
        const newRouter2 = newWallet()

        await expect(FeeRouter.connect(user1).updateState(newTimelock.address, newVault.address, [newRouter.address, newRouter2.address])).to.be.revertedWith("Governable: forbidden");
        await expect(FeeRouter.updateState(AddressZero, newVault.address, [newRouter.address, newRouter2.address])).to.be.revertedWith("FeeRouter: invalid _timelock");
        await expect(FeeRouter.updateState(newTimelock.address, AddressZero, [newRouter.address, newRouter2.address])).to.be.revertedWith("FeeRouter: invalid _vault");
        await expect(FeeRouter.updateState(newTimelock.address, newVault.address, [])).to.be.revertedWith("FeeRouter: invalid _routers");
        const tx = await FeeRouter.updateState(newTimelock.address, newVault.address, [newRouter.address, newRouter2.address]);

        await expect(tx)
            .to.emit(FeeRouter, "UpdateState")
            .withArgs(newTimelock.address, newVault.address, [newRouter.address, newRouter2.address]);

        expect(await FeeRouter.timelock()).eq(newTimelock.address)
        expect(await FeeRouter.vault()).eq(newVault.address)
        expect(await FeeRouter.routers(0)).eq(newRouter.address)
        expect(await FeeRouter.routers(1)).eq(newRouter2.address)
    })

});