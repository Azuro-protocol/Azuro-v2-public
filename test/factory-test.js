const { expect } = require("chai");
const { ethers } = require("hardhat");
const {
  getBlockTime,
  tokens,
  createCondition,
  createGame,
  makeBetGetTokenId,
  makeWithdrawPayout,
  timeShift,
  getPluggedCore,
  getCreatePoolDetails,
  getClaimParamsDef,
  deployContracts,
  createFactory,
  createPool,
  prepareRoles,
  grantRole,
  switchCore,
} = require("../utils/utils");
const { MULTIPLIER } = require("../utils/constants");

const LIQUIDITY = tokens(200000);
const OUTCOMEWIN = 1;
const OUTCOMELOSE = 2;
const IPFS = ethers.utils.formatBytes32String("ipfs");

const ONE_HOUR = 3600;
const ONE_MINUTE = 60;

describe("Pool Factory test", function () {
  const reinforcement = tokens(20000);
  const marginality = MULTIPLIER * 0.05; // 5%

  const minDepo = tokens(10);
  const daoFee = MULTIPLIER * 0.09; // 9%
  const dataProviderFee = MULTIPLIER * 0.01; // 1%
  const affiliateFee = MULTIPLIER * 0.33; // 33%

  const pool1 = 5000000;
  const pool2 = 5000000;

  const betAmount = tokens(100);
  const approveAmount = tokens(999_999_999_999_999);

  let dao, poolOwner, dataProvider, oracle, oracle2, maintainer, affiliate, affiliate2, bettor;
  let Access, LP, PrematchCore, WXDAI;
  let factory, beaconAccess, beaconLP, beaconPrematchCore, beaconAzuroBet, access, core, affiliateHelper, wxDAI, lp;
  let time;

  let gameId = 0;
  let condId = 0;

  beforeEach(async function () {
    [dao, poolOwner, dataProvider, oracle, oracle2, maintainer, affiliate, affiliate2, bettor] =
      await ethers.getSigners();

    const contracts = await deployContracts(ethers, dao);
    ({ beaconAccess, beaconLP, beaconPrematchCore, beaconAzuroBet, affiliateHelper } = contracts);

    WXDAI = await ethers.getContractFactory("WETH9");
    wxDAI = await WXDAI.deploy();
    await wxDAI.deployed();
    await bettor.sendTransaction({ to: wxDAI.address, value: tokens(1_000_000) });

    Access = await ethers.getContractFactory("Access", { signer: poolOwner });

    LP = await ethers.getContractFactory("LP", { signer: poolOwner });

    PrematchCore = await ethers.getContractFactory("PrematchCore", {
      signer: poolOwner,
      libraries: {
        AffiliateHelper: affiliateHelper.address,
      },
      unsafeAllowCustomTypes: true,
    });

    factory = await createFactory(ethers, dao, beaconAccess, beaconLP, beaconPrematchCore, contracts.beaconAzuroBet);
  });
  it("Create new pool", async () => {
    // Create pool
    const txCreatePool = await factory
      .connect(poolOwner)
      .createPool(wxDAI.address, minDepo, daoFee, dataProviderFee, affiliateFee, "pre-match");

    const txDetails = await getCreatePoolDetails(txCreatePool);

    access = await Access.attach(txDetails.access);
    expect(await access.owner()).to.be.equals(poolOwner.address);

    lp = await LP.attach(txDetails.lp);
    expect(await lp.owner()).to.be.equals(poolOwner.address);

    core = await PrematchCore.attach(txDetails.core);
    expect(await core.owner()).to.be.equals(poolOwner.address);

    const roleIds = await prepareRoles(access, poolOwner, lp, core);
    await grantRole(access, poolOwner, oracle.address, roleIds.oracle);

    // Test created pool
    await wxDAI.connect(bettor).approve(lp.address, approveAmount);
    await lp.connect(bettor).addLiquidity(LIQUIDITY);

    time = await getBlockTime(ethers);
    await createGame(lp, oracle, ++gameId, IPFS, time + ONE_HOUR);

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
      betAmount,
      OUTCOMEWIN,
      time + 10,
      0
    );

    await expect(lp.connect(poolOwner).addCore(core.address)).to.be.revertedWithCustomError(lp, "OnlyFactory");

    await expect(switchCore(lp, core, bettor, false)).to.be.revertedWith("Ownable: account is not the owner");

    await timeShift(time + ONE_HOUR + ONE_MINUTE);
    await core.connect(oracle).resolveCondition(condId, OUTCOMEWIN);

    await makeWithdrawPayout(lp, core, bettor, tokenId);
    await switchCore(lp, core, poolOwner, false);

    time = await getBlockTime(ethers);
    await createGame(lp, oracle, ++gameId, IPFS, time + ONE_HOUR);

    await expect(
      createCondition(
        core,
        oracle,
        gameId,
        ++condId,
        [pool2, pool1],
        [OUTCOMEWIN, OUTCOMELOSE],
        reinforcement,
        marginality
      )
    ).to.be.revertedWithCustomError(lp, "CoreNotActive");
  });
  it("Create new pool and try to interact with it from another one", async () => {
    // Create pool
    const { core, lp } = await createPool(
      ethers,
      factory,
      affiliateHelper,
      poolOwner,
      wxDAI.address,
      minDepo,
      daoFee,
      dataProviderFee,
      affiliateFee,
      oracle.address
    );

    const pool2 = await createPool(
      ethers,
      factory,
      affiliateHelper,
      poolOwner,
      wxDAI.address,
      minDepo,
      daoFee,
      dataProviderFee,
      affiliateFee,
      oracle.address
    );

    await expect(switchCore(lp, pool2.core, poolOwner, false)).to.be.revertedWithCustomError(lp, "UnknownCore");
    await expect(switchCore(pool2.lp, core, poolOwner, false)).to.be.revertedWithCustomError(lp, "UnknownCore");

    await expect(
      lp.claimAffiliateRewardFor(pool2.core.address, getClaimParamsDef(), poolOwner.address)
    ).to.be.revertedWithCustomError(lp, "UnknownCore");
    await expect(
      pool2.lp.claimAffiliateRewardFor(core.address, getClaimParamsDef(), poolOwner.address)
    ).to.be.revertedWithCustomError(lp, "UnknownCore");

    await expect(
      lp.connect(poolOwner).updateCoreSettings(pool2.core.address, 1, MULTIPLIER, tokens(1))
    ).to.be.revertedWithCustomError(lp, "UnknownCore");
    await expect(
      pool2.lp.connect(poolOwner).updateCoreSettings(core.address, 1, MULTIPLIER, tokens(1))
    ).to.be.revertedWithCustomError(lp, "UnknownCore");

    await expect(lp.viewPayout(pool2.core.address, 12345)).to.be.revertedWithCustomError(lp, "UnknownCore");
    await expect(pool2.lp.viewPayout(core.address, 12345)).to.be.revertedWithCustomError(lp, "UnknownCore");
  });
  it("Create and plug to pool new core type", async () => {
    // Create pool
    ({ access, core, lp } = await createPool(
      ethers,
      factory,
      affiliateHelper,
      poolOwner,
      wxDAI.address,
      minDepo,
      daoFee,
      dataProviderFee,
      affiliateFee,
      oracle.address
    ));

    // Add new core type
    await expect(
      factory.connect(bettor).updateCoreType("custom", beaconPrematchCore.address, ethers.constants.AddressZero)
    ).to.be.revertedWith("Ownable: account is not the owner");
    await factory.connect(dao).updateCoreType("custom", beaconPrematchCore.address, beaconAzuroBet.address);

    // Plug new type PrematchCore to the pool
    await expect(factory.connect(poolOwner).plugCore(lp.address, "dummy")).to.be.revertedWithCustomError(
      factory,
      "UnknownCoreType"
    );
    await expect(factory.connect(dao).plugCore(lp.address, "custom")).to.be.revertedWith(
      "Ownable: account is not the owner"
    );
    await expect(factory.connect(poolOwner).plugCore(core.address, "custom")).to.be.revertedWithCustomError(
      factory,
      "UnknownLP"
    );
    await expect(factory.connect(poolOwner).plugCore(lp.address, "dummy")).to.be.revertedWithCustomError(
      factory,
      "UnknownCoreType"
    );
    const txPlugCore = await factory.connect(poolOwner).plugCore(lp.address, "custom");

    // Attach core
    core = await PrematchCore.attach(await getPluggedCore(txPlugCore));

    // Test new type core
    expect(await core.owner()).to.be.equals(poolOwner.address);
    expect(await core.lp()).to.be.equals(lp.address);

    // Disable added core type
    await factory.connect(dao).updateCoreType("custom", ethers.constants.AddressZero, beaconAzuroBet.address);
    await expect(factory.connect(poolOwner).plugCore(lp.address, "custom")).to.be.revertedWithCustomError(
      factory,
      "UnknownCoreType"
    );
  });
});
