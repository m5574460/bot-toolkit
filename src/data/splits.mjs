// ETF 分割（反分割）：分割前的每股配息要除以比率，才能跟分割後的股價、配息放在一起比。
// 沒調整的話，歷年配息圖會像配息砍了七、八成；分割後一年內的近 12 月殖利率會用分割前的金額 ÷ 分割後的股價，嚴重高估。
// 來源：證交所「ETF 分割（反分割）恢復買賣參考價格」TWTCAU，比率＝停止買賣前收盤價 ÷ 恢復買賣參考價。
// 目前是固定清單（只列有配息的 ETF）；之後改成每天自動抓 TWTCAU，抓不到時沿用這份。

/** @type {{ code: string, date: string, ratio: number }[]} date＝恢復買賣日期；ratio＞1 是分割（1 拆 N），＜1 是反分割 */
export const ETF_SPLITS = [
  { code: '0050', date: '2025-06-18', ratio: 4 },
  { code: '0052', date: '2025-11-26', ratio: 7 },
];

export const splitsFor = (code, splits = ETF_SPLITS) => splits.filter((s) => s.code === code);

/**
 * 把除息日早於恢復買賣日期的配息除以比率（多次分割會連乘）。原本公告的金額留在 rawAmount。
 * @param {{ exDate: string, amount: number|null }[]} dividends
 * @param {{ date: string, ratio: number }[]} splits 同一檔 ETF 的分割紀錄
 * @returns {{ dividends: object[], applied: { date: string, ratio: number }[] }} applied＝真的有調整到配息的分割
 */
export function applySplits(dividends, splits) {
  const applied = new Set();
  const out = dividends.map((d) => {
    const before = splits.filter((s) => d.exDate < s.date);
    if (!before.length || d.amount == null) return d;
    before.forEach((s) => applied.add(s));
    const factor = before.reduce((f, s) => f * s.ratio, 1);
    return { ...d, amount: Math.round((d.amount / factor) * 10000) / 10000, rawAmount: d.amount };
  });
  return { dividends: out, applied: splits.filter((s) => applied.has(s)).map(({ date, ratio }) => ({ date, ratio })) };
}
