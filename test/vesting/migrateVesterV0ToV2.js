const { expect } = require("chai");
const { BigNumber } = require("ethers");
const { ethers } = require("hardhat");
const helpers = require("@nomicfoundation/hardhat-network-helpers");
const { parseEther } = ethers.utils;

function expectPartisipantEqual(res, zkePurchased, zkeClaimed, lastClaimed){
    expect(BigNumber.from(res[0]).eq(zkePurchased), `zkePurchased ${res[0].toString()} not equal to expected${zkePurchased.toString()}`).to.be.true
    expect(BigNumber.from(res[1]).eq(zkeClaimed), `zkeClaimed ${res[1].toString()} not equal to expected${zkeClaimed.toString()}`).to.be.true
    expect(BigNumber.from(res[2]).eq(lastClaimed), `lastClaimed ${res[2].toString()} not equal to expected${lastClaimed.toString()}`).to.be.true
}

function showPartisipantInfo(res){
    console.log("zkePurchased ", BigNumber.from(res[0]).toString()); 
    console.log("zkeClaimed ", BigNumber.from(res[1]).toString()); 
    console.log("lastClaimed ", BigNumber.from(res[2]).toString()); 
}

describe("migrateVesterV0ToV2", () => {
    let vesterV0, vesterV2, zke, usdc, owner, user1, user2;
    const TOKEN_PRICE = 1000000; //$1
    const MAX_ZKE_VESTING = parseEther("1500000"); //1.5m
    const DEFAULT_USDC_BALANCE = 100000 * 1000000; //10000 usdc
    const VESTING_WEEKS = 78;

    beforeEach(async () => {
        // Deploying ZKE and USDC tokens (mock)
        const ERC20 = await ethers.getContractFactory("UsdcMock");
        const ZKE = await ethers.getContractFactory("ZKE");
        zke = await ZKE.deploy();
        usdc = await ERC20.deploy();
      
        // Deploying WeeklyVesting
        const latestTimeStamp = (await helpers.time.latest());
        const WeeklyVesting = await ethers.getContractFactory("WeeklyVesting");
        vesterV0 = await WeeklyVesting.deploy(
            zke.address,
            usdc.address,
            VESTING_WEEKS, // vestingWeeks
            TOKEN_PRICE,
            MAX_ZKE_VESTING, // maxZkeVesting
            latestTimeStamp + 60 * 60 * 24 // vestingStart (1 day from now)
        );
        
        const WeeklyVestingV2 = await ethers.getContractFactory("WeeklyVestingV2");
        vesterV2 = await WeeklyVestingV2.deploy(
            vesterV0.address
        );

        [owner, user1, user2] = await ethers.getSigners();

        // Transfer initial ZKE and USDC to users
        // await zke.transfer(user1.address, parseEther("1000"));
        // await zke.transfer(user2.address, parseEther("1000"));
        await zke.transfer(vesterV0.address, MAX_ZKE_VESTING);
        await zke.transfer(vesterV2.address, MAX_ZKE_VESTING);
        
        await usdc.transfer(user1.address, DEFAULT_USDC_BALANCE);
        await usdc.transfer(user2.address, DEFAULT_USDC_BALANCE);
    });

    it("should set initial contract variables correctly", async () => {
        expect(await vesterV2.zke()).to.equal(zke.address);
        expect(await vesterV2.usdc()).to.equal(usdc.address);
        expect(await vesterV2.vestingWeeks()).to.equal(78);
        expect(await vesterV2.tokenPrice()).to.equal(TOKEN_PRICE);
        expect(await vesterV2.maxZkeVesting()).to.equal(MAX_ZKE_VESTING);
    });

    it("should allow user to buy tokens", async () => {
        const user1Usdc = usdc.connect(user1);
        await user1Usdc.approve(vesterV0.address, DEFAULT_USDC_BALANCE);

        const balanceBefore = await user1Usdc.balanceOf(user1.address);
        const user1WeeklyVesting = vesterV0.connect(user1);
        await expect(user1WeeklyVesting.buyTokens(parseEther("10")))
        .to.emit(vesterV0, "ZkePurchased")
        .withArgs(user1.address, parseEther("10"));
        
        const balanceAfter = await user1Usdc.balanceOf(user1.address);
        const expectedDiff = TOKEN_PRICE * 10;
        expect(balanceBefore.sub(balanceAfter).eq(expectedDiff), "usdc balance hasn`t been changed correctly").to.be.true;
        
        const res = await vesterV2.participants(user1.address);
        expectPartisipantEqual(res, parseEther("10"),parseEther("0"), parseEther("0") );
    });

    it("should not allow user to claim tokens before vesting starts", async () => {
        const user1WeeklyVesting = vesterV2.connect(user1);
        await expect(user1WeeklyVesting.claimTokens()).to.be.revertedWith(
            "Vesting has not started yet"
        );
    });

    it("owner should be able to withdraw usdc", async () => {
        await vesterV2.withdrawTokens(zke.address, parseEther("100"))
        await usdc.approve(vesterV2.address, DEFAULT_USDC_BALANCE);
        await vesterV2.buyTokens(parseEther("10"))
        await vesterV2.withdrawTokens(usdc.address, 1000000)
    });

    it("not owner shouldn`t be able to withdraw usdc", async () => {
        await expect(vesterV2.connect(user1).withdrawTokens(zke.address, parseEther("100"))).to.be.revertedWith("Ownable: caller is not the owner")
    });

    it("bug reproduce on weeklyVesting V1", async () => {
        // User1 buys tokens
        const user1Usdc = usdc.connect(user1);
        await user1Usdc.approve(vesterV0.address, DEFAULT_USDC_BALANCE);

        const user1VesterV0 = vesterV0.connect(user1);
        const buyAmount = parseEther("40000");
        await user1VesterV0.buyTokens(parseEther("40000")); // User1 buys 40000 ZKE tokens
        // Fast forward to vesting start
        const vestingStarts = await user1VesterV0.vestingStart();
        console.log("vestingStarts ", vestingStarts.toString());
        let latestTimeStamp = (await helpers.time.latest());
        console.log("latestTimeStamp ", latestTimeStamp);
        //1 day to reach vestingStart and 7 days to reach weeklyClaimTick
        const reachVestingStart = 60 * 60 * 24;
        const reachWeeklyClaimTick = reachVestingStart + 60 * 60 * 24 * 10; //+ 10 days
        await helpers.time.increase(reachWeeklyClaimTick); 
        
        const user1Zke = zke.connect(user1);
        const claimPerWeek = buyAmount.div(VESTING_WEEKS);  // = 512 820512820512820512
        const balanceBefore = await user1Zke.balanceOf(user1.address);
        await expect(user1VesterV0.claimTokens())
        .to.emit(vesterV0, "ZkeClaimed")
        .withArgs(user1.address, claimPerWeek); // User1 claims 512 ZKE tokens (1/78 of the purchased amount)
        const balanceAfter = await user1Zke.balanceOf(user1.address);
        expect(balanceAfter.sub(balanceBefore).eq(claimPerWeek), "zke balance hasn`t been changed correctly").to.be.true;

        const res = await vesterV0.participants(user1.address);
        latestTimeStamp = await helpers.time.latest();
        showPartisipantInfo(res);
        expectPartisipantEqual(res, buyAmount, claimPerWeek, latestTimeStamp);
        
        //reproduce bug
        const fiveDays = 60 * 60 * 24 * 5
        await helpers.time.increase(fiveDays); //second vesting week has been reached, so it should be available tokens to claim
        const availableTokens = await vesterV0.getAvailableTokens(user1.address)
        console.log("availableTokens", availableTokens.toString())
        expect(availableTokens, "tokens are not available after second vesting week passed").to.not.equal(claimPerWeek) //false positive condition
    });

    it("repair bug by weeklyVesting V2", async () => {
        // User1 buys tokens
        const user1Usdc = usdc.connect(user1);
        await user1Usdc.approve(vesterV0.address, DEFAULT_USDC_BALANCE);

        const user1VesterV0 = vesterV0.connect(user1);
        const user1VesterV2 = vesterV2.connect(user1);
        const buyAmount = parseEther("40000");
        await user1VesterV0.buyTokens(parseEther("40000")); // User1 buys 40000 ZKE tokens
        // Fast forward to vesting start
        const vestingStarts = await user1VesterV0.vestingStart();
        console.log("vestingStarts ", vestingStarts.toString());
        let latestTimeStamp = (await helpers.time.latest());
        console.log("latestTimeStamp ", latestTimeStamp);
        //1 day to reach vestingStart and 7 days to reach weeklyClaimTick
        const reachVestingStart = 60 * 60 * 24;
        const reachWeeklyClaimTick = reachVestingStart + 60 * 60 * 24 * 10; //+ 10 days
        await helpers.time.increase(reachWeeklyClaimTick); 
        
        const user1Zke = zke.connect(user1);
        const claimPerWeek = buyAmount.div(VESTING_WEEKS);  // = 512 820512820512820512
        const balanceBefore = await user1Zke.balanceOf(user1.address);
        await expect(user1VesterV0.claimTokens())
        .to.emit(vesterV0, "ZkeClaimed")
        .withArgs(user1.address, claimPerWeek); // User1 claims 512 ZKE tokens (1/78 of the purchased amount)
        const balanceAfter = await user1Zke.balanceOf(user1.address);
        expect(balanceAfter.sub(balanceBefore).eq(claimPerWeek), "zke balance hasn`t been changed correctly").to.be.true;

        let res = await vesterV0.participants(user1.address);
        latestTimeStamp = await helpers.time.latest();
        expectPartisipantEqual(res, buyAmount, claimPerWeek, latestTimeStamp);
        
        // reproduce bug
        const fiveDays = 60 * 60 * 24 * 5
        await helpers.time.increase(fiveDays); // 15 passed. second vesting week has been reached, so it should be available tokens to claim
        const oldVesterAvailableTokens = await vesterV0.getAvailableTokens(user1.address)
        console.log("oldVesterAvailableTokens", oldVesterAvailableTokens.toString())
        expect(oldVesterAvailableTokens, "tokens are not available after second vesting week passed").to.not.equal(claimPerWeek) // false positive
        
        // repaired
        let vesterV2AvailableTokens = await vesterV2.getAvailableTokens(user1.address)
        expect(vesterV2AvailableTokens, "tokens are not available after second vesting week passed").to.equal(claimPerWeek) 
        await user1VesterV2.claimTokens();
        latestTimeStamp = await helpers.time.latest();
        let vestedWeeks = BigNumber.from(latestTimeStamp).sub(vestingStarts).div(60 * 60 * 24 * 7);
        expect(vestedWeeks, "2 weeks passed").to.equal(BigNumber.from(2));
        res = await vesterV2.participants(user1.address);
        expectPartisipantEqual(res, buyAmount, claimPerWeek.mul(vestedWeeks), latestTimeStamp);
        await expect(user1VesterV2.claimTokens()).to.be.revertedWith("No tokens available to claim");

        const sevenDays = 60 * 60 * 24 * 7;
        await helpers.time.increase(sevenDays); //22 days - third week passed

        await user1VesterV2.claimTokens()
        latestTimeStamp = await helpers.time.latest();
        vestedWeeks = BigNumber.from(latestTimeStamp).sub(vestingStarts).div(60 * 60 * 24 * 7);
        expect(vestedWeeks, "3 weeks passed").to.equal(BigNumber.from(3));
        res = await vesterV2.participants(user1.address);
        expectPartisipantEqual(res, buyAmount, claimPerWeek.mul(vestedWeeks), latestTimeStamp);

        const fourDays = 60 * 60 * 24 * 4;
        await helpers.time.increase(fourDays); //25 days - 3 weeks passed
        await expect(user1VesterV2.claimTokens()).to.be.revertedWith("No tokens available to claim");
        const prevTimestamp = latestTimeStamp;
        latestTimeStamp = await helpers.time.latest();
        vestedWeeks = BigNumber.from(latestTimeStamp).sub(vestingStarts).div(60 * 60 * 24 * 7);
        expect(vestedWeeks, "3 weeks passed").to.equal(BigNumber.from(3));
        res = await vesterV2.participants(user1.address);
        expectPartisipantEqual(res, buyAmount, claimPerWeek.mul(vestedWeeks), prevTimestamp);

        
        await helpers.time.increase(fourDays); //29 days - 4 weeks passed
        await user1VesterV2.claimTokens();
        latestTimeStamp = await helpers.time.latest();
        vestedWeeks = BigNumber.from(latestTimeStamp).sub(vestingStarts).div(60 * 60 * 24 * 7);
        expect(vestedWeeks, "4 weeks passed").to.equal(BigNumber.from(4));
        res = await vesterV2.participants(user1.address);
        expectPartisipantEqual(res, buyAmount, claimPerWeek.mul(vestedWeeks), latestTimeStamp);

        const reach77Week = BigNumber.from(vestingStarts).add(60 * 60 * 24 * 539 + 1); //539 days + 1 second
        await helpers.time.increaseTo(reach77Week); //77 weeks passed
        vesterV2AvailableTokens = await vesterV2.getAvailableTokens(user1.address)
        expect(vesterV2AvailableTokens, "tokens are not available after second vesting week passed").to.equal(claimPerWeek.mul(73)) 
        await user1VesterV2.claimTokens(); //73 * claimPerWeek claim
        latestTimeStamp = await helpers.time.latest();
        vestedWeeks = BigNumber.from(latestTimeStamp).sub(vestingStarts).div(60 * 60 * 24 * 7);
        expect(vestedWeeks, "77 weeks passed").to.equal(BigNumber.from(77));
        res = await vesterV2.participants(user1.address);
        expectPartisipantEqual(res, buyAmount, claimPerWeek.mul(vestedWeeks), latestTimeStamp);

        //check claim after long delay
        const reach100Week = BigNumber.from(vestingStarts).add(60 * 60 * 24 * 7 * 100 + 1); //700 days + 1 second
        await helpers.time.increaseTo(reach100Week); //77 weeks passed
        vesterV2AvailableTokens = await vesterV2.getAvailableTokens(user1.address)
        console.log("vesterV2AvailableTokens", vesterV2AvailableTokens.toString())
        const remainingZke = BigNumber.from("512820512820512820576");
        expect(vesterV2AvailableTokens, "tokens are not available after second vesting week passed").to.equal(remainingZke) 
        await user1VesterV2.claimTokens(); //1 * claimPerWeek claim
        latestTimeStamp = await helpers.time.latest();
        vestedWeeks = BigNumber.from(latestTimeStamp).sub(vestingStarts).div(60 * 60 * 24 * 7);
        expect(vestedWeeks, "100 weeks passed").to.equal(BigNumber.from(100));
        res = await vesterV2.participants(user1.address);
        expectPartisipantEqual(res, buyAmount, buyAmount, latestTimeStamp);
    });

    it("should claim tokens referencing to the state of migrated contract", async () => {
        // User1 buys tokens
        const user1Usdc = usdc.connect(user1);
        await user1Usdc.approve(vesterV0.address, DEFAULT_USDC_BALANCE);
        await user1Usdc.approve(vesterV2.address, DEFAULT_USDC_BALANCE);

        const user1WeeklyVesting = vesterV0.connect(user1);
        const user1MigrateVesting = vesterV2.connect(user1);
        await user1WeeklyVesting.buyTokens(parseEther("30")); // User1 buys 40 ZKE tokens
        let res = await vesterV2.participants(user1.address);
        console.log(`res 1: ${res[0]} ${res[1]} ${res[2]}`)
        expectPartisipantEqual(res, parseEther("30"), 0, 0);

        await user1MigrateVesting.buyTokens(parseEther("780")); // User1 buys 40 ZKE tokens
        res = await vesterV2.participants(user1.address);
        console.log(`res 1: ${res[0]} ${res[1]} ${res[2]}`)
        expectPartisipantEqual(res, parseEther("810"), 0, 0);
        // Fast forward to vesting start
        const vestingStarts = await user1WeeklyVesting.vestingStart();
        let latestTimeStamp = (await helpers.time.latest());
        //1 day to reach vestingStart and 7 days to reach weeklyClaimTick
        await helpers.time.increaseTo(latestTimeStamp + 60 * 60 * 24 * 7  + 60 * 60 * 24); 
        
        const user1Zke = zke.connect(user1);
        const expectedDiff = parseEther("810").div(78);
        const balanceBefore = await user1Zke.balanceOf(user1.address);
        await expect(user1MigrateVesting.claimTokens())
        .to.emit(vesterV2, "ZkeClaimed")
        .withArgs(user1.address, expectedDiff); // User1 claims 10 ZKE tokens (1/4 of the purchased amount)
        const balanceAfter = await user1Zke.balanceOf(user1.address);
        expect(balanceAfter.sub(balanceBefore).eq(expectedDiff), "zke balance hasn`t been changed correctly").to.be.true;

        res = await vesterV2.participants(user1.address);
        latestTimeStamp = await helpers.time.latest();
        console.log(`res 2: ${res[0]} ${res[1]} ${res[2]}`)
        expectPartisipantEqual(res, parseEther("810"), expectedDiff, latestTimeStamp);
    });

    it("should allow user to claim tokens after vesting starts", async () => {
        // User1 buys tokens
        const user1Usdc = usdc.connect(user1);
        await user1Usdc.approve(vesterV2.address, DEFAULT_USDC_BALANCE);

        const user1WeeklyVesting = vesterV2.connect(user1);
        await user1WeeklyVesting.buyTokens(parseEther("780")); // User1 buys 40 ZKE tokens
        let res = await vesterV2.participants(user1.address);
        console.log(`res 1: ${res[0]} ${res[1]} ${res[2]}`)
        expectPartisipantEqual(res, parseEther("780"), 0, 0);
        // Fast forward to vesting start
        const vestingStarts = await user1WeeklyVesting.vestingStart();
        let latestTimeStamp = (await helpers.time.latest());
        //1 day to reach vestingStart and 7 days to reach weeklyClaimTick
        await helpers.time.increaseTo(latestTimeStamp + 60 * 60 * 24 * 7  + 60 * 60 * 24); 
        
        const user1Zke = zke.connect(user1);
        const expectedDiff = parseEther("10");
        const balanceBefore = await user1Zke.balanceOf(user1.address);
        // await user1WeeklyVesting.claimTokens()
        await expect(user1WeeklyVesting.claimTokens())
        .to.emit(vesterV2, "ZkeClaimed")
        .withArgs(user1.address, expectedDiff); // User1 claims 10 ZKE tokens (1/4 of the purchased amount)
        const balanceAfter = await user1Zke.balanceOf(user1.address);
        expect(balanceAfter.sub(balanceBefore).eq(expectedDiff), "zke balance hasn`t been changed correctly").to.be.true;

        res = await vesterV2.participants(user1.address);
        latestTimeStamp = await helpers.time.latest();
        console.log(`res 2: ${res[0]} ${res[1]} ${res[2]}`)
        expectPartisipantEqual(res, parseEther("780"), parseEther("10"), latestTimeStamp);
    });

    it("should allow owner to pause and unpause claiming for a user", async () => {
        await vesterV2.pauseClaiming(user1.address);
        expect(await vesterV2.pausedClaiming(user1.address)).to.be.true;
        await vesterV2.unpauseClaiming(user1.address);
        expect(await vesterV2.pausedClaiming(user1.address)).to.be.false;
    });

    it("should not allow user to claim tokens if claiming is paused", async () => {
        // User1 buys tokens
        const user1Usdc = usdc.connect(user1);
        await user1Usdc.approve(vesterV2.address, parseEther("1000"));
        const user1WeeklyVesting = vesterV2.connect(user1);
        await user1WeeklyVesting.buyTokens(parseEther("40")); // User1 buys 40 ZKE tokens
        await helpers.time.increase(60 * 60 * 24);


        // Pause claiming for user1
        await vesterV2.pauseClaiming(user1.address);

        // Fast forward 1 week
        await helpers.time.increase(60 * 60 * 24 * 7);

        await expect(user1WeeklyVesting.claimTokens()).to.be.revertedWith(
            "Claiming is paused for this user"
        );
    });

    it("should allow owner to set vesting start", async () => {
        const latestTimeStamp = await helpers.time.latest();
        const newVestingStart = latestTimeStamp + 60 * 60 * 24 * 2; // 2 days from now
        await vesterV2.setVestingStart(newVestingStart);
        expect(await vesterV2.vestingStart()).to.equal(newVestingStart);
    });
});


