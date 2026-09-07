const express = require('express');
const path = require('path');

const {
  resolveToken,
  getPrice,
  getSolPrice,
  searchTokens
} = require('./src/providers');

const {
  isValidAddress
} = require('./src/chains');

const {
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
} = require('./src/trading/engine');

const app = express();

const PORT =
  Number(process.env.PORT) || 10000;

app.use(
  express.json({
    limit: '100kb'
  })
);

app.use(
  express.static(
    path.join(__dirname, 'public')
  )
);

function sessionId(req) {
  const supplied =
    req.headers['x-session-id'];

  if (
    typeof supplied === 'string' &&
    supplied.trim()
  ) {
    return supplied.trim().slice(0, 200);
  }

  throw new Error('Session ID required');
}

function errorResponse(res, error) {
  const message =
    error?.message || 'Request failed';

  let status = 500;

  if (/not found/i.test(message)) {
    status = 404;
  } else if (
    /invalid|insufficient|amount|quantity|price|cash|slippage|fee|sell more|session|required/i.test(
      message
    )
  ) {
    status = 400;
  }

  res.status(status).json({
    ok: false,
    error: message
  });
}


const CONFIG = {
  feePct: Number.isFinite(
    Number(process.env.PAPERTRADE_FEE_PCT)
  )
    ? Number(process.env.PAPERTRADE_FEE_PCT)
    : 0.25,

  slippagePct: Number.isFinite(
    Number(process.env.PAPERTRADE_SLIPPAGE_PCT)
  )
    ? Number(process.env.PAPERTRADE_SLIPPAGE_PCT)
    : 0.50,

  staleAfterSeconds: Number.isFinite(
    Number(process.env.PAPERTRADE_STALE_AFTER_SECONDS)
  )
    ? Number(process.env.PAPERTRADE_STALE_AFTER_SECONDS)
    : 30,

  lowLiquidityUsd: Number.isFinite(
    Number(process.env.PAPERTRADE_LOW_LIQUIDITY_USD)
  )
    ? Number(process.env.PAPERTRADE_LOW_LIQUIDITY_USD)
    : 10000
};

function freshness(price) {
  if (!price) {
    return {
      stale: true,
      ageSeconds: null
    };
  }

  const raw = price.updatedAt;

  const ms =
    typeof raw === 'number'
      ? raw
      : Date.parse(raw);

  if (!Number.isFinite(ms)) {
    return {
      stale: true,
      ageSeconds: null
    };
  }

  const ageSeconds =
    Math.max(
      0,
      Math.floor(
        (Date.now() - ms) / 1000
      )
    );

  return {
    stale:
      ageSeconds >
      CONFIG.staleAfterSeconds,

    ageSeconds
  };
}

function decoratePrice(price) {
  if (!price) return null;

  return {
    ...price,
    ...freshness(price)
  };
}

function requireFreshPrice(price) {
  if (
    !price ||
    !validPositiveNumber(price.priceUsd)
  ) {
    throw new Error(
      'Live price unavailable for this token'
    );
  }

  const fresh = freshness(price);

  if (fresh.stale) {
    throw new Error(
      `Token price is stale (${fresh.ageSeconds ?? '?'}s old)`
    );
  }

  return {
    ...price,
    ...fresh
  };
}

function validPositiveNumber(value) {
  const n = Number(value);

  return (
    Number.isFinite(n) &&
    n > 0
  );
}

