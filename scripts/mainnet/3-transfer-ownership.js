const hre = require("hardhat");
const { getTimeout } = require("../../utils/utils");

async function main() {
  const gnosisSafe = process.env.GNOSIS_SAFE_WALLET;
  const chainId = await hre.network.provider.send("eth_chainId");
  const timeout = getTimeout(chainId);

  console.log("Transferring ownership of ProxyAdmin to gnosis safe wallet...");
  // The owner of the ProxyAdmin can upgrade our contracts
  await upgrades.admin.transferProxyAdminOwnership(gnosisSafe);
  await timeout();
  console.log("Transferred ownership of ProxyAdmin to:", gnosisSafe);
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
