const { expect } = require("chai");
const { ethers, network } = require("hardhat");
const {
  createCondition,
  createGame,
  getBlockTime,
  getLPNFTToken,
  initFixtureTree,
  makeBetGetTokenId,
  makeBetGetTokenIdOdds,
  makeWithdrawLiquidity,
  prepareAccess,
  prepareEmptyStand,
  tokens,
  timeShift,
} = require("../utils/utils");

const addLiquidity = async (lp, account, amount, data) => {
  let txAdd = await lp.connect(account).addLiquidity(amount, data);
  return await getLPNFTToken(txAdd);
};

const stake = async (staking, account, amount) => {
  await staking.connect(account).stake(amount);
};

const unstake = async (staking, account, stakeId) => {
  await staking.connect(account).withdraw(stakeId);
};

const getOracleResponse = async (stakingConnector, lp, oracle, account, depositLimit) => {
  const chainId = await network.provider.send("eth_chainId");
  const nonce = await stakingConnector.nonces(account.address);
  const oracleResponse = {
    chainId: chainId,
    nonce: nonce,
    lp: lp.address,
    account: account.address,
    depositLimit: depositLimit,
  };

  const messageHash = ethers.utils.keccak256(
    ethers.utils.defaultAbiCoder.encode(
      ["uint256", "uint256", "address", "address", "uint256"],
      [
        oracleResponse.chainId,
        oracleResponse.nonce,
        oracleResponse.lp,
        oracleResponse.account,
        oracleResponse.depositLimit,
      ]
    )
  );

  const signedMessage = await oracle.signMessage(ethers.utils.arrayify(messageHash));

  return ethers.utils.defaultAbiCoder.encode(
    ["tuple(uint256 chainId, uint256 nonce, address lp, address account, uint256 depositLimit)", "bytes"],
    [oracleResponse, signedMessage]
  );
};

const OUTCOMEWIN = 1;
const OUTCOMELOSE = 2;

const MULTIPLIER = 1e12;

const ONE_YEAR = 31536000;
const ONE_DAY = 86400;
const ONE_MINUTE = 60;

