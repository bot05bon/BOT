// Improvements integration
import { monitorCopiedWallets } from './utils/portfolioCopyMonitor';

// Global Token Cache for Sniper Speed
let globalTokenCache: any[] = [];
let lastCacheUpdate = 0;
const CACHE_TTL = 60 * 1000; // 1 minute

// Unified token fetcher from multiple sources
async function fetchUnifiedTokenList() {
  let tokens: any[] = [];
  try {
    const birdeye = await fetchTrendingBirdeye();
    if (Array.isArray(birdeye)) tokens = tokens.concat(birdeye);
  } catch {}
  try {
    const pumpfun = await fetchTrendingPumpFun();
    if (Array.isArray(pumpfun)) tokens = tokens.concat(pumpfun);
  } catch {}
  // Remove duplicates by address
  const seen: Record<string, any> = {};
  tokens = tokens.filter((t) => {
    if (!t.address) return false;
    if (seen[t.address]) return false;
    seen[t.address] = true;
    return true;
  });
  // Enrich with Solscan and CoinGecko data
  for (const t of tokens) {
    try {
      const info = await fetchTokenInfo(t.address);
      if (info) {
        t.holders = info.holders ?? t.holders;
        if ('age' in info) t.age = info.age ?? t.age;
        t.symbol = info.symbol ?? t.symbol;
        if ('name' in info) t.name = info.name ?? t.name;
        t.price = info.price ?? t.price;
        t.marketCap = info.marketCap ?? t.marketCap;
        if ('verified' in info) t.verified = info.verified ?? false;
      }
    } catch {}
  }
  return tokens;
}

async function getCachedTokenList() {
  const now = Date.now();
  if (globalTokenCache.length === 0 || now - lastCacheUpdate > CACHE_TTL) {
    globalTokenCache = await fetchUnifiedTokenList();
    lastCacheUpdate = now;
  }
  return globalTokenCache;
}
// ========== Background Monitor for Profit/Stop Targets ========== //
import { fetchSolanaTokenList } from './utils/githubTokenList';
import { executeHoneyStrategy, getHoneySettings, addHoneyToken } from './userStrategy';
import { setInterval } from 'timers';
import fs from 'fs';
import { Markup, Telegraf } from 'telegraf';
import type { Strategy } from './bot/types';
import { getErrorMessage, limitHistory, hasWallet, walletKeyboard } from './bot/helpers';
import { filterTokensByStrategy } from './bot/strategy';


import dotenv from 'dotenv';
dotenv.config();

import { Keypair } from '@solana/web3.js';
import { parseSolanaPrivateKey, toBase64Key } from './keyFormat';
import { fetchTokenInfo, fetchTrendingBirdeye, fetchTrendingPumpFun } from './utils/tokenSources';
import { autoBuy } from './utils/autoBuy';
import { unifiedBuy, unifiedSell } from './tradeSources';
import { helpMessages } from './helpMessages';
// User type definition
interface User {
  wallet?: string;
  secret?: string;
  trades?: number;
  activeTrades?: number;
  history?: string[];
  referrer?: string;
  referrals?: string[];
  strategy?: {
    minVolume?: number;
    minHolders?: number;
    minAge?: number;
    enabled?: boolean;
    onlyVerified?: boolean;
    buyAmount?: number;
    profitTargets?: number[];
    sellPercents?: number[];
    stopLossPercent?: number;
    minMarketCap?: number;
    maxAge?: number;
    fastListing?: boolean;
  };
  lastTokenList?: any[];
  honeyTemp?: any;
  _pendingSellAll?: any[];
  copiedWallets?: string[];
  lastMessageAt?: number;
}

// Telegram bot
export const bot = new Telegraf(process.env.TELEGRAM_BOT_TOKEN!);
console.log('🚀 Telegram bot script loaded.');

// Telegram bot core variables
let users: Record<string, User> = loadUsers();
let awaitingUsers: Record<string, any> = {};

function getUserInviteLink(userId: string, ctx?: any): string {
  // Use env BOT_USERNAME or fallback to ctx.botInfo.username
  const botUsername = process.env.BOT_USERNAME || ctx?.botInfo?.username || 'YourBotUsername';
  return `https://t.me/${botUsername}?start=${userId}`;
}

