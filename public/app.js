const sessionKey = "pt_session";

function createSessionId() {
  if (window.crypto && crypto.randomUUID) {
    return crypto.randomUUID();
  }

  return "pt-" + Date.now() + "-" + Math.random().toString(36).slice(2);
}

let sessionId = localStorage.getItem(sessionKey);

if (!sessionId) {
  sessionId = createSessionId();
  localStorage.setItem(sessionKey, sessionId);
}

let currentToken = null;
let refreshTimer = null;

const $ = (id) => document.getElementById(id);

function api(path, options = {}) {
  const headers = {
    ...(options.headers || {}),
    "X-Session-Id": sessionId
  };

  return fetch(path, {
    ...options,
    headers
  }).then(async (response) => {
    const data = await response.json().catch(() => ({}));

    if (!response.ok) {
      throw new Error(data.error || "Request failed");
    }

    return data;
  });
}

function money(value) {
  const n = Number(value);

  if (!Number.isFinite(n)) {
    return "$0.00";
  }

  return "$" + n.toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  });
}

function price(value) {
  const n = Number(value);

  if (!Number.isFinite(n)) {
    return "$0";
  }

  if (n >= 1) {
    return "$" + n.toLocaleString(undefined, {
      minimumFractionDigits: 2,
      maximumFractionDigits: 6
    });
  }

  if (n >= 0.01) {
    return "$" + n.toFixed(4);
  }

  return "$" + Number(n.toPrecision(5)).toString();
}

function number(value, digits = 4) {
  const n = Number(value);

  if (!Number.isFinite(n)) {
    return "0";
  }

  return n.toLocaleString(undefined, {
    maximumFractionDigits: digits
  });
}

function percent(value) {
  const n = Number(value);

  if (!Number.isFinite(n)) {
    return "0.00%";
  }

  return (n >= 0 ? "+" : "") + n.toFixed(2) + "%";
}

function shortAddress(address) {
  if (!address) {
    return "-";
  }

  if (address.length <= 18) {
    return address;
  }

  return address.slice(0, 8) + "..." + address.slice(-8);
}

function showMessage(text, type = "") {
  const el = $("message");

  el.textContent = text;
  el.className = "message";

  if (type === "error") {
    el.classList.add("loss");
  }

  if (type === "success") {
    el.classList.add("profit");
  }
}

function hideMessage() {
  $("message").classList.add("hidden");
}

function showToken(token) {
  currentToken = token;

  $("tokenCard").classList.remove("hidden");

  $("tokenName").textContent = token.name || "Unknown Token";
  $("tokenSymbol").textContent = token.symbol
    ? "$" + token.symbol
    : "-";

  $("tokenPrice").textContent = price(token.priceUsd);
  $("tokenChange").textContent = percent(token.priceChange24h);

  $("tokenChange").className =
    Number(token.priceChange24h) >= 0 ? "profit" : "loss";

  $("tokenChain").textContent = token.chain || "-";
  $("marketCap").textContent = money(token.marketCapUsd);
  $("liquidity").textContent = money(token.liquidityUsd);
  $("volume").textContent = money(token.volume24hUsd);
  $("dex").textContent = token.dex || "-";
  $("contractAddress").textContent = token.address || "-";

  if (token.updatedAt) {
    $("updated").textContent = new Date(token.updatedAt).toLocaleTimeString();
  } else {
    $("updated").textContent = "-";
  }

  const stale = $("staleBadge");

  if (token.stale) {
    stale.classList.remove("hidden");
  } else {
    stale.classList.add("hidden");
  }

  $("buyBtn").disabled = !token.priceUsd || token.stale;
}

function clearChainChooser() {
  const chooser = $("chainChooser");

  chooser.innerHTML = "";
  chooser.classList.add("hidden");
}

function showChainChooser(tokens) {
  const chooser = $("chainChooser");

  chooser.innerHTML = "";

  if (!Array.isArray(tokens) || tokens.length === 0) {
    chooser.classList.add("hidden");
    return;
  }

  chooser.classList.remove("hidden");

  const title = document.createElement("div");
  title.textContent = "Multiple chains found. Choose one:";
  title.style.width = "100%";
  title.style.color = "#8b949e";
  title.style.fontSize = "13px";

  chooser.appendChild(title);

  tokens.forEach((token) => {
    const button = document.createElement("button");

    button.textContent =
      (token.chain || "unknown") +
      " — " +
      (token.symbol || "token");

    button.addEventListener("click", () => {
      clearChainChooser();
      showToken(token);
      refreshCurrentToken();
    });

    chooser.appendChild(button);
  });
}

