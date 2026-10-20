// Порты должны совпадать с core/mihomo.ps1 (нестандартные, чтобы не конфликтовать с Clash Verge / v2rayN).
export const PORT = 17890;
export const CONTROLLER = '127.0.0.1:19090';
export const GROUP = 'PROXY';
export const AUTO = 'AUTO';
// Cloudflare, а не gstatic: Google в РФ замедляют, и сервера-мосты с выходом в РФ ложно выглядели бы мёртвыми
export const TEST_URL = 'https://cp.cloudflare.com/generate_204';
export const BLOCKED_URL = 'https://raw.githubusercontent.com/itdoginfo/allow-domains/main/Russia/inside-raw.lst';
const API = `http://${CONTROLLER}`;

export const DEFAULTS = {
  subs: [], secret: '',
  rest: 'vpn',        // куда идут сайты, не попавшие ни в одно правило: 'vpn' | 'direct'
  ruDirect: true,     // российские сайты напрямую
  useBlocked: true,   // заблокированные в РФ — через VPN
  webrtc: true,
  subViaVpn: false,   // качать подписки через VPN (если панель заблокирована в этой сети)
  vpnList: [], directList: [],
  siteServers: {},    // домен → имя сервера (или AUTO)
  blocked: [], blockedAt: 0,
};
export const load = () => chrome.storage.local.get(DEFAULTS);

// Российские зоны и сервисы на иностранных доменах: банки/госуслуги/маркетплейсы часто режут зарубежные IP.
export const RU = ['ru', 'su', 'xn--p1ai', 'moscow', 'xn--80adxhks', 'tatar',
  'yandex.net', 'yandex.com', 'yastatic.net', 'yandexcloud.net', 'vk.com', 'vk.me', 'userapi.com',
  'vkuser.net', 'mycdn.me', 'sberbank.com', '2gis.com', 'avito.st', 'wbstatic.net', 'ivi.tv', 'okko.tv'];

// «https://www.YouTube.com/watch», «*.youtube.com», «пример.рф» → нормальный домен или ''.
export function norm(s) {
  s = s.trim().toLowerCase().replace(/^\*?\./, '');
  if (!s) return '';
  try { s = new URL(s.includes('://') ? s : `http://${s}`).hostname; } catch { return ''; }
  s = s.replace(/^www\./, '');
  return /^[a-z0-9-]+(\.[a-z0-9-]+)*$/.test(s) ? s : '';
}
export const parseList = (text) => [...new Set(text.split(/\r?\n/).map(norm).filter(Boolean))];

// Подписки: только http(s)-ссылки. Ключ vless:// и т.п. — частая ошибка, объясняем отдельно.
export function parseSubs(text) {
  const lines = text.split(/\r?\n/).map((x) => x.trim()).filter(Boolean);
  for (const l of lines) {
    if (/^[a-z0-9]+:\/\//i.test(l) && !/^https?:\/\//i.test(l)) {
      throw new Error(`«${l.slice(0, 24)}…» — это ключ одного сервера, а нужна ссылка на подписку (https://…)`);
    }
    if (!/^https?:\/\/\S+$/i.test(l)) throw new Error(`«${l.slice(0, 30)}» — не похоже на ссылку подписки`);
  }
  return [...new Set(lines)];
}

const toSet = (list, v = 1) => Object.fromEntries(list.map((d) => [d, v]));
export const buildRules = (s) => ({
  // сайт с выбранным сервером всегда идёт через VPN
  user: { ...toSet(s.directList, 'direct'), ...toSet(s.vpnList, 'vpn'), ...toSet(Object.keys(s.siteServers), 'vpn') },
  blocked: s.useBlocked ? toSet(s.blocked) : {},
  ru: s.ruDirect ? toSet(RU) : {},
  vpn: s.rest === 'vpn',
});

// match/isLan/decide встраиваются в PAC через toString(): никаких ссылок наружу, только параметры.
// Значение самого точного суффикса: для mail.google.com сначала mail.google.com, потом google.com, потом com.
export function match(set, host) {
  for (;;) {
    if (Object.prototype.hasOwnProperty.call(set, host)) return set[host];
    const i = host.indexOf('.');
    if (i < 0) return undefined;
    host = host.slice(i + 1);
  }
}

