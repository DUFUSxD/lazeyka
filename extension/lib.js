import { t, setLang } from './i18n.js';

// Порты должны совпадать с core/mihomo.ps1 (нестандартные, чтобы не конфликтовать с Clash Verge / v2rayN).
export const PORT = 17890;
export const CONTROLLER = '127.0.0.1:19090';
export const GROUP = 'PROXY';
export const AUTO = 'AUTO';
// Cloudflare, а не gstatic: Google в РФ замедляют, и сервера-мосты с выходом в РФ ложно выглядели бы мёртвыми
export const TEST_URL = 'https://cp.cloudflare.com/generate_204';
export const BLOCKED_URL = 'https://raw.githubusercontent.com/itdoginfo/allow-domains/main/Russia/inside-raw.lst';
// Тест скорости: файл с Cloudflare через группу SPEED — так можно проверить любой сервер, не меняя тот, через который ходишь
export const SPEED_HOST = 'speed.cloudflare.com';
export const SPEED = 'SPEED';
const API = `http://${CONTROLLER}`;

export const DEFAULTS = {
  subs: [], secret: '',
  subNames: {},       // ссылка подписки → своё название
  rest: 'vpn',        // куда идут сайты, не попавшие ни в одно правило: 'vpn' | 'direct'
  ruDirect: true,     // российские сайты напрямую
  useBlocked: true,   // заблокированные в РФ — через VPN
  webrtc: true,
  subViaVpn: false,   // качать подписки через VPN (если панель заблокирована в этой сети)
  subsViaVpn: [],     // отдельные подписки, которые не скачались напрямую и переведены на VPN (своё для каждой сети — не переносится)
  pingInterval: 300,  // автопинг серверов (health-check группы ⚡ Авто), секунды
  updateEvery: 360,   // проверка обновлений, минуты; 0 — только вручную
  vpnList: [], directList: [],
  siteServers: {},    // домен → имя сервера (или AUTO)
  sortServers: 'sub', // порядок серверов в группе: как в подписке / по пингу / по имени
  hideDead: false,    // прятать серверы, которые не ответили на проверку
  pingOnOpen: false,  // проверять серверы при открытии окна
  collapsed: [],      // ссылки подписок, чьи серверы свёрнуты в списке
  lang: 'auto',       // язык интерфейса: 'auto' (как у браузера) | 'ru' | 'en'
  hwid: '',           // случайный идентификатор этого компьютера для панелей с лимитом устройств (не переносится)
  subMeta: {},        // ссылка → данные из служебных заголовков подписки (название, поддержка, объявление…)
  alerted: [],        // о чём уже уведомили: «ссылка|что|срок» — чтобы не повторять
  blocked: [], blockedAt: 0,
};
// Заодно ставит язык интерфейса: всё, что показывает текст, сначала читает настройки.
export const load = () => chrome.storage.local.get(DEFAULTS).then((s) => { setLang(s.lang); return s; });

// Допустимые значения настроек со списком (они же — пункты выпадающих списков; подписи переводятся там, где строится список).
export const PING_OPTIONS = [[60, 'каждую минуту'], [300, 'каждые 5 минут'], [900, 'каждые 15 минут'], [1800, 'каждые 30 минут'], [3600, 'раз в час']];
export const UPDATE_OPTIONS = [[60, 'каждый час'], [360, 'каждые 6 часов'], [1440, 'раз в день'], [10080, 'раз в неделю'], [0, 'только вручную']];
export const SORT_OPTIONS = [['sub', 'как в подписке'], ['ping', 'по пингу'], ['name', 'по названию']];
export const LANG_OPTIONS = [['auto', 'Как в браузере'], ['ru', 'Русский'], ['en', 'English']];

// Панели с лимитом устройств (Remnawave и др.) без x-hwid отвечают 404. Значения — только ASCII.
export const deviceHeaders = (hwid) => ({ 'x-hwid': hwid, 'x-device-os': 'Windows', 'x-device-model': 'Lazeyka' });

