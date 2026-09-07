const sessionKey = 'papertrade_session';

let sessionId = localStorage.getItem(sessionKey);

if (!sessionId) {
  sessionId =
    crypto.randomUUID?.() ||
    `${Date.now()}-${Math.random()}`;

  localStorage.setItem(sessionKey, sessionId);
}

let currentToken = null;

const $ = id => document.getElementById(id);

function money(value) {
  const n = Number(value || 0);

  return n.toLocaleString('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 2
  });
}

function number(value) {
  return Number(value || 0).toLocaleString('en-US', {
    maximumFractionDigits: 8
  });
}

function shortAddress(address) {
  if (!address) return '';

  if (address.length <= 18) return address;

  return `${address.slice(0, 9)}...${address.slice(-9)}`;
}

async function api(url, options = {}) {
  const headers = {
    ...(options.headers || {}),
    'X-Session-Id': sessionId,
    'Content-Type': 'application/json'
  };

  const response = await fetch(url, {
    ...options,
    headers
  });

  const data = await response.json().catch(() => ({}));

  if (!response.ok || data.ok === false) {
    throw new Error(data.error || 'Request failed');
  }

  return data;
}

function showError(message) {
  $('tokenError').textContent = message || '';
}

async function refreshWallet() {
  const data = await api('/api/wallet');
  const wallet = data.wallet;

  $('cash').textContent = money(wallet.cashUsd);
  $('cashSol').textContent =
    wallet.cashSol == null
      ? 'SOL unavailable'
      : `${number(wallet.cashSol)} SOL`;

  $('positionValue').textContent =
    money(wallet.positionValueUsd);

  $('equity').textContent =
    money(wallet.equityUsd);

  $('equitySol').textContent =
    wallet.equitySol == null
      ? 'SOL unavailable'
      : `${number(wallet.equitySol)} SOL`;

  $('pnl').textContent =
    money(wallet.totalPnlUsd);

  $('solPrice').textContent =
    wallet.priceUsd == null
      ? 'Unavailable'
      : money(wallet.priceUsd);
}

function showToken(token) {
  currentToken = token;

  $('tokenCard').classList.remove('hidden');

  $('tokenName').textContent =
    token.name || 'Unknown Token';

  $('tokenSymbol').textContent =
    token.symbol
      ? `$${token.symbol}`
      : 'UNKNOWN';

  $('tokenSource').textContent =
    token.source ||
    token.dex ||
    'Market';

  $('tokenPrice').textContent =
    Number(token.priceUsd) > 0
      ? money(token.priceUsd)
      : 'Price unavailable';

  $('tokenChange').textContent =
    `${Number(token.priceChange24h || 0).toFixed(2)}%`;

  $('tokenMarketCap').textContent =
    money(token.marketCapUsd);

  $('tokenLiquidity').textContent =
    money(token.liquidityUsd);

  $('tokenVolume').textContent =
    money(token.volume24hUsd);

  $('tokenChain').textContent =
    token.chain || 'Unknown';

  $('tokenAddress').textContent =
    token.address || '';
}

async function loadToken() {
  const address =
    $('addressInput').value.trim();

  showError('');

  if (!address) {
    showError('Enter a token contract or Solana mint.');
    return;
  }

  $('loadBtn').disabled = true;
  $('loadBtn').textContent = 'Searching...';

  try {
    const data =
      await api(
        `/api/token/resolve/${encodeURIComponent(address)}`
      );

    showToken(data.token);
  } catch (error) {
    $('tokenCard').classList.add('hidden');
    showError(error.message);
  } finally {
    $('loadBtn').disabled = false;
    $('loadBtn').textContent = 'Load Token';
  }
}

async function buyToken() {
  if (!currentToken) {
    showError('Load a token first.');
    return;
  }

  const amount =
    Number($('amountInput').value);

  if (!Number.isFinite(amount) || amount <= 0) {
    showError('Enter a valid investment amount.');
    return;
  }

  if (!currentToken.priceUsd || currentToken.priceUsd <= 0) {
    showError('This token does not currently have a live price.');
    return;
  }

  $('buyBtn').disabled = true;

  try {
    await api('/api/buy', {
      method: 'POST',
      body: JSON.stringify({
        chain: currentToken.chain,
        address: currentToken.address,
        amountUsd: amount
      })
    });

    $('amountInput').value = '';

    await refreshAll();
  } catch (error) {
    showError(error.message);
  } finally {
    $('buyBtn').disabled = false;
  }
}

