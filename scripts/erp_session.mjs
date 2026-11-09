// 主后台（index.aspx）保活脚本（旧链路，一般不需要；备货页会话独立，用 erp_login_holder.mjs）
// 浏览器层：系统 Chrome + CDP（cdp.mjs）
import fs from 'fs';
import path from 'path';
import { cfg, WORKDIR, ensureDirs } from './config.mjs';
import { run } from './cdp.mjs';

const STATUS_FILE = path.join(WORKDIR, 'erp_session_status.json');
const ERP_URL = cfg.erp.loginUrl;

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
function writeStatus(obj) {
  try { fs.writeFileSync(STATUS_FILE, JSON.stringify(obj, null, 2)); } catch (e) { /* ignore */ }
}
function extractUrl(out) {
  const lines = String(out || '').split('\n').map(l => l.trim()).filter(l => l.startsWith('http'));
  return lines.length ? lines[lines.length - 1] : '';
}
const isLoginUrl = (url) => /N?Login\.aspx/i.test(url);

async function main() {
  ensureDirs();
  const deadline = Date.now() + 60 * 60 * 1000; // 保活 60 分钟
  let opened = false;
  let failCount = 0;

  writeStatus({ phase: 'starting', time: new Date().toISOString() });

  while (Date.now() < deadline) {
    if (!opened) {
      const r = await run(['open', ERP_URL], 90000);
      const ok = (r.stdout || '').includes('✓');
      writeStatus({
        phase: ok ? 'opened' : 'open_failed',
        time: new Date().toISOString(),
        detail: ((r.stdout || '') + (r.stderr || '')).slice(0, 400),
      });
      if (ok) { opened = true; failCount = 0; await sleep(6000); }
      else { await sleep(5000); }
      continue;
    }

    const r = await run(['get', 'url'], 30000);
    const url = extractUrl(r.stdout || '') || (r.stdout || '').trim();
    if (r.err || !url) {
      failCount++;
      writeStatus({
        phase: 'poll_error',
        failCount,
        time: new Date().toISOString(),
        detail: ((r.stderr || '') + ' ' + ((r.err && r.err.message) || '')).slice(0, 300),
      });
      if (failCount >= 3) { opened = false; failCount = 0; }
      await sleep(4000);
      continue;
    }
    failCount = 0;
    const loggedIn = !isLoginUrl(url);
    writeStatus({ phase: loggedIn ? 'logged_in' : 'waiting_login', url, time: new Date().toISOString() });
    await sleep(6000);
  }

  writeStatus({ phase: 'holder_expired', time: new Date().toISOString() });
}

main().catch(e => writeStatus({ phase: 'holder_crashed', error: String(e).slice(0, 300), time: new Date().toISOString() }));
