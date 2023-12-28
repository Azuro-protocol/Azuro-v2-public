const { expect } = require("chai");
const { ethers } = require("hardhat");
const {
  getBlockTime,
  tokens,
  timeShift,
  prepareStand,
  addRole,
  bindRoles,
  grantRole,
  prepareAccess,
  initFixtureTree,
  makeBetGetTokenIdOdds,
} = require("../utils/utils");
const LIQUIDITY = tokens(200000);
const MULTIPLIER = 1e12;
const ONE_DAY = 86400;
const ONE_HOUR = 3600;
const ONE_MINUTE = 60;

const reinforcementCheck = async (
  proxyOracle,
  lp,
  core,
  proxyOracleAccess,
  coreTools,
  poolOwner,
  oracle,
  proxyOracleRoleIds,
  gamesData,
  conditionsData,
  changeData
) => {
  let condition, conditionTarget;

  await proxyOracle.connect(poolOwner).createGames(gamesData);
  await proxyOracle.connect(poolOwner).createConditions(core.address, conditionsData);

  // create check conditions with target margin/reinforcement/odds values
  let conditionsTargetData = [];
  for (let i = 0; i < conditionsData.length; ++i) {
    condition = await core.getCondition(conditionsData[i].conditionId);
    conditionsTargetData.push({
      gameId: conditionsData[i].gameId,
      conditionId: conditionsData[i].conditionId * 10,
      odds: await coreTools.calcOdds(condition.virtualFunds, 0, condition.winningOutcomesCount),
      outcomes: conditionsData[i].outcomes,
      reinforcement: changeData[i].reinforcement,
      margin: changeData[i].margin,
      winningOutcomesCount: conditionsData[i].winningOutcomesCount,
    });
  }
  await proxyOracle.connect(poolOwner).createConditions(core.address, conditionsTargetData);

  await expect(
    proxyOracle.connect(oracle).changeReinforcements(core.address, changeData)
  ).to.be.revertedWithCustomError(proxyOracleAccess, "AccessNotGranted");

  await grantRole(proxyOracleAccess, poolOwner, oracle.address, proxyOracleRoleIds["ReinforcementChanger"]);

  await proxyOracle.connect(oracle).changeReinforcements(core.address, changeData);

  for (let i = 0; i < changeData.length; ++i) {
    condition = await core.getCondition(changeData[i].conditionId);
    conditionTarget = await core.getCondition(conditionsTargetData[i].conditionId);
    let conditionOdds = await coreTools.calcOdds(
      condition.virtualFunds,
      condition.margin,
      condition.winningOutcomesCount
    );
    let conditionTargetOdds = await coreTools.calcOdds(
      conditionTarget.virtualFunds,
      conditionTarget.margin,
      conditionTarget.winningOutcomesCount
    );
    for (let j = 0; j < condition.virtualFunds.length; ++j) {
      expect(condition.virtualFunds[j]).to.be.eq(conditionTarget.virtualFunds[j]);
      expect(conditionOdds[j]).to.be.eq(conditionTargetOdds[j]);
    }
  }
};

