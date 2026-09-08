const {
  getOrCreateWallet,
  updateCash,
  addBalance,
  getBalanceTransactions,
  initDb,
  STARTING_BALANCE,
  query,
  one,
  many,
  pool
} = require('../database/db');

const DEFAULT_FEE_PCT = 0.25;
const DEFAULT_SLIPPAGE_PCT = 0.50;

function roundMoney(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

function roundQuantity(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  return Math.round((n + Number.EPSILON) * 1e12) / 1e12;
}

function cleanPct(value, fallback) {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0 || n > 100) return fallback;
  return n;
}

function getFeePct(data = {}) {
  return cleanPct(
    data.feePct ?? data.feePercent ?? process.env.PAPERTRADE_FEE_PCT,
    DEFAULT_FEE_PCT
  );
}

function getSlippagePct(data = {}) {
  return cleanPct(
    data.slippagePct ?? data.slippagePercent ?? process.env.PAPERTRADE_SLIPPAGE_PCT,
    DEFAULT_SLIPPAGE_PCT
  );
}

function executionPrice(marketPrice, side, slippagePct) {
  const price = Number(marketPrice);
  const slippage = Number(slippagePct) / 100;
  if (!Number.isFinite(price) || price <= 0) throw new Error('Invalid market price');
  if (!Number.isFinite(slippage) || slippage < 0 || slippage > 1) throw new Error('Invalid slippage');
  return side === 'BUY' ? price * (1 + slippage) : price * (1 - slippage);
}

function mapPosition(row) {
  if (!row) return null;
  const quantity = Number(row.quantity ?? row.total_quantity ?? 0);
  const costBasis = Number(row.cost_basis_usd ?? row.invested_usd ?? 0);
  const averageEntry = quantity > 0 ? costBasis / quantity : Number(row.entry_price_usd || 0);
  return {
    id: row.id,
    sessionId: row.session_id,
    chain: row.chain,
    tokenAddress: row.token_address,
    tokenName: row.token_name,
    symbol: row.symbol,
    entryPriceUsd: roundMoney(averageEntry),
    averageEntryPriceUsd: roundMoney(averageEntry),
    quantity: roundQuantity(quantity),
    totalQuantity: roundQuantity(Number(row.total_quantity ?? quantity)),
    investedUsd: roundMoney(Number(row.invested_usd ?? costBasis)),
    costBasisUsd: roundMoney(costBasis),
    openedAt: row.opened_at,
    updatedAt: row.updated_at || row.opened_at
  };
}

async function getPositions(sessionId) {
  await initDb();
  const rows = await many(
    `SELECT * FROM positions WHERE session_id = $1 AND quantity > 0 ORDER BY id DESC`,
    [sessionId]
  );
  const list = Array.isArray(rows) ? rows : [];
  return list.map(mapPosition);
}

async function getPosition(sessionId, id) {
  await initDb();
  const row = await one(
    `SELECT * FROM positions WHERE session_id = $1 AND id = $2`,
    [sessionId, id]
  );
  return mapPosition(row);
}

async function getTrades(sessionId) {
  await initDb();
  const rows = await many(
    `SELECT * FROM trades WHERE session_id = $1 ORDER BY id DESC`,
    [sessionId]
  );
  return rows.map((row) => ({
    id: row.id,
    sessionId: row.session_id,
    chain: row.chain,
    tokenAddress: row.token_address,
    tokenName: row.token_name,
    symbol: row.symbol,
    side: row.side,
    priceUsd: Number(row.execution_price_usd ?? row.price_usd ?? 0),
    marketPriceUsd: Number(row.market_price_usd ?? row.price_usd ?? 0),
    executionPriceUsd: Number(row.execution_price_usd ?? row.price_usd ?? 0),
    quantity: Number(row.quantity || 0),
    amountUsd: Number(row.amount_usd || 0),
    feeUsd: Number(row.fee_usd || 0),
    slippagePct: Number(row.slippage_pct || 0),
    pnlUsd: Number(row.pnl_usd || 0),
    source: row.source || null,
    createdAt: row.created_at
  }));
}

