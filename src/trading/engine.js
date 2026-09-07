const {
  db,
  getOrCreateWallet,
  updateCash,
  addBalance,
  getBalanceTransactions,
  STARTING_BALANCE
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

  if (!Number.isFinite(n) || n < 0 || n > 100) {
    return fallback;
  }

  return n;
}

function getFeePct(data = {}) {
  return cleanPct(
    data.feePct ??
      data.feePercent ??
      process.env.PAPERTRADE_FEE_PCT,
    DEFAULT_FEE_PCT
  );
}

function getSlippagePct(data = {}) {
  return cleanPct(
    data.slippagePct ??
      data.slippagePercent ??
      process.env.PAPERTRADE_SLIPPAGE_PCT,
    DEFAULT_SLIPPAGE_PCT
  );
}

function executionPrice(marketPrice, side, slippagePct) {
  const price = Number(marketPrice);
  const slippage = Number(slippagePct) / 100;

  if (!Number.isFinite(price) || price <= 0) {
    throw new Error('Invalid market price');
  }

  if (!Number.isFinite(slippage) || slippage < 0 || slippage > 1) {
    throw new Error('Invalid slippage');
  }

  if (side === 'BUY') {
    return price * (1 + slippage);
  }

  return price * (1 - slippage);
}

function getPositions(sessionId) {
  return db.prepare(`
    SELECT *
    FROM positions
    WHERE session_id = ?
      AND quantity > 0
    ORDER BY id DESC
  `).all(sessionId).map(row => {
    const quantity = Number(
      row.quantity ??
      row.total_quantity ??
      0
    );

    const costBasis = Number(
      row.cost_basis_usd ??
      row.invested_usd ??
      0
    );

    const averageEntry =
      quantity > 0
        ? costBasis / quantity
        : Number(row.entry_price_usd || 0);

    return {
      id: row.id,
      sessionId: row.session_id,
      chain: row.chain,
      tokenAddress: row.token_address,
      tokenName: row.token_name,
      symbol: row.symbol,

      entryPriceUsd: roundMoney(averageEntry),

      averageEntryPriceUsd:
        roundMoney(averageEntry),

      quantity: roundQuantity(quantity),

      totalQuantity:
        roundQuantity(
          Number(
            row.total_quantity ??
            quantity
          )
        ),

      investedUsd:
        roundMoney(
          Number(
            row.invested_usd ??
            costBasis
          )
        ),

      costBasisUsd:
        roundMoney(costBasis),

      openedAt: row.opened_at,
      updatedAt: row.updated_at || row.opened_at
    };
  });
}

function getPosition(sessionId, id) {
  const row = db.prepare(`
    SELECT *
    FROM positions
    WHERE session_id = ?
      AND id = ?
  `).get(sessionId, id);

  if (!row) return null;

  const quantity = Number(
    row.quantity ??
    row.total_quantity ??
    0
  );

  const costBasis = Number(
    row.cost_basis_usd ??
    row.invested_usd ??
    0
  );

  const averageEntry =
    quantity > 0
      ? costBasis / quantity
      : Number(row.entry_price_usd || 0);

  return {
    id: row.id,
    sessionId: row.session_id,
    chain: row.chain,
    tokenAddress: row.token_address,
    tokenName: row.token_name,
    symbol: row.symbol,

    entryPriceUsd:
      roundMoney(averageEntry),

    averageEntryPriceUsd:
      roundMoney(averageEntry),

    quantity:
      roundQuantity(quantity),

    totalQuantity:
      roundQuantity(
        Number(
          row.total_quantity ??
          quantity
        )
      ),

    investedUsd:
      roundMoney(
        Number(
          row.invested_usd ??
          costBasis
        )
      ),

    costBasisUsd:
      roundMoney(costBasis),

    openedAt: row.opened_at,
    updatedAt: row.updated_at || row.opened_at
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

    priceUsd:
      Number(
        row.execution_price_usd ??
        row.price_usd ??
        0
      ),

    marketPriceUsd:
      Number(
        row.market_price_usd ??
        row.price_usd ??
        0
      ),

    executionPriceUsd:
      Number(
        row.execution_price_usd ??
        row.price_usd ??
        0
      ),

    quantity:
      Number(row.quantity || 0),

    amountUsd:
      Number(row.amount_usd || 0),

    feeUsd:
      Number(row.fee_usd || 0),

    slippagePct:
      Number(row.slippage_pct || 0),

    pnlUsd:
      Number(row.pnl_usd || 0),

    source:
      row.source || null,

    createdAt:
      row.created_at
  }));
}

