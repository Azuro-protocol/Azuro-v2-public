const hre = require("hardhat");
const { ethers } = require("hardhat");
const { addRole, bindRoles, grantRole } = require("../utils/utils");

const LP_ADDRESS = process.env.LP_ADDRESS;
const ACCESS_ADDRESS = process.env.ACCESS_ADDRESS;
const CREATE_MASTER = process.env.CREATE_MASTER;
const RESOLVE_MASTER = process.env.RESOLVE_MASTER;
const CANCEL_MASTER = process.env.CANCEL_MASTER;
const SHIFT_MASTER = process.env.SHIFT_MASTER;
const STOP_MASTER = process.env.STOP_MASTER;
const ODDS_MASTER = process.env.ODDS_MASTER;
const MARGIN_MASTER = process.env.MARGIN_MASTER;
const REINFORCEMENT_MASTER = process.env.REINFORCEMENT_MASTER;

async function main() {
  const [deployer] = await ethers.getSigners();

  const Access = await ethers.getContractFactory("Access");
  const access = await upgrades.deployProxy(Access);

  const ProxyOracle = await ethers.getContractFactory("ProxyOracle");
  const proxyOracle = await upgrades.deployProxy(ProxyOracle, [access.address, LP_ADDRESS]);

  const lpAccess = await Access.attach(ACCESS_ADDRESS);
  for (let roleId = 0; roleId < 5; ++roleId) {
    await grantRole(lpAccess, deployer, proxyOracle.address, roleId);
  }

  console.log("* ProxyOracle *");
  console.log("\nACCESS:", access.address);
  console.log("PROXY_ORACLE:", proxyOracle.address);

  console.log("\nProxyOracle Access roles prepared:");
  const createRoleId = await addRole(access, deployer, "CreateMaster");
  console.log("Create Master:", createRoleId.toString());

  const resolveRoleId = await addRole(access, deployer, "ResolveMaster");
  console.log("Resolve Master:", resolveRoleId.toString());

  const cancelRoleId = await addRole(access, deployer, "CancelMaster");
  console.log("Cancel Master:", cancelRoleId.toString());

  const shiftRoleId = await addRole(access, deployer, "ShiftMaster");
  console.log("Shift Master:", shiftRoleId.toString());

  const stopRoleId = await addRole(access, deployer, "StopMaster");
  console.log("Stop Master:", stopRoleId.toString());

  const oddsRoleId = await addRole(access, deployer, "OddsMaster");
  console.log("Odds Master:", oddsRoleId.toString());

  const marginRoleId = await addRole(access, deployer, "MarginMaster");
  console.log("Margin Master:", marginRoleId.toString());

  const reinforcementRoleId = await addRole(access, deployer, "ReinforcementMaster");
  console.log("Reinforcement Master:", reinforcementRoleId.toString());

  const rolesData = [
    { target: proxyOracle.address, selector: "0xd58cf784", roleId: createRoleId }, // createGames
    { target: proxyOracle.address, selector: "0x32823bc8", roleId: createRoleId }, // createConditions
    { target: proxyOracle.address, selector: "0xd9d0f338", roleId: resolveRoleId }, // resolveCondition
    { target: proxyOracle.address, selector: "0xf3897bfd", roleId: cancelRoleId }, // cancelGames
    { target: proxyOracle.address, selector: "0x829b9682", roleId: cancelRoleId }, // cancelConditions
    { target: proxyOracle.address, selector: "0x954093c4", roleId: shiftRoleId }, // shiftGames
    { target: proxyOracle.address, selector: "0xa7d2cc49", roleId: stopRoleId }, // stopConditions
    { target: proxyOracle.address, selector: "0x91e65804", roleId: oddsRoleId }, // changeOdds
    { target: proxyOracle.address, selector: "0xbe918c6b", roleId: marginRoleId }, // changeMargins
    { target: proxyOracle.address, selector: "0x7cfccc25", roleId: reinforcementRoleId }, // changeReinforcements
  ];

  await bindRoles(access, deployer, rolesData);

  await grantRole(access, deployer, CREATE_MASTER, createRoleId);
  console.log("\nCREATE MASTERS: ['%s']", CREATE_MASTER);

  await grantRole(access, deployer, RESOLVE_MASTER, resolveRoleId);
  console.log("RESOLVE MASTERS: ['%s']", RESOLVE_MASTER);

  await grantRole(access, deployer, CANCEL_MASTER, cancelRoleId);
  console.log("CANCEL MASTERS: ['%s']", CANCEL_MASTER);

  await grantRole(access, deployer, SHIFT_MASTER, shiftRoleId);
  console.log("SHIFT MASTERS: ['%s']", SHIFT_MASTER);

  await grantRole(access, deployer, STOP_MASTER, stopRoleId);
  console.log("STOP MASTERS: ['%s']", STOP_MASTER);

  await grantRole(access, deployer, ODDS_MASTER, oddsRoleId);
  console.log("ODDS MASTERS: ['%s']", ODDS_MASTER);

  await grantRole(access, deployer, MARGIN_MASTER, marginRoleId);
  console.log("MARGIN MASTERS: ['%s']", MARGIN_MASTER);

  await grantRole(access, deployer, REINFORCEMENT_MASTER, reinforcementRoleId);
  console.log("REINFORCEMENT MASTERS: ['%s']", REINFORCEMENT_MASTER);

  try {
    await hre.run("verify:verify", {
      address: access.address,
      constructorArguments: [],
    });
  } catch (err) {}
  try {
    await hre.run("verify:verify", {
      address: proxyOracle.address,
      constructorArguments: [],
    });
  } catch (err) {}
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
