const { expect } = require("chai");
const { constants, BigNumber } = require("ethers");
const { ethers } = require("hardhat");
const {
  getBlockTime,
  timeShift,
  timeShiftBy,
  tokens,
  makeBetGetTokenId,
  makeBetGetTokenIdOdds,
  makeWithdrawPayout,
  getLPNFTToken,
  getTokenIdOdds,
  prepareStand,
  prepareAccess,
  createGame,
  encodeBetData,
  getClaimParamsDef,
  addRole,
  grantRole,
  switchCore,
  changeMinBet,
  changeReinforcementAbility,
  getPluggedCore,
} = require("../utils/utils");
const { ITERATIONS, MULTIPLIER } = require("../utils/constants");

const LIQUIDITY = tokens(2000000);
const ONE_MINUTE = 60;
const ONE_HOUR = 3600;
const ONE_WEEK = 604800;
const ONE_YEAR = 31536000;
const OUTCOMEWIN = 1;
const OUTCOMELOSE = 2;
const OUTCOMEINCORRECT = 3;
const OUTCOMES = [OUTCOMEWIN, OUTCOMELOSE];
const IPFS = ethers.utils.formatBytes32String("ipfs");
const FEEHALFPERCENT = MULTIPLIER * 0.005;
const FEE5PERCENT = MULTIPLIER * 0.05;

let conditionArr = [];

const createCondition = async (core, oracle, gameId, condId, pools, outcomes, reinforcement, marginality) => {
  await core.connect(oracle).createCondition(gameId, condId, pools, outcomes, reinforcement, marginality);

  conditionArr.push([oracle, condId]);
};

