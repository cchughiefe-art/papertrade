const express = require('express');
const path = require('path');

const {
  resolveToken,
  getPrice,
  getSolPrice
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
  return String(
    req.headers['x-session-id'] ||
    req.ip ||
    'demo'
  ).slice(0, 200);
}

function errorResponse(res, error) {
  const message =
    error?.message || 'Request failed';

  let status = 500;

  if (/not found/i.test(message)) {
    status = 404;
  } else if (
    /invalid|insufficient|amount/i.test(message)
  ) {
    status = 400;
  }

  res.status(status).json({
    ok: false,
    error: message
  });
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
          const price =
            await getPrice(
              position.chain,
              position.tokenAddress
            );

          if (
            !price ||
            !Number.isFinite(
              Number(price.priceUsd)
            ) ||
            Number(price.priceUsd) <= 0
          ) {
            return {
              position,
              price: null
            };
          }

          const currentPriceUsd =
            Number(price.priceUsd);

          const currentValueUsd =
            position.quantity *
            currentPriceUsd;

          const pnl =
            currentValueUsd -
            position.investedUsd;

          positionValueUsd +=
            currentValueUsd;

          unrealizedPnlUsd += pnl;

          return {
            position,
            price,
            currentPriceUsd,
            currentValueUsd,
            unrealizedPnlUsd: pnl,
            unrealizedPnlPct:
              position.investedUsd > 0
                ? (pnl /
                    position.investedUsd) *
                  100
                : 0
          };
        } catch (_) {
          return {
            position,
            price: null
          };
        }
      })
    );

  const trades =
    getTrades(id);

  const realizedPnlUsd =
    trades.reduce(
      (sum, trade) =>
        sum + Number(trade.pnlUsd || 0),
      0
    );

  return {
    enriched,
    positionValueUsd,
    unrealizedPnlUsd,
    realizedPnlUsd
  };
}

/* TOKEN RESOLUTION */