describe("Staking test", function () {
  const wrapLayer = initFixtureTree(ethers.provider);

  const stakingPeriod = ONE_YEAR;
  const interestRate = MULTIPLIER * 0.08; // 8%
  const stakeAmount = tokens(20);

  let dao, poolOwner, dataProvider, oracle, maintainer, lpSupplier;
  let access, core, wxDAI, lp, staking;
  let roleIds, balance;

  async function deployAndInit() {
    [dao, poolOwner, dataProvider, oracle, maintainer, lpSupplier] = await ethers.getSigners();

    ({ access, core, wxDAI, lp, roleIds } = await prepareEmptyStand(
      ethers,
      dao,
      poolOwner,
      dataProvider,
      lpSupplier,
      1,
      0,
      0
    ));
    await prepareAccess(access, poolOwner, oracle.address, poolOwner.address, maintainer.address, roleIds);

    const Staking = await ethers.getContractFactory("Staking", { signer: poolOwner });
    staking = await upgrades.deployProxy(Staking, [wxDAI.address, interestRate]);
    await staking.deployed();

    await wxDAI.connect(poolOwner).approve(lp.address, tokens(999_999_999_999_999));
    await wxDAI.connect(poolOwner).approve(staking.address, tokens(999_999_999_999_999));
    await wxDAI.connect(poolOwner).transfer(staking.address, tokens(100));

    await wxDAI.connect(lpSupplier).approve(staking.address, tokens(999_999_999_999_999));
    balance = await wxDAI.balanceOf(lpSupplier.address);
  }

  wrapLayer(deployAndInit);

  context("Common use cases", function () {
    it("Stake", async () => {
      await stake(staking, lpSupplier, stakeAmount);

      const time = await getBlockTime(ethers);
      await timeShift(time + stakingPeriod);

      await unstake(staking, lpSupplier, 1);
      expect(await wxDAI.balanceOf(lpSupplier.address)).to.be.equal(
        balance.add(stakeAmount.mul(interestRate).div(MULTIPLIER))
      );
    });
    it("Change interest rate before stake", async () => {
      const newInterestRate = MULTIPLIER * 0.5;
      await staking.connect(poolOwner).changeInterestRate(newInterestRate);

      await stake(staking, lpSupplier, stakeAmount);

      const time = await getBlockTime(ethers);
      await timeShift(time + stakingPeriod);

      await unstake(staking, lpSupplier, 1);
      expect(await wxDAI.balanceOf(lpSupplier.address)).to.be.equal(
        balance.add(stakeAmount.mul(newInterestRate).div(MULTIPLIER))
      );
    });
    it("Change interest rate after stake", async () => {
      await stake(staking, lpSupplier, stakeAmount);

      const newInterestRate = MULTIPLIER * 0.5;
      await staking.connect(poolOwner).changeInterestRate(newInterestRate);

      const time = await getBlockTime(ethers);
      await timeShift(time + stakingPeriod);

      await unstake(staking, lpSupplier, 1);
      expect(await wxDAI.balanceOf(lpSupplier.address)).to.be.equal(
        balance.add(stakeAmount.mul(interestRate).div(MULTIPLIER))
      );
    });
  });
  context("Check restrictions", function () {
    it("Check owner rights", async () => {
      await expect(staking.connect(lpSupplier).changeInterestRate(interestRate)).to.be.revertedWith(
        "Ownable: account is not the owner"
      );
    });
    it("Stake CANNOT be added if the staker have an insufficient balance", async () => {
      await wxDAI.connect(lpSupplier).transfer(oracle.address, stakeAmount.sub(1));
      await wxDAI.connect(oracle).approve(staking.address, tokens(999_999_999_999_999));
      await expect(stake(staking, oracle, stakeAmount)).to.be.revertedWith(
        "TransferHelper::transferFrom: transferFrom failed"
      );
    });
    it("Stake CANNOT be withdrawn not by its owner", async () => {
      await stake(staking, lpSupplier, stakeAmount);

      const time = await getBlockTime(ethers);
      await timeShift(time + stakingPeriod);
      await expect(unstake(staking, poolOwner, 1)).to.be.revertedWithCustomError(staking, "StakeNotOwned");
    });
    it("Stake CANNOT be withdrawn twice", async () => {
      await stake(staking, lpSupplier, stakeAmount);

      const time = await getBlockTime(ethers);
      await timeShift(time + stakingPeriod);
      await unstake(staking, lpSupplier, 1);
      await expect(unstake(staking, lpSupplier, 1)).to.be.revertedWithCustomError(staking, "StakeNotOwned");
    });
    it("Stake CANNOT be withdrawn before its withdrawal time", async () => {
      await stake(staking, lpSupplier, stakeAmount, stakingPeriod);

      const time = await getBlockTime(ethers);
      await timeShift(time + stakingPeriod - 10);
      await expect(unstake(staking, lpSupplier, 1)).to.be.revertedWithCustomError(staking, "StakingPeriodNotOver");

      await timeShift(time + stakingPeriod);
      await unstake(staking, lpSupplier, 1);
    });
    it("Stake interest CANNOT be larger than unused balance of the contract", async () => {
      const deposit = tokens(100);
      const interestRate = MULTIPLIER * 1000;
      const availableInterest = await wxDAI.balanceOf(staking.address);
      await staking.connect(poolOwner).changeInterestRate(interestRate);

      await stake(staking, lpSupplier, deposit, 2 * stakingPeriod);
      await stake(staking, lpSupplier, deposit, stakingPeriod);

      let time = await getBlockTime(ethers);
      await timeShift(time + stakingPeriod);
      await unstake(staking, lpSupplier, 2);
      expect(await wxDAI.balanceOf(lpSupplier.address)).to.be.equal(balance.sub(deposit));

      time = await getBlockTime(ethers);
      await timeShift(time + 2 * stakingPeriod);
      await unstake(staking, lpSupplier, 1);
      expect(await wxDAI.balanceOf(lpSupplier.address)).to.be.equal(balance.add(availableInterest));
    });
    it("The withdrawn amount for a stake DOES NOT increase if you unstake after the lock-up period expires", async () => {
      await stake(staking, lpSupplier, stakeAmount);

      const time = await getBlockTime(ethers);
      await timeShift(time + 2 * stakingPeriod);

      await unstake(staking, lpSupplier, 1);
      expect(await wxDAI.balanceOf(lpSupplier.address)).to.be.equal(
        balance.add(stakeAmount.mul(interestRate).div(MULTIPLIER))
      );
    });
  });
});

