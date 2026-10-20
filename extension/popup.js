import {
  GROUP, AUTO, CONTROLLER, load, norm, parseList, parseSubs, plainName, subName, buildRules, decide, isLan,
  pushConfig, ensureConfig, health, selectServer, testGroup, proxyState, applyProxy, toggle, updateBlocked, refreshSubs, viaVpn,
  exportSettings, importSettings, checkUpdate, newer, UPDATE_CMD, PING_OPTIONS, UPDATE_OPTIONS, SORT_OPTIONS,
  ensureHwid, subStatus, sortServers, speedTest, subOrigins,
} from './lib.js';

const $ = (id) => document.getElementById(id);
const el = (tag, className = '', textContent = '') => Object.assign(document.createElement(tag), { className, textContent });
const CORE_CMD = 'powershell -ExecutionPolicy Bypass -File "%LOCALAPPDATA%\\Lazeyka\\core\\mihomo.ps1"';
const VERSION = chrome.runtime.getManifest().version;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
// помощник (core/host.ps1) вызывается через service worker — он живёт, даже если popup закроют
const host = (cmd) => chrome.runtime.sendMessage({ host: cmd });
// Почему помощник недоступен — человеческими словами; null — помощник есть, ошибка другая.
function hostProblem(e = '') {
  if (/forbidden/i.test(e)) return 'Лазейка загружена не из папки установщика (%LOCALAPPDATA%\\Lazeyka\\extension), поэтому кнопка не работает. Загрузи расширение оттуда или выполни команду.';
  if (/not found/i.test(e)) return 'Обновление в один клик заработает после этой версии — сейчас нужно один раз выполнить команду.';
  return null;
}
const WHY = { list: 'твой список', blocked: 'заблокирован в РФ', ru: 'российский сайт', rest: 'остальные сайты', lan: 'локальная сеть' };

let s = await load();
s.hwid ||= await ensureHwid(); // нужен в конфиге ядра, если popup открыли раньше, чем проснулся service worker
let on = false;
let h;                 // сводка health(); undefined — ещё не загрузили, null — ядро недоступно
let rest = s.rest;     // черновик «Остальные сайты» в настройках
let bindings = {};     // черновик «Свои серверы для сайтов» в настройках
let polls = 0;

const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
const tabUrl = /^https?:/.test(tab?.url ?? '') ? tab.url : '';
const tabHost = tabUrl ? new URL(tabUrl).hostname : '';
const site = norm(tabHost);

// --- мелочи интерфейса
let toastTimer;
function toast(text, kind = '') {
  const t = $('toast');
  t.textContent = text;
  t.className = `toast show ${kind}`;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.className = 'toast'; }, kind === 'err' ? 5000 : 2500);
}

const ALERTS = {
  setup: ['Почти готово', 'Открой настройки: вставь secret из установщика и ссылку на подписку.', null, 'Открыть настройки'],
  core: ['Ядро mihomo не запущено', 'Нажми «Запустить ядро». Если не сработает — Win+R, вставь команду ниже и Enter.', CORE_CMD, 'Запустить ядро', 'Скопировать команду'],
  secret: ['Неверный secret', 'Скопируй его заново из %LOCALAPPDATA%\\Lazeyka\\core\\config.yaml (строка secret:).', null, 'Открыть настройки'],
  other: ['Прокси занят другим расширением', 'Отключи другие VPN- и прокси-расширения: прокси в браузере может держать только одно расширение.', null, 'Открыть расширения'],
  policy: ['Прокси заблокирован политикой', 'Администратор этого компьютера запретил расширениям менять прокси.', null, null],
};
const ALERT_ACTIONS = {
  setup: () => showSettings(),
  core: startCore,
  secret: () => showSettings(),
  other: () => chrome.tabs.create({ url: 'chrome://extensions' }),
};
let alertKind = null;
function showAlert(kind) {
  alertKind = kind;
  $('alert').hidden = !kind;
  $('alert').classList.toggle('info', kind === 'setup');
  $('servers').hidden = !!kind && kind !== 'other';
  if (!kind) return;
  const [title, text, code, btn] = ALERTS[kind];
  $('alertTitle').textContent = title;
  $('alertText').textContent = text;
  $('alertCode').hidden = !code;
  $('alertCode').textContent = code ?? '';
  $('alertBtn').hidden = !btn;
  $('alertBtn').textContent = btn ?? '';
  $('alertBtn2').hidden = !ALERTS[kind][4];
  $('alertBtn2').textContent = ALERTS[kind][4] ?? '';
}
$('alertBtn').onclick = () => run(() => busy($('alertBtn'), async () => ALERT_ACTIONS[alertKind]?.()));
$('alertBtn2').onclick = () => navigator.clipboard.writeText(CORE_CMD).then(() => toast('Команда скопирована: Win+R → вставить → Enter'));

