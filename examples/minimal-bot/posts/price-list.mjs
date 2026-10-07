// 一種「貼文類型」：拿資料 → 回傳 post 內容（slides、captions、narration、video）
// 這是機器人唯一需要自己寫的部分；畫圖、潤稿、配音、影片、發文都交給 bot-toolkit。
export default function priceList({ items, today, site }) {
  return {
    slug: 'price-list',
    slides: [
      { type: 'cover', kicker: `${today} 更新`, title: '連鎖咖啡\n大杯拿鐵價格', subtitle: `整理 ${items.length} 家`, note: '範例資料' },
      {
        type: 'list',
        header: '大杯拿鐵',
        page: 1,
        pages: 1,
        footnote: '價格以官網為準',
        columns: [
          { label: '品牌', width: 520 },
          { label: '價格', width: 200, align: 'right' },
          { label: '容量', width: 216, align: 'right' },
        ],
        rows: items.map((x) => [
          { text: x.brand, sub: x.note, weight: 900 },
          { text: `${x.price} 元`, tone: 'brand' },
          { text: `${x.ml} ml`, tone: 'muted', size: 30 },
        ]),
      },
      { type: 'cta', lines: ['想比較其他品項？', '到網站看完整清單'] },
    ],
    // 文案只寫模板（template）；潤稿後的版本會寫進 text
    captions: {
      threads: {
        template: [`整理了 ${items.length} 家連鎖咖啡的大杯拿鐵價格：`, '', ...items.map((x) => `・${x.brand} ${x.price} 元`), '', `${site}/`].join('\n'),
      },
    },
    // 影片旁白：每段對應哪幾張圖（從 1 開始）
    narration: [
      { slides: [1], template: `連鎖咖啡的大杯拿鐵，現在要多少錢？我們整理了 ${items.length} 家。` },
      { slides: [2], template: `最便宜的是${items[0].brand}，${items[0].price} 元。` },
      { slides: [3], template: '想比較其他品項，到網站看完整清單。' },
    ],
    video: { kicker: `${today} 更新`, title: '大杯拿鐵\n多少錢？', cta: ['想比較其他品項？', '到網站看完整清單'] },
  };
}
