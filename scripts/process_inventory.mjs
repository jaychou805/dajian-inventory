// 工作日海外仓库存监控与Excel同步 - 数据处理核心
// 输入：今日 ERP 查询数据（文本格式），输出：变化报告 + Excel 更新指令
//
// 用法:
//   1. 把今天的 ERP 数据按约定格式粘贴到 inventory-snapshots/inventory-today.txt
//      格式：第一行是页面总记录数（如 "207条"），其后是 CSV 数据行
//      SKU,商品名称,发货仓库,可用库存
//   2. 运行: node process_inventory.mjs
//   3. 脚本会：
//      - 读取 inventory-today.txt
//      - 与 inventory-snapshots/snapshot-YYYY-MM-DD.json（前一工作日）比对
//      - 排除 易可达美东仓 和 西邮美东
//      - 写出 inventory-snapshots/snapshot-YYYY-MM-DD.json（今日）
//      - 输出 markdown 变化报告（含 🔴 标记、SKU+仓库顺序）
//      - 识别首次基准（不参与当日变化）
//      - 生成 inventory-snapshots/excel-updates.json（含 A+B 值和标红指令）
//
// Excel 更新需要走 tencent-docs-sheetagent 子代理，因为：
//   - 表格中 A 列 SKU 匹配、C 列写入、按 A+B 标红
//   - 必须保留其他单元格原格式

import { readFileSync, writeFileSync, existsSync, readdirSync, unlinkSync } from 'node:fs';
import { join, resolve } from 'node:path';
import process from 'node:process';
import { cfg } from './config.mjs';

const ROOT = resolve('.');
const DATA_DIR = join(ROOT, 'inventory-snapshots');
const SNAPSHOT_DIR = DATA_DIR;

// --- 配置：SKU 顺序（与 config.json 的 skuList 一致） ---
const SKU_ORDER = cfg.skuList;

// --- 配置：仓库范围 ---
const WAREHOUSES = cfg.warehouses.statistical;
const WAREHOUSE_ORDER = { '易达云美东仓': 0, '盛宝隆美西仓（共仓）': 1, '易可达美南仓': 2 };
const EXCLUDED = cfg.warehouses.excluded;

// --- 识别仓库（严格精确匹配：任何非规范名称一律排除，杜绝"盛宝隆美客多墨西哥仓"等误入） ---
function classifyWarehouse(raw) {
  // 归一化：去空白，全角括号转半角
  const w = (raw || '').replace(/\s+/g, '').replace(/（/g, '(').replace(/）/g, ')');
  if (w === '易达云美东仓') return '易达云美东仓';
  if (w === '盛宝隆美西仓(共仓)' || w === '盛宝隆美西仓') return '盛宝隆美西仓（共仓）';
  if (w === '易可达美南仓') return '易可达美南仓';
  return null; // 其他任何仓库 → 排除
}

// --- 解析今日输入 ---
function parseTodayInput(text) {
  const lines = text.split(/\r?\n/).map(l => l.trim()).filter(l => l && !l.startsWith('#'));

  let pageTotal = null;
  let records = [];       // 纳入统计的三个仓库记录
  let rawRows = 0;        // 从页面读到的全部数据行数（含排除仓）
  let excludedRows = 0;   // 被排除仓库的行数

  for (const line of lines) {
    // 提取页面总记录数（兼容多种写法：总记录数/共X条记录/记录数：X/页面总记录数）
    let totalMatch = line.match(/页面总记录数[:：\s]*(\d+)/i);
    if (!totalMatch) totalMatch = line.match(/总记录数[:：\s]*(\d+)/i);
    if (!totalMatch) totalMatch = line.match(/^共\s*(\d+)\s*条/i);
    if (!totalMatch) totalMatch = line.match(/^(\d+)\s*条/i);
    if (totalMatch && !/[,\t]/.test(line)) {
      pageTotal = parseInt(totalMatch[1], 10);
      continue;
    }

    // 跳过分隔行
    if (line.startsWith('---') || line.startsWith('===')) continue;

    // 跳过表头
    if (line.toLowerCase().includes('产品sku') || (/^sku\s*[,\t]/i.test(line))) continue;

    // 解析数据行（支持逗号或制表符分隔）
    const parts = line.split(/[,\t]/).map(p => p.trim());
    if (parts.length >= 4 && /^\d{6,}$/.test(parts[0])) {
      const sku = parts[0];
      const name = parts[1];
      const warehouseRaw = parts[2];
      const stockRaw = parts[3];
      const stock = parseInt(stockRaw, 10);
      if (isNaN(stock)) continue;

      rawRows++;
      const finalWarehouse = classifyWarehouse(warehouseRaw);
      if (finalWarehouse === null || finalWarehouse === 'EXCLUDE') {
        excludedRows++;
        continue;
      }

      records.push({ sku, name, warehouse: finalWarehouse, available: stock });
    }
  }

  return { pageTotal, records, rawRows, excludedRows };
}

