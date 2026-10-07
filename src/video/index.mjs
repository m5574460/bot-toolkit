// 短影音合成：讀貼文資料夾的 post.json＋圖卡 PNG → 1080×1920 直式影片（Reels／Shorts）＋ subtitles.srt
// 流程：逐句配音 → 量測長度排時間軸 → 圖卡緩慢放大（開場／結尾可換成素材影片＋大字）→ 疊品牌名與字幕 → ffmpeg
// 字幕與文字都用 satori 畫成 PNG 再疊上：不依賴 ffmpeg 的 libass（conda-forge Windows 版沒有）
import { readdir, writeFile, mkdir, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import path from 'node:path';
import { todayTW } from '../env.mjs';
import { readPost, slideFiles, finalText } from '../post/index.mjs';
import { h as el, renderPng, colorsOf } from '../cards/index.mjs';
import { synthesize, prepareTts } from '../tts/index.mjs';
import { getBroll } from '../broll/index.mjs';

const run = promisify(execFile);

const W = 1080;
const H = 1920;
const SLIDE_H = 1350;
const SLIDE_Y = 230;
const FPS = 30;
const GAP_SENTENCE = 0.25; // 句與句之間
const GAP_SEGMENT = 0.5; // 換圖前
const TAIL = 1.0; // 片尾停留
const SUB_MAX = 15; // 每行字幕最多字數
const SUB_H = 200;
const SUB_Y = 1720 - SUB_H / 2; // 字幕中心在圖卡下方

async function duration(file) {
  const { stdout } = await run('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', file]);
  return Number(stdout.trim());
}
const toWav = (input, output) => run('ffmpeg', ['-y', '-v', 'error', '-i', input, '-ar', '24000', '-ac', '1', '-c:a', 'pcm_s16le', output]);
const silence = (seconds, output) =>
  run('ffmpeg', ['-y', '-v', 'error', '-f', 'lavfi', '-i', 'anullsrc=r=24000:cl=mono', '-t', String(seconds), '-c:a', 'pcm_s16le', output]);

export const splitSentences = (text) => text.match(/[^。！？!?]+[。！？!?]?/g)?.map((s) => s.trim()).filter(Boolean) ?? [];

/** 長句切成適合字幕的短行：優先在標點斷開；硬切時避開數字／英文後面（「37 檔」不拆開） */
export function subtitleLines(sentence) {
  const parts = sentence.match(/[^，、；：,;:]+[，、；：,;:]?/g) ?? [sentence];
  const lines = [];
  for (const p of parts) {
    const piece = p.replace(/[，、；：。,;:]$/, '');
    if (lines.length && [...lines.at(-1)].length + [...piece].length <= SUB_MAX) lines[lines.length - 1] += `，${piece}`;
    else lines.push(piece);
  }
  const badCut = (chars, p) => {
    let i = p - 1;
    while (i >= 0 && chars[i] === ' ') i--;
    return /[0-9A-Za-z.%]/.test(chars[i] ?? '');
  };
  return lines.flatMap((l) => {
    const chars = [...l.replace(/[。！？!?]$/, '')];
    const n = Math.ceil(chars.length / SUB_MAX);
    const cuts = [0];
    for (let i = 1; i < n; i++) {
      const ideal = Math.round((chars.length * i) / n);
      const p = [0, 1, -1, 2, -2, 3, -3, 4, -4].map((d) => ideal + d).find((q) => q > cuts.at(-1) && q < chars.length && !badCut(chars, q)) ?? ideal;
      cuts.push(p);
    }
    cuts.push(chars.length);
    return cuts.slice(0, -1).map((c, i) => chars.slice(c, cuts[i + 1]).join('').trim()).filter(Boolean);
  });
}

const srtTime = (t) => {
  const ms = Math.round(t * 1000);
  const p = (n, w = 2) => String(n).padStart(w, '0');
  return `${p(Math.floor(ms / 3600000))}:${p(Math.floor((ms % 3600000) / 60000))}:${p(Math.floor((ms % 60000) / 1000))},${p(ms % 1000, 3)}`;
};

const shadow = '0 4px 18px rgba(0,0,0,0.75)';
const png = async (tree, w, hgt, out) => writeFile(out, await renderPng(tree, w, hgt));

