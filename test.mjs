// node test.mjs — конфиг mihomo, домены, маршрутизация (исполняется настоящий текст PAC), перенос настроек.
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import {
  buildConfig, buildRules, buildPac, decide, parseList, parseSubs, norm, exportSettings, importSettings, newer, changelogSince,
  DEFAULTS, GROUP, AUTO, PORT,
} from './extension/lib.js';

const cfg = (over) => buildConfig({ ...DEFAULTS, secret: 'x', ...over });

// --- конфиг mihomo
const one = cfg({ subs: ['https://a/sub'], secret: 's3cret' });
assert.equal(one.secret, 's3cret');
assert.deepEqual(one['proxy-groups'][0], { name: GROUP, type: 'select', proxies: ['REJECT', AUTO], use: ['sub1'] });
assert.deepEqual(one['proxy-groups'][1].proxies, ['REJECT']); // все мертвы → блок, а не COMPATIBLE (= напрямую)
assert.equal(one['proxy-groups'][1].lazy, false);
assert.equal(one['proxy-providers'].sub1.override, undefined); // одна подписка — без префикса
assert.equal(one['proxy-providers'].sub1.proxy, 'DIRECT'); // иначе подписка качается через REJECT
assert.equal(cfg({ subs: ['https://a'], subViaVpn: true })['proxy-providers'].sub1.proxy, GROUP);
assert.deepEqual(one.rules, [`MATCH,${GROUP}`]);
assert.equal(cfg({ subs: ['https://a', 'https://b'] })['proxy-providers'].sub2.override['additional-prefix'], '2| ');

// свои серверы: одна select-группа на сервер, правила от точного домена к общему
const sc = cfg({ subs: ['https://a'], siteServers: { 'google.com': 'US', 'gemini.google.com': 'NL', 'x.com': 'US', 'chatgpt.com': AUTO } });
assert.deepEqual(sc['proxy-groups'].slice(2).map((g) => [g.name, g.type, g.proxies]), [['SITE0', 'select', ['REJECT']], ['SITE1', 'select', ['REJECT']]]);
assert.deepEqual(sc.rules, [
  'DOMAIN-SUFFIX,gemini.google.com,SITE1', 'DOMAIN-SUFFIX,google.com,SITE0', 'DOMAIN-SUFFIX,x.com,SITE0',
  `DOMAIN-SUFFIX,chatgpt.com,${AUTO}`, `MATCH,${GROUP}`,
]);

// --- домены и подписки
assert.equal(norm('https://www.YouTube.com/watch?v=1'), 'youtube.com');
assert.equal(norm('*.example.com'), 'example.com');
assert.equal(norm('пример.рф'), 'xn--e1afmkfd.xn--p1ai');
assert.equal(norm('# комментарий'), '');
assert.deepEqual(parseList('.ua\r\n4pda.to\n\n4pda.to\na-vrv.akamaized.net\n# x\n '), ['ua', '4pda.to', 'a-vrv.akamaized.net']);
assert.deepEqual(parseSubs(' https://a/sub \n\nhttps://a/sub\nhttp://b/s'), ['https://a/sub', 'http://b/s']);
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
  vpnList: ['x.com'], siteServers: { 'chatgpt.com': '🇺🇸 США-1| fast' }, blocked: ['a.com'] };
const str = exportSettings(full);
assert.match(str, /^LZK1:[A-Za-z0-9_-]+$/);
const back = importSettings(` ${str} `);
assert.equal(back.secret, undefined);
assert.equal(back.blocked, undefined);
assert.deepEqual(back.subs, full.subs);
assert.deepEqual(back.siteServers, full.siteServers);
assert.equal(back.rest, 'direct');
assert.equal(back.subViaVpn, true);
assert.throws(() => importSettings('hello'), /не строка настроек/);
assert.throws(() => importSettings('LZK1:!!!'), /не строка настроек/);
assert.throws(() => importSettings('LZK1:bm90IGpzb24'), /повреждена/);
const evil = `LZK1:${Buffer.from(JSON.stringify({ subs: ['javascript:alert(1)'] })).toString('base64url')}`;
assert.throws(() => importSettings(evil), /ключ одного сервера|не похоже/);
const junk = Buffer.from(JSON.stringify({ rest: 'all', webrtc: 'yes', vpnList: ['ok.com', 5], secret: 'x' })).toString('base64url');
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