async function liveValuation(id) {
  const positions =
    getPositions(id);

  let positionValueUsd = 0;
  let unrealizedPnlUsd = 0;

  const enriched =
    await Promise.all(
      positions.map(async position => {
        try {
          const rawPrice =
            await getPrice(
              position.chain,
              position.tokenAddress
            );

          const price =
            decoratePrice(rawPrice);

          const currentPriceUsd =
            Number(
              price?.priceUsd
            );

          if (
            !Number.isFinite(
              currentPriceUsd
            ) ||
            currentPriceUsd <= 0
          ) {
            return {
              position,
              price: null,
              currentPriceUsd: null,
              currentValueUsd: null,
              unrealizedPnlUsd: null,
              unrealizedPnlPct: null
            };
          }

          const currentValueUsd =
            position.quantity *
            currentPriceUsd;

          const costBasis =
            Number(
              position.costBasisUsd ??
              position.investedUsd ??
              0
            );

          const pnl =
            currentValueUsd -
            costBasis;

          positionValueUsd +=
            currentValueUsd;

          unrealizedPnlUsd +=
            pnl;

          return {
            position,
            price,

            currentPriceUsd,

            currentValueUsd,

            unrealizedPnlUsd:
              pnl,

            unrealizedPnlPct:
              costBasis > 0
                ? (pnl / costBasis) *
                  100
                : 0
          };
        } catch (_) {
          return {
            position,
            price: null,
            currentPriceUsd: null,
            currentValueUsd: null,
            unrealizedPnlUsd: null,
            unrealizedPnlPct: null
          };
        }
      })
    );

  const trades =
    getTrades(id);

  const realizedPnlUsd =
    trades.reduce(
      (sum, trade) => {
        if (trade.side !== 'SELL') {
          return sum;
        }

        return (
          sum +
          Number(
            trade.pnlUsd || 0
          )
        );
      },
      0
    );

  return {
    enriched,
    positionValueUsd,
    unrealizedPnlUsd,
    realizedPnlUsd
  };
}

async function walletResponse(id) {
  const valuation =
    await liveValuation(id);

  let solPriceUsd = null;

  try {
    solPriceUsd =
      await getSolPrice();
  } catch (_) {}

  return walletSummary(
    id,
    solPriceUsd,
    valuation
  );
}

/*
 * PUBLIC CONFIG
 */

app.get(
  '/api/config',
  (req, res) => {
    res.json({
      ok: true,
      config: {
        feePct: CONFIG.feePct,
        slippagePct: CONFIG.slippagePct,
        staleAfterSeconds:
          CONFIG.staleAfterSeconds,
        lowLiquidityUsd:
          CONFIG.lowLiquidityUsd
      }
    });
  }
);

/*
 * TOKEN RESOLUTION
 */

app.get(
  '/api/token/resolve/:address',
  async (req, res) => {
    try {
      const address =
        String(
          req.params.address || ''
        ).trim();

      if (!address) {
        return res.status(400).json({
          ok: false,
          error: 'Token address is required'
        });
      }

      const validChains =
        isValidAddress(address);

      if (!validChains.length) {
        return res.status(400).json({
          ok: false,
          error:
            'Invalid token address or Solana mint'
        });
      }

      for (const chain of validChains) {
        try {
          const token =
            await resolveToken(
              chain,
              address
            );

          if (token) {
            return res.json({
              ok: true,
              token
            });
          }
        } catch (_) {
          /*
           * Continue to the next supported
           * chain/provider instead of failing
           * the entire lookup.
           */
        }
      }

      try {
        const token =
          await resolveToken(
          undefined,
          address
        );

        if (token) {
          return res.json({
            ok: true,
            token
          });
        }
      } catch (_) {}

      return res.status(404).json({
        ok: false,
        error: 'Token not found'
      });
    } catch (error) {
      errorResponse(res, error);
    }
  }
);

/*
 * TOKEN SEARCH
 */

app.get(
  '/api/token/search',
  async (req, res) => {
    try {
      const query =
        String(
          req.query?.q || ''
        ).trim();

      if (!query) {
        return res.status(400).json({
          ok: false,
          error:
            'Search query is required'
        });
      }

      if (query.length > 100) {
        return res.status(400).json({
          ok: false,
          error:
            'Search query is too long'
        });
      }

      const results =
        await searchTokens(query);

      if (!results.length) {
        return res.status(404).json({
          ok: false,
          error:
            'No matching tokens found'
        });
      }

      res.json({
        ok: true,
        results
      });
    } catch (error) {
      errorResponse(res, error);
    }
  }
);

