const { ethers, network } = require("hardhat");
const { getTimeout, getClaimParams } = require("../utils/utils");

async function main() {
  const chainId = await network.provider.send("eth_chainId");
  const timeout = getTimeout(chainId);
  const [deployer] = await ethers.getSigners();

  const AFFILIATEHELPER_ADDRESS = process.env.AFFILIATEHELPER_ADDRESS;
  const CORE_ADDRESS = process.env.CORE_ADDRESS;
  const LP_ADDRESS = process.env.LP_ADDRESS;
  const AFFILIATE_ADDRESS = process.env.LP_ADDRESS;

  console.log("Executor wallet: ", deployer.address);
  console.log("Executor balance:", (await deployer.getBalance()).toString());
  console.log("Claim for affiliate:", AFFILIATE_ADDRESS);

  const AffiliateHelper = await ethers.getContractFactory("AffiliateHelper");
  const affiliateHelper = AffiliateHelper.attach(AFFILIATEHELPER_ADDRESS);

  const Core = await ethers.getContractFactory("Core", {
    signer: deployer,
    libraries: {
      AffiliateHelper: affiliateHelper.address,
    },
    unsafeAllowCustomTypes: true,
  });
  let core = Core.attach(CORE_ADDRESS);

  const LP = await ethers.getContractFactory("LP");
  let lp = LP.attach(LP_ADDRESS);

  // get contributed conditions count
  let conditionsCount = await core.getContributedConditionsCount(deployer.address);

  if (conditionsCount == 0) {
    console.log("Nothing to claim");
    return;
  }
  // claim partially by 100
  let batches = Math.floor(conditionsCount / 100) + 1;
  console.log("Total conditions %s batches to proceed %s", conditionsCount, batches);
  const claimParams = getClaimParams(0, 100);
  for (const i of Array(batches).keys()) {
    await lp.claimAffiliateRewardFor(core.address, claimParams, AFFILIATE_ADDRESS);
    await timeout();
    console.log("executed batch %s", i + 1);
  }
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
