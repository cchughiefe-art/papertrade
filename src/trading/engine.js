const {
  db,
  getOrCreateWallet,
  updateCash,
  addBalance,
  getBalanceTransactions,
  STARTING_BALANCE
} = require('../database/db');

function roundMoney(n) {
  return Math.round(Number(n) * 100) / 100;
}

function getPositions(sessionId) {
  return db.prepare(`
    SELECT *
    FROM positions
    WHERE session_id = ?
    ORDER BY id DESC
  `).all(sessionId).map(row => ({
    id: row.id,
    sessionId: row.session_id,
    chain: row.chain,
    tokenAddress: row.token_address,
    tokenName: row.token_name,
    symbol: row.symbol,
    entryPriceUsd: Number(row.entry_price_usd),
    quantity: Number(row.quantity),
    investedUsd: Number(row.invested_usd),
    openedAt: row.opened_at
  }));
}

function getPosition(sessionId, id) {
  const row = db.prepare(`
    SELECT *
    FROM positions
    WHERE session_id = ?
      AND id = ?
  `).get(sessionId, id);

  if (!row) return null;

  return {
    id: row.id,
    sessionId: row.session_id,
    chain: row.chain,
    tokenAddress: row.token_address,
    tokenName: row.token_name,
    symbol: row.symbol,
    entryPriceUsd: Number(row.entry_price_usd),
    quantity: Number(row.quantity),
    investedUsd: Number(row.invested_usd),
    openedAt: row.opened_at
  };
}

function getTrades(sessionId) {
  return db.prepare(`
    SELECT *
    FROM trades
    WHERE session_id = ?
    ORDER BY id DESC
  `).all(sessionId).map(row => ({
    id: row.id,
    sessionId: row.session_id,
    chain: row.chain,
    tokenAddress: row.token_address,
    tokenName: row.token_name,
    symbol: row.symbol,
    side: row.side,
    priceUsd: Number(row.price_usd),
    quantity: Number(row.quantity),
    amountUsd: Number(row.amount_usd),
    pnlUsd: Number(row.pnl_usd || 0),
    createdAt: row.created_at
  }));
}

function walletSummary(
  sessionId,
  solPriceUsd = null,
  valuation = {}
) {
  const wallet = getOrCreateWallet(sessionId);

  const cashUsd =
    Number(wallet.cash_usd || 0);

  const positionValueUsd =
    Number(valuation.positionValueUsd || 0);

  const unrealizedPnlUsd =
    Number(valuation.unrealizedPnlUsd || 0);

  const realizedPnlUsd =
    Number(valuation.realizedPnlUsd || 0);

  const equityUsd =
    cashUsd + positionValueUsd;

  const solPrice =
    Number(solPriceUsd);

  const equitySol =
    Number.isFinite(solPrice) &&
    solPrice > 0
      ? equityUsd / solPrice
      : null;

  const cashSol =
    Number.isFinite(solPrice) &&
    solPrice > 0
      ? cashUsd / solPrice
      : null;

  return {
    cashUsd,
    positionValueUsd,
    equityUsd,
    realizedPnlUsd,
    unrealizedPnlUsd,
    totalPnlUsd:
      realizedPnlUsd + unrealizedPnlUsd,
    startingBalanceUsd:
      STARTING_BALANCE,
    solPriceUsd:
      Number.isFinite(solPrice) && solPrice > 0
        ? solPrice
        : null,
    cashSol,
    equitySol,
    updatedAt: Date.now()
  };
}

