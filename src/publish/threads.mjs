// Threads 發文（官方 Threads API）。權杖在機器人專案的 .env：THREADS_ACCESS_TOKEN、THREADS_USER_ID。
// 圖片／影片必須是公開網址，Threads 不接受直接上傳檔案。
import '../env.mjs';

const API = 'https://graph.threads.net/v1.0';
export const MAX_TEXT = 500;

const token = () => process.env.THREADS_ACCESS_TOKEN;
const user = () => process.env.THREADS_USER_ID ?? 'me';

async function call(method, endpoint, params = {}) {
  const url = new URL(`${API}/${endpoint}`);
  for (const [k, v] of Object.entries({ ...params, access_token: token() })) url.searchParams.set(k, v);
  const json = await (await fetch(url, { method })).json();
  if (json.error) throw new Error(`Threads API：${json.error.message}`);
  return json;
}

/** 影片／輪播容器要等 Meta 處理完才能發布 */
async function waitReady(id) {
  for (let i = 0; i < 60; i++) {
    const { status, error_message } = await call('GET', id, { fields: 'status,error_message' });
    if (status === 'FINISHED') return;
    if (status === 'ERROR' || status === 'EXPIRED') throw new Error(`容器 ${id} 失敗：${error_message ?? status}`);
    await new Promise((r) => setTimeout(r, 5000));
  }
  throw new Error(`容器 ${id} 處理逾時`);
}

const container = (params) => call('POST', `${user()}/threads`, params).then((r) => r.id);

/** 自己最近的貼文（新到舊），用來確認發文是否其實成功 */
export const recent = (limit = 10) =>
  call('GET', `${user()}/threads`, { fields: 'id,text,permalink,timestamp', limit }).then((r) => r.data);

/** 權杖對應的帳號（用來驗證權杖） */
export const whoami = () => call('GET', 'me', { fields: 'id,username' });

/** 帳號目前的粉絲數 */
export const followers = () =>
  call('GET', `${user()}/threads_insights`, { metric: 'followers_count' }).then((r) => r.data?.[0]?.total_value?.value ?? 0);

const toUnix = (t) => (typeof t === 'number' ? t : Math.floor(new Date(t).getTime() / 1000));

/**
 * 解析帳號層級成效的回應（純函式，方便測試）
 * - clicks：期間內每個網址的點擊合計 → [{ url, value }]（欄位是 link_total_values，不是 values）
 * - views 等時間序列：每天一筆 → [{ end, value }]（end 是 API 的 end_time）
 * - followers_count 等總數：→ [{ value }]
 * 找不到預期欄位就丟錯：API 對不認得的欄位會靜默忽略、回 200，不能默默當 0
 */
export function parseAccountInsights(metric, json) {
  const m = json?.data?.find((d) => d.name === metric);
  if (!m) throw new Error(`Threads API：回應裡沒有 ${metric}`);
  if (metric === 'clicks') {
    if (!Array.isArray(m.link_total_values)) throw new Error('Threads API：clicks 沒有 link_total_values');
    return m.link_total_values.map((v) => ({ url: v.link_url, value: v.value ?? 0 }));
  }
  if (Array.isArray(m.values)) return m.values.map((v) => ({ end: v.end_time, value: v.value ?? 0 }));
  if (m.total_value) return [{ value: m.total_value.value ?? 0 }];
  throw new Error(`Threads API：${metric} 沒有 values／total_value`);
}

/**
 * 帳號層級成效（/{user-id}/threads_insights），一次一個指標
 * @param {{ metric: 'views'|'clicks'|'likes'|'replies'|'reposts'|'quotes'|'followers_count', since?: Date|string|number, until?: Date|string|number }} opts
 *   since／until：Date、ISO 字串或 Unix 秒
 */
export async function accountInsights({ metric, since, until }) {
  const params = { metric };
  if (since != null) params.since = toUnix(since);
  if (until != null) params.until = toUnix(until);
  return parseAccountInsights(metric, await call('GET', `${user()}/threads_insights`, params));
}

/**
 * 長效權杖續期：有效 60 天，產生後滿 24 小時才能續，續完重新計算 60 天。
 * 寫回機器人專案的 .env（THREADS_ACCESS_TOKEN、THREADS_TOKEN_EXPIRES_AT），回傳到期日。
 * @param {string} envFile .env 路徑（預設工作目錄的 .env）
 */
