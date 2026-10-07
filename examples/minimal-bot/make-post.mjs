// 範例機器人的主程式：資料 → post.json → 圖卡 → 潤稿 → 方便複製的 caption-*.txt
// 執行（在這個資料夾）：node make-post.mjs，接著可以：
//   npx bot-toolkit video --tts=edge   做影片
//   npx bot-toolkit threads out/<資料夾>   發文預覽
// 在別的專案裡，import 路徑一樣是 'bot-toolkit/…'（package.json 加 "bot-toolkit": "file:../bot-toolkit"）
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { todayTW } from 'bot-toolkit/env';
import { writePost, finalText } from 'bot-toolkit/post';
import { renderSlides } from 'bot-toolkit/cards';
import { polishPost, llmEnabled } from 'bot-toolkit/llm';
import config from './bot.config.mjs';
import priceList from './posts/price-list.mjs';

// 1. 資料（真實機器人會從 API 抓，例如 bot-toolkit/data/twse）
const items = [
  { brand: 'A 咖啡', price: 65, ml: 480, note: '冰熱同價' },
  { brand: 'B 咖啡', price: 75, ml: 470, note: '燕麥奶 +10' },
  { brand: 'C 咖啡', price: 120, ml: 473, note: '星級門市另計' },
];

// 2. 貼文類型產生內容 → 補上 id 與品牌 → post
const today = todayTW();
const { slug, ...content } = priceList({ items, today, site: config.brand.site });
const id = `${today}-${slug}`;
const dir = path.resolve(config.outDir, id);
const post = { id, createdAt: new Date().toISOString(), brand: config.brand, ...content };

// 3. 圖卡 → 潤稿（有金鑰才會潤）→ 存檔
const files = await renderSlides(post, dir);
if (llmEnabled()) await polishPost(post, config);
await writePost(dir, post);
for (const [platform, cap] of Object.entries(post.captions)) {
  await writeFile(path.join(dir, `caption-${platform}.txt`), finalText(cap));
}
console.log(`${id}：${files.length} 張圖 → ${path.relative(process.cwd(), dir)}`);
