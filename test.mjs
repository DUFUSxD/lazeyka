// node test.mjs — генератор конфига mihomo, разбор доменов и маршрутизация (исполняется настоящий текст PAC).
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { buildConfig, buildRules, buildPac, parseList, norm, DEFAULTS, GROUP, AUTO, PORT } from './extension/lib.js';

// --- конфиг mihomo
const one = buildConfig(['https://a/sub'], 's3cret');
assert.equal(one.secret, 's3cret');
assert.deepEqual(one['proxy-groups'][0], { name: GROUP, type: 'select', proxies: ['REJECT', AUTO], use: ['sub1'] });
assert.deepEqual(one['proxy-groups'][1].proxies, ['REJECT']); // все мертвы → блок, а не COMPATIBLE (= напрямую)
assert.equal(one['proxy-providers'].sub1.override, undefined); // одна подписка — без префикса
assert.equal(one['proxy-providers'].sub1.proxy, 'DIRECT'); // иначе подписка качается через REJECT
assert.deepEqual(one.rules, [`MATCH,${GROUP}`]);
const two = buildConfig(['https://a/sub', 'https://b/sub'], 'x');
assert.equal(two['proxy-providers'].sub2.override['additional-prefix'], '2| ');
assert.deepEqual(buildConfig([], 'x')['proxy-groups'][0].use, []);

// --- домены
assert.equal(norm('https://www.YouTube.com/watch?v=1'), 'youtube.com');
assert.equal(norm('*.example.com'), 'example.com');
assert.equal(norm('пример.рф'), 'xn--e1afmkfd.xn--p1ai');
assert.equal(norm('# комментарий'), '');
// реальные строки из списка itdoginfo + мусор
assert.deepEqual(parseList('.ua\r\n4pda.to\n\n4pda.to\na-vrv.akamaized.net\n# x\n '), ['ua', '4pda.to', 'a-vrv.akamaized.net']);

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
console.log('ok');
