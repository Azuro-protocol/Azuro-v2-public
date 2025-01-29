const { ethers, upgrades } = require("hardhat");
const hre = require("hardhat");
const { getTimeout } = require("../utils/utils");

async function main() {
  const [deployer] = await ethers.getSigners();

  // ........................ ENV ENV ENV ................
  const TOKEN_ADDRESS = process.env.TOKEN_ADDRESS;
  const CASHOUT_ORACLE = process.env.CASHOUT_ORACLE;
  const CORE_ADDRESS = process.env.CORE_ADDRESS;
  const CORE_AZURO_BET = process.env.CORE_AZURO_BET;
  const EXPRESS_ADDRESS = process.env.EXPRESS_ADDRESS;
  // ........................ ENV ENV ENV ................

  let summary = {};

  console.log("Deployer wallet:", deployer.address);
  console.log("Deployer balance:", (await deployer.getBalance()).toString());

  const chainId = await hre.network.provider.send("eth_chainId");
  const timeout = getTimeout(chainId);

  // Prepare CashOut
  const CASHOUT = await ethers.getContractFactory("CashOut", { signer: deployer });
  const cashOut = await upgrades.deployProxy(CASHOUT, [TOKEN_ADDRESS]);
  await timeout();
  summary["CASHOUT"] = cashOut.address;
  summary["TOKEN"] = TOKEN_ADDRESS;
  await cashOut.updateOracle(CASHOUT_ORACLE, true);
  await timeout();
  summary["ORACLE"] = CASHOUT_ORACLE;
  await cashOut.updateBettingContract(CORE_ADDRESS, CORE_AZURO_BET);
  await timeout();
  summary["CORE"] = CORE_ADDRESS + " azurobet: " + CORE_AZURO_BET;
  await cashOut.updateBettingContract(EXPRESS_ADDRESS, EXPRESS_ADDRESS);
  await timeout();
  summary["EXPRESS"] = EXPRESS_ADDRESS + " azurobet: " + EXPRESS_ADDRESS;

  console.log("\nCashOut settings:", JSON.stringify(summary));

  try {
    await hre.run("verify:verify", {
      address: cashOut.address,
      constructorArguments: [],
    });
  } catch (err) {}
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