/*
 * TOKEN DETAILS
 */

app.get(
  '/api/token/:chain/:address',
  async (req, res) => {
    try {
      const chain =
        String(
          req.params.chain || ''
        ).trim();

      const address =
        String(
          req.params.address || ''
        ).trim();

      if (
        !chain ||
        !address ||
        !isValidAddress(address)
          .includes(chain)
      ) {
        return res.status(400).json({
          ok: false,
          error:
            'Invalid address for selected chain'
        });
      }

      const token =
        await resolveToken(
          chain,
          address
        );

      if (!token) {
        return res.status(404).json({
          ok: false,
          error: 'Token not found'
        });
      }

      res.json({
        ok: true,
        token
      });
    } catch (error) {
      errorResponse(res, error);
    }
  }
);

/*
 * PRICE
 */

app.get(
  '/api/price/:chain/:address',
  async (req, res) => {
    try {
      const chain =
        String(
          req.params.chain || ''
        ).trim();

      const address =
        String(
          req.params.address || ''
        ).trim();

      if (
        !chain ||
        !address ||
        !isValidAddress(address)
          .includes(chain)
      ) {
        return res.status(400).json({
          ok: false,
          error:
            'Invalid address for selected chain'
        });
      }

      const price =
        await getPrice(
          chain,
          address
        );

      if (
        !price ||
        !validPositiveNumber(
          price.priceUsd
        )
      ) {
        return res.status(404).json({
          ok: false,
          error:
            'Tradeable price unavailable'
        });
      }

      res.json({
        ok: true,
        price:
          decoratePrice(price)
      });
    } catch (error) {
      errorResponse(res, error);
    }
  }
);

/*
 * SOL PRICE
 */

app.get(
  '/api/sol-price',
  async (req, res) => {
    try {
      const priceUsd =
        await getSolPrice();

      if (
        !validPositiveNumber(
          priceUsd
        )
      ) {
        return res.status(503).json({
          ok: false,
          error:
            'SOL price temporarily unavailable'
        });
      }

      res.json({
        ok: true,
        priceUsd:
          Number(priceUsd),
        updatedAt:
          Date.now()
      });
    } catch (error) {
      errorResponse(res, error);
    }
  }
);

/*
 * WALLET
 */

app.get(
  '/api/wallet',
  async (req, res) => {
    try {
      const id =
        sessionId(req);

      res.json({
        ok: true,
        wallet:
          await walletResponse(id)
      });
    } catch (error) {
      errorResponse(res, error);
    }
  }
);

/*
 * POSITIONS
 */

app.get(
  '/api/positions',
  async (req, res) => {
    try {
      const id =
        sessionId(req);

      const valuation =
        await liveValuation(id);

      res.json({
        ok: true,

        positions:
          valuation.enriched.map(item => ({
            ...item.position,

            currentPriceUsd:
              item.currentPriceUsd,

            currentValueUsd:
              item.currentValueUsd,

            unrealizedPnlUsd:
              item.unrealizedPnlUsd,

            unrealizedPnlPct:
              item.unrealizedPnlPct,

            priceUpdatedAt:
              item.price?.updatedAt ??
              null,

            priceSource:
              item.price?.source ??
              null,

            stale:
              item.price?.stale ??
              false,

            ageSeconds:
              item.price?.ageSeconds ??
              null
          }))
      });
    } catch (error) {
      errorResponse(res, error);
    }
  }
);

/*
 * SINGLE POSITION
 */

app.get(
  '/api/position/:id',
  (req, res) => {
    try {
      const id =
        sessionId(req);

      const positionId =
        Number(
          req.params.id
        );

      if (
        !Number.isInteger(
          positionId
        ) ||
        positionId <= 0
      ) {
        return res.status(400).json({
          ok: false,
          error:
            'Invalid position ID'
        });
      }

      const position =
        getPosition(
          id,
          positionId
        );

      if (!position) {
        return res.status(404).json({
          ok: false,
          error:
            'Position not found'
        });
      }

      res.json({
        ok: true,
        position
      });
    } catch (error) {
      errorResponse(res, error);
    }
  }
);

