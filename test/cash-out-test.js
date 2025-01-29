const { expect } = require("chai");
const { ethers } = require("hardhat");
const {
  createCondition,
  createGame,
  grantRole,
  initFixtureTree,
  makeBetGetTokenId,
  plugBetExpress,
  prepareStand,
  getBlockTime,
  timeShift,
  tokens,
} = require("../utils/utils");
const { MULTIPLIER } = require("../utils/constants");
const hre = require("hardhat");

const CHAINID = hre.network.config.chainId;

const ONE_MINUTE = 60;
const ONE_HOUR = 60 * ONE_MINUTE;
const ONE_DAY = 24 * ONE_HOUR;

describe("CashOut test", function () {
  const wrapLayer = initFixtureTree(ethers.provider);

  const outcomes = [1, 2];
  const conditionId = 1;
  const betId = 1;
  const betAmount = tokens(100);
  const odds = MULTIPLIER * 2;
  const payout = betAmount.mul(odds).div(MULTIPLIER);
  const cashOutBalance = tokens(10000);

  let poolOwner, oracle, bettor;
  let cashOut, wxDAI, lp, core, azuroBet, betExpress;
  let bettorBalance;
  let time;

  async function pause(via = poolOwner) {
    await cashOut.connect(via).pause();
  }

  async function unpause(via = poolOwner) {
    await cashOut.connect(via).unpause();
  }

  async function updateBettingContract(bettingContract, betTokenAddress, via = poolOwner) {
    await cashOut.connect(via).updateBettingContract(bettingContract.address, betTokenAddress);
  }

  async function updateOracle(oracle, isOracle, via = poolOwner) {
    await cashOut.connect(via).updateOracle(oracle.address, isOracle);
  }

  async function withdrawToken(to, value, via = poolOwner) {
    await cashOut.connect(via).withdrawToken(wxDAI.address, to.address, value);
  }

  async function cashOutBets({
    _oracle = oracle,
    _betOwner = bettor,
    _bettingContracts = [core, betExpress],
    _betId = betId,
    _chainId = CHAINID,
    _minOdds = 0,
    _expiresAt = time + ONE_DAY,
    _odds = [odds, odds],
  }) {
    const EIP712Domain = {
      name: "Cash Out",
      version: "1.0.0",
      chainId: _chainId,
      verifyingContract: cashOut.address,
    };
    const cashOutItems = _bettingContracts.map((bettingContract) => ({
      betId: _betId,
      bettingContract: bettingContract.address,
      minOdds: _minOdds,
    }));
    const cashOutOrder = {
      attention: "This is an attention message for web3 wallet users",
      chainId: _chainId,
      items: cashOutItems,
      expiresAt: _expiresAt,
    };
    const types = {
      CashOutItem: [
        { name: "betId", type: "uint256" },
        { name: "bettingContract", type: "address" },
        { name: "minOdds", type: "uint64" },
      ],
      CashOutOrder: [
        { name: "attention", type: "string" },
        { name: "chainId", type: "uint256" },
        { name: "items", type: "CashOutItem[]" },
        { name: "expiresAt", type: "uint64" },
      ],
    };
    const betOwnerSignature = await _betOwner._signTypedData(EIP712Domain, types, cashOutOrder);
    const cashOutDataHash = ethers.utils.keccak256(
      ethers.utils.defaultAbiCoder.encode(
        [
          "tuple(string attention, uint256 chainId, tuple(uint256 betId, address bettingContract, uint64 minOdds)[] items, uint64 expiresAt) order",
          "uint64[] odds",
          "bytes betOwnerSignature",
        ],
        [cashOutOrder, _odds, betOwnerSignature]
      )
    );
    const oracleSignature = await _oracle.signMessage(ethers.utils.arrayify(cashOutDataHash));
    await cashOut.connect(poolOwner).cashOutBets(cashOutOrder, _odds, betOwnerSignature, oracleSignature);
  }

  async function cashOutBet({
    _oracle = oracle,
    _betOwner = bettor,
    _bettingContract = core,
    _betId = betId,
    _chainId = CHAINID,
    _minOdds = 0,
    _expiresAt = time + ONE_DAY,
    _odds = odds,
  }) {
    return cashOutBets({
      _oracle,
      _betOwner,
      _bettingContracts: [_bettingContract],
      _betId,
      _chainId,
      _minOdds,
      _expiresAt,
      _odds: [_odds],
    });
  }

  async function deployAndInit() {
    const liquidity = tokens(200000);
    const reinforcement = tokens(10000);

    let factoryOwner, dataProvider, affiliate, relayExecutor;
    [factoryOwner, poolOwner, dataProvider, affiliate, oracle, bettor, affiliate, relayExecutor] =
      await ethers.getSigners();

    // Prepare Pool
    let factory, access, roleIds;
    ({ factory, access, core, azuroBet, wxDAI, lp, roleIds } = await prepareStand(
      ethers,
      factoryOwner,
      poolOwner,
      dataProvider,
      affiliate,
      bettor,
      1,
      0,
      0,
      0,
      liquidity
    ));
    await grantRole(access, poolOwner, oracle.address, roleIds.oracle);

    time = await getBlockTime(ethers);
    for (const i of Array(3).keys()) {
      const gameId = i + 1;
      await createGame(lp, oracle, gameId, time + ONE_HOUR);
      await createCondition(core, oracle, gameId, conditionId + i, [1, 1], outcomes, reinforcement, 0, false);
    }
    await makeBetGetTokenId(
      lp,
      core,
      bettor,
      affiliate.address,
      conditionId,
      betAmount,
      outcomes[0],
      time + ONE_HOUR,
      0
    );

    // Prepare bet on BetExpress
    betExpress = await plugBetExpress(
      ethers,
      factoryOwner,
      poolOwner,
      factory,
      lp,
      access,
      core,
      roleIds.oddsManager,
      MULTIPLIER,
      reinforcement
    );

    const subBets = [];
    for (const i of Array(3).keys()) {
      subBets.push({
        conditionId: conditionId + i,
        outcomeId: outcomes[0],
      });
    }
    await lp
      .connect(bettor)
      .bet(betExpress.address, betAmount, time + ONE_HOUR, [
        affiliate.address,
        0,
        ethers.utils.defaultAbiCoder.encode(["tuple(uint256 conditionId, uint64 outcomeId)[]"], [subBets]),
      ]);

    // Prepare CashOut
    const CashOut = await ethers.getContractFactory("CashOut", { signer: poolOwner });
    cashOut = await upgrades.deployProxy(CashOut, [wxDAI.address]);

    await cashOut.connect(poolOwner).updateOracle(oracle.address, true);
    await cashOut.connect(poolOwner).updateBettingContract(core.address, azuroBet.address);
    await cashOut.connect(poolOwner).updateBettingContract(betExpress.address, betExpress.address);
    await wxDAI.connect(poolOwner).transfer(cashOut.address, cashOutBalance);

    await azuroBet.connect(bettor).approve(cashOut.address, betId);
    await betExpress.connect(bettor).approve(cashOut.address, betId);
    bettorBalance = await wxDAI.balanceOf(bettor.address);

    await timeShift(time + ONE_HOUR + ONE_MINUTE);
  }

  wrapLayer(deployAndInit);

  context("Cashing Out", function () {
    context("Cashing out pre-match bets", function () {
      it("Should successfully cash-out a pre-match bet", async function () {
        await cashOutBet({});
        expect(await azuroBet.ownerOf(betId)).to.equal(cashOut.address);
        expect(await wxDAI.balanceOf(bettor.address)).to.equal(bettorBalance.add(payout));
        expect(await wxDAI.balanceOf(cashOut.address)).to.equal(cashOutBalance.sub(payout));
      });
      it("Should prevent cash-out of an already paid pre-match bet", async function () {
        await core.connect(oracle).resolveCondition(conditionId, [outcomes[0]]);
        await lp.withdrawPayout(core.address, betId);
        await expect(cashOutBet({})).to.revertedWithCustomError(cashOut, "BetAlreadyPaid");
      });
      it("Should prevent cash-out of an already resolved pre-match bet", async function () {
        await core.connect(oracle).resolveCondition(conditionId, [outcomes[0]]);
        await expect(cashOutBet({})).to.revertedWithCustomError(cashOut, "BetAlreadyResolved");
      });
    });

    context("Cashing out express bets", function () {
      it("Should successfully cash-out an express bet", async function () {
        await cashOutBet({ _bettingContract: betExpress });
        expect(await betExpress.ownerOf(betId)).to.equal(cashOut.address);
        expect(await wxDAI.balanceOf(bettor.address)).to.equal(bettorBalance.add(payout));
        expect(await wxDAI.balanceOf(cashOut.address)).to.equal(cashOutBalance.sub(payout));
      });
      it("Should prevent cash-out of an already paid express bet", async function () {
        for (const i of Array(3).keys()) {
          await core.connect(oracle).resolveCondition(conditionId + i, [outcomes[0]]);
        }
        await lp.withdrawPayout(betExpress.address, betId);
        await expect(cashOutBet({ _bettingContract: betExpress })).to.revertedWithCustomError(
          cashOut,
          "BetAlreadyPaid"
        );
      });
      it("Should prevent cash-out of an already resolved express bet", async function () {
        for (const i of Array(3).keys()) {
          await core.connect(oracle).resolveCondition(conditionId + i, [outcomes[0]]);
        }
        await expect(cashOutBet({ _bettingContract: betExpress })).to.revertedWithCustomError(
          cashOut,
          "BetAlreadyResolved"
        );
      });
    });

    context("Cashing out multiple bets", function () {
      it("Should successfully cash out multiple bets of different types", async function () {
        await cashOutBets({});
        expect(await azuroBet.ownerOf(betId)).to.equal(cashOut.address);
        expect(await betExpress.ownerOf(betId)).to.equal(cashOut.address);
        expect(await wxDAI.balanceOf(bettor.address)).to.equal(bettorBalance.add(payout.mul(2)));
        expect(await wxDAI.balanceOf(cashOut.address)).to.equal(cashOutBalance.sub(payout.mul(2)));
      });
      it("Should prevent cash-out with an empty odds array", async function () {
        await expect(cashOutBets({ _odds: [] })).to.revertedWithCustomError(cashOut, "InvalidOddsCount");
      });

      it("Should prevent cash-out if the length of the odds array differs from the number of bets", async function () {
        await expect(cashOutBets({ _odds: [odds] })).to.revertedWithCustomError(cashOut, "InvalidOddsCount");
      });
    });

    context("Common", function () {
      it("Should prevent cash-out with an invalid oracle signature", async function () {
        await expect(cashOutBet({ _oracle: bettor })).to.revertedWithCustomError(cashOut, "InvalidOracleSignature");
      });
      it("Should prevent cash-out with a bettor signature for a different network", async function () {
        await expect(cashOutBet({ _chainId: 123 })).to.revertedWithCustomError(cashOut, "InvalidChainId");
      });
      it("Should prevent cash-out for a non-allowed betting contract", async function () {
        await expect(cashOutBet({ _bettingContract: lp })).to.revertedWithCustomError(
          cashOut,
          "BettingContractNotAllowed"
        );
      });
      it("Should prevent cash-out with an expired bet owner signature", async function () {
        await timeShift(time + ONE_DAY);
        await expect(cashOutBet({})).to.revertedWithCustomError(cashOut, "BetOwnerSignatureExpired");
      });
      it("Should prevent cash-out with an invalid bet owner signature", async function () {
        await azuroBet.connect(bettor).transferFrom(bettor.address, poolOwner.address, betId);
        await expect(cashOutBet({})).to.revertedWithCustomError(cashOut, "InvalidBetOwnerSignature");
      });
      it("Should prevent cash-out with odds lower than the minimum", async function () {
        await expect(cashOutBet({ _minOdds: odds + 1 })).to.revertedWithCustomError(cashOut, "InvalidOdds");
      });
      it("Should prevent cash-out if the contract has insufficient token balance", async function () {
        await cashOut
          .connect(poolOwner)
          .withdrawToken(wxDAI.address, poolOwner.address, cashOutBalance.sub(payout).add(1));
        await expect(cashOutBet({})).to.revertedWithCustomError(cashOut, "InsufficientBalance");
      });
    });
  });

  context("Contract Management", function () {
    context("Pausing cashing out", function () {
      it("Should allow the owner to pause cashing out", async function () {
        await pause();
        await expect(cashOutBet({})).to.revertedWith("Pausable: paused");
      });
      it("Should prevent non-owner from pausing cashing out", async function () {
        await expect(pause((via = bettor))).to.revertedWith("Ownable: account is not the owner");
      });
      it("Should fail to pause if cashing out is already paused", async function () {
        await pause();
        await expect(pause()).to.revertedWith("Pausable: paused");
      });
    });

    context("Unpausing cashing out", function () {
      it("Should allow the owner to unpause cashing out", async function () {
        await pause();
        await unpause();
        await expect(cashOutBet({})).to.not.reverted;
      });
      it("Should prevent non-owner from unpausing cashing out", async function () {
        await expect(unpause((via = bettor))).to.revertedWith("Ownable: account is not the owner");
      });
      it("Should fail to unpause if cashing out is already active", async function () {
        await expect(unpause()).to.revertedWith("Pausable: not paused");
      });
    });

    context("Updating betting contracts", function () {
      it("Should update the betting contract address", async function () {
        await updateBettingContract(core, betExpress.address);
        await cashOutBet({});
        expect(await betExpress.ownerOf(betId)).to.equal(cashOut.address);
      });
      it("Should disable the betting contract by setting the bet token address to 0x0", async function () {
        await updateBettingContract(core, ethers.constants.AddressZero);
        await expect(cashOutBet({})).to.revertedWithCustomError(cashOut, "BettingContractNotAllowed");
      });
      it("Should prevent non-owner from updating betting contracts", async function () {
        await expect(updateBettingContract(core, ethers.constants.AddressZero, (via = bettor))).to.revertedWith(
          "Ownable: account is not the owner"
        );
      });
      it("Should prevent updating the betting contract to the same state", async function () {
        await expect(updateBettingContract(core, azuroBet.address)).to.revertedWithCustomError(
          cashOut,
          "NothingChanged"
        );
      });
    });

    context("Updating oracles", function () {
      it("Should enable an oracle", async function () {
        await updateOracle(bettor, true);
        await expect(cashOutBet({ _oracle: bettor })).not.be.reverted;
      });
      it("Should disable an oracle", async function () {
        await updateOracle(oracle, false);
        await expect(cashOutBet({})).revertedWithCustomError(cashOut, "InvalidOracleSignature");
      });
      it("Should prevent non-owner from updating oracles", async function () {
        await expect(updateOracle(bettor, true, (via = bettor))).to.revertedWith("Ownable: account is not the owner");
      });
      it("Should prevent updating an oracle to the same state", async function () {
        await expect(updateOracle(oracle, true)).to.revertedWithCustomError(cashOut, "NothingChanged");
      });
    });

    context("Withdrawing tokens", function () {
      it("Should allow the owner to withdraw tokens", async function () {
        const withdrawal = cashOutBalance.sub(payout).add(1);
        await withdrawToken(bettor, withdrawal);
        await expect(cashOutBet({})).to.revertedWithCustomError(cashOut, "InsufficientBalance");
        expect(await wxDAI.balanceOf(cashOut.address)).to.equal(cashOutBalance.sub(withdrawal));
        expect(await wxDAI.balanceOf(bettor.address)).to.equal(bettorBalance.add(withdrawal));
      });
      it("Should prevent non-owner from withdrawing tokens", async function () {
        await expect(withdrawToken(poolOwner, cashOutBalance, (via = bettor))).to.revertedWith(
          "Ownable: account is not the owner"
        );
      });
    });
  });
});
