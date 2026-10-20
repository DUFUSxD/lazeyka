// Порты должны совпадать с core/mihomo.ps1 (нестандартные, чтобы не конфликтовать с Clash Verge / v2rayN).
export const PORT = 17890;
export const CONTROLLER = '127.0.0.1:19090';
export const GROUP = 'PROXY';
export const AUTO = 'AUTO';
export const TEST_URL = 'https://www.gstatic.com/generate_204';
export const BLOCKED_URL = 'https://raw.githubusercontent.com/itdoginfo/allow-domains/main/Russia/inside-raw.lst';
const API = `http://${CONTROLLER}`;

export const DEFAULTS = {
  subs: [], secret: '',
  rest: 'vpn',        // куда идут сайты, не попавшие ни в одно правило: 'vpn' | 'direct'
  ruDirect: true,     // российские сайты напрямую
  useBlocked: true,   // заблокированные в РФ — через VPN
  webrtc: true,
  vpnList: [], directList: [],
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

const toSet = (list, v = 1) => Object.fromEntries(list.map((d) => [d, v]));
export const buildRules = (s) => ({
  user: { ...toSet(s.directList, 'direct'), ...toSet(s.vpnList, 'vpn') },
  blocked: s.useBlocked ? toSet(s.blocked) : {},
  ru: s.ruDirect ? toSet(RU) : {},
  vpn: s.rest === 'vpn',
});

// match/isLan/route встраиваются в PAC через toString(): никаких ссылок наружу, только параметры.
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

// true — через VPN. Порядок: свои списки → заблокированные в РФ → российские → «остальные сайты».
export function route(host, R) {
  const u = match(R.user, host);
  if (u) return u === 'vpn';
  if (match(R.blocked, host)) return true;
  if (match(R.ru, host)) return false;
  return R.vpn;
}

// Без «; DIRECT» в ответе: если ядро упало, сайты не откроются, а не пойдут мимо VPN.
export const buildPac = (R) => `var R = ${JSON.stringify(R)};
${match}
${isLan}
${route}
function FindProxyForURL(url, host) {
  host = host.toLowerCase().replace(/\\.$/, '');
  return isLan(host) || !route(host, R) ? 'DIRECT' : 'SOCKS5 127.0.0.1:${PORT}';
}`;

// JSON — валидный YAML, поэтому mihomo принимает его как payload без YAML-сериализатора.
export function buildConfig(subs, secret) {
  const names = subs.map((_, i) => `sub${i + 1}`);
  return {
    // controller/secret повторяем: mihomo пересоздаёт API-сервер из нового конфига
    'mixed-port': PORT,
    'bind-address': '127.0.0.1',
    'allow-lan': false,
    'external-controller': CONTROLLER,
    secret,
    'log-level': 'warning',
    profile: { 'store-selected': true },
    'proxy-providers': Object.fromEntries(subs.map((url, i) => [names[i], {
      // без DIRECT mihomo качает подписку через правила, т.е. через REJECT, и она не грузится никогда
      type: 'http', url, interval: 3600, proxy: 'DIRECT',
      // префикс, чтобы одноимённые сервера из разных подписок не склеились
      ...(subs.length > 1 && { override: { 'additional-prefix': `${i + 1}| ` } }),
    }])),
    // REJECT первым: если подписка не скачалась или все сервера мертвы — блок, а не трафик напрямую
    'proxy-groups': [
      { name: GROUP, type: 'select', proxies: ['REJECT', AUTO], use: names },
      { name: AUTO, type: 'url-test', proxies: ['REJECT'], use: names, url: TEST_URL, interval: 300, tolerance: 50 },
    ],
    rules: [`MATCH,${GROUP}`],
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

export const pushConfig = ({ subs, secret }) => api('/configs?force=true', secret, {
  method: 'PUT',
  body: JSON.stringify({ payload: JSON.stringify(buildConfig(subs, secret)) }),
});

// После рестарта mihomo грузит базовый config.yaml без нашей группы — заливаем заново.
export async function ensureConfig(s) {
  const r = await fetch(`${API}/proxies/${GROUP}`, { headers: { Authorization: `Bearer ${s.secret}` } });
  if (r.status === 404) await pushConfig(s);
  else if (!r.ok) throw new Error(`mihomo ${r.status}: ${await r.text()}`);
}

export async function proxyState() {
  const { levelOfControl, value } = await chrome.proxy.settings.get({});
  return { levelOfControl, on: levelOfControl === 'controlled_by_this_extension' && value.mode === 'pac_script' };
}

export async function applyProxy(s) {
  await chrome.proxy.settings.set({ scope: 'regular', value: {
    mode: 'pac_script', pacScript: { data: buildPac(buildRules(s)), mandatory: true },
  } });
  // без этого WebRTC светит реальный IP мимо прокси (минус: звонки идут по TCP)
  const rtc = chrome.privacy.network.webRTCIPHandlingPolicy;
  await (s.webrtc ? rtc.set({ value: 'disable_non_proxied_udp' }) : rtc.clear({}));
  await chrome.action.setBadgeText({ text: 'ON' });
}

export async function proxyOff() {
  await chrome.proxy.settings.clear({ scope: 'regular' });
  await chrome.privacy.network.webRTCIPHandlingPolicy.clear({});
  await chrome.action.setBadgeText({ text: '' });
}

export async function updateBlocked() {
  const r = await fetch(BLOCKED_URL);
  if (!r.ok) throw new Error(`список заблокированных: HTTP ${r.status}`);
  const blocked = parseList(await r.text());
  if (blocked.length < 100) throw new Error('список заблокированных подозрительно короткий, оставил старый');
  await chrome.storage.local.set({ blocked, blockedAt: Date.now() });
  if ((await proxyState()).on) await applyProxy(await load());
}
