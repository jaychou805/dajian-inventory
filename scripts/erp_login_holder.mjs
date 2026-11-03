// 登录保活窗口（备货页版）：打开 OverseasAnalysis.aspx（可能跳 NLogin），
// 用户在可见窗口内手动登录，轮询 URL 检测登录成功并写状态文件
import { execFile } from 'child_process';
import fs from 'fs';

const NODE = 'C:/Users/xiaozhihe/.workbuddy/binaries/node/versions/22.22.2-6/node.exe';
const AB = 'C:/Users/xiaozhihe/.workbuddy/binaries/node/versions/22.22.2-6/node_modules/agent-browser/bin/agent-browser.js';
const PROFILE = 'C:/Users/xiaozhihe/.workbuddy/erp-chrome-profile';
const STATUS_FILE = 'C:/Users/xiaozhihe/WorkBuddy/1/erp_session_status.json';
const ERP_URL = 'https://888.zhcxkj.com/IrobotBox/SalesAnalysis/OverseasAnalysis.aspx';

const GLOBAL_FLAGS = ['--profile', PROFILE, '--headed', '--args', '--no-sandbox,--disable-gpu'];

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function run(args, timeoutMs = 60000) {
  return new Promise((resolve) => {
    execFile(NODE, [AB, ...GLOBAL_FLAGS, ...args], { timeout: timeoutMs, windowsHide: true }, (err, stdout, stderr) => {
      resolve({ err, stdout: (stdout || '').toString(), stderr: (stderr || '').toString() });
    });
  });
}

function writeStatus(obj) {
  try { fs.writeFileSync(STATUS_FILE, JSON.stringify(obj, null, 2)); } catch (e) {}
}

function extractUrl(out) {
  const lines = out.split('\n').map(l => l.trim()).filter(l => l.startsWith('http'));
  return lines.length ? lines[lines.length - 1] : '';
}

async function main() {
  const deadline = Date.now() + 30 * 60 * 1000; // 保活 30 分钟
  let opened = false;
  let failCount = 0;

  writeStatus({ phase: 'starting', time: new Date().toISOString() });

  while (Date.now() < deadline) {
    if (!opened) {
      const r = await run(['open', ERP_URL], 150000);
      const ok = (r.stdout || '').includes('✓');
      writeStatus({ phase: ok ? 'opened' : 'open_failed', time: new Date().toISOString(), detail: ((r.stdout || '') + (r.stderr || '')).slice(0, 400) });
      if (ok) { opened = true; failCount = 0; await sleep(8000); }
      else { await sleep(5000); }
      continue;
    }

    // 轮询当前 URL：不在任何 Login 页 → 视为已登录
    const r = await run(['get', 'url'], 30000);
    if (r.err && !(r.stdout || '').includes('http')) {
      failCount++;
      writeStatus({ phase: 'poll_error', failCount, time: new Date().toISOString(), detail: ((r.stderr || '') + ' ' + (r.err.message || '')).slice(0, 300) });
      if (failCount >= 3) { opened = false; failCount = 0; }
      await sleep(4000);
      continue;
    }
    failCount = 0;
    const url = extractUrl(r.stdout || '');
    const loggedIn = url && !/Login\.aspx/i.test(url);
    writeStatus({ phase: loggedIn ? 'logged_in' : 'waiting_login', url, time: new Date().toISOString() });
    await sleep(6000);
  }

  writeStatus({ phase: 'holder_expired', time: new Date().toISOString() });
}

main().catch(e => writeStatus({ phase: 'holder_crashed', error: String(e).slice(0, 300), time: new Date().toISOString() }));
