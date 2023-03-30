const { ethers, network } = require("hardhat");
const { getTimeout } = require("../../utils/utils");

async function main() {
  const [deployer] = await ethers.getSigners();
  const chainId = await network.provider.send("eth_chainId");
  const timeout = getTimeout(chainId);

  console.log("Deployer wallet: ", deployer.address);
  console.log("Deployer balance:", (await deployer.getBalance()).toString());

  const AzuroBet = await ethers.getContractFactory("AzuroBet");
  const beaconAddress = process.env.BEACON_AZUROBET_ADDRESS;
  console.log("AzuroBet beacon:", beaconAddress);

  let azuroBetImplAddress;
  if (process.env.USE_MULTISIG === "YES") {
    console.log("Preparing proposal...");
    const proposal = await defender.proposeUpgrade(beaconAddress, AzuroBet);
    console.log("AzuroBet upgrade proposal created at:", proposal.url);

    azuroBetImplAddress = proposal.metadata.newImplementationAddress;
  } else {
    console.log("Upgrading AzuroBet beacon...");
    const azuroBet = await upgrades.upgradeBeacon(beaconAddress, AzuroBet);

    azuroBetImplAddress = await azuroBet.implementation();
  }
  await timeout();
  console.log("New AzuroBet beacon implementation:", azuroBetImplAddress);

  // verify
  if (chainId != 0x7a69) {
    await timeout();
    await hre.run("verify:verify", {
      address: azuroBetImplAddress,
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
