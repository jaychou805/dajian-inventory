// 把 extracted_raw.txt (agent-browser eval 输出) 转换为 inventory-today.txt 格式
import fs from 'fs';

const raw = fs.readFileSync('C:/Users/xiaozhihe/WorkBuddy/1/extracted_raw.txt', 'utf8');

// 1. 去掉 bash 警告行，提取引号内的内容；若是已解码的纯文本则直接使用
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
const first = lines[0] || '';
if (!first.startsWith('ROWS=')) { console.error('FAIL: first line is not ROWS=, got:', first.slice(0, 50)); process.exit(1); }
const declaredRows = parseInt(first.slice(5), 10);

const dataLines = [];
for (let i = 1; i < lines.length; i++) {
  const line = lines[i];
  if (!line.trim()) continue;
  const parts = line.split('\t');
  if (parts.length !== 4) { console.error('SKIP malformed line ' + i + ':', line.slice(0, 80)); continue; }
  const [sku, name, wh, stock] = parts.map(p => p.trim());
  if (!/^\d{6,}$/.test(sku)) { console.error('SKIP bad sku line ' + i + ':', line.slice(0, 80)); continue; }
  if (!/^-?\d+$/.test(stock)) { console.error('SKIP bad stock line ' + i + ':', line.slice(0, 80)); continue; }
  dataLines.push({ sku, name: name.replace(/,/g, '，'), wh, stock });
}

console.log('declared rows:', declaredRows, '| parsed data lines:', dataLines.length);
if (dataLines.length !== declaredRows) {
  console.error('FAIL: parsed count != declared count');
  process.exit(2);
}

// 4. 写出 inventory-today.txt
const out = [];
out.push('共 ' + declaredRows + ' 条记录');
out.push('产品SKU,产品名称,发货仓库,可用库存');
for (const d of dataLines) out.push(d.sku + ',' + d.name + ',' + d.wh + ',' + d.stock);

fs.writeFileSync('C:/Users/xiaozhihe/WorkBuddy/1/inventory-snapshots/inventory-today.txt', out.join('\n') + '\n', 'utf8');
console.log('WROTE inventory-today.txt:', out.length - 2, 'data rows');

// 5. 统计仓库分布（信息用）
const whCount = {};
for (const d of dataLines) whCount[d.wh] = (whCount[d.wh] || 0) + 1;
console.log('warehouse distribution:', JSON.stringify(whCount));
