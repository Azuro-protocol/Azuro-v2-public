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

const ARBITRUM_PRIVATE_KEY = process.env.ARBITRUM_PRIVATE_KEY || "";
const ARBISCAN_API_KEY = process.env.ARBISCAN_API_KEY || "";
const ARBITRUM_GOERLI_PRIVATE_KEY = process.env.ARBITRUM_GOERLI_PRIVATE_KEY || "";
const ALCHEMY_API_KEY_ARBITRUM_GOERLI = process.env.ALCHEMY_API_KEY_ARBITRUM_GOERLI || "";

const GNOSIS_RPC = process.env.GNOSIS_RPC || "";
const GNOSIS_PRIVATE_KEY = process.env.GNOSIS_PRIVATE_KEY || "";
const GNOSISSCAN_API_KEY = process.env.GNOSISSCAN_API_KEY || "";

const LINEA_PRIVATE_KEY = process.env.LINEA_PRIVATE_KEY || "";
const LINEA_GOERLI_PRIVATE_KEY = process.env.LINEA_GOERLI_PRIVATE_KEY || "";
const LINEASCAN_API_KEY = process.env.LINEASCAN_API_KEY || "";
const INFURA_API_KEY = process.env.INFURA_API_KEY || "";

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

if (ARBITRUM_PRIVATE_KEY != "") {
  exportNetworks["arbitrum"] = {
    url: "https://arb1.arbitrum.io/rpc",
    accounts: [`${ARBITRUM_PRIVATE_KEY}`],
  };
}

if (ARBITRUM_GOERLI_PRIVATE_KEY != "") {
  exportNetworks["arbitrum_goerli"] = {
    url: "https://arb-goerli.g.alchemy.com/v2/" + ALCHEMY_API_KEY_ARBITRUM_GOERLI,
    /* gasPrice: 10000000, */
    accounts: [`${ARBITRUM_GOERLI_PRIVATE_KEY}`],
  };
}

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
    url: "https://polygon-rpc.com",
    accounts: [`${POLYGON_PRIVATE_KEY}`],
  };
}

if (LINEA_PRIVATE_KEY != "") {
  exportNetworks["linea"] = {
    url: "https://linea-mainnet.infura.io/v3/" + INFURA_API_KEY,
    accounts: [`${LINEA_PRIVATE_KEY}`],
  };
}

if (LINEA_GOERLI_PRIVATE_KEY != "") {
  exportNetworks["linea_goerli"] = {
    url: "https://rpc.goerli.linea.build",
    accounts: [`${LINEA_GOERLI_PRIVATE_KEY}`],
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
      arbitrum: ARBISCAN_API_KEY,
      arbitrum_goerli: ARBISCAN_API_KEY,
      gnosis: GNOSISSCAN_API_KEY,
      linea: LINEASCAN_API_KEY,
      linea_goerli: LINEASCAN_API_KEY,
      mumbai: POLYGONSCAN_API_KEY,
      polygon: POLYGONSCAN_API_KEY,
    },
    customChains: [
      {
        network: "arbitrum",
        chainId: 42161,
        urls: {
          apiURL: "https://api.arbiscan.io/api",
          browserURL: "https://arbiscan.io",
        },
      },
      {
        network: "arbitrum_goerli",
        chainId: 421613,
        urls: {
          apiURL: "https://api-goerli.arbiscan.io/api",
          browserURL: "https://goerli.arbiscan.io",
        },
      },
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
      {
        network: "linea",
        chainId: 59144,
        urls: {
          apiURL: "https://api.lineascan.build/api",
          browserURL: "https://lineascan.build",
        },
      },
      {
        network: "linea_goerli",
        chainId: 59140,
        urls: {
          apiURL: "https://api-goerli.lineascan.build/api",
          browserURL: "goerli.lineascan.build",
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
