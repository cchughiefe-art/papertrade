const $ = id =>
  document.getElementById(id);

const POLL_MS = 7000;

let sessionId =
  localStorage.getItem('pt_session');

if (!sessionId) {
  sessionId =
    crypto.randomUUID
      ? crypto.randomUUID()
      : 's' +
        Date.now() +
        Math.random()
          .toString(36)
          .slice(2);

  localStorage.setItem(
    'pt_session',
    sessionId
  );
}

let currentToken = null;
let tradeProcessing = false;

async function api(
  url,
  options = {}
) {
  const response =
    await fetch(url, {
      ...options,
      headers: {
        'Content-Type':
          'application/json',
        'X-Session-Id':
          sessionId,
        ...(options.headers || {})
      }
    });

  const data =
    await response
      .json()
      .catch(() => ({}));

  if (!response.ok) {
    throw new Error(
      data.error ||
      `HTTP ${response.status}`
    );
  }

  return data;
}

function fmtUsd(
  value,
  decimals = 2
) {
  const n = Number(value);

  if (!Number.isFinite(n)) {
    return '—';
  }

  return (
    '$' +
    n.toLocaleString(
      'en-US',
      {
        minimumFractionDigits:
          decimals,
        maximumFractionDigits:
          decimals
      }
    )
  );
}

function fmtPrice(value) {
  const n = Number(value);

  if (!Number.isFinite(n)) {
    return '—';
  }

  if (n >= 1) {
    return fmtUsd(n, 2);
  }

  if (n >= 0.01) {
    return '$' + n.toFixed(4);
  }

  return (
    '$' +
    Number(
      n.toPrecision(5)
    ).toString()
  );
}

function fmtCompact(value) {
  const n = Number(value);

  if (!Number.isFinite(n)) {
    return '—';
  }

  return (
    '$' +
    Intl.NumberFormat(
      'en-US',
      {
        notation: 'compact',
        maximumFractionDigits: 1
      }
    ).format(n)
  );
}

function fmtQty(value) {
  const n = Number(value);

  if (!Number.isFinite(n)) {
    return '—';
  }

  return n.toLocaleString(
    'en-US',
    {
      maximumFractionDigits: 8
    }
  );
}

function fmtPct(value) {
  const n = Number(value);

  if (!Number.isFinite(n)) {
    return '—';
  }

  return (
    (n >= 0 ? '+' : '') +
    n.toFixed(2) +
    '%'
  );
}

function signedUsd(value) {
  const n = Number(value);

  if (!Number.isFinite(n)) {
    return '—';
  }

  return (
    n >= 0 ? '+$' : '-$'
  ) +
    Math.abs(n).toLocaleString(
      'en-US',
      {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2
      }
    );
}

function pnlClass(value) {
  const n = Number(value);

  if (n > 0) return 'green';
  if (n < 0) return 'red';

  return '';
}

function chainName(chain) {
  return {
    solana: 'Solana',
    ethereum: 'Ethereum',
    base: 'Base',
    bsc: 'BNB Chain',
    arbitrum: 'Arbitrum',
    polygon: 'Polygon',
    avalanche: 'Avalanche'
  }[chain] || chain;
}

function timeAgo(date) {
  if (!date) return '—';

  const ms =
    typeof date === 'number'
      ? date
      : Date.parse(date);

  if (!Number.isFinite(ms)) {
    return '—';
  }

  const seconds =
    Math.max(
      0,
      Math.floor(
        (Date.now() - ms) / 1000
      )
    );

  if (seconds < 60) {
    return `${seconds}s ago`;
  }

  const minutes =
    Math.floor(seconds / 60);

  if (minutes < 60) {
    return `${minutes}m ago`;
  }

  return (
    Math.floor(minutes / 60) +
    'h ago'
  );
}

function esc(value) {
  const div =
    document.createElement('div');

  div.textContent =
    String(value ?? '');

  return div.innerHTML;
}

function show(id) {
  $(id)?.classList.remove(
    'hidden'
  );
}

