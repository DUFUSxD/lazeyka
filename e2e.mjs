// node e2e.mjs path\to\mihomo.exe — прогон логики расширения против настоящего mihomo на фейковой подписке.
// Занимает порты 17890/19090/18888: рабочий mihomo на время теста останови.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { writeFileSync, readFileSync, mkdtempSync, rmSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { api, ensureConfig, pushConfig, GROUP, AUTO } from './extension/lib.js';

const exe = process.argv[2];
if (!exe) throw new Error('usage: node e2e.mjs <mihomo.exe>');
const dir = mkdtempSync(join(tmpdir(), 'spx-'));

// bootstrap-конфиг — ровно тот текст, что пишет core/mihomo.ps1
const secret = randomBytes(16).toString('hex');
const ps = readFileSync(new URL('./core/mihomo.ps1', import.meta.url), 'utf8');
writeFileSync(join(dir, 'config.yaml'), ps.match(/@"\r?\n([\s\S]*?)\r?\n"@/)[1].replace('$secret', secret));

const pbk = randomBytes(32).toString('base64url');
const links = [
  `vless://${crypto.randomUUID()}@127.0.0.1:1?encryption=none&security=reality&sni=example.com&fp=chrome&pbk=${pbk}&sid=ab&type=tcp&flow=xtls-rprx-vision#NL-1`,
  'trojan://pass@127.0.0.1:2?sni=example.com#DE-2',
  `ss://${Buffer.from('aes-128-gcm:pass').toString('base64')}@127.0.0.1:3#FI-3`,
];
const sub = Buffer.from(links.join('\n')).toString('base64');
let hits = 0;
const srv = createServer((_, res) => { hits++; res.end(sub); }).listen(18888, '127.0.0.1');

const auth = { headers: { Authorization: `Bearer ${secret}` } };
const start = () => spawn(exe, ['-d', dir], { stdio: 'ignore' });
const waitApi = async () => {
  for (let i = 0; i < 50; i++) {
    try { await fetch('http://127.0.0.1:19090/version', auth); return; } catch { await new Promise((r) => setTimeout(r, 200)); }
  }
  throw new Error('API mihomo не поднялся');
};

const s = { subs: ['http://127.0.0.1:18888/a', 'http://127.0.0.1:18888/b'], secret };
let p = start();
try {
  await waitApi();
  assert.equal((await fetch('http://127.0.0.1:19090/proxies')).status, 401, 'без secret API закрыт');
  assert.equal((await fetch(`http://127.0.0.1:19090/proxies/${GROUP}`, auth)).status, 404, 'bootstrap без группы');

  await ensureConfig(s);
  let g = await api(`/proxies/${GROUP}`, secret);
  assert.deepEqual(g.all.slice(0, 2), ['REJECT', AUTO]);
  assert.ok(g.all.includes('1| NL-1') && g.all.includes('2| NL-1') && g.all.includes('2| FI-3'), 'парсинг подписки и префиксы');
  assert.equal(g.now, 'REJECT');

  await api(`/proxies/${GROUP}`, secret, { method: 'PUT', body: JSON.stringify({ name: '1| DE-2' }) });
  assert.equal((await api(`/proxies/${GROUP}`, secret)).now, '1| DE-2');

  // сервера фейковые — mihomo отвечает 504 «all proxies timeout»
  const q = `url=${encodeURIComponent('https://www.gstatic.com/generate_204')}&timeout=2000`;
  await assert.rejects(api(`/group/${GROUP}/delay?${q}`, secret), /504/);
  // все сервера мертвы → «Авто» стоит на REJECT, а не на COMPATIBLE (это было бы «напрямую»)
  assert.equal((await api(`/proxies/${AUTO}`, secret)).now, 'REJECT');

  const before = hits;
  await api('/providers/proxies/sub1', secret, { method: 'PUT' });
  assert.ok(hits > before, 'refresh перекачивает подписку');

  // рестарт ядра: payload теряется, ensureConfig заливает заново, выбор восстанавливается
  p.kill(); await new Promise((r) => p.once('exit', r));
  p = start(); await waitApi();
  await ensureConfig(s);
  assert.equal((await api(`/proxies/${GROUP}`, secret)).now, '1| DE-2', 'store-selected');

  await pushConfig(s);
  assert.equal((await api(`/proxies/${GROUP}`, secret)).all.length, 8, 'повторная заливка идемпотентна');
  console.log('E2E OK');
} finally {
  p.kill(); srv.close();
  await new Promise((r) => setTimeout(r, 500));
  rmSync(dir, { recursive: true, force: true });
}
