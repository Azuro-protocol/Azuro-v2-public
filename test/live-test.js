const { expect } = require("chai");
const { BigNumber } = require("ethers");
const { ethers } = require("hardhat");
const {
  blockShiftBy,
  claimBetToken,
  createGame,
  createCondition,
  encodeBetData,
  getBlockTime,
  getLiveBetDetails,
  plugLiveCore,
  prepareStand,
  grantRole,
  prepareAccess,
  prepareLiveCoreRoles,
  makeWithdrawPayout,
  timeShift,
  tokens,
  getClaimBetTokenDetails,
  nextBatch,
} = require("../utils/utils");
const { BIGZERO, FORKING, LIVE_CORE_ADDRESS, MULTIPLIER } = require("../utils/constants");

const LIQUIDITY = tokens(30_000_000);
const OUTCOMEWIN = 1;
const OUTCOMELOSE = 2;
const OUTCOMES = [OUTCOMEWIN, OUTCOMELOSE];
const ONE_DAY = 86400;
const ONE_HOUR = 3600;
const FIVE_MINUTES = 300;
const ONE_MINUTE = 60;
const ONE_SECOND = 1;
const BET_100 = tokens(100);
const BET_600 = tokens(600);
const BET_10000 = tokens(10_000);

const minDepo = tokens(10);
const daoFee = MULTIPLIER * 0.09; // 9%
const dataProviderFee = MULTIPLIER * 0.01; // 1%

const batchMinBlocks = 50;
const batchMaxBlocks = 100;

const calcCheckProfitShares = async (lp, core, wxDAI, res, affList, outcomewin, multiplier, isRewards) => {
  // calculate profit and affiliate shares
  [shares, protocolProfit] = await getAffListShares(core, res, affList, outcomewin, multiplier);

  // quit if no rewards or no aff shares or no profit
  if (!isRewards || affList.length == 0 || protocolProfit <= BIGZERO)
    return { profit: BIGZERO, root: ethers.utils.formatBytes32String("") };

  // make leaves, Merkle Tree
  [tree, leaves, root, leafAffiliate] = getAffRewardsMerkleTreeRoot(affList, shares);

  // verify leaves
  for (const i of leaves.keys()) {
    expect(tree.verify(tree.getProof(leaves[i]), leaves[i], root)).to.be.eq(true);
  }

  return { profit: protocolProfit, root: root, tree: tree, shares: shares };
};

const getOutcomeIndex = async (core, conditionId, outcome) => {
  let outcomes = (await core.getCondition(conditionId)).outcomes;
  if (outcome == outcomes[0]) return 0;
  if (outcome == outcomes[1]) return 1;
};

const makeBetGetTokenId = async (lp, user, core, affiliate, condId, betAmount, outcome, deadline, minrate) => {
  let txBet = await lp.connect(user).bet(core.address, betAmount, deadline, {
    affiliate: affiliate,
    data: encodeBetData(condId, outcome, minrate),
  });
  let res = await getLiveBetDetails(core, txBet);
  return res;
};

const resolveConditionAtBatchNumber = async (
  bettor,
  core,
  lp,
  oracle,
  condId,
  funds,
  rejectedBatchNumber,
  batchesLockedLiquidity,
  bets6batches,
  betDetails,
  wxDAI,
  affiliate,
  bets
) => {
  await core.connect(oracle).resolveCondition(condId, [OUTCOMEWIN], batchesLockedLiquidity[rejectedBatchNumber][0]);
  const condition = await core.getCondition(condId);
  for (const j of Array(2).keys()) {
    expect(condition.funds[j]).to.be.eq(
      rejectedBatchNumber == 0 ? condition.reinforcement : funds[rejectedBatchNumber - 1][j]
    );
  }
  expect(await lp.lockedLiquidity()).to.be.equal(0); // condition's liquidity lock by 0 is result of correctly reduced lockedLiquidity and resolve

  let totalNetBetsAccepted = BigNumber.from(0);
  let winPayouts = BigNumber.from(0);

  balance = await wxDAI.balanceOf(affiliate.address);
  for (const i of bets6batches.keys()) {
    if (i >= rejectedBatchNumber) break;
    let winOdds = (await core.getBatch(betDetails[i][1])).batchOdds[await getOutcomeIndex(core, condId, [OUTCOMEWIN])];
    let winAmount = bets6batches[i][1] == OUTCOMEWIN ? bets6batches[i][0] : BigNumber.from(0);
    totalNetBetsAccepted = totalNetBetsAccepted.add(bets6batches[i][0]);
    winPayouts = winPayouts.add(winAmount.mul(winOdds).div(MULTIPLIER));
  }

  let betIds = [];
  for (const i of betDetails.keys()) {
    betIds.push(betDetails[i][2]);
  }

  // prepare affiliates list
  let affList = [];
  affList.push(affiliate);

  // calculate profits, shares by affiliates list and check withdrawn rewards
  if (totalNetBetsAccepted.gt(winPayouts)) {
    await calcCheckProfitShares(lp, core, wxDAI, bets, affList, [OUTCOMEWIN], MULTIPLIER, true);
  }

  // bettor withdraw rejected / not rejected stake by betId
  let balBefore;
  let odds;
  for (const i of betDetails.keys()) {
    // accepted bets
    if (i < rejectedBatchNumber) {
      if (bets6batches[i][1] == OUTCOMEWIN) {
        balBefore = await wxDAI.balanceOf(bettor.address);
        odds = (await core.getBetInfo(betDetails[i][2])).odds;
        await makeWithdrawPayout(lp, core, bettor, betDetails[i][2]); // pass betId
        expect(await wxDAI.balanceOf(bettor.address)).to.be.equal(
          balBefore.add(bets6batches[i][0].mul(odds).div(MULTIPLIER))
        );
      }
    } else {
      balBefore = await wxDAI.balanceOf(bettor.address);
      await makeWithdrawPayout(lp, core, bettor, betDetails[i][2]); // pass betId
      expect(await wxDAI.balanceOf(bettor.address)).to.be.equal(balBefore.add(bets6batches[i][0]));
    }
  }
};

const repeatedBetGetTokenId = async (affiliate, outcome, common) => {
  time = await getBlockTime(ethers);
  return await makeBetGetTokenId(
    common.lp,
    common.bettor,
    common.core,
    affiliate,
    common.condIdHash,
    common.betAmount,
    outcome,
    time + 10,
    common.minRate
  );
};