function hide(id) {
  $(id)?.classList.add(
    'hidden'
  );
}

function showError(id, message) {
  const el = $(id);
  if (!el) return;
  el.textContent = message || 'Something went wrong.';
  el.classList.remove('hidden');
}

function clearError(id) {
  const el = $(id);
  if (!el) return;
  el.textContent = '';
  el.classList.add('hidden');
}

function setButton(id, disabled, label) {
  const el = $(id);
  if (!el) return;
  el.disabled = !!disabled;
  if (label !== undefined) el.textContent = label;
}

function renderSearchResults(tokens) {
  if (!Array.isArray(tokens) || !tokens.length) {
    showError('resolveError', 'No matching tokens found.');
    return;
  }

  // Re-use the chain chooser UI for search results
  const box = $('chainButtons');
  if (!box) return;

  box.innerHTML = '';

  tokens.slice(0, 12).forEach(token => {
    const button = document.createElement('button');
    button.className = 'btn';
    button.style.textAlign = 'left';
    button.style.justifyContent = 'flex-start';
    button.style.height = 'auto';
    button.style.padding = '10px 12px';
    button.style.lineHeight = '1.3';

    const chain = chainName(token.chain) || token.chain || 'Unknown';
    const symbol = token.symbol || 'TOKEN';
    const name = token.name || '';
    const liq = token.liquidityUsd
      ? ' · Liq ' + (typeof fmtCompact === 'function' ? fmtCompact(token.liquidityUsd) : '$' + Math.round(token.liquidityUsd))
      : '';

    button.innerHTML =
      '<div style="font-weight:700">' + esc(symbol) + ' <span style="opacity:.7;font-weight:500">(' + esc(chain) + ')</span></div>' +
      '<div style="font-size:.75rem;opacity:.75;margin-top:2px">' + esc(name) + esc(liq) + '</div>';

    button.onclick = () => {
      hide('chainChooser');
      showToken(token);
    };

    box.appendChild(button);
  });

  const title = document.querySelector('#chainChooser .chooser-title');
  if (title) title.textContent = 'SELECT TOKEN';

  show('chainChooser');
  hide('tokenCard');
  clearError('resolveError');
}


/* WALLET */

async function refreshWallet() {
  try {
    const data =
      await api('/api/wallet');

    const w =
      data.wallet || {};

    if ($('wCash')) {
      $('wCash').textContent =
        fmtUsd(w.cashUsd);
    }

    if ($('wPositions')) {
      $('wPositions').textContent =
        fmtUsd(
          w.positionValueUsd
        );
    }

    if ($('wEquity')) {
      $('wEquity').textContent =
        fmtUsd(
          w.equityUsd
        );
    }

    if ($('wRealized')) {
      $('wRealized').textContent =
        signedUsd(
          w.realizedPnlUsd
        );
    }

    if ($('wUnrealized')) {
      $('wUnrealized').textContent =
        signedUsd(
          w.unrealizedPnlUsd
        );
    }

    if ($('solValue')) {
      $('solValue').textContent =
        w.equitySol != null
          ? Number(
              w.equitySol
            ).toLocaleString(
              'en-US',
              {
                minimumFractionDigits: 4,
                maximumFractionDigits: 8
              }
            ) + ' SOL'
          : '—';
    }
  } catch (error) {
    console.error(
      'Wallet refresh:',
      error
    );
  }
}

/* TOKEN SEARCH */

