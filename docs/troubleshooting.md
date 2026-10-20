# Диагностика

Для пользовательских проблем есть таблица в [главном README](../README.md#если-что-то-не-работает). Здесь — как разобраться руками, что происходит внутри. Все команды — в PowerShell.

## Удобные переменные

```powershell
$L = "$env:LOCALAPPDATA\Lazeyka"
$secret = ((Get-Content "$L\core\config.yaml") -match '^secret:') -replace 'secret: "(.*)"', '$1'
$H = @{ Authorization = "Bearer $secret" }
```

## Ядро

```powershell
Get-Process mihomo -ErrorAction SilentlyContinue | Select-Object Id, Path      # запущено? откуда?
Invoke-RestMethod http://127.0.0.1:19090/version -Headers $H                     # API отвечает? (401 — не тот secret)
Invoke-RestMethod http://127.0.0.1:19090/proxies/PROXY -Headers $H | Select-Object now, all   # 404 — конфиг ещё не залит
Invoke-RestMethod http://127.0.0.1:19090/proxies/AUTO -Headers $H | Select-Object now         # REJECT — живых нет или идёт проверка
(Invoke-RestMethod http://127.0.0.1:19090/providers/proxies -Headers $H).providers.sub1.proxies |
  ForEach-Object { '{0,-30} alive={1} delay={2}' -f $_.name, $_.alive, ($_.history | Select-Object -Last 1).delay }
```

**Логи ядра.** В фоне ядро работает без окна. Чтобы увидеть, что оно пишет, останови его и запусти в консоли:

```powershell
Get-Process mihomo | Where-Object Path -like "$L\*" | Stop-Process
& "$L\core\mihomo.exe" -d "$L\core"
```

Ошибки скачивания подписок выглядят как `initial proxy provider sub1 error: ...`. После этого открой Лазейку — она перезальёт конфиг. Закрыть консоль = остановить ядро; потом запусти обычным способом (`mihomo.ps1` или кнопкой в Лазейке).

**Порт занят** (`bind: Only one usage of each socket address`):

```powershell
Get-NetTCPConnection -LocalPort 17890, 19090 -State Listen | Select-Object LocalPort, OwningProcess, @{n='Process';e={(Get-Process -Id $_.OwningProcess).Path}}
```

**Сбросить ядро начисто** (новый secret — его надо будет вставить в Лазейку):

```powershell
Get-Process mihomo | Where-Object Path -like "$L\*" | Stop-Process
Remove-Item "$L\core\config.yaml", "$L\core\cache.db", "$L\core\providers" -Recurse -ErrorAction SilentlyContinue
powershell -ExecutionPolicy Bypass -File "$L\core\mihomo.ps1"
```

## Проверить путь трафика без браузера

```powershell
curl.exe -x socks5h://127.0.0.1:17890 https://cp.cloudflare.com/generate_204 -s -o NUL -w "%{http_code} %{time_total}s`n"
curl.exe -x socks5h://127.0.0.1:17890 https://ifconfig.me                   # IP, который видят сайты через VPN
```

`204` — ядро и выбранный сервер работают. Ошибка соединения — сервер мёртв или выбран `REJECT`.

## Помощник (кнопки «Обновить» и «Запустить ядро»)

```powershell
Get-Content "$L\core\host.json"            # allowed_origins: chrome-extension://<ID>/
'Google\Chrome', 'Microsoft\Edge', 'Chromium', 'Yandex\YandexBrowser', 'BraveSoftware\Brave-Browser' |
  ForEach-Object { '{0,-28} {1}' -f $_, (Get-ItemProperty "HKCU:\Software\$_\NativeMessagingHosts\com.lazeyka.host" -ErrorAction SilentlyContinue).'(default)' }
```

Сравни ID в `host.json` с ID Лазейки на `chrome://extensions` (виден в режиме разработчика).

| Ошибка в popup | Причина | Что делать |
|---|---|---|
| `Specified native messaging host not found` | ключа в реестре нет | `powershell -ExecutionPolicy Bypass -File "$L\core\mihomo.ps1"` — пропишет заново |
| `Access to the specified native messaging host is forbidden` | расширение загружено не из `$L\extension`, ID не совпадает | загрузить расширение из `$L\extension` |
| `Native host has exited` / пустой ответ | помощник упал или что-то напечатал в stdout | запустить `host.ps1` руками (ниже) и посмотреть ошибку |

Поговорить с помощником напрямую — см. скрипт `call.mjs` в [release.md](release.md#проверка-обновления-перед-выпуском). Быстрая проверка, что он вообще запускается (пустой ввод — иначе он будет ждать сообщение с клавиатуры):

```powershell
'' | powershell -NoProfile -ExecutionPolicy Bypass -File "$L\core\host.ps1"
# ответ вида  ,   {"error":"Неизвестная команда","ok":false}  — скрипт работает (первые символы — длина сообщения)
```

## Подписка не скачивается

Причину Лазейка показывает в красной плашке под названием подписки. Чтобы проверить руками, **заблокирован ли сайт подписки в этой сети**, — открой ссылку в браузере, пока Лазейка выключена (лучше в окне InPrivate/инкогнито). «Соединение сброшено» / «Не удаётся получить доступ к сайту» при том, что другие сайты открываются, — блокировка.

> ⚠️ **Не проверяй через `curl` или `Invoke-WebRequest`** в Windows: они используют системный TLS (Schannel), который с некоторыми серверами не договаривается и выдаёт ошибку (`curl: (35)`), хотя сервер исправен. Браузер и mihomo используют другие TLS-реализации — их результат и важен.

Из PowerShell надёжнее спросить само ядро — ответ будет таким же, как видит Лазейка (`N` — номер подписки по порядку в настройках):

```powershell
try { Invoke-RestMethod -Method Put http://127.0.0.1:19090/providers/proxies/subN -Headers $H; 'скачалась' } catch { $_.ErrorDetails.Message }
```

`EOF`, `connection reset`, `i/o timeout` — сеть рвёт соединение; `404 Not Found` — ссылка устарела или у подписки исчерпан лимит устройств (в кабинете провайдера среди устройств будет «Lazeyka»); `403` — панель не пускает. Не публикуй вывод целиком: в нём есть ссылка с твоим токеном.

## Нет названия, «Поддержки» или сообщений провайдера

- В ⚙ → «Подключение» должно быть «…подтягиваются сами ✓». Если там кнопка «Разрешить» — разрешения на сайт панели нет (или добавилась подписка с другого сайта).
- Не все панели отдают эти заголовки. Проверить, что пришло:
  ```js
  // консоль service worker
  (await chrome.storage.local.get('subMeta')).subMeta
  ```
  Пустые `title`/`support` при свежем `fetchedAt` — панель их не прислала, это нормально.
- Данные обновляются раз в час, после «Сохранить» и сразу после выдачи разрешения.

## Тест скорости пишет «почти ничего не скачал»

Сервер не работает, или он выходит в интернет в РФ (сервер-мост): тогда тестовый файл с Cloudflare может застревать на первых килобайтах. Тест показывает скорость до `speed.cloudflare.com` через этот сервер, а не до любого сайта.

## Расширение

- **Консоль service worker:** `chrome://extensions` → Лазейка → «служебный сценарий». Там видны ошибки таймеров, обновлений, уведомлений.
- **Консоль popup:** правый клик по окну Лазейки → «Просмотреть код».
- **Что в хранилище** (в любой из этих консолей):
  ```js
  await chrome.storage.local.get(null)
  ```
- **Кто управляет прокси:**
  ```js
  await chrome.proxy.settings.get({})   // levelOfControl: controlled_by_this_extension — это мы
  ```
  `controlled_by_other_extensions` — включено другое VPN-/прокси-расширение. Его можно найти по `chrome://extensions`: у таких расширений есть право «Изменять настройки прокси».
- **Сбросить прокси браузера**, если что-то застряло: выключить Лазейку кнопкой или удалить расширение — браузер сам вернёт системные настройки.