// Log every incoming update for tracing
bot.use((ctx, next) => {
  let text = undefined;
  let data = undefined;
  if ('message' in ctx && ctx.message && typeof ctx.message === 'object' && 'text' in ctx.message) {
    text = (ctx.message as any).text;
  }
  if ('callbackQuery' in ctx && ctx.callbackQuery && typeof ctx.callbackQuery === 'object' && 'data' in ctx.callbackQuery) {
    data = (ctx.callbackQuery as any).data;
  }
  console.log('📥 Incoming update:', {
    type: ctx.updateType,
    from: ctx.from?.id,
    text,
    data
  });
  return next();
});

// Welcome sticker
const WELCOME_STICKER = 'CAACAgUAAxkBAAEBQY1kZ...'; // Welcome sticker ID

// Users file
const USERS_FILE = 'users.json';

// Track tokens bought automatically per user to avoid duplicates
let boughtTokens: Record<string, Set<string>> = {};

// === Auto Strategy Monitor ===
async function autoStrategyMonitor() {
  for (const userId in users) {
    const user = users[userId];
    if (!user?.strategy || !user.strategy.enabled || !user.secret) continue;
    let tokens: any[] = [];
    try {
      tokens = await getCachedTokenList();
    } catch {}
    if (!tokens || tokens.length === 0) continue;
    const strat = user.strategy;
    const filtered = filterTokensByStrategy(tokens, strat);
    boughtTokens[userId] = boughtTokens[userId] || new Set();
    for (const t of filtered) {
      if (!t.address) continue;
      if (boughtTokens[userId].has(t.address)) continue;
      // Prepare buyAmount, profitTargets, sellPercents, stopLossPercent from user settings
      const buyAmount = user.strategy.buyAmount ?? 0.01;
      const profitTargets = user.strategy.profitTargets ?? [20, 50];
      const sellPercents = user.strategy.sellPercents ?? [50, 50];
      const stopLossPercent = user.strategy.stopLossPercent ?? 15;
      try {
        const { tx, source } = await unifiedBuy(t.address, buyAmount, user.secret);
        boughtTokens[userId].add(t.address);
        user.history = user.history || [];
        user.history.push(`AutoBuy: ${t.address} | Amount: ${buyAmount} SOL | Source: ${source} | Tx: ${tx}`);
        saveUsers();
        await bot.telegram.sendMessage(userId,
          `🤖 <b>Auto-buy executed by strategy!</b>\n\n` +
          `<b>Token:</b> <code>${t.address}</code>\n` +
          `<b>Amount:</b> ${buyAmount} SOL\n` +
          `<b>Profit Targets:</b> ${profitTargets.join(', ')}%\n` +
          `<b>Sell Percents:</b> ${sellPercents.join(', ')}%\n` +
          `<b>Stop Loss:</b> ${stopLossPercent}%\n` +
          `<b>Source:</b> ${source}\n` +
          `<b>Transaction:</b> <a href='https://solscan.io/tx/${tx}'>${tx}</a>`,
          { parse_mode: 'HTML' }
        );
      } catch (e: any) {
        // Optionally notify user of error
        // await bot.telegram.sendMessage(userId, `❌ Auto-buy failed: ${e?.message || e}`);
      }
    }
  }
}

// Run auto strategy monitor every 5 seconds (for faster response in testing)
setInterval(autoStrategyMonitor, 5000);

// Restore Wallet button handler
bot.action('restore_wallet', async (ctx) => {
  const userId = String(ctx.from?.id);
  awaitingUsers[userId] = 'await_restore_secret';
  await ctx.reply(
    '🔑 To restore your wallet, please send your Solana private key in one of the following formats:\n\n1. Base58 (most common, 44-88 characters, letters & numbers)\n2. Base64 (88 characters)\n3. JSON Array (64 numbers)\n\nExample (Base58):\n4f3k2...\nExample (Base64):\nM3J5dG...Z2F0ZQ==\nExample (JSON Array):\n[12,34,...]\n\n⚠️ Never share your private key with anyone!\nYou can press Cancel to exit.',
    {...Markup.inlineKeyboard([[Markup.button.callback('❌ Cancel', 'cancel_restore_wallet')]])}
  );
});