async function refreshWallet() {
  try {
    const data = await api("/api/wallet");

    const wallet = data.wallet || data;

    $("cash").textContent = money(wallet.cashUsd);
    $("positionCount").textContent =
      wallet.positionCount ?? 0;
    $("equity").textContent = money(wallet.equityUsd);
    $("totalPnl").textContent = money(wallet.totalPnlUsd);

    $("totalPnl").className =
      Number(wallet.totalPnlUsd) >= 0 ? "profit" : "loss";
  } catch (error) {
    console.error("Wallet refresh failed:", error);
  }
}

async function loadToken() {
  const address = $("tokenAddress").value.trim();

  if (!address) {
    showMessage("Enter a token contract or mint address.", "error");
    return;
  }

  const button = $("loadBtn");

  button.disabled = true;
  button.textContent = "LOADING...";

  hideMessage();
  clearChainChooser();
  $("tokenCard").classList.add("hidden");

  try {
    const data = await api(
      "/api/token/resolve/" + encodeURIComponent(address)
    );

    const tokens = data.tokens || [];

    if (tokens.length === 0) {
      throw new Error("Token not found on supported chains.");
    }

    if (tokens.length === 1) {
      showToken(tokens[0]);
    } else {
      showChainChooser(tokens);
    }

    showMessage("Token loaded.", "success");
  } catch (error) {
    showMessage(error.message, "error");
  } finally {
    button.disabled = false;
    button.textContent = "LOAD TOKEN";
  }
}

async function refreshCurrentToken() {
  if (!currentToken) {
    return;
  }

  try {
    const data = await api(
      "/api/price/" +
      encodeURIComponent(currentToken.chain) +
      "/" +
      encodeURIComponent(currentToken.address)
    );

    const token = data.token || data;

    showToken({
      ...currentToken,
      ...token
    });
  } catch (error) {
    console.error("Price refresh failed:", error);
  }
}

async function refreshPositions() {
  const container = $("positions");

  try {
    const data = await api("/api/positions");

    const positions = data.positions || [];

    if (positions.length === 0) {
      container.innerHTML =
        '<div class="empty">No open positions.</div>';
      return;
    }

    container.innerHTML = "";

    positions.forEach((position) => {
      const item = document.createElement("div");
      item.className = "item";

      const pnl = Number(position.pnlUsd || 0);
      const pnlClass = pnl >= 0 ? "profit" : "loss";

      item.innerHTML = `
        <div class="item-top">
          <div>
            <div class="item-title">
              ${escapeHtml(position.tokenName || position.symbol || "Unknown")}
            </div>

            <div class="item-sub">
              ${escapeHtml(position.chain || "-")}
              · ${escapeHtml(position.symbol || "-")}
              · ${escapeHtml(shortAddress(position.tokenAddress))}
            </div>
          </div>

          <button class="sell" data-id="${position.id}">
            PAPER SELL
          </button>
        </div>

        <div class="item-grid">
          <div>
            <span>Entry</span>
            ${price(position.entryPriceUsd)}
          </div>

          <div>
            <span>Current</span>
            ${price(position.currentPriceUsd)}
          </div>

          <div>
            <span>Invested</span>
            ${money(position.investedUsd)}
          </div>

          <div>
            <span>Value</span>
            ${money(position.currentValueUsd)}
          </div>

          <div>
            <span>Quantity</span>
            ${number(position.quantity, 8)}
          </div>

          <div>
            <span>P&amp;L</span>
            <strong class="${pnlClass}">
              ${money(pnl)}
              (${percent(position.pnlPercent)})
            </strong>
          </div>
        </div>
      `;

      const sellButton = item.querySelector(".sell");

      sellButton.addEventListener("click", () => {
        sellPosition(position.id);
      });

      container.appendChild(item);
    });
  } catch (error) {
    container.innerHTML =
      `<div class="empty">${escapeHtml(error.message)}</div>`;
  }
}

