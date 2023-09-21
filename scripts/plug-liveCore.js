const { ethers } = require("hardhat");
const hre = require("hardhat");
const { getTimeout, plugLiveCore } = require("../utils/utils");

async function main() {
  const FACTORY_ADDRESS = process.env.FACTORY_ADDRESS;
  const LP_ADDRESS = process.env.LP_ADDRESS;
  const AFFILIATEHELPER_ADDRESS = process.env.AFFILIATEHELPER_ADDRESS;

  const [deployer] = await ethers.getSigners();
  const oracle = deployer;
  const poolOwner = deployer;
  const batchMinBlocks = 50;
  const batchMaxBlocks = 100;

  let summary = {};

  console.log("Deployer wallet:", deployer.address);
  console.log("Deployer balance:", (await deployer.getBalance()).toString());

  const chainId = await hre.network.provider.send("eth_chainId");
  const timeout = getTimeout(chainId);

  const Factory = await ethers.getContractFactory("Factory");
  const factory = Factory.attach(FACTORY_ADDRESS);

  const LP = await ethers.getContractFactory("LP");
  const lp = LP.attach(LP_ADDRESS);

  // Plug live betting core
  const plugged = await plugLiveCore(ethers, deployer, factory, LP_ADDRESS, AFFILIATEHELPER_ADDRESS);
  await timeout();
  summary["LiveCore"] = plugged.liveCore.address;

  // set affiliateMaster
  await lp.connect(poolOwner).updateRole(deployer.address, 2 /*2 - AFFMASTER*/, true);
  await timeout();
  summary["affMaster"] = deployer.address;

  // Set live period settings
  await plugged.liveCore.connect(oracle).changeBatchLimits(batchMinBlocks, batchMaxBlocks);
  await timeout();
  summary["batchMinBlocks"] = batchMinBlocks;
  summary["batchMaxBlocks"] = batchMaxBlocks;

  console.log("\nLive Core settings:", JSON.stringify(summary));
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
