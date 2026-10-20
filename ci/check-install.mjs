// node ci/check-install.mjs — проверка после установщика (install.sh / install.ps1) на Windows, macOS и Linux:
// ядро отвечает; настоящий Chrome загружает распакованное расширение; его ID — в allowed_origins помощника;
// помощник отвечает расширению на ping и start через native messaging (формула ID, место регистрации, протокол).
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { homedir, platform } from 'node:os';
import { join } from 'node:path';

const os = platform();
const root = os === 'win32' ? join(process.env.LOCALAPPDATA, 'Lazeyka') : join(homedir(), 'Lazeyka');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const until = async (what, fn, ms = 30000) => {
  for (const end = Date.now() + ms; Date.now() < end; await sleep(500)) {
    const v = await fn().catch(() => null);
    if (v) return v;
  }
  throw new Error(`не дождался: ${what}`);
};

// 1. ядро
const secret = readFileSync(join(root, 'core', 'config.yaml'), 'utf8').match(/secret: "([^"]+)"/)[1];
const ver = await until('API ядра', async () => (await fetch('http://127.0.0.1:19090/version', { headers: { Authorization: `Bearer ${secret}` } })).json());
console.log('ядро:', ver.version);

// 2. регистрация помощника для Chrome
const hostJson = {
  win32: join(root, 'core', 'host.json'),
  darwin: join(homedir(), 'Library', 'Application Support', 'Google', 'Chrome', 'NativeMessagingHosts', 'com.lazeyka.host.json'),
  linux: join(homedir(), '.config', 'google-chrome', 'NativeMessagingHosts', 'com.lazeyka.host.json'),
}[os];
const host = JSON.parse(readFileSync(hostJson, 'utf8'));
console.log('помощник:', host.path, host.allowed_origins);

// 3. настоящий Chrome с распакованным расширением
const chrome = {
  win32: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  darwin: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  linux: 'google-chrome',
}[os];
const args = ['--headless=new', '--remote-debugging-port=9222', '--no-first-run', '--no-default-browser-check',
  '--disable-features=DisableLoadExtensionCommandLineSwitch', `--load-extension=${join(root, 'extension')}`,
  ...(os === 'linux' ? ['--no-sandbox'] : []), 'about:blank'];
const browser = spawn(chrome, args, { stdio: ['ignore', 'pipe', 'pipe'] });
let log = '';
browser.stdout.on('data', (d) => { log += d; });
browser.stderr.on('data', (d) => { log += d; });
try {
  const sw = await until('service worker расширения', async () => (await (await fetch('http://127.0.0.1:9222/json')).json())
    .find((t) => t.type === 'service_worker' && t.url.endsWith('/background.js'))).catch(async (e) => {
    const targets = await fetch('http://127.0.0.1:9222/json').then((r) => r.json()).catch((x) => x.message);
    const version = await fetch('http://127.0.0.1:9222/json/version').then((r) => r.json()).catch((x) => x.message);
    console.log('Chrome:', JSON.stringify(version), '\nцели:', JSON.stringify(targets, null, 1), '\nвывод Chrome:\n', log.slice(-3000));
    throw e;
  });
  const id = new URL(sw.url).host;
  console.log('ID в Chrome:', id);
  assert.ok(host.allowed_origins.includes(`chrome-extension://${id}/`), `ID ${id} нет в allowed_origins: формула ID не совпала с Chrome`);

  // 4. native messaging из service worker расширения
  const ws = new WebSocket(sw.webSocketDebuggerUrl);
  await new Promise((r, j) => { ws.onopen = r; ws.onerror = j; });
  let n = 0;
  const pending = new Map();
  ws.onmessage = (e) => { const m = JSON.parse(e.data); pending.get(m.id)?.(m); pending.delete(m.id); };
  const ask = (cmd) => new Promise((resolve) => {
    const mid = ++n;
    pending.set(mid, (m) => resolve(m.result?.result?.value ?? m.result?.exceptionDetails));
    ws.send(JSON.stringify({ id: mid, method: 'Runtime.evaluate', params: { awaitPromise: true, returnByValue: true, expression: `new Promise((r) => {
      const p = chrome.runtime.connectNative('com.lazeyka.host');
      p.onMessage.addListener((m) => { r(m); p.disconnect(); });
      p.onDisconnect.addListener(() => r({ ok: false, error: chrome.runtime.lastError?.message ?? 'disconnect' }));
      p.postMessage({ cmd: '${cmd}' });
    })` } }));
  });
  const manifest = JSON.parse(readFileSync(join(root, 'extension', 'manifest.json'), 'utf8'));
  const ping = await ask('ping');
  console.log('ping:', JSON.stringify(ping));
  assert.deepEqual(ping, { ok: true, version: manifest.version });
  const start = await ask('start');
  console.log('start:', JSON.stringify(start));
  assert.equal(start.ok, true);
  await until('ядро после start', async () => (await fetch('http://127.0.0.1:19090/version', { headers: { Authorization: `Bearer ${secret}` } })).ok);
  ws.close();
  console.log('OK');
} finally {
  browser.kill();
}
