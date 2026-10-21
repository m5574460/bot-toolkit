// 臺灣證券交易所公開資料：上市 ETF 收盤價＋收益分配（配息）紀錄。台股相關機器人共用。
//   const { updatedAt, etfs } = await fetchEtfs();
const ymd = (d) => d.toISOString().slice(0, 10).replaceAll('-', '');

/** 民國日期 → ISO：「115年10月27日」或「1151005」 */
export function rocToIso(s) {
  if (!s) return null;
  let m = s.match(/^(\d{2,3})年(\d{1,2})月(\d{1,2})日$/) ?? s.match(/^(\d{2,3})\/(\d{1,2})\/(\d{1,2})$/); // 也接受 114/10/02
  if (!m) m = s.match(/^(\d{3})(\d{2})(\d{2})$/);
  if (!m) return null;
  const [, y, mo, d] = m;
  return `${Number(y) + 1911}-${mo.padStart(2, '0')}-${d.padStart(2, '0')}`;
}

async function getJson(url) {
  for (let i = 0; i < 3; i++) {
    try {
      // 證交所偶爾很慢：每次最多等 60 秒，失敗重試
      const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' }, signal: AbortSignal.timeout(60_000) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.json();
    } catch (err) {
      if (i === 2) throw new Error(`${url}: ${err.message}`);
      await new Promise((r) => setTimeout(r, 3000));
    }
  }
}

/** 所有上市證券的最新收盤價（STOCK_DAY_ALL） */
export const fetchDailyPrices = () => getJson('https://openapi.twse.com.tw/v1/exchangeReport/STOCK_DAY_ALL');

/**
 * ETF 收益分配紀錄（全部 ETF，依代號分組）
 * @returns {Promise<Map<string, { exDate: string, payDate: string, amount: number|null }[]>>}
 */
export async function fetchEtfDividends({ historyYears = 3 } = {}) {
  const start = new Date();
  start.setFullYear(start.getFullYear() - historyYears);
  const div = await getJson(`https://www.twse.com.tw/rwd/zh/ETF/etfDiv?stkNo=&startDate=${ymd(start)}&endDate=${ymd(new Date())}&response=json`);
  if (div.status !== 'ok') throw new Error(`etfDiv status: ${div.status}`);
  // 欄位：證券代號, 證券簡稱, 除息交易日, 收益分配基準日, 收益分配發放日, 收益分配金額, 收益分配標準, 公告年度
  const byCode = new Map();
  for (const [code, , exDate, , payDate, amount] of div.data) {
    const list = byCode.get(code) ?? [];
    list.push({ exDate: rocToIso(exDate), payDate: rocToIso(payDate), amount: amount == null || amount === '' ? null : Number(amount) });
    byCode.set(code, list);
  }
  return byCode;
}

/**
 * 配息頻率：看最近幾次除息日（含已公告、還沒除息的）之間的間隔中位數。
 * 不能只數「近 12 個月配了幾次」：上市未滿一年的月配 ETF 只配過 3 次，會被誤判成季配。
 * @param {{ exDate: string }[]} dividends 新到舊
 */
export function frequencyOf(dividends) {
  const dates = [...new Set(dividends.map((d) => d.exDate).filter(Boolean))].sort().reverse().slice(0, 7);
  if (dates.length < 2) return null;
  const gaps = dates.slice(1).map((d, i) => (Date.parse(dates[i]) - Date.parse(d)) / 864e5).sort((a, b) => a - b);
  const median = gaps[gaps.length >> 1];
  if (median <= 45) return { label: '月配', perYear: 12 };
  if (median <= 135) return { label: '季配', perYear: 4 };
  if (median <= 270) return { label: '半年配', perYear: 2 };
  return { label: '年配', perYear: 1 };
}

/**
 * 有配息紀錄的上市 ETF：價格、近 12 月配息、殖利率、頻率、下次除息，依成交量排序
 * @returns {Promise<{ updatedAt: string, etfs: object[] }>}
 */
export async function fetchEtfs({ historyYears = 3 } = {}) {
  const [prices, divByCode] = await Promise.all([fetchDailyPrices(), fetchEtfDividends({ historyYears })]);
  const etfs = [];
  for (const p of prices) {
    const etf = summarizeEtf({
      code: p.Code,
      name: p.Name,
      price: Number(p.ClosingPrice),
      priceDate: rocToIso(p.Date),
      volume: Number(p.TradeVolume),
      dividends: divByCode.get(p.Code),
      market: 'TWSE',
    });
    if (etf) etfs.push(etf);
  }
  etfs.sort((a, b) => b.volume - a.volume);
  return { updatedAt: new Date().toISOString(), etfs };
}

/**
 * 把一檔 ETF 的價格與配息紀錄整理成統一格式（上市、上櫃共用，殖利率與頻率算法一致）
 * @returns {object|null} 沒有配息紀錄或沒有成交價時回傳 null
 */
export function summarizeEtf({ code, name, price, priceDate, volume, dividends, market }) {
  if (!dividends?.length || !price) return null;
  const today = new Date().toISOString().slice(0, 10);
  const yearAgo = new Date(Date.now() - 365 * 864e5).toISOString().slice(0, 10);
  // 同一除息日去重，新到舊排序
  const uniq = [...new Map(dividends.map((d) => [d.exDate, d])).values()]
    .filter((d) => d.exDate)
    .sort((a, b) => b.exDate.localeCompare(a.exDate));
  const paid = uniq.filter((d) => d.exDate >= yearAgo && d.exDate <= today && d.amount != null);
  const paidSum = paid.reduce((s, d) => s + d.amount, 0);
  const freq = frequencyOf(uniq);
  // 上市未滿一年（最早一次除息在一年內）：近 12 月配息次數不足，改用近期平均每次配息 × 一年次數年化估算
  const young = uniq.at(-1).exDate > yearAgo;
  const estimated = Boolean(young && freq && paid.length && paid.length < freq.perYear);
  const ttm = estimated ? (paidSum / paid.length) * freq.perYear : paidSum;
  return {
    code,
    name: name.trim(),
    market,
    price,
    priceDate,
    volume,
    // 只有一次除息紀錄：剛上市的標「資料不足」，老 ETF 標「不定期」
    frequency: freq?.label ?? (young ? '資料不足' : '不定期'),
    perYear: freq?.perYear ?? null,
    ttmDividend: Math.round(ttm * 10000) / 10000,
    ttmYield: ttm ? Math.round((ttm / price) * 10000) / 100 : 0,
    // estimated＝上市未滿一年、ttmDividend 是年化估算；paidCount／paidSum 是近 12 月實際配息
    estimated,
    paidCount: paid.length,
    paidSum: Math.round(paidSum * 10000) / 10000,
    lastDividend: uniq.find((d) => d.amount != null)?.amount ?? null,
    upcoming: uniq.find((d) => d.exDate > today) ?? null,
    dividends: uniq,
  };
}
