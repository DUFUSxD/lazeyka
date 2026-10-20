import {
  GROUP, AUTO, TEST_URL, api, load, norm, parseList, buildRules, route, isLan,
  pushConfig, ensureConfig, proxyState, applyProxy, proxyOff, updateBlocked,
} from './lib.js';

const $ = (id) => document.getElementById(id);
const msg = (t) => { $('msg').textContent = t; };
const LABELS = { [AUTO]: '⚡ Авто — самый быстрый живой' };
let s = await load();
let on = false;
let delays = null; // null — ещё не пинговали

const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
const tabHost = /^https?:/.test(tab?.url ?? '') ? new URL(tab.url).hostname : '';
const site = norm(tabHost);

function fillSettings() {
  $('rest').value = s.rest;
  for (const k of ['ruDirect', 'useBlocked', 'webrtc']) $(k).checked = s[k];
  for (const k of ['vpnList', 'directList', 'subs']) $(k).value = s[k].join('\n');
  $('secret').value = s.secret;
  $('blockedInfo').textContent = s.blocked.length
    ? `список itdoginfo: ${s.blocked.length} доменов, обновлён ${new Date(s.blockedAt).toLocaleDateString('ru')}`
    : 'список ещё не скачан — нажми «Обновить»';
}

// Все обращения к mihomo через run: единая обработка «ядро не запущено»/ошибок API.
async function run(fn) {
  try { await fn(); } catch (e) {
    msg(e instanceof TypeError ? 'mihomo не запущен — запусти core\\mihomo.ps1' : e.message);
  }
}

// Кнопка и текущий сайт — без mihomo. Возвращает предупреждение, если прокси не наш.
async function renderLocal() {
  const st = await proxyState();
  on = st.on;
  $('toggle').textContent = on ? 'ВКЛ' : 'ВЫКЛ';
  $('toggle').classList.toggle('on', on);
  $('site').hidden = !site;
  if (site) {
    const mode = s.vpnList.includes(site) ? 'vpn' : s.directList.includes(site) ? 'direct' : 'auto';
    for (const b of document.querySelectorAll('.seg button')) b.classList.toggle('cur', b.dataset.m === mode);
    $('host').textContent = site;
    const vpn = !isLan(tabHost) && route(tabHost, buildRules(s));
    $('now').textContent = `сейчас: ${vpn ? 'через VPN' : 'напрямую'}${on ? '' : ' (когда включено)'}`;
  }
  if (st.levelOfControl === 'controlled_by_other_extensions') return 'Прокси занят другим расширением — отключи его';
  if (st.levelOfControl === 'not_controllable') return 'Прокси заблокирован политикой браузера (рабочий ПК?)';
  return '';
}

const select = (name) => api(`/proxies/${GROUP}`, s.secret, { method: 'PUT', body: JSON.stringify({ name }) });

async function renderServers() {
  if (!s.secret) return msg('Открой «Настройки»: вставь secret и ссылки на подписки');
  await ensureConfig(s);
  const g = await api(`/proxies/${GROUP}`, s.secret);
  const nodes = g.all.filter((n) => n !== 'REJECT');
  if (g.now === 'REJECT' && nodes[0]) { await select(nodes[0]); g.now = nodes[0]; }
  $('list').replaceChildren(...nodes.map((n) => {
    const li = document.createElement('li');
    li.textContent = LABELS[n] ?? n;
    li.dataset.d = !delays ? '' : n in delays ? `${delays[n]} ms` : '✕';
    li.classList.toggle('cur', n === g.now);
    li.onclick = () => run(() => select(n).then(renderServers));
    return li;
  }));
  msg(nodes.length > 1 ? '' : 'Нет серверов — проверь ссылки подписок');
}

async function render() {
  const warn = await renderLocal();
  if (warn) return msg(warn);
  await renderServers();
}

$('toggle').onclick = () => run(async () => { await (on ? proxyOff() : applyProxy(s)); await render(); });

for (const b of document.querySelectorAll('.seg button')) {
  b.onclick = () => run(async () => {
    s.vpnList = s.vpnList.filter((d) => d !== site);
    s.directList = s.directList.filter((d) => d !== site);
    if (b.dataset.m !== 'auto') s[`${b.dataset.m}List`].push(site);
    await chrome.storage.local.set({ vpnList: s.vpnList, directList: s.directList });
    fillSettings();
    if (on) { await applyProxy(s); await chrome.tabs.reload(tab.id); }
    await renderLocal();
  });
}

$('ping').onclick = () => run(async () => {
  msg('Пингую…');
  const q = `url=${encodeURIComponent(TEST_URL)}&timeout=5000`;
  delays = await api(`/group/${GROUP}/delay?${q}`, s.secret).catch(() => ({})); // 504 — не ответил ни один
  await renderServers();
});

$('refresh').onclick = () => run(async () => {
  msg('Обновляю…');
  const res = await Promise.allSettled([
    updateBlocked(),
    ...s.subs.map((_, i) => api(`/providers/proxies/sub${i + 1}`, s.secret, { method: 'PUT' })),
  ]);
  s = await load();
  fillSettings();
  await render();
  const failed = res.find((r) => r.status === 'rejected');
  if (failed) throw failed.reason;
});

$('save').onclick = () => run(async () => {
  const prev = s;
  s = {
    ...s,
    rest: $('rest').value,
    ruDirect: $('ruDirect').checked,
    useBlocked: $('useBlocked').checked,
    webrtc: $('webrtc').checked,
    vpnList: parseList($('vpnList').value),
    directList: parseList($('directList').value),
    subs: $('subs').value.split('\n').map((x) => x.trim()).filter(Boolean),
    secret: $('secret').value.trim(),
  };
  const { blocked, blockedAt, ...settings } = s; // список itdoginfo не перезаписываем
  await chrome.storage.local.set(settings);
  fillSettings(); // показать нормализованные списки
  if (on) await applyProxy(s);
  if (s.secret && (s.secret !== prev.secret || s.subs.join() !== prev.subs.join())) {
    msg('Загружаю подписки…');
    delays = null;
    await pushConfig(s);
  }
  await render();
});

fillSettings();
$('settings').open = !s.secret || !s.subs.length;
run(render);
