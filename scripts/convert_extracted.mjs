// 把 extracted_raw.txt（页面 eval 输出）转换为 inventory-today.txt 格式
// 目录统一走 config 的 workDir 绝对路径（原版写 workDir，却要靠"在 workDir 下运行"才对上，很脆弱）
import fs from 'fs';
import path from 'path';
import { WORKDIR, DATA_DIR, ensureDirs } from './config.mjs';

ensureDirs();

const rawPath = path.join(WORKDIR, 'extracted_raw.txt');
if (!fs.existsSync(rawPath)) {
  console.error('FAIL: 找不到 ' + rawPath + '，请先跑 fetch_inventory.mjs');
  process.exit(1);
}
const raw = fs.readFileSync(rawPath, 'utf8');

// 1. 去掉日志/警告行，提取引号内的内容；若已是解码后的纯文本则直接使用
const start = raw.indexOf('"');
const last = raw.lastIndexOf('"');
let payload;
if (start >= 0 && last > start) {
  payload = raw.substring(start + 1, last);
  // 2. 处理转义（JSON 风格：\n \t \" \\）
  payload = payload.replace(/\\n/g, '\n').replace(/\\t/g, '\t').replace(/\\"/g, '"').replace(/\\\\/g, '\\');
} else {
  payload = raw;
}

// 3. 按行解析
const lines = payload.split('\n').map(l => l.replace(/\r$/, ''));
const rowsLineIdx = lines.findIndex(l => l.trim().startsWith('ROWS='));
if (rowsLineIdx < 0) {
  console.error('FAIL: 首行不是 ROWS=，实际开头:', (lines[0] || '').slice(0, 60));
  process.exit(1);
}
const declaredRows = parseInt(lines[rowsLineIdx].trim().slice(5), 10);

const dataLines = [];
for (let i = rowsLineIdx + 1; i < lines.length; i++) {
  const line = lines[i];
  if (!line.trim()) continue;
  const parts = line.split('\t');
  if (parts.length !== 4) { console.error('SKIP 格式错误行 ' + i + ':', line.slice(0, 80)); continue; }
  const [sku, name, wh, stock] = parts.map(p => p.trim());
  if (!/^\d{6,}$/.test(sku)) { console.error('SKIP SKU 非法行 ' + i + ':', line.slice(0, 80)); continue; }
  if (!/^-?\d+$/.test(stock)) { console.error('SKIP 库存非法行 ' + i + ':', line.slice(0, 80)); continue; }
  dataLines.push({ sku, name: name.replace(/,/g, '，'), wh, stock });
}

console.log('页面声明行数:', declaredRows, '| 实际解析行数:', dataLines.length);
if (dataLines.length !== declaredRows) {
  console.error('FAIL: 解析行数与页面声明不一致，拒绝生成今日数据（避免漏采）');
  process.exit(2);
}

// 4. 写出 inventory-today.txt
const out = [];
out.push('共 ' + declaredRows + ' 条记录');
out.push('产品SKU,产品名称,发货仓库,可用库存');
for (const d of dataLines) out.push(d.sku + ',' + d.name + ',' + d.wh + ',' + d.stock);

const outPath = path.join(DATA_DIR, 'inventory-today.txt');
fs.writeFileSync(outPath, out.join('\n') + '\n', 'utf8');
console.log('已写出 ' + outPath + '：' + dataLines.length + ' 行');

// 5. 统计仓库分布（信息用）
const whCount = {};
for (const d of dataLines) whCount[d.wh] = (whCount[d.wh] || 0) + 1;
console.log('仓库分布:', JSON.stringify(whCount));
