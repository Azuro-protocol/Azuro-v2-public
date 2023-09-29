const { expect } = require("chai");
const { constants } = require("ethers");
const { ethers, network } = require("hardhat");
const {
  getBlockTime,
  tokens,
  prepareStand,
  prepareAccess,
  createCondition,
  timeShift,
  createGame,
  addRole,
  grantRole,
  getPluggedCore,
  prepareRoles,
} = require("../utils/utils");
const { MULTIPLIER, FREEBET_ADDRESS, FORKING, UPGRADE_TEST } = require("../utils/constants");

const LIQUIDITY = tokens(2000000);
const ONE_HOUR = 3600;

const OUTCOMEWIN = 1;
const OUTCOMELOSE = 2;

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

const makeFreeBetCustomized = async (
  freeBet,
  manager,
  bettor,
  chainId,
  freeBetId,
  owner,
  amount,
  freeBetMinOdds,
  expiresAt,
  core,
  conditionId,
  outcome,
  deadline,
  minOdds
) => {
  const freeBetData = {
    chainId: chainId,
    freeBetId: freeBetId,
    owner: owner.address,
    amount: amount,
    minOdds: freeBetMinOdds,
    expiresAt: expiresAt,
  };

  const messageHash = ethers.utils.keccak256(
    ethers.utils.defaultAbiCoder.encode(
      ["uint256", "uint256", "address", "uint128", "uint64", "uint64"],
      Object.values(freeBetData)
    )
  );
  const signedMessage = await manager.signMessage(ethers.utils.arrayify(messageHash));

  return await freeBet
    .connect(bettor)
    .bet(freeBetData, signedMessage, core.address, conditionId, outcome, deadline, minOdds);
};

const makeFreeBet = async (
  freeBet,
  manager,
  freeBetId,
  bettor,
  amount,
  core,
  conditionId,
  outcome,
  deadline,
  minOdds
) => {
  const chainId = await network.provider.send("eth_chainId");
  return await makeFreeBetCustomized(
    freeBet,
    manager,
    bettor,
    chainId,
    freeBetId,
    bettor,
    amount,
    minOdds,
    deadline,
    core,
    conditionId,
    outcome,
    deadline,
    minOdds
  );
};

