// ===== Improvements integration =====
import {
  loadingMessage,
  showWalletBalance,
  confirmExportKey,
  setPriceAlert,
  showProfitChart,
  secretKeyWarning,
  onboardingTips,
  detailedHelp
} from './improvements';

// Onboarding tips for new users (call after wallet creation or restore)
// Example usage: onboardingTips(ctx);

// Show wallet balance (call from wallet view)
// Example usage: showWalletBalance(ctx, users[userId]);

// Confirm export private key (call before showing secret)
// Example usage: confirmExportKey(ctx, users[userId]);

// Price alert setup (call from strategy or token view)
// Example usage: setPriceAlert(ctx, users[userId]);

// Profit/loss summary (call from activity or wallet view)
// Example usage: showProfitChart(ctx, users[userId]);

// Private key warning (call before export or restore)
// Example usage: secretKeyWarning(ctx);

// Detailed help (call from /help command)
// Example usage: detailedHelp(ctx);
// ====== Copy Trading Monitoring (imported) ======
import { monitorCopiedWallets } from './utils/portfolioCopyMonitor';
// ====== Global Token Cache for Sniper Speed ======
let globalTokenCache: any[] = [];
let lastCacheUpdate = 0;
const CACHE_TTL = 60 * 1000; // 1 minute

async function getCachedTokenList() {
  const now = Date.now();
  if (globalTokenCache.length === 0 || now - lastCacheUpdate > CACHE_TTL) {
    globalTokenCache = await fetchSolanaTokenList();
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
  };
  lastTokenList?: any[];
  honeyTemp?: any;
  _pendingSellAll?: any[];
  copiedWallets?: string[];
  lastMessageAt?: number;
}

// Helper: getErrorMessage
function getErrorMessage(e: any): string {
  return e?.message || String(e);
}

// Helper: limitHistory
function limitHistory(user: User) {
  if (user.history && user.history.length > 100) {
    user.history = user.history.slice(-100);
  }
}

// Helper: sendFeeAndReferral (stub)
async function sendFeeAndReferral(amount: number, userId: string, type: string) {
  // Implement fee/referral logic here if needed
}
// Telegram bot
export const bot = new Telegraf(process.env.TELEGRAM_BOT_TOKEN!);

// Telegram bot core variables
let users: Record<string, User> = loadUsers();
let awaitingUsers: Record<string, any> = {};