export function isLan(host) {
  if (host.indexOf(':') >= 0) return /^(::1$|fe80:|f[cd][0-9a-f]{2}:)/.test(host);
  return host.indexOf('.') < 0 || /\.(local|lan|home\.arpa)$/.test(host)
    || /^(10|127)\.\d+\.\d+\.\d+$|^192\.168\.\d+\.\d+$|^172\.(1[6-9]|2\d|3[01])\.\d+\.\d+$|^169\.254\.\d+\.\d+$/.test(host);
}

// [через VPN?, причина]. Порядок: свои списки → заблокированные в РФ → российские → «остальные сайты».
export function decide(host, R) {
  const u = match(R.user, host);
  if (u) return [u === 'vpn', 'list'];
  if (match(R.blocked, host)) return [true, 'blocked'];
  if (match(R.ru, host)) return [false, 'ru'];
  return [R.vpn, 'rest'];
}

// Без «; DIRECT» в ответе: если ядро упало, сайты не откроются, а не пойдут мимо VPN.
export const buildPac = (R) => `var R = ${JSON.stringify(R)};
${match}
${isLan}
${decide}
function FindProxyForURL(url, host) {
  host = host.toLowerCase().replace(/\\.$/, '');
  return isLan(host) || !decide(host, R)[0] ? 'DIRECT' : 'SOCKS5 127.0.0.1:${PORT}';
}`;

// Серверы, под которые нужны отдельные select-группы SITE0, SITE1… (AUTO — уже группа).
const siteGroups = (s) => [...new Set(Object.values(s.siteServers))].filter((n) => n !== AUTO);

// JSON — валидный YAML, поэтому mihomo принимает его как payload без YAML-сериализатора.
export function buildConfig(s) {
  const names = s.subs.map((_, i) => `sub${i + 1}`);
  const groups = siteGroups(s);
  const target = (n) => (n === AUTO ? AUTO : `SITE${groups.indexOf(n)}`);
  // mihomo берёт первое совпавшее правило, а PAC — самый точный домен: длинные домены вперёд
  const siteRules = Object.keys(s.siteServers)
    .sort((a, b) => b.split('.').length - a.split('.').length)
    .map((d) => `DOMAIN-SUFFIX,${d},${target(s.siteServers[d])}`);
  return {
    // controller/secret повторяем: mihomo пересоздаёт API-сервер из нового конфига
    'mixed-port': PORT,
    'bind-address': '127.0.0.1',
    'allow-lan': false,
    'external-controller': CONTROLLER,
    secret: s.secret,
    'log-level': 'warning',
    profile: { 'store-selected': true },
    'proxy-providers': Object.fromEntries(s.subs.map((url, i) => [names[i], {
      // без явного proxy mihomo качает подписку через правила, т.е. через REJECT, и она не грузится никогда
      type: 'http', url, interval: 3600, proxy: s.subViaVpn ? GROUP : 'DIRECT',
      // префикс, чтобы одноимённые сервера из разных подписок не склеились
      ...(s.subs.length > 1 && { override: { 'additional-prefix': `${i + 1}| ` } }),
    }])),
    // REJECT первым: если подписка не скачалась или все сервера мертвы — блок, а не трафик напрямую
    'proxy-groups': [
      { name: GROUP, type: 'select', proxies: ['REJECT', AUTO], use: names },
      // lazy: false — проверять серверы всегда, иначе нечем показывать задержки и ловить «все умерли»
      { name: AUTO, type: 'url-test', proxies: ['REJECT'], use: names, url: TEST_URL, interval: 300, tolerance: 50, lazy: false },
      ...groups.map((_, i) => ({ name: `SITE${i}`, type: 'select', proxies: ['REJECT'], use: names })),
    ],
    rules: [...siteRules, `MATCH,${GROUP}`],
  };
}

export async function api(path, secret, opts = {}) {
  const r = await fetch(API + path, {
    ...opts,
    headers: { Authorization: `Bearer ${secret}`, 'Content-Type': 'application/json' },
  });
  if (!r.ok) throw new Error(`mihomo ${r.status}: ${await r.text()}`);
  return r.status === 204 ? null : r.json();
}

const select = (group, name, secret) => api(`/proxies/${group}`, secret, { method: 'PUT', body: JSON.stringify({ name }) });
export const selectServer = (name, secret) => select(GROUP, name, secret);

export const testGroup = (group, secret, timeout = 5000) =>
  api(`/group/${group}/delay?url=${encodeURIComponent(TEST_URL)}&timeout=${timeout}`, secret).catch(() => ({})); // 504 — не ответил никто

