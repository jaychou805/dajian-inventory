// 共享配置读取：所有脚本从 config.json 读取路径与 SKU/仓库配置
// 用法：import { cfg } from '../config.mjs' 或 require
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export function loadConfig() {
  const p = path.join(__dirname, '..', 'config.json');
  const raw = fs.readFileSync(p, 'utf8');
  return JSON.parse(raw);
}

export const cfg = loadConfig();