// --- 与昨日快照比对 ---
function compareSnapshots(prev, today) {
  const prevMap = new Map();
  for (const r of (prev?.records || [])) {
    prevMap.set(`${r.sku}|${r.warehouse}`, r.available);
  }

  const todayMap = new Map();
  for (const r of today.records) {
    todayMap.set(`${r.sku}|${r.warehouse}`, r.available);
  }

  const changes = [];
  const firstBaseline = [];
  let matchedCount = 0;
  let excludedCount = 0;

  for (const r of today.records) {
    const key = `${r.sku}|${r.warehouse}`;
    if (!prev) {
      // 没有昨日快照，所有记录都是首次基准
      firstBaseline.push({ ...r });
      continue;
    }
    if (prevMap.has(key)) {
      matchedCount++;
      const prevStock = prevMap.get(key);
      if (prevStock !== r.available) {
        const delta = r.available - prevStock;
        changes.push({
          sku: r.sku,
          name: r.name,
          warehouse: r.warehouse,
          prevStock,
          todayStock: r.available,
          type: delta > 0 ? '增加' : '减少',
          delta: Math.abs(delta),
        });
      }
    } else {
      // 昨日没有这个 key，今日才出现 → 首次基准
      firstBaseline.push({ ...r });
    }
  }

  // 计算被排除的记录数（虽然已过滤，但我们统计输入中出现的）
  excludedCount = 0; // parser 已过滤

  return { changes, firstBaseline, matchedCount, excludedCount };
}

// --- 生成 markdown 报告 ---
function generateReport({ today, pageTotal, rawRows, excludedRows, changes, firstBaseline, prevExists }) {
  const out = [];
  out.push('# 库存监控报告');
  out.push('');
  out.push(`- 页面总记录数：${pageTotal ?? '未提供'}`);
  out.push(`- 实际读取行数（含排除仓库）：${rawRows}`);
  out.push(`- 纳入统计记录数（三个指定仓库）：${today.records.length}`);
  out.push(`- 被排除仓库行数：${excludedRows}`);

  // 计算各仓库计数
  const warehouseCounts = {};
  for (const r of today.records) {
    warehouseCounts[r.warehouse] = (warehouseCounts[r.warehouse] || 0) + 1;
  }
  out.push(`  - 易达云美东仓：${warehouseCounts['易达云美东仓'] || 0}`);
  out.push(`  - 盛宝隆美西仓（共仓）：${warehouseCounts['盛宝隆美西仓（共仓）'] || 0}`);
  out.push(`  - 易可达美南仓：${warehouseCounts['易可达美南仓'] || 0}`);

  if (changes.length === 0) {
    out.push('');
    out.push('今日没有可用库存变化的SKU。');
  } else {
    out.push('');
    out.push('## 库存变化');
    out.push('');
    out.push('| SKU | 商品名称 | 发货仓库 | 前一工作日库存 | 今日库存 | 变化类型 | 变化件数 |');
    out.push('| --- | --- | --- | --- | --- | --- | --- |');

    // 按 SKU 顺序、仓库顺序输出
    for (const sku of SKU_ORDER) {
      const skuChanges = changes.filter(c => c.sku === sku);
      if (skuChanges.length === 0) continue;
      // 仓库排序：易达云美东仓 → 盛宝隆美西仓（共仓） → 易可达美南仓
      skuChanges.sort((a, b) => (WAREHOUSE_ORDER[a.warehouse] ?? 99) - (WAREHOUSE_ORDER[b.warehouse] ?? 99));
      for (const c of skuChanges) {
        // 提炼商品名称为 2-6 个关键词
        const shortName = shortenName(c.name);
        const todayDisplay = c.todayStock <= 3 ? `🔴 ${c.todayStock}` : `${c.todayStock}`;
        const typeDisplay = c.type === '增加' ? `🟢 ${c.type}` : c.type;
        out.push(`| ${c.sku} | ${shortName} | ${c.warehouse} | ${c.prevStock} | ${todayDisplay} | ${typeDisplay} | ${c.delta} |`);
      }
    }
  }

  if (firstBaseline.length > 0) {
    out.push('');
    out.push('## 首次建立基准（不参与今日变化比较）');
    out.push('');
    out.push('以下 SKU+仓库 在前一工作日快照中不存在，本次仅建立基准：');
    out.push('');
    for (const b of firstBaseline) {
      out.push(`- ${b.sku} / ${b.warehouse}：${b.available}`);
    }
  }

  return out.join('\n');
}

