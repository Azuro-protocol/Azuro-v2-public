const { expect } = require("chai");
const { constants, BigNumber } = require("ethers");
const { parseUnits, parseEther } = require("ethers/lib/utils");
const { ethers } = require("hardhat");
const {
  getBlockTime,
  tokens,
  prepareStand,
  prepareAccess,
  calcGas,
  createCondition,
  timeShiftBy,
  createGame,
  grantRole,
} = require("../utils/utils");
const { MULTIPLIER, FREEBET_ADDRESS, FORKING, UPGRADE_TEST } = require("../utils/constants");

const LIQUIDITY = tokens(2000000);
const ONE_WEEK = 604800;
const ONE_HOUR = 3600;
const IPFS = ethers.utils.formatBytes32String("ipfs");
const OUTCOMEWIN = 1;
const OUTCOMELOSE = 2;
const OUTCOMES = [OUTCOMEWIN, OUTCOMELOSE];

const odds = (num) => parseUnits(num, 9);
const tokensBN = parseEther;

async function expectTuple(txRes, ...args) {
  const [...results] = await txRes;

  results.forEach((element, index) => {
    if (index >= args.length) return;
    expect(element).to.eq(args[index]);
  });
}

function initFixtureTree(provider) {
  let currentTestLayer = 0;

  function wrapLayer(fixture) {
    let myLayer = 0;
    let snapshotBefore = 0;
    let snapshotBeforeEach = 0;

    before(async () => {
      myLayer = ++currentTestLayer;
      snapshotBefore = await provider.send("evm_snapshot", []);
      await fixture();
    });

    beforeEach(async () => {
      if (currentTestLayer == myLayer) snapshotBeforeEach = await provider.send("evm_snapshot", []);
    });

    afterEach(async () => {
      if (currentTestLayer == myLayer) await provider.send("evm_revert", [snapshotBeforeEach]);
    });

    after(async () => {
      await provider.send("evm_revert", [snapshotBefore]);
      currentTestLayer--;
    });
  }

  return wrapLayer;
}

