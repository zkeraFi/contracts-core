import { HardhatUserConfig } from "hardhat/config";
import "hardhat-contract-sizer";
import "@typechain/hardhat";
import "@nomicfoundation/hardhat-verify";
import "@nomiclabs/hardhat-ethers";
import "@nomiclabs/hardhat-waffle";
import "hardhat-abi-exporter";
import dotenv from 'dotenv';
dotenv.config();
const pk:any = process.env.TESTNET_DEPLOYER_PK;
const config: HardhatUserConfig = {
  sourcify: {
    enabled: true,

  },
  etherscan:{
    enabled:false
  },
  networks: {
    localhost: {
      timeout: 120000,
    },
    zkDocker: {
      url: "http://localhost:3050",
    },
    zkTeamServer: {
      url: "http://45.76.38.228:3050",
    },
    goerli: {
      url: "https://eth-goerli.public.blastapi.io",
      accounts: [pk],
    },
    telos: {
      url: "https://mainnet-eu.telos.net/evm", // public endpoint https://mainnet-eu.telos.net/evm https://mainnet.telos.net:443/evm
      chainId: 40,
      accounts: [pk],
      allowUnlimitedContractSize: true
    },
    telosTestnet: {
      url: "https://testnet.telos.net/evm",
      accounts: [pk],
      allowUnlimitedContractSize: true
    },
    hardhat: {
      allowUnlimitedContractSize: true,
    },
  },
  solidity: {
    compilers: [
      {
        version: "0.6.12",
        settings: {
          optimizer: {
            enabled: true,
            runs: 10
          },
        },
      },
      {
        version: "0.8.0",
        settings: {
          optimizer: {
            enabled: true,
            runs: 10
          },
        },
      },
      {
        version: "0.8.12",
        settings: {
          optimizer: {
            enabled: true,
            runs: 10
          },
        },
      },
      {
        version: "0.8.18",
        settings: {
          optimizer: {
            enabled: true,
            runs: 10
          },
          viaIR: true
        }
      }
    ],
  },
  typechain: {
    outDir: "typechain",
    target: "ethers-v5",
  },
  // paths: {
  //   tests: "./test/core/Vault", // Replace 'my-test-folder' with the name of the folder you prefer
  // },
  contractSizer: {
    alphaSort: false,
    disambiguatePaths: false,
    runOnCompile: false,
    strict: false,
  },
  abiExporter: {
    path: "./data/abi",
    runOnCompile: true,
    clear: true,
    // flat: true,
    // only: [':RewardRouterV2$'],
    spacing: 2,
    pretty: false,
    // format: "json",
  }
};

export default config;
