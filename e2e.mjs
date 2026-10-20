// node e2e.mjs path\to\mihomo.exe — логика расширения против настоящего mihomo.
// Поднимает два живых фейковых сервера (HTTP-прокси) и подписки на них; нужен интернет (health-check идёт на cp.cloudflare.com).
// Занимает порты 17890/19090 и 18888/18891/18892: рабочий mihomo на время теста останови.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import http from 'node:http';
import net from 'node:net';
import { writeFileSync, readFileSync, mkdtempSync, rmSync } from 'node:fs';
import { randomBytes, randomUUID } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { api, ensureConfig, pushConfig, health, selectServer, testGroup, DEFAULTS, GROUP, AUTO } from './extension/lib.js';

const exe = process.argv[2];
if (!exe) throw new Error('usage: node e2e.mjs <mihomo.exe>');
const dir = mkdtempSync(join(tmpdir(), 'lzk-'));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// bootstrap-конфиг — ровно тот текст, что пишет core/mihomo.ps1
const secret = randomBytes(16).toString('hex');
const ps = readFileSync(new URL('./core/mihomo.ps1', import.meta.url), 'utf8');
writeFileSync(join(dir, 'config.yaml'), ps.match(/@"\r?\n([\s\S]*?)\r?\n"@/)[1].replace('$secret', secret));

// Фейковый сервер: HTTP-прокси (mihomo ходит через него CONNECT'ом). Домены *.lzk — «интернет», отвечаем сами.
const seen = { A: [], B: [] };
function fakeServer(name, port) {
  return net.createServer((sock) => {
    sock.on('error', () => {});
    sock.once('data', (buf) => {
      sock.pause(); // до подключения к цели ничего не теряем; pipe() продолжит чтение
      const target = buf.toString('latin1').match(/^CONNECT (\S+):(\d+) /);
      if (!target) return sock.destroy();
      const [, host, p] = target;
      seen[name].push(`${host}:${p}`);
      sock.write('HTTP/1.1 200 Connection established\r\n\r\n');
      if (host.endsWith('.lzk')) {
        sock.once('data', () => sock.end(`HTTP/1.1 200 OK\r\nContent-Length: ${4 + name.length}\r\nConnection: close\r\n\r\nvia:${name}`));
        sock.resume();
        return;
      }
      const up = net.connect({ port: +p, host, family: 4 }, () => { up.pipe(sock); sock.pipe(up); });
      up.on('error', () => sock.destroy());
    });
  }).listen(port, '127.0.0.1');
}
const servers = [fakeServer('A', 18891), fakeServer('B', 18892)];

let yaml = 'proxies:\n'
  + '  - {name: A, type: http, server: 127.0.0.1, port: 18891}\n'
  + '  - {name: B, type: http, server: 127.0.0.1, port: 18892}\n'
  + '  - {name: C, type: http, server: 127.0.0.1, port: 1}\n';
const b64 = Buffer.from([ // формат 3x-ui: base64 со ссылками; сервера мёртвые, проверяем только разбор
  `vless://${randomUUID()}@127.0.0.1:1?encryption=none&security=reality&sni=example.com&fp=chrome&pbk=${randomBytes(32).toString('base64url')}&sid=ab&type=tcp&flow=xtls-rprx-vision#NL-1`,
  'trojan://pass@127.0.0.1:2?sni=example.com#DE-2',
  `ss://${Buffer.from('aes-128-gcm:pass').toString('base64')}@127.0.0.1:3#FI-3`,
].join('\n')).toString('base64');
let hits = 0;
// /yaml отдаёт ещё и трафик со сроком, как 3x-ui / Marzban / Remnawave
const USERINFO = 'upload=1073741824; download=2147483648; total=10737418240; expire=1893456000';
const subSrv = http.createServer((req, res) => {
  hits++;
  if (req.url === '/yaml') res.setHeader('subscription-userinfo', USERINFO);
  res.end(req.url === '/yaml' ? yaml : b64);
}).listen(18888, '127.0.0.1');

// Запрос «из браузера» через HTTP-вход mihomo.
const viaCore = (url) => new Promise((resolve) => {
  const req = http.request({ host: '127.0.0.1', port: 17890, path: url, headers: { Host: new URL(url).host } }, (res) => {
    let b = '';
    res.on('data', (d) => { b += d; });
    res.on('end', () => resolve(res.statusCode === 200 ? b : `HTTP ${res.statusCode}`));
  });
  req.on('error', (e) => resolve(`ERR ${e.code}`));
  req.setTimeout(8000, () => { req.destroy(); resolve('TIMEOUT'); });
  req.end();
});

const auth = { headers: { Authorization: `Bearer ${secret}` } };
const start = () => spawn(exe, ['-d', dir], { stdio: 'ignore' });
const waitApi = async () => {
  for (let i = 0; i < 50; i++) {
    try { await fetch('http://127.0.0.1:19090/version', auth); return; } catch { await sleep(200); }
  }
  throw new Error('API mihomo не поднялся');
};