async function startCore() {
  const r = await host('start');
  if (!r?.ok) {
    await navigator.clipboard.writeText(CORE_CMD).catch(() => {});
    const why = /forbidden/i.test(r?.error) ? hostProblem(r.error)
      : /not found/i.test(r?.error) ? 'Кнопка заработает после обновления через команду.' : `Не получилось: ${r?.error}.`;
    throw new Error(`${why} Пока — Win+R, вставь (команда уже скопирована), Enter`);
  }
  toast('Запускаю ядро…');
  for (let i = 0; i < 20; i++) {
    await sleep(500);
    try { await render(); } catch { continue; }
    if (alertKind !== 'core') return toast('Ядро запущено ✓');
  }
  throw new Error('Ядро не ответило. Попробуй команду: Win+R, вставь, Enter');
}

// Все действия через run: понятные сообщения вместо исключений.
async function run(fn) {
  try {
    await fn();
  } catch (e) {
    if (e instanceof TypeError && /fetch/i.test(e.message)) { h = null; showAlert('core'); renderPower(); }
    else if (/mihomo 401/.test(e.message)) showAlert('secret');
    else { console.error(e); toast(e.message, 'err'); }
  }
}

async function busy(btn, fn) {
  btn.disabled = true;
  try { await fn(); } finally { btn.disabled = false; }
}

// --- главный экран
function delayOf(name) {
  const n = h?.nodes.get(name);
  if (!n || n.delay === null) return ['', ''];
  if (n.delay === 0) return ['нет ответа', 'bad'];
  return [`${n.delay} мс`, n.delay < 300 ? 'good' : n.delay < 800 ? 'mid' : 'slow'];
}

function renderPower() {
  const bad = on && (h === null || h?.empty || h?.dead);
  $('power').className = `power${on ? (bad ? ' err' : ' on') : ''}`;
  $('power').setAttribute('aria-pressed', String(on));
  $('power').setAttribute('aria-label', on ? 'Выключить Лазейку' : 'Включить Лазейку');
  $('status').className = `status${on ? (bad ? ' err' : ' on') : ''}`;
  let status = on ? 'Включено' : 'Выключено';
  let sub = '';
  if (on && h === null) status = 'Нет связи с ядром';
  else if (on && h?.empty) status = 'Нет серверов';
  else if (on && h?.dead) status = 'Все серверы недоступны';
  if (h && !h.empty) {
    const cur = h.now === AUTO ? h.autoNow : h.now;
    if (h.now === AUTO && cur === 'REJECT') sub = h.dead ? '⚡ Авто: живых серверов нет' : '⚡ Авто подбирает сервер…';
    else {
      // при нескольких подписках — чей это сервер
      const from = h.subs.length > 1 ? h.subs.find((x) => x.servers.includes(cur))?.name : null;
      sub = `${h.now === AUTO ? '⚡ Авто → ' : ''}${plainName(cur)}${from ? ` (${from})` : ''}${delayOf(cur)[0] ? ` · ${delayOf(cur)[0]}` : ''}`;
    }
  }
  $('status').textContent = status;
  $('sub').textContent = sub;
  $('sub').title = sub;
}

function renderSite() {
  $('site').hidden = !site;
  if (!site) return;
  $('host').textContent = site;
  $('fav').src = `/_favicon/?pageUrl=${encodeURIComponent(tabUrl)}&size=32`;
  const bound = s.siteServers[site];
  const mode = bound || s.vpnList.includes(site) ? 'vpn' : s.directList.includes(site) ? 'direct' : 'auto';
  for (const b of document.querySelectorAll('#site .seg button')) b.setAttribute('aria-checked', String(b.dataset.m === mode));
  const [vpn, why] = isLan(tabHost) ? [false, 'lan'] : decide(tabHost, buildRules(s));
  $('why').className = `why ${vpn ? 'vpn' : 'direct'}`;
  $('why').textContent = `${vpn ? 'Через VPN' : 'Напрямую'} — ${bound ? 'свой сервер' : WHY[why]}${on ? '' : ' (когда включено)'}`;

  $('siteServerRow').hidden = mode === 'direct';
  const names = h ? h.all.filter((n) => n !== AUTO) : [];
  const missing = bound && bound !== AUTO && h && !names.includes(bound);
  // серверы сгруппированы по подпискам, как в списке
  const groups = (h?.subs ?? []).map((sub) => {
    const g = document.createElement('optgroup');
    g.label = sub.name;
    g.append(...sub.servers.map((n) => new Option(plainName(n), n)));
    return g;
  });
  const extra = bound && bound !== AUTO && !names.includes(bound) ? [new Option(`${plainName(bound)} (нет в подписке)`, bound)] : [];
  $('siteServer').replaceChildren(new Option('Как у всех', ''), new Option('⚡ Авто', AUTO), ...groups, ...extra);
  $('siteServer').value = bound ?? '';
  $('siteWarn').hidden = !missing;
  $('siteWarn').textContent = missing ? `⚠ Сервера «${plainName(bound)}» больше нет в подписке — сайт заблокирован. Выбери другой.` : '';
}

