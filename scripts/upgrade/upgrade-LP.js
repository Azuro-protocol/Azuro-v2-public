const { ethers, network } = require("hardhat");
const { getTimeout } = require("../../utils/utils");

async function main() {
  const [deployer] = await ethers.getSigners();
  const chainId = await network.provider.send("eth_chainId");
  const timeout = getTimeout(chainId);

  console.log("Deployer wallet: ", deployer.address);
  console.log("Deployer balance:", (await deployer.getBalance()).toString());

  const LP = await ethers.getContractFactory("LP");
  const beaconAddress = process.env.BEACON_LP_ADDRESS;
  console.log("LP beacon:", beaconAddress);

  let lpImplAddress;
  if (process.env.USE_MULTISIG === "YES") {
    console.log("Preparing proposal...");
    const proposal = await defender.proposeUpgrade(beaconAddress, LP);
    console.log("LP upgrade proposal created at:", proposal.url);

    lpImplAddress = proposal.metadata.newImplementationAddress;
  } else {
    console.log("Upgrading LP beacon...");
    const lp = await upgrades.upgradeBeacon(beaconAddress, LP);

    lpImplAddress = await lp.implementation();
  }
  await timeout();
  console.log("New LP beacon implementation:", lpImplAddress);

  // verify
  if (chainId != 0x7a69) {
    await timeout();
    await hre.run("verify:verify", {
      address: lpImplAddress,
      constructorArguments: [],
    });
  }
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
