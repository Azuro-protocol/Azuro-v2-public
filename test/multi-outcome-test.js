const { expect } = require("chai");
const { ethers } = require("hardhat");
const {
  createCondition,
  getBlockTime,
  tokens,
  createGame,
  prepareStand,
  prepareAccess,
  makeWithdrawPayout,
  makeBetGetTokenIdOdds,
  timeShift,
} = require("../utils/utils");
const { ITERATIONS } = require("../utils/constants");
const { BigNumber } = require("ethers");

const MULTIPLIER = 1e12;
const MAX_ODDS = BigNumber.from(MULTIPLIER).mul(100);

const LIQUIDITY = tokens(200000);
const MIN_DEPO = tokens(10);
const DAO_FEE = MULTIPLIER * 0.09; // 9%
const DATA_PROVIDER_FEE = MULTIPLIER * 0.01; // 1%
const AFFILIATE_FEE = MULTIPLIER * 0.6; // 60%
const REINFORCEMENT = tokens(20000);
const MARGINALITY = MULTIPLIER * 0.05; // 5%

const OUTCOMEWIN = 1;
const OUTCOMESLOSE = Array.from({ length: 20 }, (_, i) => i + 2);

const ONE_DAY = 86400;
const ONE_HOUR = 3600;
const ONE_MINUTE = 60;

let gameId = 0;
let condId = 0;

const testEngine = async (
  lp,
  core,
  wxDAI,
  coreTools,
  oracle,
  bettor,
  dao,
  dataProvider,
  affiliate,
  REINFORCEMENT,
  getBetData
) => {
  const outcomesCounts = [2, 3, 4, 10, (await core.MAX_OUTCOMES_COUNT()).toNumber()];
  outcomesCountLoop: for (const outcomesCount of outcomesCounts) {
    const outcomes = [...Array(outcomesCount).keys()];
    const outcomeWin = outcomes[Math.floor(Math.random() * outcomes.length)];

    const time = await getBlockTime(ethers);
    const lockedBefore = await lp.lockedLiquidity();

    const daoReward = (await lp.rewards(dao.address)).amount;
    const dataProviderReward = (await lp.rewards(dataProvider.address)).amount;
    const affiliateReward = (await lp.rewards(affiliate.address)).amount;

    await createGame(lp, oracle, ++gameId, time + ONE_DAY);
    await createCondition(
      core,
      oracle,
      gameId,
      ++condId,
      Array(outcomesCount).fill(50_000),
      outcomes,
      REINFORCEMENT,
      MARGINALITY,
      false
    );

    const payouts = Array(outcomesCount).fill(BigNumber.from(0));
    let totalNetBets = BigNumber.from(0);
    const winningBets = [],
      losingBets = [];
    for (const iteration of Array(ITERATIONS).keys()) {
      let [outcome, betAmount, largeFundsRatio] = getBetData(iteration, outcomes);
      let tokenId, odds;

      try {
        ({ tokenId, odds } = await makeBetGetTokenIdOdds(
          lp,
          core,
          bettor,
          affiliate.address,
          condId,
          betAmount,
          outcome,
          time + ONE_DAY,
          0
        ));
      } catch (error) {
        if (
          (error.message.includes("IncorrectOdds") || error.message.includes("SafeCastError(2)")) &&
          largeFundsRatio
        ) {
          continue outcomesCountLoop;
        } else {
          throw error;
        }
      }

      const condition = await core.getCondition(condId);
      const virtualFunds = condition.virtualFunds;
      let virtualFund = BigNumber.from(0);
      for (const fund of virtualFunds) {
        virtualFund = virtualFund.add(fund);
      }

      const probabilities = [];
      for (const fund of virtualFunds) {
        probabilities.push(fund.mul(MULTIPLIER).div(virtualFund));
      }

      const conditionOdds = await coreTools.calcOdds(virtualFunds, MARGINALITY, 1);
      const spreads = [];
      let have_max_ods = false;
      for (const i of Array(outcomes.length).keys()) {
        spreads[i] = BigNumber.from(MULTIPLIER).sub(conditionOdds[i].mul(probabilities[i]).div(MULTIPLIER));
        expect(conditionOdds[i]).lte(MAX_ODDS);
        // Checking that the odds cannot be greater than the set value of MAX_ODDS
        if (!have_max_ods && conditionOdds[i].eq(MAX_ODDS)) have_max_ods = true;
      }

      const sortedOutcomes = outcomes.slice().sort((a, b) => probabilities[b].sub(probabilities[a]).toNumber());
      for (let i = 0; i < sortedOutcomes.length - 1; i++) {
        const currentOutcome = sortedOutcomes[i];
        const nextOutcome = sortedOutcomes[i + 1];
        if (conditionOdds[currentOutcome].eq(MAX_ODDS)) {
          expect(conditionOdds[nextOutcome]).eq(MAX_ODDS);
        } else if (probabilities[currentOutcome].gt(probabilities[nextOutcome])) {
          // Checking that spreads[i] < spreads[j] if probabilities[i] > probabilities[j]
          expect(spreads[currentOutcome].lt(spreads[nextOutcome]));
          // Checking that odds[i] < odds[j] if probabilities[i] > probabilities[j]
          expect(conditionOdds[currentOutcome]).lt(conditionOdds[nextOutcome]);
        } else {
          // Checking that spreads[i] == spreads[j] if probabilities[i] == probabilities[j]
          expect(spreads[currentOutcome].eq(spreads[nextOutcome]));
          // Checking that odds[i] == odds[j] if probabilities[i] == probabilities[j]
          expect(conditionOdds[currentOutcome]).eq(conditionOdds[nextOutcome]);
        }
      }

      let spread = BigNumber.from(0);
      for (const i of Array(outcomes.length).keys()) {
        spread = spread.add(BigNumber.from(MULTIPLIER).mul(MULTIPLIER).div(conditionOdds[i]));
      }
      const realMargin = BigNumber.from(MULTIPLIER).sub(BigNumber.from(MULTIPLIER).mul(MULTIPLIER).div(spread));
      if (have_max_ods === true) {
        // Checking that actual margin is larger than expected margin if there are odds larger than MAX_ODDS
        expect(BigNumber.from(MARGINALITY)).lte(realMargin);
      } else {
        // Checking that actual margin is close to expected margin if there are no odds larger than MAX_ODDS
        expect(BigNumber.from(MARGINALITY).sub(realMargin).abs().mul(MULTIPLIER).div(MARGINALITY)).to.be.lte(1e9);
      }

      const payout = odds.mul(betAmount).div(MULTIPLIER);
      payouts[outcome] = payouts[outcome].add(payout);
      totalNetBets = totalNetBets.add(betAmount);

      // Checking that potential payout <= total bet amount + REINFORCEMENT
      expect(payouts[outcome]).to.be.lte(totalNetBets.add(REINFORCEMENT));

      let maxPayout = BigNumber.from(0);
      for (const payout of payouts) {
        if (payout.gt(maxPayout)) maxPayout = payout;
      }
      const lockedLiquidity = await lp.lockedLiquidity();
      if (maxPayout.gt(totalNetBets))
        // Checking that locked liquidity = max payout - total bet amount if max payout > total bet amount
        expect(lockedLiquidity).to.be.equal(lockedBefore.add(maxPayout.sub(totalNetBets)));
      // Checking that liquidity is not locked after the condition is resolved if max payout <= total bet amount
      else expect(lockedLiquidity).to.be.equal(lockedBefore);

      if (outcome == outcomeWin) {
        winningBets.push({ amount: betAmount, tokenId: tokenId, payout: payout });
      } else losingBets.push({ amount: betAmount, tokenId: tokenId });
    }

    await timeShift(time + ONE_DAY + ONE_MINUTE);
    await core.connect(oracle).resolveCondition(condId, [outcomeWin]);

    // Checking that liquidity is not locked after the condition is resolved
    expect(await lp.lockedLiquidity()).to.be.equal(lockedBefore);

    const outcomeWinPayout = payouts[outcomeWin];
    // Checking data provider and dao reward changing
    expect((await lp.rewards(dao.address)).amount).to.be.equal(
      daoReward.add(totalNetBets.sub(outcomeWinPayout).mul(DAO_FEE).div(MULTIPLIER))
    );
    expect((await lp.rewards(dataProvider.address)).amount).to.be.equal(
      dataProviderReward.add(totalNetBets.sub(outcomeWinPayout).mul(DATA_PROVIDER_FEE).div(MULTIPLIER))
    );
    expect((await lp.rewards(affiliate.address)).amount).to.be.equal(
      affiliateReward.add(totalNetBets.sub(outcomeWinPayout).mul(AFFILIATE_FEE).div(MULTIPLIER))
    );

    for (const bet of losingBets) {
      const balance = await wxDAI.balanceOf(bettor.address);
      await lp.connect(bettor).withdrawPayout(core.address, bet.tokenId);
      // Checking that winning bet payout = bet amount * odds
      expect(await wxDAI.balanceOf(bettor.address)).to.be.equal(balance);
    }

    for (const bet of winningBets) {
      let balance = await wxDAI.balanceOf(bettor.address);
      await makeWithdrawPayout(lp, core, bettor, bet.tokenId);
      // Checking that losing bet payout = 0
      expect(await wxDAI.balanceOf(bettor.address)).to.be.equal(balance.add(bet.payout));
    }
  }
};

