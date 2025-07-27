// This file provides a fallback: returns mock tokens if real fetch fails or returns empty.
import * as cheerio from 'cheerio';
import fetch from 'node-fetch';

export interface PumpFunToken {
  symbol: string;
  address: string;
  volume: number;
  holders: number;
  ageMinutes: number;
  marketCap: number;
}

export async function fetchPumpFunTokens(): Promise<PumpFunToken[]> {
  try {
    const url = 'https://pump.fun/';
    const res = await fetch(url);
    if (!res.ok) throw new Error('Failed to fetch pump.fun');
    const html = await res.text();
    const $ = cheerio.load(html);
    const tokens: PumpFunToken[] = [];
    $('[class*=TokenTable_tokenTable] > div').each((i, el) => {
      const symbol = $(el).find('[class*=TokenTable_tokenCell]:nth-child(2)').text().trim();
      let address = '';
      const addressBtn = $(el).find('button[data-balloon]');
      if (addressBtn.length) {
        address = addressBtn.attr('data-balloon')?.trim() || '';
      } else {
        address = $(el).find('a').attr('href')?.split('/').pop() || '';
      }
      const volumeText = $(el).find('[class*=TokenTable_tokenCell]:nth-child(5)').text().replace(/[$,]/g, '').trim();
      const volume = parseFloat(volumeText) || 0;
      const holdersText = $(el).find('[class*=TokenTable_tokenCell]:nth-child(6)').text().replace(/[,]/g, '').trim();
      const holders = parseInt(holdersText) || 0;
      const ageText = $(el).find('[class*=TokenTable_tokenCell]:nth-child(7)').text().trim();
      let ageMinutes = 0;
      if (ageText.includes('m')) ageMinutes = parseInt(ageText);
      if (ageText.includes('h')) ageMinutes = parseInt(ageText) * 60;
      const marketCapText = $(el).find('[class*=TokenTable_tokenCell]:nth-child(4)').text().replace(/[$,]/g, '').trim();
      const marketCap = parseFloat(marketCapText) || 0;
      if (symbol && address) {
        tokens.push({ symbol, address, volume, holders, ageMinutes, marketCap });
      }
    });
    if (tokens.length) return tokens;
  } catch (e) {}
  // fallback: return empty array (no mock tokens)
  return [];
}
