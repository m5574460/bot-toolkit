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

/** 權杖對應的帳號（用來驗證權杖） */
export const whoami = () => call('GET', 'me', { fields: 'id,username' });

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

/** 讀取自己某篇貼文的成效（views、likes、replies、reposts、quotes） */
export async function insights(postId) {
  const { data } = await call('GET', `${postId}/insights`, { metric: 'views,likes,replies,reposts,quotes' });
  return Object.fromEntries(data.map((m) => [m.name, m.values?.[0]?.value ?? m.total_value?.value ?? 0]));
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
