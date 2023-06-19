const { BigNumber } = require("@ethersproject/bignumber");
const { ethers } = require("hardhat");
const { FORKING, MULTIPLIER, UPGRADE_TEST } = require("../utils/constants");

const abiCoder = ethers.utils.defaultAbiCoder;

function getTimeout(chainId) {
  let timeout;
  switch (chainId) {
    case "0x2a":
      timeout = 8000;
      break; // Kovan
    case "0x4d":
      timeout = 35000;
      break; // Sokol
    case "0x7a69":
      timeout = 800;
      break; // Hardhat
    default:
      timeout = 60000;
  }

  return () => {
    return new Promise((resolve) => setTimeout(resolve, timeout));
  };
}

async function timeShift(time) {
  await network.provider.send("evm_setNextBlockTimestamp", [time]);
  await network.provider.send("evm_mine");
}

async function timeShiftBy(ethers, timeDelta) {
  let time = (await getBlockTime(ethers)) + timeDelta;
  await network.provider.send("evm_setNextBlockTimestamp", [time]);
  await network.provider.send("evm_mine");
}

async function getBlockTime(ethers) {
  const blockNumBefore = await ethers.provider.getBlockNumber();
  const blockBefore = await ethers.provider.getBlock(blockNumBefore);
  const time = blockBefore.timestamp;
  return time;
}

function tokens(val) {
  return BigNumber.from(val).mul(BigNumber.from("10").pow(18));
}

const getTokenId = async (core, txBet) => {
  const receipt = await txBet.wait();
  let iface = new ethers.utils.Interface(
    core.interface.format(ethers.utils.FormatTypes.full).filter((x) => {
      return x.includes("NewBet");
    })
  );
  let log = iface.parseLog(receipt.logs[2]);
  return log.args.tokenId;
};

const getTokenIdOdds = async (core, txBet) => {
  const receipt = await txBet.wait();
  let iface = new ethers.utils.Interface(
    core.interface.format(ethers.utils.FormatTypes.full).filter((x) => {
      return x.includes("NewBet");
    })
  );
  let log = iface.parseLog(receipt.logs[2]);
  return { tokenId: log.args.tokenId, odds: log.args.odds };
};

const getTokenIdDetails = async (core, txBet) => {
  const receipt = await txBet.wait();
  let iface = new ethers.utils.Interface(
    core.interface.format(ethers.utils.FormatTypes.full).filter((x) => {
      return x.includes("NewBet");
    })
  );
  let log = iface.parseLog(receipt.logs[2]);
  return { tokenId: log.args.tokenId, odds: log.args.odds, account: log.args.bettor, gasUsed: calcGas(receipt) };
};

const getLPNFTToken = async (txAdd) => {
  let eAdd = (await txAdd.wait()).events.filter((x) => {
    return x.event == "LiquidityAdded";
  });
  return eAdd[0].args.leaf;
};

const getLPNFTTokenDetails = async (txAdd) => {
  const receipt = await txAdd.wait();
  let eAdd = receipt.events.filter((x) => {
    return x.event == "LiquidityAdded";
  });
  return {
    tokenId: eAdd[0].args.leaf,
    account: eAdd[0].args.account,
    amount: eAdd[0].args.amount,
    gasUsed: calcGas(receipt),
  };
};

const getWinthdrawnAmount = async (tx) => {
  let eWithdraw = (await tx.wait()).events.filter((x) => {
    return x.event == "LiquidityRemoved";
  });
  return eWithdraw[0].args.amount;
};

const getWithdrawPayoutDetails = async (tx) => {
  let receipt = await tx.wait();
  let ePayout = receipt.events.filter((x) => {
    return x.event == "BettorWin";
  });
  return { amount: ePayout[0].args.amount, gasUsed: calcGas(receipt), account: ePayout[0].args.bettor };
};

const getWithdrawLiquidityDetails = async (tx) => {
  let receipt = await tx.wait();
  let ePayout = receipt.events.filter((x) => {
    return x.event == "LiquidityRemoved";
  });
  return { amount: ePayout[0].args.amount, gasUsed: calcGas(receipt), account: ePayout[0].args.account };
};

