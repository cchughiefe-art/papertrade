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

app.use(express.json({ limit: '100kb' }));
app.use(express.static(path.join(__dirname, 'public')));

const PORT = process.env.PORT || 10000;

function sessionId(req) {
  return String(
    req.headers['x-session-id'] ||
    req.ip ||
    'demo'
  ).slice(0, 200);
}

function sendError(res, error) {
  const message = error?.message || 'Request failed';

  const status =
    /not found/i.test(message) ? 404 :
    /insufficient/i.test(message) ? 400 :
    /invalid/i.test(message) ? 400 :
    500;

  res.status(status).json({
    ok: false,
    error: message
  });
}

app.get('/api/token/resolve/:address', async (req, res) => {
  try {
    const address = req.params.address.trim();

    if (!isValidAddress(address).length) {
      return res.status(400).json({
        ok: false,
        error: 'Invalid token address or mint'
      });
    }

    const result = await resolveToken(address);

    if (!result) {
      return res.status(404).json({
        ok: false,
        error: 'Token not found'
      });
    }

    res.json({
      ok: true,
      token: result
    });
  } catch (error) {
    sendError(res, error);
  }
});

app.get('/api/token/:chain/:address', async (req, res) => {
  try {
    const { chain, address } = req.params;

    if (!isValidAddress(address).includes(chain)) {
      return res.status(400).json({
        ok: false,
        error: 'Invalid address for selected chain'
      });
    }

    const result = await resolveToken(address, chain);

    if (!result) {
      return res.status(404).json({
        ok: false,
        error: 'Token not found'
      });
    }

    res.json({
      ok: true,
      token: result
    });
  } catch (error) {
    sendError(res, error);
  }
});

app.get('/api/price/:chain/:address', async (req, res) => {
  try {
    const { chain, address } = req.params;

    const result = await getPrice(chain, address);

    if (!result) {
      return res.status(404).json({
        ok: false,
        error: 'Price not found'
      });
    }

    res.json({
      ok: true,
      price: result
    });
  } catch (error) {
    sendError(res, error);
  }
});

app.get('/api/wallet', async (req, res) => {
  try {
    let solPriceUsd = null;

    try {
      solPriceUsd = await getSolPrice();
    } catch (_) {}

    const wallet = walletSummary(
      sessionId(req),
      solPriceUsd
    );

    res.json({
      ok: true,
      wallet
    });
  } catch (error) {
    sendError(res, error);
  }
});

app.get('/api/positions', (req, res) => {
  try {
    res.json({
      ok: true,
      positions: getPositions(sessionId(req))
    });
  } catch (error) {
    sendError(res, error);
  }
});

app.get('/api/trades', (req, res) => {
  try {
    res.json({
      ok: true,
      trades: getTrades(sessionId(req))
    });
  } catch (error) {
    sendError(res, error);
  }
});

app.get('/api/balance-history', (req, res) => {
  try {
    res.json({
      ok: true,
      history: getBalanceHistory(sessionId(req))
    });
  } catch (error) {
    sendError(res, error);
  }
});

app.post('/api/deposit', (req, res) => {
  try {
    const wallet = deposit(
      sessionId(req),
      req.body.amountUsd
    );

    res.json({
      ok: true,
      wallet
    });
  } catch (error) {
    sendError(res, error);
  }
});

app.post('/api/withdraw', (req, res) => {
  try {
    const wallet = withdraw(
      sessionId(req),
      req.body.amountUsd
    );

    res.json({
      ok: true,
      wallet
    });
  } catch (error) {
    sendError(res, error);
  }
});

app.post('/api/buy', async (req, res) => {
  try {
    const {
      chain,
      address,
      amountUsd
    } = req.body;

    if (!chain || !address || !isValidAddress(address).includes(chain)) {
      return res.status(400).json({
        ok: false,
        error: 'Invalid chain or token address'
      });
    }

    const token = await getPrice(chain, address);

    if (!token || !Number(token.priceUsd)) {
      return res.status(404).json({
        ok: false,
        error: 'Live price unavailable for this token'
      });
    }

    const wallet = buy(sessionId(req), {
      chain,
      address,
      amountUsd,
      priceUsd: token.priceUsd,
      tokenName: token.name,
      symbol: token.symbol
    });

    res.json({
      ok: true,
      wallet,
      token
    });
  } catch (error) {
    sendError(res, error);
  }
});

app.post('/api/sell', async (req, res) => {
  try {
    const position = getPosition(
      sessionId(req),
      req.body.positionId
    );

    if (!position) {
      return res.status(404).json({
        ok: false,
        error: 'Position not found'
      });
    }

    const token = await getPrice(
      position.chain,
      position.tokenAddress
    );

    if (!token || !Number(token.priceUsd)) {
      return res.status(404).json({
        ok: false,
        error: 'Live price unavailable for this token'
      });
    }

    const result = sell(
      sessionId(req),
      position.id,
      token.priceUsd
    );

    res.json({
      ok: true,
      ...result,
      token
    });
  } catch (error) {
    sendError(res, error);
  }
});

app.post('/api/reset', (req, res) => {
  try {
    reset(sessionId(req));

    res.json({
      ok: true,
      message: 'Paper account reset'
    });
  } catch (error) {
    sendError(res, error);
  }
});

app.get('*', (req, res) => {
  res.sendFile(
    path.join(__dirname, 'public', 'index.html')
  );
});

app.listen(PORT, () => {
  console.log(`PaperTrade running on port ${PORT}`);
});
