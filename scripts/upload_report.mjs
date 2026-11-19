// 上传今日库存报告到 GitHub 仓库，并只保留最近 2 天的报告
// 用法：node scripts/upload_report.mjs [--dry-run]
//
// 行为：
//   1. 读 <workDir>/inventory-snapshots/report-today.md
//   2. 上传到仓库 reports/report-YYYY-MM-DD.md（按日期命名）
//   3. 更新 reports/latest.md（固定名，供「查看今天的库存报告」直接读取）
//   4. 列出 reports/ 下所有 report-*.md，删除最旧的，只保留最近 2 天 + latest.md
//
// 配置（config.json 的 github 段）：
//   github.repo   如 "jaychou805/dajian-inventory"
//   github.token  有 repo 权限的 PAT（ghp_...）；也可用环境变量 GITHUB_TOKEN 覆盖
//   github.branch 默认 "master"
//
// 退出码：0 成功；1 未配置 token/repo；2 报告文件不存在；其他 = 上传失败
import fs from 'fs';
import path from 'path';
import { cfg, DATA_DIR } from './config.mjs';

const dryRun = process.argv.includes('--dry-run');

const GH = cfg.github || {};
const TOKEN = process.env.GITHUB_TOKEN || GH.token || '';
const REPO = GH.repo || '';
const BRANCH = GH.branch || 'master';
const API = `https://api.github.com/repos/${REPO}`;

const today = new Date().toISOString().slice(0, 10);
const reportSrc = path.join(DATA_DIR, 'report-today.md');
const reportName = `report-${today}.md`;
const latestName = 'latest.md';

function log(msg) { console.log('[' + new Date().toISOString().slice(0, 19) + '] ' + msg); }

// Node 的 undici fetch 默认【不读】http_proxy/https_proxy 环境变量，
// 除非显式传 dispatcher。所以这里无需特殊处理即可直连 GitHub，避开本机代理 502。
async function noProxyFetch(url, opts = {}) {
  const headers = {
    'Authorization': 'token ' + TOKEN,
    'User-Agent': 'dajian-inventory-skill',
    'Accept': 'application/vnd.github+json',
    ...(opts.headers || {}),
  };
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 30000);
  try {
    return await fetch(url, {
      method: opts.method || 'GET',
      headers,
      body: opts.body,
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timer);
  }
}

// 读远端某个路径的 sha（不存在返回 null）
async function getRemoteSha(filePath) {
  const r = await noProxyFetch(`${API}/contents/${encodeURIComponent(filePath)}?ref=${BRANCH}`);
  if (r.status === 404) return null;
  if (!r.ok) throw new Error(`获取 ${filePath} 失败: ${r.status} ${await r.text()}`);
  const d = await r.json();
  return d.sha;
}

// 上传/更新单个文件
async function putFile(filePath, content, message) {
  const body = {
    message,
    content: Buffer.from(content, 'utf8').toString('base64'),
    branch: BRANCH,
  };
  const sha = await getRemoteSha(filePath);
  if (sha) body.sha = sha;

  if (dryRun) {
    log(`[dry-run] 将写入 ${filePath}（${content.length} 字节）`);
    return;
  }
  const r = await noProxyFetch(`${API}/contents/${encodeURIComponent(filePath)}`, {
    method: 'PUT',
    body: JSON.stringify(body),
  });
  if (!r.ok) throw new Error(`写入 ${filePath} 失败: ${r.status} ${await r.text()}`);
  log('✓ 已写入 ' + filePath);
}

// 删除远端文件
async function deleteFile(filePath, message) {
  const sha = await getRemoteSha(filePath);
  if (!sha) return; // 不存在就不用删
  if (dryRun) { log(`[dry-run] 将删除 ${filePath}`); return; }
  const r = await noProxyFetch(`${API}/contents/${encodeURIComponent(filePath)}`, {
    method: 'DELETE',
    body: JSON.stringify({ message, sha, branch: BRANCH }),
  });
  if (!r.ok) throw new Error(`删除 ${filePath} 失败: ${r.status} ${await r.text()}`);
  log('✓ 已删除 ' + filePath);
}

// 列出 reports/ 下的文件
async function listReports() {
  const r = await noProxyFetch(`${API}/contents/reports?ref=${BRANCH}`);
  if (r.status === 404) return [];
  if (!r.ok) throw new Error(`列出 reports/ 失败: ${r.status} ${await r.text()}`);
  const arr = await r.json();
  return arr.filter((f) => f.type === 'file').map((f) => f.name);
}

async function main() {
  if (!TOKEN) { log('✖ 未配置 GitHub token（config.json 的 github.token 或环境变量 GITHUB_TOKEN）'); process.exit(1); }
  if (!REPO) { log('✖ 未配置 github.repo（如 jaychou805/dajian-inventory）'); process.exit(1); }
  if (!fs.existsSync(reportSrc)) { log('✖ 报告不存在：' + reportSrc); process.exit(2); }

  const report = fs.readFileSync(reportSrc, 'utf8');
  log(`准备上传报告（${report.length} 字节）到 ${REPO}@${BRANCH}`);

  // 1. 按日期上传今日报告
  await putFile(`reports/${reportName}`, report, `report: ${today} 库存日报`);

  // 2. 更新 latest.md（固定名，供「查看今天报告」）
  await putFile(`reports/${latestName}`, report, `report: 更新 latest.md（${today}）`);

  // 3. 清理：只保留最近 2 天的 report-*.md
  const all = (await listReports())
    .filter((n) => /^report-\d{4}-\d{2}-\d{2}\.md$/.test(n))
    .sort(); // 字典序即日期序（YYYY-MM-DD 天然有序）
  const keep = new Set([reportName]);
  const older = all.filter((n) => n !== reportName);
  if (older.length >= 1) keep.add(older[older.length - 1]); // 再保留最近 1 天

  for (const n of all) {
    if (!keep.has(n)) {
      log('· 清理旧报告：' + n);
      await deleteFile(`reports/${n}`, `report: 清理旧报告 ${n}（只保留最近 2 天）`);
    }
  }

  log('完成：保留报告 = ' + [...keep].sort().join(', ') + ' + ' + latestName);
  process.exit(0);
}

main().catch((e) => { log('✖ 上传失败：' + (e.message || e)); process.exit(4); });