async function calculateValuation(sessionId, prices = {}) {
  const positions = await getPositions(sessionId);
  let positionValueUsd = 0;
  let unrealizedPnlUsd = 0;

  for (const position of positions) {
    const key = `${position.chain}:${position.tokenAddress}`.toLowerCase();
    const suppliedPrice =
      prices[key] ?? prices[position.tokenAddress] ?? prices[position.tokenAddress?.toLowerCase()];
    const price = Number(suppliedPrice);
    if (!Number.isFinite(price) || price <= 0) continue;
    const value = position.quantity * price;
    positionValueUsd += value;
    unrealizedPnlUsd += value - position.costBasisUsd;
  }

  const realizedRow = await one(
    `SELECT COALESCE(SUM(pnl_usd), 0) AS realized FROM trades WHERE session_id = $1 AND side = 'SELL'`,
    [sessionId]
  );

  return {
    positionValueUsd,
    unrealizedPnlUsd,
    realizedPnlUsd: Number(realizedRow?.realized || 0)
  };
}

async function walletSummary(sessionId, solPriceUsd = null, valuation = {}) {
  const wallet = await getOrCreateWallet(sessionId);
  const cashUsd = Number(wallet.cash_usd || 0);
  const positionValueUsd = Number(valuation.positionValueUsd || 0);
  const unrealizedPnlUsd = Number(valuation.unrealizedPnlUsd || 0);
  const realizedPnlUsd = Number(valuation.realizedPnlUsd || 0);
  const equityUsd = cashUsd + positionValueUsd;
  const solPrice = Number(solPriceUsd);
  const validSolPrice = Number.isFinite(solPrice) && solPrice > 0;

  return {
    cashUsd: roundMoney(cashUsd),
    positionValueUsd: roundMoney(positionValueUsd),
    equityUsd: roundMoney(equityUsd),
    realizedPnlUsd: roundMoney(realizedPnlUsd),
    unrealizedPnlUsd: roundMoney(unrealizedPnlUsd),
    totalPnlUsd: roundMoney(realizedPnlUsd + unrealizedPnlUsd),
    startingBalanceUsd: STARTING_BALANCE,
    solPriceUsd: validSolPrice ? roundMoney(solPrice) : null,
    cashSol: validSolPrice ? cashUsd / solPrice : null,
    equitySol: validSolPrice ? equityUsd / solPrice : null,
    updatedAt: Date.now()
  };
}