export async function refreshToken(envFile = '.env') {
  const { readFile, writeFile } = await import('node:fs/promises');
  const url = new URL('https://graph.threads.net/refresh_access_token');
  url.searchParams.set('grant_type', 'th_refresh_token');
  url.searchParams.set('access_token', token());
  const json = await (await fetch(url)).json();
  if (json.error || !json.access_token) throw new Error(`Threads 權杖續期失敗：${json.error?.message ?? JSON.stringify(json)}`);
  const expiresAt = new Date(Date.now() + json.expires_in * 1000).toISOString();
  let env = await readFile(envFile, 'utf8');
  const set = (k, v) => {
    env = new RegExp(`^${k}=.*$`, 'm').test(env) ? env.replace(new RegExp(`^${k}=.*$`, 'm'), `${k}=${v}`) : `${env.trimEnd()}\n${k}=${v}\n`;
  };
  set('THREADS_ACCESS_TOKEN', json.access_token);
  set('THREADS_TOKEN_EXPIRES_AT', expiresAt);
  await writeFile(envFile, env);
  process.env.THREADS_ACCESS_TOKEN = json.access_token;
  return expiresAt;
}

const POST_METRICS = ['views', 'likes', 'replies', 'reposts', 'quotes'];

/**
 * 讀取自己某篇貼文的成效（views、likes、replies、reposts、quotes、shares）
 * 只回傳 API 真的有給的欄位：沒有 `shares` 這個 key 代表讀不到，不是 0（API 對不認得的欄位會靜默忽略）
 * 帶 shares 的請求被拒絕時，退回原本五個指標再要一次，不讓整篇成效跟著讀不到
 */
export async function insights(postId) {
  const get = (metrics) => call('GET', `${postId}/insights`, { metric: metrics.join(',') });
  const { data } = await get([...POST_METRICS, 'shares']).catch(() => get(POST_METRICS));
  return Object.fromEntries(data.map((m) => [m.name, m.values?.[0]?.value ?? m.total_value?.value ?? 0]));
}

/**
 * 貼文底下的所有留言（含留言的回覆），舊到新
 * @returns {Promise<{ id: string, text?: string, username: string, timestamp: string, replied_to?: { id: string }, is_reply_owned_by_me: boolean }[]>}
 */
export async function conversation(postId) {
  const out = [];
  let after;
  do {
    const res = await call('GET', `${postId}/conversation`, {
      fields: 'id,text,username,timestamp,replied_to,is_reply_owned_by_me',
      reverse: 'false',
      ...(after ? { after } : {}),
    });
    out.push(...res.data);
    after = res.paging?.next ? res.paging.cursors?.after : undefined;
  } while (after);
  return out;
}

/** 回覆一則貼文或留言（需要 threads_manage_replies 權限） */
export async function reply(replyToId, text) {
  if ([...text].length > MAX_TEXT) throw new Error(`文字超過 ${MAX_TEXT} 字`);
  const id = await container({ media_type: 'TEXT', text, reply_to_id: replyToId });
  await waitReady(id);
  const { id: postId } = await call('POST', `${user()}/threads_publish`, { creation_id: id });
  return { id: postId };
}

/**
 * @param {{ text: string, images?: string[], video?: string }} post 圖片／影片為公開網址
 * @returns {Promise<{ id: string, permalink: string }>}
 */
export async function publish({ text, images = [], video }) {
  if (!token()) throw new Error('缺少 THREADS_ACCESS_TOKEN');
  if ([...text].length > MAX_TEXT) throw new Error(`文字超過 ${MAX_TEXT} 字`);
  let id;
  if (video) {
    id = await container({ media_type: 'VIDEO', video_url: video, text });
  } else if (images.length > 1) {
    const children = [];
    for (const image_url of images.slice(0, 20)) children.push(await container({ media_type: 'IMAGE', image_url, is_carousel_item: 'true' }));
    for (const c of children) await waitReady(c);
    id = await container({ media_type: 'CAROUSEL', children: children.join(','), text });
  } else if (images.length === 1) {
    id = await container({ media_type: 'IMAGE', image_url: images[0], text });
  } else {
    id = await container({ media_type: 'TEXT', text });
  }
  await waitReady(id);
  const { id: postId } = await call('POST', `${user()}/threads_publish`, { creation_id: id });
  const { permalink } = await call('GET', postId, { fields: 'permalink' });
  return { id: postId, permalink };
}
