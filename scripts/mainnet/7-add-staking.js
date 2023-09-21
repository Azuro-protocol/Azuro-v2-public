const { ethers } = require("hardhat");
const hre = require("hardhat");
const { getTimeout } = require("../../utils/utils");

// ENV ENV ENV ENV ENV ENV ENV ENV ENV ENV ENV ENV ENV
const STAKING_TOKEN = process.env.AZURO_TOKEN;
// ENV ENV ENV ENV ENV ENV ENV ENV ENV ENV ENV ENV ENV

const MULTIPLIER = 1e12;
const interestRate = MULTIPLIER * 0.08; // 8%

async function main() {
  const chainId = await hre.network.provider.send("eth_chainId");
  const timeout = getTimeout(chainId);

  const [deployer] = await ethers.getSigners();
  console.log("Deployer wallet:", deployer.address);

  const Staking = await ethers.getContractFactory("Staking");
  let staking = await upgrades.deployProxy(Staking, [STAKING_TOKEN, interestRate]);
  await timeout();
  await staking.deployed();
  await timeout();

  stakingImplAddress = await upgrades.erc1967.getImplementationAddress(staking.address);

  console.log("* Staking *");
  console.log("\nStaking:", staking.address);
  console.log("\nstaking token:", STAKING_TOKEN);
  console.log("\ninterestRate:", interestRate, "(", interestRate / MULTIPLIER, "%)");

  // Verification
  if (chainId != 0x7a69) {
    try {
      await hre.run("verify:verify", {
        address: stakingImplAddress,
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