async function buy(sessionId, data = {}) {
  const amountUsd = Number(data.amountUsd);
  const marketPrice = Number(data.marketPriceUsd ?? data.priceUsd);

  if (!Number.isFinite(amountUsd) || amountUsd <= 0) {
    throw new Error('Investment amount must be greater than zero');
  }
  if (!Number.isFinite(marketPrice) || marketPrice <= 0) {
    throw new Error('A valid token price is required');
  }
  if (typeof data.chain !== 'string' || !data.chain.trim()) {
    throw new Error('Token chain is required');
  }
  if (typeof data.address !== 'string' || !data.address.trim()) {
    throw new Error('Token address is required');
  }

  const feePct = getFeePct(data);
  const slippagePct = getSlippagePct(data);
  const execution = executionPrice(marketPrice, 'BUY', slippagePct);
  const feeUsd = roundMoney((amountUsd * feePct) / 100);
  const totalCashRequired = roundMoney(amountUsd + feeUsd);
  const quantity = roundQuantity(amountUsd / execution);

  if (!Number.isFinite(quantity) || quantity <= 0) {
    throw new Error('Unable to calculate token quantity');
  }

  const wallet = await getOrCreateWallet(sessionId);
  if (Number(wallet.cash_usd) < totalCashRequired) {
    throw new Error('Insufficient paper cash');
  }

  const tokenName = data.tokenName || 'Unknown Token';
  const symbol = data.symbol || 'UNKNOWN';
  const client = await pool.connect();
  let result;

  try {
    await client.query('BEGIN');

    const latestRes = await client.query(
      `SELECT * FROM wallets WHERE session_id = $1 FOR UPDATE`,
      [sessionId]
    );
    const latestWallet = latestRes.rows[0];
    if (!latestWallet || Number(latestWallet.cash_usd) < totalCashRequired) {
      throw new Error('Insufficient paper cash');
    }

    await client.query(
      `UPDATE wallets SET cash_usd = $1, updated_at = NOW() WHERE session_id = $2`,
      [roundMoney(Number(latestWallet.cash_usd) - totalCashRequired), sessionId]
    );

    const existingRes = await client.query(
      `SELECT * FROM positions
       WHERE session_id = $1 AND LOWER(chain) = LOWER($2)
         AND LOWER(token_address) = LOWER($3) AND quantity > 0
       ORDER BY id ASC LIMIT 1 FOR UPDATE`,
      [sessionId, data.chain, data.address]
    );
    const existing = existingRes.rows[0];

    if (existing) {
      const oldQuantity = Number(existing.quantity ?? existing.total_quantity ?? 0);
      const oldCostBasis = Number(existing.cost_basis_usd ?? existing.invested_usd ?? 0);
      const newQuantity = roundQuantity(oldQuantity + quantity);
      const newCostBasis = roundMoney(oldCostBasis + amountUsd);
      const averageEntry = newQuantity > 0 ? newCostBasis / newQuantity : execution;

      await client.query(
        `UPDATE positions SET
           token_name=$1, symbol=$2, entry_price_usd=$3, quantity=$4,
           invested_usd=$5, cost_basis_usd=$6, total_quantity=$7, updated_at=NOW()
         WHERE id=$8 AND session_id=$9`,
        [tokenName, symbol, averageEntry, newQuantity, newCostBasis, newCostBasis, newQuantity, existing.id, sessionId]
      );

      result = {
        positionId: existing.id,
        quantity: newQuantity,
        costBasisUsd: newCostBasis,
        averageEntryPriceUsd: averageEntry
      };
    } else {
      const insertRes = await client.query(
        `INSERT INTO positions (
           session_id, chain, token_address, token_name, symbol,
           entry_price_usd, quantity, invested_usd, cost_basis_usd, total_quantity, updated_at
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,NOW()) RETURNING id`,
        [sessionId, data.chain, data.address, tokenName, symbol, execution, quantity, amountUsd, amountUsd, quantity]
      );

      result = {
        positionId: Number(insertRes.rows[0].id),
        quantity,
        costBasisUsd: roundMoney(amountUsd),
        averageEntryPriceUsd: execution
      };
    }

    await client.query(
      `INSERT INTO trades (
         session_id, chain, token_address, token_name, symbol, side,
         price_usd, quantity, amount_usd, pnl_usd, fee_usd, slippage_pct,
         market_price_usd, execution_price_usd, source
       ) VALUES ($1,$2,$3,$4,$5,'BUY',$6,$7,$8,0,$9,$10,$11,$12,$13)`,
      [sessionId, data.chain, data.address, tokenName, symbol, execution, quantity, amountUsd, feeUsd, slippagePct, marketPrice, execution, data.source || null]
    );

    await client.query('COMMIT');
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }

  return {
    side: 'BUY',
    marketPriceUsd: roundMoney(marketPrice),
    executionPriceUsd: roundMoney(execution),
    slippagePct,
    amountUsd: roundMoney(amountUsd),
    feeUsd,
    totalCashRequired,
    quantity,
    ...result,
    wallet: await getOrCreateWallet(sessionId)
  };
}

