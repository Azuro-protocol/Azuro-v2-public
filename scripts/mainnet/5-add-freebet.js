const { ethers } = require("hardhat");
const hre = require("hardhat");
const { getTimeout } = require("../../utils/utils");

async function main() {
  const TOKEN_ADDRESS = process.env.TOKEN_ADDRESS;
  const LP_ADDRESS = process.env.LP_ADDRESS;
  const FREEBET_MANAGER = process.env.FREEBET_MANAGER;

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
  await freeBet.setLp(LP_ADDRESS);
  await timeout();
  console.log("FREEBET MANAGER:", FREEBET_MANAGER);

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
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
