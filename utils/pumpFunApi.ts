// All imports must be at the top


import fetch from 'node-fetch';




export interface PumpFunToken {
  symbol: string;
  address: string;
  marketCap: number;
  volume: number;
  holders: number;
  ageMinutes: number;
}

// In-memory cache for tokens
let cache: { tokens: PumpFunToken[]; timestamp: number } | null = null;
const CACHE_TTL = 60 * 1000; // 1 minute
const RETRY_COUNT = 2;
const RETRY_DELAY = 2000; // 2 seconds

// Fetch tokens from pump.fun public API endpoint with cache and retry
export async function fetchPumpFunTokens(): Promise<PumpFunToken[]> {
  const now = Date.now();
  if (cache && now - cache.timestamp < CACHE_TTL) {
    return cache.tokens;
  }
  let lastErr: any = null;
  for (let attempt = 0; attempt <= RETRY_COUNT; attempt++) {
    try {
      const res = await fetch('https://pump.fun/api/coins', {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          'Accept': 'application/json'
        }
      });
      if (!res.ok) throw new Error('Failed to fetch pump.fun tokens');
      const data = await res.json();
      if (!Array.isArray(data)) throw new Error('Invalid data format');
      const tokens: PumpFunToken[] = data.map((t: any) => ({
        symbol: t.symbol || '',
        address: t.mint || '',
        marketCap: Number(t.marketCap) || 0,
        volume: Number(t.volume24h) || 0,
        holders: Number(t.holders) || 0,
        ageMinutes: t.launchedAt ? Math.floor((now - Number(t.launchedAt)) / 60000) : 0
      }));
      cache = { tokens, timestamp: now };
      return tokens;
    } catch (err) {
      lastErr = err;
      if (attempt < RETRY_COUNT) {
        await new Promise(res => setTimeout(res, RETRY_DELAY));
      }
    }
  }
  console.error('fetchPumpFunTokens: error after retries', lastErr);
  return [];
}
// ...existing code...