async function loadToken() {
  const input = $('tokenInput');
  const query = input.value.trim();

  clearError('resolveError');
  hide('chainChooser');
  hide('tokenCard');

  if (!query) {
    showError(
      'resolveError',
      'Enter a token name, symbol, contract, or Solana mint.'
    );
    return;
  }

  setButton('loadBtn', true, 'SEARCHING...');
  show('searchStatus');

  try {
    let data;

    const looksLikeAddress =
      query.length >= 32 &&
      query.length <= 60 &&
      (
        /^0x[a-fA-F0-9]{40}$/.test(query) ||
        /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(query)
      );

    if (looksLikeAddress) {
      try {
        data = await api(
          '/api/token/resolve/' +
          encodeURIComponent(query)
        );

        if (
          data.ambiguous &&
          Array.isArray(data.tokens)
        ) {
          renderSearchResults(data.tokens);
        } else if (data.token) {
          showToken(data.token);
        } else {
          throw new Error('Token not found.');
        }

        return;
      } catch (addressError) {
        console.log(
          'Address resolution failed, trying token search:',
          addressError.message
        );
      }
    }

    data = await api(
      '/api/token/search?q=' +
      encodeURIComponent(query)
    );

    const results =
      Array.isArray(data.results)
        ? data.results
        : [];

    if (!results.length) {
      throw new Error('No matching tokens found.');
    }

    if (results.length === 1) {
      showToken(results[0]);
    } else {
      renderSearchResults(results);
    }

  } catch (error) {
    showError(
      'resolveError',
      error.message || 'Token search failed.'
    );
  } finally {
    hide('searchStatus');

    setButton(
      'loadBtn',
      false,
      'SEARCH'
    );
  }
}
function renderChainChooser(
  tokens
) {
  const box =
    $('chainButtons');

  box.innerHTML = '';

  tokens.forEach(token => {
    const button =
      document.createElement(
        'button'
      );

    button.className =
      'btn';

    button.textContent =
      `${chainName(
        token.chain
      )} · ${
        token.symbol ||
        'TOKEN'
      }`;

    button.onclick = () => {
      hide('chainChooser');
      showToken(token);
    };

    box.appendChild(
      button
    );
  });

  show('chainChooser');
}

/* TOKEN DISPLAY */

function showToken(token) {
  if (!token) {
    throw new Error(
      'Token data missing'
    );
  }

  currentToken = token;

  $('tSymbol')
    .textContent =
    token.symbol ||
    'UNKNOWN';

  $('tName')
    .textContent =
    token.name ||
    'Unknown Token';

  $('tIcon')
    .textContent =
    (
      token.symbol ||
      '?'
    )
      .slice(0, 2)
      .toUpperCase();

  $('tChain')
    .textContent =
    chainName(
      token.chain
    );

  $('tDex')
    .textContent =
    token.dex ||
    'DEX unavailable';

  $('tPrice')
    .textContent =
    fmtPrice(
      token.priceUsd
    );

  $('tChange')
    .textContent =
    '24h ' +
    fmtPct(
      token.priceChange24h
    );

  $('tChange')
    .className =
    pnlClass(
      token.priceChange24h
    );

  $('tMcap')
    .textContent =
    fmtCompact(
      token.marketCapUsd
    );

  $('tLiq')
    .textContent =
    fmtCompact(
      token.liquidityUsd
    );

  $('tVol')
    .textContent =
    fmtCompact(
      token.volume24hUsd
    );

  $('tAddr')
    .textContent =
    token.address;

  $('tUpdated')
    .textContent =
    timeAgo(
      token.updatedAt
    );

  $('amountInput').value =
    '';

  hide('buyError');

  if (
    token.priceAvailable === false
  ) {
    show('tStale');
  } else {
    hide('tStale');
  }

  show('tokenCard');
}

/* LIVE TOKEN */

async function refreshCurrentToken() {
  if (!currentToken) {
    return;
  }

  try {
    const data =
      await api(
        `/api/price/${
          currentToken.chain
        }/${
          encodeURIComponent(
            currentToken.address
          )
        }`
      );

    const price =
      data.price;

    if (
      !price ||
      !Number.isFinite(
        Number(price.priceUsd)
      )
    ) {
      throw new Error(
        'No live price'
      );
    }

    currentToken = {
      ...currentToken,
      ...price
    };

    $('tPrice')
      .textContent =
      fmtPrice(
        price.priceUsd
      );

    $('tChange')
      .textContent =
      '24h ' +
      fmtPct(
        price.priceChange24h
      );

    $('tChange')
      .className =
      pnlClass(
        price.priceChange24h
      );

    $('tMcap')
      .textContent =
      fmtCompact(
        price.marketCapUsd
      );

    $('tLiq')
      .textContent =
      fmtCompact(
        price.liquidityUsd
      );

    $('tVol')
      .textContent =
      fmtCompact(
        price.volume24hUsd
      );

    $('tUpdated')
      .textContent =
      timeAgo(
        price.updatedAt
      );

    hide('tStale');
  } catch (_) {
    show('tStale');
  }
}

