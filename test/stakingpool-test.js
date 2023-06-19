const { expect } = require("chai");
const { BigNumber } = require("ethers");
const { ethers } = require("hardhat");
const {
  createCondition,
  createGame,
  getBlockTime,
  getLPNFTToken,
  initFixtureTree,
  makeBetNativeGetTokenId,
  makeWithdrawLiquidityNative,
  prepareAccess,
  prepareEmptyStand,
  tokens,
  timeShift,
} = require("../utils/utils");

const stake = async (stakingPool, account, amount, period) => {
  await stakingPool.connect(account).stake(amount, period);
};

const unstake = async (stakingPool, account, stakeId) => {
  await stakingPool.connect(account).withdraw(stakeId);
};

const addLiquidityNative = async (lp, account, amount) => {
  let txAdd = await lp.connect(account).addLiquidityNative({ value: BigNumber.from(amount) });
  return await getLPNFTToken(txAdd);
};

const OUTCOMEWIN = 1;
const OUTCOMELOSE = 2;
const IPFS = ethers.utils.formatBytes32String("ipfs");

const MULTIPLIER = 1e12;

const ONE_YEAR = 31536000;
const ONE_DAY = 86400;
const ONE_MINUTE = 60;

describe.skip("StakingPool test", function () {
  const wrapLayer = initFixtureTree(ethers.provider);

  const REINFORCEMENT = tokens(20000);
  const MARGINALITY = MULTIPLIER * 0.05; // 5%

  const minDepo = tokens(10);
  const daoFee = MULTIPLIER * 0.09; // 9%
  const dataProviderFee = MULTIPLIER * 0.01; // 1%
  const affiliateFee = MULTIPLIER * 0.33; // 33%

  const depositRate = MULTIPLIER * 5; // stake/deposit = 1/5
  const interestRate = MULTIPLIER * 0.08; // 8%
  const minStakePeriod = ONE_YEAR / 2;

  const pool1 = 5000000;
  const pool2 = 5000000;

  const stakeAmount = tokens(20);
  const deposit = stakeAmount.mul(depositRate).div(MULTIPLIER);

  let dao, poolOwner, dataProvider, oracle, maintainer, lpSupplier;
  let access, core, wxDAI, lp, stakingPool;
  let roleIds, balance;

  let gameId = 0;
  let condId = 0;

  async function deployAndInit() {
    [dao, poolOwner, dataProvider, oracle, maintainer, lpSupplier] = await ethers.getSigners();

    ({ access, core, wxDAI, lp, roleIds } = await prepareEmptyStand(
      ethers,
      dao,
      poolOwner,
      dataProvider,
      lpSupplier,
      minDepo,
      daoFee,
      dataProviderFee,
      affiliateFee
    ));
    await prepareAccess(access, poolOwner, oracle.address, poolOwner.address, maintainer.address, roleIds);

    const StakingPool = await ethers.getContractFactory("StakingPool", { signer: poolOwner });
    stakingPool = await upgrades.deployProxy(StakingPool, [lp.address, wxDAI.address]);
    await stakingPool.deployed();

    await lp.connect(poolOwner).changeLiquidityManager(stakingPool.address);
    await lp.connect(poolOwner).changeMinDepo(1);
    await stakingPool.connect(poolOwner).changeDepositRate(depositRate);
    await stakingPool.connect(poolOwner).changeInterestRate(interestRate);
    await stakingPool.connect(poolOwner).changeMinStakePeriod(minStakePeriod);

    await wxDAI.connect(poolOwner).approve(stakingPool.address, tokens(999_999_999_999_999));
    await wxDAI.connect(poolOwner).transfer(stakingPool.address, tokens(100));

    await wxDAI.connect(lpSupplier).approve(stakingPool.address, tokens(999_999_999_999_999));
    balance = await wxDAI.balanceOf(lpSupplier.address);
  }

  wrapLayer(deployAndInit);

  context("Common use cases", function () {
    it("stake (1 year) - deposit - withdraw (100%) - unstake", async () => {
      await stake(stakingPool, lpSupplier, stakeAmount, ONE_YEAR);
      const lpNFT = await addLiquidityNative(lp, lpSupplier, deposit);
      await expect(addLiquidityNative(lp, lpSupplier, 1)).to.be.revertedWithCustomError(stakingPool, "NotEnoughStake");

      const time = await getBlockTime(ethers);
      await timeShift(time + ONE_YEAR);
      await expect(unstake(stakingPool, lpSupplier, 1)).to.be.revertedWithCustomError(
        stakingPool,
        "NotEnoughStakeToReinforceDeposits"
      );
      await makeWithdrawLiquidityNative(lp, lpSupplier, lpNFT, MULTIPLIER);

      await unstake(stakingPool, lpSupplier, 1);
      expect(await wxDAI.balanceOf(lpSupplier.address)).to.be.equal(
        balance.add(stakeAmount.mul(interestRate).div(MULTIPLIER))
      );
    });
    it("stake (1/2 year) - deposit - withdraw (100%) - unstake", async () => {
      await stake(stakingPool, lpSupplier, stakeAmount, ONE_YEAR / 2);
      const lpNFT = await addLiquidityNative(lp, lpSupplier, deposit.div(2));
      await expect(addLiquidityNative(lp, lpSupplier, 1)).to.be.revertedWithCustomError(stakingPool, "NotEnoughStake");

      const time = await getBlockTime(ethers);
      await timeShift(time + ONE_YEAR);
      await expect(unstake(stakingPool, lpSupplier, 1)).to.be.revertedWithCustomError(
        stakingPool,
        "NotEnoughStakeToReinforceDeposits"
      );
      await makeWithdrawLiquidityNative(lp, lpSupplier, lpNFT, MULTIPLIER);

      await unstake(stakingPool, lpSupplier, 1);
      expect(await wxDAI.balanceOf(lpSupplier.address)).to.be.equal(
        balance.add(stakeAmount.mul(interestRate).div(MULTIPLIER).div(2))
      );
    });
    it("stake (1/2 year) - stake (1/2 year) - deposit  - withdraw (100%) - unstake", async () => {
      await stake(stakingPool, lpSupplier, stakeAmount, ONE_YEAR / 2);
      await expect(addLiquidityNative(lp, lpSupplier, deposit.div(2).add(1))).to.be.revertedWithCustomError(
        stakingPool,
        "NotEnoughStake"
      );

      await stake(stakingPool, lpSupplier, stakeAmount, ONE_YEAR / 2);
      const lpNFT = await addLiquidityNative(lp, lpSupplier, deposit);
      await expect(addLiquidityNative(lp, lpSupplier, 1)).to.be.revertedWithCustomError(stakingPool, "NotEnoughStake");

      const time = await getBlockTime(ethers);
      await timeShift(time + ONE_YEAR);
      await expect(unstake(stakingPool, lpSupplier, 1)).to.be.revertedWithCustomError(
        stakingPool,
        "NotEnoughStakeToReinforceDeposits"
      );
      await expect(unstake(stakingPool, lpSupplier, 2)).to.be.revertedWithCustomError(
        stakingPool,
        "NotEnoughStakeToReinforceDeposits"
      );
      await makeWithdrawLiquidityNative(lp, lpSupplier, lpNFT, MULTIPLIER);

      await unstake(stakingPool, lpSupplier, 1);
      await unstake(stakingPool, lpSupplier, 2);
      expect(await wxDAI.balanceOf(lpSupplier.address)).to.be.equal(
        balance.add(stakeAmount.mul(interestRate).div(MULTIPLIER))
      );
    });
    it("stake (1/2 year) - stake (1/2 year) - deposit - withdraw (49%) - withdraw (2%) - unstake - withdraw (100%) - unstake", async () => {
      await stake(stakingPool, lpSupplier, stakeAmount, ONE_YEAR / 2);
      await stake(stakingPool, lpSupplier, stakeAmount, ONE_YEAR / 2);
      const lpNFT = await addLiquidityNative(lp, lpSupplier, deposit);
      await expect(addLiquidityNative(lp, lpSupplier, 1)).to.be.revertedWithCustomError(stakingPool, "NotEnoughStake");

      const time = await getBlockTime(ethers);
      await timeShift(time + ONE_YEAR);
      await makeWithdrawLiquidityNative(lp, lpSupplier, lpNFT, MULTIPLIER * 0.49);
      await expect(unstake(stakingPool, lpSupplier, 1)).to.be.revertedWithCustomError(
        stakingPool,
        "NotEnoughStakeToReinforceDeposits"
      );

      await makeWithdrawLiquidityNative(lp, lpSupplier, lpNFT, MULTIPLIER * 0.02 /* 0.02 * (100-49) ~ 1 */);
      await unstake(stakingPool, lpSupplier, 1);

      await makeWithdrawLiquidityNative(lp, lpSupplier, lpNFT, MULTIPLIER);
      await unstake(stakingPool, lpSupplier, 2);
      expect(await wxDAI.balanceOf(lpSupplier.address)).to.be.equal(
        balance.add(stakeAmount.mul(interestRate).div(MULTIPLIER))
      );
    });
    it("stake (1 year) - deposit - resolve losing condition - withdraw (50%) - deposit - withdraw (100%) - unstake", async () => {
      await stake(stakingPool, lpSupplier, stakeAmount, ONE_YEAR);
      const lpNFT = await addLiquidityNative(lp, lpSupplier, deposit);

      let time = await getBlockTime(ethers);
      await createGame(lp, oracle, ++gameId, IPFS, time + ONE_DAY);
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
      await makeBetNativeGetTokenId(
        lp,
        core,
        poolOwner,
        ethers.constants.AddressZero,
        condId,
        tokens(100),
        OUTCOMEWIN,
        time + 100,
        0
      );

      await timeShift(time + ONE_DAY + ONE_MINUTE);
      await core.connect(oracle).resolveCondition(condId, OUTCOMEWIN);
      await makeWithdrawLiquidityNative(lp, lpSupplier, lpNFT, MULTIPLIER / 2);
      await expect(
        addLiquidityNative(lp, lpSupplier, deposit.sub(await lp.nodeWithdrawView(lpNFT)).add(1))
      ).to.be.revertedWithCustomError(stakingPool, "NotEnoughStake");
      const lpNFT2 = await addLiquidityNative(lp, lpSupplier, deposit.sub(await lp.nodeWithdrawView(lpNFT)));
      await expect(addLiquidityNative(lp, lpSupplier, 1)).to.be.revertedWithCustomError(stakingPool, "NotEnoughStake");

      time = await getBlockTime(ethers);
      await makeWithdrawLiquidityNative(lp, lpSupplier, lpNFT, MULTIPLIER);
      await makeWithdrawLiquidityNative(lp, lpSupplier, lpNFT2, MULTIPLIER);

      await timeShift(time + ONE_YEAR);
      await unstake(stakingPool, lpSupplier, 1);
      expect(await wxDAI.balanceOf(lpSupplier.address)).to.be.equal(
        balance.add(stakeAmount.mul(interestRate).div(MULTIPLIER))
      );
    });
    it("stake (1 year) - deposit - resolve profitable condition - withdraw (50%) - deposit - withdraw (100%) - unstake", async () => {
      await stake(stakingPool, lpSupplier, stakeAmount, ONE_YEAR);
      const lpNFT = await addLiquidityNative(lp, lpSupplier, deposit);

      let time = await getBlockTime(ethers);
      await createGame(lp, oracle, ++gameId, IPFS, time + ONE_DAY);
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
      await makeBetNativeGetTokenId(
        lp,
        core,
        poolOwner,
        ethers.constants.AddressZero,
        condId,
        tokens(100),
        OUTCOMELOSE,
        time + 100,
        0
      );

      await timeShift(time + ONE_DAY + ONE_MINUTE);
      await core.connect(oracle).resolveCondition(condId, OUTCOMEWIN);
      await makeWithdrawLiquidityNative(lp, lpSupplier, lpNFT, MULTIPLIER / 2);
      await expect(
        addLiquidityNative(lp, lpSupplier, deposit.sub(await lp.nodeWithdrawView(lpNFT)).add(1))
      ).to.be.revertedWithCustomError(stakingPool, "NotEnoughStake");
      const lpNFT2 = await addLiquidityNative(lp, lpSupplier, deposit.sub(await lp.nodeWithdrawView(lpNFT)));
      await expect(addLiquidityNative(lp, lpSupplier, 1)).to.be.revertedWithCustomError(stakingPool, "NotEnoughStake");

      time = await getBlockTime(ethers);
      await makeWithdrawLiquidityNative(lp, lpSupplier, lpNFT, MULTIPLIER);
      await makeWithdrawLiquidityNative(lp, lpSupplier, lpNFT2, MULTIPLIER);

      await timeShift(time + ONE_YEAR);
      await unstake(stakingPool, lpSupplier, 1);
      expect(await wxDAI.balanceOf(lpSupplier.address)).to.be.equal(
        balance.add(stakeAmount.mul(interestRate).div(MULTIPLIER))
      );
    });
    it("stake (1 year) - deposit - resolve profitable condition - withdraw (1%) - withdraw (100%) - unstake", async () => {
      await stake(stakingPool, lpSupplier, stakeAmount, ONE_YEAR);
      const lpNFT = await addLiquidityNative(lp, lpSupplier, deposit);

      let time = await getBlockTime(ethers);
      await createGame(lp, oracle, ++gameId, IPFS, time + ONE_DAY);
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
      await makeBetNativeGetTokenId(
        lp,
        core,
        poolOwner,
        ethers.constants.AddressZero,
        condId,
        tokens(100),
        OUTCOMELOSE,
        time + 100,
        0
      );

      await timeShift(time + ONE_DAY + ONE_MINUTE);
      await core.connect(oracle).resolveCondition(condId, OUTCOMEWIN);
      await makeWithdrawLiquidityNative(lp, lpSupplier, lpNFT, MULTIPLIER * 0.01);
      await expect(addLiquidityNative(lp, lpSupplier, 1)).to.be.revertedWithCustomError(stakingPool, "NotEnoughStake");

      time = await getBlockTime(ethers);
      await makeWithdrawLiquidityNative(lp, lpSupplier, lpNFT, MULTIPLIER);

      await timeShift(time + ONE_YEAR);
      await unstake(stakingPool, lpSupplier, 1);
      expect(await wxDAI.balanceOf(lpSupplier.address)).to.be.equal(
        balance.add(stakeAmount.mul(interestRate).div(MULTIPLIER))
      );
    });
    it("stake (1 year) - deposit - transfer lpNFT - withdraw (100%) - unstake", async () => {
      await stake(stakingPool, lpSupplier, stakeAmount, ONE_YEAR);
      const lpNFT = await addLiquidityNative(lp, lpSupplier, deposit);

      await lp.connect(lpSupplier).transferFrom(lpSupplier.address, poolOwner.address, lpNFT);
      await expect(addLiquidityNative(lp, lpSupplier, 1)).to.be.revertedWithCustomError(stakingPool, "NotEnoughStake");
      await expect(addLiquidityNative(lp, poolOwner, 1)).to.be.revertedWithCustomError(stakingPool, "NotEnoughStake");
      await makeWithdrawLiquidityNative(lp, poolOwner, lpNFT, MULTIPLIER);

      const time = await getBlockTime(ethers);
      await timeShift(time + ONE_YEAR);
      await expect(unstake(stakingPool, poolOwner, 1)).to.be.revertedWithCustomError(stakingPool, "StakeNotOwned");
      await unstake(stakingPool, lpSupplier, 1);
      await expect(await wxDAI.balanceOf(lpSupplier.address)).to.be.equal(
        balance.add(stakeAmount.mul(interestRate).div(MULTIPLIER))
      );
    });
    it("stake (1 year) - deposit - transfer lpNFT - withdraw (50%) - deposit - withdraw (50%) unstake", async () => {
      await stake(stakingPool, lpSupplier, stakeAmount, ONE_YEAR);
      const lpNFT = await addLiquidityNative(lp, lpSupplier, deposit);

      await lp.connect(lpSupplier).transferFrom(lpSupplier.address, poolOwner.address, lpNFT);
      await makeWithdrawLiquidityNative(lp, poolOwner, lpNFT, MULTIPLIER / 2);
      await expect(addLiquidityNative(lp, poolOwner, deposit.div(2))).to.be.revertedWithCustomError(
        stakingPool,
        "NotEnoughStake"
      );
      const lpNFT2 = await addLiquidityNative(lp, lpSupplier, deposit.div(2));

      const time = await getBlockTime(ethers);
      await timeShift(time + ONE_YEAR);
      await makeWithdrawLiquidityNative(lp, poolOwner, lpNFT, MULTIPLIER);
      await makeWithdrawLiquidityNative(lp, lpSupplier, lpNFT2, MULTIPLIER);
      await unstake(stakingPool, lpSupplier, 1);
      expect(await wxDAI.balanceOf(lpSupplier.address)).to.be.equal(
        balance.add(stakeAmount.mul(interestRate).div(MULTIPLIER))
      );
    });
  });
  context("Settings management", function () {
    it("Remove liquidity manager", async () => {
      await lp.connect(poolOwner).changeLiquidityManager(ethers.constants.AddressZero);
      const lpNFT = await addLiquidityNative(lp, lpSupplier, tokens(10000));

      await makeWithdrawLiquidityNative(lp, lpSupplier, lpNFT, MULTIPLIER);
    });
    it("Add liquidity manager after depositing liquidity", async () => {
      await lp.connect(poolOwner).changeLiquidityManager(ethers.constants.AddressZero);
      const lpNFT = await addLiquidityNative(lp, lpSupplier, tokens(10000));

      await lp.connect(poolOwner).changeLiquidityManager(stakingPool.address);
      await makeWithdrawLiquidityNative(lp, lpSupplier, lpNFT, MULTIPLIER);
    });
    it("Change deposit rate", async () => {
      const depositRate = MULTIPLIER * 10;
      await stakingPool.connect(poolOwner).changeDepositRate(depositRate);

      await stake(stakingPool, lpSupplier, stakeAmount, ONE_YEAR);
      const deposit = stakeAmount.mul(depositRate).div(MULTIPLIER);
      const lpNFT = await addLiquidityNative(lp, lpSupplier, deposit);
      await expect(addLiquidityNative(lp, lpSupplier, 1)).to.be.revertedWithCustomError(stakingPool, "NotEnoughStake");

      const time = await getBlockTime(ethers);
      await timeShift(time + ONE_YEAR);
      await expect(unstake(stakingPool, lpSupplier, 1)).to.be.revertedWithCustomError(
        stakingPool,
        "NotEnoughStakeToReinforceDeposits"
      );
      await makeWithdrawLiquidityNative(lp, lpSupplier, lpNFT, MULTIPLIER);

      await unstake(stakingPool, lpSupplier, 1);
      expect(await wxDAI.balanceOf(lpSupplier.address)).to.be.equal(
        balance.add(stakeAmount.mul(interestRate).div(MULTIPLIER))
      );
    });
    it("Change interest rate", async () => {
      const interestRate = MULTIPLIER;
      await stakingPool.connect(poolOwner).changeInterestRate(interestRate);

      await stake(stakingPool, lpSupplier, stakeAmount, ONE_YEAR);
      const lpNFT = await addLiquidityNative(lp, lpSupplier, deposit);
      await expect(addLiquidityNative(lp, lpSupplier, 1)).to.be.revertedWithCustomError(stakingPool, "NotEnoughStake");

      const time = await getBlockTime(ethers);
      await timeShift(time + ONE_YEAR);
      await expect(unstake(stakingPool, lpSupplier, 1)).to.be.revertedWithCustomError(
        stakingPool,
        "NotEnoughStakeToReinforceDeposits"
      );
      await makeWithdrawLiquidityNative(lp, lpSupplier, lpNFT, MULTIPLIER);

      await unstake(stakingPool, lpSupplier, 1);
      expect(await wxDAI.balanceOf(lpSupplier.address)).to.be.equal(
        balance.add(stakeAmount.mul(interestRate).div(MULTIPLIER))
      );
    });
    it("Change minimum stake period", async () => {
      const minStakePeriod = ONE_DAY;
      await stakingPool.connect(poolOwner).changeMinStakePeriod(minStakePeriod);

      await expect(stake(stakingPool, lpSupplier, stakeAmount, ONE_DAY - 1)).to.be.revertedWithCustomError(
        stakingPool,
        "TooShortStakePeriod"
      );
      await stake(stakingPool, lpSupplier, stakeAmount, ONE_DAY);
      const deposit = stakeAmount.mul(depositRate).div(MULTIPLIER).mul(ONE_DAY).div(ONE_YEAR);
      const lpNFT = await addLiquidityNative(lp, lpSupplier, deposit);

      const time = await getBlockTime(ethers);
      await timeShift(time + ONE_DAY);
      await makeWithdrawLiquidityNative(lp, lpSupplier, lpNFT, MULTIPLIER);

      await stakingPool.connect(poolOwner).changeMinStakePeriod(ONE_YEAR);
      await unstake(stakingPool, lpSupplier, 1);
      expect(await wxDAI.balanceOf(lpSupplier.address)).to.be.equal(
        balance.add(stakeAmount.mul(BigNumber.from(interestRate).mul(ONE_DAY).div(ONE_YEAR)).div(MULTIPLIER))
      );
    });
  });
  context("Check restrictions", function () {
    it("Check owner rights", async () => {
      await expect(stakingPool.connect(lpSupplier).changeDepositRate(depositRate)).to.be.revertedWith(
        "Ownable: account is not the owner"
      );
      await expect(stakingPool.connect(lpSupplier).changeInterestRate(interestRate)).to.be.revertedWith(
        "Ownable: account is not the owner"
      );
      await expect(stakingPool.connect(lpSupplier).changeMinStakePeriod(minStakePeriod)).to.be.revertedWith(
        "Ownable: account is not the owner"
      );
    });
    it("Stake CANNOT be added with too short staking period", async () => {
      await expect(stake(stakingPool, lpSupplier, stakeAmount, minStakePeriod - 1)).to.be.revertedWithCustomError(
        stakingPool,
        "TooShortStakePeriod"
      );
    });
    it("Stake CANNOT be added if the staker have an insufficient balance", async () => {
      await wxDAI.connect(lpSupplier).transfer(oracle.address, stakeAmount.sub(1));
      await wxDAI.connect(oracle).approve(stakingPool.address, tokens(999_999_999_999_999));
      await expect(stake(stakingPool, oracle, stakeAmount, ONE_YEAR)).to.be.revertedWith(
        "TransferHelper::transferFrom: transferFrom failed"
      );
    });
    it("Liquidity CANNOT be added if the stake is not sufficient with the deposit rate it was made with", async () => {
      await stake(stakingPool, lpSupplier, stakeAmount, ONE_YEAR);
      await expect(addLiquidityNative(lp, lpSupplier, deposit.add(1))).to.be.revertedWithCustomError(
        stakingPool,
        "NotEnoughStake"
      );
      await addLiquidityNative(lp, lpSupplier, deposit);
    });
    it("Stake CANNOT be withdrawn not by its owner", async () => {
      await stake(stakingPool, lpSupplier, stakeAmount, ONE_YEAR);

      const time = await getBlockTime(ethers);
      await timeShift(time + ONE_YEAR);
      await expect(unstake(stakingPool, poolOwner, 1)).to.be.revertedWithCustomError(stakingPool, "StakeNotOwned");
    });
    it("Stake CANNOT be withdrawn twice", async () => {
      await stake(stakingPool, lpSupplier, stakeAmount, ONE_YEAR);

      const time = await getBlockTime(ethers);
      await timeShift(time + ONE_YEAR);
      await unstake(stakingPool, lpSupplier, 1);
      await expect(unstake(stakingPool, lpSupplier, 1)).to.be.revertedWithCustomError(stakingPool, "StakeNotOwned");
    });
    it("Stake CANNOT be withdrawn before its withdrawal time", async () => {
      await stake(stakingPool, lpSupplier, stakeAmount, ONE_YEAR);

      const time = await getBlockTime(ethers);
      await timeShift(time + ONE_YEAR - 10);
      await expect(unstake(stakingPool, lpSupplier, 1)).to.be.revertedWithCustomError(
        stakingPool,
        "StakingPeriodNotOver"
      );

      await timeShift(time + ONE_YEAR);
      await unstake(stakingPool, lpSupplier, 1);
    });
    it("Stake CANNOT be withdrawn if liquidity deposits made by staker is not reinforced with another stakes", async () => {
      await stake(stakingPool, lpSupplier, stakeAmount, ONE_YEAR);
      const lpNFT = await addLiquidityNative(lp, lpSupplier, deposit);

      const time = await getBlockTime(ethers);
      await timeShift(time + ONE_YEAR);
      await expect(unstake(stakingPool, lpSupplier, 1)).to.be.revertedWithCustomError(
        stakingPool,
        "NotEnoughStakeToReinforceDeposits"
      );

      const res = await makeWithdrawLiquidityNative(lp, lpSupplier, lpNFT, MULTIPLIER * 0.99);
      await expect(unstake(stakingPool, lpSupplier, 1)).to.be.revertedWithCustomError(
        stakingPool,
        "NotEnoughStakeToReinforceDeposits"
      );

      const compensationStakeAmount = deposit.sub(res[0]).mul(MULTIPLIER).div(depositRate);
      await stake(stakingPool, lpSupplier, compensationStakeAmount.sub(1), ONE_YEAR);
      await expect(unstake(stakingPool, lpSupplier, 1)).to.be.revertedWithCustomError(
        stakingPool,
        "NotEnoughStakeToReinforceDeposits"
      );

      await stake(stakingPool, lpSupplier, 1, ONE_YEAR);
      await unstake(stakingPool, lpSupplier, 1);
    });
    it("Stake interest CANNOT be larger than unused balance of the contract", async () => {
      const availableInterest = await wxDAI.balanceOf(stakingPool.address);
      const interestRate = MULTIPLIER * 1000;
      await stakingPool.connect(poolOwner).changeInterestRate(MULTIPLIER * 1000);
      expect(availableInterest).lt(deposit.mul(interestRate).div(MULTIPLIER));

      await stake(stakingPool, lpSupplier, deposit, 2 * ONE_YEAR);
      await stake(stakingPool, lpSupplier, deposit, ONE_YEAR);

      let time = await getBlockTime(ethers);
      await timeShift(time + ONE_YEAR);
      await unstake(stakingPool, lpSupplier, 2);
      expect(await wxDAI.balanceOf(lpSupplier.address)).to.be.equal(balance.sub(deposit));

      time = await getBlockTime(ethers);
      await timeShift(time + 2 * ONE_YEAR);
      await unstake(stakingPool, lpSupplier, 1);
      expect(await wxDAI.balanceOf(lpSupplier.address)).to.be.equal(balance.add(availableInterest));
    });
  });
});