function buy(sessionId, data) {
  const amountUsd = Number(data.amountUsd);
  const priceUsd = Number(data.priceUsd);

  if (!Number.isFinite(amountUsd) || amountUsd <= 0) {
    throw new Error('Invalid investment amount');
  }

  if (!Number.isFinite(priceUsd) || priceUsd <= 0) {
    throw new Error('Invalid token price');
  }

  const wallet =
    getOrCreateWallet(sessionId);

  if (wallet.cash_usd < amountUsd) {
    throw new Error('Insufficient paper cash');
  }

  const quantity =
    amountUsd / priceUsd;

  const transaction = db.transaction(() => {
    updateCash(
      sessionId,
      roundMoney(
        wallet.cash_usd - amountUsd
      )
    );

    db.prepare(`
      INSERT INTO positions (
        session_id,
        chain,
        token_address,
        token_name,
        symbol,
        entry_price_usd,
        quantity,
        invested_usd
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      sessionId,
      data.chain,
      data.address,
      data.tokenName || 'Unknown Token',
      data.symbol || 'UNKNOWN',
      priceUsd,
      quantity,
      amountUsd
    );

    db.prepare(`
      INSERT INTO trades (
        session_id,
        chain,
        token_address,
        token_name,
        symbol,
        side,
        price_usd,
        quantity,
        amount_usd,
        pnl_usd
      )
      VALUES (?, ?, ?, ?, ?, 'BUY', ?, ?, ?, 0)
    `).run(
      sessionId,
      data.chain,
      data.address,
      data.tokenName || 'Unknown Token',
      data.symbol || 'UNKNOWN',
      priceUsd,
      quantity,
      amountUsd
    );
  });

  transaction();

  return getOrCreateWallet(sessionId);
}

function sell(sessionId, positionId, priceUsd) {
  const position =
    getPosition(sessionId, positionId);

  if (!position) {
    throw new Error('Position not found');
  }

  const price = Number(priceUsd);

  if (!Number.isFinite(price) || price <= 0) {
    throw new Error('Invalid sell price');
  }

  const proceeds =
    position.quantity * price;

  const pnl =
    proceeds - position.investedUsd;

  const wallet =
    getOrCreateWallet(sessionId);

  const transaction = db.transaction(() => {
    updateCash(
      sessionId,
      roundMoney(
        wallet.cash_usd + proceeds
      )
    );

    db.prepare(`
      INSERT INTO trades (
        session_id,
        chain,
        token_address,
        token_name,
        symbol,
        side,
        price_usd,
        quantity,
        amount_usd,
        pnl_usd
      )
      VALUES (?, ?, ?, ?, ?, 'SELL', ?, ?, ?, ?)
    `).run(
      sessionId,
      position.chain,
      position.tokenAddress,
      position.tokenName,
      position.symbol,
      price,
      position.quantity,
      proceeds,
      pnl
    );

    db.prepare(`
      DELETE FROM positions
      WHERE session_id = ?
        AND id = ?
    `).run(
      sessionId,
      positionId
    );
  });

  transaction();

  return {
    proceeds,
    pnlUsd: pnl,
    wallet:
      getOrCreateWallet(sessionId)
  };
}

function deposit(sessionId, amountUsd) {
  return addBalance(
    sessionId,
    'deposit',
    amountUsd
  );
}

function withdraw(sessionId, amountUsd) {
  return addBalance(
    sessionId,
    'withdrawal',
    amountUsd
  );
}

function getBalanceHistory(sessionId) {
  return getBalanceTransactions(sessionId);
}

function reset(sessionId) {
  const transaction =
    db.transaction(() => {
      db.prepare(`
        DELETE FROM positions
        WHERE session_id = ?
      `).run(sessionId);

      db.prepare(`
        DELETE FROM trades
        WHERE session_id = ?
      `).run(sessionId);

      db.prepare(`
        DELETE FROM balance_transactions
        WHERE session_id = ?
      `).run(sessionId);

      db.prepare(`
        UPDATE wallets
        SET cash_usd = ?,
            updated_at = CURRENT_TIMESTAMP
        WHERE session_id = ?
      `).run(
        STARTING_BALANCE,
        sessionId
      );
    });

  transaction();

  return getOrCreateWallet(sessionId);
}

module.exports = {
  walletSummary,
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