/* BUY/SELL handlers are defined in the final trading section below. */

/* POSITIONS */

async function refreshPositions() {
  try {
    const data =
      await api(
        '/api/positions'
      );

    const positions =
      data.positions || [];

    $('positionCount')
      .textContent =
      positions.length
        ? `${positions.length} OPEN`
        : '';

    const list =
      $('positionsList');

    if (!positions.length) {
      list.innerHTML =
        '<p class="empty">No open positions.</p>';

      return;
    }

    list.innerHTML = '';

    positions.forEach(p => {
      const div =
        document.createElement(
          'div'
        );

      div.className =
        'pos';

      const stale =
        p.currentPriceUsd ==
        null;

      const pnl =
        p.unrealizedPnlUsd;

      div.innerHTML = `
        <div class="pos-top">
          <div>
            <div class="pos-sym">
              ${esc(
                p.symbol ||
                p.tokenName ||
                'TOKEN'
              )}
            </div>

            <div class="muted small">
              ${esc(
                chainName(
                  p.chain
                )
              )}
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
                  : fmtPrice(
                      p.currentPriceUsd
                    )
              }
            </div>

            <div class="muted small">
              ${
                p.priceUpdatedAt
                  ? 'updated ' +
                    timeAgo(
                      p.priceUpdatedAt
                    )
                  : ''
              }
            </div>
          </div>
        </div>

        <div class="pos-grid">
          <div>
            <span class="label">
              ENTRY
            </span>
            ${fmtPrice(
              p.entryPriceUsd
            )}
          </div>

          <div>
            <span class="label">
              INVESTED
            </span>
            ${fmtUsd(
              p.investedUsd
            )}
          </div>

          <div>
            <span class="label">
              QUANTITY
            </span>
            ${fmtQty(
              p.quantity
            )}
          </div>

          <div>
            <span class="label">
              VALUE
            </span>
            ${
              p.currentValueUsd != null
                ? fmtUsd(
                    p.currentValueUsd
                  )
                : '—'
            }
          </div>
        </div>

        <div class="pos-actions">
          <span
            class="${pnlClass(
              pnl
            )}"
          >
            ${
              pnl != null
                ? signedUsd(
                    pnl
                  ) +
                  ' (' +
                  fmtPct(
                    p.unrealizedPnlPct
                  ) +
                  ')'
                : '—'
            }
          </span>

          <button class="btn sell">
            SELL
          </button>
        </div>
      `;

      div.querySelector(
        '.sell'
      ).onclick =
        () =>
          sellPosition(
            p.id
          );

      list.appendChild(div);
    });
  } catch (error) {
    console.error(
      'Positions:',
      error
    );
  }
}

/* TRADE HISTORY */