// 提炼商品名为 2-6 个关键词
function shortenName(name) {
  if (!name) return '';
  // 优先保留中英混合的关键规格：颜色、尺寸、容量、型号等
  // 简化策略：取前 4 个空格分词 + 移除常见修饰词
  const cleaned = name.replace(/[【】\[\]()（）]/g, ' ').replace(/\s+/g, ' ').trim();
  const tokens = cleaned.split(' ').filter(t => t.length > 0);
  if (tokens.length <= 4) return cleaned;
  // 取前 4 个 + 后 1 个（规格通常在后）
  return [...tokens.slice(0, 4), ...(tokens.length > 5 ? [tokens[tokens.length - 1]] : [])].join(' ');
}

// --- 生成 Excel 更新指令 ---
// 说明：
//   - 遍历全部 69 个 SKU，计算每个 SKU 的 美东(A) + 美西(B) 值
//   - 三仓都无记录的 SKU → value "0+0"（规则：完全没有记录的写 0+0）
//   - "表格中缺失的 SKU" 需由 sheetagent 读取 Excel A 列后判断：
//     即"ERP 有记录、但 Excel A 列不存在的 SKU" → 不新增行，仅列出
function generateExcelUpdates({ today, firstBaseline }) {
  const eastMap = new Map();   // sku -> 易达云美东仓可用库存
  const westMap = new Map();   // sku -> 盛宝隆美西仓（共仓）可用库存
  const southMap = new Map();  // sku -> 易可达美南仓可用库存

  for (const r of today.records) {
    if (r.warehouse === '易达云美东仓') eastMap.set(r.sku, r.available);
    else if (r.warehouse === '盛宝隆美西仓（共仓）') westMap.set(r.sku, r.available);
    else if (r.warehouse === '易可达美南仓') southMap.set(r.sku, r.available);
  }

  const baselineOnlySkus = new Set(firstBaseline.map(b => b.sku));

  const updates = [];
  for (const sku of SKU_ORDER) {
    const a = eastMap.has(sku) ? eastMap.get(sku) : 0;
    const b = westMap.has(sku) ? westMap.get(sku) : 0;
    const hasAny = eastMap.has(sku) || westMap.has(sku) || southMap.has(sku);

    updates.push({
      sku,
      value: `${a}+${b}`,
      redFlag: a <= 3 || b <= 3,
      // hasAny：ERP 里该 SKU 是否有任何记录（三个仓库任一）
      // 用于 sheetagent 判断"表格缺失 SKU"（ERP 有记录但表格无此 SKU）
      hasAny,
    });
  }

  // 有 ERP 记录（至少一个仓库有数据）的 SKU 集合
  const skusWithErpData = updates.filter(u => u.hasAny).map(u => u.sku);

  return { updates, skusWithErpData };
}

