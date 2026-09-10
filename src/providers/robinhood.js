'use strict';

const BASE_URL = process.env.ROBINHOOD_ASSETS_BASE_URL || 'https://api.robinhood.com/rhj';
const CHAIN_ID = 4663;
const ASSET_TTL = 5 * 60 * 1000;
const PRICE_TTL = 15 * 1000;
let assetCache = { expires: 0, assets: [] };
let priceCache = { expires: 0, quotes: [] };

async function fetchJson(path) {
  const response = await fetch(`${BASE_URL}${path}`, {
    headers: { accept: 'application/json', 'user-agent': 'PaperTrade/1.0' }
  });
  if (!response.ok) throw new Error(`Robinhood HTTP ${response.status}`);
  return response.json();
}

async function getAssets() {
  if (Date.now() < assetCache.expires) return assetCache.assets;
  const data = await fetchJson('/assets');
  const assets = (Array.isArray(data?.assets) ? data.assets : []).filter(asset =>
    asset?.status === 'ASSET_STATUS_ACTIVE' &&
    asset.deployments?.some(deployment => Number(deployment.chainId) === CHAIN_ID)
  );
  assetCache = { assets, expires: Date.now() + ASSET_TTL };
  return assets;
}

async function getQuotes() {
  if (Date.now() < priceCache.expires) return priceCache.quotes;
  const data = await fetchJson('/prices');
  const quotes = Array.isArray(data?.quotes) ? data.quotes : [];
  priceCache = { quotes, expires: Date.now() + PRICE_TTL };
  return quotes;
}

function deployment(asset) {
  return asset?.deployments?.find(item => Number(item.chainId) === CHAIN_ID) || null;
}

function normalize(asset, quote) {
  const contract = deployment(asset)?.contractAddress;
  const bid = Number(quote?.bid);
  const ask = Number(quote?.ask);
  const multiplier = Number(asset?.currentMultiplier || 1);
  const rawPrice = Number.isFinite(bid) && bid > 0 && Number.isFinite(ask) && ask > 0
    ? (bid + ask) / 2
    : Number.isFinite(ask) && ask > 0 ? ask : bid;
  const priceUsd = rawPrice * (Number.isFinite(multiplier) && multiplier > 0 ? multiplier : 1);
  if (!contract || !Number.isFinite(priceUsd) || priceUsd <= 0) return null;
  return {
    chain: 'robinhood',
    address: contract,
    name: asset.tokenName || `${asset.tokenSymbol} · Robinhood Token`,
    symbol: asset.tokenSymbol || 'UNKNOWN',
    logoUrl: asset.logoUrl || null,
    priceUsd,
    marketCapUsd: null,
    liquidityUsd: null,
    volume24hUsd: Number.isFinite(Number(quote?.dailyTradingVolume)) ? Number(quote.dailyTradingVolume) * rawPrice : null,
    priceChange24h: null,
    bidUsd: Number.isFinite(bid) ? bid * multiplier : null,
    askUsd: Number.isFinite(ask) ? ask * multiplier : null,
    tradingHalted: Boolean(quote?.isTradingHalt),
    tradability: asset.tradingCapabilities || null,
    assetType: 'stock_token',
    source: 'robinhood',
    dex: 'Robinhood Stock Token API',
    priceAvailable: !quote?.isTradingHalt,
    quoteGeneratedAt: quote?.generatedAt || null,
    updatedAt: Date.now()
  };
}

async function searchTokens(query) {
  const clean = String(query || '').trim().toLowerCase();
  if (!clean) return [];
  const [assets, quotes] = await Promise.all([getAssets(), getQuotes()]);
  const quoteBySymbol = new Map(quotes.map(quote => [String(quote.tokenSymbol).toLowerCase(), quote]));
  return assets
    .filter(asset => String(asset.tokenSymbol).toLowerCase().includes(clean) || String(asset.tokenName).toLowerCase().includes(clean) || String(deployment(asset)?.contractAddress).toLowerCase() === clean)
    .map(asset => normalize(asset, quoteBySymbol.get(String(asset.tokenSymbol).toLowerCase())))
    .filter(Boolean)
    .slice(0, 20);
}

async function resolveToken(address) {
  const clean = String(address || '').trim().toLowerCase();
  const assets = await getAssets();
  const asset = assets.find(item => String(deployment(item)?.contractAddress).toLowerCase() === clean);
  if (!asset) return null;
  const data = await fetchJson(`/prices/${encodeURIComponent(asset.tokenSymbol)}`);
  const quote = (Array.isArray(data?.quotes) ? data.quotes : [])[0];
  return normalize(asset, quote);
}

async function getPrices(tokens) {
  const input = Array.isArray(tokens) ? tokens : [];
  const [assets, quotes] = await Promise.all([getAssets(), getQuotes()]);
  const assetByAddress = new Map(assets.map(asset => [String(deployment(asset)?.contractAddress).toLowerCase(), asset]));
  const quoteBySymbol = new Map(quotes.map(quote => [String(quote.tokenSymbol).toLowerCase(), quote]));
  return input.map(token => {
    const asset = assetByAddress.get(String(token?.address || '').toLowerCase());
    return asset ? normalize(asset, quoteBySymbol.get(String(asset.tokenSymbol).toLowerCase())) : null;
  });
}

module.exports = { searchTokens, resolveToken, getPrice: resolveToken, getPrices };