async function refreshTrades() {
  try {
    const data =
      await api(
        '/api/trades'
      );

    const trades =
      data.trades || [];

    const list =
      $('tradesList');

    if (!trades.length) {
      list.innerHTML =
        '<p class="empty">No trades yet.</p>';

      return;
    }

    list.innerHTML = '';

    trades.forEach(t => {
      const div =
        document.createElement(
          'div'
        );

      div.className =
        'trade';

      const cls =
        pnlClass(
          t.pnlUsd
        );

      div.innerHTML = `
        <div class="pos-top">
          <div>
            <div class="pos-sym">
              ${esc(
                t.symbol ||
                t.tokenName ||
                'TOKEN'
              )}
            </div>

            <div class="muted small">
              ${esc(
                chainName(
                  t.chain
                )
              )}
              · ${esc(
                t.side
              )}
            </div>
          </div>

          <div class="muted small">
            ${esc(
              t.createdAt
            )}
          </div>
        </div>

        <div class="pos-grid">
          <div>
            <span class="label">
              PRICE
            </span>
            ${fmtPrice(
              t.priceUsd
            )}
          </div>

          <div>
            <span class="label">
              QUANTITY
            </span>
            ${fmtQty(
              t.quantity
            )}
          </div>

          <div>
            <span class="label">
              VALUE
            </span>
            ${fmtUsd(
              t.amountUsd
            )}
          </div>

          <div>
            <span class="label">
              P&L
            </span>
            <span class="${cls}">
              ${
                t.side === 'SELL'
                  ? signedUsd(
                      t.pnlUsd
                    )
                  : '—'
              }
            </span>
          </div>
        </div>
      `;

      list.appendChild(div);
    });
  } catch (error) {
    console.error(
      'Trades:',
      error
    );
  }
}

/* DEPOSIT / WITHDRAW */

async function changeBalance(
  type
) {
  const title =
    type === 'deposit'
      ? 'Enter deposit amount in USD:'
      : 'Enter withdrawal amount in USD:';

  const input =
    prompt(title);

  if (input === null) {
    return;
  }

  const amount =
    Number(input);

  if (
    !Number.isFinite(amount) ||
    amount <= 0
  ) {
    alert(
      'Enter a valid amount.'
    );

    return;
  }

  try {
    await api(
      '/api/' + type,
      {
        method: 'POST',
        body: JSON.stringify({
          amountUsd:
            amount
        })
      }
    );

    await refreshAll();
  } catch (error) {
    alert(
      error.message
    );
  }
}

/* COPY */

async function copyAddress() {
  if (
    !currentToken ||
    !currentToken.address
  ) {
    return;
  }

  try {
    await navigator.clipboard.writeText(
      currentToken.address
    );

    const button =
      $('copyAddressBtn');

    button.textContent =
      'COPIED';

    setTimeout(
      () => {
        button.textContent =
          'COPY';
      },
      1500
    );
  } catch (_) {
    prompt(
      'Copy token address:',
      currentToken.address
    );
  }
}

/* REFRESH */

async function refreshAll() {
  await Promise.all([
    refreshWallet(),
    refreshPositions(),
    refreshTrades(),
    loadPTConfig()
  ]);
}

/* EVENTS */

$('loadBtn').onclick =
  loadToken;

$('tokenInput')
  .addEventListener(
    'keydown',
    event => {
      if (
        event.key === 'Enter'
      ) {
        loadToken();
      }
    }
  );

$('depositBtn').onclick =
  () =>
    changeBalance(
      'deposit'
    );

$('withdrawBtn').onclick =
  () =>
    changeBalance(
      'withdraw'
    );

$('copyAddressBtn').onclick =
  copyAddress;

/* START */

refreshAll();

setInterval(
  async () => {
    await refreshCurrentToken();
    await refreshAll();
  },
  POLL_MS
);
/* FINAL TRADING PATCH */

let PT_FEE_PCT = 0.25;
let PT_SLIPPAGE_PCT = 0.50;
let ptConfigLoaded = false;

async function loadPTConfig() {
  try {
    const data = await api('/api/config');
    const config = data.config || {};

    const fee = Number(config.feePct);
    const slippage = Number(config.slippagePct);

    if (Number.isFinite(fee) && fee >= 0) {
      PT_FEE_PCT = fee;
    }

    if (Number.isFinite(slippage) && slippage >= 0) {
      PT_SLIPPAGE_PCT = slippage;
    }

    ptConfigLoaded = true;
  } catch (_) {
    // Safe defaults match the backend defaults.
    ptConfigLoaded = false;
  }
}

