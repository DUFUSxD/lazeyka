import { AUTO, load, ensureConfig, updateBlocked, proxyState, setBadge, health, selectServer, toggle } from './lib.js';

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
    notify('lzk', `Лазейка: сервер «${h.now}» не отвечает`, 'Можно переключиться на ⚡ Авто — он сам выберет живой сервер.',
      [{ title: 'Переключить на ⚡ Авто' }]);
  }
  if (state === 'core') notify('lzk', 'Лазейка: ядро mihomo не запущено', 'Сайты через VPN не откроются. Открой Лазейку — там команда для запуска.');
  if (state === 'ok' && last !== 'ok') chrome.notifications.clear('lzk');
}
const blocked = () => updateBlocked().catch(() => {}); // нет сети/GitHub — останется прошлый список

// alarms создаём только тут: пересоздание при каждом пробуждении сбрасывало бы 6-часовой таймер
function setup() {
  chrome.alarms.create('sync', { periodInMinutes: 1 });
  chrome.alarms.create('blocked', { periodInMinutes: 360 });
  sync();
  blocked();
}
chrome.runtime.onInstalled.addListener(setup);
chrome.runtime.onStartup.addListener(setup);
chrome.alarms.onAlarm.addListener((a) => (a.name === 'blocked' ? blocked() : sync()));

chrome.commands.onCommand.addListener((cmd) => { if (cmd === 'toggle') toggle().then(sync); });

chrome.notifications.onButtonClicked.addListener(async () => {
  const s = await load();
  await selectServer(AUTO, s.secret).catch(() => {});
  chrome.notifications.clear('lzk');
  sync();
});
