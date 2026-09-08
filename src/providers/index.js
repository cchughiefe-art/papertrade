const dexscreener = require('./dexscreener');
const gecko = require('./geckoterminal');

const cache = new Map();
const inFlight = new Map();

const PRICE_TTL = 15000;
const STALE_TTL = 120000;
const TOKEN_TTL = 30000;
const MISS_TTL = 5000;

function key(chain, address) {
  return `${chain || 'auto'}:${String(address).toLowerCase()}`;
}

function getCached(k) {
  const item = cache.get(k);
  if (!item) return null;
  if (Date.now() > item.expires) {
    cache.delete(k);
    return null;
  }
  return item.value;
}

function setCached(k, value, ttl) {
  cache.set(k, { value, expires: Date.now() + ttl, staleUntil: Date.now() + STALE_TTL });
  if (cache.size > 2000) {
    const first = cache.keys().next().value;
    if (first) cache.delete(first);
  }
}

function isUsablePrice(value) {
  return value && Number.isFinite(Number(value.priceUsd)) && Number(value.priceUsd) > 0;
}

async function resolveToken(chain, address) {
  const cleanChain = String(chain || '').trim().toLowerCase();
  const cleanAddress = String(address || '').trim();

  if (!cleanAddress) {
    throw new Error('Token address required');
  }

  const providers = [
    async () => {
      try {
        return await dexscreener.resolveToken(cleanChain, cleanAddress);
      } catch (_) {
        return null;
      }
    },
    async () => {
      try {
        return await gecko.resolveToken(cleanChain, cleanAddress);
      } catch (_) {
        return null;
      }
    }
  ];

  for (const provider of providers) {
    const token = await provider();
    if (token && typeof token === 'object') {
      const price = Number(token.priceUsd);
      return {
        ...token,
        priceUsd: Number.isFinite(price) && price > 0 ? price : 0,
        priceAvailable: Number.isFinite(price) && price > 0
      };
    }
  }

  throw new Error('Token not found');
}

async function getPrice(chain, address) {
  const k = key(chain, address);
  const cached = getCached(k);
  if (isUsablePrice(cached)) return cached;

  if (inFlight.has(k)) return inFlight.get(k);
  const request = (async () => {
    let result = null;
    try { result = await dexscreener.getPrice(address, chain); } catch (_) {}

    if (!isUsablePrice(result)) {
      try { result = await gecko.getPrice(address, chain); } catch (_) {}
    }

    if (isUsablePrice(result)) { setCached(k, result, PRICE_TTL); return result; }
    const old = cache.get(k);
    return old && Date.now() <= old.staleUntil ? { ...old.value, stale: true } : null;
  })();
  inFlight.set(k, request);
  try { return await request; } finally { inFlight.delete(k); }
}

async function getPrices(tokens) {
  const input = Array.isArray(tokens) ? tokens : [];
  const results = new Array(input.length);
  const missing = [];
  input.forEach((token, index) => {
    const cached = getCached(key(token?.chain, token?.address));
    if (isUsablePrice(cached)) results[index] = cached;
    else missing.push({ ...token, index });
  });
  if (missing.length) {
    let bulk = [];
    try { bulk = await dexscreener.getPrices(missing); } catch (_) {}
    await Promise.all(missing.map(async (token, i) => {
      let result = bulk[i];
      if (!isUsablePrice(result)) {
        try { result = await gecko.getPrice(token.address, token.chain); } catch (_) {}
      }
      if (isUsablePrice(result)) setCached(key(token.chain, token.address), result, PRICE_TTL);
      else {
        const old = cache.get(key(token.chain, token.address));
        if (old && Date.now() <= old.staleUntil) result = { ...old.value, stale: true };
      }
      results[token.index] = isUsablePrice(result) ? result : null;
    }));
  }
  return results;
}

async function searchTokens(query) {
  const clean = String(query || '').trim();
  if (!clean) return [];

  const cacheKey = `search:${clean.toLowerCase()}`;
  const cached = getCached(cacheKey);
  if (Array.isArray(cached)) return cached;

  let results = null;
  let providerError = null;

  try {
    results = await dexscreener.searchTokens(clean);
  } catch (error) {
    providerError = error;
  }

  if (providerError) {
    throw new Error('Token search provider is temporarily unavailable');
  }

  const usable = Array.isArray(results)
    ? results.filter(item => item && item.chain && item.address && item.name && item.symbol)
    : [];

  setCached(cacheKey, usable, 5000);
  return usable;
}

async function getSolPrice() {
  const solMint = 'So11111111111111111111111111111111111111112';
  const result = await getPrice('solana', solMint);
  if (!isUsablePrice(result)) {
    throw new Error('Unable to get SOL price');
  }
  return Number(result.priceUsd);
}

async function getTrending() {
  const cached = getCached('trending');
  if (Array.isArray(cached)) return cached;
  const tokens = await dexscreener.getTrending();
  setCached('trending', tokens, 60000);
  return tokens;
}

module.exports = {
  resolveToken,
  getPrice,
  getPrices,
  getSolPrice,
  searchTokens,
  getTrending
};