// Один идентификатор на компьютер: создаётся при первой нужде и дальше не меняется.
export async function ensureHwid() {
  const { hwid } = await chrome.storage.local.get('hwid');
  if (hwid) return hwid;
  const id = crypto.randomUUID().replaceAll('-', ''); // 32 символа [0-9a-f] — подходит под 10–64 [A-Za-z0-9=-]
  await chrome.storage.local.set({ hwid: id });
  return id;
}

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

// Подписки, по одной на строку: «https://…» или «Название https://…».
// Ключ vless:// и т.п. вместо подписки — частая ошибка, объясняем отдельно. → [{ url, name }]
export function parseSubs(text) {
  const out = [];
  for (const l of text.split(/\r?\n/).map((x) => x.trim()).filter(Boolean)) {
    const m = l.match(/^(.*?)\s*(https?:\/\/\S+)$/i);
    if (!m) {
      if (/[a-z0-9]+:\/\//i.test(l)) throw new Error(t('«{0}…» — это ключ одного сервера, а нужна ссылка на подписку (https://…)', l.slice(0, 24)));
      throw new Error(t('«{0}» — не похоже на ссылку подписки', l.slice(0, 30)));
    }
    const name = m[1].replace(/[\s|:—–-]+$/, '').trim().slice(0, 40);
    if (!out.some((x) => x.url === m[2])) out.push({ url: m[2], name });
  }
  return out;
}

// Имя подписки: своё, от провайдера (profile-title) или домен панели.
export const subName = (s, url) => s.subNames[url] || s.subMeta?.[url]?.title || new URL(url).hostname;
// Где искать логотип подписки: favicon сайта кабинета (часто это основной сайт провайдера, а подписка — на техническом
// домене), потом адреса подписки, потом их основных доменов. Только сайты самого провайдера — без сервисов иконок.
export function iconUrls(urls) {
  const hosts = urls.filter((u) => /^https?:\/\//.test(u ?? '')).map((u) => new URL(u));
  const main = hosts.filter((u) => u.hostname.split('.').length > 2 && !/^[\d.]+$/.test(u.hostname))
    .map((u) => `https://${u.hostname.split('.').slice(-2).join('.')}/favicon.ico`);
  return [...new Set([...hosts.map((u) => `${u.origin}/favicon.ico`), ...main])];
}

// При нескольких подписках mihomo добавляет к именам серверов префикс «1| » — людям он не нужен.
export const plainName = (n) => n.replace(/^\d+\| /, '');

// Состояние подписки по Subscription-Userinfo — общие пороги для шапки и уведомлений.
// expire бывает и в миллисекундах (больше 32e9), total = 0 — безлимит.
export function subStatus(i, now = Date.now()) {
  if (!i) return null;
  const used = (i.Upload || 0) + (i.Download || 0);
  const expireMs = !i.Expire ? 0 : i.Expire > 32e9 ? i.Expire : i.Expire * 1000;
  const daysLeft = expireMs ? (expireMs - now) / 864e5 : Infinity;
  return {
    used, total: i.Total || 0, expireMs, daysLeft,
    expired: daysLeft < 0,
    expiresSoon: daysLeft >= 0 && daysLeft < 3,
    trafficLow: !!i.Total && used / i.Total >= 0.9,
  };
}

// Порядок серверов внутри подписки. По пингу: живые по задержке, потом непроверенные, потом мёртвые.
export function sortServers(names, mode, nodes) {
  if (mode === 'name') return [...names].sort((a, b) => plainName(a).localeCompare(plainName(b), 'ru', { numeric: true }));
  if (mode !== 'ping') return names;
  const key = (n) => { const d = nodes.get(n)?.delay; return d > 0 ? d : d === 0 ? 2e9 : 1e9; };
  return [...names].sort((a, b) => key(a) - key(b));
}

const toSet = (list, v = 1) => Object.fromEntries(list.map((d) => [d, v]));
export const buildRules = (s) => ({
  // сайт с выбранным сервером всегда идёт через VPN; файл теста скорости — тоже (иначе меряли бы свой интернет)
  user: { ...toSet(s.directList, 'direct'), ...toSet(s.vpnList, 'vpn'), ...toSet(Object.keys(s.siteServers), 'vpn'), [SPEED_HOST]: 'vpn' },
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
      // без явного proxy mihomo качает подписку через правила, т.е. через REJECT, и она не грузится никогда;
      // через VPN — через ⚡ Авто, а не выбранный вручную сервер: тот может оказаться мёртвым
      type: 'http', url, interval: subInterval(s, url), proxy: viaVpn(s, url) ? AUTO : 'DIRECT',
      // префикс, чтобы одноимённые сервера из разных подписок не склеились
      ...(s.subs.length > 1 && { override: { 'additional-prefix': `${i + 1}| ` } }),
      ...(s.hwid && { header: Object.fromEntries(Object.entries(deviceHeaders(s.hwid)).map(([k, v]) => [k, [v]])) }),
    }])),
    // REJECT первым: если подписка не скачалась или все сервера мертвы — блок, а не трафик напрямую
    'proxy-groups': [
      { name: GROUP, type: 'select', proxies: ['REJECT', AUTO], use: names },
      // lazy: false — проверять серверы всегда, иначе нечем показывать задержки и ловить «все умерли»
      { name: AUTO, type: 'url-test', proxies: ['REJECT'], use: names, url: TEST_URL, interval: s.pingInterval, tolerance: 50, lazy: false },
      { name: SPEED, type: 'select', proxies: ['REJECT'], use: names },
      ...groups.map((_, i) => ({ name: `SITE${i}`, type: 'select', proxies: ['REJECT'], use: names })),
    ],
    rules: [`DOMAIN-SUFFIX,${SPEED_HOST},${SPEED}`, ...siteRules, `MATCH,${GROUP}`],
  };
}

