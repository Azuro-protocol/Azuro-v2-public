const { expect } = require("chai");
const { constants } = require("ethers");
const { ethers } = require("hardhat");
const {
  getBlockTime,
  tokens,
  prepareStand,
  prepareAccess,
  createGame,
  createCondition,
  makeBetGetTokenId,
  makeBetGetTokenIdOdds,
  timeShift,
  changeReinforcementAbility,
} = require("../utils/utils");
const { ITERATIONS, MULTIPLIER } = require("../utils/constants");

const LIQUIDITY = tokens(20000);
const OUTCOMEWIN = 1;
const OUTCOMELOSE = 2;
const IPFS = ethers.utils.formatBytes32String("ipfs");

const ONE_MINUTE = 60;
const ONE_HOUR = 3600;

describe("Reinforcement test", function () {
  const reinforcement = constants.WeiPerEther.mul(2000); // 10%
  const marginality = MULTIPLIER * 0.05; // 5%

  const minDepo = tokens(10);
  const daoFee = MULTIPLIER * 0.09; // 9%
  const dataProviderFee = MULTIPLIER * 0.01; // 1%
  const affiliateFee = MULTIPLIER * 0.33; // 33%

  const pool1 = 5000000;
  const pool2 = 5000000;

  let dao, poolOwner, dataProvider, bettor, affiliate, oracle, oracle2, maintainer;
  let access, core, wxDAI, lp;
  let roleIds, time;

  let gameId = 0;
  let condId = 0;

  before(async () => {
    [dao, poolOwner, dataProvider, bettor, affiliate, oracle, oracle2, maintainer] = await ethers.getSigners();
    ({ access, core, wxDAI, lp, roleIds } = await prepareStand(
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

    const LibraryMock = await ethers.getContractFactory("LibraryMock", {
      signer: await ethers.getSigner(),
    });
    coreTools = await LibraryMock.deploy();
    await coreTools.deployed();

    lockedBefore = await lp.lockedLiquidity();
  });
  beforeEach(async () => {
    time = await getBlockTime(ethers);
    await createGame(lp, oracle, ++gameId, IPFS, time + ONE_HOUR);
  });
  it("Check if odds match allocated reinforcement", async function () {
    const verificationCondId = ++condId;
    await createCondition(
      core,
      oracle,
      gameId,
      verificationCondId,
      [pool2, pool1],
      [OUTCOMEWIN, OUTCOMELOSE],
      reinforcement,
      marginality
    );

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

    const fundShare = reinforcement.div(2);
    let fundBanks = [fundShare, fundShare]; // pools are equal
    let totalNetBets = [constants.Zero, constants.Zero];
    let payouts = [constants.Zero, constants.Zero];

    let outcome, outcomeIndex, amount;
    for (const i of Array(ITERATIONS).keys()) {
      [outcome, outcomeIndex] = Math.random() > 1 / 2 ? [OUTCOMEWIN, 0] : [OUTCOMELOSE, 1];
      amount = tokens(Math.floor(Math.random() * 100) + 1);

      let res = await makeBetGetTokenIdOdds(
        lp,
        core,
        bettor,
        affiliate.address,
        condId,
        amount,
        outcome,
        time + 1000,
        0
      );

      // Calculate target odds in old (before a48c107) fixed-reinforcement manner
      const funds = [
        fundBanks[0].add(totalNetBets[1]).sub(payouts[1]),
        fundBanks[1].add(totalNetBets[0]).sub(payouts[0]),
      ];
      const targetOdds = funds[0].add(funds[1].add(amount)).mul(MULTIPLIER).div(funds[outcomeIndex].add(amount));
      core.connect(oracle).changeOdds(verificationCondId, [targetOdds.sub(MULTIPLIER), MULTIPLIER]);

      expect(res.odds).to.be.equal(await core.calcOdds(verificationCondId, 0, OUTCOMEWIN));

      fundBanks[outcomeIndex] = fundBanks[outcomeIndex].add(amount);
      totalNetBets[outcomeIndex] = totalNetBets[outcomeIndex].add(amount);
      payouts[outcomeIndex] = payouts[outcomeIndex].add(res.odds.mul(amount).div(MULTIPLIER));
    }

    timeShift(time + ONE_HOUR + ONE_MINUTE);
    await core.connect(oracle).resolveCondition(condId, OUTCOMEWIN);
  });
  it("Common betting workflow", async function () {
    // Bets for different outcomes
    const condId1 = ++condId;
    await createCondition(
      core,
      oracle,
      gameId,
      condId1,
      [150000, 300000],
      [OUTCOMEWIN, OUTCOMELOSE],
      reinforcement,
      marginality
    );

    expect(await lp.lockedLiquidity()).to.equal(lockedBefore);

    const betAmount1 = tokens(100);
    const res1 = await makeBetGetTokenIdOdds(
      lp,
      core,
      bettor,
      affiliate.address,
      condId1,
      betAmount1,
      OUTCOMEWIN,
      time + 100,
      0
    );
    const deltaPayout1 = res1.odds.sub(MULTIPLIER).mul(betAmount1).div(MULTIPLIER);
    expect(await lp.lockedLiquidity()).to.equal(lockedBefore.add(deltaPayout1));

    const betAmount2 = tokens(30);
    const res2 = await makeBetGetTokenIdOdds(
      lp,
      core,
      bettor,
      affiliate.address,
      condId1,
      betAmount2,
      OUTCOMELOSE,
      time + 100,
      0
    );
    const deltaPayout2 = res2.odds.sub(MULTIPLIER).mul(betAmount2).div(MULTIPLIER);
    expect(await lp.lockedLiquidity()).to.equal(lockedBefore.add(deltaPayout1.sub(betAmount2)));

    const betAmount3 = tokens(50);
    const res3 = await makeBetGetTokenIdOdds(
      lp,
      core,
      bettor,
      affiliate.address,
      condId1,
      betAmount3,
      OUTCOMELOSE,
      time + 100,
      0
    );
    const deltaPayout3 = res3.odds.sub(MULTIPLIER).mul(betAmount3).div(MULTIPLIER);
    const lockedAmount = await lp.lockedLiquidity();
    expect(lockedAmount).to.equal(deltaPayout2.add(deltaPayout3).sub(betAmount1));

    // Bets for the same outcomes
    const condId2 = ++condId;
    await createCondition(
      core,
      oracle,
      gameId,
      condId2,
      [91000, 909000],
      [OUTCOMEWIN, OUTCOMELOSE],
      reinforcement,
      marginality
    );

    const betAmount4 = tokens(20);
    const res4 = await makeBetGetTokenIdOdds(
      lp,
      core,
      bettor,
      affiliate.address,
      condId2,
      betAmount4,
      OUTCOMEWIN,
      time + 100,
      0
    );
    const deltaPayout4 = res4.odds.sub(MULTIPLIER).mul(betAmount4).div(MULTIPLIER);
    expect((await lp.lockedLiquidity()).sub(lockedAmount)).to.equal(deltaPayout4);

    const betAmount5 = tokens(2);
    const res5 = await makeBetGetTokenIdOdds(
      lp,
      core,
      bettor,
      affiliate.address,
      condId2,
      betAmount5,
      OUTCOMEWIN,
      time + 100,
      0
    );
    const deltaPayout5 = res5.odds.sub(MULTIPLIER).mul(betAmount5).div(MULTIPLIER);
    expect((await lp.lockedLiquidity()).sub(lockedAmount)).to.equal(deltaPayout5.add(deltaPayout4));

    timeShift(time + ONE_HOUR + ONE_MINUTE);
    await core.connect(oracle).resolveCondition(condId1, OUTCOMEWIN);
    await core.connect(oracle).resolveCondition(condId2, OUTCOMEWIN);

    expect(await lp.lockedLiquidity()).to.equal(lockedBefore);
  });
  it("Create conditions whose total max reinforcement exceeds the amount of liquidity", async function () {
    let reinforcement = LIQUIDITY.div(2); // 50%
    // Total maximum reinforcement amount is greater than liquidity pool x 25
    for (const i of Array(50).keys()) {
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
    }

    expect(await lp.lockedLiquidity()).to.equal(lockedBefore);
  });
  it("Make bets whose total bet amount exceeds the amount of liquidity", async function () {
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

    // Total bet amount is greater than liquidity pool x 25
    const lpBefore = await lp.getReserve();
    for (const i of Array(10).keys()) {
      let res = await makeBetGetTokenIdOdds(
        lp,
        core,
        bettor,
        affiliate.address,
        condId,
        tokens(500000),
        OUTCOMEWIN,
        time + 100,
        0
      );
      expect(res.odds).to.be.gt(MULTIPLIER);
    }

    timeShift(time + ONE_HOUR + ONE_MINUTE);
    await core.connect(oracle).resolveCondition(condId, OUTCOMEWIN);

    expect(await lp.getReserve()).to.be.gt(lpBefore.sub(reinforcement.div(2)));
  });
  it("Make bets that breaks liquidity reinforcement limit", async function () {
    await changeReinforcementAbility(lp, core, poolOwner, MULTIPLIER / 2);
    let lpBefore = await lp.getReserve();

    const condId1 = ++condId;
    await createCondition(
      core,
      oracle,
      gameId,
      condId1,
      [pool2, pool1],
      [OUTCOMEWIN, OUTCOMELOSE],
      lpBefore.div(2), // Max outcome reinforcement = available liquidity * 0.25
      marginality
    );

    await makeBetGetTokenId(lp, core, bettor, affiliate.address, condId1, tokens(10000), OUTCOMEWIN, time + 100, 0);
    // Lower reinforcement limit
    await changeReinforcementAbility(lp, core, poolOwner, MULTIPLIER / 10);
    await expect(
      makeBetGetTokenId(lp, core, bettor, affiliate.address, condId1, tokens(10000), OUTCOMEWIN, time + 100, 0)
    ).to.be.revertedWithCustomError(lp, "NotEnoughLiquidity");
    // Still accept bets not increasing locked reserves amount
    await makeBetGetTokenId(lp, core, bettor, affiliate.address, condId1, tokens(100), OUTCOMELOSE, time + 100, 0);

    // Try to make bet for another condition
    const condId2 = ++condId;
    await createCondition(
      core,
      oracle,
      gameId,
      condId2,
      [pool2, pool1],
      [OUTCOMEWIN, OUTCOMELOSE],
      reinforcement,
      marginality
    );

    await expect(
      makeBetGetTokenId(lp, core, bettor, affiliate.address, condId2, tokens(100), OUTCOMEWIN, time + 100, 0)
    ).to.be.revertedWithCustomError(lp, "NotEnoughLiquidity");

    // Increase the limit back
    await changeReinforcementAbility(lp, core, poolOwner, MULTIPLIER / 2);
    await makeBetGetTokenId(lp, core, bettor, affiliate.address, condId1, tokens(100000), OUTCOMEWIN, time + 100, 0);
    await makeBetGetTokenId(lp, core, bettor, affiliate.address, condId2, tokens(100000), OUTCOMEWIN, time + 100, 0);
  });
  it("Cancel condition", async function () {
    const betAmount = tokens(100);
    const lpBefore = await lp.lockedLiquidity();

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
    expect(await lp.lockedLiquidity()).to.be.equal(lpBefore);

    const res = await makeBetGetTokenIdOdds(
      lp,
      core,
      bettor,
      affiliate.address,
      condId,
      betAmount,
      OUTCOMEWIN,
      time + 100,
      0
    );
    expect(await lp.lockedLiquidity()).to.be.equal(
      lpBefore.add(res.odds.mul(betAmount).div(MULTIPLIER).sub(betAmount))
    );

    await core.connect(oracle).cancelCondition(condId);
    expect(await lp.lockedLiquidity()).to.be.equal(lpBefore);
  });
  it("Cancel game", async function () {
    const betAmount = tokens(100);
    const lpBefore = await lp.lockedLiquidity();

    const condId1 = ++condId;
    await createCondition(
      core,
      oracle,
      gameId,
      condId1,
      [pool2, pool1],
      [OUTCOMEWIN, OUTCOMELOSE],
      reinforcement,
      marginality
    );
    const condId2 = ++condId;
    await createCondition(
      core,
      oracle,
      gameId,
      condId2,
      [pool2, pool1],
      [OUTCOMEWIN, OUTCOMELOSE],
      reinforcement,
      marginality
    );
    expect(await lp.lockedLiquidity()).to.be.equal(lpBefore);

    let res = await makeBetGetTokenIdOdds(
      lp,
      core,
      bettor,
      affiliate.address,
      condId1,
      betAmount,
      OUTCOMEWIN,
      time + 100,
      0
    );
    const lpAfter = await lp.lockedLiquidity();
    expect(lpAfter).to.be.equal(lpBefore.add(res.odds.mul(betAmount).div(MULTIPLIER).sub(betAmount)));

    res = await makeBetGetTokenIdOdds(
      lp,
      core,
      bettor,
      affiliate.address,
      condId2,
      betAmount,
      OUTCOMEWIN,
      time + 100,
      0
    );
    expect(await lp.lockedLiquidity()).to.be.equal(lpAfter.add(res.odds.mul(betAmount).div(MULTIPLIER).sub(betAmount)));

    await lp.connect(oracle).cancelGame(gameId);
    expect(await lp.lockedLiquidity()).to.be.equal(lpBefore);
  });
});
