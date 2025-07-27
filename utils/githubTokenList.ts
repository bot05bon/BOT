// utils/githubTokenList.ts
// Fetch Solana token list from GitHub (solana-labs/token-list)

import fetch from 'node-fetch';

/**
 * Fetch Solana tokens from GitHub (solana-labs/token-list) and CoinGecko
 * Returns merged list with unique addresses
 */
export async function fetchSolanaTokenList(): Promise<any[]> {
  const githubUrl = 'https://raw.githubusercontent.com/solana-labs/token-list/main/src/tokens/solana.tokenlist.json';
  const coingeckoUrl = 'https://api.coingecko.com/api/v3/coins/list?include_platform=true';
  let githubTokens: any[] = [];
  let coingeckoTokens: any[] = [];

  // Fetch from GitHub
  try {
    const res = await fetch(githubUrl);
    const data = await res.json();
    if (data && data.tokens && Array.isArray(data.tokens)) {
      githubTokens = data.tokens;
    }
  } catch (e) {
    console.error('Failed to fetch Solana token list from GitHub:', e);
  }

  // Fetch from CoinGecko
  try {
    const res = await fetch(coingeckoUrl);
    const data = await res.json();
    if (Array.isArray(data)) {
      coingeckoTokens = data.filter((t: any) => t?.platforms?.solana);
    }
  } catch (e) {
    console.error('Failed to fetch Solana tokens from CoinGecko:', e);
  }

  // Merge tokens by address
  const addressSet = new Set<string>();
  const merged: any[] = [];

  // Add GitHub tokens first
  for (const t of githubTokens) {
    if (t.address && !addressSet.has(t.address)) {
      addressSet.add(t.address);
      merged.push(t);
    }
  }

  // Add CoinGecko tokens if not already present
  for (const t of coingeckoTokens) {
    const address = t.platforms?.solana;
    if (address && !addressSet.has(address)) {
      addressSet.add(address);
      merged.push({
        address,
        symbol: t.symbol,
        name: t.name,
        coingeckoId: t.id
      });
    }
  }

  return merged;
}