// Ядро отвечает за миллисекунды; 30 с — с запасом на скачивание подписок при перезаливке конфига. Без предела
// зависшее ядро (или чужая программа на этом порту) навсегда держало бы кнопки «занято» и очередь фоновых проверок.
const CORE_TIMEOUT = 30e3;
export async function api(path, secret, opts = {}) {
  const r = await fetch(API + path, {
    signal: AbortSignal.timeout(CORE_TIMEOUT),
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
  await settleAuto(s.secret);
}

// Свежий url-test 10 с держит закэшированный выбор, и при фоновом трафике после заливки конфига это REJECT
// (сайты блокируются). Обновление подписки так не делает — mihomo сам перепроверяет серверы (проверено).
// Тест группы сбрасывает кэш: первый наполняет историю, второй — уже при известных живых серверах.
export async function settleAuto(secret) {
  await testGroup(AUTO, secret);
  await testGroup(AUTO, secret);
}

export const viaVpn = (s, url) => s.subViaVpn || s.subsViaVpn.includes(url);
// Как часто mihomo перекачивает подписку: как просит провайдер (profile-update-interval), иначе раз в час.
export const subInterval = (s, url) => (s.subMeta?.[url]?.updateHours || 1) * 3600;

// Скорость сервера в Мбит/с: файл с Cloudflare через группу SPEED. Ограничен 25 МБ и 8 секундами — расходует трафик подписки.
// Работает только при включённой Лазейке: запрос браузера идёт через PAC → mihomo → SPEED → этот сервер.
export async function speedTest(name, s, { bytes = 25e6, maxMs = 8000 } = {}) {
  // конфиг до 1.4 без группы SPEED — перезалить и повторить
  await select(SPEED, name, s.secret).catch(async () => { await pushConfig(s); await select(SPEED, name, s.secret); });
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), maxMs);
  const t0 = performance.now();
  let got = 0;
  try {
    const r = await fetch(`https://${SPEED_HOST}/__down?bytes=${bytes}`, { cache: 'no-store', signal: ctrl.signal });
    if (!r.ok) throw new Error(t('тест скорости: HTTP {0}', r.status));
    const reader = r.body.getReader();
    for (;;) { const { done, value } = await reader.read(); if (done) break; got += value.length; }
  } catch (e) {
    if (e.name !== 'AbortError') throw new Error(t('Сервер не смог скачать тестовый файл — возможно, он не работает'));
  } finally {
    clearTimeout(timer);
  }
  if (got < 1e5) throw new Error(t('Сервер почти ничего не скачал за 8 секунд — возможно, он не работает'));
  return (got * 8) / ((performance.now() - t0) / 1000) / 1e6;
}

