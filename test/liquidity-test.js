const { expect } = require("chai");
const { BigNumber } = require("ethers");
const { ethers } = require("hardhat");
const {
  addLiquidity,
  getBlockTime,
  timeShiftBy,
  tokens,
  prepareEmptyStand,
  prepareAccess,
  createGame,
  createCondition,
  getWinthdrawnAmount,
  makeBetGetTokenId,
  makeWithdrawPayout,
  makeBetGetTokenIdOdds,
  changeReinforcementAbility,
} = require("../utils/utils");
const { FORKING, ITERATIONS, MULTIPLIER } = require("../utils/constants");

const LIQUIDITY = tokens(2_000_000);
const ONE_WEEK = 604800;
const ONE_DAY = 86400;
const ONE_MINUTE = 60;
const OUTCOMEWIN = 1;
const OUTCOMELOSE = 2;

const WITHDRAW_100_PERCENT = MULTIPLIER;
const WITHDRAW_80_PERCENT = MULTIPLIER * 0.8;
const WITHDRAW_50_PERCENT = MULTIPLIER * 0.5;
const WITHDRAW_20_PERCENT = MULTIPLIER * 0.2;
const WITHDRAW_10_PERCENT = MULTIPLIER * 0.1;
const TOKENS_1K = tokens(1_000);
const TOKENS_3K = tokens(3_000);
const TOKENS_4K = tokens(4_000);
const TOKENS_5K = tokens(5_000);
const TOKENS_20K = tokens(20_000);
const TOKENS_100K = tokens(100_000);
const FIRST_DEPO = tokens(100);
const SECOND_DEPO = tokens(100);
const ZERO_ADDRESS = ethers.constants.AddressZero;

const reinforcement = TOKENS_20K; // 10%
const marginality = MULTIPLIER * 0.05; // 5%

const minDepo = tokens(10);
const daoFee = MULTIPLIER * 0.09; // 9%
const dataProviderFee = MULTIPLIER * 0.01; // 1%

const approveAmount = tokens(999_999_999_999_999);
const pool1 = 5000000;
const pool2 = 5000000;

const DEPO_A = tokens(120_000);
const DEPO_B = tokens(10_000);

let dao, poolOwner, dataProvider, lpSupplier, lpSupplier2, lpOwner, oracle, oracle2, maintainer;
let access, core, wxDAI, lp, azuroBet, lpnft;
let roleIds, time, lpnft0;

let gameId = 0;
let condId = 0;
let condIds = [];
let lpNFT_A, lpNFT_B;

