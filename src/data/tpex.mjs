// 櫃買中心（TPEx）公開資料：上櫃 ETF 收盤價＋配息紀錄（債券 ETF 大多在上櫃）。格式與 data/twse 一致。
//   const { etfs } = await fetchTpexEtfs();
// 來源：
//   收盤價    OpenAPI tpex_mainboard_daily_close_quotes
//   歷史配息  除權除息計算結果表（網站查詢，一次可查 3 年）
//   即將除息  OpenAPI tpex_exright_prepost（除權除息預告表）
// 限制：櫃買中心資料沒有「發放日」，payDate 為 null。
import { rocToIso, summarizeEtf } from './twse.mjs';

const ETF_CODE = /^00\d{2,4}[A-Z]?$/;
const roc = (d) => `${d.getFullYear() - 1911}/${String(d.getMonth() + 1).padStart(2, '0')}/${String(d.getDate()).padStart(2, '0')}`;

async function getJson(url) {
  for (let i = 0; i < 3; i++) {
    try {
      // 櫃買中心偶爾很慢：每次最多等 90 秒，失敗重試
      const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0', Accept: 'application/json' }, signal: AbortSignal.timeout(90_000) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.json();
    } catch (err) {
      if (i === 2) throw new Error(`${url}: ${err.message}`);
      await new Promise((r) => setTimeout(r, 3000));
    }
  }
}

/** 上櫃 ETF 配息（歷史＋預告），依代號分組 */
export async function fetchTpexEtfDividends({ historyYears = 3 } = {}) {
  const start = new Date();
  start.setFullYear(start.getFullYear() - historyYears);
  const [hist, pre] = await Promise.all([
    getJson(`https://www.tpex.org.tw/web/stock/exright/dailyquo/exDailyQ_result.php?l=zh-tw&d=${roc(start)}&ed=${roc(new Date())}`),
    getJson('https://www.tpex.org.tw/openapi/v1/tpex_exright_prepost'),
  ]);
  const byCode = new Map();
  const add = (code, exDate, amount) => {
    if (!ETF_CODE.test(code) || !exDate) return;
    if (!byCode.has(code)) byCode.set(code, []);
    byCode.get(code).push({ exDate, payDate: null, amount: amount > 0 ? amount : null });
  };
  // 欄位：除權息日期(0), 代號(1), 名稱(2), …, 息值(6), …, 權/息(8), …, 現金股利(13)
  for (const r of hist.tables?.[0]?.data ?? []) {
    if (!String(r[8]).includes('息')) continue;
    add(r[1].trim(), rocToIso(r[0]), Number(r[13] || r[6]));
  }
  for (const r of pre) {
    if (!String(r.ExRrightsExDividend).includes('息')) continue;
    add(r.SecuritiesCompanyCode.trim(), rocToIso(r.ExRrightsExDividendDate), Number(r.CashDividend));
  }
  return byCode;
}

/** 有配息紀錄的上櫃 ETF（格式同 twse.fetchEtfs），依成交量排序 */
export async function fetchTpexEtfs({ historyYears = 3 } = {}) {
  const [quotes, divByCode] = await Promise.all([
    getJson('https://www.tpex.org.tw/openapi/v1/tpex_mainboard_daily_close_quotes'),
    fetchTpexEtfDividends({ historyYears }),
  ]);
  const etfs = [];
  for (const q of quotes) {
    const code = q.SecuritiesCompanyCode?.trim();
    if (!ETF_CODE.test(code)) continue;
    const etf = summarizeEtf({
      code,
      name: q.CompanyName,
      price: Number(q.Close),
      priceDate: rocToIso(q.Date),
      volume: Number(q.TradingShares),
      dividends: divByCode.get(code),
      market: 'TPEx',
    });
    if (etf) etfs.push(etf);
  }
  etfs.sort((a, b) => b.volume - a.volume);
  return { updatedAt: new Date().toISOString(), etfs };
}
