const { CHAINS } = require('../chains');

const BASE =
  process.env.DEXSCREENER_BASE ||
  'https://api.dexscreener.com/latest/dex';

async function fetchJson(url, timeoutMs = 8000) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        accept: 'application/json'
      }
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    return await response.json();
  } finally {
    clearTimeout(timeout);
  }
}

function normalizePair(chainKey, pair) {
  const chain = CHAINS[chainKey];

  if (!chain || !pair || !pair.baseToken) {
    return null;
  }

  return {
    chain: chainKey,
    address: pair.baseToken.address,
    name: pair.baseToken.name || null,
    symbol: pair.baseToken.symbol || null,
    priceUsd: pair.priceUsd ? Number(pair.priceUsd) : null,
    marketCapUsd:
      pair.marketCap != null
        ? Number(pair.marketCap)
        : pair.fdv != null
          ? Number(pair.fdv)
          : null,
    liquidityUsd:
      pair.liquidity && pair.liquidity.usd != null
        ? Number(pair.liquidity.usd)
        : null,
    volume24hUsd:
      pair.volume && pair.volume.h24 != null
        ? Number(pair.volume.h24)
        : null,
    priceChange24h:
      pair.priceChange && pair.priceChange.h24 != null
        ? Number(pair.priceChange.h24)
        : null,
    pairAddress: pair.pairAddress || null,
    dex: pair.dexId || null,
    updatedAt: Math.floor(Date.now() / 1000)
  };
}

function bestPairPerChain(pairs, address) {
  const result = new Map();

  for (const pair of pairs || []) {
    if (!pair.baseToken) continue;

    if (
      String(pair.baseToken.address).toLowerCase() !==
      String(address).toLowerCase()
    ) {
      continue;
    }

    const chainKey = pair.chainId;

    if (!CHAINS[chainKey]) continue;

    const liquidity =
      pair.liquidity && pair.liquidity.usd
        ? Number(pair.liquidity.usd)
        : 0;

    const previous = result.get(chainKey);

    const previousLiquidity =
      previous &&
      previous.liquidity &&
      previous.liquidity.usd
        ? Number(previous.liquidity.usd)
        : 0;

    if (!previous || liquidity > previousLiquidity) {
      result.set(chainKey, pair);
    }
  }

  return result;
}

async function resolveToken(address) {
  const data = await fetchJson(`${BASE}/tokens/${address}`);

  const pairs = bestPairPerChain(data.pairs, address);

  const results = [];

  for (const [chainKey, pair] of pairs) {
    const token = normalizePair(chainKey, pair);

    if (token && token.priceUsd != null) {
      results.push(token);
    }
  }

  results.sort(
    (a, b) =>
      (b.liquidityUsd || 0) -
      (a.liquidityUsd || 0)
  );

  return results;
}

async function getTokenData(chain, address) {
  const config = CHAINS[chain];

  if (!config) {
    throw new Error('Unsupported chain');
  }

  const data = await fetchJson(`${BASE}/tokens/${address}`);

  const pairs = bestPairPerChain(data.pairs, address);

  const pair = pairs.get(config.providers.dexscreener);

  if (!pair) return null;

  return normalizePair(chain, pair);
}

async function getPrice(chain, address) {
  const token = await getTokenData(chain, address);

  if (!token || token.priceUsd == null) {
    return null;
  }

  return {
    priceUsd: token.priceUsd,
    updatedAt: token.updatedAt,
    source: 'dexscreener'
  };
}

module.exports = {
  resolveToken,
  getTokenData,
  getPrice
};
