const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

const DATA_DIR = process.env.DATA_DIR || path.join(process.cwd(), 'data');

fs.mkdirSync(DATA_DIR, { recursive: true });

const db = new Database(path.join(DATA_DIR, 'papertrade.db'));

db.pragma('journal_mode = WAL');

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

const STARTING_BALANCE = 10000;

function getOrCreateWallet(sessionId) {
  let wallet = db
    .prepare(`
      SELECT *
      FROM wallets
      WHERE session_id = ?
    `)
    .get(sessionId);

  if (!wallet) {
    db.prepare(`
      INSERT INTO wallets(session_id, cash_usd)
      VALUES (?, ?)
    `).run(sessionId, STARTING_BALANCE);

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
  db.prepare(`
    UPDATE wallets
    SET cash_usd = ?,
        updated_at = CURRENT_TIMESTAMP
    WHERE session_id = ?
  `).run(cashUsd, sessionId);
}

function addBalance(sessionId, type, amountUsd) {
  if (!['deposit', 'withdrawal'].includes(type)) {
    throw new Error('Invalid balance transaction');
  }

  const amount = Number(amountUsd);

  if (!Number.isFinite(amount) || amount <= 0) {
    throw new Error('Amount must be greater than zero');
  }

  const wallet = getOrCreateWallet(sessionId);

  if (type === 'withdrawal' && wallet.cash_usd < amount) {
    throw new Error('Insufficient paper cash');
  }

  const newBalance =
    type === 'deposit'
      ? wallet.cash_usd + amount
      : wallet.cash_usd - amount;

  const transaction = db.transaction(() => {
    updateCash(sessionId, newBalance);

    db.prepare(`
      INSERT INTO balance_transactions(
        session_id,
        type,
        amount_usd
      )
      VALUES (?, ?, ?)
    `).run(sessionId, type, amount);
  });

  transaction();

  return getOrCreateWallet(sessionId);
}

function getBalanceTransactions(sessionId) {
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
