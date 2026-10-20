import {
  AUTO, load, ensureConfig, updateBlocked, proxyState, setBadge, health, selectServer, toggle, plainName,
  checkUpdate, newer, hostCall,
} from './lib.js';

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
  await setBadge(on, state !== 'ok');
  const { last } = await chrome.storage.session.get({ last: 'ok' });
  if (state === last) return;
  await chrome.storage.session.set({ last: state });
  if (state === 'dead') notify('lzk', 'Лазейка: все серверы недоступны', 'Сайты через VPN не откроются. Проверь подписку или сеть.');
  if (state === 'nowDead') {
    notify('lzk', `Лазейка: сервер «${plainName(h.now)}» не отвечает`, 'Можно переключиться на ⚡ Авто — он сам выберет живой сервер.',
      [{ title: 'Переключить на ⚡ Авто' }]);
  }
  if (state === 'core') notify('lzk', 'Лазейка: ядро mihomo не запущено', 'Сайты через VPN не откроются. Открой Лазейку и нажми «Запустить ядро».');
  if (state === 'ok' && last !== 'ok') chrome.notifications.clear('lzk');
}
const blocked = () => updateBlocked().catch(() => {}); // нет сети/GitHub — останется прошлый список

// Новая версия на GitHub — одно уведомление на версию; дальше её показывает баннер в popup.
async function updates() {
  const u = await checkUpdate().catch(() => null);
  if (!u || !newer(u.latest, VERSION)) return;
  const { notifiedVersion } = await chrome.storage.local.get('notifiedVersion');
  if (notifiedVersion === u.latest) return;
  await chrome.storage.local.set({ notifiedVersion: u.latest });
  notify('lzk-upd', `Вышла Лазейка ${u.latest}`, u.notes[0] ?? 'Открой Лазейку и нажми «Обновить» — это один клик.');
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
  chrome.alarms.create('sync', { periodInMinutes: 1 });
  chrome.alarms.create('blocked', { periodInMinutes: 360 });
  sync();
  blocked();
  await scheduleUpdates(true);
}
chrome.storage.onChanged.addListener((ch, area) => { if (area === 'local' && ch.updateEvery) scheduleUpdates(false); });
chrome.runtime.onInstalled.addListener((d) => {
  setup();
  if (d.reason === 'update' && d.previousVersion !== VERSION) {
    notify('lzk-upd', `Лазейка обновлена до ${VERSION}`, 'Всё готово, настройки на месте.');
  }
});
chrome.runtime.onStartup.addListener(setup);
chrome.alarms.onAlarm.addListener((a) => ({ blocked, update: updates }[a.name] ?? sync)());

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