const deployContracts = async (ethers, owner) => {
  // Access beacon
  const ACCESS = await ethers.getContractFactory("Access", {
    signer: owner,
  });
  const beaconAccess = await upgrades.deployBeacon(ACCESS);
  await beaconAccess.deployed();

  // AzuroBet beacon
  const AZUROBET = await ethers.getContractFactory("AzuroBet", {
    signer: owner,
  });
  const beaconAzuroBet = await upgrades.deployBeacon(AZUROBET);
  await beaconAzuroBet.deployed();

  // LP beacon
  const LP = await ethers.getContractFactory("LP", {
    signer: owner,
  });
  const beaconLP = await upgrades.deployBeacon(LP);
  await beaconLP.deployed();

  // silence linked library proxy deploy warning:
  // Warning: Potentially unsafe deployment of PrematchCore
  //  You are using the `unsafeAllow.external-library-linking` flag to include external libraries.
  //  Make sure you have manually checked that the linked libraries are upgrade safe.
  upgrades.silenceWarnings();

  // Affiliate helper library
  const AffiliateHelper = await ethers.getContractFactory("AffiliateHelper");
  const affiliateHelper = await AffiliateHelper.deploy();
  await affiliateHelper.deployed();

  // Pre-match core beacon
  const PrematchCore = await ethers.getContractFactory("PrematchCore", {
    signer: owner,
    libraries: {
      AffiliateHelper: affiliateHelper.address,
    },
    unsafeAllowCustomTypes: true,
  });
  const beaconPrematchCore = await upgrades.deployBeacon(PrematchCore, { unsafeAllowLinkedLibraries: true });
  await beaconPrematchCore.deployed();

  return {
    beaconAccess,
    beaconLP,
    beaconPrematchCore,
    beaconAzuroBet,
    affiliateHelper,
  };
};

const createFactory = async (ethers, owner, beaconAccess, beaconLP, beaconPrematchCore, beaconAzuroBet) => {
  // Factory
  const Factory = await ethers.getContractFactory("Factory", { signer: owner });
  const factory = await upgrades.deployProxy(Factory, [beaconAccess.address, beaconLP.address]);

  // setting up
  await factory.updateCoreType("pre-match", beaconPrematchCore.address, beaconAzuroBet.address);

  return factory;
};

const getPluggedCore = async (tx) => {
  const receipt = await tx.wait();
  const eNewCore = receipt.events.filter((x) => {
    return (
      x.topics[0] ==
      ethers.utils.keccak256(ethers.utils.toUtf8Bytes("CoreSettingsUpdated(address,uint8,uint64,uint128)"))
    );
  });

  return ethers.utils.defaultAbiCoder.decode(["address"], eNewCore[0].topics[1])[0];
};

const getCreatePoolDetails = async (tx) => {
  const receipt = await tx.wait();
  const eNewPool = receipt.events.filter((x) => {
    return x.event == "NewPool";
  });
  return { lp: eNewPool[0].args[0], core: await getPluggedCore(tx), access: eNewPool[0].args[3] };
};

const createPool = async (
  ethers,
  factory,
  affiliateHelper,
  poolOwner,
  token,
  minDepo,
  daoFee,
  dataProviderFee,
  affiliateFee
) => {
  const txCreatePool = await factory
    .connect(poolOwner)
    .createPool(token, minDepo, daoFee, dataProviderFee, affiliateFee, "pre-match");

  const txDetails = await getCreatePoolDetails(txCreatePool);

  const Access = await ethers.getContractFactory("Access", { signer: poolOwner });
  const access = await Access.attach(txDetails.access);

  const LP = await ethers.getContractFactory("LP", { signer: poolOwner });
  const lp = await LP.attach(txDetails.lp);

  const PrematchCore = await ethers.getContractFactory("PrematchCore", {
    signer: poolOwner,
    libraries: {
      AffiliateHelper: affiliateHelper.address,
    },
    unsafeAllowCustomTypes: true,
  });
  const core = await PrematchCore.attach(txDetails.core);

  const AzuroBet = await ethers.getContractFactory("AzuroBet", {
    signer: poolOwner,
  });
  const azuroBet = await AzuroBet.attach(await core.azuroBet());

  return { access, core, lp, azuroBet };
};

const plugExpress = async (ethers, poolOwner, factoryOwner, factory, lp, core, timeout) => {
  upgrades.silenceWarnings();

  const BetExpress = await ethers.getContractFactory("BetExpress", {
    signer: poolOwner,
  });

  let beaconExpress;
  if ((await factory.coreBeacons("express")).core == ethers.constants.AddressZero) {
    beaconExpress = await upgrades.deployBeacon(BetExpress);
    await beaconExpress.deployed();
    await timeout();

    await factory.connect(factoryOwner).updateCoreType("express", beaconExpress.address, ethers.constants.AddressZero);
    await timeout();
  }

  const plugTx = await factory.connect(poolOwner).plugExpress(lp, core, "express");
  const betExpress = await BetExpress.attach(await getPluggedCore(plugTx));
  await timeout();

  return { betExpress, beaconExpress };
};