describe("ProxyOracle test", function () {
  const wrapLayer = initFixtureTree(ethers.provider);

  const REINFORCEMENT = tokens(20000);
  const MARGINALITY = MULTIPLIER * 0.05; // 5%

  const minDepo = tokens(10);
  const daoFee = MULTIPLIER * 0.09; // 9%
  const dataProviderFee = MULTIPLIER * 0.01; // 1%
  const affiliateFee = MULTIPLIER * 0.6; // 60%

  let dao, poolOwner, dataProvider, oracle, bettor;
  let access, core, lp, proxyOracle, proxyOracleAccess, coreTools;
  let roleIds,
    proxyOracleRoleIds = {};

  let gamesData, conditionsData;
  let wxDAI;

  async function deployAndInit() {
    [dao, poolOwner, dataProvider, affiliate, oracle, bettor, affiliate] = await ethers.getSigners();

    ({ access, core, lp, roleIds, wxDAI } = await prepareStand(
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

    const Access = await ethers.getContractFactory("Access", { signer: poolOwner });
    proxyOracleAccess = await upgrades.deployProxy(Access);
    await proxyOracleAccess.deployed();

    const ProxyOracle = await ethers.getContractFactory("ProxyOracle", { signer: poolOwner });
    proxyOracle = await upgrades.deployProxy(ProxyOracle, [proxyOracleAccess.address, lp.address]);
    await proxyOracle.deployed();

    const LibraryMock = await ethers.getContractFactory("LibraryMock");
    coreTools = await LibraryMock.deploy();
    await coreTools.deployed();

    // The DAO is set because ERC721 does not allow to mint to the zero address
    await prepareAccess(access, poolOwner, proxyOracle.address, dao.address, proxyOracle.address, roleIds);

    for (const role of [
      "GameCreator",
      "GameCanceler",
      "GameShifter",
      "ConditionCreator",
      "ConditionCanceler",
      "ConditionResolver",
      "ConditionStopper",
      "OddsChanger",
      "MarginChanger",
      "ReinforcementChanger",
    ]) {
      proxyOracleRoleIds[role] = await addRole(proxyOracleAccess, poolOwner, role);
    }
    const rolesData = [
      { target: proxyOracle.address, selector: "0xd58cf784", roleId: proxyOracleRoleIds["GameCreator"] }, // createGames
      { target: proxyOracle.address, selector: "0xf3897bfd", roleId: proxyOracleRoleIds["GameCanceler"] }, // cancelGames
      { target: proxyOracle.address, selector: "0x954093c4", roleId: proxyOracleRoleIds["GameShifter"] }, // shiftGames
      { target: proxyOracle.address, selector: "0x32823bc8", roleId: proxyOracleRoleIds["ConditionCreator"] }, // createConditions
      { target: proxyOracle.address, selector: "0x829b9682", roleId: proxyOracleRoleIds["ConditionCanceler"] }, // cancelConditions
      { target: proxyOracle.address, selector: "0xd9d0f338", roleId: proxyOracleRoleIds["ConditionResolver"] }, // resolveConditions
      { target: proxyOracle.address, selector: "0xa7d2cc49", roleId: proxyOracleRoleIds["ConditionStopper"] }, // stopConditions
      { target: proxyOracle.address, selector: "0x91e65804", roleId: proxyOracleRoleIds["OddsChanger"] }, // changeOdds
      { target: proxyOracle.address, selector: "0xbe918c6b", roleId: proxyOracleRoleIds["MarginChanger"] }, // changeMargins
      { target: proxyOracle.address, selector: "0x7cfccc25", roleId: proxyOracleRoleIds["ReinforcementChanger"] }, // changeReinforcements
    ];
    await bindRoles(proxyOracleAccess, poolOwner, rolesData);
    await grantRole(proxyOracleAccess, poolOwner, poolOwner.address, proxyOracleRoleIds["GameCreator"]);
    await grantRole(proxyOracleAccess, poolOwner, poolOwner.address, proxyOracleRoleIds["ConditionCreator"]);
  }

  wrapLayer(deployAndInit);

  before(async function () {
    const time = await getBlockTime(ethers);
    gamesData = [];
    for (const i of Array(3).keys()) {
      gamesData.push({
        gameId: i + 1,
        startsAt: time + (i + 1) * ONE_DAY,
        data: [],
      });
    }

    conditionsData = [];
    for (let i = 0; i < gamesData.length; ++i) {
      conditionsData.push({
        gameId: gamesData[i].gameId,
        conditionId: 10 * (i + 1),
        odds: [1, 1 + i],
        outcomes: [i + 1, (i + 1) * 2],
        reinforcement: REINFORCEMENT.mul(i + 1),
        margin: MARGINALITY * (i + 1),
        winningOutcomesCount: 1,
      });
    }
  });

  context("Check functions execution and access restrictions", function () {
    it("Create games", async () => {
      await expect(proxyOracle.connect(oracle).createGames(gamesData)).to.be.revertedWithCustomError(
        proxyOracleAccess,
        "AccessNotGranted"
      );

      const accessToken = await grantRole(
        proxyOracleAccess,
        poolOwner,
        oracle.address,
        proxyOracleRoleIds["GameCreator"]
      );
      await proxyOracle.connect(oracle).createGames(gamesData);
      for (const data of gamesData) {
        const game = await lp.games(data.gameId);
        expect(game.startsAt).to.be.equal(data.startsAt);
      }

      await proxyOracleAccess.connect(poolOwner).burn(accessToken);
      await expect(proxyOracle.connect(oracle).createGames(gamesData)).to.be.revertedWithCustomError(
        proxyOracleAccess,
        "AccessNotGranted"
      );
    });
    it("Cancel games", async () => {
      await proxyOracle.connect(poolOwner).createGames(gamesData);

      const gameIds = [];
      for (let i = 0; i < gamesData.length; ++i) {
        gameIds.push(gamesData[i].gameId);
      }
      await expect(proxyOracle.connect(oracle).cancelGames(gameIds)).to.be.revertedWithCustomError(
        proxyOracleAccess,
        "AccessNotGranted"
      );

      const accessToken = await grantRole(
        proxyOracleAccess,
        poolOwner,
        oracle.address,
        proxyOracleRoleIds["GameCanceler"]
      );
      await proxyOracle.connect(oracle).cancelGames(gameIds);
      for (const gameId of gameIds) {
        expect(await lp.isGameCanceled(gameId)).to.be.equal(true);
      }

      await proxyOracleAccess.connect(poolOwner).burn(accessToken);
      await expect(proxyOracle.connect(oracle).cancelGames(gameIds)).to.be.revertedWithCustomError(
        proxyOracleAccess,
        "AccessNotGranted"
      );
    });
    it("Shift games", async () => {
      await proxyOracle.connect(poolOwner).createGames(gamesData);

      const time = await getBlockTime(ethers);
      const shiftGamesData = [];
      for (let i = 0; i < gamesData.length; ++i) {
        shiftGamesData.push({
          gameId: gamesData[i].gameId,
          startsAt: time + (i + 1) * ONE_HOUR,
        });
      }
      await expect(proxyOracle.connect(oracle).shiftGames(shiftGamesData)).to.be.revertedWithCustomError(
        proxyOracleAccess,
        "AccessNotGranted"
      );

      const accessToken = await grantRole(
        proxyOracleAccess,
        poolOwner,
        oracle.address,
        proxyOracleRoleIds["GameShifter"]
      );
      await proxyOracle.connect(oracle).shiftGames(shiftGamesData);
      for (const data of shiftGamesData) {
        const game = await lp.games(data.gameId);
        expect(game.startsAt).to.be.equal(data.startsAt);
      }

      await proxyOracleAccess.connect(poolOwner).burn(accessToken);
      await expect(proxyOracle.connect(oracle).shiftGames(shiftGamesData)).to.be.revertedWithCustomError(
        proxyOracleAccess,
        "AccessNotGranted"
      );
    });
    it("Create conditions", async () => {
      await proxyOracle.connect(poolOwner).createGames(gamesData);

      await expect(
        proxyOracle.connect(oracle).createConditions(core.address, conditionsData)
      ).to.be.revertedWithCustomError(proxyOracleAccess, "AccessNotGranted");

      const accessToken = await grantRole(
        proxyOracleAccess,
        poolOwner,
        oracle.address,
        proxyOracleRoleIds["ConditionCreator"]
      );
      await proxyOracle.connect(oracle).createConditions(core.address, conditionsData);
      for (const data of conditionsData) {
        const condition = await core.getCondition(data.conditionId);
        const oddsSum = data.odds[0] + data.odds[1];
        expect(condition.gameId).to.be.equal(data.gameId);
        expect(condition.virtualFunds[0]).to.be.equal(data.reinforcement.mul(data.odds[1]).div(oddsSum));
        expect(condition.virtualFunds[0]).to.be.equal(data.reinforcement.mul(data.odds[1]).div(oddsSum));
        expect(condition.reinforcement).to.be.equal(data.reinforcement);
        expect(condition.margin).to.be.equal(data.margin);
        expect(condition.winningOutcomesCount).to.be.equal(data.winningOutcomesCount);
        expect(await core.outcomeNumbers(data.conditionId, data.outcomes[0])).to.be.equal(1); // outcomeIndex (0) + 1
        expect(await core.outcomeNumbers(data.conditionId, data.outcomes[1])).to.be.equal(2); // outcomeIndex (1) + 1
      }

      await proxyOracleAccess.connect(poolOwner).burn(accessToken);
      await expect(
        proxyOracle.connect(oracle).createConditions(core.address, conditionsData)
      ).to.be.revertedWithCustomError(proxyOracleAccess, "AccessNotGranted");
    });
    it("Cancel conditions", async () => {
      await proxyOracle.connect(poolOwner).createGames(gamesData);
      await proxyOracle.connect(poolOwner).createConditions(core.address, conditionsData);

      const conditionIds = [];
      for (let i = 0; i < conditionsData.length; ++i) {
        conditionIds.push(conditionsData[i].conditionId);
      }
      await expect(
        proxyOracle.connect(oracle).cancelConditions(core.address, conditionIds)
      ).to.be.revertedWithCustomError(proxyOracleAccess, "AccessNotGranted");

      const accessToken = await grantRole(
        proxyOracleAccess,
        poolOwner,
        oracle.address,
        proxyOracleRoleIds["ConditionCanceler"]
      );
      await proxyOracle.connect(oracle).cancelConditions(core.address, conditionIds);
      for (const conditionId of conditionIds) {
        const condition = await core.getCondition(conditionId);
        expect(condition.state).to.be.equal(2 /* CANCELED */);
      }

      await proxyOracleAccess.connect(poolOwner).burn(accessToken);
      await expect(
        proxyOracle.connect(oracle).cancelConditions(core.address, conditionIds)
      ).to.be.revertedWithCustomError(proxyOracleAccess, "AccessNotGranted");
    });
    it("Resolve conditions", async () => {
      await proxyOracle.connect(poolOwner).createGames(gamesData);
      await proxyOracle.connect(poolOwner).createConditions(core.address, conditionsData);
      timeShift(gamesData[2].startsAt + ONE_MINUTE);

      const resolveConditionsData = [];
      for (let i = 0; i < conditionsData.length; ++i) {
        resolveConditionsData.push({
          conditionId: conditionsData[i].conditionId,
          winningOutcomes: [conditionsData[i].outcomes[1]],
        });
      }
      await expect(
        proxyOracle.connect(oracle).resolveConditions(core.address, resolveConditionsData)
      ).to.be.revertedWithCustomError(proxyOracleAccess, "AccessNotGranted");

      const accessToken = await grantRole(
        proxyOracleAccess,
        poolOwner,
        oracle.address,
        proxyOracleRoleIds["ConditionResolver"]
      );
      await proxyOracle.connect(oracle).resolveConditions(core.address, resolveConditionsData);
      for (const data of resolveConditionsData) {
        expect(await core.isOutcomeWinning(data.conditionId, data.winningOutcomes[0])).to.be.equal(true);
      }

      await proxyOracleAccess.connect(poolOwner).burn(accessToken);
      await expect(
        proxyOracle.connect(oracle).resolveConditions(core.address, resolveConditionsData)
      ).to.be.revertedWithCustomError(proxyOracleAccess, "AccessNotGranted");
    });
    it("Stop conditions", async () => {
      await proxyOracle.connect(poolOwner).createGames(gamesData);
      await proxyOracle.connect(poolOwner).createConditions(core.address, conditionsData);

      const stopConditionsData = [];
      for (let i = 0; i < conditionsData.length; ++i) {
        stopConditionsData.push({
          conditionId: conditionsData[i].conditionId,
          flag: true,
        });
      }
      await expect(
        proxyOracle.connect(oracle).stopConditions(core.address, stopConditionsData)
      ).to.be.revertedWithCustomError(proxyOracleAccess, "AccessNotGranted");

      const accessToken = await grantRole(
        proxyOracleAccess,
        poolOwner,
        oracle.address,
        proxyOracleRoleIds["ConditionStopper"]
      );
      await proxyOracle.connect(oracle).stopConditions(core.address, stopConditionsData);
      for (const data of stopConditionsData) {
        const condition = await core.getCondition(data.conditionId);
        expect(condition.state).to.be.equal(3 /* STOPPED */);
      }

      await proxyOracleAccess.connect(poolOwner).burn(accessToken);
      await expect(
        proxyOracle.connect(oracle).stopConditions(core.address, stopConditionsData)
      ).to.be.revertedWithCustomError(proxyOracleAccess, "AccessNotGranted");
    });
    it("Change odds", async () => {
      await proxyOracle.connect(poolOwner).createGames(gamesData);
      await proxyOracle.connect(poolOwner).createConditions(core.address, conditionsData);

      const changeOddsData = [];
      for (let i = 0; i < conditionsData.length; ++i) {
        changeOddsData.push({
          conditionId: conditionsData[i].conditionId,
          odds: [1, 2 + i],
        });
      }
      await expect(proxyOracle.connect(oracle).changeOdds(core.address, changeOddsData)).to.be.revertedWithCustomError(
        proxyOracleAccess,
        "AccessNotGranted"
      );

      const accessToken = await grantRole(
        proxyOracleAccess,
        poolOwner,
        oracle.address,
        proxyOracleRoleIds["OddsChanger"]
      );
      await proxyOracle.connect(oracle).changeOdds(core.address, changeOddsData);
      for (const data of changeOddsData) {
        const condition = await core.getCondition(data.conditionId);
        const oddsSum = data.odds[0] + data.odds[1];
        expect(condition.virtualFunds[0]).to.be.equal(condition.reinforcement.mul(data.odds[1]).div(oddsSum));
        expect(condition.virtualFunds[1]).to.be.equal(condition.reinforcement.mul(data.odds[0]).div(oddsSum));
      }

      await proxyOracleAccess.connect(poolOwner).burn(accessToken);
      await expect(proxyOracle.connect(oracle).changeOdds(core.address, changeOddsData)).to.be.revertedWithCustomError(
        proxyOracleAccess,
        "AccessNotGranted"
      );
    });
    it("Change margin", async () => {
      await proxyOracle.connect(poolOwner).createGames(gamesData);
      await proxyOracle.connect(poolOwner).createConditions(core.address, conditionsData);

      const changeDataIncorrect = [];
      for (let i = 0; i < conditionsData.length; ++i) {
        changeDataIncorrect.push({
          conditionId: conditionsData[i].conditionId,
          margin: MULTIPLIER + 1,
          reinforcement: (await core.getCondition(conditionsData[i].conditionId)).reinforcement,
        });
      }

      const changeData = [];
      for (let i = 0; i < conditionsData.length; ++i) {
        changeData.push({
          conditionId: conditionsData[i].conditionId,
          margin: MULTIPLIER * 0.01 * i,
          reinforcement: (await core.getCondition(conditionsData[i].conditionId)).reinforcement,
          winningOutcomesCount: conditionsData[i].winningOutcomesCount,
        });
      }
      await expect(proxyOracle.connect(oracle).changeMargins(core.address, changeData)).to.be.revertedWithCustomError(
        proxyOracleAccess,
        "AccessNotGranted"
      );

      const accessToken = await grantRole(
        proxyOracleAccess,
        poolOwner,
        oracle.address,
        proxyOracleRoleIds["MarginChanger"]
      );

      await expect(
        proxyOracle.connect(oracle).changeMargins(core.address, changeDataIncorrect)
      ).to.be.revertedWithCustomError(core, "IncorrectMargin");

      await proxyOracle.connect(oracle).changeMargins(core.address, changeData);

      let condition;
      for (let index = 0; index < changeData.length; index++) {
        condition = await core.getCondition(changeData[index].conditionId);
        expect(condition.margin).to.be.eq(changeData[index].margin);
      }

      await proxyOracleAccess.connect(poolOwner).burn(accessToken);
      await expect(proxyOracle.connect(oracle).changeMargins(core.address, changeData)).to.be.revertedWithCustomError(
        proxyOracleAccess,
        "AccessNotGranted"
      );
    });
    it("Change up reinforcement", async () => {
      const changeData = [];
      for (let i = 0; i < conditionsData.length; ++i) {
        changeData.push({
          conditionId: conditionsData[i].conditionId,
          margin: conditionsData[i].margin,
          reinforcement: REINFORCEMENT.mul(i + 2),
          winningOutcomesCount: conditionsData[i].winningOutcomesCount,
        });
      }
      await reinforcementCheck(
        proxyOracle,
        lp,
        core,
        proxyOracleAccess,
        coreTools,
        poolOwner,
        oracle,
        proxyOracleRoleIds,
        gamesData,
        conditionsData,
        changeData
      );
    });
    it("Change down reinforcement", async () => {
      const changeData = [];
      for (let i = 0; i < conditionsData.length; ++i) {
        changeData.push({
          conditionId: conditionsData[i].conditionId,
          margin: conditionsData[i].margin,
          reinforcement: REINFORCEMENT.mul(i + 1).div(2),
          winningOutcomesCount: conditionsData[i].winningOutcomesCount,
        });
      }

      await reinforcementCheck(
        proxyOracle,
        lp,
        core,
        proxyOracleAccess,
        coreTools,
        poolOwner,
        oracle,
        proxyOracleRoleIds,
        gamesData,
        conditionsData,
        changeData
      );
    });
    it("Change down reinforcement after bet", async () => {
      await proxyOracle.connect(poolOwner).createGames(gamesData);
      await proxyOracle.connect(poolOwner).createConditions(core.address, conditionsData);

      const time = await getBlockTime(ethers);
      for (let i = 0; i < conditionsData.length; ++i) {
        await makeBetGetTokenIdOdds(
          lp,
          core,
          bettor,
          affiliate.address,
          conditionsData[i].conditionId,
          tokens(100),
          conditionsData[i].outcomes[0],
          time + ONE_DAY,
          0
        );
      }

      const changeData = [];
      for (let i = 0; i < conditionsData.length; ++i) {
        changeData.push({
          conditionId: conditionsData[i].conditionId,
          margin: 0,
          reinforcement: 0,
          winningOutcomesCount: conditionsData[i].winningOutcomesCount,
        });
      }

      await grantRole(proxyOracleAccess, poolOwner, oracle.address, proxyOracleRoleIds["ReinforcementChanger"]);
      await expect(
        proxyOracle.connect(oracle).changeReinforcements(core.address, changeData)
      ).to.be.revertedWithCustomError(core, "IncorrectReinforcement");

      for (let i = 0; i < conditionsData.length; ++i) {
        changeData[i].reinforcement = conditionsData[i].reinforcement;
      }

      await expect(
        proxyOracle.connect(oracle).changeReinforcements(core.address, changeData)
      ).to.be.revertedWithCustomError(core, "NothingChanged");
    });
    it("Change margin and reinforcement together", async () => {
      await proxyOracle.connect(poolOwner).createGames(gamesData);
      await proxyOracle.connect(poolOwner).createConditions(core.address, conditionsData);

      const changeDataNothingChanged = [];
      for (let i = 0; i < conditionsData.length; ++i) {
        const condition = await core.getCondition(conditionsData[i].conditionId);
        changeDataNothingChanged.push({
          conditionId: conditionsData[i].conditionId,
          margin: condition.margin,
          reinforcement: condition.reinforcement,
        });
      }

      const changeData = [];
      for (let i = 0; i < conditionsData.length; ++i) {
        changeData.push({
          conditionId: conditionsData[i].conditionId,
          margin: MULTIPLIER * 0.01 * i,
          reinforcement: REINFORCEMENT.add(tokens(100)),
        });
      }

      await grantRole(proxyOracleAccess, poolOwner, oracle.address, proxyOracleRoleIds["ReinforcementChanger"]);

      await expect(
        proxyOracle.connect(oracle).changeConditionSettings(core.address, changeDataNothingChanged)
      ).to.be.revertedWithCustomError(proxyOracle, "NothingChanged");

      await proxyOracle.connect(oracle).changeConditionSettings(core.address, changeData);

      let condition;
      for (let index = 0; index < changeData.length; index++) {
        condition = await core.getCondition(changeData[index].conditionId);
        expect(condition.margin).to.be.eq(changeData[index].margin);
        expect(condition.reinforcement).to.be.eq(changeData[index].reinforcement);
      }
    });
  });
  context("Check restrictions", function () {
    it("Oracle CAN NOT create condition with reinforcement larger than limit", async () => {
      await proxyOracle.connect(poolOwner).createGames([gamesData[0]]);
      await proxyOracle.connect(poolOwner).changeReinforcementLimit(conditionsData[0].reinforcement.sub(1));
      await grantRole(proxyOracleAccess, poolOwner, oracle.address, proxyOracleRoleIds["ConditionCreator"]);

      await expect(
        proxyOracle.connect(oracle).createConditions(core.address, [conditionsData[0]])
      ).to.be.revertedWithCustomError(proxyOracle, "TooLargeReinforcement");

      await proxyOracle.connect(poolOwner).changeReinforcementLimit(conditionsData[0].reinforcement);
      await proxyOracle.connect(oracle).createConditions(core.address, [conditionsData[0]]);
    });
  });
});
