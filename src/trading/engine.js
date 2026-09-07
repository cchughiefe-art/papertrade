const crypto = require('crypto');

const {
  db,
  getOrCreateWallet,
  STARTING_BALANCE
} = require('../database/db');

function cents(value) {
  return Math.round(Number(value) * 100) / 100;
}

function mapPosition(row) {
  if (!row) return null;

  return {
    id: row.id,
    sessionId: row.session_id,
    chain: row.chain,
    tokenAddress: row.token_address,
    tokenName: row.token_name,
    symbol: row.symbol,
    entryPriceUsd: row.entry_price_usd,
    quantity: row.quantity,
    investedUsd: row.invested_usd,
    openedAt: row.opened_at
  };
}

function mapTrade(row) {
  if (!row) return null;

  return {
    id: row.id,
    sessionId: row.session_id,
    chain: row.chain,
    tokenAddress: row.token_address,
    tokenName: row.token_name,
    symbol: row.symbol,
    entryPriceUsd: row.entry_price_usd,
    exitPriceUsd: row.exit_price_usd,
    quantity: row.quantity,
    investedUsd: row.invested_usd,
    exitValueUsd: row.exit_value_usd,
    pnlUsd: row.pnl_usd,
    pnlPct: row.pnl_pct,
    openedAt: row.opened_at,
    closedAt: row.closed_at
  };
}

function getWalletSimple(sessionId) {
  const wallet =
    getOrCreateWallet(sessionId);

  return {
    cash: cents(wallet.cash),
    startingBalance:
      wallet.starting_balance,

    realizedPnl:
      cents(wallet.realized_pnl),

    totalPnl:
      cents(
        wallet.cash -
        wallet.starting_balance +
        wallet.realized_pnl
      )
  };
}

function getPositions(sessionId) {
  const rows = db
    .prepare(`
      SELECT *
      FROM positions
      WHERE session_id = ?
      ORDER BY opened_at DESC
    `)
    .all(sessionId);

  return rows.map(mapPosition);
}

function getPosition(sessionId, positionId) {
  const row = db
    .prepare(`
      SELECT *
      FROM positions
      WHERE session_id = ?
      AND id = ?
    `)
    .get(sessionId, positionId);

  return mapPosition(row);
}

function getTrades(sessionId) {
  const rows = db
    .prepare(`
      SELECT *
      FROM trades
      WHERE session_id = ?
      ORDER BY closed_at DESC
    `)
    .all(sessionId);

  return rows.map(mapTrade);
}

function walletSummary(sessionId, priceMap) {
  const wallet =
    getOrCreateWallet(sessionId);

  const positions =
    getPositions(sessionId).map(position => {
      const key =
        `${position.chain}:${position.tokenAddress.toLowerCase()}`;

      const price =
        priceMap
          ? priceMap.get(key)
          : undefined;

      const currentValueUsd =
        price &&
        price.priceUsd != null
          ? position.quantity *
            price.priceUsd
          : null;

      const pnl =
        currentValueUsd != null
          ? currentValueUsd -
            position.investedUsd
          : null;

      return {
        ...position,

        currentPriceUsd:
          price
            ? price.priceUsd
            : null,

        priceUpdatedAt:
          price
            ? price.updatedAt
            : null,

        currentValueUsd,

        unrealizedPnlUsd:
          pnl != null
            ? cents(pnl)
            : null,

        unrealizedPnlPct:
          pnl != null
            ? (pnl /
                position.investedUsd) *
              100
            : null
      };
    });

  const openValue =
    positions.reduce(
      (sum, position) =>
        sum +
        (position.currentValueUsd || 0),
      0
    );

  const knownPrices =
    positions.filter(
      position =>
        position.currentValueUsd != null
    ).length;

  const equity =
    wallet.cash + openValue;

  const unrealizedPnl =
    positions.reduce(
      (sum, position) =>
        sum +
        (position.unrealizedPnlUsd || 0),
      0
    );

  return {
    cash: cents(wallet.cash),

    startingBalance:
      wallet.starting_balance,

    positions,

    openPositionsValue:
      cents(openValue),

    equity:
      cents(equity),

    realizedPnl:
      cents(wallet.realized_pnl),

    unrealizedPnl:
      cents(unrealizedPnl),

    totalPnl:
      cents(
        equity -
        wallet.starting_balance
      ),

    allPricesKnown:
      knownPrices === positions.length
  };
}

