import {
  GROUP, AUTO, api, load, norm, parseList, parseSubs, buildRules, decide, isLan,
  pushConfig, ensureConfig, health, selectServer, testGroup, proxyState, applyProxy, toggle, updateBlocked,
  exportSettings, importSettings, checkUpdate, newer, UPDATE_CMD,
} from './lib.js';

const $ = (id) => document.getElementById(id);
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
    else sub = `${h.now === AUTO ? '⚡ Авто → ' : ''}${cur}${delayOf(cur)[0] ? ` · ${delayOf(cur)[0]}` : ''}`;
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
  const opts = [['', 'Как у всех'], [AUTO, '⚡ Авто'], ...names.map((n) => [n, n])];
  if (bound && !opts.some(([v]) => v === bound)) opts.push([bound, `${bound} (нет в подписке)`]);
  $('siteServer').replaceChildren(...opts.map(([v, t]) => new Option(t, v)));
  $('siteServer').value = bound ?? '';
  $('siteWarn').hidden = !missing;
  $('siteWarn').textContent = missing ? `⚠ Сервера «${bound}» больше нет в подписке — сайт заблокирован. Выбери другой.` : '';
}

function renderServers() {
  const q = $('search').value.trim().toLowerCase();
  if (!h || h.empty) {
    $('count').textContent = '';
    $('search').hidden = true;
    const li = document.createElement('li');
    li.className = 'empty';
    li.textContent = h ? 'Серверов нет — проверь ссылки подписок в настройках' : h === null ? '—' : 'Загружаю…';
    return $('list').replaceChildren(li);
  }
  $('count').textContent = String(h.all.length - 1);
  $('search').hidden = h.all.length <= 9;
  $('list').replaceChildren(...h.all.filter((n) => !q || n === AUTO || n.toLowerCase().includes(q)).map((n) => {
    const isAuto = n === AUTO;
    const [d, cls] = delayOf(isAuto ? h.autoNow : n);
    const b = document.createElement('button');
    b.className = `node${n === h.now ? ' cur' : ''}${cls === 'bad' ? ' dead' : ''}`;
    b.setAttribute('role', 'option');
    b.setAttribute('aria-selected', String(n === h.now));
    const name = document.createElement('span');
    name.className = 'name';
    name.textContent = isAuto ? '⚡ Авто' : n;
    if (isAuto) {
      const hint = document.createElement('span');
      hint.className = 'hint';
      hint.textContent = h.autoNow === 'REJECT' ? 'самый быстрый живой' : `→ ${h.autoNow}`;
      name.append(hint);
    }
    const delay = document.createElement('span');
    delay.className = `delay ${cls}`;
    delay.textContent = d;
    b.append(name, delay);
    b.title = isAuto ? 'Сам выбирает самый быстрый живой сервер и переключается, если текущий упал' : n;
    b.onclick = () => run(async () => { await selectServer(n, s.secret); await refreshHealth(); });
    const li = document.createElement('li');
    li.append(b);
    return li;
  }));
}

async function refreshHealth() {
  h = await health(s);
  if (h.now === 'REJECT' && !h.empty) { await selectServer(AUTO, s.secret); h = await health(s); } // первый запуск
  renderPower(); renderServers(); renderSite();
  // Авто ещё ищет живой сервер — заглянем ещё раз чуть позже
  if (h.now === AUTO && h.autoNow === 'REJECT' && !h.dead && !h.empty && polls++ < 8) setTimeout(() => run(refreshHealth), 1500);
}

async function render() {
  const st = await proxyState();
  on = st.on;
  renderPower(); renderSite();
  if (st.levelOfControl === 'controlled_by_other_extensions') return showAlert('other');
  if (st.levelOfControl === 'not_controllable') return showAlert('policy');
  if (!s.secret || !s.subs.length) { renderServers(); return showAlert('setup'); }
  await ensureConfig(s);
  showAlert(null);
  await refreshHealth();
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
  const res = await Promise.allSettled([
    updateBlocked(),
    ...s.subs.map((_, i) => api(`/providers/proxies/sub${i + 1}`, s.secret, { method: 'PUT' })),
  ]);
  s = await load();
  await render();
  const failed = res.find((r) => r.status === 'rejected');
  if (failed) throw failed.reason;
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
function fillSettings() {
  rest = s.rest;
  bindings = { ...s.siteServers };
  for (const b of document.querySelectorAll('#restSeg button')) b.setAttribute('aria-checked', String(b.dataset.v === rest));
  for (const k of ['ruDirect', 'useBlocked', 'webrtc', 'subViaVpn']) $(k).checked = s[k];
  for (const k of ['vpnList', 'directList', 'subs']) $(k).value = s[k].join('\n');
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
    t.textContent = `${d} → ${n === AUTO ? '⚡ Авто' : n}`;
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

// Сохранить новые настройки: mihomo перезаливаем, только если поменялось то, что он видит.
async function apply(next) {
  const mihomoKey = (x) => JSON.stringify([x.subs, x.secret, x.subViaVpn, x.siteServers]);
  const push = next.secret && next.subs.length && mihomoKey(next) !== mihomoKey(s);
  const { blocked, blockedAt, ...settings } = next; // список itdoginfo не трогаем
  await chrome.storage.local.set(settings);
  s = next;
  if (on) await applyProxy(s);
  if (push) { toast('Загружаю подписки…'); await pushConfig(s); }
}

$('save').onclick = () => run(() => busy($('save'), async () => {
  await apply({
    ...s,
    subs: parseSubs($('subs').value),
    secret: $('secret').value.trim(),
    rest,
    ruDirect: $('ruDirect').checked,
    useBlocked: $('useBlocked').checked,
    webrtc: $('webrtc').checked,
    subViaVpn: $('subViaVpn').checked,
    vpnList: parseList($('vpnList').value),
    directList: parseList($('directList').value),
    siteServers: bindings,
  });
  showMain();
  toast('Сохранено ✓');
  await render();
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
run(render);
