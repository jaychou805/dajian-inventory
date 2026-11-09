// 系统 Chrome + CDP 直连封装（零依赖），替代原 agent-browser 方案。
//
// 为什么不用 agent-browser：
//   1) agent-browser 0.27.0 的逻辑是「自己指定 --remote-debugging-port=N + 等 DevToolsActivePort 文件」，
//      而 Chrome 157+ 只在端口为 0（自动分配）时才写这个文件 → 必然超时；
//   2) 升级 agent-browser 要求 node>=24，且它预编译的 exe / 下载的 Chrome for Testing
//      在开了 WDAC（应用程序控制策略）的机器上会被拦截（os error 4551）；
//   3) 直接用 Program Files 里的系统 Chrome + Node 22 内置 WebSocket 走 CDP，零依赖、不受 WDAC 影响。
//
// 对外只暴露一个与旧脚本调用点兼容的 run(args, timeoutMs)：
//   run(['close'])            → 关闭浏览器
//   run(['open', url])        → 打开页面，stdout = '✓ <最终URL>'（跳登录页时 URL 里带 Login.aspx）
//   run(['eval', '-b', b64])  → 在页面执行脚本（支持 Promise），stdout = JSON.stringify(返回值)
//   run(['get', 'url'])       → 当前页面 URL
//   run(['get', 'title'])     → 页面标题
import { spawn, execFile } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { cfg, CHROME_PROFILE, BROWSER } from './config.mjs';

const state = { child: null, port: 0, owned: false, page: null, cdp: null };

function log(msg) { console.log('[cdp] ' + msg); }
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

const CHROME_CANDIDATES = [
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  process.env.LOCALAPPDATA ? path.join(process.env.LOCALAPPDATA, 'Google/Chrome/Application/chrome.exe') : null,
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/google-chrome',
  '/usr/bin/google-chrome-stable',
  '/usr/bin/chromium-browser',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
];

export function resolveChromePath() {
  const fromCfg = cfg.paths && cfg.paths.chrome;
  if (fromCfg && fs.existsSync(fromCfg)) return fromCfg;
  if (process.env.CHROME_PATH && fs.existsSync(process.env.CHROME_PATH)) return process.env.CHROME_PATH;
  for (const c of CHROME_CANDIDATES) {
    if (c && fs.existsSync(c)) return c;
  }
  return null;
}

/** 极简 HTTP GET/PUT，用于 CDP 的 /json/* 端点 */
function httpJson(port, pathname, method = 'GET', timeout = 8000) {
  return new Promise((resolve) => {
    let done = false;
    const finish = (v) => { if (!done) { done = true; resolve(v); } };
    const req = http.request({ host: '127.0.0.1', port, path: pathname, method, timeout }, (res) => {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', (c) => { body += c; });
      res.on('end', () => {
        let data = null;
        try { data = JSON.parse(body); } catch (e) { data = null; }
        finish({ ok: res.statusCode >= 200 && res.statusCode < 300, status: res.statusCode, data, body });
      });
    });
    req.on('error', (e) => finish({ ok: false, error: e }));
    req.on('timeout', () => { req.destroy(); finish({ ok: false, error: new Error('HTTP timeout') }); });
    req.end();
  });
}

function readPortFile(profile) {
  const f = path.join(profile, 'DevToolsActivePort');
  try {
    const lines = fs.readFileSync(f, 'utf8').split('\n').map(s => s.trim()).filter(Boolean);
    if (lines.length >= 1 && /^\d+$/.test(lines[0])) {
      return { port: parseInt(lines[0], 10), wsPath: lines[1] || '' };
    }
  } catch (e) { /* 文件还没生成 */ }
  return null;
}

/**
 * 等浏览器真正「可连」而不是只等端口文件：
 * DevToolsActivePort 往往先于 HTTP 端点就绪写入，只判文件存在会误判成启动失败。
 * 每轮都重读文件（Chrome 自重启时端口会变），拿到端口后再轮询 /json/version。
 */