export async function pushConfig(s) {
  await api('/configs?force=true', s.secret, {
    method: 'PUT',
    body: JSON.stringify({ payload: JSON.stringify(buildConfig(s)) }),
  });
  // после перезагрузки select-группы сайтов стоят на REJECT; сервера нет в подписке — так и останется (popup предупредит)
  await Promise.all(siteGroups(s).map((n, i) => select(`SITE${i}`, n, s.secret).catch(() => {})));
  // Свежий url-test 10 с держит закэшированный выбор, и при фоновом трафике это REJECT (сайты блокируются).
  // Тест группы сбрасывает кэш: первый наполняет историю задержек, второй — уже при известных живых серверах.
  await testGroup(AUTO, s.secret);
  await testGroup(AUTO, s.secret);
}

// После рестарта mihomo грузит базовый config.yaml без нашей группы — заливаем заново.
export async function ensureConfig(s) {
  const r = await fetch(`${API}/proxies/${GROUP}`, { headers: { Authorization: `Bearer ${s.secret}` } });
  if (r.status === 404) await pushConfig(s);
  else if (!r.ok) throw new Error(`mihomo ${r.status}: ${await r.text()}`);
}

// Сводка health-check mihomo. delay: число мс, 0 — не ответил, null — ещё не проверяли.
export async function health(s) {
  const [{ providers }, g, auto] = await Promise.all([
    api('/providers/proxies', s.secret), api(`/proxies/${GROUP}`, s.secret), api(`/proxies/${AUTO}`, s.secret),
  ]);
  const nodes = new Map(Object.values(providers).filter((p) => p.vehicleType === 'HTTP').flatMap((p) => p.proxies)
    .map((n) => [n.name, { alive: n.alive, delay: n.history.length ? n.history.at(-1).delay : null }]));
  const list = [...nodes.values()];
  const checked = list.some((n) => n.delay !== null);
  return {
    all: g.all.filter((n) => n !== 'REJECT'), // AUTO + серверы в порядке подписок
    now: g.now,
    autoNow: auto.now,
    nodes,
    empty: !nodes.size,
    dead: checked && !list.some((n) => n.alive),
    // выбранный вручную сервер проверен и не отвечает
    nowDead: g.now !== AUTO && nodes.get(g.now)?.delay === 0,
  };
}

export async function proxyState() {
  const { levelOfControl, value } = await chrome.proxy.settings.get({});
  return { levelOfControl, on: levelOfControl === 'controlled_by_this_extension' && value.mode === 'pac_script' };
}

const icon = (state) => ({ path: { 16: `icons/${state}16.png`, 32: `icons/${state}32.png` } });
export async function setBadge(on, dead = false) {
  await chrome.action.setIcon(icon(on ? 'on' : 'off'));
  await chrome.action.setBadgeBackgroundColor({ color: dead ? '#e5534b' : '#2fb36b' });
  await chrome.action.setBadgeText({ text: on && dead ? '!' : '' });
}

export async function applyProxy(s) {
  await chrome.proxy.settings.set({ scope: 'regular', value: {
    mode: 'pac_script', pacScript: { data: buildPac(buildRules(s)), mandatory: true },
  } });
  // без этого WebRTC светит реальный IP мимо прокси (минус: звонки идут по TCP)
  const rtc = chrome.privacy.network.webRTCIPHandlingPolicy;
  await (s.webrtc ? rtc.set({ value: 'disable_non_proxied_udp' }) : rtc.clear({}));
  await setBadge(true);
}

export async function proxyOff() {
  await chrome.proxy.settings.clear({ scope: 'regular' });
  await chrome.privacy.network.webRTCIPHandlingPolicy.clear({});
  await setBadge(false);
}

// Общий путь для кнопки в popup и горячей клавиши.
export async function toggle() {
  const { on } = await proxyState();
  await (on ? proxyOff() : applyProxy(await load()));
  return !on;
}

export async function updateBlocked() {
  const r = await fetch(BLOCKED_URL);
  if (!r.ok) throw new Error(`список заблокированных: HTTP ${r.status}`);
  const blocked = parseList(await r.text());
  if (blocked.length < 100) throw new Error('список заблокированных подозрительно короткий, оставил старый');
  await chrome.storage.local.set({ blocked, blockedAt: Date.now() });
  if ((await proxyState()).on) await applyProxy(await load());
}

