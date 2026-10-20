import { load, ensureConfig, updateBlocked, proxyState } from './lib.js';

// mihomo после рестарта теряет залитый конфиг (до повторной заливки всё режет REJECT) — подстраховка раз в минуту.
async function sync() {
  const s = await load();
  if (s.secret) await ensureConfig(s).catch(() => {});
}
const blocked = () => updateBlocked().catch(() => {}); // нет сети/GitHub — останется прошлый список

// alarms создаём только тут: пересоздание при каждом пробуждении сбрасывало бы 6-часовой таймер
function setup() {
  chrome.alarms.create('sync', { periodInMinutes: 1 });
  chrome.alarms.create('blocked', { periodInMinutes: 360 });
  sync();
  blocked();
  // бейдж не переживает перезапуск браузера/перезагрузку расширения, а прокси — переживает
  proxyState().then(({ on }) => chrome.action.setBadgeText({ text: on ? 'ON' : '' }));
}
chrome.runtime.onInstalled.addListener(setup);
chrome.runtime.onStartup.addListener(setup);
chrome.alarms.onAlarm.addListener((a) => (a.name === 'blocked' ? blocked() : sync()));
