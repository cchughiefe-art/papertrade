const BASE_URL =
  process.env.GECKOTERMINAL_BASE_URL ||
  'https://api.geckoterminal.com/api/v2';

const NETWORKS = {
  solana: 'solana',
  ethereum: 'eth',
  base: 'base',
  bsc: 'bsc',
  arbitrum: 'arbitrum',
  polygon: 'polygon_pos',
  avalanche: 'avax'
};

async function fetchJson(url) {
  const res = await fetch(url, {
    headers: {
      accept: 'application/json;version=20230203',
      'user-agent': 'PaperTrade/1.0'
    }
  });

  if (!res.ok) {
    throw new Error(`GeckoTerminal HTTP ${res.status}`);
  }

  return res.json();
}

function normalize(pool, network, address) {
  const a = pool?.attributes || {};

  const price = Number(
    a.base_token_price_usd ||
    a.quote_token_price_usd
  );

  if (!Number.isFinite(price) || price <= 0) {
    return null;
  }

  return {
    chain: network,
    address:
      address ||
      pool?.relationships?.base_token?.data?.id
        ?.split('_')
        .pop(),
    name: a.name || 'Unknown Token',
    symbol: a.symbol || 'UNKNOWN',
    priceUsd: price,
    marketCapUsd:
      Number(
        a.market_cap_usd ||
        a.fdv_usd ||
        0
      ) || 0,
    liquidityUsd:
      Number(
        a.reserve_in_usd ||
        a.total_reserve_in_usd ||
        0
      ) || 0,
    volume24hUsd:
      Number(a.volume_usd?.h24 || 0) || 0,
    priceChange24h:
      Number(
        a.price_change_percentage?.h24 || 0
      ) || 0,
    pairAddress:
      a.address ||
      pool?.id?.split('_').pop() ||
      null,
    dex: 'GeckoTerminal',
    updatedAt: Date.now(),
    priceAvailable: true
  };
}

async function resolveToken(address, chainHint = null) {
  const networks =
    chainHint && NETWORKS[chainHint]
      ? [chainHint]
      : Object.keys(NETWORKS);

  for (const chain of networks) {
    const network = NETWORKS[chain];

    try {
      const url =
        `${BASE_URL}/networks/${network}/tokens/${encodeURIComponent(address)}/pools?page=1`;

      const data = await fetchJson(url);

      const pools = Array.isArray(data.data)
        ? data.data
        : [];

      const result = pools
        .map(pool =>
          normalize(pool, chain, address)
        )
        .filter(Boolean)
        .sort(
          (a, b) =>
            b.liquidityUsd - a.liquidityUsd ||
            b.volume24hUsd - a.volume24hUsd
        )[0];

      if (result) return result;
    } catch (_) {}
  }

  return null;
}

async function getPrice(address, chainHint = null) {
  return resolveToken(address, chainHint);
}

module.exports = {
  resolveToken,
  getPrice
};
