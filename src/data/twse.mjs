// 臺灣證券交易所公開資料：上市 ETF 收盤價＋收益分配（配息）紀錄。台股相關機器人共用。
//   const { updatedAt, etfs } = await fetchEtfs();
const ymd = (d) => d.toISOString().slice(0, 10).replaceAll('-', '');

/** 民國日期 → ISO：「115年10月27日」或「1151005」 */
export function rocToIso(s) {
  if (!s) return null;
  let m = s.match(/^(\d{2,3})年(\d{1,2})月(\d{1,2})日$/);
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

/** 以近 12 個月（已公布金額）的配息次數判斷頻率 */
export function frequencyOf(dividends) {
  const cutoff = new Date(Date.now() - 365 * 864e5).toISOString().slice(0, 10);
  const n = dividends.filter((d) => d.exDate >= cutoff && d.amount != null).length;
  if (n >= 10) return { label: '月配', perYear: 12 };
  if (n >= 3) return { label: '季配', perYear: 4 };
  if (n === 2) return { label: '半年配', perYear: 2 };
  if (n === 1) return { label: '年配', perYear: 1 };
  return null;
}

/**
 * 有配息紀錄的上市 ETF：價格、近 12 月配息、殖利率、頻率、下次除息，依成交量排序
 * @returns {Promise<{ updatedAt: string, etfs: object[] }>}
 */
export async function fetchEtfs({ historyYears = 3 } = {}) {
  const [prices, divByCode] = await Promise.all([fetchDailyPrices(), fetchEtfDividends({ historyYears })]);
  const today = new Date().toISOString().slice(0, 10);
  const yearAgo = new Date(Date.now() - 365 * 864e5).toISOString().slice(0, 10);
  const etfs = [];
  for (const p of prices) {
    const dividends = divByCode.get(p.Code);
    const price = Number(p.ClosingPrice);
    if (!dividends || !price) continue;
    // 同一除息日去重，新到舊排序
    const uniq = [...new Map(dividends.map((d) => [d.exDate, d])).values()]
      .filter((d) => d.exDate)
      .sort((a, b) => b.exDate.localeCompare(a.exDate));
    const ttm = uniq.filter((d) => d.exDate >= yearAgo && d.exDate <= today && d.amount != null).reduce((s, d) => s + d.amount, 0);
    const freq = frequencyOf(uniq);
    etfs.push({
      code: p.Code,
      name: p.Name.trim(),
      price,
      priceDate: rocToIso(p.Date),
      volume: Number(p.TradeVolume),
      frequency: freq?.label ?? '不定期',
      perYear: freq?.perYear ?? null,
      ttmDividend: Math.round(ttm * 10000) / 10000,
      ttmYield: ttm ? Math.round((ttm / price) * 10000) / 100 : 0,
      lastDividend: uniq.find((d) => d.amount != null)?.amount ?? null,
      upcoming: uniq.find((d) => d.exDate > today) ?? null,
      dividends: uniq,
    });
  }
  etfs.sort((a, b) => b.volume - a.volume);
  return { updatedAt: new Date().toISOString(), etfs };
}
