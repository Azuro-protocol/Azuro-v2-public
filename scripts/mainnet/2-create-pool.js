const { BigNumber } = require("ethers");
const { ethers } = require("hardhat");
const hre = require("hardhat");
const { createPool, addRole, bindRoles, grantRole, getTimeout, tokens } = require("../../utils/utils");

const FACTORY_ADDRESS = process.env.FACTORY_ADDRESS;
const AFFILIATEHELPER_ADDRESS = process.env.AFFILIATEHELPER_ADDRESS;
const TOKEN_ADDRESS = process.env.TOKEN_ADDRESS;

const ORACLES = JSON.parse(process.env.ORACLES ?? "[]");
let MAINTAINERS = JSON.parse(process.env.MAINTAINERS ?? "[]");
let ODDS_MANAGERS = JSON.parse(process.env.ODDS_MANAGERS ?? "[]");

let CLAIMTIMEOUT = 604800; // 1 week

async function main() {
  const chainId = await hre.network.provider.send("eth_chainId");
  const timeout = getTimeout(chainId);
  const [deployer] = await ethers.getSigners();

  const MULTIPLIER = 1e12;

  const minDepo = tokens(10);
  const daoFee = MULTIPLIER * 0.09; // 9%
  const dataProviderFee = MULTIPLIER * 0.01; // 1%
  const affiliateFee = MULTIPLIER * 0.01; // 1%

  let factory, access, core, lp, azuroBet, affiliateHelper;

  console.log("Pool owner wallet: ", deployer.address);
  console.log(
    "\nminDepo:",
    minDepo,
    "\ndaoFee:",
    daoFee,
    "\ndataProviderFee:",
    dataProviderFee,
    "\naffiliateFee:",
    affiliateFee
  );

  /// PRE-MATCH POOL
  const Factory = await ethers.getContractFactory("Factory", { signer: deployer });
  factory = await Factory.attach(FACTORY_ADDRESS);

  const AffiliateHelper = await ethers.getContractFactory("AffiliateHelper", { signer: deployer });
  affiliateHelper = await AffiliateHelper.attach(AFFILIATEHELPER_ADDRESS);

  ({ access, core, lp, azuroBet } = await createPool(
    ethers,
    factory,
    affiliateHelper,
    deployer,
    TOKEN_ADDRESS,
    minDepo,
    daoFee,
    dataProviderFee,
    affiliateFee
  ));
  await timeout();

  console.log("\n* Pool *");
  console.log("\nAccess deployed to:", access.address);
  console.log("LP deployed to:", lp.address);
  console.log("PrematchCore deployed to:", core.address);
  console.log("AzuroBet deployed to:", azuroBet.address);

  console.log(
    "\nCONTRACTS FOR WEB APP:",
    JSON.stringify({
      factory: factory.address,
      core: core.address,
      lp: lp.address,
      azuroBet: azuroBet.address,
      token: TOKEN_ADDRESS,
    })
  );
  // LP settings
  await lp.connect(deployer).changeClaimTimeout(CLAIMTIMEOUT);
  console.log("ClaimTimeout:", CLAIMTIMEOUT);

  await lp.connect(deployer).changeDataProvider(ORACLES[0]);
  console.log("DataProvider:", ORACLES[0]);

  // Roles
  const oracleRoleId = await addRole(access, deployer, "Oracle");
  await timeout();
  const maintainerRoleId = await addRole(access, deployer, "Maintainer");
  await timeout();
  const oddsManagerRoleId = await addRole(access, deployer, "OddsManager");
  await timeout();
  const rolesData = [
    { target: lp.address, selector: "0x69958ab9", roleId: oracleRoleId }, // cancelGame
    { target: lp.address, selector: "0x0c6b6b7a", roleId: oracleRoleId }, // createGame
    { target: lp.address, selector: "0xa8822061", roleId: oracleRoleId }, // shiftGame
    { target: core.address, selector: "0xbc4925fc", roleId: oracleRoleId }, // cancelCondition
    { target: core.address, selector: "0x8ea8c308", roleId: oracleRoleId }, // changeOdds
    { target: core.address, selector: "0xc6600c7c", roleId: oracleRoleId }, // createCondition
    { target: core.address, selector: "0xbc4925fc", roleId: maintainerRoleId }, // cancelCondition
    { target: core.address, selector: "0x6fea02f0", roleId: maintainerRoleId }, // stopCondition
    { target: core.address, selector: "0x8ea8c308", roleId: oddsManagerRoleId }, // changeOdds
  ];
  await access.connect(deployer).bindRoles(rolesData);
  await timeout();

  console.log(
    `\nAccess roles (ids) prepared:\n- Oracle:`,
    oracleRoleId.toString(),
    "\n- Maintainer:",
    maintainerRoleId.toString(),
    "\n- Odds Manager:",
    oddsManagerRoleId.toString()
  );

  for (const iterator of MAINTAINERS.keys()) {
    await grantRole(access, deployer, MAINTAINERS[iterator], maintainerRoleId);
    await timeout();
  }
  console.log("\nMAINTAINERS:", MAINTAINERS);

  for (const iterator of ODDS_MANAGERS.keys()) {
    await grantRole(access, deployer, ODDS_MANAGERS[iterator], oddsManagerRoleId);
    await timeout();
  }
  console.log("\nOdds managers:", ODDS_MANAGERS);

  for (const iterator of ORACLES.keys()) {
    await grantRole(access, deployer, ORACLES[iterator], oracleRoleId);
    await timeout();
  }
  console.log("ORACLES:", ORACLES);
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