// Create Wallet button handler
bot.action('create_wallet', async (ctx) => {
  const userId = String(ctx.from?.id);
  // Generate new wallet
  const keypair = Keypair.generate();
  users[userId] = users[userId] || { trades: 0, activeTrades: 1, history: [] };
  users[userId].wallet = keypair.publicKey.toBase58();
  users[userId].secret = Buffer.from(keypair.secretKey).toString('base64');
  users[userId].history = users[userId].history || [];
  users[userId].history.push('Created new wallet');
  saveUsers();
  await ctx.reply('✅ New wallet created! Your address: ' + users[userId].wallet);
  await sendMainMenu(ctx);
});

// Export Private Key button handler
bot.action('exportkey', async (ctx) => {
  const userId = String(ctx.from?.id);
  const user = users[userId];
  if (!user || !user.secret) {
    return await ctx.reply(helpMessages.wallet_needed, walletKeyboard());
  }
  await ctx.reply('⚠️ Your private key (base64):\n' + user.secret, { parse_mode: 'Markdown' });
});

// Back to main menu button handler
bot.action('back_to_menu', async (ctx) => {
  await sendMainMenu(ctx);
});

// Send main menu
async function sendMainMenu(ctx: any) {
  await ctx.reply(
    helpMessages.main_menu,
    {
      parse_mode: 'HTML',
      ...Markup.inlineKeyboard([
        [Markup.button.callback('🟢 Buy', 'buy'), Markup.button.callback('🔴 Sell', 'sell')],
        [Markup.button.callback('⚙️ Strategy', 'set_strategy'), Markup.button.callback('🍯 Honey Points', 'honey_points')],
        [Markup.button.callback('📊 Activity', 'show_activity'), Markup.button.callback('👛 Wallet', 'my_wallet')],
        [Markup.button.callback('💰 Sell All', 'sell_all_wallet'), Markup.button.callback('📋 Copy Trade', 'copy_trade')],
        [Markup.button.callback('🔗 Invite Friends', 'invite_friends')]
      ])
    }
  );
}

// ====== User, wallet, and menu helper functions ======
function loadUsers(): Record<string, User> {
  try {
    if (fs.existsSync(USERS_FILE)) {
      const raw = fs.readFileSync(USERS_FILE, 'utf8');
      return JSON.parse(raw);
    }
  } catch {}
  return {};
}

function saveUsers() {
  try {
    fs.writeFileSync(USERS_FILE, JSON.stringify(users, null, 2));
  } catch {}
}

bot.action('buy', async (ctx) => {
  const userId = String(ctx.from?.id);
  await ctx.reply(helpMessages.buy);
  if (!hasWallet(users[userId])) {
    return await ctx.reply(helpMessages.wallet_needed, walletKeyboard());
  }
  awaitingUsers[userId + '_buy'] = true;
  await ctx.reply('🔍 Please send the token mint address to buy (44-88 alphanumeric characters):');
});

bot.action('sell', async (ctx) => {
  const userId = String(ctx.from?.id);
  await ctx.reply(helpMessages.sell);
  if (!hasWallet(users[userId])) {
    return await ctx.reply(helpMessages.wallet_needed, walletKeyboard());
  }
  awaitingUsers[userId + '_sell'] = true;
  await ctx.reply('💰 Please send the token mint address to sell (44-88 alphanumeric characters):');
});

bot.action('set_strategy', async (ctx) => {
  const userId = String(ctx.from?.id);
  await ctx.reply(helpMessages.strategy);
  awaitingUsers[userId] = 'await_strategy_all';
  await ctx.reply(
    '⚙️ <b>Enter your strategy as: volume,holders,age,marketCap,maxAge,verified,fast</b>\n' +
    'Example: <code>1000,50,10,50000,60,true,true</code>\n' +
    '• volume: Minimum trading volume in USD (positive number)\n' +
    '• holders: Minimum number of holders (positive integer)\n' +
    '• age: Minimum age in minutes (positive integer)\n' +
    '• marketCap: Minimum market cap (positive number)\n' +
    '• maxAge: Maximum age in minutes (positive integer)\n' +
    '• verified: Only verified tokens (true/false)\n' +
    '• fast: Only fast listings (true/false)\n' +
    'You can disable the strategy with /strategy_off or enable it with /strategy_on',
    { parse_mode: 'HTML' }
  );
});

