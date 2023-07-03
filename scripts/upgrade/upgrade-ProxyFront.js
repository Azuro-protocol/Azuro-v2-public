const { ethers, network } = require("hardhat");
const { getTimeout } = require("../../utils/utils");

async function main() {
  const [deployer] = await ethers.getSigners();
  const chainId = await network.provider.send("eth_chainId");
  const timeout = getTimeout(chainId);

  console.log("Deployer wallet: ", deployer.address);
  console.log("Deployer balance:", (await deployer.getBalance()).toString());

  const PROXYFRONT = await ethers.getContractFactory("ProxyFront");
  const ProxyFrontAddress = process.env.PROXYFRONT_ADDRESS;
  console.log("PROXYFRONT proxy:", ProxyFrontAddress);
  
  console.log("Upgrading PROXYFRONT proxy...");
  const proxyFront = await upgrades.upgradeProxy(ProxyFrontAddress, PROXYFRONT);
  await timeout()

  let proxyFrontImplAddress = upgrades.erc1967.getImplementationAddress(proxyFront.address);
  await timeout();

  console.log("New PROXYFRONT implementation:", proxyFrontImplAddress);

  // verify
  if (chainId != 0x7a69) {
    await timeout();
    await hre.run("verify:verify", {
      address: proxyFrontImplAddress,
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