const prepareEmptyStand = async (
  ethers,
  factoryOwner,
  poolOwner,
  dataProvider,
  bettor,
  minDepo,
  daoFee,
  dataProviderFee,
  affiliateFee
) => {
  const WXDAI = await ethers.getContractFactory("WETH9");
  const mintableAmount = tokens(80_000_000);
  let factory, access, lp, wxDAI, core, azuroBet, affiliateHelper;

  if (FORKING) {
    await network.provider.request({
      method: "hardhat_reset",
      params: [
        {
          forking: {
            jsonRpcUrl: process.env.GNOSIS_RPC,
          },
        },
      ],
    });

    const Factory = await ethers.getContractFactory("Factory");
    factory = await Factory.attach(process.env.FACTORY_ADDRESS);
    const factoryOwnerAddress = await factory.owner();
    await hre.network.provider.request({
      method: "hardhat_impersonateAccount",
      params: [factoryOwnerAddress],
    });
    const factoryOwner_ = await ethers.provider.getSigner(factoryOwnerAddress);

    const AffiliateHelper = await ethers.getContractFactory("AffiliateHelper");
    affiliateHelper = AffiliateHelper.attach(process.env.AFFILIATEHELPER_ADDRESS);

    const PrematchCore = await ethers.getContractFactory("PrematchCore", {
      libraries: {
        AffiliateHelper: affiliateHelper.address,
      },
      unsafeAllowCustomTypes: true,
    });
    core = await PrematchCore.attach(process.env.CORE_ADDRESS);

    const AzuroBet = await ethers.getContractFactory("AzuroBet");
    azuroBet = await AzuroBet.attach(core.azuroBet());

    const LP = await ethers.getContractFactory("LP");
    lp = await LP.attach(core.lp());
    const lpOwnerAddress = await lp.owner();
    await hre.network.provider.request({
      method: "hardhat_impersonateAccount",
      params: [lpOwnerAddress],
    });
    const lpOwner = await ethers.provider.getSigner(lpOwnerAddress);

    if (UPGRADE_TEST) {
      const Factory = await ethers.getContractFactory("Factory", { signer: factoryOwner_ });
      try {
        await upgrades.upgradeProxy(process.env.FACTORY_ADDRESS, Factory);
      } catch (err) {
        console.log("⚠️Factory not upgraded:", err);
      }

      const AzuroBet = await ethers.getContractFactory("AzuroBet", { signer: lpOwner });
      try {
        await upgrades.upgradeBeacon(process.env.BEACON_AZUROBET_ADDRESS, AzuroBet);
      } catch (err) {
        console.log("⚠️AzuroBet not upgraded:", err);
      }

      const PrematchCore = await ethers.getContractFactory("PrematchCore", {
        libraries: {
          AffiliateHelper: affiliateHelper.address,
        },
        unsafeAllowCustomTypes: true,
        signer: lpOwner,
      });
      try {
        await upgrades.upgradeBeacon(process.env.BEACON_CORE_ADDRESS, PrematchCore, {
          unsafeAllowLinkedLibraries: true,
        });
      } catch (err) {
        console.log("⚠️Core not upgraded:", err);
      }

      const LP = await ethers.getContractFactory("LP", { signer: lpOwner });
      try {
        await upgrades.upgradeBeacon(process.env.BEACON_LP_ADDRESS, LP);
      } catch (err) {
        console.log("⚠️LP not upgraded:", err);
      }
    }

    await factory.connect(factoryOwner_).transferOwnership(factoryOwner.address);
    await azuroBet.connect(lpOwner).transferOwnership(poolOwner.address);
    await core.connect(lpOwner).transferOwnership(poolOwner.address);
    await lp.connect(lpOwner).transferOwnership(poolOwner.address);

    await lp.connect(poolOwner).updateRole(oracle.address, 0 /*0 - ORACLE*/, true);
    await lp.connect(poolOwner).changeFee(0, daoFee);
    await lp.connect(poolOwner).changeFee(1, dataProviderFee);
    await lp.connect(poolOwner).changeFee(2, affiliateFee);
    await lp.connect(poolOwner).changeReinforcementAbility(MULTIPLIER);

    wxDAI = await WXDAI.attach(lp.token());
  } else {
    // Test wrapped xDAI
    wxDAI = await WXDAI.deploy();
    await wxDAI.deployed();

    // Contracts
    const contracts = await deployContracts(ethers, factoryOwner);

    // Pool Factory
    factory = await createFactory(
      ethers,
      factoryOwner,
      contracts.beaconAccess,
      contracts.beaconLP,
      contracts.beaconPrematchCore,
      contracts.beaconAzuroBet
    );

    ({ affiliateHelper } = contracts);
    // Pool
    ({ access, lp, core, azuroBet } = await createPool(
      ethers,
      factory,
      affiliateHelper,
      poolOwner,
      wxDAI.address,
      minDepo,
      daoFee,
      dataProviderFee,
      affiliateFee
    ));
  }

  // setting up
  const roleIds = await prepareRoles(access, poolOwner, lp, core);
  await lp.connect(poolOwner).changeDataProvider(dataProvider.address);

  await poolOwner.sendTransaction({ to: wxDAI.address, value: mintableAmount });
  await bettor.sendTransaction({ to: wxDAI.address, value: mintableAmount });
  return {
    factory,
    access,
    lp,
    core,
    azuroBet,
    wxDAI,
    affiliateHelper,
    roleIds,
  };
};

