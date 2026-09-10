# PaperTrade

PaperTrade is a responsive multi-chain crypto trading simulator. It uses live market data while every balance, position, buy, and sell remains completely simulated.

## Safety

PaperTrade never connects to a wallet, stores private keys, sends blockchain transactions, or moves real funds.

## Features

- Search by token name, symbol, EVM contract, or Solana mint
- Ethereum, Base, BNB Chain, Arbitrum, Polygon, Avalanche, and Solana support
- DexScreener market data with GeckoTerminal fallback
- Live position valuation and USD-to-SOL portfolio conversion
- Simulated fees and slippage
- Full and partial position selling
- Deposit, withdrawal, P&L, trade history, and account reset
- Durable PostgreSQL storage through Supabase or another Postgres provider
- Responsive, mobile-first interface with accessible review dialogs
- Stale-price protection for trade execution

## Run locally

Requirements: Node.js 18 or newer and a PostgreSQL database.

```bash
npm ci
export DATABASE_URL='your-postgres-connection-string'
npm start
```

Open `http://localhost:10000` unless `PORT` is set.

## Environment variables

| Variable | Required | Default | Purpose |
| --- | --- | --- | --- |
| `DATABASE_URL` | Yes | None | PostgreSQL connection string |
| `PORT` | No | `10000` | HTTP server port |
| `STARTING_BALANCE_USD` | No | `10000` | New account paper balance |
| `PAPERTRADE_FEE_PCT` | No | `0.25` | Simulated trade fee percentage |
| `PAPERTRADE_SLIPPAGE_PCT` | No | `0.50` | Simulated slippage percentage |
| `PAPERTRADE_STALE_AFTER_SECONDS` | No | `30` | Maximum price age for execution |
| `SUPABASE_URL` | For accounts | None | Supabase project URL used for authentication |
| `SUPABASE_ANON_KEY` | For accounts | None | Supabase public anonymous key |
| `SUPPORT_URL` | No | Hidden | Secure payment, donation, or sponsorship page |
| `SUPPORT_LABEL` | No | `Support PaperTrade` | Text shown for the optional support link |

## Verification

```bash
npm run check
```

This validates server and browser JavaScript syntax, verifies token cache isolation, and runs a browser-style smoke test for search, buy, sell, deposit, withdrawal, and reset.

## Deployment

The included `render.yaml` runs the Node service on Render. Add `DATABASE_URL` to the Render service environment before deployment.
