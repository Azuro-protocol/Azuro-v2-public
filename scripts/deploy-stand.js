const { ethers, upgrades } = require("hardhat");
const hre = require("hardhat");
const {
  addLiquidity,
  tokens,
  getTimeout,
  deployContracts,
  createFactory,
  createPool,
  prepareRoles,
} = require("../utils/utils");

const TOKEN_ADDRESS = process.env.TOKEN_ADDRESS;

async function main() {
  const [deployer] = await ethers.getSigners();
  const oracle = deployer;
  const MULTIPLIER = 1e12;
  const daoFee = MULTIPLIER * 0.09; // 9%
  const dataProviderFee = MULTIPLIER * 0.01; // 1%

  let token, factory, beaconAccess, beaconLP, beaconPrematchCore, beaconLiveCore, beaconAzuroBet;
  let summary = {};

  console.log("Deployer wallet:", deployer.address);

  const chainId = await hre.network.provider.send("eth_chainId");
  const timeout = getTimeout(chainId);

  const Token = await ethers.getContractFactory("TestERC20");
  token = await Token.attach(TOKEN_ADDRESS);
  summary["token"] = TOKEN_ADDRESS;

  // Beacons
  {
    ({ beaconAccess, beaconLP, beaconPrematchCore, beaconLiveCore, beaconAzuroBet } = await deployContracts(
      ethers,
      deployer
    ));
    await timeout();

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
    factory = await createFactory(
      ethers,
      deployer,
      beaconAccess,
      beaconLP,
      beaconPrematchCore,
      beaconLiveCore,
      beaconAzuroBet
    );
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
        deployer,
        token.address,
        1,
        daoFee,
        dataProviderFee,
        oracle.address
      ));

      console.log(
        "\nACCESS:",
        access.address,
        "\nAZURO_BET:",
        azuroBet.address,
        "\nCORE:",
        core.address,
        "\nLP:",
        lp.address,
        "\n\nTOKEN:",
        token.address
      );
      summary[`pool ${i + 1}`] = {
        access: access.address,
        azuroBet: azuroBet.address,
        core: core.address,
        lp: lp.address,
      };

      // setting up
      const liquidity = tokens(100_000_000);
      await token.connect(deployer).approve(lp.address, liquidity);
      await timeout();
      const lpnft = await addLiquidity(lp, deployer, liquidity);
      await timeout();
      console.log("\nLiquidity added:", liquidity.toString(), "\nLPNFT:", lpnft);

      const roleIds = await prepareRoles(access, deployer, lp, core);
      console.log(
        `\nAccess roles prepared:\n- Oracle:`,
        roleIds.oracle.toString(),
        "\n- Maintainer:",
        roleIds.maintainer.toString(),
        "\n- Odds Manager:",
        roleIds.oddsManager.toString(),
        "\n- Margin Manager:",
        roleIds.marginManager.toString(),
        "\n- Reinforcement Manager:",
        roleIds.reinforcementManager.toString()
      );
    }
  }

  console.log("\nCONTRACTS FOR WEB APP:", JSON.stringify(summary));
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
