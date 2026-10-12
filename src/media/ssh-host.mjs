// 暫放素材的主機（例如自己的 VM 上跑 Caddy／nginx 提供 HTTPS）：IG Reels／Threads 影片要用公開網址，
// 本機做好影片 → scp 上傳 → 拿網址去發文 → 發完刪掉。
// 設定（機器人專案的 .env）：
//   MEDIA_SSH_HOST=161.33.136.64  MEDIA_SSH_USER=ubuntu  MEDIA_SSH_KEY=C:\Users\me\.ssh\vm.key
//   MEDIA_REMOTE_DIR=/srv/xixisuan-media  MEDIA_BASE_URL=https://media.xixisuan.com
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import '../env.mjs';

const run = promisify(execFile);
const cfg = () => {
  const c = {
    host: process.env.MEDIA_SSH_HOST,
    user: process.env.MEDIA_SSH_USER ?? 'ubuntu',
    key: process.env.MEDIA_SSH_KEY,
    dir: process.env.MEDIA_REMOTE_DIR,
    base: process.env.MEDIA_BASE_URL?.replace(/\/$/, ''),
  };
  for (const k of ['host', 'key', 'dir', 'base']) if (!c[k]) throw new Error(`缺少素材主機設定（MEDIA_SSH_${k.toUpperCase()} 等）`);
  return c;
};
const sshOpts = (key) => ['-i', key, '-o', 'BatchMode=yes', '-o', 'ConnectTimeout=20', '-o', 'StrictHostKeyChecking=accept-new'];
const safeName = (name) => {
  if (!/^[\w.-]+$/.test(name)) throw new Error(`檔名只能用英數、點、底線、連字號：${name}`);
  return name;
};

/** 上傳檔案並確認公開網址可以開啟，回傳網址 */
export async function uploadFile(localPath, name) {
  const c = cfg();
  await run('scp', [...sshOpts(c.key), localPath, `${c.user}@${c.host}:${c.dir}/${safeName(name)}`], { maxBuffer: 1 << 24 });
  const url = `${c.base}/${name}`;
  const res = await fetch(url, { method: 'HEAD', signal: AbortSignal.timeout(30_000) });
  if (!res.ok) throw new Error(`上傳後網址無法開啟（HTTP ${res.status}）：${url}`);
  return url;
}

/** 刪除主機上的檔案 */
export async function removeFile(name) {
  const c = cfg();
  await run('ssh', [...sshOpts(c.key), `${c.user}@${c.host}`, `rm -f -- '${c.dir}/${safeName(name)}'`]);
}
