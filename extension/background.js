import {
  AUTO, load, ensureConfig, pushConfig, updateBlocked, proxyState, applyProxy, setBadge, health, selectServer, toggle, plainName,
  checkUpdate, newer, hostCall, ensureHwid, subStatus, refreshMeta, migrateSub, subInterval,
} from './lib.js';
import { t, plural, lang } from './i18n.js';

const VERSION = chrome.runtime.getManifest().version;
const notify = (id, title, message, buttons) => chrome.notifications.create(id, {
  type: 'basic', iconUrl: 'icons/icon128.png', title, message, ...(buttons && { buttons }), priority: 1,
});

// Раз в минуту: mihomo после рестарта теряет залитый конфиг (до повторной заливки всё режет REJECT),
// заодно следим за здоровьем серверов и предупреждаем при смене состояния, а не каждую минуту.
async function sync() {
  const s = await load();
  const { on } = await proxyState();
  let state = 'ok';
  let h;
  if (s.secret) {
    try {
      await ensureConfig(s);
      h = await health(s);
      if (on && !h.empty) state = h.dead ? 'dead' : h.nowDead ? 'nowDead' : 'ok';
    } catch {
      state = on ? 'core' : 'ok';
    }
  }
  if (h) await subAlerts(s, h);
  await setBadge(on, state !== 'ok');
  const { last } = await chrome.storage.session.get({ last: 'ok' });
  if (state === last) return;
  await chrome.storage.session.set({ last: state });
  if (state === 'dead') notify('lzk', t('Лазейка: {0}', t('все серверы недоступны')), t('Сайты через VPN не откроются. Проверь подписку или сеть.'));
  if (state === 'nowDead') {
    notify('lzk', t('Лазейка: {0}', t('сервер «{0}» не отвечает', plainName(h.now))), t('Можно переключиться на ⚡ Авто — он сам выберет живой сервер.'),
      [{ title: t('Переключить на ⚡ Авто') }]);
  }
  if (state === 'core') notify('lzk', t('Лазейка: {0}', t('ядро mihomo не запущено')), t('Сайты через VPN не откроются. Открой Лазейку и нажми «Запустить ядро».'));
  if (state === 'ok' && last !== 'ok') chrome.notifications.clear('lzk');
}

// Подписка кончается или трафик на исходе — одно уведомление на каждое событие. Ключ включает срок и объём,
// поэтому после продления (новая дата) предупреждение придёт снова, когда опять подойдёт срок.
async function subAlerts(s, h) {
  const fresh = [];
  for (const sub of h.subs) {
    const st = subStatus(sub.info);
    if (!st || !sub.url) continue;
    const days = Math.max(1, Math.ceil(st.daysLeft));
    const events = [
      st.expired && ['expired', t('Подписка «{0}» закончилась', sub.name), t('Продли её у провайдера — иначе её серверы перестанут работать.')],
      st.expiresSoon && ['soon', t('Подписка «{0}» заканчивается', sub.name), t('Осталось {0} — не забудь продлить.', plural(days, 'день|дня|дней'))],
      st.trafficLow && ['traffic', t('Трафик подписки «{0}» на исходе', sub.name),
        t('Израсходовано {0}% — осталось {1} ГБ.', Math.round((st.used / st.total) * 100), ((st.total - st.used) / 1024 ** 3).toFixed(1))],
    ].filter(Boolean);
    for (const [kind, title, text] of events) {
      const key = `${sub.url}|${kind}|${st.expireMs}|${st.total}`;
      if (s.alerted.includes(key)) continue;
      fresh.push(key);
      notify(`lzk-sub-${fresh.length}-${Date.now()}`, t('Лазейка: {0}', title), text);
    }
  }
  if (fresh.length) await chrome.storage.local.set({ alerted: [...s.alerted, ...fresh].slice(-50) });
}

const blocked = () => updateBlocked().catch(() => {}); // нет сети/GitHub — останется прошлый список

// Данные от провайдера (название, поддержка, объявление, интервал, переезд). Подписка переехала — меняем ссылку везде
// и перезаливаем ядро; изменился интервал обновления — тоже.
let metaRunning = false;
async function meta() {
  if (metaRunning) return;
  metaRunning = true;
  try {
    let s = await load();
    if (!s.secret || !s.subs.length) return;
    const intervals = (x) => JSON.stringify(x.subs.map((u) => subInterval(x, u)));
    const before = intervals(s);
    s = { ...s, subMeta: await refreshMeta(s) };
    let moved = 0;
    for (const url of [...s.subs]) {
      const to = s.subMeta[url]?.newUrl;
      if (!to || s.subs.includes(to)) continue;
      Object.assign(s, migrateSub(s, url, to));
      moved++;
      notify(`lzk-move-${moved}`, t('Лазейка: {0}', t('провайдер сменил адрес подписки')), t('Подписка теперь на {0} — обновил сам, ничего делать не нужно.', new URL(to).host));
    }
    await chrome.storage.local.set({ subMeta: s.subMeta, ...(moved && { subs: s.subs, subNames: s.subNames, subsViaVpn: s.subsViaVpn }) });
    if (moved || intervals(s) !== before) await pushConfig(s).catch(() => {});
  } finally {
    metaRunning = false;
  }
}

