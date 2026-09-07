const $ = id => document.getElementById(id);

const POLL_MS = 7000;

let sessionId = localStorage.getItem('pt_session');

if (!sessionId) {
  sessionId = (crypto.randomUUID ? crypto.randomUUID() : 's' + Date.now() + Math.random().toString(36).slice(2))
    .replace(/-/g, '');

  localStorage.setItem('pt_session', sessionId);
}

let currentToken = null;
let lastPriceUpdate = {};

async function api(path, opts = {}) {
  const res = await fetch(path, {
    ...opts,
    headers: {
      'Content-Type': 'application/json',
      'X-Session-Id': sessionId,
      ...(opts.headers || {})
    }
  });

  const data = await res.json().catch(() => ({}));

  if (!res.ok) {
    throw new Error(data.error || `HTTP ${res.status}`);
  }

  return data;
}

function fmtUsd(n, dec = 2) {
  if (n == null || !Number.isFinite(Number(n))) return '—';

  return '$' + Number(n).toLocaleString('en-US', {
    minimumFractionDigits: dec,
    maximumFractionDigits: dec
  });
}

function fmtPrice(p) {
  if (p == null || !Number.isFinite(Number(p))) return '—';

  p = Number(p);

  if (p >= 1) return fmtUsd(p, 2);
  if (p >= 0.01) return '$' + p.toFixed(4);

  return '$' + Number(p.toPrecision(4)).toString();
}

function fmtCompact(n) {
  if (n == null || !Number.isFinite(Number(n))) return '—';

  return '$' + Intl.NumberFormat('en-US', {
    notation: 'compact',
    maximumFractionDigits: 1
  }).format(Number(n));
}

function fmtQty(q) {
  if (q == null) return '—';

  return Number(q).toLocaleString('en-US', {
    maximumFractionDigits: 8
  });
}

function fmtPct(n) {
  if (n == null || !Number.isFinite(Number(n))) return '—';

  n = Number(n);

  return (n >= 0 ? '+' : '') + n.toFixed(2) + '%';
}

function pnlClass(n) {
  n = Number(n);

  if (n > 0) return 'green';
  if (n < 0) return 'red';

  return '';
}

function signedUsd(n) {
  if (n == null || !Number.isFinite(Number(n))) return '—';

  n = Number(n);

  return (n >= 0 ? '+$' : '-$') +
    Math.abs(n).toLocaleString('en-US', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2
    });
}

function timeAgo(ts) {
  if (!ts) return '—';

  const seconds = Math.max(
    0,
    Math.floor(Date.now() / 1000) - Number(ts)
  );

  if (seconds < 60) return `${seconds}s ago`;

  const minutes = Math.floor(seconds / 60);

  if (minutes < 60) return `${minutes}m ago`;

  const hours = Math.floor(minutes / 60);

  return `${hours}h ago`;
}

function hide(id) {
  $(id).classList.add('hidden');
}

function show(id) {
  $(id).classList.remove('hidden');
}

function esc(s) {
  const d = document.createElement('div');
  d.textContent = String(s ?? '');
  return d.innerHTML;
}

function chainName(id) {
  return {
    solana: 'Solana',
    ethereum: 'Ethereum',
    base: 'Base',
    bsc: 'BNB Chain',
    arbitrum: 'Arbitrum',
    polygon: 'Polygon',
    avalanche: 'Avalanche'
  }[id] || id;
}


/* =========================
   WALLET
========================= */

async function refreshWallet() {
  try {
    const w = await api("/api/wallet");
    const sol = await api("/api/sol-price");
    $("wCash").textContent = fmtUsd(w.cash);
    $("wPositions").textContent = fmtUsd(w.openPositionsValue) + (w.allPricesKnown ? "" : "*");
    $("wEquity").textContent = fmtUsd(w.equity) + (w.allPricesKnown ? "" : "*");
    const tp = $("wPnl");
    tp.textContent = signedUsd(w.totalPnl);
    tp.className = "val " + pnlClass(w.totalPnl);
    if (sol && sol.priceUsd > 0 && $("wSol")) {
      const solAmount = w.equity / sol.priceUsd;
      $("wSol").textContent = solAmount.toLocaleString("en-US", { minimumFractionDigits: 4, maximumFractionDigits: 6 }) + " SOL";
    }
    $("pnlDetail").textContent = `Realized: ${signedUsd(w.realizedPnl)} · Unrealized: ${signedUsd(w.unrealizedPnl)}` + (w.allPricesKnown ? "" : " · * some prices stale");
  } catch { }
}

