# Документация для разработчика

Здесь — всё, что нужно, чтобы понимать, как устроена Лазейка, менять её и выпускать новые версии. Инструкция для пользователей — в [главном README](../README.md).

| Документ | О чём |
|---|---|
| [architecture.md](architecture.md) | Из чего состоит проект, как ходит трафик, как расширение управляет ядром, где что хранится |
| [development.md](development.md) | Как запустить из исходников, тесты, как устроен код, частые задачи |
| [release.md](release.md) | Как выпустить новую версию и не сломать обновление у пользователей |
| [troubleshooting.md](troubleshooting.md) | Диагностика: ядро, API, помощник, реестр, логи |
| [decisions.md](decisions.md) | Почему сделано именно так: неочевидные решения и грабли, на которые уже наступали |

## Карта репозитория

```
lazeyka/
├── extension/            расширение браузера (Manifest V3, без сборки и зависимостей)
│   ├── manifest.json     версия, права, горячая клавиша
│   ├── lib.js            вся логика: настройки, правила сайтов (PAC), конфиг mihomo, API, обновления
│   ├── background.js     service worker: таймеры, уведомления, горячая клавиша, самообновление
│   ├── popup.html/.css/.js  окно расширения
│   ├── icons/            иконки (on/off для панели, 48/128 для страницы расширений и уведомлений)
│   └── fonts/            шрифт с флагами стран (Windows сам не рисует эмодзи-флаги)
├── core/
│   ├── mihomo.ps1        скачать mihomo, создать config.yaml с secret, прописать помощника, автозагрузка, запуск
│   ├── host.ps1          помощник (native messaging host): ping / start / update
│   ├── host.bat          запускалка помощника для браузера
│   ├── mihomo.sh, host.sh  то же для macOS и Linux
│   └── store-ids.txt     ID версий из магазинов (для allowed_origins помощника)
├── install.ps1           установщик одной командой (irm … | iex)
├── install.sh            установщик для macOS и Linux (curl … | sh)
├── test.mjs              юнит-тесты (node test.mjs)
├── e2e.mjs               сквозной тест против настоящего mihomo (node e2e.mjs <mihomo.exe>)
├── CHANGELOG.md          «что нового» — пункты показываются пользователю в баннере обновления и в релизе
├── ci/check-install.mjs  проверка после установщика в CI: ядро, ID в Chrome, помощник
├── .github/              workflows: проверки на 3 системах (test.yml), релизы, сайт; текст релиза (release-notes.mjs)
└── docs/                 эта документация и картинки для README
```

У пользователя всё ставится в `%LOCALAPPDATA%\Lazeyka` (на macOS и Linux — `~/Lazeyka`) — та же структура плюс файлы, которых нет в репозитории:

| Файл | Откуда | Что это |
|---|---|---|
| `core\mihomo.exe` (`core/mihomo`) | скачивает `mihomo.ps1` / `mihomo.sh` с github.com/MetaCubeX/mihomo | ядро |
| `core\config.yaml` | создаёт `mihomo.ps1` один раз | стартовый конфиг ядра со случайным **secret** |
| `core\host.json` | `mihomo.ps1` при каждом запуске | манифест помощника с ID расширения (на macOS и Linux — в папках браузеров, см. [architecture.md](architecture.md)) |
| LaunchAgent / служба `systemd --user` | `mihomo.sh` | автозапуск ядра на macOS / Linux |
| `core\cache.db`, `core\providers\` | mihomo | выбранные серверы, скачанные подписки |
