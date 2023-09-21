const { expect } = require("chai");
const { constants, BigNumber } = require("ethers");
const { parseUnits } = require("ethers/lib/utils");
const { ethers } = require("hardhat");
const {
  getBlockTime,
  tokens,
  prepareStand,
  prepareAccess,
  createCondition,
  timeShiftBy,
  createGame,
  addRole,
  grantRole,
} = require("../utils/utils");
const { MULTIPLIER, FREEBET_ADDRESS, FORKING, UPGRADE_TEST } = require("../utils/constants");

const LIQUIDITY = tokens(2000000);
const ONE_WEEK = 604800;
const ONE_HOUR = 3600;

const OUTCOMEWIN = 1;
const OUTCOMELOSE = 2;
const OUTCOMES = [OUTCOMEWIN, [OUTCOMELOSE]];

const odds = (num) => parseUnits(num, 9);

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
  let access, core, wxDAI, lp, azuroBet, freeBetFactory, freeBetFactoryAccess, freeBet;
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
      LIQUIDITY
    ));
    await prepareAccess(access, poolOwner, oracle.address, oracle2.address, maintainer.address, roleIds);

    now = await getBlockTime(ethers);
    condId = 13253453;

    newBet = {
      amount: tokens(100),
      minOdds: odds("1.5"),
      durationTime: BigNumber.from(ONE_WEEK),
    };
    newBet2 = {
      amount: tokens(150),
      minOdds: odds("1.4"),
      durationTime: BigNumber.from(ONE_WEEK / 7),
    };

    const Access = await ethers.getContractFactory("Access", { signer: factoryOwner });
    const FreeBetFactory = await ethers.getContractFactory("FreeBetFactory", { signer: factoryOwner });
    const FreeBet = await ethers.getContractFactory("FreeBet");

    if (FORKING && FREEBET_ADDRESS !== "") {
      freeBet = await FreeBet.attach(FREEBET_ADDRESS);
      const freeBetOwnerAddress = await freeBet.owner();
      await hre.network.provider.request({
        method: "hardhat_impersonateAccount",
        params: [freeBetOwnerAddress],
      });
      const freeBetOwner = await ethers.provider.getSigner(freeBetOwnerAddress);

      if (UPGRADE_TEST) {
        const FreeBet = await ethers.getContractFactory("FreeBet", { signer: freeBetOwner });
        try {
          await upgrades.upgradeProxy(FREEBET_ADDRESS, FreeBet);
        } catch (err) {
          console.log("⚠️FreeBet not upgraded:", err);
        }
      }
      await freeBet.connect(freeBetOwner).transferOwnership(factoryOwner.address);
    } else {
      freeBetFactoryAccess = await upgrades.deployProxy(Access);
      freeBetFactory = await upgrades.deployProxy(FreeBetFactory, [freeBetFactoryAccess.address]);

      const freeBetDeployerRoleId = await addRole(freeBetFactoryAccess, factoryOwner, "FreeBet Deployer");
      await freeBetFactoryAccess.connect(factoryOwner).bindRole({
        target: freeBetFactory.address,
        selector: "0x04209123",
        roleId: freeBetDeployerRoleId,
      });
      await grantRole(freeBetFactoryAccess, factoryOwner, poolOwner.address, freeBetDeployerRoleId);

      const txCreateFreeBet = await freeBetFactory
        .connect(poolOwner)
        .createFreeBet(lp.address, "XYZFreeBet", "XFBET", affiliate.address, maintainer.address);
      const receipt = await txCreateFreeBet.wait();
      let iface = new ethers.utils.Interface(
        freeBetFactory.interface.format(ethers.utils.FormatTypes.full).filter((x) => {
          return x.includes("NewFreeBet");
        })
      );
      let log = iface.parseLog(receipt.logs[4]);
      freeBet = await FreeBet.attach(log.args.freeBetAddress);
    }

    await factoryOwner.sendTransaction({ to: wxDAI.address, value: tokens(8_000_000) });

    await wxDAI.transfer(maintainer.address, tokens(10000));

    // funding freeBet
    await wxDAI.transfer(freeBet.address, tokens(1000));
    balanceFreebetBefore = await wxDAI.balanceOf(freeBet.address);

    await createGame(lp, oracle, ++gameId, now + ONE_HOUR);

    await createCondition(core, oracle, gameId, condId, [pool2, pool1], OUTCOMES, reinforcement, marginality);
  }

  wrapLayer(deployAndInit);

  it("Check FreeBet Factory access", async () => {
    await expect(
      freeBetFactory
        .connect(factoryOwner)
        .createFreeBet(lp.address, "XYZFreeBet", "XFBET", affiliate.address, maintainer.address)
    ).to.be.revertedWithCustomError(freeBetFactoryAccess, "AccessNotGranted");
  });
  it("Check FreeBet beacon owner", async () => {
    const freeBetBeaconAddress = await freeBetFactory.freeBetBeacon();
    const UpgradeableBeacon = await ethers.getContractFactory("UpgradeableBeacon");
    const freeBetBeacon = await UpgradeableBeacon.attach(freeBetBeaconAddress);
    expect(await freeBetBeacon.owner()).to.be.equal(factoryOwner.address);
  });
  it("Check changing URI", async () => {
    await freeBet.connect(poolOwner).setBaseURI(URI);
    expect(await freeBet.baseURI()).to.be.equal(URI);
  });
  it("Check changing affiliate", async () => {
    const expectedOdds = await core.calcOdds(condId, tokens(50), OUTCOMEWIN);
    const azurobetId = (await azuroBet.lastTokenId()).add(1);

    await freeBet.connect(maintainer).mint(bettor1.address, newBet);

    await freeBet.connect(poolOwner).setAffiliate(bettor1.address);
    const tx = freeBet
      .connect(bettor1)
      .redeem(core.address, 1, condId, tokens(50), OUTCOMEWIN, now + ONE_HOUR, odds("1.5"));

    await expect(tx)
      .to.emit(core, "NewBet")
      .withArgs(freeBet.address, bettor1.address, condId, azurobetId, OUTCOMEWIN, tokens(50), expectedOdds, [
        reinforcement.div(2).add(tokens(50)),
        reinforcement.div(2).sub(tokens(50).mul(expectedOdds.sub(MULTIPLIER)).div(MULTIPLIER)),
      ]);
  });
  it("Check supportsInterface EIP165, ERC721", async () => {
    expect(await freeBet.supportsInterface(0x01ffc9a7)).to.be.equal(true); // IERC165Upgradeable
    expect(await freeBet.supportsInterface(0x80ac58cd)).to.be.equal(true); // IERC721Upgradeable
    expect(await freeBet.supportsInterface(0x5b5e139f)).to.be.equal(true); // IERC721MetadataUpgradeable
  });
  it("Check only owner", async () => {
    await expect(freeBet.connect(bettor1).setBaseURI(URI)).to.be.revertedWith("Ownable: account is not the owner");
    await expect(freeBet.connect(maintainer).setLp(lp.address)).to.be.revertedWith("Ownable: account is not the owner");
  });
  it("Check only maintainer", async () => {
    await expect(freeBet.connect(bettor1).withdrawReserve(100)).to.be.revertedWithCustomError(freeBet, "OnlyManager");
    await expect(freeBet.connect(bettor1).mint(bettor2.address, newBet)).to.be.revertedWithCustomError(
      freeBet,
      "OnlyManager"
    );
    await expect(
      freeBet.connect(poolOwner).mintBatch([bettor2.address, bettor3.address], newBet)
    ).to.be.revertedWithCustomError(freeBet, "OnlyManager");
  });

  it("Should add funds for any user", async () => {
    const balanceBefore = await wxDAI.balanceOf(bettor1.address);
    await wxDAI.connect(bettor1).approve(freeBet.address, tokens(1000));
    await wxDAI.connect(bettor1).transfer(freeBet.address, tokens(1000));
    expect(await wxDAI.balanceOf(bettor1.address)).to.eq(balanceBefore.sub(tokens(1000)));
    expect(await wxDAI.balanceOf(freeBet.address)).to.eq(balanceFreebetBefore.add(tokens(1000)));
  });
  it("Should withdraw all funds for maintainer", async () => {
    const balanceBefore = await wxDAI.balanceOf(maintainer.address);
    await freeBet.connect(maintainer).withdrawReserve(tokens(1000));
    expect(await wxDAI.balanceOf(maintainer.address)).to.eq(balanceBefore.add(tokens(1000)));
    expect(await wxDAI.balanceOf(freeBet.address)).to.eq(balanceFreebetBefore.sub(tokens(1000)));
  });
  it("Should not withdraw if amount is too big", async () => {
    await expect(freeBet.connect(maintainer).withdrawReserve(tokens(10000))).to.be.revertedWithCustomError(
      freeBet,
      "InsufficientContractBalance"
    );
    expect(await wxDAI.balanceOf(freeBet.address)).to.eq(balanceFreebetBefore);
  });

  it("Should return empty array if no expired bets", async () => {
    const expired = await freeBet.getExpiredUnresolved(0, 1000);
    expect(expired[0]).to.eql(new Array(1000).fill(BigNumber.from(0)));
    expect(expired[1]).to.eq(0);
  });

  context("Minted freeBet", () => {
    async function mint() {
      await freeBet.connect(maintainer).mint(bettor1.address, newBet);
    }

    wrapLayer(mint);

    it("Should mint successfully", async () => {
      expect(await freeBet.balanceOf(bettor1.address)).to.eq(1);
      expect(await freeBet.lockedReserve()).to.eq(newBet.amount);
      await expect(freeBet.connect(maintainer).mint(bettor1.address, newBet2))
        .to.emit(freeBet, "FreeBetMinted")
        .withArgs(bettor1.address, 2, [newBet2.amount, newBet2.minOdds, newBet2.durationTime]);
      expect(await freeBet.balanceOf(bettor1.address)).to.eq(2);
      expect(await freeBet.lockedReserve()).to.eq(newBet.amount.add(newBet2.amount));
      await expectTuple(await freeBet.freeBets(2), newBet2.amount, newBet2.minOdds, newBet2.durationTime);
      expect(await freeBet.expirationTime(2)).to.be.closeTo(newBet2.durationTime.add(now), 1000);
    });

    it("Should mint batch", async () => {
      expect(await freeBet.balanceOf(bettor1.address)).to.eq(1);
      expect(await freeBet.lockedReserve()).to.eq(newBet.amount);
      const bettors = [bettor1.address, bettor2.address, bettor3.address];
      await expect(freeBet.connect(maintainer).mintBatch(bettors, newBet))
        .to.emit(freeBet, "FreeBetMintedBatch")
        .withArgs(bettors, 2, 3, [newBet.amount, newBet.minOdds, newBet.durationTime]);
      await expectTuple(await freeBet.freeBets(2), newBet.amount, newBet.minOdds, newBet.durationTime);
      await expectTuple(await freeBet.freeBets(3), newBet.amount, newBet.minOdds, newBet.durationTime);
      await expectTuple(await freeBet.freeBets(4), newBet.amount, newBet.minOdds, newBet.durationTime);
      expect(await freeBet.lockedReserve()).to.eq(newBet.amount.mul(2).add(newBet.amount.mul(2)));
      expect(await freeBet.balanceOf(bettor1.address)).to.eq(2);
    });

    it("Should only burn expired bets", async () => {
      await freeBet.connect(maintainer).mint(bettor1.address, newBet);
      await freeBet.connect(maintainer).mintBatch([bettor2.address, bettor3.address], newBet2);
      expect(await freeBet.lockedReserve()).to.eq(newBet.amount.mul(2).add(newBet2.amount.mul(2)));

      await timeShiftBy(ethers, ONE_WEEK / 2);
      const [expired, length] = await freeBet.getExpiredUnresolved(0, 100);
      expect(length).to.eq(2);
      expect(expired).to.eql([
        BigNumber.from(3),
        BigNumber.from(4),
        ...new Array(100 - length).fill(BigNumber.from(0)),
      ]);
      const tx = freeBet.resolveExpired([3, 4]);
      await expect(tx).to.emit(freeBet, "FreeBetsResolved").withArgs([3, 4], tokens(300));
      expect((await freeBet.getExpiredUnresolved(0, 100))[0]).to.eql(new Array(100).fill(BigNumber.from(0)));
      expect(await freeBet.lockedReserve()).to.eq(newBet.amount.mul(2));
    });

    it("Can't be transferred", async () => {
      await expect(
        freeBet.connect(bettor1).transferFrom(bettor1.address, factoryOwner.address, 1)
      ).to.be.revertedWithCustomError(freeBet, "NonTransferable");
    });

    it("Should redeem correct freeBet", async () => {
      const expectedOdds = await core.calcOdds(condId, tokens(50), [OUTCOMEWIN]);
      const azurobetId = (await azuroBet.lastTokenId()).add(1);
      expect(await freeBet.lockedReserve()).to.eq(newBet.amount);
      await expectTuple(await freeBet.freeBets(1), newBet.amount, newBet.minOdds, newBet.durationTime);
      await expectTuple(
        await freeBet.azuroBets(azurobetId),
        ethers.constants.AddressZero,
        ethers.constants.AddressZero,
        0,
        0,
        0
      );
      const tx = freeBet
        .connect(bettor1)
        .redeem(core.address, 1, condId, tokens(50), OUTCOMEWIN, now + ONE_HOUR, odds("1.5"));

      await expect(tx)
        .to.emit(freeBet, "FreeBetRedeemed")
        .withArgs(core.address, bettor1.address, 1, azurobetId, tokens(50));

      await expect(tx)
        .to.emit(core, "NewBet")
        .withArgs(freeBet.address, affiliate.address, condId, azurobetId, OUTCOMEWIN, tokens(50), expectedOdds, [
          reinforcement.div(2).add(tokens(50)),
          reinforcement.div(2).sub(tokens(50).mul(expectedOdds.sub(MULTIPLIER)).div(MULTIPLIER)),
        ]);

      await expect(tx).to.emit(wxDAI, "Transfer").withArgs(freeBet.address, lp.address, tokens(50));

      await expectTuple(await freeBet.freeBets(1), newBet.amount.sub(tokens(50)), newBet.minOdds, newBet.durationTime);
      await expectTuple(await freeBet.azuroBets(azurobetId), core.address, bettor1.address, condId, 1, tokens(50), 0);

      expect(await freeBet.lockedReserve()).to.eq(newBet.amount.sub(tokens(50)));
    });

    it("Shouldn't redeem expired freeBet", async () => {
      await timeShiftBy(ethers, ONE_WEEK + 60);
      await expect(
        freeBet.connect(bettor1).redeem(core.address, 1, condId, tokens(50), [OUTCOMEWIN], now + ONE_HOUR, odds("1.5"))
      ).to.be.revertedWithCustomError(freeBet, "BetExpired");
    });

    it("Should revert redeem of not owned freeBet", async () => {
      await expect(
        freeBet.connect(bettor2).redeem(core.address, 1, condId, tokens(50), [OUTCOMEWIN], now + ONE_HOUR, odds("1.5"))
      ).to.be.revertedWithCustomError(freeBet, "OnlyBetOwner");
    });

    it("Should revert withdraw if requested tokens are locked", async () => {
      await expect(freeBet.connect(maintainer).withdrawReserve(tokens(1000))).to.be.revertedWithCustomError(
        freeBet,
        "InsufficientContractBalance"
      );
      expect(await wxDAI.balanceOf(freeBet.address)).to.eq(tokens(1000));
    });

    it("Should let withdraw unlocked tokens", async () => {
      await freeBet.connect(maintainer).withdrawReserve(tokens(900));
      await timeShiftBy(ethers, ONE_WEEK + 60);
      const [ids, length] = await freeBet.getExpiredUnresolved(0, 100);
      await freeBet.resolveExpired(ids.slice(0, length));
      await freeBet.connect(maintainer).withdrawReserve(tokens(100));
      expect(await wxDAI.balanceOf(freeBet.address)).to.eq(0);
    });

    context("Redeemed on 1 outcome", () => {
      let odds1;
      let betAmount;
      let azurobetId;

      async function redeem() {
        betAmount = newBet.amount;
        odds1 = await core.calcOdds(condId, betAmount, [OUTCOMEWIN]);
        azurobetId = (await azuroBet.lastTokenId()).add(1);

        await freeBet
          .connect(bettor1)
          .redeem(core.address, 1, condId, betAmount, [OUTCOMEWIN], now + ONE_HOUR, odds("1.5"));
      }

      wrapLayer(redeem);

      context("Win", () => {
        let payout;

        async function win() {
          payout = betAmount.mul(odds1).div(MULTIPLIER);
          await timeShiftBy(ethers, ONE_HOUR * 2);
          await core.connect(oracle).resolveCondition(condId, [OUTCOMEWIN]);
        }

        wrapLayer(win);

        it("Should resolve payout by any user and burn freeBet", async () => {
          await expectTuple(
            await freeBet.azuroBets(azurobetId),
            core.address,
            bettor1.address,
            condId,
            1,
            newBet.amount,
            0
          );
          const tx = freeBet.connect(bettor2).resolvePayout([azurobetId]);

          await expect(tx).to.emit(lp, "BettorWin").withArgs(core.address, freeBet.address, azurobetId, payout);
          await expect(tx).to.emit(wxDAI, "Transfer").withArgs(lp.address, freeBet.address, payout);
          await expectTuple(
            await freeBet.azuroBets(azurobetId),
            core.address,
            bettor1.address,
            condId,
            1,
            0,
            payout.sub(betAmount)
          );

          await expect(freeBet.connect(bettor2).resolvePayout([azurobetId])).to.be.revertedWithCustomError(
            freeBet,
            "AlreadyResolved"
          );
        });

        it("Should Withdraw payout after resolve", async () => {
          await freeBet.connect(bettor2).resolvePayout([azurobetId]);

          await expectTuple(
            await freeBet.azuroBets(azurobetId),
            core.address,
            bettor1.address,
            condId,
            1,
            0,
            payout.sub(betAmount)
          );
          const tx = freeBet.connect(bettor1).withdrawPayout(azurobetId);
          await expect(tx).to.emit(wxDAI, "Transfer").withArgs(freeBet.address, bettor1.address, payout.sub(betAmount));
          await expect(tx)
            .to.emit(freeBet, "BettorWin")
            .withArgs(core.address, bettor1.address, azurobetId, payout.sub(betAmount));
          await expectTuple(await freeBet.azuroBets(azurobetId), core.address, bettor1.address, condId, 1, 0, 0);

          await expect(freeBet.connect(bettor2).resolvePayout([azurobetId])).to.be.revertedWithCustomError(
            freeBet,
            "AlreadyResolved"
          );
          await expect(freeBet.connect(bettor1).withdrawPayout(azurobetId)).to.not.be.reverted;
        });

        it("Should resolve and withdraw by calling withdraw", async () => {
          await expectTuple(
            await freeBet.azuroBets(azurobetId),
            core.address,
            bettor1.address,
            condId,
            1,
            newBet.amount,
            0
          );
          const tx = freeBet.connect(bettor1).withdrawPayout(azurobetId);
          await expect(tx).to.emit(lp, "BettorWin").withArgs(core.address, freeBet.address, azurobetId, payout);
          await expect(tx).to.emit(wxDAI, "Transfer").withArgs(lp.address, freeBet.address, payout);
          await expect(tx).to.emit(wxDAI, "Transfer").withArgs(freeBet.address, bettor1.address, payout.sub(betAmount));
          await expect(tx)
            .to.emit(freeBet, "BettorWin")
            .withArgs(core.address, bettor1.address, azurobetId, payout.sub(betAmount));
          await expectTuple(await freeBet.azuroBets(azurobetId), core.address, bettor1.address, condId, 1, 0, 0);

          await expect(freeBet.connect(bettor2).resolvePayout([azurobetId])).to.be.revertedWithCustomError(
            freeBet,
            "AlreadyResolved"
          );
          await expect(freeBet.connect(bettor1).withdrawPayout(azurobetId)).to.not.be.reverted;
        });

        it("Should revert withdraw payout of not owned Azuro bet", async () => {
          await expect(freeBet.connect(bettor2).withdrawPayout(azurobetId)).to.be.revertedWithCustomError(
            freeBet,
            "OnlyBetOwner"
          );
        });
      });

      context("Lose", () => {
        async function lose() {
          await timeShiftBy(ethers, ONE_HOUR * 2);
          await core.connect(oracle).resolveCondition(condId, [2]);
        }

        wrapLayer(lose);

        it("Should resolve 0 payout and burn freeBet", async () => {
          await expectTuple(
            await freeBet.azuroBets(azurobetId),
            core.address,
            bettor1.address,
            condId,
            1,
            newBet.amount,
            0
          );
          await freeBet.connect(bettor2).resolvePayout([azurobetId]);

          await expectTuple(await freeBet.azuroBets(azurobetId), core.address, bettor1.address, condId, 1, 0, 0);

          await expect(freeBet.connect(bettor2).resolvePayout([azurobetId])).to.be.revertedWithCustomError(
            freeBet,
            "AlreadyResolved"
          );
        });

        it("Should withdraw 0 payout and burn freeBet", async () => {
          await expectTuple(
            await freeBet.azuroBets(azurobetId),
            core.address,
            bettor1.address,
            condId,
            1,
            newBet.amount,
            0
          );
          const tx = freeBet.connect(bettor1).withdrawPayout(azurobetId);

          await expect(tx).to.not.emit(freeBet, "BettorWin");
          await expectTuple(await freeBet.azuroBets(azurobetId), core.address, bettor1.address, condId, 1, 0, 0);

          await expect(freeBet.connect(bettor2).resolvePayout([azurobetId])).to.be.revertedWithCustomError(
            freeBet,
            "AlreadyResolved"
          );
          await expect(freeBet.connect(bettor1).withdrawPayout(azurobetId)).to.not.be.reverted;
        });
      });

      context("Cancel", () => {
        async function cancel() {
          await timeShiftBy(ethers, ONE_HOUR * 2);
          await core.connect(oracle).cancelCondition(condId);
        }

        wrapLayer(cancel);

        it("Should reissue freeBet on resolve", async () => {
          await expectTuple(
            await freeBet.azuroBets(azurobetId),
            core.address,
            bettor1.address,
            condId,
            1,
            newBet.amount,
            0
          );
          await expectTuple(await freeBet.freeBets(1), 0, newBet.minOdds, newBet.durationTime);
          expect(await freeBet.lockedReserve()).to.eq(0);

          const tx = freeBet.connect(bettor2).resolvePayout([azurobetId]);

          await expect(tx).to.emit(lp, "BettorWin").withArgs(core.address, freeBet.address, azurobetId, betAmount);
          await expect(tx).to.emit(wxDAI, "Transfer").withArgs(lp.address, freeBet.address, betAmount);
          await expect(tx)
            .to.emit(freeBet, "FreeBetReissued")
            .withArgs(bettor1.address, 1, [newBet.amount, newBet.minOdds, newBet.durationTime]);

          await expectTuple(await freeBet.freeBets(1), newBet.amount, newBet.minOdds, newBet.durationTime);
          await expectTuple(await freeBet.azuroBets(azurobetId), core.address, bettor1.address, condId, 1, 0, 0);
          expect(await freeBet.expirationTime(1)).to.be.closeTo(
            newBet.durationTime.add(await getBlockTime(ethers)),
            1000
          );
          expect(await freeBet.lockedReserve()).to.eq(newBet.amount);

          await expect(freeBet.connect(bettor2).resolvePayout([azurobetId])).to.be.revertedWithCustomError(
            freeBet,
            "AlreadyResolved"
          );
        });

        it("Should Withdraw payout after resolve", async () => {
          await freeBet.connect(bettor2).resolvePayout([azurobetId]);

          await expectTuple(await freeBet.azuroBets(azurobetId), core.address, bettor1.address, condId, 1, 0, 0);
          const tx = freeBet.connect(bettor1).withdrawPayout(azurobetId);
          await expect(tx).to.not.emit(wxDAI, "Transfer");
          await expect(tx).to.not.emit(freeBet, "BettorWin");
          await expectTuple(await freeBet.azuroBets(azurobetId), core.address, bettor1.address, condId, 1, 0, 0);

          await expect(freeBet.connect(bettor2).resolvePayout([azurobetId])).to.be.revertedWithCustomError(
            freeBet,
            "AlreadyResolved"
          );
          await expect(freeBet.connect(bettor1).withdrawPayout(azurobetId)).to.not.be.reverted;
        });

        it("Should resolve and withdraw by calling withdraw", async () => {
          await expectTuple(
            await freeBet.azuroBets(azurobetId),
            core.address,
            bettor1.address,
            condId,
            1,
            newBet.amount,
            0
          );
          expect(await freeBet.lockedReserve()).to.eq(0);

          const tx = freeBet.connect(bettor1).withdrawPayout(azurobetId);

          await expect(tx).to.emit(lp, "BettorWin").withArgs(core.address, freeBet.address, azurobetId, betAmount);
          await expect(tx).to.emit(wxDAI, "Transfer").withArgs(lp.address, freeBet.address, betAmount);
          await expect(tx)
            .to.emit(freeBet, "FreeBetReissued")
            .withArgs(bettor1.address, 1, [newBet.amount, newBet.minOdds, newBet.durationTime]);
          await expect(tx).to.not.emit(freeBet, "BettorWin");
          await expectTuple(await freeBet.azuroBets(azurobetId), core.address, bettor1.address, condId, 1, 0, 0);
          expect(await freeBet.expirationTime(1)).to.be.closeTo(
            newBet.durationTime.add(await getBlockTime(ethers)),
            1000
          );
          expect(await freeBet.lockedReserve()).to.eq(newBet.amount);

          await expect(freeBet.connect(bettor1).withdrawPayout(azurobetId)).to.not.be.reverted;
          await expect(freeBet.connect(bettor2).resolvePayout([azurobetId])).to.be.revertedWithCustomError(
            freeBet,
            "AlreadyResolved"
          );
        });
      });
    });
  });
});
