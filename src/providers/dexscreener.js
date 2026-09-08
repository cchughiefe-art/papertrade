const BASE_URL =
  process.env.DEXSCREENER_BASE_URL ||
  'https://api.dexscreener.com';

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

function normalizePair(pair, address) {
  if (!pair) return null;

  const target = String(address).toLowerCase();
  const base = pair.baseToken || {};
  const quote = pair.quoteToken || {};

  const baseMatch =
    String(base.address || '').toLowerCase() === target;

  const quoteMatch =
    String(quote.address || '').toLowerCase() === target;

  if (!baseMatch && !quoteMatch) return null;

  let price = Number(pair.priceUsd);

  if (quoteMatch && !baseMatch) {
    const baseUsd = Number(pair.priceUsd);
    const nativePrice = Number(pair.priceNative);

    if (
      Number.isFinite(baseUsd) &&
      baseUsd > 0 &&
      Number.isFinite(nativePrice) &&
      nativePrice > 0
    ) {
      price = baseUsd / nativePrice;
    }
  }

  if (!Number.isFinite(price) || price <= 0) {
    return null;
  }

  const token = baseMatch ? base : quote;

  return {
    chain: pair.chainId || null,
    address: token.address,
    name: token.name || 'Unknown Token',
    symbol: token.symbol || 'UNKNOWN',
    logoUrl:
      pair.info?.imageUrl ||
      pair.info?.header ||
      null,
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
    source: 'dexscreener',
    priceAvailable: true,
    updatedAt: Date.now()
  };
}

function choose(pairs, address, chainHint) {
  if (!Array.isArray(pairs)) return null;

  return pairs
    .filter(pair => {
      if (!chainHint) return true;
      return pair.chainId === chainHint;
    })
    .map(pair => normalizePair(pair, address))
    .filter(Boolean)
    .sort(
      (a, b) =>
        b.liquidityUsd - a.liquidityUsd ||
        b.volume24hUsd - a.volume24hUsd
    )[0] || null;
}

async function resolveToken(chainHint = null, address) {
  const clean = String(address || '').trim();

  if (!clean) return null;

  if (chainHint) {
    try {
      const data = await fetchJson(
        `${BASE_URL}/tokens/v1/${encodeURIComponent(chainHint)}/${encodeURIComponent(clean)}`
      );

      const result = choose(
        data,
        clean,
        chainHint
      );

      if (result) return result;
    } catch (_) {}
  }

  try {
    const data = await fetchJson(
      `${BASE_URL}/latest/dex/search?q=${encodeURIComponent(clean)}`
    );

    const result = choose(
      data.pairs,
      clean,
      chainHint
    );

    if (result) return result;
  } catch (_) {}

  try {
    const data = await fetchJson(
      `${BASE_URL}/latest/dex/tokens/${encodeURIComponent(clean)}`
    );

    const result = choose(
      data.pairs,
      clean,
      chainHint
    );

    if (result) return result;
  } catch (_) {}

  return null;
}

async function searchTokens(query) {
  const clean = String(query || '').trim();

  if (!clean) return [];

  const data = await fetchJson(
    `${BASE_URL}/latest/dex/search?q=${encodeURIComponent(clean)}`
  );

  const pairs = Array.isArray(data?.pairs)
    ? data.pairs
    : [];

  const seen = new Set();

  return pairs
    .map(pair => {
      const base = pair.baseToken || {};
      const quote = pair.quoteToken || {};

      const baseAddress = String(base.address || '');
      const quoteAddress = String(quote.address || '');

      const baseSymbol = String(base.symbol || '');
      const quoteSymbol = String(quote.symbol || '');

      const q = clean.toLowerCase();

      const baseMatch =
        baseAddress.toLowerCase() === q ||
        baseSymbol.toLowerCase() === q ||
        String(base.name || '').toLowerCase().includes(q);

      const quoteMatch =
        quoteAddress.toLowerCase() === q ||
        quoteSymbol.toLowerCase() === q ||
        String(quote.name || '').toLowerCase().includes(q);

      const address =
        baseMatch ? baseAddress :
        quoteMatch ? quoteAddress :
        baseAddress;

      const token =
        baseMatch ? base :
        quoteMatch ? quote :
        base;

      const price = Number(pair.priceUsd);

      if (!address || !Number.isFinite(price) || price <= 0) {
        return null;
      }

      const key =
        `${pair.chainId || ''}:${address}`.toLowerCase();

      if (seen.has(key)) {
        return null;
      }

      seen.add(key);

      return {
        chain: pair.chainId || null,
        address,
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
        pairAddress:
          pair.pairAddress || null,
        dex:
          pair.dexId || null,
        url:
          pair.url || null,
        logoUrl:
          pair.info?.imageUrl ||
          pair.info?.header ||
          null,
        source: 'dexscreener',
        priceAvailable: true,
        updatedAt: Date.now()
      };
    })
    .filter(Boolean)
    .sort(
      (a, b) =>
        b.liquidityUsd - a.liquidityUsd ||
        b.volume24hUsd - a.volume24hUsd
    )
    .slice(0, 20);
}

async function getPrice(address, chainHint = null) {
  return resolveToken(chainHint, address);
}

async function getTrending() {
  const boosts = await fetchJson(`${BASE_URL}/token-boosts/top/v1`);
  const selected = Array.isArray(boosts) ? boosts.slice(0, 20) : [];
  const tokens = await Promise.all(selected.map(item =>
    resolveToken(item.chainId, item.tokenAddress).catch(() => null)
  ));
  return tokens.filter(Boolean).sort((a, b) => b.liquidityUsd - a.liquidityUsd).slice(0, 12);
}

module.exports = {
  resolveToken,
  getPrice,
  searchTokens,
  getTrending
};
