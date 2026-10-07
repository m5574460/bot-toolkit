// 金鑰與設定放在「機器人專案」自己的 .env（執行時的工作目錄），toolkit 本身不放任何金鑰
import path from 'node:path';
import { fileURLToPath } from 'node:url';

let loaded = false;
export function loadEnv(dir = process.cwd()) {
  if (loaded) return;
  loaded = true;
  try {
    process.loadEnvFile(path.join(dir, '.env'));
  } catch {
    // 沒有 .env 就只用環境變數
  }
}
loadEnv();

/** toolkit 根目錄（字型、快取、tools 都相對於這裡） */
export const TOOLKIT_ROOT = fileURLToPath(new URL('../', import.meta.url));
export const FONTS_DIR = path.join(TOOLKIT_ROOT, 'assets', 'fonts');
export const CACHE_DIR = path.join(TOOLKIT_ROOT, '.cache');

/** 台灣日期 YYYY-MM-DD */
export const todayTW = () => new Date(Date.now() + 8 * 3600e3).toISOString().slice(0, 10);
