const { ethers, network } = require("hardhat");
const { getTimeout } = require("../utils/utils");
const { Wallet } = require("ethers");

let wxDaiAddress;

async function main() {
  const chainId = await network.provider.send("eth_chainId");
  const timeout = getTimeout(chainId);
  const [deployer] = await ethers.getSigners();
  const MAINTAINERS = JSON.parse(process.env.MAINTAINERS ?? "[]");

  let freebet;
  const LP_ADDRESS = process.env.LP_ADDRESS;

  console.log("Deployer wallet: ", deployer.address);
  console.log("Deployer balance:", (await deployer.getBalance()).toString());

  // xDAI
  {
    wxDaiAddress = process.env.TOKEN_ADDRESS;
  }

  // Freebet
  {
    const FreeBet = await ethers.getContractFactory("FreeBet");
    freebet = await upgrades.deployProxy(FreeBet, [wxDaiAddress], { useDeployedImplementation: false });
    await timeout();
    await freebet.deployed();
    console.log("FreeBet deployed to:", freebet.address);
    await timeout();
    const freebetImplAddress = await upgrades.erc1967.getImplementationAddress(freebet.address);
    const freebetImpl = FreeBet.attach(freebetImplAddress);
    await freebetImpl.initialize(Wallet.createRandom().address);
    console.log("FreeBetImpl deployed to:", freebetImplAddress);
    await timeout();
  }

  // initial settings
  {
    await freebet.setLp(LP_ADDRESS);
    await timeout();
    console.log("FreeBet: LP address set to", await freebet.LP());

    for (const maintainer of MAINTAINERS) {
      await freebet.updateMaintainer(maintainer, true);
      console.log("FreeBet: Added maintainer:", maintainer);
      await timeout();
    }
  }
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