describe("Liquidity test", function () {
  before(async () => {
    [
      dao,
      poolOwner,
      dataProvider,
      lpOwner,
      lpSupplier,
      lpSupplier2,
      oracle,
      oracle2,
      maintainer,
      USER_B,
      USER_C,
      USER_D,
    ] = await ethers.getSigners();
  });
  beforeEach(async () => {
    time = await getBlockTime(ethers);
    ({ access, core, wxDAI, lp, roleIds } = await prepareEmptyStand(
      ethers,
      dao,
      poolOwner,
      dataProvider,
      lpSupplier,
      minDepo,
      daoFee,
      dataProviderFee
    ));
    await prepareAccess(access, poolOwner, oracle.address, oracle2.address, maintainer.address, roleIds);

    await wxDAI.connect(poolOwner).approve(lp.address, approveAmount);
    await wxDAI.connect(lpSupplier).approve(lp.address, approveAmount);
    await wxDAI.connect(lpSupplier2).approve(lp.address, approveAmount);

    try {
      await lp.connect(dao).claimReward();
    } catch {}
    try {
      await lp.connect(oracle).claimReward();
    } catch {}
  });
  it("Deposit no liquidity", async () => {
    const deposit = 0;

    // LP adds no liquidity
    await expect(addLiquidity(lp, lpSupplier, deposit)).to.be.revertedWithCustomError(lp, "SmallDepo");
    await expect(lp.connect(poolOwner).changeMinDepo(deposit)).to.be.revertedWithCustomError(lp, "IncorrectMinDepo");
  });
  it("Deposit a small amount of liquidity", async () => {
    await changeReinforcementAbility(lp, core, poolOwner, MULTIPLIER);

    const deposit = BigNumber.from(2);
    await lp.connect(poolOwner).changeMinDepo(deposit);

    const betAmount = BigNumber.from(1); // max bet with `deposit` reinforcement

    // LP adds a small amount of liquidity`
    const lpNFT = await addLiquidity(lp, lpSupplier, deposit);
    let lpReserve = await lp.getReserve();

    // Create first condition
    time = await getBlockTime(ethers);
    await createGame(lp, oracle, ++gameId, time + ONE_DAY);

    await createCondition(
      core,
      oracle,
      gameId,
      ++condId,
      [pool2, pool1],
      [OUTCOMEWIN, OUTCOMELOSE],
      deposit,
      marginality
    );

    // Place a large losing bet
    await makeBetGetTokenId(lp, core, poolOwner, ZERO_ADDRESS, condId, betAmount, OUTCOMELOSE, time + 1000, 0);

    // Pass 1 day and resolve the first condition
    await timeShiftBy(ethers, ONE_DAY + ONE_MINUTE);
    await core.connect(oracle).resolveCondition(condId, [OUTCOMEWIN]);

    // Withdraw LPs first deposit
    let tx = await lp.connect(lpSupplier).withdrawLiquidity(lpNFT, WITHDRAW_100_PERCENT);
    expect(await getWinthdrawnAmount(tx)).to.be.closeTo(
      deposit.add(
        betAmount
          .mul(MULTIPLIER - (daoFee + dataProviderFee))
          .div(MULTIPLIER)
          .mul(deposit)
          .div(lpReserve)
      ),
      10
    );

    // LP adds a small amount of liquidity for the second time
    const lpNFT2 = await addLiquidity(lp, lpSupplier, deposit);
    lpReserve = await lp.getReserve();

    // Create second condition
    time = await getBlockTime(ethers);
    await createGame(lp, oracle, ++gameId, time + ONE_DAY);

    await createCondition(
      core,
      oracle,
      gameId,
      ++condId,
      [pool2, pool1],
      [OUTCOMEWIN, OUTCOMELOSE],
      deposit,
      marginality
    );

    // Place a large winning bet
    const res = await makeBetGetTokenIdOdds(
      lp,
      core,
      poolOwner,
      ZERO_ADDRESS,
      condId,
      betAmount,
      OUTCOMEWIN,
      time + 1000,
      0
    );

    // Pass 1 day and resolve the second condition
    await timeShiftBy(ethers, ONE_DAY + ONE_MINUTE);
    await core.connect(oracle).resolveCondition(condId, [OUTCOMEWIN]);

    // Withdraw second LPs second deposit
    let tx2 = await lp.connect(lpSupplier).withdrawLiquidity(lpNFT2, WITHDRAW_100_PERCENT);
    expect(await getWinthdrawnAmount(tx2)).to.be.closeTo(
      deposit.sub(
        betAmount
          .mul(res.odds)
          .div(MULTIPLIER)
          .sub(betAmount)
          .mul(MULTIPLIER - (daoFee + dataProviderFee))
          .div(MULTIPLIER)
          .mul(deposit)
          .div(lpReserve)
      ),
      10
    );
  });
  it("Deposit a large amount of liquidity", async () => {
    await changeReinforcementAbility(lp, core, poolOwner, 1);

    const deposit = tokens(100_000_000);
    const betAmount = BigNumber.from(1);

    await lpSupplier.sendTransaction({ to: wxDAI.address, value: deposit });

    // LP adds a large amount of liquidity
    const lpNFT = await addLiquidity(lp, lpSupplier, deposit);
    let lpReserve = await lp.getReserve();

    // Create first condition
    time = await getBlockTime(ethers);
    await createGame(lp, oracle, ++gameId, time + ONE_DAY);

    await createCondition(
      core,
      oracle,
      gameId,
      ++condId,
      [pool2, pool1],
      [OUTCOMEWIN, OUTCOMELOSE],
      deposit,
      marginality
    );

    // Place a small losing bet
    await makeBetGetTokenId(lp, core, poolOwner, ZERO_ADDRESS, condId, betAmount, OUTCOMELOSE, time + 1000, 0);

    // Pass 1 day and resolve the first condition
    await timeShiftBy(ethers, ONE_DAY + ONE_MINUTE);
    await core.connect(oracle).resolveCondition(condId, [OUTCOMEWIN]);

    // Withdraw LPs first deposit
    let tx = await lp.connect(lpSupplier).withdrawLiquidity(lpNFT, WITHDRAW_100_PERCENT);
    expect(await getWinthdrawnAmount(tx)).to.be.closeTo(
      deposit.add(
        betAmount
          .mul(MULTIPLIER - (daoFee + dataProviderFee))
          .div(MULTIPLIER)
          .mul(deposit)
          .div(lpReserve)
      ),
      10
    );

    // LP adds a large amount of liquidity for the second time
    await lpSupplier.sendTransaction({ to: wxDAI.address, value: deposit });
    const lpNFT2 = await addLiquidity(lp, lpSupplier, deposit);
    lpReserve = await lp.getReserve();

    // Create second condition
    time = await getBlockTime(ethers);
    await createGame(lp, oracle, ++gameId, time + ONE_DAY);

    await createCondition(
      core,
      oracle,
      gameId,
      ++condId,
      [pool2, pool1],
      [OUTCOMEWIN, OUTCOMELOSE],
      deposit,
      marginality
    );

    // Place a small winning bet
    const res = await makeBetGetTokenIdOdds(
      lp,
      core,
      poolOwner,
      ZERO_ADDRESS,
      condId,
      betAmount,
      OUTCOMEWIN,
      time + 1000,
      0
    );

    // Pass 1 day and resolve the second condition
    await timeShiftBy(ethers, ONE_DAY + ONE_MINUTE);
    await core.connect(oracle).resolveCondition(condId, [OUTCOMEWIN]);

    // Withdraw LPs second deposit
    let tx2 = await lp.connect(lpSupplier).withdrawLiquidity(lpNFT2, WITHDRAW_100_PERCENT);
    expect(await getWinthdrawnAmount(tx2)).to.be.closeTo(
      deposit.sub(
        betAmount
          .mul(res.odds)
          .div(MULTIPLIER)
          .sub(betAmount)
          .mul(MULTIPLIER - (daoFee + dataProviderFee))
          .div(MULTIPLIER)
          .mul(deposit)
          .div(lpReserve)
      ),
      10
    );
  });
  it("Deposit a random amount of liquidity", async () => {
    const suppliers = await ethers.getSigners();
    const betAmount = tokens(100);
    let deposits = [];
    let lpReserve = await lp.getReserve();

    await lp.connect(poolOwner).changeMinDepo(1);

    const minDegree = 1;
    const extraDegree = Math.floor(Math.log2(tokens(100_000))) - minDegree;

    // LP add random amounts of liquidity for the first time
    for (const _ of Array(ITERATIONS / 2).keys()) {
      let lpSupplier = suppliers[Math.floor(Math.random() * suppliers.length)];
      let deposit = BigNumber.from(2).pow(Math.floor(minDegree + extraDegree * Math.random()));

      await lpSupplier.sendTransaction({ to: wxDAI.address, value: deposit });
      await wxDAI.connect(lpSupplier).approve(lp.address, tokens(approveAmount));
      let lpNFT = await addLiquidity(lp, lpSupplier, deposit);

      deposits.push({ supplier: lpSupplier, balance: deposit, lpNFT: lpNFT });
      lpReserve = lpReserve.add(deposit);
    }

    // Create first condition
    time = await getBlockTime(ethers);
    await createGame(lp, oracle, ++gameId, time + ONE_DAY);

    await createCondition(
      core,
      oracle,
      gameId,
      ++condId,
      [pool2, pool1],
      [OUTCOMEWIN, OUTCOMELOSE],
      lpReserve,
      marginality
    );

    // Place a losing bet
    await makeBetGetTokenId(lp, core, poolOwner, ZERO_ADDRESS, condId, betAmount, OUTCOMELOSE, time + 1000, 0);

    // Pass 1 day and resolve the first condition
    await timeShiftBy(ethers, ONE_DAY + ONE_MINUTE);
    await core.connect(oracle).resolveCondition(condId, [OUTCOMEWIN]);

    // Check LPs balances after the first condition
    const profit = betAmount.mul(MULTIPLIER - (daoFee + dataProviderFee)).div(MULTIPLIER);
    for (const deposit of deposits) {
      deposit.balance = deposit.balance.add(profit.mul(deposit.balance).div(lpReserve));
      expect(await lp.nodeWithdrawView(deposit.lpNFT)).to.be.closeTo(deposit.balance, 10);
    }
    lpReserve = lpReserve.add(profit);

    // LPs add random amounts of liquidity for the second time
    for (const _ of Array(ITERATIONS / 2).keys()) {
      let lpSupplier = suppliers[Math.floor(Math.random() * suppliers.length)];
      let deposit = BigNumber.from(2).pow(Math.floor(minDegree + extraDegree * Math.random()));

      await lpSupplier.sendTransaction({ to: wxDAI.address, value: deposit });
      await wxDAI.connect(lpSupplier).approve(lp.address, tokens(approveAmount));
      let lpNFT = await addLiquidity(lp, lpSupplier, deposit);

      deposits.push({ supplier: lpSupplier, balance: deposit, lpNFT: lpNFT });
      lpReserve = lpReserve.add(deposit);
    }

    // Create second condition
    time = await getBlockTime(ethers);
    await createGame(lp, oracle, ++gameId, time + ONE_DAY);

    await createCondition(
      core,
      oracle,
      gameId,
      ++condId,
      [pool2, pool1],
      [OUTCOMEWIN, OUTCOMELOSE],
      lpReserve,
      marginality
    );

    // Place a winning bet
    const res = await makeBetGetTokenIdOdds(
      lp,
      core,
      poolOwner,
      ZERO_ADDRESS,
      condId,
      betAmount,
      OUTCOMEWIN,
      time + 1000,
      0
    );

    // Pass 1 day and resolve the second condition
    await timeShiftBy(ethers, ONE_DAY + ONE_MINUTE);
    await core.connect(oracle).resolveCondition(condId, [OUTCOMEWIN]);

    // Check LPs balances after the second condition
    const loss = betAmount
      .mul(res.odds)
      .div(MULTIPLIER)
      .sub(betAmount)
      .mul(MULTIPLIER - (daoFee + dataProviderFee))
      .div(MULTIPLIER);
    for (const deposit of deposits) {
      let balance = deposit.balance;

      let tx = await lp.connect(deposit.supplier).withdrawLiquidity(deposit.lpNFT, WITHDRAW_100_PERCENT);
      expect(await getWinthdrawnAmount(tx)).to.be.closeTo(balance.sub(loss.mul(balance).div(lpReserve)), 10);
    }
  });
  it("Withdraw not existent liquidity deposit", async () => {
    await expect(lp.withdrawLiquidity(100, WITHDRAW_100_PERCENT)).to.be.revertedWith("ERC721: invalid token ID");
  });
  it("Withdraw not owned liquidity", async () => {
    const lpNFT = await addLiquidity(lp, poolOwner, TOKENS_100K);
    await expect(lp.connect(maintainer).withdrawLiquidity(lpNFT, WITHDRAW_100_PERCENT)).to.be.revertedWithCustomError(
      lp,
      "LiquidityNotOwned"
    );
  });
  it("Withdraw whole deposit", async () => {
    const betAmount = tokens(100);

    // Add initial liquidity
    const lpNFT = await addLiquidity(lp, poolOwner, TOKENS_100K);
    await addLiquidity(lp, poolOwner, TOKENS_20K);

    // Create condition
    time = await getBlockTime(ethers);
    await createGame(lp, oracle, ++gameId, time + ONE_DAY);

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

    // Place a losing bet
    await makeBetGetTokenIdOdds(lp, core, poolOwner, ZERO_ADDRESS, condId, betAmount, OUTCOMELOSE, time + 1000, 0);

    // Withdraw 100% of initial liquidity
    let tx1 = await lp.connect(poolOwner).withdrawLiquidity(lpNFT, WITHDRAW_100_PERCENT);
    expect(await getWinthdrawnAmount(tx1)).to.be.equal(tokens(100_000));
    expect(await lp.nodeWithdrawView(lpNFT)).to.be.equal(0);

    // Pass 1 day and resolve condition
    await timeShiftBy(ethers, ONE_DAY + ONE_MINUTE);
    await core.connect(oracle).resolveCondition(condId, [OUTCOMEWIN]);

    // Withdraw second LPs liquidity
    await expect(lp.connect(lpSupplier2).withdrawLiquidity(lpNFT, WITHDRAW_100_PERCENT)).to.be.revertedWith(
      "ERC721: invalid token ID"
    );
    expect(await lp.nodeWithdrawView(lpNFT)).to.be.equal(0);
  });
  it("Withdraw 0% of a deposit", async () => {
    // Add initial liquidity
    const lpNFT = await addLiquidity(lp, poolOwner, TOKENS_100K);

    // Withdraw 0% of initial liquidity
    let tx1 = await lp.connect(poolOwner).withdrawLiquidity(lpNFT, 0);
    expect(await getWinthdrawnAmount(tx1)).to.be.equal(tokens(0));
    expect(await lp.nodeWithdrawView(lpNFT)).to.be.equal(TOKENS_100K);
    expect(await lp.isDepositExists(lpNFT)).to.be.equal(true);
  });
  it("Withdraw 80% of a deposit", async () => {
    const betAmount = tokens(100);

    // Add initial liquidity
    const lpNFT = await addLiquidity(lp, poolOwner, TOKENS_100K);

    // Create condition
    time = await getBlockTime(ethers);
    await createGame(lp, oracle, ++gameId, time + ONE_DAY);

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

    // Second LP adds liquidity >= the reinforcement amount for the condition
    await wxDAI.connect(poolOwner).transfer(lpSupplier2.address, TOKENS_20K);
    const lpNFT2 = await addLiquidity(lp, lpSupplier2, TOKENS_20K);

    // Place a winning bet
    let res = await makeBetGetTokenIdOdds(
      lp,
      core,
      poolOwner,
      ZERO_ADDRESS,
      condId,
      betAmount,
      OUTCOMEWIN,
      time + 1000,
      0
    );

    // Withdraw 80% of initial liquidity
    let tx1 = await lp.connect(poolOwner).withdrawLiquidity(lpNFT, WITHDRAW_80_PERCENT);
    expect(await getWinthdrawnAmount(tx1)).to.be.equal(tokens(80_000));
    const lpReserve = await lp.getReserve();

    // Pass 1 day and resolve condition
    await timeShiftBy(ethers, ONE_DAY + ONE_MINUTE);
    await core.connect(oracle).resolveCondition(condId, [OUTCOMEWIN]);

    // Withdraw winning bet
    await makeWithdrawPayout(lp, core, poolOwner, res.tokenId);

    // Withdraw second LPs liquidity
    let tx2 = await lp.connect(lpSupplier2).withdrawLiquidity(lpNFT2, WITHDRAW_100_PERCENT);
    expect(await getWinthdrawnAmount(tx2)).to.be.closeTo(
      TOKENS_20K.sub(betAmount.mul(res.odds).div(MULTIPLIER).sub(betAmount).mul(TOKENS_20K).div(lpReserve)),
      10
    );
  });
  it("Withdraw such % of the deposit that the withdrawn amount becomes 0", async () => {
    // Add a very small initial liquidity
    const deposit = 99;
    await lp.connect(poolOwner).changeMinDepo(1);
    const lpNFT = await addLiquidity(lp, poolOwner, deposit);

    // Withdraw 1% of initial liquidity
    let tx1 = await lp.connect(poolOwner).withdrawLiquidity(lpNFT, MULTIPLIER * 0.01);
    expect(await getWinthdrawnAmount(tx1)).to.be.equal(tokens(0));
    expect(await lp.nodeWithdrawView(lpNFT)).to.be.equal(deposit);
    expect(await lp.isDepositExists(lpNFT)).to.be.equal(true);
  });
  it("Withdraw a deposit in small parts", async () => {
    const deposit = TOKENS_5K;
    const betAmount = tokens(100);

    await lpSupplier.sendTransaction({ to: wxDAI.address, value: deposit });

    // LP adds initial liquidity
    const lpNFT = await addLiquidity(lp, lpSupplier, deposit);
    const lpReserve = await lp.getReserve();

    // Create condition
    time = await getBlockTime(ethers);
    await createGame(lp, oracle, ++gameId, time + ONE_DAY);

    await createCondition(
      core,
      oracle,
      gameId,
      ++condId,
      [pool2, pool1],
      [OUTCOMEWIN, OUTCOMELOSE],
      deposit,
      marginality
    );

    // Place a small winning bet
    const res = await makeBetGetTokenIdOdds(
      lp,
      core,
      poolOwner,
      ZERO_ADDRESS,
      condId,
      betAmount,
      OUTCOMEWIN,
      time + 1000,
      0
    );
    let loss = betAmount.mul(res.odds).div(MULTIPLIER).sub(betAmount);
    let withdrawnAmount = ethers.constants.Zero;

    if (lpReserve === deposit) {
      // Withdraw a part of the deposit in small parts
      const withdrawAllowed = deposit.sub(loss);

      while (
        withdrawnAmount.add(deposit.sub(withdrawnAmount).mul(WITHDRAW_10_PERCENT).div(MULTIPLIER)).lte(withdrawAllowed)
      ) {
        let tx = await lp.connect(lpSupplier).withdrawLiquidity(lpNFT, WITHDRAW_10_PERCENT);
        withdrawnAmount = withdrawnAmount.add(await getWinthdrawnAmount(tx));
      }

      // Try to withdraw remaining part of the deposit
      await expect(lp.connect(lpSupplier).withdrawLiquidity(lpNFT, WITHDRAW_10_PERCENT)).to.be.revertedWithCustomError(
        lp,
        "LiquidityIsLocked"
      );
    } else {
      loss = loss.mul(deposit).div(lpReserve);
    }

    // Pass 1 day and resolve the condition
    await timeShiftBy(ethers, ONE_DAY + ONE_MINUTE);
    await core.connect(oracle).resolveCondition(condId, [OUTCOMEWIN]);

    // Withdraw remaining part of the deposit again
    let tx = await lp.connect(lpSupplier).withdrawLiquidity(lpNFT, WITHDRAW_100_PERCENT);
    expect(withdrawnAmount.add(await getWinthdrawnAmount(tx))).to.be.closeTo(deposit.sub(loss), 10);
  });
  context("Add liquidity before and after condition", () => {
    beforeEach(async () => {
      await wxDAI.connect(poolOwner).approve(lp.address, approveAmount);
      await wxDAI.connect(lpSupplier).approve(lp.address, approveAmount);
      lpnft0 = await addLiquidity(lp, poolOwner, LIQUIDITY);

      await wxDAI.connect(poolOwner).transfer(lpSupplier2.address, TOKENS_1K);
      await wxDAI.connect(lpSupplier2).approve(lp.address, TOKENS_1K);

      lpNFT = await addLiquidity(lp, lpSupplier2, FIRST_DEPO);

      // make condition
      time = await getBlockTime(ethers);
      await createGame(lp, oracle, ++gameId, time + ONE_DAY);

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

      lpNFT2 = await addLiquidity(lp, lpSupplier2, SECOND_DEPO);
    });
    it("condition with loss bets, withdraw first add increased, second not changed", async () => {
      // make 120 bets loosed and lp getting more $
      for (const i of Array(100).keys()) {
        await makeBetGetTokenId(lp, core, poolOwner, ZERO_ADDRESS, condId, tokens(200), OUTCOMELOSE, time + 1000, 0);
      }

      // pass 1 day and resolve condition
      await timeShiftBy(ethers, ONE_DAY + ONE_MINUTE);
      await core.connect(oracle).resolveCondition(condId, [OUTCOMEWIN]);

      let amount0 = await getWinthdrawnAmount(
        await lp.connect(poolOwner).withdrawLiquidity(lpnft0, WITHDRAW_100_PERCENT)
      );
      let amount1 = await getWinthdrawnAmount(
        await lp.connect(lpSupplier2).withdrawLiquidity(lpNFT, WITHDRAW_100_PERCENT)
      );
      let amount2 = await getWinthdrawnAmount(
        await lp.connect(lpSupplier2).withdrawLiquidity(lpNFT2, WITHDRAW_100_PERCENT)
      );

      expect(amount0).to.be.gt(LIQUIDITY);
      expect(amount1).to.be.gt(FIRST_DEPO);
      expect(amount2).to.be.equal(SECOND_DEPO);

      // try re-withdrawal of deposit token
      await expect(lp.connect(poolOwner).withdrawLiquidity(lpnft0, WITHDRAW_100_PERCENT)).to.be.revertedWith(
        "ERC721: invalid token ID"
      );
      await expect(lp.connect(lpSupplier2).withdrawLiquidity(lpNFT, WITHDRAW_100_PERCENT)).to.be.revertedWith(
        "ERC721: invalid token ID"
      );
      await expect(lp.connect(lpSupplier2).withdrawLiquidity(lpNFT2, WITHDRAW_100_PERCENT)).to.be.revertedWith(
        "ERC721: invalid token ID"
      );
    });
    it("condition with win bets, try withdraw before resolve", async () => {
      // make 120 bets loosed and lp getting more $
      for (const i of Array(100).keys()) {
        await makeBetGetTokenId(lp, core, poolOwner, ZERO_ADDRESS, condId, tokens(2000), [OUTCOMEWIN], time + 1000, 0);
      }

      // try to withdraw main liquidity before resolve
      await expect(lp.connect(poolOwner).withdrawLiquidity(lpnft0, WITHDRAW_100_PERCENT)).to.be.revertedWithCustomError(
        lp,
        "LiquidityIsLocked"
      );

      await timeShiftBy(ethers, ONE_DAY);
      await core.connect(oracle).resolveCondition(condId, [OUTCOMEWIN]);

      let amount0 = await getWinthdrawnAmount(
        await lp.connect(poolOwner).withdrawLiquidity(lpnft0, WITHDRAW_100_PERCENT)
      );

      expect(amount0).to.be.lt(LIQUIDITY);
    });
    it("condition with win bets, withdraw bet payouts after the liquidity is withdrawn", async () => {
      if (FORKING) this.skip();

      const tokenIds = [];
      for (const i of Array(100).keys()) {
        let tokenId = await makeBetGetTokenId(
          lp,
          core,
          poolOwner,
          ZERO_ADDRESS,
          condId,
          tokens(2000),
          OUTCOMEWIN,
          time + 1000,
          0
        );
        tokenIds.push(tokenId);
      }

      await timeShiftBy(ethers, ONE_DAY + ONE_MINUTE);
      await core.connect(oracle).resolveCondition(condId, [OUTCOMEWIN]);

      await lp.connect(poolOwner).withdrawLiquidity(lpnft0, WITHDRAW_100_PERCENT);
      await lp.connect(lpSupplier2).withdrawLiquidity(lpNFT, WITHDRAW_100_PERCENT);
      await lp.connect(lpSupplier2).withdrawLiquidity(lpNFT2, WITHDRAW_100_PERCENT);

      let betPayouts = await wxDAI.balanceOf(lp.address);

      let madePayouts = ethers.constants.Zero;
      for (const tokenId of tokenIds) {
        const [payout, ,] = await makeWithdrawPayout(lp, core, poolOwner, tokenId);
        madePayouts = madePayouts.add(payout);
      }

      expect(madePayouts).to.be.equal(betPayouts);
      expect(await lp.getReserve()).to.be.equal(0);
      expect(await lp.lockedLiquidity()).to.be.equal(0);
    });
    it("condition with win bets, withdraw, first add reduced, second reduced", async () => {
      // make 120 bets loosed and lp getting more $
      for (const i of Array(100).keys()) {
        await makeBetGetTokenId(lp, core, poolOwner, ZERO_ADDRESS, condId, tokens(200), [OUTCOMEWIN], time + 1000, 0);
      }

      // pass 1 day and resolve condition
      await timeShiftBy(ethers, ONE_DAY);
      await core.connect(oracle).resolveCondition(condId, [OUTCOMEWIN]);

      let tx1 = await lp.connect(lpSupplier2).withdrawLiquidity(lpNFT, WITHDRAW_100_PERCENT);
      let tx2 = await lp.connect(lpSupplier2).withdrawLiquidity(lpNFT2, WITHDRAW_100_PERCENT);

      expect(await getWinthdrawnAmount(tx1)).to.be.lt(FIRST_DEPO);
      expect(await getWinthdrawnAmount(tx2)).to.be.lt(SECOND_DEPO);
    });
    it("change minDepo and try low liquidity add", async () => {
      await lp.connect(poolOwner).changeMinDepo(minDepo);

      await expect(addLiquidity(lp, poolOwner, minDepo.sub(1))).to.be.revertedWithCustomError(lp, "SmallDepo");

      await lp.connect(poolOwner).changeMinDepo(tokens(1000));

      // make low liquidity add
      await expect(addLiquidity(lp, poolOwner, tokens(1000).sub(1))).to.be.revertedWithCustomError(lp, "SmallDepo");
    });
    it("change withdraw timeout and withdraw", async () => {
      // set one day timeout
      await lp.connect(poolOwner).changeWithdrawTimeout(ONE_DAY);

      time = await getBlockTime(ethers);
      let lpNFT = await addLiquidity(lp, poolOwner, tokens(1000));
      let withdrawAmount = await lp.nodeWithdrawView(lpNFT);

      // try liquidity withdraw with error
      let timeDiffer = (await getBlockTime(ethers)) - time;
      await expect(lp.withdrawLiquidity(lpNFT, WITHDRAW_100_PERCENT)).to.be.revertedWithCustomError(
        lp,
        "WithdrawalTimeout"
      );

      // set no timeout
      await lp.connect(poolOwner).changeWithdrawTimeout(0);

      // try liquidity withdraw with error
      timeDiffer = (await getBlockTime(ethers)) - time;
      await expect(lp.withdrawLiquidity(lpNFT, WITHDRAW_100_PERCENT)).to.be.revertedWithCustomError(
        lp,
        "WithdrawalTimeout"
      );

      // trasnfer LPNFT token to another account and try to withdraw
      await lp.connect(poolOwner).transferFrom(poolOwner.address, lpSupplier.address, lpNFT);
      timeDiffer = (await getBlockTime(ethers)) - time;
      await expect(lp.connect(lpSupplier).withdrawLiquidity(lpNFT, WITHDRAW_100_PERCENT)).to.be.revertedWithCustomError(
        lp,
        "WithdrawalTimeout"
      );

      // set one week timeout
      await lp.connect(poolOwner).changeWithdrawTimeout(ONE_WEEK);

      // +1 day
      await timeShiftBy(ethers, ONE_DAY);

      // try liquidity withdraw successfully
      expect(
        await getWinthdrawnAmount(await lp.connect(lpSupplier).withdrawLiquidity(lpNFT, WITHDRAW_100_PERCENT))
      ).to.be.equal(withdrawAmount);
    });
  });
  context("Donate liquidity", function () {
    const donation = tokens(50);
    const deposit = tokens(100);
    const deposit2 = tokens(200);
    it("Donate no liquidity", async () => {
      const lastLeaf = await lp.getLastDepositId();
      await expect(lp.connect(poolOwner).donateLiquidity(0, lastLeaf)).to.be.revertedWithCustomError(
        lp,
        "SmallDonation"
      );
    });
    it("Share donation between liquidity deposit that does not exist", async () => {
      const lpNFT = await addLiquidity(lp, lpSupplier, deposit);
      await expect(lp.connect(poolOwner).donateLiquidity(donation, lpNFT + 1)).to.be.revertedWithCustomError(
        lp,
        "DepositDoesNotExist"
      );
    });
    it("Share donation between 2 very last liquidity deposits", async () => {
      const lpNFT = await addLiquidity(lp, lpSupplier, deposit);
      const lpNFT2 = await addLiquidity(lp, lpSupplier, deposit2);
      const lpReserve = await lp.getReserve();

      await lp.connect(poolOwner).donateLiquidity(donation, lpNFT2);

      const tx = await lp.connect(lpSupplier).withdrawLiquidity(lpNFT, WITHDRAW_100_PERCENT);
      expect(await getWinthdrawnAmount(tx)).to.be.closeTo(deposit.add(donation.mul(deposit).div(lpReserve)), 10);
      const tx2 = await lp.connect(lpSupplier).withdrawLiquidity(lpNFT2, WITHDRAW_100_PERCENT);
      expect(await getWinthdrawnAmount(tx2)).to.be.closeTo(deposit2.add(donation.mul(deposit2).div(lpReserve)), 10);
    });
    it("Share donation between 2 not very last liquidity deposits", async () => {
      const lpNFT = await addLiquidity(lp, lpSupplier, deposit);
      const lpNFT2 = await addLiquidity(lp, lpSupplier, deposit2);
      const lpReserve = await lp.getReserve();

      // The third deposit does not participate in the donation distribution
      const deposit3 = tokens(400);
      const lpNFT3 = await addLiquidity(lp, lpSupplier, deposit3);

      await lp.connect(poolOwner).donateLiquidity(donation, lpNFT2);

      const tx = await lp.connect(lpSupplier).withdrawLiquidity(lpNFT, WITHDRAW_100_PERCENT);
      expect(await getWinthdrawnAmount(tx)).to.be.closeTo(deposit.add(donation.mul(deposit).div(lpReserve)), 10);
      const tx2 = await lp.connect(lpSupplier).withdrawLiquidity(lpNFT2, WITHDRAW_100_PERCENT);
      expect(await getWinthdrawnAmount(tx2)).to.be.closeTo(deposit2.add(donation.mul(deposit2).div(lpReserve)), 10);
      const tx3 = await lp.connect(lpSupplier).withdrawLiquidity(lpNFT3, WITHDRAW_100_PERCENT);
      expect(await getWinthdrawnAmount(tx3)).to.be.equal(deposit3);
    });
  });
});
describe("Add liquidity before and after condition", () => {
  let bets = [];
  let profits = [];
  before("prepare", async () => {
    if (FORKING) this.skip();

    [dao, poolOwner, dataProvider, lpOwner, USER_A, lpSupplier2, oracle, oracle2, maintainer, USER_B, USER_C, USER_D] =
      await ethers.getSigners();

    ({ access, core, wxDAI, lp, roleIds } = await prepareEmptyStand(
      ethers,
      dao,
      poolOwner,
      dataProvider,
      USER_A,
      minDepo,
      daoFee,
      dataProviderFee
    ));
    await prepareAccess(access, poolOwner, oracle.address, oracle2.address, maintainer.address, roleIds);

    await lp.connect(poolOwner).changeFee(0, 0); // DAO
    await lp.connect(poolOwner).changeFee(1, 0); // Oracle
    const lpBefore = await lp.getReserve();
    const lockedBefore = await lp.lockedLiquidity();

    /**
    	      dates	Liquidity Tree	lockedLiquidity
            20.04	     120000,00	          60000	"A depo" -> 120000	         "Conditions 1,2,3" -> 60000
            21.04	     120789.04	          40000	"B,D,C bet 1k on 1" -> 3000	 "cond 1 resolve" -> 1177.67
            22.04	     130789.04	          40000	"B depo" -> 10000,00         "B,D,C bet 1k on 2" -> 3000
            22.04	     132799.04	          20000	"cond 2 resolve" -> 3000
    case 1	22.04	     127799.04	          20000	"B witdraw 1/2" -> 5000
    case 1	22.04	     127799.04	          20000	"B,D,C bet 1k on 3" -> 3000
    case 2	23.04	     103239.23	          20000	"A witdraw 1/5" -> 24559.808
    case 2	23.04	     101138.24	              0	"cond 3 resolve (loss)" -> -2100.989584
    case 2	24.04	     101138.24	          40000	"Conditions 4,5" -> 40000
    case 2	24.04	     101138.24	          40000	"B,D,C bet 1k on 4" -> 3000
    case 2	25.04	     101927.28	          20000	"cond 4 resolve (win)" -> 789.04
    case 3	25.04	      98298,07	          20000	"B withdraw" -> 4955.75
    case 4	25.04	      98298,07	          20000	"A withdraw 1/1" -> LiquidityIsLocked()
     */

    await wxDAI.connect(USER_A).transfer(USER_B.address, TOKENS_20K);
    await wxDAI.connect(USER_A).transfer(USER_C.address, TOKENS_4K);
    await wxDAI.connect(USER_A).transfer(USER_D.address, TOKENS_4K);
    await wxDAI.connect(USER_B).approve(lp.address, TOKENS_20K);
    await wxDAI.connect(USER_C).approve(lp.address, TOKENS_4K);
    await wxDAI.connect(USER_D).approve(lp.address, TOKENS_4K);

    await wxDAI.connect(USER_A).approve(lp.address, DEPO_A);
    lpNFT_A = await addLiquidity(lp, USER_A, DEPO_A);
    expect((await lp.treeNode(1)).amount.sub(lpBefore)).to.be.equal(DEPO_A);

    // make 3 conditions, 120_000 total and 60_000 locked
    for (const i of Array(5).keys()) {
      if (i <= 2) {
        time = await getBlockTime(ethers);
        await createGame(
          lp,
          oracle,
          ++gameId,

          BigNumber.from(ONE_DAY)
            .mul(i + 1)
            .add(time)
            .toString()
        );
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
        condIds.push(condId);
      }
    }
    expect((await lp.treeNode(1)).amount.sub(lpBefore)).to.be.equal(DEPO_A);

    // make 3 bets on condition #1
    let res = await makeBetGetTokenIdOdds(
      lp,
      core,
      USER_B,
      ZERO_ADDRESS,
      condIds[0],
      TOKENS_1K,
      OUTCOMEWIN,
      time + 1000,
      0
    );
    await makeBetGetTokenId(lp, core, USER_C, ZERO_ADDRESS, condIds[0], TOKENS_1K, OUTCOMELOSE, time + 1000, 0);
    await makeBetGetTokenId(lp, core, USER_D, ZERO_ADDRESS, condIds[0], TOKENS_1K, OUTCOMELOSE, time + 1000, 0);

    // +1 day and resolve condition #1 - USER_B wins
    await timeShiftBy(ethers, ONE_DAY + ONE_MINUTE);
    await core.connect(oracle).resolveCondition(condIds[0], [OUTCOMEWIN]);

    let winnerPayout = TOKENS_1K.mul(res.odds).div(MULTIPLIER);
    let protocolProfit = TOKENS_3K.sub(winnerPayout);
    let newLiquidity = tokens(120_000).add(protocolProfit);

    expect((await lp.treeNode(1)).amount.sub(lpBefore)).to.be.equal(newLiquidity); // 120789.04297994 = DEPO(120000) + PROFIT (1177.676089)
    expect((await lp.lockedLiquidity()).sub(lockedBefore)).to.be.equal(tokens(0));

    // make 3 bets on condition #2 and USER_B depo
    time = await getBlockTime(ethers);
    await makeBetGetTokenId(lp, core, USER_B, ZERO_ADDRESS, condIds[1], TOKENS_1K, OUTCOMELOSE, time + 1000, 0);
    await makeBetGetTokenId(lp, core, USER_C, ZERO_ADDRESS, condIds[1], TOKENS_1K, OUTCOMELOSE, time + 1000, 0);
    await makeBetGetTokenId(lp, core, USER_D, ZERO_ADDRESS, condIds[1], TOKENS_1K, OUTCOMELOSE, time + 1000, 0);

    let before = (await lp.treeNode(1)).amount;
    lpNFT_B = await addLiquidity(lp, USER_B, DEPO_B);
    let afterAdd = (await lp.treeNode(1)).amount;
    expect(afterAdd.sub(before)).to.be.equal(DEPO_B); // 130789.04

    // +1 day and resolve condition #2 - POOL wins
    await timeShiftBy(ethers, ONE_DAY + ONE_MINUTE);

    await core.connect(oracle).resolveCondition(condIds[1], [OUTCOMEWIN]);
    let afterResolve = (await lp.treeNode(1)).amount;

    expect(afterResolve.sub(afterAdd)).to.be.equal(TOKENS_3K); // 132799.04 pool win (2010)
    expect(await lp.lockedLiquidity()).to.be.equal(0);
  });
  it("Case 1 User B withdraw 1/2 of 10000 depo and 3 bets on condition #3", async () => {
    let before = (await lp.treeNode(1)).amount;
    expect(await lp.nodeWithdrawView(lpNFT_B)).to.be.equal(DEPO_B);
    expect(
      await getWinthdrawnAmount(await lp.connect(USER_B).withdrawLiquidity(lpNFT_B, WITHDRAW_50_PERCENT))
    ).to.be.equal(TOKENS_5K);
    expect((await lp.treeNode(1)).amount).to.be.equal(before.sub(TOKENS_5K)); // 127799.04 (liquidity USER_A + USER_B)

    time = await getBlockTime(ethers);
    bets.push(
      await makeBetGetTokenIdOdds(lp, core, USER_B, ZERO_ADDRESS, condIds[2], TOKENS_1K, [OUTCOMEWIN], time + 1000, 0)
    );
    bets.push(
      await makeBetGetTokenIdOdds(lp, core, USER_C, ZERO_ADDRESS, condIds[2], TOKENS_1K, [OUTCOMEWIN], time + 1000, 0)
    );
    bets.push(
      await makeBetGetTokenIdOdds(lp, core, USER_D, ZERO_ADDRESS, condIds[2], TOKENS_1K, [OUTCOMEWIN], time + 1000, 0)
    );
  });
  it("Case 2 User A withdraw 1/5 of 120000 depo", async () => {
    let before = (await lp.treeNode(1)).amount;

    const A_20_PERCENT = before.sub(TOKENS_5K).div(5); // 24559.808 ~ (127799.04 - 5000) / 5
    expect((await lp.nodeWithdrawView(lpNFT_A)).div(5)).to.be.equal(A_20_PERCENT);
    expect(
      await getWinthdrawnAmount(await lp.connect(USER_A).withdrawLiquidity(lpNFT_A, WITHDRAW_20_PERCENT))
    ).to.be.equal(A_20_PERCENT);

    // rest of liquidity
    expect((await lp.treeNode(1)).amount).to.be.equal(before.sub(A_20_PERCENT)); // 103239.232 = 127799.04 - 24559.808 (liquidity USER_A + USER_B)

    // +1 day and resolve condition #3 - POOL loss
    await timeShiftBy(ethers, ONE_DAY + ONE_MINUTE);
    let beforeResolve = (await lp.treeNode(1)).amount;
    await core.connect(oracle).resolveCondition(condIds[2], [OUTCOMEWIN]);
    afterResolve = (await lp.treeNode(1)).amount;

    let poolLoss = tokens(0);
    for (const i of bets.keys()) {
      poolLoss = poolLoss.add(TOKENS_1K.mul(bets[i].odds).div(MULTIPLIER));
    }
    poolLoss = poolLoss.sub(TOKENS_3K);

    expect(beforeResolve.sub(afterResolve)).to.be.equal(poolLoss); // 2100.989582 pool loss
    expect(await lp.lockedLiquidity()).to.be.equal(tokens(0));
    // save B profits
    profits[0] = poolLoss.mul(await lp.nodeWithdrawView(lpNFT_B)).div((await lp.treeNode(1)).amount);

    // rest of liquidity
    // 101138.242417 = 103239.232 - 2100.989583 (liquidity - POOL loss )

    // make 2 conditions, 100_000 total and 40_000 locked
    for (const i of Array(5).keys()) {
      if (i >= 3) {
        time = await getBlockTime(ethers);
        await createGame(
          lp,
          oracle,
          ++gameId,

          BigNumber.from(ONE_DAY)
            .mul(i - 2)
            .add(time)
            .toString()
        );

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
        condIds.push(condId);
      }
    }
    expect((await lp.treeNode(1)).amount).to.be.equal(afterResolve);

    time = await getBlockTime(ethers);
    res = await makeBetGetTokenIdOdds(
      lp,
      core,
      USER_B,
      ZERO_ADDRESS,
      condIds[3],
      TOKENS_1K,
      OUTCOMEWIN,
      time + 1000,
      0
    );
    await makeBetGetTokenId(lp, core, USER_C, ZERO_ADDRESS, condIds[3], TOKENS_1K, OUTCOMELOSE, time + 1000, 0);
    await makeBetGetTokenId(lp, core, USER_D, ZERO_ADDRESS, condIds[3], TOKENS_1K, OUTCOMELOSE, time + 1000, 0);

    // +1 day and resolve condition #4 - POOL wins
    await timeShiftBy(ethers, ONE_DAY + ONE_MINUTE);
    beforeResolve = (await lp.treeNode(1)).amount;
    await core.connect(oracle).resolveCondition(condIds[3], [OUTCOMEWIN]);

    afterResolve = (await lp.treeNode(1)).amount;

    let winnerPayout = TOKENS_1K.mul(res.odds).div(MULTIPLIER);
    let protocolProfit = TOKENS_3K.sub(winnerPayout);

    expect(afterResolve.sub(beforeResolve)).to.be.equal(protocolProfit); // 789.04 pool win (1177.67 - 388.63)

    profits[1] = protocolProfit.mul(await lp.nodeWithdrawView(lpNFT_B)).div((await lp.treeNode(1)).amount);
    // rest of liquidity
    expect(afterResolve).to.be.equals(beforeResolve.add(protocolProfit)); // 101927.28 = 101138.24 + 789.04
  });
  it("Case 3 User B withdraw rest of depo", async () => {
    // 4936.46 = 5000 + (-2100.98*4898.24/101138.24 + 789.04*4936.46/101927.28 )
    const B_WITHDRAW_REST = TOKENS_5K.add(profits[1].sub(profits[0])).add(1); // 1 wei round error
    expect(await lp.nodeWithdrawView(lpNFT_B)).to.be.equal(B_WITHDRAW_REST);
    expect(
      await getWinthdrawnAmount(await lp.connect(USER_B).withdrawLiquidity(lpNFT_B, WITHDRAW_100_PERCENT))
    ).to.be.equal(B_WITHDRAW_REST);
  });
  it("Case 4 User A try withdraw all of depo", async () => {
    await expect(await lp.nodeWithdrawView(lpNFT_A)).to.be.equal(
      (await lp.treeNode(1)).amount.sub(await lp.lockedLiquidity())
    );
  });
});
