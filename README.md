# bot-toolkit

社群內容機器人的共用模組：**圖卡、LLM 潤稿防呆、配音、短影音、素材影片、發文、資料來源**。
主題機器人（例如 [xixisuan](../xixisuan)）只負責「選資料、寫內容」，把結果寫成 `post.json`，後面的流程都由這裡處理。

```
主題機器人（bots）                     bot-toolkit
┌──────────────────────┐   post.json   ┌──────────────────────────────────────────────┐
│ 資料（data/twse…）    │ ────────────▶ │ cards  → 01.png…                             │
│ 貼文類型（選資料寫內容）│               │ llm    → 潤稿＋防呆（captions / narration）  │
│ 品牌設定 bot.config  │               │ video  → tts＋broll＋字幕 → video.mp4         │
└──────────────────────┘               │ publish/threads → 發文，結果寫回 post.json   │
                                       └──────────────────────────────────────────────┘
```

## 模組

| import | 用途 | 主要函式 |
|---|---|---|
| `bot-toolkit/env` | 讀機器人專案的 `.env`、共用路徑 | `todayTW()`、`TOOLKIT_ROOT` |
| `bot-toolkit/post` | **共同格式** `post.json` 讀寫 | `readPost` `writePost` `updatePost` `finalText` |
| `bot-toolkit/cards` | 圖卡（satori → 1080×1350 PNG），版型 cover／list／cta | `renderSlides(post, dir)` `renderPng(tree)` |
| `bot-toolkit/llm` | LLM 潤稿＋防呆（數字一字不差、禁用詞、emoji、AI 套話、連結、字數） | `polishPost(post, { persona, banned })` `validate()` |
| `bot-toolkit/tts` | 配音：breezy（本機台灣腔）／edge／minimax；BreezyVoice 容器自動開關 | `synthesize()` `prepareTts()` |
| `bot-toolkit/broll` | Pixabay 實拍素材（只用人工挑選的 ID，共用快取） | `getBroll(pools, pool, seed)` |
| `bot-toolkit/video` | 短影音 1080×1920＋字幕 srt | `makeVideos(dirs, opts)` |
| `bot-toolkit/publish/threads` | Threads 官方 API 發文（文字／圖／輪播／影片） | `publish()` `whoami()` |
| `bot-toolkit/data/twse` | 證交所：ETF 收盤價＋配息 | `fetchEtfs()` |

## post.json（模組之間的介面）

```jsonc
{
  "id": "2026-10-07-weekly",                    // = 資料夾名稱
  "brand": { "name": "息息相算", "site": "https://xixisuan.com", "colors": {…}, "disclaimer": "…" },
  "slides": [                                    // 圖卡內容（資料，不是圖）
    { "type": "cover", "kicker": "…", "title": "第一行\n第二行", "subtitle": "…", "note": "…" },
    { "type": "list", "header": "…", "page": 1, "pages": 3, "footnote": "…",
      "columns": [{ "label": "ETF", "width": 440 }, { "label": "殖利率", "width": 156, "align": "right" }],
      "rows": [[{ "text": "0056", "sub": "元大高股息", "weight": 900 }, { "text": "7.06%", "tone": "brand" }]] },
    { "type": "cta", "lines": ["…", "…"] }
  ],
  "captions": { "threads": { "template": "…", "text": "潤稿後（通過檢查才有）", "polished": true } },
  "narration": [{ "slides": [1], "template": "…", "text": "…" }],   // slides 從 1 起算，可跨多張
  "video": { "kicker": "…", "title": "…", "cta": ["…"], "broll": { "hook": "city", "outro": "money" } },
  "publish": { "threads": { "id": "…", "permalink": "…", "at": "…" } }
}
```

Cell（list 的格子）：字串，或 `{ text, sub?, size?=40, weight?=700, tone?='ink'|'muted'|'brand', subSize?=24 }`。

## 在機器人專案裡使用

```jsonc
// 機器人的 package.json（toolkit 放在旁邊的資料夾）
"optionalDependencies": { "bot-toolkit": "file:../bot-toolkit" }   // 網站建置不需要它，雲端找不到也不會失敗
```

機器人根目錄放 `bot.config.mjs`（CLI 會讀）：

```js
export default {
  outDir: 'social/out',
  brand: { name, site, colors, disclaimer },
  persona: '…帳號定位…',          // LLM 人設
  banned: ['推薦', …],            // 主題禁用詞
  brollPools: { city: [58766, …] },
  bgmDir: 'assets/bgm',
};
```

### CLI（在機器人資料夾執行）

```bash
npx bot-toolkit cards   <貼文資料夾>              # 依 post.json 重畫圖卡
npx bot-toolkit polish  <貼文資料夾>              # LLM 潤稿
npx bot-toolkit video   [貼文資料夾…] [--tts=edge] # 不給資料夾＝今天的全部
npx bot-toolkit threads <貼文資料夾> [--images] [--confirm]   # 預設只預覽
npx bot-toolkit threads --text "內容" [--confirm]
npx bot-toolkit whoami                             # 驗證 Threads 權杖
```

**其他語言（例如 Python 機器人）**：寫出 `post.json` 後，用 subprocess 呼叫上面的 CLI 即可。

## 環境與金鑰

- conda：`conda env create -f environment.yml`（Node 22＋ffmpeg）；`npm ci`
- **金鑰放在各機器人專案的 `.env`**（toolkit 從執行時的工作目錄讀取，本身不放任何金鑰）：
  `MINIMAX_API_KEY`（潤稿／配音）、`PIXABAY_API_KEY`、`THREADS_ACCESS_TOKEN`、`THREADS_USER_ID`、`TTS_PROVIDER`…
- BreezyVoice（台灣腔配音）安裝與換聲音：[tools/breezyvoice/README.md](tools/breezyvoice/README.md)
- 快取：`.cache/broll/`（素材影片，所有機器人共用）
