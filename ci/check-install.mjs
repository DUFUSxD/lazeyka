// node ci/check-install.mjs — проверка после установщика (install.sh / install.ps1) на Windows, macOS и Linux:
// ядро отвечает; настоящий Chrome загружает распакованное расширение; его ID — в allowed_origins помощника;
// помощник отвечает расширению на ping и start через native messaging (формула ID, место регистрации, протокол).
// Chrome управляется по каналу отладки (--remote-debugging-pipe): брендовый Chrome с версии 137 игнорирует
// --load-extension, официальная замена — команда Extensions.loadUnpacked.
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
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
const coreUp = async () => (await fetch('http://127.0.0.1:19090/version', { headers: { Authorization: `Bearer ${secret}` } })).json();
console.log('ядро:', (await until('API ядра', coreUp)).version);

// 2. регистрация помощника для Chrome
const hostJson = {
  win32: join(root, 'core', 'host.json'),
  darwin: join(homedir(), 'Library', 'Application Support', 'Google', 'Chrome', 'NativeMessagingHosts', 'com.lazeyka.host.json'),
  linux: join(homedir(), '.config', 'google-chrome', 'NativeMessagingHosts', 'com.lazeyka.host.json'),
}[os];
const host = JSON.parse(readFileSync(hostJson, 'utf8'));
console.log('помощник:', host.path, host.allowed_origins);

// 3. настоящий Chrome, протокол отладки по каналу: запись — fd 3, чтение — fd 4, сообщения разделены \0
const chrome = {
  win32: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  darwin: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  linux: 'google-chrome',
}[os];
// профиль по умолчанию, как у пользователя: без --user-data-dir headless Chrome берёт временный, а на Linux
// папку помощников (NativeMessagingHosts) Chrome ищет внутри профиля
const profile = {
  win32: join(process.env.LOCALAPPDATA ?? '', 'Google', 'Chrome', 'User Data'),
  darwin: join(homedir(), 'Library', 'Application Support', 'Google', 'Chrome'),
  linux: join(homedir(), '.config', 'google-chrome'),
}[os];
// помощник напрямую, тем же кадром, что шлёт Chrome: отделяет поломку помощника от поломки регистрации
if (os !== 'win32') { // на Windows path — host.bat относительно host.json, его проверяет только Chrome
  const direct = spawnSync(host.path, { input: Buffer.concat([Buffer.from([16, 0, 0, 0]), Buffer.from('{"cmd":"ping"}  ')]) });
  console.log('помощник напрямую:', direct.status, JSON.stringify(direct.stdout?.subarray(4).toString()), direct.stdout?.subarray(0, 4), direct.stderr?.toString().slice(0, 500));
}
const browser = spawn(chrome, ['--headless=new', '--remote-debugging-pipe', '--enable-unsafe-extension-debugging', `--user-data-dir=${profile}`,
  '--no-first-run', '--no-default-browser-check', ...(os === 'linux' ? ['--no-sandbox'] : []), 'about:blank'],
{ stdio: ['ignore', 'ignore', 'pipe', 'pipe', 'pipe'] });
let log = '';
browser.stderr.on('data', (d) => { log = (log + d).slice(-4000); });
let n = 0;
let buf = '';
const pending = new Map();
browser.stdio[4].on('data', (d) => {
  buf += d;
  for (let i; (i = buf.indexOf('\0')) >= 0; buf = buf.slice(i + 1)) {
    const m = JSON.parse(buf.slice(0, i));
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
  }
});
const send = (method, params = {}, sessionId) => new Promise((resolve, reject) => {
  const id = ++n;
  const timer = setTimeout(() => { pending.delete(id); reject(new Error(`${method}: нет ответа`)); }, 20000);
  pending.set(id, (m) => { clearTimeout(timer); if (m.error) reject(new Error(`${method}: ${m.error.message}`)); else resolve(m.result); });
  browser.stdio[3].write(`${JSON.stringify({ id, method, params, ...(sessionId && { sessionId }) })}\0`);
});

try {
  const { id } = await until('Chrome и Extensions.loadUnpacked', () => send('Extensions.loadUnpacked', { path: join(root, 'extension') }))
    .catch((e) => { console.log('вывод Chrome:\n', log); throw e; });
  console.log('ID в Chrome:', id);
  assert.ok(host.allowed_origins.includes(`chrome-extension://${id}/`), `ID ${id} нет в allowed_origins: формула ID не совпала с Chrome`);

  // 4. native messaging из service worker расширения
  const sw = await until('service worker расширения', async () => (await send('Target.getTargets')).targetInfos
    .find((t) => t.type === 'service_worker' && t.url.startsWith(`chrome-extension://${id}/`)));
  const { sessionId } = await send('Target.attachToTarget', { targetId: sw.targetId, flatten: true });
  const ask = async (cmd) => {
    const res = await send('Runtime.evaluate', { awaitPromise: true, returnByValue: true, expression: `new Promise((r) => {
      const p = chrome.runtime.connectNative('com.lazeyka.host');
      p.onMessage.addListener((m) => { r(m); p.disconnect(); });
      p.onDisconnect.addListener(() => r({ ok: false, error: chrome.runtime.lastError?.message ?? 'disconnect' }));
      p.postMessage({ cmd: '${cmd}' });
    })` }, sessionId);
    if (res.exceptionDetails || res.result?.value === undefined) console.log('evaluate:', JSON.stringify(res));
    return res.result?.value;
  };
  const manifest = JSON.parse(readFileSync(join(root, 'extension', 'manifest.json'), 'utf8'));
  const ping = await ask('ping');
  console.log('ping:', JSON.stringify(ping));
  assert.deepEqual(ping, { ok: true, version: manifest.version });
  const start = await ask('start');
  console.log('start:', JSON.stringify(start));
  assert.equal(start.ok, true);
  await until('ядро после start', coreUp);
  console.log('OK');
} catch (e) {
  console.error(e);
  process.exitCode = 1;
} finally {
  browser.kill();
  setTimeout(() => process.exit(), 500); // открытый канал не даёт node завершиться; код выхода — из exitCode
}
