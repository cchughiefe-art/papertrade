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
