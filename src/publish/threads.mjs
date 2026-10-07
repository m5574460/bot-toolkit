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
