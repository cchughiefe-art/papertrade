const { Pool } = require('pg');
const path = require('path');
const fs = require('fs');

const DATA_DIR = process.env.DATA_DIR || path.join(process.cwd(), 'data');
fs.mkdirSync(DATA_DIR, { recursive: true });

const configuredStartingBalance = Number(process.env.STARTING_BALANCE_USD);
const STARTING_BALANCE =
  Number.isFinite(configuredStartingBalance) && configuredStartingBalance > 0
    ? configuredStartingBalance
    : 10000;

const DATABASE_URL = process.env.DATABASE_URL || process.env.SUPABASE_DB_URL || '';

if (!DATABASE_URL) {
  console.warn(
    'WARNING: DATABASE_URL not set. Set it to your Supabase Postgres URI or data will not persist.'
  );
}

const pool = DATABASE_URL
  ? new Pool({
      connectionString: DATABASE_URL,
      ssl: { rejectUnauthorized: false },
      max: 5,
      idleTimeoutMillis: 30000
    })
  : null;

let ready = null;
let databaseStatus = { ready: false, error: null, checkedAt: null };

async function query(text, params = []) {
  if (!pool) {
    throw new Error('DATABASE_URL is not configured');
  }
  return pool.query(text, params);
}

async function one(text, params = []) {
  const res = await query(text, params);
  return res.rows[0] || null;
}

async function many(text, params = []) {
  const res = await query(text, params);
  return res.rows || [];
}

