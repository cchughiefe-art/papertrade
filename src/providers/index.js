const dexscreener = require('./dexscreener');
const gecko = require('./geckoterminal');

const priceCache = new Map();
const metadataCache = new Map();

const PRICE_TTL = 6000;
const METADATA_TTL = 60000;
const NEGATIVE_TTL = 10000;

function cacheKey(chain, address) {
  return `${chain || 'auto'}:${String(address).toLowerCase()}`;
}

function cached(map, key) {
  const item = map.get(key);

  if (!item) return null;

  if (Date.now() - item.time > item.ttl) {
    map.delete(key);
    return null;
  }

  return item.value;
}

function put(map, key, value, ttl) {
  map.set(key, {
    value,
    time: Date.now(),
    ttl
  });

  if (map.size > 5000) {
    const first = map.keys().next().value;
    map.delete(first);
  }
}

function parseMeta(html) {
  if (!html) return null;

  const get = name => {
    const re = new RegExp(
      `<meta[^>]+(?:property|name)=["']${name}["'][^>]+content=["']([^"']*)["']`,
      'i'
    );

    return html.match(re)?.[1] || null;
  };

  const title = get('og:title') || get('twitter:title');
  const description = get('og:description') || get('twitter:description');

  if (!title && !description) return null;

  let name = title || 'Pump.fun Token';
  let symbol = 'UNKNOWN';

  const match = name.match(/^(.*?)\s*\$([A-Za-z0-9_]+)(?:\s|$)/);

  if (match) {
    name = match[1].trim();
    symbol = match[2];
  }

  return {
    name,
    symbol
  };
}

async function pumpFunFallback(address) {
  try {
    const url =
      `https://pump.fun/explore?outputCurrency=${encodeURIComponent(address)}`;

    const res = await fetch(url, {
      headers: {
        accept: 'text/html',
        'user-agent': 'PaperTrade/1.0'
      }
    });

    if (!res.ok) return null;

    const html = await res.text();
    const meta = parseMeta(html);

    if (!meta) return null;

    return {
      chain: 'solana',
      address,
      name: meta.name,
      symbol: meta.symbol,
      priceUsd: 0,
      marketCapUsd: 0,
      liquidityUsd: 0,
      volume24hUsd: 0,
      priceChange24h: 0,
      pairAddress: null,
      dex: 'Pump.fun',
      source: 'pump.fun',
      priceAvailable: false,
      updatedAt: Date.now()
    };
  } catch (_) {
    return null;
  }
}

async function resolveToken(address, chainHint = null) {
  const clean = String(address || '').trim();

  if (!clean) return null;

  const key = cacheKey(chainHint, clean);

  const cachedValue = cached(metadataCache, key);

  if (cachedValue) {
    return cachedValue;
  }

  // 1. DexScreener.
  try {
    const result = await dexscreener.resolveToken(clean);

    if (result) {
      put(metadataCache, key, result, METADATA_TTL);
      put(priceCache, key, result, PRICE_TTL);
      return result;
    }
  } catch (_) {}

  // 2. GeckoTerminal.
  try {
    const result = await gecko.resolveToken(clean, chainHint);

    if (result) {
      put(metadataCache, key, result, METADATA_TTL);
      put(priceCache, key, result, PRICE_TTL);
      return result;
    }
  } catch (_) {}

  // 3. Pump.fun for Solana addresses.
  if (!chainHint || chainHint === 'solana') {
    const pump = await pumpFunFallback(clean);

    if (pump) {
      put(metadataCache, key, pump, METADATA_TTL);
      return pump;
    }
  }

  put(metadataCache, key, null, NEGATIVE_TTL);

  return null;
}

async function getPrice(chain, address) {
  const key = cacheKey(chain, address);

  const existing = cached(priceCache, key);

  if (existing && existing.priceAvailable !== false) {
    return existing;
  }

  // DexScreener first.
  try {
    const result = await dexscreener.getPrice(address);

    if (result) {
      put(priceCache, key, result, PRICE_TTL);
      put(metadataCache, key, result, METADATA_TTL);
      return result;
    }
  } catch (_) {}

  // GeckoTerminal fallback.
  try {
    const result = await gecko.getPrice(address, chain);

    if (result) {
      put(priceCache, key, result, PRICE_TTL);
      put(metadataCache, key, result, METADATA_TTL);
      return result;
    }
  } catch (_) {}

  return null;
}

async function getSolPrice() {
  const solMint =
    'So11111111111111111111111111111111111111112';

  const result = await getPrice('solana', solMint);

  if (!result || !Number.isFinite(Number(result.priceUsd))) {
    throw new Error('Unable to get SOL price');
  }

  return Number(result.priceUsd);
}

module.exports = {
  resolveToken,
  getPrice,
  getSolPrice
};
