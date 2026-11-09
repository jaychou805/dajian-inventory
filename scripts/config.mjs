// 共享配置读取：所有脚本从 config.json 读取路径与 SKU/仓库配置
// 本文件同时负责把 workDir / chromeProfile 统一解析成【绝对路径】，
// 避免出现「convert 写 workDir、process 读 cwd」这类因运行目录不同而错位的问题。
import fs from 'fs';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export const CONFIG_PATH = path.join(__dirname, '..', 'config.json');

export function loadConfig() {
  const raw = fs.readFileSync(CONFIG_PATH, 'utf8');
  return JSON.parse(raw);
}

export const cfg = loadConfig();

// 统一展开 ~ 并转绝对路径
export function expandPath(p, base = process.cwd()) {
  if (!p) return p;
  let out = String(p).trim();
  if (out === '~' || out.startsWith('~/') || out.startsWith('~\\')) {
    out = path.join(os.homedir(), out.slice(1));
  }
  return path.resolve(base, out);
}

export const WORKDIR = expandPath(cfg.paths && cfg.paths.workDir, process.cwd());
export const DATA_DIR = path.join(WORKDIR, 'inventory-snapshots');
export const CHROME_PROFILE = expandPath(
  (cfg.paths && cfg.paths.chromeProfile) || path.join(os.homedir(), '.workbuddy', 'erp-chrome-profile'),
  os.homedir()
);

// Excel 相关配置的默认值（旧版 config.json 没有 excel 段也能跑）
export const EXCEL = {
  sheetId: '000001',
  skuCol: 'A',
  nameCol: 'B',
  inventoryCol: 'C',
  headerRow: 0,
  autoAppendMissing: false,
  preferXlsx: true,
  outputFile: '',
  ...(cfg.excel || {}),
};

// 浏览器行为
export const BROWSER = {
  headless: false,
  launchTimeoutMs: 30000,
  ...(cfg.browser || {}),
};

// 目录懒创建：所有脚本写文件前都会调用，避免 workDir 不存在直接 ENOENT
export function ensureDirs() {
  for (const d of [WORKDIR, DATA_DIR]) {
    try { fs.mkdirSync(d, { recursive: true }); } catch (e) { /* 已有则忽略 */ }
  }
  return { WORKDIR, DATA_DIR };
}