function calculateValuation(sessionId, prices = {}) {
  const positions = getPositions(sessionId);

  let positionValueUsd = 0;
  let unrealizedPnlUsd = 0;

  for (const position of positions) {
    const key =
      `${position.chain}:${position.tokenAddress}`.toLowerCase();

    const suppliedPrice =
      prices[key] ??
      prices[position.tokenAddress] ??
      prices[position.tokenAddress?.toLowerCase()];

    const price = Number(suppliedPrice);

    if (!Number.isFinite(price) || price <= 0) {
      continue;
    }

    const value =
      position.quantity * price;

    const pnl =
      value - position.costBasisUsd;

    positionValueUsd += value;
    unrealizedPnlUsd += pnl;
  }

  const realizedRow = db.prepare(`
    SELECT COALESCE(SUM(pnl_usd), 0) AS realized
    FROM trades
    WHERE session_id = ?
      AND side = 'SELL'
  `).get(sessionId);

  return {
    positionValueUsd,
    unrealizedPnlUsd,
    realizedPnlUsd:
      Number(realizedRow?.realized || 0)
  };
}

function walletSummary(
  sessionId,
  solPriceUsd = null,
  valuation = {}
) {
  const wallet =
    getOrCreateWallet(sessionId);

  const cashUsd =
    Number(wallet.cash_usd || 0);

  const positionValueUsd =
    Number(
      valuation.positionValueUsd || 0
    );

  const unrealizedPnlUsd =
    Number(
      valuation.unrealizedPnlUsd || 0
    );

  const realizedPnlUsd =
    Number(
      valuation.realizedPnlUsd || 0
    );

  const equityUsd =
    cashUsd + positionValueUsd;

  const solPrice =
    Number(solPriceUsd);

  const validSolPrice =
    Number.isFinite(solPrice) &&
    solPrice > 0;

  return {
    cashUsd:
      roundMoney(cashUsd),

    positionValueUsd:
      roundMoney(positionValueUsd),

    equityUsd:
      roundMoney(equityUsd),

    realizedPnlUsd:
      roundMoney(realizedPnlUsd),

    unrealizedPnlUsd:
      roundMoney(unrealizedPnlUsd),

    totalPnlUsd:
      roundMoney(
        realizedPnlUsd +
        unrealizedPnlUsd
      ),

    startingBalanceUsd:
      STARTING_BALANCE,

    solPriceUsd:
      validSolPrice
        ? roundMoney(solPrice)
        : null,

    cashSol:
      validSolPrice
        ? cashUsd / solPrice
        : null,

    equitySol:
      validSolPrice
        ? equityUsd / solPrice
        : null,

    updatedAt:
      Date.now()
  };
}

function findExistingPosition(
  sessionId,
  chain,
  address
) {
  return db.prepare(`
    SELECT *
    FROM positions
    WHERE session_id = ?
      AND LOWER(chain) = LOWER(?)
      AND LOWER(token_address) = LOWER(?)
      AND quantity > 0
    ORDER BY id ASC
    LIMIT 1
  `).get(
    sessionId,
    chain,
    address
  );
}