const prepareStand = async (
  ethers,
  factoryOwner,
  poolOwner,
  dataProvider,
  bettor,
  minDepo,
  daoFee,
  dataProviderFee,
  affiliateFee,
  liquidity
) => {
  let stand = await prepareEmptyStand(
    ethers,
    factoryOwner,
    poolOwner,
    dataProvider,
    bettor,
    minDepo,
    daoFee,
    dataProviderFee,
    affiliateFee
  );
  const approveAmount = tokens(999_999_999_999_999);
  await stand.wxDAI.connect(poolOwner).approve(stand.lp.address, approveAmount);
  await stand.wxDAI.connect(bettor).approve(stand.lp.address, approveAmount);

  stand["lpnft"] = await getLPNFTToken(await stand.lp.connect(poolOwner).addLiquidity(liquidity));

  return stand;
};

const prepareStandNativeLiquidity = async (
  ethers,
  factoryOwner,
  poolOwner,
  dataProvider,
  bettor,
  minDepo,
  daoFee,
  dataProviderFee,
  affiliateFee,
  liquidity
) => {
  let stand = await prepareEmptyStand(
    ethers,
    factoryOwner,
    poolOwner,
    dataProvider,
    bettor,
    minDepo,
    daoFee,
    dataProviderFee,
    affiliateFee
  );

  stand["lpnft"] = await getLPNFTToken(await stand.lp.connect(poolOwner).addLiquidityNative({ value: liquidity }));

  return stand;
};

const prepareRoles = async (access, poolOwner, lp, core) => {
  const oracleRoleId = await addRole(access, poolOwner, "Oracle");
  const maintainerRoleId = await addRole(access, poolOwner, "Maintainer");
  const oddsManagerRoleId = await addRole(access, poolOwner, "OddsManager");
  const rolesData = [
    { target: lp.address, selector: "0x69958ab9", roleId: oracleRoleId }, // cancelGame
    { target: lp.address, selector: "0x0c6b6b7a", roleId: oracleRoleId }, // createGame
    { target: lp.address, selector: "0xa8822061", roleId: oracleRoleId }, // shiftGame
    { target: core.address, selector: "0xbc4925fc", roleId: oracleRoleId }, // cancelCondition
    { target: core.address, selector: "0x8ea8c308", roleId: oracleRoleId }, // changeOdds
    { target: core.address, selector: "0xc6600c7c", roleId: oracleRoleId }, // createCondition
    { target: core.address, selector: "0xbc4925fc", roleId: maintainerRoleId }, // cancelCondition
    { target: core.address, selector: "0x6fea02f0", roleId: maintainerRoleId }, // stopCondition
    { target: core.address, selector: "0x8ea8c308", roleId: oddsManagerRoleId }, // changeOdds
  ];
  await bindRoles(access, poolOwner, rolesData);

  return { oracle: oracleRoleId, maintainer: maintainerRoleId, oddsManager: oddsManagerRoleId };
};