describe("FreeBet test", function () {
  const wrapLayer = initFixtureTree(ethers.provider);

  let chainId;

  let factoryOwner, poolOwner, bettor, dataProvider, oracle, oracle2, manager, affiliate;
  let factory, access, core, wxDAI, lp, azuroBet, freeBetFactory, freeBetFactoryAccess, freeBet;
  let core2, azuroBet2;
  let roleIds, time;
  let freeBetId = 1,
    gameId = 1,
    condId = 1;

  const reinforcement = constants.WeiPerEther.mul(20000); // 10%
  const marginality = MULTIPLIER * 0.05; // 5%

  const pool1 = 5000000;
  const pool2 = 5000000;

  const minDepo = tokens(10);
  const daoFee = MULTIPLIER * 0.09; // 9%
  const dataProviderFee = MULTIPLIER * 0.01; // 1%
  const affiliateFee = MULTIPLIER * 0.6; // 60%

  const freeBetMinOdds = MULTIPLIER;
  const betAmount = tokens(100);
  const balanceFreeBetBefore = tokens(1000);

  async function deployAndRelease() {
    [factoryOwner, poolOwner, bettor, dataProvider, oracle, oracle2, manager, affiliate] = await ethers.getSigners();

    ({ factory, access, core, wxDAI, lp, azuroBet, roleIds } = await prepareStand(
      ethers,
      factoryOwner,
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
    await prepareAccess(access, poolOwner, oracle.address, oracle2.address, manager.address, roleIds);

    time = await getBlockTime(ethers);

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
        selector: "0xe80568e3",
        roleId: freeBetDeployerRoleId,
      });
      await grantRole(freeBetFactoryAccess, factoryOwner, poolOwner.address, freeBetDeployerRoleId);

      const txCreateFreeBet = await freeBetFactory
        .connect(poolOwner)
        .createFreeBet(lp.address, affiliate.address, manager.address);
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

    await wxDAI.transfer(manager.address, tokens(10000));

    await createGame(lp, oracle, ++gameId, time + ONE_HOUR);
    await createCondition(
      core,
      oracle,
      gameId,
      condId,
      [pool2, pool1],
      [OUTCOMEWIN, OUTCOMELOSE],
      reinforcement,
      marginality,
      false
    );

    const PrematchCore = await ethers.getContractFactory("PrematchCore", {
      signer: poolOwner,
      unsafeAllowCustomTypes: true,
    });

    const txPlugCore = await factory.connect(poolOwner).plugCore(lp.address, "pre-match");
    core2 = await PrematchCore.attach(await getPluggedCore(txPlugCore));

    const AzuroBet = await ethers.getContractFactory("AzuroBet");
    const azuroBet2Address = await core2.azuroBet();
    azuroBet2 = await AzuroBet.attach(azuroBet2Address);

    const roleIds2 = await prepareRoles(access, poolOwner, lp, core2);
    await grantRole(access, poolOwner, oracle.address, roleIds2.oracle);
    await createCondition(
      core2,
      oracle,
      gameId,
      condId,
      [pool2, pool1],
      [OUTCOMEWIN, OUTCOMELOSE],
      reinforcement,
      marginality,
      false
    );

    await wxDAI.connect(factoryOwner).approve(freeBet.address, tokens(100000));
    await wxDAI.connect(factoryOwner).transfer(freeBet.address, balanceFreeBetBefore);

    time = await getBlockTime(ethers);
    chainId = await network.provider.send("eth_chainId");
  }

  wrapLayer(deployAndRelease);

  context("Management", () => {
    it("Check FreeBet Factory access", async () => {
      await expect(
        freeBetFactory.connect(factoryOwner).createFreeBet(lp.address, affiliate.address, manager.address)
      ).to.be.revertedWithCustomError(freeBetFactoryAccess, "AccessNotGranted");
    });
    it("Check FreeBet beacon owner", async () => {
      const freeBetBeaconAddress = await freeBetFactory.freeBetBeacon();
      const UpgradeableBeacon = await ethers.getContractFactory("UpgradeableBeacon");
      const freeBetBeacon = await UpgradeableBeacon.attach(freeBetBeaconAddress);
      expect(await freeBetBeacon.owner()).to.be.equal(factoryOwner.address);
    });
    it("Check changing affiliate", async () => {
      const expectedOdds = await core.calcOdds(condId, betAmount, OUTCOMEWIN);
      const azuroBetId = (await azuroBet.lastTokenId()).add(1);

      await freeBet.connect(poolOwner).setAffiliate(bettor.address);
      const tx = await makeFreeBet(
        freeBet,
        manager,
        freeBetId,
        bettor,
        betAmount,
        core,
        condId,
        OUTCOMEWIN,
        time + ONE_HOUR,
        MULTIPLIER
      );

      await expect(tx)
        .to.emit(core, "NewBet")
        .withArgs(freeBet.address, bettor.address, condId, azuroBetId, OUTCOMEWIN, betAmount, expectedOdds, [
          reinforcement.div(2).add(betAmount),
          reinforcement.div(2).sub(betAmount.mul(expectedOdds.sub(MULTIPLIER)).div(MULTIPLIER)),
        ]);
    });
    it("Check only owner", async () => {
      await expect(freeBet.connect(manager).setAffiliate(affiliate.address)).to.be.revertedWith(
        "Ownable: account is not the owner"
      );
      await expect(freeBet.connect(manager).setLp(lp.address)).to.be.revertedWith("Ownable: account is not the owner");
      await expect(freeBet.connect(manager).setManager(manager.address)).to.be.revertedWith(
        "Ownable: account is not the owner"
      );
    });
    it("Should add funds for any bettor", async () => {
      const balanceBefore = await wxDAI.balanceOf(bettor.address);
      await wxDAI.connect(bettor).approve(freeBet.address, tokens(1000));
      await wxDAI.connect(bettor).transfer(freeBet.address, tokens(1000));
      expect(await wxDAI.balanceOf(bettor.address)).to.eq(balanceBefore.sub(tokens(1000)));
      expect(await wxDAI.balanceOf(freeBet.address)).to.eq(balanceFreeBetBefore.add(tokens(1000)));
    });
    it("Should withdraw all funds for manager", async () => {
      const balanceBefore = await wxDAI.balanceOf(manager.address);
      await freeBet.connect(manager).withdrawReserve(tokens(1000));
      expect(await wxDAI.balanceOf(manager.address)).to.eq(balanceBefore.add(tokens(1000)));
      expect(await wxDAI.balanceOf(freeBet.address)).to.eq(balanceFreeBetBefore.sub(tokens(1000)));
    });
    it("Should withdraw unlocked tokens", async () => {
      const managerBalance = await wxDAI.balanceOf(manager.address);
      await freeBet.connect(manager).withdrawReserve(balanceFreeBetBefore);
      expect(await wxDAI.balanceOf(manager.address)).to.be.equal(managerBalance.add(balanceFreeBetBefore));
    });
    it("Shouldn't withdraw locked tokens", async () => {
      const azuroBetId = (await azuroBet.lastTokenId()).add(1);
      const expectedOdds = await core.calcOdds(condId, betAmount, [OUTCOMEWIN]);
      await makeFreeBet(
        freeBet,
        manager,
        freeBetId,
        bettor,
        betAmount,
        core,
        condId,
        OUTCOMEWIN,
        time + ONE_HOUR,
        MULTIPLIER
      );

      await timeShift(time + ONE_HOUR * 2);
      await core.connect(oracle).resolveCondition(condId, [OUTCOMEWIN]);

      await freeBet.resolvePayout([freeBetId]);
      const payout = betAmount.mul(expectedOdds).div(MULTIPLIER);
      expect(await wxDAI.balanceOf(freeBet.address)).to.be.equal(balanceFreeBetBefore.add(payout).sub(betAmount));

      await expect(freeBet.connect(manager).withdrawReserve(balanceFreeBetBefore.add(1))).to.be.revertedWithCustomError(
        freeBet,
        "InsufficientContractBalance"
      );
      await freeBet.connect(manager).withdrawReserve(balanceFreeBetBefore);
    });
    it("Shouldn't withdraw not by manager", async () => {
      await expect(freeBet.connect(bettor).withdrawReserve(1)).to.be.revertedWithCustomError(freeBet, "OnlyManager");
    });
    it("Shouldn't withdraw if amount is too big", async () => {
      await expect(freeBet.connect(manager).withdrawReserve(tokens(10000))).to.be.revertedWithCustomError(
        freeBet,
        "InsufficientContractBalance"
      );
      expect(await wxDAI.balanceOf(freeBet.address)).to.eq(balanceFreeBetBefore);
    });
  });
  context("Redeem free bet", () => {
    it("Should redeem free bet", async () => {
      const expectedOdds = await core.calcOdds(condId, betAmount, [OUTCOMEWIN]);
      const condition = await core.getCondition(condId);
      const azuroBetId = (await azuroBet.lastTokenId()).add(1);
      const tx = await makeFreeBet(
        freeBet,
        manager,
        freeBetId,
        bettor,
        betAmount,
        core,
        condId,
        OUTCOMEWIN,
        time + ONE_HOUR,
        MULTIPLIER
      );

      await expect(tx)
        .to.emit(freeBet, "NewBet")
        .withArgs(freeBetId, core.address, bettor.address, azuroBetId, betAmount, freeBetMinOdds, time + ONE_HOUR);

      await expect(tx)
        .to.emit(core, "NewBet")
        .withArgs(freeBet.address, affiliate.address, condId, azuroBetId, OUTCOMEWIN, betAmount, expectedOdds, [
          condition.virtualFunds[0].add(betAmount),
          condition.virtualFunds[1].sub(betAmount.mul(expectedOdds.sub(MULTIPLIER)).div(MULTIPLIER)),
        ]);

      await expect(tx).to.emit(wxDAI, "Transfer").withArgs(freeBet.address, lp.address, betAmount);

      await expectTuple(await freeBet.freeBets(freeBetId++), bettor.address, core.address, azuroBetId, betAmount, 0);
    });
    it("Should be no conflict between redeemed free bets in different Cores of the same LP", async () => {
      const azuroBetId = (await azuroBet.lastTokenId()).add(1);
      await makeFreeBet(
        freeBet,
        manager,
        freeBetId,
        bettor,
        betAmount,
        core,
        condId,
        OUTCOMEWIN,
        time + ONE_HOUR,
        MULTIPLIER
      );

      const azuroBetId2 = (await azuroBet2.lastTokenId()).add(1);
      const betAmount2 = betAmount.mul(2);
      await makeFreeBet(
        freeBet,
        manager,
        ++freeBetId,
        poolOwner,
        betAmount2,
        core2,
        condId,
        OUTCOMEWIN,
        time + ONE_HOUR,
        MULTIPLIER
      );

      await expectTuple(await freeBet.freeBets(freeBetId - 1), bettor.address, core.address, azuroBetId, betAmount, 0);
      await expectTuple(
        await freeBet.freeBets(freeBetId++),
        poolOwner.address,
        core2.address,
        azuroBetId2,
        betAmount2,
        0
      );
    });
    it("Shouldn't redeem freeBet with data that does not match the manager's signature", async () => {
      const freeBetData = {
        chainId: chainId,
        freeBetId: freeBetId,
        owner: bettor.address,
        amount: betAmount,
        minOdds: freeBetMinOdds,
        expiresAt: time + ONE_HOUR,
      };

      const messageHash = ethers.utils.keccak256(
        ethers.utils.defaultAbiCoder.encode(
          ["uint256", "uint256", "address", "uint128", "uint64", "uint64"],
          Object.values(freeBetData)
        )
      );
      const signedMessage = await manager.signMessage(ethers.utils.arrayify(messageHash));

      const anotherFreeBetData = {
        chainId: chainId + 1,
        freeBetId: freeBetId + 1,
        owner: poolOwner.address,
        amount: betAmount.add(1),
        minOdds: freeBetMinOdds + 1,
        expiresAt: time + ONE_HOUR + 1,
      };

      for (const field in freeBetData) {
        const incorrectFreeBetData = Object.assign({}, freeBetData);
        incorrectFreeBetData[field] = anotherFreeBetData[field];
        await expect(
          freeBet
            .connect(bettor)
            .bet(incorrectFreeBetData, signedMessage, core.address, condId, OUTCOMEWIN, time + ONE_HOUR, MULTIPLIER)
        ).to.be.revertedWithCustomError(freeBet, "InvalidSignature");
      }
    });
    it("Shouldn't redeem not owned freeBet", async () => {
      await expect(
        makeFreeBetCustomized(
          freeBet,
          manager,
          poolOwner,
          chainId,
          freeBetId,
          bettor,
          betAmount,
          freeBetMinOdds,
          time,
          core,
          condId,
          OUTCOMEWIN,
          time + ONE_HOUR,
          freeBetMinOdds
        )
      ).to.be.revertedWithCustomError(freeBet, "OnlyFreeBetOwner");
    });
    it("Shouldn't redeem freeBet with the same ID", async () => {
      await makeFreeBet(
        freeBet,
        manager,
        freeBetId,
        bettor,
        betAmount,
        core,
        condId,
        OUTCOMEWIN,
        time + ONE_HOUR,
        MULTIPLIER
      );
      await expect(
        makeFreeBet(
          freeBet,
          manager,
          freeBetId,
          bettor,
          betAmount.add(1),
          core,
          condId,
          OUTCOMEWIN,
          time + ONE_HOUR,
          MULTIPLIER
        )
      ).to.be.revertedWithCustomError(freeBet, "BetAlreadyClaimed");
    });
    it("Shouldn't redeem freeBet from another network", async () => {
      await expect(
        makeFreeBetCustomized(
          freeBet,
          manager,
          poolOwner,
          chainId + 1,
          freeBetId,
          bettor,
          betAmount,
          freeBetMinOdds,
          time + ONE_HOUR,
          core,
          condId,
          OUTCOMEWIN,
          time + ONE_HOUR,
          freeBetMinOdds
        )
      ).to.be.revertedWithCustomError(freeBet, "IncorrectChainId");
    });
    it("Shouldn't redeem freeBet with minOdds less than the manager has specified", async () => {
      await expect(
        makeFreeBetCustomized(
          freeBet,
          manager,
          bettor,
          chainId,
          freeBetId,
          bettor,
          betAmount,
          freeBetMinOdds,
          time + ONE_HOUR,
          core,
          condId,
          OUTCOMEWIN,
          time + ONE_HOUR,
          freeBetMinOdds - 1
        )
      ).to.be.revertedWithCustomError(freeBet, "SmallMinOdds");
    });
    it("Shouldn't redeem freeBet from another network", async () => {
      await expect(
        makeFreeBetCustomized(
          freeBet,
          manager,
          poolOwner,
          chainId + 1,
          freeBetId,
          bettor,
          betAmount,
          freeBetMinOdds,
          time + ONE_HOUR,
          core,
          condId,
          OUTCOMEWIN,
          time + ONE_HOUR,
          freeBetMinOdds
        )
      ).to.be.revertedWithCustomError(freeBet, "IncorrectChainId");
    });
    it("Shouldn't redeem freeBet twice", async () => {
      await makeFreeBet(
        freeBet,
        manager,
        freeBetId,
        bettor,
        betAmount,
        core,
        condId,
        OUTCOMEWIN,
        time + ONE_HOUR,
        MULTIPLIER
      );
      await expect(
        makeFreeBet(
          freeBet,
          manager,
          freeBetId,
          bettor,
          betAmount,
          core,
          condId,
          OUTCOMEWIN,
          time + ONE_HOUR,
          MULTIPLIER
        )
      ).to.be.revertedWithCustomError(freeBet, "BetAlreadyClaimed");
    });
    it("Shouldn't redeem freeBet if there are insufficient funds in the contract", async () => {
      await expect(
        makeFreeBet(
          freeBet,
          manager,
          freeBetId,
          bettor,
          balanceFreeBetBefore.add(1),
          core,
          condId,
          OUTCOMEWIN,
          time + ONE_HOUR,
          MULTIPLIER
        )
      ).to.be.revertedWithCustomError(freeBet, "InsufficientContractBalance");
    });
    it("Shouldn't redeem freeBet with locked tokens", async () => {
      await freeBet.connect(manager).withdrawReserve(balanceFreeBetBefore.sub(betAmount));

      const azuroBetId = (await azuroBet.lastTokenId()).add(1);
      await makeFreeBet(
        freeBet,
        manager,
        freeBetId,
        bettor,
        betAmount,
        core,
        condId,
        OUTCOMEWIN,
        time + ONE_HOUR,
        MULTIPLIER
      );

      await timeShift(time + ONE_HOUR * 2);
      await core.connect(oracle).resolveCondition(condId, [OUTCOMEWIN]);

      await freeBet.resolvePayout([freeBetId]);

      await freeBet.connect(manager).withdrawReserve(1);
      await expect(
        makeFreeBet(
          freeBet,
          manager,
          freeBetId,
          bettor,
          betAmount,
          core,
          condId,
          OUTCOMEWIN,
          time + ONE_HOUR,
          MULTIPLIER
        )
      ).to.be.revertedWithCustomError(freeBet, "InsufficientContractBalance");
    });
  });
  context("Resolve", () => {
    let odds1;
    let azuroBetId;

    async function redeem() {
      odds1 = await core.calcOdds(condId, betAmount, OUTCOMEWIN);
      azuroBetId = (await azuroBet.lastTokenId()).add(1);
      await makeFreeBet(
        freeBet,
        manager,
        freeBetId,
        bettor,
        betAmount,
        core,
        condId,
        OUTCOMEWIN,
        time + ONE_HOUR,
        MULTIPLIER
      );
    }
    wrapLayer(redeem);

    context("Win", () => {
      let payout;

      async function win() {
        payout = betAmount.mul(odds1).div(MULTIPLIER);
        await timeShift(time + ONE_HOUR * 2);
        await core.connect(oracle).resolveCondition(condId, [OUTCOMEWIN]);
      }

      wrapLayer(win);

      it("Should resolve payout by any bettor and burn freeBet", async () => {
        await expectTuple(await freeBet.freeBets(freeBetId), bettor.address, core.address, azuroBetId, betAmount, 0);
        expect(await freeBet.lockedReserve()).to.be.equal(0);

        const tx = await freeBet.connect(poolOwner).resolvePayout([freeBetId]);
        expect(await freeBet.lockedReserve()).to.be.equal(payout.sub(betAmount));

        await expect(tx).to.emit(lp, "BettorWin").withArgs(core.address, freeBet.address, azuroBetId, payout);
        await expect(tx).to.emit(wxDAI, "Transfer").withArgs(lp.address, freeBet.address, payout);
        await expectTuple(
          await freeBet.freeBets(freeBetId),
          bettor.address,
          core.address,
          azuroBetId,
          0,
          payout.sub(betAmount)
        );

        await expect(freeBet.connect(poolOwner).resolvePayout([freeBetId])).to.be.revertedWithCustomError(
          freeBet,
          "AlreadyResolved"
        );
      });
      it("Should Withdraw payout after resolve", async () => {
        expect(await freeBet.lockedReserve()).to.be.equal(0);

        await freeBet.connect(poolOwner).resolvePayout([freeBetId]);
        expect(await freeBet.lockedReserve()).to.be.equal(payout.sub(betAmount));

        await expectTuple(
          await freeBet.freeBets(freeBetId),
          bettor.address,
          core.address,
          azuroBetId,
          0,
          payout.sub(betAmount)
        );
        const tx = await freeBet.connect(bettor).withdrawPayout(freeBetId);
        expect(await freeBet.lockedReserve()).to.be.equal(0);

        await expect(tx).to.emit(wxDAI, "Transfer").withArgs(freeBet.address, bettor.address, payout.sub(betAmount));
        await expect(tx)
          .to.emit(freeBet, "BettorWin")
          .withArgs(core.address, bettor.address, freeBetId, payout.sub(betAmount));
        await expectTuple(await freeBet.freeBets(freeBetId), bettor.address, core.address, azuroBetId, 0, 0);

        await expect(freeBet.connect(poolOwner).resolvePayout([freeBetId])).to.be.revertedWithCustomError(
          freeBet,
          "AlreadyResolved"
        );
        await expect(freeBet.connect(bettor).withdrawPayout(freeBetId)).to.not.be.reverted;
      });
      it("Should resolve and withdraw by calling withdraw", async () => {
        await expectTuple(await freeBet.freeBets(freeBetId), bettor.address, core.address, azuroBetId, betAmount, 0);
        const tx = await freeBet.connect(bettor).withdrawPayout(freeBetId);
        await expect(tx).to.emit(lp, "BettorWin").withArgs(core.address, freeBet.address, azuroBetId, payout);
        await expect(tx).to.emit(wxDAI, "Transfer").withArgs(lp.address, freeBet.address, payout);
        await expect(tx).to.emit(wxDAI, "Transfer").withArgs(freeBet.address, bettor.address, payout.sub(betAmount));
        await expect(tx)
          .to.emit(freeBet, "BettorWin")
          .withArgs(core.address, bettor.address, freeBetId, payout.sub(betAmount));
        await expectTuple(await freeBet.freeBets(freeBetId), bettor.address, core.address, azuroBetId, 0, 0);

        await expect(freeBet.connect(poolOwner).resolvePayout([freeBetId])).to.be.revertedWithCustomError(
          freeBet,
          "AlreadyResolved"
        );
        await expect(freeBet.connect(bettor).withdrawPayout(freeBetId)).to.not.be.reverted;
      });
      it("Should revert withdraw payout of not redeemed free bet", async () => {
        await expect(freeBet.connect(bettor).withdrawPayout(0)).to.be.revertedWithCustomError(
          freeBet,
          "BetDoesNotExist"
        );
      });
    });
    context("Lose", () => {
      async function lose() {
        await timeShift(time + ONE_HOUR * 2);
        await core.connect(oracle).resolveCondition(condId, [2]);
      }

      wrapLayer(lose);

      it("Should resolve 0 payout", async () => {
        await expectTuple(await freeBet.freeBets(freeBetId), bettor.address, core.address, azuroBetId, betAmount, 0);
        expect(await freeBet.lockedReserve()).to.be.equal(0);

        await freeBet.connect(poolOwner).resolvePayout([freeBetId]);
        expect(await freeBet.lockedReserve()).to.be.equal(0);

        await expectTuple(await freeBet.freeBets(freeBetId), bettor.address, core.address, azuroBetId, 0, 0);

        await expect(freeBet.connect(poolOwner).resolvePayout([freeBetId])).to.be.revertedWithCustomError(
          freeBet,
          "AlreadyResolved"
        );
      });
      it("Should withdraw 0 payout", async () => {
        await expectTuple(await freeBet.freeBets(freeBetId), bettor.address, core.address, azuroBetId, betAmount, 0);
        expect(await freeBet.lockedReserve()).to.be.equal(0);

        const tx = await freeBet.connect(bettor).withdrawPayout(freeBetId);
        expect(await freeBet.lockedReserve()).to.be.equal(0);

        await expect(tx).to.emit(freeBet, "BettorWin");
        await expectTuple(await freeBet.freeBets(freeBetId), bettor.address, core.address, azuroBetId, 0, 0);

        await expect(freeBet.connect(poolOwner).resolvePayout([freeBetId])).to.be.revertedWithCustomError(
          freeBet,
          "AlreadyResolved"
        );
        await expect(freeBet.connect(bettor).withdrawPayout(freeBetId)).to.not.be.reverted;
      });
    });
    context("Cancel", () => {
      async function cancel() {
        await timeShift(time + ONE_HOUR * 2);
        await core.connect(oracle).cancelCondition(condId);
      }

      wrapLayer(cancel);

      it("Should Withdraw payout after resolve", async () => {
        await freeBet.connect(poolOwner).resolvePayout([freeBetId]);

        await expectTuple(await freeBet.freeBets(freeBetId), bettor.address, core.address, azuroBetId, 0, 0);
        const tx = await freeBet.connect(bettor).withdrawPayout(freeBetId);
        await expect(tx).to.not.emit(wxDAI, "Transfer");
        await expect(tx).to.emit(freeBet, "BettorWin");
        await expectTuple(await freeBet.freeBets(freeBetId), bettor.address, core.address, azuroBetId, 0, 0);

        await expect(freeBet.connect(poolOwner).resolvePayout([freeBetId])).to.be.revertedWithCustomError(
          freeBet,
          "AlreadyResolved"
        );
        await expect(freeBet.connect(bettor).withdrawPayout(freeBetId)).to.not.be.reverted;
      });
      it("Should resolve and withdraw by calling withdraw", async () => {
        await expectTuple(await freeBet.freeBets(freeBetId), bettor.address, core.address, azuroBetId, betAmount, 0);
        expect(await freeBet.lockedReserve()).to.eq(0);

        const tx = await freeBet.connect(bettor).withdrawPayout(freeBetId);

        await expect(tx).to.emit(lp, "BettorWin").withArgs(core.address, freeBet.address, azuroBetId, betAmount);
        await expect(tx).to.emit(wxDAI, "Transfer").withArgs(lp.address, freeBet.address, betAmount);
        await expect(tx).to.emit(freeBet, "BettorWin");
        await expectTuple(await freeBet.freeBets(freeBetId), bettor.address, core.address, azuroBetId, 0, 0);
        expect(await freeBet.lockedReserve()).to.eq(0);

        await expect(freeBet.connect(bettor).withdrawPayout(freeBetId)).to.not.be.reverted;
        await expect(freeBet.connect(poolOwner).resolvePayout([freeBetId])).to.be.revertedWithCustomError(
          freeBet,
          "AlreadyResolved"
        );
      });
    });
  });
});