const overlays = {
  brand: (name, C) =>
    el({ width: W, height: 200, justifyContent: 'center', paddingTop: 80, fontFamily: 'Noto Sans TC' },
      el({ fontSize: 46, fontWeight: 700, color: C.accent, letterSpacing: 2, textShadow: '0 2px 8px rgba(0,0,0,0.6)' }, name)),
  hook: ({ kicker, title }, C) =>
    el({ width: W, height: H, flexDirection: 'column', justifyContent: 'center', padding: '0 80px', fontFamily: 'Noto Sans TC', color: '#ffffff' },
      el({ fontSize: 44, fontWeight: 700, color: C.accent, textShadow: shadow, marginBottom: 24 }, kicker),
      el({ flexDirection: 'column', fontSize: 120, fontWeight: 900, lineHeight: 1.2, textShadow: shadow }, ...title.split('\n').map((t) => el({}, t)))),
  cta: ({ cta }, siteHost, C) =>
    el({ width: W, height: H, flexDirection: 'column', justifyContent: 'center', padding: '0 80px', fontFamily: 'Noto Sans TC', color: '#ffffff' },
      el({ flexDirection: 'column', fontSize: 84, fontWeight: 900, lineHeight: 1.3, textShadow: shadow }, ...cta.map((t) => el({}, t))),
      el({ marginTop: 56, alignSelf: 'flex-start', fontSize: 52, fontWeight: 700, color: C.bg, background: C.accent, padding: '20px 40px', borderRadius: 18 }, siteHost)),
  cue: (text) =>
    el({ width: W, height: SUB_H, alignItems: 'center', justifyContent: 'center', fontFamily: 'Noto Sans TC' },
      el({ background: 'rgba(0,0,0,0.78)', color: '#ffffff', fontSize: 64, fontWeight: 700, padding: '14px 34px', borderRadius: 18 }, text)),
};

/**
 * 合成一個貼文資料夾的影片
 * @param {string} dir 貼文資料夾（含 post.json 與 01.png…）
 * @param {{ provider: string, brollPools?: Record<string, number[]>, bgmDir?: string, log?: Function }} opts
 */
