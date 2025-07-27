// Solscan API
export async function fetchFromSolscan(address: string): Promise<TokenInfo | null> {
  try {
    const metaRes = await fetch(`https://public-api.solscan.io/token/meta?tokenAddress=${address}`);
    const meta = await metaRes.json();
    if (meta?.tokenAddress) {
      // Try to get price from Solscan
      let price = undefined;
      if (meta.priceUsdt) price = meta.priceUsdt;
      return {
        address: meta.tokenAddress,
        symbol: meta.symbol,
        marketCap: meta.marketCap,
        volume: meta.volume24h,
        holders: meta.holderCount,
        price
      };
    }
  } catch {}
  return null;
}
// tokenSources.ts
// Official sources for fetching Solana token prices and info

export type TokenInfo = {
  address: string;
  symbol?: string;
  marketCap?: number;
  volume?: number;
  holders?: number;
  ageMinutes?: number;
  price?: number;
};

// Birdeye API
export async function fetchFromBirdeye(address: string): Promise<TokenInfo | null> {
  try {
    const res = await fetch(`https://public-api.birdeye.so/public/price?address=${address}`);
    const data = await res.json();
    if (data?.data?.value) {
      return { address, price: data.data.value };
    }
  } catch {}
  return null;
}

// Pump.fun API (official public endpoint)
export async function fetchFromPumpFun(address: string): Promise<TokenInfo | null> {
  try {
    const res = await fetch(`https://api.pump.fun/api/v1/token/${address}`);
    const data = await res.json();
    if (data?.address) {
      return {
        address: data.address,
        symbol: data.symbol,
        marketCap: data.marketCap,
        volume: data.volume,
        holders: data.holders,
        ageMinutes: data.ageMinutes,
        price: data.price
      };
    }
  } catch {}
  return null;
}

// Coingecko API (official)
export async function fetchFromCoingecko(address: string): Promise<TokenInfo | null> {
  try {
    // Coingecko does not support direct Solana token mint lookup, but supports some tokens by id
    // Example: https://api.coingecko.com/api/v3/coins/solana
    // For custom tokens, this will return null
    return null;
  } catch {}
  return null;
}

// Main unified fetcher: tries all sources in order
export async function fetchTokenInfo(address: string): Promise<TokenInfo | null> {
  let info = await fetchFromBirdeye(address);
  if (info && info.price) return info;
  info = await fetchFromPumpFun(address);
  if (info && info.price) return info;
  info = await fetchFromSolscan(address);
  if (info && info.price) return info;
  info = await fetchFromCoingecko(address);
  if (info && info.price) return info;
  return null;
}

// Fetch trending tokens from Birdeye
export async function fetchTrendingBirdeye(): Promise<TokenInfo[]> {
  try {
    const res = await fetch('https://public-api.birdeye.so/public/tokenlist?sort=volume24h');
    const data = await res.json();
    if (Array.isArray(data?.data?.tokens)) {
      return data.data.tokens.map((t: any) => ({
        address: t.address,
        symbol: t.symbol,
        marketCap: t.marketCap,
        volume: t.volume24h,
        price: t.price
      }));
    }
  } catch {}
  return [];
}

// Fetch trending tokens from Pump.fun
export async function fetchTrendingPumpFun(): Promise<TokenInfo[]> {
  try {
    const res = await fetch('https://api.pump.fun/api/v1/tokens/trending');
    const data = await res.json();
    if (Array.isArray(data?.tokens)) {
      return data.tokens.map((t: any) => ({
        address: t.address,
        symbol: t.symbol,
        marketCap: t.marketCap,
        volume: t.volume,
        holders: t.holders,
        ageMinutes: t.ageMinutes,
        price: t.price
      }));
    }
  } catch {}
  return [];
}