// Почему подписка не скачалась — человеческими словами. Только адрес сайта: путь ссылки — это личный токен.
export function subError(e, url) {
  let host = t('подписки');
  try { host = new URL(url).host; } catch { /* оставим общее слово */ }
  const raw = e?.message ?? String(e);
  let m = raw;
  try { m = JSON.parse(raw.replace(/^mihomo \d+: /, '')).message ?? raw; } catch { /* не JSON — как есть */ }
  const code = m.match(/^(\d{3}) /)?.[1];
  if (code === '404' || code === '410') {
    return { kind: 'notfound', text: t('{0} ответил «не найдено» ({1}): ссылка устарела, подписка удалена или у провайдера кончился лимит устройств', host, code) };
  }
  if (['401', '403', '451'].includes(code)) return { kind: 'denied', text: t('{0} отказал в доступе ({1}) — возможно, не пускает из этой сети или страны', host, code) };
  if (/x509|certificate/i.test(m)) return { kind: 'cert', text: t('У сайта {0} проблема с сертификатом', host) };
  if (/EOF|reset|timeout|deadline|refused|no such host|handshake|unreachable|forcibly/i.test(m)) {
    return { kind: 'network', text: t('Сайт {0} не отвечает из этой сети — похоже, он здесь заблокирован', host) };
  }
  return { kind: 'other', text: `${t('Не удалось скачать подписку с {0}', host)}${code ? ` (${code})` : ''}` };
}

// Скачать подписки заново. Не вышло напрямую из-за сети или отказа, а живые серверы есть (из других подписок или кэша) —
// эта подписка дальше качается через VPN: s.subsViaVpn меняется, сохранить его — дело вызывающего.
// → Map(ссылка → null | { kind, text, viaVpn })
export async function refreshSubs(s, indices = s.subs.map((_, i) => i)) {
  const update = (i) => api(`/providers/proxies/sub${i + 1}`, s.secret, { method: 'PUT' }).then(() => null, (e) => subError(e, s.subs[i]));
  const errors = new Map(await Promise.all(indices.map(async (i) => [s.subs[i], await update(i)])));
  const retry = indices.filter((i) => ['network', 'denied', 'other'].includes(errors.get(s.subs[i])?.kind) && !viaVpn(s, s.subs[i]));
  if (retry.length) {
    await settleAuto(s.secret);
    const h = await health(s);
    if ([...h.nodes.values()].some((n) => n.delay > 0)) {
      s.subsViaVpn = [...s.subsViaVpn, ...retry.map((i) => s.subs[i])];
      await pushConfig(s);
      for (const i of retry) {
        const e = await update(i);
        errors.set(s.subs[i], e && { ...e, text: t('{0}. Через VPN тоже не вышло', e.text), viaVpn: true });
      }
    }
  }
  return errors;
}

// После рестарта mihomo грузит базовый config.yaml без нашей группы — заливаем заново.
export async function ensureConfig(s) {
  const r = await fetch(`${API}/proxies/${GROUP}`, { headers: { Authorization: `Bearer ${s.secret}` }, signal: AbortSignal.timeout(CORE_TIMEOUT) });
  if (r.status === 404) await pushConfig(s);
  else if (!r.ok) throw new Error(`mihomo ${r.status}: ${await r.text()}`);
}

