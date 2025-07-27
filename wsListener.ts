
import WebSocket from 'ws';
import dotenv from 'dotenv';
dotenv.config();


// WebSocket sources from environment variables
const sources: Record<string, string | undefined> = {
  helius: process.env.HELIUS_WS_URL,
  eclipse: process.env.HELIUS_ECLIPSE_URL,
  unstaked: process.env.HELIUS_UNSTAKED_URL,
  dexscreener: process.env.DEXSCREENER_WS_URL,
  // Add any other sources from .env here
};

const selectedSource = process.env.WS_SOURCE || 'helius';
const wsUrl = sources[selectedSource] ?? undefined;

import axios from 'axios';

if (selectedSource === 'dexscreener') {
  // DexScreener uses HTTP API, not WebSocket
  async function fetchDexScreenerTokens() {
    try {
      let endpoint = '';

switch (actionType) {
  case 'boosts':
    endpoint = process.env.DEXSCREENER_API_ENDPOINT_BOOSTS || 'https://api.dexscreener.com/token-boosts/latest/v1';
    break;
  case 'profiles':
    endpoint = process.env.DEXSCREENER_API_ENDPOINT_PROFILES || 'https://api.dexscreener.com/token-profiles/latest/v1';
    break;
  case 'search':
    endpoint = process.env.DEXSCREENER_API_ENDPOINT_SEARCH || 'https://api.dexscreener.com/latest/dex/search';
    break;
  default:
    endpoint = process.env.DEXSCREENER_API_ENDPOINT || 'https://api.dexscreener.com/token-boosts/latest/v1';
}

// ثم تستخدم endpoint الذي تم اختياره
const response = await axios.get(endpoint);

      let tokens: any[] = [];
      let dataType = '';
      if (endpoint.includes('token-boosts')) {
        tokens = response.data?.pairs || response.data?.tokens || response.data || [];
        dataType = 'boosts';
      } else if (endpoint.includes('token-profiles')) {
        tokens = response.data?.profiles || response.data?.tokens || response.data || [];
        dataType = 'profiles';
      } else if (endpoint.includes('dex/search')) {
        tokens = response.data?.pairs || response.data?.tokens || response.data || [];
        dataType = 'search';
      } else {
        tokens = response.data?.pairs || response.data?.tokens || response.data || [];
        dataType = 'unknown';
      }
      console.log(`[DexScreener] Data type: ${dataType}, Tokens received:`, Array.isArray(tokens) ? tokens.length : typeof tokens);
      const strategy = getUserStrategy();
      const filtered = filterTokensByStrategy(tokens, strategy);
      if (filtered.length > 0) {
        console.log('Filtered tokens (strategy matched):', filtered);
        if (bot && telegramUserId) {
          filtered.forEach(token => {
            const msg = `🚀 New token matched your strategy (DexScreener):\n` +
              `<b>Address:</b> <code>${token.address || token.mint || 'N/A'}</code>\n` +
              `<b>MarketCap:</b> ${token.marketCap || 'N/A'}\n` +
              `<b>Volume:</b> ${token.volume || 'N/A'}\n` +
              `<b>Age:</b> ${token.age || 'N/A'} min\n`;
            bot.telegram.sendMessage(telegramUserId, msg, { parse_mode: 'HTML' });
          });
        }
      } else {
        console.log('No tokens matched strategy.');
      }
    } catch (err) {
      console.error('DexScreener API error:', err);
    }
  }
  // جلب البيانات كل دقيقة تلقائياً
  setInterval(fetchDexScreenerTokens, 60 * 1000);
  // جلب أولي عند التشغيل
  fetchDexScreenerTokens();
} else {
  if (!wsUrl) {
    console.error(`WebSocket URL for source '${selectedSource}' not found in .env`);
    process.exit(1);
  }
  const ws = new WebSocket(wsUrl);
  ws.on('open', () => {
    console.log(`WebSocket connection opened: [${selectedSource}]`, wsUrl);
    // You can send a subscription message here if required by the source documentation
  });
  ws.on('message', (data: WebSocket.Data) => {
    try {
      const json = JSON.parse(data.toString());
      // Assume incoming data is a single token or an array of tokens
      const tokens = Array.isArray(json) ? json : [json];
      const strategy = getUserStrategy();
      const filtered = filterTokensByStrategy(tokens, strategy);
      if (filtered.length > 0) {
        console.log('Filtered tokens (strategy matched):', filtered);
        // Send notification to Telegram bot if configured
        if (bot && telegramUserId) {
          filtered.forEach(token => {
            const msg = `🚀 New token matched your strategy:\n` +
              `<b>Address:</b> <code>${token.address || token.mint || 'N/A'}</code>\n` +
              `<b>MarketCap:</b> ${token.marketCap || 'N/A'}\n` +
              `<b>Volume:</b> ${token.volume || 'N/A'}\n` +
              `<b>Age:</b> ${token.age || 'N/A'} min\n`;
            bot.telegram.sendMessage(telegramUserId, msg, { parse_mode: 'HTML' });
          });
        }
        // You can trigger auto-buy logic here if needed
      } else {
        console.log('No tokens matched strategy.');
      }
    } catch (e) {
      console.log('Raw message:', data);
    }
  });
  ws.on('error', (err: Error) => {
    console.error('WebSocket error:', err);
  });
  ws.on('close', () => {
    console.log('WebSocket connection closed');
  });
}

import { filterTokensByStrategy } from './bot/strategy';
import { Strategy } from './bot/types';
import { Telegraf } from 'telegraf';

// Initialize Telegram bot
const telegramToken = process.env.TELEGRAM_BOT_TOKEN;
const telegramUserId = process.env.TELEGRAM_USER_ID; // Set this in .env to receive notifications
const bot = telegramToken ? new Telegraf(telegramToken) : undefined;

// Function to get strategy settings from environment variables
function getUserStrategy(): Strategy {
  return {
    minVolume: process.env.STRAT_MIN_VOLUME ? Number(process.env.STRAT_MIN_VOLUME) : undefined,
    minHolders: process.env.STRAT_MIN_HOLDERS ? Number(process.env.STRAT_MIN_HOLDERS) : undefined,
    minAge: process.env.STRAT_MIN_AGE ? Number(process.env.STRAT_MIN_AGE) : undefined,
    minMarketCap: process.env.STRAT_MIN_MARKETCAP ? Number(process.env.STRAT_MIN_MARKETCAP) : undefined,
    maxAge: process.env.STRAT_MAX_AGE ? Number(process.env.STRAT_MAX_AGE) : undefined,
    onlyVerified: process.env.STRAT_ONLY_VERIFIED === 'true',
    fastListing: process.env.STRAT_FAST_LISTING === 'true',
    enabled: true,
  };
}

// ...existing code...
