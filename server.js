
const express = require('express');
const path = require('path');

const market = require('./src/providers');
const engine = require('./src/trading/engine');
const { isValidAddress } = require('./src/chains');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

function session(req, res, next) {
  const id = String(
    req.get('x-session-id') || 'anonymous'
  );

  req.sessionId =
    /^[A-Za-z0-9_-]{4,64}$/.test(id)
      ? id
      : 'anonymous';

  next();
}

app.use('/api', session);

async function buildPriceMap(positions) {
  const map = new Map();

  await Promise.all(
    positions.map(async position => {
      try {
        const price = await market.getPrice(
          position.chain,
          position.tokenAddress
        );

        map.set(
          `${position.chain}:${position.tokenAddress.toLowerCase()}`,
          price
        );
      } catch {
        map.set(
          `${position.chain}:${position.tokenAddress.toLowerCase()}`,
          null
        );
      }
    })
  );

  return map;
}

/* ---------------- TOKEN RESOLUTION ---------------- */

app.get(
  '/api/token/resolve/:address',
  async (req, res) => {
    const address =
      req.params.address.trim();

    const candidates =
      isValidAddress(address);

    if (!candidates.length) {
      return res.status(400).json({
        error:
          'Invalid contract / mint address format'
      });
    }

    try {
      const results =
        await market.resolveToken(
          address,
          candidates
        );

      if (
        !results ||
        !results.length
      ) {
        return res.status(404).json({
          error:
            'Token not found on any supported chain'
        });
      }

      if (results.length === 1) {
        return res.json({
          token: results[0],
          ambiguous: false
        });
      }

      return res.json({
        ambiguous: true,
        tokens: results
      });
    } catch (error) {
      console.error(
        'resolve error:',
        error.message
      );

      return res.status(502).json({
        error:
          'Market data unavailable. Please try again.'
      });
    }
  }
);

/* ---------------- TOKEN DATA ---------------- */

app.get(
  '/api/token/:chain/:address',
  async (req, res) => {
    const {
      chain,
      address
    } = req.params;

    if (
      !isValidAddress(address).includes(chain)
    ) {
      return res.status(400).json({
        error:
          'Invalid address for this chain'
      });
    }

    try {
      const token =
        await market.getTokenData(
          chain,
          address
        );

      if (!token) {
        return res.status(404).json({
          error: 'Token not found'
        });
      }

      return res.json({ token });
    } catch (error) {
      console.error(
        'token error:',
        error.message
      );

      return res.status(502).json({
        error:
          'Market data unavailable'
      });
    }
  }
);

/* ---------------- PRICE ---------------- */

app.get(
  '/api/price/:chain/:address',
  async (req, res) => {
    const {
      chain,
      address
    } = req.params;

    if (
      !isValidAddress(address).includes(chain)
    ) {
      return res.status(400).json({
        error:
          'Invalid address for this chain'
      });
    }

    try {
      const price =
        await market.getPrice(
          chain,
          address
        );

      if (!price) {
        return res.status(404).json({
          error:
            'Price not available'
        });
      }

      return res.json({ price });
    } catch {
      return res.status(502).json({
        error:
          'Market data unavailable',
        stale: true
      });
    }
  }
);

app.post(
  '/api/prices',
  async (req, res) => {
    const list =
      Array.isArray(
        req.body &&
        req.body.tokens
      )
        ? req.body.tokens.slice(0, 30)
        : [];

    const clean =
      list.filter(
        token =>
          token &&
          typeof token.chain === 'string' &&
          typeof token.address === 'string'
      );

    const prices =
      await Promise.all(
        clean.map(async token => {
          try {
            const price =
              await market.getPrice(
                token.chain,
                token.address
              );

            return {
              chain: token.chain,
              address: token.address,
              price
            };
          } catch {
            return {
              chain: token.chain,
              address: token.address,
              price: null
            };
          }
        })
      );

    return res.json({
      prices
    });
  }
);

/* ---------------- WALLET ---------------- */

app.get(
  '/api/wallet',
  async (req, res) => {
    try {
      const positions =
        engine.getPositions(
          req.sessionId
        );

      const priceMap =
        await buildPriceMap(
          positions
        );

      return res.json(
        engine.walletSummary(
          req.sessionId,
          priceMap
        )
      );
    } catch (error) {
      console.error(
        'wallet error:',
        error.message
      );

      return res.status(500).json({
        error:
          'Unable to load wallet'
      });
    }
  }
);

/* ---------------- POSITIONS ---------------- */

app.get(
  '/api/positions',
  async (req, res) => {
    try {
      const positions =
        engine.getPositions(
          req.sessionId
        );

      const priceMap =
        await buildPriceMap(
          positions
        );

      const wallet =
        engine.walletSummary(
          req.sessionId,
          priceMap
        );

      return res.json({
        positions:
          wallet.positions
      });
    } catch (error) {
      console.error(
        'positions error:',
        error.message
      );

      return res.status(500).json({
        error:
          'Unable to load positions'
      });
    }
  }
);