// Сводка health-check mihomo. delay: число мс, 0 — не ответил, null — ещё не проверяли.
export async function health(s) {
  const [{ providers }, g, auto] = await Promise.all([
    api('/providers/proxies', s.secret), api(`/proxies/${GROUP}`, s.secret), api(`/proxies/${AUTO}`, s.secret),
  ]);
  // провайдеры sub1…subN ↔ s.subs[0…N-1]; JSON-ключи mihomo отсортированы как строки (sub10 < sub2), сортируем по номеру
  const subs = Object.entries(providers).filter(([, p]) => p.vehicleType === 'HTTP')
    .map(([key, p]) => ({ key, i: Number(key.slice(3)) - 1, p }))
    .sort((a, b) => a.i - b.i)
    .map(({ key, i, p }) => ({
      key,
      url: s.subs[i],
      name: s.subs[i] ? subName(s, s.subs[i]) : key,
      info: p.subscriptionInfo ?? null, // из заголовка Subscription-Userinfo: Upload/Download/Total байты, Expire unix-время
      servers: p.proxies.map((n) => n.name),
    }));
  const nodes = new Map(Object.values(providers).filter((p) => p.vehicleType === 'HTTP').flatMap((p) => p.proxies)
    .map((n) => [n.name, { alive: n.alive, delay: n.history.length ? n.history.at(-1).delay : null }]));
  const list = [...nodes.values()];
  const checked = list.some((n) => n.delay !== null);
  return {
    all: g.all.filter((n) => n !== 'REJECT'), // AUTO + серверы в порядке подписок
    subs,
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
  if (!r.ok) throw new Error(t('список заблокированных: HTTP {0}', r.status));
  const blocked = parseList(await r.text());
  if (blocked.length < 100) throw new Error(t('список заблокированных подозрительно короткий, оставил старый'));
  await chrome.storage.local.set({ blocked, blockedAt: Date.now() });
  if ((await proxyState()).on) await applyProxy(await load());
}

// --- обновления: версия и заметки из main на GitHub, установка — через помощника (core/host.ps1, core/host.sh)
export const RAW = 'https://raw.githubusercontent.com/DUFUSxD/lazeyka/main';
export const HOST = 'com.lazeyka.host';

// Команды и пути под систему (os из chrome.runtime.getPlatformInfo): Windows — PowerShell и %LOCALAPPDATA%,
// macOS и Linux — терминал и ~/Lazeyka. run* — как открыть место для команды (ключи переводов, переводит popup):
// runMid — посреди фразы, runStart — в начале, runShort — в коротком сообщении.
// storeInstall: из магазина ставится только расширение — ядро тем же установщиком, но без «загрузи распакованное».
export function osInfo(os) {
  if (os === 'win') {
    return {
      dir: '%LOCALAPPDATA%\\Lazeyka', sep: '\\',
      install: `powershell -c "irm ${RAW}/install.ps1 | iex"`,
      storeInstall: `powershell -c "$env:LAZEYKA_STORE=1; irm ${RAW}/install.ps1 | iex"`,
      core: 'powershell -ExecutionPolicy Bypass -File "%LOCALAPPDATA%\\Lazeyka\\core\\mihomo.ps1"',
      runMid: 'Win+R', runStart: 'Нажми Win+R', runShort: 'Win+R',
    };
  }
  const mac = os === 'mac';
  return {
    dir: '~/Lazeyka', sep: '/',
    install: `curl -fsSL ${RAW}/install.sh | sh`,
    storeInstall: `curl -fsSL ${RAW}/install.sh | LAZEYKA_STORE=1 sh`,
    core: 'sh ~/Lazeyka/core/mihomo.sh',
    runMid: mac ? 'открой Терминал (Cmd+Пробел → «Терминал»)' : 'открой терминал (Ctrl+Alt+T)',
    runStart: mac ? 'Открой Терминал (Cmd+Пробел → «Терминал»)' : 'Открой терминал (Ctrl+Alt+T)',
    runShort: mac ? 'Терминал' : 'терминал',
  };
}
// Установлено из Chrome Web Store / Edge Add-ons, а не «Загрузить распакованное»: обновления приходят из магазина.
export const fromStore = async () => (await chrome.management.getSelf()).installType !== 'development';

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
  if (!r.ok) throw new Error(t('проверка обновлений: HTTP {0}', r.status));
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
      if (!answered) reject(new Error(chrome.runtime.lastError?.message || t('Помощник завершился без ответа')));
    });
    port.postMessage({ cmd });
  });
}