async function loadToken() {
  const address = $('tokenInput').value.trim();

  hide('resolveError');
  hide('chainChooser');
  hide('tokenCard');

  if (!address) {
    $('resolveError').textContent = 'Paste a token contract or Solana mint address.';
    show('resolveError');
    return;
  }

  show('searchStatus');
  $('loadBtn').disabled = true;
  $('loadBtn').textContent = 'SEARCHING...';

  try {
    const data = await api(
      `/api/token/resolve/${encodeURIComponent(address)}`
    );

    if (data.ambiguous) {
      renderChainChooser(data.tokens);
    } else {
      showToken(data.token);
    }

  } catch (e) {
    $('resolveError').textContent = e.message;
    show('resolveError');

  } finally {
    hide('searchStatus');
    $('loadBtn').disabled = false;
    $('loadBtn').textContent = 'SEARCH';
  }
}

function renderChainChooser(tokens) {
  const box = $('chainButtons');

  box.innerHTML = '';

  for (const t of tokens) {
    const b = document.createElement('button');

    b.className = 'btn';
    b.textContent =
      `${chainName(t.chain)}${t.symbol ? ' · ' + t.symbol : ''}`;

    b.onclick = () => {
      hide('chainChooser');
      showToken(t);
    };

    box.appendChild(b);
  }

  show('chainChooser');
}


/* =========================
   TOKEN DISPLAY
========================= */

function showToken(t) {
  currentToken = t;

  const key = `${t.chain}:${t.address.toLowerCase()}`;

  lastPriceUpdate[key] = t.updatedAt;

  $('tSymbol').textContent = t.symbol || 'UNKNOWN';

  $('tName').textContent =
    t.name || 'Unknown Token';

  $('tIcon').textContent =
    (t.symbol || '?').slice(0, 2).toUpperCase();

  $('tChain').textContent =
    chainName(t.chain);

  $('tDex').textContent =
    t.dex || 'DEX unavailable';

  $('tPrice').textContent =
    fmtPrice(t.priceUsd);

  $('tChange').textContent =
    '24h ' + fmtPct(t.priceChange24h);

  $('tChange').className =
    pnlClass(t.priceChange24h);

  $('tMcap').textContent =
    fmtCompact(t.marketCapUsd);

  $('tLiq').textContent =
    fmtCompact(t.liquidityUsd);

  $('tVol').textContent =
    fmtCompact(t.volume24hUsd);

  $('tAddr').textContent =
    t.address;

  $('tUpdated').textContent =
    timeAgo(t.updatedAt);

  $('amountInput').value = '';

  hide('buyError');
  hide('tStale');

  show('tokenCard');

  $('tokenCard').scrollIntoView({
    behavior: 'smooth',
    block: 'nearest'
  });
}


/* =========================
   LIVE TOKEN PRICE
========================= */

async function refreshCurrentToken() {
  if (!currentToken) return;

  const t = currentToken;

  try {
    const result = await api(
      `/api/price/${t.chain}/${encodeURIComponent(t.address)}`
    );

    if (
      result.price &&
      result.price.priceUsd != null
    ) {
      const p = result.price;

      $('tPrice').textContent =
        fmtPrice(p.priceUsd);

      $('tUpdated').textContent =
        timeAgo(p.updatedAt);

      const key =
        `${t.chain}:${t.address.toLowerCase()}`;

      lastPriceUpdate[key] = p.updatedAt;

      hide('tStale');

    } else {
      markStale(t);
    }

  } catch {
    markStale(t);
  }
}

function markStale(t) {
  show('tStale');

  const key =
    `${t.chain}:${t.address.toLowerCase()}`;

  $('tUpdated').textContent =
    timeAgo(lastPriceUpdate[key]);

  $('tPrice').textContent =
    fmtPrice(t.priceUsd);
}


