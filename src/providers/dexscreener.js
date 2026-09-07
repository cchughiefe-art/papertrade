const BASE_URL = process.env.DEXSCREENER_BASE_URL || 'https://api.dexscreener.com/latest/dex';

async function fetchJson(url) {
  const res = await fetch(url, {
    headers: {
      'accept': 'application/json',
      'user-agent': 'PaperTrade/1.0'
    }
  });

  if (!res.ok) {
    throw new Error(`DexScreener HTTP ${res.status}`);
  }

  return res.json();
}

function normalizePair(pair) {
  if (!pair) return null;

  const base = pair.baseToken || {};
  const price = Number(pair.priceUsd);

  if (!base.address || !Number.isFinite(price) || price <= 0) {
    return null;
  }

  return {
    chain: pair.chainId || null,
    address: base.address,
    name: base.name || 'Unknown Token',
    symbol: base.symbol || 'UNKNOWN',
    priceUsd: price,
    marketCapUsd: Number(pair.marketCap || pair.fdv || 0) || 0,
    liquidityUsd: Number(pair.liquidity?.usd || 0) || 0,
    volume24hUsd: Number(pair.volume?.h24 || 0) || 0,
    priceChange24h: Number(pair.priceChange?.h24 || 0) || 0,
    pairAddress: pair.pairAddress || null,
    dex: pair.dexId || null,
    url: pair.url || null,
    updatedAt: Date.now()
  };
}

function bestPair(pairs) {
  if (!Array.isArray(pairs) || !pairs.length) return null;

  const valid = pairs
    .map(normalizePair)
    .filter(Boolean);

  valid.sort((a, b) => {
    if (b.liquidityUsd !== a.liquidityUsd) {
      return b.liquidityUsd - a.liquidityUsd;
    }

    return b.volume24hUsd - a.volume24hUsd;
  });

  return valid[0] || null;
}

async function resolveToken(address) {
  const clean = String(address || '').trim();

  if (!clean) return null;

  // Exact token lookup.
  try {
    const data = await fetchJson(
      `${BASE_URL}/tokens/${encodeURIComponent(clean)}`
    );

    const result = bestPair(data.pairs);

    if (result) return result;
  } catch (_) {}

  // Search endpoint catches tokens that are not returned by /tokens/:address.
  try {
    const data = await fetchJson(
      `${BASE_URL}/search/?q=${encodeURIComponent(clean)}`
    );

    const pairs = Array.isArray(data.pairs) ? data.pairs : [];

    const exact = pairs.filter(pair => {
      const base = pair.baseToken?.address || '';
      const quote = pair.quoteToken?.address || '';

      return (
        base.toLowerCase() === clean.toLowerCase() ||
        quote.toLowerCase() === clean.toLowerCase()
      );
    });

    const result = bestPair(exact.length ? exact : pairs);

    if (result) {
      // If the searched address was the quote token, normalize to it.
      const pair = pairs.find(p =>
        (p.baseToken?.address || '').toLowerCase() === clean.toLowerCase() ||
        (p.quoteToken?.address || '').toLowerCase() === clean.toLowerCase()
      );

      if (pair) {
        const normalized = normalizePair(pair);

        if (
          pair.quoteToken?.address?.toLowerCase() === clean.toLowerCase() &&
          pair.baseToken?.address?.toLowerCase() !== clean.toLowerCase()
        ) {
          return {
            ...result,
            address: clean
          };
        }

        return normalized || result;
      }

      return result;
    }
  } catch (_) {}

  return null;
}

async function getPrice(address) {
  return resolveToken(address);
}

module.exports = {
  resolveToken,
  getPrice
};