describe.skip("Live test", function () {
  const MARGINALITY = MULTIPLIER * 0.05; // 5%
  const REINFORCEMENT = tokens(20_000);
  const pool1 = 5000000;
  const pool2 = 5000000;

  let dao, poolOwner, dataProvider, oracle, oracle2, maintainer, affiliate, affiliate2, bettor, bettor2;
  let factory, access, core, wxDAI, lp, azuroBet;
  let roleIds, time;

  let gameId = 0;
  let condId = 0;

  let bettingStart, bettingEnd;

  before(async function () {
    if (FORKING && LIVE_CORE_ADDRESS === "") this.skip();

    [
      dao,
      poolOwner,
      dataProvider,
      oracle,
      oracle2,
      maintainer,
      affiliateMaster,
      affiliate,
      affiliate1,
      affiliate2,
      affiliate3,
      affiliate4,
      affiliate5,
      affiliate6,
      affiliate7,
      affiliate8,
      affiliate9,
      affiliate10,
      bettor,
      bettor2,
    ] = await ethers.getSigners();
  });
  beforeEach(async function () {
    time = await getBlockTime(ethers);

    ({ factory, access, wxDAI, lp, azuroBet, roleIds } = await prepareStand(
      ethers,
      dao,
      poolOwner,
      dataProvider,
      bettor,
      minDepo,
      daoFee,
      dataProviderFee,
      LIQUIDITY
    ));
    await prepareAccess(access, poolOwner, oracle.address, oracle2.address, maintainer.address, roleIds);

    if (FORKING) {
      // Get existing live betting core
      const LiveCore = await ethers.getContractFactory("LiveCore", {
        unsafeAllowCustomTypes: true,
      });
      core = await LiveCore.attach(LIVE_CORE_ADDRESS);

      const AzuroBet = await ethers.getContractFactory("AzuroBet");
      azuroBet = await AzuroBet.attach(core.azuroBet());
    } else {
      // Plug live betting core
      const pluggedCore = await plugLiveCore(ethers, poolOwner, factory, lp.address);
      [core, azuroBet] = [pluggedCore.liveCore, pluggedCore.azuroBet];
    }

    // Set Live core specific role settings
    const affMasterRoleId = prepareLiveCoreRoles(access, poolOwner, core, roleIds);
    await grantRole(access, poolOwner, affiliateMaster.address, affMasterRoleId);

    // Set batch period
    await core.connect(oracle).changeBatchLimits(batchMinBlocks, batchMaxBlocks);

    // Create condition
    time = await getBlockTime(ethers);
    await createGame(lp, oracle, ++gameId, time + ONE_SECOND);

    time = await getBlockTime(ethers);

    bettingStart = time + FIVE_MINUTES;
    bettingEnd = bettingStart + ONE_HOUR;

    await createCondition(
      core,
      oracle,
      gameId,
      ++condId,
      [pool2, pool1],
      [OUTCOMEWIN, OUTCOMELOSE],
      REINFORCEMENT,
      MARGINALITY
    );

    try {
      await lp.connect(affiliate)["claimAffiliateReward(address)"](core.address);
    } catch {}
  });
  it("Betting all accepted bets and claim bet tokens", async () => {
    time = await getBlockTime(ethers);
    await timeShift(time + FIVE_MINUTES);
    let res = [];
    for (const i of Array(2).keys()) {
      for (const iterator of Array(3).keys()) {
        time = await getBlockTime(ethers);
        res.push(
          await makeBetGetTokenId(
            lp,
            bettor,
            core,
            affiliate.address,
            condId,
            BET_100,
            OUTCOMELOSE,
            time + 10,
            1100000000 + 100000000 * (iterator + 1)
          )
        );
        res.push(
          await makeBetGetTokenId(
            lp,
            bettor,
            core,
            affiliate.address,
            condId,
            BET_100,
            OUTCOMEWIN,
            time + 10,
            1100000000 + 100000000 * (iterator + 1)
          )
        );
      }
    }
    let affList = [];
    affList.push(affiliate);

    await expect(core.executeBatch(condId)).to.be.revertedWithCustomError(core, "MinBlocksNotPassed");

    // execute active batch on condition
    await nextBatch(ethers, core, condId, batchMinBlocks);

    // all accepted
    for (const i of res.keys()) {
      let r = await core.getBetInfo(res[i].betId);
      expect(r.rejected).to.be.equal(false);
      expect(r.betAmount).to.be.equal(BET_100);
    }

    // try claim all
    for (const i of res.keys()) {
      await expect(claimBetToken(core, bettor, res[i].betId)).to.be.revertedWithCustomError(
        core,
        "ConditionNotFinished"
      );
    }

    time = await getBlockTime(ethers);
    await timeShift(time + ONE_DAY + ONE_MINUTE);
    time = await getBlockTime(ethers);
    await core.connect(oracle).resolveCondition(condId, [OUTCOMEWIN], time + ONE_MINUTE);

    // claim all
    for (const i of res.keys()) {
      await claimBetToken(core, bettor, res[i].betId);
    }

    let tokenIds = await azuroBet.tokensOfOwner(bettor.address);
    expect(tokenIds.length).to.be.equal(2);

    // staked 600 tokens and funds > 600
    for (const i of tokenIds.keys()) {
      expect(await azuroBet.balanceOf(bettor.address, tokenIds[i])).to.be.equal(BET_600);
      expect(await azuroBet.balancePayoutOf(bettor.address, tokenIds[i])).to.be.gt(BET_600);
    }

    // calculate profits, shares by affiliates list and check withdrawn rewards
    await calcCheckProfitShares(lp, core, wxDAI, res, affList, [OUTCOMEWIN], MULTIPLIER, true);
  });
  it("Betting accepted and rejected bets and claim bet tokens", async () => {
    let betIDs = [];
    let res;

    time = await getBlockTime(ethers);
    await timeShift(time + FIVE_MINUTES);
    time = await getBlockTime(ethers);
    let hugeRes = await makeBetGetTokenId(
      lp,
      bettor,
      core,
      affiliate.address,
      condId,
      BET_10000,
      OUTCOMEWIN,
      time + 10,
      0
    );
    betIDs.push(hugeRes);

    time = await getBlockTime(ethers);
    let rejectedRes = await makeBetGetTokenId(
      lp,
      bettor,
      core,
      affiliate.address,
      condId,
      tokens(10),
      OUTCOMEWIN,
      time + 10,
      MULTIPLIER * 1.9
    );
    betIDs.push(rejectedRes);

    for (const iterator of Array(30).keys()) {
      for (const i of OUTCOMES.keys()) {
        time = await getBlockTime(ethers);
        betIDs.push(
          await makeBetGetTokenId(
            lp,
            bettor,
            core,
            affiliate.address,
            condId,
            BET_100,
            OUTCOMES[i],
            time + 10,
            BigNumber.from(MULTIPLIER)
              .mul(100 + iterator)
              .div(100)
          )
        );
      }
    }

    let affList = [];
    affList.push(affiliate);

    let batches = await core.conditionBatchCount(condId);
    let batchId = await core.batchIds(condId, batches - 1);

    // execute active batch on condition
    await nextBatch(ethers, core, condId, batchMinBlocks);

    // one rejected
    res = await core.getBetInfo(rejectedRes.betId);
    expect(res.rejected).to.be.equal(true);
    expect(res.betAmount).to.be.equal(tokens(10));
    await expect(claimBetToken(core, bettor, rejectedRes.betId)).to.be.revertedWithCustomError(core, "BetRejected");

    let balBefore = await wxDAI.balanceOf(bettor.address);
    await makeWithdrawPayout(lp, core, bettor, rejectedRes.betId); // pass betId
    expect(await wxDAI.balanceOf(bettor.address)).to.be.equal(balBefore.add(tokens(10)));

    time = await getBlockTime(ethers);
    await timeShift(time + ONE_DAY + ONE_MINUTE);
    time = await getBlockTime(ethers);
    await core.connect(oracle).resolveCondition(condId, [OUTCOMEWIN], time + ONE_MINUTE);

    // all accepted
    for (const i of betIDs.keys()) {
      let betId = betIDs[i].betId;
      res = await core.getBetInfo(betId);
      if (betId != rejectedRes.betId) {
        expect(res.rejected).to.be.equal(false);
        if (betId == hugeRes.betId) expect(res.betAmount).to.be.equal(BET_10000);
        else expect(res.betAmount).to.be.equal(BET_100);
        await claimBetToken(core, bettor, betId);
      }
    }

    // nothing to be locked
    expect(await lp.lockedLiquidity()).to.be.equal(0);

    // check expected payouts
    let resOdds = (await core.getBatch(batchId)).batchOdds;
    for (const i of OUTCOMES.keys()) {
      let tokenId = await core.getTokenId(condId, i);
      expect((await azuroBet.balanceOf(bettor.address, tokenId)).mul(resOdds[i]).div(MULTIPLIER)).to.be.equal(
        await azuroBet.balancePayoutOf(bettor.address, tokenId)
      );
    }

    // no protocol profit
    expect(
      (await calcCheckProfitShares(lp, core, wxDAI, betIDs, affList, [OUTCOMEWIN], MULTIPLIER, true)).profit
    ).to.be.eq(0);
    // no affiliate profit
    expect(await wxDAI.balanceOf(affiliate.address)).to.be.equal(0);
  });
  it("Bets and claim bet tokens, resolved not all batches", async () => {
    let toRejectBetIDs = [];
    let betIDs = [];
    let bets = [];
    let res;
    let affList = [];
    affList.push(affiliate);
    affList.push(affiliate1);
    affList.push(affiliate2);

    for (const a of affList.keys()) {
      for (const iterator of Array(10).keys()) {
        for (const i of OUTCOMES.keys()) {
          time = await getBlockTime(ethers);
          res = await makeBetGetTokenId(
            lp,
            bettor,
            core,
            affList[a].address,
            condId,
            BET_100,
            OUTCOMES[i],
            time + 10,
            1000000000 + iterator * 10000000
          );
          betIDs.push(res.betId);
          bets.push(res);
        }
      }
    }

    let batches = await core.conditionBatchCount(condId);
    let batchId = await core.batchIds(condId, batches - 1);
    await nextBatch(ethers, core, condId, batchMinBlocks);

    // save resolve time as last batch started
    let resolveTime = await getBlockTime(ethers);

    time = await getBlockTime(ethers);
    await timeShift(time + FIVE_MINUTES);
    time = await getBlockTime(ethers);

    // make bets for batch that will not be accepted
    for (const iterator of Array(30).keys()) {
      for (const i of OUTCOMES.keys()) {
        time = await getBlockTime(ethers);
        res = await makeBetGetTokenId(
          lp,
          bettor,
          core,
          affiliate.address,
          condId,
          BET_100,
          OUTCOMES[i],
          time + 10,
          1000000000 + iterator * 10000000
        );
        toRejectBetIDs.push(res.betId);
        bets.push(res);
      }
    }

    // resolve
    await core.connect(oracle).resolveCondition(condId, [OUTCOMEWIN], resolveTime);

    // nothing to be locked
    expect(await lp.lockedLiquidity()).to.be.equal(0);

    let resOdds = [];
    for (const i of OUTCOMES.keys()) {
      resOdds.push((await core.getBatch(batchId)).batchOdds[i]);
    }

    let balBefore = await wxDAI.balanceOf(bettor.address);
    // all rejected bets claimed back
    for (const i of toRejectBetIDs.keys()) {
      res = await core.getBetInfo(toRejectBetIDs[i]);
      expect(res.rejected).to.be.equal(true);
      expect(res.betAmount).to.be.equal(BET_100);

      // withdraw rejected
      await makeWithdrawPayout(lp, core, bettor, toRejectBetIDs[i]);
      await expect(claimBetToken(core, bettor, toRejectBetIDs[i])).to.be.revertedWithCustomError(core, "OnlyBetOwner");
    }
    let balAfter = await wxDAI.balanceOf(bettor.address);
    expect(balAfter).to.be.equal(balBefore.add(BET_100.mul(30).mul(2)));

    //claim not rejected
    for (const i of betIDs.keys()) {
      res = await core.getBetInfo(betIDs[i]);
      expect(res.rejected).to.be.equal(false);
      expect(res.betAmount).to.be.equal(BET_100);
      await claimBetToken(core, bettor, betIDs[i]);
      await expect(claimBetToken(core, bettor, betIDs[i])).to.be.revertedWithCustomError(core, "AlreadyClaimed");
    }

    for (const i of OUTCOMES.keys()) {
      let tokenId = await core.getTokenId(condId, i);
      expect((await azuroBet.balanceOf(bettor.address, tokenId)).mul(resOdds[i]).div(MULTIPLIER)).to.be.equal(
        await azuroBet.balancePayoutOf(bettor.address, tokenId)
      );
    }

    // calculate profits, shares by affiliates list and check withdrawn rewards
    await calcCheckProfitShares(lp, core, wxDAI, bets, affList, [OUTCOMEWIN], MULTIPLIER, true);
  });
  it("3 bets: 1 accepted 2 rejected after execute batch", async () => {
    let acceptedBetIDs = [];
    let rejectedBetIDs = [];
    let betDetails = [];
    let betIDs = [];
    let affList = [];

    time = await getBlockTime(ethers);
    await timeShift(time + FIVE_MINUTES);
    time = await getBlockTime(ethers);

    // first bet, but executed in second term
    res = await makeBetGetTokenId(
      lp,
      bettor,
      core,
      affiliate.address,
      condId,
      tokens(600),
      OUTCOMELOSE,
      time + 10,
      MULTIPLIER * 1.8
    );
    rejectedBetIDs.push(res.betId);
    betDetails.push(res.betId);
    betIDs.push(res);

    // second bet, but executed in first term, large bet makes odds lower than minOdds for other bets
    res = await makeBetGetTokenId(
      lp,
      bettor,
      core,
      affiliate.address,
      condId,
      tokens(6000),
      OUTCOMELOSE,
      time + 10,
      MULTIPLIER
    );
    acceptedBetIDs.push(res.betId);
    betDetails.push(res.betId);
    betIDs.push(res);
    affList.push(affiliate);

    res = await makeBetGetTokenId(
      lp,
      bettor,
      core,
      affiliate.address,
      condId,
      tokens(900),
      OUTCOMELOSE,
      time + 10,
      MULTIPLIER * 1.8
    );
    rejectedBetIDs.push(res.betId);
    betDetails.push(res.betId);
    betIDs.push(res);

    // execute active batch on condition
    await nextBatch(ethers, core, condId, batchMinBlocks);

    // resolve condition
    await timeShift(time + ONE_DAY + ONE_MINUTE);
    time = await getBlockTime(ethers);
    await core.connect(oracle).resolveCondition(condId, [OUTCOMEWIN], time + ONE_MINUTE);

    // check 1 accepted bet
    for (const i of acceptedBetIDs.keys()) {
      let betData = await core.getBetInfo(acceptedBetIDs[i]);
      expect(betData.rejected).to.be.equal(false);
    }

    // check 2 rejected bets
    for (const i of rejectedBetIDs.keys()) {
      expect((await core.getBetInfo(rejectedBetIDs[i])).rejected).to.be.equal(true);
    }

    // affiliate get 100% of affiliated profit
    await calcCheckProfitShares(lp, core, wxDAI, betIDs, affList, [OUTCOMEWIN], MULTIPLIER, true);
  });
  it("3 bets: 2 accepted in first batch, 1 accepted in next batch", async () => {
    let firstBatchBetIDs = [];
    let secondBatchBetIDs = [];
    let res = [];

    time = await getBlockTime(ethers);
    await timeShift(time + FIVE_MINUTES);
    time = await getBlockTime(ethers);

    res.push(
      await makeBetGetTokenId(
        lp,
        bettor,
        core,
        affiliate.address,
        condId,
        BET_100,
        OUTCOMELOSE,
        time + 10,
        MULTIPLIER * 1.5
      )
    );
    firstBatchBetIDs.push(res[res.length - 1].betId);
    time = await getBlockTime(ethers);

    res.push(
      await makeBetGetTokenId(
        lp,
        bettor,
        core,
        affiliate.address,
        condId,
        BET_100,
        OUTCOMELOSE,
        time + 10,
        MULTIPLIER * 1.5
      )
    );
    firstBatchBetIDs.push(res[res.length - 1].betId);

    // pass batch period for new batch at new bet
    await blockShiftBy(ethers, batchMaxBlocks);
    time = await getBlockTime(ethers);
    res.push(
      await makeBetGetTokenId(
        lp,
        bettor,
        core,
        affiliate.address,
        condId,
        tokens(900),
        OUTCOMELOSE,
        time + 10,
        MULTIPLIER * 1.8
      )
    );
    secondBatchBetIDs.push(res[res.length - 1].betId);

    let affList = [];
    affList.push(affiliate);

    // execute active batch on condition
    await nextBatch(ethers, core, condId, batchMinBlocks);

    // check fist batch bets
    for (const i of firstBatchBetIDs.keys()) {
      let betData = await core.betGroups(firstBatchBetIDs[i]);
      expect(betData.batchId).to.be.eq(1);
      expect((await core.getBetInfo(firstBatchBetIDs[i])).odds).to.be.equal("1887012779013"); // odds = 1.887
    }

    // check seconds batch bets
    for (const i of secondBatchBetIDs.keys()) {
      let betData = await core.betGroups(secondBatchBetIDs[i]);
      expect(betData.batchId).to.be.eq(2);
      expect((await core.getBetInfo(secondBatchBetIDs[i])).odds).to.be.equal("1800341217091"); // odds = 1.800
    }

    // check affiliate profit
    await timeShift(time + ONE_DAY + ONE_MINUTE);
    time = await getBlockTime(ethers);
    await core.connect(oracle).resolveCondition(condId, [OUTCOMEWIN], time + ONE_MINUTE);

    // calculate profits, shares by affiliates list and check withdrawn rewards
    await calcCheckProfitShares(lp, core, wxDAI, res, affList, [OUTCOMEWIN], MULTIPLIER, true);
  });
  it("4 bets: accepted (rejected) winning and losing", async () => {
    let acceptedBetIDs = [];
    let rejectedBetIDs = [];
    let betDetails = [];
    let res;
    let affList = [];
    let betIDs = [];

    time = await getBlockTime(ethers);
    await timeShift(time + FIVE_MINUTES);
    time = await getBlockTime(ethers);

    res = await makeBetGetTokenId(
      lp,
      bettor,
      core,
      affiliate.address,
      condId,
      BET_100,
      OUTCOMEWIN,
      time + 10,
      MULTIPLIER
    );
    acceptedBetIDs.push(res.betId);
    betDetails.push(res.betId);
    affList.push(affiliate);
    betIDs.push(res);

    res = await makeBetGetTokenId(
      lp,
      bettor,
      core,
      affiliate1.address,
      condId,
      tokens(200),
      OUTCOMELOSE,
      time + 10,
      MULTIPLIER
    );
    acceptedBetIDs.push(res.betId);
    betDetails.push(res.betId);
    affList.push(affiliate1);
    betIDs.push(res);

    // pass batch period and to call execute batch
    await nextBatch(ethers, core, condId, batchMinBlocks);

    time = await getBlockTime(ethers);
    let resolveTime = time;

    res = await makeBetGetTokenId(
      lp,
      bettor,
      core,
      affiliate.address,
      condId,
      tokens(400),
      OUTCOMEWIN,
      time + 10,
      MULTIPLIER * 1.8
    );
    rejectedBetIDs.push(res.betId);
    betDetails.push(res.betId);
    betIDs.push(res);

    res = await makeBetGetTokenId(
      lp,
      bettor,
      core,
      affiliate.address,
      condId,
      tokens(800),
      OUTCOMEWIN,
      time + 10,
      MULTIPLIER * 1.8
    );
    rejectedBetIDs.push(res.betId);
    betDetails.push(res.betId);
    betIDs.push(res);

    // check affiliate profit
    await timeShift(time + ONE_DAY + ONE_MINUTE);
    time = await getBlockTime(ethers);
    await core.connect(oracle).resolveCondition(condId, [OUTCOMEWIN], resolveTime);

    // check if bets are rejected
    for (const i of OUTCOMES.keys()) {
      expect((await core.getBetInfo(acceptedBetIDs[i])).rejected).to.be.equal(false);
      expect((await core.getBetInfo(rejectedBetIDs[i])).rejected).to.be.equal(true);
    }

    // calculate profits, shares by affiliates list and check withdrawn rewards
    await calcCheckProfitShares(lp, core, wxDAI, betIDs, affList, [OUTCOMEWIN], MULTIPLIER, true);
  });
  it("Withdraw payout for bet from batch executed with resolving condition", async () => {
    time = await getBlockTime(ethers);
    await timeShift(time + FIVE_MINUTES);
    time = await getBlockTime(ethers);

    let betAmount = BET_100;
    let balBefore = await wxDAI.balanceOf(bettor.address);
    let res = [];
    res.push(
      await makeBetGetTokenId(
        lp,
        bettor,
        core,
        affiliate.address,
        condId,
        betAmount,
        OUTCOMEWIN,
        time + 10,
        MULTIPLIER * 1.5
      )
    );

    // can't accept bet after live period
    await timeShift(bettingEnd + 1);
    await expect(
      makeBetGetTokenId(
        lp,
        bettor,
        core,
        affiliate.address,
        condId,
        betAmount,
        [OUTCOMEWIN],
        time + 10,
        MULTIPLIER * 1.5
      )
    ).revertedWithCustomError(lp, "BetExpired");

    let affList = [];
    affList.push(affiliate);

    // pass batch period and to call execute batch
    await nextBatch(ethers, core, condId, batchMinBlocks);
    time = await getBlockTime(ethers);

    await core.connect(oracle).resolveCondition(condId, [OUTCOMEWIN], time);

    let betData = await core.getBetInfo(res[0].betId);
    expect(betData.rejected).to.be.equal(false);

    // try view payout for incorrect bettor
    await expect(core.viewPayout(bettor2.address, res[0].betId)).to.be.revertedWithCustomError(core, "OnlyBetOwner");

    await makeWithdrawPayout(lp, core, bettor, res[0].betId);

    expect(await wxDAI.balanceOf(bettor.address)).to.be.equal(
      balBefore.add(betData.odds.sub(MULTIPLIER).mul(betAmount).div(MULTIPLIER))
    );
    await expect(claimBetToken(core, bettor, res[0].betId)).to.be.revertedWithCustomError(core, "OnlyBetOwner");

    // calculate profits, shares by affiliates list and check withdrawn rewards, no affiliate rewards
    await calcCheckProfitShares(lp, core, wxDAI, res, affList, [OUTCOMEWIN], MULTIPLIER, false);
  });
  it("Withdraw payout by single transaction for bet from batch executed and condition resolved", async () => {
    time = await getBlockTime(ethers);
    await timeShift(time + FIVE_MINUTES);
    time = await getBlockTime(ethers);

    let betAmount = BET_100;
    let balBefore = await wxDAI.balanceOf(bettor.address);
    let res = [];
    res.push(
      await makeBetGetTokenId(
        lp,
        bettor,
        core,
        affiliate.address,
        condId,
        betAmount,
        OUTCOMEWIN,
        time + 10,
        MULTIPLIER * 1.5
      )
    );

    let affList = [];
    affList.push(affiliate);

    // pass batch period and to call execute batch
    await nextBatch(ethers, core, condId, batchMinBlocks);
    time = await getBlockTime(ethers);

    await core.connect(oracle).resolveCondition(condId, [OUTCOMEWIN], time);

    let betData = await core.getBetInfo(res[0].betId);
    expect(betData.rejected).to.be.equal(false);

    let azuroBetTokensBefore = await azuroBet.balanceOf(bettor.address, res[0].betId);
    await makeWithdrawPayout(lp, core, bettor, res[0].betId);

    // check azuroBet tokens not affected
    expect(azuroBetTokensBefore.sub(await azuroBet.balanceOf(bettor.address, res[0].betId))).to.be.equal(0);

    expect(await wxDAI.balanceOf(bettor.address)).to.be.equal(
      balBefore.add(betData.odds.sub(MULTIPLIER).mul(betAmount).div(MULTIPLIER))
    );

    // calculate profits, shares by affiliates list and check withdrawn rewards, no affiliate rewards
    await calcCheckProfitShares(lp, core, wxDAI, res, affList, [OUTCOMEWIN], MULTIPLIER, false);
  });
  it("Withdraw payout for bet for canceled condition", async () => {
    time = await getBlockTime(ethers);
    await timeShift(time + FIVE_MINUTES);
    time = await getBlockTime(ethers);

    let betAmount = BET_100;
    let balBefore = await wxDAI.balanceOf(bettor.address);
    let res = [];
    res.push(
      await makeBetGetTokenId(
        lp,
        bettor,
        core,
        affiliate.address,
        condId,
        betAmount,
        OUTCOMES[0],
        time + 10,
        MULTIPLIER * 1.5
      )
    );

    let affList = [];
    affList.push(affiliate);

    expect(await wxDAI.balanceOf(bettor.address)).to.be.equal(balBefore.sub(betAmount));

    await timeShift(time + ONE_DAY + ONE_MINUTE);
    await core.connect(oracle).cancelCondition(condId);

    let betData = await core.getBetInfo(res[0].betId);
    expect(betData.rejected).to.be.equal(false);

    await makeWithdrawPayout(lp, core, bettor, res[0].betId);

    expect(await wxDAI.balanceOf(bettor.address)).to.be.equal(balBefore);
    await expect(claimBetToken(core, bettor, res[0].betId)).to.be.revertedWithCustomError(core, "OnlyBetOwner");

    // calculate profits, shares by affiliates list and check withdrawn rewards, no affiliate rewards
    await calcCheckProfitShares(lp, core, wxDAI, res, affList, [OUTCOMEWIN], MULTIPLIER, false);

    // no affiliate rewards
    expect(await wxDAI.balanceOf(affList[0].address)).to.be.eq(0);
  });
  describe("make 6 batches, resolve parts of batches", async () => {
    let batchesBetIDs, batchesLockedLiquidity, funds, res, bets;

    let bets6batches = [
      [tokens(200), [OUTCOMEWIN]],
      [tokens(200), OUTCOMELOSE],
      [tokens(300), [OUTCOMEWIN]],
      [tokens(400), OUTCOMELOSE],
      [tokens(400), [OUTCOMEWIN]],
      [tokens(500), OUTCOMELOSE],
    ];

    beforeEach(async function () {
      batchesBetIDs = [];
      batchesLockedLiquidity = [];
      funds = [];
      betDetails = [];
      bets = [];

      time = await getBlockTime(ethers);
      await timeShift(time + FIVE_MINUTES);

      for (const i of bets6batches.keys()) {
        time = await getBlockTime(ethers);
        res = await makeBetGetTokenId(
          lp,
          bettor,
          core,
          affiliate.address,
          condId,
          bets6batches[i][0], // amount
          bets6batches[i][1], // outcome
          time + 10,
          MULTIPLIER * 1.5
        );
        bets.push(res);
        batchesBetIDs.push(res.betId);
        betDetails.push([res.conditionId, res.batchId, res.betId]);
        batchesLockedLiquidity.push([time, await lp.lockedLiquidity()]);
        funds.push((await core.getCondition(condId)).funds);
        await blockShiftBy(ethers, batchMaxBlocks);
      }

      // add after last batch
      time = await getBlockTime(ethers);
      batchesLockedLiquidity.push([time, await lp.lockedLiquidity()]);

      // remove first
      batchesLockedLiquidity.shift();
      funds.shift();

      time = await getBlockTime(ethers);
      await timeShift(time + ONE_DAY);
      time = await getBlockTime(ethers);
    });

    it("resolve at batch #0, (nothing accepted)", async () => {
      await resolveConditionAtBatchNumber(
        bettor,
        core,
        lp,
        oracle,
        condId,
        funds,
        0,
        batchesLockedLiquidity,
        bets6batches,
        betDetails,
        wxDAI,
        affiliate,
        bets
      );
    });

    it("resolve at batch #1, (#0 accepted)", async () => {
      await resolveConditionAtBatchNumber(
        bettor,
        core,
        lp,
        oracle,
        condId,
        funds,
        1,
        batchesLockedLiquidity,
        bets6batches,
        betDetails,
        wxDAI,
        affiliate,
        bets
      );
    });

    it("resolve at batch #2, (#0, #1 batches accepted)", async () => {
      await resolveConditionAtBatchNumber(
        bettor,
        core,
        lp,
        oracle,
        condId,
        funds,
        2,
        batchesLockedLiquidity,
        bets6batches,
        betDetails,
        wxDAI,
        affiliate,
        bets
      );
    });

    it("resolve at batch #3, (#0, #1, #2 batches accepted)", async () => {
      await resolveConditionAtBatchNumber(
        bettor,
        core,
        lp,
        oracle,
        condId,
        funds,
        3,
        batchesLockedLiquidity,
        bets6batches,
        betDetails,
        wxDAI,
        affiliate,
        bets
      );
    });

    it("resolve at batch #4, (#0, #1, #2, #3 batches accepted)", async () => {
      await resolveConditionAtBatchNumber(
        bettor,
        core,
        lp,
        oracle,
        condId,
        funds,
        4,
        batchesLockedLiquidity,
        bets6batches,
        betDetails,
        wxDAI,
        affiliate,
        bets
      );
    });

    it("resolve at batch #5, (#0, #1, #2, #3, #4 batches accepted)", async () => {
      await resolveConditionAtBatchNumber(
        bettor,
        core,
        lp,
        oracle,
        condId,
        funds,
        5,
        batchesLockedLiquidity,
        bets6batches,
        betDetails,
        wxDAI,
        affiliate,
        bets
      );
    });
  });
  it("Betting bet after resolved condition", async () => {
    await blockShiftBy(ethers, FIVE_MINUTES);
    time = await getBlockTime(ethers);
    await core.connect(oracle).resolveCondition(condId, [OUTCOMEWIN], time);
    time = await getBlockTime(ethers);

    await expect(
      makeBetGetTokenId(lp, bettor, core, affiliate.address, condId, BET_100, [OUTCOMEWIN], time + 10, MULTIPLIER * 1.5)
    ).to.be.revertedWithCustomError(core, "ConditionNotRunning");
  });
  it("Betting before and after canceled condition, claim token and get stake, get stake by betId, affiliate try get rewards", async () => {
    let betDetails = [];
    let res = await makeBetGetTokenId(
      lp,
      bettor,
      core,
      affiliate.address,
      condId,
      BET_100,
      OUTCOMEWIN,
      time + 10,
      MULTIPLIER * 1.5
    );
    betDetails.push(res.betId);
    res = await makeBetGetTokenId(
      lp,
      bettor,
      core,
      affiliate.address,
      condId,
      BET_100,
      OUTCOMELOSE,
      time + 10,
      MULTIPLIER * 1.5
    );
    betDetails.push(res.betId);

    await core.connect(oracle).cancelCondition(condId);
    time = await getBlockTime(ethers);

    // try bet after canceled
    await expect(
      makeBetGetTokenId(lp, bettor, core, affiliate.address, condId, BET_100, [OUTCOMEWIN], time + 10, MULTIPLIER * 1.5)
    ).to.be.revertedWithCustomError(core, "ConditionNotRunning");

    // claim token by betId and withdraw bet by token
    let txBet = await core.connect(bettor).claimBetToken(betDetails[0]);
    let tokenId = (await getClaimBetTokenDetails(azuroBet, txBet)).id;

    let balBefore = await wxDAI.balanceOf(bettor.address);
    await makeWithdrawPayout(lp, core, bettor, tokenId); // pass tokenId
    expect(await wxDAI.balanceOf(bettor.address)).to.be.equal(balBefore.add(BET_100));

    balBefore = await wxDAI.balanceOf(bettor.address);
    await makeWithdrawPayout(lp, core, bettor, betDetails[1]); // pass betId
    expect(await wxDAI.balanceOf(bettor.address)).to.be.equal(balBefore.add(BET_100));
  });
  it("Betting with 3 affiliates - one win stake", async () => {
    /**
    batch    bet     win                    lose          oddsWin        winner payout   affiliate profit
             100     affiliate1             affiliate1    1.895801648767 189.5801648767 10.419835123
    1        100                            affiliate2                                  100
             100                            affiliate3                                  100
    --------------------------------------------------
             100                            affiliate1                                  100
    2        100                            affiliate2                                  100
             100                            affiliate3                                  100
    --------------------------------------------------
             100                            affiliate1                                  100
    3        100                            affiliate2                                  100
             100                            affiliate3                                  100
    -----------------------------------------------------------------------------------------------------
    Bets    1000                                                                        810.419835123

    affiliate1..........................................................................210.419835123
    affiliate2..........................................................................300
    affiliate3..........................................................................300

    Winer payouts		 189.580164876700       1640.089916
    Protocol profit	 810.419835123300       -640.0899159
    Aff profit (33%) 267.438545590689       -211.2296723
    aff kef	0.33

    rewards share
      affiliate1     210.419835123 / 810.419835123300 * 810.419835123300 * 0.33 = 69.43854559050
      affiliate2     300           / 810.419835123300 * 810.419835123300 * 0.33 = 99
      affiliate3     300           / 810.419835123300 * 810.419835123300 * 0.33 = 99
    rewards
      affiliate1     124,3574236 / 424,3574236 * 93,4946307 * 0.33   = 9,041500743
      affiliate3     300         / 424,3574236 * 93,4946307 * 0.33   = 21,81172739
    */
    time = await getBlockTime(ethers);
    let common = {
      lp: lp,
      bettor: bettor,
      core: core,
      condIdHash: condId,
      minRate: MULTIPLIER * 1.5,
      betAmount: BET_100,
    };
    let res = [];
    let affList = [];
    affList.push(affiliate1);
    affList.push(affiliate2);
    affList.push(affiliate3);

    // make all bets by 3 batches
    res.push(await repeatedBetGetTokenId(affiliate1.address, [OUTCOMEWIN], common));
    for (const i of affList.keys()) {
      res.push(await repeatedBetGetTokenId(affList[i].address, OUTCOMELOSE, common));
    }
    await nextBatch(ethers, core, condId, batchMinBlocks);

    for (const i of affList.keys()) {
      res.push(await repeatedBetGetTokenId(affList[i].address, OUTCOMELOSE, common));
    }
    await nextBatch(ethers, core, condId, batchMinBlocks);

    for (const i of affList.keys()) {
      res.push(await repeatedBetGetTokenId(affList[i].address, OUTCOMELOSE, common));
    }
    await nextBatch(ethers, core, condId, batchMinBlocks);

    time = await getBlockTime(ethers);
    await timeShift(time + ONE_DAY + ONE_MINUTE);
    time = await getBlockTime(ethers);
    await core.connect(oracle).resolveCondition(condId, [OUTCOMEWIN], time + ONE_MINUTE);
    expect(await lp.lockedLiquidity()).to.be.equal(0);

    // try to claim zero proof
    await expect(lp.connect(affiliate1).claimAffiliateReward(core.address, 0x0)).to.be.reverted;

    // calculate profits, shares by affiliates list and check withdrawn rewards
    await calcCheckProfitShares(lp, core, wxDAI, res, affList, [OUTCOMEWIN], MULTIPLIER, true);
  });
  it("Betting with 3 affiliates - multiple win stakes", async () => {
    /**
    batch   winbet   win           losebet  lose          oddsWin       winner payout
             100     affiliate1      200    affiliate1    1,878390428   187,8390428
    1        200     affiliate2      100    affiliate2                  375,6780856
                                     300    affiliate3
    --------------------------------------------------
    2        200     affiliate1      100    affiliate1    1,939017668   387,8035336
                                     100    affiliate2
    --------------------------------------------------
    3                                100    affiliate1
             500     affiliate2      100    affiliate2    1,910369415   955,1847073
    --------------------------------------------------------------------------------
    Bets    1000                    1000                               1906,505369

    Winer payouts		1906,505369	  1899,456849
    Protocol profit	  93,4946307	 100,5431513
    Aff profit (33%)  30,85322813	  33,17923992
    aff kef	0.33

    rewards
      affiliate1     124,3574236 / 424,3574236 * 93,4946307 * 0.33   = 9,041500743
      affiliate3     300         / 424,3574236 * 93,4946307 * 0.33   = 21,81172739
    */
    time = await getBlockTime(ethers);
    let common = {
      lp: lp,
      bettor: bettor,
      core: core,
      condIdHash: condId,
      minRate: MULTIPLIER * 1.5,
      betAmount: BET_100,
    };
    let res = [];
    let affList = [];
    affList.push(affiliate1);
    affList.push(affiliate2);
    affList.push(affiliate3);

    // make all bets by 3 batches
    res.push(await repeatedBetGetTokenId(affiliate1.address, [OUTCOMEWIN], common));
    for (const i of Array(2).keys()) {
      res.push(await repeatedBetGetTokenId(affiliate1.address, OUTCOMELOSE, common));
    }
    for (const i of Array(2).keys()) {
      res.push(await repeatedBetGetTokenId(affiliate2.address, [OUTCOMEWIN], common));
    }
    res.push(await repeatedBetGetTokenId(affiliate2.address, OUTCOMELOSE, common));
    for (const i of Array(3).keys()) {
      res.push(await repeatedBetGetTokenId(affiliate3.address, OUTCOMELOSE, common));
    }
    await nextBatch(ethers, core, condId, batchMinBlocks);

    for (const i of Array(2).keys()) {
      res.push(await repeatedBetGetTokenId(affiliate1.address, [OUTCOMEWIN], common));
    }
    res.push(await repeatedBetGetTokenId(affiliate1.address, OUTCOMELOSE, common));
    res.push(await repeatedBetGetTokenId(affiliate2.address, OUTCOMELOSE, common));
    await nextBatch(ethers, core, condId, batchMinBlocks);

    res.push(await repeatedBetGetTokenId(affiliate1.address, OUTCOMELOSE, common));
    for (const i of Array(5).keys()) {
      res.push(await repeatedBetGetTokenId(affiliate2.address, [OUTCOMEWIN], common));
    }
    res.push(await repeatedBetGetTokenId(affiliate2.address, OUTCOMELOSE, common));
    await nextBatch(ethers, core, condId, batchMinBlocks);

    time = await getBlockTime(ethers);
    await timeShift(time + ONE_DAY + ONE_MINUTE);
    time = await getBlockTime(ethers);

    // resolve condition
    await core.connect(oracle).resolveCondition(condId, [OUTCOMEWIN], time + ONE_MINUTE);
    expect(await lp.lockedLiquidity()).to.be.equal(0);

    // try to claim zero proof
    await expect(lp.connect(affiliate1).claimAffiliateReward(core.address, 0x0)).to.be.reverted;

    // calculate profits, shares by affiliates list and check withdrawn rewards
    let calcResult = await calcCheckProfitShares(lp, core, wxDAI, res, affList, [OUTCOMEWIN], MULTIPLIER, true);

    // try bad proof
    let badLeaves = [];
    badLeaves.push(
      ethers.utils.hexlify(
        Buffer.from(
          ethers.utils.solidityKeccak256(["address", "uint128"], [affiliate4.address, BET_100]).slice(2),
          "hex"
        )
      )
    );

    const tree = new MerkleTree(badLeaves, keccak256, { sortPairs: true });
    expect(tree.verify(calcResult.tree, badLeaves[0], calcResult.root)).to.be.eq(false);
  });
  it("Betting with 3 affiliates - all win stakes", async () => {
    /**
    batch   winbet   win           losebet  lose          oddsWin        winner payout
             100     affiliate1                           1.878390427935 187,8390428
    1        200     affiliate2                                          375,6780856
    --------------------------------------------------
    2        200     affiliate1                           1.838851721573 367,7703443
    --------------------------------------------------
             500     affiliate3                           1.786654108405 893,3270542
    --------------------------------------------------------------------------------
    Bets    1000                                                        1906,505369

    Winer payouts		          1906,505369	  0
    Protocol profit		        -906,5053693	1000
    Affiliated profit (33%)		-299,1467719	330
    aff kef	0,33
    */
    time = await getBlockTime(ethers);
    let common = {
      lp: lp,
      bettor: bettor,
      core: core,
      condIdHash: condId,
      minRate: MULTIPLIER * 1.5,
      betAmount: BET_100,
    };
    let res = [];
    let affList = [];
    affList.push(affiliate1);
    affList.push(affiliate2);
    affList.push(affiliate3);

    // make all bets by 3 batches
    res.push(await repeatedBetGetTokenId(affiliate1.address, [OUTCOMEWIN], common));
    for (const i of Array(2).keys()) {
      res.push(await repeatedBetGetTokenId(affiliate2.address, [OUTCOMEWIN], common));
    }
    await nextBatch(ethers, core, condId, batchMinBlocks);

    for (const i of Array(2).keys()) {
      res.push(await repeatedBetGetTokenId(affiliate1.address, [OUTCOMEWIN], common));
    }
    await nextBatch(ethers, core, condId, batchMinBlocks);

    for (const i of Array(5).keys()) {
      934946307;
      res.push(await repeatedBetGetTokenId(affiliate3.address, [OUTCOMEWIN], common));
    }
    await nextBatch(ethers, core, condId, batchMinBlocks);

    await timeShift((await getBlockTime(ethers)) + ONE_DAY + ONE_MINUTE);
    time = await getBlockTime(ethers);

    // resolve condition
    await core.connect(oracle).resolveCondition(condId, [OUTCOMEWIN], time + ONE_MINUTE);
    expect(await lp.lockedLiquidity()).to.be.equal(0);

    // calculate profits, shares by affiliates list and check withdrawn rewards
    let checkProfits = await calcCheckProfitShares(lp, core, wxDAI, res, affList, [OUTCOMEWIN], MULTIPLIER, true);
    // all win, no protocol/affiliate profits
    expect(checkProfits.profit).to.be.eq(0);
  });
  it("Betting with 3 affiliates - all lose stakes", async () => {
    /**
    batch    bet     win                    lose          oddsWin        winner payout  affiliated profit
    1        100                            affiliate1                                  100
             200                            affiliate2                                  200
    --------------------------------------------------
    2        200                            affiliate1                                  200
    --------------------------------------------------
    3        500                            affiliate3                                  500
    -----------------------------------------------------------------------------------------------------
    Bets    1000                                                                        500

    Winer payouts		             0	      1905,560366
    Protocol profit		        1000	      -905,5603658
    Affiliated profit (33%)		 330	      -298,8349207
    aff kef	0,33

    rewards
      affiliate1     300 / 1000 * 1000 * 0.33 = 99
      affiliate2     200 / 1000 * 1000 * 0.33 = 66
      affiliate3     500 / 1000 * 1000 * 0.33 = 165
    */
    time = await getBlockTime(ethers);
    let common = {
      lp: lp,
      bettor: bettor,
      core: core,
      condIdHash: condId,
      minRate: MULTIPLIER * 1.5,
      betAmount: BET_100,
    };
    let res = [];
    let affList = [];
    affList.push(affiliate1);
    affList.push(affiliate2);
    affList.push(affiliate3);

    // make all bets by 3 batches
    res.push(await repeatedBetGetTokenId(affiliate1.address, OUTCOMELOSE, common));
    for (const i of Array(2).keys()) {
      res.push(await repeatedBetGetTokenId(affiliate2.address, OUTCOMELOSE, common));
    }
    await nextBatch(ethers, core, condId, batchMinBlocks);

    for (const i of Array(2).keys()) {
      res.push(await repeatedBetGetTokenId(affiliate1.address, OUTCOMELOSE, common));
    }
    await nextBatch(ethers, core, condId, batchMinBlocks);

    for (const i of Array(5).keys()) {
      res.push(await repeatedBetGetTokenId(affiliate3.address, OUTCOMELOSE, common));
    }
    await nextBatch(ethers, core, condId, batchMinBlocks);

    await timeShift((await getBlockTime(ethers)) + ONE_DAY + ONE_MINUTE);
    time = await getBlockTime(ethers);

    // resolve condition
    await core.connect(oracle).resolveCondition(condId, [OUTCOMEWIN], time + ONE_MINUTE);
    expect(await lp.lockedLiquidity()).to.be.equal(0);

    // calculate profits, shares by affiliates list and check withdrawn rewards
    let checkProfits = await calcCheckProfitShares(lp, core, wxDAI, res, affList, [OUTCOMEWIN], MULTIPLIER, true);
    // all lose, all stakes go to protocol/affiliate profits
    expect(checkProfits.profit).to.be.eq(tokens(1000));
  });
  // keep out! run takes ~4 minutes to execution
  it("Mass bets on one minOdds", async () => {
    /**
    batch    bet     win                    lose          oddsWin        winner payout  affiliated profit
    1     100 * 1000                        affiliate1                                  100000
          100 * 1000                        affiliate2                                  100000
    --------------------------------------------------
    2     100 * 1000                        affiliate1                                  100000
          100 * 1000                        affiliate2                                  100000
    -----------------------------------------------------------------------------------------------------
    Bets    400000                                                                      400000

    Winer payouts		              0	 405910,4424
    Protocol profit		       400000	  -5910,442365
    Affiliated profit (33%)	 132000	  -1950,44598
    aff kef	0,33

    rewards
      affiliate1     200000 / 400000 * 400000 * 0.33 = 66000
      affiliate2     200000 / 400000 * 400000 * 0.33 = 66000
    */
    time = await getBlockTime(ethers);
    let common = {
      lp: lp,
      bettor: bettor,
      core: core,
      condIdHash: condId,
      minRate: MULTIPLIER * 1,
      betAmount: BET_100,
    };
    let res = [];
    let affList = [];
    affList.push(affiliate1);
    affList.push(affiliate2);

    const TIMES = 1000;

    // try set incorrect batch limits
    await expect(core.connect(oracle).changeBatchLimits(10_000, 1_000)).to.be.revertedWithCustomError(
      core,
      "IncorrectBatchLimits"
    );

    // Increase live period settings
    await core.connect(oracle).changeBatchLimits(1_000, 10_000);

    // make all bets by 2 batches
    for (const i of Array(TIMES).keys()) {
      res.push(await repeatedBetGetTokenId(affiliate1.address, OUTCOMELOSE, common));
      res.push(await repeatedBetGetTokenId(affiliate2.address, OUTCOMELOSE, common));
    }
    await nextBatch(ethers, core, condId, batchMinBlocks);

    for (const i of Array(TIMES).keys()) {
      res.push(await repeatedBetGetTokenId(affiliate1.address, OUTCOMELOSE, common));
      res.push(await repeatedBetGetTokenId(affiliate2.address, OUTCOMELOSE, common));
    }
    await nextBatch(ethers, core, condId, batchMinBlocks);

    await timeShift((await getBlockTime(ethers)) + ONE_DAY + ONE_MINUTE);
    time = await getBlockTime(ethers);

    // resolve condition
    await core.connect(oracle).resolveCondition(condId, [OUTCOMEWIN], time + ONE_MINUTE);
    expect(await lp.lockedLiquidity()).to.be.equal(0);

    // calculate profits, shares by affiliates list and check withdrawn rewards
    let checkProfits = await calcCheckProfitShares(lp, core, wxDAI, res, affList, [OUTCOMEWIN], MULTIPLIER, true);
    // all lose, all stakes go to protocol/affiliate profits
    expect(checkProfits.profit).to.be.eq(tokens(400_000));
  });
  it("Large bets (10_000_000)", async () => {
    /**
    batch    bet     win                    lose          oddsWin        winner payout  affiliated profit
    1     1_000_000                         affiliate1                                  1_000_000
          1_000_000  affiliate2                                                         1_000_000
    --------------------------------------------------
    2    10_000_000  affiliate1                                                         10_000_000
         10_000_000                         affiliate2                                  10_000_000
    -----------------------------------------------------------------------------------------------------
    Bets 22_000_000                                                                     22_000_000

    Winer payouts		        20952380,95	   20952380,95
    Protocol profit		       1047619,048	  1047619,048
    Affiliated profit (33%)		345714,2857	   345714,2857
    aff kef	0,33

    rewards
      affiliate1     1000000 / 11000000 * 1047619,048 * 0.33 =  31428.5714
      affiliate2    10000000 / 11000000 * 1047619,048 * 0.33 = 314285.7144
    */
    time = await getBlockTime(ethers);
    let common = {
      lp: lp,
      bettor: bettor,
      core: core,
      condIdHash: condId,
      minRate: MULTIPLIER * 1,
      betAmount: tokens(1_000_000),
    };
    let res = [];
    let affList = [];
    affList.push(affiliate1);
    affList.push(affiliate2);

    // make all bets by 2 batches
    res.push(await repeatedBetGetTokenId(affiliate1.address, [OUTCOMEWIN], common));
    res.push(await repeatedBetGetTokenId(affiliate2.address, OUTCOMELOSE, common));
    await nextBatch(ethers, core, condId, batchMinBlocks);

    common = {
      lp: lp,
      bettor: bettor,
      core: core,
      condIdHash: condId,
      minRate: MULTIPLIER * 1,
      betAmount: tokens(10_000_000),
    };
    res.push(await repeatedBetGetTokenId(affiliate1.address, [OUTCOMEWIN], common));
    res.push(await repeatedBetGetTokenId(affiliate2.address, OUTCOMELOSE, common));

    await nextBatch(ethers, core, condId, batchMinBlocks);

    await timeShift((await getBlockTime(ethers)) + ONE_DAY + ONE_MINUTE);
    time = await getBlockTime(ethers);

    // resolve condition
    await core.connect(oracle).resolveCondition(condId, [OUTCOMEWIN], time + ONE_MINUTE);
    expect(await lp.lockedLiquidity()).to.be.equal(0);

    // calculate profits, shares by affiliates list and check withdrawn rewards
    await calcCheckProfitShares(lp, core, wxDAI, res, affList, [OUTCOMEWIN], MULTIPLIER, true);
  });
  it("Many different minOdds", async () => {
    time = await getBlockTime(ethers);
    let res = [];
    let affList = [];
    affList.push(affiliate);

    const TIMES = 120;
    const NEW_BATCH_MIN_BLOCKS = 1_000;
    const PRECISION = 10;

    // Increase live period settings
    await core.connect(oracle).changeBatchLimits(NEW_BATCH_MIN_BLOCKS, 10_000);

    // Change odds
    await core.connect(oracle).changeOdds(condId, [10000000000000, 90000000000]);

    const BIG_MULTIPLIER = BigNumber.from(MULTIPLIER);
    const BIG_ONE = BigNumber.from(1);

    // make many bets with different minOdds

    for (const i of Array(TIMES).keys()) {
      time = await getBlockTime(ethers);
      let big_i = BigNumber.from(i);
      res.push(
        await makeBetGetTokenId(
          lp,
          bettor,
          core,
          affiliate.address,
          condId,
          BET_100,
          OUTCOMEWIN,
          time + 10,
          BIG_MULTIPLIER.mul(BIG_ONE.mul(PRECISION).add(BIG_ONE.mul(big_i))).div(PRECISION)
        )
      );
      res.push(
        await makeBetGetTokenId(
          lp,
          bettor,
          core,
          affiliate.address,
          condId,
          BET_100,
          OUTCOMELOSE,
          time + 10,
          BIG_MULTIPLIER
        )
      );
    }

    await nextBatch(ethers, core, condId, NEW_BATCH_MIN_BLOCKS);

    await timeShift((await getBlockTime(ethers)) + ONE_DAY + ONE_MINUTE);
    time = await getBlockTime(ethers);

    // resolve condition
    await core.connect(oracle).resolveCondition(condId, [OUTCOMEWIN], time + ONE_MINUTE);
    expect(await lp.lockedLiquidity()).to.be.equal(0);
  });
  it("Win bet, withdraw all liquidity, withdraw win payout", async () => {
    const firstLPNFT = 1_099_511_627_776;
    time = await getBlockTime(ethers);
    let res = await makeBetGetTokenId(
      lp,
      bettor,
      core,
      affiliate.address,
      condId,
      BET_100,
      OUTCOMEWIN,
      time + 10,
      MULTIPLIER
    );
    await nextBatch(ethers, core, condId, batchMinBlocks);
    await timeShift((await getBlockTime(ethers)) + ONE_DAY + ONE_MINUTE);

    // resolve condition
    time = await getBlockTime(ethers);
    await core.connect(oracle).resolveCondition(condId, [OUTCOMEWIN], (await getBlockTime(ethers)) + ONE_MINUTE);
    expect(await lp.lockedLiquidity()).to.be.equal(0);

    // LP withdraw all of liquidity
    await lp.withdrawLiquidity(firstLPNFT, 1e12, false);

    // bettor withdraw payout
    let balBefore = await wxDAI.balanceOf(bettor.address);
    let betOdds = (await core.getBetInfo(res.betId)).odds;
    await lp.connect(bettor).withdrawPayout(core.address, res.betId);
    expect((await wxDAI.balanceOf(bettor.address)).sub(balBefore)).to.be.eq(BET_100.mul(betOdds).div(MULTIPLIER));
  });
  it("Withdraw affiliate rewards from two reward periods.", async () => {
    let betAmount = BET_100;
    let res, balBefore, affList;

    for (const i of Array(2).keys()) {
      time = await getBlockTime(ethers);

      await createGame(lp, oracle, ++gameId, time + ONE_SECOND);

      // game started and we try to create live condition
      await timeShift(time + ONE_MINUTE);

      await createCondition(
        core,
        oracle,
        gameId,
        ++condId,
        [pool2, pool1],
        [OUTCOMEWIN, OUTCOMELOSE],
        REINFORCEMENT,
        MARGINALITY
      );
      await timeShift(time + FIVE_MINUTES);
      time = await getBlockTime(ethers);

      balBefore = await wxDAI.balanceOf(bettor.address);
      res = [];
      res.push(
        await makeBetGetTokenId(
          lp,
          bettor,
          core,
          affiliate.address,
          condId,
          betAmount,
          OUTCOMELOSE,
          time + 10,
          MULTIPLIER * 1.5
        )
      );

      affList = [];
      affList.push(affiliate);

      // pass batch period and to call execute batch
      await nextBatch(ethers, core, condId, batchMinBlocks);
      time = await getBlockTime(ethers);

      await core.connect(oracle).resolveCondition(condId, [OUTCOMEWIN], time);

      // calculate profits, shares by affiliates list and check withdrawn rewards, no affiliate rewards
      await calcCheckProfitShares(lp, core, wxDAI, res, affList, [OUTCOMEWIN], MULTIPLIER, true);
    }
  });
  it("Pass incorrect share > 100%", async () => {
    let betAmount = BET_100;
    let res, balBefore, affList;

    time = await getBlockTime(ethers);
    await timeShift(time + FIVE_MINUTES);
    time = await getBlockTime(ethers);

    balBefore = await wxDAI.balanceOf(bettor.address);
    res = [];
    res.push(
      await makeBetGetTokenId(
        lp,
        bettor,
        core,
        affiliate.address,
        condId,
        betAmount,
        OUTCOMELOSE,
        time + 10,
        MULTIPLIER * 1.5
      )
    );

    affList = [];
    affList.push(affiliate);

    // pass batch period and to call execute batch
    await nextBatch(ethers, core, condId, batchMinBlocks);
    time = await getBlockTime(ethers);

    await core.connect(oracle).resolveCondition(condId, [OUTCOMEWIN], time);

    // calculate profits, shares by affiliates list and check withdrawn rewards, no affiliate rewards
    let shares = [];

    let affAddress = affList[0].address;
    shares[affAddress] = BigNumber.from(MULTIPLIER).add(1);

    // make leaves, Merkle Tree
    [tree, leaves, root, leafAffiliate] = getAffRewardsMerkleTreeRoot(affList, shares);

    // write rewards
    let resSet = await setAffRewards(core, affiliateMaster, root);

    // try to claim affiliate rewards with incorrect share
    let affiliateAddress = affList[0].address;
    let rawParams = await getClaimLiveParams(
      tree,
      resSet.setNumber,
      leafAffiliate[affiliateAddress],
      shares[affiliateAddress]
    );
    await expect(claimAffiliateReward(lp, affList[0], core, rawParams)).to.be.revertedWithCustomError(
      core,
      "RewardsExceeded"
    );
  });
  it("Pass incorrect sum share (50% + 51%) > 100%", async () => {
    let betAmount = BET_100;
    let res, balBefore, affList;

    affList = [];
    affList.push(affiliate);
    affList.push(affiliate1);

    time = await getBlockTime(ethers);
    await timeShift(time + FIVE_MINUTES);
    time = await getBlockTime(ethers);

    balBefore = await wxDAI.balanceOf(bettor.address);
    res = [];
    for (const i of Array(2).keys()) {
      res.push(
        await makeBetGetTokenId(
          lp,
          bettor,
          core,
          affList[i].address,
          condId,
          betAmount,
          OUTCOMELOSE,
          time + 10,
          MULTIPLIER * 1.5
        )
      );
    }

    // pass batch period and to call execute batch
    await nextBatch(ethers, core, condId, batchMinBlocks);
    time = await getBlockTime(ethers);

    await core.connect(oracle).resolveCondition(condId, [OUTCOMEWIN], time);

    // calculate profits, shares by affiliates list and check withdrawn rewards, no affiliate rewards
    let shares = [];

    shares[affList[0].address] = BigNumber.from(MULTIPLIER).div(2);
    shares[affList[1].address] = BigNumber.from(MULTIPLIER).div(2).add(BigNumber.from(10).pow(10));

    // make leaves, Merkle Tree
    [tree, leaves, root, leafAffiliate] = getAffRewardsMerkleTreeRoot(affList, shares);

    // write rewards
    let resSet = await setAffRewards(core, affiliateMaster, root);

    // claim rewards
    let rawParams = [];
    for (const i of Array(2).keys()) {
      rawParams.push(
        await getClaimLiveParams(tree, resSet.setNumber, leafAffiliate[affList[i].address], shares[affList[i].address])
      );
    }
    // claim 50% of 100%, rest 50%
    await claimAffiliateReward(lp, affList[0], core, rawParams[0]);
    // try to claim affiliate rewards with incorrect share (51% of 50%)
    await expect(claimAffiliateReward(lp, affList[1], core, rawParams[1])).to.be.revertedWithCustomError(
      core,
      "RewardsExceeded"
    );
  });
  it("Betting before and after canceled game, claim token and get stake, get stake by betId, affiliate try get rewards", async () => {
    let betDetails = [];
    let res = await makeBetGetTokenId(
      lp,
      bettor,
      core,
      affiliate.address,
      condId,
      BET_100,
      OUTCOMEWIN,
      time + 10,
      MULTIPLIER * 1.5
    );
    betDetails.push(res.betId);
    res = await makeBetGetTokenId(
      lp,
      bettor,
      core,
      affiliate.address,
      condId,
      BET_100,
      OUTCOMELOSE,
      time + 10,
      MULTIPLIER * 1.5
    );
    betDetails.push(res.betId);

    await lp.connect(oracle).cancelGame(gameId);
    time = await getBlockTime(ethers);

    // try bet after canceled
    await expect(
      makeBetGetTokenId(lp, bettor, core, affiliate.address, condId, BET_100, [OUTCOMEWIN], time + 10, MULTIPLIER * 1.5)
    ).to.be.revertedWithCustomError(core, "ConditionNotRunning");

    // claim token by betId and withdraw bet by token
    let txBet = await core.connect(bettor).claimBetToken(betDetails[0]);
    let tokenId = (await getClaimBetTokenDetails(azuroBet, txBet)).id;

    let balBefore = await wxDAI.balanceOf(bettor.address);
    await makeWithdrawPayout(lp, core, bettor, tokenId); // pass tokenId
    expect(await wxDAI.balanceOf(bettor.address)).to.be.equal(balBefore.add(BET_100));

    balBefore = await wxDAI.balanceOf(bettor.address);
    await makeWithdrawPayout(lp, core, bettor, betDetails[1]); // pass betId
    expect(await wxDAI.balanceOf(bettor.address)).to.be.equal(balBefore.add(BET_100));
  });
});