/* ---------------- TRADES ---------------- */

app.get(
  '/api/trades',
  (req, res) => {
    try {
      return res.json({
        trades:
          engine.getTrades(
            req.sessionId
          )
      });
    } catch (error) {
      console.error(
        'trades error:',
        error.message
      );

      return res.status(500).json({
        error:
          'Unable to load trade history'
      });
    }
  }
);

/* ---------------- BUY ---------------- */

app.post(
  '/api/buy',
  async (req, res) => {
    const {
      chain,
      address
    } = req.body || {};

    const amountUsd =
      Number(
        req.body &&
        req.body.amountUsd
      );

    if (
      typeof chain !== 'string' ||
      typeof address !== 'string' ||
      !isValidAddress(address).includes(chain)
    ) {
      return res.status(400).json({
        error:
          'Invalid chain or address'
      });
    }

    if (
      !Number.isFinite(amountUsd) ||
      amountUsd <= 0
    ) {
      return res.status(400).json({
        error:
          'Enter a valid investment amount'
      });
    }

    if (amountUsd < 0.01) {
      return res.status(400).json({
        error:
          'Minimum paper investment is $0.01'
      });
    }

    const wallet =
      engine.getWalletSimple(
        req.sessionId
      );

    if (
      amountUsd >
      wallet.cash + 1e-9
    ) {
      return res.status(400).json({
        error:
          'Not enough paper cash'
      });
    }

    let price;

    try {
      price =
        await market.getPrice(
          chain,
          address
        );
    } catch {
      return res.status(502).json({
        error:
          'Cannot fetch real price right now. Try again shortly.'
      });
    }

    if (
      !price ||
      !price.priceUsd
    ) {
      return res.status(502).json({
        error:
          'Real price unavailable - paper buy not executed'
      });
    }

    try {
      const position =
        engine.buy(
          req.sessionId,
          chain,
          address,
          amountUsd,
          price.priceUsd
        );

      const tokenData =
        await market
          .getTokenData(
            chain,
            address
          )
          .catch(() => null);

      if (tokenData) {
        engine.enrichPositionMetadata(
          position.id,
          tokenData
        );
      }

      const positions =
        engine.getPositions(
          req.sessionId
        );

      const priceMap =
        await buildPriceMap(
          positions
        );

      return res.status(201).json({
        position:
          engine.getPosition(
            req.sessionId,
            position.id
          ),

        wallet:
          engine.walletSummary(
            req.sessionId,
            priceMap
          )
      });
    } catch (error) {
      console.error(
        'buy error:',
        error.message
      );

      return res.status(400).json({
        error: error.message
      });
    }
  }
);

/* ---------------- SELL ---------------- */

app.post(
  '/api/sell',
  async (req, res) => {
    const positionId =
      String(
        req.body &&
        req.body.positionId || ''
      );

    const position =
      engine.getPosition(
        req.sessionId,
        positionId
      );

    if (!position) {
      return res.status(404).json({
        error:
          'Position not found'
      });
    }

    let price;

    try {
      price =
        await market.getPrice(
          position.chain,
          position.tokenAddress
        );
    } catch {
      return res.status(502).json({
        error:
          'Cannot fetch real price right now. Try again shortly.'
      });
    }

    if (
      !price ||
      !price.priceUsd
    ) {
      return res.status(502).json({
        error:
          'Real price unavailable - paper sell not executed'
      });
    }

    try {
      const trade =
        engine.sell(
          req.sessionId,
          position.id,
          price.priceUsd
        );

      const positions =
        engine.getPositions(
          req.sessionId
        );

      const priceMap =
        await buildPriceMap(
          positions
        );

      return res.json({
        trade,

        wallet:
          engine.walletSummary(
            req.sessionId,
            priceMap
          )
      });
    } catch (error) {
      console.error(
        'sell error:',
        error.message
      );

      return res.status(400).json({
        error: error.message
      });
    }
  }
);

/* ---------------- RESET ---------------- */

app.post(
  '/api/reset',
  (req, res) => {
    try {
      engine.reset(
        req.sessionId
      );

      return res.json({
        ok: true,
        wallet:
          engine.getWalletSimple(
            req.sessionId
          )
      });
    } catch (error) {
      console.error(
        'reset error:',
        error.message
      );

      return res.status(500).json({
        error:
          'Unable to reset account'
      });
    }
  }
);

/* ---------------- ERRORS ---------------- */

app.use(
  (req, res) => {
    res.status(404).json({
      error: 'Not found'
    });
  }
);

app.use(
  (error, req, res, next) => {
    console.error(error);

    res.status(500).json({
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
