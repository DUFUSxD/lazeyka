# Публикация в магазинах расширений

Всё, что нужно для карточек в **Microsoft Edge Add-ons** и **Chrome Web Store**: порядок действий, тексты на русском и английском, обоснования разрешений и картинки (`images/`).

## Как устроена версия из магазина

- Магазин ставит только расширение. Ядро mihomo и помощник ставятся той же командой установщика, но с пометкой `LAZEYKA_STORE` — тогда установщик не просит «загрузить распакованное». Окно Лазейки само показывает эту команду, если ядра нет (`STORE_INSTALL_CMD` в `lib.js`).
- Расширение понимает, что оно из магазина, по `chrome.management.getSelf().installType` (у распакованного — `development`). Тогда оно не проверяет обновления на GitHub и не показывает кнопку «Обновить»: версии приходят из магазина.
- Помощник пускает только расширения из своего списка ID. У каждого магазина ID свой и выдаётся при первой загрузке — его нужно дописать в `$storeIds` в `core/mihomo.ps1` (см. шаг 4).
- Архив для загрузки прикладывается к каждому релизу: `lazeyka-extension-X.Y.Z.zip` на странице [Releases](https://github.com/DUFUSxD/lazeyka/releases). В `manifest.json` нет `key` — так и должно быть.

## Порядок действий

1. **Аккаунт разработчика.**
   - Edge: [Partner Center](https://partner.microsoft.com/dashboard/microsoftedge/overview) → программа Microsoft Edge, регистрация бесплатная, нужен аккаунт Microsoft.
   - Chrome: [Chrome Web Store Developer Dashboard](https://chrome.google.com/webstore/devconsole), разовый взнос $5. Российские карты Google не принимает — нужна зарубежная.
2. **Новый элемент** → загрузить `lazeyka-extension-X.Y.Z.zip` из последнего релиза.
3. **Заполнить карточку** текстами и картинками ниже; политика конфиденциальности — https://dufusxd.github.io/lazeyka/en/privacy.html (русская — https://dufusxd.github.io/lazeyka/privacy.html).
4. **Сразу после загрузки** магазин покажет ID расширения (32 буквы a–p). Дописать оба ID в `core/mihomo.ps1`:
   ```powershell
   $storeIds = @('ID-из-Chrome-Web-Store', 'ID-из-Edge-Add-ons')
   ```
   и выпустить версию. Без этого кнопка «Запустить ядро» у версии из магазина ответит «forbidden», хотя установщик ядро поставит и запустит.
5. **Отправить на проверку.** Обычно занимает от нескольких дней до пары недель; вопросы проверяющих чаще всего про `nativeMessaging` и `proxy` — ответы ниже.
6. После публикации — добавить ссылки на магазины в README, на сайт и в FAQ («Будет ли Лазейка в магазине»).

## Риски

- **Доступность в России.** Магазины могут скрыть VPN-расширение в регионе по требованию регулятора; в Partner Center и Developer Dashboard можно выбрать страны.
- **Законы РФ.** С 2024 года в России запрещена популяризация средств обхода блокировок, с сентября 2025 — реклама VPN. Карточка в магазине — это описание программы, но тексты лучше держать нейтральными (без «обхода блокировок»); перед публикацией и продвижением стоит самому проверить актуальные правила.
- **Проверка.** Расширение, которому нужна программа на компьютере, — обычная история (менеджеры паролей так же работают), но проверяющие могут попросить пояснений. Код открыт — ссылка на репозиторий помогает.

---

## Тексты карточки

### Название
- RU: **Лазейка — VPN для браузера через свои подписки**
- EN: **Lazeyka — browser VPN with your own subscriptions**

(в манифесте имя короткое — «Лазейка» / «Lazeyka»; в магазине можно длиннее)

### Краткое описание (до 132 символов)
- RU: VPN только для браузера через свои подписки VLESS/Reality, Hysteria2, Trojan, Shadowsocks — с правилами для сайтов.
- EN: Browser-only VPN through your own VLESS/Reality, Hysteria2, Trojan or Shadowsocks subscriptions, with per-site rules.

### Подробное описание — RU

```
Лазейка — VPN только для браузера через твои собственные серверы. Вставляешь ссылку на подписку, нажимаешь большую зелёную кнопку — и сайты открываются через VPN. Игры, мессенджеры и обновления Windows работают как обычно, напрямую.

• Твои подписки: VLESS (в том числе Reality), VMess, Trojan, Shadowsocks, Hysteria2, TUIC — ссылки от провайдера, Telegram-бота или своей панели (Remnawave, 3x-ui, Marzban).
• Правила по сайтам: свои списки «всегда через VPN» и «всегда напрямую», отдельный сервер для отдельного сайта. Готовые правила для России: российские сайты — напрямую, заблокированные — через VPN.
• ⚡ Авто: сам выбирает самый быстрый работающий сервер и переключается, если текущий упал.
• Без утечек: если ядро недоступно, сайты через VPN не откроются, а не пойдут с настоящим адресом. Защита от утечки IP через WebRTC.
• Трафик и срок подписки, уведомления о скором окончании, тест скорости серверов, поиск по странам.
• Интерфейс на русском и английском.

Важно: браузеры сами не умеют VLESS, поэтому Лазейке нужна бесплатная программа-ядро mihomo на компьютере (Windows 10/11). Она ставится одной командой — окно расширения её покажет.

Без своих серверов, аккаунтов, аналитики и рекламы: подписки хранятся только на твоём компьютере. Открытый код (MIT): https://github.com/DUFUSxD/lazeyka
```

### Подробное описание — EN

```
Lazeyka is a VPN for your browser only — through your own servers. Paste your subscription link, press the big green button, and websites open through your VPN. Games, messengers and Windows updates keep working directly.

• Your own subscriptions: VLESS (including Reality), VMess, Trojan, Shadowsocks, Hysteria2, TUIC — links from your provider, a Telegram bot or your own panel (Remnawave, 3x-ui, Marzban).
• Per-site rules: your own "always via VPN" and "always direct" lists, and a dedicated server for a specific site. Ready-made rules for users in Russia.
• ⚡ Auto: picks the fastest working server and switches when the current one goes down.
• No leaks: if the core is unavailable, VPN sites don't open instead of leaking your real IP. WebRTC IP leak protection.
• Subscription traffic and expiry, expiry notifications, server speed test, search by country.
• English and Russian interface.

Note: browsers can't speak VLESS themselves, so Lazeyka needs the free mihomo core program on your computer (Windows 10/11). It installs with one command — the extension window shows it.

No servers, accounts, analytics or ads of our own: your subscriptions stay on your computer. Open source (MIT): https://github.com/DUFUSxD/lazeyka
```

### Категория и поиск
- Chrome Web Store: **Privacy & Security** (или **Tools**).
- Edge Add-ons: **Productivity** / **Privacy and security**, если доступна.
- Поисковые слова (Edge, до 7): `VPN`, `VLESS`, `Reality`, `proxy`, `Hysteria2`, `mihomo`, `split tunneling`.

### Картинки (`images/`)
| Файл | Размер | Где |
|---|---|---|
| `screenshot-1..3-ru.png`, `screenshot-1..3-en.png` | 1280×800 | скриншоты (до 5 в Chrome, до 10 в Edge; можно по языкам) |
| `promo-small-ru.png`, `promo-small-en.png` | 440×280 | малая промо-плитка (обязательна в Chrome) |
| `marquee-ru.png`, `marquee-en.png` | 1400×560 | большой баннер (по желанию) |
| `../extension/icons/icon128.png` | 128×128 | значок магазина |

Картинки собраны из скриншотов `docs/images`; пересобрать — тем же способом, что описан в `docs/development.md` для скриншотов.

---

## Обоснования разрешений (для формы магазина, на английском)

**Single purpose:** Route the browser's traffic through the user's own VPN/proxy subscriptions (via a local mihomo core) with per-site rules.

| Permission | Justification |
|---|---|
| `proxy` | Core function: sets a PAC script so that only the sites chosen by the user's rules go through the user's own proxy (the local mihomo core at 127.0.0.1); other sites stay direct. |
| `privacy` | Sets `webRTCIPHandlingPolicy` to stop WebRTC from leaking the user's real IP while the VPN is on. The user can turn it off. |
| `storage` | Stores the user's settings: subscription links, site lists, per-site servers, interface options. |
| `alarms` | Periodic checks of the local core and server health, refreshing the blocked-sites list and subscription provider data. |
| `activeTab` | Shows which rule applies to the current site in the popup and reloads that tab after the user changes its rule. |
| `notifications` | Alerts about an expiring subscription, low traffic, a server going down or the local core not running. |
| `favicon` | Shows the current site's icon in the popup's site card. |
| `nativeMessaging` | Talks to the helper installed by the user's installer on the same computer, to start the local mihomo core with one click. |
| `declarativeNetRequestWithHostAccess` | A session rule sets the User-Agent of the extension's own background requests to the user's subscription panel, so the panel returns subscription metadata (provider name, support link). It applies only to non-tab requests and only to panels the user granted access to. |
| Host `http://127.0.0.1:19090/*` | REST API of the local mihomo core (configuration, server status, traffic). |
| Host `https://speed.cloudflare.com/*` | User-initiated speed test of a chosen server. |
| Optional hosts `https://*/*`, `http://*/*` | Requested at runtime, only for the user's own subscription panel domains and only when the user clicks “Allow”, to read provider metadata. |

**Remote code:** No. All code is in the package; the extension doesn't load or evaluate remote scripts. (The GitHub self-update used by the unpacked version is disabled for store installs.)

## Раздел «Конфиденциальность» в форме

- **Собираемые данные.** Разработчику ничего не передаётся. Ссылки на подписки (в них токен доступа) и настройки хранятся локально и уходят только на сайт провайдера, который указал сам пользователь. Если форма требует отметить категорию — **Authentication information**, с пояснением «stored locally, used only to download the user's own subscription, never sent to the developer or third parties».
- **Подтверждения:** не продаём данные третьим лицам; не используем их для целей, не связанных с основной функцией; не используем для оценки кредитоспособности.
- **Политика:** https://dufusxd.github.io/lazeyka/en/privacy.html