const prepareFreeBetRoles = async (access, freebet, poolOwner) => {
  const freebetManagerRoleId = await addRole(access, poolOwner, "FreeBetManager");
  const rolesData = [
    { target: freebet.address, selector: "0x95c25200", roleId: freebetManagerRoleId }, // mint
    { target: freebet.address, selector: "0x4aaf7d9e", roleId: freebetManagerRoleId }, // mintBatch
    { target: freebet.address, selector: "0x69c6e9e4", roleId: freebetManagerRoleId }, // withdrawReserve
    { target: freebet.address, selector: "0xbf64c51a", roleId: freebetManagerRoleId }, // withdrawReserveNative
  ];
  await bindRoles(access, poolOwner, rolesData);

  return freebetManagerRoleId;
};

const prepareAccess = async (access, poolOwner, oracle, oracle2, maintainer, roleIds) => {
  await grantRole(access, poolOwner, oracle, roleIds.oracle);
  await grantRole(access, poolOwner, oracle2, roleIds.oracle);
  await grantRole(access, poolOwner, maintainer, roleIds.maintainer);
  await grantRole(access, poolOwner, maintainer, roleIds.oddsManager);
};

const getRoleAddedDetails = async (txAdd) => {
  let eAdd = (await txAdd.wait()).events.filter((x) => {
    return x.event == "RoleAdded";
  });
  return { role: eAdd[0].args.role, roleId: eAdd[0].args.roleId };
};

const getTransferredNFTId = async (access, tx) => {
  const receipt = await tx.wait();
  let iface = new ethers.utils.Interface(
    access.interface.format(ethers.utils.FormatTypes.full).filter((x) => {
      return x.includes("Transfer");
    })
  );
  let log = iface.parseLog(receipt.logs[0]);
  return log.args.tokenId;
};

const addRole = async (access, owner, roleName) => {
  let txAdd = await access.connect(owner).addRole(roleName);
  let res = await getRoleAddedDetails(txAdd);
  return res.roleId;
};

const bindRoles = async (access, owner, rolesData) => {
  await access.connect(owner).bindRoles(rolesData);
};

const grantRole = async (access, owner, account, roleId) => {
  const txGrant = await access.connect(owner).grantRole(account, roleId);
  return getTransferredNFTId(access, txGrant);
};

const calcGas = (receipt) => {
  return receipt.effectiveGasPrice.mul(receipt.cumulativeGasUsed);
};

const createGame = async (lp, oracle, oracleGameId, ipfsHashHex, time) => {
  await lp.connect(oracle).createGame(oracleGameId, ipfsHashHex, time);
};

const createCondition = async (core, oracle, gameId, oracleCondId, pools, outcomes, reinforcement, margin) => {
  await core.connect(oracle).createCondition(gameId, oracleCondId, pools, outcomes, reinforcement, margin);
};

const encodeBetData = (condIDHash, outcome, minrate) => {
  return ethers.utils.defaultAbiCoder.encode(
    ["tuple(uint256 conditionId, uint64 outcomeId, uint64 minOdds)"],
    [{ conditionId: condIDHash, outcomeId: outcome, minOdds: minrate }]
  );
};

const makeAddLiquidityNative = async (lp, account, amount) => {
  let txAdd = await lp.connect(account).addLiquidityNative({ value: BigNumber.from(amount) });
  let res = await getLPNFTTokenDetails(txAdd);
  return [res.tokenId, res.gasUsed, res.account, res.amount];
};

const makeBetNativeGetTokenId = async (
  lp,
  core,
  account,
  affiliate,
  condIDHash,
  betAmount,
  outcome,
  deadline,
  minrate
) => {
  let txBet = await lp.connect(account).betNative(
    core.address,
    deadline,
    {
      affiliate: affiliate,
      data: encodeBetData(condIDHash, outcome, minrate),
    },
    {
      value: BigNumber.from(betAmount),
    }
  );
  let res = await getTokenIdDetails(core, txBet);
  return [res.tokenId, res.odds, res.gasUsed, res.account];
};

const makeBetGetTokenId = async (lp, core, account, affiliate, condIDHash, betAmount, outcome, deadline, minrate) => {
  let txBet = await lp.connect(account).bet(core.address, betAmount, deadline, {
    affiliate: affiliate,
    data: encodeBetData(condIDHash, outcome, minrate),
  });
  let res = await getTokenId(core, txBet);
  return res;
};

