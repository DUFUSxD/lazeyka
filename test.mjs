// node test.mjs — конфиг mihomo, домены, маршрутизация (исполняется настоящий текст PAC), перенос настроек.
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import {
  buildConfig, buildRules, buildPac, decide, parseList, parseSubs, plainName, subName, subError, norm, exportSettings, importSettings, newer, changelogSince,
  subStatus, sortServers, parseSubMeta, decodeText, migrateSub, deviceHeaders, iconUrls,
  DEFAULTS, GROUP, AUTO, PORT, SPEED, SPEED_HOST,
} from './extension/lib.js';

const cfg = (over) => buildConfig({ ...DEFAULTS, secret: 'x', ...over });

// --- конфиг mihomo
const one = cfg({ subs: ['https://a/sub'], secret: 's3cret' });
assert.equal(one.secret, 's3cret');
assert.deepEqual(one['proxy-groups'][0], { name: GROUP, type: 'select', proxies: ['REJECT', AUTO], use: ['sub1'] });
assert.deepEqual(one['proxy-groups'][1].proxies, ['REJECT']); // все мертвы → блок, а не COMPATIBLE (= напрямую)
assert.equal(one['proxy-groups'][1].lazy, false);
assert.equal(one['proxy-groups'][1].interval, 300); // автопинг по умолчанию — 5 минут
assert.equal(cfg({ subs: ['https://a'], pingInterval: 60 })['proxy-groups'][1].interval, 60);
assert.equal(one['proxy-providers'].sub1.override, undefined); // одна подписка — без префикса
assert.equal(one['proxy-providers'].sub1.proxy, 'DIRECT'); // иначе подписка качается через REJECT
assert.equal(cfg({ subs: ['https://a'], subViaVpn: true })['proxy-providers'].sub1.proxy, AUTO); // через VPN — через ⚡ Авто
const perSub = cfg({ subs: ['https://a', 'https://b'], subsViaVpn: ['https://b'] })['proxy-providers'];
assert.deepEqual([perSub.sub1.proxy, perSub.sub2.proxy], ['DIRECT', AUTO]); // только та подписка, что не скачалась напрямую