/*
 * TRADES
 */

app.get(
  '/api/trades',
  (req, res) => {
    try {
      res.json({
        ok: true,
        trades:
          getTrades(
            sessionId(req)
          )
      });
    } catch (error) {
      errorResponse(res, error);
    }
  }
);

/*
 * BALANCE HISTORY
 */

app.get(
  '/api/balance-history',
  (req, res) => {
    try {
      res.json({
        ok: true,
        history:
          getBalanceHistory(
            sessionId(req)
          )
      });
    } catch (error) {
      errorResponse(res, error);
    }
  }
);

/*
 * DEPOSIT
 */

app.post(
  '/api/deposit',
  async (req, res) => {
    try {
      const amount =
        Number(
          req.body?.amountUsd
        );

      if (
        !Number.isFinite(amount) ||
        amount <= 0
      ) {
        return res.status(400).json({
          ok: false,
          error:
            'Deposit amount must be greater than zero'
        });
      }

      const id =
        sessionId(req);

      const wallet =
        deposit(
          id,
          amount
        );

      res.json({
        ok: true,
        wallet:
          await walletResponse(id),
        transaction: {
          type: 'deposit',
          amountUsd: amount
        }
      });
    } catch (error) {
      errorResponse(res, error);
    }
  }
);

/*
 * WITHDRAW
 */

app.post(
  '/api/withdraw',
  async (req, res) => {
    try {
      const amount =
        Number(
          req.body?.amountUsd
        );

      if (
        !Number.isFinite(amount) ||
        amount <= 0
      ) {
        return res.status(400).json({
          ok: false,
          error:
            'Withdrawal amount must be greater than zero'
        });
      }

      const id =
        sessionId(req);

      withdraw(
        id,
        amount
      );

      res.json({
        ok: true,
        wallet:
          await walletResponse(id),
        transaction: {
          type: 'withdrawal',
          amountUsd: amount
        }
      });
    } catch (error) {
      errorResponse(res, error);
    }
  }
);

/*
 * BUY
 */

app.post(
  '/api/buy',
  async (req, res) => {
    try {
      const body =
        req.body || {};

      const chain =
        String(
          body.chain || ''
        ).trim();

      const address =
        String(
          body.address || ''
        ).trim();

      const amountUsd =
        Number(
          body.amountUsd
        );

      if (
        !chain ||
        !address ||
        !isValidAddress(address)
          .includes(chain)
      ) {
        return res.status(400).json({
          ok: false,
          error:
            'Invalid chain or token address'
        });
      }

      if (
        !Number.isFinite(
          amountUsd
        ) ||
        amountUsd <= 0
      ) {
        return res.status(400).json({
          ok: false,
          error:
            'Investment amount must be greater than zero'
        });
      }

      const rawPrice =
        await getPrice(
          chain,
          address
        );

      let token;
      try {
        token = requireFreshPrice(rawPrice);
      } catch (error) {
        return res.status(503).json({
          ok: false,
          error:
            error.message ||
            'Live price unavailable for this token'
        });
      }

      const result =
        buy(
          sessionId(req),
          {
            chain,
            address,
            amountUsd,

            marketPriceUsd:
              Number(
                token.priceUsd
              ),

            priceUsd:
              Number(
                token.priceUsd
              ),

            tokenName:
              token.name,

            symbol:
              token.symbol,

            feePct:
              CONFIG.feePct,

            slippagePct:
              CONFIG.slippagePct,

            source:
              token.source
          }
        );

      const id =
        sessionId(req);

      res.json({
        ok: true,
        token,

        trade: result,

        wallet:
          await walletResponse(id)
      });
    } catch (error) {
      errorResponse(res, error);
    }
  }
);

