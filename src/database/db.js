const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

const dataDir =
  process.env.DATA_DIR ||
  path.join(__dirname, '..', '..');

if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, {
    recursive: true
  });
}

const dbPath =
  path.join(dataDir, 'papertrade.db');

const db = new Database(dbPath);

db.pragma('journal_mode = WAL');

db.exec(`
CREATE TABLE IF NOT EXISTS wallets (
  session_id TEXT PRIMARY KEY,
  cash REAL NOT NULL,
  starting_balance REAL NOT NULL,
  realized_pnl REAL NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS positions (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  chain TEXT NOT NULL,
  token_address TEXT NOT NULL,
  token_name TEXT,
  symbol TEXT,
  entry_price_usd REAL NOT NULL,
  quantity REAL NOT NULL,
  invested_usd REAL NOT NULL,
  opened_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS trades (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  chain TEXT NOT NULL,
  token_address TEXT NOT NULL,
  token_name TEXT,
  symbol TEXT,
  entry_price_usd REAL NOT NULL,
  exit_price_usd REAL NOT NULL,
  quantity REAL NOT NULL,
  invested_usd REAL NOT NULL,
  exit_value_usd REAL NOT NULL,
  pnl_usd REAL NOT NULL,
  pnl_pct REAL NOT NULL,
  opened_at INTEGER NOT NULL,
  closed_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS
idx_positions_session
ON positions(session_id);

CREATE INDEX IF NOT EXISTS
idx_trades_session
ON trades(session_id);
`);

const STARTING_BALANCE = 10000;

function getOrCreateWallet(sessionId) {
  let wallet = db
    .prepare(
      'SELECT * FROM wallets WHERE session_id = ?'
    )
    .get(sessionId);

  if (!wallet) {
    db.prepare(`
      INSERT INTO wallets
      (
        session_id,
        cash,
        starting_balance,
        realized_pnl,
        created_at
      )
      VALUES (?, ?, ?, 0, ?)
    `).run(
      sessionId,
      STARTING_BALANCE,
      STARTING_BALANCE,
      Math.floor(Date.now() / 1000)
    );

    wallet = db
      .prepare(
        'SELECT * FROM wallets WHERE session_id = ?'
      )
      .get(sessionId);
  }

  return wallet;
}

module.exports = {
  db,
  getOrCreateWallet,
  STARTING_BALANCE
};
