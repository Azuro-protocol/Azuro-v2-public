const { expect } = require("chai");
const { BigNumber } = require("ethers");
const { ethers } = require("hardhat");
const {
  calcGas,
  createCondition,
  createGame,
  encodeBetData,
  getBlockTime,
  getTokenIdOdds,
  initFixtureTree,
  makeBetGetTokenIdOdds,
  prepareAccess,
  prepareStand,
  timeShift,
  tokens,
} = require("../utils/utils");

const LIQUIDITY = tokens(200000);

const OUTCOMEWIN = 1;
const OUTCOMELOSE = 2;
const IPFS = ethers.utils.formatBytes32String("ipfs");

const MULTIPLIER = 1e12;

const ONE_HOUR = 3600;
const ONE_MINUTE = 60;

describe("ProxyFront test", function () {
  const wrapLayer = initFixtureTree(ethers.provider);

  const REINFORCEMENT = tokens(20000);
  const MARGINALITY = MULTIPLIER * 0.05; // 5%

  const minDepo = tokens(10);
  const daoFee = MULTIPLIER * 0.09; // 9%
  const dataProviderFee = MULTIPLIER * 0.01; // 1%
  const affiliateFee = MULTIPLIER * 0.33; // 33%

  const pool1 = 5000000;
  const pool2 = 5000000;

  let dao, poolOwner, dataProvider, oracle, oracle2, maintainer, account;
  let access, core, wxDAI, lp, azuroBet, proxyFront;
  let roleIds, time, balance, wxDAIBalance, betsAmount;

  let gameId = 1;
  let condId = 1;

  let betsData = [];

  async function deployAndInit() {
    [dao, poolOwner, dataProvider, oracle, oracle2, maintainer, account] = await ethers.getSigners();

    ({ access, core, wxDAI, lp, azuroBet, roleIds } = await prepareStand(
      ethers,
      dao,
      poolOwner,
      dataProvider,
      account,
      minDepo,
      daoFee,
      dataProviderFee,
      affiliateFee,
      LIQUIDITY
    ));

    await prepareAccess(access, poolOwner, oracle.address, oracle2.address, maintainer.address, roleIds);

    const ProxyFront = await ethers.getContractFactory("ProxyFront");
    proxyFront = await upgrades.deployProxy(ProxyFront);
    await proxyFront.deployed();

    await wxDAI.connect(account).approve(proxyFront.address, tokens(999_999_999_999_999));
    balance = await account.getBalance();
    wxDAIBalance = await wxDAI.balanceOf(account.address);

    time = await getBlockTime(ethers);
    betsAmount = BigNumber.from(0);
    for (const i of Array(3).keys()) {
      const betAmount = tokens(50).mul(i + 1);
      betsData.push({
        core: core.address,
        amount: betAmount,
        expiresAt: time + 100,
        extraData: { affiliate: ethers.constants.AddressZero, data: encodeBetData(condId, OUTCOMEWIN, 0) },
      });
      betsAmount = betsAmount.add(betAmount);
    }

    await createGame(lp, oracle, gameId, IPFS, time + ONE_HOUR);
    await createCondition(
      core,
      oracle,
      gameId,
      condId,
      [pool2, pool1],
      [OUTCOMEWIN, OUTCOMELOSE],
      REINFORCEMENT,
      MARGINALITY
    );
  }

  wrapLayer(deployAndInit);

  context("Check functions execution", function () {
    it("Making bets", async () => {
      const txBet = await proxyFront.connect(account).bet(lp.address, betsData, false);
      const receipt = await txBet.wait();

      expect(await account.getBalance()).to.be.equal(balance.sub(calcGas(receipt)));
      expect(await wxDAI.balanceOf(account.address)).to.be.equal(wxDAIBalance.sub(tokens(300)));
      for (let i = 1; i <= betsData.length; ++i) {
        expect(await azuroBet.ownerOf(i)).to.be.equal(account.address);
      }
    });
    it("Making bets in native tokens", async () => {
      const txBet = await proxyFront.connect(account).bet(lp.address, betsData, true, { value: betsAmount });
      const receipt = await txBet.wait();

      expect(await account.getBalance()).to.be.equal(balance.sub(betsAmount).sub(calcGas(receipt)));
      expect(await wxDAI.balanceOf(account.address)).to.be.equal(wxDAIBalance);
      for (let i = 1; i <= betsData.length; ++i) {
        expect(await azuroBet.ownerOf(i)).to.be.equal(account.address);
      }
    });
    it("Withdrawing payouts", async () => {
      const betAmount = tokens(100),
        withdrawPayoutsData = [];
      let deltaPayout = BigNumber.from(0);
      for (const _ of Array(3).keys()) {
        const res = await makeBetGetTokenIdOdds(
          lp,
          core,
          account,
          ethers.constants.AddressZero,
          condId,
          betAmount,
          OUTCOMEWIN,
          time + 100,
          0
        );
        deltaPayout = deltaPayout.add(res.odds.mul(betAmount).div(MULTIPLIER).sub(betAmount));
        withdrawPayoutsData.push({ core: core.address, tokenId: res.tokenId });
      }

      time = await getBlockTime(ethers);
      await timeShift(time + ONE_HOUR + ONE_MINUTE);
      await core.connect(oracle).resolveCondition(condId, OUTCOMEWIN);

      await proxyFront.connect(account).withdrawPayouts(lp.address, withdrawPayoutsData, false);
      expect(await wxDAI.balanceOf(account.address)).to.be.equal(wxDAIBalance.add(deltaPayout));
    });
    it("Withdrawing payouts in native tokens", async () => {
      const betAmount = tokens(100),
        withdrawPayoutsData = [];
      let payout = BigNumber.from(0);
      for (const _ of Array(3).keys()) {
        const txBet = await lp.connect(poolOwner).betFor(account.address, core.address, betAmount, time + 100, {
          affiliate: ethers.constants.AddressZero,
          data: encodeBetData(condId, OUTCOMEWIN, 0),
        });
        const { tokenId, odds } = await getTokenIdOdds(core, txBet);

        payout = payout.add(odds.mul(betAmount).div(MULTIPLIER));
        withdrawPayoutsData.push({ core: core.address, tokenId: tokenId });
      }

      time = await getBlockTime(ethers);
      await timeShift(time + ONE_HOUR + ONE_MINUTE);
      await core.connect(oracle).resolveCondition(condId, OUTCOMEWIN);

      await proxyFront.connect(poolOwner).withdrawPayouts(lp.address, withdrawPayoutsData, true);

      expect(await account.getBalance()).to.be.equal(balance.add(payout));
      expect(await wxDAI.balanceOf(account.address)).to.be.equal(wxDAIBalance);
    });
  });
  context("Check restrictions", function () {
    it("Bettor CANNOT place bets using common tokens if it don't have enough balance", async () => {
      await wxDAI.connect(dataProvider).approve(proxyFront.address, tokens(999_999_999_999_999));
      await dataProvider.sendTransaction({ to: wxDAI.address, value: betsAmount.sub(1) });
      await expect(proxyFront.connect(dataProvider).bet(lp.address, betsData, false)).to.be.revertedWith(
        "TransferHelper::transferFrom: transferFrom failed"
      );

      await dataProvider.sendTransaction({ to: wxDAI.address, value: 1 });
      await proxyFront.connect(dataProvider).bet(lp.address, betsData, false);
    });
    it("Bettor CANNOT place bets using native tokens if passed value is less or larger than the sum of bets", async () => {
      await expect(
        proxyFront.connect(account).bet(lp.address, betsData, true, { value: betsAmount.sub(1) })
      ).to.be.revertedWithCustomError(proxyFront, "IncorrectValue");
      await expect(
        proxyFront.connect(account).bet(lp.address, betsData, true, { value: betsAmount.add(1) })
      ).to.be.revertedWithCustomError(proxyFront, "IncorrectValue");

      await proxyFront.connect(account).bet(lp.address, betsData, true, { value: betsAmount });
    });
  });
});
