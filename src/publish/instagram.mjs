// Instagram 發文（官方 Instagram API with Instagram Login，graph.instagram.com）。
// 權杖在機器人專案的 .env：IG_ACCESS_TOKEN、IG_USER_ID。帳號需為專業帳號（創作者／商業）。
// 限制：圖片只接受 JPEG、必須是公開網址；輪播最多 10 張；每 24 小時最多 100 篇。
import '../env.mjs';

const API = 'https://graph.instagram.com/v23.0';
export const MAX_CAPTION = 2200;
export const MAX_CAROUSEL = 10;

const token = () => process.env.IG_ACCESS_TOKEN;
const user = () => process.env.IG_USER_ID ?? 'me';

async function call(method, endpoint, params = {}) {
  const url = new URL(`${API}/${endpoint}`);
  for (const [k, v] of Object.entries({ ...params, access_token: token() })) url.searchParams.set(k, v);
  const json = await (await fetch(url, { method })).json();
  if (json.error) throw new Error(`Instagram API：${json.error.error_user_msg ?? json.error.message}`);
  return json;
}

/** 容器要等 Instagram 下載並處理完素材才能發布（影片可能要幾分鐘） */
async function waitReady(id, { timeoutMs = 10 * 60e3 } = {}) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const { status_code: s } = await call('GET', id, { fields: 'status_code' });
    if (s === 'FINISHED' || s === 'PUBLISHED') return;
    if (s === 'ERROR' || s === 'EXPIRED') throw new Error(`容器 ${id} 失敗：${s}`);
    await new Promise((r) => setTimeout(r, 5000));
  }
  throw new Error(`容器 ${id} 處理逾時`);
}

const container = (params) => call('POST', `${user()}/media`, params).then((r) => r.id);

async function finish(creationId) {
  await waitReady(creationId);
  // 狀態已經是 FINISHED，media_publish 偶爾還是回「media is not ready」→ 等一下再試（沒發布成功，不會重複發）
  let id;
  for (let i = 0; ; i++) {
    try {
      ({ id } = await call('POST', `${user()}/media_publish`, { creation_id: creationId }));
      break;
    } catch (err) {
      if (i >= 5 || !/not ready/i.test(err.message)) throw err;
      await new Promise((r) => setTimeout(r, 20_000));
    }
  }
  const { permalink } = await call('GET', id, { fields: 'permalink' });
  return { id, permalink };
}

/** 權杖對應的帳號 */
export const whoami = () => call('GET', 'me', { fields: 'user_id,username,account_type,media_count' });

/** 帳號目前的粉絲數 */
export const followers = () => call('GET', 'me', { fields: 'followers_count' }).then((r) => r.followers_count ?? 0);

/**
 * 發文：images 1 張＝單圖，2～10 張＝輪播；或 video＝Reels（同時分享到動態）
 * @param {{ caption: string, images?: string[], video?: string }} post 素材為公開網址（圖片需 JPEG）
 * @returns {Promise<{ id: string, permalink: string }>}
 */
export async function publish({ caption, images = [], video }) {
  if (!token()) throw new Error('缺少 IG_ACCESS_TOKEN');
  if ([...caption].length > MAX_CAPTION) throw new Error(`文案超過 ${MAX_CAPTION} 字`);
  if (video) return finish(await container({ media_type: 'REELS', video_url: video, caption, share_to_feed: 'true' }));
  if (!images.length) throw new Error('Instagram 貼文至少要 1 張圖');
  if (images.length === 1) return finish(await container({ image_url: images[0], caption }));
  const children = [];
  for (const image_url of images.slice(0, MAX_CAROUSEL)) children.push(await container({ image_url, is_carousel_item: 'true' }));
  for (const c of children) await waitReady(c);
  return finish(await container({ media_type: 'CAROUSEL', children: children.join(','), caption }));
}

/**
 * 貼文底下的留言（含留言的回覆），格式與 threads.conversation 一致，方便共用同一套回覆流程。
 * 注意：App 在開發模式時只讀得到 App 測試人員的留言（其他人的留言 API 回傳空的，但 comments_count 會算）。
 * @returns {Promise<{ id: string, text: string, username: string, timestamp: string, replied_to?: { id: string }, is_reply_owned_by_me: boolean }[]>}
 */
export async function conversation(mediaId) {
  // 留言的 from.id 可能是 user_id 或 App 範圍的 id，兩個都比對，再加上帳號名稱
  const me = await whoami();
  const myIds = new Set([String(me.user_id), String(me.id), String(process.env.IG_USER_ID)]);
  const out = [];
  const add = (c, parentId) => {
    const username = c.username ?? c.from?.username;
    out.push({
      id: c.id,
      text: c.text,
      username,
      timestamp: c.timestamp,
      ...(parentId ? { replied_to: { id: parentId } } : {}),
      is_reply_owned_by_me: myIds.has(String(c.from?.id)) || username === me.username,
    });
  };
  let after;
  do {
    const res = await call('GET', `${mediaId}/comments`, {
      fields: 'id,text,username,timestamp,from,replies{id,text,username,timestamp,from}',
      ...(after ? { after } : {}),
    });
    for (const c of res.data) {
      add(c);
      for (const r of c.replies?.data ?? []) add(r, c.id);
    }
    after = res.paging?.next ? res.paging.cursors?.after : undefined;
  } while (after);
  return out;
}

/** 回覆一則留言（需要 instagram_business_manage_comments 權限） */
export async function reply(commentId, text) {
  const { id } = await call('POST', `${commentId}/replies`, { message: text });
  return { id };
}

/** 貼文成效 */
export async function insights(mediaId) {
  const { data } = await call('GET', `${mediaId}/insights`, { metric: 'views,reach,likes,comments,saved,shares' });
  return Object.fromEntries(data.map((m) => [m.name, m.values?.[0]?.value ?? m.total_value?.value ?? 0]));
}

/**
 * 長效權杖續期（有效 60 天，產生滿 24 小時才能續）；寫回 .env 的 IG_ACCESS_TOKEN、IG_TOKEN_EXPIRES_AT
 */
export async function refreshToken(envFile = '.env') {
  const { readFile, writeFile } = await import('node:fs/promises');
  const url = new URL('https://graph.instagram.com/refresh_access_token');
  url.searchParams.set('grant_type', 'ig_refresh_token');
  url.searchParams.set('access_token', token());
  const json = await (await fetch(url)).json();
  if (json.error || !json.access_token) throw new Error(`IG 權杖續期失敗：${json.error?.message ?? JSON.stringify(json)}`);
  const expiresAt = new Date(Date.now() + json.expires_in * 1000).toISOString();
  let env = await readFile(envFile, 'utf8');
  const set = (k, v) => {
    env = new RegExp(`^${k}=.*$`, 'm').test(env) ? env.replace(new RegExp(`^${k}=.*$`, 'm'), `${k}=${v}`) : `${env.trimEnd()}\n${k}=${v}\n`;
  };
  set('IG_ACCESS_TOKEN', json.access_token);
  set('IG_TOKEN_EXPIRES_AT', expiresAt);
  await writeFile(envFile, env);
  process.env.IG_ACCESS_TOKEN = json.access_token;
  return expiresAt;
}