bot.action('honey_points', async (ctx) => {
  const userId = String(ctx.from?.id);
  await ctx.reply(helpMessages.honey_points);
  awaitingUsers[userId] = 'await_honey_address';
  await ctx.reply(
    '🍯 <b>Honey Points Setup</b>\n\nStep 1/4: Enter token address (44-88 alphanumeric characters):\n💡 <i>The address is the token address on Solana network.</i>',
    { parse_mode: 'HTML', ...Markup.inlineKeyboard([
      [Markup.button.callback('Cancel', 'cancel_input')],
      [Markup.button.callback('Back', 'back_honey')]
    ]) }
  );
});

bot.action('show_activity', async (ctx) => {
  const userId = String(ctx.from?.id);
  await ctx.reply(helpMessages.activity);
  if (!hasWallet(users[userId])) {
    return await ctx.reply(helpMessages.wallet_needed, walletKeyboard());
  }
  const history = users[userId]?.history || [];
  const text = history.length ? history.map((h) => `• ${h}`).join('\n') : 'No activity yet.';
  await ctx.reply(`📊 *Your Activity:*\n${text}`,
    {
      parse_mode: 'Markdown',
      ...Markup.inlineKeyboard([[Markup.button.callback('⬅️ Back', 'back_to_menu')]])
    });
});

bot.action('my_wallet', async (ctx) => {
  const userId = String(ctx.from?.id);
  await ctx.reply(helpMessages.wallet);
  const user = users[userId];
  if (!user?.wallet) {
    return ctx.reply(helpMessages.no_wallet);
  }
  let msg = `<b>👛 Your Wallet Address:</b>\n<code>${user.wallet}</code>`;
  await ctx.reply(msg, {
    parse_mode: 'HTML',
    ...Markup.inlineKeyboard([
      [Markup.button.callback('🔑 Export Private Key', 'exportkey'), Markup.button.callback('🔄 Main Menu', 'back_to_menu')]
    ])
  });
});

bot.action('sell_all_wallet', async (ctx) => {
  const userId = String(ctx.from?.id);
  await ctx.reply(helpMessages.sell_all);
  const user = users[userId];
  if (!hasWallet(user)) {
    return ctx.reply(helpMessages.wallet_needed, walletKeyboard());
  }
  // Fetch tokens from wallet via Birdeye or Solscan
  try {
    const res = await fetch(`https://public-api.birdeye.so/public/wallet/token_list?address=${user.wallet}`);
    const data = await res.json();
    const tokens = Array.isArray(data?.data)
      ? (data.data as Array<{token_address: string; token_symbol?: string; token_amount: number}>)
          .filter((t) => t.token_amount > 0.00001)
      : [];
    if (!tokens.length) {
      return ctx.reply('No tokens found in your wallet.');
    }
    let msg = '<b>Your wallet tokens:</b>\n';
    msg += tokens.map((t: {token_symbol?: string; token_address: string; token_amount: number}, i: number) =>
      `\n${i+1}. <b>${t.token_symbol || '-'}:</b> <code>${t.token_address}</code> | Amount: <b>${t.token_amount}</b>`
    ).join('\n');
    msg += '\n\n⚠️ <b>Are you sure you want to sell ALL tokens for SOL?</b>';
    await ctx.reply(msg, {
      parse_mode: 'HTML',
      ...Markup.inlineKeyboard([
        [Markup.button.callback('✅ Confirm Sell All', 'confirm_sell_all_wallet'), Markup.button.callback('❌ Cancel', 'back_to_menu')]
      ])
    });
    user._pendingSellAll = tokens;
  } catch {
    await ctx.reply('Failed to fetch wallet tokens.');
  }
});

// Execute mass sell after confirmation
bot.action('confirm_sell_all_wallet', async (ctx) => {
  const userId = String(ctx.from?.id);
  const user = users[userId];
  if (!hasWallet(user) || !Array.isArray(user._pendingSellAll)) {
    return ctx.reply('No tokens to sell.');
  }
  await ctx.reply('⏳ Selling all tokens in your wallet...');
  let results: string[] = [];
  for (const t of user._pendingSellAll) {
    try {
      const secret = typeof user.secret === 'string' ? user.secret : '';
      const { tx, source } = await unifiedSell(t.token_address, t.token_amount, secret);
      results.push(`✅ <b>${t.token_symbol || '-'}:</b> Sold <b>${t.token_amount}</b> | Source: ${source} | <a href="https://solscan.io/tx/${tx}">View Transaction</a>`);
    } catch (e: any) {
      results.push(`❌ <b>${t.token_symbol || '-'}:</b> Failed to sell | ${e?.message || 'Error'}`);
    }
  }
  delete user._pendingSellAll;
  await ctx.reply('<b>Sell All Results:</b>\n' + results.join('\n'), { parse_mode: 'HTML' });
});


