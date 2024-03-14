import { HardhatUserConfig } from "hardhat/config";
import "hardhat-contract-sizer";
import "@typechain/hardhat";
import "@matterlabs/hardhat-zksync-solc";
import "@matterlabs/hardhat-zksync-verify";
import "@nomiclabs/hardhat-etherscan";
import "@nomiclabs/hardhat-ethers";
import "@nomiclabs/hardhat-waffle";
import "hardhat-abi-exporter";
import 'solidity-coverage';

const config: HardhatUserConfig = {
  networks: {
    hardhat: {
      zksync: false, // enables zksync in hardhat local network
      allowUnlimitedContractSize: true,
      gas:5000000,
      blockGasLimit:20000000,
      accounts:{
        accountsBalance:"1000000000000000000000000"
      }
    },
    zkMainnet: {
      url: "https://mainnet.era.zksync.io",
      ethNetwork: "https://eth.llamarpc.com",
      zksync: true,
      verifyURL:
        "https://zksync2-mainnet-explorer.zksync.io/contract_verification",
    },
    zkSepolia: {
      url: "https://sepolia.era.zksync.dev",
      ethNetwork: "https://rpc.ankr.com/eth_sepolia",
      zksync: true,
      verifyURL:
        "https://explorer.sepolia.era.zksync.dev/contract_verification"
    },
    zkTestnet: {
      url: "https://testnet.era.zksync.dev",
      ethNetwork: "https://eth-goerli.public.blastapi.io",
      zksync: true,
      verifyURL:
        "https://zksync2-testnet-explorer.zksync.dev/contract_verification"
    }
  },
  solidity: {
    compilers: [
      {
        version: "0.6.12",
        settings: {
          optimizer: {
            enabled: true,
            runs: 200,
          },
        },
      },
      {
        version: "0.8.0",
        settings: {
          optimizer: {
            enabled: true,
            runs: 200,
          },
        },
      },
      {
        version: "0.8.12",
        settings: {
          optimizer: {
            enabled: true,
            runs: 200,
          },
        },
      },
      {
        version: "0.8.18",
        settings: {
          optimizer: {
            enabled: true,
            runs: 200
          },
          viaIR: true
        }
      }
    ]
  },
  typechain: {
    outDir: "typechain",
    target: "ethers-v5",
  },
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
    spacing: 2,
    pretty: false
  },
  zksolc: {
    version: "1.3.8",
    compilerSource: "binary", // binary or docker (deprecated)
    settings: {
      libraries: {
        "contracts/core/PositionUtils_0_8_18.sol": {
          PositionUtils_0_8_18: "0x63092e876D3b977c58f936379746B99d350646BC",
        }
      },
      optimizer: {
        enabled: true, // optional. True by default
        mode: "z", // optional. 3 by default, z to optimize bytecode size
      },
    },
  },
};

export default config;
