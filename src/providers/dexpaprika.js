'use strict';

const BASE_URL = process.env.DEXPAPRIKA_BASE_URL || 'https://api.dexpaprika.com';
const NETWORKS = {
  solana: 'solana', ethereum: 'ethereum', base: 'base', bsc: 'bsc',
  arbitrum: 'arbitrum', polygon: 'polygon', avalanche: 'avalanche'
};

async function fetchJson(url) {
  const response = await fetch(url, { headers: { accept: 'application/json', 'user-agent': 'PaperTrade/1.0' } });
  if (!response.ok) throw new Error(`DexPaprika HTTP ${response.status}`);
  return response.json();
}

function normalizeToken(data, chain, address) {
  const summary = data?.summary || {};
  const price = Number(summary.price_usd ?? data?.price_usd);
  if (!Number.isFinite(price) || price <= 0) return null;
  return {
    chain,
    address: data?.id || address,
    name: data?.name || 'Unknown Token',
    symbol: data?.symbol || 'UNKNOWN',
    priceUsd: price,
    marketCapUsd: Number(summary.market_cap_usd ?? summary.fdv ?? 0) || null,
    liquidityUsd: Number(summary.liquidity_usd ?? 0) || null,
    volume24hUsd: Number(summary['24h']?.volume_usd ?? 0) || null,
    priceChange24h: Number(summary['24h']?.price_change ?? 0) || null,
    source: 'dexpaprika',
    dex: 'DexPaprika',
    priceAvailable: true,
    updatedAt: Date.now()
  };
}

async function resolveToken(chain, address) {
  const network = NETWORKS[String(chain || '').toLowerCase()];
  if (!network || !address) return null;
  const data = await fetchJson(`${BASE_URL}/networks/${encodeURIComponent(network)}/tokens/${encodeURIComponent(address)}`);
  return normalizeToken(data, chain, address);
}

async function getPrices(tokens) {
  const input = Array.isArray(tokens) ? tokens : [];
  const results = new Array(input.length).fill(null);
  const groups = new Map();
  input.forEach((token, index) => {
    const chain = String(token?.chain || '').toLowerCase();
    if (!NETWORKS[chain] || !token?.address) return;
    if (!groups.has(chain)) groups.set(chain, []);
    groups.get(chain).push({ index, address: String(token.address) });
  });
  for (const [chain, entries] of groups) {
    for (let offset = 0; offset < entries.length; offset += 10) {
      const chunk = entries.slice(offset, offset + 10);
      const addresses = [...new Set(chunk.map(item => item.address))];
      const url = `${BASE_URL}/networks/${encodeURIComponent(NETWORKS[chain])}/multi/prices?tokens=${addresses.map(encodeURIComponent).join(',')}`;
      const data = await fetchJson(url);
      const rows = Array.isArray(data) ? data : (data?.prices || []);
      const byAddress = new Map(rows.map(row => [String(row.id || row.address || '').toLowerCase(), row]));
      chunk.forEach(item => {
        const row = byAddress.get(item.address.toLowerCase());
        if (row) results[item.index] = normalizeToken(row, chain, item.address);
      });
    }
  }
  return results;
}

module.exports = { resolveToken, getPrice: resolveToken, getPrices };
