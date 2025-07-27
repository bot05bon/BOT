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

/**
 * Fast, lightweight fetch using cheerio and node-fetch (no Puppeteer)
 */
export async function fetchPumpFunTokens(): Promise<PumpFunToken[]> {
  const url = 'https://pump.fun/';
  const res = await fetch(url);
  if (!res.ok) throw new Error('Failed to fetch pump.fun');
  const html = await res.text();
  const $ = cheerio.load(html);
  const tokens: PumpFunToken[] = [];

  // حدد الصفوف الديناميكية للتوكنات (قد تحتاج تحديث selector حسب الموقع)
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
  return tokens;
}

// Test: Print tokens if run directly
if (require.main === module) {
  fetchPumpFunTokens()
    .then(tokens => {
      if (!tokens.length) {
        console.log('No tokens found.');
      } else {
        console.log('Latest pump.fun tokens:');
        tokens.forEach((t, i) => {
          console.log(`${i+1}. ${t.symbol} | $${t.marketCap} MC | $${t.volume} Vol | ${t.holders} Holders | ${t.ageMinutes}m | ${t.address}`);
        });
      }
    })
    .catch(err => {
      console.error('Error fetching tokens:', err);
    });
}