function renderServers() {
  const q = $('search').value.trim().toLowerCase();
  if (!h || (h.empty && !h.subs.length)) {
    $('count').textContent = '';
    $('search').hidden = true;
    const li = document.createElement('li');
    li.className = 'empty';
    li.textContent = h ? 'Серверов нет — проверь ссылки подписок в настройках' : h === null ? '—' : 'Загружаю…';
    return $('list').replaceChildren(li);
  }
  $('count').textContent = String(h.all.length - 1);
  $('search').hidden = h.all.length <= 9;
  const match = (n) => !q || plainName(n).toLowerCase().includes(q);
  // выбранный, текущий у ⚡ Авто и привязанные к сайтам не прячем, даже если не отвечают
  const keep = new Set([h.now, h.autoNow, ...Object.values(s.siteServers)]);
  let hidden = 0;
  const visible = (n) => {
    if (!s.hideDead || showDead || keep.has(n) || h.nodes.get(n)?.delay !== 0) return true;
    hidden++;
    return false;
  };
  // ⚡ Авто сверху, дальше серверы группами по подпискам: шапка с логотипом, названием, трафиком и сроком.
  // Подписка, которая не скачалась, тоже видна — с причиной, иначе непонятно, куда она делась.
  const items = [...(h.empty ? [] : [nodeItem(AUTO)]), ...h.subs.flatMap((sub) => {
    if (!sub.servers.length) return q ? [] : subHeader(sub);
    const servers = sortServers(sub.servers, s.sortServers, h.nodes).filter(match).filter(visible);
    return servers.length || !q ? [...subHeader(sub), ...servers.map(nodeItem)] : [];
  })];
  if (hidden) {
    const b = el('button', 'btn small', `Скрыто неработающих: ${hidden} — показать`);
    b.onclick = () => { showDead = true; renderServers(); };
    const li = el('li', 'more');
    li.append(b);
    items.push(li);
  }
  $('list').replaceChildren(...items);
}
let showDead = false; // «показать» скрытые неработающие — до закрытия окна

const subErrors = new Map(); // ссылка → { kind, text }: почему подписка не скачалась
const triedSubs = new Set(); // пустые подписки, которые уже пробовали починить в этом открытии окна
let fixing = false;

// Скачать подписки заново; не скачалась напрямую — refreshSubs сам переводит её на VPN, если есть живые серверы.
async function fixSubs(indices) {
  const before = new Set(s.subsViaVpn);
  const errors = await refreshSubs(s, indices);
  await chrome.storage.local.set({ subsViaVpn: s.subsViaVpn });
  for (const [url, e] of errors) if (e) subErrors.set(url, e); else subErrors.delete(url);
  h = await health(s);
  renderPower(); renderServers(); renderSite();
  const moved = s.subsViaVpn.find((u) => !before.has(u) && errors.has(u) && !errors.get(u));
  if (moved) toast(`Сайт подписки ${new URL(moved).host} недоступен напрямую — скачал через VPN ✓`);
  return errors;
}