const makeBetGetTokenIdOdds = async (
  lp,
  core,
  account,
  affiliate,
  condIDHash,
  betAmount,
  outcome,
  deadline,
  minrate
) => {
  let txBet = await lp.connect(account).bet(core.address, betAmount, deadline, {
    affiliate: affiliate,
    data: encodeBetData(condIDHash, outcome, minrate),
  });
  let res = await getTokenIdOdds(core, txBet);
  return { tokenId: res.tokenId, odds: res.odds };
};

const makeWithdrawLiquidity = async (lp, account, lpnft, percent) => {
  let txWithdraw = await lp.connect(account).withdrawLiquidityNative(lpnft, percent, false);
  let res = await getWithdrawLiquidityDetails(txWithdraw);
  return [res.amount, res.gasUsed, res.account];
};

const makeWithdrawLiquidityNative = async (lp, account, lpnft, percent) => {
  let txWithdraw = await lp.connect(account).withdrawLiquidity(lpnft, percent, true);
  let res = await getWithdrawLiquidityDetails(txWithdraw);
  return [res.amount, res.gasUsed, res.account];
};

const makeWithdrawPayout = async (lp, core, account, tokenId) => {
  let txPayOut = await lp.connect(account).withdrawPayout(core.address, tokenId, false);
  let res = await getWithdrawPayoutDetails(txPayOut);
  return [res.amount, res.gasUsed, res.account];
};

const makeWithdrawPayoutNative = async (lp, core, account, tokenId) => {
  let txPayOut = await lp.connect(account).withdrawPayout(core.address, tokenId, true);
  let res = await getWithdrawPayoutDetails(txPayOut);
  return [res.amount, res.gasUsed, res.account];
};

const claimAffiliateReward = async (lp, affiliate, core, dataParam) => {
  let tx = await lp["claimAffiliateRewardFor(address,bytes,address)"](core.address, dataParam, affiliate.address);
  let res = await getClaimAffiliateRewardDetails(tx);
  return { affiliate: res.affiliate, amount: res.amount };
};

const getClaimParams = (start, count) => {
  return abiCoder.encode(
    ["tuple(uint256 start,uint256 count) affiliateParams"],
    [
      {
        start: start,
        count: count,
      },
    ]
  );
};

const getClaimParamsDef = () => {
  return getClaimParams(0, 0);
};

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

const switchCore = async (lp, core, poolOwner, active) => {
  const coreData = await lp.cores(core.address);
  const state = active ? 1 : 2;
  if (coreData.state != state) {
    await lp.connect(poolOwner).updateCoreSettings(core.address, state, coreData.reinforcementAbility, coreData.minBet);
  }
};

const changeReinforcementAbility = async (lp, core, poolOwner, reinforcementAbility) => {
  const coreData = await lp.cores(core.address);
  if (!coreData.reinforcementAbility.eq(reinforcementAbility)) {
    await lp.connect(poolOwner).updateCoreSettings(core.address, coreData.state, reinforcementAbility, coreData.minBet);
  }
};

const changeMinBet = async (lp, core, poolOwner, minBet) => {
  const coreData = await lp.cores(core.address);
  if (!coreData.minBet.eq(minBet)) {
    await lp.connect(poolOwner).updateCoreSettings(core.address, coreData.state, coreData.reinforcementAbility, minBet);
  }
};

module.exports = {
  getBlockTime,
  getTimeout,
  timeShift,
  timeShiftBy,
  tokens,
  getTokenId,
  getTokenIdOdds,
  getTokenIdDetails,
  getWithdrawLiquidityDetails,
  getWithdrawPayoutDetails,
  getLPNFTToken,
  getWinthdrawnAmount,
  getWithdrawPayoutDetails,
  getLPNFTTokenDetails,
  getPluggedCore,
  getCreatePoolDetails,
  deployContracts,
  createFactory,
  createPool,
  prepareStand,
  prepareStandNativeLiquidity,
  prepareEmptyStand,
  addRole,
  bindRoles,
  grantRole,
  prepareRoles,
  prepareFreeBetRoles,
  prepareAccess,
  calcGas,
  createGame,
  createCondition,
  encodeBetData,
  makeAddLiquidityNative,
  makeBetNativeGetTokenId,
  makeBetGetTokenId,
  makeBetGetTokenIdOdds,
  makeWithdrawPayout,
  makeWithdrawPayoutNative,
  makeWithdrawLiquidity,
  makeWithdrawLiquidityNative,
  plugExpress,
  claimAffiliateReward,
  getClaimParams,
  getClaimParamsDef,
  initFixtureTree,
  switchCore,
  changeReinforcementAbility,
  changeMinBet,
};
