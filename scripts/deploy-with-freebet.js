const { ethers, upgrades } = require("hardhat");
const hre = require("hardhat");
const {
  tokens,
  getTimeout,
  deployContracts,
  createFactory,
  createPool,
  grantRole,
  prepareRoles,
  prepareFreeBetRoles,
  getLPNFTTokenDetails,
} = require("../utils/utils");

const TOKEN_ADDRESS = process.env.TOKEN_ADDRESS;
const ORACLES = JSON.parse(process.env.ORACLES ?? "[]");
const MAINTAINERS = JSON.parse(process.env.MAINTAINERS ?? "[]");
const ODDS_MANAGERS = JSON.parse(process.env.ODDS_MANAGERS ?? "[]");
const FREEBET_MANAGERS = JSON.parse(process.env.FREEBET_MANAGERS ?? "[]");

async function main() {
  const [deployer] = await ethers.getSigners();
  const oracle = deployer;
  const MULTIPLIER = 1e12;
  const daoFee = MULTIPLIER * 0.09; // 9%
  const dataProviderFee = MULTIPLIER * 0.01; // 1%
  const affiliateFee = MULTIPLIER * 0.33; // 33%

  let token, factory, beaconAccess, beaconLP, beaconPrematchCore, beaconAzuroBet, affiliateHelper;
  let summary = {};

  console.log("Deployer wallet:", deployer.address);

  const chainId = await hre.network.provider.send("eth_chainId");
  const timeout = getTimeout(chainId);

  const FreeBet = await ethers.getContractFactory("FreeBet");

  const Token = await ethers.getContractFactory("TestERC20");
  token = await Token.attach(TOKEN_ADDRESS);
  summary["token"] = TOKEN_ADDRESS;

  // Beacons
  {
    ({ beaconAccess, beaconLP, beaconPrematchCore, beaconAzuroBet, affiliateHelper } = await deployContracts(
      ethers,
      deployer
    ));
    await timeout();

    console.log("* Libraries *\nAffiliateHelper:", affiliateHelper.address);
    console.log(
      "\n* Beacons *\nAccess:",
      beaconAccess.address,
      "\nAzuroBet:",
      beaconAzuroBet.address,
      "\nPrematchCore:",
      beaconPrematchCore.address,
      "\nLP:",
      beaconLP.address
    );
    console.log(
      "\n* Beacon implementations *\nAccess:",
      await beaconAccess.implementation(),
      "\nAzuroBet:",
      await beaconAzuroBet.implementation(),
      "\nPrematchCore:",
      await beaconPrematchCore.implementation(),
      "\nLP:",
      await beaconLP.implementation()
    );
  }

  // Pool Factory
  {
    factory = await createFactory(ethers, deployer, beaconAccess, beaconLP, beaconPrematchCore, beaconAzuroBet);
    await timeout();
    const factoryImplAddress = await upgrades.erc1967.getImplementationAddress(factory.address);

    summary["factory"] = factory.address;
    console.log("\nfactory", factory.address, "\nfactoryImpl", factoryImplAddress);
  }

  // Pools
  {
    let access, core, lp, azuroBet;
    for (const i of Array(1).keys()) {
      console.log(`\n* Pool ${i + 1} *`);

      ({ access, core, lp, azuroBet } = await createPool(
        ethers,
        factory,
        affiliateHelper,
        deployer,
        token.address,
        1e19,
        daoFee,
        dataProviderFee,
        affiliateFee,
        oracle.address
      ));

      const freeBet = await upgrades.deployProxy(FreeBet, [TOKEN_ADDRESS], { useDeployedImplementation: false });
      await timeout();
      await freeBet.deployed();
      await freeBet.setLp(lp.address);

      console.log(
        "\nACCESS:",
        access.address,
        "\nAZURO_BET:",
        azuroBet.address,
        "\nCORE:",
        core.address,
        "\nLP:",
        lp.address,
        "\nFREEBET:",
        freeBet.address,
        "\nTOKEN:",
        token.address
      );
      summary[`pool ${i + 1}`] = {
        access: access.address,
        azuroBet: azuroBet.address,
        core: core.address,
        lp: lp.address,
        freeBet: freeBet.address,
      };

      // setting up
      const liquidity = tokens(100_000_000);
      await token.connect(deployer).approve(lp.address, liquidity);
      await timeout();
      const lpnft = await getLPNFTTokenDetails(await lp.connect(deployer).addLiquidity(liquidity));
      await timeout();
      console.log("Liquidity added:", lpnft.amount.toString(), "\nLPNFT:", lpnft.tokenId);

      const roleIds = await prepareRoles(access, deployer, lp, core);
      const freeBetRoleId = await prepareFreeBetRoles(access, freeBet, deployer);
      console.log(
        `\nAccess roles prepared:\n- Oracle:`,
        roleIds.oracle.toString(),
        "\n- Maintainer:",
        roleIds.maintainer.toString(),
        "\n- Odds Manager:",
        roleIds.oddsManager.toString(),
        "\n- FreeBet Manager:",
        freeBetRoleId.toString()
      );

      for (const iterator of ORACLES.keys()) {
        await grantRole(access, deployer, ORACLES[iterator], roleIds.oracle);
        await timeout();
      }
      console.log("\nORACLES:", ORACLES);

      for (const iterator of MAINTAINERS.keys()) {
        await grantRole(access, deployer, MAINTAINERS[iterator], roleIds.maintainer);
        await timeout();
      }
      console.log("MAINTAINERS:", MAINTAINERS);

      for (const iterator of ODDS_MANAGERS.keys()) {
        await grantRole(access, deployer, ODDS_MANAGERS[iterator], roleIds.oddsManager);
        await timeout();
      }
      console.log("ODDS MANAGERS:", ODDS_MANAGERS);

      for (const iterator of FREEBET_MANAGERS.keys()) {
        await grantRole(access, deployer, FREEBET_MANAGERS[iterator], freeBetRoleId);
        await timeout();
      }
      console.log("FREEBET MANAGERS:", FREEBET_MANAGERS);
    }
  }

  console.log("\nCONTRACTS FOR WEB APP:", JSON.stringify(summary));

  // Verification
  if (chainId != 0x7a69) {
    try {
      await hre.run("verify:verify", {
        address: factory.address,
        constructorArguments: [],
      });
    } catch (err) {}
    try {
      await hre.run("verify:verify", {
        address: await beaconAccess.implementation(),
        constructorArguments: [],
      });
    } catch (err) {}
    try {
      await hre.run("verify:verify", {
        address: await beaconLP.implementation(),
        constructorArguments: [],
      });
    } catch (err) {}
    try {
      await hre.run("verify:verify", {
        address: await beaconPrematchCore.implementation(),
        constructorArguments: [],
      });
    } catch (err) {}
    try {
      await hre.run("verify:verify", {
        address: await beaconAzuroBet.implementation(),
        constructorArguments: [],
      });
    } catch (err) {}
    try {
      await hre.run("verify:verify", {
        address: affiliateHelper.address,
        constructorArguments: [],
      });
    } catch (err) {}
  }
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
