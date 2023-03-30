require("@nomicfoundation/hardhat-chai-matchers");
require("@nomiclabs/hardhat-ethers");
require("@nomiclabs/hardhat-etherscan");
require("@nomiclabs/hardhat-ganache");
require("@openzeppelin/hardhat-upgrades");
require("@openzeppelin/hardhat-defender");
require("hardhat-change-network");
require("hardhat-contract-sizer");
require("hardhat-docgen");
require("hardhat-gas-reporter");
require("solidity-coverage");

require("dotenv").config();

const GNOSIS_RPC = process.env.GNOSIS_RPC || "";
const GNOSIS_PRIVATE_KEY = process.env.GNOSIS_PRIVATE_KEY || "";
const GNOSISSCAN_API_KEY = process.env.GNOSISSCAN_API_KEY || "";

const POLYGON_PRIVATE_KEY = process.env.POLYGON_PRIVATE_KEY || "";
const MUMBAI_PRIVATE_KEY = process.env.MUMBAI_PRIVATE_KEY || "";
const POLYGONSCAN_API_KEY = process.env.POLYGONSCAN_API_KEY || "";

const DEFENDER_TEAM_API_KEY = process.env.DEFENDER_TEAM_API_KEY || "";
const DEFENDER_TEAM_API_SECRET_KEY = process.env.DEFENDER_TEAM_API_SECRET_KEY || "";

// This is a sample Hardhat task. To learn how to create your own go to
// https://hardhat.org/guides/create-task.html
task("accounts", "Prints the list of accounts", async () => {
  const accounts = await ethers.getSigners();

  for (const account of accounts) {
    console.log(account.address);
  }
});

// You need to export an object to set up your config
// Go to https://hardhat.org/config/ to learn more

/**
 * @type import('hardhat/config').HardhatUserConfig
 */

const exportNetworks = {
  hardhat: {
    accounts: {
      accountsBalance: "1000000000000000000000000000000000",
    },
    forking: {
      enabled: process.env.FORKING === "YES",
      url: GNOSIS_RPC,
      live: false,
    },
  },
};

if (GNOSIS_PRIVATE_KEY != "") {
  exportNetworks["gnosis"] = {
    url: GNOSIS_RPC,
    accounts: [`${GNOSIS_PRIVATE_KEY}`],
  };
}

if (MUMBAI_PRIVATE_KEY != "") {
  exportNetworks["mumbai"] = {
    url: "https://polygon-testnet-rpc.allthatnode.com:8545",
    accounts: [`${MUMBAI_PRIVATE_KEY}`],
  };
}

if (POLYGON_PRIVATE_KEY != "") {
  exportNetworks["polygon"] = {
    url: "https://polygon.llamarpc.com",
    accounts: [`${POLYGON_PRIVATE_KEY}`],
  };
}

module.exports = {
  solidity: {
    compilers: [
      {
        version: "0.8.16",
        settings: {
          optimizer: {
            enabled: true,
            runs: 2,
          },
        },
      },
    ],
  },
  defaultNetwork: "hardhat",
  networks: exportNetworks,
  defender: {
    apiKey: DEFENDER_TEAM_API_KEY,
    apiSecret: DEFENDER_TEAM_API_SECRET_KEY,
  },
  etherscan: {
    apiKey: {
      gnosis: GNOSISSCAN_API_KEY,
      mumbai: POLYGONSCAN_API_KEY,
      polygon: POLYGONSCAN_API_KEY,
    },
    customChains: [
      {
        network: "gnosis",
        chainId: 100,
        urls: {
          apiURL: "https://api.gnosisscan.io/api",
          browserURL: "https://gnosisscan.io/",
        },
      },
      {
        network: "mumbai",
        chainId: 80001,
        urls: {
          apiURL: "https://api-testnet.polygonscan.com/api",
          browserURL: "https://mumbai.polygonscan.com",
        },
      },
    ],
  },
  contractSizer: {
    alphaSort: true,
    runOnCompile: true,
    disambiguatePaths: false,
  },
  gasReporter: {
    enabled: true,
    currency: "USD",
  },
  docgen: {
    path: "./docs",
    clear: true,
    runOnCompile: true,
  },
  mocha: {
    timeout: 100000000,
  },
};