export async function makeVideo(dir, { provider, brollPools, bgmDir, log = console.log }) {
  const post = await readPost(dir);
  const C = colorsOf(post.brand);
  const bgHex = `0x${C.bg.replace('#', '')}`;
  const narration = post.narration.map((s) => ({ slides: s.slides, text: finalText(s) }));
  const slides = await slideFiles(dir);
  const work = path.join(dir, 'video-work');
  await rm(work, { recursive: true, force: true });
  await mkdir(work, { recursive: true });
  await silence(GAP_SENTENCE, path.join(work, 'gap-s.wav'));
  await silence(GAP_SEGMENT, path.join(work, 'gap-g.wav'));

  // 1. 逐句配音，量出長度，排出時間軸
  const concat = [];
  const cues = [];
  const slideDur = new Array(slides.length).fill(0);
  let t = 0;
  for (const [si, seg] of narration.entries()) {
    const segStart = t;
    for (const [ji, sentence] of splitSentences(seg.text).entries()) {
      const mp3 = path.join(work, `s${si}-${ji}.mp3`);
      const wav = mp3.replace(/\.mp3$/, '.wav');
      await synthesize(sentence, mp3, provider);
      await toWav(mp3, wav);
      const d = await duration(wav);
      const lines = subtitleLines(sentence);
      const totalChars = lines.reduce((s, l) => s + [...l].length, 0);
      let lt = t;
      for (const l of lines) {
        const ld = (d * [...l].length) / totalChars;
        cues.push({ start: lt, end: lt + ld, text: l });
        lt += ld;
      }
      concat.push(wav, path.join(work, 'gap-s.wav'));
      t += d + GAP_SENTENCE;
    }
    concat.push(path.join(work, 'gap-g.wav'));
    t += GAP_SEGMENT;
    for (const s of seg.slides) slideDur[s - 1] += (t - segStart) / seg.slides.length; // 一段可橫跨多張圖
  }
  for (let i = 0; i < slideDur.length; i++) if (!slideDur[i]) slideDur[i] = 2; // 沒旁白的圖給 2 秒
  slideDur[slideDur.length - 1] += TAIL;
  const total = slideDur.reduce((a, b) => a + b, 0);

  await writeFile(path.join(work, 'audio.txt'), concat.map((f) => `file '${f.replaceAll('\\', '/')}'`).join('\n'));
  await run('ffmpeg', ['-y', '-v', 'error', '-f', 'concat', '-safe', '0', '-i', path.join(work, 'audio.txt'), '-c', 'copy', path.join(work, 'narration.wav')]);
  await png(overlays.brand(post.brand.name, C), W, 200, path.join(work, 'brand.png'));
  for (const [i, c] of cues.entries()) await png(overlays.cue(c.text), W, SUB_H, path.join(work, `cue${i}.png`));

  // 開場與結尾：有素材就用「素材影片＋大字」取代封面圖與結尾圖
  const special = new Map();
  const meta = post.video;
  if (meta?.broll && brollPools) {
    const seed = Math.floor(Date.parse(todayTW()) / 864e5);
    const hook = meta.broll.hook && (await getBroll(brollPools, meta.broll.hook, seed));
    const outro = meta.broll.outro && (await getBroll(brollPools, meta.broll.outro, seed));
    if (hook) {
      await png(overlays.hook(meta, C), W, H, path.join(work, 'hook.png'));
      special.set(0, { clip: hook.file, overlay: 'video-work/hook.png' });
    }
    if (outro) {
      await png(overlays.cta(meta, new URL(post.brand.site).host, C), W, H, path.join(work, 'cta.png'));
      special.set(slides.length - 1, { clip: outro.file, overlay: 'video-work/cta.png' });
    }
    if (hook || outro) log(`  素材影片：${[hook, outro].filter(Boolean).map((b) => `pixabay#${b.id}（${b.pool}）`).join('、')}`);
  }

  // 2. 每段做成完整的 1080×1920 畫面 → 串接 → 疊品牌名 → 依時間疊字幕 → 混音
  const inputs = [];
  const addInput = (...a) => (inputs.push(...a), inputs.filter((x) => x === '-i').length - 1);
  const filters = [];
  slides.forEach((f, i) => {
    const dur = slideDur[i].toFixed(3);
    const sp = special.get(i);
    if (sp) {
      const v = addInput('-stream_loop', '-1', '-t', dur, '-i', sp.clip);
      const o = addInput('-i', sp.overlay);
      filters.push(`[${v}:v]scale=${W}:${H}:force_original_aspect_ratio=increase,crop=${W}:${H},fps=${FPS},eq=brightness=-0.12:saturation=0.85,setsar=1[b${i}]`);
      filters.push(`[b${i}][${o}:v]overlay=0:0[f${i}]`);
    } else {
      const v = addInput('-loop', '1', '-framerate', String(FPS), '-t', dur, '-i', f);
      const frames = Math.round(slideDur[i] * FPS);
      filters.push(`[${v}:v]scale=${W * 2}:${SLIDE_H * 2},zoompan=z='1+0.05*on/${frames}':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=1:s=${W}x${SLIDE_H}:fps=${FPS},pad=${W}:${H}:0:${SLIDE_Y}:color=${bgHex},setsar=1[f${i}]`);
    }
  });
  filters.push(`${slides.map((_, i) => `[f${i}]`).join('')}concat=n=${slides.length}:v=1:a=0[o0]`);
  const brandIdx = addInput('-i', 'video-work/brand.png');
  filters.push(`[o0][${brandIdx}:v]overlay=0:0[c0]`);
  cues.forEach((c, i) => {
    const idx = addInput('-i', `video-work/cue${i}.png`);
    filters.push(`[c${i}][${idx}:v]overlay=0:${SUB_Y}:enable='between(t,${c.start.toFixed(3)},${c.end.toFixed(3)})'[c${i + 1}]`);
  });
  filters.push(`[c${cues.length}]format=yuv420p[vout]`);
  const nIdx = addInput('-i', 'video-work/narration.wav');
  const bgm = bgmDir && existsSync(bgmDir) ? (await readdir(bgmDir)).find((f) => /\.(mp3|m4a|wav)$/i.test(f)) : null;
  if (bgm) {
    const bgmIdx = addInput('-stream_loop', '-1', '-i', path.join(bgmDir, bgm));
    filters.push(`[${bgmIdx}:a]volume=0.08,afade=t=out:st=${(total - 1.5).toFixed(2)}:d=1.5[bg]`);
    filters.push(`[${nIdx}:a][bg]amix=inputs=2:duration=first:normalize=0[aout]`);
  }

  await run('ffmpeg', [
    '-y', '-v', 'error', ...inputs,
    '-filter_complex', filters.join(';'),
    '-map', '[vout]', '-map', bgm ? '[aout]' : `${nIdx}:a`,
    '-c:v', 'libx264', '-preset', 'medium', '-crf', '20', '-pix_fmt', 'yuv420p', '-r', String(FPS),
    '-c:a', 'aac', '-b:a', '160k', '-t', total.toFixed(3), '-movflags', '+faststart',
    'video.mp4',
  ], { cwd: dir, maxBuffer: 1 << 26 });
  await writeFile(path.join(dir, 'subtitles.srt'), cues.map((c, i) => `${i + 1}\n${srtTime(c.start)} --> ${srtTime(c.end)}\n${c.text}\n`).join('\n'));
  return { total, file: path.join(dir, 'video.mp4') };
}

/**
 * 多個資料夾一次做完；TTS 服務（BreezyVoice 容器）只啟動一次，結束時關閉
 * @param {string[]} dirs
 * @param {{ provider?: string, brollPools?: object, bgmDir?: string, log?: Function }} opts
 */
export async function makeVideos(dirs, opts = {}) {
  const log = opts.log ?? console.log;
  const { provider, release } = await prepareTts(opts.provider, { log });
  const results = [];
  try {
    for (const dir of dirs) {
      const started = Date.now();
      const r = await makeVideo(dir, { ...opts, provider, log });
      log(`${path.basename(dir)}：${r.total.toFixed(1)} 秒影片（${provider}，${((Date.now() - started) / 1000).toFixed(0)}s）`);
      results.push(r);
    }
  } finally {
    await release();
  }
  return results;
}
