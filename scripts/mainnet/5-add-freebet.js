const { ethers } = require("hardhat");
const hre = require("hardhat");
const { getTimeout, prepareFreeBetRoles, grantRole } = require("../../utils/utils");

async function main() {
  const TOKEN_ADDRESS = process.env.TOKEN_ADDRESS;
  const LP_ADDRESS = process.env.LP_ADDRESS;
  const FREEBET_MANAGERS = JSON.parse(process.env.FREEBET_MANAGERS ?? "[]");

  const ACCESS_ADDRESS = process.env.ACCESS_ADDRESS;
  const chainId = await hre.network.provider.send("eth_chainId");
  const timeout = getTimeout(chainId);

  const [deployer] = await ethers.getSigners();

  const Access = await ethers.getContractFactory("Access");
  let access = await Access.attach(ACCESS_ADDRESS);

  const FreeBet = await ethers.getContractFactory("FreeBet");
  const freeBet = await upgrades.deployProxy(FreeBet, [TOKEN_ADDRESS], { useDeployedImplementation: false });
  await timeout();
  await freeBet.deployed();
  await freeBet.setLp(LP_ADDRESS);
  await timeout();

  console.log(
    "\nACCESS:",
    access.address,
    "\nLP:",
    LP_ADDRESS,
    "\nFREEBET:",
    freeBet.address,
    "\nTOKEN:",
    TOKEN_ADDRESS
  );

  const freeBetRoleId = await prepareFreeBetRoles(access, freeBet, deployer);
  console.log(`\nAccess roles prepared:\n- FreeBet Manager:`, freeBetRoleId.toString());

  for (const iterator of FREEBET_MANAGERS.keys()) {
    await timeout();
    await grantRole(access, deployer, FREEBET_MANAGERS[iterator], freeBetRoleId);
  }
  console.log("FREEBET MANAGERS:", FREEBET_MANAGERS);
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
