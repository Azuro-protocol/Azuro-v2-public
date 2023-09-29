const { ethers } = require("hardhat");
const config = require("./config.json");

async function getBytecodeHash(contractAddress, provider) {
  const bytecode = await provider.getCode(contractAddress);
  return ethers.utils.keccak256(bytecode);
}

function printGreen(message) {
  console.log("\x1b[32m%s\x1b[0m", message);
}

function printRed(message) {
  console.log("\x1b[31m%s\x1b[0m", message);
}

async function main() {
  for (const version in config.versions) {
    const contracts = config.versions[version];
    const networks = config.networks;
    let isPrevMismatch = false;

    // Loop through the contracts within each version
    for (const contractName in contracts) {
      const addresses = contracts[contractName];
      let firstNetwork = null;
      let firstHash = null;
      let isMismatch = false;
      let bytecodeHash;

      // Loop through the addresses for each contract
      for (const network in addresses) {
        const provider = new ethers.providers.JsonRpcProvider(networks[network]);
        bytecodeHash = await getBytecodeHash(addresses[network], provider);

        // Compare the current hash with the first one
        if (firstHash == null) {
          firstNetwork = network;
          firstHash = bytecodeHash;
        } else if (bytecodeHash != firstHash) {
          if (!isMismatch) {
            if (!isPrevMismatch) {
              printRed("----------------------------------------------------------");
            }
            printRed(`${contractName}:\n${firstNetwork}: ${firstHash}`);
            isMismatch = true;
            isPrevMismatch = true;
          }
          printRed(`${network}: ${bytecodeHash}`);
        }
      }
      if (!isMismatch) {
        printGreen(`${contractName}: OK (${bytecodeHash})`);
        isPrevMismatch = false;
      } else printRed("----------------------------------------------------------");
    }
  }
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
