const hre = require("hardhat");
const { ethers, network } = require("hardhat");
const { addRole, bindRoles, getTimeout, grantRole } = require("../utils/utils");

const LP_ADDRESS = process.env.LP_ADDRESS;
const FREEBET_AFFILIATE = process.env.FREEBET_AFFILIATE;
const FREEBET_MANAGER = process.env.FREEBET_MANAGER;

async function main() {
  const chainId = await network.provider.send("eth_chainId");
  const timeout = getTimeout(chainId);

  const Access = await ethers.getContractFactory("Access");
  const access = await upgrades.deployProxy(Access);

  await timeout();

  const FreeBetFactory = await ethers.getContractFactory("FreeBetFactory");
  const freeBetFactory = await upgrades.deployProxy(FreeBetFactory, [access.address]);

  await timeout();

  const freeBetBeaconAddress = await freeBetFactory.freeBetBeacon();
  const UpgradeableBeacon = await ethers.getContractFactory("UpgradeableBeacon");
  const freeBetBeacon = await UpgradeableBeacon.attach(freeBetBeaconAddress);
  const freeBetImplementationAddress = await freeBetBeacon.implementation();

  console.log("* FreeBet *");
  console.log("\nACCESS:", access.address);
  console.log("FREEBET_FACTORY:", freeBetFactory.address);
  console.log("FREEBET_BEACON:", freeBetBeaconAddress);
  console.log("FREEBET_IMPLEMENTATION:", freeBetImplementationAddress);

  const [deployer] = await ethers.getSigners();

  const roleId = await addRole(access, deployer, "FreeBet Deployer");
  await bindRoles(access, deployer, [
    {
      target: freeBetFactory.address,
      selector: "0x04209123",
      roleId: roleId,
    },
  ]);
  await grantRole(access, deployer, deployer.address, roleId);

  const txCreateFreeBet = await freeBetFactory
    .connect(deployer)
    .createFreeBet(LP_ADDRESS, "XYZFreeBet", "XFBET", FREEBET_AFFILIATE, FREEBET_MANAGER);
  const receipt = await txCreateFreeBet.wait();
  const iface = new ethers.utils.Interface(
    freeBetFactory.interface.format(ethers.utils.FormatTypes.full).filter((x) => {
      return x.includes("NewFreeBet");
    })
  );
  const log = iface.parseLog(receipt.logs[4]);

  console.log("\nFREEBET:", log.args.freeBetAddress);
  console.log("FREEBET MANAGER:", FREEBET_MANAGER);

  try {
    await hre.run("verify:verify", {
      address: access.address,
      constructorArguments: [],
    });
  } catch (err) {}
  try {
    await hre.run("verify:verify", {
      address: freeBetFactory.address,
      constructorArguments: [],
    });
  } catch (err) {}
  try {
    await hre.run("verify:verify", {
      address: freeBetBeaconAddress,
      constructorArguments: [freeBetImplementationAddress],
    });
  } catch (err) {}
  try {
    await hre.run("verify:verify", {
      address: freeBetImplementationAddress,
      constructorArguments: [],
    });
  } catch (err) {}
  try {
    await hre.run("verify:verify", {
      address: log.args.freeBetAddress,
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
