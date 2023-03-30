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
} = require("../utils/utils");

const LIQUIDITY = tokens(200000);

const MULTIPLIER = 1e12;

const ONE_DAY = 86400;
const ONE_HOUR = 3600;
const ONE_MINUTE = 60;

describe("ProxyOracle test", function () {
  const wrapLayer = initFixtureTree(ethers.provider);

  const REINFORCEMENT = tokens(20000);
  const MARGINALITY = MULTIPLIER * 0.05; // 5%

  const minDepo = tokens(10);
  const daoFee = MULTIPLIER * 0.09; // 9%
  const dataProviderFee = MULTIPLIER * 0.01; // 1%
  const affiliateFee = MULTIPLIER * 0.33; // 33%

  let dao, poolOwner, dataProvider, oracle, bettor;
  let access, core, lp, proxyOracle, proxyOracleAccess;
  let roleIds,
    proxyOracleRoleIds = {};

  let gamesData, conditionsData;

  async function deployAndInit() {
    [dao, poolOwner, dataProvider, oracle, bettor] = await ethers.getSigners();

    ({ access, core, lp, roleIds } = await prepareStand(
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

    const Access = await ethers.getContractFactory("Access", { signer: poolOwner });
    proxyOracleAccess = await upgrades.deployProxy(Access);
    await proxyOracleAccess.deployed();

    const ProxyOracle = await ethers.getContractFactory("ProxyOracle", { signer: poolOwner });
    proxyOracle = await upgrades.deployProxy(ProxyOracle, [proxyOracleAccess.address, lp.address]);
    await proxyOracle.deployed();

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
    ]) {
      proxyOracleRoleIds[role] = await addRole(proxyOracleAccess, poolOwner, role);
    }
    const rolesData = [
      { target: proxyOracle.address, selector: "0xdcf0ac81", roleId: proxyOracleRoleIds["GameCreator"] }, // createGame
      { target: proxyOracle.address, selector: "0xf3897bfd", roleId: proxyOracleRoleIds["GameCanceler"] }, // cancelGame
      { target: proxyOracle.address, selector: "0x954093c4", roleId: proxyOracleRoleIds["GameShifter"] }, // shiftGame
      { target: proxyOracle.address, selector: "0x3f562a00", roleId: proxyOracleRoleIds["ConditionCreator"] }, // createCondition
      { target: proxyOracle.address, selector: "0x829b9682", roleId: proxyOracleRoleIds["ConditionCanceler"] }, // cancelCondition
      { target: proxyOracle.address, selector: "0xca2c602d", roleId: proxyOracleRoleIds["ConditionResolver"] }, // resolveCondition
      { target: proxyOracle.address, selector: "0xa7d2cc49", roleId: proxyOracleRoleIds["ConditionStopper"] }, // stopCondition
      { target: proxyOracle.address, selector: "0xcc09bd38", roleId: proxyOracleRoleIds["OddsChanger"] }, // changeOdds
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
        ipfsHash: ethers.utils.formatBytes32String(i + 1),
        startsAt: time + (i + 1) * ONE_DAY,
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
        expect(game.ipfsHash).to.be.equal(data.ipfsHash);
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
        expect(condition.gameId).to.be.equal(data.gameId);
        expect(condition.virtualFunds[0]).to.be.equal(
          data.reinforcement.mul(data.odds[1]).div(data.odds[0] + data.odds[1])
        );
        expect(condition.virtualFunds[1]).to.be.equal(data.reinforcement.sub(condition.virtualFunds[0]));
        expect(condition.outcomes[0]).to.be.equal(data.outcomes[0]);
        expect(condition.outcomes[1]).to.be.equal(data.outcomes[1]);
        expect(condition.reinforcement).to.be.equal(data.reinforcement);
        expect(condition.margin).to.be.equal(data.margin);
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
          outcomeWin: conditionsData[i].outcomes[1],
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
        const condition = await core.getCondition(data.conditionId);
        expect(condition.outcomeWin).to.be.equal(data.outcomeWin);
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
        expect(condition.virtualFunds[0]).to.be.equal(
          condition.reinforcement.mul(data.odds[1]).div(data.odds[0] + data.odds[1])
        );
        expect(condition.virtualFunds[1]).to.be.equal(condition.reinforcement.sub(condition.virtualFunds[0]));
      }

      await proxyOracleAccess.connect(poolOwner).burn(accessToken);
      await expect(proxyOracle.connect(oracle).changeOdds(core.address, changeOddsData)).to.be.revertedWithCustomError(
        proxyOracleAccess,
        "AccessNotGranted"
      );
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
