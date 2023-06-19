const { expect } = require("chai");
const { constants } = require("ethers");
const { ethers } = require("hardhat");
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
const IPFS = ethers.utils.formatBytes32String("ipfs");
const OUTCOMEWIN = 1;
const OUTCOMELOSE = 2;
const OUTCOMES = [OUTCOMEWIN, OUTCOMELOSE];
const MULTIPLIER = 1e12;

describe("BetExpress tests", function () {
  const wrapLayer = initFixtureTree(ethers.provider);

  let factoryOwner, poolOwner, dataProvider, bettor1, oracle, oracle2, maintainer, bettor2, bettor3, affiliate;
  let factory, core, wxDAI, lp, betExpress, coreTools, access, roleIds;
  let now;
  let oracleGameId = 0;

  const reinforcement = constants.WeiPerEther.mul(20000); // 10%
  const marginality = MULTIPLIER * 0.1; // 10%
  const maxSandboxShare = MULTIPLIER * 0.2; // 20%
  const maxReinforcementShare = MULTIPLIER * 0.1; // 10%

  let subBet1, subBet2, subBet3;
  let oracleCondId;

  const minDepo = tokens(10);
  const daoFee = MULTIPLIER * 0.09; // 9%
  const oracleFee = MULTIPLIER * 0.01; // 1%
  const affiliateFee = MULTIPLIER * 0.33; // 33%

  async function deployAndInit() {
    [factoryOwner, poolOwner, dataProvider, bettor1, oracle, oracle2, maintainer, bettor2, bettor3, affiliate] =
      await ethers.getSigners();

    ({ factory, core, wxDAI, lp, _, access, roleIds } = await prepareStand(
      ethers,
      factoryOwner,
      poolOwner,
      dataProvider,
      bettor1,
      minDepo,
      daoFee,
      oracleFee,
      affiliateFee,
      LIQUIDITY
    ));

    const LibraryMock = await ethers.getContractFactory("LibraryMock", {
      signer: factoryOwner,
    });
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
    await betExpress.connect(poolOwner).setParams(marginality, maxReinforcementShare);

    await prepareAccess(access, poolOwner, oracle.address, oracle2.address, maintainer.address, roleIds);
    await grantRole(access, poolOwner, betExpress.address, roleIds.oddsManager);

    await factoryOwner.sendTransaction({ to: wxDAI.address, value: tokens(8_000_000) });

    await createGame(lp, oracle, ++oracleGameId, IPFS, now + ONE_HOUR);
    await createGame(lp, oracle, ++oracleGameId, IPFS, now + ONE_HOUR);
    await createGame(lp, oracle, ++oracleGameId, IPFS, now + ONE_HOUR);

    await createCondition(core, oracle, oracleGameId - 2, oracleCondId, [1, 1], OUTCOMES, reinforcement, marginality);
    await createCondition(core, oracle, oracleGameId - 1, ++oracleCondId, [3, 2], OUTCOMES, reinforcement, marginality);
    await createCondition(core, oracle, oracleGameId, ++oracleCondId, [1, 4], OUTCOMES, reinforcement, marginality);
  }

  wrapLayer(deployAndInit);

  it("Set incorrect BetExpress params", async () => {
    await expect(
      betExpress.connect(poolOwner).setParams(MULTIPLIER * 1.1, maxReinforcementShare)
    ).to.be.revertedWithCustomError(betExpress, "IncorrectMargin");

    await expect(betExpress.connect(poolOwner).setParams(marginality, MULTIPLIER * 1.1)).to.be.revertedWithCustomError(
      betExpress,
      "IncorrectMaxReinforcementShare"
    );
  });

  it("Can't accept express bet that contains similar gameIds or conditionIds in subbets", async () => {
    const amount = tokens(1000);

    const subBets = ethers.utils.defaultAbiCoder.encode(
      ["tuple(uint256 conditionId, uint64 outcomeId)[]"],
      [[subBet1, subBet2, subBet2]] // same condition (thus, same game)
    );

    await expect(
      lp.connect(bettor1).bet(betExpress.address, amount, now + ONE_WEEK, [affiliate.address, subBets])
    ).to.be.revertedWithCustomError(betExpress, "SameGameIdsNotAllowed");

    await createCondition(core, oracle, oracleGameId, oracleCondId + 1, [1, 2], OUTCOMES, reinforcement, marginality);
    const subBet4 = {
      conditionId: oracleCondId + 1,
      outcomeId: OUTCOMEWIN,
    };

    const subBets2 = ethers.utils.defaultAbiCoder.encode(
      ["tuple(uint256 conditionId, uint64 outcomeId)[]"],
      [[subBet1, subBet2, subBet3, subBet4]] // same game
    );

    await expect(
      lp.connect(bettor1).bet(betExpress.address, amount, now + ONE_WEEK, [affiliate.address, subBets2])
    ).to.be.revertedWithCustomError(betExpress, "SameGameIdsNotAllowed");
  });

  it("Can't resolve nonexistent express bet", async () => {
    await expect(lp.connect(bettor1).withdrawPayout(betExpress.address, 1, false)).to.be.revertedWith(
      "ERC721: invalid token ID"
    );

    await expect(lp.connect(bettor1).viewPayout(betExpress.address, 1)).to.be.revertedWithCustomError(
      betExpress,
      "BetNotExists"
    );
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

    await expect(lp.connect(bettor1).bet(betExpress.address, amount, now + ONE_WEEK, [affiliate.address, subBets]))
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
      lp.connect(bettor1).bet(betExpress.address, tokens(1000), now + ONE_WEEK, [affiliate.address, subBets2])
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
      lp.connect(bettor1).bet(betExpress.address, tokens(1000), now + ONE_WEEK, [affiliate.address, subBets2])
    ).to.be.revertedWithCustomError(betExpress, "TooFewSubbets");
  });

  it("Can't make bet on a canceled condition", async () => {
    await core.connect(oracle).cancelCondition(oracleCondId);

    const subBets2 = ethers.utils.defaultAbiCoder.encode(
      ["tuple(uint256 conditionId, uint64 outcomeId)[]"],
      [[subBet1, subBet2, subBet3]]
    );

    await expect(
      lp.connect(bettor1).bet(betExpress.address, tokens(1000), now + ONE_WEEK, [affiliate.address, subBets2])
    )
      .to.be.revertedWithCustomError(betExpress, "ConditionNotRunning")
      .withArgs(oracleCondId);
  });

  it("Can't make bet on a stopped condition", async () => {
    await core.connect(maintainer).stopCondition(oracleCondId, true);

    const subBets2 = ethers.utils.defaultAbiCoder.encode(
      ["tuple(uint256 conditionId, uint64 outcomeId)[]"],
      [[subBet1, subBet2, subBet3]]
    );

    await expect(
      lp.connect(bettor1).bet(betExpress.address, tokens(1000), now + ONE_WEEK, [affiliate.address, subBets2])
    )
      .to.be.revertedWithCustomError(betExpress, "ConditionNotRunning")
      .withArgs(oracleCondId);
  });

  it("Can't make bet on a resolved condition", async () => {
    await timeShiftBy(ethers, ONE_HOUR + ONE_HOUR);
    await core.connect(oracle).resolveCondition(oracleCondId - 2, OUTCOMEWIN);

    const subBets2 = ethers.utils.defaultAbiCoder.encode(
      ["tuple(uint256 conditionId, uint64 outcomeId)[]"],
      [[subBet1, subBet2, subBet3]]
    );

    await expect(
      lp.connect(bettor1).bet(betExpress.address, tokens(1000), now + ONE_WEEK, [affiliate.address, subBets2])
    )
      .to.be.revertedWithCustomError(betExpress, "ConditionNotRunning")
      .withArgs(oracleCondId - 2);
  });

  it("Сan't make a bet if the reinforcement limit for one sub-bet condition is exceeded.", async () => {
    let amount = tokens(40000);
    let subBets = ethers.utils.defaultAbiCoder.encode(
      ["tuple(uint256 conditionId, uint64 outcomeId)[]"],
      [[subBet1, subBet2, subBet3]]
    );
    await expect(lp.connect(bettor1).bet(betExpress.address, amount, now + ONE_WEEK, [affiliate.address, subBets]))
      .to.be.revertedWithCustomError(betExpress, "TooLargeReinforcement")
      .withArgs(subBet1.conditionId);

    amount = tokens(25000);
    subBets = ethers.utils.defaultAbiCoder.encode(
      ["tuple(uint256 conditionId, uint64 outcomeId)[]"],
      [[subBet1, subBet2]]
    );
    await lp.connect(bettor1).bet(betExpress.address, amount, now + ONE_WEEK, [affiliate.address, subBets]);

    subBets = ethers.utils.defaultAbiCoder.encode(
      ["tuple(uint256 conditionId, uint64 outcomeId)[]"],
      [[subBet3, subBet2]]
    );
    await expect(lp.connect(bettor1).bet(betExpress.address, amount, now + ONE_WEEK, [affiliate.address, subBets]))
      .to.be.revertedWithCustomError(betExpress, "TooLargeReinforcement")
      .withArgs(subBet2.conditionId);

    await createGame(lp, oracle, oracleGameId + 1, IPFS, now + ONE_HOUR);
    await createCondition(
      core,
      oracle,
      oracleGameId + 1,
      oracleCondId + 1,
      [1, 2],
      OUTCOMES,
      reinforcement,
      marginality
    );
    const subBet4 = {
      conditionId: oracleCondId + 1,
      outcomeId: OUTCOMEWIN,
    };
    subBets = ethers.utils.defaultAbiCoder.encode(
      ["tuple(uint256 conditionId, uint64 outcomeId)[]"],
      [[subBet3, subBet4]]
    );
    await lp.connect(bettor1).bet(betExpress.address, amount, now + ONE_WEEK, [affiliate.address, subBets]);
  });

  it("Can't make bets if resulting sum of odds is too small", async () => {
    const amount = tokens(1);

    await createCondition(
      core,
      oracle,
      oracleGameId - 2,
      oracleCondId + 1,
      [1, 10000000],
      OUTCOMES,
      reinforcement,
      marginality
    );
    await createCondition(
      core,
      oracle,
      oracleGameId - 1,
      oracleCondId + 2,
      [1, 20000000],
      OUTCOMES,
      reinforcement,
      marginality
    );
    await createCondition(
      core,
      oracle,
      oracleGameId,
      oracleCondId + 3,
      [1, 30000000],
      OUTCOMES,
      reinforcement,
      marginality
    );

    const subBet1_ = {
      conditionId: oracleCondId + 1,
      outcomeId: OUTCOMEWIN,
    };
    const subBet2_ = {
      conditionId: oracleCondId + 2,
      outcomeId: OUTCOMEWIN,
    };
    const subBet3_ = {
      conditionId: oracleCondId + 3,
      outcomeId: OUTCOMEWIN,
    };

    const subBets = ethers.utils.defaultAbiCoder.encode(
      ["tuple(uint256 conditionId, uint64 outcomeId)[]"],
      [[subBet1_, subBet2_, subBet3_]]
    );

    await expect(
      lp.connect(bettor1).bet(betExpress.address, amount, now + ONE_WEEK, [affiliate.address, subBets])
    ).to.be.revertedWithCustomError(betExpress, "TooSmallOdds");
  });

  context("Express bet with 3 subbets", () => {
    let newBet;
    let lpBefore, lockedBefore, balanceBefore, balanceAffBefore, balanceDaoBefore, balanceDataProviderBefore;

    beforeEach(async () => {
      lpBefore = await lp.getReserve();
      balanceBefore = await wxDAI.balanceOf(bettor1.address);
      balanceAffBefore = await wxDAI.balanceOf(affiliate.address);
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

      await lp.connect(bettor1).bet(betExpress.address, amount, now + ONE_WEEK, [affiliate.address, subBets]);
      newBet = await betExpress.getBet(1);
    }

    wrapLayer(putExpressBet);

    it("Bettor wins if all subbets win and takes all payout", async () => {
      const balanceBefore = await wxDAI.balanceOf(bettor1.address);
      const balanceAffBefore = await wxDAI.balanceOf(affiliate.address);
      const balanceDaoBefore = await wxDAI.balanceOf(factoryOwner.address);
      const balanceDataProviderBefore = await wxDAI.balanceOf(dataProvider.address);

      await core.connect(oracle).resolveCondition(oracleCondId - 2, OUTCOMEWIN);
      await core.connect(oracle).resolveCondition(oracleCondId - 1, OUTCOMEWIN);
      await core.connect(oracle).resolveCondition(oracleCondId, OUTCOMEWIN);

      const payout = newBet.odds.mul(newBet.amount).div(MULTIPLIER);

      expect(await lp.lockedLiquidity()).to.be.eq(lockedBefore.add(payout.sub(newBet.amount)));
      expect(await lp.connect(bettor1).viewPayout(betExpress.address, 1)).to.be.eq(payout);
      await lp.connect(bettor1).withdrawPayout(betExpress.address, 1, false);
      await lp.claimAffiliateRewardFor(betExpress.address, ethers.utils.arrayify(0), affiliate.address);
      await lp.connect(factoryOwner).claimReward();
      await lp.connect(dataProvider).claimReward();

      expect(await lp.getReserve()).to.be.eq(lpBefore.sub(payout.sub(newBet.amount)));
      expect(await lp.lockedLiquidity()).to.be.eq(lockedBefore);
      expect(await wxDAI.balanceOf(bettor1.address)).to.be.eq(balanceBefore.add(payout));
      expect(await wxDAI.balanceOf(affiliate.address)).to.be.eq(balanceAffBefore);
      expect(await wxDAI.balanceOf(factoryOwner.address)).to.be.eq(balanceDaoBefore);
      expect(await wxDAI.balanceOf(dataProvider.address)).to.be.eq(balanceDataProviderBefore);

      await expect(lp.connect(bettor1).withdrawPayout(betExpress.address, 1, false)).to.be.revertedWithCustomError(
        betExpress,
        "AlreadyResolved"
      );
    });

    it("Bettor loses if any subbet loses", async () => {
      await core.connect(oracle).resolveCondition(oracleCondId - 2, OUTCOMELOSE);
      await core.connect(oracle).resolveCondition(oracleCondId - 1, OUTCOMEWIN);
      await core.connect(oracle).resolveCondition(oracleCondId, OUTCOMEWIN);

      const payout = 0;

      expect(await lp.connect(bettor1).viewPayout(betExpress.address, 1)).to.be.eq(payout);
      await lp.connect(bettor1).withdrawPayout(betExpress.address, 1, false);
      await lp.claimAffiliateRewardFor(betExpress.address, ethers.utils.arrayify(0), affiliate.address);
      await lp.connect(factoryOwner).claimReward();
      await lp.connect(dataProvider).claimReward();

      expect(await lp.getReserve()).to.be.eq(
        lpBefore.add(newBet.amount.mul(MULTIPLIER - (affiliateFee + daoFee + oracleFee)).div(MULTIPLIER))
      );
      expect(await lp.lockedLiquidity()).to.be.eq(lockedBefore);
      expect(await wxDAI.balanceOf(bettor1.address)).to.be.eq(balanceBefore);
      expect(await wxDAI.balanceOf(affiliate.address)).to.be.eq(
        balanceAffBefore.add(newBet.amount.mul(affiliateFee).div(MULTIPLIER))
      );
      expect(await wxDAI.balanceOf(factoryOwner.address)).to.be.eq(
        balanceDaoBefore.add(newBet.amount.mul(daoFee).div(MULTIPLIER))
      );
      expect(await wxDAI.balanceOf(dataProvider.address)).to.be.eq(
        balanceDataProviderBefore.add(newBet.amount.mul(oracleFee).div(MULTIPLIER))
      );
    });

    it("Bettor wins, but payout is decreased, if any condition or game is canceled", async () => {
      await core.connect(oracle).resolveCondition(oracleCondId - 2, OUTCOMEWIN);
      await core.connect(oracle).cancelCondition(oracleCondId - 1);
      await lp.connect(oracle).cancelGame(oracleGameId);

      const winningOdds = newBet.conditionOdds[0];
      const payout = newBet.amount.mul(winningOdds).div(MULTIPLIER);

      expect(await lp.connect(bettor1).viewPayout(betExpress.address, 1)).to.be.eq(payout);
      await lp.connect(bettor1).withdrawPayout(betExpress.address, 1, false);
      await lp.claimAffiliateRewardFor(betExpress.address, ethers.utils.arrayify(0), affiliate.address);
      await lp.connect(factoryOwner).claimReward();
      await lp.connect(dataProvider).claimReward();

      expect(await lp.getReserve()).to.be.eq(lpBefore.sub(payout.sub(newBet.amount)));
      expect(await lp.lockedLiquidity()).to.be.eq(lockedBefore);
      expect(await wxDAI.balanceOf(bettor1.address)).to.be.eq(balanceBefore.add(payout));
      expect(await wxDAI.balanceOf(affiliate.address)).to.be.eq(balanceAffBefore);
      expect(await wxDAI.balanceOf(factoryOwner.address)).to.be.eq(balanceDaoBefore);
      expect(await wxDAI.balanceOf(dataProvider.address)).to.be.eq(balanceDataProviderBefore);
    });

    it("Bettor gets amount back if all conditions are canceled", async () => {
      await core.connect(oracle).cancelCondition(oracleCondId - 2);
      await core.connect(oracle).cancelCondition(oracleCondId - 1);
      await core.connect(oracle).cancelCondition(oracleCondId);

      const payout = newBet.amount;

      expect(await lp.connect(bettor1).viewPayout(betExpress.address, 1)).to.be.eq(payout);
      await lp.connect(bettor1).withdrawPayout(betExpress.address, 1, false);
      await lp.claimAffiliateRewardFor(betExpress.address, ethers.utils.arrayify(0), affiliate.address);
      await lp.connect(factoryOwner).claimReward();
      await lp.connect(dataProvider).claimReward();

      expect(await lp.getReserve()).to.be.eq(lpBefore);
      expect(await lp.lockedLiquidity()).to.be.eq(lockedBefore);
      expect(await wxDAI.balanceOf(bettor1.address)).to.be.eq(balanceBefore.add(payout));
      expect(await wxDAI.balanceOf(affiliate.address)).to.be.eq(balanceAffBefore);
      expect(await wxDAI.balanceOf(factoryOwner.address)).to.be.eq(balanceDaoBefore);
      expect(await wxDAI.balanceOf(dataProvider.address)).to.be.eq(balanceDataProviderBefore);
    });

    it("Can't resolve bet payout if any condition is not finished", async () => {
      await core.connect(oracle).resolveCondition(oracleCondId - 2, OUTCOMEWIN);
      await core.connect(oracle).cancelCondition(oracleCondId - 1);
      await core.connect(maintainer).stopCondition(oracleCondId, true); // not finished

      await expect(lp.connect(bettor1).viewPayout(betExpress.address, 1)).to.be.revertedWithCustomError(
        betExpress,
        "ConditionNotFinished"
      );
      await expect(lp.connect(bettor1).withdrawPayout(betExpress.address, 1, false)).to.be.revertedWithCustomError(
        betExpress,
        "ConditionNotFinished"
      );
    });

    it("Payout is resolved if condition is resolved, even though its game is canceled", async () => {
      await core.connect(oracle).resolveCondition(oracleCondId - 2, OUTCOMEWIN);
      await core.connect(oracle).resolveCondition(oracleCondId - 1, OUTCOMEWIN);
      await core.connect(oracle).resolveCondition(oracleCondId, OUTCOMEWIN);

      await lp.connect(oracle).cancelGame(oracleGameId);
      await lp.connect(oracle).cancelGame(oracleGameId - 2);

      const payout = newBet.odds.mul(newBet.amount).div(MULTIPLIER);

      expect(await lp.connect(bettor1).viewPayout(betExpress.address, 1)).to.be.eq(payout);
      await lp.connect(bettor1).withdrawPayout(betExpress.address, 1, false);
      await lp.claimAffiliateRewardFor(betExpress.address, ethers.utils.arrayify(0), affiliate.address);
      await lp.connect(factoryOwner).claimReward();
      await lp.connect(dataProvider).claimReward();

      expect(await lp.getReserve()).to.be.eq(lpBefore.sub(payout.sub(newBet.amount)));
      expect(await lp.lockedLiquidity()).to.be.eq(lockedBefore);
      expect(await wxDAI.balanceOf(bettor1.address)).to.be.eq(balanceBefore.add(payout));
      expect(await wxDAI.balanceOf(affiliate.address)).to.be.eq(balanceAffBefore);
      expect(await wxDAI.balanceOf(factoryOwner.address)).to.be.eq(balanceDaoBefore);
      expect(await wxDAI.balanceOf(dataProvider.address)).to.be.eq(balanceDataProviderBefore);

      await expect(lp.connect(bettor1).withdrawPayout(betExpress.address, 1, false)).to.be.revertedWithCustomError(
        betExpress,
        "AlreadyResolved"
      );
    });
  });
});