async function sell(sessionId, positionId, priceOrData, maybeData) {
  const position = await getPosition(sessionId, positionId);
  if (!position) throw new Error('Position not found');

  let data = {};
  if (priceOrData && typeof priceOrData === 'object') data = priceOrData;
  else data = { ...(maybeData || {}), priceUsd: priceOrData };

  const marketPrice = Number(data.marketPriceUsd ?? data.priceUsd);
  if (!Number.isFinite(marketPrice) || marketPrice <= 0) throw new Error('Invalid sell price');

  const requestedQuantity = data.quantity ?? data.sellQuantity ?? data.amountQuantity;
  let quantity =
    requestedQuantity === undefined || requestedQuantity === null || requestedQuantity === ''
      ? position.quantity
      : Number(requestedQuantity);

  if (!Number.isFinite(quantity) || quantity <= 0) throw new Error('Sell quantity must be greater than zero');
  if (!Number.isFinite(position.quantity) || position.quantity <= 0) {
    throw new Error('Position has no sellable quantity');
  }

  const epsilon = 1e-10;
  if (quantity > position.quantity + epsilon) throw new Error('Cannot sell more than the position quantity');
  quantity = Math.min(quantity, position.quantity);

  const feePct = getFeePct(data);
  const slippagePct = getSlippagePct(data);
  const execution = executionPrice(marketPrice, 'SELL', slippagePct);
  const grossProceeds = roundMoney(quantity * execution);
  const feeUsd = roundMoney((grossProceeds * feePct) / 100);
  const netProceeds = roundMoney(grossProceeds - feeUsd);
  const proportion = position.quantity > 0 ? quantity / position.quantity : 1;
  const soldCostBasis = roundMoney(position.costBasisUsd * proportion);
  const realizedPnl = roundMoney(netProceeds - soldCostBasis);
  const remainingQuantity = roundQuantity(position.quantity - quantity);
  const remainingCostBasis = roundMoney(position.costBasisUsd - soldCostBasis);

  const client = await pool.connect();
  let result;

  try {
    await client.query('BEGIN');

    const walletRes = await client.query(
      `SELECT * FROM wallets WHERE session_id = $1 FOR UPDATE`,
      [sessionId]
    );
    const wallet = walletRes.rows[0];
    if (!wallet) throw new Error('Wallet not found');

    await client.query(
      `UPDATE wallets SET cash_usd = $1, updated_at = NOW() WHERE session_id = $2`,
      [roundMoney(Number(wallet.cash_usd) + netProceeds), sessionId]
    );

    await client.query(
      `INSERT INTO trades (
         session_id, chain, token_address, token_name, symbol, side,
         price_usd, quantity, amount_usd, pnl_usd, fee_usd, slippage_pct,
         market_price_usd, execution_price_usd, source
       ) VALUES ($1,$2,$3,$4,$5,'SELL',$6,$7,$8,$9,$10,$11,$12,$13,$14)`,
      [
        sessionId, position.chain, position.tokenAddress, position.tokenName, position.symbol,
        execution, quantity, grossProceeds, realizedPnl, feeUsd, slippagePct,
        marketPrice, execution, data.source || null
      ]
    );

    if (remainingQuantity <= epsilon) {
      await client.query(`DELETE FROM positions WHERE id = $1 AND session_id = $2`, [positionId, sessionId]);
      result = { closed: true, remainingQuantity: 0, remainingCostBasisUsd: 0 };
    } else {
      const remainingAverageEntry =
        remainingQuantity > 0 ? remainingCostBasis / remainingQuantity : 0;
      await client.query(
        `UPDATE positions SET
           entry_price_usd=$1, quantity=$2, invested_usd=$3,
           cost_basis_usd=$4, total_quantity=$5, updated_at=NOW()
         WHERE id=$6 AND session_id=$7`,
        [remainingAverageEntry, remainingQuantity, remainingCostBasis, remainingCostBasis, remainingQuantity, positionId, sessionId]
      );
      result = {
        closed: false,
        remainingQuantity,
        remainingCostBasisUsd: remainingCostBasis,
        remainingAverageEntryPriceUsd: remainingAverageEntry
      };
    }

    await client.query('COMMIT');
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }

  return {
    side: 'SELL',
    marketPriceUsd: roundMoney(marketPrice),
    executionPriceUsd: roundMoney(execution),
    slippagePct,
    quantity: roundQuantity(quantity),
    grossProceeds,
    feeUsd,
    netProceeds,
    soldCostBasisUsd: soldCostBasis,
    pnlUsd: realizedPnl,
    ...result,
    wallet: await getOrCreateWallet(sessionId)
  };
}

async function deposit(sessionId, amountUsd) {
  return addBalance(sessionId, 'deposit', amountUsd);
}

async function withdraw(sessionId, amountUsd) {
  return addBalance(sessionId, 'withdraw', amountUsd);
}

async function getBalanceHistory(sessionId) {
  return getBalanceTransactions(sessionId);
}

async function reset(sessionId) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(`DELETE FROM positions WHERE session_id = $1`, [sessionId]);
    await client.query(`DELETE FROM trades WHERE session_id = $1`, [sessionId]);
    await client.query(`DELETE FROM balance_transactions WHERE session_id = $1`, [sessionId]);
    await client.query(
      `UPDATE wallets SET cash_usd = $1, updated_at = NOW() WHERE session_id = $2`,
      [STARTING_BALANCE, sessionId]
    );
    await client.query('COMMIT');
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
  return getOrCreateWallet(sessionId);
}

module.exports = {
  DEFAULT_FEE_PCT,
  DEFAULT_SLIPPAGE_PCT,
  walletSummary,
  calculateValuation,
  getPositions,
  getPosition,
  getTrades,
  buy,
  sell,
  deposit,
  withdraw,
  getBalanceHistory,
  reset
};
