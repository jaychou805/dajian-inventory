import { execFile } from 'child_process';
import fs from 'fs';
import { cfg } from './config.mjs';

const NODE = cfg.paths.node;
const AB = cfg.paths.agentBrowser;
const PROFILE = cfg.paths.chromeProfile;
const STATUS_FILE = cfg.paths.workDir + '/erp_session_status.json';
const ERP_URL = cfg.erp.loginUrl;

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
  const deadline = Date.now() + 60 * 60 * 1000; // 保活 60 分钟
  let opened = false;
  let failCount = 0;
  let loggedInAnnounced = false;

  writeStatus({ phase: 'starting', time: new Date().toISOString() });

  while (Date.now() < deadline) {
    if (!opened) {
      const r = await run(['open', ERP_URL], 90000);
      const ok = (r.stdout || '').includes('✓');
      writeStatus({ phase: ok ? 'opened' : 'open_failed', time: new Date().toISOString(), detail: ((r.stdout || '') + (r.stderr || '')).slice(0, 400) });
      if (ok) { opened = true; failCount = 0; await sleep(6000); }
      else { await sleep(5000); }
      continue;
    }

    // 心跳轮询：保持 daemon 活跃 + 检测登录状态
    const r = await run(['get', 'url'], 30000);
    if (r.err && !(r.stdout || '').includes('http')) {
      failCount++;
      writeStatus({ phase: 'poll_error', failCount, time: new Date().toISOString(), detail: ((r.stderr || '') + ' ' + (r.err.message || '')).slice(0, 300) });
      if (failCount >= 3) { opened = false; failCount = 0; } // 连续失败则重开浏览器
      await sleep(4000);
      continue;
    }
    failCount = 0;
    const url = extractUrl(r.stdout || '');
    const loggedIn = url && !url.includes('Login.aspx');
    writeStatus({ phase: loggedIn ? 'logged_in' : 'waiting_login', url, time: new Date().toISOString() });
    if (loggedIn && !loggedInAnnounced) { loggedInAnnounced = true; }
    await sleep(6000);
  }

  writeStatus({ phase: 'holder_expired', time: new Date().toISOString() });
}

main().catch(e => writeStatus({ phase: 'holder_crashed', error: String(e).slice(0, 300), time: new Date().toISOString() }));
