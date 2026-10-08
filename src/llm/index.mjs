// LLM 潤稿＋防呆：LLM 只改寫文字，數字由程式負責；通不過檢查就退回模板。
// 通用規則寫在這裡（數字一字不差、不加 emoji、不用 AI 套話、不漏連結、字數）；
// 主題相關的規則（人設、禁用詞）由各機器人傳入。
// 預設用 MiniMax-M3（Anthropic 相容端點），可用 LLM_BASE_URL／LLM_MODEL 換成其他相容模型。
import Anthropic from '@anthropic-ai/sdk';
import '../env.mjs';
import { finalText } from '../post/index.mjs';

const API_KEY = process.env.MINIMAX_API_KEY ?? process.env.LLM_API_KEY;
const client = API_KEY
  ? new Anthropic({ apiKey: API_KEY, baseURL: process.env.LLM_BASE_URL ?? process.env.MINIMAX_BASE_URL ?? 'https://api.minimax.io/anthropic' })
  : null;
const MODEL = process.env.LLM_MODEL ?? process.env.MINIMAX_MODEL ?? 'MiniMax-M3';

export const llmEnabled = () => client != null;

/** 一看就像 AI 寫的套話（所有主題通用） */
export const AI_PHRASES = ['讓我們', '一起來看看', '總結來說', '總而言之', '值得注意的是', '不容錯過', '快來', '趕快', '小編', '你知道嗎', '寶藏', '絕對'];

const numbersIn = (text) => (text.replaceAll(',', '').match(/\d+(?:\.\d+)?/g) ?? []).map(Number);
const emojiCount = (s) => s.match(/\p{Extended_Pictographic}/gu)?.length ?? 0;
const hashtagCount = (s) => s.match(/#[^\s#]+/g)?.length ?? 0;

/**
 * 回傳 null 代表通過；否則回傳失敗原因
 * @param {string} output
 * @param {{ draft: string, maxLength?: number, banned?: string[] }} opts
 */
export function validate(output, { draft, maxLength, banned = [], maxEmoji = 2 }) {
  const allowed = new Set(numbersIn(draft));
  const got = new Set(numbersIn(output));
  const extra = [...got].filter((n) => !allowed.has(n));
  if (extra.length) return `出現原稿沒有的數字：${extra.join(', ')}`;
  // 反過來也要成立：原稿的數字都得原樣保留（擋掉「17 張」被改寫成「十七張」）
  const missing = [...allowed].filter((n) => !got.has(n));
  if (missing.length) return `漏掉或改寫了數字：${missing.join(', ')}`;
  const hit = banned.filter((w) => output.includes(w));
  if (hit.length) return `出現禁用詞：${hit.join('、')}`;
  if (maxLength && [...output].length > maxLength) return `超過 ${maxLength} 字`;
  // emoji 少量就好（像真人），太多就像 AI：最多 maxEmoji 個（原稿本來就比較多則以原稿為準）
  if (emojiCount(output) > Math.max(maxEmoji, emojiCount(draft))) return `emoji 太多（上限 ${maxEmoji} 個）`;
  if (hashtagCount(output) > hashtagCount(draft)) return '加了 hashtag';
  const ai = AI_PHRASES.filter((w) => output.includes(w));
  if (ai.length) return `AI 腔用語：${ai.join('、')}`;
  for (const url of draft.match(/https?:\/\/\S+/g) ?? []) {
    if (!output.includes(url)) return `漏掉連結 ${url}`;
  }
  return null;
}

const HINTS = {
  threads: (max) => `平台是 Threads：口語、短句，總長度不超過 ${max} 字，開頭一句要能讓人停下來。`,
  ig: () => '平台是 Instagram：第一行要是吸睛標題，段落分明，方便手機閱讀。',
  narration: (max) => `這是短影音的配音旁白（會用語音合成念出來）：改成自然的口語，長度和原稿差不多（不超過 ${max} 字），不要 emoji、不要 hashtag、不要括號與條列符號，只用逗號和句號斷句。`,
};

const systemPrompt = ({ persona, banned }) => `你是${persona}。
任務：改寫使用者給的貼文草稿，讓它讀起來像一個真人在社群上隨手分享，不要像罐頭模板，也不要像 AI 寫的。

語氣：平實、口語、短句，像跟朋友講話；不誇張、不喊口號、不用「讓我們、一起來看看、總結來說、值得注意的是、你知道嗎」這類套話。

硬性規則（違反任何一條都不合格）：
1. 所有數字、代號、日期、網址必須「原封不動」照抄草稿，不可新增、刪除、換算或改寫成中文數字。
2. 不可以加入草稿沒有的事實、數據，或草稿沒提到的網站功能與內容（例如草稿沒說「扣稅」就不能寫）。
3. ${banned.length ? `禁止出現這些字眼：${banned.join('、')}。` : '不可改變草稿的立場。'}
4. 保留草稿最後的免責聲明與 hashtag（如果有）；草稿沒有 hashtag 就不要加。
5. 使用台灣繁體中文與台灣用語。emoji 可以用一點點（整篇最多 2 個，放在自然的位置），不要每行都放。
6. 只輸出改寫後的貼文本身，不要任何說明。`;

/**
 * @param {string} draft 模板產生的草稿（含全部正確數字）
 * @param {{ platform: 'threads'|'ig'|'narration', maxLength?: number, persona: string, banned?: string[] }} opts
 * @returns {Promise<{ text: string|null, reason?: string }>}
 */
export async function polish(draft, { platform, maxLength, persona, banned = [], maxEmoji = platform === 'narration' ? 0 : 2 }) {
  if (!client) return { text: null, reason: '未設定 MINIMAX_API_KEY' };
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      const res = await client.messages.create({
        model: MODEL,
        max_tokens: 2000,
        system: systemPrompt({ persona, banned }),
        messages: [{ role: 'user', content: `${HINTS[platform](maxLength)}\n\n草稿：\n${draft}` }],
      });
      // MiniMax 會回 thinking block，只取文字
      const text = res.content.filter((b) => b.type === 'text').map((b) => b.text).join('')
        .replace(/<think>[\s\S]*?<\/think>/g, '').trim();
      const reason = validate(text, { draft, maxLength, banned, maxEmoji });
      if (!reason) return { text };
      if (attempt === 2) return { text: null, reason };
    } catch (err) {
      if (attempt === 2) return { text: null, reason: `API 錯誤：${err.message}` };
    }
  }
}

const MAX = { threads: 500, ig: 2200 };

/**
 * 潤飾整篇 post 的文案與旁白（就地修改 post）；沒有金鑰就全部用模板
 * @param {object} post
 * @param {{ persona: string, banned?: string[], log?: (msg: string) => void }} opts
 */
export async function polishPost(post, { persona, banned = [], log = console.log }) {
  if (!llmEnabled()) return post;
  for (const [platform, cap] of Object.entries(post.captions ?? {})) {
    const { text, reason } = await polish(cap.template, { platform, maxLength: MAX[platform], persona, banned });
    Object.assign(cap, { text: text ?? undefined, polished: !!text, reason });
    log(`  ${platform} 文案：${text ? '潤稿通過檢查' : `退回模板（${reason}）`}`);
  }
  await Promise.all((post.narration ?? []).map(async (seg) => {
    const { text } = await polish(seg.template, { platform: 'narration', maxLength: Math.ceil([...seg.template].length * 1.6), persona, banned });
    Object.assign(seg, { text: text ?? undefined, polished: !!text });
  }));
  if (post.narration?.length) log(`  旁白：${post.narration.filter((s) => s.polished).length}/${post.narration.length} 段潤稿通過`);
  return post;
}

export { finalText };
