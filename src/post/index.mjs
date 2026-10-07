// post.json：所有模組之間交換資料的共同格式。
// 主題機器人只負責產生它（內容），後面的畫圖、潤稿、配音、影片、發文都讀寫同一份檔案。
//
// /**
//  * @typedef {Object} Brand
//  * @property {string} name                 品牌名（圖卡、影片上方顯示）
//  * @property {string} site                 網站網址，例如 https://xixisuan.com
//  * @property {Partial<Colors>} [colors]    品牌配色（見 cards 的 DEFAULT_COLORS）
//  * @property {string} [disclaimer]         結尾圖卡的免責聲明
//  *
//  * @typedef {Object} Post
//  * @property {string} id                   資料夾名稱，例如 2026-10-07-weekly
//  * @property {Brand} brand
//  * @property {Slide[]} slides              圖卡內容（資料，不是圖）；見 cards 模組
//  * @property {{ [platform: string]: Caption }} captions   threads / ig …
//  * @property {Segment[]} narration         影片旁白，每段對應一或多張圖（1 起算）
//  * @property {VideoMeta} [video]           影片開場／結尾設定
//  * @property {{ [platform: string]: object }} [publish]  各平台發文結果
//  *
//  * @typedef {{ template: string, text?: string, polished?: boolean, reason?: string }} Caption
//  * @typedef {{ slides: number[], template: string, text?: string, polished?: boolean }} Segment
//  * @typedef {{ kicker: string, title: string, cta: string[], broll?: { hook?: string, outro?: string } }} VideoMeta
//  */
import { readFile, writeFile, mkdir, readdir } from 'node:fs/promises';
import path from 'node:path';

export const POST_FILE = 'post.json';

export async function readPost(dir) {
  return JSON.parse(await readFile(path.join(dir, POST_FILE), 'utf8'));
}

export async function writePost(dir, post) {
  await mkdir(dir, { recursive: true });
  await writeFile(path.join(dir, POST_FILE), JSON.stringify(post, null, 2));
  return post;
}

/** 讀出 → 修改 → 寫回 */
export async function updatePost(dir, fn) {
  const post = await readPost(dir);
  await fn(post);
  return writePost(dir, post);
}

/** 文案的最終版本：潤稿通過用潤稿版，否則用模板 */
export const finalText = (c) => (c?.text ?? c?.template ?? '');

/** 圖卡檔名：01.png、02.png… */
export const slideFile = (i) => `${String(i + 1).padStart(2, '0')}.png`;

export async function slideFiles(dir) {
  return (await readdir(dir)).filter((f) => /^\d+\.png$/.test(f)).sort();
}