async function sellPosition(positionId) {
  if (!confirm("Sell this paper position at the current market price?")) {
    return;
  }

  try {
    const data = await api("/api/sell", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        positionId
      })
    });

    showMessage(
      "Sold. P&L: " + money(data.trade?.pnlUsd || 0),
      Number(data.trade?.pnlUsd || 0) >= 0
        ? "success"
        : "error"
    );

    await refreshAll();
  } catch (error) {
    showMessage(error.message, "error");
  }
}

async function buyToken() {
  if (!currentToken) {
    showMessage("Load a token first.", "error");
    return;
  }

  const amount = Number($("amountUsd").value);

  if (!Number.isFinite(amount) || amount <= 0) {
    showMessage("Enter a valid investment amount.", "error");
    return;
  }

  const button = $("buyBtn");

  button.disabled = true;
  button.textContent = "BUYING...";

  try {
    const data = await api("/api/buy", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        chain: currentToken.chain,
        address: currentToken.address,
        amountUsd: amount
      })
    });

    showMessage(
      "Paper buy executed at " +
      price(data.trade?.priceUsd || currentToken.priceUsd),
      "success"
    );

    await refreshAll();
  } catch (error) {
    showMessage(error.message, "error");
  } finally {
    button.disabled =
      !currentToken ||
      !currentToken.priceUsd ||
      currentToken.stale;

    button.textContent = "PAPER BUY";
  }
}

async function refreshTrades() {
  const container = $("trades");

  try {
    const data = await api("/api/trades");

    const trades = data.trades || [];

    if (trades.length === 0) {
      container.innerHTML =
        '<div class="empty">No trades yet.</div>';
      return;
    }

    container.innerHTML = "";

    trades.forEach((trade) => {
      const item = document.createElement("div");
      item.className = "item";

      const pnl = Number(trade.pnlUsd || 0);

      item.innerHTML = `
        <div class="item-top">
          <div>
            <div class="item-title">
              ${escapeHtml(trade.side || "").toUpperCase()}
              ${escapeHtml(trade.symbol || trade.tokenName || "TOKEN")}
            </div>

            <div class="item-sub">
              ${escapeHtml(trade.chain || "-")}
              · ${escapeHtml(shortAddress(trade.tokenAddress))}
            </div>
          </div>

          <strong class="${pnl >= 0 ? "profit" : "loss"}">
            ${trade.side === "sell" ? money(pnl) : "-"}
          </strong>
        </div>

        <div class="item-grid">
          <div>
            <span>Price</span>
            ${price(trade.priceUsd)}
          </div>

          <div>
            <span>Amount</span>
            ${money(trade.amountUsd)}
          </div>

          <div>
            <span>Quantity</span>
            ${number(trade.quantity, 8)}
          </div>

          <div>
            <span>Time</span>
            ${formatDate(trade.createdAt)}
          </div>
        </div>
      `;

      container.appendChild(item);
    });
  } catch (error) {
    container.innerHTML =
      `<div class="empty">${escapeHtml(error.message)}</div>`;
  }
}

async function resetAccount() {
  const first = confirm(
    "Reset your paper trading account back to $10,000?"
  );

  if (!first) {
    return;
  }

  const second = confirm(
    "This will delete all open positions and trade history. Continue?"
  );

  if (!second) {
    return;
  }

  try {
    await api("/api/reset", {
      method: "POST"
    });

    currentToken = null;

    $("tokenCard").classList.add("hidden");
    clearChainChooser();

    showMessage("Paper trading account reset.", "success");

    await refreshAll();
  } catch (error) {
    showMessage(error.message, "error");
  }
}

async function refreshAll() {
  await Promise.all([
    refreshWallet(),
    refreshPositions(),
    refreshTrades()
  ]);
}

function formatDate(value) {
  if (!value) {
    return "-";
  }

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return String(value);
  }

  return date.toLocaleString();
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

$("loadBtn").addEventListener("click", loadToken);

$("buyBtn").addEventListener("click", buyToken);

$("resetBtn").addEventListener("click", resetAccount);

$("refreshBtn").addEventListener("click", refreshAll);

$("tokenAddress").addEventListener("keydown", (event) => {
  if (event.key === "Enter") {
    loadToken();
  }
});

refreshAll();

refreshTimer = setInterval(async () => {
  await refreshAll();

  if (currentToken) {
    await refreshCurrentToken();
  }
}, 7000);
