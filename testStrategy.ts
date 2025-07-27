
import fs from 'fs';
import * as dotenv from 'dotenv';
dotenv.config();
import { Connection, PublicKey, Keypair, LAMPORTS_PER_SOL } from '@solana/web3.js';
import { Metaplex, keypairIdentity } from '@metaplex-foundation/js';
import bs58 from 'bs58';
import fetch from 'node-fetch';

// Usage: npx ts-node testStrategy.ts <minVolume> <minHolders> <minAge> <userId>
async function main() {
  const amount = 0.01;
  // إعداد اتصال سولانا
  const rpcUrl = process.env.SOLANA_RPC || 'https://api.mainnet-beta.solana.com';
  const connection = new Connection(rpcUrl, 'confirmed');
  // إعداد metaplex لجلب بيانات الميتاداتا
  let metaplex: any;
  const [,, minVolumeArg, minHoldersArg, minAgeArg, userIdArg] = process.argv;
  if (!minVolumeArg || !minHoldersArg || !minAgeArg || !userIdArg) {
    console.log('Usage: npx ts-node testStrategy.ts <minVolume> <minHolders> <minAge> <userId>');
    process.exit(1);
  }
  const minVolume = parseFloat(minVolumeArg);
  const minHolders = parseInt(minHoldersArg);
  const minAge = parseInt(minAgeArg);
  const userId = userIdArg;

  // Load users
  const users = JSON.parse(fs.readFileSync('users.json', 'utf8'));
  const user = users[userId];
  if (!user || !user.secret) {
    console.log('User not found or missing secret.');
    process.exit(1);
  }
  // إنشاء محفظة المستخدم من secret (assume base58 or array)
  let userKeypair: Keypair;
  try {
    if (Array.isArray(user.secret)) {
      userKeypair = Keypair.fromSecretKey(Uint8Array.from(user.secret));
    } else if (typeof user.secret === 'string') {
      // detect base64 or base58
      if (/^[A-Za-z0-9+/=]+$/.test(user.secret) && user.secret.length % 4 === 0) {
        // base64
        const secretBytes = Uint8Array.from(Buffer.from(user.secret, 'base64'));
        userKeypair = Keypair.fromSecretKey(secretBytes);
      } else {
        // assume base58
        userKeypair = Keypair.fromSecretKey(bs58.decode(user.secret));
      }
    } else {
      throw new Error('Invalid secret format');
    }
  } catch (e) {
    console.log('Failed to parse user secret:', e);
    process.exit(1);
  }
  // إعداد metaplex instance
  metaplex = Metaplex.make(connection)
    .use(keypairIdentity(userKeypair));





  // جلب قائمة توكنات نشطة من dexscreener وcoingecko فقط
  let tokens: any[] = [];
  let sourceName = 'dexscreener+coingecko';
  try {
    // جلب أزواج سولانا من dexscreener
    const resDex = await fetch('https://api.dexscreener.com/latest/dex/pairs/solana');
    if (!resDex.ok) throw new Error('Failed to fetch from dexscreener');
    const dexData = await resDex.json();
    const dexPairs = dexData?.pairs || [];
    // جلب top coins من coingecko
    const resCgk = await fetch('https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&order=volume_desc&per_page=100&page=1');
    if (!resCgk.ok) throw new Error('Failed to fetch from coingecko');
    const cgkData = await resCgk.json();
    // بناء قائمة توكنات موحدة (address, symbol, name, volume, marketCap, holders, age, price)
    // من dexscreener
    for (const p of dexPairs) {
      let age = 0;
      if (p.pairCreatedAt) {
        const created = new Date(p.pairCreatedAt);
        age = Math.floor((Date.now() - created.getTime()) / 60000);
      }
      tokens.push({
        address: p.baseToken.address,
        symbol: p.baseToken.symbol,
        name: p.baseToken.name,
        volume: p.volume ? Number(p.volume.h24) : 0,
        marketCap: p.liquidity ? Number(p.liquidity.usd) : 0,
        holders: 0, // dexscreener لا يوفر عدد holders
        age,
        price: p.priceUsd ? Number(p.priceUsd) : 0,
      });
    }
    // من coingecko
    for (const c of cgkData) {
      tokens.push({
        address: c.id,
        symbol: c.symbol,
        name: c.name,
        volume: c.total_volume || 0,
        marketCap: c.market_cap || 0,
        holders: 0, // coingecko لا يوفر عدد holders
        age: 0,
        price: c.current_price || 0,
      });
    }
  } catch (e) {
    console.log('[dexscreener/coingecko fetch failed]:', e);
    return;
  }
  if (!tokens.length) {
    console.log(`[${sourceName}] returned no tokens.`);
    return;
  }
  // فلترة التوكنات
  const filtered = tokens.filter((t: any) => typeof t.volume === 'number' && t.volume >= minVolume && t.volume > 0 && typeof t.marketCap === 'number' && t.marketCap > 0 && typeof t.age === 'number' && t.age >= minAge && t.age > 0);
  const excluded = tokens.filter((t: any) => !filtered.includes(t));
  console.log(`\n=== ${sourceName} tokens fetched (${tokens.length}) ===`);
  tokens.slice(0, 10).forEach((t: any, i: number) => {
    console.log(`#${i+1} ${t.symbol || '-'} | ${t.address}`);
    if (t.volume !== undefined) console.log(`  Volume: ${t.volume}`);
    if (t.marketCap !== undefined) console.log(`  MarketCap: ${t.marketCap}`);
    if (t.age !== undefined) console.log(`  Age: ${t.age}`);
    if (t.price !== undefined) console.log(`  Price: ${t.price}`);
  });
  if (!filtered.length) {
    console.log(`\nNo real tokens match the strategy in ${sourceName}. Showing first 5 excluded tokens with reasons:`);
    excluded.slice(0, 5).forEach((t: any, i: number) => {
      console.log(`#${i+1} ${t.symbol || '-'} | ${t.address}`);
      let reasons = [];
      if (!(typeof t.volume === 'number' && t.volume >= minVolume && t.volume > 0)) reasons.push('volume');
      if (!(typeof t.marketCap === 'number' && t.marketCap > 0)) reasons.push('marketCap');
      if (!(typeof t.age === 'number' && t.age >= minAge && t.age > 0)) reasons.push('age');
      console.log(`  Exclude reason: ${reasons.join(', ')}`);
      if (t.volume !== undefined) console.log(`  Volume: ${t.volume}`);
      if (t.marketCap !== undefined) console.log(`  MarketCap: ${t.marketCap}`);
      if (t.age !== undefined) console.log(`  Age: ${t.age}`);
      if (t.price !== undefined) console.log(`  Price: ${t.price}`);
    });
    return;
  }
  // تجربة الشراء الحقيقي (محاكاة إرسال معاملة فقط دون تنفيذ فعلي)
  let success = 0, failed = 0, total = filtered.length;
  for (const [i, token] of filtered.slice(0, 5).entries()) {
    const symbol = token.symbol || '-';
    const name = token.name || '-';
    const info = `#${i+1}/${total} | ${symbol} | ${name} | ${token.address}`;
    console.log(`\nTrying (${sourceName}): ${info}`);
    if (token.volume !== undefined) console.log(`  Volume: ${token.volume}`);
    if (token.marketCap !== undefined) console.log(`  MarketCap: ${token.marketCap}`);
    if (token.age !== undefined) console.log(`  Age: ${token.age}`);
    if (token.price !== undefined) console.log(`  Price: ${token.price}`);
    const start = Date.now();
    try {
      // هنا يمكنك تنفيذ شراء حقيقي باستخدام web3.js (محاكاة فقط)
      // مثال: طباعة عنوان المستخدم والتوكن والمبلغ
      // في التطبيق الفعلي: ستستخدم تعليمات شراء SPL عبر DEX أو برنامج خاص
      console.log(`Simulate Buy:`, { user: userKeypair.publicKey.toBase58(), token: token.address, amount, elapsed: `${((Date.now() - start) / 1000).toFixed(2)}s` });
      success++;
    } catch (e: any) {
      const elapsed = ((Date.now() - start) / 1000).toFixed(2);
      console.log(`AutoBuy Failed:`, { token: token.address, reason: e?.message || e, elapsed: `${elapsed}s` });
      failed++;
    }
  }
  console.log(`\nSummary (${sourceName}): Success: ${success}, Failed: ${failed}, Total: ${total}`);

}

main();
