'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { calculateStatistics, calculateMaxDrawdown } = require('../src/analytics');

test('advanced statistics calculate trading edge correctly', () => {
  const trades = [
    { side: 'BUY', feeUsd: 1, createdAt: '2026-01-01' },
    { side: 'SELL', pnlUsd: 100, feeUsd: 2, createdAt: '2026-01-02' },
    { side: 'SELL', pnlUsd: -40, feeUsd: 1, createdAt: '2026-01-03' },
    { side: 'SELL', pnlUsd: 60, feeUsd: 1, createdAt: '2026-01-04' }
  ];
  const result = calculateStatistics(trades, [{ equityUsd: 1000 }, { equityUsd: 1120 }]);
  assert.equal(result.winRate, 66.67);
  assert.equal(result.profitFactor, 4);
  assert.equal(result.expectancyUsd, 40);
  assert.equal(result.totalPnlUsd, 120);
  assert.equal(result.totalFeesUsd, 5);
  assert.equal(result.returnPct, 12);
});

test('maximum drawdown uses the highest previous equity peak', () => {
  assert.deepEqual(calculateMaxDrawdown([
    { equityUsd: 1000 }, { equityUsd: 1200 }, { equityUsd: 900 }, { equityUsd: 1100 }
  ]), { maxDrawdownUsd: 300, maxDrawdownPct: 25 });
});