// --- 主流程 ---
async function main() {
  const inputFile = join(DATA_DIR, 'inventory-today.txt');
  if (!existsSync(inputFile)) {
    console.error(`未找到今日输入文件: ${inputFile}`);
    console.error('请将今日 ERP 查询数据按约定格式粘贴到该文件后重试。');
    process.exit(1);
  }

  const inputText = readFileSync(inputFile, 'utf8');
  const { pageTotal, records, rawRows, excludedRows } = parseTodayInput(inputText);
  const today = { records, capturedAt: new Date().toISOString() };

  // 找出"前一工作日"的快照
  const snapshots = readdirSync(SNAPSHOT_DIR)
    .filter(f => f.startsWith('snapshot-') && f.endsWith('.json'))
    .sort();

  let prevSnapshot = null;
  let prevFile = null;
  if (snapshots.length > 0) {
    prevFile = join(SNAPSHOT_DIR, snapshots[snapshots.length - 1]);
    prevSnapshot = JSON.parse(readFileSync(prevFile, 'utf8'));
    console.log(`读取到前一工作日快照: ${snapshots[snapshots.length - 1]}`);
  } else {
    console.log('未找到前一工作日快照，所有 SKU+仓库 将作为首次基准。');
  }

  // 1. 核对记录数（页面总记录数 vs 实际读取的行数，含排除仓）
  if (pageTotal !== null && pageTotal !== rawRows) {
    console.error(`❌ 记录数不一致：页面总记录数 = ${pageTotal}，实际读取行数 = ${rawRows}（含被排除仓库 ${excludedRows} 行）。`);
    console.error('按规则，网页读取不完整时不得保存快照或更新 Excel。请检查输入数据。');
    process.exit(2);
  }

  // 2. 比对
  const { changes, firstBaseline, matchedCount } = compareSnapshots(prevSnapshot, today);

  // 3. 生成报告
  const report = generateReport({
    today,
    pageTotal,
    rawRows,
    excludedRows,
    changes,
    firstBaseline,
    prevExists: !!prevSnapshot,
  });
  console.log('\n=== 报告 ===\n');
  console.log(report);
  writeFileSync(join(DATA_DIR, 'report-today.md'), report, 'utf8');

  // 4. 保存今日快照
  const todayDate = today.capturedAt.slice(0, 10);
  const todayFile = join(DATA_DIR, `snapshot-${todayDate}.json`);
  writeFileSync(todayFile, JSON.stringify(today, null, 2), 'utf8');
  console.log(`\n今日快照已保存: ${todayFile}`);

  // 5. 生成 Excel 更新指令
  const { updates, skusWithErpData } = generateExcelUpdates({ today, firstBaseline });
  writeFileSync(join(DATA_DIR, 'excel-updates.json'), JSON.stringify({ updates, skusWithErpData }, null, 2), 'utf8');
  console.log(`Excel 更新指令已生成: ${join(DATA_DIR, 'excel-updates.json')}`);

  // 6. 清理旧快照：只保留"前一工作日"和"今日"两份
  const allSnapshots = readdirSync(SNAPSHOT_DIR)
    .filter(f => f.startsWith('snapshot-') && f.endsWith('.json'))
    .sort();
  const keep = new Set();
  keep.add(`snapshot-${todayDate}.json`);          // 今日
  if (prevSnapshot) keep.add(snapshots[snapshots.length - 1]); // 前一工作日
  for (const f of allSnapshots) {
    if (!keep.has(f)) {
      try { unlinkSync(join(SNAPSHOT_DIR, f)); console.log(`已删除旧快照: ${f}`); }
      catch (e) { console.warn(`删除 ${f} 失败: ${e.message}`); }
    }
  }

  // 7. 输出完成总结
  console.log('\n=== 完成总结 ===');
  console.log(`1. 库存变化记录数：${changes.length}`);
  console.log(`2. 页面总记录数：${pageTotal ?? '未提供'}`);
  console.log(`3. 实际读取行数（含排除仓）：${rawRows}`);
  console.log(`4. 三个仓库纳入统计记录数：${records.length}（排除仓 ${excludedRows} 行）`);
  console.log(`5. 库存快照：${todayFile}`);
  console.log(`6. Excel 待更新 SKU 数：${updates.length}`);
  console.log(`7. ERP 有记录（供 sheetagent 判断表格缺失）：${skusWithErpData.length} 个 SKU`);
  console.log(`8. 首次基准 SKU+仓库 数：${firstBaseline.length}`);
}

main().catch(e => { console.error(e); process.exit(1); });