// Invite Friends button (English)
bot.action('invite_friends', async (ctx) => {
  const userId = String(ctx.from?.id);
  const inviteLink = getUserInviteLink(userId, ctx);
  let msg = 'Invite friends and earn rewards every time they trade using the bot.' + `\n\n<b>Your Invite Link:</b> <a href='${inviteLink}'>${inviteLink}</a>`;
  await ctx.reply(msg, {
    parse_mode: 'HTML',
    ...Markup.inlineKeyboard([
      [
        Markup.button.url('🔗 Open Invite Link', inviteLink),
        Markup.button.callback('🔄 Main Menu', 'back_to_menu')
      ],
      [
        Markup.button.switchToChat('📤 Share Invite Link', inviteLink)
      ]
    ])
  });
});

// ========== Main Commands ========== //
bot.start(async (ctx) => {
  const userId = String(ctx.from?.id);
  users[userId] = users[userId] || { trades: 0, activeTrades: 1, history: [] };
  await ctx.reply(
    'Welcome to the Solana Trading Bot! 🤖\n\n' +
    'This bot allows you to trade Solana tokens, manage your wallet, and set up automated trading strategies.\n\n' +
    'Please choose an option below to get started:',
    {
      parse_mode: 'HTML',
      ...Markup.inlineKeyboard([
        [Markup.button.callback('🆕 Create Wallet', 'create_wallet'), Markup.button.callback('🔑 Restore Wallet', 'restore_wallet')],
        [Markup.button.callback('📊 View Wallet Balance', 'view_balance'), Markup.button.callback('📈 View Profit Chart', 'view_profit')],
        [Markup.button.callback('⚙️ Set Price Alert', 'set_price_alert'), Markup.button.callback('📋 View Activity Log', 'view_activity')],
        [Markup.button.callback('💰 Quick Buy', 'quick_buy'), Markup.button.callback('🔄 Quick Sell', 'quick_sell')],
        [Markup.button.callback('📈 Strategy Monitor', 'strategy_monitor'), Markup.button.callback('📊 Token Sniffer', 'token_sniffer')],
        [Markup.button.callback('📤 Invite Friends', 'invite_friends')]
      ])
    }
  );
  console.log(`✅ /start command received from ${userId}`);
});