// Новая версия на GitHub — одно уведомление на версию; дальше её показывает баннер в popup.
async function updates() {
  await load(); // язык уведомления
  const u = await checkUpdate().catch(() => null);
  if (!u || !newer(u.latest, VERSION)) return;
  const { notifiedVersion } = await chrome.storage.local.get('notifiedVersion');
  if (notifiedVersion === u.latest) return;
  await chrome.storage.local.set({ notifiedVersion: u.latest });
  // заметки из CHANGELOG — только по-русски
  notify('lzk-upd', t('Вышла Лазейка {0}', u.latest), (lang() === 'ru' && u.notes[0]) || t('Открой Лазейку и нажми «Обновить» — это один клик.'));
}

// Обновление идёт здесь, а не в popup: popup закрывается от любого клика мимо, а порт к помощнику держит service worker живым.
async function selfUpdate() {
  const r = await hostCall('update');
  if (!r.ok) throw new Error(r.error);
  if (!newer(r.version, VERSION)) return { ok: true, same: true }; // GitHub ещё отдаёт старый архив (кэш ~5 мин)
  setTimeout(() => chrome.runtime.reload(), 300); // перечитать файлы с диска
  return { ok: true, version: r.version };
}

chrome.runtime.onMessage.addListener((msg, _sender, reply) => {
  if (msg?.meta) { meta().then(() => reply({ ok: true }), (e) => reply({ ok: false, error: e.message })); return true; }
  const run = { update: selfUpdate, start: () => hostCall('start'), ping: () => hostCall('ping') }[msg?.host];
  if (!run) return false;
  run().then(reply, (e) => reply({ ok: false, error: e.message }));
  return true; // ответ асинхронный
});

// alarms создаём только тут: пересоздание при каждом пробуждении сбрасывало бы таймеры
// Проверка обновлений по настройке; 0 — «только вручную»: никаких обращений к GitHub, даже при запуске.
async function scheduleUpdates(check) {
  const { updateEvery } = await load();
  if (!updateEvery) return chrome.alarms.clear('update');
  chrome.alarms.create('update', { periodInMinutes: updateEvery });
  if (check) updates();
}

async function setup() {
  await ensureHwid();
  chrome.alarms.create('sync', { periodInMinutes: 1 });
  chrome.alarms.create('blocked', { periodInMinutes: 360 });
  chrome.alarms.create('meta', { periodInMinutes: 60 });
  sync();
  blocked();
  meta().catch(() => {});
  await scheduleUpdates(true);
}
chrome.storage.onChanged.addListener((ch, area) => { if (area === 'local' && ch.updateEvery) scheduleUpdates(false); });
chrome.runtime.onInstalled.addListener(async (d) => {
  // новая версия могла поменять правила сайтов или конфиг ядра — применить сразу, а не при следующем включении
  await ensureHwid();
  // до 1.6 Лазейка была только русской — у тех, кто обновляется, не переключать её на язык браузера
  if (d.reason === 'update' && newer('1.6.0', d.previousVersion ?? '0') && !(await chrome.storage.local.get('lang')).lang) {
    await chrome.storage.local.set({ lang: 'ru' });
  }
  const s = await load();
  if ((await proxyState()).on) await applyProxy(s).catch(() => {});
  // ядро держит конфиг прошлой версии, пока его не перезапустят, — перезалить (ядро не запущено — догонит ensureConfig)
  if (d.reason === 'update' && s.secret && s.subs.length) await pushConfig(s).catch(() => {});
  setup();
  if (d.reason === 'update' && d.previousVersion !== VERSION) {
    notify('lzk-upd', t('Лазейка обновлена до {0}', VERSION), t('Всё готово, настройки на месте.'));
  }
});
chrome.runtime.onStartup.addListener(setup);
chrome.alarms.onAlarm.addListener((a) => ({ blocked, update: updates, meta }[a.name] ?? sync)());
// разрешение на сайт панели выдают из popup, а он может закрыться от окна браузера — данные качаем здесь
chrome.permissions.onAdded.addListener(() => meta().catch(() => {}));

chrome.commands.onCommand.addListener((cmd) => { if (cmd === 'toggle') toggle().then(sync); });

chrome.notifications.onButtonClicked.addListener(async (id) => {
  if (id !== 'lzk') return;
  const s = await load();
  await selectServer(AUTO, s.secret).catch(() => {});
  chrome.notifications.clear('lzk');
  sync();
});
chrome.notifications.onClicked.addListener((id) => {
  chrome.notifications.clear(id);
  chrome.action.openPopup?.().catch(() => {}); // где браузер разрешает — сразу открыть Лазейку
});
