// Strategy logic and filtering
import { User } from './types';

/**
 * Filter tokens by user strategy
 * @param tokens Array of tokens
 * @param strategy User strategy object
 */
export interface Strategy {
  minVolume?: number;
  minHolders?: number;
  minAge?: number;
  enabled?: boolean;
  onlyVerified?: boolean;
  minMarketCap?: number;
  maxAge?: number;
  fastListing?: boolean;
}

export function filterTokensByStrategy(tokens: any[], strategy?: Strategy): any[] {
  if (!strategy || !strategy.enabled) return tokens;
  return tokens.filter((t: any) => {
    let ok = true;
    if (typeof strategy.minVolume === 'number') {
      const vol = t.volume ?? t.price * t.marketCap ?? 0;
      ok = ok && vol >= strategy.minVolume;
    }
    if (typeof strategy.minHolders === 'number') {
      ok = ok && (typeof t.holders === 'number' ? t.holders >= strategy.minHolders : true);
    }
    if (typeof strategy.minAge === 'number') {
      ok = ok && (typeof t.age === 'number' ? t.age >= strategy.minAge : true);
    }
    if (typeof strategy.maxAge === 'number') {
      ok = ok && (typeof t.age === 'number' ? t.age <= strategy.maxAge : true);
    }
    if (typeof strategy.minMarketCap === 'number') {
      ok = ok && (typeof t.marketCap === 'number' ? t.marketCap >= strategy.minMarketCap : true);
    }
    if (strategy.onlyVerified && t.verified !== true) ok = false;
    if (strategy.fastListing && t.age && t.age < 30) ok = ok && true; // مثال: إدراج سريع أقل من 30 دقيقة
    return ok;
  });
}