context("Multi-outcome test", function () {
  let dao, poolOwner, dataProvider, oracle, oracle2, maintainer, affiliate, bettor;
  let factory, access, core, azuroBet, wxDAI, lp, coreTools;
  let roleIds, time;

  before(async function () {
    [dao, poolOwner, dataProvider, oracle, oracle2, maintainer, bettor, affiliate] = await ethers.getSigners();

    ({ factory, access, core, azuroBet, wxDAI, lp, roleIds } = await prepareStand(
      ethers,
      dao,
      poolOwner,
      dataProvider,
      affiliate,
      bettor,
      MIN_DEPO,
      DAO_FEE,
      DATA_PROVIDER_FEE,
      AFFILIATE_FEE,
      LIQUIDITY
    ));

    const LibraryMock = await ethers.getContractFactory("LibraryMock");
    coreTools = await LibraryMock.deploy();
    await coreTools.deployed();

    await prepareAccess(access, poolOwner, oracle.address, oracle2.address, maintainer.address, roleIds);
  });
  context("Conditions management", function () {
    it("Create conditions with outcomes having the same odds", async () => {
      const time = await getBlockTime(ethers);
      await createGame(lp, oracle, ++gameId, time + ONE_DAY);

      const outcomesCounts = [2, 3, 4, 10, (await core.MAX_OUTCOMES_COUNT()).toNumber()];
      outcomesCountLoop: for (const outcomesCount of outcomesCounts) {
        const outcomes = [...Array(outcomesCount).keys()];
        await createCondition(
          core,
          oracle,
          gameId,
          ++condId,
          Array(outcomesCount).fill(50_000),
          outcomes,
          REINFORCEMENT,
          0,
          false
        );

        const condition = await core.getCondition(condId);
        const expectedOdds = MULTIPLIER * outcomesCount;
        let newVirtualFund = BigNumber.from(0);
        for (const i of Array(outcomesCount).keys()) {
          newVirtualFund = newVirtualFund.add(condition.virtualFunds[i]);
          expect(await core.calcOdds(condId, 0, i)).to.be.equal(expectedOdds);
        }

        expect(newVirtualFund).to.be.closeTo(REINFORCEMENT, 100);
      }
    });
    it("Create conditions with outcomes having the different odds", async () => {
      const time = await getBlockTime(ethers);
      await createGame(lp, oracle, ++gameId, time + ONE_DAY);

      const outcomesCounts = [2, 3, 4, 10, (await core.MAX_OUTCOMES_COUNT()).toNumber()];
      outcomesCountLoop: for (const outcomesCount of outcomesCounts) {
        const outcomes = [...Array(outcomesCount).keys()];

        const initialOdds = Array.from({ length: outcomesCount }, (_, i) => 1000 + i * 1000);
        let oddsNormalizer = BigNumber.from(0);
        for (let i = 0; i < outcomesCount; i++) {
          oddsNormalizer = oddsNormalizer.add(BigNumber.from(MULTIPLIER).mul(MULTIPLIER).div(initialOdds[i]));
        }

        await createCondition(core, oracle, gameId, ++condId, initialOdds, outcomes, REINFORCEMENT, 0, false);

        const condition = await core.getCondition(condId);
        let newVirtualFund = BigNumber.from(0);
        for (const i of Array(outcomesCount).keys()) {
          newVirtualFund = newVirtualFund.add(condition.virtualFunds[i]);
          const expectedOdds = BigNumber.from(initialOdds[i]).mul(oddsNormalizer).div(MULTIPLIER);
          expect(await core.calcOdds(condId, 0, i)).to.be.closeTo(expectedOdds, 100);
        }

        expect(newVirtualFund).to.be.closeTo(REINFORCEMENT, 100);
      }
    });
    it("Create condition with outcomes having the hardcoded odds", async () => {
      const time = await getBlockTime(ethers);
      await createGame(lp, oracle, ++gameId, time + ONE_DAY);

      const outcomesCount = 3;
      const initialOdds = [200, 300, 600]; // [50%, 33%, 16%]

      await createCondition(core, oracle, gameId, ++condId, initialOdds, [0, 1, 2], REINFORCEMENT, 0, false);

      const condition = await core.getCondition(condId);
      let newVirtualFund = BigNumber.from(0);
      for (const i of Array(outcomesCount).keys()) {
        newVirtualFund = newVirtualFund.add(condition.virtualFunds[i]);
        const expectedOdds = BigNumber.from(initialOdds[i]).mul(1e10);
        expect(await core.calcOdds(condId, 0, i)).to.be.closeTo(expectedOdds, 100);
      }

      expect(newVirtualFund).to.be.closeTo(REINFORCEMENT, 100);
    });
    it("Change odds", async () => {
      const time = await getBlockTime(ethers);
      await createGame(lp, oracle, ++gameId, time + ONE_DAY);

      const outcomesCounts = [2, 3, 4, 10, (await core.MAX_OUTCOMES_COUNT()).toNumber()];
      outcomesCountLoop: for (const outcomesCount of outcomesCounts) {
        const outcomes = [...Array(outcomesCount).keys()];
        await createCondition(
          core,
          oracle,
          gameId,
          ++condId,
          Array(outcomesCount).fill(50_000),
          outcomes,
          REINFORCEMENT,
          0,
          false
        );

        await makeBetGetTokenIdOdds(
          lp,
          core,
          bettor,
          affiliate.address,
          condId,
          tokens(100),
          OUTCOMEWIN,
          time + ONE_DAY,
          0
        );
        const condition = await core.getCondition(condId);
        let virtualFund = BigNumber.from(0);
        for (let i = 0; i < outcomesCount; i++) {
          virtualFund = virtualFund.add(condition.virtualFunds[i]);
        }

        const newOdds = Array.from({ length: outcomesCount }, (_, i) => 1000 + i * 1000);
        await core.connect(oracle).changeOdds(condId, newOdds);

        let oddsNormalizer = BigNumber.from(0);
        for (let i = 0; i < outcomesCount; i++) {
          oddsNormalizer = oddsNormalizer.add(BigNumber.from(MULTIPLIER).mul(MULTIPLIER).div(newOdds[i]));
        }

        let newVrtualFund = BigNumber.from(0);
        for (const i of Array(outcomesCount).keys()) {
          newVrtualFund = newVrtualFund.add(condition.virtualFunds[i]);
          const expectedOdds = BigNumber.from(newOdds[i]).mul(oddsNormalizer).div(MULTIPLIER);
          expect(await core.calcOdds(condId, 0, i)).to.be.closeTo(expectedOdds, 100);
        }

        expect(newVrtualFund).to.be.closeTo(virtualFund, 100);
      }
    });
    it("Change odds after bet", async () => {
      const time = await getBlockTime(ethers);
      const betAmount = tokens(100);
      await createGame(lp, oracle, ++gameId, time + ONE_DAY);

      const outcomesCounts = [2, 3, 4, 10, (await core.MAX_OUTCOMES_COUNT()).toNumber()];
      outcomesCountLoop: for (const outcomesCount of outcomesCounts) {
        const outcomes = [...Array(outcomesCount).keys()];
        await createCondition(
          core,
          oracle,
          gameId,
          ++condId,
          Array(outcomesCount).fill(50_000),
          outcomes,
          REINFORCEMENT,
          0,
          false
        );

        const { odds } = await makeBetGetTokenIdOdds(
          lp,
          core,
          bettor,
          affiliate.address,
          condId,
          tokens(100),
          outcomes[0],
          time + ONE_DAY,
          0
        );
        const payoutDelta = odds.mul(betAmount).div(MULTIPLIER).sub(betAmount);

        const newOdds = Array.from({ length: outcomesCount }, (_, i) => 1000 + i * 1000);
        await core.connect(oracle).changeOdds(condId, newOdds);

        let oddsNormalizer = BigNumber.from(0);
        for (let i = 0; i < outcomesCount; i++) {
          oddsNormalizer = oddsNormalizer.add(BigNumber.from(MULTIPLIER).mul(MULTIPLIER).div(newOdds[i]));
        }

        const condition = await core.getCondition(condId);
        let virtualFund = BigNumber.from(0);
        for (const i of Array(outcomesCount).keys()) {
          virtualFund = virtualFund.add(condition.virtualFunds[i]);
          const expectedOdds = BigNumber.from(newOdds[i]).mul(oddsNormalizer).div(MULTIPLIER);
          expect(await core.calcOdds(condId, 0, i)).to.be.closeTo(expectedOdds, 100);
        }

        expect(virtualFund).to.be.closeTo(REINFORCEMENT.sub(payoutDelta), 100);
      }
    });
  });
  context("Betting", function () {
    it("Make common bets", async () => {
      await testEngine(
        lp,
        core,
        wxDAI,
        coreTools,
        oracle,
        bettor,
        dao,
        dataProvider,
        affiliate,
        REINFORCEMENT,
        (_, outcomes) => {
          return [
            outcomes[Math.floor(Math.random() * outcomes.length)],
            REINFORCEMENT.div(100 * outcomes.length),
            false,
          ];
        }
      );
    });
    it("Make tiny bets", async () => {
      await testEngine(
        lp,
        core,
        wxDAI,
        coreTools,
        oracle,
        bettor,
        dao,
        dataProvider,
        affiliate,
        REINFORCEMENT,
        (_, outcomes) => {
          return [outcomes[Math.floor(Math.random() * outcomes.length)], 100, false];
        }
      );
    });
    it("Make huge bets", async () => {
      await testEngine(
        lp,
        core,
        wxDAI,
        coreTools,
        oracle,
        bettor,
        dao,
        dataProvider,
        affiliate,
        REINFORCEMENT,
        (iteration, outcomes) => {
          return [outcomes[iteration % outcomes.length], REINFORCEMENT.div(outcomes.length), true];
        }
      );
    });
    it("Make bets with tiny odds", async () => {
      await testEngine(
        lp,
        core,
        wxDAI,
        coreTools,
        oracle,
        bettor,
        dao,
        dataProvider,
        affiliate,
        tokens(1),
        (_, outcomes) => {
          return [outcomes[0], REINFORCEMENT.div(outcomes.length), true];
        }
      );
    });
    it("Make bets with huge odds", async () => {
      await testEngine(
        lp,
        core,
        wxDAI,
        coreTools,
        oracle,
        bettor,
        dao,
        dataProvider,
        affiliate,
        tokens(100),
        (iteration, outcomes) => {
          if (iteration === 0) return [outcomes[0], REINFORCEMENT.div(outcomes.length)];
          else return [outcomes[1], tokens(100), true];
        }
      );
    });
    it("Make unbalanced bets", async () => {
      await testEngine(
        lp,
        core,
        wxDAI,
        coreTools,
        oracle,
        bettor,
        dao,
        dataProvider,
        affiliate,
        tokens(100),
        (iteration, outcomes) => {
          if (iteration % 2) return [outcomes[0], REINFORCEMENT.div(outcomes.length), true];
          else return [outcomes[1 + Math.floor(Math.random() * outcomes.length - 1)], 1, false];
        }
      );
    });
    it("Make random bets", async () => {
      await testEngine(
        lp,
        core,
        wxDAI,
        coreTools,
        oracle,
        bettor,
        dao,
        dataProvider,
        affiliate,
        tokens(100),
        (_, outcomes) => {
          const extraDegree = Math.floor(Math.log2(REINFORCEMENT.div(outcomes.length)));
          return [
            outcomes[Math.floor(Math.random() * outcomes.length)],
            BigNumber.from(2).pow(Math.floor(extraDegree * Math.random())),
            true,
          ];
        }
      );
    });
  });
  context("Check restrictions", function () {
    beforeEach(async function () {
      time = await getBlockTime(ethers);
      await createGame(lp, oracle, ++gameId, time + ONE_HOUR);
    });
    it("Condition MUST contain at least two outcomes", async () => {
      await expect(
        createCondition(core, oracle, gameId, ++condId, [50000], [OUTCOMEWIN], REINFORCEMENT, MARGINALITY, false)
      ).to.be.revertedWithCustomError(core, "IncorrectOutcomesCount");
      await expect(
        createCondition(core, oracle, gameId, ++condId, [], [], REINFORCEMENT, MARGINALITY, false)
      ).to.be.revertedWithCustomError(core, "IncorrectOutcomesCount");
    });
    it("The number of condition outcomes MUST NOT break the limit", async () => {
      const maxOutcomesCount = (await core.MAX_OUTCOMES_COUNT()).toNumber();
      await createCondition(
        core,
        oracle,
        gameId,
        ++condId,
        Array(maxOutcomesCount).fill(50_000),
        [...Array(maxOutcomesCount).keys()],
        REINFORCEMENT,
        MARGINALITY,
        false
      );
      await expect(
        createCondition(
          core,
          oracle,
          gameId,
          ++condId,
          Array(maxOutcomesCount + 1).fill(50_000),
          [...Array(maxOutcomesCount + 1).keys()],
          REINFORCEMENT,
          MARGINALITY,
          false
        )
      ).to.be.revertedWithCustomError(core, "IncorrectOutcomesCount");
    });
    it("The number of passed odds MUST match condition outcomes", async () => {
      await expect(
        createCondition(
          core,
          oracle,
          gameId,
          ++condId,
          [50000, 50000, 50000],
          [OUTCOMEWIN, OUTCOMESLOSE[0]],
          REINFORCEMENT,
          MARGINALITY,
          false
        )
      ).to.be.revertedWithCustomError(core, "OutcomesAndOddsCountDiffer");
      await expect(
        createCondition(
          core,
          oracle,
          gameId,
          ++condId,
          [50000],
          [OUTCOMEWIN, OUTCOMESLOSE[0]],
          REINFORCEMENT,
          MARGINALITY,
          false
        )
      ).to.be.revertedWithCustomError(core, "OutcomesAndOddsCountDiffer");

      await createCondition(
        core,
        oracle,
        gameId,
        ++condId,
        [50000, 50000],
        [OUTCOMEWIN, OUTCOMESLOSE[0]],
        REINFORCEMENT,
        MARGINALITY,
        false
      );
      await expect(core.connect(oracle).changeOdds(condId, [50000, 50000, 50000])).to.be.revertedWithCustomError(
        core,
        "OutcomesAndOddsCountDiffer"
      );
      await expect(core.connect(oracle).changeOdds(condId, [50000])).to.be.revertedWithCustomError(
        core,
        "OutcomesAndOddsCountDiffer"
      );
    });
    it("The passed odds MUST NOT be equal 0", async () => {
      await expect(
        createCondition(
          core,
          oracle,
          gameId,
          ++condId,
          [50000, 50000, 0],
          [OUTCOMEWIN, OUTCOMESLOSE[0], OUTCOMESLOSE[1]],
          REINFORCEMENT,
          MARGINALITY,
          false
        )
      ).to.be.revertedWithCustomError(core, "ZeroOdds");

      await createCondition(
        core,
        oracle,
        gameId,
        ++condId,
        [50000, 50000, 50000],
        [OUTCOMEWIN, OUTCOMESLOSE[0], OUTCOMESLOSE[1]],
        REINFORCEMENT,
        MARGINALITY,
        false
      );
      await expect(core.connect(oracle).changeOdds(condId, [50000, 50000, 0])).to.be.revertedWithCustomError(
        core,
        "ZeroOdds"
      );
    });
  });

  context("Multiplied chance test", function () {
    before(async function () {
      await lp.connect(poolOwner).changeFee(0, 0);
      await lp.connect(poolOwner).changeFee(1, 0);
      await lp.connect(poolOwner).changeFee(2, 0);
    });
    beforeEach(async function () {
      time = await getBlockTime(ethers);
      await createGame(lp, oracle, ++gameId, time + ONE_HOUR);
    });
    it("Should withdraw payout for each winning outcome", async () => {
      await core
        .connect(oracle)
        .createCondition(
          gameId,
          ++condId,
          [50000, 50000, 50000],
          [OUTCOMEWIN, OUTCOMESLOSE[0], OUTCOMESLOSE[1]],
          REINFORCEMENT,
          0,
          2,
          false
        );

      const betAmount = tokens(100);
      const res1 = await makeBetGetTokenIdOdds(
        lp,
        core,
        bettor,
        affiliate.address,
        condId,
        betAmount,
        OUTCOMEWIN,
        time + ONE_DAY,
        0
      );
      const payout1 = res1.odds.mul(betAmount).div(MULTIPLIER);

      const res2 = await makeBetGetTokenIdOdds(
        lp,
        core,
        bettor,
        affiliate.address,
        condId,
        betAmount,
        OUTCOMESLOSE[0],
        time + ONE_DAY,
        0
      );
      const payout2 = res2.odds.mul(betAmount).div(MULTIPLIER);

      const res3 = await makeBetGetTokenIdOdds(
        lp,
        core,
        bettor,
        affiliate.address,
        condId,
        betAmount,
        OUTCOMESLOSE[1],
        time + ONE_DAY,
        0
      );

      timeShift(time + ONE_HOUR + ONE_MINUTE);
      await core.connect(oracle).resolveCondition(condId, [OUTCOMEWIN, OUTCOMESLOSE[0]]);

      expect(await core.isOutcomeWinning(condId, OUTCOMEWIN)).to.be.equal(true);
      expect(await core.isOutcomeWinning(condId, OUTCOMESLOSE[0])).to.be.equal(true);
      expect(await core.isOutcomeWinning(condId, OUTCOMESLOSE[1])).to.be.equal(false);

      let balance = await wxDAI.balanceOf(bettor.address);
      await makeWithdrawPayout(lp, core, bettor, res1.tokenId);
      expect(await wxDAI.balanceOf(bettor.address)).to.be.equal(balance.add(payout1));

      balance = await wxDAI.balanceOf(bettor.address);
      await makeWithdrawPayout(lp, core, bettor, res2.tokenId);
      expect(await wxDAI.balanceOf(bettor.address)).to.be.equal(balance.add(payout2));

      balance = await wxDAI.balanceOf(bettor.address);
      await lp.withdrawPayout(core.address, res3.tokenId);
      expect(await wxDAI.balanceOf(bettor.address)).to.be.equal(balance);
    });
    it("The odds of condition with double chance should be less than of the common one", async () => {
      await core
        .connect(oracle)
        .createCondition(
          gameId,
          ++condId,
          [50000, 50000, 50000],
          [OUTCOMEWIN, OUTCOMESLOSE[0], OUTCOMESLOSE[1]],
          REINFORCEMENT,
          0,
          1,
          false
        );

      const odds = await core.calcOdds(condId, 0, OUTCOMEWIN);
      await core
        .connect(oracle)
        .createCondition(
          gameId,
          ++condId,
          [50000, 50000, 50000],
          [OUTCOMEWIN, OUTCOMESLOSE[0], OUTCOMESLOSE[1]],
          REINFORCEMENT,
          0,
          2,
          false
        );
      expect(await core.calcOdds(condId, 0, OUTCOMEWIN)).to.be.equal(odds.div(2));
    });
    it("The condition payout should be equal to the maximum sum of payouts of winning outcomes if it is larger to totalNetBets", async () => {
      const lpBefore = await lp.getReserve();
      const lockedBefore = await lp.lockedLiquidity();
      await core
        .connect(oracle)
        .createCondition(
          gameId,
          ++condId,
          [50000, 50000, 50000],
          [OUTCOMEWIN, OUTCOMESLOSE[0], OUTCOMESLOSE[1]],
          REINFORCEMENT,
          0,
          2,
          false
        );

      const betAmount = tokens(100);
      const res1 = await makeBetGetTokenIdOdds(
        lp,
        core,
        bettor,
        affiliate.address,
        condId,
        betAmount,
        OUTCOMEWIN,
        time + ONE_DAY,
        0
      );
      const payout1 = res1.odds.mul(betAmount).div(MULTIPLIER);

      const res2 = await makeBetGetTokenIdOdds(
        lp,
        core,
        bettor,
        affiliate.address,
        condId,
        betAmount,
        OUTCOMESLOSE[0],
        time + ONE_DAY,
        0
      );
      const payout2 = res2.odds.mul(betAmount).div(MULTIPLIER);

      timeShift(time + ONE_HOUR + ONE_MINUTE);
      await core.connect(oracle).resolveCondition(condId, [OUTCOMEWIN, OUTCOMESLOSE[0]]);

      expect(await lp.lockedLiquidity()).to.be.equal(lockedBefore);
      expect(await lp.getReserve()).to.be.equal(lpBefore.add(betAmount.mul(2)).sub(payout1.add(payout2)));
    });
    it("The condition payout should be equal to the total bet amount if condition is canceled", async () => {
      const lpBefore = await lp.getReserve();
      const lockedBefore = await lp.lockedLiquidity();
      await core
        .connect(oracle)
        .createCondition(
          gameId,
          ++condId,
          [50000, 50000, 50000],
          [OUTCOMEWIN, OUTCOMESLOSE[0], OUTCOMESLOSE[1]],
          REINFORCEMENT,
          0,
          2,
          false
        );

      const betAmount = tokens(100);
      await makeBetGetTokenIdOdds(
        lp,
        core,
        bettor,
        affiliate.address,
        condId,
        betAmount,
        OUTCOMEWIN,
        time + ONE_DAY,
        0
      );

      await makeBetGetTokenIdOdds(
        lp,
        core,
        bettor,
        affiliate.address,
        condId,
        betAmount,
        OUTCOMESLOSE[0],
        time + ONE_DAY,
        0
      );

      await core.connect(oracle).cancelCondition(condId);

      expect(await core.isOutcomeWinning(condId, OUTCOMEWIN)).to.be.equal(false);
      expect(await core.isOutcomeWinning(condId, OUTCOMESLOSE[0])).to.be.equal(false);
      expect(await core.isOutcomeWinning(condId, OUTCOMESLOSE[1])).to.be.equal(false);

      expect(await lp.lockedLiquidity()).to.be.equal(lockedBefore);
      expect(await lp.getReserve()).to.be.equal(lpBefore);
    });
    it("The locked liquidity amount should be equal to the worst of the possible losses under this condition", async () => {
      const lpBefore = await lp.getReserve();
      const lockedBefore = await lp.lockedLiquidity();
      await core
        .connect(oracle)
        .createCondition(
          gameId,
          ++condId,
          [50000, 50000, 50000],
          [OUTCOMEWIN, OUTCOMESLOSE[0], OUTCOMESLOSE[1]],
          REINFORCEMENT,
          0,
          2,
          false
        );

      const betAmount1 = tokens(200);
      const res1 = await makeBetGetTokenIdOdds(
        lp,
        core,
        bettor,
        affiliate.address,
        condId,
        betAmount1,
        OUTCOMEWIN,
        time + ONE_DAY,
        0
      );
      const payout1 = res1.odds.mul(betAmount1).div(MULTIPLIER);

      const betAmount2 = tokens(50);
      const res2 = await makeBetGetTokenIdOdds(
        lp,
        core,
        bettor,
        affiliate.address,
        condId,
        betAmount2,
        OUTCOMESLOSE[0],
        time + ONE_DAY,
        0
      );
      const payout2 = res2.odds.mul(betAmount2).div(MULTIPLIER);

      const betAmount3 = tokens(200);
      const res3 = await makeBetGetTokenIdOdds(
        lp,
        core,
        bettor,
        affiliate.address,
        condId,
        betAmount3,
        OUTCOMESLOSE[1],
        time + ONE_DAY,
        0
      );
      const payout3 = res3.odds.mul(betAmount3).div(MULTIPLIER);

      expect(await lp.lockedLiquidity()).to.be.equal(
        lockedBefore.add(payout1).add(payout3).sub(betAmount1.add(betAmount2).add(betAmount3))
      );

      const betAmount4 = tokens(200);
      const res4 = await makeBetGetTokenIdOdds(
        lp,
        core,
        bettor,
        affiliate.address,
        condId,
        betAmount4,
        OUTCOMESLOSE[0],
        time + ONE_DAY,
        0
      );
      const payout4 = res4.odds.mul(betAmount4).div(MULTIPLIER);
      expect(await lp.lockedLiquidity()).to.be.equal(
        lockedBefore.add(
          payout2.add(payout3).add(payout4).sub(betAmount1.add(betAmount2).add(betAmount3).add(betAmount4))
        )
      );

      timeShift(time + ONE_HOUR + ONE_MINUTE);
      await core.connect(oracle).resolveCondition(condId, [OUTCOMEWIN, OUTCOMESLOSE[0]]);

      expect(await core.isOutcomeWinning(condId, OUTCOMEWIN)).to.be.equal(true);
      expect(await core.isOutcomeWinning(condId, OUTCOMESLOSE[0])).to.be.equal(true);
      expect(await core.isOutcomeWinning(condId, OUTCOMESLOSE[1])).to.be.equal(false);

      expect(await lp.lockedLiquidity()).to.be.equal(lockedBefore);
      expect(await lp.getReserve()).to.be.equal(
        lpBefore.sub(payout2.add(payout1).add(payout4).sub(betAmount1.add(betAmount2).add(betAmount3).add(betAmount4)))
      );
    });
    it("The locked liquidity amount should be equal to 0 if the worst of the possible losses under this condition less or equal to 0", async () => {
      const lpBefore = await lp.getReserve();
      const lockedBefore = await lp.lockedLiquidity();
      await core
        .connect(oracle)
        .createCondition(
          gameId,
          ++condId,
          [50000, 50000, 50000],
          [OUTCOMEWIN, OUTCOMESLOSE[0], OUTCOMESLOSE[1]],
          REINFORCEMENT,
          MARGINALITY,
          2,
          false
        );

      const betAmount = tokens(100);
      const res1 = await makeBetGetTokenIdOdds(
        lp,
        core,
        bettor,
        affiliate.address,
        condId,
        betAmount,
        OUTCOMEWIN,
        time + ONE_DAY,
        0
      );
      const payout1 = res1.odds.mul(betAmount).div(MULTIPLIER);

      const res2 = await makeBetGetTokenIdOdds(
        lp,
        core,
        bettor,
        affiliate.address,
        condId,
        betAmount,
        OUTCOMESLOSE[0],
        time + ONE_DAY,
        0
      );
      const payout2 = res2.odds.mul(betAmount).div(MULTIPLIER);

      await makeBetGetTokenIdOdds(
        lp,
        core,
        bettor,
        affiliate.address,
        condId,
        betAmount,
        OUTCOMESLOSE[1],
        time + ONE_DAY,
        0
      );

      expect(await lp.lockedLiquidity()).to.be.equal(lockedBefore);

      timeShift(time + ONE_HOUR + ONE_MINUTE);
      await core.connect(oracle).resolveCondition(condId, [OUTCOMEWIN, OUTCOMESLOSE[0]]);

      expect(await core.isOutcomeWinning(condId, OUTCOMEWIN)).to.be.equal(true);
      expect(await core.isOutcomeWinning(condId, OUTCOMESLOSE[0])).to.be.equal(true);
      expect(await core.isOutcomeWinning(condId, OUTCOMESLOSE[1])).to.be.equal(false);

      expect(await lp.lockedLiquidity()).to.be.equal(lockedBefore);
      expect(await lp.getReserve()).to.be.equal(lpBefore.add(betAmount.mul(3)).sub(payout1.add(payout2)));
    });
    it("The condition fund should be equal to the worst of the possible after odds changing", async () => {
      const lpBefore = await lp.getReserve();
      const lockedBefore = await lp.lockedLiquidity();
      await core
        .connect(oracle)
        .createCondition(
          gameId,
          ++condId,
          [50000, 50000, 50000],
          [OUTCOMEWIN, OUTCOMESLOSE[0], OUTCOMESLOSE[1]],
          REINFORCEMENT,
          0,
          2,
          false
        );

      const betAmount1 = tokens(200);
      const res1 = await makeBetGetTokenIdOdds(
        lp,
        core,
        bettor,
        affiliate.address,
        condId,
        betAmount1,
        OUTCOMEWIN,
        time + ONE_DAY,
        0
      );
      const payout1 = res1.odds.mul(betAmount1).div(MULTIPLIER);

      const betAmount2 = tokens(50);
      const res2 = await makeBetGetTokenIdOdds(
        lp,
        core,
        bettor,
        affiliate.address,
        condId,
        betAmount2,
        OUTCOMESLOSE[0],
        time + ONE_DAY,
        0
      );
      const payout2 = res2.odds.mul(betAmount2).div(MULTIPLIER);

      const betAmount3 = tokens(200);
      const res3 = await makeBetGetTokenIdOdds(
        lp,
        core,
        bettor,
        affiliate.address,
        condId,
        betAmount3,
        OUTCOMESLOSE[1],
        time + ONE_DAY,
        0
      );
      const payout3 = res3.odds.mul(betAmount3).div(MULTIPLIER);

      await core.connect(oracle).changeOdds(condId, [50000, 50000, 50000]);

      let condition = await core.getCondition(condId);
      let virtualFund = BigNumber.from(0);
      for (const i of Array(3).keys()) {
        virtualFund = virtualFund.add(condition.virtualFunds[i]);
      }
      expect(virtualFund).to.be.closeTo(
        REINFORCEMENT.add(betAmount1.add(betAmount2).add(betAmount3)).sub(payout1.add(payout3)),
        10
      );

      const betAmount4 = tokens(200);
      const res4 = await makeBetGetTokenIdOdds(
        lp,
        core,
        bettor,
        affiliate.address,
        condId,
        betAmount4,
        OUTCOMESLOSE[0],
        time + ONE_DAY,
        0
      );
      const payout4 = res4.odds.mul(betAmount4).div(MULTIPLIER);

      await core.connect(oracle).changeOdds(condId, [50000, 50000, 50000]);

      condition = await core.getCondition(condId);
      virtualFund = BigNumber.from(0);
      for (const i of Array(3).keys()) {
        virtualFund = virtualFund.add(condition.virtualFunds[i]);
      }
      expect(virtualFund).to.be.closeTo(
        REINFORCEMENT.add(betAmount1.add(betAmount2).add(betAmount3).add(betAmount4)).sub(
          payout3.add(payout4).add(payout2)
        ),
        10
      );

      timeShift(time + ONE_HOUR + ONE_MINUTE);
      await core.connect(oracle).resolveCondition(condId, [OUTCOMEWIN, OUTCOMESLOSE[0]]);

      expect(await core.isOutcomeWinning(condId, OUTCOMEWIN)).to.be.equal(true);
      expect(await core.isOutcomeWinning(condId, OUTCOMESLOSE[0])).to.be.equal(true);
      expect(await core.isOutcomeWinning(condId, OUTCOMESLOSE[1])).to.be.equal(false);

      expect(await lp.lockedLiquidity()).to.be.equal(lockedBefore);
      expect(await lp.getReserve()).to.be.equal(
        lpBefore.sub(payout2.add(payout1).add(payout4).sub(betAmount1.add(betAmount2).add(betAmount3).add(betAmount4)))
      );
    });
    context("Check restrictions", function () {
      it("A condition CANNOT have the number of winning outcomes greater than or equal to the total number of its outcomes", async () => {
        await expect(
          core
            .connect(oracle)
            .createCondition(
              gameId,
              ++condId,
              [50000, 50000, 50000],
              [OUTCOMEWIN, OUTCOMESLOSE[0], OUTCOMESLOSE[1]],
              REINFORCEMENT,
              MARGINALITY,
              4,
              false
            )
        ).to.be.revertedWithCustomError(core, "IncorrectWinningOutcomesCount");
        await expect(
          core
            .connect(oracle)
            .createCondition(
              gameId,
              ++condId,
              [50000, 50000, 50000],
              [OUTCOMEWIN, OUTCOMESLOSE[0], OUTCOMESLOSE[1]],
              REINFORCEMENT,
              MARGINALITY,
              3,
              false
            )
        ).to.be.revertedWithCustomError(core, "IncorrectWinningOutcomesCount");
      });
      it("The number of passed winning outcomes SHOULD match the count of winning outcomes for the condition", async () => {
        await core
          .connect(oracle)
          .createCondition(
            gameId,
            ++condId,
            [50000, 50000, 50000, 50000],
            [OUTCOMEWIN, OUTCOMESLOSE[0], OUTCOMESLOSE[1], OUTCOMESLOSE[2]],
            REINFORCEMENT,
            MARGINALITY,
            2,
            false
          );
        await expect(core.connect(oracle).resolveCondition(condId, [OUTCOMEWIN])).to.be.revertedWithCustomError(
          core,
          "IncorrectWinningOutcomesCount"
        );
        await expect(
          core.connect(oracle).resolveCondition(condId, [OUTCOMEWIN, OUTCOMESLOSE[0], OUTCOMESLOSE[1]])
        ).to.be.revertedWithCustomError(core, "IncorrectWinningOutcomesCount");
      });
      it("The probability of an outcome CANNOT become larger than 100% through changing odds", async () => {
        await core
          .connect(oracle)
          .createCondition(
            gameId,
            ++condId,
            [50000, 50000, 50000],
            [OUTCOMEWIN, OUTCOMESLOSE[0], OUTCOMESLOSE[1]],
            REINFORCEMENT,
            0,
            2,
            false
          );
        await expect(core.connect(oracle).changeOdds(condId, [15000, 30000, 30000])).to.be.revertedWithCustomError(
          core,
          "IncorrectOdds"
        );
        await core.connect(oracle).changeOdds(condId, [15001, 30000, 30000]);

        await core
          .connect(oracle)
          .createCondition(
            gameId,
            ++condId,
            [50000, 50000, 50000, 50000],
            [OUTCOMEWIN, OUTCOMESLOSE[0], OUTCOMESLOSE[1], OUTCOMESLOSE[2]],
            REINFORCEMENT,
            0,
            2,
            false
          );
        await expect(
          core.connect(oracle).changeOdds(condId, [15000, 45000, 45000, 45000])
        ).to.be.revertedWithCustomError(core, "IncorrectOdds");
        await core.connect(oracle).changeOdds(condId, [15001, 45000, 45000, 45000]);
      });
      it("The probability of an outcome CANNOT become larger than 100% through making bets with margin", async () => {
        await core
          .connect(oracle)
          .createCondition(
            gameId,
            ++condId,
            [15001, 30000, 30000],
            [OUTCOMEWIN, OUTCOMESLOSE[0], OUTCOMESLOSE[1]],
            REINFORCEMENT,
            MARGINALITY,
            2,
            false
          );

        await expect(
          makeBetGetTokenIdOdds(lp, core, bettor, affiliate.address, condId, tokens(100), OUTCOMEWIN, time + ONE_DAY, 0)
        ).to.be.revertedWithCustomError(core, "IncorrectOdds");
      });
      it("The probability of an outcome CANNOT become larger than 100% through making bets without margin", async () => {
        await core
          .connect(oracle)
          .createCondition(
            gameId,
            ++condId,
            [15001, 30000, 30000],
            [OUTCOMEWIN, OUTCOMESLOSE[0], OUTCOMESLOSE[1]],
            REINFORCEMENT,
            0,
            2,
            false
          );

        await expect(
          makeBetGetTokenIdOdds(lp, core, bettor, affiliate.address, condId, tokens(100), OUTCOMEWIN, time + ONE_DAY, 0)
        ).to.be.revertedWithCustomError(core, "IncorrectOdds");
      });
    });
  });
});
