'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { isValidAddress, isValidMarketToken, isResolvableAddress } = require('../src/chains');

test('market token validation accepts provider-discovered non-EVM chains', () => {
  assert.equal(isValidMarketToken('sui', `0x${'a'.repeat(64)}`), true);
  assert.equal(isValidMarketToken('ton', 'EQBynBO23ywHy_CgarY9NK9FTz0yDsG82PtcbSTQgGoXwiuA'), true);
  assert.equal(isValidMarketToken('tron', 'TJRyWwFs9wTFGZg3JbrVriFbNfCug5tDeC'), true);
});

test('market token validation rejects unsafe chain and address input', () => {
  assert.equal(isValidMarketToken('../evil', `0x${'a'.repeat(40)}`), false);
  assert.equal(isValidMarketToken('base', 'short'), false);
  assert.equal(isResolvableAddress('address with spaces and ?query=1'), false);
});

test('legacy auto-detection remains available for EVM and Solana', () => {
  assert.ok(isValidAddress(`0x${'b'.repeat(40)}`).includes('ethereum'));
  assert.deepEqual(isValidAddress('So11111111111111111111111111111111111111112'), ['solana']);
});
