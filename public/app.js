'use strict';

const $ = (id) => document.getElementById(id);
const POLL_MS = 30000;
const state = { token: null, positions: [], busy: false, feePct: 0.25, slippagePct: 0.5, portfolio: localStorage.getItem('pt_portfolio') || 'default', accessToken: localStorage.getItem('pt_access_token') || '', refreshToken: localStorage.getItem('pt_refresh_token') || '', expiresAt: Number(localStorage.getItem('pt_expires_at') || 0), authRefresh: null };
let toastTimer;
let modalAction = null;
let sessionId = localStorage.getItem('pt_session');

if (!sessionId) {
  sessionId = globalThis.crypto?.randomUUID?.() || `pt-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  localStorage.setItem('pt_session', sessionId);
}

function saveSession(session) {
  state.accessToken = session?.access_token || '';
  state.refreshToken = session?.refresh_token || state.refreshToken || '';
  state.expiresAt = Date.now() + Number(session?.expires_in || 3600) * 1000;
  localStorage.setItem('pt_access_token', state.accessToken);
  localStorage.setItem('pt_refresh_token', state.refreshToken);
  localStorage.setItem('pt_expires_at', String(state.expiresAt));
  $('authBtn').textContent = state.accessToken ? 'Account' : 'Sign in';
}

function clearSession() {
  state.accessToken = ''; state.refreshToken = ''; state.expiresAt = 0;
  ['pt_access_token', 'pt_refresh_token', 'pt_expires_at'].forEach(key => localStorage.removeItem(key));
  $('authBtn').textContent = 'Sign in';
}

async function refreshSession() {
  if (!state.refreshToken) return false;
  if (!state.authRefresh) state.authRefresh = fetch('/api/auth/refresh', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ refreshToken: state.refreshToken }) })
    .then(async response => ({ response, data: await response.json().catch(() => ({})) }))
    .then(({ response, data }) => { if (!response.ok || !data.session?.access_token) throw new Error(data.error || 'Session expired'); saveSession(data.session); return true; })
    .catch(() => { clearSession(); return false; })
    .finally(() => { state.authRefresh = null; });
  return state.authRefresh;
}

async function api(url, options = {}, retried = false) {
  if (state.refreshToken && state.expiresAt && Date.now() > state.expiresAt - 60000 && !String(url).startsWith('/api/auth/')) await refreshSession();
  const response = await fetch(url, {
    ...options,
    headers: { 'Content-Type': 'application/json', 'X-Session-Id': sessionId, 'X-Portfolio-Id': state.portfolio, ...(state.accessToken ? { Authorization: `Bearer ${state.accessToken}` } : {}), ...(options.headers || {}) }
  });
  const data = await response.json().catch(() => ({}));
  if (response.status === 401 && state.refreshToken && !retried && await refreshSession()) return api(url, options, true);
  if (!response.ok) throw new Error(data.error || `Request failed (${response.status})`);
  return data;
}

function number(value) { const n = Number(value); return Number.isFinite(n) ? n : null; }
function money(value, decimals = 2) { const n = number(value); return n === null ? '—' : new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: decimals, maximumFractionDigits: decimals }).format(n); }
function price(value) { const n = number(value); if (n === null) return '—'; if (n >= 1) return money(n); if (n >= 0.01) return `$${n.toFixed(4)}`; return `$${n.toPrecision(5)}`; }
function compact(value) { const n = number(value); return n === null ? '—' : `$${new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 2 }).format(n)}`; }
function quantity(value) { const n = number(value); return n === null ? '—' : n.toLocaleString('en-US', { maximumFractionDigits: 8 }); }
function percent(value) { const n = number(value); return n === null ? '—' : `${n >= 0 ? '+' : ''}${n.toFixed(2)}%`; }
function signedMoney(value) { const n = number(value); return n === null ? '—' : `${n >= 0 ? '+' : '-'}${money(Math.abs(n))}`; }
function tone(value) { const n = number(value); return n === null || n === 0 ? '' : n > 0 ? 'positive' : 'negative'; }
function chainName(chain) { return ({ solana: 'Solana', ethereum: 'Ethereum', base: 'Base', bsc: 'BNB Chain', arbitrum: 'Arbitrum', polygon: 'Polygon', avalanche: 'Avalanche', robinhood: 'Robinhood Chain' })[chain] || chain || 'Unknown'; }
function relativeTime(value) { const ms = typeof value === 'number' ? value : Date.parse(value); if (!Number.isFinite(ms)) return '—'; const seconds = Math.max(0, Math.floor((Date.now() - ms) / 1000)); if (seconds < 60) return `${seconds}s ago`; if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`; if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`; return `${Math.floor(seconds / 86400)}d ago`; }
function dateTime(value) { const ms = Date.parse(value); return Number.isFinite(ms) ? new Date(ms).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }) : '—'; }
function show(id) { $(id)?.classList.remove('hidden'); }
function hide(id) { $(id)?.classList.add('hidden'); }
function message(id, text) { const el = $(id); if (!el) return; el.textContent = text || ''; el.classList.toggle('hidden', !text); }
function setButton(id, busy, busyText, normalText) { const el = $(id); if (!el) return; el.disabled = busy; el.textContent = busy ? busyText : normalText; }
function setPnl(id, value) { const el = $(id); if (!el) return; el.textContent = signedMoney(value); el.className = tone(value); }

function toast(text, isError = false) {
  const el = $('toast');
  clearTimeout(toastTimer);
  el.textContent = text;
  el.className = `toast${isError ? ' error-toast' : ''}`;
  toastTimer = setTimeout(() => hide('toast'), 3000);
}

function openModal(title, body, action, confirmText = 'Confirm') {
  $('modalTitle').textContent = title;
  $('modalBody').innerHTML = body;
  $('modalConfirm').textContent = confirmText;
  $('modalConfirm').disabled = false;
  message('modalError', '');
  modalAction = action;
  show('modal');
  document.body.style.overflow = 'hidden';
  setTimeout(() => $('modalBody').querySelector('input')?.focus(), 0);
}

function closeModal() {
  if (state.busy) return;
  hide('modal');
  document.body.style.overflow = '';
  modalAction = null;
}

async function confirmModal() {
  if (!modalAction || state.busy) return;
  state.busy = true;
  $('modalConfirm').disabled = true;
  $('modalConfirm').textContent = 'Processing…';
  message('modalError', '');
  try {
    await modalAction();
    state.busy = false;
    closeModal();
  } catch (error) {
    state.busy = false;
    $('modalConfirm').disabled = false;
    $('modalConfirm').textContent = 'Try again';
    message('modalError', error.message || 'Action failed.');
  }
}

async function loadConfig() {
  try {
    const { config = {} } = await api('/api/config');
    if (number(config.feePct) !== null) state.feePct = Number(config.feePct);
    if (number(config.slippagePct) !== null) state.slippagePct = Number(config.slippagePct);
    $('feeNote').textContent = `${state.feePct}% fee and ${state.slippagePct}% simulated slippage. Final execution uses a fresh live price.`;
  } catch (_) {}
}

async function refreshWallet() {
  const { wallet = {} } = await api('/api/wallet');
  $('wCash').textContent = money(wallet.cashUsd);
  $('wPositions').textContent = money(wallet.positionValueUsd);
  $('wEquity').textContent = money(wallet.equityUsd);
  setPnl('wRealized', wallet.realizedPnlUsd);
  setPnl('wUnrealized', wallet.unrealizedPnlUsd);
  $('solValue').textContent = number(wallet.equitySol) === null ? 'SOL price unavailable' : `${Number(wallet.equitySol).toLocaleString('en-US', { minimumFractionDigits: 4, maximumFractionDigits: 6 })} SOL · 1 SOL = ${price(wallet.solPriceUsd)}`;
  $('lastSync').textContent = 'Updated just now';
}

function selectToken(token) {
  selectTab('trade');
  state.token = token;
  hide('chainChooser');
  message('resolveError', '');
  $('tSymbol').textContent = token.symbol || 'TOKEN';
  $('buySymbol').textContent = token.symbol || 'token';
  $('tName').textContent = token.name || 'Unknown token';
  $('tIcon').textContent = (token.symbol || '?').slice(0, 2).toUpperCase();
  $('tChain').textContent = chainName(token.chain);
  $('tDex').textContent = token.dex || token.source || 'Live market';
  updateTokenDisplay(token);
  const risks = Array.isArray(token.riskWarnings) ? token.riskWarnings : [];
  $('riskWarnings').innerHTML = risks.map(item => `<div>⚠ ${item.message}</div>`).join('');
  $('riskWarnings').classList.toggle('hidden', !risks.length);
  $('tAddr').textContent = token.address || '—';
  $('amountInput').value = '';
  message('buyError', '');
  show('tokenCard');
  if (!$('watchBtn')) { const b=document.createElement('button'); b.id='watchBtn'; b.className='text-button watch-button'; b.type='button'; b.textContent='Add to watchlist'; b.onclick=addWatch; $('copyAddressBtn').after(b); }
  $('tokenCard').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function updateTokenDisplay(token) {
  $('tPrice').textContent = price(token.priceUsd);
  $('tChange').textContent = `${percent(token.priceChange24h)} today`;
  $('tChange').className = tone(token.priceChange24h);
  $('tMcap').textContent = compact(token.marketCapUsd);
  $('tLiq').textContent = compact(token.liquidityUsd);
  $('tVol').textContent = compact(token.volume24hUsd);
  $('tUpdated').textContent = relativeTime(token.updatedAt);
  if (token.stale || token.priceAvailable === false) show('tStale'); else hide('tStale');
}

function renderResults(tokens) {
  const list = $('chainButtons');
  list.replaceChildren();
  tokens.slice(0, 12).forEach((token) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'result-item';
    const left = document.createElement('span'); left.className = 'result-token';
    const name = document.createElement('strong'); name.textContent = `${token.symbol || 'TOKEN'} · ${chainName(token.chain)}`;
    const detail = document.createElement('span'); detail.textContent = token.name || 'Unknown token';
    const meta = document.createElement('span'); meta.className = 'result-meta'; meta.textContent = token.liquidityUsd ? `Liq ${compact(token.liquidityUsd)}` : price(token.priceUsd);
    left.append(name, detail); button.append(left, meta); button.addEventListener('click', () => selectToken(token)); list.appendChild(button);
  });
  show('chainChooser');
}

async function searchToken(event) {
  event?.preventDefault();
  const query = $('tokenInput').value.trim();
  message('resolveError', ''); hide('chainChooser');
  if (!query) return message('resolveError', 'Enter a token name, symbol, or contract address.');
  setButton('loadBtn', true, 'Searching…', 'Search'); show('searchStatus');
  try {
    const addressLike = /^0x[a-fA-F0-9]{40}$/.test(query) || /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(query);
    let tokens = [];
    if (addressLike) {
      try { const data = await api(`/api/token/resolve/${encodeURIComponent(query)}`); tokens = data.token ? [data.token] : (data.tokens || []); } catch (_) {}
    }
    if (!tokens.length) { const data = await api(`/api/token/search?q=${encodeURIComponent(query)}`); tokens = data.results || []; }
    if (!tokens.length) throw new Error('No matching tokens found. Check the name or contract and try again.');
    if (tokens.length === 1) selectToken(tokens[0]); else renderResults(tokens);
  } catch (error) { message('resolveError', error.message || 'Token search failed.'); }
  finally { hide('searchStatus'); setButton('loadBtn', false, 'Searching…', 'Search'); }
}

async function refreshCurrentToken() {
  if (!state.token) return;
  try {
    const data = await api(`/api/price/${encodeURIComponent(state.token.chain)}/${encodeURIComponent(state.token.address)}`);
    state.token = { ...state.token, ...(data.price || {}) };
    updateTokenDisplay(state.token);
  } catch (_) { show('tStale'); }
}

function emptyState(icon, title, copy) { return `<div class="empty-state"><span>${icon}</span><strong>${title}</strong><p>${copy}</p></div>`; }

async function refreshPositions() {
  const { positions = [] } = await api('/api/positions');
  state.positions = positions;
  $('positionCount').textContent = String(positions.length);
  const list = $('positionsList');
  if (!positions.length) { list.innerHTML = emptyState('◎', 'No open positions', 'Search for a token and place your first paper trade.'); return; }
  list.replaceChildren();
  positions.forEach((position) => {
    const row = document.createElement('article'); row.className = 'position';
    const unavailable = number(position.currentPriceUsd) === null;
    row.innerHTML = `<div class="row-between"><div class="asset-name"><strong></strong><span></span></div><div class="position-price"><strong>${unavailable ? 'Price unavailable' : price(position.currentPriceUsd)}</strong><span class="updated">${position.priceUpdatedAt ? relativeTime(position.priceUpdatedAt) : ''}</span></div></div><div class="position-grid position-market"><div><span>Invested</span><strong>${money(position.investedUsd)}</strong></div><div><span>Current value</span><strong>${money(position.currentValueUsd)}</strong></div><div><span>Entry price</span><strong>${price(position.entryPriceUsd)}</strong></div><div><span>Market cap</span><strong>${compact(position.marketCapUsd)}</strong></div><div><span>Liquidity</span><strong>${compact(position.liquidityUsd)}</strong></div><div><span>24h volume</span><strong>${compact(position.volume24hUsd)}</strong></div></div><div class="position-footer"><span class="pnl ${tone(position.unrealizedPnlUsd)}">${unavailable ? 'Waiting for price' : `${signedMoney(position.unrealizedPnlUsd)} (${percent(position.unrealizedPnlPct)})`}</span><span><button class="text-button copy-position" type="button">Copy CA</button><button class="text-button exits" type="button">Set exits</button><button class="sell-button" type="button" ${unavailable ? 'disabled' : ''}>Review sell</button></span></div>`;
    row.querySelector('.asset-name strong').textContent = position.symbol || position.tokenName || 'TOKEN';
    row.querySelector('.asset-name span').textContent = `${chainName(position.chain)} · ${quantity(position.quantity)} tokens`;
    row.querySelector('.sell-button').addEventListener('click', () => reviewSell(position)); list.appendChild(row);
    row.querySelector('.copy-position').addEventListener('click', () => copyText(position.tokenAddress, 'Contract address copied.'));
    row.querySelector('.exits').addEventListener('click', () => setExit(position));
  });
}

async function refreshTrades() {
  const { trades = [] } = await api('/api/trades');
  const list = $('tradesList');
  if (!trades.length) { list.innerHTML = emptyState('↕', 'No trades yet', 'Your buys and sells will appear here.'); return; }
  list.replaceChildren();
  trades.forEach((trade) => {
    const row = document.createElement('article'); row.className = 'trade-item';
    row.innerHTML = `<div class="row-between"><div class="asset-name"><strong><span class="side ${String(trade.side).toLowerCase()}">${trade.side}</span><span class="trade-symbol"></span></strong><span>${chainName(trade.chain)}</span></div><span class="updated">${dateTime(trade.createdAt)}</span></div><div class="trade-values"><div><span>Value</span><strong>${money(trade.amountUsd)}</strong></div><div><span>Execution</span><strong>${price(trade.priceUsd)}</strong></div><div><span>P&amp;L</span><strong class="${tone(trade.pnlUsd)}">${trade.side === 'SELL' ? signedMoney(trade.pnlUsd) : '—'}</strong></div></div>`;
    row.querySelector('.trade-symbol').textContent = trade.symbol || trade.tokenName || 'TOKEN'; list.appendChild(row);
  });
}

async function refreshAll({ quiet = false } = {}) {
  const tasks = [refreshWallet(), refreshPositions(), refreshTrades()];
  const results = await Promise.allSettled(tasks);
  const failed = results.find((result) => result.status === 'rejected');
  if (failed) { $('marketStatus').classList.add('offline'); if (!quiet) toast(failed.reason?.message || 'Unable to refresh account.', true); }
  else $('marketStatus').classList.remove('offline');
}

function reviewBalance(type) {
  const isDeposit = type === 'deposit';
  openModal(isDeposit ? 'Add paper funds' : 'Withdraw paper funds', `<label class="form-label" for="balanceAmount">Amount in USD</label><input class="modal-input" id="balanceAmount" type="number" inputmode="decimal" min="0.01" step="0.01" placeholder="100.00"><p class="trade-note">This changes simulated cash only. No real money moves.</p>`, async () => {
    const amount = Number($('balanceAmount').value);
    if (!Number.isFinite(amount) || amount <= 0) throw new Error('Enter an amount greater than zero.');
    await api(`/api/${type}`, { method: 'POST', body: JSON.stringify({ amountUsd: amount }) });
    await refreshAll({ quiet: true }); toast(isDeposit ? `${money(amount)} added to paper cash.` : `${money(amount)} withdrawn from paper cash.`);
  }, isDeposit ? 'Add funds' : 'Withdraw');
}

function reviewBuy() {
  message('buyError', '');
  const token = state.token; const amount = Number($('amountInput').value); const market = number(token?.priceUsd);
  if (!token) return message('buyError', 'Select a token first.');
  if (!Number.isFinite(amount) || amount <= 0) return message('buyError', 'Enter an investment amount greater than zero.');
  if (market === null || market <= 0) return message('buyError', 'A live price is required before buying.');
  const execution = market * (1 + state.slippagePct / 100); const fee = amount * state.feePct / 100;
  openModal(`Buy ${token.symbol || 'token'}`, `<div class="review-grid"><div><span>Investment</span><strong>${money(amount)}</strong></div><div><span>Estimated fee</span><strong>${money(fee)}</strong></div><div><span>Market price</span><strong>${price(market)}</strong></div><div><span>Est. execution</span><strong>${price(execution)}</strong></div><div><span>Est. quantity</span><strong>${quantity(amount / execution)}</strong></div><div><span>Total cash</span><strong>${money(amount + fee)}</strong></div></div>`, async () => {
    await api('/api/buy', { method: 'POST', body: JSON.stringify({ chain: token.chain, address: token.address, amountUsd: amount }) });
    $('amountInput').value = ''; await refreshAll({ quiet: true }); toast(`${token.symbol || 'Token'} paper buy completed.`);
  }, 'Confirm buy');
}

function reviewSell(position) {
  const owned = Number(position.quantity); const market = Number(position.currentPriceUsd); let chosen = owned;
  if (!Number.isFinite(owned) || owned <= 0 || !Number.isFinite(market) || market <= 0) return toast('A live position price is required to sell.', true);
  openModal(`Sell ${position.symbol || 'token'}`, `<div class="sell-options"><button class="quick-sell button-secondary" type="button" data-percent="25">25%</button><button class="quick-sell button-secondary" type="button" data-percent="50">50%</button><button class="quick-sell button-secondary" type="button" data-percent="75">75%</button><button class="quick-sell button-secondary" type="button" data-percent="100">100%</button></div><label class="form-label" for="sellQuantity">Quantity to sell</label><input class="modal-input" id="sellQuantity" type="number" min="0" step="any" value="${owned}"><div id="sellPreview" class="review-grid" style="margin-top:12px"></div>`, async () => {
    chosen = Number($('sellQuantity').value);
    if (!Number.isFinite(chosen) || chosen <= 0) throw new Error('Enter a valid quantity.');
    if (chosen > owned + 1e-12) throw new Error('You cannot sell more than you own.');
    await api('/api/sell', { method: 'POST', body: JSON.stringify({ positionId: position.id, quantity: chosen }) });
    await refreshAll({ quiet: true }); toast(`${position.symbol || 'Token'} paper sell completed.`);
  }, 'Confirm sell');
  const update = () => { const qty = Number($('sellQuantity').value); chosen = qty; const execution = market * (1 - state.slippagePct / 100); const gross = qty * execution; const fee = gross * state.feePct / 100; const basis = Number(position.investedUsd || position.costBasisUsd || 0) * qty / owned; const pnl = gross - fee - basis; $('sellPreview').innerHTML = `<div><span>Est. proceeds</span><strong>${money(gross - fee)}</strong></div><div><span>Est. P&amp;L</span><strong class="${tone(pnl)}">${signedMoney(pnl)}</strong></div>`; };
  document.querySelectorAll('.quick-sell').forEach((button) => button.addEventListener('click', () => { $('sellQuantity').value = String(owned * Number(button.dataset.percent) / 100); update(); }));
  $('sellQuantity').addEventListener('input', update); update();
}

function reviewReset() {
  openModal('Reset paper account', '<p style="color:#aeb8c5;font-size:.8rem;line-height:1.6">This permanently clears all open positions, trades, and balance activity, then restores the starting paper balance.</p>', async () => {
    await api('/api/reset', { method: 'POST' }); state.token = null; hide('tokenCard'); hide('chainChooser'); await refreshAll({ quiet: true }); toast('Paper account reset.');
  }, 'Reset account');
}

async function copyAddress() {
  if (!state.token?.address) return;
  return copyText(state.token.address, 'Contract address copied.');
}

async function copyText(value, successMessage) {
  try { await navigator.clipboard.writeText(value); toast(successMessage); }
  catch (_) { toast('Copy failed. Press and hold the contract address.', true); }
}

function bindEvents() {
  $('searchForm').addEventListener('submit', searchToken);
  $('depositBtn').addEventListener('click', () => reviewBalance('deposit'));
  $('withdrawBtn').addEventListener('click', () => reviewBalance('withdraw'));
  $('resetBtn').addEventListener('click', reviewReset);
  $('buyBtn').addEventListener('click', reviewBuy);
  $('copyAddressBtn').addEventListener('click', copyAddress);
  document.querySelectorAll('[data-close-modal]').forEach((button) => button.addEventListener('click', closeModal));
  $('modalCancel').addEventListener('click', closeModal); $('modalConfirm').addEventListener('click', confirmModal);
  document.querySelectorAll('[data-amount]').forEach((button) => button.addEventListener('click', () => { $('amountInput').value = button.dataset.amount; message('buyError', ''); }));
  document.addEventListener('keydown', (event) => { if (event.key === 'Escape') closeModal(); });
  $('newPortfolioBtn').addEventListener('click', createPortfolio);
  $('portfolioSelect').addEventListener('change', async event => { state.portfolio=event.target.value; localStorage.setItem('pt_portfolio',state.portfolio); await refreshV2(); await refreshAll(); });
  $('authBtn').addEventListener('click', authDialog);
  $('refreshTrending').addEventListener('click', loadTrending);
  document.querySelectorAll('[data-tab]').forEach(button => button.addEventListener('click', () => selectTab(button.dataset.tab)));
}

function selectTab(tab) {
  document.querySelectorAll('[data-tab]').forEach(button => button.classList.toggle('active', button.dataset.tab === tab));
  document.querySelectorAll('[data-view]').forEach(section => section.classList.toggle('hidden', section.dataset.view !== tab));
  if (!/jsdom/i.test(navigator.userAgent)) window.scrollTo?.({ top: 0, behavior: 'smooth' });
}

async function loadPortfolios(){try{const {portfolios=[]}=await api('/api/portfolios');const select=$('portfolioSelect');select.replaceChildren();portfolios.forEach(p=>{const o=document.createElement('option');o.value=p.key;o.textContent=p.name;o.selected=p.key===state.portfolio;select.appendChild(o);});}catch(_) {}}
function createPortfolio(){openModal('New portfolio','<label class="form-label">Portfolio name</label><input id="portfolioName" class="modal-input" maxlength="40" placeholder="Memecoin strategy">',async()=>{const name=$('portfolioName').value.trim();const {portfolio}=await api('/api/portfolios',{method:'POST',body:JSON.stringify({name})});state.portfolio=portfolio.key;localStorage.setItem('pt_portfolio',state.portfolio);await loadPortfolios();await refreshAll();toast('Portfolio created.');},'Create');}
function authDialog(){
  if (state.accessToken) return openModal('Your account','<p class="trade-note">You are signed in. Your portfolios are linked to this account.</p>',async()=>{clearSession();state.portfolio='default';localStorage.setItem('pt_portfolio','default');await loadPortfolios();await refreshAll();toast('Signed out.');},'Sign out');
  openModal('Sign in','<div class="auth-tabs"><button id="loginMode" class="active" type="button">Sign in</button><button id="signupMode" type="button">Create account</button></div><label class="form-label">Email</label><input id="authEmail" class="modal-input" type="email" autocomplete="email"><label class="form-label auth-password-label">Password</label><input id="authPassword" class="modal-input" type="password" minlength="8" autocomplete="current-password"><p id="authHelp" class="trade-note">Use the email and password you registered with.</p>',async()=>{
    const action=$('signupMode').classList.contains('active')?'signup':'login';
    const email=$('authEmail').value.trim(),password=$('authPassword').value;
    if(!email||password.length<8)throw new Error('Enter a valid email and a password of at least 8 characters.');
    const {session}=await api('/api/auth/'+action,{method:'POST',body:JSON.stringify({email,password})});
    if(session?.access_token){saveSession(session);await loadPortfolios();await refreshAll();toast(action==='signup'?'Account created and signed in.':'Signed in.');}
    else { state.busy=false; $('modalConfirm').disabled=false; $('modalConfirm').textContent='Sign in'; $('loginMode').click(); throw new Error('Account created. Confirm the email Supabase sent you, then sign in here.'); }
  },'Sign in');
  setTimeout(()=>{const setMode=signup=>{const login=$('loginMode'),create=$('signupMode');login.classList.toggle('active',!signup);create.classList.toggle('active',signup);$('modalTitle').textContent=signup?'Create account':'Sign in';$('modalConfirm').textContent=signup?'Create account':'Sign in';$('authHelp').textContent=signup?'Supabase may email you a confirmation link before the first sign-in.':'Use the email and password you registered with.';$('authPassword').autocomplete=signup?'new-password':'current-password';};$('loginMode').onclick=()=>setMode(false);$('signupMode').onclick=()=>setMode(true);},0);
}
async function loadStats(){try{const {statistics:s}=await api('/api/statistics');$('statistics').innerHTML=`<div><span>Win rate</span><strong>${Number(s.winRate).toFixed(1)}%</strong></div><div><span>Closed trades</span><strong>${s.closedTrades}</strong></div><div><span>Total P&amp;L</span><strong class="${tone(s.totalPnlUsd)}">${signedMoney(s.totalPnlUsd)}</strong></div><div><span>Total fees</span><strong>${money(s.totalFeesUsd)}</strong></div>`;}catch(_) {}}
async function loadHistory(){try{const {history=[]}=await api('/api/equity-history');const svg=$('equityChart');if(history.length<2){svg.innerHTML='<text x="300" y="80" text-anchor="middle" fill="#647084" font-size="14">History appears as your portfolio updates</text>';return;}const values=history.map(x=>Number(x.equityUsd));const min=Math.min(...values),max=Math.max(...values),range=max-min||1;const pts=values.map((v,i)=>`${i/(values.length-1)*600},${150-(v-min)/range*135}`).join(' ');svg.innerHTML=`<polyline class="chart-line" points="${pts}"/>`;}catch(_) {}}
async function loadTrending(){try{const {tokens=[]}=await api('/api/trending');const list=$('trendingList');list.replaceChildren();tokens.forEach(t=>{const b=document.createElement('button');b.className='result-item';b.innerHTML=`<span class="result-token"><strong>${t.symbol} · ${chainName(t.chain)}</strong><span>${t.name}</span></span><span class="result-meta">${price(t.priceUsd)}</span>`;b.onclick=()=>selectToken(t);list.appendChild(b);});}catch(error){toast(error.message,true);}}
async function addWatch(){await api('/api/watchlist',{method:'POST',body:JSON.stringify(state.token)});toast('Added to watchlist.');}
async function loadWatchlist(){try{const {tokens=[]}=await api('/api/watchlist');const list=$('watchlistList');list.replaceChildren();if(!tokens.length){list.innerHTML=emptyState('☆','Watchlist empty','Save tokens to follow them without buying.');return;}tokens.forEach(t=>{const b=document.createElement('button');b.className='result-item';b.innerHTML=`<span class="result-token"><strong>${t.symbol} · ${chainName(t.chain)}</strong><span>${t.name}</span></span><span class="result-meta">${price(t.priceUsd)}</span>`;b.onclick=()=>selectToken(t);list.appendChild(b);});}catch(_) {}}
async function loadBalanceHistory(){try{const {history=[]}=await api('/api/balance-history');const list=$('balanceHistory');list.innerHTML=history.length?history.slice(0,20).map(t=>`<div class="trade-item row-between"><span><strong>${t.type==='deposit'?'Deposit':'Withdrawal'}</strong><small class="updated"> ${dateTime(t.createdAt)}</small></span><strong class="${t.type==='deposit'?'positive':'negative'}">${t.type==='deposit'?'+':'-'}${money(t.amountUsd)}</strong></div>`).join(''):emptyState('↕','No cash activity','Deposits and withdrawals appear here.');}catch(_) {}}
function setExit(position){openModal(`Set exits for ${position.symbol}`,'<label class="form-label">Stop-loss price (optional)</label><input id="stopPrice" class="modal-input" type="number" step="any"><label class="form-label" style="margin-top:12px">Take-profit price (optional)</label><input id="takePrice" class="modal-input" type="number" step="any">',async()=>{const stop=Number($('stopPrice').value),take=Number($('takePrice').value);if(!(stop>0)&&!(take>0))throw new Error('Enter at least one trigger price.');if(stop>0)await api('/api/orders',{method:'POST',body:JSON.stringify({positionId:position.id,type:'stop_loss',triggerPriceUsd:stop,percentToSell:100})});if(take>0)await api('/api/orders',{method:'POST',body:JSON.stringify({positionId:position.id,type:'take_profit',triggerPriceUsd:take,percentToSell:100})});toast('Exit orders saved.');},'Save exits');}
async function refreshV2(){await Promise.allSettled([loadPortfolios(),loadStats(),loadHistory(),loadWatchlist(),loadBalanceHistory()]);}

async function init() {
  bindEvents();
  if (state.accessToken) $('authBtn').textContent = 'Account';
  await loadConfig();
  await refreshAll();
  await refreshV2();
  await loadTrending();
  setInterval(async () => { await Promise.allSettled([refreshCurrentToken(), refreshAll({ quiet: true })]); }, POLL_MS);
}

init().catch((error) => toast(error.message || 'PaperTrade could not start.', true));