describe("Prematch Core test", function () {
  let factoryOwner, poolOwner, dataProvider, bettor, lpOwner, affiliate, oracle, oracle2, maintainer;
  let factory, access, core, wxDAI, lp, affiliateHelper, azuroBet;
  let roleIds, lpNFT, time;

  let gameId = 0;
  let condId = 0;

  const reinforcement = constants.WeiPerEther.mul(20000); // 10%
  const marginality = MULTIPLIER * 0.05; // 5%

  const minDepo = tokens(10);
  const daoFee = MULTIPLIER * 0.09; // 9%
  const dataProviderFee = MULTIPLIER * 0.01; // 1%
  const affiliateFee = MULTIPLIER * 0.33; // 33%

  const pool1 = 5000000;
  const pool2 = 5000000;

  before(async () => {
    [factoryOwner, poolOwner, dataProvider, bettor, lpOwner, affiliate, oracle, oracle2, maintainer] =
      await ethers.getSigners();

    ({ factory, access, core, wxDAI, lp, azuroBet, affiliateHelper, roleIds } = await prepareStand(
      ethers,
      factoryOwner,
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

    lpNFT = await getLPNFTToken(await lp.connect(poolOwner).addLiquidity(minDepo));
  });

  describe("Prematch Core settings", () => {
    it("Updating core settings does not affect another cores", async function () {
      const PrematchCore = await ethers.getContractFactory("PrematchCore", {
        signer: poolOwner,
        libraries: {
          AffiliateHelper: affiliateHelper.address,
        },
        unsafeAllowCustomTypes: true,
      });

      const txPlugCore = await factory.connect(poolOwner).plugCore(lp.address, "pre-match");
      const core2 = await PrematchCore.attach(await getPluggedCore(txPlugCore));

      await lp.connect(poolOwner).updateCoreSettings(
        core2.address,
        2, // state: INACTIVE
        0, // reinforcementAbility: 0%
        1 //miBet: 1
      );

      time = await getBlockTime(ethers);
      await createGame(lp, oracle, ++gameId, IPFS, time + ONE_HOUR);

      await createCondition(core, oracle, gameId, ++condId, [pool2, pool1], OUTCOMES, reinforcement, marginality);

      await makeBetGetTokenIdOdds(lp, core, poolOwner, affiliate.address, condId, tokens(100), 1, time + 100, 0);
    });
    it("Core state can be set only as ACTIVE or INACTIVE", async () => {
      await switchCore(lp, core, poolOwner, false); // INACTIVE
      await switchCore(lp, core, poolOwner, true); // ACTIVE

      const coreData = await lp.cores(core.address);
      await expect(
        lp.connect(poolOwner).updateCoreSettings(core.address, 0, coreData.reinforcementAbility, coreData.minBet)
      ).to.be.revertedWithCustomError(lp, "IncorrectCoreState");
      await expect(
        lp.connect(poolOwner).updateCoreSettings(core.address, 3, coreData.reinforcementAbility, coreData.minBet)
      ).to.be.reverted;
    });
    it("Reinforcement ability CAN NOT be larger than 100%", async function () {
      await expect(changeReinforcementAbility(lp, core, poolOwner, MULTIPLIER + 1)).to.be.revertedWithCustomError(
        lp,
        "IncorrectReinforcementAbility"
      );
    });
    it("Minimum bet CAN NOT be less than 1", async () => {
      await expect(changeMinBet(lp, core, poolOwner, 0)).to.be.revertedWithCustomError(lp, "IncorrectMinBet");
    });
  });

  describe("Conditions management", () => {
    it("Create role with name larger than 32 bytes", async () => {
      await addRole(access, poolOwner, "dummydummydummydummydummydummydu" /* 32 bytes */);
      const dummyRoleId = await addRole(access, poolOwner, "заглушказаглушка" /* 32 bytes */);

      await expect(
        addRole(access, poolOwner, "dummydummydummydummydummydummydum" /* 33 bytes */)
      ).to.be.revertedWithCustomError(access, "SafeCastError");
      await expect(addRole(access, poolOwner, "заглушказаглушказ" /* 34 bytes */)).to.be.revertedWithCustomError(
        access,
        "SafeCastError"
      );

      await expect(
        access.connect(poolOwner).renameRole(dummyRoleId, "dummydummydummydummydummydummydum" /* 33 bytes */)
      ).to.be.revertedWithCustomError(access, "SafeCastError");
      await expect(
        access.connect(poolOwner).renameRole(dummyRoleId, "заглушказаглушказ" /* 33 bytes */)
      ).to.be.revertedWithCustomError(access, "SafeCastError");
    });
    it("Manage roleIds", async () => {
      await expect(
        access.checkAccess(bettor.address, core.address, "0xc6600c7c" /* createCondition */)
      ).to.be.revertedWithCustomError(access, "AccessNotGranted");
      await expect(grantRole(access, bettor, bettor.address, roleIds.oracle)).to.be.revertedWith(
        "Ownable: account is not the owner"
      );

      const accessToken = await grantRole(access, poolOwner, bettor.address, roleIds.oracle);
      await access.checkAccess(bettor.address, core.address, "0xc6600c7c");

      access.connect(poolOwner).burn(accessToken);
      await expect(access.checkAccess(bettor.address, core.address, "0xc6600c7c")).to.be.revertedWithCustomError(
        access,
        "AccessNotGranted"
      );
    });
    it("Create incorrect CORE.condition params", async () => {
      time = await getBlockTime(ethers);
      await createGame(lp, oracle, ++gameId, IPFS, time + ONE_HOUR);

      await expect(
        createCondition(
          core,
          oracle,
          gameId,
          ++condId,
          [pool2, pool1],
          [OUTCOMEWIN, OUTCOMEWIN], // must be not equal
          reinforcement,
          marginality
        )
      ).to.be.revertedWithCustomError(core, "SameOutcomes");

      await expect(
        createCondition(
          core,
          oracle,
          gameId,
          condId,
          [pool2, pool1],
          OUTCOMES,
          reinforcement,
          MULTIPLIER + 1 // must belong to [0, 1]
        )
      ).to.be.revertedWithCustomError(core, "IncorrectMargin");

      await expect(
        createCondition(
          core,
          oracle,
          gameId,
          condId,
          [0, pool1], // no zeros
          [OUTCOMELOSE, OUTCOMEWIN],
          reinforcement,
          marginality
        )
      ).to.be.revertedWithCustomError(core, "ZeroOdds");

      await expect(
        createCondition(
          core,
          oracle,
          gameId,
          condId,
          [pool2, 0], // no zeros
          [OUTCOMELOSE, OUTCOMEWIN],
          reinforcement,
          marginality
        )
      ).to.be.revertedWithCustomError(core, "ZeroOdds");
    });
    it("Make two conditions: canceled and resolved and try to stop them", async () => {
      time = await getBlockTime(ethers);
      await createGame(lp, oracle, ++gameId, IPFS, time + ONE_HOUR);

      let condIds = [];

      for (const i of Array(3).keys()) {
        condIds.push(++condId);
        await createCondition(core, oracle, gameId, condId, [pool2, pool1], OUTCOMES, reinforcement, marginality);
      }

      await timeShiftBy(ethers, ONE_HOUR + ONE_MINUTE);
      /* enum ConditionState {
        CREATED,
        RESOLVED,
        CANCELED,
        PAUSED
      } */
      // resolve first conditon
      await core.connect(oracle).resolveCondition(condIds[0], OUTCOMEWIN);
      expect((await core.getCondition(condIds[0])).state).to.be.equal(1); // RESOLVED

      // cancel second condition
      await core.connect(oracle).cancelCondition(condIds[1]);
      expect((await core.getCondition(condIds[1])).state).to.be.equal(2); // CANCELED

      // try to stop RESOLVED condition
      await expect(core.connect(maintainer).stopCondition(condIds[0], true)).to.be.revertedWithCustomError(
        core,
        "CantChangeFlag"
      );
      await expect(core.connect(maintainer).stopCondition(condIds[0], false)).to.be.revertedWithCustomError(
        core,
        "CantChangeFlag"
      );

      // try to stop CANCELED condition
      await expect(core.connect(maintainer).stopCondition(condIds[1], true)).to.be.revertedWithCustomError(
        core,
        "CantChangeFlag"
      );
      await expect(core.connect(maintainer).stopCondition(condIds[1], false)).to.be.revertedWithCustomError(
        core,
        "CantChangeFlag"
      );

      // cancel game
      await lp.connect(oracle).cancelGame(gameId);
      expect((await core.getCondition(condIds[2])).state).to.be.equal(0); // CREATED

      // try to stop condition from CANCELED game
      await expect(core.connect(maintainer).stopCondition(condIds[2], true)).to.be.revertedWithCustomError(
        core,
        "CantChangeFlag"
      );
      await expect(core.connect(maintainer).stopCondition(condIds[2], false)).to.be.revertedWithCustomError(
        core,
        "CantChangeFlag"
      );
    });
    it("Resolve condition after long period", async () => {
      time = await getBlockTime(ethers);
      await createGame(lp, oracle, ++gameId, IPFS, time + ONE_HOUR);

      await createCondition(core, oracle, gameId, ++condId, [10, 10000], OUTCOMES, reinforcement, marginality);

      const betAmount = tokens(100);
      let { tokenId, odds } = await makeBetGetTokenIdOdds(
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
      const payout = odds.mul(betAmount).div(MULTIPLIER);

      await timeShiftBy(ethers, ONE_YEAR * 10);
      await core.connect(oracle).resolveCondition(condId, OUTCOMEWIN);

      const balBefore = await wxDAI.balanceOf(bettor.address);

      await makeWithdrawPayout(lp, core, bettor, tokenId);
      expect(await wxDAI.balanceOf(bettor.address)).to.be.equal(balBefore.add(payout));
    });
    it("Resolve condition by an oracle that lost his role after condition creating", async () => {
      const accessToken = await grantRole(access, poolOwner, bettor.address, roleIds.oracle);

      time = await getBlockTime(ethers);
      await createGame(lp, bettor, ++gameId, IPFS, time + ONE_HOUR);
      await createCondition(core, bettor, gameId, ++condId, [10, 10000], OUTCOMES, reinforcement, marginality);

      await access.connect(poolOwner).burn(accessToken);

      await timeShiftBy(ethers, time + ONE_HOUR + ONE_MINUTE);
      await core.connect(bettor).resolveCondition(condId, OUTCOMEWIN);

      const condition = await core.getCondition(condId);
      expect(condition.state).to.be.equal(1 /* RESOLVED */);
      expect(condition.outcomeWin).to.be.equal(OUTCOMEWIN);
    });
    it("Cancel condition by an oracle that lost his role after condition creating", async () => {
      const accessToken = await grantRole(access, poolOwner, bettor.address, roleIds.oracle);

      time = await getBlockTime(ethers);
      await createGame(lp, bettor, ++gameId, IPFS, time + ONE_HOUR);
      await createCondition(core, bettor, gameId, ++condId, [10, 10000], OUTCOMES, reinforcement, marginality);

      await access.connect(poolOwner).burn(accessToken);

      await core.connect(bettor).cancelCondition(condId);

      const condition = await core.getCondition(condId);
      expect(condition.state).to.be.equal(2 /* CANCELED */);
    });
    it("Should NOT create condition from not oracle", async () => {
      time = await getBlockTime(ethers);
      await createGame(lp, oracle, ++gameId, IPFS, time + ONE_HOUR);

      condId++;
      await expect(
        core.connect(bettor).createCondition(gameId, condId, [pool2, pool1], OUTCOMES, reinforcement, marginality)
      ).to.be.revertedWithCustomError(access, "AccessNotGranted");
    });
    it("Should NOT create condition with ID 0", async () => {
      time = await getBlockTime(ethers);
      await createGame(lp, oracle, ++gameId, IPFS, time + ONE_HOUR);

      await expect(
        core.connect(oracle).createCondition(gameId, 0, [pool2, pool1], OUTCOMES, reinforcement, marginality)
      ).to.be.revertedWithCustomError(core, "IncorrectConditionId");
    });
    it("Should NOT create condition if the game is already started", async () => {
      time = await getBlockTime(ethers);
      await createGame(lp, oracle, ++gameId, IPFS, time + ONE_HOUR);

      await timeShift(time + ONE_HOUR);
      await expect(
        core.connect(oracle).createCondition(gameId, ++condId, [pool2, pool1], OUTCOMES, reinforcement, marginality)
      ).to.be.revertedWithCustomError(core, "GameAlreadyStarted");
    });
    it("Should NOT create condition that is already created", async () => {
      time = await getBlockTime(ethers);
      await createGame(lp, oracle, ++gameId, IPFS, time + ONE_HOUR);

      await createCondition(core, oracle, gameId, ++condId, [pool2, pool1], OUTCOMES, reinforcement, marginality);

      await expect(
        createCondition(core, oracle, gameId, condId, [pool2, pool1], OUTCOMES, reinforcement, marginality)
      ).to.be.revertedWithCustomError(core, "ConditionAlreadyCreated");
    });
    it("Should NOT resolve condition that not been created before", async () => {
      await expect(core.connect(oracle).resolveCondition(++condId, OUTCOMEWIN)).to.be.revertedWithCustomError(
        core,
        "ConditionNotExists"
      );
    });
    it("Should NOT resolve condition if the game has not started yet", async () => {
      time = await getBlockTime(ethers);
      await createGame(lp, oracle, ++gameId, IPFS, time + ONE_HOUR);

      condId++;
      await createCondition(core, oracle, gameId, condId, [pool2, pool1], OUTCOMES, reinforcement, marginality);

      await timeShift(time + ONE_HOUR + ONE_MINUTE - 10);
      await expect(core.connect(oracle).resolveCondition(condId, OUTCOMEWIN)).to.be.revertedWithCustomError(
        core,
        "ResolveTooEarly"
      );

      await timeShift(time + ONE_HOUR + ONE_MINUTE);
      await core.connect(oracle).resolveCondition(condId, OUTCOMEWIN);
    });
    it("Should NOT resolve condition from not oracle", async () => {
      time = await getBlockTime(ethers);
      await createGame(lp, oracle, ++gameId, IPFS, time + ONE_HOUR);

      condId++;
      await createCondition(core, oracle, gameId, condId, [pool2, pool1], OUTCOMES, reinforcement, marginality);

      await expect(core.connect(bettor).resolveCondition(condId, OUTCOMEWIN))
        .to.be.revertedWithCustomError(core, "OnlyOracle")
        .withArgs(oracle.address);
    });
    it("Should NOT resolve condition from other oracle than created it", async () => {
      time = await getBlockTime(ethers);
      await createGame(lp, oracle, ++gameId, IPFS, time + ONE_HOUR);

      condId++;
      await createCondition(core, oracle, gameId, condId, [pool2, pool1], OUTCOMES, reinforcement, marginality);

      await expect(core.connect(oracle2).resolveCondition(condId, OUTCOMEWIN))
        .to.be.revertedWithCustomError(core, "OnlyOracle")
        .withArgs(oracle.address);
    });
    it("Should NOT resolve condition with incorrect outcome", async () => {
      time = await getBlockTime(ethers);
      await createGame(lp, oracle, ++gameId, IPFS, time + ONE_HOUR);

      condId++;
      await createCondition(core, oracle, gameId, condId, [pool2, pool1], OUTCOMES, reinforcement, marginality);

      await timeShift(time + ONE_HOUR + ONE_MINUTE);
      await expect(core.connect(oracle).resolveCondition(condId, OUTCOMEINCORRECT)).to.be.revertedWithCustomError(
        core,
        "WrongOutcome"
      );
    });
    it("Should view/return funds from canceled condition", async () => {
      time = await getBlockTime(ethers);
      await createGame(lp, oracle, ++gameId, IPFS, time + ONE_HOUR);

      const condId1 = ++condId;
      await createCondition(core, oracle, gameId, condId1, [pool2, pool1], OUTCOMES, reinforcement, marginality);

      const condId2 = ++condId;
      await createCondition(core, oracle, gameId, condId2, [pool2, pool1], OUTCOMES, reinforcement, marginality);

      let tokenId = await makeBetGetTokenId(
        lp,
        core,
        bettor,
        affiliate.address,
        condId2,
        tokens(100),
        OUTCOMEWIN,
        time + 100,
        0
      );

      // check condition not passed yet
      await expect(makeWithdrawPayout(lp, core, bettor, tokenId)).to.be.revertedWithCustomError(
        core,
        "ConditionNotFinished"
      );

      // try incorrect oracle wallet
      await expect(core.connect(bettor).cancelCondition(condId2)).to.be.revertedWithCustomError(
        access,
        "AccessNotGranted"
      );

      await core.connect(oracle).cancelCondition(condId2);

      // bet is accepted - only condition is cancelled not the game
      await makeBetGetTokenId(lp, core, bettor, affiliate.address, condId1, tokens(100), OUTCOMEWIN, time + 100, 0);

      // check payout
      expect(await lp.connect(bettor).viewPayout(core.address, tokenId)).to.be.equal(tokens(100));

      let BalBefore = await wxDAI.balanceOf(bettor.address);
      await makeWithdrawPayout(lp, core, bettor, tokenId);
      expect((await wxDAI.balanceOf(bettor.address)).sub(BalBefore)).to.be.equal(tokens(100));
    });
    it("Should view/return funds from canceled by maintainer condition", async () => {
      time = await getBlockTime(ethers);
      await createGame(lp, oracle, ++gameId, IPFS, time + ONE_HOUR);

      condId++;
      await createCondition(core, oracle, gameId, condId, [pool2, pool1], OUTCOMES, reinforcement, marginality);

      let tokenId = await makeBetGetTokenId(
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

      // check condition not passed yet
      await expect(makeWithdrawPayout(lp, core, bettor, tokenId)).to.be.revertedWithCustomError(
        core,
        "ConditionNotFinished"
      );

      // wait for ending condition
      await timeShift((await getBlockTime(ethers)) + ONE_HOUR);

      // try incorrect oracle wallet
      await expect(core.connect(bettor).cancelCondition(condId)).to.be.revertedWithCustomError(
        access,
        "AccessNotGranted"
      );

      let reserveBeforeCancel = await lp.getReserve();
      await core.connect(maintainer).cancelCondition(condId);
      // try cancel again
      await expect(core.connect(maintainer).cancelCondition(condId)).to.be.revertedWithCustomError(
        core,
        "ConditionAlreadyResolved"
      );
      // check LP reserve not changed after canceling
      expect(await lp.getReserve()).to.be.equal(reserveBeforeCancel);

      // check payout
      expect(await lp.connect(bettor).viewPayout(core.address, tokenId)).to.be.equal(tokens(100));

      let BalBefore = await wxDAI.balanceOf(bettor.address);
      await makeWithdrawPayout(lp, core, bettor, tokenId);
      expect((await wxDAI.balanceOf(bettor.address)).sub(BalBefore)).to.be.equal(tokens(100));
    });
    it("Should view/return funds from canceled game", async () => {
      time = await getBlockTime(ethers);
      await createGame(lp, oracle, ++gameId, IPFS, time + ONE_HOUR);

      // try to create condition bounded with incorrect game
      await expect(
        createCondition(core, oracle, 0, ++condId, [pool2, pool1], OUTCOMES, reinforcement, marginality)
      ).to.be.revertedWithCustomError(lp, "GameNotExists");

      // create conditions
      const condId1 = ++condId;
      await createCondition(core, oracle, gameId, condId1, [pool2, pool1], OUTCOMES, reinforcement, marginality);

      const condId2 = ++condId;
      await createCondition(core, oracle, gameId, condId2, [pool2, pool1], OUTCOMES, reinforcement, marginality);

      // make bets

      let tokenId1 = await makeBetGetTokenId(
        lp,
        core,
        bettor,
        affiliate.address,
        condId1,
        tokens(100),
        OUTCOMEWIN,
        time + 100,
        0
      );

      let tokenId2 = await makeBetGetTokenId(
        lp,
        core,
        bettor,
        affiliate.address,
        condId2,
        tokens(50),
        OUTCOMEWIN,
        time + 100,
        0
      );

      // try to cancel by incorrect oracle wallet
      await expect(lp.connect(maintainer).cancelGame(gameId)).to.be.revertedWithCustomError(access, "AccessNotGranted");

      // try to cancel incorrect game
      await expect(lp.connect(oracle).cancelGame(0)).to.be.revertedWithCustomError(lp, "GameNotExists");

      await lp.connect(oracle).cancelGame(gameId);

      // try cancel game again
      await expect(lp.connect(oracle).cancelGame(gameId)).to.be.revertedWithCustomError(lp, "GameAlreadyCanceled");

      // try cancel condition
      await expect(core.connect(oracle).cancelCondition(condId2)).to.be.revertedWithCustomError(
        core,
        "ConditionAlreadyResolved"
      );

      // try resolve condition
      await timeShiftBy(ethers, ONE_HOUR + ONE_MINUTE);
      await expect(core.connect(oracle).resolveCondition(condId2, OUTCOMEWIN)).to.be.revertedWithCustomError(
        core,
        "ConditionAlreadyResolved"
      );

      // try to create condition bounded with canceled game
      await expect(
        createCondition(core, oracle, gameId, condId + 1, [pool2, pool1], OUTCOMES, reinforcement, marginality)
      ).to.be.revertedWithCustomError(lp, "GameCanceled_");

      // try to make bet for condition bounded with canceled game
      time = await getBlockTime(ethers);
      await expect(
        makeBetGetTokenId(lp, core, poolOwner, affiliate.address, condId1, tokens(100), OUTCOMEWIN, time + 100, 0)
      ).to.be.revertedWithCustomError(core, "ActionNotAllowed");

      // check payout for first condition
      expect(await lp.connect(bettor).viewPayout(core.address, tokenId1)).to.be.equal(tokens(100));

      // check payout for second condition
      expect(await lp.connect(bettor).viewPayout(core.address, tokenId2)).to.be.equal(tokens(50));

      let BalBefore = await wxDAI.balanceOf(bettor.address);
      await makeWithdrawPayout(lp, core, bettor, tokenId1);
      let BalAfter = await wxDAI.balanceOf(bettor.address);
      expect(BalAfter.sub(BalBefore)).to.be.equal(tokens(100));

      await makeWithdrawPayout(lp, core, bettor, tokenId2);
      expect((await wxDAI.balanceOf(bettor.address)).sub(BalAfter)).to.be.equal(tokens(50));
    });
    it("Should NOT create game from not oracle", async () => {
      time = await getBlockTime(ethers);
      await expect(createGame(lp, bettor, ++gameId, IPFS, time + ONE_HOUR)).to.be.revertedWithCustomError(
        access,
        "AccessNotGranted"
      );
    });
    it("Should NOT create game with ID 0", async () => {
      time = await getBlockTime(ethers);
      await expect(createGame(lp, oracle, 0, IPFS, time + ONE_HOUR)).to.be.revertedWithCustomError(
        lp,
        "IncorrectGameId"
      );
    });
    it("Should NOT create game that is already started", async () => {
      time = await getBlockTime(ethers);
      await expect(createGame(lp, oracle, ++gameId, IPFS, time)).to.be.revertedWithCustomError(
        core,
        "IncorrectTimestamp"
      );
    });
    it("Should NOT create game that is already created", async () => {
      await createGame(lp, oracle, ++gameId, IPFS, time + ONE_HOUR);
      await expect(createGame(lp, oracle, gameId, IPFS, time + ONE_HOUR)).to.be.revertedWithCustomError(
        lp,
        "GameAlreadyCreated"
      );
    });
    it("Should shift game start", async () => {
      time = await getBlockTime(ethers);
      await createGame(lp, oracle, ++gameId, IPFS, time + ONE_HOUR);

      condId++;
      await createCondition(core, oracle, gameId, condId, [pool2, pool1], OUTCOMES, reinforcement, marginality);

      await expect(lp.connect(maintainer).shiftGame(gameId, time)).to.be.revertedWithCustomError(
        access,
        "AccessNotGranted"
      );
      await expect(lp.connect(oracle).shiftGame(0, time)).to.be.revertedWithCustomError(lp, "GameNotExists");
      await lp.connect(oracle).shiftGame(gameId, time);

      const game = await lp.games(gameId);
      await expect(game.startsAt).to.be.equal(time);
    });

    describe("Odds management", () => {
      beforeEach(async () => {
        time = await getBlockTime(ethers);
        await createGame(lp, oracle, ++gameId, IPFS, time + ONE_HOUR);
      });
      it("Check restrictions", async () => {
        await createCondition(core, oracle, gameId, ++condId, [pool2, pool1], OUTCOMES, reinforcement, marginality);

        const newOdds = [100, 10000];
        const newOdds2 = [10000, 100];

        // Change odds not by oracle
        await expect(core.connect(bettor).changeOdds(condId, newOdds)).to.be.revertedWithCustomError(
          access,
          "AccessNotGranted"
        );

        // Incorrect odds
        await expect(core.connect(oracle).changeOdds(condId, [0, 10000])).to.be.revertedWithCustomError(
          core,
          "ZeroOdds"
        );
        await expect(core.connect(oracle).changeOdds(condId, [100, 0])).to.be.revertedWithCustomError(core, "ZeroOdds");

        // Stop condition
        await core.connect(oracle).changeOdds(condId, newOdds); // success
        await core.connect(maintainer).stopCondition(condId, true);
        await expect(core.connect(oracle).changeOdds(condId, newOdds2)).to.be.revertedWithCustomError(
          core,
          "ActionNotAllowed"
        );

        await core.connect(maintainer).stopCondition(condId, false);

        // Resolved condition
        await core.connect(oracle).changeOdds(condId, newOdds); // success
        timeShift(time + ONE_HOUR + ONE_MINUTE);
        await core.connect(oracle).resolveCondition(condId, OUTCOMEWIN);
        await expect(core.connect(oracle).changeOdds(condId, newOdds2)).to.be.revertedWithCustomError(
          core,
          "ActionNotAllowed"
        );

        time = await getBlockTime(ethers);
        await createGame(lp, oracle, ++gameId, IPFS, time + ONE_HOUR);

        // Canceled condition
        await createCondition(core, oracle, gameId, ++condId, [pool2, pool1], OUTCOMES, reinforcement, marginality);

        await core.connect(oracle).changeOdds(condId, newOdds); // success
        await core.connect(oracle).cancelCondition(condId);
        await expect(core.connect(oracle).changeOdds(condId, newOdds2)).to.be.revertedWithCustomError(
          core,
          "ActionNotAllowed"
        );

        // Canceled game
        await createCondition(core, oracle, gameId, ++condId, [pool2, pool1], OUTCOMES, reinforcement, marginality);

        await core.connect(oracle).changeOdds(condId, newOdds); // success
        await lp.connect(oracle).cancelGame(gameId);
        await expect(core.connect(oracle).changeOdds(condId, newOdds2)).to.be.revertedWithCustomError(
          core,
          "ActionNotAllowed"
        );
      });
      it("Change odds before betting starts", async () => {
        const condId1 = ++condId;
        await createCondition(core, oracle, gameId, condId1, [pool2, pool1], OUTCOMES, reinforcement, marginality);

        const newOdds = [100, 10000];
        await core.connect(oracle).changeOdds(condId1, newOdds);

        const condId2 = ++condId;
        await createCondition(core, oracle, gameId, condId2, newOdds, OUTCOMES, reinforcement, marginality);

        const betAmount = tokens(100);
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
        let res2 = await makeBetGetTokenIdOdds(
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

        expect(res.odds).to.be.equal(res2.odds);

        res = await makeBetGetTokenIdOdds(
          lp,
          core,
          bettor,
          affiliate.address,
          condId1,
          betAmount,
          OUTCOMELOSE,
          time + 100,
          0
        );
        res2 = await makeBetGetTokenIdOdds(
          lp,
          core,
          bettor,
          affiliate.address,
          condId2,
          betAmount,
          OUTCOMELOSE,
          time + 100,
          0
        );

        expect(res.odds).to.be.equal(res2.odds);
      });
      it("Change odds after betting starts", async () => {
        const condId1 = ++condId;
        await createCondition(core, oracle, gameId, condId1, [pool2, pool1], OUTCOMES, reinforcement, marginality);

        const betAmount = tokens(100);
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
        const payout = res.odds.mul(betAmount).div(MULTIPLIER);

        const newOdds = [100, 10000];
        await core.connect(oracle).changeOdds(condId1, newOdds);

        const condId2 = ++condId;
        await createCondition(
          core,
          oracle,
          gameId,
          condId2,
          newOdds,
          OUTCOMES,
          reinforcement.sub(payout.sub(betAmount)),
          marginality
        );

        res = await makeBetGetTokenIdOdds(
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
        let res2 = await makeBetGetTokenIdOdds(
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

        expect(res.odds).to.be.equal(res2.odds);

        res = await makeBetGetTokenIdOdds(
          lp,
          core,
          bettor,
          affiliate.address,
          condId1,
          betAmount,
          OUTCOMELOSE,
          time + 100,
          0
        );
        res2 = await makeBetGetTokenIdOdds(
          lp,
          core,
          bettor,
          affiliate.address,
          condId2,
          betAmount,
          OUTCOMELOSE,
          time + 100,
          0
        );

        expect(res.odds).to.be.equal(res2.odds);
      });
      it("Change odds to extend available funds", async () => {
        const betAmount = tokens(100);
        const reinforcement = betAmount.mul(2).div(MULTIPLIER);

        await createCondition(core, oracle, gameId, ++condId, [50000, 50000], OUTCOMES, reinforcement, marginality);

        await expect(
          makeBetGetTokenIdOdds(lp, core, bettor, affiliate.address, condId, betAmount, OUTCOMEWIN, time + 100, 0)
        ).to.be.revertedWithCustomError(core, "LargeFundsRatio");

        await core.connect(oracle).changeOdds(condId, [50001, 50000]);
        await makeBetGetTokenId(lp, core, bettor, affiliate.address, condId, betAmount, OUTCOMEWIN, time + 100, 0);
      });
      it("Change odds to break reinforcement limit", async () => {
        const reinforcement = tokens(1);

        await createCondition(core, oracle, gameId, ++condId, [pool2, pool1], OUTCOMES, reinforcement, marginality);

        const balance = await wxDAI.balanceOf(bettor.address);
        const reserves = await lp.getReserve();

        const betAmount = tokens(100);
        const tokensWin = [];
        for (const i of Array(ITERATIONS).keys()) {
          await core.connect(oracle).changeOdds(condId, [1_000_000_000, 1]);
          let { tokenId, odds } = await makeBetGetTokenIdOdds(
            lp,
            core,
            bettor,
            affiliate.address,
            condId,
            betAmount,
            OUTCOMEWIN,
            time + 1000,
            0
          );

          expect(odds).to.be.gte(MULTIPLIER);
          tokensWin.push(tokenId);
        }

        timeShift(time + ONE_HOUR + ONE_MINUTE);
        await core.connect(oracle).resolveCondition(condId, OUTCOMEWIN);

        for (const tokenId of tokensWin) {
          await makeWithdrawPayout(lp, core, bettor, tokenId);
        }
        expect(await wxDAI.balanceOf(bettor.address)).to.be.lte(balance.add(reinforcement));
        expect(await lp.getReserve()).to.be.gte(reserves.sub(reinforcement));
      });
      it("Change odds randomly", async function () {
        await createCondition(core, oracle, gameId, ++condId, [pool2, pool1], OUTCOMES, reinforcement, marginality);
        const lockedLiquidity = await lp.lockedLiquidity();

        let totalNetBets = constants.Zero;
        let payouts = [constants.Zero, constants.Zero];

        for (const i of Array(ITERATIONS).keys()) {
          let [outcome, outcomeIndex] = Math.random() > 1 / 2 ? [OUTCOMEWIN, 0] : [OUTCOMELOSE, 1];
          let betAmount = tokens(Math.floor(Math.random() * 100) + 1);
          let newVirtualFunds;

          // Change odds for 0-2 times
          let nChanges = Math.floor(Math.random() * 3);
          if (nChanges > 0)
            for (const i of Array(nChanges).keys()) {
              let newOdds = [
                BigNumber.from(Math.floor(Math.random() * 100) + 1),
                BigNumber.from(Math.floor(Math.random() * 100) + 1),
              ];

              await core.connect(oracle).changeOdds(condId, newOdds);

              // Check virtual funds changes
              let condition = await core.getCondition(condId);
              let conditionReserve = condition.funds[0].lt(condition.funds[1])
                ? condition.funds[0]
                : condition.funds[1];

              newVirtualFunds = condition.virtualFunds;
              expect(newVirtualFunds[0].add(newVirtualFunds[1])).to.be.equal(conditionReserve);
            }
          else newVirtualFunds = (await core.getCondition(condId)).virtualFunds;

          let odds = await core.calcOdds(condId, betAmount, outcome);

          // Reinforcement limit exceeds
          if (totalNetBets.sub(payouts[outcomeIndex]).lt(odds.mul(betAmount).div(MULTIPLIER).sub(betAmount))) {
            outcomeIndex = 1 - outcomeIndex;
            outcome = OUTCOMES[outcomeIndex];
            odds = await core.calcOdds(condId, betAmount, outcome);
          }

          let res = await makeBetGetTokenIdOdds(
            lp,
            core,
            bettor,
            affiliate.address,
            condId,
            betAmount,
            outcome,
            time + 1000,
            0
          );

          // Check betting odds
          expect(res.odds).to.be.equal(odds);

          let payout = res.odds.mul(betAmount).div(MULTIPLIER);
          payouts[outcomeIndex] = payouts[outcomeIndex].add(payout);
          totalNetBets = totalNetBets.add(betAmount);

          let condition = await core.getCondition(condId);

          // Check condition funds
          for (const outcomeIndex in OUTCOMES) {
            expect(condition.funds[outcomeIndex]).to.be.equal(
              reinforcement.add(totalNetBets).sub(payouts[1 - outcomeIndex])
            );
          }

          // Check virtual funds changes again
          expect(condition.virtualFunds[outcomeIndex]).to.be.equal(newVirtualFunds[outcomeIndex].add(betAmount));
          expect(condition.virtualFunds[1 - outcomeIndex]).to.be.equal(
            newVirtualFunds[1 - outcomeIndex].add(betAmount).sub(payout)
          );
        }

        timeShift(time + ONE_HOUR + ONE_MINUTE);
        await core.connect(oracle).resolveCondition(condId, OUTCOMEWIN);

        // Check locked liquidity
        expect(await lp.lockedLiquidity()).to.be.equal(lockedLiquidity);

        const profit = totalNetBets.gt(payouts[0]) ? totalNetBets.sub(payouts[0]) : ethers.constants.Zero;

        // Check affiliates earnings
        expect((await core.getCondition(condId)).affiliatesReward).to.be.equal(
          profit.mul(affiliateFee).div(MULTIPLIER)
        );

        // Check affiliate reward
        const balance = await wxDAI.balanceOf(affiliate.address);
        await lp.claimAffiliateRewardFor(core.address, getClaimParamsDef(), affiliate.address);

        expect(await wxDAI.balanceOf(affiliate.address)).to.be.equal(
          balance.add(profit.mul(affiliateFee).div(MULTIPLIER))
        );
      });
    });
  });

  describe("Betting", async function () {
    let time, deadline, minrate;
    let betAmount = constants.WeiPerEther.mul(100);
    before(async function () {
      await bettor.sendTransaction({ to: wxDAI.address, value: tokens(20_000_000) });
    });
    beforeEach(async function () {
      // create condition
      time = await getBlockTime(ethers);
      await createGame(lp, oracle, ++gameId, IPFS, time + ONE_HOUR);

      condId++;
      await createCondition(core, oracle, gameId, condId, [pool2, pool1], OUTCOMES, reinforcement, marginality);
    });
    it("Create conditions, make bets, stop one/all/release conditions, make bets", async () => {
      time = await getBlockTime(ethers);
      await createGame(lp, oracle, ++gameId, IPFS, time + ONE_HOUR);

      let condIds = [];
      let tokenWin;

      // create 5 conditions and make bets
      for (const i of Array(5).keys()) {
        condIds.push(++condId);
        await createCondition(core, oracle, gameId, condId, [pool2, pool1], OUTCOMES, reinforcement, marginality);
        tokenWin = makeBetGetTokenId(
          lp,
          core,
          poolOwner,
          affiliate.address,
          condId,
          tokens(100),
          OUTCOMEWIN,
          time + 100,
          0
        );
      }

      // disable core
      await switchCore(lp, core, poolOwner, false);

      // try to make one new condition
      await expect(
        createCondition(core, oracle, gameId, ++condId, [pool2, pool1], OUTCOMES, reinforcement, marginality)
      ).to.be.revertedWithCustomError(lp, "CoreNotActive");

      // try bet on any of conditions will be failed
      for (const i of condIds.keys()) {
        await expect(
          makeBetGetTokenId(lp, core, poolOwner, affiliate.address, condIds[i], tokens(100), OUTCOMEWIN, time + 100, 0)
        ).to.be.revertedWithCustomError(lp, "CoreNotActive");
      }

      // enable core back
      await switchCore(lp, core, poolOwner, true);

      // try incorrect resume condition
      await expect(core.connect(maintainer).stopCondition(condIds[0], false)).to.be.revertedWithCustomError(
        core,
        "CantChangeFlag"
      );
      // stop only one condition (#0)
      await core.connect(maintainer).stopCondition(condIds[0], true);
      // try pause condition again
      await expect(core.connect(maintainer).stopCondition(condIds[0], true)).to.be.revertedWithCustomError(
        core,
        "CantChangeFlag"
      );

      // try bet all conditions, all ok and only one will be failed (#0)
      let tokenIds = [];
      for (const i of condIds.keys()) {
        if (i == 0) {
          await expect(
            makeBetGetTokenId(
              lp,
              core,
              poolOwner,
              affiliate.address,
              condIds[i],
              tokens(100),
              OUTCOMEWIN,
              time + 100,
              0
            )
          ).to.be.revertedWithCustomError(core, "ActionNotAllowed");
        } else {
          tokenIds.push(
            await makeBetGetTokenId(
              lp,
              core,
              poolOwner,
              affiliate.address,
              condIds[i],
              tokens(100),
              OUTCOMEWIN,
              time + 100,
              0
            )
          );
        }
      }

      // release condition (#0)
      await core.connect(maintainer).stopCondition(condIds[0], false);
      // try unpause condition again
      await expect(core.connect(maintainer).stopCondition(condIds[0], false)).to.be.revertedWithCustomError(
        core,
        "CantChangeFlag"
      );

      // bet on release condition (#0) is ok
      tokenIds.push(
        await makeBetGetTokenId(
          lp,
          core,
          poolOwner,
          affiliate.address,
          condIds[0],
          tokens(100),
          OUTCOMEWIN,
          time + 100,
          0
        )
      );

      // disable core again
      await switchCore(lp, core, poolOwner, false);

      // repay bets even if core is disabled
      await timeShiftBy(ethers, ONE_HOUR + ONE_MINUTE);
      for (const i of condIds.keys()) {
        await core.connect(oracle).resolveCondition(condIds[i], OUTCOMEWIN);
      }

      for (const i of tokenIds.keys()) {
        await makeWithdrawPayout(lp, core, poolOwner, tokenIds[i]);
      }

      // enable core back again
      await switchCore(lp, core, poolOwner, true);
    });
    it("Make tiny bets", async () => {
      time = await getBlockTime(ethers);
      await createGame(lp, oracle, ++gameId, IPFS, time + ONE_HOUR);

      await createCondition(core, oracle, gameId, ++condId, [pool2, pool1], OUTCOMES, reinforcement, marginality);

      const betAmount = 1;
      const tokensWin = [],
        tokensLose = [],
        payouts = [];
      for (const _ of Array(ITERATIONS).keys()) {
        time = await getBlockTime(ethers);
        let { tokenId, odds } = await makeBetGetTokenIdOdds(
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
        expect(odds).to.be.gt(MULTIPLIER);
        tokensWin.push(tokenId);
        payouts.push(odds.mul(betAmount).div(MULTIPLIER));

        ({ tokenId, odds } = await makeBetGetTokenIdOdds(
          lp,
          core,
          bettor,
          affiliate.address,
          condId,
          betAmount,
          OUTCOMELOSE,
          time + 100,
          0
        ));
        expect(odds).to.be.gt(MULTIPLIER);
        tokensLose.push(tokenId);
      }

      await timeShiftBy(ethers, ONE_WEEK + ONE_MINUTE);
      await core.connect(oracle).resolveCondition(condId, OUTCOMEWIN);

      let balance = await wxDAI.balanceOf(bettor.address);
      for (const tokenId of tokensLose) {
        await lp.connect(bettor).withdrawPayout(core.address, tokenId, false);
        expect(await wxDAI.balanceOf(bettor.address)).to.be.equal(balance);
      }

      for (const i of tokensWin.keys()) {
        await makeWithdrawPayout(lp, core, bettor, tokensWin[i]);
        balance = balance.add(payouts[i]);
        expect(await wxDAI.balanceOf(bettor.address)).to.be.equal(balance);
      }
    });
    it("Make huge bets", async () => {
      time = await getBlockTime(ethers);
      await createGame(lp, oracle, ++gameId, IPFS, time + ONE_HOUR);

      await createCondition(core, oracle, gameId, ++condId, [pool2, pool1], OUTCOMES, reinforcement, marginality);

      const betAmount = tokens(100000);
      const tokensWin = [],
        tokensLose = [],
        payouts = [];
      for (const _ of Array(ITERATIONS).keys()) {
        time = await getBlockTime(ethers);
        let { tokenId, odds } = await makeBetGetTokenIdOdds(
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
        expect(odds).to.be.gt(MULTIPLIER);
        tokensWin.push(tokenId);
        payouts.push(odds.mul(betAmount).div(MULTIPLIER));

        ({ tokenId, odds } = await makeBetGetTokenIdOdds(
          lp,
          core,
          bettor,
          affiliate.address,
          condId,
          betAmount,
          OUTCOMELOSE,
          time + 100,
          0
        ));
        expect(odds).to.be.gt(MULTIPLIER);
        tokensLose.push(tokenId);
      }

      await timeShiftBy(ethers, ONE_WEEK + ONE_MINUTE);
      await core.connect(oracle).resolveCondition(condId, OUTCOMEWIN);

      let balance = await wxDAI.balanceOf(bettor.address);
      for (const i of tokensWin.keys()) {
        await lp.connect(bettor).withdrawPayout(core.address, tokensLose[i], false);
        expect(await wxDAI.balanceOf(bettor.address)).to.be.equal(balance);

        await lp.connect(bettor).withdrawPayout(core.address, tokensWin[i], false);
        balance = balance.add(payouts[i]);
        expect(await wxDAI.balanceOf(bettor.address)).to.be.equal(balance);
      }
    });
    it("Make huge bet that can't be payed out", async () => {
      time = await getBlockTime(ethers);
      await createGame(lp, oracle, ++gameId, IPFS, time + ONE_HOUR);

      condId++;
      await createCondition(core, oracle, gameId, condId, [pool2, pool1], OUTCOMES, reinforcement, marginality);

      const tokenId = await makeBetGetTokenId(
        lp,
        core,
        bettor,
        affiliate.address,
        condId,
        tokens(7_000_000),
        OUTCOMEWIN,
        time + 100,
        0
      );

      time = await getBlockTime(ethers);
      await timeShift(time + ONE_HOUR + ONE_MINUTE);
      await core.connect(oracle).resolveCondition(condId, OUTCOMEWIN);

      let balBefore = await wxDAI.balanceOf(bettor.address);
      await makeWithdrawPayout(lp, core, bettor, tokenId);
      let balAfter = await wxDAI.balanceOf(bettor.address);
      expect(balAfter.sub(balBefore)).to.be.gt(tokens(7_000_000));
    });
    it("Make bets with tiny odds", async () => {
      time = await getBlockTime(ethers);
      await createGame(lp, oracle, ++gameId, IPFS, time + ONE_HOUR);

      await createCondition(core, oracle, gameId, ++condId, [10, 10000], OUTCOMES, reinforcement, marginality);

      const tokensWin = [],
        payouts = [];
      for (const _ of Array(ITERATIONS).keys()) {
        time = await getBlockTime(ethers);
        let { tokenId, odds } = await makeBetGetTokenIdOdds(
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
        expect(odds).to.be.gt(MULTIPLIER);
        tokensWin.push(tokenId);
        payouts.push(odds.mul(betAmount).div(MULTIPLIER));
      }

      await timeShiftBy(ethers, ONE_WEEK + ONE_MINUTE);
      await core.connect(oracle).resolveCondition(condId, OUTCOMEWIN);

      let balance = await wxDAI.balanceOf(bettor.address);
      for (const i of tokensWin.keys()) {
        await makeWithdrawPayout(lp, core, bettor, tokensWin[i]);
        balance = balance.add(payouts[i]);
        expect(await wxDAI.balanceOf(bettor.address)).to.be.equal(balance);
      }
    });
    it("Make bets with huge odds", async () => {
      time = await getBlockTime(ethers);
      await createGame(lp, oracle, ++gameId, IPFS, time + ONE_HOUR);

      await createCondition(core, oracle, gameId, ++condId, [10000, 10], OUTCOMES, reinforcement, marginality);

      const tokensWin = [],
        payouts = [];
      for (const _ of Array(ITERATIONS).keys()) {
        time = await getBlockTime(ethers);
        let { tokenId, odds } = await makeBetGetTokenIdOdds(
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
        expect(odds).to.be.gt(MULTIPLIER);
        tokensWin.push(tokenId);
        payouts.push(odds.mul(betAmount).div(MULTIPLIER));
      }

      await timeShiftBy(ethers, ONE_WEEK + ONE_MINUTE);
      await core.connect(oracle).resolveCondition(condId, OUTCOMEWIN);

      let balance = await wxDAI.balanceOf(bettor.address);
      for (const i of tokensWin.keys()) {
        await makeWithdrawPayout(lp, core, bettor, tokensWin[i]);
        balance = balance.add(payouts[i]);
        expect(await wxDAI.balanceOf(bettor.address)).to.be.equal(balance);
      }
    });
    it("Make bets with large funds ratio", async () => {
      time = await getBlockTime(ethers);
      await createGame(lp, oracle, ++gameId, IPFS, time + ONE_HOUR);

      await createCondition(core, oracle, gameId, ++condId, [10000, 10], OUTCOMES, betAmount.div(1e9), marginality);

      const tokensWin = [],
        tokensLose = [],
        payouts = [];
      for (const _ of Array(ITERATIONS).keys()) {
        time = await getBlockTime(ethers);
        let { tokenId, odds } = await makeBetGetTokenIdOdds(
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
        expect(odds).to.be.gte(MULTIPLIER);
        tokensWin.push(tokenId);
        payouts.push(odds.mul(betAmount).div(MULTIPLIER));

        ({ tokenId, odds } = await makeBetGetTokenIdOdds(
          lp,
          core,
          bettor,
          affiliate.address,
          condId,
          betAmount,
          OUTCOMELOSE,
          time + 100,
          0
        ));
        expect(odds).to.be.gt(MULTIPLIER);
        tokensLose.push(tokenId);
      }

      await timeShiftBy(ethers, ONE_WEEK + ONE_MINUTE);
      await core.connect(oracle).resolveCondition(condId, OUTCOMEWIN);

      let balance = await wxDAI.balanceOf(bettor.address);
      for (const i of tokensWin.keys()) {
        await lp.connect(bettor).withdrawPayout(core.address, tokensLose[i], false);
        expect(await wxDAI.balanceOf(bettor.address)).to.be.equal(balance);

        await lp.connect(bettor).withdrawPayout(core.address, tokensWin[i], false);
        balance = balance.add(payouts[i]);
        expect(await wxDAI.balanceOf(bettor.address)).to.be.equal(balance);
      }
    });
    it("Make unbalanced bets", async () => {
      time = await getBlockTime(ethers);
      await createGame(lp, oracle, ++gameId, IPFS, time + ONE_HOUR);

      await createCondition(core, oracle, gameId, ++condId, [pool2, pool1], OUTCOMES, reinforcement, marginality);

      const betAmount = tokens(100000);
      const tokensWin = [],
        tokensLose = [],
        payouts = [];
      for (const _ of Array(ITERATIONS).keys()) {
        time = await getBlockTime(ethers);
        let { tokenId, odds } = await makeBetGetTokenIdOdds(
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
        expect(odds).to.be.gt(MULTIPLIER);
        tokensWin.push(tokenId);
        payouts.push(odds.mul(betAmount).div(MULTIPLIER));

        ({ tokenId, odds } = await makeBetGetTokenIdOdds(
          lp,
          core,
          bettor,
          affiliate.address,
          condId,
          1,
          OUTCOMELOSE,
          time + 100,
          0
        ));
        expect(odds).to.be.gt(MULTIPLIER);
        tokensLose.push(tokenId);
      }

      await timeShiftBy(ethers, ONE_WEEK + ONE_MINUTE);
      await core.connect(oracle).resolveCondition(condId, OUTCOMEWIN);

      let balance = await wxDAI.balanceOf(bettor.address);
      for (const i of tokensWin.keys()) {
        await lp.connect(bettor).withdrawPayout(core.address, tokensLose[i], false);
        expect(await wxDAI.balanceOf(bettor.address)).to.be.equal(balance);

        await lp.connect(bettor).withdrawPayout(core.address, tokensWin[i], false);
        balance = balance.add(payouts[i]);
        expect(await wxDAI.balanceOf(bettor.address)).to.be.equal(balance);
      }
    });
    it("Make random bets", async () => {
      const bettors = await ethers.getSigners();

      const winningBets = [],
        losingBets = [];

      const minDegree = 0;
      const extraDegree = Math.floor(Math.log2(tokens(100_000))) - minDegree;
      for (const i of Array(ITERATIONS).keys()) {
        let bettorIndex = Math.floor(Math.random() * bettors.length);
        let bettor = bettors[bettorIndex];
        let outcome = Math.random() > 1 / 2 ? OUTCOMEWIN : OUTCOMELOSE;
        let betAmount = BigNumber.from(2).pow(Math.floor(minDegree + extraDegree * Math.random()));

        await bettor.sendTransaction({ to: wxDAI.address, value: betAmount });
        await wxDAI.connect(bettor).approve(lp.address, tokens(999_999_999_999_999));

        let balBefore = await wxDAI.balanceOf(bettor.address);
        time = await getBlockTime(ethers);
        let { tokenId, odds } = await makeBetGetTokenIdOdds(
          lp,
          core,
          bettor,
          affiliate.address,
          condId,
          betAmount,
          outcome,
          time + 100,
          0
        );
        expect(await wxDAI.balanceOf(bettor.address)).to.be.equal(balBefore.sub(betAmount));
        expect(odds).to.be.gt(MULTIPLIER);

        if (outcome == OUTCOMEWIN) {
          winningBets.push({ bettor: bettor, tokenId: tokenId, payout: odds.mul(betAmount).div(MULTIPLIER) });
        } else losingBets.push({ bettor: bettor, tokenId: tokenId });
      }

      await timeShift(time + ONE_HOUR + ONE_MINUTE);
      core.connect(oracle).resolveCondition(condId, OUTCOMEWIN);

      for (const bet of losingBets) {
        let bettor = bet.bettor;
        let balance = await wxDAI.balanceOf(bettor.address);

        await lp.connect(bettor).withdrawPayout(core.address, bet.tokenId, false);

        expect(await wxDAI.balanceOf(bettor.address)).to.be.equal(balance);
      }

      for (const bet of winningBets) {
        let bettor = bet.bettor;
        let balance = await wxDAI.balanceOf(bettor.address);

        await makeWithdrawPayout(lp, core, bettor, bet.tokenId);

        expect(await wxDAI.balanceOf(bettor.address)).to.be.equal(balance.add(bet.payout));
      }
    });
    it("Make bet for", async () => {
      time = await getBlockTime(ethers);
      await createGame(lp, oracle, ++gameId, IPFS, time + ONE_HOUR);

      await createCondition(core, oracle, gameId, ++condId, [pool2, pool1], OUTCOMES, reinforcement, marginality);

      const daoBal = await wxDAI.balanceOf(poolOwner.address);
      const bettorBal = await wxDAI.balanceOf(bettor.address);

      const betAmount = tokens(100);
      let txBet = await lp.connect(poolOwner).betFor(bettor.address, core.address, betAmount, time + 100, {
        affiliate: affiliate.address,
        data: encodeBetData(condId, OUTCOMEWIN, 0),
      });
      let res = await getTokenIdOdds(core, txBet);

      expect(await wxDAI.balanceOf(poolOwner.address)).to.be.equal(daoBal.sub(betAmount));
      expect(await wxDAI.balanceOf(bettor.address)).to.be.equal(bettorBal);

      expect(await azuroBet.ownerOf(res.tokenId)).to.be.equal(bettor.address);

      const payout = res.odds.mul(betAmount).div(MULTIPLIER);

      await timeShiftBy(ethers, ONE_WEEK + ONE_MINUTE);
      await core.connect(oracle).resolveCondition(condId, OUTCOMEWIN);

      await makeWithdrawPayout(lp, core, bettor, res.tokenId);
      expect(await wxDAI.balanceOf(bettor.address)).to.be.equal(bettorBal.add(payout));
    });
    it("Make withdraw payout for", async () => {
      time = await getBlockTime(ethers);
      await createGame(lp, oracle, ++gameId, IPFS, time + ONE_HOUR);

      await createCondition(core, oracle, gameId, ++condId, [pool2, pool1], OUTCOMES, reinforcement, marginality);

      const betAmount = tokens(100);
      let { tokenId, odds } = await makeBetGetTokenIdOdds(
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

      const poolOwnerBal = await wxDAI.balanceOf(poolOwner.address);
      const bettorBal = await wxDAI.balanceOf(bettor.address);
      expect(await azuroBet.ownerOf(tokenId)).to.be.equal(bettor.address);

      const payout = odds.mul(betAmount).div(MULTIPLIER);

      await timeShiftBy(ethers, ONE_WEEK + ONE_MINUTE);
      await core.connect(oracle).resolveCondition(condId, OUTCOMEWIN);

      await makeWithdrawPayout(lp, core, poolOwner, tokenId);
      expect(await wxDAI.balanceOf(poolOwner.address)).to.be.equal(poolOwnerBal);
      expect(await wxDAI.balanceOf(bettor.address)).to.be.equal(bettorBal.add(payout));

      await expect(makeWithdrawPayout(lp, core, bettor, tokenId)).to.be.revertedWithCustomError(core, "AlreadyPaid");
      await expect(makeWithdrawPayout(lp, core, poolOwner, tokenId)).to.be.revertedWithCustomError(core, "AlreadyPaid");
    });
    it("Make withdraw payout for after bet token transferring", async () => {
      time = await getBlockTime(ethers);
      await createGame(lp, oracle, ++gameId, IPFS, time + ONE_HOUR);

      await createCondition(core, oracle, gameId, ++condId, [pool2, pool1], OUTCOMES, reinforcement, marginality);

      const betAmount = tokens(100);
      const tokenId = await makeBetGetTokenId(
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

      expect(await azuroBet.ownerOf(tokenId)).to.be.equal(bettor.address);
      await azuroBet
        .connect(bettor)
        ["safeTransferFrom(address,address,uint256)"](bettor.address, poolOwner.address, tokenId);

      const poolOwnerBal = await wxDAI.balanceOf(poolOwner.address);
      const bettorBal = await wxDAI.balanceOf(bettor.address);
      expect(await azuroBet.ownerOf(tokenId)).to.be.equal(poolOwner.address);

      await core.connect(oracle).cancelCondition(condId);

      await makeWithdrawPayout(lp, core, bettor, tokenId);
      expect(await wxDAI.balanceOf(poolOwner.address)).to.be.equal(poolOwnerBal.add(betAmount));
      expect(await wxDAI.balanceOf(bettor.address)).to.be.equal(bettorBal);

      await expect(makeWithdrawPayout(lp, core, bettor, tokenId)).to.be.revertedWithCustomError(core, "AlreadyPaid");
      await expect(makeWithdrawPayout(lp, core, poolOwner, tokenId)).to.be.revertedWithCustomError(core, "AlreadyPaid");
    });
    it("Should calculate correct margin", async function () {
      core.connect(oracle).changeOdds(condId, [73000, 100000]);
      expect(await core.calcOdds(condId, 0, OUTCOMEWIN)).to.equal(1658829422886);

      core.connect(oracle).changeOdds(condId, [98000, 100000]);
      expect(await core.calcOdds(condId, 0, OUTCOMEWIN)).to.equal(1886657619097);

      await createCondition(core, oracle, gameId, ++condId, [98000, 100000], OUTCOMES, reinforcement, MULTIPLIER * 0.1);
      expect(await core.calcOdds(condId, 0, OUTCOMEWIN)).to.equal(1801801818366);
    });
    it("Should accept bet only before game starts", async function () {
      await makeBetGetTokenId(lp, core, bettor, affiliate.address, condId, betAmount, OUTCOMEWIN, time + 100, 0);

      await timeShift(time + ONE_HOUR);
      time = await getBlockTime(ethers);

      await expect(
        makeBetGetTokenId(lp, core, bettor, affiliate.address, condId, betAmount, OUTCOMEWIN, time + 100, 0)
      ).to.be.revertedWithCustomError(core, "ActionNotAllowed");
    });
    it("Should except deadline outdated", async function () {
      deadline = time - 10;
      minrate = 0;
      await expect(
        makeBetGetTokenId(lp, core, poolOwner, affiliate.address, condId, betAmount, OUTCOMEWIN, deadline, minrate)
      ).to.be.revertedWithCustomError(lp, "BetExpired");
    });
    it("Should except minrate extended", async function () {
      deadline = time + 10;
      minrate = 9000000000000;
      await expect(
        makeBetGetTokenId(lp, core, poolOwner, affiliate.address, condId, betAmount, OUTCOMEWIN, deadline, minrate)
      ).to.be.revertedWithCustomError(core, "SmallOdds");
    });
    it("Should go through betting workflow with 2 users", async function () {
      const betAmount = constants.WeiPerEther.mul(100);
      time = await getBlockTime(ethers);

      await createGame(lp, oracle, ++gameId, IPFS, time + ONE_HOUR);
      //  EVENT: create condition
      condId++;
      await createCondition(core, oracle, gameId, condId, [pool2, pool1], OUTCOMES, reinforcement, marginality);

      let deadline = time + 10;
      let minrate = await core.calcOdds(condId, betAmount, OUTCOMEWIN);
      let incorrect_minrate = (await core.calcOdds(condId, betAmount, OUTCOMEWIN)).add(1);

      await expect(
        makeBetGetTokenId(
          lp,
          core,
          poolOwner,
          affiliate.address,
          condId,
          betAmount,
          OUTCOMEWIN,
          deadline,
          incorrect_minrate
        )
      ).revertedWithCustomError(core, "SmallOdds");

      let _res1 = await makeBetGetTokenIdOdds(
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

      let tokenWin = _res1.tokenId;
      let payout1 = betAmount.mul(_res1.odds).div(MULTIPLIER);

      expect(await azuroBet.ownerOf(tokenWin)).to.equal(poolOwner.address);
      await azuroBet
        .connect(poolOwner)
        ["safeTransferFrom(address,address,uint256)"](poolOwner.address, bettor.address, tokenWin);
      expect(await azuroBet.ownerOf(tokenWin)).to.equal(bettor.address);

      //  EVENT: second player put the bet
      let _res2 = await makeBetGetTokenIdOdds(
        lp,
        core,
        bettor,
        affiliate.address,
        condId,
        betAmount,
        OUTCOMELOSE,
        deadline,
        minrate
      );
      let tokenLose = _res2.tokenId;

      await timeShift(time + ONE_HOUR + ONE_MINUTE);
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
      await lp.connect(poolOwner).withdrawPayout(core.address, tokenWin, false);
      const bettor1NewBalance = await wxDAI.balanceOf(poolOwner.address);
      expect(bettor1NewBalance).to.equal(bettor1OldBalance.add(payout1));

      // Try to withdraw again, must be reverted
      await expect(lp.connect(poolOwner).withdrawPayout(core.address, tokenWin, false)).to.be.revertedWithCustomError(
        core,
        "AlreadyPaid"
      );

      // Withdraw reward for bet #2 - no payout
      const bettor2OldBalance = await wxDAI.balanceOf(bettor.address);
      await lp.connect(bettor).withdrawPayout(core.address, tokenLose, false);
      const bettor2NewBalance = await wxDAI.balanceOf(bettor.address);

      await expect(bettor2OldBalance).to.equal(bettor2NewBalance);
    });
    it("Should NOT take bet with zero amount", async () => {
      time = await getBlockTime(ethers);
      await createGame(lp, oracle, ++gameId, IPFS, time + ONE_HOUR);

      condId++;
      await createCondition(core, oracle, gameId, condId, [pool2, pool1], OUTCOMES, reinforcement, marginality);

      await expect(
        makeBetGetTokenId(lp, core, poolOwner, affiliate.address, condId, 0, OUTCOMEWIN, time + 100, 0)
      ).to.be.revertedWithCustomError(lp, "SmallBet");

      await expect(
        lp.connect(poolOwner).betFor(bettor.address, core.address, 0, time + 100, {
          affiliate: affiliate.address,
          data: encodeBetData(condId, OUTCOMEWIN, 0),
        })
      ).to.be.revertedWithCustomError(lp, "SmallBet");
    });
    it("Should NOT take bet with incorrect outcome stake", async () => {
      time = await getBlockTime(ethers);
      await createGame(lp, oracle, ++gameId, IPFS, time + ONE_HOUR);

      condId++;
      await createCondition(core, oracle, gameId, condId, [pool2, pool1], OUTCOMES, reinforcement, marginality);

      await expect(
        makeBetGetTokenId(lp, core, poolOwner, affiliate.address, condId, tokens(100), OUTCOMEINCORRECT, time + 100, 0)
      ).to.be.revertedWithCustomError(core, "WrongOutcome");
    });
    it("Should NOT make withdraw payout twice", async () => {
      time = await getBlockTime(ethers);
      await createGame(lp, oracle, ++gameId, IPFS, time + ONE_HOUR);

      await createCondition(core, oracle, gameId, ++condId, [pool2, pool1], OUTCOMES, reinforcement, marginality);

      const betAmount = tokens(100);
      let { tokenId, odds } = await makeBetGetTokenIdOdds(
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

      const bettorBal = await wxDAI.balanceOf(bettor.address);

      const payout = odds.mul(betAmount).div(MULTIPLIER);

      await timeShiftBy(ethers, ONE_WEEK + ONE_MINUTE);
      await core.connect(oracle).resolveCondition(condId, OUTCOMEWIN);

      await makeWithdrawPayout(lp, core, bettor, tokenId);
      expect(await wxDAI.balanceOf(bettor.address)).to.be.equal(bettorBal.add(payout));

      await expect(makeWithdrawPayout(lp, core, bettor, tokenId)).to.be.revertedWithCustomError(core, "AlreadyPaid");
    });
    it("Should NOT make withdraw payout twice for cancelled condition", async () => {
      time = await getBlockTime(ethers);
      await createGame(lp, oracle, ++gameId, IPFS, time + ONE_HOUR);

      await createCondition(core, oracle, gameId, ++condId, [pool2, pool1], OUTCOMES, reinforcement, marginality);

      const bettorBal = await wxDAI.balanceOf(bettor.address);
      const betAmount = tokens(100);
      const tokenId = await makeBetGetTokenId(
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

      await core.connect(oracle).cancelCondition(condId);

      await makeWithdrawPayout(lp, core, bettor, tokenId);
      expect(await wxDAI.balanceOf(bettor.address)).to.be.equal(bettorBal);

      await expect(makeWithdrawPayout(lp, core, bettor, tokenId)).to.be.revertedWithCustomError(core, "AlreadyPaid");
    });
    it("Should NOT take bet less than minimum", async function () {
      time = await getBlockTime(ethers);
      await createGame(lp, oracle, ++gameId, IPFS, time + ONE_HOUR);

      await createCondition(core, oracle, gameId, ++condId, [pool2, pool1], OUTCOMES, reinforcement, marginality);

      const minBetAmount = tokens(10);
      await changeMinBet(lp, core, poolOwner, minBetAmount);

      await expect(
        makeBetGetTokenIdOdds(lp, core, poolOwner, affiliate.address, condId, minBetAmount.sub(1), 1, time + 100, 0)
      ).to.be.revertedWithCustomError(lp, "SmallBet");
      await makeBetGetTokenIdOdds(lp, core, poolOwner, affiliate.address, condId, minBetAmount, 1, time + 100, 0);

      await changeMinBet(lp, core, poolOwner, minBetAmount.add(1));
      await expect(
        makeBetGetTokenIdOdds(lp, core, poolOwner, affiliate.address, condId, minBetAmount, 1, time + 100, 0)
      ).to.be.revertedWithCustomError(lp, "SmallBet");

      await changeMinBet(lp, core, poolOwner, minBetAmount.sub(1));
      await makeBetGetTokenIdOdds(
        lp,
        core,
        poolOwner,
        affiliate.address,
        condId,
        minBetAmount.sub(1),
        1,
        time + 100,
        0
      );
    });
  });

  describe("Reward oracle", function () {
    let factoryOwner, poolOwner, dataProvider, bettor, lpOwner, affiliate, oracle, oracle2, maintainer;
    let access, core, wxDAI, lp;
    let lpNFT, time, condId2;

    let gameId = 0;
    let condId = 0;

    const reinforcement = constants.WeiPerEther.mul(20000); // 10%
    const marginality = MULTIPLIER * 0.05; // 5%

    const minDepo = tokens(10);
    const daoFee = MULTIPLIER * 0.09; // 9%
    const dataProviderFee = MULTIPLIER * 0.01; // 1%
    const affiliateFee = MULTIPLIER * 0.33; // 33%

    const pool1 = 5000000;
    const pool2 = 5000000;

    const betAmount = tokens(100);
    const betAmount2 = tokens(50);

    beforeEach(async () => {
      [factoryOwner, poolOwner, dataProvider, bettor, lpOwner, affiliate, oracle, oracle2, maintainer] =
        await ethers.getSigners();

      ({ access, core, wxDAI, lp, azuroBet, roleIds } = await prepareStand(
        ethers,
        factoryOwner,
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

      lpNFT = await getLPNFTToken(await lp.connect(poolOwner).addLiquidity(minDepo));

      time = await getBlockTime(ethers);
      await createGame(lp, oracle, ++gameId, IPFS, time + ONE_HOUR);

      condId2 = ++condId;
      await createCondition(core, oracle2, gameId, condId2, [pool2, pool1], OUTCOMES, reinforcement, marginality);

      await createCondition(core, oracle, gameId, ++condId, [pool2, pool1], OUTCOMES, reinforcement, marginality);

      await makeBetGetTokenId(lp, core, poolOwner, affiliate.address, condId, tokens(100), OUTCOMELOSE, time + 100, 0);
      await makeBetGetTokenId(lp, core, poolOwner, affiliate.address, condId2, tokens(100), OUTCOMELOSE, time + 100, 0);

      await lp.connect(poolOwner).changeDataProvider(dataProvider.address);

      time = await getBlockTime(ethers);
      timeShift(time + ONE_HOUR + ONE_MINUTE);
    });
    it("Create conditions by different oracles and get reward", async () => {
      let dataProviderBal = await wxDAI.balanceOf(dataProvider.address);
      let daoBal = await wxDAI.balanceOf(factoryOwner.address);

      await core.connect(oracle).resolveCondition(condId, OUTCOMEWIN);
      await core.connect(oracle2).resolveCondition(condId2, OUTCOMEWIN);

      await lp.connect(dataProvider).claimReward();
      expect(await wxDAI.balanceOf(dataProvider.address)).to.be.equal(dataProviderBal.add(tokens(2))); // 1% of 200 tokens

      await lp.connect(factoryOwner).claimReward();
      expect(await wxDAI.balanceOf(factoryOwner.address)).to.be.equal(daoBal.add(tokens(18))); // 9% of 200 tokens
    });
    it("Change fee %", async () => {
      await lp.connect(poolOwner).changeFee(0, FEE5PERCENT); // set DAO fee to 5%
      expect(await lp.fees(0)).to.be.equal(FEE5PERCENT);

      await lp.connect(poolOwner).changeFee(1, FEEHALFPERCENT); // set Data Provider fee to 0.5%
      expect(await lp.fees(1)).to.be.equal(FEEHALFPERCENT);

      await lp.connect(poolOwner).changeFee(2, MULTIPLIER - FEE5PERCENT - FEEHALFPERCENT); // set affiliate fee to 94.5%
      expect(await lp.fees(2)).to.be.equal(MULTIPLIER - FEE5PERCENT - FEEHALFPERCENT);

      await expect(lp.connect(poolOwner).changeFee(0, FEE5PERCENT + 1)).to.be.revertedWithCustomError(
        lp,
        "IncorrectFee"
      );
      await expect(lp.connect(poolOwner).changeFee(1, FEEHALFPERCENT + 1)).to.be.revertedWithCustomError(
        lp,
        "IncorrectFee"
      );
      await expect(
        lp.connect(poolOwner).changeFee(2, MULTIPLIER - FEE5PERCENT - FEEHALFPERCENT + 1)
      ).to.be.revertedWithCustomError(lp, "IncorrectFee");
    });
    it("Change fee %, create conditions by different oracles and get reward", async () => {
      await lp.connect(poolOwner).changeFee(0, FEE5PERCENT); // set DAO fee to 5%
      await lp.connect(poolOwner).changeFee(1, FEEHALFPERCENT); // set Data Provider fee to 0.5%

      let dataProviderBal = await wxDAI.balanceOf(dataProvider.address);
      let daoBal = await wxDAI.balanceOf(factoryOwner.address);

      await core.connect(oracle).resolveCondition(condId, OUTCOMEWIN);
      await core.connect(oracle2).resolveCondition(condId2, OUTCOMEWIN);

      await lp.connect(dataProvider).claimReward();
      expect(await wxDAI.balanceOf(dataProvider.address)).to.be.equal(dataProviderBal.add(tokens(1))); // + 1% of 200 tokens

      await lp.connect(factoryOwner).claimReward();
      expect(await wxDAI.balanceOf(factoryOwner.address)).to.be.equal(daoBal.add(tokens(10))); // + 5% of 200 tokens
    });
    it("Change claim timeout, create conditions and get reward", async () => {
      lp.connect(poolOwner).changeClaimTimeout(ONE_WEEK);

      await core.connect(oracle).resolveCondition(condId, OUTCOMEWIN);

      await lp.connect(dataProvider).claimReward();
      await lp.connect(factoryOwner).claimReward();

      await core.connect(oracle2).resolveCondition(condId2, OUTCOMEWIN);

      time = await getBlockTime(ethers);
      await expect(lp.connect(factoryOwner).claimReward()).to.be.revertedWithCustomError(lp, "ClaimTimeout");

      await createGame(lp, oracle, ++gameId, IPFS, time + ONE_MINUTE);

      condId++;
      await createCondition(core, oracle, gameId, ++condId, [pool2, pool1], OUTCOMES, reinforcement, marginality);
      await makeBetGetTokenId(lp, core, poolOwner, affiliate.address, condId, tokens(100), OUTCOMELOSE, time + 100, 0);

      timeShift(time + 2 * ONE_MINUTE);
      await core.connect(oracle).resolveCondition(condId, OUTCOMEWIN);

      await expect(lp.connect(dataProvider).claimReward()).to.be.revertedWithCustomError(lp, "ClaimTimeout");

      lp.connect(poolOwner).changeClaimTimeout(2 * ONE_MINUTE);
      await lp.connect(dataProvider).claimReward();

      lp.connect(poolOwner).changeClaimTimeout(ONE_WEEK);
      timeShift(time + ONE_WEEK - 5);
      await expect(lp.connect(factoryOwner).claimReward()).to.be.revertedWithCustomError(lp, "ClaimTimeout");

      timeShift(time + ONE_WEEK);
      await lp.connect(factoryOwner).claimReward();
    });
    it("Oracle creates a profitable condition and data provider gets reward", async () => {
      const lpReserve = await lp.getReserve();
      const dataProviderBal = await wxDAI.balanceOf(dataProvider.address);
      const daoBal = await wxDAI.balanceOf(factoryOwner.address);

      time = await getBlockTime(ethers);
      await createGame(lp, oracle, ++gameId, IPFS, time + ONE_HOUR);

      condId++;
      await createCondition(core, oracle, gameId, condId, [pool2, pool1], OUTCOMES, reinforcement, marginality);

      await makeBetGetTokenId(lp, core, bettor, affiliate.address, condId, betAmount, OUTCOMELOSE, time + 100, 0);

      time = await getBlockTime(ethers);
      timeShift(time + ONE_HOUR + ONE_MINUTE);
      await core.connect(oracle).resolveCondition(condId, OUTCOMEWIN);

      await lp.connect(factoryOwner).claimReward();
      const daoReward = betAmount.mul(daoFee).div(MULTIPLIER);
      expect(await wxDAI.balanceOf(factoryOwner.address)).to.be.equal(daoBal.add(daoReward));

      await lp.connect(dataProvider).claimReward();
      const dataProviderReward = betAmount.mul(dataProviderFee).div(MULTIPLIER);
      expect(await wxDAI.balanceOf(dataProvider.address)).to.be.equal(dataProviderBal.add(dataProviderReward));

      const affiliateReward = betAmount.mul(affiliateFee).div(MULTIPLIER);
      expect(await lp.getReserve()).to.be.equal(
        lpReserve.add(betAmount).sub(daoReward.add(dataProviderReward).add(affiliateReward))
      );
    });
    it("Oracle creates a condition with extremely small profit and data provider gets no reward", async () => {
      const lpReserve = await lp.getReserve();
      const dataProviderBal = await wxDAI.balanceOf(dataProvider.address);
      const daoBal = await wxDAI.balanceOf(factoryOwner.address);
      const betAmount = 1;

      time = await getBlockTime(ethers);
      await createGame(lp, oracle, ++gameId, IPFS, time + ONE_HOUR);

      condId++;
      await createCondition(core, oracle, gameId, condId, [pool2, pool1], OUTCOMES, reinforcement, marginality);

      await makeBetGetTokenId(lp, core, bettor, affiliate.address, condId, betAmount, OUTCOMELOSE, time + 100, 0);

      time = await getBlockTime(ethers);
      timeShift(time + ONE_HOUR + ONE_MINUTE);
      await core.connect(oracle).resolveCondition(condId, OUTCOMEWIN);

      await lp.connect(factoryOwner).claimReward();
      expect(await wxDAI.balanceOf(factoryOwner.address)).to.be.equal(daoBal);

      await lp.connect(dataProvider).claimReward();
      expect(await wxDAI.balanceOf(dataProvider.address)).to.be.equal(dataProviderBal);

      expect(await lp.getReserve()).to.be.equal(lpReserve.add(betAmount));
    });
    it("Oracle creates a lose-making condition and gets no reward", async () => {
      const daoBal = await wxDAI.balanceOf(factoryOwner.address);
      const dataProviderBal = await wxDAI.balanceOf(oracle.address);

      time = await getBlockTime(ethers);
      await createGame(lp, oracle, ++gameId, IPFS, time + ONE_HOUR);

      condId++;
      await createCondition(core, oracle, gameId, condId, [pool2, pool1], OUTCOMES, reinforcement, marginality);

      await makeBetGetTokenId(lp, core, bettor, affiliate.address, condId, betAmount, OUTCOMEWIN, time + 100, 0);

      time = await getBlockTime(ethers);
      timeShift(time + ONE_HOUR + ONE_MINUTE);
      await core.connect(oracle).resolveCondition(condId, OUTCOMEWIN);

      await lp.connect(factoryOwner).claimReward();
      expect(await wxDAI.balanceOf(factoryOwner.address)).to.be.equal(daoBal);

      await lp.connect(dataProvider).claimReward();
      expect(await wxDAI.balanceOf(dataProvider.address)).to.be.equal(dataProviderBal);
    });
    it("Oracle creates a lose-making condition after a profitable one and data provider gets reward", async () => {
      let lpReserve = await lp.getReserve();
      const daoBal = await wxDAI.balanceOf(factoryOwner.address);
      const dataProviderBal = await wxDAI.balanceOf(dataProvider.address);

      time = await getBlockTime(ethers);
      await createGame(lp, oracle, ++gameId, IPFS, time + ONE_HOUR);

      const profitCondId = ++condId;
      await createCondition(core, oracle, gameId, profitCondId, [pool2, pool1], OUTCOMES, reinforcement, marginality);

      await makeBetGetTokenId(lp, core, bettor, affiliate.address, condId, betAmount, OUTCOMELOSE, time + 100, 0);

      const lossCondId = ++condId;
      await createCondition(core, oracle, gameId, lossCondId, [pool2, pool1], OUTCOMES, reinforcement, marginality);

      const { odds } = await makeBetGetTokenIdOdds(
        lp,
        core,
        bettor,
        affiliate.address,
        lossCondId,
        betAmount2,
        OUTCOMEWIN,
        time + 100,
        0
      );

      time = await getBlockTime(ethers);
      timeShift(time + ONE_HOUR + ONE_MINUTE);
      await core.connect(oracle).resolveCondition(profitCondId, OUTCOMEWIN);

      const daoReward = betAmount.mul(daoFee).div(MULTIPLIER);
      const dataProviderReward = betAmount.mul(dataProviderFee).div(MULTIPLIER);
      const affiliateReward = betAmount.mul(affiliateFee).div(MULTIPLIER);
      const lpReserveAfter = await lp.getReserve();
      expect(lpReserveAfter).to.be.equal(
        lpReserve.add(betAmount).sub(daoReward.add(dataProviderReward).add(affiliateReward))
      );

      await core.connect(oracle).resolveCondition(lossCondId, OUTCOMEWIN);

      const loss = betAmount2.mul(odds).div(MULTIPLIER).sub(betAmount2);
      const daoLoss = loss.mul(daoFee).div(MULTIPLIER);
      const dataProviderLoss = loss.mul(dataProviderFee).div(MULTIPLIER);
      expect(await lp.getReserve()).to.be.equal(lpReserveAfter.sub(loss.sub(daoLoss.add(dataProviderLoss))));

      await lp.connect(factoryOwner).claimReward();
      expect(await wxDAI.balanceOf(factoryOwner.address)).to.be.equal(daoBal.add(daoReward).sub(daoLoss));

      await lp.connect(dataProvider).claimReward();
      expect(await wxDAI.balanceOf(dataProvider.address)).to.be.equal(
        dataProviderBal.add(dataProviderReward).sub(dataProviderLoss)
      );
    });
    it("Oracle creates a profitable condition after a lose-making one and data provider gets reward", async () => {
      let lpReserve = await lp.getReserve();
      const daoBal = await wxDAI.balanceOf(factoryOwner.address);
      const dataProviderBal = await wxDAI.balanceOf(dataProvider.address);

      time = await getBlockTime(ethers);
      await createGame(lp, oracle, ++gameId, IPFS, time + ONE_HOUR);

      const lossCondId = ++condId;
      await createCondition(core, oracle, gameId, lossCondId, [pool2, pool1], OUTCOMES, reinforcement, marginality);

      const { odds } = await makeBetGetTokenIdOdds(
        lp,
        core,
        bettor,
        affiliate.address,
        condId,
        betAmount2,
        OUTCOMEWIN,
        time + 100,
        0
      );

      const profitCondId = ++condId;
      await createCondition(core, oracle, gameId, profitCondId, [pool2, pool1], OUTCOMES, reinforcement, marginality);

      await makeBetGetTokenId(lp, core, bettor, affiliate.address, profitCondId, betAmount, OUTCOMELOSE, time + 100, 0);

      time = await getBlockTime(ethers);
      timeShift(time + ONE_HOUR + ONE_MINUTE);
      await core.connect(oracle).resolveCondition(lossCondId, OUTCOMEWIN);

      const loss = betAmount2.mul(odds).div(MULTIPLIER).sub(betAmount2);
      const daoLoss = loss.mul(daoFee).div(MULTIPLIER);
      const dataProviderLoss = loss.mul(dataProviderFee).div(MULTIPLIER);
      const lpReserveAfter = await lp.getReserve();
      expect(lpReserveAfter).to.be.equal(lpReserve.sub(loss));

      await core.connect(oracle).resolveCondition(profitCondId, OUTCOMEWIN);

      const daoReward = betAmount.mul(daoFee).div(MULTIPLIER);
      const dataProviderReward = betAmount.mul(dataProviderFee).div(MULTIPLIER);
      const affiliateReward = betAmount.mul(affiliateFee).div(MULTIPLIER);
      expect(await lp.getReserve()).to.be.equal(
        lpReserveAfter
          .add(betAmount)
          .sub(daoReward.add(dataProviderReward).sub(daoLoss).sub(dataProviderLoss).add(affiliateReward))
      );

      await lp.connect(factoryOwner).claimReward();
      expect(await wxDAI.balanceOf(factoryOwner.address)).to.be.equal(daoBal.add(daoReward).sub(daoLoss));

      await lp.connect(dataProvider).claimReward();
      expect(await wxDAI.balanceOf(dataProvider.address)).to.be.equal(
        dataProviderBal.add(dataProviderReward).sub(dataProviderLoss)
      );
    });
    it("Change fee %, create conditions by different oracles and get data provider reward", async () => {
      lp.connect(poolOwner).changeFee(0, FEE5PERCENT); // set DAO fee to 5%
      lp.connect(poolOwner).changeFee(1, FEEHALFPERCENT); // set data provider fee to 0.5%

      let dataProviderBal = await wxDAI.balanceOf(dataProvider.address);
      let daoBal = await wxDAI.balanceOf(factoryOwner.address);

      await core.connect(oracle).resolveCondition(condId, OUTCOMEWIN);
      await core.connect(oracle2).resolveCondition(condId2, OUTCOMEWIN);

      await lp.connect(dataProvider).claimReward();
      expect(await wxDAI.balanceOf(dataProvider.address)).to.be.equal(dataProviderBal.add(tokens(1))); // + 1% of 200 tokens

      await lp.connect(factoryOwner).claimReward();
      expect(await wxDAI.balanceOf(factoryOwner.address)).to.be.equal(daoBal.add(tokens(10))); // + 9% of 200 tokens
    });
    it("Oracle creates a profitable condition and data provider gets reward", async () => {
      const lpReserve = await lp.getReserve();
      const daoBal = await wxDAI.balanceOf(factoryOwner.address);
      const dataProviderBal = await wxDAI.balanceOf(dataProvider.address);

      time = await getBlockTime(ethers);
      await createGame(lp, oracle, ++gameId, IPFS, time + ONE_HOUR);

      condId++;
      await createCondition(core, oracle, gameId, condId, [pool2, pool1], OUTCOMES, reinforcement, marginality);

      await makeBetGetTokenId(lp, core, bettor, affiliate.address, condId, betAmount, OUTCOMELOSE, time + 100, 0);

      time = await getBlockTime(ethers);
      timeShift(time + ONE_HOUR + ONE_MINUTE);
      await core.connect(oracle).resolveCondition(condId, OUTCOMEWIN);

      await lp.connect(factoryOwner).claimReward();
      const daoReward = betAmount.mul(daoFee).div(MULTIPLIER);
      expect(await wxDAI.balanceOf(factoryOwner.address)).to.be.equal(daoBal.add(daoReward));

      await lp.connect(dataProvider).claimReward();
      const dataProviderReward = betAmount.mul(dataProviderFee).div(MULTIPLIER);
      expect(await wxDAI.balanceOf(dataProvider.address)).to.be.equal(dataProviderBal.add(dataProviderReward));

      const affiliateReward = betAmount.mul(affiliateFee).div(MULTIPLIER);
      expect(await lp.getReserve()).to.be.equal(
        lpReserve.add(betAmount).sub(daoReward.add(dataProviderReward).add(affiliateReward))
      );
    });
    it("Oracle creates a lose-making condition after a profitable one and data provider gets reward", async () => {
      let lpReserve = await lp.getReserve();
      const daoBal = await wxDAI.balanceOf(factoryOwner.address);
      const dataProviderBal = await wxDAI.balanceOf(dataProvider.address);

      time = await getBlockTime(ethers);
      await createGame(lp, oracle, ++gameId, IPFS, time + ONE_HOUR);

      const profitCondId = ++condId;
      await createCondition(core, oracle, gameId, profitCondId, [pool2, pool1], OUTCOMES, reinforcement, marginality);

      await makeBetGetTokenId(lp, core, bettor, affiliate.address, profitCondId, betAmount, OUTCOMELOSE, time + 100, 0);

      const lossCondId = ++condId;
      await createCondition(core, oracle, gameId, lossCondId, [pool2, pool1], OUTCOMES, reinforcement, marginality);

      const { odds } = await makeBetGetTokenIdOdds(
        lp,
        core,
        bettor,
        affiliate.address,
        lossCondId,
        betAmount2,
        OUTCOMEWIN,
        time + 100,
        0
      );

      time = await getBlockTime(ethers);
      timeShift(time + ONE_HOUR + ONE_MINUTE);
      await core.connect(oracle).resolveCondition(profitCondId, OUTCOMEWIN);

      const daoReward = betAmount.mul(daoFee).div(MULTIPLIER);
      const dataProviderReward = betAmount.mul(dataProviderFee).div(MULTIPLIER);
      const affiliateReward = betAmount.mul(affiliateFee).div(MULTIPLIER);
      const lpReserveAfter = await lp.getReserve();
      expect(lpReserveAfter).to.be.equal(
        lpReserve.add(betAmount).sub(daoReward.add(dataProviderReward).add(affiliateReward))
      );

      await core.connect(oracle).resolveCondition(lossCondId, OUTCOMEWIN);

      const loss = betAmount2.mul(odds).div(MULTIPLIER).sub(betAmount2);
      const daoLoss = loss.mul(daoFee).div(MULTIPLIER);
      const dataProviderLoss = loss.mul(dataProviderFee).div(MULTIPLIER);
      expect(await lp.getReserve()).to.be.equal(lpReserveAfter.sub(loss.sub(daoLoss.add(dataProviderLoss))));

      await lp.connect(factoryOwner).claimReward();
      expect(await wxDAI.balanceOf(factoryOwner.address)).to.be.equal(daoBal.add(daoReward).sub(daoLoss));

      await lp.connect(dataProvider).claimReward();
      expect(await wxDAI.balanceOf(dataProvider.address)).to.be.equal(
        dataProviderBal.add(dataProviderReward).sub(dataProviderLoss)
      );
    });
    it("Oracle creates a profitable condition after a lose-making one and data provider gets reward", async () => {
      let lpReserve = await lp.getReserve();
      const daoBal = await wxDAI.balanceOf(factoryOwner.address);
      const dataProviderBal = await wxDAI.balanceOf(dataProvider.address);

      time = await getBlockTime(ethers);
      await createGame(lp, oracle, ++gameId, IPFS, time + ONE_HOUR);

      const profitCondId = ++condId;
      await createCondition(core, oracle, gameId, profitCondId, [pool2, pool1], OUTCOMES, reinforcement, marginality);

      const { odds } = await makeBetGetTokenIdOdds(
        lp,
        core,
        bettor,
        affiliate.address,
        condId,
        betAmount2,
        OUTCOMEWIN,
        time + 100,
        0
      );

      const lossCondId = ++condId;
      await createCondition(core, oracle, gameId, lossCondId, [pool2, pool1], OUTCOMES, reinforcement, marginality);

      await makeBetGetTokenId(lp, core, bettor, affiliate.address, lossCondId, betAmount, OUTCOMELOSE, time + 100, 0);

      time = await getBlockTime(ethers);
      timeShift(time + ONE_HOUR + ONE_MINUTE);
      await core.connect(oracle).resolveCondition(profitCondId, OUTCOMEWIN);

      const loss = betAmount2.mul(odds).div(MULTIPLIER).sub(betAmount2);
      const daoLoss = loss.mul(daoFee).div(MULTIPLIER);
      const dataProviderLoss = loss.mul(dataProviderFee).div(MULTIPLIER);
      const lpReserveAfter = await lp.getReserve();
      expect(lpReserveAfter).to.be.equal(lpReserve.sub(loss));

      await core.connect(oracle).resolveCondition(lossCondId, OUTCOMEWIN);

      const daoReward = betAmount.mul(daoFee).div(MULTIPLIER);
      const dataProviderReward = betAmount.mul(dataProviderFee).div(MULTIPLIER);
      const affiliateReward = betAmount.mul(affiliateFee).div(MULTIPLIER);
      expect(await lp.getReserve()).to.be.equal(
        lpReserveAfter
          .add(betAmount)
          .sub(daoReward.add(dataProviderReward).sub(daoLoss).sub(dataProviderLoss).add(affiliateReward))
      );

      await lp.connect(factoryOwner).claimReward();
      expect(await wxDAI.balanceOf(factoryOwner.address)).to.be.equal(daoBal.add(daoReward).sub(daoLoss));

      await lp.connect(dataProvider).claimReward();
      expect(await wxDAI.balanceOf(dataProvider.address)).to.be.equal(
        dataProviderBal.add(dataProviderReward).sub(dataProviderLoss)
      );
    });
    it("Oracle creates a profitable condition and DAO gets reward as data provider", async () => {
      await lp.connect(poolOwner).changeDataProvider(factoryOwner.address);

      const lpReserve = await lp.getReserve();
      const daoBal = await wxDAI.balanceOf(factoryOwner.address);

      time = await getBlockTime(ethers);
      await createGame(lp, oracle, ++gameId, IPFS, time + ONE_HOUR);

      condId++;
      await createCondition(core, oracle, gameId, condId, [pool2, pool1], OUTCOMES, reinforcement, marginality);

      await makeBetGetTokenId(lp, core, bettor, affiliate.address, condId, betAmount, OUTCOMELOSE, time + 100, 0);

      time = await getBlockTime(ethers);
      timeShift(time + ONE_HOUR + ONE_MINUTE);
      await core.connect(oracle).resolveCondition(condId, OUTCOMEWIN);

      await lp.connect(factoryOwner).claimReward();
      const daoReward = betAmount.mul(daoFee + dataProviderFee).div(MULTIPLIER);
      expect(await wxDAI.balanceOf(factoryOwner.address)).to.be.equal(daoBal.add(daoReward));

      const affiliateReward = betAmount.mul(affiliateFee).div(MULTIPLIER);
      expect(await lp.getReserve()).to.be.equal(lpReserve.add(betAmount).sub(daoReward.add(affiliateReward)));
    });
    it("Oracle creates a lose-making condition and DAO gets no reward", async () => {
      const daoBal = await wxDAI.balanceOf(factoryOwner.address);
      await lp.connect(poolOwner).changeDataProvider(factoryOwner.address);

      time = await getBlockTime(ethers);
      await createGame(lp, oracle, ++gameId, IPFS, time + ONE_HOUR);

      condId++;
      await createCondition(core, oracle, gameId, condId, [pool2, pool1], OUTCOMES, reinforcement, marginality);

      await makeBetGetTokenId(lp, core, bettor, affiliate.address, condId, betAmount, OUTCOMEWIN, time + 100, 0);

      time = await getBlockTime(ethers);
      timeShift(time + ONE_HOUR + ONE_MINUTE);
      await core.connect(oracle).resolveCondition(condId, OUTCOMEWIN);

      await lp.connect(factoryOwner).claimReward();
      expect(await wxDAI.balanceOf(factoryOwner.address)).to.be.equal(daoBal);
    });
    it("Oracle creates a profitable condition after a loss-making one and DAO gets reward as data provider", async () => {
      await lp.connect(poolOwner).changeDataProvider(factoryOwner.address);

      let lpReserve = await lp.getReserve();
      const daoBal = await wxDAI.balanceOf(factoryOwner.address);

      time = await getBlockTime(ethers);
      await createGame(lp, oracle, ++gameId, IPFS, time + ONE_HOUR);

      const lossCondId = ++condId;
      await createCondition(core, oracle, gameId, lossCondId, [pool2, pool1], OUTCOMES, reinforcement, marginality);

      await makeBetGetTokenId(lp, core, bettor, affiliate.address, lossCondId, betAmount, OUTCOMELOSE, time + 100, 0);

      const profitCondId = ++condId;
      await createCondition(core, oracle, gameId, profitCondId, [pool2, pool1], OUTCOMES, reinforcement, marginality);

      const { odds } = await makeBetGetTokenIdOdds(
        lp,
        core,
        bettor,
        affiliate.address,
        profitCondId,
        betAmount2,
        OUTCOMEWIN,
        time + 100,
        0
      );

      time = await getBlockTime(ethers);
      timeShift(time + ONE_HOUR + ONE_MINUTE);
      await core.connect(oracle).resolveCondition(lossCondId, OUTCOMEWIN);

      const daoReward = betAmount.mul(daoFee + dataProviderFee).div(MULTIPLIER);
      const affiliateReward = betAmount.mul(affiliateFee).div(MULTIPLIER);
      const lpReserveAfter = await lp.getReserve();
      expect(lpReserveAfter).to.be.equal(lpReserve.add(betAmount).sub(daoReward.add(affiliateReward)));

      await core.connect(oracle).resolveCondition(profitCondId, OUTCOMEWIN);

      const loss = betAmount2.mul(odds).div(MULTIPLIER).sub(betAmount2);
      const daoLoss = loss.mul(daoFee + dataProviderFee).div(MULTIPLIER);
      expect(await lp.getReserve()).to.be.equal(lpReserveAfter.sub(loss.sub(daoLoss)));

      await lp.connect(factoryOwner).claimReward();
      expect(await wxDAI.balanceOf(factoryOwner.address)).to.be.equal(daoBal.add(daoReward).sub(daoLoss));
    });
    it("Oracle creates a profitable condition after a lose-making one and DAO gets reward as data provider", async () => {
      await lp.connect(poolOwner).changeDataProvider(factoryOwner.address);

      let lpReserve = await lp.getReserve();
      const daoBal = await wxDAI.balanceOf(factoryOwner.address);

      time = await getBlockTime(ethers);
      await createGame(lp, oracle, ++gameId, IPFS, time + ONE_HOUR);

      const lossCondId = ++condId;
      await createCondition(core, oracle, gameId, lossCondId, [pool2, pool1], OUTCOMES, reinforcement, marginality);

      const { odds } = await makeBetGetTokenIdOdds(
        lp,
        core,
        bettor,
        affiliate.address,
        condId,
        betAmount2,
        OUTCOMEWIN,
        time + 100,
        0
      );

      const profitCondId = ++condId;
      await createCondition(core, oracle, gameId, profitCondId, [pool2, pool1], OUTCOMES, reinforcement, marginality);

      await makeBetGetTokenId(lp, core, bettor, affiliate.address, profitCondId, betAmount, OUTCOMELOSE, time + 100, 0);

      time = await getBlockTime(ethers);
      timeShift(time + ONE_HOUR + ONE_MINUTE);
      await core.connect(oracle).resolveCondition(lossCondId, OUTCOMEWIN);

      const loss = betAmount2.mul(odds).div(MULTIPLIER).sub(betAmount2);
      const daoLoss = loss.mul(daoFee + dataProviderFee).div(MULTIPLIER);
      const lpReserveAfter = await lp.getReserve();
      expect(lpReserveAfter).to.be.equal(lpReserve.sub(loss));

      await core.connect(oracle).resolveCondition(profitCondId, OUTCOMEWIN);

      const daoReward = betAmount.mul(daoFee + dataProviderFee).div(MULTIPLIER);
      const affiliateReward = betAmount.mul(affiliateFee).div(MULTIPLIER);
      expect(await lp.getReserve()).to.be.equal(
        lpReserveAfter.add(betAmount).sub(daoReward.sub(daoLoss).add(affiliateReward))
      );

      await lp.connect(factoryOwner).claimReward();
      expect(await wxDAI.balanceOf(factoryOwner.address)).to.be.equal(daoBal.add(daoReward).sub(daoLoss));
    });
  });
});
