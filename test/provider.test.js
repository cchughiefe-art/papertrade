'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

test('price cache keeps different tokens isolated', async () => {
  const originalFetch = global.fetch;
  const seen = [];
  global.fetch = async (url) => {
    seen.push(url);
    const address = decodeURIComponent(String(url).split('/').pop());
    const value = address === 'TokenAddressOne' ? '1.25' : '9.75';
    return { ok: true, json: async () => [{ chainId: 'solana', pairAddress: `pair-${address}`, priceUsd: value, priceNative: value, baseToken: { address, name: address, symbol: address.slice(-3) }, quoteToken: { address: 'USDC', name: 'USD Coin', symbol: 'USDC' }, liquidity: { usd: 100000 }, volume: { h24: 50000 }, priceChange: { h24: 1 } }] };
  };
  delete require.cache[require.resolve('../src/providers')];
  const provider = require('../src/providers');
  try {
    const first = await provider.getPrice('solana', 'TokenAddressOne');
    const second = await provider.getPrice('solana', 'TokenAddressTwo');
    assert.equal(first.priceUsd, 1.25);
    assert.equal(second.priceUsd, 9.75);
    assert.equal(seen.length, 2);
  } finally { global.fetch = originalFetch; }
});

test('batch prices use one request for tokens on the same chain', async () => {
  const originalFetch = global.fetch;
  const seen = [];
  global.fetch = async (url) => {
    seen.push(String(url));
    const tail = decodeURIComponent(String(url).split('/').pop());
    const addresses = tail.split(',');
    return { ok: true, json: async () => addresses.map((address, index) => ({ chainId: 'base', pairAddress: `pair-${address}`, priceUsd: String(index + 2), priceNative: String(index + 2), baseToken: { address, name: address, symbol: `T${index}` }, quoteToken: { address: 'USDC', name: 'USD Coin', symbol: 'USDC' }, liquidity: { usd: 100000 - index }, volume: { h24: 50000 }, priceChange: { h24: 1 } })) };
  };
  delete require.cache[require.resolve('../src/providers')];
  delete require.cache[require.resolve('../src/providers/dexscreener')];
  const provider = require('../src/providers');
  try {
    const results = await provider.getPrices([{ chain: 'base', address: 'BatchOne' }, { chain: 'base', address: 'BatchTwo' }]);
    assert.deepEqual(results.map(item => item.priceUsd), [2, 3]);
    assert.equal(seen.length, 1);
    assert.match(seen[0], /BatchOne,BatchTwo$/);
  } finally { global.fetch = originalFetch; }
});

test('Robinhood Stock Token price applies the corporate-action multiplier', async () => {
  const originalFetch = global.fetch;
  const contract = '0x1Cdad396DB64BDa184d5182A97Dd9B3C62100b7D';
  global.fetch = async (url) => {
    if (String(url).endsWith('/assets')) return { ok: true, json: async () => ({ assets: [{ tokenSymbol: 'P', tokenName: 'Everpure · Robinhood Token', status: 'ASSET_STATUS_ACTIVE', currentMultiplier: '2', deployments: [{ contractAddress: contract, chainId: 4663 }] }] }) };
    return { ok: true, json: async () => ({ quotes: [{ tokenSymbol: 'P', bid: '10', ask: '12', dailyTradingVolume: '100', generatedAt: new Date().toISOString() }] }) };
  };
  delete require.cache[require.resolve('../src/providers/robinhood')];
  const robinhood = require('../src/providers/robinhood');
  try {
    const token = await robinhood.resolveToken(contract);
    assert.equal(token.chain, 'robinhood');
    assert.equal(token.priceUsd, 22);
    assert.equal(token.address, contract);
    assert.equal(token.assetType, 'stock_token');
  } finally { global.fetch = originalFetch; }
});