function ptModal(title, html, confirmFn) {
  let m = $('ptModal');
  if (!m) {
    m = document.createElement('div');
    m.id = 'ptModal';
    m.style.cssText = 'position:fixed;inset:0;background:#000b;z-index:9999;display:flex;align-items:center;justify-content:center;padding:16px';
    m.innerHTML = '<div id="ptBox" style="width:min(460px,100%);max-height:90vh;overflow:auto;background:#171717;border-radius:16px;padding:20px"><div style="display:flex;justify-content:space-between;align-items:center"><b id="ptTitle"></b><button id="ptX" class="btn">X</button></div><div id="ptBody"></div><div id="ptErr" class="error hidden"></div><div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-top:15px"><button id="ptCancel" class="btn">CANCEL</button><button id="ptConfirm" class="btn primary">CONFIRM</button></div></div>';
    document.body.appendChild(m);
    $('ptX').onclick = () => {
      tradeProcessing = false;
      m.remove();
    };
    $('ptCancel').onclick = () => {
      tradeProcessing = false;
      m.remove();
    };
  }
  $('ptTitle').textContent = title;
  $('ptBody').innerHTML = html;
  hide('ptErr');
  $('ptConfirm').disabled = false;
  $('ptConfirm').textContent = 'CONFIRM';
  $('ptConfirm').onclick = async () => {
    $('ptConfirm').disabled = true;
    $('ptConfirm').textContent = 'PROCESSING...';
    try {
      await confirmFn();
      m.remove();
      await refreshAll();
    } catch (e) {
      tradeProcessing = false;
      $('ptErr').textContent = e.message || 'Trade failed';
      show('ptErr');
      $('ptConfirm').disabled = false;
      $('ptConfirm').textContent = 'CONFIRM';
    }
  };
  m.style.display = 'flex';
}

buyToken = function () {
  if (tradeProcessing) return;

  if (!currentToken) {
    return showGlobalError('Load a token first.');
  }

  const amount = Number($('amountInput')?.value);
  const price = Number(currentToken.priceUsd);

  if (!Number.isFinite(amount) || amount <= 0) {
    return showGlobalError('Enter a valid investment amount.');
  }

  if (!Number.isFinite(price) || price <= 0) {
    return showGlobalError('A live price is required before buying.');
  }

  const fee = amount * PT_FEE_PCT / 100;
  const execution = price * (1 + PT_SLIPPAGE_PCT / 100);
  const qty = amount / execution;

  tradeProcessing = true;

  ptModal(
    'Confirm BUY ' + (currentToken.symbol || 'TOKEN'),
    '<div class="pos-grid">' +
    '<div>MARKET<br><b>' + fmtPrice(price) + '</b></div>' +
    '<div>EXECUTION<br><b>' + fmtPrice(execution) + '</b></div>' +
    '<div>INVESTMENT<br><b>' + fmtUsd(amount) + '</b></div>' +
    '<div>FEE<br><b>' + fmtUsd(fee) + '</b></div>' +
    '<div>SLIPPAGE<br><b>' + PT_SLIPPAGE_PCT + '%</b></div>' +
    '<div>QUANTITY<br><b>' + fmtQty(qty) + '</b></div>' +
    '</div>',
    async () => {
      try {
        // Snapshot the token at confirm time so a later search can't change it
        const tokenToBuy = currentToken;
        if (!tokenToBuy || !tokenToBuy.chain || !tokenToBuy.address) {
          throw new Error('Token selection was lost. Search and select the token again.');
        }

        await api('/api/buy', {
          method: 'POST',
          body: JSON.stringify({
            chain: tokenToBuy.chain,
            address: tokenToBuy.address,
            amountUsd: amount
          })
        });

        $('amountInput').value = '';
        await refreshAll();
      } finally {
        tradeProcessing = false;
      }
    }
  );
};

