const { ethers, upgrades } = require("hardhat");
const hre = require("hardhat");
const { getTimeout } = require("../../utils/utils");

async function main() {
  const [deployer] = await ethers.getSigners();

  let summary = {};

  console.log("Deployer wallet:", deployer.address);

  const chainId = await hre.network.provider.send("eth_chainId");
  const timeout = getTimeout(chainId);

  // Access beacon
  console.log("deploy beacon Access...");
  const ACCESS = await ethers.getContractFactory("Access", { signer: deployer });
  const beaconAccess = await upgrades.deployBeacon(ACCESS);
  await beaconAccess.deployed();
  await timeout();

  // AzuroBet beacon
  console.log("deploy beacon AzuroBet...");
  const AZUROBET = await ethers.getContractFactory("AzuroBet", { signer: deployer });
  const beaconAzuroBet = await upgrades.deployBeacon(AZUROBET);
  await beaconAzuroBet.deployed();
  await timeout();

  // LP beacon
  console.log("deploy beacon LP...");
  const LP = await ethers.getContractFactory("LP", { signer: deployer });
  const beaconLP = await upgrades.deployBeacon(LP);
  await beaconLP.deployed();
  await timeout();

  // silence linked library proxy deploy warning:
  // Warning: Potentially unsafe deployment of PrematchCore
  //  You are using the `unsafeAllow.external-library-linking` flag to include external libraries.
  //  Make sure you have manually checked that the linked libraries are upgrade safe.
  upgrades.silenceWarnings();

  // Affiliate helper library
  console.log("deploy AffiliateHelper...");
  const AffiliateHelper = await ethers.getContractFactory("AffiliateHelper");
  const affiliateHelper = await AffiliateHelper.deploy();
  await affiliateHelper.deployed();
  await timeout();

  // Pre-match core beacon
  console.log("deploy beacon PrematchCore...");
  const PrematchCore = await ethers.getContractFactory("PrematchCore", {
    signer: deployer,
    libraries: {
      AffiliateHelper: affiliateHelper.address,
    },
    unsafeAllowCustomTypes: true,
  });
  const beaconPrematchCore = await upgrades.deployBeacon(PrematchCore, { unsafeAllowLinkedLibraries: true });
  await beaconPrematchCore.deployed();
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

  // Pool Factory
  const Factory = await ethers.getContractFactory("Factory", { signer: deployer });
  const factory = await upgrades.deployProxy(Factory, [beaconAccess.address, beaconLP.address]);
  await timeout();

  // setting up
  console.log("updatePrematchCoreType for pre-match...");
  await factory.updatePrematchCoreType("pre-match", beaconPrematchCore.address, beaconAzuroBet.address);
  await timeout();

  const factoryImplAddress = await upgrades.erc1967.getImplementationAddress(factory.address);

  summary["factory"] = factory.address;
  console.log("\nfactory", factory.address, "\nfactoryImpl", factoryImplAddress);

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