async function waitDevToolsReady(profile, st, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  let exitSeenAt = 0;
  while (Date.now() < deadline) {
    const info = readPortFile(profile);
    if (info) {
      for (let i = 0; i < 10 && Date.now() < deadline; i++) {
        if (await probeVersion(info.port)) return info.port;
        await sleep(400);
      }
    }
    if (st.exited) {
      // 进程已退出且端口一直不可用（真实失败）；但 Chrome 首次初始化时也可能「父进程退出、子进程接管」，给 3s 观察期
      if (!exitSeenAt) exitSeenAt = Date.now();
      else if (Date.now() - exitSeenAt > 3000) return 0;
    }
    await sleep(300);
  }
  return 0;
}

async function probeVersion(port) {
  const r = await httpJson(port, '/json/version', 'GET', 3000);
  return (r.ok && r.data && r.data.webSocketDebuggerUrl) ? r.data : null;
}

function killTree(child) {
  if (!child) return;
  try {
    if (process.platform === 'win32') {
      execFile('taskkill', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true }, () => {});
    } else {
      child.kill('SIGKILL');
    }
  } catch (e) { /* ignore */ }
  try { child.kill('SIGKILL'); } catch (e) { /* ignore */ }
}

/** CDP 客户端：一条 WebSocket 走一个页面 target */
class Cdp {
  constructor(wsUrl) {
    this.wsUrl = wsUrl;
    this.nextId = 0;
    this.pending = new Map();
    this.ws = null;
  }

  connect(timeoutMs = 15000) {
    if (typeof WebSocket === 'undefined') {
      return Promise.reject(new Error('当前 Node 没有内置 WebSocket，请用 Node 22+ 运行'));
    }
    return new Promise((resolve, reject) => {
      let settled = false;
      const ws = new WebSocket(this.wsUrl);
      this.ws = ws;
      const timer = setTimeout(() => {
        if (!settled) { settled = true; reject(new Error('CDP WebSocket 连接超时')); }
      }, timeoutMs);

      ws.addEventListener('open', () => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve();
      });
      ws.addEventListener('error', () => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        reject(new Error('CDP WebSocket 连接失败'));
      });
      ws.addEventListener('close', () => {
        for (const [, p] of this.pending) { clearTimeout(p.timer); p.reject(new Error('CDP 连接已关闭')); }
        this.pending.clear();
      });
      ws.addEventListener('message', (ev) => {
        let msg;
        try { msg = JSON.parse(ev.data); } catch (e) { return; }
        if (!msg.id) return; // 事件消息，忽略
        const p = this.pending.get(msg.id);
        if (!p) return;
        this.pending.delete(msg.id);
        clearTimeout(p.timer);
        if (msg.error) p.reject(new Error((msg.error.message || 'CDP error') + ' (' + msg.error.code + ')'));
        else p.resolve(msg.result);
      });
    });
  }

  send(method, params = {}, timeoutMs = 60000) {
    if (!this.ws || this.ws.readyState !== 1) {
      return Promise.reject(new Error('CDP 未连接，无法执行 ' + method));
    }
    const id = ++this.nextId;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(method + ' 超时（' + timeoutMs + 'ms）'));
      }, timeoutMs);
      this.pending.set(id, { resolve, reject, timer });
      try {
        this.ws.send(JSON.stringify({ id, method, params }));
      } catch (e) {
        clearTimeout(timer);
        this.pending.delete(id);
        reject(e);
      }
    });
  }

  close() {
    try { if (this.ws) this.ws.close(); } catch (e) { /* ignore */ }
    this.ws = null;
  }
}

