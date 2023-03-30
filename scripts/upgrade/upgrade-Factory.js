const { ethers, network, upgrades } = require("hardhat");
const { getTimeout } = require("../../utils/utils");

async function main() {
  const [deployer] = await ethers.getSigners();
  const chainId = await network.provider.send("eth_chainId");
  const timeout = getTimeout(chainId);

  console.log("Deployer wallet: ", deployer.address);
  console.log("Deployer balance:", (await deployer.getBalance()).toString());

  const Factory = await ethers.getContractFactory("Factory");
  const factoryAddress = process.env.FACTORY_ADDRESS;
  console.log("Factory:", factoryAddress);

  let factoryImplAddress;
  if (process.env.USE_MULTISIG === "YES") {
    console.log("Preparing proposal...");
    const proposal = await defender.proposeUpgrade(factoryAddress, Factory);
    console.log("Factory upgrade proposal created at:", proposal.url);

    factoryImplAddress = proposal.metadata.newImplementationAddress;
  } else {
    console.log("Upgrading Factory...");
    const factory = await upgrades.upgradeProxy(factoryAddress, Factory);

    factoryImplAddress = await upgrades.erc1967.getImplementationAddress(factory.address);
  }
  await timeout();
  console.log("New Factory implementation:", factoryImplAddress);

  // verify
  if (chainId != 0x7a69) {
    await timeout();
    await hre.run("verify:verify", {
      address: factoryImplAddress,
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