function getUserInviteLink(userId: string, ctx?: any): string {
  // Use env BOT_USERNAME or fallback to ctx.botInfo.username
  const botUsername = process.env.BOT_USERNAME || ctx?.botInfo?.username || 'YourBotUsername';
  return `https://t.me/${botUsername}?start=${userId}`;
}

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
    // Get tokens list
    let tokens: any[] = [];
    try {
      tokens = await getCachedTokenList();
    } catch {}
    if (!tokens || tokens.length === 0) continue;
    // Apply strategy filter
    let filtered = tokens;
    const strat = user.strategy;
    if (strat) {
      filtered = tokens.filter((t: any) => {
        let ok = true;
        if (typeof strat.minVolume === 'number') {
          if (typeof t.volume === 'number') ok = ok && t.volume >= strat.minVolume;
        }
        if (typeof strat.minHolders === 'number') {
          if (typeof t.holders === 'number') ok = ok && t.holders >= strat.minHolders;
        }
        if (typeof strat.minAge === 'number') {
          if (typeof t.age === 'number') ok = ok && t.age >= strat.minAge;
        }
        return ok;
      });
    }
    // Prevent duplicate buys
    boughtTokens[userId] = boughtTokens[userId] || new Set();
    for (const t of filtered) {
      if (!t.address) continue;
      if (boughtTokens[userId].has(t.address)) continue;
      // Execute buy
      try {
        const amount = 0.01; // Default buy amount (can be made user-configurable)
        const { tx, source } = await unifiedBuy(t.address, amount, user.secret);
        boughtTokens[userId].add(t.address);
        user.history = user.history || [];
        user.history.push(`AutoBuy: ${t.address} | Amount: ${amount} SOL | Source: ${source} | Tx: ${tx}`);
        saveUsers();
        await bot.telegram.sendMessage(userId,
          `🤖 <b>Auto-buy executed by strategy!</b>\n\n` +
          `<b>Token:</b> <code>${t.address}</code>\n` +
          `<b>Amount:</b> ${amount} SOL\n` +
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

function hasWallet(user?: User): boolean {
  return !!(user && user.wallet && user.secret);
}

function walletKeyboard() {
  return Markup.inlineKeyboard([
    [Markup.button.callback('🔑 Restore Wallet', 'restore_wallet'), Markup.button.callback('🆕 Create Wallet', 'create_wallet')]
  ]);
}

bot.action('buy', async (ctx) => {
  const userId = String(ctx.from?.id);
  await ctx.reply(helpMessages.buy);
  if (!hasWallet(users[userId])) {
    return await ctx.reply(helpMessages.wallet_needed, walletKeyboard());
  }
  awaitingUsers[userId + '_buy'] = true;
  await ctx.reply('🔍 Please send the token mint address to buy:');
});

bot.action('sell', async (ctx) => {
  const userId = String(ctx.from?.id);
  await ctx.reply(helpMessages.sell);
  if (!hasWallet(users[userId])) {
    return await ctx.reply(helpMessages.wallet_needed, walletKeyboard());
  }
  awaitingUsers[userId + '_sell'] = true;
  await ctx.reply('💰 Please send the token mint address to sell:');
});

bot.action('set_strategy', async (ctx) => {
  const userId = String(ctx.from?.id);
  await ctx.reply(helpMessages.strategy);
  awaitingUsers[userId] = 'await_strategy_all';
  await ctx.reply(
    '⚙️ <b>Enter your strategy as: volume,holders,age</b>\nExample: <code>1000,50,10</code>\n' +
    '• volume: Minimum trading volume in USD\n' +
    '• holders: Minimum number of holders\n' +
    '• age: Minimum age in minutes\n' +
    'You can disable the strategy with /strategy_off or enable it with /strategy_on',
    { parse_mode: 'HTML' }
  );
});

bot.action('honey_points', async (ctx) => {
  const userId = String(ctx.from?.id);
  await ctx.reply(helpMessages.honey_points);
  awaitingUsers[userId] = 'await_honey_address';
  await ctx.reply(
    '🍯 <b>Honey Points Setup</b>\n\nStep 1/4: Enter token address:\n💡 <i>The address is the token address on Solana network.</i>',
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
      [Markup.button.callback('🔑 Export Private Key', 'exportkey')],
      [Markup.button.callback('🔄 Main Menu', 'back_to_menu')]
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
        [Markup.button.callback('✅ Confirm Sell All', 'confirm_sell_all_wallet')],
        [Markup.button.callback('❌ Cancel', 'back_to_menu')]
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


// (Removed duplicate honey_points handler)

// Invite Friends button (English)
bot.action('invite_friends', async (ctx) => {
  const userId = String(ctx.from?.id);
  // Use env BOT_USERNAME or fallback to ctx.botInfo.username
  const botUsername = process.env.BOT_USERNAME || ctx.botInfo?.username || 'YourBotUsername';
  const inviteLink = `https://t.me/${botUsername}?start=${userId}`;
  let msg = helpMessages.invite_friends + `\n\n<b>Your Invite Link:</b> <a href='${inviteLink}'>${inviteLink}</a>`;
  await ctx.reply(msg, {
    parse_mode: 'HTML',
    ...Markup.inlineKeyboard([
      [Markup.button.url('🔗 Open Invite Link', inviteLink), Markup.button.callback('🔄 Main Menu', 'back_to_menu')]
    ])
  });
});

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

// ========== User Registration and Wallet Setup ========== //

// ...existing code...

bot.action('buy', async (ctx) => {
  const userId = String(ctx.from?.id);
  await ctx.reply(helpMessages.buy);
  if (!hasWallet(users[userId])) {
    return await ctx.reply(helpMessages.wallet_needed, walletKeyboard());
  }
  awaitingUsers[userId + '_buy'] = true;
  await ctx.reply('🔍 Send the token mint address to buy:');
});

bot.action('sell', async (ctx) => {
  const userId = String(ctx.from?.id);
  await ctx.reply(helpMessages.sell);
  if (!hasWallet(users[userId])) {
    return await ctx.reply(helpMessages.wallet_needed, walletKeyboard());
  }
  awaitingUsers[userId + '_sell'] = true;
  await ctx.reply('💰 Send the token mint address to sell:');
});

bot.action('set_strategy', async (ctx) => {
  const userId = String(ctx.from?.id);
  await ctx.reply(helpMessages.strategy);
  awaitingUsers[userId] = 'await_strategy_all';
  await ctx.reply(
    '⚙️ <b>Enter your strategy as: volume,holders,age</b>\nExample: <code>1000,50,10</code>\n' +
    '• volume: Minimum trading volume in USD\n' +
    '• holders: Minimum number of holders\n' +
    '• age: Minimum age in minutes\n' +
    'You can disable the strategy with /strategy_off or enable it with /strategy_on',
    { parse_mode: 'HTML' }
  );
});

bot.action('honey_points', async (ctx) => {
  const userId = String(ctx.from?.id);
  await ctx.reply(helpMessages.honey_points);
  awaitingUsers[userId] = 'await_honey_address';
  await ctx.reply(
    '🍯 <b>Honey Points Setup</b>\n\nStep 1/4: Enter token address:\n💡 <i>The address is the token address on Solana network.</i>',
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


// (Removed duplicate honey_points handler)

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
  // Referral registration
  const args = ctx.startPayload;
  if (args && args !== userId && !users[userId]?.referrer) {
    users[userId].referrer = args;
    users[args] = users[args] || { trades: 0, activeTrades: 1, history: [] };
    users[args].referrals = users[args].referrals || [];
    if (!users[args].referrals.includes(userId)) users[args].referrals.push(userId);
    saveUsers();
    await ctx.reply('🎉 You joined via referral! Your inviter will earn rewards from your trades.');
  }
  if (!hasWallet(users[userId])) {
    awaitingUsers[userId] = 'choose_wallet_action';
    await ctx.reply(helpMessages.wallet_needed, walletKeyboard());
    return;
  }
  await sendMainMenu(ctx);
});

bot.command('menu', async (ctx) => {
  const userId = String(ctx.from?.id);
  if (!hasWallet(users[userId])) {
    return await ctx.reply(helpMessages.wallet_needed, walletKeyboard());
  }
  await sendMainMenu(ctx);
});

bot.command('help', async (ctx) => {
  await ctx.reply(helpMessages.help, { parse_mode: 'Markdown' });
});

// ========== Strategy Setup ========== //
bot.command('strategy', async (ctx) => {
  const userId = String(ctx.from?.id);
  awaitingUsers[userId] = 'await_strategy_volume';
  await ctx.reply(
    '⚙️ <b>Strategy Setup</b>\n\n' +
    'Step 1/3: Enter minimum trading volume in SOL (e.g. 0.5):\n' +
    '💡 <i>Volume هو حجم التداول المطلوب ليتم عرض العملة لك. كلما زاد كان أكثر أماناً.</i>',
    { parse_mode: 'HTML', ...Markup.inlineKeyboard([
      [Markup.button.callback('Cancel', 'cancel_input')],
      [Markup.button.callback('Back', 'back_strategy')]
    ]) }
  );
});

bot.command('strategy_on', async (ctx) => {
  const userId = String(ctx.from?.id);
  users[userId] = users[userId] || { trades: 0, activeTrades: 1, history: [] };
  users[userId].strategy = users[userId].strategy || {};
  users[userId].strategy.enabled = true;
  saveUsers();
  await ctx.reply('✅ Auto-buy strategy enabled.');
});

bot.command('strategy_off', async (ctx) => {
  const userId = String(ctx.from?.id);
  users[userId] = users[userId] || { trades: 0, activeTrades: 1, history: [] };
  users[userId].strategy = users[userId].strategy || {};
  users[userId].strategy.enabled = false;
  saveUsers();
  await ctx.reply('⏸️ Auto-buy strategy disabled.');
});

// ========== Activity & Wallet Info ========== //
bot.action('show_activity', async (ctx) => {
  const userId = String(ctx.from?.id);
  if (!hasWallet(users[userId])) {
    return await ctx.reply(helpMessages.wallet_needed, walletKeyboard());
  }
  const history = users[userId]?.history || [];
  const text = history.length ? history.map((h: string) => `• ${h}`).join('\n') : 'No activity yet.';
  await ctx.reply(`📊 *Your Activity:*\n${text}`, {
    parse_mode: 'Markdown',
    ...Markup.inlineKeyboard([[Markup.button.callback('⬅️ Back', 'back_to_menu')]])
  });
});

bot.command('exportkey', async (ctx) => {
  const userId = String(ctx.from?.id);
  const user = users[userId];
  if (!user || !user.secret) {
    return await ctx.reply(helpMessages.wallet_needed, walletKeyboard());
  }
  await ctx.reply(helpMessages.export_warning + user.secret, { parse_mode: 'Markdown' });
});

// ========== Buy & Sell ========== //
bot.command('buy', async (ctx) => {
  const userId = String(ctx.from?.id);
  if (!hasWallet(users[userId])) {
    return await ctx.reply(helpMessages.wallet_needed, walletKeyboard());
  }
  awaitingUsers[userId + '_buy'] = true;
  ctx.reply('🔍 Send the token mint address to buy:');
});

bot.command('sell', async (ctx) => {
  const userId = String(ctx.from?.id);
  if (!hasWallet(users[userId])) {
    return await ctx.reply(helpMessages.wallet_needed, walletKeyboard());
  }
  awaitingUsers[userId + '_sell'] = true;
  ctx.reply('💰 Send the token mint address to sell:');
});

// ========== Tokens List ========== //



bot.command(['tokens', 'pumpfun', 'list'], async (ctx) => {
  const userId = String(ctx.from?.id);
  await ctx.reply('Fetching the latest tokens matching your strategy ...');
  try {
    let tokens = await getCachedTokenList();
    if (!tokens || tokens.length === 0) {
      await ctx.reply('No tokens found from the available sources. Try again later.');
      return;
    }
    // Apply user strategy filter if available
    const strat = users[userId]?.strategy;
    let filtered = tokens;
    if (strat && strat.enabled) {
      filtered = tokens.filter((t: any) => {
        let ok = true;
        // If property is missing, consider it as matching
        if (typeof strat.minVolume === 'number') {
          if (typeof t.volume === 'number') ok = ok && t.volume >= strat.minVolume;
          else ok = ok && true;
        }
        if (typeof strat.minHolders === 'number') {
          if (typeof t.holders === 'number') ok = ok && t.holders >= strat.minHolders;
          else ok = ok && true;
        }
        if (typeof strat.minAge === 'number') {
          if (typeof t.age === 'number') ok = ok && t.age >= strat.minAge;
          else ok = ok && true;
        }
        return ok;
      });
    }
    // Sort by volume if available
    const sorted = filtered
      .filter((t: any) => typeof t.volume === 'number')
      .sort((a: any, b: any) => b.volume - a.volume)
      .slice(0, 10);

    users[userId] = users[userId] || { trades: 0, activeTrades: 1, history: [] };
    users[userId].lastTokenList = sorted;
    users[userId].history = users[userId].history || [];
    users[userId].history.push('Viewed tokens matching strategy');
    saveUsers();

    let msg = '<b>Top Solana tokens matching your strategy:</b>\n';
    if (sorted.length === 0) {
      msg += '\nNo tokens match your strategy at the moment.';
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
  } catch (e: any) {
    await ctx.reply('Error fetching tokens: ' + getErrorMessage(e));
  }
});

// Add token from trending list to Honey Points strategy
bot.action(/add_honey_(\d+)/, async (ctx) => {
  const userId = String(ctx.from?.id);
  const idx = Number(ctx.match[1]);
  const token = users[userId]?.lastTokenList?.[idx];
  if (!token) return ctx.reply('Token not found.');
  // Default Honey Points settings
  const honeyToken = {
    address: token.address,
    buyAmount: 0.01,
    profitPercents: [1, 2, 3],
    soldPercents: [30, 30, 40]
  };
  try {
    addHoneyToken(userId, honeyToken, users);
    saveUsers();
    await ctx.reply(`✅ Token <b>${token.symbol}</b> added to Honey Points strategy.`, { parse_mode: 'HTML' });
  } catch (e: any) {
    await ctx.reply('❌ ' + e.message);
  }
});

bot.action('refresh_tokens', async (ctx) => {
  const userId = String(ctx.from?.id);
  await ctx.reply('Refreshing tokens...');
  try {
    let tokens = await fetchTrendingBirdeye();
    if (!tokens || tokens.length === 0) {
      tokens = await fetchTrendingPumpFun();
    }
    if (!tokens || tokens.length === 0) {
      await ctx.reply('No tokens found at the moment.');
      return;
    }
    const top = tokens.slice(0, 10);
    let msg = '<b>Trending Solana tokens:</b>\n';
    msg += top.map((t, i) => {
      let vol = t.volume ? t.volume.toLocaleString() : '-';
      return `\n${i+1}. ${t.symbol || '-'} | MC: $${t.marketCap?.toLocaleString?.() ?? '-'} | Vol: ${vol} | <code>${t.address}</code>`;
    }).join('\n');
    await ctx.reply(msg, { parse_mode: 'HTML' });
  } catch (e: any) {
    await ctx.reply('Error fetching tokens: ' + getErrorMessage(e));
  }
});

// ========== Text Handler (Wallet Restore, Strategy, Buy/Sell) ========== //
bot.on('text', async (ctx) => {
  const userId = String(ctx.from?.id);
  const text = ctx.message.text.trim();
  const user = users[userId] = users[userId] || { trades: 0, activeTrades: 1, history: [] };
  user.lastMessageAt = Date.now();
  limitHistory(user);

  // Restore wallet from private key
  if (awaitingUsers[userId] === 'await_restore_secret') {
    const secretKey = parseSolanaPrivateKey(text);
    if (secretKey && secretKey.length === 64) {
      try {
        const keypair = Keypair.fromSecretKey(secretKey);
        users[userId].wallet = keypair.publicKey.toBase58();
        users[userId].secret = toBase64Key(secretKey);
        users[userId].history = users[userId].history || [];
        users[userId].history.push('Wallet restored from private key');
        saveUsers();
        delete awaitingUsers[userId];
        await ctx.reply('✅ Wallet restored successfully! Your address: ' + users[userId].wallet);
        await sendMainMenu(ctx);
        return;
      } catch (e: any) {}
    }
    await ctx.reply('❌ Invalid or unsupported private key. Please send your Solana secret key in Base58, Base64, or as a JSON array.\nPress Cancel to exit.');
    return;
  }
// Cancel wallet restore button
bot.action('cancel_restore_wallet', async (ctx) => {
  const userId = String(ctx.from?.id);
  if (awaitingUsers[userId] === 'await_restore_secret') {
    delete awaitingUsers[userId];
    await ctx.reply('❌ Wallet restore process cancelled. You can return to the main menu.',
      {...Markup.inlineKeyboard([[Markup.button.callback('🔄 Main Menu', 'back_to_menu')]])}
    );
  }
});

  // Honey Points steps with token address validation
  if (awaitingUsers[userId] === 'await_honey_address') {
    if (!/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(text)) {
      return ctx.reply('❌ Invalid token address.');
    }
    // Validate address via API
    try {
      const info = await fetchTokenInfo(text);
      if (!info || !info.symbol) {
        return ctx.reply('❌ Token address not found or invalid.');
      }
    } catch {
      return ctx.reply('❌ Could not verify token address.');
    }
    user.honeyTemp = { address: text };
    awaitingUsers[userId] = 'await_honey_amount';
    await ctx.reply('💰 Enter buy amount in SOL (e.g. 0.01):', { ...Markup.inlineKeyboard([
      [Markup.button.callback('Cancel', 'cancel_input')],
      [Markup.button.callback('Back', 'back_honey')]
    ]) });
    return;
  }
  if (awaitingUsers[userId] === 'await_honey_amount') {
    const buyAmount = parseFloat(text);
    if (isNaN(buyAmount) || buyAmount <= 0) {
      return ctx.reply('❌ Enter a valid amount > 0.');
    }
    user.honeyTemp = user.honeyTemp || {};
    user.honeyTemp.buyAmount = buyAmount;
    awaitingUsers[userId] = 'await_honey_profit';
    await ctx.reply('🎯 Enter profit percentages as comma separated (e.g. 1,2,3):', { ...Markup.inlineKeyboard([
      [Markup.button.callback('Cancel', 'cancel_input')],
      [Markup.button.callback('Back', 'back_honey')]
    ]) });
    return;
  }
  if (awaitingUsers[userId] === 'await_honey_profit') {
    const profitPercents = text.split(',').map(s => parseFloat(s.trim())).filter(n => n >= 1 && n <= 20);
    if (!profitPercents.length || profitPercents.length > 3) {
      return ctx.reply('❌ Enter 1-3 profit percentages between 1 and 20.');
    }
    user.honeyTemp = user.honeyTemp || {};
    user.honeyTemp.profitPercents = profitPercents;
    awaitingUsers[userId] = 'await_honey_sell';
    await ctx.reply('📤 Enter sell percentages as comma separated (total 100, e.g. 30,30,40):', { ...Markup.inlineKeyboard([
      [Markup.button.callback('Cancel', 'cancel_input')],
      [Markup.button.callback('Back', 'back_honey')]
    ]) });
    return;
  }
  if (awaitingUsers[userId] === 'await_honey_sell') {
    const soldPercents = text.split(',').map(s => parseFloat(s.trim()));
    user.honeyTemp = user.honeyTemp || {};
    if (!user.honeyTemp.profitPercents || soldPercents.length !== user.honeyTemp.profitPercents.length || soldPercents.reduce((a,b)=>a+b,0) !== 100) {
      return ctx.reply('❌ Sell percentages must match profit stages and total 100%.');
    }
    user.honeyTemp.soldPercents = soldPercents;
    // Summary before saving with edit buttons
    const temp = user.honeyTemp || {};
    await ctx.reply(
      `✅ Honey Points token ready:\n• Address: <code>${temp.address ?? ''}</code>\n• Amount: <b>${temp.buyAmount ?? ''} SOL</b>\n• Profit %: <b>${(temp.profitPercents ?? []).join(',')}</b>\n• Sell %: <b>${(temp.soldPercents ?? []).join(',')}</b>`,
      { parse_mode: 'HTML', ...Markup.inlineKeyboard([
        [Markup.button.callback('Save Honey Token', 'save_honey_token')],
        [Markup.button.callback('Edit', 'edit_honey_token')],
        [Markup.button.callback('Cancel', 'cancel_input')]
      ]) }
    );
    return;
  }
// Honey Points back button
bot.action('back_honey', async (ctx) => {
  const userId = String(ctx.from?.id);
  if (awaitingUsers[userId] === 'await_honey_amount') {
    awaitingUsers[userId] = 'await_honey_address';
    await ctx.reply('🔙 Back: Enter token address:', { parse_mode: 'HTML' });
  } else if (awaitingUsers[userId] === 'await_honey_profit') {
    awaitingUsers[userId] = 'await_honey_amount';
    await ctx.reply('🔙 Back: Enter buy amount in SOL:', { parse_mode: 'HTML' });
  } else if (awaitingUsers[userId] === 'await_honey_sell') {
    awaitingUsers[userId] = 'await_honey_profit';
    await ctx.reply('🔙 Back: Enter profit percentages:', { parse_mode: 'HTML' });
  }
});
// Direct edit from summary
bot.action('edit_honey_token', async (ctx) => {
  const userId = String(ctx.from?.id);
  if (!users[userId]?.honeyTemp) return ctx.reply('No Honey Points token to edit.');
  awaitingUsers[userId] = 'await_honey_address';
  await ctx.reply('✏️ Edit Honey Points: Enter token address:', { parse_mode: 'HTML' });
});
// ========== Real-time Honey Points Monitoring ========== //
async function getPrice(address: string): Promise<number> {
  // Unified official sources (Birdeye, Pump.fun, Solscan, Coingecko)
  const info = await fetchTokenInfo(address);
  if (info && typeof info.price === 'number' && info.price > 0) {
    return info.price;
  }
  // fallback: try to get price from Solscan directly if not present
  try {
    const res = await fetch(`https://public-api.solscan.io/token/meta?tokenAddress=${address}`);
    const meta = await res.json();
    if (meta?.priceUsdt && typeof meta.priceUsdt === 'number') {
      return meta.priceUsdt;
    }
  } catch {}
  return 0;
}

async function honeyAutoBuy(address: string, amount: number, secret: string): Promise<string> {
  // Use existing autoBuy logic
  return await autoBuy(address, amount, secret);
}

async function honeyAutoSell(address: string, amount: number, secret: string): Promise<string> {
  // Use unifiedSell logic
  const { tx } = await unifiedSell(address, amount, secret);
  return tx;
}

async function honeyMonitor() {
  for (const userId in users) {
    const honey = getHoneySettings(userId, users);
    if (!honey.tokens || honey.tokens.length === 0) continue;
    try {
      await executeHoneyStrategy(
        userId,
        users,
        getPrice,
        async (address, amount, secret) => {
          const tx = await honeyAutoBuy(address, amount, secret);
          await bot.telegram.sendMessage(userId, `🍯 Auto-buy executed for ${address} | Amount: ${amount} SOL | Tx: ${tx}`);
          return tx;
        },
        async (address, amount, secret) => {
          const tx = await honeyAutoSell(address, amount, secret);
          await bot.telegram.sendMessage(userId, `🍯 Auto-sell executed for ${address} | Amount: ${amount} SOL | Tx: ${tx}`);
          return tx;
        }
      );
      saveUsers();
    } catch (e: any) {
      // Optionally notify user of error
      // await bot.telegram.sendMessage(userId, `🍯 Honey Points error: ${e.message}`);
    }
  }
}

setInterval(honeyMonitor, 5000); // Real-time: every 5 seconds

  // Step-by-step strategy input
  if (awaitingUsers[userId] === 'await_strategy_volume') {
    const minVolume = parseFloat(text);
    if (isNaN(minVolume) || minVolume < 0.01) {
      return ctx.reply('❌ Volume must be a number ≥ 0.01 SOL.');
    }
    user.strategy = user.strategy || {};
    user.strategy.minVolume = minVolume;
    awaitingUsers[userId] = 'await_strategy_holders';
    await ctx.reply(
      `✅ Volume set: <b>${minVolume} SOL</b>\n\nStep 2/3: Enter minimum holders (e.g. 50):`,
      { parse_mode: 'HTML', ...Markup.inlineKeyboard([
        [Markup.button.callback('Cancel', 'cancel_input')],
        [Markup.button.callback('Back', 'back_strategy')]
      ]) }
    );
    return;
  }
  if (awaitingUsers[userId] === 'await_strategy_holders') {
    const minHolders = parseInt(text);
    if (isNaN(minHolders) || minHolders < 10) {
      return ctx.reply('❌ Holders must be a number ≥ 10.');
    }
    user.strategy = user.strategy || {};
    user.strategy.minHolders = minHolders;
    awaitingUsers[userId] = 'await_strategy_age';
    await ctx.reply(
      `✅ Holders set: <b>${minHolders}</b>\n\nStep 3/3: Enter minimum age in minutes (e.g. 10):`,
      { parse_mode: 'HTML', ...Markup.inlineKeyboard([
        [Markup.button.callback('Cancel', 'cancel_input')],
        [Markup.button.callback('Back', 'back_strategy')]
      ]) }
    );
    return;
  }
  if (awaitingUsers[userId] === 'await_strategy_age') {
    const minAge = parseInt(text);
    if (isNaN(minAge) || minAge < 1) {
      return ctx.reply('❌ Age must be a number ≥ 1 minute.');
    }
    user.strategy = user.strategy || {};
    user.strategy.minAge = minAge;
    user.strategy.enabled = true;
    user.history = user.history || [];
    user.history.push(`Saved strategy: Volume ≥ ${user.strategy.minVolume} SOL, Holders ≥ ${user.strategy.minHolders}, Age ≥ ${user.strategy.minAge} min`);
    user.history = user.history || [];
    saveUsers();
    delete awaitingUsers[userId];
    await ctx.reply(
      `✅ Strategy saved!\n\n<b>Summary:</b>\n• Volume ≥ <b>${user.strategy.minVolume} SOL</b>\n• Holders ≥ <b>${user.strategy.minHolders}</b>\n• Age ≥ <b>${user.strategy.minAge} min</b>`,
      { parse_mode: 'HTML', ...Markup.inlineKeyboard([
        [Markup.button.callback('Edit Strategy', 'edit_strategy')],
        [Markup.button.callback('Show Active Targets', 'show_active_targets')]
      ]) }
    );
    // Show actual strategy results (top tokens)
    await ctx.reply('Fetching tokens matching your strategy ...');
    try {
      let tokens = await getCachedTokenList();
      if (!tokens || tokens.length === 0) {
        await ctx.reply('No tokens found from the available sources. Try again later.');
        return;
      }
      // Apply user strategy filter if available
      const strat = user.strategy;
      let filtered = tokens;
      if (strat && strat.enabled) {
        filtered = tokens.filter((t: any) => {
          let ok = true;
          if (typeof strat.minVolume === 'number') {
            if (typeof t.volume === 'number') ok = ok && t.volume >= strat.minVolume;
            else ok = ok && true;
          }
          if (typeof strat.minHolders === 'number') {
            if (typeof t.holders === 'number') ok = ok && t.holders >= strat.minHolders;
            else ok = ok && true;
          }
          if (typeof strat.minAge === 'number') {
            if (typeof t.age === 'number') ok = ok && t.age >= strat.minAge;
            else ok = ok && true;
          }
          return ok;
        });
      }
      // Sort by volume if available
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
        msg += '\nNo tokens match your strategy at the moment.';
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
    } catch (e: any) {
      await ctx.reply('Error fetching tokens: ' + getErrorMessage(e));
    }
    return;
  }
// Show current strategy
bot.command('strategy_show', async (ctx) => {
  const userId = String(ctx.from?.id);
  const strat = users[userId]?.strategy;
  if (!strat) {
    return ctx.reply('No strategy set. Use /strategy to set one.');
  }
  let msg = 'Your current strategy:\n';
  msg += `• Min Volume: ${strat.minVolume ?? '-'} SOL\n`;
  msg += `• Min Holders: ${strat.minHolders ?? '-'}\n`;
  msg += `• Min Age: ${strat.minAge ?? '-'} minutes\n`;
  msg += `• Enabled: ${strat.enabled ? 'Yes' : 'No'}`;
  await ctx.reply(msg);
});


  // Manual buy
  if (awaitingUsers[userId + '_buy']) {
    delete awaitingUsers[userId + '_buy'];
    if (!user?.secret) {
      return ctx.reply('❌ You must create or restore your wallet first.');
    }
    const tokenMint = text.trim();
    if (!/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(tokenMint)) {
      return ctx.reply('❌ Invalid token address. It must be a valid Solana mint address (32-44 chars).');
    }
    try {
      const amount = 0.01; // Default buy amount in SOL
      const { tx, source } = await unifiedBuy(tokenMint, amount, user.secret);
      user.history = user.history || [];
      user.history.push(`Buy: ${tokenMint} | Amount: ${amount} SOL | Source: ${source} | Tx: ${tx}`);
      saveUsers();
      await ctx.reply(
        `✅ <b>Buy order sent successfully!</b>\n\n` +
        `<b>Token:</b> <code>${tokenMint}</code>\n` +
        `<b>Amount:</b> ${amount} SOL\n` +
        `<b>Source:</b> ${source}\n` +
        `<b>Transaction:</b> <a href=\"https://solscan.io/tx/${tx}\">${tx}</a>\n\n` +
        `You can track it on Solscan or any Solana explorer.`,
        {
          parse_mode: 'HTML',
          ...Markup.inlineKeyboard([
            [Markup.button.callback('Reserve Profit', `set_profit_${tokenMint}`), Markup.button.callback('Stop Loss', `set_stop_${tokenMint}`)]
          ])
        }
      );
      // Show summary
      await ctx.reply(
        `📈 <b>Trade Summary</b>\n` +
        `• <b>Wallet:</b> <code>${user.wallet}</code>\n` +
        `• <b>Token:</b> <code>${tokenMint}</code>\n` +
        `• <b>Amount:</b> ${amount} SOL\n` +
        `• <b>Source:</b> ${source}\n` +
        `• <b>Tx:</b> <a href=\"https://solscan.io/tx/${tx}\">${tx}</a>`,
        { parse_mode: 'HTML' }
      );
      await sendFeeAndReferral(amount, userId, 'trade');
      return;
    } catch (e: any) {
      return ctx.reply('❌ Buy failed: ' + getErrorMessage(e));
    }
  }

  // Manual sell (activated)
  if (awaitingUsers[userId + '_sell']) {
    delete awaitingUsers[userId + '_sell'];
    if (!user?.secret) {
      return ctx.reply('❌ You must create or restore your wallet first.');
    }
    const tokenMint = text.trim();
    if (!/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(tokenMint)) {
      return ctx.reply('❌ Invalid token address. It must be a valid Solana mint address (32-44 chars).');
    }
    try {
      const amount = 0.01; // Default sell amount in SOL (can be improved to fetch actual balance)
      const { tx, source } = await unifiedSell(tokenMint, amount, user.secret);
      user.history = user.history || [];
      user.history.push(`Sell: ${tokenMint} | Amount: ${amount} SOL | Source: ${source} | Tx: ${tx}`);
      saveUsers();
      await ctx.reply(
        `✅ <b>Sell order sent successfully!</b>\n\n` +
        `<b>Token:</b> <code>${tokenMint}</code>\n` +
        `<b>Amount:</b> ${amount} SOL\n` +
        `<b>Source:</b> ${source}\n` +
        `<b>Transaction:</b> <a href=\"https://solscan.io/tx/${tx}\">${tx}</a>\n\n` +
        `You can track it on Solscan or any Solana explorer.`,
        { parse_mode: 'HTML' }
      );
      // Show summary
      await ctx.reply(
        `📉 <b>Trade Summary</b>\n` +
        `• <b>Wallet:</b> <code>${user.wallet}</code>\n` +
        `• <b>Token:</b> <code>${tokenMint}</code>\n` +
        `• <b>Amount:</b> ${amount} SOL\n` +
        `• <b>Source:</b> ${source}\n` +
        `• <b>Tx:</b> <a href=\"https://solscan.io/tx/${tx}\">${tx}</a>`,
        { parse_mode: 'HTML' }
      );
      await sendFeeAndReferral(amount, userId, 'trade');
      return;
    } catch (e: any) {
      return ctx.reply('❌ Sell failed: ' + getErrorMessage(e));
    }
  }

  // Fallback
  await ctx.reply(
    helpMessages.unknown_command,
    Markup.inlineKeyboard([
      [Markup.button.callback('Main Menu', 'back_to_menu')]
    ])
  );
});


bot.launch()
  .then(() => {
    console.log('========================================');
    console.log('✅ Telegram trading bot is running!');
    console.log('Start time:', new Date().toLocaleString());
    console.log('========================================');
  })
  .catch((err) => console.error('❌ Bot launch failed:', err));

// Copy Trade button handler
bot.action('copy_trade', async (ctx) => {
  const userId = String(ctx.from?.id);
  await ctx.reply(helpMessages.copy_trade);
  const user = users[userId] = users[userId] || { trades: 0, activeTrades: 1, history: [] };
  user.copiedWallets = user.copiedWallets || [];
  let msg = '<b>Copy Trading Setup</b>\n\n';
  if (user.copiedWallets.length) {
    msg += 'Currently copying these wallets:\n' + user.copiedWallets.map((w: string, i: number) => `${i+1}. <code>${w}</code>`).join('\n') + '\n\n';
  } else {
    msg += 'No wallets are being copied yet.\n\n';
  }
  msg += 'You can add a wallet to copy its trades, or remove an existing one.';
  await ctx.reply(msg, {
    parse_mode: 'HTML',
    ...Markup.inlineKeyboard([
      [Markup.button.callback('➕ Add Wallet', 'add_copy_wallet')],
      ...(user.copiedWallets.length ? [[Markup.button.callback('➖ Remove Wallet', 'remove_copy_wallet')]] : []),
      [Markup.button.callback('🔄 Main Menu', 'back_to_menu')]
    ])
  });
});

// Add wallet to copy
bot.action('add_copy_wallet', async (ctx) => {
  const userId = String(ctx.from?.id);
  awaitingUsers[userId] = 'await_copy_wallet_add';
  await ctx.reply('Send the wallet address you want to copy:');
});

// Remove wallet from copy list
bot.action('remove_copy_wallet', async (ctx) => {
  const userId = String(ctx.from?.id);
  const user = users[userId] = users[userId] || { trades: 0, activeTrades: 1, history: [] };
  if (!user.copiedWallets || !user.copiedWallets.length) {
    return ctx.reply('No wallets to remove.');
  }
  awaitingUsers[userId] = 'await_copy_wallet_remove';
  let msg = 'Send the wallet address you want to remove from your copy list:\n' + user.copiedWallets.map((w: string, i: number) => `${i+1}. <code>${w}</code>`).join('\n');
  await ctx.reply(msg, { parse_mode: 'HTML' });
});


// At the end of the file, after honeyMonitor interval:
setInterval(() => {
  // Prepare users for portfolioTracker
  const trackerUsers: Record<string, any> = {};
  for (const userId in users) {
    const u = users[userId];
    if (u.copiedWallets && u.copiedWallets.length && u.secret && u.wallet) {
      trackerUsers[userId] = {
        userId,
        copiedWallets: u.copiedWallets,
        secret: u.secret,
        wallet: u.wallet
      };
    }
  }
  if (Object.keys(trackerUsers).length) {
    monitorCopiedWallets(trackerUsers);
  }
}, 10000); // Every 10 seconds
