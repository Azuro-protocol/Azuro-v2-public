const { ethers, network } = require("hardhat");
const { getTimeout } = require("../utils/utils");

async function main() {
  const chainId = await network.provider.send("eth_chainId");
  const timeout = getTimeout(chainId);
  const [deployer] = await ethers.getSigners();

  const CORE_ADDRESS = process.env.CORE_ADDRESS;

  const subId = process.env.VRF_SUBSCRIPTION_ID;
  const vrfCoordinatorAddress = process.env.VRF_COORDINATOR_ADDRESS;
  const keyHash = process.env.VRF_KEY_HASH;

  const requestConfirmations = process.env.X2_REQUEST_CONFIRMATIONS;
  const callbackGasLimit = process.env.X2_CALLBACK_GAS_LIMIT;
  const payoutMultiplier = process.env.X2_PAYOUT_MULTIPLIER;
  const margin = process.env.X2_MARGIN;
  const minBet = process.env.X2_MIN_BET;
  const resultPeriod = process.env.X2_RESULT_PERIOD;

  const args = [
    CORE_ADDRESS,
    vrfCoordinatorAddress,
    subId,
    keyHash,
    requestConfirmations,
    callbackGasLimit,
    payoutMultiplier,
    margin,
    minBet,
    resultPeriod,
  ];

  console.log("Deployer wallet: ", deployer.address);
  console.log("Deployer balance:", (await deployer.getBalance()).toString());

  {
    const X2OrNothing = await ethers.getContractFactory("X2OrNothing");
    const x2Beacon = await upgrades.deployBeacon(X2OrNothing);
    await timeout();
    await x2Beacon.deployed();
    await timeout();
    console.log("x2Beacon deployed to:", x2Beacon.address);
    const x2OrNothingProxy = await upgrades.deployBeaconProxy(x2Beacon, X2OrNothing, args);
    await timeout();
    await x2OrNothingProxy.deployed();
    await timeout();
    console.log("x2OrNothingProxy deployed to:", x2OrNothingProxy.address);
  }
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
