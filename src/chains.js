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
  },

  robinhood: {
    id: 'robinhood',
    name: 'Robinhood Chain',
    native: 'ETH',
    chainId: 4663,
    addressType: 'evm',
    explorer: a => `https://robinhoodchain.blockscout.com/token/${a}`,
    providers: { robinhood: 'robinhood' }
  }
};

const EVM_RE = /^0x[a-fA-F0-9]{40}$/;
const SOL_RE = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
const CHAIN_ID_RE = /^[a-z0-9][a-z0-9_-]{0,39}$/;
// Covers contract/mint formats returned by DEX market-data providers, including
// EVM, Solana, Sui, Aptos, TON, Tron, Cosmos and Cardano-style identifiers.
// A matching shape is not treated as proof that a token exists: every order is
// still resolved against a provider and requires a fresh positive USD price.
const PROVIDER_ADDRESS_RE = /^[a-zA-Z0-9:_-]{20,160}$/;

function isValidAddress(address) {
  if (!address) return [];

  if (EVM_RE.test(address)) {
    return Object.values(CHAINS)
      .filter(c => c.addressType === 'evm')
      .map(c => c.id)
      .sort((a, b) => Number(b === 'robinhood') - Number(a === 'robinhood'));
  }

  if (SOL_RE.test(address)) {
    return ['solana'];
  }

  return [];
}

function isValidMarketToken(chain, address) {
  const cleanChain = String(chain || '').trim().toLowerCase();
  const cleanAddress = String(address || '').trim();
  return CHAIN_ID_RE.test(cleanChain) && PROVIDER_ADDRESS_RE.test(cleanAddress);
}

function isResolvableAddress(address) {
  return PROVIDER_ADDRESS_RE.test(String(address || '').trim());
}

module.exports = {
  CHAINS,
  isValidAddress,
  isValidMarketToken,
  isResolvableAddress
};
