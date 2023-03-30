const { ethers, network } = require("hardhat");
const { getTimeout } = require("../../utils/utils");

async function main() {
  const [deployer] = await ethers.getSigners();
  const chainId = await network.provider.send("eth_chainId");
  const timeout = getTimeout(chainId);

  console.log("Deployer wallet: ", deployer.address);
  console.log("Deployer balance:", (await deployer.getBalance()).toString());

  const PrematchCore = await ethers.getContractFactory("PrematchCore", {
    libraries: {
      AffiliateHelper: process.env.AFFILIATEHELPER_ADDRESS,
    },
    unsafeAllowCustomTypes: true,
  });
  const beaconAddress = process.env.BEACON_CORE_ADDRESS;
  console.log("PrematchCore beacon:", beaconAddress);

  let coreImplAddress;
  if (process.env.USE_MULTISIG === "YES") {
    console.log("Preparing proposal...");
    const proposal = await defender.proposeUpgrade(beaconAddress, PrematchCore);
    console.log("PrematchCore upgrade proposal created at:", proposal.url);

    coreImplAddress = proposal.metadata.newImplementationAddress;
  } else {
    console.log("Upgrading PrematchCore beacon...");
    const core = await upgrades.upgradeBeacon(beaconAddress, PrematchCore, { unsafeAllowLinkedLibraries: true });

    coreImplAddress = await core.implementation();
  }
  await timeout();
  console.log("New PrematchCore beacon implementation:", coreImplAddress);

  // verify
  if (chainId != 0x7a69) {
    await timeout();
    await hre.run("verify:verify", {
      address: coreImplAddress,
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
