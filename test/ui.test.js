'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');

const root = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'public/index.html'), 'utf8');
const script = fs.readFileSync(path.join(root, 'public/app.js'), 'utf8');
const tick = () => new Promise((resolve) => setTimeout(resolve, 15));

test('primary UI actions call their matching APIs', async () => {
  const dom = new JSDOM(html, { url: 'https://papertrade.test', runScripts: 'dangerously', pretendToBeVisual: true });
  const { window } = dom;
  window.HTMLElement.prototype.scrollIntoView = () => {};
  window.crypto.randomUUID = () => 'test-session';
  let copied = '';
  window.navigator.clipboard = { writeText: async value => { copied = value; } };
  const calls = [];
  let hasPosition = false;
  let watchlisted = true;
  const token = { chain: 'solana', address: 'So11111111111111111111111111111111111111112', name: 'Wrapped SOL', symbol: 'SOL', priceUsd: 150, marketCapUsd: 1e9, liquidityUsd: 2e6, volume24hUsd: 1e6, priceChange24h: 2, updatedAt: Date.now() };
  const response = (data, ok = true) => Promise.resolve({ ok, status: ok ? 200 : 400, json: async () => data });
  window.fetch = async (url, options = {}) => {
    calls.push({ url, method: options.method || 'GET', body: options.body });
    if (url === '/api/config') return response({ config: { feePct: .25, slippagePct: .5 } });
    if (url === '/api/wallet') return response({ wallet: { cashUsd: 10000, positionValueUsd: 0, equityUsd: 10000, realizedPnlUsd: 0, unrealizedPnlUsd: 0, equitySol: 66.6667, solPriceUsd: 150 } });
    if (url === '/api/positions') return response({ positions: hasPosition ? [{ id: 1, chain: 'solana', tokenAddress: token.address, tokenName: token.name, symbol: token.symbol, quantity: 2, investedUsd: 200, costBasisUsd: 200, entryPriceUsd: 100, currentPriceUsd: 150, currentValueUsd: 300, unrealizedPnlUsd: 100, unrealizedPnlPct: 50, priceUpdatedAt: new Date().toISOString() }] : [] });
    if (url === '/api/trades') return response({ trades: [] });
    if (url === '/api/watchlist' && !options.method) return response({ tokens: watchlisted ? [{ id: 7, ...token }] : [] });
    if (url === '/api/watchlist/7' && options.method === 'DELETE') watchlisted = false;
    if (String(url).startsWith('/api/token/search')) return response({ results: [token] });
    if (String(url).startsWith('/api/price/')) return response({ price: token });
    if (url === '/api/buy') hasPosition = true;
    if (url === '/api/sell') hasPosition = false;
    return response({ ok: true });
  };
  window.eval(script);
  await tick();
  assert.equal(window.document.getElementById('wEquity').textContent, '$10,000.00');
  assert.match(window.document.getElementById('solValue').textContent, /1 SOL = \$150\.00/);

  window.document.getElementById('tokenInput').value = 'SOL';
  window.document.getElementById('searchForm').dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true }));
  await tick();
  assert.equal(window.document.getElementById('tSymbol').textContent, 'SOL');
  token.liquidityUsd = 7610;
  token.priceChange24h = 444.54;
  window.document.getElementById('searchForm').dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true }));
  await tick();
  assert.match(window.document.getElementById('riskWarnings').textContent, /below/);
  assert.doesNotMatch(window.document.getElementById('riskWarnings').textContent, /unavailable/);
  assert.match(window.document.getElementById('riskWarnings').textContent, /444\.5%/);

  window.document.getElementById('amountInput').value = '100';
  window.document.getElementById('buyBtn').click();
  window.document.getElementById('modalConfirm').click();
  await tick();
  assert.ok(calls.some((call) => call.url === '/api/buy' && call.method === 'POST'));
  window.document.querySelector('[data-tab="portfolio"]').click();
  assert.equal(window.document.querySelector('[data-view="portfolio"]').classList.contains('hidden'), false);
  assert.match(window.document.getElementById('positionsList').textContent, /Market cap/);
  window.document.querySelector('.copy-position').click();
  await tick();
  assert.equal(copied, token.address);

  window.document.querySelector('.sell-button').click();
  window.document.getElementById('modalConfirm').click();
  await tick();
  assert.ok(calls.some((call) => call.url === '/api/sell' && call.method === 'POST'));

  window.document.getElementById('depositBtn').click();
  window.document.getElementById('balanceAmount').value = '50';
  window.document.getElementById('modalConfirm').click();
  await tick();
  assert.ok(calls.some((call) => call.url === '/api/deposit' && call.method === 'POST'));

  window.document.getElementById('withdrawBtn').click();
  window.document.getElementById('balanceAmount').value = '20';
  window.document.getElementById('modalConfirm').click();
  await tick();
  assert.ok(calls.some((call) => call.url === '/api/withdraw' && call.method === 'POST'));

  window.document.getElementById('resetBtn').click();
  window.document.getElementById('modalConfirm').click();
  await tick();
  assert.ok(calls.some((call) => call.url === '/api/reset' && call.method === 'POST'));

  window.document.querySelector('[data-tab="discover"]').click();
  await tick();
  window.document.querySelector('.watch-remove').click();
  await tick();
  assert.ok(calls.some((call) => call.url === '/api/watchlist/7' && call.method === 'DELETE'));

  window.document.getElementById('authBtn').click();
  await tick();
  window.document.getElementById('forgotPassword').click();
  await tick();
  window.document.getElementById('recoveryEmail').value = 'user@example.com';
  window.document.getElementById('modalConfirm').click();
  await tick();
  assert.ok(calls.some((call) => call.url === '/api/auth/recover' && call.method === 'POST'));
  dom.window.close();
});