function nodeItem(n) {
  const isAuto = n === AUTO;
  const [d, cls] = delayOf(isAuto ? h.autoNow : n);
  const b = document.createElement('button');
  b.className = `node${n === h.now ? ' cur' : ''}${cls === 'bad' ? ' dead' : ''}`;
  b.setAttribute('role', 'option');
  b.setAttribute('aria-selected', String(n === h.now));
  const name = document.createElement('span');
  name.className = 'name';
  name.textContent = isAuto ? '⚡ Авто' : plainName(n);
  if (isAuto) {
    const hint = document.createElement('span');
    hint.className = 'hint';
    hint.textContent = h.autoNow === 'REJECT' ? 'самый быстрый живой' : `→ ${plainName(h.autoNow)}`;
    name.append(hint);
  }
  const delay = document.createElement('span');
  delay.className = `delay ${cls}`;
  delay.textContent = d;
  b.append(name, delay);
  b.title = isAuto ? 'Сам выбирает самый быстрый живой сервер и переключается, если текущий упал' : plainName(n);
  b.onclick = () => run(async () => { await selectServer(n, s.secret); await refreshHealth(); });
  const li = el('li', 'node-row');
  li.append(b);
  if (!isAuto) li.append(speedButton(n));
  return li;
}

// Тест скорости любого сервера, не переключаясь на него. Результаты живут до закрытия окна.
const speeds = new Map(); // сервер → Мбит/с
let speedNow = null;      // сервер, который меряем сейчас
const mbit = (v) => `${v < 10 ? v.toFixed(1) : Math.round(v)} Мбит/с`;
function speedButton(n) {
  const v = speeds.get(n);
  const b = el('button', `spd${v !== undefined ? ' has' : ''}${speedNow === n ? ' busy' : ''}`, speedNow === n ? '…' : v === undefined ? '⇣' : mbit(v));
  b.title = 'Тест скорости: скачать до 25 МБ через этот сервер (расходует трафик подписки)';
  b.setAttribute('aria-label', `Тест скорости: ${plainName(n)}`);
  b.disabled = !!speedNow;
  b.onclick = () => run(async () => {
    if (!on) throw new Error('Включи Лазейку — тест скорости идёт через неё');
    speedNow = n;
    renderServers();
    try { speeds.set(n, await speedTest(n, s)); } finally { speedNow = null; renderServers(); }
  });
  return b;
}

// Шапка подписки в две строки: название; под ним трафик и срок (из Subscription-Userinfo), «через VPN» и ссылки провайдера.
const GB = 1024 ** 3;
const gb = (b) => (b / GB).toFixed(b < 10 * GB ? 1 : 0);
function subHeader(sub) {
  const st = subStatus(sub.info);
  const parts = [];
  if (st?.total) parts.push(`${gb(st.used)} из ${gb(st.total)} ГБ`); else if (st?.used) parts.push(`${gb(st.used)} ГБ`);
  if (st?.expireMs) parts.push(st.expired ? 'истекла' : `до ${new Date(st.expireMs).toLocaleDateString('ru', { day: 'numeric', month: 'long' })}`);
  if (sub.url && viaVpn(s, sub.url)) parts.push('через VPN');
  const meta = (sub.url && s.subMeta[sub.url]) || {};
  const links = [['support', 'Поддержка'], ['web', 'Кабинет']].filter(([k]) => /^https?:\/\//.test(meta[k] ?? '')).map(([k, text]) => {
    const a = Object.assign(el('a', 'sub-link', text), { href: meta[k], target: '_blank', rel: 'noopener noreferrer' });
    a.title = new URL(meta[k]).host;
    return a;
  });
  const lines = el('div', 'sub-lines');
  const name = el('span', 'sub-name', sub.name);
  name.title = sub.name;
  lines.append(name);
  if (parts.length || links.length) {
    const second = el('div', 'sub-second');
    const warn = st && (st.expired || st.expiresSoon || st.trafficLow);
    if (parts.length) second.append(el('span', `sub-info${warn ? ' warn' : ''}`, parts.join(' · ')));
    second.append(...links);
    lines.append(second);
  }
  const li = el('li', 'sub-head');
  li.append(subIcon(sub), lines);
  if (sub.servers.length) return [li];

  // пустая подписка: почему и что можно сделать
  const err = subErrors.get(sub.url);
  const box = document.createElement('li');
  box.className = 'sub-error';
  const why = document.createElement('span');
  why.textContent = `⚠ ${err?.text ?? (fixing ? 'Не скачалась — пробую ещё раз…' : 'Подписка не скачалась')}`;
  box.append(why);
  if (sub.url && !viaVpn(s, sub.url) && err && err.kind !== 'notfound') {
    const b = document.createElement('button');
    b.className = 'btn small';
    b.textContent = 'Скачать через VPN';
    b.onclick = () => run(() => busy(b, async () => {
      s.subsViaVpn = [...s.subsViaVpn, sub.url];
      await chrome.storage.local.set({ subsViaVpn: s.subsViaVpn });
      toast('Скачиваю через VPN…');
      await pushConfig(s);
      const e = (await fixSubs([s.subs.indexOf(sub.url)])).get(sub.url);
      if (e) throw new Error(e.text);
    }));
    box.append(b);
  }
  return [li, box];
}