/* =========================
   BUY
========================= */

async function buy() {
  if (!currentToken) {
    alert('Load a token first.');
    return;
  }

  const amount = Number(
    $('amountInput').value
  );

  hide('buyError');

  if (!Number.isFinite(amount) || amount <= 0) {
    $('buyError').textContent =
      'Enter a valid investment amount.';

    show('buyError');
    return;
  }

  const button = $('buyBtn');

  button.disabled = true;
  button.textContent = 'BUYING...';

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

    await Promise.all([
      refreshWallet(),
      refreshPositions(),
      refreshTrades()
    ]);

  } catch (e) {
    $('buyError').textContent = e.message;
    show('buyError');

  } finally {
    button.disabled = false;
    button.textContent = 'BUY TOKEN';
  }
}


/* =========================
   SELL
========================= */

async function sell(positionId) {
  if (!confirm(
    'Sell this paper position at the current real market price?'
  )) {
    return;
  }

  try {
    await api('/api/sell', {
      method: 'POST',
      body: JSON.stringify({
        positionId
      })
    });

    await Promise.all([
      refreshWallet(),
      refreshPositions(),
      refreshTrades()
    ]);

  } catch (e) {
    alert(e.message);
  }
}


/* =========================
   POSITIONS
========================= */

async function refreshPositions() {
  try {
    const data = await api('/api/positions');

    const positions = data.positions || [];

    $('positionCount').textContent =
      positions.length
        ? `${positions.length} OPEN`
        : '';

    const list = $('positionsList');

    if (!positions.length) {
      list.innerHTML =
        '<p class="empty">No open positions.</p>';
      return;
    }

    list.innerHTML = '';

    for (const p of positions) {
      const div = document.createElement('div');

      div.className = 'pos';

      const pnl = p.unrealizedPnlUsd;

      const stale =
        p.currentPriceUsd == null;

      div.innerHTML = `
        <div class="pos-top">

          <div>
            <div class="pos-sym">
              ${esc(p.symbol || p.tokenName || 'TOKEN')}
            </div>

            <div class="muted small">
              ${esc(chainName(p.chain))}
            </div>
          </div>

          <div style="text-align:right">

            ${
              stale
                ? '<span class="stale-badge">STALE</span>'
                : ''
            }

            <div>
              ${
                stale
                  ? 'Price unavailable'
                  : fmtPrice(p.currentPriceUsd)
              }
            </div>

            <div class="muted small">
              ${
                p.priceUpdatedAt
                  ? 'updated ' + timeAgo(p.priceUpdatedAt)
                  : ''
              }
            </div>

          </div>

        </div>

        <div class="pos-grid">

          <div>
            <span class="label">ENTRY</span>
            ${fmtPrice(p.entryPriceUsd)}
          </div>

          <div>
            <span class="label">INVESTED</span>
            ${fmtUsd(p.investedUsd)}
          </div>

          <div>
            <span class="label">QUANTITY</span>
            ${fmtQty(p.quantity)}
          </div>

          <div>
            <span class="label">VALUE</span>
            ${
              p.currentValueUsd != null
                ? fmtUsd(p.currentValueUsd)
                : '—'
            }
          </div>

        </div>

        <div class="pos-actions">

          <span
            class="${pnlClass(pnl)}"
            style="margin-right:10px"
          >
            ${
              pnl != null
                ? signedUsd(pnl) +
                  ' (' +
                  fmtPct(p.unrealizedPnlPct) +
                  ')'
                : '—'
            }
          </span>

          <button class="btn sell">
            SELL
          </button>

        </div>
      `;

      div.querySelector('.sell').onclick =
        () => sell(p.id);

      list.appendChild(div);
    }

  } catch {
    // Keep existing positions visible.
  }
}


/* =========================
   TRADE HISTORY
========================= */