// ========== User Registration and Wallet Setup ==========
bot.on('text', async (ctx) => {
  const userId = String(ctx.from?.id);
  const text = ctx.message.text.trim();
  const user = users[userId] = users[userId] || { trades: 0, activeTrades: 1, history: [] };
  user.lastMessageAt = Date.now();
  limitHistory(user);
  // Trace text message received
  console.log(`📝 Received text from ${userId}: ${text}`);

  // Restore wallet secret
  if (awaitingUsers[userId] === 'await_restore_secret') {
    try {
      // Determine format: Base58, Base64, or JSON Array
      let secretKey: number[] | null = null;
      if (text.length >= 44 && text.length <= 88) {
        // Base58 or Base64
        const decoded = Buffer.from(text, text.includes('=') ? 'base64' : 'utf8');
        if (decoded.length === 32) {
          // Valid Base58 (Solana secret key is 32 bytes)
          secretKey = Array.from(decoded);
        }
      } else if (text.startsWith('[') && text.endsWith(']')) {
        // JSON Array
        secretKey = JSON.parse(text);
      }
      if (secretKey) {
        // Import wallet
        const keypair = Keypair.fromSecretKey(Uint8Array.from(secretKey));
        users[userId].wallet = keypair.publicKey.toBase58();
        users[userId].secret = Buffer.from(keypair.secretKey).toString('base64');
        users[userId].history = users[userId].history || [];
        users[userId].history.push('Restored wallet');
        saveUsers();
        await ctx.reply('✅ Wallet restored! Your address: ' + users[userId].wallet);
        await sendMainMenu(ctx);
      } else {
        await ctx.reply('Invalid secret key format. Please send your private key in Base58, Base64, or JSON Array format.');
      }
    } catch (e) {
      console.error('❌ Error restoring wallet:', e);
      await ctx.reply('Error restoring wallet: ' + getErrorMessage(e));
    }
    return;
  }

  // Advanced strategy input
  if (awaitingUsers[userId] === 'await_strategy_all') {
    const parts = text.split(',').map(s => s.trim());
    if (parts.length < 7) {
      await ctx.reply('❌ Invalid strategy input. Please enter 7 values separated by commas as shown in the example.');
      return;
    }
    user.strategy = {
      minVolume: parseFloat(parts[0]) || undefined,
      minHolders: parseFloat(parts[1]) || undefined,
      minAge: parseInt(parts[2]) || undefined,
      minMarketCap: parseFloat(parts[3]) || undefined,
      maxAge: parseInt(parts[4]) || undefined,
      onlyVerified: parts[5] === 'true',
      fastListing: parts[6] === 'true',
      enabled: true
    } as Strategy;
    if (!user.history) user.history = [];
    user.history.push(`Saved strategy: ${JSON.stringify(user.strategy)}`);
    saveUsers();
    delete awaitingUsers[userId];
    await ctx.reply('✅ Advanced strategy saved!');
    await ctx.reply('Fetching tokens matching your strategy ...');
    try {
      let tokens = await getCachedTokenList();
      if (!tokens || tokens.length === 0) {
        await ctx.reply('No tokens found from the available sources. Try again later.');
        return;
      }
      const filtered = filterTokensByStrategy(tokens, user.strategy);
      const sorted = filtered
        .filter((t: any) => typeof t.volume === 'number')
        .sort((a: any, b: any) => b.volume - a.volume)
        .slice(0, 10);
      user.lastTokenList = sorted;
      user.history = user.history || [];
      user.history.push('Viewed tokens matching strategy');
      saveUsers();
      let msg = '<b>Top Solana tokens matching your strategy:</b>\n';
      if (sorted.length === 0) {
        msg += '\n❌ No tokens match your strategy at the moment.';
      } else {
        msg += sorted.map((t: any, i: number) => {
          let symbol = t.symbol || '-';
          let name = t.name || '-';
          let solscanLink = `https://solscan.io/token/${t.address}`;
          let volume = t.volume ? t.volume.toLocaleString() : '-';
          let maxVol = sorted[0]?.volume || 1;
          let barLen = Math.round((t.volume / maxVol) * 20);
          let bar = '▮'.repeat(barLen) + '▯'.repeat(20 - barLen);
          return `\n${i+1}. <b>${symbol}:</b> <code>${t.address}</code>\n` +
            `Name: ${name}\n` +
            `Volume: ${volume} <code>${bar}</code>\n` +
            `<a href='${solscanLink}'>View on Solscan</a>\n` +
            `<b>Add to Honey Points:</b> /add_honey_${i}`;
        }).join('\n');
      }
      await ctx.reply(msg, {
        parse_mode: 'HTML',
        ...Markup.inlineKeyboard([[Markup.button.callback('Refresh', 'refresh_tokens')]])
      });
    } catch (e) {
      console.error('❌ Error fetching tokens for strategy:', e);
      await ctx.reply('Error fetching tokens: ' + getErrorMessage(e));
    }
    return;
  }

  // Buy handler (awaiting token address)
  if (awaitingUsers[userId + '_buy']) {
    awaitingUsers[userId + '_buy'] = true;
    const tokenAddress = text;
    const user = users[userId];
    if (!user.secret) {
      return ctx.reply('Please restore or create a wallet first.', walletKeyboard());
    }
    // Simple validation: check if address is 44-88 characters and contains letters/numbers
    const addressPattern = /^[A-Za-z0-9]{44,88}$/;
    if (!addressPattern.test(tokenAddress)) {
      return ctx.reply('Invalid token address. Please send a valid token mint address.');
    }
    // Check if it's a known token (optional)
    const knownTokens = ['So11111111111111111111111111111111111111112', 'TokenkegQy1ZRySxg6g6g6g6g6g6g6g6g6'];
    if (!knownTokens.includes(tokenAddress)) {
      return ctx.reply('Warning: This token is not in the list of known tokens. Proceed with caution.');
    }
    // Proceed with buy logic...
    try {
      const amount = 0.01; // Fixed amount for testing
      const { tx, source } = await unifiedBuy(tokenAddress, amount, user.secret);
      user.history = user.history || [];
      user.history.push(`Bought ${amount} SOL of token ${tokenAddress} | Tx: ${tx}`);
      saveUsers();
      await ctx.reply(`✅ Successfully bought ${amount} SOL of the token!\n\nTransaction: [View on Solscan](https://solscan.io/tx/${tx})`, { parse_mode: 'Markdown' });
    } catch (e) {
      console.error('❌ Error executing buy order:', e);
      await ctx.reply('Error executing buy order: ' + getErrorMessage(e));
    }
    delete awaitingUsers[userId + '_buy'];
    return;
  }

  // Sell handler (awaiting token address)
  if (awaitingUsers[userId + '_sell']) {
    awaitingUsers[userId + '_sell'] = true;
    const tokenAddress = text;
    const user = users[userId];
    if (!user.secret) {
      return ctx.reply('Please restore or create a wallet first.', walletKeyboard());
    }
    // Simple validation: check if address is 44-88 characters and contains letters/numbers
    const addressPattern = /^[A-Za-z0-9]{44,88}$/;
    if (!addressPattern.test(tokenAddress)) {
      return ctx.reply('Invalid token address. Please send a valid token mint address.');
    }
    // Check if it's a known token (optional)
    const knownTokens = ['So11111111111111111111111111111111111111112', 'TokenkegQy1ZRySxg6g6g6g6g6g6g6g6g6'];
    if (!knownTokens.includes(tokenAddress)) {
      return ctx.reply('Warning: This token is not in the list of known tokens. Proceed with caution.');
    }
    // Proceed with sell logic...
    try {
      const amount = 0.01; // Fixed amount for testing
      const { tx, source } = await unifiedSell(tokenAddress, amount, user.secret);
      user.history = user.history || [];
      user.history.push(`Sold ${amount} SOL of token ${tokenAddress} | Tx: ${tx}`);
      saveUsers();
      await ctx.reply(`✅ Successfully sold ${amount} SOL of the token!\n\nTransaction: [View on Solscan](https://solscan.io/tx/${tx})`, { parse_mode: 'Markdown' });
    } catch (e) {
      console.error('❌ Error executing sell order:', e);
      await ctx.reply('Error executing sell order: ' + getErrorMessage(e));
    }
    delete awaitingUsers[userId + '_sell'];
    return;
  }

  // Honey Points address input
  if (awaitingUsers[userId] === 'await_honey_address') {
    const tokenAddress = text.trim();
    const user = users[userId];
    if (!user.secret) {
      return ctx.reply('Please restore or create a wallet first.', walletKeyboard());
    }
    // Simple validation: check if address is 44-88 characters and contains letters/numbers
    const addressPattern = /^[A-Za-z0-9]{44,88}$/;
    if (!addressPattern.test(tokenAddress)) {
      return ctx.reply('Invalid token address. Please send a valid token mint address.');
    }
    // Check if it's a known token (optional)
    const knownTokens = ['So11111111111111111111111111111111111111112', 'TokenkegQy1ZRySxg6g6g6g6g6g6g6g6g6'];
    if (!knownTokens.includes(tokenAddress)) {
      return ctx.reply('Warning: This token is not in the list of known tokens. Proceed with caution.');
    }
    // Proceed with honey points logic...
    try {
      const userId = ctx.from.id;
      const tokenAddress = text.trim();
      const user = users[userId];
      if (!user.secret) {
        return ctx.reply('Please restore or create a wallet first.', walletKeyboard());
      }
      // Add token to Honey Points
      addHoneyToken(String(userId), {
        address: tokenAddress,
        buyAmount: 0.01,
        profitPercents: [20, 50],
        soldPercents: [50, 50]
      }, users);
      await ctx.reply('✅ Token added to Honey Points!');
    } catch (e) {
      console.error('❌ Error processing Honey Points:', e);
      await ctx.reply('Error processing Honey Points: ' + getErrorMessage(e));
    }
    delete awaitingUsers[userId];
    return;
  }
  await ctx.reply('Unrecognized input. Please use the buttons or commands to interact with the bot.');
  console.log('⚠️ Unrecognized input from', userId, ':', text);
});

// Launch the bot and log startup
bot.launch().then(() => {
  console.log('✅ Telegram bot launched and listening for updates.');
}).catch((err) => {
  console.error('❌ Failed to launch Telegram bot:', err);
});
