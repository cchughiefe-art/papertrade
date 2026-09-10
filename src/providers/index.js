const dexscreener = require('./dexscreener');
const gecko = require('./geckoterminal');
const robinhood = require('./robinhood');
const paprika = require('./dexpaprika');

const cache = new Map();
const pendingPrices = new Map();
let pendingTimer = null;

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
  if (Date.now() > item.staleUntil) {
    cache.delete(k);
    return null;
  }
  return Date.now() <= item.expires ? item.value : null;
}

function getStale(k) { const item = cache.get(k); return item && Date.now() <= item.staleUntil ? item.value : null; }

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

  if (!cleanChain || cleanChain === 'robinhood') {
    try {
      const token = await robinhood.resolveToken(cleanAddress);
      if (token) return token;
    } catch (_) {}
    if (cleanChain === 'robinhood') throw new Error('Robinhood Stock Token not found');
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
        return await paprika.resolveToken(cleanChain, cleanAddress);
      } catch (_) {
        return null;
      }
    },
    async () => {
      try { return await gecko.resolveToken(cleanChain, cleanAddress); } catch (_) { return null; }
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
  return (await getPrices([{ chain, address }]))[0] || null;
}

function queuePrice(token) {
  const k = key(token?.chain, token?.address);
  const cached = getCached(k);
  if (isUsablePrice(cached)) return Promise.resolve(cached);
  return new Promise(resolve => {
    const entry = pendingPrices.get(k) || { token: { chain: token?.chain, address: token?.address }, waiters: [] };
    entry.waiters.push(resolve); pendingPrices.set(k, entry);
    if (!pendingTimer) pendingTimer = setTimeout(flushPriceQueue, 25);
  });
}

async function flushPriceQueue() {
  pendingTimer = null;
  const entries = [...pendingPrices.entries()];
  pendingPrices.clear();
  const tokens = entries.map(([, entry]) => entry.token);
  const values = new Array(tokens.length).fill(null);
  const robinhoodItems = [], dexItems = [];
  tokens.forEach((token, index) => (String(token.chain).toLowerCase() === 'robinhood' ? robinhoodItems : dexItems).push({ ...token, index }));
  if (dexItems.length) try { (await dexscreener.getPrices(dexItems)).forEach((value, i) => { values[dexItems[i].index] = value; }); } catch (_) {}
  if (robinhoodItems.length) try { (await robinhood.getPrices(robinhoodItems)).forEach((value, i) => { values[robinhoodItems[i].index] = value; }); } catch (_) {}
  const paprikaItems = dexItems.filter(item => !isUsablePrice(values[item.index]));
  if (paprikaItems.length) try { (await paprika.getPrices(paprikaItems)).forEach((value, i) => { if (value) values[paprikaItems[i].index] = value; }); } catch (_) {}
  const geckoItems = dexItems.filter(item => !isUsablePrice(values[item.index]));
  let cursor = 0;
  async function geckoWorker() { while (cursor < geckoItems.length) { const item = geckoItems[cursor++]; try { values[item.index] = await gecko.getPrice(item.address, item.chain); } catch (_) {} } }
  await Promise.all(Array.from({ length: Math.min(3, geckoItems.length) }, geckoWorker));
  entries.forEach(([k, entry], index) => {
    let value = values[index];
    const stale = getStale(k);
    if (isUsablePrice(value) && stale) value = { ...stale, ...value };
    if (isUsablePrice(value)) setCached(k, value, PRICE_TTL);
    else if (stale) value = { ...stale, stale: true };
    else value = null;
    entry.waiters.forEach(resolve => resolve(value));
  });
}

async function getPrices(tokens) {
  return Promise.all((Array.isArray(tokens) ? tokens : []).map(queuePrice));
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
    const [dexResults, robinhoodResults] = await Promise.allSettled([
      dexscreener.searchTokens(clean),
      robinhood.searchTokens(clean)
    ]);
    results = [
      ...(robinhoodResults.status === 'fulfilled' ? robinhoodResults.value : []),
      ...(dexResults.status === 'fulfilled' ? dexResults.value : [])
    ];
    if (dexResults.status === 'rejected' && robinhoodResults.status === 'rejected') providerError = dexResults.reason;
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

function getProviderStatus() {
  return {
    cacheEntries: cache.size,
    queuedPrices: pendingPrices.size,
    providers: [
      { name: 'DexScreener', role: 'primary', status: 'ready' },
      { name: 'DexPaprika', role: 'fallback', status: 'ready' },
      { name: 'GeckoTerminal', role: 'fallback', status: 'ready' },
      { name: 'Robinhood', role: 'stock tokens', status: 'ready' }
    ]
  };
}

module.exports = {
  resolveToken,
  getPrice,
  getPrices,
  getSolPrice,
  searchTokens,
  getTrending,
  getProviderStatus
};
