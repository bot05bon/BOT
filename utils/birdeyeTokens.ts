import fetch from 'node-fetch';

export interface BirdeyeToken {
  symbol: string;
  address: string;
  priceUsd?: number;
  volume24h?: number;
  marketCap?: number;
}

// Fetch trending tokens from Birdeye public API
export async function fetchBirdeyeTokens(): Promise<BirdeyeToken[]> {
  const url = 'https://public-api.birdeye.so/public/tokenlist?sort_by=volume_24h&sort_type=desc&offset=0&limit=20';
  const res = await fetch(url, {
    headers: { 'X-API-KEY': '' } // Birdeye allows empty key for public endpoints
  });
  if (!res.ok) throw new Error('Failed to fetch from Birdeye');
  const data = await res.json();
  if (!data || !Array.isArray(data.data)) return [];
  return data.data.map((t: any) => ({
    symbol: t.symbol,
    address: t.address,
    priceUsd: t.priceUsd,
    volume24h: t.volume24h,
    marketCap: t.marketCap
  }));
}
