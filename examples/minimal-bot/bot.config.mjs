// 範例機器人的設定：bot-toolkit 的 CLI 會從「執行時的資料夾」讀這個檔
export default {
  outDir: 'out', // 貼文資料夾放哪裡

  brand: {
    name: '咖啡小算盤',
    site: 'https://example.com',
    colors: { bg: '#3b2414', bgSoft: '#7a4a24', accent: '#e8b86d', paper: '#faf6f0' }, // 只寫要改的，其餘用預設
    disclaimer: '價格為範例資料，僅供參考。',
  },

  // LLM 潤稿用（沒有 MINIMAX_API_KEY 就不會潤稿，直接用模板）
  persona: '台灣咖啡愛好者社群帳號，只整理公開價格資訊',
  banned: ['最便宜', '保證'],

  // 影片開場／結尾素材（Pixabay 影片 ID），沒有就只用圖卡
  brollPools: {},
};
