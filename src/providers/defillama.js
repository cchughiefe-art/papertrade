'use strict';

const BASE_URL = process.env.DEFILLAMA_BASE_URL || 'https://coins.llama.fi';
const NETWORKS = {
  ethereum: 'ethereum', base: 'base', bsc: 'bsc', arbitrum: 'arbitrum',
  polygon: 'polygon', avalanche: 'avax', optimism: 'optimism', solana: 'solana',
  linea: 'linea', blast: 'blast', zksync: 'zksync', mantle: 'mantle',
  fantom: 'fantom', celo: 'celo', cronos: 'cronos', tron: 'tron', sui: 'sui'
};

async function fetchJson(url) {
  const response = await fetch(url, { headers: { accept: 'application/json', 'user-agent': 'PaperTrade/1.0' } });
  if (!response.ok) throw new Error(`DefiLlama HTTP ${response.status}`);
  return response.json();
}

async function getPrices(tokens) {
  const input = Array.isArray(tokens) ? tokens : [];
  const results = new Array(input.length).fill(null);
  const supported = input.map((token, index) => {
    const chain = String(token?.chain || '').toLowerCase();
    const network = NETWORKS[chain];
    const address = String(token?.address || '').trim();
    return network && address ? { index, chain, address, key: `${network}:${address}` } : null;
  }).filter(Boolean);

  for (let offset = 0; offset < supported.length; offset += 50) {
    const chunk = supported.slice(offset, offset + 50);
    const data = await fetchJson(`${BASE_URL}/prices/current/${chunk.map(item => encodeURIComponent(item.key)).join(',')}`);
    const coins = data?.coins || {};
    for (const item of chunk) {
      const row = coins[item.key] || coins[`${NETWORKS[item.chain]}:${item.address.toLowerCase()}`];
      const price = Number(row?.price);
      if (!Number.isFinite(price) || price <= 0) continue;
      results[item.index] = {
        chain: item.chain, address: item.address, name: row.symbol || 'Token', symbol: row.symbol || 'TOKEN',
        priceUsd: price, source: 'defillama', dex: 'DefiLlama', priceAvailable: true,
        confidence: Number(row.confidence) || null,
        updatedAt: Number(row.timestamp) > 0 ? Number(row.timestamp) * 1000 : Date.now()
      };
    }
  }
  return results;
}

module.exports = { getPrices };