async function refreshPositions() {
  const data = await api('/api/positions');

  if (!data.positions.length) {
    $('positions').innerHTML =
      '<p class="muted">No open positions.</p>';
    return;
  }

  const results = await Promise.all(
    data.positions.map(async position => {
      let price = position.entryPriceUsd;

      try {
        const result =
          await api(
            `/api/price/${encodeURIComponent(position.chain)}/${encodeURIComponent(position.tokenAddress)}`
          );

        if (result.price?.priceUsd) {
          price = Number(result.price.priceUsd);
        }
      } catch (_) {}

      const value =
        position.quantity * price;

      const pnl =
        value - position.investedUsd;

      return `
        <div class="position">
          <div class="position-top">
            <strong>${escapeHtml(position.symbol || position.tokenName)}</strong>
            <span>${money(value)}</span>
          </div>

          <div class="position-details">
            <span>Entry: ${money(position.entryPriceUsd)}</span>
            <span>Current: ${money(price)}</span>
            <span>Qty: ${number(position.quantity)}</span>
          </div>

          <div class="${pnl >= 0 ? 'profit' : 'loss'}">
            P&L: ${money(pnl)}
          </div>

          <button
            onclick="sellPosition(${position.id})"
            class="danger"
          >
            SELL
          </button>
        </div>
      `;
    })
  );

  $('positions').innerHTML =
    results.join('');
}

async function sellPosition(id) {
  if (!confirm('Sell this paper position at the current market price?')) {
    return;
  }

  try {
    await api('/api/sell', {
      method: 'POST',
      body: JSON.stringify({
        positionId: id
      })
    });

    await refreshAll();
  } catch (error) {
    alert(error.message);
  }
}

async function refreshTrades() {
  const data = await api('/api/trades');

  if (!data.trades.length) {
    $('trades').innerHTML =
      '<p class="muted">No trades yet.</p>';
    return;
  }

  $('trades').innerHTML =
    data.trades.map(trade => `
      <div class="history-row">
        <strong>${escapeHtml(trade.side)}</strong>
        <span>${escapeHtml(trade.symbol || 'TOKEN')}</span>
        <span>${money(trade.amountUsd)}</span>
        <span class="${trade.pnlUsd >= 0 ? 'profit' : 'loss'}">
          ${money(trade.pnlUsd)}
        </span>
      </div>
    `).join('');
}

async function refreshBalanceHistory() {
  const data =
    await api('/api/balance-history');

  if (!data.history.length) {
    $('balanceHistory').innerHTML =
      '<p class="muted">No deposits or withdrawals.</p>';
    return;
  }

  $('balanceHistory').innerHTML =
    data.history.map(item => `
      <div class="history-row">
        <strong class="${item.type === 'deposit' ? 'profit' : 'loss'}">
          ${item.type.toUpperCase()}
        </strong>

        <span>${money(item.amountUsd)}</span>

        <span>
          ${new Date(item.createdAt).toLocaleString()}
        </span>
      </div>
    `).join('');
}

async function depositMoney() {
  const amount =
    Number(prompt('Enter deposit amount in USD:'));

  if (!Number.isFinite(amount) || amount <= 0) {
    return;
  }

  try {
    await api('/api/deposit', {
      method: 'POST',
      body: JSON.stringify({
        amountUsd: amount
      })
    });

    await refreshAll();
  } catch (error) {
    alert(error.message);
  }
}

async function withdrawMoney() {
  const amount =
    Number(prompt('Enter withdrawal amount in USD:'));

  if (!Number.isFinite(amount) || amount <= 0) {
    return;
  }

  try {
    await api('/api/withdraw', {
      method: 'POST',
      body: JSON.stringify({
        amountUsd: amount
      })
    });

    await refreshAll();
  } catch (error) {
    alert(error.message);
  }
}

async function resetAccount() {
  if (!confirm(
    'Reset the paper account back to $10,000? This deletes positions and history.'
  )) {
    return;
  }

  try {
    await api('/api/reset', {
      method: 'POST'
    });

    await refreshAll();
  } catch (error) {
    alert(error.message);
  }
}

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

async function refreshAll() {
  try {
    await refreshWallet();
    await refreshPositions();
    await refreshTrades();
    await refreshBalanceHistory();
  } catch (error) {
    console.error(error);
  }
}

$('loadBtn').addEventListener('click', loadToken);
$('buyBtn').addEventListener('click', buyToken);
$('depositBtn').addEventListener('click', depositMoney);
$('withdrawBtn').addEventListener('click', withdrawMoney);
$('resetBtn').addEventListener('click', resetAccount);

$('addressInput').addEventListener('keydown', event => {
  if (event.key === 'Enter') {
    loadToken();
  }
});

refreshAll();

setInterval(refreshAll, 7000);