// Логотип подписки — favicon сайта панели (сначала сам адрес, потом основной домен), иначе кружок с буквой.
// Сторонние сервисы иконок не используем: они узнали бы, какими панелями ты пользуешься.
const icons = new Map(); // url подписки → найденный адрес картинки или null
function subIcon(sub) {
  const letter = () => {
    const el = document.createElement('span');
    el.className = 'sub-ico letter';
    el.textContent = (sub.name.match(/[\p{L}\p{N}]/u)?.[0] ?? '?').toUpperCase();
    el.style.background = `hsl(${[...sub.name].reduce((a, c) => a + c.codePointAt(0), 0) % 360} 50% 42%)`;
    return el;
  };
  if (!sub.url) return letter();
  const known = icons.get(sub.url);
  if (known === null) return letter();
  const img = new Image(16, 16);
  img.className = 'sub-ico';
  img.alt = '';
  const u = new URL(sub.url);
  const parts = u.hostname.split('.');
  const tries = known ? [known] : [`${u.origin}/favicon.ico`,
    ...(parts.length > 2 && !/^[\d.]+$/.test(u.hostname) ? [`https://${parts.slice(-2).join('.')}/favicon.ico`] : [])];
  img.onload = () => icons.set(sub.url, img.src);
  img.onerror = () => {
    const next = tries.shift();
    if (next) img.src = next; else { icons.set(sub.url, null); img.replaceWith(letter()); }
  };
  img.src = tries.shift();
  return img;
}

async function refreshHealth() {
  h = await health(s);
  if (h.now === 'REJECT' && !h.empty) { await selectServer(AUTO, s.secret); h = await health(s); } // первый запуск
  renderPower(); renderServers(); renderSite();
  // Авто ещё ищет живой сервер — заглянем ещё раз чуть позже
  if (h.now === AUTO && h.autoNow === 'REJECT' && !h.dead && !h.empty && polls++ < 8) setTimeout(() => run(refreshHealth), 1500);
  // пустые подписки — один раз за открытие окна узнать причину и, если можно, скачать через VPN
  const broken = s.subs.map((u, i) => [u, i]).filter(([u]) => h.subs.find((x) => x.url === u)?.servers.length === 0 && !triedSubs.has(u));
  if (broken.length && !fixing) {
    for (const [u] of broken) triedSubs.add(u);
    fixing = true;
    renderServers();
    run(() => fixSubs(broken.map(([, i]) => i))).finally(() => { fixing = false; renderServers(); });
  }
}

async function render() {
  const st = await proxyState();
  on = st.on;
  renderPower(); renderSite();
  if (!on) stopTraffic();
  if (st.levelOfControl === 'controlled_by_other_extensions') return showAlert('other');
  if (st.levelOfControl === 'not_controllable') return showAlert('policy');
  if (!s.secret || !s.subs.length) { renderServers(); return showAlert('setup'); }
  await ensureConfig(s);
  showAlert(null);
  await refreshHealth();
  if (on) startTraffic();
}

// Скорость и объём через VPN: mihomo раз в секунду шлёт строку JSON в /traffic. Сайты «напрямую» сюда не попадают.
let traffic = null;
const size = (b) => (b < 1024 ** 2 ? `${Math.round(b / 1024)} КБ` : b < GB ? `${(b / 1024 ** 2).toFixed(1)} МБ` : `${(b / GB).toFixed(2)} ГБ`);
async function startTraffic() {
  if (traffic) return;
  const ctrl = traffic = new AbortController();
  try {
    const r = await fetch(`http://${CONTROLLER}/traffic`, { headers: { Authorization: `Bearer ${s.secret}` }, signal: ctrl.signal });
    const reader = r.body.pipeThrough(new TextDecoderStream()).getReader();
    let buf = '';
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      const lines = (buf + value).split('\n');
      buf = lines.pop();
      const last = lines.filter(Boolean).at(-1);
      if (!last) continue;
      const t = JSON.parse(last);
      const total = t.upTotal + t.downTotal;
      $('rate').textContent = `↓ ${size(t.down)}/с  ↑ ${size(t.up)}/с${total >= 0 ? ` · всего ${size(total)}` : ''}`;
    }
  } catch { /* выключили, закрыли окно или ядро упало */ }
  if (traffic === ctrl) stopTraffic();
}
function stopTraffic() {
  traffic?.abort();
  traffic = null;
  $('rate').textContent = '';
}