// --- обновления: версия и заметки из main на GitHub, установка — через помощника (core/host.ps1)
export const RAW = 'https://raw.githubusercontent.com/DUFUSxD/lazeyka/main';
export const HOST = 'com.lazeyka.host';
export const UPDATE_CMD = `powershell -c "irm ${RAW}/install.ps1 | iex"`;

export function newer(a, b) {
  const x = a.split('.').map(Number);
  const y = b.split('.').map(Number);
  for (let i = 0; i < 3; i++) if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) > (y[i] || 0);
  return false;
}

// Пункты CHANGELOG.md из разделов «## X.Y.Z» новее установленной версии.
export function changelogSince(md, current) {
  const out = [];
  let take = false;
  for (const line of md.split(/\r?\n/)) {
    const h = line.match(/^##\s+v?(\d+\.\d+\.\d+)/);
    if (h) take = newer(h[1], current);
    else if (take && /^\s*[-*]\s+/.test(line)) out.push(line.replace(/^\s*[-*]\s+/, '').replace(/\*\*/g, '').trim());
  }
  return out;
}

export async function checkUpdate() {
  const get = (p) => fetch(`${RAW}/${p}`, { cache: 'no-store' });
  const r = await get('extension/manifest.json');
  if (!r.ok) throw new Error(`проверка обновлений: HTTP ${r.status}`);
  const { version: latest } = await r.json();
  const md = await get('CHANGELOG.md').then((x) => (x.ok ? x.text() : '')).catch(() => '');
  const update = { latest, notes: changelogSince(md, chrome.runtime.getManifest().version), checkedAt: Date.now() };
  await chrome.storage.local.set({ update });
  return update;
}

// Вызов помощника. Порт держит service worker живым, пока помощник работает.
export function hostCall(cmd) {
  return new Promise((resolve, reject) => {
    const port = chrome.runtime.connectNative(HOST);
    let answered = false;
    port.onMessage.addListener((m) => { answered = true; resolve(m); port.disconnect(); });
    port.onDisconnect.addListener(() => {
      if (!answered) reject(new Error(chrome.runtime.lastError?.message || 'Помощник завершился без ответа'));
    });
    port.postMessage({ cmd });
  });
}

// --- перенос настроек одной строкой (без secret — он свой на каждом компьютере)
const PORTABLE = ['subs', 'rest', 'ruDirect', 'useBlocked', 'webrtc', 'subViaVpn', 'vpnList', 'directList', 'siteServers'];
const b64enc = (str) => {
  let bin = '';
  for (const b of new TextEncoder().encode(str)) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
};
const b64dec = (str) => new TextDecoder().decode(
  Uint8Array.from(atob(str.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0)));

export const exportSettings = (s) => `LZK1:${b64enc(JSON.stringify(Object.fromEntries(PORTABLE.map((k) => [k, s[k]]))))}`;

// Строка пришла извне: берём только известные ключи нужных типов и прогоняем через те же нормализаторы.
export function importSettings(str) {
  const m = str.trim().match(/^LZK1:([A-Za-z0-9_-]+)$/);
  if (!m) throw new Error('Это не строка настроек Лазейки (должна начинаться с LZK1:)');
  let o;
  try { o = JSON.parse(b64dec(m[1])); } catch { throw new Error('Строка настроек повреждена — скопируй её заново'); }
  if (!o || typeof o !== 'object') throw new Error('Строка настроек повреждена');
  const strings = (v) => Array.isArray(v) && v.every((x) => typeof x === 'string');
  const out = {};
  if (strings(o.subs)) out.subs = parseSubs(o.subs.join('\n'));
  if (o.rest === 'vpn' || o.rest === 'direct') out.rest = o.rest;
  for (const k of ['ruDirect', 'useBlocked', 'webrtc', 'subViaVpn']) if (typeof o[k] === 'boolean') out[k] = o[k];
  for (const k of ['vpnList', 'directList']) if (strings(o[k])) out[k] = parseList(o[k].join('\n'));
  if (o.siteServers && typeof o.siteServers === 'object') {
    out.siteServers = Object.fromEntries(Object.entries(o.siteServers)
      .filter(([d, n]) => norm(d) && typeof n === 'string' && n).map(([d, n]) => [norm(d), n]));
  }
  if (!Object.keys(out).length) throw new Error('В строке нет настроек');
  return out;
}