async function initDb() {
  if (ready) return ready;

  ready = (async () => {
    if (!pool) {
      throw new Error(
        'DATABASE_URL is required. Add your Supabase connection string on Render.'
      );
    }

    await query(`CREATE TABLE IF NOT EXISTS schema_migrations (
      version INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`);

    await query(`
      CREATE TABLE IF NOT EXISTS wallets (
        session_id TEXT PRIMARY KEY,
        cash_usd DOUBLE PRECISION NOT NULL DEFAULT 10000,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);

    await query(`
      CREATE TABLE IF NOT EXISTS positions (
        id SERIAL PRIMARY KEY,
        session_id TEXT NOT NULL,
        chain TEXT NOT NULL,
        token_address TEXT NOT NULL,
        token_name TEXT,
        symbol TEXT,
        entry_price_usd DOUBLE PRECISION NOT NULL,
        quantity DOUBLE PRECISION NOT NULL,
        invested_usd DOUBLE PRECISION NOT NULL,
        cost_basis_usd DOUBLE PRECISION,
        total_quantity DOUBLE PRECISION,
        opened_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ
      )
    `);

    await query(`
      CREATE TABLE IF NOT EXISTS trades (
        id SERIAL PRIMARY KEY,
        session_id TEXT NOT NULL,
        chain TEXT NOT NULL,
        token_address TEXT NOT NULL,
        token_name TEXT,
        symbol TEXT,
        side TEXT NOT NULL,
        price_usd DOUBLE PRECISION NOT NULL,
        quantity DOUBLE PRECISION NOT NULL,
        amount_usd DOUBLE PRECISION NOT NULL,
        pnl_usd DOUBLE PRECISION DEFAULT 0,
        fee_usd DOUBLE PRECISION DEFAULT 0,
        slippage_pct DOUBLE PRECISION DEFAULT 0,
        market_price_usd DOUBLE PRECISION,
        execution_price_usd DOUBLE PRECISION,
        source TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);

    await query(`
      CREATE TABLE IF NOT EXISTS balance_transactions (
        id SERIAL PRIMARY KEY,
        session_id TEXT NOT NULL,
        type TEXT NOT NULL,
        amount_usd DOUBLE PRECISION NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);

    await query(`CREATE TABLE IF NOT EXISTS portfolios (
      id SERIAL PRIMARY KEY,
      owner_id TEXT NOT NULL,
      portfolio_key TEXT NOT NULL,
      name TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE(owner_id, portfolio_key)
    )`);

    await query(`CREATE TABLE IF NOT EXISTS equity_history (
      id BIGSERIAL PRIMARY KEY,
      session_id TEXT NOT NULL,
      equity_usd DOUBLE PRECISION NOT NULL,
      cash_usd DOUBLE PRECISION NOT NULL,
      position_value_usd DOUBLE PRECISION NOT NULL,
      recorded_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`);

    await query(`CREATE TABLE IF NOT EXISTS watchlist (
      id SERIAL PRIMARY KEY,
      session_id TEXT NOT NULL,
      chain TEXT NOT NULL,
      token_address TEXT NOT NULL,
      token_name TEXT,
      symbol TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE(session_id, chain, token_address)
    )`);

    await query(`CREATE TABLE IF NOT EXISTS conditional_orders (
      id SERIAL PRIMARY KEY,
      session_id TEXT NOT NULL,
      position_id INTEGER NOT NULL,
      order_type TEXT NOT NULL CHECK (order_type IN ('stop_loss','take_profit')),
      trigger_price_usd DOUBLE PRECISION NOT NULL,
      percent_to_sell DOUBLE PRECISION NOT NULL DEFAULT 100,
      status TEXT NOT NULL DEFAULT 'active',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      executed_at TIMESTAMPTZ
    )`);

    await query(
      `CREATE INDEX IF NOT EXISTS idx_positions_session ON positions(session_id)`
    );
    await query(
      `CREATE INDEX IF NOT EXISTS idx_trades_session ON trades(session_id)`
    );
    await query(
      `CREATE INDEX IF NOT EXISTS idx_balance_transactions_session ON balance_transactions(session_id)`
    );
    await query(`CREATE INDEX IF NOT EXISTS idx_equity_history_session_time ON equity_history(session_id, recorded_at DESC)`);
    await query(`CREATE INDEX IF NOT EXISTS idx_watchlist_session ON watchlist(session_id)`);
    await query(`CREATE INDEX IF NOT EXISTS idx_orders_session_status ON conditional_orders(session_id, status)`);
    await query(`INSERT INTO schema_migrations(version, name) VALUES (1, 'papertrade_v2_core') ON CONFLICT DO NOTHING`);

    // Safe backfills
    await query(`
      UPDATE positions
      SET
        cost_basis_usd = COALESCE(cost_basis_usd, invested_usd),
        total_quantity = COALESCE(total_quantity, quantity),
        updated_at = COALESCE(updated_at, opened_at)
      WHERE cost_basis_usd IS NULL
         OR total_quantity IS NULL
         OR updated_at IS NULL
    `);

    await query(`
      UPDATE trades
      SET
        fee_usd = COALESCE(fee_usd, 0),
        slippage_pct = COALESCE(slippage_pct, 0),
        execution_price_usd = COALESCE(execution_price_usd, price_usd)
      WHERE fee_usd IS NULL
         OR slippage_pct IS NULL
         OR execution_price_usd IS NULL
    `);

    databaseStatus = { ready: true, error: null, checkedAt: new Date().toISOString() };
    console.log('Database: Supabase/Postgres (durable)');
  })();

  ready.catch((error) => {
    databaseStatus = { ready: false, error: error.message, checkedAt: new Date().toISOString() };
    ready = null;
  });

  return ready;
}

function getDatabaseStatus() {
  return { configured: Boolean(DATABASE_URL), ...databaseStatus };
}

async function recordEquity(sessionId, snapshot) {
  await initDb();
  const last = await one(`SELECT recorded_at FROM equity_history WHERE session_id=$1 ORDER BY recorded_at DESC LIMIT 1`, [sessionId]);
  if (last && Date.now() - Date.parse(last.recorded_at) < 60000) return;
  await query(`INSERT INTO equity_history(session_id,equity_usd,cash_usd,position_value_usd) VALUES($1,$2,$3,$4)`, [sessionId, snapshot.equityUsd, snapshot.cashUsd, snapshot.positionValueUsd]);
}

async function getEquityHistory(sessionId, limit = 100) {
  await initDb();
  return many(`SELECT equity_usd AS "equityUsd", cash_usd AS "cashUsd", position_value_usd AS "positionValueUsd", recorded_at AS "recordedAt" FROM equity_history WHERE session_id=$1 ORDER BY recorded_at DESC LIMIT $2`, [sessionId, Math.min(500, Math.max(1, limit))]);
}

async function getOrCreateWallet(sessionId) {
  await initDb();

  if (typeof sessionId !== 'string' || !sessionId.trim() || sessionId.length > 200) {
    throw new Error('Invalid session');
  }

  let wallet = await one(`SELECT * FROM wallets WHERE session_id = $1`, [
    sessionId
  ]);

  if (!wallet) {
    await query(
      `INSERT INTO wallets (session_id, cash_usd) VALUES ($1, $2)
       ON CONFLICT (session_id) DO NOTHING`,
      [sessionId, STARTING_BALANCE]
    );
    wallet = await one(`SELECT * FROM wallets WHERE session_id = $1`, [
      sessionId
    ]);
  }

  return wallet;
}

async function updateCash(sessionId, cashUsd) {
  await initDb();
  const amount = Number(cashUsd);

  if (!Number.isFinite(amount) || amount < 0) {
    throw new Error('Invalid cash balance');
  }

  await query(
    `UPDATE wallets
     SET cash_usd = $1, updated_at = NOW()
     WHERE session_id = $2`,
    [amount, sessionId]
  );
}

async function addBalance(sessionId, type, amount) {
  await initDb();

  if (typeof sessionId !== 'string' || !sessionId.trim()) {
    throw new Error('Session ID required');
  }

  if (type !== 'deposit' && type !== 'withdraw') {
    throw new Error('Invalid balance transaction type');
  }

  const numericAmount =
    typeof amount === 'number' ? amount : Number(amount);

  if (
    !Number.isFinite(numericAmount) ||
    numericAmount <= 0 ||
    numericAmount === Infinity ||
    numericAmount === -Infinity
  ) {
    throw new Error('Amount must be a finite number greater than zero');
  }

  await getOrCreateWallet(sessionId);
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await client.query(
      `SELECT cash_usd FROM wallets WHERE session_id = $1 FOR UPDATE`,
      [sessionId]
    );
    const currentCash = Number(result.rows[0]?.cash_usd);
    if (!Number.isFinite(currentCash) || currentCash < 0) {
      throw new Error('Invalid cash balance');
    }
    if (type === 'withdraw' && numericAmount > currentCash) {
      throw new Error('Insufficient cash');
    }
    const nextCash = type === 'deposit'
      ? currentCash + numericAmount
      : currentCash - numericAmount;
    if (!Number.isFinite(nextCash) || nextCash < 0) {
      throw new Error('Invalid resulting cash balance');
    }
    await client.query(
      `UPDATE wallets SET cash_usd = $1, updated_at = NOW() WHERE session_id = $2`,
      [nextCash, sessionId]
    );
    await client.query(
      `INSERT INTO balance_transactions (session_id, type, amount_usd, created_at)
       VALUES ($1, $2, $3, NOW())`,
      [sessionId, type, numericAmount]
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

async function getBalanceTransactions(sessionId) {
  await initDb();
  return many(
    `SELECT
       id,
       type,
       amount_usd AS "amountUsd",
       created_at AS "createdAt"
     FROM balance_transactions
     WHERE session_id = $1
     ORDER BY id DESC`,
    [sessionId]
  );
}

module.exports = {
  pool,
  initDb,
  STARTING_BALANCE,
  getOrCreateWallet,
  updateCash,
  addBalance,
  getBalanceTransactions,
  query,
  one,
  many,
  getDatabaseStatus,
  recordEquity,
  getEquityHistory
};
