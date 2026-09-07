const CHAINS = {
  solana: {
    id: 'solana',
    name: 'Solana',
    native: 'SOL',
    addressType: 'solana',
    explorer: a => `https://solscan.io/token/${a}`,
    providers: { dexscreener: 'solana', gecko: 'solana' }
  },

  ethereum: {
    id: 'ethereum',
    name: 'Ethereum',
    native: 'ETH',
    chainId: 1,
    addressType: 'evm',
    explorer: a => `https://etherscan.io/token/${a}`,
    providers: { dexscreener: 'ethereum', gecko: 'eth' }
  },

  base: {
    id: 'base',
    name: 'Base',
    native: 'ETH',
    chainId: 8453,
    addressType: 'evm',
    explorer: a => `https://basescan.org/token/${a}`,
    providers: { dexscreener: 'base', gecko: 'base' }
  },

  bsc: {
    id: 'bsc',
    name: 'BNB Chain',
    native: 'BNB',
    chainId: 56,
    addressType: 'evm',
    explorer: a => `https://bscscan.com/token/${a}`,
    providers: { dexscreener: 'bsc', gecko: 'bsc' }
  },

  arbitrum: {
    id: 'arbitrum',
    name: 'Arbitrum',
    native: 'ETH',
    chainId: 42161,
    addressType: 'evm',
    explorer: a => `https://arbiscan.io/token/${a}`,
    providers: { dexscreener: 'arbitrum', gecko: 'arbitrum' }
  },

  polygon: {
    id: 'polygon',
    name: 'Polygon',
    native: 'POL',
    chainId: 137,
    addressType: 'evm',
    explorer: a => `https://polygonscan.com/token/${a}`,
    providers: { dexscreener: 'polygon', gecko: 'polygon_pos' }
  },

  avalanche: {
    id: 'avalanche',
    name: 'Avalanche',
    native: 'AVAX',
    chainId: 43114,
    addressType: 'evm',
    explorer: a => `https://snowtrace.io/token/${a}`,
    providers: { dexscreener: 'avalanche', gecko: 'avax' }
  }
};

const EVM_RE = /^0x[a-fA-F0-9]{40}$/;
const SOL_RE = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

function isValidAddress(address) {
  if (!address) return [];

  if (EVM_RE.test(address)) {
    return Object.values(CHAINS)
      .filter(c => c.addressType === 'evm')
      .map(c => c.id);
  }

  if (SOL_RE.test(address)) {
    return ['solana'];
  }

  return [];
}

module.exports = {
  CHAINS,
  isValidAddress
};
