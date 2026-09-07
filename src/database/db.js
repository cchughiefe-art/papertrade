const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

const DATA_DIR = process.env.DATA_DIR || path.join(process.cwd(), 'data');

fs.mkdirSync(DATA_DIR, { recursive: true });

const db = new Database(path.join(DATA_DIR, 'papertrade.db'));

db.pragma('journal_mode = WAL');

const configuredStartingBalance = Number(process.env.STARTING_BALANCE_USD);

const STARTING_BALANCE =
  Number.isFinite(configuredStartingBalance) && configuredStartingBalance > 0
    ? configuredStartingBalance
    : 10000;

function addColumnIfMissing(table, column, definition) {
  const columns = db.prepare(`PRAGMA table_info(${table})`).all();

  if (!columns.some((columnInfo) => columnInfo.name === column)) {
    db.exec(
      `ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`
    );
  }
}

db.exec(`
  CREATE TABLE IF NOT EXISTS wallets (
    session_id TEXT PRIMARY KEY,
    cash_usd REAL NOT NULL DEFAULT 10000,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS positions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id TEXT NOT NULL,
    chain TEXT NOT NULL,
    token_address TEXT NOT NULL,
    token_name TEXT,
    symbol TEXT,
    entry_price_usd REAL NOT NULL,
    quantity REAL NOT NULL,
    invested_usd REAL NOT NULL,
    opened_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS trades (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id TEXT NOT NULL,
    chain TEXT NOT NULL,
    token_address TEXT NOT NULL,
    token_name TEXT,
    symbol TEXT,
    side TEXT NOT NULL,
    price_usd REAL NOT NULL,
    quantity REAL NOT NULL,
    amount_usd REAL NOT NULL,
    pnl_usd REAL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS balance_transactions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id TEXT NOT NULL,
    type TEXT NOT NULL,
    amount_usd REAL NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );

  CREATE INDEX IF NOT EXISTS idx_positions_session
    ON positions(session_id);

  CREATE INDEX IF NOT EXISTS idx_trades_session
    ON trades(session_id);

  CREATE INDEX IF NOT EXISTS idx_balance_transactions_session
    ON balance_transactions(session_id);
`);

/*
 * Safe migrations.
 *
 * Existing paper-trading data is preserved.
 */

addColumnIfMissing(
  'positions',
  'cost_basis_usd',
  'REAL'
);

addColumnIfMissing(
  'positions',
  'total_quantity',
  'REAL'
);

addColumnIfMissing(
  'positions',
  'updated_at',
  'TEXT'
);

addColumnIfMissing(
  'trades',
  'fee_usd',
  'REAL DEFAULT 0'
);

addColumnIfMissing(
  'trades',
  'slippage_pct',
  'REAL DEFAULT 0'
);

addColumnIfMissing(
  'trades',
  'market_price_usd',
  'REAL'
);

addColumnIfMissing(
  'trades',
  'execution_price_usd',
  'REAL'
);

addColumnIfMissing(
  'trades',
  'source',
  'TEXT'
);

/*
 * Backfill new fields for existing records.
 */

db.prepare(`
  UPDATE positions
  SET
    cost_basis_usd = COALESCE(
      cost_basis_usd,
      invested_usd
    ),
    total_quantity = COALESCE(
      total_quantity,
      quantity
    ),
    updated_at = COALESCE(
      updated_at,
      opened_at
    )
`).run();

db.prepare(`
  UPDATE trades
  SET
    fee_usd = COALESCE(
      fee_usd,
      0
    ),
    slippage_pct = COALESCE(
      slippage_pct,
      0
    ),
    execution_price_usd = COALESCE(
      execution_price_usd,
      price_usd
    )
`).run();

function getOrCreateWallet(sessionId) {
  if (
    typeof sessionId !== 'string' ||
    !sessionId.trim() ||
    sessionId.length > 200
  ) {
    throw new Error('Invalid session');
  }

  let wallet = db
    .prepare(`
      SELECT *
      FROM wallets
      WHERE session_id = ?
    `)
    .get(sessionId);

  if (!wallet) {
    db.prepare(`
      INSERT INTO wallets (
        session_id,
        cash_usd
      )
      VALUES (?, ?)
    `).run(
      sessionId,
      STARTING_BALANCE
    );

    wallet = db
      .prepare(`
        SELECT *
        FROM wallets
        WHERE session_id = ?
      `)
      .get(sessionId);
  }

  return wallet;
}

function updateCash(sessionId, cashUsd) {
  const amount = Number(cashUsd);

  if (
    !Number.isFinite(amount) ||
    amount < 0
  ) {
    throw new Error('Invalid cash balance');
  }

  db.prepare(`
    UPDATE wallets
    SET
      cash_usd = ?,
      updated_at = CURRENT_TIMESTAMP
    WHERE session_id = ?
  `).run(
    amount,
    sessionId
  );
}

function addBalance(sessionId, type, amount) {
  if (typeof sessionId !== 'string' || !sessionId.trim()) {
    throw new Error('Session ID required');
  }

  if (type !== 'deposit' && type !== 'withdraw') {
    throw new Error('Invalid balance transaction type');
  }

  const numericAmount =
    typeof amount === 'number'
      ? amount
      : Number(amount);

  if (
    !Number.isFinite(numericAmount) ||
    numericAmount <= 0 ||
    numericAmount === Infinity ||
    numericAmount === -Infinity
  ) {
    throw new Error('Amount must be a finite number greater than zero');
  }

  const wallet = getOrCreateWallet(sessionId);
  const currentCash = Number(wallet.cash_usd);

  if (!Number.isFinite(currentCash) || currentCash < 0) {
    throw new Error('Invalid cash balance');
  }

  if (type === 'withdraw' && numericAmount > currentCash) {
    throw new Error('Insufficient cash');
  }

  const nextCash =
    type === 'deposit'
      ? currentCash + numericAmount
      : currentCash - numericAmount;

  if (!Number.isFinite(nextCash) || nextCash < 0) {
    throw new Error('Invalid resulting cash balance');
  }

  const tx = db.transaction(() => {
    db.prepare(`
      UPDATE wallets
      SET cash_usd = ?, updated_at = CURRENT_TIMESTAMP
      WHERE session_id = ?
    `).run(nextCash, sessionId);

    db.prepare(`
      INSERT INTO balance_transactions
        (session_id, type, amount_usd, created_at)
      VALUES (?, ?, ?, CURRENT_TIMESTAMP)
    `).run(sessionId, type, numericAmount);
  });

  tx();

  return getOrCreateWallet(sessionId);
}

function getBalanceTransactions(
  sessionId
) {
  return db.prepare(`
    SELECT
      id,
      type,
      amount_usd AS amountUsd,
      created_at AS createdAt
    FROM balance_transactions
    WHERE session_id = ?
    ORDER BY id DESC
  `).all(sessionId);
}

module.exports = {
  db,
  STARTING_BALANCE,
  getOrCreateWallet,
  updateCash,
  addBalance,
  getBalanceTransactions
};
