const { ethers } = require("hardhat");
const {
  getBlockTime,
  tokens,
  createCondition,
  makeBetLiveGetTokenId,
  getTimeout,
  getGameId,
} = require("../utils/utils");

const OUTCOMEWIN = 1;
const OUTCOMELOSE = 2;
const MARGINALITY = 50000000; // 5%
const REINFORCEMENT = tokens(20_000);
const pool1 = 5000000;
const pool2 = 5000000;

const lpAddress = process.env.LP_ADDRESS;
const liveCoreAddress = process.env.LIVE_CORE_ADDRESS;
const affiliateHelperaddress = process.env.AFFILIATEHELPER_ADDRESS;

async function main() {
  const chainId = await hre.network.provider.send("eth_chainId");
  const timeout = getTimeout(chainId);

  const [deployer] = await ethers.getSigners();
  const oracle = deployer;
  const affiliate = deployer;

  console.log("Deployer wallet:", deployer.address);
  console.log("Deployer balance:", (await deployer.getBalance()).toString());

  const LP = await ethers.getContractFactory("LP");
  const lp = LP.attach(lpAddress);

  const LiveCore = await ethers.getContractFactory("LiveCore", {
    signer: deployer,
    libraries: {
      AffiliateHelper: affiliateHelperaddress,
    },
    unsafeAllowCustomTypes: true,
  });
  const core = LiveCore.attach(liveCoreAddress);

  let condId = 4,
    condIdHash,
    time;

  time = await getBlockTime(ethers);

  const blockNumBefore = await ethers.provider.getBlockNumber();
  const blockBefore = await ethers.provider.getBlock(blockNumBefore);
  const time2 = blockBefore.timestamp;

  console.log("blockNumBefore", blockNumBefore, "time2", time2);

  // add oracle
  await lp.connect(deployer).updateRole(oracle.address, 0, true);
  await timeout();

  // Create game
  const oracleGameId = 8;
  time = await getBlockTime(ethers);
  const txCreate = await lp.connect(oracle).createGame(oracleGameId, time + 172800);
  await timeout();

  const gameId = await getGameId(txCreate);
  console.log("gameId", gameId);

  // Create condition
  condIdHash = await createCondition(
    core,
    oracle,
    gameId,
    ++condId,
    [pool2, pool1],
    [OUTCOMEWIN, OUTCOMELOSE],
    REINFORCEMENT,
    MARGINALITY
  );
  await timeout();
  console.log("condIdHash", condIdHash);

  time = await getBlockTime(ethers);
  await makeBetLiveGetTokenId(
    lp,
    deployer,
    core,
    affiliate.address,
    condIdHash,
    tokens(100),
    OUTCOMELOSE,
    time + 100,
    1200000000
  );
  await timeout();

  time = await getBlockTime(ethers);
  await makeBetLiveGetTokenId(
    lp,
    deployer,
    core,
    affiliate.address,
    condIdHash,
    tokens(100),
    OUTCOMEWIN,
    time + 100,
    1200000000
  );
  await timeout();

  await core.executeBatch(condIdHash);

  console.log("batch for ", condIdHash, " executed");
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
