const BASE_URL = process.env.DEXSCREENER_BASE_URL || 'https://api.dexscreener.com';

async function fetchJson(url) {
  const res = await fetch(url, {
    headers: {
      accept: 'application/json',
      'user-agent': 'PaperTrade/1.0'
    }
  });

  if (!res.ok) {
    throw new Error(`DexScreener HTTP ${res.status}`);
  }

  return res.json();
}

function normalizePair(pair, targetAddress) {
  if (!pair) return null;

  const target = String(targetAddress || '').toLowerCase();
  const base = pair.baseToken || {};
  const quote = pair.quoteToken || {};

  const baseMatch =
    String(base.address || '').toLowerCase() === target;

  const quoteMatch =
    String(quote.address || '').toLowerCase() === target;

  let token = base;
  let price = Number(pair.priceUsd);

  if (quoteMatch && !baseMatch) {
    const basePrice = Number(pair.priceUsd);
    const priceNative = Number(pair.priceNative);

    if (
      Number.isFinite(basePrice) &&
      basePrice > 0 &&
      Number.isFinite(priceNative) &&
      priceNative > 0
    ) {
      price = basePrice / priceNative;
    }

    token = quote;
  }

  if (
    !token.address ||
    !Number.isFinite(price) ||
    price <= 0
  ) {
    return null;
  }

  return {
    chain: pair.chainId || null,
    address: token.address,
    name: token.name || 'Unknown Token',
    symbol: token.symbol || 'UNKNOWN',
    priceUsd: price,
    marketCapUsd:
      Number(pair.marketCap || pair.fdv || 0) || 0,
    liquidityUsd:
      Number(pair.liquidity?.usd || 0) || 0,
    volume24hUsd:
      Number(pair.volume?.h24 || 0) || 0,
    priceChange24h:
      Number(pair.priceChange?.h24 || 0) || 0,
    pairAddress: pair.pairAddress || null,
    dex: pair.dexId || null,
    url: pair.url || null,
    updatedAt: Date.now(),
    priceAvailable: true
  };
}

function bestPair(pairs, address) {
  if (!Array.isArray(pairs)) return null;

  return pairs
    .map(pair => normalizePair(pair, address))
    .filter(Boolean)
    .sort(
      (a, b) =>
        b.liquidityUsd - a.liquidityUsd ||
        b.volume24hUsd - a.volume24hUsd
    )[0] || null;
}

async function resolveToken(address, chainHint = null) {
  const clean = String(address || '').trim();

  if (!clean) return null;

  /*
   * Exact chain lookup.
   * This is especially important for Solana/Pump.fun tokens.
   */
  if (chainHint) {
    try {
      const data = await fetchJson(
        `${BASE_URL}/tokens/v1/${encodeURIComponent(chainHint)}/${encodeURIComponent(clean)}`
      );

      const result = bestPair(data, clean);

      if (result) return result;
    } catch (_) {}
  }

  /*
   * Search fallback.
   * Useful for freshly listed meme coins.
   */
  try {
    const data = await fetchJson(
      `${BASE_URL}/latest/dex/search?q=${encodeURIComponent(clean)}`
    );

    const pairs = Array.isArray(data.pairs)
      ? data.pairs
      : [];

    const exact = pairs.filter(pair => {
      const base =
        String(pair.baseToken?.address || '').toLowerCase();

      const quote =
        String(pair.quoteToken?.address || '').toLowerCase();

      return (
        base === clean.toLowerCase() ||
        quote === clean.toLowerCase()
      );
    });

    const result = bestPair(
      exact.length ? exact : pairs,
      clean
    );

    if (result) return result;
  } catch (_) {}

  /*
   * Legacy fallback.
   */
  try {
    const data = await fetchJson(
      `${BASE_URL}/latest/dex/tokens/${encodeURIComponent(clean)}`
    );

    const result = bestPair(data.pairs, clean);

    if (result) return result;
  } catch (_) {}

  return null;
}

async function getPrice(address, chainHint = null) {
  return resolveToken(address, chainHint);
}

module.exports = {
  resolveToken,
  getPrice
};
