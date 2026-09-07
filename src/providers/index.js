const dexscreener = require('./dexscreener');
const geckoterminal = require('./geckoterminal');

const PRICE_TTL_MS = 6000;
const META_TTL_MS = 60000;
const NEG_TTL_MS = 15000;

const cache = new Map();

function cacheGet(key) {
  const entry = cache.get(key);

  if (!entry) return undefined;

  if (Date.now() > entry.expires) {
    cache.delete(key);
    return undefined;
  }

  return entry.value;
}

function cacheSet(key, value, ttl) {
  if (cache.size > 5000) {
    cache.clear();
  }

  cache.set(key, {
    value,
    expires: Date.now() + ttl
  });
}

async function firstOk(functions) {
  let lastError;

  for (const fn of functions) {
    try {
      const value = await fn();

      if (value != null) {
        return value;
      }
    } catch (error) {
      lastError = error;
    }
  }

  if (lastError) {
    throw lastError;
  }

  return null;
}

async function resolveToken(address) {
  const key = `resolve:${address.toLowerCase()}`;

  const cached = cacheGet(key);

  if (cached !== undefined) {
    return cached;
  }

  try {
    const result = await firstOk([
      () => dexscreener.resolveToken(address),
      () => geckoterminal.resolveToken(address)
    ]);

    cacheSet(key, result, META_TTL_MS);

    return result;
  } catch {
    cacheSet(key, null, NEG_TTL_MS);
    return null;
  }
}

async function getTokenData(chain, address) {
  const key =
    `token:${chain}:${address.toLowerCase()}`;

  const cached = cacheGet(key);

  if (cached !== undefined) {
    return cached;
  }

  try {
    const result = await firstOk([
      () =>
        dexscreener.getTokenData(
          chain,
          address
        ),

      () =>
        geckoterminal.getTokenData(
          chain,
          address
        )
    ]);

    cacheSet(key, result, META_TTL_MS);

    return result;
  } catch {
    return null;
  }
}

async function getPrice(chain, address) {
  const key =
    `price:${chain}:${address.toLowerCase()}`;

  const cached = cacheGet(key);

  if (cached !== undefined) {
    return cached;
  }

  try {
    const result = await firstOk([
      () =>
        dexscreener.getPrice(
          chain,
          address
        ),

      () =>
        geckoterminal.getPrice(
          chain,
          address
        )
    ]);

    cacheSet(
      key,
      result,
      result ? PRICE_TTL_MS : NEG_TTL_MS
    );

    return result;
  } catch {
    return null;
  }
}

module.exports = {
  resolveToken,
  getTokenData,
  getPrice
};
