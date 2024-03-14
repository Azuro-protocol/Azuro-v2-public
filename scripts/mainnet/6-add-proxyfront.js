const { ethers } = require("hardhat");
const hre = require("hardhat");
const { getTimeout } = require("../../utils/utils");

async function main() {
  const chainId = await hre.network.provider.send("eth_chainId");
  const timeout = getTimeout(chainId);

  const [deployer] = await ethers.getSigners();
  console.log("Deployer wallet:", deployer.address);

  const ProxyFront = await ethers.getContractFactory("ProxyFront");
  let proxyFront = await upgrades.deployProxy(ProxyFront);
  await timeout();
  await proxyFront.deployed();
  await timeout();

  const proxyFrontImplAddress = await upgrades.erc1967.getImplementationAddress(proxyFront.address);

  console.log("* ProxyFront *");
  console.log("ProxyFront proxy:", proxyFront.address);
  console.log("ProxyFront Implementation:", proxyFrontImplAddress);

  // Verification
  if (chainId != 0x7a69) {
    try {
      await hre.run("verify:verify", {
        address: await proxyFrontImplAddress,
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
