// CDP 版单次调试工具：一条命令做一件事，跑完自动关浏览器。
//
// 用法：
//   node scripts/ab_run.mjs open "https://888.zhcxkj.com/IrobotBox/SalesAnalysis/OverseasAnalysis.aspx"
//   node scripts/ab_run.mjs get url
//   node scripts/ab_run.mjs get title
//   node scripts/ab_run.mjs eval "document.title"
//   node scripts/ab_run.mjs eval -b <base64 的 JS>
//   node scripts/ab_run.mjs close
//
// 想连续多步操作同一个页面，请写脚本 import { run } from './cdp.mjs'（同进程内浏览器会话复用）。
// 超时可用环境变量 AB_TIMEOUT 调整（毫秒，默认 90000）。
import { run, closeBrowser } from './cdp.mjs';

const argv = process.argv.slice(2);
if (argv.length === 0) {
  console.error('用法: node ab_run.mjs <open|eval|get|close> [...]');
  process.exit(2);
}

const timeoutMs = parseInt(process.env.AB_TIMEOUT || '90000', 10);

const r = await run(argv, timeoutMs);
if (r.stdout) process.stdout.write(r.stdout.endsWith('\n') ? r.stdout : r.stdout + '\n');
if (r.stderr) process.stderr.write(r.stderr + '\n');

// close 之外的命令也统一收尾，避免残留 Chrome
try { await closeBrowser(); } catch (e) { /* ignore */ }

process.exit(r.err ? 1 : 0);
