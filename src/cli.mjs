#!/usr/bin/env node
// 命令列入口：在「機器人專案」資料夾裡執行（讀它的 .env 與 bot.config.mjs）
//   bot-toolkit cards   <貼文資料夾…>                  依 post.json 重畫圖卡
//   bot-toolkit polish  <貼文資料夾…>                  LLM 潤稿（需要 bot.config.mjs 的 persona）
//   bot-toolkit video   [貼文資料夾…] [--tts=breezy]    合成短影音（不給資料夾＝今天的全部）
//   bot-toolkit threads <貼文資料夾> [--images] [--confirm]   發 Threads（預設只預覽）
//   bot-toolkit threads --text "內容" [--confirm]
//   bot-toolkit whoami                                  驗證 Threads 權杖
// 其他語言（例如 Python）也可以用 subprocess 呼叫這些指令，透過 post.json 交換資料。
import { readdir, readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { todayTW } from './env.mjs';
import { readPost, writePost, finalText, slideFiles, updatePost } from './post/index.mjs';

const [cmd, ...args] = process.argv.slice(2);
const flag = (name) => args.includes(name);
const opt = (name) => args.find((a) => a.startsWith(`${name}=`))?.slice(name.length + 1);
const value = (name) => (args.includes(name) ? args[args.indexOf(name) + 1] : undefined);
const positional = args.filter((a, i) => !a.startsWith('--') && args[i - 1] !== '--text');

/** 機器人設定：bot.config.mjs（outDir、persona、banned、brollPools、bgmDir…） */
async function botConfig() {
  const file = path.resolve('bot.config.mjs');
  return existsSync(file) ? (await import(pathToFileURL(file).href)).default : {};
}

async function postDirs(cfg) {
  if (positional.length) return positional.map((d) => path.resolve(d));
  const out = path.resolve(cfg.outDir ?? 'social/out');
  return (await readdir(out).catch(() => [])).filter((d) => d.startsWith(todayTW())).map((d) => path.join(out, d));
}

const cfg = await botConfig();

switch (cmd) {
  case 'cards': {
    const { renderSlides } = await import('./cards/index.mjs');
    for (const dir of await postDirs(cfg)) {
      const files = await renderSlides(await readPost(dir), dir);
      console.log(`${path.basename(dir)}：${files.length} 張圖`);
    }
    break;
  }
  case 'polish': {
    const { polishPost } = await import('./llm/index.mjs');
    for (const dir of await postDirs(cfg)) {
      console.log(path.basename(dir));
      await updatePost(dir, (post) => polishPost(post, cfg));
    }
    break;
  }
  case 'video': {
    const { makeVideos } = await import('./video/index.mjs');
    const dirs = await postDirs(cfg);
    if (!dirs.length) throw new Error('找不到貼文資料夾');
    await makeVideos(dirs, { provider: opt('--tts'), brollPools: cfg.brollPools, bgmDir: cfg.bgmDir });
    break;
  }
  case 'whoami': {
    const { whoami } = await import('./publish/threads.mjs');
    console.log(await whoami());
    break;
  }
  case 'threads': {
    const { publish, MAX_TEXT } = await import('./publish/threads.mjs');
    let post;
    let dir;
    if (value('--text')) {
      post = { text: value('--text') };
    } else if (positional[0]) {
      dir = path.resolve(positional[0]);
      const p = await readPost(dir);
      const site = p.brand.site.replace(/\/$/, '');
      const images = flag('--images') ? (await slideFiles(dir)).map((f) => `${site}/social/${path.basename(dir)}/${f}`) : [];
      post = { text: finalText(p.captions.threads), images };
    } else {
      throw new Error('用法：bot-toolkit threads <貼文資料夾> [--images] [--confirm]  或  --text "內容"');
    }
    console.log('──── 預覽 ────');
    console.log(post.text);
    if (post.images?.length) console.log(`\n附圖 ${post.images.length} 張：\n${post.images.join('\n')}`);
    console.log(`──── ${[...post.text].length}/${MAX_TEXT} 字 ────`);
    if (!flag('--confirm')) {
      console.log('（預覽模式，未發文；確認內容後加 --confirm 才會發出）');
      break;
    }
    const result = await publish(post);
    console.log(`已發布：${result.permalink}`);
    if (dir) await updatePost(dir, (p) => { p.publish = { ...p.publish, threads: { ...result, at: new Date().toISOString() } }; });
    break;
  }
  default:
    console.log((await readFile(new URL(import.meta.url), 'utf8')).split('\n').filter((l) => l.startsWith('//')).join('\n'));
}

// Edge TTS 的 WebSocket 會讓程序掛著不結束
process.exit(0);