sellPosition = async function (positionId) {
  if (tradeProcessing) return;

  tradeProcessing = true;

  try {
    const d = await api('/api/position/' + encodeURIComponent(positionId));
    const p = d.position || d;
    const owned = Number(p.quantity);

    if (!Number.isFinite(owned) || owned <= 0) {
      throw new Error('Invalid position quantity.');
    }

    // Fetch a fresh live price for this position's token
    let price = Number(p.currentPriceUsd);
    if (!Number.isFinite(price) || price <= 0) {
      try {
        const priceData = await api(
          '/api/price/' +
          encodeURIComponent(p.chain) + '/' +
          encodeURIComponent(p.tokenAddress)
        );
        price = Number(priceData?.price?.priceUsd || priceData?.priceUsd);
      } catch (_) {}
    }

    if (!Number.isFinite(price) || price <= 0) {
      throw new Error('Current price unavailable. Try again in a moment.');
    }

    let qty = owned;

    const html =
      '<div style="display:grid;grid-template-columns:repeat(4,1fr);gap:6px;margin:12px 0">' +
      ['25','50','75','100'].map(x =>
        '<button class="btn ptPct" data-p="' + x + '">' + x + '%</button>'
      ).join('') +
      '</div>' +
      '<input id="ptQty" type="number" min="0" step="any" value="' + owned + '" placeholder="Custom quantity" style="width:100%;box-sizing:border-box;padding:12px">' +
      '<div id="ptPreview" style="margin-top:14px"></div>';

    ptModal(
      'Sell ' + (p.symbol || p.tokenName || 'TOKEN'),
      html,
      async () => {
        try {
          qty = Number($('ptQty').value);

          if (!Number.isFinite(qty) || qty <= 0) {
            throw new Error('Enter a valid quantity.');
          }

          if (qty > owned + 1e-12) {
            throw new Error('You cannot sell more than you own.');
          }

          await api('/api/sell', {
            method: 'POST',
            body: JSON.stringify({
              positionId: p.id,
              quantity: qty
            })
          });

          await refreshAll();
        } finally {
          tradeProcessing = false;
        }
      }
    );

    const update = () => {
      const q = Number($('ptQty').value);

      if (!Number.isFinite(q) || q <= 0) {
        $('ptPreview').textContent = '';
        return;
      }

      const execution = price * (1 - PT_SLIPPAGE_PCT / 100);
      const gross = q * execution;
      const fee = gross * PT_FEE_PCT / 100;
      const net = gross - fee;
      const basis =
        Number(p.investedUsd || p.costBasisUsd || 0) *
        q / owned;
      const pnl = net - basis;

      $('ptPreview').innerHTML =
        'Market: <b>' + fmtPrice(price) + '</b><br>' +
        'Execution: <b>' + fmtPrice(execution) + '</b><br>' +
        'Quantity: <b>' + fmtQty(q) + '</b><br>' +
        'Gross: <b>' + fmtUsd(gross) + '</b><br>' +
        'Fee: <b>' + fmtUsd(fee) + '</b><br>' +
        'Net: <b>' + fmtUsd(net) + '</b><br>' +
        'Estimated P&L: <b class="' + pnlClass(pnl) + '">' +
        signedUsd(pnl) + '</b>';
    };

    setTimeout(() => {
      document.querySelectorAll('.ptPct').forEach(b => {
        b.onclick = () => {
          $('ptQty').value =
            owned * Number(b.dataset.p) / 100;
          update();
        };
      });

      $('ptQty').oninput = update;
      update();
    }, 0);

  } catch (e) {
    tradeProcessing = false;
    showGlobalError(e.message || 'Unable to load position.');
  }
};

resetAccount = async function () {
  if (!confirm(
    'Reset account? Positions, trades and balance history will be deleted. Your anonymous account ID stays the same.'
  )) return;

  try {
    await api('/api/reset', { method: 'POST' });
    currentToken = null;
    hide('tokenCard');
    hide('chainChooser');
    await refreshAll();
  } catch (e) {
    showGlobalError(e.message || 'Reset failed.');
  }
};

console.log('PaperTrade final trading patch loaded');

/* FINAL WIRING FIX */
function showGlobalError(msg) {
  alert(msg || 'Something went wrong.');
}

if ($('buyBtn')) $('buyBtn').onclick = buyToken;
if ($('resetBtn')) $('resetBtn').onclick = resetAccount;

console.log('PaperTrade handlers wired');
