const { expect } = require("chai");
const { constants, utils } = require("ethers");
const { ethers } = require("hardhat");
const {
  getBlockTime,
  timeShift,
  timeShiftBy,
  tokens,
  createCondition,
  createGame,
  prepareStand,
  prepareAccess,
  makeBetGetTokenIdOdds,
  makeWithdrawPayout,
} = require("../utils/utils");
const { MULTIPLIER } = require("../utils/constants");
const dbg = require("debug")("test:extension");

const OUTCOMEWIN = 1;
const OUTCOMELOSE = 2;
const IPFS = ethers.utils.formatBytes32String("ipfs");
const ONE_HOUR = 3600;
const ONE_MINUTE = 60;
const LIQUIDITY = tokens(2000000);

describe("Extension test", function () {
  let dao, poolOwner, dataProvider, bettor, lpOwner, affiliate, oracle, oracle2, maintainer;
  let access, core, wxDAI, lp, azuroBet;
  let roleIds, now;

  const reinforcement = constants.WeiPerEther.mul(20000); // 10%
  const marginality = MULTIPLIER * 0.05; // 5%

  const minDepo = tokens(10);
  const daoFee = MULTIPLIER * 0.09; // 9%
  const dataProviderFee = MULTIPLIER * 0.01; // 1%
  const affiliateFee = MULTIPLIER * 0.33; // 33%

  let gameId = 0,
    condId = 0;

  const pool1 = 5000000;
  const pool2 = 5000000;

  before(async () => {
    [dao, poolOwner, dataProvider, bettor, lpOwner, affiliate, oracle, oracle2, maintainer] = await ethers.getSigners();

    now = await getBlockTime(ethers);

    ({ access, core, wxDAI, lp, azuroBet, roleIds } = await prepareStand(
      ethers,
      dao,
      poolOwner,
      dataProvider,
      bettor,
      minDepo,
      daoFee,
      dataProviderFee,
      affiliateFee,
      LIQUIDITY
    ));
    await prepareAccess(access, poolOwner, oracle.address, oracle2.address, maintainer.address, roleIds);

    await poolOwner.sendTransaction({ to: wxDAI.address, value: tokens(500_000_000) });
  });

  it("Should go through betting workflow with 2 users with slippage", async function () {
    const betAmount = tokens("6000");
    const betAmount2 = tokens("6000");

    //  EVENT: create condition
    now = await getBlockTime(ethers);
    await createGame(lp, oracle, ++gameId, IPFS, now + ONE_HOUR);
    await createCondition(
      core,
      oracle,
      gameId,
      ++condId,
      [pool2, pool1],
      [OUTCOMEWIN, OUTCOMELOSE],
      reinforcement,
      marginality
    );

    let approveAmount = tokens("9999999");

    now = await getBlockTime(ethers);
    await timeShift(now + 1);

    dbg("Block mined");
    let deadline = now + 10;
    let minrate = MULTIPLIER;

    // first player put the bet
    await wxDAI.approve(lp.address, approveAmount); // approve wxDAI for the contract LP
    dbg("LP approved");

    let res = await makeBetGetTokenIdOdds(
      lp,
      core,
      poolOwner,
      affiliate.address,
      condId,
      betAmount,
      OUTCOMEWIN,
      deadline,
      minrate
    );
    dbg("tx bet1 sent");

    let tokenWin = res.tokenId;
    let rate1 = res.odds;
    let payout1 = rate1.mul(betAmount).div(MULTIPLIER);

    await azuroBet
      .connect(poolOwner)
      ["safeTransferFrom(address,address,uint256)"](poolOwner.address, bettor.address, tokenWin);

    //  EVENT: second player put the bet
    await wxDAI.connect(bettor).approve(lp.address, approveAmount);
    let res2 = await makeBetGetTokenIdOdds(
      lp,
      core,
      bettor,
      affiliate.address,
      condId,
      betAmount2,
      OUTCOMELOSE,
      deadline,
      minrate
    );
    let tokenLose = res2.tokenId;

    now += 36001;
    await timeShiftBy(ethers, ONE_HOUR + ONE_MINUTE);
    // resolve condition by oracle
    await core.connect(oracle).resolveCondition(condId, OUTCOMEWIN);

    //  EVENT: first player get his payout
    const bettor1OldBalance = await wxDAI.balanceOf(poolOwner.address);
    await azuroBet.setApprovalForAll(lp.address, true);

    // transfer back to poolOwner
    await azuroBet
      .connect(bettor)
      ["safeTransferFrom(address,address,uint256)"](bettor.address, poolOwner.address, tokenWin);

    // try to withdraw stake #1 from poolOwner - must be ok
    await makeWithdrawPayout(lp, core, bettor, tokenWin);
    const bettor1NewBalance = await wxDAI.balanceOf(poolOwner.address);

    expect(bettor1NewBalance).to.equal(bettor1OldBalance.add(payout1));

    // if second player go for payout he does not get anything because he loses the bet
    let token2Payout = await lp.connect(bettor).viewPayout(core.address, tokenLose);
    dbg("Payout value", token2Payout.toString());

    const bettor2OldBalance = await wxDAI.balanceOf(bettor.address);
    await lp.connect(bettor).withdrawPayout(core.address, tokenLose, false);
    const bettor2NewBalance = await wxDAI.balanceOf(bettor.address);

    expect(bettor2NewBalance).to.be.equal(bettor2OldBalance);
  });

  it("Should go through betting workflow with 2 users with bid more than pool", async function () {
    const betAmount = constants.WeiPerEther.mul(60000);
    const betAmount2 = constants.WeiPerEther.mul(6000);
    now += 4000;

    //  EVENT: create condition
    await createGame(lp, oracle, ++gameId, IPFS, now + ONE_HOUR);
    await createCondition(
      core,
      oracle,
      gameId,
      ++condId,
      [pool2, pool1],
      [OUTCOMEWIN, OUTCOMELOSE],
      reinforcement,
      marginality
    );

    let approveAmount = tokens("9999999");

    await timeShiftBy(ethers, ONE_HOUR + ONE_MINUTE);

    let deadline = now + 10;
    let minrate = MULTIPLIER;

    // first player put the bet
    await wxDAI.approve(lp.address, approveAmount); // approve wxDAI for the contract LP

    let res = await makeBetGetTokenIdOdds(
      lp,
      core,
      poolOwner,
      affiliate.address,
      condId,
      betAmount,
      OUTCOMEWIN,
      deadline,
      minrate
    );

    let tokenWin = res.tokenId;
    let payout1 = betAmount.mul(res.odds).div(MULTIPLIER);

    //  EVENT: second player put the bet
    await wxDAI.connect(bettor).approve(lp.address, approveAmount);
    let res2 = await makeBetGetTokenIdOdds(
      lp,
      core,
      bettor,
      affiliate.address,
      condId,
      betAmount2,
      OUTCOMELOSE,
      deadline,
      minrate
    );
    let tokenLose = res2.tokenId;

    now += 3601;
    await timeShift(now + ONE_MINUTE);
    // resolve condition by oracle
    await core.connect(oracle).resolveCondition(condId, OUTCOMEWIN);

    //  EVENT: first player get his payout
    const bettor1OldBalance = await wxDAI.balanceOf(poolOwner.address);
    await azuroBet.setApprovalForAll(lp.address, true);

    // try to withdraw stake #1 from poolOwner - must be ok
    await makeWithdrawPayout(lp, core, poolOwner, tokenWin);
    const bettor1NewBalance = await wxDAI.balanceOf(poolOwner.address);

    expect(bettor1NewBalance).to.equal(bettor1OldBalance.add(payout1));

    // if second player go for payout he does not get anything because he loses the bet
    let token2Payout = await lp.connect(bettor).viewPayout(core.address, tokenLose);
    dbg("Payout value", token2Payout.toString());

    const bettor2OldBalance = await wxDAI.balanceOf(bettor.address);
    await lp.connect(bettor).withdrawPayout(core.address, tokenLose, false);
    const bettor2NewBalance = await wxDAI.balanceOf(bettor.address);
    expect(bettor2NewBalance).to.equal(bettor2OldBalance);

    const balance = await wxDAI.balanceOf(bettor.address);
    await expect(lp.connect(bettor).withdrawPayout(core.address, tokenLose, false)).to.be.revertedWithCustomError(
      core,
      "AlreadyPaid"
    );
    expect(await wxDAI.balanceOf(bettor.address)).to.be.equal(balance);
  });

  describe("Detailed tests", function () {
    let conditionA, conditionB, conditionC;
    conditionA = 100000323;
    conditionB = 200000323;
    conditionC = 300000323;
    let approveAmount = tokens("4000000000");
    let minrate = MULTIPLIER;
    let deadline = now + 999999999;

    beforeEach(async () => {
      now = now + ONE_HOUR;
      deadline = now + 999999999;
      await createGame(lp, oracle, ++gameId, IPFS, now);

      await createCondition(
        core,
        oracle,
        gameId,
        ++conditionA,
        [19800, 200],
        [OUTCOMEWIN, OUTCOMELOSE],
        reinforcement,
        marginality
      );

      await createCondition(
        core,
        oracle,
        gameId,
        ++conditionB,
        [10000, 10000],
        [OUTCOMEWIN, OUTCOMELOSE],
        reinforcement,
        marginality
      );

      await createCondition(
        core,
        oracle,
        gameId,
        ++conditionC,
        [200, 19800],
        [OUTCOMEWIN, OUTCOMELOSE],
        reinforcement,
        marginality
      );
    });
    it("Should register bet with no slippage with bet 1/100", async function () {
      let betAmount = tokens("1");
      let betAmount2 = tokens("99");

      // first player put the bet
      await wxDAI.approve(lp.address, approveAmount); // approve wxDAI for the contract LP

      let res = await makeBetGetTokenIdOdds(
        lp,
        core,
        poolOwner,
        affiliate.address,
        conditionA,
        betAmount,
        1,
        deadline,
        minrate
      );

      let tokenWin = res.tokenId;
      let rate1 = res.odds;

      dbg("RATE BET = ", utils.formatUnits(rate1, 12));
      expect(utils.formatUnits(rate1, 12)).to.equal("19.275327731138");

      // bet 2
      let res2 = await makeBetGetTokenIdOdds(
        lp,
        core,
        poolOwner,
        affiliate.address,
        conditionA,
        betAmount2,
        2,
        deadline,
        minrate
      );

      let rate2 = res2.odds;

      dbg("RATE BET A = ", utils.formatUnits(rate2, 12));
      expect(utils.formatUnits(rate2, 12)).to.equal("1.001868625416");

      await timeShiftBy(ethers, ONE_HOUR + ONE_MINUTE);
      // resolve condition by oracle
      await core.connect(oracle).resolveCondition(conditionA, 1);

      //  EVENT: first player get his payout
      const bettor1OldBalance = await wxDAI.balanceOf(poolOwner.address);
      await azuroBet.setApprovalForAll(lp.address, true);

      // try to withdraw stake #1 from poolOwner - must be ok
      await makeWithdrawPayout(lp, core, poolOwner, tokenWin);
      const bettor1NewBalance = await wxDAI.balanceOf(poolOwner.address);

      let bettor1OldBalance_plus_calculation = bettor1OldBalance.add(rate1.mul(betAmount.div(MULTIPLIER))).toString();
      expect(bettor1OldBalance_plus_calculation).to.equal(bettor1NewBalance);
    });
    it("Should register bet with no slippage with bet 1/2", async function () {
      let betAmount = tokens("200");
      let betAmount2 = tokens("200");

      // first player put the bet
      await wxDAI.approve(lp.address, approveAmount); // approve wxDAI for the contract LP

      let res = await makeBetGetTokenIdOdds(
        lp,
        core,
        poolOwner,
        affiliate.address,
        conditionB,
        betAmount,
        1,
        deadline,
        minrate
      );

      let tokenWin = res.tokenId;
      let rate1 = res.odds;

      dbg("BET ID A = ", tokenWin);
      dbg("RATE BET A = ", utils.formatUnits(rate1, 12)); // todo hardcode check
      expect(rate1).to.be.closeTo(1887012779013, 10);

      // bet 2
      let res2 = await makeBetGetTokenIdOdds(
        lp,
        core,
        poolOwner,
        affiliate.address,
        conditionB,
        betAmount2,
        2,
        deadline,
        minrate
      );

      let rate2 = res2.odds;

      dbg("RATE BET  = ", utils.formatUnits(rate2, 12));
      expect(utils.formatUnits(rate2, 12)).to.equal("1.920769336974");

      await timeShiftBy(ethers, ONE_HOUR + ONE_MINUTE);
      // resolve condition by oracle
      await core.connect(oracle).resolveCondition(conditionB, 1);

      //  EVENT: first player get his payout
      const bettor1OldBalance = await wxDAI.balanceOf(poolOwner.address);
      await azuroBet.setApprovalForAll(lp.address, true);

      // try to withdraw stake #1 from poolOwner - must be ok
      await makeWithdrawPayout(lp, core, poolOwner, tokenWin);
      const bettor1NewBalance = await wxDAI.balanceOf(poolOwner.address);

      let bettor1OldBalance_plus_calculation = bettor1OldBalance.add(rate1.mul(betAmount.div(MULTIPLIER))).toString();
      expect(bettor1OldBalance_plus_calculation).to.equal(bettor1NewBalance);
    });
    it("Should register bet with no slippage with bet 99/100", async function () {
      let betAmount = tokens("99");
      let betAmount2 = tokens("4");

      // first player put the bet
      await wxDAI.approve(lp.address, approveAmount); // approve wxDAI for the contract LP

      let res = await makeBetGetTokenIdOdds(
        lp,
        core,
        poolOwner,
        affiliate.address,
        conditionC,
        betAmount,
        1,
        deadline,
        minrate
      );

      let tokenWin = res.tokenId;
      let rate1 = res.odds;

      dbg("RATE BET = ", utils.formatUnits(rate1, 12)); // todo hardcode check
      expect(utils.formatUnits(rate1, 12)).to.equal("1.001847473404");

      // bet 2
      let res2 = await makeBetGetTokenIdOdds(
        lp,
        core,
        poolOwner,
        affiliate.address,
        conditionC,
        betAmount2,
        2,
        deadline,
        minrate
      );

      let rate2 = res2.odds;

      dbg("RATE BET A = ", utils.formatUnits(rate2, 12));
      expect(utils.formatUnits(rate2, 12)).to.equal("19.263242169502");

      await timeShiftBy(ethers, ONE_HOUR + ONE_MINUTE);
      // resolve condition by oracle
      await core.connect(oracle).resolveCondition(conditionC, 1);

      //  EVENT: first player get his payout
      const bettor1OldBalance = await wxDAI.balanceOf(poolOwner.address);
      await azuroBet.setApprovalForAll(lp.address, true);

      // try to withdraw stake #1 from poolOwner - must be ok
      await makeWithdrawPayout(lp, core, poolOwner, tokenWin);
      const bettor1NewBalance = await wxDAI.balanceOf(poolOwner.address);

      let bettor1OldBalance_plus_calculation = bettor1OldBalance.add(rate1.mul(betAmount.div(MULTIPLIER))).toString();
      expect(bettor1OldBalance_plus_calculation).to.equal(bettor1NewBalance);
    });

    it("Should register bet with slippage with bet 1/100", async function () {
      let betAmount = tokens("10");
      let betAmount2 = tokens("990");

      // first player put the bet
      await wxDAI.approve(lp.address, approveAmount); // approve wxDAI for the contract LP

      let res = await makeBetGetTokenIdOdds(
        lp,
        core,
        poolOwner,
        affiliate.address,
        conditionA,
        betAmount,
        1,
        deadline,
        minrate
      );

      let tokenWin = res.tokenId;
      let rate1 = res.odds;

      dbg("RATE BET = ", utils.formatUnits(rate1, 12));
      expect(utils.formatUnits(rate1, 12)).to.equal("19.214250504646");

      // bet 2
      let res2 = await makeBetGetTokenIdOdds(
        lp,
        core,
        poolOwner,
        affiliate.address,
        conditionA,
        betAmount2,
        2,
        deadline,
        minrate
      );

      let rate2 = res2.odds;

      dbg("RATE BET = ", utils.formatUnits(rate2, 12));
      expect(utils.formatUnits(rate2, 12)).to.equal("1.001897212624");

      await timeShiftBy(ethers, ONE_HOUR + ONE_MINUTE);
      // resolve condition by oracle
      await core.connect(oracle).resolveCondition(conditionA, 1);

      //  EVENT: first player get his payout
      const bettor1OldBalance = await wxDAI.balanceOf(poolOwner.address);
      await azuroBet.setApprovalForAll(lp.address, true);

      // try to withdraw stake #1 from poolOwner - must be ok
      await makeWithdrawPayout(lp, core, poolOwner, tokenWin);
      const bettor1NewBalance = await wxDAI.balanceOf(poolOwner.address);

      let bettor1OldBalance_plus_calculation = bettor1OldBalance.add(rate1.mul(betAmount.div(MULTIPLIER))).toString();
      expect(bettor1OldBalance_plus_calculation).to.equal(bettor1NewBalance);
    });
    it("Should register bet with slippage with bet 1/2", async function () {
      let betAmount = tokens("500");
      let betAmount2 = tokens("500");

      // first player put the bet
      await wxDAI.approve(lp.address, approveAmount); // approve wxDAI for the contract LP

      let res = await makeBetGetTokenIdOdds(
        lp,
        core,
        poolOwner,
        affiliate.address,
        conditionB,
        betAmount,
        1,
        deadline,
        minrate
      );

      let tokenWin = res.tokenId;
      let rate1 = res.odds;

      dbg("RATE BET = ", utils.formatUnits(rate1, 12)); // todo hardcode check
      expect(utils.formatUnits(rate1, 12)).to.equal("1.86162671578");

      // bet 2
      let res2 = await makeBetGetTokenIdOdds(
        lp,
        core,
        poolOwner,
        affiliate.address,
        conditionB,
        betAmount2,
        2,
        deadline,
        minrate
      );
      let rate2 = res2.odds;

      dbg("RATE BET  = ", utils.formatUnits(rate2, 12));
      expect(rate2).to.be.closeTo(1943431025957, 10);

      await timeShiftBy(ethers, ONE_HOUR + ONE_MINUTE);
      // resolve condition by oracle
      await core.connect(oracle).resolveCondition(conditionB, 1);

      //  EVENT: first player get his payout
      const bettor1OldBalance = await wxDAI.balanceOf(poolOwner.address);
      await azuroBet.setApprovalForAll(lp.address, true);

      // try to withdraw stake #1 from poolOwner - must be ok
      await makeWithdrawPayout(lp, core, poolOwner, tokenWin);
      const bettor1NewBalance = await wxDAI.balanceOf(poolOwner.address);

      let bettor1OldBalance_plus_calculation = bettor1OldBalance.add(rate1.mul(betAmount.div(MULTIPLIER))).toString();
      expect(bettor1OldBalance_plus_calculation).to.equal(bettor1NewBalance);
    });
    it("Should register bet with slippage with bet 99/100", async function () {
      let betAmount = tokens("1000");
      let betAmount2 = tokens("10");

      // first player put the bet
      await wxDAI.approve(lp.address, approveAmount); // approve wxDAI for the contract LP

      let res = await makeBetGetTokenIdOdds(
        lp,
        core,
        poolOwner,
        affiliate.address,
        conditionC,
        betAmount,
        1,
        deadline,
        minrate
      );
      let tokenWin = res.tokenId;
      let rate1 = res.odds;

      dbg("RATE BET = ", utils.formatUnits(rate1, 12)); // todo hardcode check
      expect(utils.formatUnits(rate1, 12)).to.equal("1.001696088921");

      // bet 2
      let res2 = await makeBetGetTokenIdOdds(
        lp,
        core,
        poolOwner,
        affiliate.address,
        conditionC,
        betAmount2,
        2,
        deadline,
        minrate
      );
      let rate2 = res2.odds;

      dbg("RATE BET = ", utils.formatUnits(rate2, 12));
      expect(utils.formatUnits(rate2, 12)).to.equal("19.293352030529");

      await timeShiftBy(ethers, ONE_HOUR + ONE_MINUTE);
      // resolve condition by oracle
      await core.connect(oracle).resolveCondition(conditionC, 1);

      //  EVENT: first player get his payout
      const bettor1OldBalance = await wxDAI.balanceOf(poolOwner.address);
      await azuroBet.setApprovalForAll(lp.address, true);

      // try to withdraw stake #1 from poolOwner - must be ok
      await makeWithdrawPayout(lp, core, poolOwner, tokenWin);
      const bettor1NewBalance = await wxDAI.balanceOf(poolOwner.address);

      let bettor1OldBalance_plus_calculation = bettor1OldBalance.add(rate1.mul(betAmount.div(MULTIPLIER))).toString();
      expect(bettor1OldBalance_plus_calculation).to.equal(bettor1NewBalance);
    });

    it("Should register bet with huge slippage with bet 1/100", async function () {
      let betAmount = tokens("200");
      let betAmount2 = tokens("19800");

      // first player put the bet
      await wxDAI.approve(lp.address, approveAmount); // approve wxDAI for the contract LP

      let res = await makeBetGetTokenIdOdds(
        lp,
        core,
        poolOwner,
        affiliate.address,
        conditionA,
        betAmount,
        1,
        deadline,
        minrate
      );
      let tokenWin = res.tokenId;
      let rate1 = res.odds;

      dbg("RATE BET = ", utils.formatUnits(rate1, 12));
      expect(utils.formatUnits(rate1, 12)).to.equal("17.624528654449");

      // bet 2
      let res2 = await makeBetGetTokenIdOdds(
        lp,
        core,
        poolOwner,
        affiliate.address,
        conditionA,
        betAmount2,
        2,
        deadline,
        minrate
      );
      let rate2 = res2.odds;

      dbg("RATE BET = ", utils.formatUnits(rate2, 12));
      expect(utils.formatUnits(rate2, 12)).to.equal("1.002207622739");

      await timeShiftBy(ethers, ONE_HOUR + ONE_MINUTE);
      // resolve condition by oracle
      await core.connect(oracle).resolveCondition(conditionA, 1);

      //  EVENT: first player get his payout
      const bettor1OldBalance = await wxDAI.balanceOf(poolOwner.address);
      await azuroBet.setApprovalForAll(lp.address, true);

      // try to withdraw stake #1 from poolOwner - must be ok
      await makeWithdrawPayout(lp, core, poolOwner, tokenWin);
      const bettor1NewBalance = await wxDAI.balanceOf(poolOwner.address);

      let bettor1OldBalance_plus_calculation = bettor1OldBalance.add(rate1.mul(betAmount.div(MULTIPLIER))).toString();
      expect(bettor1OldBalance_plus_calculation).to.equal(bettor1NewBalance);
    });
    it("Should register bet with huge slippage with bet 1/2", async function () {
      let betAmount = tokens("10000");
      let betAmount2 = tokens("10000");

      // first player put the bet
      await wxDAI.approve(lp.address, approveAmount); // approve wxDAI for the contract LP

      let res = await makeBetGetTokenIdOdds(
        lp,
        core,
        poolOwner,
        affiliate.address,
        conditionB,
        betAmount,
        1,
        deadline,
        minrate
      );
      let tokenWin = res.tokenId;
      let rate1 = res.odds;

      dbg("RATE BET = ", utils.formatUnits(rate1, 12)); // todo hardcode check
      expect(utils.formatUnits(rate1, 12)).to.equal("1.446763275229");

      // bet 2
      let res2 = await makeBetGetTokenIdOdds(
        lp,
        core,
        poolOwner,
        affiliate.address,
        conditionB,
        betAmount2,
        2,
        deadline,
        minrate
      );
      let rate2 = res2.odds;

      dbg("RATE BET  = ", utils.formatUnits(rate2, 12));
      expect(utils.formatUnits(rate2, 12)).to.equal("2.163132180282");

      await timeShiftBy(ethers, ONE_HOUR + ONE_MINUTE);
      // resolve condition by oracle
      await core.connect(oracle).resolveCondition(conditionB, 1);

      //  EVENT: first player get his payout
      const bettor1OldBalance = await wxDAI.balanceOf(poolOwner.address);
      await azuroBet.setApprovalForAll(lp.address, true);

      // try to withdraw stake #1 from poolOwner - must be ok
      await makeWithdrawPayout(lp, core, poolOwner, tokenWin);
      const bettor1NewBalance = await wxDAI.balanceOf(poolOwner.address);

      let bettor1OldBalance_plus_calculation = bettor1OldBalance.add(rate1.mul(betAmount.div(MULTIPLIER))).toString();
      expect(bettor1OldBalance_plus_calculation).to.equal(bettor1NewBalance);
    });
    it("Should register bet with huge slippage with bet 99/100", async function () {
      let betAmount = tokens("19800");
      let betAmount2 = tokens("200");

      // first player put the bet
      await wxDAI.approve(lp.address, approveAmount); // approve wxDAI for the contract LP

      let res = await makeBetGetTokenIdOdds(
        lp,
        core,
        poolOwner,
        affiliate.address,
        conditionC,
        betAmount,
        1,
        deadline,
        minrate
      );
      let tokenWin = res.tokenId;
      let rate1 = res.odds;

      dbg("RATE BET = ", utils.formatUnits(rate1, 12));
      expect(utils.formatUnits(rate1, 12)).to.equal("1.000479797859");

      // bet 2
      let res2 = await makeBetGetTokenIdOdds(
        lp,
        core,
        poolOwner,
        affiliate.address,
        conditionC,
        betAmount2,
        2,
        deadline,
        minrate
      );
      let rate2 = res2.odds;

      dbg("RATE BET = ", utils.formatUnits(rate2, 12));
      expect(utils.formatUnits(rate2, 12)).to.equal("19.31335139943");

      await timeShiftBy(ethers, ONE_HOUR + ONE_MINUTE);
      // resolve condition by oracle
      await core.connect(oracle).resolveCondition(conditionC, 1);

      //  EVENT: first player get his payout
      const bettor1OldBalance = await wxDAI.balanceOf(poolOwner.address);
      await azuroBet.setApprovalForAll(lp.address, true);

      // try to withdraw stake #1 from poolOwner - must be ok
      await makeWithdrawPayout(lp, core, poolOwner, tokenWin);
      const bettor1NewBalance = await wxDAI.balanceOf(poolOwner.address);

      let bettor1OldBalance_plus_calculation = bettor1OldBalance.add(rate1.mul(betAmount.div(MULTIPLIER))).toString();
      expect(bettor1OldBalance_plus_calculation).to.equal(bettor1NewBalance);
    });

    it("attack on pool with bet 1/100", async function () {
      let betAmount = tokens("1000");
      let betAmount2 = tokens("100000");

      // first player put the bet
      await wxDAI.approve(lp.address, approveAmount); // approve wxDAI for the contract LP

      let res = await makeBetGetTokenIdOdds(
        lp,
        core,
        poolOwner,
        affiliate.address,
        conditionA,
        betAmount,
        1,
        deadline,
        minrate
      );
      let tokenWin = res.tokenId;
      let rate1 = res.odds;

      dbg("RATE BET = ", utils.formatUnits(rate1, 12));
      expect(utils.formatUnits(rate1, 12)).to.equal("11.483716389001");

      // bet 2
      let res2 = await makeBetGetTokenIdOdds(
        lp,
        core,
        poolOwner,
        affiliate.address,
        conditionA,
        betAmount2,
        2,
        deadline,
        minrate
      );
      let rate2 = res2.odds;

      dbg("RATE BET = ", utils.formatUnits(rate2, 12));
      expect(utils.formatUnits(rate2, 12)).to.equal("1.002188670598");
      await timeShiftBy(ethers, ONE_HOUR + ONE_MINUTE);
      // resolve condition by oracle
      await core.connect(oracle).resolveCondition(conditionA, 1);

      //  EVENT: first player get his payout
      const bettor1OldBalance = await wxDAI.balanceOf(poolOwner.address);
      await azuroBet.setApprovalForAll(lp.address, true);

      // try to withdraw stake #1 from poolOwner - must be ok
      await makeWithdrawPayout(lp, core, poolOwner, tokenWin);
      const bettor1NewBalance = await wxDAI.balanceOf(poolOwner.address);

      let bettor1OldBalance_plus_calculation = bettor1OldBalance.add(rate1.mul(betAmount.div(MULTIPLIER))).toString();
      expect(bettor1OldBalance_plus_calculation).to.equal(bettor1NewBalance);
    });
    it("attack on pool with huge slippage with bet 1/2", async function () {
      let betAmount = tokens("50000");
      let betAmount2 = tokens("50000");

      // first player put the bet
      await wxDAI.approve(lp.address, approveAmount); // approve wxDAI for the contract LP

      let res = await makeBetGetTokenIdOdds(
        lp,
        core,
        poolOwner,
        affiliate.address,
        conditionB,
        betAmount,
        1,
        deadline,
        minrate
      );
      let tokenWin = res.tokenId;
      let rate1 = res.odds;

      dbg("RATE BET = ", utils.formatUnits(rate1, 12)); // todo hardcode check
      expect(utils.formatUnits(rate1, 12)).to.equal("1.135938265021");

      // bet 2
      let res2 = await makeBetGetTokenIdOdds(
        lp,
        core,
        poolOwner,
        affiliate.address,
        conditionB,
        betAmount2,
        2,
        deadline,
        minrate
      );
      let rate2 = res2.odds;

      dbg("RATE BET  = ", utils.formatUnits(rate2, 12));
      expect(utils.formatUnits(rate2, 12)).to.equal("2.01997986306");

      await timeShiftBy(ethers, ONE_HOUR + ONE_MINUTE);
      // resolve condition by oracle
      await core.connect(oracle).resolveCondition(conditionB, 1);

      //  EVENT: first player get his payout
      const bettor1OldBalance = await wxDAI.balanceOf(poolOwner.address);
      await azuroBet.setApprovalForAll(lp.address, true);

      // try to withdraw stake #1 from poolOwner - must be ok
      await makeWithdrawPayout(lp, core, poolOwner, tokenWin);
      const bettor1NewBalance = await wxDAI.balanceOf(poolOwner.address);

      let bettor1OldBalance_plus_calculation = bettor1OldBalance.add(rate1.mul(betAmount.div(MULTIPLIER))).toString();
      expect(bettor1OldBalance_plus_calculation).to.equal(bettor1NewBalance);
    });
    it("attack on pool with huge slippage with bet 99/100", async function () {
      let betAmount = tokens("100000");
      let betAmount2 = tokens("1000");

      // first player put the bet
      await wxDAI.approve(lp.address, approveAmount); // approve wxDAI for the contract LP

      let res = await makeBetGetTokenIdOdds(
        lp,
        core,
        poolOwner,
        affiliate.address,
        conditionC,
        betAmount,
        1,
        deadline,
        minrate
      );
      let tokenWin = res.tokenId;
      let rate1 = res.odds;

      dbg("RATE BET = ", utils.formatUnits(rate1, 12));
      expect(utils.formatUnits(rate1, 12)).to.equal("1.00005289524");

      // bet 2
      let res2 = await makeBetGetTokenIdOdds(
        lp,
        core,
        poolOwner,
        affiliate.address,
        conditionC,
        betAmount2,
        2,
        deadline,
        minrate
      );
      let rate2 = res2.odds;

      dbg("RATE BET = ", utils.formatUnits(rate2, 12));
      expect(utils.formatUnits(rate2, 12)).to.equal("19.298855294631");

      await timeShiftBy(ethers, ONE_HOUR + ONE_MINUTE);
      // resolve condition by oracle
      await core.connect(oracle).resolveCondition(conditionC, 1);

      //  EVENT: first player get his payout
      const bettor1OldBalance = await wxDAI.balanceOf(poolOwner.address);
      await azuroBet.setApprovalForAll(lp.address, true);

      // try to withdraw stake #1 from poolOwner - must be ok
      await makeWithdrawPayout(lp, core, poolOwner, tokenWin);
      const bettor1NewBalance = await wxDAI.balanceOf(poolOwner.address);

      let bettor1OldBalance_plus_calculation = bettor1OldBalance.add(rate1.mul(betAmount.div(MULTIPLIER))).toString();
      expect(bettor1OldBalance_plus_calculation).to.equal(bettor1NewBalance);
    });

    it("should check with super small bet", async function () {
      let betAmount = tokens("50");

      // first player put the bet
      now = (await getBlockTime(ethers)) + ONE_HOUR;
      await createGame(lp, oracle, ++gameId, IPFS, now);

      await createCondition(
        core,
        oracle,
        gameId,
        ++condId,
        [150, 260],
        [OUTCOMEWIN, OUTCOMELOSE],
        reinforcement,
        marginality
      );

      await wxDAI.approve(lp.address, approveAmount); // approve wxDAI for the contract LP

      let res = await makeBetGetTokenIdOdds(
        lp,
        core,
        poolOwner,
        affiliate.address,
        condId,
        betAmount,
        1,
        deadline,
        minrate
      );
      let tokenWin = res.tokenId;
      let rate1 = res.odds;

      dbg("RATE BET = ", utils.formatUnits(rate1, 12));
      expect(utils.formatUnits(rate1, 12)).to.equal("1.515853055581");

      // bet 2
      let res2 = await makeBetGetTokenIdOdds(
        lp,
        core,
        poolOwner,
        affiliate.address,
        condId,
        betAmount,
        2,
        deadline,
        minrate
      );
      let rate2 = res2.odds;

      dbg("RATE BET = ", utils.formatUnits(rate2, 12));
      expect(utils.formatUnits(rate2, 12)).to.equal("2.557094311467");

      await timeShiftBy(ethers, ONE_HOUR + ONE_MINUTE);
      // resolve condition by oracle
      await core.connect(oracle).resolveCondition(condId, 1);

      //  EVENT: first player get his payout
      const bettor1OldBalance = await wxDAI.balanceOf(poolOwner.address);
      await azuroBet.setApprovalForAll(lp.address, true);

      // try to withdraw stake #1 from poolOwner - must be ok
      await makeWithdrawPayout(lp, core, poolOwner, tokenWin);
      const bettor1NewBalance = await wxDAI.balanceOf(poolOwner.address);

      let bettor1OldBalance_plus_calculation = bettor1OldBalance.add(rate1.mul(betAmount.div(MULTIPLIER))).toString();
      expect(bettor1OldBalance_plus_calculation).to.equal(bettor1NewBalance);
    });

    it("Should check user slippage limit", async function () {
      let betAmount = tokens("10");
      let currentOdds = await core.calcOdds(conditionA, betAmount, OUTCOMEWIN);

      // first player put the bet
      await wxDAI.approve(lp.address, approveAmount); // approve wxDAI for the contract LP

      await expect(
        makeBetGetTokenIdOdds(
          lp,
          core,
          poolOwner,
          affiliate.address,
          conditionA,
          betAmount,
          1,
          deadline,
          currentOdds.add(1)
        )
      ).to.be.revertedWithCustomError(core, "SmallOdds");
    });
    it("Should revert on odds = 1.0", async function () {
      let betAmount = tokens(100);

      now = (await getBlockTime(ethers)) + ONE_HOUR;
      await createGame(lp, oracle, ++gameId, IPFS, now);

      await createCondition(
        core,
        oracle,
        gameId,
        ++condId,
        [50000, 50000],
        [OUTCOMEWIN, OUTCOMELOSE],
        betAmount.div(MULTIPLIER),
        marginality
      );

      minrate = 0;

      // first player put the bet
      await wxDAI.approve(lp.address, approveAmount); // approve wxDAI for the contract LP

      await expect(
        makeBetGetTokenIdOdds(lp, core, poolOwner, affiliate.address, condId, betAmount, OUTCOMEWIN, deadline, minrate)
      ).to.be.revertedWithCustomError(core, "LargeFundsRatio");
    });
  });
});
