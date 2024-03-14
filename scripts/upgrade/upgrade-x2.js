const { ethers, network } = require("hardhat");
const { getTimeout } = require("../../utils/utils");

async function main() {
  const chainId = await network.provider.send("eth_chainId");
  const timeout = getTimeout(chainId);
  const [deployer] = await ethers.getSigners();

  const BEACON_X2_ADDRESS = process.env.BEACON_X2_ADDRESS;

  console.log("Deployer wallet: ", deployer.address);
  console.log("Deployer balance:", (await deployer.getBalance()).toString());
  console.log("upgrade beacon:", BEACON_X2_ADDRESS);

  const X2OrNothing = await ethers.getContractFactory("X2OrNothing");
  await timeout();

  let x2OrNothingImplAddress;
  if (process.env.USE_MULTISIG === "YES") {
    console.log("MULTISIG");
    // beacon upgrade can't be proposed
    x2OrNothingImplAddress = await upgrades.prepareUpgrade(BEACON_X2_ADDRESS, X2OrNothing);
  } else {
    const x2OrNothing = await upgrades.upgradeBeacon(BEACON_X2_ADDRESS, X2OrNothing);
    await timeout();

    x2OrNothingImplAddress = await x2OrNothing.implementation();
  }
  console.log("x2OrNothingImplAddress: ", x2OrNothingImplAddress);
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
