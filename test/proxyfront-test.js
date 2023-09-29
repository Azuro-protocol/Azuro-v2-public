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

const MULTIPLIER = 1e12;

const ONE_HOUR = 3600;
const ONE_MINUTE = 60;

const getLPNFTDetails = async (txAdd) => {
  const receipt = await txAdd.wait();
  let eAdd = receipt.events.filter((x) => {
    return x.topics[0] == ethers.utils.keccak256(ethers.utils.toUtf8Bytes("LiquidityAdded(address,uint48,uint256)"));
  });
  return {
    tokenId: ethers.utils.defaultAbiCoder.decode(["uint48"], eAdd[0].topics[2])[0],
    amount: ethers.utils.defaultAbiCoder.decode(["uint256"], eAdd[0].data)[0],
    account: ethers.utils.defaultAbiCoder.decode(["address"], eAdd[0].topics[1])[0],
    gasUsed: calcGas(receipt),
  };
};

describe("ProxyFront test", function () {
  const wrapLayer = initFixtureTree(ethers.provider);

  const REINFORCEMENT = tokens(20000);
  const MARGINALITY = MULTIPLIER * 0.05; // 5%

  const minDepo = tokens(10);
  const daoFee = MULTIPLIER * 0.09; // 9%
  const dataProviderFee = MULTIPLIER * 0.01; // 1%
  const affiliateFee = MULTIPLIER * 0.6; // 60%

  const pool1 = 5000000;
  const pool2 = 5000000;

  let dao, poolOwner, dataProvider, oracle, oracle2, maintainer, account;
  let access, core, wxDAI, lp, azuroBet, proxyFront;
  let roleIds, time, balance, wxDAIBalance, betsAmount;

  let gameId = 1;
  let condId = 1;

  let betsData = [];

  async function deployAndInit() {
    [dao, poolOwner, dataProvider, affiliate, oracle, oracle2, maintainer, account] = await ethers.getSigners();

    ({ access, core, wxDAI, lp, azuroBet, roleIds } = await prepareStand(
      ethers,
      dao,
      poolOwner,
      dataProvider,
      affiliate,
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
        extraData: {
          affiliate: ethers.constants.AddressZero,
          minOdds: 0,
          data: encodeBetData(condId, [OUTCOMEWIN], 0),
        },
      });
      betsAmount = betsAmount.add(betAmount);
    }

    await createGame(lp, oracle, ++gameId, time + ONE_HOUR);
    await createCondition(
      core,
      oracle,
      gameId,
      condId,
      [pool2, pool1],
      [OUTCOMEWIN, OUTCOMELOSE],
      REINFORCEMENT,
      MARGINALITY,
      false
    );
  }

  wrapLayer(deployAndInit);

  context("Check functions execution", function () {
    it("Making bets", async () => {
      const txBet = await proxyFront.connect(account).bet(lp.address, betsData);
      const receipt = await txBet.wait();

      expect(await account.getBalance()).to.be.equal(balance.sub(calcGas(receipt)));
      expect(await wxDAI.balanceOf(account.address)).to.be.equal(wxDAIBalance.sub(tokens(300)));
      for (let i = 1; i <= betsData.length; ++i) {
        expect(await azuroBet.ownerOf(i)).to.be.equal(account.address);
      }
    });
    it("Making bets in native tokens", async () => {
      const txBet = await proxyFront.connect(account).bet(lp.address, betsData, { value: betsAmount });
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
        withdrawPayoutsData.push({ core: core.address, tokenId: res.tokenId, isNative: false });
      }

      time = await getBlockTime(ethers);
      await timeShift(time + ONE_HOUR + ONE_MINUTE);
      await core.connect(oracle).resolveCondition(condId, [OUTCOMEWIN]);

      await proxyFront.connect(account).withdrawPayouts(withdrawPayoutsData);
      expect(await wxDAI.balanceOf(account.address)).to.be.equal(wxDAIBalance.add(deltaPayout));
    });
    it("Withdrawing payouts in native tokens", async () => {
      const betAmount = tokens(100),
        withdrawPayoutsData = [];
      let payout = BigNumber.from(0);
      for (const _ of Array(3).keys()) {
        const txBet = await lp.connect(poolOwner).betFor(account.address, core.address, betAmount, time + 100, {
          affiliate: ethers.constants.AddressZero,
          minOdds: 0,
          data: encodeBetData(condId, [OUTCOMEWIN]),
        });
        const { tokenId, odds } = await getTokenIdOdds(core, txBet);

        payout = payout.add(odds.mul(betAmount).div(MULTIPLIER));
        withdrawPayoutsData.push({ core: core.address, tokenId: tokenId, isNative: true });
      }

      time = await getBlockTime(ethers);
      await timeShift(time + ONE_HOUR + ONE_MINUTE);
      await core.connect(oracle).resolveCondition(condId, [OUTCOMEWIN]);

      await proxyFront.connect(poolOwner).withdrawPayouts(withdrawPayoutsData);

      expect(await account.getBalance()).to.be.equal(balance.add(payout));
      expect(await wxDAI.balanceOf(account.address)).to.be.equal(wxDAIBalance);
    });
    it("Adding liquidity in native tokens", async () => {
      const deposit = tokens(100);

      const txAdd = await proxyFront.connect(account).addLiquidityNative(lp.address, [], { value: deposit });
      const details = await getLPNFTDetails(txAdd);

      expect(details.amount).to.be.equal(deposit);
      expect(await lp.ownerOf(details.tokenId)).to.be.equal(account.address);
      expect(await account.getBalance()).to.be.equal(balance.sub(deposit).sub(details.gasUsed));
      expect(await wxDAI.balanceOf(account.address)).to.be.equal(wxDAIBalance);
    });
    it("Withdrawing liquidity in native tokens", async () => {
      const deposit = tokens(100);

      let gasUsed = BigNumber.from(0);
      const txAdd = await proxyFront.connect(account).addLiquidityNative(lp.address, [], { value: deposit });
      const details = await getLPNFTDetails(txAdd);
      gasUsed = gasUsed.add(details.gasUsed);

      const txApprove = await lp.connect(account).approve(proxyFront.address, details.tokenId);
      let receipt = await txApprove.wait();
      gasUsed = gasUsed.add(calcGas(receipt));

      const txWithdraw = await proxyFront
        .connect(account)
        .withdrawLiquidityNative(lp.address, details.tokenId, MULTIPLIER);
      receipt = await txWithdraw.wait();
      gasUsed = gasUsed.add(calcGas(receipt));

      expect(await account.getBalance()).to.be.equal(balance.sub(gasUsed));
      expect(await wxDAI.balanceOf(account.address)).to.be.equal(wxDAIBalance);
    });
  });
  context("Check restrictions", function () {
    it("Bettor CANNOT place bets using common tokens if it don't have enough balance", async () => {
      await wxDAI.connect(dataProvider).approve(proxyFront.address, tokens(999_999_999_999_999));
      await dataProvider.sendTransaction({ to: wxDAI.address, value: betsAmount.sub(1) });
      await expect(proxyFront.connect(dataProvider).bet(lp.address, betsData)).to.be.revertedWith(
        "TransferHelper::transferFrom: transferFrom failed"
      );

      await dataProvider.sendTransaction({ to: wxDAI.address, value: 1 });
      await proxyFront.connect(dataProvider).bet(lp.address, betsData);
    });
    it("Bettor CANNOT place bets using native tokens if passed value is less or larger than the sum of bets", async () => {
      await expect(
        proxyFront.connect(account).bet(lp.address, betsData, { value: betsAmount.sub(1) })
      ).to.be.revertedWithCustomError(proxyFront, "IncorrectValue");
      await expect(
        proxyFront.connect(account).bet(lp.address, betsData, { value: betsAmount.add(1) })
      ).to.be.revertedWithCustomError(proxyFront, "IncorrectValue");

      await proxyFront.connect(account).bet(lp.address, betsData, { value: betsAmount });
    });
  });
});
