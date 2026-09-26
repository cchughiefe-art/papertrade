'use strict';

const num = value => Number.isFinite(Number(value)) ? Number(value) : 0;
const round = (value, places = 2) => Math.round((num(value) + Number.EPSILON) * 10 ** places) / 10 ** places;

function calculateMaxDrawdown(history = []) {
  let peak = 0, maxDrawdownUsd = 0, maxDrawdownPct = 0;
  for (const point of history) {
    const equity = num(point.equityUsd);
    if (equity <= 0) continue;
    peak = Math.max(peak, equity);
    const drawdownUsd = peak - equity;
    const drawdownPct = peak ? drawdownUsd / peak * 100 : 0;
    if (drawdownPct > maxDrawdownPct) { maxDrawdownPct = drawdownPct; maxDrawdownUsd = drawdownUsd; }
  }
  return { maxDrawdownUsd: round(maxDrawdownUsd), maxDrawdownPct: round(maxDrawdownPct) };
}

function calculateStreaks(results) {
  let currentType = null, current = 0, bestWinStreak = 0, worstLossStreak = 0;
  for (const result of results) {
    const type = result > 0 ? 'win' : result < 0 ? 'loss' : 'flat';
    if (type === 'flat') { currentType = null; current = 0; continue; }
    current = type === currentType ? current + 1 : 1;
    currentType = type;
    if (type === 'win') bestWinStreak = Math.max(bestWinStreak, current);
    if (type === 'loss') worstLossStreak = Math.max(worstLossStreak, current);
  }
  return { bestWinStreak, worstLossStreak };
}

function calculateStatistics(trades = [], history = []) {
  const sells = trades.filter(t => String(t.side).toUpperCase() === 'SELL')
    .sort((a, b) => Date.parse(a.createdAt || 0) - Date.parse(b.createdAt || 0));
  const pnl = sells.map(t => num(t.pnlUsd));
  const wins = pnl.filter(v => v > 0), losses = pnl.filter(v => v < 0);
  const grossProfitUsd = wins.reduce((sum, v) => sum + v, 0);
  const grossLossUsd = Math.abs(losses.reduce((sum, v) => sum + v, 0));
  const totalPnlUsd = pnl.reduce((sum, v) => sum + v, 0);
  const firstEquity = num(history[0]?.equityUsd), lastEquity = num(history.at(-1)?.equityUsd);
  return {
    trades: trades.length, closedTrades: sells.length, wins: wins.length, losses: losses.length,
    breakEvenTrades: pnl.length - wins.length - losses.length,
    winRate: round(sells.length ? wins.length / sells.length * 100 : 0),
    totalPnlUsd: round(totalPnlUsd),
    totalFeesUsd: round(trades.reduce((sum, t) => sum + num(t.feeUsd), 0)),
    grossProfitUsd: round(grossProfitUsd), grossLossUsd: round(grossLossUsd),
    profitFactor: grossLossUsd > 0 ? round(grossProfitUsd / grossLossUsd) : grossProfitUsd > 0 ? null : 0,
    expectancyUsd: round(sells.length ? totalPnlUsd / sells.length : 0),
    averageWinUsd: round(wins.length ? grossProfitUsd / wins.length : 0),
    averageLossUsd: round(losses.length ? -grossLossUsd / losses.length : 0),
    payoffRatio: losses.length && wins.length ? round((grossProfitUsd / wins.length) / (grossLossUsd / losses.length)) : null,
    bestTradeUsd: round(pnl.length ? Math.max(...pnl) : 0), worstTradeUsd: round(pnl.length ? Math.min(...pnl) : 0),
    returnPct: round(firstEquity > 0 ? (lastEquity - firstEquity) / firstEquity * 100 : 0),
    ...calculateMaxDrawdown(history), ...calculateStreaks(pnl)
  };
}

module.exports = { calculateStatistics, calculateMaxDrawdown };
