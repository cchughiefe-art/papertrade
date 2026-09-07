const dexscreener = require('./dexscreener');
const gecko = require('./geckoterminal');

const cache = new Map();

const PRICE_TTL = 6000;
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
  cache.set(k, {
    value,
    expires: Date.now() + ttl
  });

  if (cache.size > 2000) {
    const first = cache.keys().next().value;

    if (first) cache.delete(first);
  }
}

function isUsablePrice(value) {
  return (
    value &&
    Number.isFinite(Number(value.priceUsd)) &&
    Number(value.priceUsd) > 0
  );
}

async function resolveToken(address, chainHint = null) {
  const clean = String(address || '').trim();

  if (!clean) return null;

  const k = key(chainHint, clean);
  const cached = getCached(k);

  if (cached) return cached;

  let result = null;

  try {
    result = await dexscreener.resolveToken(
      clean,
      chainHint
    );
  } catch (_) {}

  if (!result) {
    try {
      result = await gecko.resolveToken(
        clean,
        chainHint
      );
    } catch (_) {}
  }

  /*
   * Pump.fun is a Solana launchpad.
   * Only use it as metadata fallback.
   * A zero price is never accepted as a tradable price.
   */
  if (
    !result &&
    (!chainHint || chainHint === 'solana')
  ) {
    try {
      const res = await fetch(
        `https://frontend-api.pump.fun/coins/${encodeURIComponent(clean)}`,
        {
          headers: {
            accept: 'application/json',
            'user-agent': 'PaperTrade/1.0'
          }
        }
      );

      if (res.ok) {
        const coin = await res.json();

        if (coin && coin.mint === clean) {
          result = {
            chain: 'solana',
            address: clean,
            name: coin.name || 'Unknown Token',
            symbol: coin.symbol || 'UNKNOWN',
            priceUsd: 0,
            marketCapUsd:
              Number(coin.usd_market_cap || 0) || 0,
            liquidityUsd: 0,
            volume24hUsd: 0,
            priceChange24h: 0,
            pairAddress: null,
            dex: 'Pump.fun',
            source: 'pump.fun',
            priceAvailable: false,
            updatedAt: Date.now()
          };
        }
      }
    } catch (_) {}
  }

  if (result) {
    setCached(
      k,
      result,
      result.priceAvailable === false
        ? TOKEN_TTL
        : PRICE_TTL
    );

    return result;
  }

  setCached(k, null, MISS_TTL);

  return null;
}

async function getPrice(chain, address) {
  const k = key(chain, address);
  const cached = getCached(k);

  if (isUsablePrice(cached)) {
    return cached;
  }

  let result = null;

  try {
    result = await dexscreener.getPrice(
      address,
      chain
    );
  } catch (_) {}

  if (!isUsablePrice(result)) {
    try {
      result = await gecko.getPrice(
        address,
        chain
      );
    } catch (_) {}
  }

  if (isUsablePrice(result)) {
    setCached(k, result, PRICE_TTL);
    return result;
  }

  return null;
}

async function getSolPrice() {
  const solMint =
    'So11111111111111111111111111111111111111112';

  const result = await getPrice(
    'solana',
    solMint
  );

  if (!isUsablePrice(result)) {
    throw new Error('Unable to get SOL price');
  }

  return Number(result.priceUsd);
}

module.exports = {
  resolveToken,
  getPrice,
  getSolPrice
};
