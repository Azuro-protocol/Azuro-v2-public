const { expect } = require("chai");
const { ethers } = require("hardhat");
const {
  prepareStand,
  createCondition,
  createGame,
  getBlockTime,
  prepareAccess,
  timeShiftBy,
  makeBetGetTokenId,
  tokens,
  timeShift,
} = require("../utils/utils");
const { MULTIPLIER } = require("../utils/constants");

const LIQUIDITY = tokens(2000000);
const OUTCOMEWIN = 1;
const OUTCOMELOSE = 2;

const ONE_HOUR = 3600;
const ONE_MINUTE = 60;
const MINREQUESTCONFIRMATIONS = 3;
const MAXREQUESTCONFIRMATIONS = 200;
const KEYHASH = "0x6e099d640cde6de9d40ac749b4b594126b0169747122711109c9985d47751f93";

const subId = 1;

describe("X2OrNothing test", function () {
  const reinforcement = tokens(20000);
  const marginality = MULTIPLIER * 0.05; // 5%
  const minDepo = tokens(10);
  const daoFee = MULTIPLIER * 0.09; // 9%
  const dataProviderFee = MULTIPLIER * 0.01; // 1%
  const x2Liquidity = tokens(100000);

  let vrfCoordinator, x2OrNothing;
  let dao, poolOwner, dataProvider, oracle, oracle2, maintainer, affiliate, bettor;

  let gameId = 0;
  let condId = 0;

  const pool1 = 5000000;
  const pool2 = 5000000;

  let initializeArguments;

  const resolveBet = async function (isWon) {
    const game = await x2OrNothing.games(bettor.address);
    const randNumber = isWon ? 1e12 : 999999999999;
    await vrfCoordinator.fulfillRandomWordsWithOverride(game.requestId, x2OrNothing.address, [randNumber]);
  };

  const makeBetOnOutcome = async function () {
    time = await getBlockTime(ethers);
    await createGame(lp, oracle, ++gameId, time + ONE_HOUR);

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

    const tokenId = await makeBetGetTokenId(
      lp,
      core,
      bettor,
      affiliate.address,
      condId,
      tokens(200),
      OUTCOMEWIN,
      time + 10,
      0
    );

    timeShift(time + ONE_HOUR + ONE_MINUTE);
    await core.connect(oracle).resolveCondition(condId, [OUTCOMEWIN]);

    await azuroBet.connect(bettor).approve(x2OrNothing.address, tokenId);

    return tokenId;
  };

  before(async function () {
    [dao, poolOwner, dataProvider, oracle, oracle2, maintainer, affiliate, affiliate2, affiliate3, bettor] =
      await ethers.getSigners();

    ({ access, core, wxDAI, lp, roleIds, azuroBet } = await prepareStand(
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

    const VRFCoordinator = await ethers.getContractFactory("VRFCoordinator");
    vrfCoordinator = await VRFCoordinator.deploy();

    await vrfCoordinator.createSubscription();
    await vrfCoordinator.fundSubscription(subId, tokens(1000));

    initializeArguments = [
      core.address,
      vrfCoordinator.address,
      subId,
      "0x4b09e658ed251bcafeebbc69400383d49f344ace09b9576fe248bb02c003fe9f",
      3,
      100000,
      2000000000000,
      30000000000, // 3%
      tokens(5),
      ONE_HOUR,
    ];

    const X2OrNothing = await ethers.getContractFactory("X2OrNothing");
    x2OrNothing = await upgrades.deployProxy(X2OrNothing, initializeArguments);

    await vrfCoordinator.addConsumer(subId, x2OrNothing.address);

    await wxDAI.connect(bettor).approve(x2OrNothing.address, tokens(999_999_999_999_999));
    await wxDAI.connect(bettor).transfer(x2OrNothing.address, x2Liquidity);
  });

  it("Should NOT be able to double initialize X2OrNothing", async function () {
    await expect(x2OrNothing.initialize(...initializeArguments)).to.be.revertedWith(
      "Initializable: contract is already initialized"
    );
  });

  it("Should NOT be able to call not for owner", async function () {
    await expect(x2OrNothing.connect(bettor).changeMargin(3)).to.be.revertedWith("Ownable: account is not the owner");
    await expect(x2OrNothing.connect(bettor).changeResultPeriod(400)).to.be.revertedWith(
      "Ownable: account is not the owner"
    );
    await expect(
      x2OrNothing
        .connect(bettor)
        .changeVrf("0xAE975071Be8F8eE67addBC1A82488F1C24858067", 123, MINREQUESTCONFIRMATIONS, KEYHASH)
    ).to.be.revertedWith("Ownable: account is not the owner");
    await expect(x2OrNothing.connect(bettor).changePayoutMultiplier(3)).to.be.revertedWith(
      "Ownable: account is not the owner"
    );
    await expect(x2OrNothing.connect(bettor).changeMinBet(tokens(1))).to.be.revertedWith(
      "Ownable: account is not the owner"
    );
    await expect(x2OrNothing.connect(bettor).withdrawAllAvailableLiquidity(bettor.address)).to.be.revertedWith(
      "Ownable: account is not the owner"
    );
  });

  it("Should NOT be able to pass incorrect values", async function () {
    await expect(x2OrNothing.changeMargin(0)).to.be.revertedWithCustomError(x2OrNothing, "IncorrectMargin");
    await expect(x2OrNothing.changeMargin(1e13)).to.be.revertedWithCustomError(x2OrNothing, "IncorrectMargin");
    await expect(x2OrNothing.changePayoutMultiplier(0)).to.be.revertedWithCustomError(
      x2OrNothing,
      "IncorrectPayoutMultiplier"
    );
    await expect(x2OrNothing.changeResultPeriod(0)).to.be.revertedWithCustomError(x2OrNothing, "IncorrectResultPeriod");
    await expect(
      x2OrNothing.changeVrf("0x0000000000000000000000000000000000000000", 123, MINREQUESTCONFIRMATIONS, KEYHASH)
    ).to.be.revertedWithCustomError(x2OrNothing, "IncorrectVrf");
    await expect(
      x2OrNothing.changeVrf("0xAE975071Be8F8eE67addBC1A82488F1C24858067", 0, MINREQUESTCONFIRMATIONS, KEYHASH)
    ).to.be.revertedWithCustomError(x2OrNothing, "IncorrectConsumerId");
    await expect(
      x2OrNothing.changeVrf("0xAE975071Be8F8eE67addBC1A82488F1C24858067", 123, MINREQUESTCONFIRMATIONS - 1, KEYHASH)
    ).to.be.revertedWithCustomError(x2OrNothing, "IncorrectRequestConfirmations");

    await expect(
      x2OrNothing.changeVrf("0xAE975071Be8F8eE67addBC1A82488F1C24858067", 123, MAXREQUESTCONFIRMATIONS + 1, KEYHASH)
    ).to.be.revertedWithCustomError(x2OrNothing, "IncorrectRequestConfirmations");

    await expect(x2OrNothing.changeMinBet(0)).to.be.revertedWithCustomError(x2OrNothing, "IncorrectMinBet");
  });

  it("Should NOT be able to place bet bigger than available liquidity", async function () {
    const betAmount = x2Liquidity.add(tokens(1));
    await expect(x2OrNothing.connect(bettor).bet(betAmount)).to.be.revertedWithCustomError(x2OrNothing, "BetTooBig");
  });

  it("Should NOT be able to bet less than min bet and zero amount", async function () {
    const betAmount = tokens(1);

    await expect(x2OrNothing.connect(bettor).bet(betAmount)).to.be.revertedWithCustomError(x2OrNothing, "SmallBet");
    await expect(x2OrNothing.connect(bettor).bet(0)).to.be.revertedWithCustomError(x2OrNothing, "SmallBet");
  });

  it("Should NOT be able to refund right after bet and if bet doesn't exist", async function () {
    const betAmount = tokens(10);

    await expect(x2OrNothing.connect(bettor).withdrawPayout()).to.be.revertedWithCustomError(
      x2OrNothing,
      "GameNotExist"
    );

    await x2OrNothing.connect(bettor).bet(betAmount);

    await expect(x2OrNothing.connect(bettor).withdrawPayout()).to.be.revertedWithCustomError(x2OrNothing, "ZeroPayout");

    await resolveBet(true);
    await x2OrNothing.connect(bettor).withdrawPayout();
  });

  it("Should NOT be able to withdraw payout for unresolved game", async function () {
    const betAmount = tokens(10);
    await x2OrNothing.connect(bettor).bet(betAmount);

    await expect(x2OrNothing.connect(bettor).withdrawPayout()).to.be.revertedWithCustomError(x2OrNothing, "ZeroPayout");
    await resolveBet(false);
  });

  it("Should be able to refund if vrf request failing", async function () {
    const betAmount = tokens(10);
    const expectedBettorBalanceAfterRefund = await wxDAI.balanceOf(bettor.address);

    await x2OrNothing.connect(bettor).bet(betAmount);

    await expect(x2OrNothing.connect(bettor).withdrawPayout()).to.be.revertedWithCustomError(x2OrNothing, "ZeroPayout");

    await timeShiftBy(ethers, ONE_HOUR);

    await x2OrNothing.connect(bettor).withdrawPayout();

    expect(await wxDAI.balanceOf(bettor.address)).to.equal(expectedBettorBalanceAfterRefund);
  });

  it("Should be able to bet and withdraw", async function () {
    const betAmount = tokens(10);
    const payoutMultiplier = 2;
    const bettorBalance = await wxDAI.balanceOf(bettor.address);
    const expectedBettorBalance = bettorBalance.sub(betAmount).add(betAmount.mul(payoutMultiplier));

    await x2OrNothing.connect(bettor).bet(betAmount);

    await resolveBet(true);
    await x2OrNothing.connect(bettor).withdrawPayout();

    expect(await wxDAI.balanceOf(bettor.address)).to.equal(expectedBettorBalance);
  });

  it("Should be able to bet and lose", async function () {
    const betAmount = tokens(10);
    const bettorBalance = await wxDAI.balanceOf(bettor.address);
    const expectedBettorBalance = bettorBalance.sub(betAmount);

    await x2OrNothing.connect(bettor).bet(betAmount);

    await resolveBet(false);
    await expect(x2OrNothing.connect(bettor).withdrawPayout()).to.be.revertedWithCustomError(
      x2OrNothing,
      "GameNotExist"
    );

    expect(await wxDAI.balanceOf(bettor.address)).to.equal(expectedBettorBalance);
  });

  it("Should NOT be able to bet if previous didn't resolve", async function () {
    const betAmount = tokens(10);

    await x2OrNothing.connect(bettor).bet(betAmount);
    await expect(x2OrNothing.connect(bettor).bet(betAmount)).to.be.revertedWithCustomError(x2OrNothing, "AwaitingVRF");

    await resolveBet(false);
  });

  it("Should NOT be able to bet if previous didn't withdraw", async function () {
    const betAmount = tokens(10);

    await x2OrNothing.connect(bettor).bet(betAmount);
    await resolveBet(true);

    await expect(x2OrNothing.connect(bettor).bet(betAmount)).to.be.revertedWithCustomError(
      x2OrNothing,
      "AwaitingWithdraw"
    );

    await x2OrNothing.connect(bettor).withdrawPayout();
  });

  it("Should NOT be able to bet payout without previous won bet", async function () {
    const betAmount = tokens(10);

    await x2OrNothing.connect(bettor).bet(betAmount);
    await resolveBet(false);

    await expect(x2OrNothing.connect(bettor).betPayout()).to.be.revertedWithCustomError(x2OrNothing, "GameNotExist");
  });

  it("Should be able to double previous won bet", async function () {
    const betAmount = tokens(15);
    const bettorBalance = await wxDAI.balanceOf(bettor.address);
    const payoutMultiplier = 2;
    const expectedBettorBalance = bettorBalance.sub(betAmount).add(betAmount.mul(payoutMultiplier ** 2));

    await x2OrNothing.connect(bettor).bet(betAmount);
    await resolveBet(true);

    await x2OrNothing.connect(bettor).betPayout();
    await resolveBet(true);

    await x2OrNothing.connect(bettor).withdrawPayout();

    expect(await wxDAI.balanceOf(bettor.address)).to.equal(expectedBettorBalance);
  });

  it("Should be able to bet nft and win", async function () {
    const tokenId = await makeBetOnOutcome();

    const betAmount = await core.viewPayout(tokenId);
    const bettorBalance = await wxDAI.balanceOf(bettor.address);
    const payoutMultiplier = 2;
    const expectedBettorBalance = bettorBalance.add(betAmount.mul(payoutMultiplier));

    await x2OrNothing.connect(bettor).betRedeem(tokenId);

    await resolveBet(true);

    await x2OrNothing.connect(bettor).withdrawPayout();

    expect(await wxDAI.balanceOf(bettor.address)).to.equal(expectedBettorBalance);
  });

  it("Should be able to bet nft and lose", async function () {
    const tokenId = await makeBetOnOutcome();

    const expectedBettorBalance = await wxDAI.balanceOf(bettor.address);

    await x2OrNothing.connect(bettor).betRedeem(tokenId);

    await resolveBet(false);

    await expect(x2OrNothing.connect(bettor).withdrawPayout()).to.be.revertedWithCustomError(
      x2OrNothing,
      "GameNotExist"
    );

    expect(await wxDAI.balanceOf(bettor.address)).to.equal(expectedBettorBalance);
  });

  it("Should be able to lock liquidity and withdraw all available liquidity", async function () {
    const betAmount = tokens(10);
    const lockedLiquidityBeforeBet = await x2OrNothing.lockedLiquidity();
    const payoutMultiplier = 2;

    await x2OrNothing.connect(bettor).bet(betAmount);

    const allLiquidity = await wxDAI.balanceOf(x2OrNothing.address);

    const expectedLockedLiquidity = lockedLiquidityBeforeBet.add(betAmount.mul(payoutMultiplier));
    const expectedAvailableLiquidity = allLiquidity.sub(expectedLockedLiquidity);

    const lockedLiquidityAfterBet = await x2OrNothing.lockedLiquidity();
    const availableLiquidityAfterBet = await x2OrNothing.getAvailableLiquidity();

    expect(lockedLiquidityAfterBet).to.equal(expectedLockedLiquidity);
    expect(availableLiquidityAfterBet).to.equal(expectedAvailableLiquidity);

    await x2OrNothing.withdrawAllAvailableLiquidity(dao.address);
    const allLiquidityAfterWithdraw = await wxDAI.balanceOf(x2OrNothing.address);
    const daoBalance = await wxDAI.balanceOf(dao.address);

    expect(allLiquidityAfterWithdraw).to.equal(expectedLockedLiquidity);
    expect(daoBalance).to.equal(availableLiquidityAfterBet);
  });

  it("Should NOT be able to withdraw zero liquidity", async function () {
    await expect(x2OrNothing.withdrawAllAvailableLiquidity(dao.address)).to.be.revertedWithCustomError(
      x2OrNothing,
      "ZeroLiquidity"
    );
  });

  it("Should be able change contract params", async function () {
    const newMargin = 2;
    await x2OrNothing.changeMargin(newMargin);
    expect(await x2OrNothing.margin()).to.equal(newMargin);

    const newResultPeriod = ONE_MINUTE;
    await x2OrNothing.changeResultPeriod(newResultPeriod);
    expect(await x2OrNothing.resultPeriod()).to.equal(newResultPeriod);

    const newPayoutMultiplier = 3;
    await x2OrNothing.changePayoutMultiplier(newPayoutMultiplier);
    expect(await x2OrNothing.payoutMultiplier()).to.equal(newPayoutMultiplier);

    const newVtf = "0xAE975071Be8F8eE67addBC1A82488F1C24858067";
    const newConsumerId = 123;
    await x2OrNothing.changeVrf(newVtf, newConsumerId, MINREQUESTCONFIRMATIONS, KEYHASH);
    expect(await x2OrNothing.coordinator()).to.equal(newVtf);
    expect(await x2OrNothing.consumerId()).to.equal(newConsumerId);

    const newMinBet = tokens(10);
    await x2OrNothing.changeMinBet(newMinBet);
    expect(await x2OrNothing.minBet()).to.equal(newMinBet);
  });
});
