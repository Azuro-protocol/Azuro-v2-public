const { ethers } = require("hardhat");
const hre = require("hardhat");
const { getTimeout, plugExpress, changeReinforcementAbility, grantRole } = require("../utils/utils");

async function main() {
  const FACTORY_ADDRESS = process.env.FACTORY_ADDRESS ?? "";
  const ACCESS_ADDRESS = process.env.ACCESS_ADDRESS ?? "";
  const LP_ADDRESS = process.env.LP_ADDRESS ?? "";
  const CORE_ADDRESS = process.env.CORE_ADDRESS ?? "";
  const MAX_REINFORCEMENT = process.env.MAX_REINFORCEMENT;

  const MULTIPLIER = 1e12;

  const [poolOwner] = await ethers.getSigners();
  const factoryOwner = poolOwner;
  const deployer = poolOwner;
  const reinforcementAbility = MULTIPLIER * 0.2; // 20%

  let summary = {};

  console.log("Deployer wallet:", deployer.address);
  console.log("Deployer balance:", (await deployer.getBalance()).toString());

  const chainId = await hre.network.provider.send("eth_chainId");
  const timeout = getTimeout(chainId);

  const Factory = await ethers.getContractFactory("Factory");
  const factory = Factory.attach(FACTORY_ADDRESS);

  const LP = await ethers.getContractFactory("LP");
  const lp = LP.attach(LP_ADDRESS);

  const Access = await ethers.getContractFactory("Access");
  const access = Access.attach(ACCESS_ADDRESS);

  // Plug express core
  const { betExpress, beaconExpress } = await plugExpress(
    ethers,
    deployer,
    factoryOwner,
    factory,
    lp.address,
    CORE_ADDRESS,
    timeout
  );
  await timeout();
  summary["BetExpress"] = betExpress.address;

  // Set options
  await changeReinforcementAbility(lp, betExpress, poolOwner, reinforcementAbility);
  await timeout();
  await betExpress.connect(poolOwner).changeReinforcement(MAX_REINFORCEMENT);
  await timeout();

  summary["reinforcementAbility"] = reinforcementAbility;
  summary["maxReinforcement"] = MAX_REINFORCEMENT;

  // Allow express to change odds in core
  await grantRole(access, poolOwner, betExpress.address, 2);
  await timeout();
  console.log("OddsManager role granted");

  console.log("\nBetExpress settings:", JSON.stringify(summary));

  // Verification
  if (chainId != `0x7a69`) {
    try {
      await hre.run("verify:verify", {
        address: await beaconExpress.implementation(),
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