async function createTarget(port, url) {
  // Chrome 111+ 要求 PUT；老版本接受 GET，两种都试
  const q = '/json/new?' + encodeURIComponent(url || 'about:blank');
  let r = await httpJson(port, q, 'PUT', 15000);
  if (!r.ok || !r.data) r = await httpJson(port, q, 'GET', 15000);
  if (!r.ok || !r.data || !r.data.webSocketDebuggerUrl) {
    throw new Error('创建标签页失败：' + (r.status || (r.error && r.error.message) || 'unknown'));
  }
  return r.data;
}

async function attachPage(port, url) {
  const target = await createTarget(port, url || 'about:blank');
  const cdp = new Cdp(target.webSocketDebuggerUrl);
  await cdp.connect();
  try { await cdp.send('Page.enable', {}, 10000); } catch (e) { /* 非必需 */ }
  try { await cdp.send('Runtime.enable', {}, 10000); } catch (e) { /* 非必需 */ }
  state.cdp = cdp;
  state.page = { targetId: target.id || '', wsUrl: target.webSocketDebuggerUrl };
  return state.page;
}

/** 启动（或复用）浏览器并挂上一个页面 target */
export async function ensureBrowser(opts = {}) {
  if (state.cdp && state.page && !opts.forceNew) return state;

  const profile = CHROME_PROFILE;
  fs.mkdirSync(profile, { recursive: true });

  // 1) 已经有带调试端口的实例在跑 → 直接复用（避免 profile 被占导致 DevToolsActivePort 不生成）
  if (!opts.forceNew) {
    const info = readPortFile(profile);
    if (info && await probeVersion(info.port)) {
      log('复用已运行的 Chrome 调试实例，端口 ' + info.port);
      state.port = info.port;
      state.owned = false;
      await attachPage(info.port, 'about:blank');
      return state;
    }
  }

  const chrome = resolveChromePath();
  if (!chrome) {
    throw new Error('未找到 Chrome。请在 config.json 的 paths.chrome 里写上 chrome.exe 的绝对路径');
  }
  const headless = opts.headless !== undefined ? opts.headless : BROWSER.headless;
  const launchTimeout = opts.launchTimeoutMs || BROWSER.launchTimeoutMs || 30000;

  const portFile = path.join(profile, 'DevToolsActivePort');
  try { fs.unlinkSync(portFile); } catch (e) { /* 无残留 */ }

  const args = [
    '--remote-debugging-port=0',          // 必须 0：Chrome 157+ 只有自动分配端口才会写 DevToolsActivePort
    '--user-data-dir=' + profile,         // 登录态持久化的关键
    '--remote-allow-origins=*',           // 允许 Node 内置 WebSocket 直连
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-gpu',
    '--disable-background-timer-throttling',
    '--disable-renderer-backgrounding',
    '--window-size=1440,900',
    'about:blank',
  ];
  if (headless) args.unshift('--headless=new');
  if (process.platform !== 'darwin') args.unshift('--no-sandbox');

  let lastErr = '';
  for (let attempt = 1; attempt <= 2; attempt++) {
    log('启动 Chrome（第 ' + attempt + ' 次）：' + chrome);
    const child = spawn(chrome, args, { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: false });
    state.child = child;
    state.owned = true;

    const st = { exited: false, code: null, stderr: '' };
    child.stderr.on('data', (d) => { st.stderr = (st.stderr + d.toString()).slice(-1200); });
    child.stdout.on('data', () => { /* 丢弃 */ });

    child.on('exit', (code) => { st.exited = true; st.code = code; });
    child.on('error', (e) => { st.exited = true; st.stderr = String((e && e.message) || e); });

    const port = await waitDevToolsReady(profile, st, launchTimeout);
    if (port) {
      state.port = port;
      log('Chrome 已就绪，调试端口 ' + port);
      await attachPage(port, 'about:blank');
      return state;
    }

    lastErr = st.exited
      ? 'Chrome 提前退出 (code=' + st.code + ')：' + st.stderr.replace(/\s+/g, ' ').slice(0, 300)
      : launchTimeout / 1000 + 's 内没有可连接的调试端口';

    killTree(child);
    state.child = null;
    state.owned = false;
    // 清理上次残留的 profile 单实例锁（此时已确认没有可用的调试实例）
    for (const n of ['SingletonLock', 'SingletonCookie', 'SingletonSocket']) {
      try { fs.unlinkSync(path.join(profile, n)); } catch (e) { /* ignore */ }
    }
    await sleep(1500);
  }
  throw new Error('Chrome 启动失败：' + lastErr);
}

