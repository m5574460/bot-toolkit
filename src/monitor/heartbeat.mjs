// 排程心跳監控（healthchecks.io 或相容服務）：工作沒跑、失敗、跑了沒做事都會通知
//   import { ping } from 'bot-toolkit/monitor/heartbeat';
//   await ping(process.env.HC_PING_DAILY, 'start');
//   await ping(process.env.HC_PING_DAILY, ok ? 'success' : 'fail', '執行摘要…');
// 網址沒設定就跳過；網路失敗只印警告，絕不影響主流程。
import '../env.mjs';

/**
 * @param {string|undefined} url 回報網址（例如 https://hc-ping.com/<uuid>）
 * @param {'start'|'success'|'fail'|'log'} status
 * @param {string} [body] 執行摘要（服務會保存前 100 kB，通知信裡看得到）
 */
export async function ping(url, status = 'success', body = '') {
  if (!url) return;
  const target = status === 'success' ? url : `${url.replace(/\/$/, '')}/${status}`;
  try {
    await fetch(target, { method: 'POST', body: String(body).slice(0, 100_000), signal: AbortSignal.timeout(10_000) });
  } catch (err) {
    console.warn(`⚠️ 心跳回報失敗（${status}）：${err.message}`);
  }
}