// Сообщение провайдера (заголовок announce) — пока его не закроют; новое сообщение покажется снова.
async function renderNews() {
  const { newsSeen = [] } = await chrome.storage.local.get('newsSeen');
  const key = (u) => `${new URL(u).host}|${s.subMeta[u].announce}`;
  const url = s.subs.find((u) => s.subMeta[u]?.announce && !newsSeen.includes(key(u)));
  $('news').hidden = !url;
  if (!url) return;
  $('newsTitle').textContent = `Сообщение от «${subName(s, url)}»`;
  $('newsText').textContent = s.subMeta[url].announce;
  $('newsClose').onclick = async () => {
    await chrome.storage.local.set({ newsSeen: [...newsSeen, key(url)].slice(-20) });
    renderNews();
  };
}

// Данные провайдера качает service worker (он живёт, даже если окно закроется); потом перерисовать то, что от них зависит.
async function pullMeta() {
  const r = await chrome.runtime.sendMessage({ meta: true });
  if (!r?.ok) return;
  s = { ...s, ...(await chrome.storage.local.get(['subMeta', 'subs', 'subNames', 'subsViaVpn'])) }; // мог переехать адрес подписки
  renderNews();
  if (h) await refreshHealth();
}

// Проверить серверы при открытии окна — не чаще раза в минуту, даже если окно открывают часто.
async function pingOnOpen() {
  if (!s.pingOnOpen || !h || h.empty) return;
  const { lastPing = 0 } = await chrome.storage.session.get('lastPing');
  if (Date.now() - lastPing < 60e3) return;
  await chrome.storage.session.set({ lastPing: Date.now() });
  $('ping').click();
}

$('power').onclick = () => run(() => busy($('power'), async () => { on = await toggle(); await render(); }));

// Изменение правил для открытого сайта: сохранить, применить, перезагрузить вкладку.
async function saveSite(push) {
  await chrome.storage.local.set({ vpnList: s.vpnList, directList: s.directList, siteServers: s.siteServers });
  renderSite();
  if (push) { toast('Применяю…'); await pushConfig(s); }
  if (on) { await applyProxy(s); await chrome.tabs.reload(tab.id); }
  toast(on ? 'Готово — страница перезагружается' : 'Сохранено');
  if (h) await refreshHealth();
}

for (const b of document.querySelectorAll('#site .seg button')) {
  b.onclick = () => run(async () => {
    if (!site) return;
    const m = b.dataset.m;
    s.vpnList = s.vpnList.filter((d) => d !== site);
    s.directList = s.directList.filter((d) => d !== site);
    if (m === 'vpn') s.vpnList.push(site);
    if (m === 'direct') s.directList.push(site);
    const hadServer = site in s.siteServers;
    if (m !== 'vpn') delete s.siteServers[site]; // «Авто»/«Напрямую» снимают свой сервер
    await saveSite(hadServer && !(site in s.siteServers));
  });
}

$('siteServer').onchange = () => run(() => busy($('siteServer'), async () => {
    if (!site) return;
  const v = $('siteServer').value;
  s.siteServers = { ...s.siteServers };
  if (v) { s.siteServers[site] = v; s.directList = s.directList.filter((d) => d !== site); } else delete s.siteServers[site];
  await saveSite(true);
}));

$('ping').onclick = () => run(() => busy($('ping'), async () => {
  $('ping').textContent = '…';
  try { await testGroup(GROUP, s.secret); await refreshHealth(); } finally { $('ping').textContent = 'Пинг'; }
}));

$('refresh').onclick = () => run(() => busy($('refresh'), async () => {
  toast('Обновляю подписки и списки…');
  const [blocked] = await Promise.allSettled([updateBlocked()]);
  s = await load();
  fillSettings();
  const failed = [...(await fixSubs(s.subs.map((_, i) => i))).values()].find(Boolean);
  if (failed) throw new Error(failed.text); // только адрес сайта, без токена из ссылки
  if (blocked.status === 'rejected') throw blocked.reason;
  toast('Обновлено ✓');
}));

$('search').oninput = renderServers;

