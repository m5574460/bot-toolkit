// Pixabay 免版稅實拍素材（可商用、免標註）。只用「人工挑選過的 ID」：關鍵字搜尋常挑到卡通或不相關畫面。
// 素材池由各機器人提供（例如 { city: [58766, …], money: [12564, …] }）；
// 影片下載後快取在 toolkit 的 .cache/broll/，所有機器人共用。Pixabay 規定 API 結果要快取 24 小時。
import { readFile, writeFile, mkdir, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { CACHE_DIR } from '../env.mjs';

const CACHE = path.join(CACHE_DIR, 'broll');
const DAY = 864e5;

async function lookup(id) {
  const cacheFile = path.join(CACHE, `meta-${id}.json`);
  if (existsSync(cacheFile) && Date.now() - (await stat(cacheFile)).mtimeMs < DAY) {
    return JSON.parse(await readFile(cacheFile, 'utf8'));
  }
  const res = await fetch(`https://pixabay.com/api/videos/?key=${process.env.PIXABAY_API_KEY}&id=${id}`);
  if (!res.ok) throw new Error(`Pixabay ${res.status}`);
  const hit = (await res.json()).hits[0];
  if (!hit) throw new Error(`找不到素材 ${id}`);
  // 直式裁切需要解析度：1920 寬用 large，4K 用 medium（2560）省流量
  const v = hit.videos.large.width && hit.videos.large.width <= 1920 ? hit.videos.large : hit.videos.medium;
  const meta = { id, url: v.url };
  await writeFile(cacheFile, JSON.stringify(meta));
  return meta;
}

/**
 * 從素材池挑一支並下載；沒有 key 或失敗回傳 null（影片就退回純圖卡）
 * @param {Record<string, number[]>} pools
 * @param {string} pool
 * @param {number} seed 同一個 seed 挑到同一支；用日期當 seed 每天會輪換
 */
export async function getBroll(pools, pool, seed = 0) {
  const ids = pools?.[pool];
  if (!process.env.PIXABAY_API_KEY || !ids?.length) return null;
  await mkdir(CACHE, { recursive: true });
  const id = ids[seed % ids.length];
  try {
    const file = path.join(CACHE, `${id}.mp4`);
    if (!existsSync(file)) {
      const { url } = await lookup(id);
      const res = await fetch(url);
      if (!res.ok) throw new Error(`下載素材失敗 ${res.status}`);
      await writeFile(file, Buffer.from(await res.arrayBuffer()));
    }
    return { file, id, pool };
  } catch (err) {
    console.warn(`  素材影片略過（${pool}#${id}）：${err.message}`);
    return null;
  }
}
