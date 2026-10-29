// 投信投顧公會（SITCA）每月 ETF 統計：基金規模、受益人數、定期定額扣款戶數。台股相關機器人共用。
//   const stats = await fetchSitcaEtfStats('202609');   // Map<代號, {...}>，該月還沒公布時回傳 null
// 每月中旬公布上個月；投信 ETF（上市、上櫃）都有，期貨信託 ETF（例如 00635U）不在裡面。
// 來源是 HTML 表格（一次全部 ETF，約 800 KB），改版時解析會失敗 → 丟錯，由呼叫端沿用舊資料。

const num = (s) => {
  const n = Number(s.replaceAll(',', ''));
  return Number.isFinite(n) ? n : null;
};

const decode = (s) =>
  s.replace(/<[^>]*>/g, '').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&#(\d+);/g, (_, d) => String.fromCharCode(d)).trim();

/** YYYYMM → 前一個月 YYYYMM */
export const prevMonth = (ym) => {
  const y = Number(ym.slice(0, 4));
  const m = Number(ym.slice(4));
  return m === 1 ? `${y - 1}12` : `${y}${String(m - 1).padStart(2, '0')}`;
};

/**
 * @param {string} ym YYYYMM
 * @returns {Promise<Map<string, { aum: number, holders: number, natural: number, legal: number, sipAccounts: number, sipAmount: number }>|null>}
 */
export async function fetchSitcaEtfStats(ym) {
  const url = `https://www.sitca.org.tw/ROC/SITCA_ETF/etf_statement2.aspx?txtYM=${ym}&txtcomid=&txtfund=&txtemcode=&txtkeyword=&txtR1=1&txtR2=1`;
  let html;
  for (let i = 0; i < 3; i++) {
    try {
      const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' }, signal: AbortSignal.timeout(90_000) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      html = await res.text();
      break;
    } catch (err) {
      if (i === 2) throw new Error(`SITCA ${ym}: ${err.message}`);
      await new Promise((r) => setTimeout(r, 3000));
    }
  }
  const start = html.indexOf('ctl00_ContentPlaceHolder1_GridView1');
  if (start < 0) return null; // 該月還沒公布：頁面沒有表格
  const table = html.slice(start, html.indexOf('</table>', start));
  const rows = [...table.matchAll(/<tr[\s\S]*?<\/tr>/g)].map((m) => [...m[0].matchAll(/<t[hd][^>]*>([\s\S]*?)<\/t[hd]>/g)].map((c) => decode(c[1])));
  const header = rows[0] ?? [];
  const col = (name) => {
    const i = header.indexOf(name);
    if (i < 0) throw new Error(`SITCA ${ym}: 找不到欄位「${name}」（網站可能改版）`);
    return i;
  };
  const c = {
    code: col('證券代號'),
    aum: col('基金規模(台幣)'),
    natural: col('自然人受益人數'),
    legal: col('法人受益人數'),
    holders: col('總受益人數'),
    sipAccounts: col('本月定期定額扣款戶數'),
    sipAmount: col('本月定期定額扣款金額(台幣)'),
  };
  const stats = new Map();
  // 只留第一欄是序號（數字）的列，去掉標題與合計列
  for (const r of rows.slice(1).filter((r) => /^\d+$/.test(r[0]))) {
    const code = r[c.code];
    if (!code) continue;
    stats.set(code, {
      aum: num(r[c.aum]),
      holders: num(r[c.holders]),
      natural: num(r[c.natural]),
      legal: num(r[c.legal]),
      sipAccounts: num(r[c.sipAccounts]),
      sipAmount: num(r[c.sipAmount]),
    });
  }
  if (!stats.size) return null;
  return stats;
}