// --- почему подписка не скачалась: строки — как их реально отдаёт mihomo; токен из ссылки не показываем
const TOKEN_URL = 'https://abc123.panel.example.com/s/SECRETTOKEN';
let se = subError(new Error('mihomo 503: {"message":"Get \\"https://abc123.panel.example.com/s/SECRETTOKEN\\": EOF"}'), TOKEN_URL);
assert.equal(se.kind, 'network');
assert.match(se.text, /abc123\.panel\.example\.com не отвечает из этой сети/);
assert.doesNotMatch(se.text, /SECRETTOKEN|\/s\//);
assert.equal(subError(new Error('mihomo 503: {"message":"404 Not Found"}'), TOKEN_URL).kind, 'notfound');
assert.equal(subError(new Error('mihomo 503: {"message":"403 Forbidden"}'), TOKEN_URL).kind, 'denied');
assert.equal(subError(new Error('mihomo 503: {"message":"Get \\"https://x/s/t\\": dial tcp 1.2.3.4:443: i/o timeout"}'), TOKEN_URL).kind, 'network');
assert.equal(subError(new Error('mihomo 503: {"message":"Get \\"https://x/s/t\\": read tcp: connection reset by peer"}'), TOKEN_URL).kind, 'network');
assert.equal(subError(new Error('mihomo 503: {"message":"x509: certificate signed by unknown authority"}'), TOKEN_URL).kind, 'cert');
se = subError(new Error('mihomo 503: {"message":"500 Internal Server Error"}'), TOKEN_URL);
assert.equal(se.kind, 'other');
assert.match(se.text, /\(500\)/);
assert.match(subError(new Error('mihomo 503: {"message":"404 Not Found"}'), TOKEN_URL).text, /лимит устройств/); // Remnawave без x-hwid отвечает 404
// тест скорости — своя группа и правило первым, чтобы его не перехватили правила сайтов
assert.deepEqual(one.rules, [`DOMAIN-SUFFIX,${SPEED_HOST},${SPEED}`, `MATCH,${GROUP}`]);
assert.deepEqual(one['proxy-groups'][2], { name: SPEED, type: 'select', proxies: ['REJECT'], use: ['sub1'] });
assert.equal(cfg({ subs: ['https://a', 'https://b'] })['proxy-providers'].sub2.override['additional-prefix'], '2| ');

// HWID: с ним панели с лимитом устройств отдают подписку; без него в конфиге заголовков нет
assert.equal(one['proxy-providers'].sub1.header, undefined);
assert.deepEqual(cfg({ subs: ['https://a'], hwid: 'abcdef0123456789abcdef0123456789' })['proxy-providers'].sub1.header,
  { 'x-hwid': ['abcdef0123456789abcdef0123456789'], 'x-device-os': ['Windows'], 'x-device-model': ['Lazeyka'] });
assert.ok(Object.values(deviceHeaders('x')).every((v) => /^[\x20-\x7e]+$/.test(v)), 'заголовки — только ASCII');
// как часто перекачивать подписку — как просит провайдер, иначе раз в час
assert.equal(one['proxy-providers'].sub1.interval, 3600);
assert.equal(cfg({ subs: ['https://a'], subMeta: { 'https://a': { updateHours: 12 } } })['proxy-providers'].sub1.interval, 43200);

// свои серверы: одна select-группа на сервер, правила от точного домена к общему
const sc = cfg({ subs: ['https://a'], siteServers: { 'google.com': 'US', 'gemini.google.com': 'NL', 'x.com': 'US', 'chatgpt.com': AUTO } });
assert.deepEqual(sc['proxy-groups'].slice(3).map((g) => [g.name, g.type, g.proxies]), [['SITE0', 'select', ['REJECT']], ['SITE1', 'select', ['REJECT']]]);
assert.deepEqual(sc.rules, [
  `DOMAIN-SUFFIX,${SPEED_HOST},${SPEED}`,
  'DOMAIN-SUFFIX,gemini.google.com,SITE1', 'DOMAIN-SUFFIX,google.com,SITE0', 'DOMAIN-SUFFIX,x.com,SITE0',
  `DOMAIN-SUFFIX,chatgpt.com,${AUTO}`, `MATCH,${GROUP}`,
]);

// --- состояние подписки: пороги общие для шапки и уведомлений
const NOW = Date.UTC(2026, 0, 10);
const st = (i) => subStatus(i, NOW);
assert.equal(st(null), null);
assert.equal(st({ Upload: 0, Download: 95, Total: 100, Expire: 0 }).trafficLow, true);
assert.equal(st({ Upload: 0, Download: 50, Total: 100, Expire: 0 }).trafficLow, false);
assert.equal(st({ Upload: 0, Download: 999, Total: 0, Expire: 0 }).trafficLow, false); // total 0 — безлимит
assert.equal(st({ Expire: NOW / 1000 + 2 * 86400 }).expiresSoon, true);
assert.equal(st({ Expire: NOW / 1000 + 10 * 86400 }).expiresSoon, false);
assert.equal(st({ Expire: NOW / 1000 - 60 }).expired, true);
assert.equal(st({ Expire: NOW + 2 * 864e5 }).expiresSoon, true); // expire в миллисекундах
assert.equal(st({ Expire: 0 }).daysLeft, Infinity);

// --- сортировка серверов внутри подписки
const nodes = new Map([['1| B', { delay: 300 }], ['1| A', { delay: 0 }], ['1| C', { delay: 120 }], ['1| D', { delay: null }]]);
assert.deepEqual(sortServers(['1| B', '1| A', '1| C', '1| D'], 'sub', nodes), ['1| B', '1| A', '1| C', '1| D']);
assert.deepEqual(sortServers(['1| B', '1| A', '1| C', '1| D'], 'ping', nodes), ['1| C', '1| B', '1| D', '1| A']); // живые, непроверенные, мёртвые
assert.deepEqual(sortServers(['NL 10', 'NL 2', 'DE 1'], 'name', new Map()), ['DE 1', 'NL 2', 'NL 10']);

// --- данные от провайдера: всё недоверенное
const H = (o) => new Headers(o);
const b64 = (t) => Buffer.from(t).toString('base64');
let meta = parseSubMeta(H({ 'profile-title': `base64:${b64('Мой VPN\nописание')}`, 'support-url': 'https://t.me/help',
  'profile-web-page-url': 'javascript:alert(1)', announce: b64('Техработы в 3:00\r\nизвините'), 'profile-update-interval': '12' }), 'https://p.example/s/t');
assert.equal(meta.title, 'Мой VPN');
assert.equal(meta.support, 'https://t.me/help');
assert.equal(meta.web, ''); // не http(s) — не ссылка
assert.equal(meta.announce, 'Техработы в 3:00\nизвините');
assert.equal(meta.updateHours, 12);
assert.equal(decodeText('Test1234'), 'Test1234'); // похоже на base64, но раскодируется в мусор — оставить как есть
assert.equal(decodeText('Hello world'), 'Hello world');
assert.equal(decodeText('base64:!!!'), '');
assert.equal(parseSubMeta(H({ announce: 'x'.repeat(500) }), 'https://p/s').announce.length, 200);
assert.equal(parseSubMeta(H({ 'profile-update-interval': '0' }), 'https://p/s').updateHours, 0);
// переезд: только https → https
assert.equal(parseSubMeta(H({ 'new-domain': 'new.example.org' }), 'https://old.example.com/s/t').newUrl, 'https://new.example.org/s/t');
assert.equal(parseSubMeta(H({ 'new-url': 'https://n.example/s/x' }), 'https://o.example/s/t').newUrl, 'https://n.example/s/x');
assert.equal(parseSubMeta(H({ 'new-url': 'http://n.example/s/x' }), 'https://o.example/s/t').newUrl, '');
assert.equal(parseSubMeta(H({ 'new-domain': 'new.example.org' }), 'http://old.example.com/s/t').newUrl, '');
const mig = migrateSub({ subs: ['https://o/s', 'https://k/s'], subNames: { 'https://o/s': 'Мой' }, subsViaVpn: ['https://o/s'], subMeta: { 'https://o/s': { title: 'T' } } },
  'https://o/s', 'https://n/s');
assert.deepEqual(mig, { subs: ['https://n/s', 'https://k/s'], subNames: { 'https://n/s': 'Мой' }, subsViaVpn: ['https://n/s'], subMeta: { 'https://n/s': { title: 'T' } } });
// своё название важнее названия от провайдера
assert.equal(subName({ subNames: {}, subMeta: { 'https://a/s': { title: 'От провайдера' } } }, 'https://a/s'), 'От провайдера');
assert.equal(subName({ subNames: { 'https://a/s': 'Своё' }, subMeta: { 'https://a/s': { title: 'От провайдера' } } }, 'https://a/s'), 'Своё');
// логотип: сначала сайт кабинета, потом адрес подписки, потом основные домены; без кабинета — как раньше
assert.deepEqual(iconUrls(['https://my.brand.com/cabinet', 'https://sub.brand-cdn.net/s/tok']), [
  'https://my.brand.com/favicon.ico', 'https://sub.brand-cdn.net/favicon.ico', 'https://brand.com/favicon.ico', 'https://brand-cdn.net/favicon.ico']);
assert.deepEqual(iconUrls([undefined, 'http://1.2.3.4:2096/sub/tok']), ['http://1.2.3.4:2096/favicon.ico']);
assert.deepEqual(iconUrls(['https://brand.com/', 'https://sub.brand.com/s']), [
  'https://brand.com/favicon.ico', 'https://sub.brand.com/favicon.ico'], 'без повторов');
assert.deepEqual(iconUrls(['javascript:alert(1)', 'https://a.example/s']), ['https://a.example/favicon.ico']);

// --- домены и подписки
assert.equal(norm('https://www.YouTube.com/watch?v=1'), 'youtube.com');
assert.equal(norm('*.example.com'), 'example.com');
assert.equal(norm('пример.рф'), 'xn--e1afmkfd.xn--p1ai');
assert.equal(norm('# комментарий'), '');
assert.deepEqual(parseList('.ua\r\n4pda.to\n\n4pda.to\na-vrv.akamaized.net\n# x\n '), ['ua', '4pda.to', 'a-vrv.akamaized.net']);
assert.deepEqual(parseSubs(' https://a/sub \n\nhttps://a/sub\nhttp://b/s'), [{ url: 'https://a/sub', name: '' }, { url: 'http://b/s', name: '' }]);
// название перед ссылкой, с любым разделителем
assert.deepEqual(parseSubs('Мой VPN https://a/s\nРабота — https://b/s\nДруг | https://c/s').map((x) => x.name), ['Мой VPN', 'Работа', 'Друг']);
assert.equal(subName({ subNames: { 'https://a/s': 'Мой VPN' } }, 'https://a/s'), 'Мой VPN');
assert.equal(subName({ subNames: {} }, 'https://panel.example.com:2096/sub/x'), 'panel.example.com'); // по умолчанию — домен панели
assert.equal(plainName('2| 🇳🇱 NL-1'), '🇳🇱 NL-1');
assert.equal(plainName('🇳🇱 12| fast'), '🇳🇱 12| fast'); // префикс только в начале
assert.throws(() => parseSubs('vless://uuid@host:443?security=reality#NL'), /ключ одного сервера/);
assert.throws(() => parseSubs('panel.example.com/sub'), /не похоже на ссылку/);

// --- PAC
const V = `SOCKS5 127.0.0.1:${PORT}`;
const D = 'DIRECT';
const pac = (over) => {
  const ctx = {};
  vm.runInNewContext(buildPac(buildRules({ ...DEFAULTS, blocked: parseList('.ua\n4pda.to\nyoutube.com'), ...over })), ctx);
  return (h) => ctx.FindProxyForURL(`https://${h}/`, h);
};

let f = pac({}); // по умолчанию: остальное через VPN, РФ напрямую
assert.equal(f('google.com'), V);
assert.equal(f('Google.com.'), V);
assert.equal(f('ya.ru'), D);
assert.equal(f('music.yandex.net'), D);
assert.equal(f('xn--e1afmkfd.xn--p1ai'), D);
for (const h of ['localhost', 'router', '192.168.1.1', '10.0.0.5', '172.20.1.1', 'nas.local', '::1']) assert.equal(f(h), D, h);
assert.equal(f('10.example.com'), V); // не IP
assert.equal(f('172.32.0.1'), V); // не приватный

f = pac({ rest: 'direct' }); // «только заблокированное через VPN»
assert.equal(f('google.com'), D);
assert.equal(f('www.youtube.com'), V);
assert.equal(f('news.kyiv.ua'), V);
assert.equal(f('a.constructor'), D); // ключи Object.prototype не матчатся
assert.equal(pac({ rest: 'direct', useBlocked: false })('youtube.com'), D);

f = pac({ directList: ['google.com'], vpnList: ['gemini.google.com'] }); // побеждает самый точный домен
assert.equal(f('gemini.google.com'), V);
assert.equal(f('mail.google.com'), D);
assert.equal(pac({ vpnList: ['kinopoisk.ru'] })('hd.kinopoisk.ru'), V); // свой список важнее «РФ напрямую»
assert.equal(pac({ rest: 'direct', directList: ['youtube.com'] })('youtube.com'), D); // и важнее списка блокировок
assert.equal(pac({ rest: 'direct', siteServers: { 'ya.ru': 'US' } })('ya.ru'), V); // свой сервер = через VPN

// причины для карточки сайта
const R = buildRules({ ...DEFAULTS, blocked: ['youtube.com'], vpnList: ['x.com'] });
assert.deepEqual(decide('x.com', R), [true, 'list']);
assert.deepEqual(decide('www.youtube.com', R), [true, 'blocked']);
assert.deepEqual(decide('ya.ru', R), [false, 'ru']);
assert.deepEqual(decide('example.org', R), [true, 'rest']);

// --- перенос настроек: туда-обратно без потерь, без secret, мусор отвергается
const full = { ...DEFAULTS, secret: 'top', subs: ['https://p.example/sub/токен'], rest: 'direct', subViaVpn: true,
  vpnList: ['x.com'], siteServers: { 'chatgpt.com': '🇺🇸 США-1| fast' }, blocked: ['a.com'],
  subNames: { 'https://p.example/sub/токен': 'Мой VPN' }, pingInterval: 900, updateEvery: 0,
  sortServers: 'ping', hideDead: true, pingOnOpen: true, hwid: 'device-specific', subMeta: { x: 1 } };
const str = exportSettings(full);
assert.match(str, /^LZK1:[A-Za-z0-9_-]+$/);
const back = importSettings(` ${str} `);
assert.equal(back.secret, undefined);
assert.equal(back.blocked, undefined);
assert.deepEqual(back.subs, full.subs);
assert.deepEqual(back.siteServers, full.siteServers);
assert.equal(back.rest, 'direct');
assert.equal(back.subViaVpn, true);
assert.deepEqual(back.subNames, full.subNames);
assert.equal(back.pingInterval, 900);
assert.equal(back.updateEvery, 0); // «только вручную» — валидное значение, не путать с «нет значения»
assert.deepEqual([back.sortServers, back.hideDead, back.pingOnOpen], ['ping', true, true]);
assert.equal(back.hwid, undefined); // идентификатор устройства свой на каждом компьютере
assert.equal(back.subMeta, undefined);
assert.throws(() => importSettings('hello'), /не строка настроек/);
assert.throws(() => importSettings('LZK1:!!!'), /не строка настроек/);
assert.throws(() => importSettings('LZK1:bm90IGpzb24'), /повреждена/);
const evil = `LZK1:${Buffer.from(JSON.stringify({ subs: ['javascript:alert(1)'] })).toString('base64url')}`;
assert.throws(() => importSettings(evil), /ключ одного сервера|не похоже/);
const junk = Buffer.from(JSON.stringify({ rest: 'all', webrtc: 'yes', vpnList: ['ok.com', 5], secret: 'x', pingInterval: 7, updateEvery: '60' })).toString('base64url');
assert.throws(() => importSettings(`LZK1:${junk}`), /нет настроек/); // неверные типы и secret игнорируются
// --- обновления
assert.equal(newer('1.2.0', '1.1.0'), true);
assert.equal(newer('1.10.0', '1.9.3'), true); // не строковое сравнение
assert.equal(newer('1.1.0', '1.1.0'), false);
assert.equal(newer('1.0.9', '1.1.0'), false);
assert.equal(newer('2.0', '1.9.9'), true);
const md = readFileSync(new URL('./CHANGELOG.md', import.meta.url), 'utf8');
const notes = changelogSince(md, '1.1.0');
assert.ok(notes.length >= 2 && notes.every((n) => n && !n.startsWith('-')), 'пункты 1.2.0');
assert.deepEqual(changelogSince(md, '9.0.0'), []);
assert.ok(changelogSince(md, '1.0.0').length > notes.length, 'несколько версий сразу');
assert.deepEqual(changelogSince('## 1.3.0\r\n- **жирный** пункт\n## 1.2.0\n- старый', '1.2.0'), ['жирный пункт']);
console.log('ok');
