import { BigNumber, ethers } from 'ethers';

const maxUint256 = ethers.constants.MaxUint256;

const decimals:{[index: string]: number} = {
  "0xBBeB516fb02a01611cBBE0453Fe3c580D7281011": 8
}

function parseDecToken(token: string, n: string): ethers.BigNumber {
  return ethers.utils.parseUnits(n, decimals[token]);
}

function newWallet(): ethers.Wallet {
  return ethers.Wallet.createRandom();
}

function bigNumberify(n: number | string | BigNumber): ethers.BigNumber {
  return ethers.BigNumber.from(n);
}

function parseDec(n: string, dec: number): ethers.BigNumber {
  return ethers.utils.parseUnits(n, dec);
}

function expandDecimals(n: number | string | BigNumber, decimals: number): ethers.BigNumber {
  return bigNumberify(n).mul(bigNumberify(10).pow(decimals));
}


async function gasUsed(provider: ethers.providers.Provider, tx: ethers.providers.TransactionResponse): Promise<BigNumber> {
  const { gasUsed } = await provider.getTransactionReceipt(tx.hash);
  return gasUsed;
}

async function getNetworkFee(provider: ethers.providers.Provider, tx: ethers.providers.TransactionResponse): Promise<BigNumber> {
  const gas = await gasUsed(provider, tx);
  return gas.mul(tx.gasPrice!);
}

async function reportGasUsed(provider: ethers.providers.Provider, tx: ethers.providers.TransactionResponse, label: string): Promise<BigNumber> {
  const { gasUsed } = await provider.getTransactionReceipt(tx.hash);
  console.info(label, gasUsed.toString());
  return gasUsed;
}

async function getBlockTime(provider: ethers.providers.Provider): Promise<number> {
  const blockNumber = await provider.getBlockNumber();
  const block = await provider.getBlock(blockNumber);
  return block.timestamp;
}

async function getTxnBalances(
  provider: ethers.providers.Provider,
  user: ethers.Wallet,
  txn: () => Promise<ethers.providers.TransactionResponse>,
  callback: (balance0: BigNumber, balance1: BigNumber, fee: BigNumber) => void
): Promise<void> {
  const balance0 = await provider.getBalance(user.address);
  const tx = await txn();
  const fee = await getNetworkFee(provider, tx);
  const balance1 = await provider.getBalance(user.address);
  callback(balance0, balance1, fee);
}

function print(label: string, value: BigNumber, decimals: number): void {
  if (decimals === 0) {
    console.log(label, value.toString());
    return;
  }
  const valueStr = ethers.utils.formatUnits(value, decimals);
  console.log(label, valueStr);
}

function getPriceBitArray(prices: string[]): string[] {
  const priceBitArray: string[] = [];
  let shouldExit = false;

  for (let i = 0; i < Math.floor((prices.length - 1) / 8) + 1; i++) {
    let priceBits = ethers.BigNumber.from('0');
    for (let j = 0; j < 8; j++) {
      const index = i * 8 + j;
      if (index >= prices.length) {
        shouldExit = true;
        break;
      }

      const price = ethers.BigNumber.from(prices[index]);
      if (price.gt(ethers.BigNumber.from('2147483648'))) { // 2^31
        throw new Error(`price exceeds bit limit ${price.toString()}`);
      }
      priceBits = priceBits.or(price.shl(j * 32));
    }

    priceBitArray.push(priceBits.toString());
    if (shouldExit) {
      break;
    }
  }

  return priceBitArray;
}

function getPriceBits(prices: string[]): string {
  if (prices.length > 8) {
    throw new Error('max prices.length exceeded');
  }

  let priceBits = ethers.BigNumber.from('0');

  for (let j = 0; j < 8; j++) {
    const index = j;
    if (index >= prices.length) {
      break;
    }
    const price = ethers.BigNumber.from(prices[index]);
    if (price.gt(ethers.BigNumber.from('2147483648'))) { // 2^31
      throw new Error(`price exceeds bit limit ${price.toString()}`);
    }

    priceBits = priceBits.or(price.shl(j * 32));
  }

  return priceBits.toString();
}

const padDecimals = (amount: BigNumber, minDecimals: number): string => {
  let amountStr = amount.toString();
  const dotIndex = amountStr.indexOf('.');
  if (dotIndex !== -1) {
    const decimals = amountStr.length - dotIndex - 1;
    if (decimals < minDecimals) {
      amountStr = amountStr.padEnd(amountStr.length + (minDecimals - decimals), '0');
    }
  } else {
    amountStr = amountStr + '.0000';
  }
  return amountStr;
};


function numberWithCommas(x: number | string): string {
  if (!x) {
    return '...';
  }
  const parts = x.toString().split('.');
  parts[0] = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return parts.join('.');
}


export {
  newWallet,
  maxUint256,
  bigNumberify,
  expandDecimals,
  gasUsed,
  getNetworkFee,
  reportGasUsed,
  getBlockTime,
  getTxnBalances,
  print,
  getPriceBitArray,
  getPriceBits,
  parseDec,
  parseDecToken
};