function buy(sessionId, data = {}) {
  const amountUsd =
    Number(data.amountUsd);

  const marketPrice =
    Number(
      data.marketPriceUsd ??
      data.priceUsd
    );

  if (
    !Number.isFinite(amountUsd) ||
    amountUsd <= 0
  ) {
    throw new Error(
      'Investment amount must be greater than zero'
    );
  }

  if (
    !Number.isFinite(marketPrice) ||
    marketPrice <= 0
  ) {
    throw new Error(
      'A valid token price is required'
    );
  }

  if (
    typeof data.chain !== 'string' ||
    !data.chain.trim()
  ) {
    throw new Error(
      'Token chain is required'
    );
  }

  if (
    typeof data.address !== 'string' ||
    !data.address.trim()
  ) {
    throw new Error(
      'Token address is required'
    );
  }

  const feePct =
    getFeePct(data);

  const slippagePct =
    getSlippagePct(data);

  const execution =
    executionPrice(
      marketPrice,
      'BUY',
      slippagePct
    );

  const feeUsd =
    roundMoney(
      amountUsd *
      feePct /
      100
    );

  const totalCashRequired =
    roundMoney(
      amountUsd +
      feeUsd
    );

  const quantity =
    roundQuantity(
      amountUsd / execution
    );

  if (
    !Number.isFinite(quantity) ||
    quantity <= 0
  ) {
    throw new Error(
      'Unable to calculate token quantity'
    );
  }

  const wallet =
    getOrCreateWallet(sessionId);

  if (
    Number(wallet.cash_usd) <
    totalCashRequired
  ) {
    throw new Error(
      'Insufficient paper cash'
    );
  }

  const tokenName =
    data.tokenName ||
    'Unknown Token';

  const symbol =
    data.symbol ||
    'UNKNOWN';

  let result;

  const transaction =
    db.transaction(() => {
      const latestWallet =
        getOrCreateWallet(sessionId);

      if (
        Number(latestWallet.cash_usd) <
        totalCashRequired
      ) {
        throw new Error(
          'Insufficient paper cash'
        );
      }

      updateCash(
        sessionId,
        roundMoney(
          Number(latestWallet.cash_usd) -
          totalCashRequired
        )
      );

      const existing =
        findExistingPosition(
          sessionId,
          data.chain,
          data.address
        );

      if (existing) {
        const oldQuantity =
          Number(
            existing.quantity ??
            existing.total_quantity ??
            0
          );

        const oldCostBasis =
          Number(
            existing.cost_basis_usd ??
            existing.invested_usd ??
            0
          );

        const newQuantity =
          roundQuantity(
            oldQuantity +
            quantity
          );

        const newCostBasis =
          roundMoney(
            oldCostBasis +
            amountUsd
          );

        const averageEntry =
          newQuantity > 0
            ? newCostBasis /
              newQuantity
            : execution;

        db.prepare(`
          UPDATE positions
          SET
            token_name = ?,
            symbol = ?,
            entry_price_usd = ?,
            quantity = ?,
            invested_usd = ?,
            cost_basis_usd = ?,
            total_quantity = ?,
            updated_at = CURRENT_TIMESTAMP
          WHERE id = ?
            AND session_id = ?
        `).run(
          tokenName,
          symbol,
          averageEntry,
          newQuantity,
          newCostBasis,
          newCostBasis,
          newQuantity,
          existing.id,
          sessionId
        );

        result = {
          positionId: existing.id,
          quantity: newQuantity,
          costBasisUsd: newCostBasis,
          averageEntryPriceUsd:
            averageEntry
        };
      } else {
        const info =
          db.prepare(`
            INSERT INTO positions (
              session_id,
              chain,
              token_address,
              token_name,
              symbol,
              entry_price_usd,
              quantity,
              invested_usd,
              cost_basis_usd,
              total_quantity,
              updated_at
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
          `).run(
            sessionId,
            data.chain,
            data.address,
            tokenName,
            symbol,
            execution,
            quantity,
            amountUsd,
            amountUsd,
            quantity
          );

        result = {
          positionId:
            Number(info.lastInsertRowid),

          quantity,

          costBasisUsd:
            roundMoney(amountUsd),

          averageEntryPriceUsd:
            execution
        };
      }

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
          pnl_usd,
          fee_usd,
          slippage_pct,
          market_price_usd,
          execution_price_usd,
          source
        )
        VALUES (?, ?, ?, ?, ?, 'BUY', ?, ?, ?, 0, ?, ?, ?, ?, ?)
      `).run(
        sessionId,
        data.chain,
        data.address,
        tokenName,
        symbol,
        execution,
        quantity,
        amountUsd,
        feeUsd,
        slippagePct,
        marketPrice,
        execution,
        data.source || null
      );
    });

  transaction();

  return {
    side: 'BUY',

    marketPriceUsd:
      roundMoney(marketPrice),

    executionPriceUsd:
      roundMoney(execution),

    slippagePct,

    amountUsd:
      roundMoney(amountUsd),

    feeUsd,

    totalCashRequired,

    quantity,

    ...result,

    wallet:
      getOrCreateWallet(sessionId)
  };
}

function sell(
  sessionId,
  positionId,
  priceOrData,
  maybeData
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

  let data = {};

  if (
    priceOrData &&
    typeof priceOrData === 'object'
  ) {
    data = priceOrData;
  } else {
    data = {
      ...(maybeData || {}),
      priceUsd: priceOrData
    };
  }

  const marketPrice =
    Number(
      data.marketPriceUsd ??
      data.priceUsd
    );

  if (
    !Number.isFinite(marketPrice) ||
    marketPrice <= 0
  ) {
    throw new Error(
      'Invalid sell price'
    );
  }

  const requestedQuantity =
    data.quantity ??
    data.sellQuantity ??
    data.amountQuantity;

  let quantity;

  if (
    requestedQuantity === undefined ||
    requestedQuantity === null ||
    requestedQuantity === ''
  ) {
    quantity =
      position.quantity;
  } else {
    quantity =
      Number(requestedQuantity);
  }

  if (
    !Number.isFinite(quantity) ||
    quantity <= 0
  ) {
    throw new Error(
      'Sell quantity must be greater than zero'
    );
  }

  const epsilon = 1e-10;

  if (
    quantity >
    position.quantity + epsilon
  ) {
    throw new Error(
      'Cannot sell more than the position quantity'
    );
  }

  quantity =
    Math.min(
      quantity,
      position.quantity
    );

  const feePct =
    getFeePct(data);

  const slippagePct =
    getSlippagePct(data);

  const execution =
    executionPrice(
      marketPrice,
      'SELL',
      slippagePct
    );

  const grossProceeds =
    roundMoney(
      quantity * execution
    );

  const feeUsd =
    roundMoney(
      grossProceeds *
      feePct /
      100
    );

  const netProceeds =
    roundMoney(
      grossProceeds -
      feeUsd
    );

  const proportion =
    position.quantity > 0
      ? quantity /
        position.quantity
      : 1;

  const soldCostBasis =
    roundMoney(
      position.costBasisUsd *
      proportion
    );

  const realizedPnl =
    roundMoney(
      netProceeds -
      soldCostBasis
    );

  const remainingQuantity =
    roundQuantity(
      position.quantity -
      quantity
    );

  const remainingCostBasis =
    roundMoney(
      position.costBasisUsd -
      soldCostBasis
    );

  let result;

  const transaction =
    db.transaction(() => {
      const wallet =
        getOrCreateWallet(sessionId);

      updateCash(
        sessionId,
        roundMoney(
          Number(wallet.cash_usd) +
          netProceeds
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
          pnl_usd,
          fee_usd,
          slippage_pct,
          market_price_usd,
          execution_price_usd,
          source
        )
        VALUES (?, ?, ?, ?, ?, 'SELL', ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        sessionId,
        position.chain,
        position.tokenAddress,
        position.tokenName,
        position.symbol,
        execution,
        quantity,
        grossProceeds,
        realizedPnl,
        feeUsd,
        slippagePct,
        marketPrice,
        execution,
        data.source || null
      );

      if (
        remainingQuantity <=
        epsilon
      ) {
        db.prepare(`
          DELETE FROM positions
          WHERE id = ?
            AND session_id = ?
        `).run(
          positionId,
          sessionId
        );

        result = {
          closed: true,
          remainingQuantity: 0,
          remainingCostBasisUsd: 0
        };
      } else {
        const remainingAverageEntry =
          remainingQuantity > 0
            ? remainingCostBasis /
              remainingQuantity
            : 0;

        db.prepare(`
          UPDATE positions
          SET
            entry_price_usd = ?,
            quantity = ?,
            invested_usd = ?,
            cost_basis_usd = ?,
            total_quantity = ?,
            updated_at = CURRENT_TIMESTAMP
          WHERE id = ?
            AND session_id = ?
        `).run(
          remainingAverageEntry,
          remainingQuantity,
          remainingCostBasis,
          remainingCostBasis,
          remainingQuantity,
          positionId,
          sessionId
        );

        result = {
          closed: false,
          remainingQuantity,
          remainingCostBasisUsd:
            remainingCostBasis,
          remainingAverageEntryPriceUsd:
            remainingAverageEntry
        };
      }
    });

  transaction();

  return {
    side: 'SELL',

    marketPriceUsd:
      roundMoney(marketPrice),

    executionPriceUsd:
      roundMoney(execution),

    slippagePct,

    quantity:
      roundQuantity(quantity),

    grossProceeds,

    feeUsd,

    netProceeds,

    soldCostBasisUsd:
      soldCostBasis,

    pnlUsd:
      realizedPnl,

    ...result,

    wallet:
      getOrCreateWallet(sessionId)
  };
}

function deposit(
  sessionId,
  amountUsd
) {
  return addBalance(
    sessionId,
    'deposit',
    amountUsd
  );
}

function withdraw(
  sessionId,
  amountUsd
) {
  return addBalance(
    sessionId,
    'withdrawal',
    amountUsd
  );
}

function getBalanceHistory(sessionId) {
  return getBalanceTransactions(
    sessionId
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
        DELETE FROM balance_transactions
        WHERE session_id = ?
      `).run(sessionId);

      db.prepare(`
        UPDATE wallets
        SET
          cash_usd = ?,
          updated_at = CURRENT_TIMESTAMP
        WHERE session_id = ?
      `).run(
        STARTING_BALANCE,
        sessionId
      );
    });

  transaction();

  return getOrCreateWallet(
    sessionId
  );
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