describe("Staking connector test", function () {
  const wrapLayer = initFixtureTree(ethers.provider);

  const REINFORCEMENT = tokens(20000);
  const MARGINALITY = MULTIPLIER * 0.05; // 5%

  const depositRate = MULTIPLIER * 5; // stake/deposit = 1/5

  const pool1 = 5000000;
  const pool2 = 5000000;

  const stakeAmount = tokens(20);
  const deposit = stakeAmount.mul(depositRate).div(MULTIPLIER);
  const betAmount = tokens(50);

  let dao, poolOwner, dataProvider, oracle, maintainer, lpSupplier;
  let access, core, wxDAI, lp, stakingConnector;
  let roleIds;

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
      1,
      0,
      0
    ));
    await prepareAccess(access, poolOwner, oracle.address, poolOwner.address, maintainer.address, roleIds);

    const StakingConnector = await ethers.getContractFactory("StakingConnector", { signer: poolOwner });
    stakingConnector = await upgrades.deployProxy(StakingConnector, [lp.address, oracle.address]);
    await stakingConnector.deployed();

    await lp.connect(poolOwner).changeLiquidityManager(stakingConnector.address);

    await wxDAI.connect(lpSupplier).approve(lp.address, tokens(999_999_999_999_999));
    await wxDAI.connect(poolOwner).approve(lp.address, tokens(999_999_999_999_999));
  }

  wrapLayer(deployAndInit);

  context("Common use cases", function () {
    it("deposit", async () => {
      let oracleResponse = await getOracleResponse(stakingConnector, lp, oracle, lpSupplier, deposit);
      const lpNFT = await addLiquidity(lp, lpSupplier, deposit, oracleResponse);

      oracleResponse = await getOracleResponse(stakingConnector, lp, oracle, lpSupplier, 0);
      await expect(addLiquidity(lp, lpSupplier, 1, oracleResponse)).to.be.revertedWithCustomError(
        stakingConnector,
        "InsufficientDepositLimit"
      );
      await makeWithdrawLiquidity(lp, lpSupplier, lpNFT, MULTIPLIER);
    });
    it("deposit - resolve losing condition - withdraw (50%) - deposit - withdraw (100%)", async () => {
      let oracleResponse = await getOracleResponse(stakingConnector, lp, oracle, lpSupplier, deposit);
      const lpNFT = await addLiquidity(lp, lpSupplier, deposit, oracleResponse);

      let time = await getBlockTime(ethers);
      await createGame(lp, oracle, ++gameId, time + ONE_DAY);
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
      await makeBetGetTokenIdOdds(
        lp,
        core,
        poolOwner,
        ethers.constants.AddressZero,
        condId,
        betAmount,
        OUTCOMEWIN,
        time + 100,
        0
      );
      await timeShift(time + ONE_DAY + ONE_MINUTE);
      await core.connect(oracle).resolveCondition(condId, [OUTCOMEWIN]);
      await makeWithdrawLiquidity(lp, lpSupplier, lpNFT, MULTIPLIER / 2);

      oracleResponse = await getOracleResponse(stakingConnector, lp, oracle, lpSupplier, deposit);
      await expect(
        addLiquidity(lp, lpSupplier, deposit.sub(await lp.nodeWithdrawView(lpNFT)).add(1), oracleResponse)
      ).to.be.revertedWithCustomError(stakingConnector, "InsufficientDepositLimit");
      const lpNFT2 = await addLiquidity(lp, lpSupplier, deposit.sub(await lp.nodeWithdrawView(lpNFT)), oracleResponse);

      oracleResponse = await getOracleResponse(stakingConnector, lp, oracle, lpSupplier, deposit);
      await expect(addLiquidity(lp, lpSupplier, 1, oracleResponse)).to.be.revertedWithCustomError(
        stakingConnector,
        "InsufficientDepositLimit"
      );

      await makeWithdrawLiquidity(lp, lpSupplier, lpNFT, MULTIPLIER);
      await makeWithdrawLiquidity(lp, lpSupplier, lpNFT2, MULTIPLIER);
    });
    it("stake (1 year) - deposit - resolve profitable condition - withdraw (50%) - deposit - withdraw (100%) - unstake", async () => {
      let oracleResponse = await getOracleResponse(stakingConnector, lp, oracle, lpSupplier, deposit);
      const lpNFT = await addLiquidity(lp, lpSupplier, deposit, oracleResponse);

      let time = await getBlockTime(ethers);
      await createGame(lp, oracle, ++gameId, time + ONE_DAY);
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
      await makeBetGetTokenId(
        lp,
        core,
        poolOwner,
        ethers.constants.AddressZero,
        condId,
        betAmount,
        OUTCOMELOSE,
        time + 100,
        0
      );

      await timeShift(time + ONE_DAY + ONE_MINUTE);
      await core.connect(oracle).resolveCondition(condId, [OUTCOMEWIN]);
      await makeWithdrawLiquidity(lp, lpSupplier, lpNFT, MULTIPLIER / 2);

      oracleResponse = await getOracleResponse(stakingConnector, lp, oracle, lpSupplier, deposit);
      await expect(
        addLiquidity(lp, lpSupplier, deposit.sub(await lp.nodeWithdrawView(lpNFT)).add(1), oracleResponse)
      ).to.be.revertedWithCustomError(stakingConnector, "InsufficientDepositLimit");
      const lpNFT2 = await addLiquidity(lp, lpSupplier, deposit.sub(await lp.nodeWithdrawView(lpNFT)), oracleResponse);

      oracleResponse = await getOracleResponse(stakingConnector, lp, oracle, lpSupplier, deposit);
      await expect(addLiquidity(lp, lpSupplier, 1, oracleResponse)).to.be.revertedWithCustomError(
        stakingConnector,
        "InsufficientDepositLimit"
      );

      await makeWithdrawLiquidity(lp, lpSupplier, lpNFT, MULTIPLIER);
      await makeWithdrawLiquidity(lp, lpSupplier, lpNFT2, MULTIPLIER);
    });
    it("deposit - resolve profitable condition - withdraw (1%) - withdraw (100%)", async () => {
      let oracleResponse = await getOracleResponse(stakingConnector, lp, oracle, lpSupplier, deposit);
      const lpNFT = await addLiquidity(lp, lpSupplier, deposit, oracleResponse);

      let time = await getBlockTime(ethers);
      await createGame(lp, oracle, ++gameId, time + ONE_DAY);
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
      await makeBetGetTokenId(
        lp,
        core,
        poolOwner,
        ethers.constants.AddressZero,
        condId,
        betAmount,
        OUTCOMELOSE,
        time + 100,
        0
      );

      await timeShift(time + ONE_DAY + ONE_MINUTE);
      await core.connect(oracle).resolveCondition(condId, [OUTCOMEWIN]);
      await makeWithdrawLiquidity(lp, lpSupplier, lpNFT, MULTIPLIER * 0.01);

      oracleResponse = await getOracleResponse(stakingConnector, lp, oracle, lpSupplier, deposit);
      await expect(addLiquidity(lp, lpSupplier, 1, oracleResponse)).to.be.revertedWithCustomError(
        stakingConnector,
        "InsufficientDepositLimit"
      );

      await makeWithdrawLiquidity(lp, lpSupplier, lpNFT, MULTIPLIER);
    });
    it("deposit - transfer lpNFT - withdraw (100%)", async () => {
      let oracleResponse = await getOracleResponse(stakingConnector, lp, oracle, lpSupplier, deposit);
      const lpNFT = await addLiquidity(lp, lpSupplier, deposit, oracleResponse);

      await lp.connect(lpSupplier).transferFrom(lpSupplier.address, poolOwner.address, lpNFT);

      oracleResponse = await getOracleResponse(stakingConnector, lp, oracle, lpSupplier, deposit);
      await expect(addLiquidity(lp, lpSupplier, 1, oracleResponse)).to.be.revertedWithCustomError(
        stakingConnector,
        "InsufficientDepositLimit"
      );
      await expect(addLiquidity(lp, poolOwner, 1, oracleResponse)).to.be.revertedWithCustomError(
        stakingConnector,
        "OracleResponseDoesNotMatch"
      );

      await makeWithdrawLiquidity(lp, poolOwner, lpNFT, MULTIPLIER);
    });
    it("deposit - transfer lpNFT - withdraw (50%) - deposit - withdraw (50%)", async () => {
      let oracleResponse = await getOracleResponse(stakingConnector, lp, oracle, lpSupplier, deposit);
      const lpNFT = await addLiquidity(lp, lpSupplier, deposit, oracleResponse);

      await lp.connect(lpSupplier).transferFrom(lpSupplier.address, poolOwner.address, lpNFT);
      await makeWithdrawLiquidity(lp, poolOwner, lpNFT, MULTIPLIER / 2);

      oracleResponse = await getOracleResponse(stakingConnector, lp, oracle, lpSupplier, deposit);
      await expect(addLiquidity(lp, lpSupplier, deposit.div(2).add(1), oracleResponse)).to.be.revertedWithCustomError(
        stakingConnector,
        "InsufficientDepositLimit"
      );
      await expect(addLiquidity(lp, poolOwner, deposit.div(2), oracleResponse)).to.be.revertedWithCustomError(
        stakingConnector,
        "OracleResponseDoesNotMatch"
      );
      const lpNFT2 = await addLiquidity(lp, lpSupplier, deposit.div(2), oracleResponse);

      await makeWithdrawLiquidity(lp, poolOwner, lpNFT, MULTIPLIER);
      await makeWithdrawLiquidity(lp, lpSupplier, lpNFT2, MULTIPLIER);
    });
  });
  context("Settings management", function () {
    it("Remove liquidity manager", async () => {
      await lp.connect(poolOwner).changeLiquidityManager(ethers.constants.AddressZero);
      const oracleResponse = await getOracleResponse(stakingConnector, lp, oracle, lpSupplier, deposit);
      const lpNFT = await addLiquidity(lp, lpSupplier, deposit, oracleResponse);

      await makeWithdrawLiquidity(lp, lpSupplier, lpNFT, MULTIPLIER);
    });
    it("Add liquidity manager after depositing liquidity", async () => {
      await lp.connect(poolOwner).changeLiquidityManager(ethers.constants.AddressZero);
      const oracleResponse = await getOracleResponse(stakingConnector, lp, oracle, lpSupplier, deposit);
      const lpNFT = await addLiquidity(lp, lpSupplier, deposit, oracleResponse);

      await lp.connect(poolOwner).changeLiquidityManager(stakingConnector.address);
      await makeWithdrawLiquidity(lp, lpSupplier, lpNFT, MULTIPLIER);
    });
  });
  context("Check restrictions", function () {
    it("Check owner rights", async () => {
      await expect(stakingConnector.connect(lpSupplier).changeOracle(lpSupplier.address)).to.be.revertedWith(
        "Ownable: account is not the owner"
      );
    });
    it("Liquidity CAN NOT be added if oracle response contains another account address", async () => {
      const oracleResponse = await getOracleResponse(stakingConnector, lp, oracle, poolOwner, deposit);
      await expect(addLiquidity(lp, lpSupplier, deposit, oracleResponse)).to.be.revertedWithCustomError(
        stakingConnector,
        "OracleResponseDoesNotMatch"
      );
    });
    it("Liquidity CAN NOT be added if oracle response contains another LP address", async () => {
      const oracleResponse = await getOracleResponse(stakingConnector, core, oracle, lpSupplier, deposit);
      await expect(addLiquidity(lp, lpSupplier, deposit, oracleResponse)).to.be.revertedWithCustomError(
        stakingConnector,
        "OracleResponseDoesNotMatch"
      );
    });
    it("Liquidity CAN NOT be added if oracle response contains another chain ID", async () => {
      const chainId = 123;
      const nonce = await stakingConnector.nonces(lpSupplier.address);
      let oracleResponse = {
        chainId: chainId,
        nonce: nonce,
        lp: lp.address,
        account: lpSupplier.address,
        depositLimit: deposit,
      };

      const messageHash = ethers.utils.keccak256(
        ethers.utils.defaultAbiCoder.encode(
          ["uint256", "uint256", "address", "address", "uint256"],
          [
            oracleResponse.chainId,
            oracleResponse.nonce,
            oracleResponse.lp,
            oracleResponse.account,
            oracleResponse.depositLimit,
          ]
        )
      );

      const signedMessage = await oracle.signMessage(ethers.utils.arrayify(messageHash));

      oracleResponse = ethers.utils.defaultAbiCoder.encode(
        ["tuple(uint256 chainId, uint256 nonce, address lp, address account, uint256 depositLimit)", "bytes"],
        [oracleResponse, signedMessage]
      );
      await expect(addLiquidity(lp, lpSupplier, deposit, oracleResponse)).to.be.revertedWithCustomError(
        stakingConnector,
        "OracleResponseDoesNotMatch"
      );
    });
    it("Liquidity CAN NOT be added if oracle response contains incorrect nonce", async () => {
      const chainId = await network.provider.send("eth_chainId");
      const nonce = 123;
      let oracleResponse = {
        chainId: chainId,
        nonce: nonce,
        lp: lp.address,
        account: lpSupplier.address,
        depositLimit: deposit,
      };

      const messageHash = ethers.utils.keccak256(
        ethers.utils.defaultAbiCoder.encode(
          ["uint256", "uint256", "address", "address", "uint256"],
          [
            oracleResponse.chainId,
            oracleResponse.nonce,
            oracleResponse.lp,
            oracleResponse.account,
            oracleResponse.depositLimit,
          ]
        )
      );

      const signedMessage = await oracle.signMessage(ethers.utils.arrayify(messageHash));

      oracleResponse = ethers.utils.defaultAbiCoder.encode(
        ["tuple(uint256 chainId, uint256 nonce, address lp, address account, uint256 depositLimit)", "bytes"],
        [oracleResponse, signedMessage]
      );
      await expect(addLiquidity(lp, lpSupplier, deposit, oracleResponse)).to.be.revertedWithCustomError(
        stakingConnector,
        "InvalidNonce"
      );
    });
    it("Liquidity CAN NOT be added if oracle response is generated by another oracle", async () => {
      const oracleResponse = await getOracleResponse(stakingConnector, lp, poolOwner, lpSupplier, deposit);
      await expect(addLiquidity(lp, lpSupplier, deposit, oracleResponse)).to.be.revertedWithCustomError(
        stakingConnector,
        "InvalidSignature"
      );
    });
    it("Liquidity CAN NOT be added if oracle response contains invalid signature", async () => {
      const chainId = await network.provider.send("eth_chainId");
      const nonce = await stakingConnector.nonces(lpSupplier.address);
      let oracleResponse = {
        chainId: chainId,
        nonce: nonce,
        lp: lp.address,
        account: lpSupplier.address,
        depositLimit: deposit,
      };

      const messageHash = ethers.utils.keccak256(
        ethers.utils.defaultAbiCoder.encode(
          ["uint256", "uint256", "address", "address", "uint256"],
          [oracleResponse.chainId, oracleResponse.nonce, oracleResponse.lp, oracleResponse.account, 110]
        )
      );

      const signedMessage = await oracle.signMessage(ethers.utils.arrayify(messageHash));

      oracleResponse = ethers.utils.defaultAbiCoder.encode(
        ["tuple(uint256 chainId, uint256 nonce, address lp, address account, uint256 depositLimit)", "bytes"],
        [oracleResponse, signedMessage]
      );
      await expect(addLiquidity(lp, lpSupplier, deposit, oracleResponse)).to.be.revertedWithCustomError(
        stakingConnector,
        "InvalidSignature"
      );
    });
    it("Liquidity CAN NOT be added if oracle response contains another chain ID", async () => {
      const chainId = 123;
      const nonce = await stakingConnector.nonces(lpSupplier.address);
      let oracleResponse = {
        chainId: chainId,
        nonce: nonce,
        lp: lp.address,
        account: lpSupplier.address,
        depositLimit: deposit,
      };

      const messageHash = ethers.utils.keccak256(
        ethers.utils.defaultAbiCoder.encode(
          ["uint256", "uint256", "address", "address", "uint256"],
          [
            oracleResponse.chainId,
            oracleResponse.nonce,
            oracleResponse.lp,
            oracleResponse.account,
            oracleResponse.depositLimit,
          ]
        )
      );

      const signedMessage = await oracle.signMessage(ethers.utils.arrayify(messageHash));

      oracleResponse = ethers.utils.defaultAbiCoder.encode(
        ["tuple(uint256 chainId, uint256 nonce, address lp, address account, uint256 depositLimit)", "bytes"],
        [oracleResponse, signedMessage]
      );
      await expect(addLiquidity(lp, lpSupplier, deposit, oracleResponse)).to.be.revertedWithCustomError(
        stakingConnector,
        "OracleResponseDoesNotMatch"
      );
    });
    it("Liquidity CANNOT be added if it exceeds the deposit limit specified in the oracle response", async () => {
      const oracleResponse = await getOracleResponse(stakingConnector, lp, oracle, lpSupplier, deposit);
      await expect(addLiquidity(lp, lpSupplier, deposit.add(1), oracleResponse)).to.be.revertedWithCustomError(
        stakingConnector,
        "InsufficientDepositLimit"
      );
    });
  });
});
