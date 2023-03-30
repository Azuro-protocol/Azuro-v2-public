const { expect } = require("chai");
const { ethers } = require("hardhat");
const {
  deployContracts,
  getBlockTime,
  tokens,
  createGame,
  timeShift,
  prepareStand,
  bindRoles,
  grantRole,
  prepareAccess,
  prepareRoles,
  getPluggedCore,
} = require("../utils/utils");

const createCondition = async (
  safeOracle,
  oracle,
  core,
  gameId,
  condId,
  pools,
  outcomes,
  reinforcement,
  margin,
  proposeDeadline
) => {
  await safeOracle
    .connect(oracle)
    .createCondition(core.address, gameId, condId, pools, outcomes, reinforcement, margin, proposeDeadline);
};

const LIQUIDITY = tokens(200000);
const INSURANCE = tokens(100).sub(1); // an odd INSURANCE value may cause additional errors.

const OUTCOMEWIN = 1;
const OUTCOMELOSE = 2;
const OUTCOMEINCORRECT = 3;
const IPFS = ethers.utils.formatBytes32String("ipfs");

const MULTIPLIER = 1e12;

const ONE_DAY = 86400;
const ONE_HOUR = 3600;
const ONE_MINUTE = 60;

describe("🛡️ SafeOracle test", function () {
  const REINFORCEMENT = tokens(20000);
  const MARGINALITY = MULTIPLIER * 0.05; // 5%

  const minDepo = tokens(10);
  const daoFee = MULTIPLIER * 0.09; // 9%
  const dataProviderFee = MULTIPLIER * 0.01; // 1%
  const affiliateFee = MULTIPLIER * 0.33; // 33%

  const pool1 = 5000000;
  const pool2 = 5000000;

  const DISPUTE_PERIOD = 300;

  let dao, poolOwner, dataProvider, oracle, oracle2, maintainer, affiliate, bettor, disputer;
  let SafeOracle;
  let factory, access, core, azuroBet, wxDAI, affiliateHelper, lp, safeOracle;
  let decisionPeriod;
  let roleIds, time, balance;

  let gameId = 0;
  let condId = 0;

  before(async function () {
    [dao, poolOwner, dataProvider, oracle, oracle2, maintainer, bettor, affiliate, disputer] =
      await ethers.getSigners();

    ({ factory, access, core, azuroBet, wxDAI, affiliateHelper, lp, roleIds } = await prepareStand(
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

    SafeOracle = await ethers.getContractFactory("SafeOracle");

    safeOracle = await upgrades.deployProxy(SafeOracle, [factory.address, wxDAI.address, INSURANCE, DISPUTE_PERIOD]);
    await safeOracle.deployed();

    await grantRole(access, poolOwner, safeOracle.address, roleIds.oracle);

    const mintAmount = INSURANCE.mul(1000);
    for (const signer of [oracle, disputer]) {
      await signer.sendTransaction({ to: wxDAI.address, value: mintAmount });
      await wxDAI.connect(signer).approve(safeOracle.address, mintAmount);
    }

    decisionPeriod = (await safeOracle.DECISION_PERIOD()).toNumber();
  });
  beforeEach(async function () {
    if (!(await lp.fees(0)).eq(daoFee)) await lp.connect(poolOwner).changeFee(0, daoFee);
    if (!(await safeOracle.disputePeriod()).eq(DISPUTE_PERIOD))
      await safeOracle.connect(dao).changeDisputePeriod(DISPUTE_PERIOD);
    if (!(await safeOracle.insurance()).eq(INSURANCE)) await safeOracle.connect(dao).changeInsurance(INSURANCE);

    for (const signer of [oracle, disputer, dao]) {
      const balance = await safeOracle.balanceOf(signer.address);
      if (balance.gt(0)) await safeOracle.connect(signer).withdraw(balance);
    }

    time = await getBlockTime(ethers);
    await createGame(lp, oracle, ++gameId, IPFS, time + ONE_HOUR);
  });
  describe("Common use cases", function () {
    beforeEach(async function () {
      balance = await wxDAI.balanceOf(oracle.address);
      await createCondition(
        safeOracle,
        oracle,
        core,
        gameId,
        ++condId,
        [pool2, pool1],
        [OUTCOMEWIN, OUTCOMELOSE],
        REINFORCEMENT,
        MARGINALITY,
        time + ONE_DAY
      );
    });
    it("Oracle creates condition and fully pays for the insurance with ERC20 token", async () => {
      expect(await wxDAI.balanceOf(oracle.address)).to.be.equal(balance.sub(INSURANCE));

      const condition = await core.getCondition(condId);
      expect(condition.gameId).to.be.equal(gameId);
      expect(condition.funds[0]).to.be.equal(REINFORCEMENT);
      expect(condition.funds[1]).to.be.equal(REINFORCEMENT);
      expect(condition.outcomes[0]).to.be.equal(OUTCOMEWIN);
      expect(condition.outcomes[1]).to.be.equal(OUTCOMELOSE);
      expect(condition.margin).to.be.equal(MARGINALITY);
    });
    it("Oracle creates condition and fully pays for the insurance from the balance remaining in the contract", async () => {
      await timeShift(time + ONE_HOUR + ONE_MINUTE);
      await safeOracle.connect(oracle)["resolveCondition(address,uint256,uint64)"](core.address, condId, OUTCOMEWIN);

      time = await getBlockTime(ethers);
      await timeShift(time + DISPUTE_PERIOD);
      await safeOracle.connect(bettor).applyProposal(core.address, condId);
      expect(await safeOracle.balanceOf(oracle.address)).to.be.equal(INSURANCE);

      time = await getBlockTime(ethers);
      await createGame(lp, oracle, ++gameId, IPFS, time + ONE_HOUR);
      await createCondition(
        safeOracle,
        oracle,
        core,
        gameId,
        ++condId,
        [pool2, pool1],
        [OUTCOMEWIN, OUTCOMELOSE],
        REINFORCEMENT,
        MARGINALITY,
        time + ONE_DAY
      );

      expect(await wxDAI.balanceOf(oracle.address)).to.be.equal(balance.sub(INSURANCE));
      expect(await safeOracle.balanceOf(oracle.address)).to.be.equal(0);
    });
    it("Oracle creates condition and pays a part of the insurance from the balance remaining in the contract", async () => {
      await timeShift(time + ONE_HOUR + ONE_MINUTE);
      await safeOracle.connect(oracle)["resolveCondition(address,uint256,uint64)"](core.address, condId, OUTCOMEWIN);

      time = await getBlockTime(ethers);
      await timeShift(time + DISPUTE_PERIOD);
      await safeOracle.connect(bettor).applyProposal(core.address, condId);
      expect(await safeOracle.balanceOf(oracle.address)).to.be.equal(INSURANCE);

      const withdrawAmount = tokens(1);
      await safeOracle.connect(oracle).withdraw(withdrawAmount);
      expect(await wxDAI.balanceOf(oracle.address)).to.be.equal(balance.sub(INSURANCE.sub(withdrawAmount)));
      expect(await safeOracle.balanceOf(oracle.address)).to.be.equal(INSURANCE.sub(withdrawAmount));

      time = await getBlockTime(ethers);
      await createGame(lp, oracle, ++gameId, IPFS, time + ONE_HOUR);
      await createCondition(
        safeOracle,
        oracle,
        core,
        gameId,
        ++condId,
        [pool2, pool1],
        [OUTCOMEWIN, OUTCOMELOSE],
        REINFORCEMENT,
        MARGINALITY,
        time + ONE_DAY
      );

      expect(await wxDAI.balanceOf(oracle.address)).to.be.equal(balance.sub(INSURANCE));
      expect(await safeOracle.balanceOf(oracle.address)).to.be.equal(0);
    });
    it("Oracle creates condition and pays for the insurance with changed amount", async () => {
      const insurance = tokens(123);
      await safeOracle.connect(dao).changeInsurance(insurance);

      balance = await wxDAI.balanceOf(oracle.address);
      await createCondition(
        safeOracle,
        oracle,
        core,
        gameId,
        ++condId,
        [pool2, pool1],
        [OUTCOMEWIN, OUTCOMELOSE],
        REINFORCEMENT,
        MARGINALITY,
        time + ONE_DAY
      );

      expect(await wxDAI.balanceOf(oracle.address)).to.be.equal(balance.sub(insurance));
    });
    it("Oracle creates 2 conditions and pays the insurance twice", async () => {
      await createCondition(
        safeOracle,
        oracle,
        core,
        gameId,
        ++condId,
        [pool2, pool1],
        [OUTCOMEWIN, OUTCOMELOSE],
        REINFORCEMENT,
        MARGINALITY,
        time + ONE_DAY
      );

      expect(await wxDAI.balanceOf(oracle.address)).to.be.equal(balance.sub(INSURANCE.mul(2)));
    });
    it("Oracle provides 'resolve' solution that accepted without dispute", async () => {
      let condition = await core.getCondition(condId);
      expect(condition.state).to.be.equal(0 /* CREATED */);

      await timeShift(time + ONE_HOUR + ONE_MINUTE);
      await safeOracle.connect(oracle)["resolveCondition(address,uint256,uint64)"](core.address, condId, OUTCOMEWIN);

      time = await getBlockTime(ethers);
      await timeShift(time + DISPUTE_PERIOD);
      await safeOracle.connect(bettor).applyProposal(core.address, condId);

      condition = await core.getCondition(condId);
      expect(condition.state).to.be.equal(1 /* RESOLVED */);
      expect(condition.outcomeWin).to.be.equal(OUTCOMEWIN);
    });
    it("Oracle provides 'resolve' solution of 2 conditions with the same id  in different cores that accepted without dispute", async () => {
      const PrematchCore = await ethers.getContractFactory("PrematchCore", {
        signer: poolOwner,
        libraries: {
          AffiliateHelper: affiliateHelper.address,
        },
        unsafeAllowCustomTypes: true,
      });

      const txPlugCore = await factory.connect(poolOwner).plugCore(lp.address, "pre-match");
      const core2 = await PrematchCore.attach(await getPluggedCore(txPlugCore));

      const roleIds2 = await prepareRoles(access, poolOwner, lp, core2);
      await grantRole(access, poolOwner, oracle.address, roleIds2.oracle);
      await grantRole(access, poolOwner, safeOracle.address, roleIds2.oracle);

      await createCondition(
        safeOracle,
        oracle,
        core2,
        gameId,
        condId,
        [pool2, pool1],
        [OUTCOMEWIN, OUTCOMELOSE],
        REINFORCEMENT,
        MARGINALITY,
        time + ONE_DAY
      );

      for (const _core of [core, core2]) {
        let condition = await _core.getCondition(condId);
        expect(condition.state).to.be.equal(0 /* CREATED */);

        await timeShift(time + ONE_HOUR + ONE_MINUTE);
        await safeOracle.connect(oracle)["resolveCondition(address,uint256,uint64)"](_core.address, condId, OUTCOMEWIN);

        time = await getBlockTime(ethers);
        await timeShift(time + DISPUTE_PERIOD);
        await safeOracle.connect(bettor).applyProposal(_core.address, condId);

        condition = await _core.getCondition(condId);
        expect(condition.state).to.be.equal(1 /* RESOLVED */);
        expect(condition.outcomeWin).to.be.equal(OUTCOMEWIN);
      }
    });
    it("Oracle provides no solution inside of a resolve period so the DAO resolves the condition", async () => {
      await timeShift(time + ONE_DAY);
      await safeOracle.connect(dao)["resolveCondition(address,uint256,uint64)"](core.address, condId, OUTCOMEWIN);
      expect(await safeOracle.balanceOf(oracle.address)).to.be.equal(0);
      expect(await safeOracle.balanceOf(dao.address)).to.be.equal(INSURANCE);

      const condition = await core.getCondition(condId);
      expect(condition.state).to.be.equal(1 /* RESOLVED */);
      expect(condition.outcomeWin).to.be.equal(OUTCOMEWIN);
    });
    it("Oracle provides solution that can't be executed so the DAO resolves the condition", async () => {
      await timeShift(time + ONE_HOUR + ONE_MINUTE);
      await safeOracle
        .connect(oracle)
        ["resolveCondition(address,uint256,uint64)"](core.address, condId, OUTCOMEINCORRECT);

      time = await getBlockTime(ethers);
      await timeShift(time + DISPUTE_PERIOD);
      await safeOracle.connect(bettor).applyProposal(core.address, condId);

      await safeOracle.connect(dao)["resolveCondition(address,uint256,uint64)"](core.address, condId, OUTCOMEWIN);
      expect(await safeOracle.balanceOf(oracle.address)).to.be.equal(0);
      expect(await safeOracle.balanceOf(dao.address)).to.be.equal(INSURANCE);

      const condition = await core.getCondition(condId);
      expect(condition.state).to.be.equal(1 /* RESOLVED */);
      expect(condition.outcomeWin).to.be.equal(OUTCOMEWIN);
    });
    it("Oracle provides solution and cancels condition in dispute period", async () => {
      await timeShift(time + ONE_HOUR + ONE_MINUTE);
      await safeOracle.connect(oracle)["resolveCondition(address,uint256,uint64)"](core.address, condId, OUTCOMEWIN);

      await core.connect(oracle).cancelCondition(condId);
      await safeOracle.connect(bettor).handleCanceledCondition(core.address, condId);

      expect(await safeOracle.balanceOf(oracle.address)).to.be.equal(0);
      expect(await safeOracle.balanceOf(dao.address)).to.be.equal(INSURANCE);
    });
    it("Oracle provides solution and cancels condition after dispute starts", async () => {
      await timeShift(time + ONE_HOUR + ONE_MINUTE);
      await safeOracle.connect(oracle)["resolveCondition(address,uint256,uint64)"](core.address, condId, OUTCOMEWIN);

      await safeOracle.connect(disputer).dispute(core.address, condId);
      await core.connect(oracle).cancelCondition(condId);
      await safeOracle.connect(bettor).handleCanceledCondition(core.address, condId);

      expect(await safeOracle.balanceOf(oracle.address)).to.be.equal(0);
      expect(await safeOracle.balanceOf(disputer.address)).to.be.equal(INSURANCE.div(2));
      expect(await safeOracle.balanceOf(dao.address)).to.be.equal(INSURANCE);
    });
    it("Oracle provides solution and cancels condition after dispute period", async () => {
      await timeShift(time + ONE_HOUR + ONE_MINUTE);
      await safeOracle.connect(oracle)["resolveCondition(address,uint256,uint64)"](core.address, condId, OUTCOMEWIN);

      await core.connect(oracle).cancelCondition(condId);
      time = await getBlockTime(ethers);
      await timeShift(time + DISPUTE_PERIOD);
      await safeOracle.connect(bettor).handleCanceledCondition(core.address, condId);

      expect(await safeOracle.balanceOf(oracle.address)).to.be.equal(0);
      expect(await safeOracle.balanceOf(dao.address)).to.be.equal(INSURANCE);
    });
    it("Oracle cancels condition and reports about it before propose deadline ", async () => {
      await core.connect(oracle).cancelCondition(condId);
      await safeOracle.connect(bettor).handleCanceledCondition(core.address, condId);

      expect(await safeOracle.balanceOf(oracle.address)).to.be.equal(INSURANCE);
      expect(await safeOracle.balanceOf(dao.address)).to.be.equal(0);
    });
    it("Oracle cancels condition and reports about it after propose deadline", async () => {
      time = await getBlockTime(ethers);
      await timeShift(time + ONE_DAY);
      await core.connect(oracle).cancelCondition(condId);
      await safeOracle.connect(bettor).handleCanceledCondition(core.address, condId);

      expect(await safeOracle.balanceOf(oracle.address)).to.be.equal(0);
      expect(await safeOracle.balanceOf(dao.address)).to.be.equal(INSURANCE);
    });
    it("Oracle cancels condition and reports about it after propose deadline + decision period", async () => {
      time = await getBlockTime(ethers);
      await timeShift(time + ONE_DAY + decisionPeriod);
      await core.connect(oracle).cancelCondition(condId);
      await safeOracle.connect(bettor).handleCanceledCondition(core.address, condId);

      expect(await safeOracle.balanceOf(oracle.address)).to.be.equal(0);
      expect(await safeOracle.balanceOf(dao.address)).to.be.equal(INSURANCE);
    });
    it("Oracle claims its balance", async () => {
      await timeShift(time + ONE_HOUR + ONE_MINUTE);
      await safeOracle.connect(oracle)["resolveCondition(address,uint256,uint64)"](core.address, condId, OUTCOMEWIN);

      time = await getBlockTime(ethers);
      await timeShift(time + DISPUTE_PERIOD);
      await safeOracle.connect(bettor).applyProposal(core.address, condId);
      expect(await wxDAI.balanceOf(oracle.address)).to.be.equal(balance.sub(INSURANCE));
      expect(await safeOracle.balanceOf(oracle.address)).to.be.equal(INSURANCE);

      await safeOracle.connect(oracle).withdraw(INSURANCE);
      expect(await wxDAI.balanceOf(oracle.address)).to.be.equal(balance);
      expect(await safeOracle.balanceOf(oracle.address)).to.be.equal(0);
    });
    it("The DAO satisfies dispute with another solution", async () => {
      const disputerBalance = await wxDAI.balanceOf(disputer.address);
      await timeShift(time + ONE_HOUR + ONE_MINUTE);
      await safeOracle
        .connect(oracle)
        ["resolveCondition(address,uint256,uint64)"](core.address, condId, OUTCOMEINCORRECT);
      await safeOracle.connect(disputer).dispute(core.address, condId);
      expect(await wxDAI.balanceOf(disputer.address)).to.be.equal(disputerBalance.sub(INSURANCE.div(2)));

      await safeOracle.connect(dao)["resolveCondition(address,uint256,uint64)"](core.address, condId, OUTCOMEWIN);
      expect(await safeOracle.balanceOf(oracle.address)).to.be.equal(0);
      expect(await safeOracle.balanceOf(disputer.address)).to.be.equal(INSURANCE);
      expect(await safeOracle.balanceOf(dao.address)).to.be.equal(INSURANCE.div(2));

      const condition = await core.getCondition(condId);
      expect(condition.state).to.be.equal(1 /* RESOLVED */);
      expect(condition.outcomeWin).to.be.equal(OUTCOMEWIN);
    });
    it("The DAO satisfies dispute with canceling condition", async () => {
      const disputerBalance = await wxDAI.balanceOf(disputer.address);
      await timeShift(time + ONE_HOUR + ONE_MINUTE);
      await safeOracle
        .connect(oracle)
        ["resolveCondition(address,uint256,uint64)"](core.address, condId, OUTCOMEINCORRECT);
      await safeOracle.connect(disputer).dispute(core.address, condId);
      expect(await wxDAI.balanceOf(disputer.address)).to.be.equal(disputerBalance.sub(INSURANCE.div(2)));

      await safeOracle.connect(dao).cancelCondition(core.address, condId);
      expect(await safeOracle.balanceOf(oracle.address)).to.be.equal(0);
      expect(await safeOracle.balanceOf(disputer.address)).to.be.equal(INSURANCE);
      expect(await safeOracle.balanceOf(dao.address)).to.be.equal(INSURANCE.div(2));

      const condition = await core.getCondition(condId);
      expect(condition.state).to.be.equal(2 /* RESOLVED */);
    });
    it("The DAO rejects dispute", async () => {
      await timeShift(time + ONE_HOUR + ONE_MINUTE);
      await safeOracle.connect(oracle)["resolveCondition(address,uint256,uint64)"](core.address, condId, OUTCOMEWIN);
      await safeOracle.connect(disputer).dispute(core.address, condId);

      await safeOracle.connect(dao).approve(core.address, condId);
      expect(await safeOracle.balanceOf(oracle.address)).to.be.equal(INSURANCE);
      expect(await safeOracle.balanceOf(disputer.address)).to.be.equal(0);
      expect(await safeOracle.balanceOf(dao.address)).to.be.equal(INSURANCE.div(2));

      const condition = await core.getCondition(condId);
      expect(condition.state).to.be.equal(1 /* RESOLVED */);
      expect(condition.outcomeWin).to.be.equal(OUTCOMEWIN);
    });
    it("The DAO rejects dispute after changing dispute period", async () => {
      const disputePeriod = 900;
      await safeOracle.connect(dao).changeDisputePeriod(disputePeriod);

      await createCondition(
        safeOracle,
        oracle,
        core,
        gameId,
        ++condId,
        [pool2, pool1],
        [OUTCOMEWIN, OUTCOMELOSE],
        REINFORCEMENT,
        MARGINALITY,
        time + ONE_DAY
      );

      await timeShift(time + ONE_HOUR + ONE_MINUTE);
      await safeOracle.connect(oracle)["resolveCondition(address,uint256,uint64)"](core.address, condId, OUTCOMEWIN);

      time = await getBlockTime(ethers);
      await timeShift(time + disputePeriod - 10);
      await safeOracle.connect(disputer).dispute(core.address, condId);

      await safeOracle.connect(dao).approve(core.address, condId);
      expect(await safeOracle.balanceOf(oracle.address)).to.be.equal(INSURANCE);
      expect(await safeOracle.balanceOf(disputer.address)).to.be.equal(0);
      expect(await safeOracle.balanceOf(dao.address)).to.be.equal(INSURANCE.div(2));

      const condition = await core.getCondition(condId);
      expect(condition.state).to.be.equal(1 /* RESOLVED */);
      expect(condition.outcomeWin).to.be.equal(OUTCOMEWIN);
    });
    it("The DAO does not resolve dispute inside of the decision period so condition is canceled", async () => {
      await timeShift(time + ONE_HOUR + ONE_MINUTE);
      await safeOracle.connect(oracle)["resolveCondition(address,uint256,uint64)"](core.address, condId, OUTCOMEWIN);
      await safeOracle.connect(disputer).dispute(core.address, condId);

      time = await getBlockTime(ethers);
      await timeShift(time + DISPUTE_PERIOD + decisionPeriod);
      await safeOracle.connect(bettor).applyCancelCondition(core.address, condId);
      expect(await safeOracle.balanceOf(oracle.address)).to.be.equal(INSURANCE);
      expect(await safeOracle.balanceOf(disputer.address)).to.be.equal(INSURANCE.div(2));
      expect(await safeOracle.balanceOf(dao.address)).to.be.equal(0);

      const condition = await core.getCondition(condId);
      expect(condition.state).to.be.equal(2 /* CANCELED */);
    });
    it("Oracle provides solution that can't be executed without dispute", async () => {
      await timeShift(time + ONE_HOUR + ONE_MINUTE);
      await safeOracle
        .connect(oracle)
        ["resolveCondition(address,uint256,uint64)"](core.address, condId, OUTCOMEINCORRECT);

      time = await getBlockTime(ethers);
      await timeShift(time + DISPUTE_PERIOD);
      await safeOracle.connect(bettor).applyProposal(core.address, condId);
      expect(await safeOracle.balanceOf(oracle.address)).to.be.equal(0);
      expect(await safeOracle.balanceOf(dao.address)).to.be.equal(0);
      let condition = await core.getCondition(condId);
      expect(condition.state).to.be.equal(0 /* CREATED */);

      time = await getBlockTime(ethers);
      await timeShift(time + decisionPeriod);
      await safeOracle.connect(bettor).applyCancelCondition(core.address, condId);
      expect(await safeOracle.balanceOf(oracle.address)).to.be.equal(INSURANCE);
      expect(await safeOracle.balanceOf(dao.address)).to.be.equal(0);

      condition = await core.getCondition(condId);
      expect(condition.state).to.be.equal(2 /* CANCELED */);
    });
    it("Oracle provide solution that can't be executed but the DAO does not resolve dispute inside of the decision period", async () => {
      await timeShift(time + ONE_HOUR + ONE_MINUTE);
      await safeOracle
        .connect(oracle)
        ["resolveCondition(address,uint256,uint64)"](core.address, condId, OUTCOMEINCORRECT);
      await safeOracle.connect(disputer).dispute(core.address, condId);

      time = await getBlockTime(ethers);
      await timeShift(time + DISPUTE_PERIOD + decisionPeriod);
      await safeOracle.connect(bettor).applyCancelCondition(core.address, condId);
      expect(await safeOracle.balanceOf(oracle.address)).to.be.equal(INSURANCE);
      expect(await safeOracle.balanceOf(disputer.address)).to.be.equal(INSURANCE.div(2));
      expect(await safeOracle.balanceOf(dao.address)).to.be.equal(0);

      const condition = await core.getCondition(condId);
      expect(condition.state).to.be.equal(2 /* CANCELED */);
    });
  });
  describe("Check restrictions", function () {
    describe("Prepare", function () {
      it("Condition CAN NOT be interacted with if it does not created before", async () => {
        const incorrectCondId = 0;

        await expect(
          safeOracle.connect(dao).handleCanceledCondition(core.address, incorrectCondId)
        ).to.be.revertedWithCustomError(safeOracle, "ConditionDoesNotExist");
        await expect(
          safeOracle.connect(dao).applyCancelCondition(core.address, incorrectCondId)
        ).to.be.revertedWithCustomError(core, "ConditionNotExists");
        await expect(safeOracle.connect(dao).approve(core.address, incorrectCondId)).to.be.revertedWithCustomError(
          core,
          "ConditionNotExists"
        );
        await expect(
          safeOracle.connect(dao)["resolveCondition(address,uint256,uint64)"](core.address, incorrectCondId, OUTCOMEWIN)
        ).to.be.revertedWithCustomError(core, "ConditionNotExists");
        await expect(
          safeOracle.connect(dao)["resolveCondition(address,uint256,uint64)"](core.address, incorrectCondId, OUTCOMEWIN)
        ).to.be.revertedWithCustomError(core, "ConditionNotExists");
        await expect(safeOracle.connect(dao).dispute(core.address, incorrectCondId)).to.be.revertedWithCustomError(
          core,
          "ConditionNotExists"
        );
        await expect(
          safeOracle.connect(dao).applyProposal(core.address, incorrectCondId)
        ).to.be.revertedWithCustomError(core, "ConditionNotExists");
      });
      it("Condition CAN NOT be created by a non-oracle", async () => {
        await expect(
          createCondition(
            safeOracle,
            dao,
            core,
            gameId,
            ++condId,
            [pool2, pool1],
            [OUTCOMEWIN, OUTCOMELOSE],
            REINFORCEMENT,
            MARGINALITY,
            time + ONE_DAY
          )
        ).to.be.revertedWithCustomError(access, "AccessNotGranted");
      });
      it("Condition CAN NOT be created if the propose deadline is in the past", async () => {
        await expect(
          createCondition(
            safeOracle,
            oracle,
            core,
            gameId,
            ++condId,
            [pool2, pool1],
            [OUTCOMEWIN, OUTCOMELOSE],
            REINFORCEMENT,
            MARGINALITY,
            time - 1
          )
        ).to.be.revertedWithCustomError(safeOracle, "IncorrectProposeDeadline");
      });
      it("Condition CAN NOT be created by an oracle that have not enough funds to pay for the insurance", async () => {
        await wxDAI.connect(oracle2).approve(safeOracle.address, INSURANCE);
        await expect(
          createCondition(
            safeOracle,
            oracle2,
            core,
            gameId,
            ++condId,
            [pool2, pool1],
            [OUTCOMEWIN, OUTCOMELOSE],
            REINFORCEMENT,
            MARGINALITY,
            time + ONE_DAY
          )
        ).to.be.revertedWith("TransferHelper::transferFrom: transferFrom failed");
      });
      it("Condition CAN NOT be created on a core that doesn't belong to the Factory", async () => {
        const { affiliateHelper } = await deployContracts(ethers, dao);
        const PrematchCore = await ethers.getContractFactory("PrematchCore", {
          signer: poolOwner,
          libraries: {
            AffiliateHelper: affiliateHelper.address,
          },
          unsafeAllowCustomTypes: true,
        });
        const core2 = await upgrades.deployProxy(PrematchCore, [azuroBet.address, lp.address], {
          unsafeAllowLinkedLibraries: true,
        });

        await bindRoles(access, poolOwner, [{ target: core2.address, selector: "0xc6600c7c", roleId: roleIds.oracle }]);

        await expect(
          createCondition(
            safeOracle,
            oracle,
            core2,
            gameId,
            ++condId,
            [pool2, pool1],
            [OUTCOMEWIN, OUTCOMELOSE],
            REINFORCEMENT,
            MARGINALITY,
            time + ONE_DAY
          )
        ).to.be.revertedWithCustomError(lp, "UnknownCore");
      });
      it("Condition CAN NOT be created twice", async () => {
        await createCondition(
          safeOracle,
          oracle,
          core,
          gameId,
          ++condId,
          [pool2, pool1],
          [OUTCOMEWIN, OUTCOMELOSE],
          REINFORCEMENT,
          MARGINALITY,
          time + ONE_DAY
        );
        await expect(
          createCondition(
            safeOracle,
            oracle,
            core,
            gameId,
            condId,
            [pool2, pool1],
            [OUTCOMEWIN, OUTCOMELOSE],
            REINFORCEMENT,
            MARGINALITY,
            time + ONE_DAY
          )
        ).to.be.revertedWithCustomError(core, "ConditionAlreadyCreated");
      });
      it("Condition CAN NOT be created if it is already created directly through the core", async () => {
        await core
          .connect(oracle)
          .createCondition(gameId, ++condId, [pool2, pool1], [OUTCOMEWIN, OUTCOMELOSE], REINFORCEMENT, MARGINALITY);
        await expect(
          createCondition(
            safeOracle,
            oracle,
            core,
            gameId,
            condId,
            [pool2, pool1],
            [OUTCOMEWIN, OUTCOMELOSE],
            REINFORCEMENT,
            MARGINALITY,
            time + ONE_DAY
          )
        ).to.be.revertedWithCustomError(safeOracle, "ConditionAlreadyCreated");
      });
    });
    describe("Propose", function () {
      beforeEach(async function () {
        await createCondition(
          safeOracle,
          oracle,
          core,
          gameId,
          ++condId,
          [pool2, pool1],
          [OUTCOMEWIN, OUTCOMELOSE],
          REINFORCEMENT,
          MARGINALITY,
          time + ONE_DAY
        );

        await timeShift(time + ONE_HOUR + ONE_MINUTE);
      });
      it("Solution CAN NOT be proposed by an oracle outside of the resolve period", async () => {
        await timeShift(time + ONE_DAY);
        await expect(
          safeOracle.connect(oracle)["resolveCondition(address,uint256,uint64)"](core.address, condId, OUTCOMEWIN)
        ).to.be.revertedWithCustomError(safeOracle, "CantPropose");
      });
      it("Solution CAN NOT be proposed by an oracle other than the one that created it", async () => {
        await oracle2.sendTransaction({ to: wxDAI.address, value: INSURANCE });
        await wxDAI.connect(oracle2).approve(safeOracle.address, INSURANCE);

        await expect(
          safeOracle.connect(oracle2)["resolveCondition(address,uint256,uint64)"](core.address, condId, OUTCOMEWIN)
        ).to.be.revertedWithCustomError(safeOracle, "OnlyOracle");
      });
      it("Solution CAN NOT be proposed twice", async () => {
        await safeOracle.connect(oracle)["resolveCondition(address,uint256,uint64)"](core.address, condId, OUTCOMEWIN);

        await expect(
          safeOracle.connect(oracle)["resolveCondition(address,uint256,uint64)"](core.address, condId, OUTCOMEWIN)
        ).to.be.revertedWithCustomError(safeOracle, "CantPropose");
      });
      it("Solution CAN NOT be proposed if condition is canceled", async () => {
        await core.connect(oracle).cancelCondition(condId);
        await expect(safeOracle.connect(bettor).applyProposal(core.address, condId)).to.be.revertedWithCustomError(
          safeOracle,
          "ConditionCanceled"
        );
      });
      it("Solution CAN NOT be accepted if it is not proposed", async () => {
        await expect(safeOracle.connect(bettor).applyProposal(core.address, condId)).to.be.revertedWithCustomError(
          safeOracle,
          "CantAcceptSolution"
        );
      });
      it("Solution CAN NOT be accepted inside of the dispute period", async () => {
        await safeOracle.connect(oracle)["resolveCondition(address,uint256,uint64)"](core.address, condId, OUTCOMEWIN);

        time = await getBlockTime(ethers);
        await timeShift(time + DISPUTE_PERIOD - ONE_MINUTE);
        await expect(safeOracle.connect(bettor).applyProposal(core.address, condId)).to.be.revertedWithCustomError(
          safeOracle,
          "CantAcceptSolution"
        );
      });
      it("Solution CAN NOT be accepted inside of the decision period if it is disputed", async () => {
        await safeOracle.connect(oracle)["resolveCondition(address,uint256,uint64)"](core.address, condId, OUTCOMEWIN);
        await safeOracle.connect(disputer).dispute(core.address, condId);

        time = await getBlockTime(ethers);
        await timeShift(time + decisionPeriod - ONE_MINUTE);
        await expect(safeOracle.connect(bettor).applyProposal(core.address, condId)).to.be.revertedWithCustomError(
          safeOracle,
          "CantAcceptSolution"
        );
      });
      it("Solution CAN NOT be accepted twice for the same condition", async () => {
        await safeOracle.connect(oracle)["resolveCondition(address,uint256,uint64)"](core.address, condId, OUTCOMEWIN);

        time = await getBlockTime(ethers);
        await timeShift(time + DISPUTE_PERIOD);
        await safeOracle.connect(bettor).applyProposal(core.address, condId);
        await expect(safeOracle.connect(bettor).applyProposal(core.address, condId)).to.be.revertedWithCustomError(
          safeOracle,
          "CantAcceptSolution"
        );
      });
      it("Solution CAN NOT be accepted if condition is canceled", async () => {
        await safeOracle.connect(oracle)["resolveCondition(address,uint256,uint64)"](core.address, condId, OUTCOMEWIN);
        await core.connect(oracle).cancelCondition(condId);

        time = await getBlockTime(ethers);
        await timeShift(time + DISPUTE_PERIOD);
        await expect(safeOracle.connect(bettor).applyProposal(core.address, condId)).to.be.revertedWithCustomError(
          safeOracle,
          "ConditionCanceled"
        );
      });
    });
    describe("Dispute", function () {
      beforeEach(async function () {
        await createCondition(
          safeOracle,
          oracle,
          core,
          gameId,
          ++condId,
          [pool2, pool1],
          [OUTCOMEWIN, OUTCOMELOSE],
          REINFORCEMENT,
          MARGINALITY,
          time + ONE_DAY
        );

        await timeShift(time + ONE_HOUR + ONE_MINUTE);
        await safeOracle.connect(oracle)["resolveCondition(address,uint256,uint64)"](core.address, condId, OUTCOMEWIN);

        time = await getBlockTime(ethers);
      });
      it("Dispute CAN NOT be opened by disputer that have not enough funds to pay fot the insurance", async () => {
        await wxDAI.connect(maintainer).approve(safeOracle.address, INSURANCE);
        await expect(safeOracle.connect(maintainer).dispute(core.address, condId)).to.be.revertedWith(
          "TransferHelper::transferFrom: transferFrom failed"
        );
      });
      it("Dispute CAN NOT be opened for a condition that don't have a proposed solution", async () => {
        await createGame(lp, oracle, ++gameId, IPFS, time + ONE_HOUR);

        await createCondition(
          safeOracle,
          oracle,
          core,
          gameId,
          ++condId,
          [pool2, pool1],
          [OUTCOMEWIN, OUTCOMELOSE],
          REINFORCEMENT,
          MARGINALITY,
          time + ONE_DAY
        );
        await expect(safeOracle.connect(disputer).dispute(core.address, condId)).to.be.revertedWithCustomError(
          safeOracle,
          "DisputeNotAllowed"
        );
      });
      it("Dispute CAN NOT be opened for a condition that have an accepted solution", async () => {
        await timeShift(time + DISPUTE_PERIOD);

        await safeOracle.connect(bettor).applyProposal(core.address, condId);
        await expect(safeOracle.connect(disputer).dispute(core.address, condId)).to.be.revertedWithCustomError(
          safeOracle,
          "DisputeNotAllowed"
        );
      });
      it("Dispute CAN NOT be opened outside of the dispute period", async () => {
        await timeShift(time + DISPUTE_PERIOD);
        await expect(safeOracle.connect(disputer).dispute(core.address, condId)).to.be.revertedWithCustomError(
          safeOracle,
          "DisputeNotAllowed"
        );
      });
      it("Dispute CAN NOT be opened twice for the same condition", async () => {
        await safeOracle.connect(disputer).dispute(core.address, condId);
        await expect(safeOracle.connect(disputer).dispute(core.address, condId)).to.be.revertedWithCustomError(
          safeOracle,
          "DisputeNotAllowed"
        );
      });
      it("Dispute CAN NOT be opened if condition is canceled", async () => {
        await core.connect(oracle).cancelCondition(condId);
        await expect(safeOracle.connect(disputer).dispute(core.address, condId)).to.be.revertedWithCustomError(
          safeOracle,
          "ConditionCanceled"
        );
      });
    });
    describe("Resolve", function () {
      beforeEach(async function () {
        await createCondition(
          safeOracle,
          oracle,
          core,
          gameId,
          ++condId,
          [pool2, pool1],
          [OUTCOMEWIN, OUTCOMELOSE],
          REINFORCEMENT,
          MARGINALITY,
          time + ONE_DAY
        );
      });
      it("Condition solution CAN be approved only by the DAO", async () => {
        await timeShift(time + ONE_HOUR + ONE_MINUTE);
        await safeOracle.connect(oracle)["resolveCondition(address,uint256,uint64)"](core.address, condId, OUTCOMEWIN);
        await safeOracle.connect(disputer).dispute(core.address, condId);

        await expect(safeOracle.connect(oracle).approve(core.address, condId)).to.be.revertedWith(
          "Ownable: account is not the owner"
        );
      });
      it("Condition solution CAN be approved by the DAO only if it is disputed", async () => {
        await timeShift(time + ONE_DAY);
        await expect(safeOracle.connect(dao).approve(core.address, condId)).to.be.revertedWithCustomError(
          safeOracle,
          "CantResolve"
        );
      });
      it("Condition CAN NOT be resolved by the DAO during a resolve period if it is not disputed", async () => {
        await expect(
          safeOracle.connect(dao)["resolveCondition(address,uint256,uint64)"](core.address, condId, OUTCOMEWIN)
        ).to.be.revertedWithCustomError(safeOracle, "CantResolve");
      });
      it("Condition CAN NOT be resolved by the DAO after decision period if it is not disputed", async () => {
        await timeShift(time + ONE_DAY + decisionPeriod);
        await expect(
          safeOracle.connect(dao)["resolveCondition(address,uint256,uint64)"](core.address, condId, OUTCOMEWIN)
        ).to.be.revertedWithCustomError(safeOracle, "CantResolve");
      });
      it("Condition CAN NOT be resolved by the DAO with the same solution that is already proposed", async () => {
        await timeShift(time + ONE_HOUR + ONE_MINUTE);
        await safeOracle.connect(oracle)["resolveCondition(address,uint256,uint64)"](core.address, condId, OUTCOMEWIN);
        await safeOracle.connect(disputer).dispute(core.address, condId);

        await expect(
          safeOracle.connect(dao)["resolveCondition(address,uint256,uint64)"](core.address, condId, OUTCOMEWIN)
        ).to.be.revertedWithCustomError(safeOracle, "SameSolutionAsProposed");
      });
      it("Condition CAN NOT be resolved by the DAO with solution that CAN NOT be executed", async () => {
        await timeShift(time + ONE_HOUR + ONE_MINUTE);
        await safeOracle.connect(oracle)["resolveCondition(address,uint256,uint64)"](core.address, condId, OUTCOMEWIN);
        await safeOracle.connect(disputer).dispute(core.address, condId);

        await expect(
          safeOracle.connect(dao)["resolveCondition(address,uint256,uint64)"](core.address, condId, OUTCOMEINCORRECT)
        ).to.be.revertedWithCustomError(safeOracle, "IncorrectSolution");
      });
      it("Condition CAN NOT be resolved twice", async () => {
        await timeShift(time + ONE_HOUR + ONE_MINUTE);
        await safeOracle.connect(oracle)["resolveCondition(address,uint256,uint64)"](core.address, condId, OUTCOMELOSE);
        await safeOracle.connect(disputer).dispute(core.address, condId);

        await safeOracle.connect(dao)["resolveCondition(address,uint256,uint64)"](core.address, condId, OUTCOMEWIN);
        await expect(
          safeOracle.connect(dao)["resolveCondition(address,uint256,uint64)"](core.address, condId, OUTCOMEWIN)
        ).to.be.revertedWithCustomError(safeOracle, "CantResolve");
      });
      it("Condition CAN NOT be resolved through direct call to core contract", async () => {
        await timeShift(time + ONE_HOUR + ONE_MINUTE);
        await expect(core.connect(oracle)["resolveCondition(uint256,uint64)"](condId, OUTCOMEWIN))
          .to.be.revertedWithCustomError(core, "OnlyOracle")
          .withArgs(safeOracle.address);
      });
      it("Condition CAN NOT be resolved by the DAO if it is canceled", async () => {
        await timeShift(time + ONE_HOUR + ONE_MINUTE);
        await safeOracle.connect(oracle)["resolveCondition(address,uint256,uint64)"](core.address, condId, OUTCOMEWIN);
        await safeOracle.connect(disputer).dispute(core.address, condId);

        await core.connect(oracle).cancelCondition(condId);
        await expect(
          safeOracle.connect(dao)["resolveCondition(address,uint256,uint64)"](core.address, condId, OUTCOMEINCORRECT)
        ).to.be.revertedWithCustomError(safeOracle, "ConditionCanceled");
      });
    });
    describe("Cancel", function () {
      beforeEach(async function () {
        await createCondition(
          safeOracle,
          oracle,
          core,
          gameId,
          ++condId,
          [pool2, pool1],
          [OUTCOMEWIN, OUTCOMELOSE],
          REINFORCEMENT,
          MARGINALITY,
          time + ONE_DAY
        );
      });
      it("Condition CAN NOT be canceled if the DAO provided solution", async () => {
        await timeShift(time + ONE_HOUR + ONE_MINUTE);
        await safeOracle.connect(oracle)["resolveCondition(address,uint256,uint64)"](core.address, condId, OUTCOMEWIN);
        await safeOracle.connect(disputer).dispute(core.address, condId);
        await safeOracle.connect(dao).approve(core.address, condId);

        time = await getBlockTime(ethers);
        await timeShift(time + DISPUTE_PERIOD + decisionPeriod);
        await expect(safeOracle.applyCancelCondition(core.address, condId)).to.be.revertedWithCustomError(
          safeOracle,
          "CantAcceptSolution"
        );
      });
      it("Condition CAN NOT be canceled if the DAO and oracle didn't provided solution but (propose deadline + decision period) is not passed", async () => {
        await timeShift(time + ONE_DAY + decisionPeriod - ONE_MINUTE);
        await expect(safeOracle.applyCancelCondition(core.address, condId)).to.be.revertedWithCustomError(
          safeOracle,
          "CantAcceptSolution"
        );
      });
      it("Condition CAN NOT be canceled if the DAO didn't provided solution after dispute but (DISPUTE_PERIOD + decisionPeriod) is not passed", async () => {
        await timeShift(time + ONE_HOUR + ONE_MINUTE);
        await safeOracle.connect(oracle)["resolveCondition(address,uint256,uint64)"](core.address, condId, OUTCOMEWIN);
        await safeOracle.connect(disputer).dispute(core.address, condId);

        time = await getBlockTime(ethers);
        await timeShift(time + DISPUTE_PERIOD + decisionPeriod - ONE_MINUTE);
        await expect(safeOracle.applyCancelCondition(core.address, condId)).to.be.revertedWithCustomError(
          safeOracle,
          "CantAcceptSolution"
        );
      });
      it("Condition CAN NOT be canceled twice", async () => {
        await timeShift(time + ONE_HOUR + ONE_MINUTE);
        await safeOracle.connect(oracle)["resolveCondition(address,uint256,uint64)"](core.address, condId, OUTCOMEWIN);
        await safeOracle.connect(disputer).dispute(core.address, condId);

        time = await getBlockTime(ethers);
        await timeShift(time + DISPUTE_PERIOD + decisionPeriod);
        await safeOracle.applyCancelCondition(core.address, condId);
        await expect(safeOracle.applyCancelCondition(core.address, condId)).to.be.revertedWithCustomError(
          safeOracle,
          "ConditionCanceled"
        );
      });
    });
    describe("Handle if canceled", function () {
      beforeEach(async function () {
        await createCondition(
          safeOracle,
          oracle,
          core,
          gameId,
          ++condId,
          [pool2, pool1],
          [OUTCOMEWIN, OUTCOMELOSE],
          REINFORCEMENT,
          MARGINALITY,
          time + ONE_DAY
        );
      });
      it("Condition CAN NOT be processed as canceled if (!!!) it is not canceled", async () => {
        await expect(
          safeOracle.connect(bettor).handleCanceledCondition(core.address, condId)
        ).to.be.revertedWithCustomError(safeOracle, "ConditionNotCanceled");
      });
      it("Condition CAN NOT be processed as canceled if it is already resolved", async () => {
        await timeShift(time + ONE_HOUR + ONE_MINUTE);
        await safeOracle.connect(oracle)["resolveCondition(address,uint256,uint64)"](core.address, condId, OUTCOMELOSE);

        time = await getBlockTime(ethers);
        await timeShift(time + DISPUTE_PERIOD);
        await safeOracle.connect(bettor).applyProposal(core.address, condId);

        await lp.connect(oracle).cancelGame(gameId);
        await expect(
          safeOracle.connect(bettor).handleCanceledCondition(core.address, condId)
        ).to.be.revertedWithCustomError(safeOracle, "ConditionAlreadyResolved");
      });
      it("Condition CAN NOT be processed as canceled twice", async () => {
        await core.connect(oracle).cancelCondition(condId);

        await safeOracle.connect(bettor).handleCanceledCondition(core.address, condId);
        await expect(
          safeOracle.connect(bettor).handleCanceledCondition(core.address, condId)
        ).to.be.revertedWithCustomError(safeOracle, "ConditionAlreadyResolved");
      });
    });
    describe("Other", function () {
      it("Balance owner CAN NOT withdraw more funds than owns", async () => {
        await createCondition(
          safeOracle,
          oracle,
          core,
          gameId,
          ++condId,
          [pool2, pool1],
          [OUTCOMEWIN, OUTCOMELOSE],
          REINFORCEMENT,
          MARGINALITY,
          time + ONE_DAY
        );

        await timeShift(time + ONE_HOUR + ONE_MINUTE);
        await safeOracle.connect(oracle)["resolveCondition(address,uint256,uint64)"](core.address, condId, OUTCOMEWIN);

        time = await getBlockTime(ethers);
        await timeShift(time + DISPUTE_PERIOD);
        await safeOracle.connect(bettor).applyProposal(core.address, condId);

        const balance = await safeOracle.balanceOf(oracle.address);
        await expect(safeOracle.connect(oracle).withdraw(balance + 1)).to.be.revertedWithCustomError(
          safeOracle,
          "InsufficientBalance"
        );
      });
      it("Dispute period CAN NOT be set as 0", async () => {
        await expect(safeOracle.connect(dao).changeDisputePeriod(0)).to.be.revertedWithCustomError(
          safeOracle,
          "IncorrectDisputePeriod"
        );
        await expect(
          upgrades.deployProxy(SafeOracle, [factory.address, wxDAI.address, INSURANCE, 0])
        ).to.be.revertedWithCustomError(safeOracle, "IncorrectDisputePeriod");
      });
      it("Dispute period CAN NOT be changed for condition that is already proposed", async () => {
        await createCondition(
          safeOracle,
          oracle,
          core,
          gameId,
          ++condId,
          [pool2, pool1],
          [OUTCOMEWIN, OUTCOMELOSE],
          REINFORCEMENT,
          MARGINALITY,
          time + ONE_DAY
        );

        await timeShift(time + ONE_HOUR + ONE_MINUTE);
        await safeOracle.connect(oracle)["resolveCondition(address,uint256,uint64)"](core.address, condId, OUTCOMEWIN);
        await safeOracle.connect(dao).changeDisputePeriod(60);

        time = await getBlockTime(ethers);
        await timeShift(time + DISPUTE_PERIOD - 10);
        await safeOracle.connect(disputer).dispute(core.address, condId);
      });
      it("Insurance CAN NOT be changed if condition is already created", async () => {
        await createCondition(
          safeOracle,
          oracle,
          core,
          gameId,
          ++condId,
          [pool2, pool1],
          [OUTCOMEWIN, OUTCOMELOSE],
          REINFORCEMENT,
          MARGINALITY,
          time + ONE_DAY
        );

        await safeOracle.connect(dao).changeInsurance(tokens(123));

        await timeShift(time + ONE_HOUR + ONE_MINUTE);
        await safeOracle.connect(oracle)["resolveCondition(address,uint256,uint64)"](core.address, condId, OUTCOMEWIN);

        time = await getBlockTime(ethers);
        await timeShift(time + DISPUTE_PERIOD);
        await safeOracle.connect(bettor).applyProposal(core.address, condId);
        expect(await safeOracle.balanceOf(oracle.address)).to.be.equal(INSURANCE);
      });
      it("The DAO have special privileges", async () => {
        for (const signer of [bettor, oracle, disputer, poolOwner]) {
          await expect(safeOracle.connect(signer).changeDisputePeriod(DISPUTE_PERIOD)).to.be.revertedWith(
            "Ownable: account is not the owner"
          );
          await expect(safeOracle.connect(signer).changeInsurance(INSURANCE)).to.be.revertedWith(
            "Ownable: account is not the owner"
          );
        }
        safeOracle.connect(dao).changeDisputePeriod(DISPUTE_PERIOD);
      });
    });
  });
});
