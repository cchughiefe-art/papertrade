const { CHAINS } = require('../chains');

const BASE =
  process.env.GECKOTERMINAL_BASE ||
  'https://api.geckoterminal.com/api/v2';

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

function num(value) {
  if (value == null || value === '') return null;

  const n = Number(value);

  return Number.isFinite(n) ? n : null;
}

function fromToken(chain, token, pool) {
  const attributes = token?.attributes || {};
  const poolAttributes = pool?.attributes || {};

  const volume =
    poolAttributes.volume_usd &&
    poolAttributes.volume_usd.h24 != null
      ? num(poolAttributes.volume_usd.h24)
      : null;

  const change =
    poolAttributes.price_change_percentage &&
    poolAttributes.price_change_percentage.h24 != null
      ? num(poolAttributes.price_change_percentage.h24)
      : null;

  return {
    chain,
    address: attributes.address,
    name: attributes.name || null,
    symbol: attributes.symbol || null,
    priceUsd: num(attributes.price_usd),

    marketCapUsd:
      num(attributes.market_cap_usd) ??
      num(attributes.fdv_usd),

    liquidityUsd:
      num(attributes.total_reserve_in_usd),

    volume24hUsd: volume,
    priceChange24h: change,

    pairAddress:
      pool && pool.id
        ? String(pool.id).split('_').pop()
        : null,

    dex:
      pool &&
      pool.relationships &&
      pool.relationships.dex &&
      pool.relationships.dex.data
        ? pool.relationships.dex.data.id
        : null,

    updatedAt: Math.floor(Date.now() / 1000)
  };
}

async function getTokenData(chain, address) {
  const config = CHAINS[chain];

  if (!config) {
    throw new Error('Unsupported chain');
  }

  const network = config.providers.gecko;

  const data = await fetchJson(
    `${BASE}/networks/${network}/tokens/${encodeURIComponent(
      address
    )}?include=top_pools`
  );

  const pools = (data.included || []).filter(
    item => item.type === 'pool'
  );

  const pool = pools[0] || null;

  const token = fromToken(chain, data.data, pool);

  return token.priceUsd != null ? token : null;
}

async function getPrice(chain, address) {
  const config = CHAINS[chain];

  if (!config) {
    throw new Error('Unsupported chain');
  }

  const network = config.providers.gecko;

  const data = await fetchJson(
    `${BASE}/networks/${network}/tokens/${encodeURIComponent(
      address
    )}/price`
  );

  const price =
    data.data &&
    data.data.attributes
      ? Number(data.data.attributes.price_in_usd)
      : null;

  if (!Number.isFinite(price)) {
    return null;
  }

  return {
    priceUsd: price,
    updatedAt: Math.floor(Date.now() / 1000),
    source: 'geckoterminal'
  };
}

async function resolveToken(address) {
  const data = await fetchJson(
    `${BASE}/search?query=${encodeURIComponent(address)}`
  );

  const pools = (data.data || []).filter(
    item => item.type === 'pool'
  );

  const best = new Map();

  for (const pool of pools) {
    const relationships = pool.relationships || {};

    const baseToken =
      relationships.base_token &&
      relationships.base_token.data;

    if (!baseToken) continue;

    const parts = String(baseToken.id).split('_');

    if (parts.length < 2) continue;

    if (
      String(parts[1]).toLowerCase() !==
      String(address).toLowerCase()
    ) {
      continue;
    }

    const network = parts[0];

    const chain = Object.keys(CHAINS).find(
      key => CHAINS[key].providers.gecko === network
    );

    if (!chain) continue;

    const liquidity =
      pool.attributes &&
      pool.attributes.reserve_in_usd
        ? Number(pool.attributes.reserve_in_usd)
        : 0;

    const previous = best.get(chain);

    if (!previous || liquidity > previous.liquidity) {
      best.set(chain, {
        liquidity,
        token: {
          chain,
          address,

          name: null,
          symbol: null,

          priceUsd:
            pool.attributes &&
            pool.attributes.base_token_price_usd
              ? Number(
                  pool.attributes.base_token_price_usd
                )
              : null,

          marketCapUsd: null,
          liquidityUsd: liquidity || null,

          volume24hUsd:
            pool.attributes &&
            pool.attributes.volume_usd
              ? num(pool.attributes.volume_usd.h24)
              : null,

          priceChange24h:
            pool.attributes &&
            pool.attributes.price_change_percentage
              ? num(
                  pool.attributes
                    .price_change_percentage.h24
                )
              : null,

          pairAddress:
            pool.attributes
              ? pool.attributes.address
              : null,

          dex:
            relationships.dex &&
            relationships.dex.data
              ? relationships.dex.data.id
              : null,

          updatedAt: Math.floor(Date.now() / 1000)
        }
      });
    }
  }

  return [...best.values()]
    .map(item => item.token)
    .filter(token => token.priceUsd != null)
    .sort(
      (a, b) =>
        (b.liquidityUsd || 0) -
        (a.liquidityUsd || 0)
    );
}

module.exports = {
  resolveToken,
  getTokenData,
  getPrice
};
