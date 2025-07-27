// mockLiveMarket.ts
// محرك بيانات سوقية لحظية لمحاكاة سوق العملات الرقمية بدقة وواقعية



import { randomUUID } from 'crypto';
import fetch from 'node-fetch';

export interface MockToken {
  address: string;
  symbol: string;
  price: number;
  volume24h: number;
  marketCap: number;
  holders: number;
  ageMinutes: number;
}



let tokens: MockToken[] = [];
let fetchError: string | null = null;

async function fetchTokensFromSources() {
  try {
    // جلب من DexScreener
    const dexRes = await fetch('https://api.dexscreener.com/latest/dex/pairs/solana');
    if (!dexRes.ok) throw new Error('DexScreener fetch failed');
    const dexData = await dexRes.json();
    const dexTokens: MockToken[] = (dexData.pairs || []).slice(0, 50).map((p: any) => ({
      address: p.baseToken.address,
      symbol: p.baseToken.symbol,
      price: parseFloat(p.priceUsd) || 0,
      volume24h: parseFloat(p.volume.h24) || 0,
      marketCap: parseFloat(p.liquidity.usd) || 0,
      holders: 0,
      ageMinutes: 0
    }));
    console.log('DexScreener tokens fetched:', dexTokens.slice(0, 5));

    // جلب من CoinGecko
    const cgRes = await fetch('https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&order=volume_desc&per_page=100&page=1');
    if (!cgRes.ok) throw new Error('CoinGecko fetch failed');
    const cgData = await cgRes.json();
    const cgTokens: MockToken[] = (cgData || []).map((c: any) => ({
      address: c.id,
      symbol: c.symbol.toUpperCase(),
      price: c.current_price,
      volume24h: c.total_volume,
      marketCap: c.market_cap,
      holders: 0,
      ageMinutes: 0
    }));
    console.log('CoinGecko tokens fetched:', cgTokens.slice(0, 5));

    tokens = [...dexTokens, ...cgTokens];
    if (!tokens.length) throw new Error('No tokens fetched from sources');
  } catch (e: any) {
    fetchError = e?.message || String(e);
    tokens = [];
  }
}

// جلب البيانات عند بدء التشغيل (متزامن)
const fetchPromise = fetchTokensFromSources();


// تحديث الأسعار بشكل لحظي (تحديث من المصدر كل 60 ثانية)
setInterval(() => {
  fetchTokensFromSources();
}, 60000);


export async function getLiveTokens(): Promise<MockToken[]> {
  await fetchPromise;
  if (fetchError) throw new Error('فشل جلب البيانات: ' + fetchError);
  return tokens;
}


export async function getTokenByAddress(address: string): Promise<MockToken | undefined> {
  await fetchPromise;
  return tokens.find(t => t.address === address);
}


export async function simulateBuy(address: string, amount: number): Promise<{ success: boolean; price: number; tx: string }> {
  const token = await getTokenByAddress(address);
  if (!token) return { success: false, price: 0, tx: '' };
  token.volume24h += amount * token.price;
  return { success: true, price: token.price, tx: randomUUID() };
}


export async function simulateSell(address: string, amount: number): Promise<{ success: boolean; price: number; tx: string }> {
  const token = await getTokenByAddress(address);
  if (!token) return { success: false, price: 0, tx: '' };
  token.volume24h -= amount * token.price;
  if (token.volume24h < 0) token.volume24h = 0;
  return { success: true, price: token.price, tx: randomUUID() };
}