async function rawEval(expression, timeoutMs = 200000) {
  if (!state.cdp) await ensureBrowser();
  const res = await state.cdp.send('Runtime.evaluate', {
    expression,
    awaitPromise: true,      // js_extract_all.js 返回 Promise，必须等
    returnByValue: true,
    userGesture: true,       // 允许 click 等需要手势的操作
  }, timeoutMs);
  if (res && res.exceptionDetails) {
    const d = res.exceptionDetails;
    const desc = (d.exception && (d.exception.description || d.exception.value)) || d.text || '';
    throw new Error('页面脚本异常：' + String(desc).slice(0, 400));
  }
  return res && res.result ? res.result.value : undefined;
}

export async function getUrl() {
  try { return await rawEval('location.href', 15000); } catch (e) { return ''; }
}

async function waitLoaded(timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      if (await rawEval('document.readyState', 8000) === 'complete') {
        await sleep(1200); // 给 jQuery/组件一点渲染时间
        return true;
      }
    } catch (e) { /* 导航过程中执行上下文会被重建，重试即可 */ }
    await sleep(500);
  }
  return false;
}

export async function navigate(url, timeoutMs = 60000) {
  await ensureBrowser();
  await state.cdp.send('Page.navigate', { url }, 30000);
  await waitLoaded(timeoutMs);
  return getUrl();
}

export async function closeBrowser() {
  try { if (state.cdp) state.cdp.close(); } catch (e) { /* ignore */ }
  state.cdp = null;
  state.page = null;
  if (state.owned && state.child) killTree(state.child);
  state.child = null;
  state.owned = false;
  state.port = 0;
}

/**
 * 与旧 agent-browser 调用点兼容的入口。
 * 返回 { err, stdout, stderr }，业务脚本只用 stdout 判断结果，故输出格式保持原样。
 */
export async function run(args, timeoutMs = 90000) {
  const argv = Array.isArray(args) ? [...args] : [String(args)];
  const cmd = (argv[0] || '').toLowerCase();
  try {
    if (cmd === 'close') {
      await closeBrowser();
      return { err: null, stdout: '✓ closed', stderr: '' };
    }
    if (cmd === 'open') {
      const finalUrl = await navigate(argv[1], timeoutMs);
      return { err: null, stdout: '✓ ' + finalUrl, stderr: '' };
    }
    if (cmd === 'eval') {
      const bi = argv.indexOf('-b');
      let js;
      if (bi >= 0) js = Buffer.from(argv[bi + 1] || '', 'base64').toString('utf8');
      else js = argv.slice(1).join(' ');
      const value = await rawEval(js, timeoutMs);
      return { err: null, stdout: JSON.stringify(value === undefined ? null : value), stderr: '' };
    }
    if (cmd === 'get') {
      const what = (argv[1] || 'url').toLowerCase();
      if (what === 'url') return { err: null, stdout: await getUrl(), stderr: '' };
      if (what === 'title') return { err: null, stdout: String(await rawEval('document.title', 15000)), stderr: '' };
      throw new Error('不支持的 get 目标：' + what);
    }
    throw new Error('不支持的命令：' + cmd);
  } catch (e) {
    return { err: e, stdout: '', stderr: String((e && e.message) || e) };
  }
}

// 进程退出时兜底清理自己拉起的 Chrome，避免留下孤儿进程
process.on('exit', () => {
  if (state.owned && state.child) {
    try { state.child.kill('SIGKILL'); } catch (e) { /* ignore */ }
  }
});