// --- данные от провайдера: служебные заголовки подписки (их понимают Happ, Incy; отдают Remnawave, 3x-ui и др.)
// mihomo их наружу не отдаёт, поэтому расширение заглядывает в подписку само — с разрешения на сайт панели.

// «base64:…» или похожее на base64 — раскодировать, если получился нормальный текст; иначе оставить как есть.
export function decodeText(v) {
  if (!v) return '';
  let b64 = null;
  if (/^base64:/i.test(v)) b64 = v.slice(7);
  else if (v.length >= 8 && v.length % 4 === 0 && /^[A-Za-z0-9+/]+={0,2}$/.test(v)) b64 = v;
  if (b64 !== null) {
    try {
      const t = new TextDecoder('utf-8', { fatal: true }).decode(Uint8Array.from(atob(b64), (c) => c.charCodeAt(0)));
      if (!/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(t)) return t.replace(/\r\n?/g, '\n').trim(); // \t \n \r — можно
    } catch { /* не base64 или не UTF-8 */ }
    if (/^base64:/i.test(v)) return '';
  }
  return v.trim();
}

const httpUrl = (v) => { try { const u = new URL(v); return /^https?:$/.test(u.protocol) ? u.href : ''; } catch { return ''; } };

// Заголовки ответа подписки → то, что покажем. Всё от провайдера считаем недоверенным: только текст и http(s)-ссылки.
export function parseSubMeta(h, url) {
  const get = (n) => h.get(n) ?? '';
  const meta = {
    title: decodeText(get('profile-title') || get('subscription-name')).split('\n')[0].trim().slice(0, 40),
    support: httpUrl(get('support-url')),
    web: httpUrl(get('profile-web-page-url') || get('homepage')),
    announce: decodeText(get('announce')).slice(0, 200),
    updateHours: 0,
    newUrl: '',
  };
  const hours = Number(get('profile-update-interval'));
  if (Number.isInteger(hours) && hours >= 1 && hours <= 168) meta.updateHours = hours;
  // переезд подписки — только https → https
  if (url.startsWith('https://')) {
    const nu = get('new-url');
    const nd = get('new-domain').trim().toLowerCase();
    if (/^https:\/\/\S+$/i.test(nu) && httpUrl(nu)) meta.newUrl = httpUrl(nu);
    else if (/^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(nd)) { const u = new URL(url); u.hostname = nd; meta.newUrl = u.href; }
    if (meta.newUrl === url) meta.newUrl = '';
  }
  return meta;
}

// Подписка переехала: заменить ссылку во всех настройках, где она ключ или значение.
export function migrateSub(s, from, to) {
  const re = (u) => (u === from ? to : u);
  const reKeys = (o) => Object.fromEntries(Object.entries(o).map(([k, v]) => [re(k), v]));
  return {
    subs: s.subs.map(re), subNames: reKeys(s.subNames), subsViaVpn: s.subsViaVpn.map(re), subMeta: reKeys(s.subMeta),
    collapsed: (s.collapsed ?? []).map(re), // свёрнутая подписка после переезда остаётся свёрнутой
  };
}

const originOf = (url) => `${new URL(url).origin}/*`;
export const subOrigins = (subs) => [...new Set(subs.map(originOf))];

// Свои запросы расширения к панелям — с тем же User-Agent, что у mihomo, иначе панель отдаст HTML-страницу вместо
// подписки. Правило только для запросов вне вкладок (tabId -1): открытая во вкладке панель выглядит как обычно.
async function syncUaRule(subs, ua) {
  const old = await chrome.declarativeNetRequest.getSessionRules();
  await chrome.declarativeNetRequest.updateSessionRules({
    removeRuleIds: old.map((r) => r.id),
    addRules: [...new Set(subs.map((u) => new URL(u).origin))].map((o, i) => ({
      id: i + 1,
      priority: 1,
      action: { type: 'modifyHeaders', requestHeaders: [{ header: 'user-agent', operation: 'set', value: ua }] },
      condition: { urlFilter: `|${o}/`, tabIds: [chrome.tabs.TAB_ID_NONE], resourceTypes: ['xmlhttprequest', 'other'] },
    })),
  });
}

