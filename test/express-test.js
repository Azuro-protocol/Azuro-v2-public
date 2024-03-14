const { expect } = require("chai");
const { constants, BigNumber } = require("ethers");
const { ethers } = require("hardhat");
const { MULTIPLIER, ITERATIONS } = require("../utils/constants");
const {
  getBlockTime,
  tokens,
  prepareStand,
  createCondition,
  timeShiftBy,
  createGame,
  initFixtureTree,
  grantRole,
  prepareAccess,
  getPluggedCore,
  changeReinforcementAbility,
} = require("../utils/utils");

const LIQUIDITY = tokens(2000000);
const ONE_WEEK = 604800;
const ONE_HOUR = 3600;

const OUTCOMEWIN = 1;
const OUTCOMELOSE = 2;
const OUTCOMES = [OUTCOMEWIN, OUTCOMELOSE];

describe("BetExpress tests", function () {
  const wrapLayer = initFixtureTree(ethers.provider);

  let factoryOwner, poolOwner, dataProvider, bettor1, oracle, oracle2, maintainer, bettor2, bettor3, affiliate;
  let factory, core, wxDAI, lp, betExpress, coreTools, access, roleIds;
  let now;
  let oracleGameId = 0;

  const reinforcement = constants.WeiPerEther.mul(20000);
  const marginality = BigNumber.from(MULTIPLIER * 0.05); // 5%
  const maxSandboxShare = MULTIPLIER * 0.2; // 20%

  let subBet1, subBet2, subBet3;
  let oracleCondId;

  const minDepo = tokens(10);
  const daoFee = MULTIPLIER * 0.09; // 9%
  const oracleFee = MULTIPLIER * 0.01; // 1%
  const affiliateFee = MULTIPLIER * 0.6; // 60%

  async function deployAndInit() {
    [factoryOwner, poolOwner, dataProvider, bettor1, oracle, oracle2, maintainer, bettor2, bettor3, affiliate] =
      await ethers.getSigners();

    ({ factory, core, wxDAI, lp, _, access, roleIds } = await prepareStand(
      ethers,
      factoryOwner,
      poolOwner,
      dataProvider,
      affiliate,
      bettor1,
      minDepo,
      daoFee,
      oracleFee,
      affiliateFee,
      LIQUIDITY
    ));

    const LibraryMock = await ethers.getContractFactory("LibraryMock");
    coreTools = await LibraryMock.deploy();
    await coreTools.deployed();

    now = await getBlockTime(ethers);
    oracleCondId = 13253453;

    subBet1 = {
      conditionId: oracleCondId,
      outcomeId: OUTCOMEWIN,
    };
    subBet2 = {
      conditionId: oracleCondId + 1,
      outcomeId: OUTCOMEWIN,
    };
    subBet3 = {
      conditionId: oracleCondId + 2,
      outcomeId: OUTCOMEWIN,
    };

    const BetExpress = await ethers.getContractFactory("BetExpress", {
      signer: factoryOwner,
    });
    const beaconExpress = await upgrades.deployBeacon(BetExpress);
    await beaconExpress.deployed();

    await factory.connect(factoryOwner).updateCoreType("express", beaconExpress.address, ethers.constants.AddressZero);
    const plugTx = await factory.connect(poolOwner).plugExpress(lp.address, core.address, "express");

    betExpress = await BetExpress.attach(await getPluggedCore(plugTx));

    await changeReinforcementAbility(lp, betExpress, poolOwner, maxSandboxShare);
    await betExpress.connect(poolOwner).changeReinforcement(reinforcement);

    await prepareAccess(access, poolOwner, oracle.address, oracle2.address, maintainer.address, roleIds);
    await grantRole(access, poolOwner, betExpress.address, roleIds.oddsManager);

    await factoryOwner.sendTransaction({ to: wxDAI.address, value: tokens(8_000_000) });

    await createGame(lp, oracle, ++oracleGameId, now + ONE_HOUR);
    await createGame(lp, oracle, ++oracleGameId, now + ONE_HOUR);
    await createGame(lp, oracle, ++oracleGameId, now + ONE_HOUR);

    await createCondition(
      core,
      oracle,
      oracleGameId - 2,
      oracleCondId,
      [1, 1],
      OUTCOMES,
      reinforcement,
      marginality,
      false
    );
    await createCondition(
      core,
      oracle,
      oracleGameId - 1,
      ++oracleCondId,
      [3, 2],
      OUTCOMES,
      reinforcement,
      marginality,
      false
    );
    await createCondition(
      core,
      oracle,
      oracleGameId,
      ++oracleCondId,
      [1, 4],
      OUTCOMES,
      reinforcement,
      marginality,
      false
    );
  }

  wrapLayer(deployAndInit);

  it("Can't accept express bet that contains similar gameIds or conditionIds in subbets", async () => {
    const amount = tokens(1000);

    const subBets = ethers.utils.defaultAbiCoder.encode(
      ["tuple(uint256 conditionId, uint64 outcomeId)[]"],
      [[subBet1, subBet2, subBet2]] // same condition (thus, same game)
    );

    await expect(
      lp.connect(bettor1).bet(betExpress.address, amount, now + ONE_WEEK, [affiliate.address, 0, subBets])
    ).to.be.revertedWithCustomError(betExpress, "SameGameIdsNotAllowed");

    await createCondition(
      core,
      oracle,
      oracleGameId,
      oracleCondId + 1,
      [1, 2],
      OUTCOMES,
      reinforcement,
      marginality,
      false
    );
    const subBet4 = {
      conditionId: oracleCondId + 1,
      outcomeId: OUTCOMEWIN,
    };

    const subBets2 = ethers.utils.defaultAbiCoder.encode(
      ["tuple(uint256 conditionId, uint64 outcomeId)[]"],
      [[subBet1, subBet2, subBet3, subBet4]] // same game
    );

    await expect(
      lp.connect(bettor1).bet(betExpress.address, amount, now + ONE_WEEK, [affiliate.address, 0, subBets2])
    ).to.be.revertedWithCustomError(betExpress, "SameGameIdsNotAllowed");
  });

  it("Can't resolve nonexistent express bet", async () => {
    await expect(lp.connect(bettor1).withdrawPayout(betExpress.address, 1)).to.be.revertedWith(
      "ERC721: invalid token ID"
    );

    await expect(lp.connect(bettor1).viewPayout(betExpress.address, 1)).to.be.revertedWithCustomError(
      betExpress,
      "BetNotExists"
    );

    await expect(betExpress.calcPayout(1)).to.be.revertedWithCustomError(betExpress, "BetNotExists");
  });

  it("Can't change the maximum odds to a value that is smaller than one", async () => {
    await expect(betExpress.connect(poolOwner).changeMaxOdds(MULTIPLIER - 1)).to.be.revertedWithCustomError(
      betExpress,
      "IncorrectMaxOdds"
    );
    await betExpress.connect(poolOwner).changeMaxOdds(MULTIPLIER);
  });

  it("Can't make bet if condition doesn't exist", async () => {
    const amount = tokens(1000);

    const subBet4 = {
      conditionId: oracleCondId + 1,
      outcomeId: OUTCOMEWIN,
    };

    const subBets = ethers.utils.defaultAbiCoder.encode(
      ["tuple(uint256 conditionId, uint64 outcomeId)[]"],
      [[subBet1, subBet2, subBet3, subBet4]]
    );

    await expect(lp.connect(bettor1).bet(betExpress.address, amount, now + ONE_WEEK, [affiliate.address, 0, subBets]))
      .to.be.revertedWithCustomError(betExpress, "ConditionNotRunning")
      .withArgs(oracleCondId + 1);
  });

  it("Can't make bet on a condition which game is canceled", async () => {
    await lp.connect(oracle).cancelGame(oracleGameId);
    const subBets2 = ethers.utils.defaultAbiCoder.encode(
      ["tuple(uint256 conditionId, uint64 outcomeId)[]"],
      [[subBet1, subBet2, subBet3]]
    );

    await expect(
      lp.connect(bettor1).bet(betExpress.address, tokens(1000), now + ONE_WEEK, [affiliate.address, 0, subBets2])
    )
      .to.be.revertedWithCustomError(betExpress, "ConditionNotRunning")
      .withArgs(oracleCondId);
  });

  it("Can't make bet with only one subbet", async () => {
    const subBets2 = ethers.utils.defaultAbiCoder.encode(
      ["tuple(uint256 conditionId, uint64 outcomeId)[]"],
      [[subBet1]]
    );

    await expect(
      lp.connect(bettor1).bet(betExpress.address, tokens(1000), now + ONE_WEEK, [affiliate.address, 0, subBets2])
    ).to.be.revertedWithCustomError(betExpress, "TooFewSubbets");
  });

  it("Can't make bet on a canceled condition", async () => {
    await core.connect(oracle).cancelCondition(oracleCondId);

    const subBets2 = ethers.utils.defaultAbiCoder.encode(
      ["tuple(uint256 conditionId, uint64 outcomeId)[]"],
      [[subBet1, subBet2, subBet3]]
    );

    await expect(
      lp.connect(bettor1).bet(betExpress.address, tokens(1000), now + ONE_WEEK, [affiliate.address, 0, subBets2])
    )
      .to.be.revertedWithCustomError(betExpress, "ConditionNotRunning")
      .withArgs(oracleCondId);
  });

  it("Can't make bet with condition not for express", async () => {
    await createGame(lp, oracle, oracleGameId + 1, now + ONE_HOUR);
    await createCondition(
      core,
      oracle,
      oracleGameId + 1,
      oracleCondId + 1,
      [1, 4],
      OUTCOMES,
      reinforcement,
      marginality,
      true
    );
    let subBet4 = {
      conditionId: oracleCondId + 1,
      outcomeId: OUTCOMEWIN,
    };

    const subBets2 = ethers.utils.defaultAbiCoder.encode(
      ["tuple(uint256 conditionId, uint64 outcomeId)[]"],
      [[subBet1, subBet2, subBet3, subBet4]]
    );

    await expect(
      lp.connect(bettor1).bet(betExpress.address, tokens(1000), now + ONE_WEEK, [affiliate.address, 0, subBets2])
    ).to.be.revertedWithCustomError(betExpress, "ConditionNotForExpress");
  });

  it("Can't make bet on a stopped condition", async () => {
    await core.connect(maintainer).stopCondition(oracleCondId, true);

    const subBets2 = ethers.utils.defaultAbiCoder.encode(
      ["tuple(uint256 conditionId, uint64 outcomeId)[]"],
      [[subBet1, subBet2, subBet3]]
    );

    await expect(
      lp.connect(bettor1).bet(betExpress.address, tokens(1000), now + ONE_WEEK, [affiliate.address, 0, subBets2])
    )
      .to.be.revertedWithCustomError(betExpress, "ConditionNotRunning")
      .withArgs(oracleCondId);
  });

  it("Can't make bet on a resolved condition", async () => {
    await timeShiftBy(ethers, ONE_HOUR + ONE_HOUR);
    await core.connect(oracle).resolveCondition(oracleCondId - 2, [OUTCOMEWIN]);

    const subBets2 = ethers.utils.defaultAbiCoder.encode(
      ["tuple(uint256 conditionId, uint64 outcomeId)[]"],
      [[subBet1, subBet2, subBet3]]
    );

    await expect(
      lp.connect(bettor1).bet(betExpress.address, tokens(1000), now + ONE_WEEK, [affiliate.address, 0, subBets2])
    )
      .to.be.revertedWithCustomError(betExpress, "ConditionNotRunning")
      .withArgs(oracleCondId - 2);
  });

  it("Сan't make a bet if the reinforcement limit for one sub-bet condition is exceeded.", async () => {
    let amount = tokens(1000);
    let subBets = ethers.utils.defaultAbiCoder.encode(
      ["tuple(uint256 conditionId, uint64 outcomeId)[]"],
      [[subBet1, subBet2, subBet3]]
    );

    const { conditionOdds } = await betExpress.calcOdds([subBet1, subBet2, subBet3], amount);
    await betExpress
      .connect(poolOwner)
      .changeReinforcement(conditionOdds[1].sub(MULTIPLIER).mul(amount).div(MULTIPLIER).div(2));

    await expect(lp.connect(bettor1).bet(betExpress.address, amount, now + ONE_WEEK, [affiliate.address, 0, subBets]))
      .to.be.revertedWithCustomError(betExpress, "TooLargeReinforcement")
      .withArgs(subBet1.conditionId);

    amount = tokens(200);
    subBets = ethers.utils.defaultAbiCoder.encode(
      ["tuple(uint256 conditionId, uint64 outcomeId)[]"],
      [[subBet1, subBet2]]
    );
    await lp.connect(bettor1).bet(betExpress.address, amount, now + ONE_WEEK, [affiliate.address, 0, subBets]);

    subBets = ethers.utils.defaultAbiCoder.encode(
      ["tuple(uint256 conditionId, uint64 outcomeId)[]"],
      [[subBet3, subBet2]]
    );
    await expect(lp.connect(bettor1).bet(betExpress.address, amount, now + ONE_WEEK, [affiliate.address, 0, subBets]))
      .to.be.revertedWithCustomError(betExpress, "TooLargeReinforcement")
      .withArgs(subBet2.conditionId);

    await createGame(lp, oracle, oracleGameId + 1, now + ONE_HOUR);
    await createCondition(
      core,
      oracle,
      oracleGameId + 1,
      oracleCondId + 1,
      [1, 2],
      OUTCOMES,
      reinforcement,
      marginality,
      false
    );
    const subBet4 = {
      conditionId: oracleCondId + 1,
      outcomeId: OUTCOMEWIN,
    };
    subBets = ethers.utils.defaultAbiCoder.encode(
      ["tuple(uint256 conditionId, uint64 outcomeId)[]"],
      [[subBet3, subBet4]]
    );
    await lp.connect(bettor1).bet(betExpress.address, amount, now + ONE_WEEK, [affiliate.address, 0, subBets]);
  });

  it("Can't make a bet if resulting odds is smaller than passed minimum odds", async () => {
    const amount = tokens(100);
    const { expressOdds } = await betExpress.calcOdds([subBet1, subBet2, subBet3], amount);
    let subBets = ethers.utils.defaultAbiCoder.encode(
      ["tuple(uint256 conditionId, uint64 outcomeId)[]"],
      [[subBet1, subBet2, subBet3]]
    );

    await expect(
      lp
        .connect(bettor1)
        .bet(betExpress.address, amount, now + ONE_WEEK, [affiliate.address, expressOdds.add(1), subBets])
    ).to.be.revertedWithCustomError(betExpress, "SmallOdds");

    subBets = ethers.utils.defaultAbiCoder.encode(
      ["tuple(uint256 conditionId, uint64 outcomeId)[]"],
      [[subBet1, subBet2, subBet3]]
    );

    await lp
      .connect(bettor1)
      .bet(betExpress.address, amount, now + ONE_WEEK, [affiliate.address, expressOdds, subBets]);
  });

  it("Can't make a bet if resulting odds exceeds the maximum odds limit", async () => {
    const amount = tokens(100);
    const { expressOdds } = await betExpress.calcOdds([subBet1, subBet2, subBet3], amount);
    let subBets = ethers.utils.defaultAbiCoder.encode(
      ["tuple(uint256 conditionId, uint64 outcomeId)[]"],
      [[subBet1, subBet2, subBet3]]
    );

    await betExpress.connect(poolOwner).changeMaxOdds(expressOdds.sub(1));
    await expect(
      lp.connect(bettor1).bet(betExpress.address, amount, now + ONE_WEEK, [affiliate.address, 0, subBets])
    ).to.be.revertedWithCustomError(betExpress, "LargeOdds");

    await betExpress.connect(poolOwner).changeMaxOdds(expressOdds);
    await lp.connect(bettor1).bet(betExpress.address, amount, now + ONE_WEEK, [affiliate.address, 0, subBets]);
  });

  it("Check calculations", async () => {
    const pools = [
      [1, 1],
      [3, 2],
      [1, 10],
    ];
    const marginalities = [marginality, marginality.div(2), marginality.div(3)];
    const subBets = [];
    for (const i of Array(3).keys()) {
      const conditionId = oracleCondId + i + 1;
      await createCondition(
        core,
        oracle,
        oracleGameId - i,
        conditionId,
        pools[i],
        OUTCOMES,
        reinforcement,
        marginalities[i],
        false
      );
      subBets[i] = {
        conditionId: conditionId,
        outcomeId: OUTCOMEWIN,
      };
    }

    const amount = tokens(100);
    const conditions = [];
    const reinforcements = [];
    let expectedExpressOdds = BigNumber.from(MULTIPLIER);
    let oddsSum = BigNumber.from(0);
    for (const i of subBets.keys()) {
      const condition = await core.getCondition(subBets[i].conditionId);
      const outcomeIndex = subBets[i].outcomeId - 1;
      const odds = (await coreTools.calcOdds(condition.virtualFunds, 0, 1))[outcomeIndex];
      conditions[i] = condition;
      reinforcements[i] = await betExpress.lockedReserves(subBets[i].conditionId);
      expectedExpressOdds = expectedExpressOdds.mul(odds).div(MULTIPLIER);
      oddsSum = oddsSum.add(odds);
    }

    const expectedConditionOdds = [];
    const subBetAmount = expectedExpressOdds
      .sub(MULTIPLIER)
      .mul(amount)
      .div(oddsSum.sub(MULTIPLIER * subBets.length));
    expectedExpressOdds = BigNumber.from(MULTIPLIER);
    oddsSum = BigNumber.from(0);
    for (const i of subBets.keys()) {
      const virtualFunds = [];
      for (const virtualFund of conditions[i].virtualFunds) {
        virtualFunds.push(virtualFund);
      }

      const outcomeIndex = subBets[i].outcomeId - 1;
      virtualFunds[outcomeIndex] = virtualFunds[outcomeIndex].add(subBetAmount);

      const odds = (await coreTools.calcOdds(virtualFunds, conditions[i].margin, 1))[outcomeIndex];
      expectedExpressOdds = expectedExpressOdds.mul(odds).div(MULTIPLIER);
      oddsSum = oddsSum.add(odds);
      expectedConditionOdds[i] = odds;
    }

    const subBets_ = ethers.utils.defaultAbiCoder.encode(["tuple(uint256 conditionId, uint64 outcomeId)[]"], [subBets]);
    const { conditionOdds, expressOdds } = await betExpress.calcOdds(subBets, amount);
    await lp.connect(bettor1).bet(betExpress.address, amount, now + ONE_WEEK, [affiliate.address, 0, subBets_]);

    const newBet = await betExpress.getBet(1);
    expect(expressOdds).to.be.equal(expectedExpressOdds);
    expect(newBet.odds).to.be.equal(expressOdds);

    const deltaPayout = newBet.odds.mul(amount).div(MULTIPLIER).sub(amount);
    for (const i of subBets.keys()) {
      expect(conditionOdds[i]).to.be.equal(expectedConditionOdds[i]);
      expect(newBet.conditionOdds[i]).to.be.equal(conditionOdds[i]);
      expect(await betExpress.lockedReserves(subBets[i].conditionId)).to.be.equal(
        reinforcements[i].add(
          deltaPayout.mul(expectedConditionOdds[i].sub(MULTIPLIER)).div(oddsSum.sub(MULTIPLIER * subBets.length))
        )
      );
    }
  });

  it("Should emit correct margin of the express bet", async function () {
    const amount = tokens(100);
    const subBets = ethers.utils.defaultAbiCoder.encode(
      ["tuple(uint256 conditionId, uint64 outcomeId)[]"],
      [[subBet1, subBet2, subBet3]]
    );

    let clearOddsSum = BigNumber.from(0);
    let clearExpressOdds = BigNumber.from(MULTIPLIER);
    for (const subBet of [subBet1, subBet2, subBet3]) {
      const condition = await core.getCondition(subBet.conditionId);
      const outcomeIndex = subBet.outcomeId - 1;
      const odds = (await coreTools.calcOdds(condition.virtualFunds, 0, 1))[outcomeIndex];

      clearOddsSum = clearOddsSum.add(odds);
      clearExpressOdds = clearExpressOdds.mul(odds).div(MULTIPLIER);
    }

    const subBetAmount = clearExpressOdds
      .sub(MULTIPLIER)
      .mul(amount)
      .div(clearOddsSum.sub(3 * MULTIPLIER));

    const expectedBetMargins = [];
    for (const subBet of [subBet1, subBet2, subBet3]) {
      const condition = await core.getCondition(subBet.conditionId);
      const virtualFunds = [];
      for (const virtualFund of condition.virtualFunds) {
        virtualFunds.push(virtualFund);
      }

      const outcomeIndex = subBet.outcomeId - 1;
      const clearOdds = (await coreTools.calcOdds(virtualFunds, 0, 1))[outcomeIndex];

      virtualFunds[outcomeIndex] = virtualFunds[outcomeIndex].add(subBetAmount);
      const odds = (await coreTools.calcOdds(virtualFunds, condition.margin, 1))[outcomeIndex];

      expectedBetMargins.push(BigNumber.from(MULTIPLIER).sub(odds.mul(MULTIPLIER).div(clearOdds)));
    }

    const txBet = await lp
      .connect(bettor1)
      .bet(betExpress.address, amount, now + ONE_WEEK, [affiliate.address, 0, subBets]);
    const receipt = await txBet.wait();
    const iface = new ethers.utils.Interface(
      betExpress.interface.format(ethers.utils.FormatTypes.full).filter((x) => {
        return x.includes("NewBetMargins");
      })
    );

    const log = iface.parseLog(receipt.logs[5]);
    const betMargins = log.args.margins;
    for (const i of Array(betMargins.length).keys()) {
      expect(betMargins[i]).to.be.equal(expectedBetMargins[i]);
    }
  });

  context("Express bet with 3 subbets", () => {
    let newBet;
    let lpBefore, lockedBefore, balanceBefore, balanceDaoBefore, balanceDataProviderBefore;

    beforeEach(async () => {
      lpBefore = await lp.getReserve();
      balanceBefore = await wxDAI.balanceOf(bettor1.address);
      balanceDaoBefore = await wxDAI.balanceOf(factoryOwner.address);
      balanceDataProviderBefore = await wxDAI.balanceOf(dataProvider.address);

      await timeShiftBy(ethers, ONE_HOUR + ONE_HOUR);
    });

    async function putExpressBet() {
      lockedBefore = await lp.lockedLiquidity();

      const amount = tokens(1000);

      const subBets = ethers.utils.defaultAbiCoder.encode(
        ["tuple(uint256 conditionId, uint64 outcomeId)[]"],
        [[subBet1, subBet2, subBet3]]
      );

      await lp.connect(bettor1).bet(betExpress.address, amount, now + ONE_WEEK, [affiliate.address, 0, subBets]);
      newBet = await betExpress.getBet(1);
    }

    wrapLayer(putExpressBet);

    it("Bettor wins if all subbets win and takes all payout", async () => {
      const balanceBefore = await wxDAI.balanceOf(bettor1.address);
      const balanceDaoBefore = await wxDAI.balanceOf(factoryOwner.address);
      const balanceDataProviderBefore = await wxDAI.balanceOf(dataProvider.address);

      await core.connect(oracle).resolveCondition(oracleCondId - 2, [OUTCOMEWIN]);
      await core.connect(oracle).resolveCondition(oracleCondId - 1, [OUTCOMEWIN]);
      await core.connect(oracle).resolveCondition(oracleCondId, [OUTCOMEWIN]);

      const payout = newBet.odds.mul(newBet.amount).div(MULTIPLIER);

      expect(await lp.lockedLiquidity()).to.be.eq(lockedBefore.add(payout.sub(newBet.amount)));
      expect(await lp.connect(bettor1).viewPayout(betExpress.address, 1)).to.be.eq(payout);
      await lp.connect(bettor1).withdrawPayout(betExpress.address, 1);
      await lp.connect(factoryOwner).claimReward();
      await lp.connect(dataProvider).claimReward();

      expect(await lp.getReserve()).to.be.eq(lpBefore.sub(payout.sub(newBet.amount)));
      expect(await lp.lockedLiquidity()).to.be.eq(lockedBefore);
      expect(await wxDAI.balanceOf(bettor1.address)).to.be.eq(balanceBefore.add(payout));
      expect(await wxDAI.balanceOf(factoryOwner.address)).to.be.eq(balanceDaoBefore);
      expect(await wxDAI.balanceOf(dataProvider.address)).to.be.eq(balanceDataProviderBefore);

      await expect(lp.connect(bettor1).withdrawPayout(betExpress.address, 1)).to.be.revertedWithCustomError(
        betExpress,
        "AlreadyPaid"
      );
    });

    it("Bettor loses if any subbet loses", async () => {
      await core.connect(oracle).resolveCondition(oracleCondId - 2, [OUTCOMELOSE]);
      await core.connect(oracle).resolveCondition(oracleCondId - 1, [OUTCOMEWIN]);
      await core.connect(oracle).resolveCondition(oracleCondId, [OUTCOMEWIN]);

      const payout = 0;

      expect(await lp.connect(bettor1).viewPayout(betExpress.address, 1)).to.be.eq(payout);
      await lp.connect(bettor1).withdrawPayout(betExpress.address, 1);
      await lp.connect(factoryOwner).claimReward();
      await lp.connect(dataProvider).claimReward();

      expect(await lp.getReserve()).to.be.eq(
        lpBefore.add(newBet.amount.mul(MULTIPLIER - (daoFee + oracleFee + affiliateFee)).div(MULTIPLIER))
      );
      expect(await lp.lockedLiquidity()).to.be.eq(lockedBefore);
      expect(await wxDAI.balanceOf(bettor1.address)).to.be.eq(balanceBefore);
      expect(await wxDAI.balanceOf(factoryOwner.address)).to.be.eq(
        balanceDaoBefore.add(newBet.amount.mul(daoFee).div(MULTIPLIER))
      );
      expect(await wxDAI.balanceOf(dataProvider.address)).to.be.eq(
        balanceDataProviderBefore.add(newBet.amount.mul(oracleFee).div(MULTIPLIER))
      );
    });

    it("Bettor wins, but payout is decreased, if any condition or game is canceled", async () => {
      await core.connect(oracle).resolveCondition(oracleCondId - 2, [OUTCOMEWIN]);
      await core.connect(oracle).cancelCondition(oracleCondId - 1);
      await lp.connect(oracle).cancelGame(oracleGameId);

      const winningOdds = newBet.conditionOdds[0];
      const payout = newBet.amount.mul(winningOdds).div(MULTIPLIER);

      expect(await lp.connect(bettor1).viewPayout(betExpress.address, 1)).to.be.eq(payout);
      await lp.connect(bettor1).withdrawPayout(betExpress.address, 1);
      await lp.connect(factoryOwner).claimReward();
      await lp.connect(dataProvider).claimReward();

      expect(await lp.getReserve()).to.be.eq(lpBefore.sub(payout.sub(newBet.amount)));
      expect(await lp.lockedLiquidity()).to.be.eq(lockedBefore);
      expect(await wxDAI.balanceOf(bettor1.address)).to.be.eq(balanceBefore.add(payout));
      expect(await wxDAI.balanceOf(factoryOwner.address)).to.be.eq(balanceDaoBefore);
      expect(await wxDAI.balanceOf(dataProvider.address)).to.be.eq(balanceDataProviderBefore);
    });

    it("Bettor gets amount back if all conditions are canceled", async () => {
      await core.connect(oracle).cancelCondition(oracleCondId - 2);
      await core.connect(oracle).cancelCondition(oracleCondId - 1);
      await core.connect(oracle).cancelCondition(oracleCondId);

      const payout = newBet.amount;

      expect(await lp.connect(bettor1).viewPayout(betExpress.address, 1)).to.be.eq(payout);
      await lp.connect(bettor1).withdrawPayout(betExpress.address, 1);
      await lp.connect(factoryOwner).claimReward();
      await lp.connect(dataProvider).claimReward();

      expect(await lp.getReserve()).to.be.eq(lpBefore);
      expect(await lp.lockedLiquidity()).to.be.eq(lockedBefore);
      expect(await wxDAI.balanceOf(bettor1.address)).to.be.eq(balanceBefore.add(payout));
      expect(await wxDAI.balanceOf(factoryOwner.address)).to.be.eq(balanceDaoBefore);
      expect(await wxDAI.balanceOf(dataProvider.address)).to.be.eq(balanceDataProviderBefore);
    });

    it("Can't resolve bet payout if any condition is not finished", async () => {
      await core.connect(oracle).resolveCondition(oracleCondId - 2, [OUTCOMEWIN]);
      await core.connect(oracle).cancelCondition(oracleCondId - 1);
      await core.connect(maintainer).stopCondition(oracleCondId, true); // not finished

      await expect(lp.connect(bettor1).viewPayout(betExpress.address, 1)).to.be.revertedWithCustomError(
        betExpress,
        "ConditionNotFinished"
      );
      await expect(betExpress.calcPayout(1)).to.be.revertedWithCustomError(betExpress, "ConditionNotFinished");
      await expect(lp.connect(bettor1).withdrawPayout(betExpress.address, 1)).to.be.revertedWithCustomError(
        betExpress,
        "ConditionNotFinished"
      );
    });

    it("Can calculate bet payout even if it is withdrawn", async () => {
      await core.connect(oracle).resolveCondition(oracleCondId - 2, [OUTCOMEWIN]);
      await core.connect(oracle).resolveCondition(oracleCondId - 1, [OUTCOMEWIN]);
      await core.connect(oracle).resolveCondition(oracleCondId, [OUTCOMEWIN]);

      const payout = newBet.odds.mul(newBet.amount).div(MULTIPLIER);

      expect(await lp.lockedLiquidity()).to.be.eq(lockedBefore.add(payout.sub(newBet.amount)));
      expect(await lp.connect(bettor1).viewPayout(betExpress.address, 1)).to.be.eq(payout);
      expect(await betExpress.calcPayout(1)).to.be.eq(payout);

      await lp.connect(bettor1).withdrawPayout(betExpress.address, 1);

      await expect(lp.connect(bettor1).withdrawPayout(betExpress.address, 1)).to.be.revertedWithCustomError(
        betExpress,
        "AlreadyPaid"
      );
      await expect(lp.connect(bettor1).viewPayout(betExpress.address, 1)).to.be.revertedWithCustomError(
        betExpress,
        "AlreadyPaid"
      );
      expect(await betExpress.calcPayout(1)).to.be.eq(payout);
    });

    it("Payout is resolved if condition is resolved, even though its game is canceled", async () => {
      await core.connect(oracle).resolveCondition(oracleCondId - 2, [OUTCOMEWIN]);
      await core.connect(oracle).resolveCondition(oracleCondId - 1, [OUTCOMEWIN]);
      await core.connect(oracle).resolveCondition(oracleCondId, [OUTCOMEWIN]);

      await lp.connect(oracle).cancelGame(oracleGameId);
      await lp.connect(oracle).cancelGame(oracleGameId - 2);

      const payout = newBet.odds.mul(newBet.amount).div(MULTIPLIER);

      expect(await lp.connect(bettor1).viewPayout(betExpress.address, 1)).to.be.eq(payout);
      await lp.connect(bettor1).withdrawPayout(betExpress.address, 1);
      await lp.connect(factoryOwner).claimReward();
      await lp.connect(dataProvider).claimReward();

      expect(await lp.getReserve()).to.be.eq(lpBefore.sub(payout.sub(newBet.amount)));
      expect(await lp.lockedLiquidity()).to.be.eq(lockedBefore);
      expect(await wxDAI.balanceOf(bettor1.address)).to.be.eq(balanceBefore.add(payout));
      expect(await wxDAI.balanceOf(factoryOwner.address)).to.be.eq(balanceDaoBefore);
      expect(await wxDAI.balanceOf(dataProvider.address)).to.be.eq(balanceDataProviderBefore);

      await expect(lp.connect(bettor1).withdrawPayout(betExpress.address, 1)).to.be.revertedWithCustomError(
        betExpress,
        "AlreadyPaid"
      );
    });
  });
});