app.get(
  '/api/token/resolve/:address',
  async (req, res) => {
    try {
      const address =
        req.params.address.trim();

      const validChains =
        isValidAddress(address);

      if (!validChains.length) {
        return res.status(400).json({
          ok: false,
          error:
            'Invalid token address or Solana mint'
        });
      }

      /*
       * If the address is valid on multiple EVM
       * chains, try each chain until a real market
       * is found.
       */
      for (const chain of validChains) {
        const token =
          await resolveToken(
            address,
            chain
          );

        if (token) {
          return res.json({
            ok: true,
            token
          });
        }
      }

      /*
       * Final automatic lookup.
       */
      const token =
        await resolveToken(address);

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

/* TOKEN */

app.get(
  '/api/token/:chain/:address',
  async (req, res) => {
    try {
      const {
        chain,
        address
      } = req.params;

      if (
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
          address,
          chain
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

/* PRICE */

app.get(
  '/api/price/:chain/:address',
  async (req, res) => {
    try {
      const {
        chain,
        address
      } = req.params;

      if (
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

      if (!price) {
        return res.status(404).json({
          ok: false,
          error: 'Price not found'
        });
      }

      res.json({
        ok: true,
        price
      });
    } catch (error) {
      errorResponse(res, error);
    }
  }
);

/* SOL PRICE */

app.get(
  '/api/sol-price',
  async (req, res) => {
    try {
      const priceUsd =
        await getSolPrice();

      res.json({
        ok: true,
        priceUsd,
        updatedAt: Date.now()
      });
    } catch (error) {
      errorResponse(res, error);
    }
  }
);

/* WALLET */

app.get(
  '/api/wallet',
  async (req, res) => {
    try {
      const id =
        sessionId(req);

      const valuation =
        await liveValuation(id);

      let solPriceUsd = null;

      try {
        solPriceUsd =
          await getSolPrice();
      } catch (_) {}

      res.json({
        ok: true,
        wallet:
          walletSummary(
            id,
            solPriceUsd,
            valuation
          )
      });
    } catch (error) {
      errorResponse(res, error);
    }
  }
);

/* POSITIONS */

app.get(
  '/api/positions',
  async (req, res) => {
    try {
      const valuation =
        await liveValuation(
          sessionId(req)
        );

      res.json({
        ok: true,
        positions:
          valuation.enriched.map(item => {
            const p =
              item.position;

            return {
              ...p,
              currentPriceUsd:
                item.currentPriceUsd ??
                null,
              currentValueUsd:
                item.currentValueUsd ??
                null,
              unrealizedPnlUsd:
                item.unrealizedPnlUsd ??
                null,
              unrealizedPnlPct:
                item.unrealizedPnlPct ??
                null,
              priceUpdatedAt:
                item.price?.updatedAt ??
                null
            };
          })
      });
    } catch (error) {
      errorResponse(res, error);
    }
  }
);

/* TRADES */

app.get(
  '/api/trades',
  (req, res) => {
    try {
      res.json({
        ok: true,
        trades:
          getTrades(sessionId(req))
      });
    } catch (error) {
      errorResponse(res, error);
    }
  }
);

/* BALANCE HISTORY */

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

/* DEPOSIT */

app.post(
  '/api/deposit',
  async (req, res) => {
    try {
      const id =
        sessionId(req);

      deposit(
        id,
        req.body?.amountUsd
      );

      const sol =
        await getSolPrice()
          .catch(() => null);

      const valuation =
        await liveValuation(id);

      res.json({
        ok: true,
        wallet:
          walletSummary(
            id,
            sol,
            valuation
          )
      });
    } catch (error) {
      errorResponse(res, error);
    }
  }
);

/* WITHDRAW */

app.post(
  '/api/withdraw',
  async (req, res) => {
    try {
      const id =
        sessionId(req);

      withdraw(
        id,
        req.body?.amountUsd
      );

      const sol =
        await getSolPrice()
          .catch(() => null);

      const valuation =
        await liveValuation(id);

      res.json({
        ok: true,
        wallet:
          walletSummary(
            id,
            sol,
            valuation
          )
      });
    } catch (error) {
      errorResponse(res, error);
    }
  }
);

/* BUY */

app.post(
  '/api/buy',
  async (req, res) => {
    try {
      const {
        chain,
        address,
        amountUsd
      } = req.body || {};

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

      const amount =
        Number(amountUsd);

      if (
        !Number.isFinite(amount) ||
        amount <= 0
      ) {
        return res.status(400).json({
          ok: false,
          error:
            'Enter a valid investment amount'
        });
      }

      const token =
        await getPrice(
          chain,
          address
        );

      if (
        !token ||
        !Number.isFinite(
          Number(token.priceUsd)
        ) ||
        Number(token.priceUsd) <= 0
      ) {
        return res.status(404).json({
          ok: false,
          error:
            'Live price unavailable for this token'
        });
      }

      buy(
        sessionId(req),
        {
          chain,
          address,
          amountUsd: amount,
          priceUsd:
            Number(token.priceUsd),
          tokenName:
            token.name,
          symbol:
            token.symbol
        }
      );

      const id =
        sessionId(req);

      const sol =
        await getSolPrice()
          .catch(() => null);

      const valuation =
        await liveValuation(id);

      res.json({
        ok: true,
        token,
        wallet:
          walletSummary(
            id,
            sol,
            valuation
          )
      });
    } catch (error) {
      errorResponse(res, error);
    }
  }
);

/* SELL */

app.post(
  '/api/sell',
  async (req, res) => {
    try {
      const id =
        sessionId(req);

      const position =
        getPosition(
          id,
          req.body?.positionId
        );

      if (!position) {
        return res.status(404).json({
          ok: false,
          error: 'Position not found'
        });
      }

      const token =
        await getPrice(
          position.chain,
          position.tokenAddress
        );

      if (
        !token ||
        !Number.isFinite(
          Number(token.priceUsd)
        ) ||
        Number(token.priceUsd) <= 0
      ) {
        return res.status(404).json({
          ok: false,
          error:
            'Live price unavailable for this token'
        });
      }

      const result =
        sell(
          id,
          position.id,
          Number(token.priceUsd)
        );

      const sol =
        await getSolPrice()
          .catch(() => null);

      const valuation =
        await liveValuation(id);

      res.json({
        ok: true,
        token,
        proceeds:
          result.proceeds,
        pnlUsd:
          result.pnlUsd,
        wallet:
          walletSummary(
            id,
            sol,
            valuation
          )
      });
    } catch (error) {
      errorResponse(res, error);
    }
  }
);

/* RESET */

app.post(
  '/api/reset',
  (req, res) => {
    try {
      reset(
        sessionId(req)
      );

      res.json({
        ok: true,
        message:
          'Paper account reset'
      });
    } catch (error) {
      errorResponse(res, error);
    }
  }
);

/* FRONTEND */

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

app.listen(
  PORT,
  () => {
    console.log(
      `PaperTrade running on port ${PORT}`
    );
  }
);