/*
 * SELL
 *
 * Supports:
 * - full position
 * - custom quantity
 * - percentage
 */

app.post(
  '/api/sell',
  async (req, res) => {
    try {
      const body =
        req.body || {};

      const id =
        sessionId(req);

      const positionId =
        Number(
          body.positionId
        );

      if (
        !Number.isInteger(
          positionId
        ) ||
        positionId <= 0
      ) {
        return res.status(400).json({
          ok: false,
          error:
            'Invalid position ID'
        });
      }

      const position =
        getPosition(
          id,
          positionId
        );

      if (!position) {
        return res.status(404).json({
          ok: false,
          error:
            'Position not found'
        });
      }

      let quantity;

      if (
        body.quantity !== undefined
      ) {
        quantity =
          Number(
            body.quantity
          );
      } else if (
        body.sellQuantity !== undefined
      ) {
        quantity =
          Number(
            body.sellQuantity
          );
      } else if (
        body.percent !== undefined
      ) {
        const percent =
          Number(
            body.percent
          );

        if (
          !Number.isFinite(percent) ||
          percent <= 0 ||
          percent > 100
        ) {
          return res.status(400).json({
            ok: false,
            error:
              'Sell percentage must be between 0 and 100'
          });
        }

        quantity =
          position.quantity *
          (percent / 100);
      } else {
        quantity =
          position.quantity;
      }

      if (
        !Number.isFinite(quantity) ||
        quantity <= 0
      ) {
        return res.status(400).json({
          ok: false,
          error:
            'Sell quantity must be greater than zero'
        });
      }

      if (
        quantity >
        position.quantity
      ) {
        return res.status(400).json({
          ok: false,
          error:
            'Cannot sell more than the position quantity'
        });
      }

      const rawPrice =
        await getPrice(
          position.chain,
          position.tokenAddress
        );

      let token;
      try {
        token = requireFreshPrice(rawPrice);
      } catch (error) {
        return res.status(503).json({
          ok: false,
          error:
            error.message ||
            'Live price unavailable for this token'
        });
      }

      const result =
        sell(
          id,
          positionId,
          {
            quantity,

            marketPriceUsd:
              Number(
                token.priceUsd
              ),

            priceUsd:
              Number(
                token.priceUsd
              ),

            feePct:
              CONFIG.feePct,

            slippagePct:
              CONFIG.slippagePct,

            source:
              token.source
          }
        );

      res.json({
        ok: true,

        token,

        trade: result,

        wallet:
          await walletResponse(id)
      });
    } catch (error) {
      errorResponse(res, error);
    }
  }
);

/*
 * RESET
 */

app.post(
  '/api/reset',
  async (req, res) => {
    try {
      const id =
        sessionId(req);

      const wallet =
        reset(id);

      res.json({
        ok: true,

        message:
          'Paper account reset',

        wallet:
          await walletResponse(id)
      });
    } catch (error) {
      errorResponse(res, error);
    }
  }
);

/*
 * HEALTH
 */

app.get(
  '/api/health',
  (req, res) => {
    res.json({
      ok: true,
      service: 'papertrade',
      timestamp: Date.now()
    });
  }
);

/*
 * FRONTEND FALLBACK
 */

app.get(
  '*',
  (req, res) => {
    res.sendFile(
      path.join(
        __dirname,
        'public',
        'index.html'
      )
    );
  }
);

app.use(
  (
    error,
    req,
    res,
    next
  ) => {
    if (
      error?.type ===
      'entity.parse.failed'
    ) {
      return res.status(400).json({
        ok: false,
        error:
          'Invalid JSON request'
      });
    }

    console.error(
      'Unhandled request error:',
      error?.message || error
    );

    res.status(500).json({
      ok: false,
      error:
        'Internal server error'
    });
  }
);

app.listen(
  PORT,
  () => {
    console.log(
      `PaperTrade running on port ${PORT}`
    );
  }
);