describe("FreeBet test", function () {
  const wrapLayer = initFixtureTree(ethers.provider);

  let factoryOwner, poolOwner, dataProvider, bettor1, oracle, oracle2, maintainer, bettor2, bettor3, affiliate;
  let access, core, wxDAI, lp, azuroBet, freebet;
  let roleIds, now;
  let gameId = 0;

  const reinforcement = constants.WeiPerEther.mul(20000); // 10%
  const marginality = MULTIPLIER * 0.05; // 5%

  const URI = "https://smth.com";

  let newBet, newBet2;
  let condId;
  let balanceFreebetBefore;

  const pool1 = 5000000;
  const pool2 = 5000000;

  const minDepo = tokens(10);
  const daoFee = MULTIPLIER * 0.09; // 9%
  const dataProviderFee = MULTIPLIER * 0.01; // 1%
  const affiliateFee = MULTIPLIER * 0.33; // 33%

  async function deployAndInit() {
    [factoryOwner, poolOwner, dataProvider, bettor1, oracle, oracle2, maintainer, bettor2, bettor3, affiliate] =
      await ethers.getSigners();

    ({ access, core, wxDAI, lp, azuroBet, roleIds } = await prepareStand(
      ethers,
      factoryOwner,
      poolOwner,
      dataProvider,
      bettor1,
      minDepo,
      daoFee,
      dataProviderFee,
      affiliateFee,
      LIQUIDITY
    ));
    await prepareAccess(access, poolOwner, oracle.address, oracle2.address, maintainer.address, roleIds);

    now = await getBlockTime(ethers);
    condId = 13253453;

    newBet = {
      amount: tokensBN("100"),
      minOdds: odds("1.5"),
      durationTime: BigNumber.from(ONE_WEEK),
    };
    newBet2 = {
      amount: tokensBN("150"),
      minOdds: odds("1.4"),
      durationTime: BigNumber.from(ONE_WEEK / 7),
    };

    const FreeBet = await ethers.getContractFactory("FreeBet");

    if (FORKING && FREEBET_ADDRESS !== "") {
      freebet = await FreeBet.attach(FREEBET_ADDRESS);
      const freebetOwnerAddress = await freebet.owner();
      await hre.network.provider.request({
        method: "hardhat_impersonateAccount",
        params: [freebetOwnerAddress],
      });
      const freebetOwner = await ethers.provider.getSigner(freebetOwnerAddress);

      if (UPGRADE_TEST) {
        const FreeBet = await ethers.getContractFactory("FreeBet", { signer: freebetOwner });
        try {
          await upgrades.upgradeProxy(FREEBET_ADDRESS, FreeBet);
        } catch (err) {
          console.log("⚠️FreeBet not upgraded:", err);
        }
      }
      await freebet.connect(freebetOwner).transferOwnership(factoryOwner.address);
    } else {
      freebet = await upgrades.deployProxy(FreeBet, [wxDAI.address]);
      await freebet.deployed();
    }

    await freebet.setLp(lp.address);

    await freebet.setManager(maintainer.address);

    await factoryOwner.sendTransaction({ to: wxDAI.address, value: tokens(8_000_000) });

    await wxDAI.transfer(maintainer.address, tokens(10000));

    // funding freebet
    await wxDAI.transfer(freebet.address, tokens(1000));
    balanceFreebetBefore = await wxDAI.balanceOf(freebet.address);

    await createGame(lp, oracle, ++gameId, IPFS, now + ONE_HOUR);

    await createCondition(core, oracle, gameId, condId, [pool2, pool1], OUTCOMES, reinforcement, marginality);
  }

  wrapLayer(deployAndInit);

  it("Check deploy FreeBet", async () => {
    const FreeBet = await ethers.getContractFactory("FreeBet");
    const freebet = await upgrades.deployProxy(FreeBet, [wxDAI.address]);
    await freebet.deployed();
  });
  it("Fails to deploy FreeBet if token is null", async () => {
    const FreeBet = await ethers.getContractFactory("FreeBet");
    await expect(upgrades.deployProxy(FreeBet, [ethers.constants.AddressZero])).to.be.revertedWithCustomError(
      freebet,
      "WrongToken"
    );
  });
  it("Check changing URI", async () => {
    await freebet.setBaseURI(URI);
    expect(await freebet.baseURI()).to.be.equal(URI);
  });
  it("Check supportsInterface EIP165, ERC721", async () => {
    expect(await freebet.supportsInterface(0x01ffc9a7)).to.be.equal(true); // IERC165Upgradeable
    expect(await freebet.supportsInterface(0x80ac58cd)).to.be.equal(true); // IERC721Upgradeable
    expect(await freebet.supportsInterface(0x5b5e139f)).to.be.equal(true); // IERC721MetadataUpgradeable
  });
  it("Check only owner", async () => {
    await expect(freebet.connect(bettor1).setBaseURI(URI)).to.be.revertedWith("Ownable: account is not the owner");
    await expect(freebet.connect(maintainer).setLp(lp.address)).to.be.revertedWith("Ownable: account is not the owner");
  });
  it("Check only maintainer", async () => {
    await expect(freebet.connect(bettor1).withdrawReserve(100)).to.be.revertedWithCustomError(freebet, "OnlyManager");
    await expect(freebet.connect(bettor1).withdrawReserveNative(100)).to.be.revertedWithCustomError(
      freebet,
      "OnlyManager"
    );
    await expect(freebet.connect(bettor1).mint(bettor2.address, newBet)).to.be.revertedWithCustomError(
      freebet,
      "OnlyManager"
    );
    await expect(
      freebet.connect(poolOwner).mintBatch([bettor2.address, bettor3.address], newBet)
    ).to.be.revertedWithCustomError(freebet, "OnlyManager");
  });

  it("Should add funds for any user", async () => {
    const balanceBefore = await wxDAI.balanceOf(bettor1.address);
    await wxDAI.connect(bettor1).approve(freebet.address, tokens(1000));
    await wxDAI.connect(bettor1).transfer(freebet.address, tokens(1000));
    expect(await wxDAI.balanceOf(bettor1.address)).to.eq(balanceBefore.sub(tokens(1000)));
    expect(await wxDAI.balanceOf(freebet.address)).to.eq(balanceFreebetBefore.add(tokens(1000)));
  });
  it("Should add funds in native for any user", async () => {
    const balanceNativeBefore = await bettor1.getBalance();
    const tx = await bettor1.sendTransaction({ to: freebet.address, value: tokens(1000) });
    const res = await tx.wait();
    expect(await bettor1.getBalance()).to.be.eq(balanceNativeBefore.sub(tokens(1000)).sub(calcGas(res)));
    expect(await wxDAI.balanceOf(freebet.address)).to.eq(balanceFreebetBefore.add(tokens(1000)));
  });
  it("Should withdraw all funds for maintainer", async () => {
    const balanceBefore = await wxDAI.balanceOf(maintainer.address);
    await freebet.connect(maintainer).withdrawReserve(tokens(1000));
    expect(await wxDAI.balanceOf(maintainer.address)).to.eq(balanceBefore.add(tokens(1000)));
    expect(await wxDAI.balanceOf(freebet.address)).to.eq(balanceFreebetBefore.sub(tokens(1000)));
  });
  it("Should withdraw all funds in native for maintainer", async () => {
    const balanceBefore = await wxDAI.balanceOf(maintainer.address);
    const balanceNativeBefore = await maintainer.getBalance();
    const tx = await freebet.connect(maintainer).withdrawReserveNative(tokens(1000));
    const res = await tx.wait();
    expect(await wxDAI.balanceOf(maintainer.address)).to.eq(balanceBefore);
    expect(await maintainer.getBalance()).to.be.eq(balanceNativeBefore.add(tokens(1000)).sub(calcGas(res)));
    expect(await wxDAI.balanceOf(freebet.address)).to.eq(balanceFreebetBefore.sub(tokens(1000)));
  });
  it("Should not withdraw if amount is too big", async () => {
    await expect(freebet.connect(maintainer).withdrawReserve(tokens(10000))).to.be.revertedWithCustomError(
      freebet,
      "InsufficientContractBalance"
    );
    expect(await wxDAI.balanceOf(freebet.address)).to.eq(balanceFreebetBefore);
  });

  it("Should return empty array if no expired bets", async () => {
    const expired = await freebet.getExpiredUnresolved(0, 1000);
    expect(expired[0]).to.eql(new Array(1000).fill(BigNumber.from(0)));
    expect(expired[1]).to.eq(0);
  });

  context("Minted freebet", () => {
    async function mint() {
      await freebet.connect(maintainer).mint(bettor1.address, newBet);
    }

    wrapLayer(mint);

    it("Should mint successfully", async () => {
      expect(await freebet.balanceOf(bettor1.address)).to.eq(1);
      expect(await freebet.lockedReserve()).to.eq(newBet.amount);
      await expect(freebet.connect(maintainer).mint(bettor1.address, newBet2))
        .to.emit(freebet, "FreeBetMinted")
        .withArgs(bettor1.address, 2, [newBet2.amount, newBet2.minOdds, newBet2.durationTime]);
      expect(await freebet.balanceOf(bettor1.address)).to.eq(2);
      expect(await freebet.lockedReserve()).to.eq(newBet.amount.add(newBet2.amount));
      await expectTuple(await freebet.freeBets(2), newBet2.amount, newBet2.minOdds, newBet2.durationTime);
      expect(await freebet.expirationTime(2)).to.be.closeTo(newBet2.durationTime.add(now), 1000);
    });

    it("Should mint batch", async () => {
      expect(await freebet.balanceOf(bettor1.address)).to.eq(1);
      expect(await freebet.lockedReserve()).to.eq(newBet.amount);
      const bettors = [bettor1.address, bettor2.address, bettor3.address];
      await expect(freebet.connect(maintainer).mintBatch(bettors, newBet))
        .to.emit(freebet, "FreeBetMintedBatch")
        .withArgs(bettors, 2, 3, [newBet.amount, newBet.minOdds, newBet.durationTime]);
      await expectTuple(await freebet.freeBets(2), newBet.amount, newBet.minOdds, newBet.durationTime);
      await expectTuple(await freebet.freeBets(3), newBet.amount, newBet.minOdds, newBet.durationTime);
      await expectTuple(await freebet.freeBets(4), newBet.amount, newBet.minOdds, newBet.durationTime);
      expect(await freebet.lockedReserve()).to.eq(newBet.amount.mul(2).add(newBet.amount.mul(2)));
      expect(await freebet.balanceOf(bettor1.address)).to.eq(2);
    });

    it("Should only burn expired bets", async () => {
      await freebet.connect(maintainer).mint(bettor1.address, newBet);
      await freebet.connect(maintainer).mintBatch([bettor2.address, bettor3.address], newBet2);
      expect(await freebet.lockedReserve()).to.eq(newBet.amount.mul(2).add(newBet2.amount.mul(2)));

      await timeShiftBy(ethers, ONE_WEEK / 2);
      const [expired, length] = await freebet.getExpiredUnresolved(0, 100);
      expect(length).to.eq(2);
      expect(expired).to.eql([
        BigNumber.from(3),
        BigNumber.from(4),
        ...new Array(100 - length).fill(BigNumber.from(0)),
      ]);
      const tx = freebet.resolveExpired([3, 4]);
      await expect(tx).to.emit(freebet, "FreeBetsResolved").withArgs([3, 4], tokens(300));
      expect((await freebet.getExpiredUnresolved(0, 100))[0]).to.eql(new Array(100).fill(BigNumber.from(0)));
      expect(await freebet.lockedReserve()).to.eq(newBet.amount.mul(2));
    });

    it("Can't be transferred", async () => {
      await expect(
        freebet.connect(bettor1).transferFrom(bettor1.address, factoryOwner.address, 1)
      ).to.be.revertedWithCustomError(freebet, "NonTransferable");
    });

    it("Should redeem correct freebet", async () => {
      const expectedOdds = await core.calcOdds(condId, tokens(50), OUTCOMEWIN);
      const azurobetId = (await azuroBet.lastTokenId()) + 1;
      expect(await freebet.lockedReserve()).to.eq(newBet.amount);
      await expectTuple(await freebet.freeBets(1), newBet.amount, newBet.minOdds, newBet.durationTime);
      await expectTuple(
        await freebet.azuroBets(azurobetId),
        ethers.constants.AddressZero,
        ethers.constants.AddressZero,
        0,
        0,
        0
      );
      const tx = freebet
        .connect(bettor1)
        .redeem(core.address, 1, condId, tokens(50), OUTCOMEWIN, now + ONE_HOUR, odds("1.5"), affiliate.address);

      await expect(tx)
        .to.emit(freebet, "FreeBetRedeemed")
        .withArgs(core.address, bettor1.address, 1, azurobetId, tokens(50));

      await expect(tx)
        .to.emit(core, "NewBet")
        .withArgs(freebet.address, affiliate.address, condId, azurobetId, OUTCOMEWIN, tokens(50), expectedOdds, [
          tokens(10050),
          tokens(10000).sub(tokens(50).mul(expectedOdds.sub(MULTIPLIER)).div(MULTIPLIER)),
        ]);

      await expect(tx).to.emit(wxDAI, "Transfer").withArgs(freebet.address, lp.address, tokens(50));

      await expectTuple(
        await freebet.freeBets(1),
        newBet.amount.sub(tokensBN("50")),
        newBet.minOdds,
        newBet.durationTime
      );
      await expectTuple(await freebet.azuroBets(azurobetId), core.address, bettor1.address, 1, tokensBN("50"), 0);

      expect(await freebet.lockedReserve()).to.eq(newBet.amount.sub(tokens(50)));
    });

    it("Shouldn't redeem expired freebet", async () => {
      await timeShiftBy(ethers, ONE_WEEK + 60);
      await expect(
        freebet
          .connect(bettor1)
          .redeem(core.address, 1, condId, tokens(50), OUTCOMEWIN, now + ONE_HOUR, odds("1.5"), affiliate.address)
      ).to.be.revertedWithCustomError(freebet, "BetExpired");
    });

    it("Should revert redeem of not owned freebet", async () => {
      await expect(
        freebet
          .connect(bettor2)
          .redeem(core.address, 1, condId, tokens(50), OUTCOMEWIN, now + ONE_HOUR, odds("1.5"), affiliate.address)
      ).to.be.revertedWithCustomError(freebet, "OnlyBetOwner");
    });
    it("Should revert withdraw if requested tokens are locked", async () => {
      await expect(freebet.connect(maintainer).withdrawReserve(tokens(1000))).to.be.revertedWithCustomError(
        freebet,
        "InsufficientContractBalance"
      );
      expect(await wxDAI.balanceOf(freebet.address)).to.eq(tokens(1000));
    });

    it("Should let withdraw unlocked tokens", async () => {
      await freebet.connect(maintainer).withdrawReserve(tokens(900));
      await timeShiftBy(ethers, ONE_WEEK + 60);
      const [ids, length] = await freebet.getExpiredUnresolved(0, 100);
      await freebet.resolveExpired(ids.slice(0, length));
      await freebet.connect(maintainer).withdrawReserve(tokens(100));
      expect(await wxDAI.balanceOf(freebet.address)).to.eq(0);
    });

    context("Redeemed on 1 outcome", async () => {
      let odds1;
      let betAmount;
      const azurobetId = (await azuroBet.lastTokenId()) + 1;

      async function redeem() {
        betAmount = newBet.amount;
        odds1 = await core.calcOdds(condId, betAmount, OUTCOMEWIN);

        await freebet
          .connect(bettor1)
          .redeem(core.address, 1, condId, betAmount, OUTCOMEWIN, now + ONE_HOUR, odds("1.5"), affiliate.address);
      }

      wrapLayer(redeem);

      context("Win", () => {
        let payout;

        async function win() {
          payout = betAmount.mul(odds1).div(MULTIPLIER);
          await timeShiftBy(ethers, ONE_HOUR * 2);
          await core.connect(oracle).resolveCondition(condId, OUTCOMEWIN);
        }

        wrapLayer(win);

        it("Should resolve payout by any user and burn freebet", async () => {
          await expectTuple(await freebet.azuroBets(azurobetId), core.address, bettor1.address, 1, newBet.amount, 0);
          const tx = freebet.connect(bettor2).resolvePayout(azurobetId);

          await expect(tx).to.emit(freebet, "Transfer").withArgs(bettor1.address, constants.AddressZero, 1);
          await expect(tx).to.emit(lp, "BettorWin").withArgs(core.address, freebet.address, azurobetId, payout);
          await expect(tx).to.emit(wxDAI, "Transfer").withArgs(lp.address, freebet.address, payout);
          await expectTuple(
            await freebet.azuroBets(azurobetId),
            core.address,
            bettor1.address,
            1,
            0,
            payout.sub(betAmount)
          );

          await expect(freebet.connect(bettor2).resolvePayout(azurobetId)).to.be.revertedWithCustomError(
            freebet,
            "AlreadyResolved"
          );
        });

        it("Should Withdraw payout after resolve", async () => {
          await freebet.connect(bettor2).resolvePayout(azurobetId);

          await expectTuple(
            await freebet.azuroBets(azurobetId),
            core.address,
            bettor1.address,
            1,
            0,
            payout.sub(betAmount)
          );
          const tx = freebet.connect(bettor1).withdrawPayout(azurobetId);
          await expect(tx).to.emit(wxDAI, "Transfer").withArgs(freebet.address, bettor1.address, payout.sub(betAmount));
          await expect(tx)
            .to.emit(freebet, "BettorWin")
            .withArgs(core.address, bettor1.address, azurobetId, payout.sub(betAmount));
          await expectTuple(await freebet.azuroBets(azurobetId), core.address, bettor1.address, 1, 0, 0);

          await expect(freebet.connect(bettor2).resolvePayout(azurobetId)).to.be.revertedWithCustomError(
            freebet,
            "AlreadyResolved"
          );
          await expect(freebet.connect(bettor1).withdrawPayout(azurobetId)).to.not.be.reverted;
        });

        it("Should Withdraw payout in native after resolve", async () => {
          await freebet.connect(bettor2).resolvePayout(azurobetId);

          await expectTuple(
            await freebet.azuroBets(azurobetId),
            core.address,
            bettor1.address,
            1,
            0,
            payout.sub(betAmount)
          );
          const balanceNativeBefore = await bettor1.getBalance();
          const tx = await freebet.connect(bettor1).withdrawPayoutNative(azurobetId);
          await expect(tx)
            .to.emit(freebet, "BettorWin")
            .withArgs(core.address, bettor1.address, azurobetId, payout.sub(betAmount));
          const res = await tx.wait();
          expect(await bettor1.getBalance()).to.eq(balanceNativeBefore.add(payout.sub(betAmount)).sub(calcGas(res)));
          await expectTuple(await freebet.azuroBets(azurobetId), core.address, bettor1.address, 1, 0, 0);

          await expect(freebet.connect(bettor2).resolvePayout(azurobetId)).to.be.revertedWithCustomError(
            freebet,
            "AlreadyResolved"
          );
          await expect(freebet.connect(bettor1).withdrawPayout(azurobetId)).to.not.be.reverted;
        });

        it("Should resolve and withdraw by calling withdraw", async () => {
          await expectTuple(await freebet.azuroBets(azurobetId), core.address, bettor1.address, 1, newBet.amount, 0);
          const tx = freebet.connect(bettor1).withdrawPayout(azurobetId);
          await expect(tx).to.emit(freebet, "Transfer").withArgs(bettor1.address, constants.AddressZero, 1);
          await expect(tx).to.emit(lp, "BettorWin").withArgs(core.address, freebet.address, azurobetId, payout);
          await expect(tx).to.emit(wxDAI, "Transfer").withArgs(lp.address, freebet.address, payout);
          await expect(tx).to.emit(wxDAI, "Transfer").withArgs(freebet.address, bettor1.address, payout.sub(betAmount));
          await expect(tx)
            .to.emit(freebet, "BettorWin")
            .withArgs(core.address, bettor1.address, azurobetId, payout.sub(betAmount));
          await expectTuple(await freebet.azuroBets(azurobetId), core.address, bettor1.address, 1, 0, 0);

          await expect(freebet.connect(bettor2).resolvePayout(azurobetId)).to.be.revertedWithCustomError(
            freebet,
            "AlreadyResolved"
          );
          await expect(freebet.connect(bettor1).withdrawPayout(azurobetId)).to.not.be.reverted;
        });

        it("Should revert withdraw payout of not owned Azuro bet", async () => {
          await expect(freebet.connect(bettor2).withdrawPayout(azurobetId)).to.be.revertedWithCustomError(
            core,
            "OnlyBetOwner"
          );
        });
      });

      context("Lose", () => {
        async function lose() {
          await timeShiftBy(ethers, ONE_HOUR * 2);
          await core.connect(oracle).resolveCondition(condId, 2);
        }

        wrapLayer(lose);

        it("Should resolve 0 payout and burn freebet", async () => {
          await expectTuple(await freebet.azuroBets(azurobetId), core.address, bettor1.address, 1, newBet.amount, 0);
          const tx = freebet.connect(bettor2).resolvePayout(azurobetId);

          await expect(tx).to.emit(freebet, "Transfer").withArgs(bettor1.address, constants.AddressZero, 1);
          await expectTuple(await freebet.azuroBets(azurobetId), core.address, bettor1.address, 1, 0, 0);

          await expect(freebet.connect(bettor2).resolvePayout(azurobetId)).to.be.revertedWithCustomError(
            freebet,
            "AlreadyResolved"
          );
        });

        it("Should withdraw 0 payout and burn freebet", async () => {
          await expectTuple(await freebet.azuroBets(azurobetId), core.address, bettor1.address, 1, newBet.amount, 0);
          const tx = freebet.connect(bettor1).withdrawPayout(azurobetId);

          await expect(tx).to.emit(freebet, "Transfer").withArgs(bettor1.address, constants.AddressZero, 1);
          await expect(tx).to.not.emit(freebet, "BettorWin");
          await expectTuple(await freebet.azuroBets(azurobetId), core.address, bettor1.address, 1, 0, 0);

          await expect(freebet.connect(bettor2).resolvePayout(azurobetId)).to.be.revertedWithCustomError(
            freebet,
            "AlreadyResolved"
          );
          await expect(freebet.connect(bettor1).withdrawPayout(azurobetId)).to.not.be.reverted;
        });
      });

      context("Cancel", () => {
        async function cancel() {
          await timeShiftBy(ethers, ONE_HOUR * 2);
          await core.connect(oracle).cancelCondition(condId);
        }

        wrapLayer(cancel);

        it("Should reissue freebet on resolve", async () => {
          await expectTuple(await freebet.azuroBets(azurobetId), core.address, bettor1.address, 1, newBet.amount, 0);
          await expectTuple(await freebet.freeBets(1), 0, newBet.minOdds, newBet.durationTime);
          expect(await freebet.lockedReserve()).to.eq(0);

          const tx = freebet.connect(bettor2).resolvePayout(azurobetId);

          await expect(tx).to.emit(lp, "BettorWin").withArgs(core.address, freebet.address, azurobetId, betAmount);
          await expect(tx).to.emit(wxDAI, "Transfer").withArgs(lp.address, freebet.address, betAmount);
          await expect(tx)
            .to.emit(freebet, "FreeBetReissued")
            .withArgs(bettor1.address, 1, [newBet.amount, newBet.minOdds, newBet.durationTime]);

          await expectTuple(await freebet.freeBets(1), newBet.amount, newBet.minOdds, newBet.durationTime);
          await expectTuple(await freebet.azuroBets(azurobetId), core.address, bettor1.address, 1, 0, 0);
          expect(await freebet.expirationTime(1)).to.be.closeTo(
            newBet.durationTime.add(await getBlockTime(ethers)),
            1000
          );
          expect(await freebet.lockedReserve()).to.eq(newBet.amount);

          await expect(freebet.connect(bettor2).resolvePayout(azurobetId)).to.be.revertedWithCustomError(
            freebet,
            "AlreadyResolved"
          );
        });

        it("Should Withdraw payout after resolve", async () => {
          await freebet.connect(bettor2).resolvePayout(azurobetId);

          await expectTuple(await freebet.azuroBets(azurobetId), core.address, bettor1.address, 1, 0, 0);
          const tx = freebet.connect(bettor1).withdrawPayout(azurobetId);
          await expect(tx).to.not.emit(wxDAI, "Transfer");
          await expect(tx).to.not.emit(freebet, "BettorWin");
          await expectTuple(await freebet.azuroBets(azurobetId), core.address, bettor1.address, 1, 0, 0);

          await expect(freebet.connect(bettor2).resolvePayout(azurobetId)).to.be.revertedWithCustomError(
            freebet,
            "AlreadyResolved"
          );
          await expect(freebet.connect(bettor1).withdrawPayout(azurobetId)).to.not.be.reverted;
        });

        it("Should resolve and withdraw by calling withdraw", async () => {
          await expectTuple(await freebet.azuroBets(azurobetId), core.address, bettor1.address, 1, newBet.amount, 0);
          expect(await freebet.lockedReserve()).to.eq(0);

          const tx = freebet.connect(bettor1).withdrawPayout(azurobetId);

          await expect(tx).to.emit(lp, "BettorWin").withArgs(core.address, freebet.address, azurobetId, betAmount);
          await expect(tx).to.emit(wxDAI, "Transfer").withArgs(lp.address, freebet.address, betAmount);
          await expect(tx)
            .to.emit(freebet, "FreeBetReissued")
            .withArgs(bettor1.address, 1, [newBet.amount, newBet.minOdds, newBet.durationTime]);
          await expect(tx).to.not.emit(freebet, "BettorWin");
          await expectTuple(await freebet.azuroBets(azurobetId), core.address, bettor1.address, 1, 0, 0);
          expect(await freebet.expirationTime(1)).to.be.closeTo(
            newBet.durationTime.add(await getBlockTime(ethers)),
            1000
          );
          expect(await freebet.lockedReserve()).to.eq(newBet.amount);

          await expect(freebet.connect(bettor1).withdrawPayout(azurobetId)).to.not.be.reverted;
          await expect(freebet.connect(bettor2).resolvePayout(azurobetId)).to.be.revertedWithCustomError(
            freebet,
            "AlreadyResolved"
          );
        });
      });
    });
  });
});