// Данные от провайдера по всем подпискам, на сайты которых есть разрешение. Не вышло — остаются прежние.
export async function refreshMeta(s) {
  const out = { ...s.subMeta };
  const version = (await api('/version', s.secret).catch(() => null))?.version ?? 'v1.19.32';
  await syncUaRule(s.subs, `clash.meta/${version}`);
  for (const url of s.subs) {
    if (!(await chrome.permissions.contains({ origins: [originOf(url)] }))) continue;
    try {
      // панель, которую режет DPI, может молчать бесконечно — без предела данные провайдера не обновились бы больше никогда
      const r = await fetch(url, { cache: 'no-store', credentials: 'omit', headers: deviceHeaders(s.hwid), signal: AbortSignal.timeout(15e3) });
      r.body?.cancel();
      if (r.ok) out[url] = { ...parseSubMeta(r.headers, url), fetchedAt: Date.now() };
    } catch { /* панель недоступна — оставим старое */ }
  }
  return out;
}

// --- перенос настроек одной строкой (без secret — он свой на каждом компьютере)
const PORTABLE = ['subs', 'subNames', 'rest', 'ruDirect', 'useBlocked', 'webrtc', 'subViaVpn', 'vpnList', 'directList', 'siteServers',
  'pingInterval', 'updateEvery', 'sortServers', 'hideDead', 'pingOnOpen', 'lang'];
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
  if (!m) throw new Error(t('Это не строка настроек Лазейки (должна начинаться с LZK1:)'));
  let o;
  try { o = JSON.parse(b64dec(m[1])); } catch { throw new Error(t('Строка настроек повреждена — скопируй её заново')); }
  if (!o || typeof o !== 'object') throw new Error(t('Строка настроек повреждена'));
  const strings = (v) => Array.isArray(v) && v.every((x) => typeof x === 'string');
  const out = {};
  if (strings(o.subs)) out.subs = parseSubs(o.subs.join('\n')).map((x) => x.url);
  if (o.subNames && typeof o.subNames === 'object') {
    out.subNames = Object.fromEntries(Object.entries(o.subNames)
      .filter(([u, n]) => /^https?:\/\/\S+$/i.test(u) && typeof n === 'string' && n.trim())
      .map(([u, n]) => [u, n.trim().slice(0, 40)]));
  }
  if (o.rest === 'vpn' || o.rest === 'direct') out.rest = o.rest;
  for (const k of ['ruDirect', 'useBlocked', 'webrtc', 'subViaVpn', 'hideDead', 'pingOnOpen']) if (typeof o[k] === 'boolean') out[k] = o[k];
  if (SORT_OPTIONS.some(([v]) => v === o.sortServers)) out.sortServers = o.sortServers;
  if (LANG_OPTIONS.some(([v]) => v === o.lang)) out.lang = o.lang;
  if (PING_OPTIONS.some(([v]) => v === o.pingInterval)) out.pingInterval = o.pingInterval;
  if (UPDATE_OPTIONS.some(([v]) => v === o.updateEvery)) out.updateEvery = o.updateEvery;
  for (const k of ['vpnList', 'directList']) if (strings(o[k])) out[k] = parseList(o[k].join('\n'));
  if (o.siteServers && typeof o.siteServers === 'object') {
    out.siteServers = Object.fromEntries(Object.entries(o.siteServers)
      .filter(([d, n]) => norm(d) && typeof n === 'string' && n).map(([d, n]) => [norm(d), n]));
  }
  if (!Object.keys(out).length) throw new Error(t('В строке нет настроек'));
  return out;
}
