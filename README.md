# PaperTrade

A multi-chain paper trading simulator that uses real market prices while keeping all trading completely simulated.

## Important

PaperTrade does not use real money.

It does not:

- Connect to wallets
- Store private keys
- Send blockchain transactions
- Buy real tokens
- Sell real tokens
- Require a funded wallet

All balances, positions and trades are simulated.

## Features

- Multi-chain token support
- Automatic chain detection
- Real market prices
- Paper buying and selling
- Simulated portfolio
- Real-time position repricing
- Profit and loss tracking
- Trade history
- Account reset
- Mobile-friendly interface
- SQLite database
- Provider fallback
- Stale-price protection

## Supported Chains

- Ethereum
- Base
- BNB Smart Chain
- Arbitrum
- Polygon
- Avalanche
- Solana

## Market Data

PaperTrade uses public market-data providers.

Primary provider:

- DexScreener

Fallback provider:

- GeckoTerminal

Prices are fetched when tokens are loaded and positions are periodically repriced.

## How Trading Works

When you paper buy a token:

1. PaperTrade fetches the current market price.
2. The requested USD amount is deducted from the simulated cash balance.
3. The simulator calculates the token quantity.
4. The position is stored in SQLite.
5. No blockchain transaction occurs.

When you paper sell:

1. PaperTrade fetches the current market price.
2. The position is closed at that simulated market price.
3. Profit or loss is calculated.
4. The simulated cash balance is updated.
5. The trade is recorded in the database.

## Starting Balance

Every new session starts with:

```text
$10,000