async function refreshTrades() {
  try {
    const data = await api('/api/trades');

    const trades = data.trades || [];

    const list = $('tradesList');

    if (!trades.length) {
      list.innerHTML =
        '<p class="empty">No closed trades yet.</p>';
      return;
    }

    list.innerHTML = '';

    for (const t of trades) {
      const div = document.createElement('div');

      div.className = 'trade';

      div.innerHTML = `
        <div class="pos-top">

          <div class="pos-sym">
            ${esc(t.symbol || t.tokenName || 'TOKEN')}

            <span class="muted small">
              ${esc(chainName(t.chain))}
            </span>
          </div>

          <div class="muted small">
            ${
              t.closedAt
                ? new Date(
                    t.closedAt * 1000
                  ).toLocaleDateString()
                : ''
            }
          </div>

        </div>

        <div class="pos-grid">

          <div>
            <span class="label">ENTRY</span>
            ${fmtPrice(t.entryPriceUsd)}
          </div>

          <div>
            <span class="label">EXIT</span>
            ${fmtPrice(t.exitPriceUsd)}
          </div>

          <div>
            <span class="label">INVESTED</span>
            ${fmtUsd(t.investedUsd)}
          </div>

          <div>
            <span class="label">EXIT VALUE</span>
            ${fmtUsd(t.exitValueUsd)}
          </div>

        </div>

        <div class="${pnlClass(t.pnlUsd)}">
          ${signedUsd(t.pnlUsd)}
          (${fmtPct(t.pnlPct)})
        </div>
      `;

      list.appendChild(div);
    }

  } catch {
    // Ignore refresh errors.
  }
}


/* =========================
   DEPOSIT / WITHDRAW
========================= */

async function deposit() {
  const amount = prompt(
    'Enter amount to deposit into your paper account (USD):'
  );

  if (amount === null) return;

  const value = Number(amount);

  if (!Number.isFinite(value) || value <= 0) {
    alert('Enter a valid amount.');
    return;
  }

  try {
    await api('/api/deposit', {
      method: 'POST',
      body: JSON.stringify({
        amountUsd: value
      })
    });

    await refreshWallet();

  } catch (e) {
    alert(e.message);
  }
}

async function withdraw() {
  const amount = prompt(
    'Enter amount to withdraw from your paper account (USD):'
  );

  if (amount === null) return;

  const value = Number(amount);

  if (!Number.isFinite(value) || value <= 0) {
    alert('Enter a valid amount.');
    return;
  }

  try {
    await api('/api/withdraw', {
      method: 'POST',
      body: JSON.stringify({
        amountUsd: value
      })
    });

    await refreshWallet();

  } catch (e) {
    alert(e.message);
  }
}


/* =========================
   COPY ADDRESS
========================= */

async function copyAddress() {
  if (!currentToken || !currentToken.address) return;

  try {
    await navigator.clipboard.writeText(
      currentToken.address
    );

    const button = $('copyAddressBtn');

    button.textContent = 'COPIED';

    setTimeout(() => {
      button.textContent = 'COPY';
    }, 1500);

  } catch {
    prompt(
      'Copy token address:',
      currentToken.address
    );
  }
}


/* =========================
   RESET
========================= */

async function reset() {
  if (!confirm(
    'Reset your paper account?\n\n' +
    'This will delete open positions and trade history.'
  )) {
    return;
  }

  if (!confirm(
    'Are you absolutely sure? This cannot be undone.'
  )) {
    return;
  }

  try {
    await api('/api/reset', {
      method: 'POST'
    });

    currentToken = null;

    hide('tokenCard');

    await Promise.all([
      refreshWallet(),
      refreshPositions(),
      refreshTrades()
    ]);

  } catch (e) {
    alert(e.message);
  }
}


/* =========================
   POLLING
========================= */

async function pollPrices() {
  await refreshCurrentToken();
  await refreshPositions();
  await refreshWallet();
}


/* =========================
   EVENTS
========================= */

$('loadBtn').onclick = loadToken;

$('tokenInput').addEventListener(
  'keydown',
  e => {
    if (e.key === 'Enter') {
      loadToken();
    }
  }
);

$('buyBtn').onclick = buy;

$('depositBtn').onclick = deposit;

$('withdrawBtn').onclick = withdraw;

$('copyAddressBtn').onclick = copyAddress;

$('resetBtn').onclick = reset;


/* =========================
   INITIAL LOAD
========================= */

refreshWallet();
refreshPositions();
refreshTrades();

setInterval(
  pollPrices,
  POLL_MS
);