const s = {
  ...DEFAULTS, secret,
  subs: ['http://127.0.0.1:18888/yaml', 'http://127.0.0.1:18888/b64'],
  siteServers: { 'b.lzk': '1| B', 'gone.lzk': '1| ZZZ', 'auto.lzk': AUTO },
  subNames: { 'http://127.0.0.1:18888/yaml': 'Мой VPN' },
};
let p = start();
try {
  await waitApi();
  assert.equal((await fetch('http://127.0.0.1:19090/proxies')).status, 401, 'без secret API закрыт');
  assert.equal((await fetch(`http://127.0.0.1:19090/proxies/${GROUP}`, auth)).status, 404, 'bootstrap без группы');

  await ensureConfig(s);
  // сразу после заливки «Авто» уже стоит на живом сервере, а не висит 10 с на REJECT
  assert.match((await api(`/proxies/${AUTO}`, secret)).now, /^1\| [AB]$/, 'Авто сразу нашёл живой');

  let h = await health(s);
  assert.deepEqual(h.all, [AUTO, '1| A', '1| B', '1| C', '2| NL-1', '2| DE-2', '2| FI-3'], 'YAML и base64 подписки, префиксы');
  assert.equal(h.now, 'REJECT'); // первый запуск: popup сам переключит на Авто
  assert.ok(h.nodes.get('1| A').alive && h.nodes.get('1| A').delay > 0);
  assert.equal(h.nodes.get('1| C').delay, 0);
  assert.equal(h.dead, false);
  // серверы по подпискам: своё название или домен, трафик и срок из заголовка
  assert.deepEqual(h.subs.map((x) => [x.key, x.name, x.servers]), [
    ['sub1', 'Мой VPN', ['1| A', '1| B', '1| C']],
    ['sub2', '127.0.0.1', ['2| NL-1', '2| DE-2', '2| FI-3']],
  ]);
  assert.deepEqual(h.subs[0].info, { Upload: 1073741824, Download: 2147483648, Total: 10737418240, Expire: 1893456000 }, JSON.stringify(h.subs[0].info));
  assert.equal(h.subs[1].info, null, 'без заголовка — без трафика');

  await selectServer(AUTO, secret);
  assert.match(await viaCore('http://x.lzk/'), /^via:[AB]$/, 'обычный сайт — через Авто');
  assert.match(await viaCore('http://auto.lzk/'), /^via:[AB]$/, 'свой сервер = Авто');
  // общий сервер — A, чтобы привязка к B была видна однозначно
  await selectServer('1| A', secret);
  assert.equal(await viaCore('http://x.lzk/'), 'via:A', 'обычный сайт — через выбранный сервер');
  assert.equal(await viaCore('http://b.lzk/'), 'via:B', 'сайт со своим сервером');
  assert.equal(await viaCore('http://www.b.lzk/'), 'via:B', 'и его поддомены');
  assert.doesNotMatch(await viaCore('http://gone.lzk/'), /^via:/, 'сервера нет в подписке — блок, не напрямую');

  // выбран мёртвый сервер: трафик не уходит напрямую, health это видит
  await selectServer('1| C', secret);
  assert.doesNotMatch(await viaCore('http://x.lzk/'), /^via:/, 'kill switch');
  await testGroup(GROUP, secret);
  h = await health(s);
  assert.equal(h.nowDead, true);
  assert.equal(h.dead, false);

  // подписка через VPN: её скачивание идёт через выбранный сервер
  await selectServer('1| A', secret);
  await pushConfig({ ...s, subViaVpn: true });
  seen.A.length = 0;
  await api('/providers/proxies/sub1', secret, { method: 'PUT' });
  assert.ok(seen.A.includes('127.0.0.1:18888'), 'подписка скачана через сервер A');
  const before = hits;
  await api('/providers/proxies/sub2', secret, { method: 'PUT' });
  assert.ok(hits > before, 'refresh перекачивает подписку');

  // перезаливка под фоновым трафиком (как смена сервера для сайта во время сёрфинга):
  // «Авто» не должен залипать на закэшированном REJECT
  await selectServer(AUTO, secret);
  let browsing = true;
  const traffic = (async () => { while (browsing) { await viaCore(`http://t${Math.random().toString(36).slice(2, 6)}.lzk/`); await sleep(50); } })();
  await pushConfig({ ...s, siteServers: { ...s.siteServers, 'y.lzk': '1| A' } });
  const autoNow = (await api(`/proxies/${AUTO}`, secret)).now;
  browsing = false;
  await traffic;
  assert.match(autoNow, /^1\| [AB]$/, 'Авто сразу после перезаливки под трафиком');
  await selectServer('1| A', secret);

  // рестарт ядра: payload теряется, ensureConfig заливает заново, выборы восстанавливаются
  p.kill(); await new Promise((r) => p.once('exit', r));
  p = start(); await waitApi();
  await ensureConfig(s);
  assert.equal((await api(`/proxies/${GROUP}`, secret)).now, '1| A', 'store-selected');
  assert.equal(await viaCore('http://b.lzk/'), 'via:B', 'свой сервер после рестарта');

  // все серверы умерли: Авто на REJECT, health.dead, трафик блокируется
  yaml = 'proxies:\n  - {name: C, type: http, server: 127.0.0.1, port: 1}\n';
  await api('/providers/proxies/sub1', secret, { method: 'PUT' });
  await selectServer(AUTO, secret);
  await testGroup(AUTO, secret, 2000);
  h = await health(s);
  assert.equal(h.autoNow, 'REJECT');
  assert.equal(h.dead, true);
  assert.doesNotMatch(await viaCore('http://x.lzk/'), /^via:/, 'все мертвы — блок');
  console.log('E2E OK');
} finally {
  p.kill();
  for (const x of [...servers, subSrv]) x.close();
  await sleep(500);
  rmSync(dir, { recursive: true, force: true });
}
