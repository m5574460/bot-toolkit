// 文字轉語音。provider：
//   breezy  — 本機 BreezyVoice（台灣口音，Docker＋GPU），生成後壓縮句中停頓並加速；見 tools/breezyvoice
//   edge    — Edge TTS（快；BreezyVoice 不可用時自動退回）
//   minimax — MiniMax 語音（計費）
// 設定（.env）：TTS_PROVIDER、EDGE_VOICE、EDGE_RATE、BREEZY_TEMPO、BREEZY_DIR、BREEZY_URL、MINIMAX_TTS_MODEL、MINIMAX_VOICE
import { writeFile, readFile, rm } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import http from 'node:http';
import path from 'node:path';
import { MsEdgeTTS, OUTPUT_FORMAT } from 'msedge-tts';
import { TOOLKIT_ROOT } from '../env.mjs';

const run = promisify(execFile);
const env = (k, d) => process.env[k] ?? d;

export const defaultProvider = () => env('TTS_PROVIDER', 'edge');

// ---------- Edge ----------
let edge;
async function edgeTts(text) {
  if (!edge) {
    edge = new MsEdgeTTS();
    await edge.setMetadata(env('EDGE_VOICE', 'zh-TW-YunJheNeural'), OUTPUT_FORMAT.AUDIO_24KHZ_48KBITRATE_MONO_MP3);
  }
  const { audioStream } = edge.toStream(text, { rate: env('EDGE_RATE', '+8%') });
  const chunks = [];
  for await (const c of audioStream) chunks.push(c);
  return Buffer.concat(chunks);
}

// ---------- MiniMax ----------
async function minimaxTts(text) {
  const key = process.env.MINIMAX_API_KEY;
  if (!key) throw new Error('TTS_PROVIDER=minimax 需要 MINIMAX_API_KEY');
  const res = await fetch('https://api.minimax.io/v1/t2a_v2', {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: env('MINIMAX_TTS_MODEL', 'speech-2.8-hd'),
      text,
      stream: false,
      language_boost: 'Chinese',
      voice_setting: { voice_id: env('MINIMAX_VOICE', 'female-shaonv'), speed: 1.05, vol: 1, pitch: 0 },
      audio_setting: { sample_rate: 24000, bitrate: 64000, format: 'mp3', channel: 1 },
    }),
  });
  const json = await res.json();
  if (json.base_resp?.status_code !== 0 || !json.data?.audio) throw new Error(`MiniMax TTS 失敗：${JSON.stringify(json.base_resp)}`);
  return Buffer.from(json.data.audio, 'hex');
}

// ---------- BreezyVoice ----------
const BREEZY_URL = () => env('BREEZY_URL', 'http://localhost:8080');
const BREEZY_DIR = () => path.resolve(TOOLKIT_ROOT, env('BREEZY_DIR', '../BreezyVoice'));
const COMPOSE = ['compose', '-f', 'compose.yaml', '-f', 'compose.gpu.yaml'];

/** 一句可能要 30～90 秒，fetch 有固定 5 分鐘 headers 逾時，所以用 node:http 不設逾時 */
function breezyRequest(text) {
  return new Promise((resolve, reject) => {
    const body = Buffer.from(JSON.stringify({ input: text }));
    const req = http.request(`${BREEZY_URL()}/audio/speech`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': body.length },
    }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => (res.statusCode === 200 ? resolve(Buffer.concat(chunks)) : reject(new Error(`BreezyVoice HTTP ${res.statusCode}`))));
    });
    req.on('error', reject);
    req.end(body);
  });
}

/** BreezyVoice 句中停頓偏長：超過 0.3 秒壓成 0.15 秒、去頭尾靜音，再整體加速 */
async function breezyTts(text, outPath) {
  const wav = `${outPath}.raw.wav`;
  await writeFile(wav, await breezyRequest(text));
  await run('ffmpeg', ['-y', '-v', 'error', '-i', wav, '-af',
    `silenceremove=start_periods=1:start_threshold=-45dB:stop_periods=-1:stop_duration=0.3:stop_threshold=-45dB:stop_silence=0.15,atempo=${env('BREEZY_TEMPO', '1.10')}`,
    '-ar', '24000', '-ac', '1', '-b:a', '64k', outPath]);
  await rm(wav, { force: true });
  return readFile(outPath);
}

async function breezyReady() {
  try {
    return (await fetch(`${BREEZY_URL()}/models`, { signal: AbortSignal.timeout(3000) })).ok;
  } catch {
    return false;
  }
}

/** 確保 BreezyVoice 在跑；回傳 true 代表是這次啟動的（做完要關，它會吃掉約 5 GB 記憶體） */
export async function startBreezy({ timeoutMs = 10 * 60e3, log = console.log } = {}) {
  if (await breezyReady()) return false;
  log('  啟動 BreezyVoice 容器（載入模型約 2～4 分鐘）…');
  await run('docker', [...COMPOSE, 'up', '-d'], { cwd: BREEZY_DIR() });
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await breezyReady()) return true;
    await new Promise((r) => setTimeout(r, 5000));
  }
  throw new Error('BreezyVoice 啟動逾時');
}

export async function stopBreezy() {
  await run('docker', [...COMPOSE, 'down'], { cwd: BREEZY_DIR() }).catch(() => {});
}

/**
 * 準備好 provider（breezy 會啟動容器，起不來就退回 edge）
 * @returns {Promise<{ provider: string, release: () => Promise<void> }>}
 */
export async function prepareTts(provider = defaultProvider(), { log = console.log } = {}) {
  if (provider !== 'breezy') return { provider, release: async () => {} };
  try {
    const started = await startBreezy({ log });
    return { provider, release: started ? stopBreezy : async () => {} };
  } catch (err) {
    log(`  BreezyVoice 無法使用（${err.message}），改用 Edge TTS`);
    return { provider: 'edge', release: async () => {} };
  }
}

/** 合成一句話並寫成 mp3 */
export async function synthesize(text, outPath, provider = defaultProvider()) {
  for (let attempt = 1; ; attempt++) {
    try {
      if (provider === 'breezy') return await breezyTts(text, outPath);
      const audio = await (provider === 'minimax' ? minimaxTts : edgeTts)(text);
      if (!audio.length) throw new Error('收到空的音訊');
      return await writeFile(outPath, audio);
    } catch (err) {
      if (attempt === 3) throw err;
      edge = null; // Edge 連線斷掉時重建
      await new Promise((r) => setTimeout(r, 1500 * attempt));
    }
  }
}
