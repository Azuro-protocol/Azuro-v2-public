const { expect } = require("chai");
const { constants } = require("ethers");
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
  const affiliateFee = MULTIPLIER * 0.6; // 60%

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
      affiliate,
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
    await createGame(lp, oracle, ++gameId, now + ONE_HOUR);
    await createCondition(
      core,
      oracle,
      gameId,
      ++condId,
      [pool2, pool1],
      [OUTCOMEWIN, OUTCOMELOSE],
      reinforcement,
      marginality,
      false
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
    await core.connect(oracle).resolveCondition(condId, [OUTCOMEWIN]);

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
    await lp.connect(bettor).withdrawPayout(core.address, tokenLose);
    const bettor2NewBalance = await wxDAI.balanceOf(bettor.address);

    expect(bettor2NewBalance).to.be.equal(bettor2OldBalance);
  });

  it("Should go through betting workflow with 2 users with bid more than pool", async function () {
    const betAmount = constants.WeiPerEther.mul(60000);
    const betAmount2 = constants.WeiPerEther.mul(6000);
    now += 4000;

    //  EVENT: create condition
    await createGame(lp, oracle, ++gameId, now + ONE_HOUR);
    await createCondition(
      core,
      oracle,
      gameId,
      ++condId,
      [pool2, pool1],
      [OUTCOMEWIN, OUTCOMELOSE],
      reinforcement,
      marginality,
      false
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
    await core.connect(oracle).resolveCondition(condId, [OUTCOMEWIN]);

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
    await lp.connect(bettor).withdrawPayout(core.address, tokenLose);
    const bettor2NewBalance = await wxDAI.balanceOf(bettor.address);
    expect(bettor2NewBalance).to.equal(bettor2OldBalance);

    const balance = await wxDAI.balanceOf(bettor.address);
    await expect(lp.connect(bettor).withdrawPayout(core.address, tokenLose)).to.be.revertedWithCustomError(
      core,
      "AlreadyPaid"
    );
    expect(await wxDAI.balanceOf(bettor.address)).to.be.equal(balance);
  });
});
