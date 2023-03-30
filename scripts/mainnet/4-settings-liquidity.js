const { BigNumber } = require("ethers");
const { ethers } = require("hardhat");
const hre = require("hardhat");
const { getTimeout, getLPNFTToken } = require("../../utils/utils");

async function main() {
  const LP_ADDRESS = process.env.LP_ADDRESS;
  const FIRST_DEPO = process.env.FIRST_DEPO;
  const chainId = await hre.network.provider.send("eth_chainId");
  const timeout = getTimeout(chainId);

  const [deployer] = await ethers.getSigners();

  let liquidityProvider = new hre.ethers.Wallet(process.env.LP_PRIVATE_KEY, deployer.provider);

  const LP = await ethers.getContractFactory("LP");
  const lp = await LP.attach(LP_ADDRESS);

  // liquidityProvider add liquidity
  {
    console.log(
      "liquidity provider have balance",
      (await ethers.provider.getBalance(liquidityProvider.address)).toString()
    );
    let lpnft = await getLPNFTToken(
      await lp.connect(liquidityProvider).addLiquidityNative({ value: BigNumber.from(FIRST_DEPO) })
    );
    await timeout();
    console.log("added liquidity, LPNFT #", lpnft, "and LP has reserve", (await lp.getReserve()).toString());
  }
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