// --- обновления
const fmtTime = (t) => new Date(t).toLocaleString('ru', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
async function renderUpdate() {
  const { update, dismissedVersion } = await chrome.storage.local.get(['update', 'dismissedVersion']);
  const has = !!update && newer(update.latest, VERSION);
  $('upd').hidden = !has || dismissedVersion === update.latest;
  if (has) {
    $('updTitle').textContent = `Доступна версия ${update.latest}`;
    $('updNotes').replaceChildren(...update.notes.slice(0, 4).map((n) => Object.assign(document.createElement('li'), { textContent: n })));
  }
  $('verInfo').textContent = `Установлена ${VERSION}${update ? ` · проверено ${fmtTime(update.checkedAt)}` : ''}${has ? ` · есть ${update.latest}` : update ? ' · это последняя' : ''}`;
}

function showManualUpdate(err) {
  $('upd').hidden = false;
  $('updManual').hidden = false;
  $('updCmd').textContent = UPDATE_CMD;
  $('updErr').textContent = hostProblem(err) ?? `Не получилось обновить автоматически: ${err}`;
}

$('updBtn').onclick = () => run(() => busy($('updBtn'), async () => {
  $('updBtn').textContent = 'Обновляю…';
  try {
    const r = await host('update');
    if (r?.ok && r.same) toast('GitHub ещё отдаёт старую версию — попробуй через пару минут', 'err');
    else if (r?.ok) toast(`Обновлено до ${r.version} — перезапускаюсь…`); // service worker сам перезагрузит расширение
    else showManualUpdate(r?.error);
  } finally {
    $('updBtn').textContent = 'Обновить';
  }
}));
$('updLater').onclick = async () => {
  const { update } = await chrome.storage.local.get('update');
  await chrome.storage.local.set({ dismissedVersion: update?.latest });
  $('upd').hidden = true;
};
$('updCopy').onclick = () => navigator.clipboard.writeText(UPDATE_CMD).then(() => toast('Команда скопирована: Win+R → вставить → Enter'));
$('updReload').onclick = () => chrome.runtime.reload();
$('checkUpd').onclick = () => run(() => busy($('checkUpd'), async () => {
  const u = await checkUpdate();
  await chrome.storage.local.remove('dismissedVersion');
  await renderUpdate();
  if (newer(u.latest, VERSION)) { showMain(); toast(`Есть версия ${u.latest}`); } else toast('У тебя последняя версия ✓');
}));

// --- настройки
for (const [id, opts] of [['pingInterval', PING_OPTIONS], ['updateEvery', UPDATE_OPTIONS], ['sortServers', SORT_OPTIONS]]) {
  $(id).replaceChildren(...opts.map(([v, t]) => new Option(t, v)));
}

function fillSettings() {
  rest = s.rest;
  bindings = { ...s.siteServers };
  for (const b of document.querySelectorAll('#restSeg button')) b.setAttribute('aria-checked', String(b.dataset.v === rest));
  for (const k of ['ruDirect', 'useBlocked', 'webrtc', 'subViaVpn', 'hideDead', 'pingOnOpen']) $(k).checked = s[k];
  for (const k of ['pingInterval', 'updateEvery', 'sortServers']) $(k).value = s[k];
  renderMetaHint();
  for (const k of ['vpnList', 'directList']) $(k).value = s[k].join('\n');
  $('subs').value = s.subs.map((u) => (s.subNames[u] ? `${s.subNames[u]} ${u}` : u)).join('\n');
  $('secret').value = s.secret;
  $('blockedInfo').textContent = s.blocked.length
    ? `Список itdoginfo: ${s.blocked.length} доменов, обновлён ${new Date(s.blockedAt).toLocaleDateString('ru')}`
    : 'Список ещё не скачан — нажми ⟳ на главном экране';
  renderBindings();
}

function renderBindings() {
  const entries = Object.entries(bindings);
  $('noBindings').hidden = entries.length > 0;
  $('bindings').replaceChildren(...entries.map(([d, n]) => {
    const li = document.createElement('li');
    const t = document.createElement('span');
    t.textContent = `${d} → ${n === AUTO ? '⚡ Авто' : plainName(n)}`;
    t.title = t.textContent;
    const x = document.createElement('button');
    x.className = 'icon-btn small';
    x.textContent = '✕';
    x.setAttribute('aria-label', `Убрать свой сервер для ${d}`);
    x.onclick = () => { delete bindings[d]; renderBindings(); };
    li.append(t, x);
    return li;
  }));
}

for (const b of document.querySelectorAll('#restSeg button')) {
  b.onclick = () => {
    rest = b.dataset.v;
    for (const x of document.querySelectorAll('#restSeg button')) x.setAttribute('aria-checked', String(x === b));
  };
}

function showSettings() {
  fillSettings();
  $('mainView').hidden = true;
  $('settingsView').hidden = false;
  $('gear').setAttribute('aria-pressed', 'true');
  (s.secret ? $('subs') : $('secret')).focus();
}
function showMain() {
  $('settingsView').hidden = true;
  $('mainView').hidden = false;
  $('gear').setAttribute('aria-pressed', 'false');
}
$('gear').onclick = () => ($('settingsView').hidden ? showSettings() : showMain());
$('back').onclick = showMain;

$('showSecret').onclick = () => { $('secret').type = $('secret').type === 'password' ? 'text' : 'password'; };

// Название, поддержка и сообщения провайдера: нужно разрешение на сайт панели (просим только по кнопке).
async function renderMetaHint() {
  const origins = subOrigins(s.subs);
  const ok = origins.length > 0 && await chrome.permissions.contains({ origins });
  $('metaGrant').hidden = !origins.length || ok;
  $('metaHint').textContent = !origins.length ? ''
    : ok ? 'Название, поддержка и сообщения провайдера подтягиваются сами ✓'
      : 'Лазейка может подтянуть от провайдера название, ссылку на поддержку и его сообщения. Браузер спросит разрешение на сайт панели.';
}
$('metaGrant').onclick = () => {
  let subs = s.subs;
  try { subs = parseSubs($('subs').value).map((x) => x.url); } catch { /* в поле ошибка — берём сохранённые */ }
  // request — первым делом в обработчике клика, иначе браузер не покажет запрос
  chrome.permissions.request({ origins: subOrigins(subs) }).then((ok) => run(async () => {
    await renderMetaHint();
    if (!ok) return toast('Без разрешения название и ссылки провайдера не подтянутся', 'err');
    toast('Загружаю данные провайдера…');
    await pullMeta();
    await renderMetaHint();
    toast('Готово ✓');
  }));
};

// Сохранить новые настройки: mihomo перезаливаем, только если поменялось то, что он видит.
async function apply(next) {
  const mihomoKey = (x) => JSON.stringify([x.subs, x.secret, x.subViaVpn, x.siteServers, x.pingInterval]);
  const push = next.secret && next.subs.length && mihomoKey(next) !== mihomoKey(s);
  // список itdoginfo и то, что пишет service worker (данные провайдера, уведомления), не трогаем — у popup они могли устареть
  const { blocked, blockedAt, subMeta, alerted, hwid, ...settings } = next;
  await chrome.storage.local.set(settings);
  s = next;
  if (on) await applyProxy(s);
  if (push) { toast('Загружаю подписки…'); await pushConfig(s); }
}

$('save').onclick = () => run(() => busy($('save'), async () => {
  const subs = parseSubs($('subs').value);
  await apply({
    ...s,
    subs: subs.map((x) => x.url),
    subNames: Object.fromEntries(subs.filter((x) => x.name).map((x) => [x.url, x.name])),
    secret: $('secret').value.trim(),
    rest,
    ruDirect: $('ruDirect').checked,
    useBlocked: $('useBlocked').checked,
    webrtc: $('webrtc').checked,
    subViaVpn: $('subViaVpn').checked,
    pingInterval: Number($('pingInterval').value),
    updateEvery: Number($('updateEvery').value),
    sortServers: $('sortServers').value,
    hideDead: $('hideDead').checked,
    pingOnOpen: $('pingOnOpen').checked,
    vpnList: parseList($('vpnList').value),
    directList: parseList($('directList').value),
    siteServers: bindings,
  });
  showMain();
  toast('Сохранено ✓');
  await render();
  run(pullMeta); // новая подписка — сразу её название и ссылки (если разрешение уже есть)
}));

$('export').onclick = () => run(async () => {
  await navigator.clipboard.writeText(exportSettings(s));
  toast('Строка настроек скопирована — вставь её на другом компьютере');
});

$('import').onclick = () => run(() => busy($('import'), async () => {
  await apply({ ...s, ...importSettings($('importStr').value) });
  $('importStr').value = '';
  fillSettings();
  toast(s.secret ? 'Настройки импортированы ✓' : 'Импортировано. Осталось вставить secret и сохранить');
}));

$('shortcuts').onclick = () => chrome.tabs.create({ url: 'chrome://extensions/shortcuts' });

const cmd = (await chrome.commands.getAll()).find((c) => c.name === 'toggle');
$('hotkey').textContent = cmd?.shortcut || 'не задана';

renderUpdate();
renderNews();
run(render).then(() => run(pingOnOpen));
