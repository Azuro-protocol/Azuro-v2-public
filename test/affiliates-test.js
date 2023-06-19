const { expect } = require("chai");
const { ethers } = require("hardhat");
const {
  getBlockTime,
  tokens,
  prepareStand,
  prepareAccess,
  createGame,
  createCondition,
  makeBetGetTokenId,
  timeShift,
  makeBetGetTokenIdOdds,
  getClaimParams,
  getClaimParamsDef,
  switchCore,
} = require("../utils/utils");
const { MULTIPLIER } = require("../utils/constants");

const LIQUIDITY = tokens(2000000);
const OUTCOMEWIN = 1;
const OUTCOMELOSE = 2;
const IPFS = ethers.utils.formatBytes32String("ipfs");

const ONE_HOUR = 3600;
const ONE_MINUTE = 60;

describe("Affiliates test", function () {
  const reinforcement = tokens(20000);
  const marginality = MULTIPLIER * 0.05; // 5%

  const minDepo = tokens(10);
  const daoFee = MULTIPLIER * 0.09; // 9%
  const dataProviderFee = MULTIPLIER * 0.01; // 1%
  const affiliateFee = MULTIPLIER * 0.33; // 33%

  const pool1 = 5000000;
  const pool2 = 5000000;

  let dao, poolOwner, dataProvider, oracle, oracle2, maintainer, affiliate, affiliate2, bettor;
  let access, core, wxDAI, lp;
  let roleIds, time, balance;

  let gameId = 0;
  let condId = 0;

  before(async function () {
    [dao, poolOwner, dataProvider, oracle, oracle2, maintainer, affiliate, affiliate2, affiliate3, bettor] =
      await ethers.getSigners();

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
  });
  beforeEach(async function () {
    time = await getBlockTime(ethers);
    await createGame(lp, oracle, ++gameId, IPFS, time + ONE_HOUR);

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

    try {
      await lp.claimAffiliateRewardFor(core.address, getClaimParamsDef(), affiliate.address);
    } catch {}
    await lp.connect(poolOwner).changeFee(2, affiliateFee);
  });
  it("Betting on opposite condition's outcomes through one affiliate", async function () {
    expect(await core.getContributedConditionsCount(affiliate.address)).to.be.equal(0);

    await makeBetGetTokenId(lp, core, bettor, affiliate.address, condId, tokens(100), OUTCOMELOSE, time + 100, 0);
    let res = await makeBetGetTokenIdOdds(
      lp,
      core,
      bettor,
      affiliate.address,
      condId,
      tokens(100),
      OUTCOMEWIN,
      time + 100,
      0
    );
    timeShift(time + ONE_HOUR + ONE_MINUTE);
    await core.connect(oracle).resolveCondition(condId, OUTCOMEWIN);
    expect(await core.getContributedConditionsCount(affiliate.address)).to.be.equal(1);

    balance = await wxDAI.balanceOf(affiliate.address);
    await lp.claimAffiliateRewardFor(core.address, getClaimParamsDef(), affiliate.address);

    expect(await core.getContributedConditionsCount(affiliate.address)).to.be.equal(0);
    expect(await wxDAI.balanceOf(affiliate.address)).to.be.equal(
      balance.add(
        tokens(200)
          .sub(res.odds.mul(tokens(100)).div(MULTIPLIER))
          .mul(affiliateFee)
          .div(MULTIPLIER)
      )
    );
  });
  it("Betting same amount on opposite condition's outcomes through one affiliate", async function () {
    await makeBetGetTokenId(lp, core, bettor, affiliate.address, condId, tokens(200), OUTCOMELOSE, time + 10, 0);
    let res = await makeBetGetTokenIdOdds(
      lp,
      core,
      bettor,
      affiliate.address,
      condId,
      tokens(200),
      OUTCOMEWIN,
      time + 10,
      0
    );
    timeShift(time + ONE_HOUR + ONE_MINUTE);
    await core.connect(oracle).resolveCondition(condId, OUTCOMEWIN);

    balance = await wxDAI.balanceOf(affiliate.address);
    await lp.claimAffiliateRewardFor(core.address, getClaimParamsDef(), affiliate.address);

    expect(await wxDAI.balanceOf(affiliate.address)).to.be.equal(
      balance.add(
        tokens(400)
          .sub(res.odds.mul(tokens(200)).div(MULTIPLIER))
          .mul(affiliateFee)
          .div(MULTIPLIER)
      )
    );
  });
  it("Betting on several condition's through one affiliate", async function () {
    await makeBetGetTokenId(lp, core, bettor, affiliate.address, condId, tokens(100), OUTCOMELOSE, time + 100, 0);

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
    await makeBetGetTokenId(lp, core, bettor, affiliate.address, condId, tokens(50), OUTCOMELOSE, time + 100, 0);

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
    await makeBetGetTokenId(lp, core, bettor, affiliate.address, condId, tokens(25), OUTCOMEWIN, time + 100, 0);

    timeShift(time + ONE_HOUR + ONE_MINUTE);
    await core.connect(oracle).resolveCondition(condId - 2, OUTCOMEWIN);
    await core.connect(oracle).resolveCondition(condId - 1, OUTCOMEWIN);
    await core.connect(oracle).resolveCondition(condId, OUTCOMEWIN);

    balance = await wxDAI.balanceOf(affiliate.address);
    await lp.claimAffiliateRewardFor(core.address, getClaimParamsDef(), affiliate.address);

    expect(await wxDAI.balanceOf(affiliate.address)).to.be.equal(
      balance.add(tokens(150).mul(affiliateFee).div(MULTIPLIER))
    );
  });
  it("Betting on one condition through several affiliates", async function () {
    await makeBetGetTokenId(lp, core, bettor, affiliate.address, condId, tokens(100), OUTCOMELOSE, time + 100, 0);
    await makeBetGetTokenId(lp, core, bettor, affiliate2.address, condId, tokens(50), OUTCOMELOSE, time + 100, 0);
    let res = await makeBetGetTokenIdOdds(
      lp,
      core,
      bettor,
      affiliate3.address,
      condId,
      tokens(25),
      OUTCOMEWIN,
      time + 100,
      0
    );

    timeShift(time + ONE_HOUR + ONE_MINUTE);
    await core.connect(oracle).resolveCondition(condId, OUTCOMEWIN);
    const profit = tokens(175).sub(res.odds.mul(tokens(25)).div(MULTIPLIER));

    balance = await wxDAI.balanceOf(affiliate.address);
    await lp.claimAffiliateRewardFor(core.address, getClaimParamsDef(), affiliate.address);
    expect(await wxDAI.balanceOf(affiliate.address)).to.be.closeTo(
      balance.add(profit.mul(100).div(150).mul(affiliateFee).div(MULTIPLIER)),
      10
    );

    balance = await wxDAI.balanceOf(affiliate2.address);
    await lp.claimAffiliateRewardFor(core.address, getClaimParamsDef(), affiliate2.address);
    expect(await wxDAI.balanceOf(affiliate2.address)).to.be.closeTo(
      balance.add(profit.mul(50).div(150).mul(affiliateFee).div(MULTIPLIER)),
      10
    );

    balance = await wxDAI.balanceOf(affiliate3.address);
    await lp.claimAffiliateRewardFor(core.address, getClaimParamsDef(), affiliate3.address);

    expect(await wxDAI.balanceOf(affiliate3.address)).to.be.equal(balance);
  });
  it("Some bets have no affiliate", async function () {
    await makeBetGetTokenId(lp, core, bettor, affiliate.address, condId, tokens(100), OUTCOMELOSE, time + 100, 0);
    let res = await makeBetGetTokenIdOdds(
      lp,
      core,
      bettor,
      affiliate.address,
      condId,
      tokens(50),
      OUTCOMEWIN,
      time + 100,
      0
    );
    await makeBetGetTokenId(
      lp,
      core,
      bettor,
      //affiliate.address,
      ethers.constants.AddressZero,
      condId,
      tokens(25),
      OUTCOMELOSE,
      time + 100,
      0
    );

    timeShift(time + ONE_HOUR + ONE_MINUTE);
    await core.connect(oracle).resolveCondition(condId, OUTCOMEWIN);

    balance = await wxDAI.balanceOf(affiliate.address);
    await lp.claimAffiliateRewardFor(core.address, getClaimParamsDef(), affiliate.address);

    // 100 + 50 by affiliate
    expect(await wxDAI.balanceOf(affiliate.address)).to.be.equal(
      balance.add(
        tokens(150)
          .sub(res.odds.mul(tokens(50)).div(MULTIPLIER))
          .mul(affiliateFee)
          .div(MULTIPLIER)
      )
    );

    balance = await wxDAI.balanceOf(poolOwner.address);
    await lp.claimAffiliateRewardFor(core.address, getClaimParamsDef(), poolOwner.address);

    // 25 affiliate set to default affiliate -> lp.owner = poolOwner
    expect(await wxDAI.balanceOf(poolOwner.address)).to.be.equal(
      balance.add(tokens(25).mul(affiliateFee).div(MULTIPLIER))
    );
  });
  it("Core is inactive", async function () {
    await makeBetGetTokenId(lp, core, bettor, affiliate.address, condId, tokens(100), OUTCOMELOSE, time + 100, 0);

    await switchCore(lp, core, poolOwner, false);

    timeShift(time + ONE_HOUR + ONE_MINUTE);
    await core.connect(oracle).resolveCondition(condId, OUTCOMEWIN);

    balance = await wxDAI.balanceOf(affiliate.address);
    await lp.claimAffiliateRewardFor(core.address, getClaimParamsDef(), affiliate.address);

    expect(await wxDAI.balanceOf(affiliate.address)).to.be.equal(
      balance.add(tokens(100).mul(affiliateFee).div(MULTIPLIER))
    );

    await switchCore(lp, core, poolOwner, true);
  });
  it("Game is canceled", async function () {
    await makeBetGetTokenId(lp, core, bettor, affiliate.address, condId, tokens(100), OUTCOMELOSE, time + 100, 0);

    await lp.connect(oracle).cancelGame(gameId);

    balance = await wxDAI.balanceOf(affiliate.address);
    await lp.claimAffiliateRewardFor(core.address, getClaimParamsDef(), affiliate.address);
    expect(await wxDAI.balanceOf(affiliate.address)).to.be.equal(balance);

    await expect(
      lp.claimAffiliateRewardFor(core.address, getClaimParamsDef(), affiliate.address)
    ).to.be.revertedWithCustomError(core, "NoPendingReward");
  });
  it("Condition is canceled", async function () {
    await makeBetGetTokenId(lp, core, bettor, affiliate.address, condId, tokens(100), OUTCOMELOSE, time + 100, 0);

    timeShift(time + ONE_HOUR);
    await core.connect(oracle).cancelCondition(condId);

    balance = await wxDAI.balanceOf(affiliate.address);
    await lp.claimAffiliateRewardFor(core.address, getClaimParamsDef(), affiliate.address);

    expect(await wxDAI.balanceOf(affiliate.address)).to.be.equal(balance);

    await expect(
      lp.claimAffiliateRewardFor(core.address, getClaimParamsDef(), affiliate.address)
    ).to.be.revertedWithCustomError(core, "NoPendingReward");
  });
  it("Condition is paused", async function () {
    await makeBetGetTokenId(lp, core, bettor, affiliate.address, condId, tokens(100), OUTCOMELOSE, time + 100, 0);

    await core.connect(maintainer).stopCondition(condId, true);

    timeShift(time + ONE_HOUR + ONE_MINUTE);

    balance = await wxDAI.balanceOf(affiliate.address);
    await lp.claimAffiliateRewardFor(core.address, getClaimParamsDef(), affiliate.address);

    expect(await wxDAI.balanceOf(affiliate.address)).to.be.equal(balance);

    await core.connect(oracle).resolveCondition(condId, OUTCOMEWIN);

    await lp.claimAffiliateRewardFor(core.address, getClaimParamsDef(), affiliate.address);

    expect(await wxDAI.balanceOf(affiliate.address)).to.be.equal(
      balance.add(tokens(100).mul(affiliateFee).div(MULTIPLIER))
    );

    await expect(
      lp.claimAffiliateRewardFor(core.address, getClaimParamsDef(), affiliate.address)
    ).to.be.revertedWithCustomError(core, "NoPendingReward");
  });
  it("Condition doesn't make a profit", async function () {
    let res = await makeBetGetTokenIdOdds(
      lp,
      core,
      bettor,
      affiliate2.address,
      condId,
      tokens(100),
      OUTCOMEWIN,
      time + 100,
      0
    );

    const zeroBalanceBet = tokens(100).mul(res.odds.sub(MULTIPLIER)).div(MULTIPLIER);
    await makeBetGetTokenId(
      lp,
      core,
      bettor,
      affiliate.address,
      condId,
      zeroBalanceBet.sub(1),
      OUTCOMELOSE,
      time + 100,
      0
    );

    timeShift(time + ONE_HOUR + ONE_MINUTE);
    await core.connect(oracle).resolveCondition(condId, OUTCOMEWIN);

    balance = await wxDAI.balanceOf(affiliate.address);
    await lp.claimAffiliateRewardFor(core.address, getClaimParamsDef(), affiliate.address);

    expect(await wxDAI.balanceOf(affiliate.address)).to.be.equal(balance);
  });
  it("Affiliate doesn't make a profit", async function () {
    let res = await makeBetGetTokenIdOdds(
      lp,
      core,
      bettor,
      affiliate.address,
      condId,
      tokens(100),
      OUTCOMEWIN,
      time + 100,
      0
    );

    const zeroBalanceBet = tokens(100).mul(res.odds.sub(MULTIPLIER)).div(MULTIPLIER);
    await makeBetGetTokenId(lp, core, bettor, affiliate.address, condId, zeroBalanceBet, OUTCOMELOSE, time + 100, 0);

    await makeBetGetTokenId(lp, core, bettor, affiliate2.address, condId, tokens(50), OUTCOMELOSE, time + 100, 0);

    timeShift(time + ONE_HOUR + ONE_MINUTE);
    await core.connect(oracle).resolveCondition(condId, OUTCOMEWIN);

    balance = await wxDAI.balanceOf(affiliate.address);
    await lp.claimAffiliateRewardFor(core.address, getClaimParamsDef(), affiliate.address);

    expect(await wxDAI.balanceOf(affiliate.address)).to.be.equal(balance);
  });
  it("Affiliate end up making a loss", async function () {
    // make profitable bets
    for (let i = 0; i < 10; i++) {
      await makeBetGetTokenIdOdds(lp, core, bettor, affiliate.address, condId, tokens(100), OUTCOMELOSE, time + 100, 0);
    }
    // make losing bet that outweighs potential affiliate profit
    await makeBetGetTokenId(lp, core, bettor, affiliate.address, condId, tokens(10_000), OUTCOMEWIN, time + 100, 0);

    timeShift(time + ONE_HOUR + ONE_MINUTE);
    await core.connect(oracle).resolveCondition(condId, OUTCOMEWIN);

    balance = await wxDAI.balanceOf(affiliate.address);
    await lp.claimAffiliateRewardFor(core.address, getClaimParamsDef(), affiliate.address);

    expect(await wxDAI.balanceOf(affiliate.address)).to.be.equal(balance);
  });
  it("Affiliate tries to get the same reward twice", async function () {
    await makeBetGetTokenId(lp, core, bettor, affiliate.address, condId, tokens(100), OUTCOMELOSE, time + 100, 0);

    timeShift(time + ONE_HOUR + ONE_MINUTE);
    await core.connect(oracle).resolveCondition(condId, OUTCOMEWIN);

    balance = await wxDAI.balanceOf(affiliate.address);
    await lp.claimAffiliateRewardFor(core.address, getClaimParamsDef(), affiliate.address);

    expect(await wxDAI.balanceOf(affiliate.address)).to.be.equal(
      balance.add(tokens(100).mul(affiliateFee).div(MULTIPLIER))
    );

    await expect(
      lp.claimAffiliateRewardFor(core.address, getClaimParamsDef(), affiliate.address)
    ).to.be.revertedWithCustomError(core, "NoPendingReward");
  });
  it("Affiliate gets a reward before all affiliated conditions are finished", async function () {
    let condIdStart = condId + 1;
    for (let i = 0; i < 3; i++) {
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
      await makeBetGetTokenId(lp, core, bettor, affiliate.address, condId, tokens(100), OUTCOMELOSE, time + 100, 0);

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
      await makeBetGetTokenId(lp, core, bettor, affiliate.address, condId, tokens(50), OUTCOMELOSE, time + 100, 0);
    }

    timeShift(time + ONE_HOUR + ONE_MINUTE);
    for (let i = 0; i < 3; i++) {
      await core.connect(oracle).resolveCondition(condIdStart + i * 2, OUTCOMEWIN);
    }

    balance = await wxDAI.balanceOf(affiliate.address);
    await lp.claimAffiliateRewardFor(core.address, getClaimParamsDef(), affiliate.address);

    expect(await wxDAI.balanceOf(affiliate.address)).to.be.equal(
      balance.add(tokens(300).mul(affiliateFee).div(MULTIPLIER))
    );

    timeShift(time + ONE_HOUR * 2 + ONE_MINUTE);
    condIdStart++;
    for (let i = 0; i < 3; i++) {
      await core.connect(oracle).resolveCondition(condIdStart + i * 2, OUTCOMEWIN);
    }

    await lp.claimAffiliateRewardFor(core.address, getClaimParamsDef(), affiliate.address);

    expect(await wxDAI.balanceOf(affiliate.address)).to.be.equal(
      balance.add(tokens(450).mul(affiliateFee).div(MULTIPLIER))
    );
  });
  it("Affiliate gets a reward for 10 conditions in 4 parts", async function () {
    expect(await core.getContributedConditionsCount(affiliate.address)).to.be.equal(0);
    for (let i = 0; i < 10; i++) {
      time = await getBlockTime(ethers);
      await createGame(lp, oracle, ++gameId, IPFS, time + ONE_HOUR);

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
      await makeBetGetTokenId(lp, core, bettor, affiliate.address, condId, tokens(100), OUTCOMELOSE, time + 100, 0);

      timeShift(time + ONE_HOUR + ONE_MINUTE);
      time = await getBlockTime(ethers);
      await core.connect(oracle).resolveCondition(condId, OUTCOMEWIN);
    }
    expect(await core.getContributedConditionsCount(affiliate.address)).to.be.equal(10);

    let start = 6;
    while (start >= 0) {
      balance = await wxDAI.balanceOf(affiliate.address);
      await lp.claimAffiliateRewardFor(core.address, getClaimParams(start, 3), affiliate.address);
      expect(await wxDAI.balanceOf(affiliate.address)).to.be.equal(
        balance.add(tokens(300).mul(affiliateFee).div(MULTIPLIER))
      );
      expect(await core.getContributedConditionsCount(affiliate.address)).to.be.equal(start + 1);
      start -= 3;
    }

    balance = await wxDAI.balanceOf(affiliate.address);
    await lp.claimAffiliateRewardFor(core.address, getClaimParams(0, 1), affiliate.address);

    expect(await core.getContributedConditionsCount(affiliate.address)).to.be.equal(0);
    expect(await wxDAI.balanceOf(affiliate.address)).to.be.equal(
      balance.add(tokens(100).mul(affiliateFee).div(MULTIPLIER))
    );
    await expect(
      lp.claimAffiliateRewardFor(core.address, getClaimParamsDef(), affiliate.address)
    ).to.be.revertedWithCustomError(core, "NoPendingReward");
  });
  it('Affiliate gets a reward with the "count" parameter exceeding the number of unrewarded conditions', async function () {
    for (let i = 0; i < 3; i++) {
      time = await getBlockTime(ethers);
      await createGame(lp, oracle, ++gameId, IPFS, time + ONE_HOUR);

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
      await makeBetGetTokenId(lp, core, bettor, affiliate.address, condId, tokens(100), OUTCOMELOSE, time + 100, 0);

      timeShift(time + ONE_HOUR + ONE_MINUTE);
      await core.connect(oracle).resolveCondition(condId, OUTCOMEWIN);
    }

    balance = await wxDAI.balanceOf(affiliate.address);
    await lp.claimAffiliateRewardFor(core.address, getClaimParams(0, 10), affiliate.address);

    expect(await wxDAI.balanceOf(affiliate.address)).to.be.equal(
      balance.add(tokens(300).mul(affiliateFee).div(MULTIPLIER))
    );
  });
  it("Affiliate gets a reward after fee changing", async function () {
    await makeBetGetTokenId(lp, core, bettor, affiliate.address, condId, tokens(100), OUTCOMELOSE, time + 10, 0);

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
    await makeBetGetTokenId(lp, core, bettor, affiliate.address, condId, tokens(50), OUTCOMELOSE, time + 10, 0);

    timeShift(time + ONE_HOUR + ONE_MINUTE);
    await core.connect(oracle).resolveCondition(condId - 1, OUTCOMEWIN);

    const newAffiliateFee = affiliateFee / 2;
    await lp.connect(poolOwner).changeFee(2, newAffiliateFee);

    balance = await wxDAI.balanceOf(affiliate.address);
    await lp.claimAffiliateRewardFor(core.address, getClaimParamsDef(), affiliate.address);
    expect(await wxDAI.balanceOf(affiliate.address)).to.be.closeTo(
      balance.add(tokens(100).mul(affiliateFee).div(MULTIPLIER)),
      10
    );

    await core.connect(oracle).resolveCondition(condId, OUTCOMEWIN);

    balance = await wxDAI.balanceOf(affiliate.address);
    await lp.claimAffiliateRewardFor(core.address, getClaimParamsDef(), affiliate.address);
    expect(await wxDAI.balanceOf(affiliate.address)).to.be.closeTo(
      balance.add(tokens(50).mul(newAffiliateFee).div(MULTIPLIER)),
      10
    );
  });
  it('Affiliate tries to get a reward with the "start" parameter exceeding the number of unrewarded conditions', async function () {
    for (let i = 0; i < 3; i++) {
      time = await getBlockTime(ethers);

      await createGame(lp, oracle, ++gameId, IPFS, time + ONE_HOUR);
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
      await makeBetGetTokenId(lp, core, bettor, affiliate.address, condId, tokens(100), OUTCOMELOSE, time + 100, 0);

      timeShift(time + ONE_HOUR + ONE_MINUTE);
      await core.connect(oracle).resolveCondition(condId, OUTCOMEWIN);
    }

    await expect(
      lp.claimAffiliateRewardFor(core.address, getClaimParams(4, 1), affiliate.address)
    ).to.be.revertedWithCustomError(core, "StartOutOfRange");
  });
});