function buy(
  sessionId,
  chain,
  address,
  amountUsd,
  priceUsd
) {
  const wallet =
    getOrCreateWallet(sessionId);

  if (
    amountUsd >
    wallet.cash + 1e-9
  ) {
    throw new Error(
      'Not enough paper cash'
    );
  }

  if (
    !Number.isFinite(priceUsd) ||
    priceUsd <= 0
  ) {
    throw new Error(
      'Invalid market price'
    );
  }

  const quantity =
    amountUsd / priceUsd;

  const id =
    crypto.randomUUID();

  const now =
    Math.floor(Date.now() / 1000);

  const transaction =
    db.transaction(() => {
      db.prepare(`
        INSERT INTO positions
        (
          id,
          session_id,
          chain,
          token_address,
          token_name,
          symbol,
          entry_price_usd,
          quantity,
          invested_usd,
          opened_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        id,
        sessionId,
        chain,
        address,
        null,
        null,
        priceUsd,
        quantity,
        cents(amountUsd),
        now
      );

      db.prepare(`
        UPDATE wallets
        SET cash = cash - ?
        WHERE session_id = ?
      `).run(
        cents(amountUsd),
        sessionId
      );
    });

  transaction();

  return getPosition(
    sessionId,
    id
  );
}

function sell(
  sessionId,
  positionId,
  exitPriceUsd
) {
  const position =
    getPosition(
      sessionId,
      positionId
    );

  if (!position) {
    throw new Error(
      'Position not found'
    );
  }

  if (
    !Number.isFinite(exitPriceUsd) ||
    exitPriceUsd <= 0
  ) {
    throw new Error(
      'Invalid exit price'
    );
  }

  const exitValueUsd =
    position.quantity *
    exitPriceUsd;

  const pnl =
    exitValueUsd -
    position.investedUsd;

  const pnlPct =
    (pnl /
      position.investedUsd) *
    100;

  const now =
    Math.floor(Date.now() / 1000);

  const transaction =
    db.transaction(() => {
      db.prepare(`
        DELETE FROM positions
        WHERE id = ?
      `).run(position.id);

      db.prepare(`
        INSERT INTO trades
        (
          id,
          session_id,
          chain,
          token_address,
          token_name,
          symbol,
          entry_price_usd,
          exit_price_usd,
          quantity,
          invested_usd,
          exit_value_usd,
          pnl_usd,
          pnl_pct,
          opened_at,
          closed_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        crypto.randomUUID(),
        sessionId,
        position.chain,
        position.tokenAddress,
        position.tokenName,
        position.symbol,
        position.entryPriceUsd,
        exitPriceUsd,
        position.quantity,
        position.investedUsd,
        cents(exitValueUsd),
        cents(pnl),
        pnlPct,
        position.openedAt,
        now
      );

      db.prepare(`
        UPDATE wallets
        SET
          cash = cash + ?,
          realized_pnl =
            realized_pnl + ?
        WHERE session_id = ?
      `).run(
        cents(exitValueUsd),
        cents(pnl),
        sessionId
      );
    });

  transaction();

  return {
    closedPosition: position,
    exitPriceUsd,
    exitValueUsd:
      cents(exitValueUsd),
    pnlUsd:
      cents(pnl),
    pnlPct
  };
}

function enrichPositionMetadata(
  positionId,
  token
) {
  db.prepare(`
    UPDATE positions
    SET
      token_name = ?,
      symbol = ?
    WHERE id = ?
  `).run(
    token.name || null,
    token.symbol || null,
    positionId
  );
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
        UPDATE wallets
        SET
          cash = ?,
          starting_balance = ?,
          realized_pnl = 0
        WHERE session_id = ?
      `).run(
        STARTING_BALANCE,
        STARTING_BALANCE,
        sessionId
      );
    });

  transaction();

  getOrCreateWallet(sessionId);
}

module.exports = {
  getWalletSimple,
  walletSummary,
  getPositions,
  getPosition,
  getTrades,
  buy,
  sell,
  reset,
  enrichPositionMetadata
};
