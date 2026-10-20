# Безопасность · Security

## Как сообщить об уязвимости

**Не заводи публичный issue.** Открой вкладку [Security](https://github.com/DUFUSxD/lazeyka/security) → **«Report a vulnerability»** — сообщение увидит только автор. Опиши, что можно сделать и как это воспроизвести.

Исправления выходят в последней версии; старые версии не поддерживаются — Лазейка обновляется в один клик.

## Что важно для безопасности

- **Подписки и secret** хранятся только в браузере и в ядре на этом компьютере. Своих серверов, аккаунтов и статистики у Лазейки нет.
- **Ядро mihomo** слушает только `127.0.0.1`; управление — по случайному secret.
- **Kill switch:** если ядро недоступно, сайты, которые должны идти через VPN, не открываются, а не идут напрямую. Утечку IP через WebRTC Лазейка закрывает.
- **Помощник** (`core/host.ps1`) выполняет только три команды — узнать версию, запустить ядро, обновиться — и только для расширения из папки установщика. Обновление скачивается только из этого репозитория.
- **Данные от провайдера** (название, ссылки, объявления) считаются недоверенными: показываются как текст, ссылки — только `http(s)`.

Подробнее — в [docs/architecture.md](docs/architecture.md) и [docs/decisions.md](docs/decisions.md).

---

## Reporting a vulnerability

**Please don't open a public issue.** Go to the [Security](https://github.com/DUFUSxD/lazeyka/security) tab → **“Report a vulnerability”** — only the maintainer will see it. Describe the impact and how to reproduce it.

Fixes ship in the latest version only; Lazeyka updates in one click.

## Security model in short

- **Subscriptions and the secret** stay in the browser and the local core. Lazeyka has no servers, accounts or telemetry.
- **The mihomo core** listens on `127.0.0.1` only and is controlled with a random secret.
- **Kill switch:** if the core is down, sites that should go via VPN don't open instead of going direct. WebRTC IP leaks are blocked.
- **The helper** (`core/host.ps1`) runs exactly three commands — version, start core, self-update — only for the extension loaded from the installer folder, and updates only from this repository.
- **Provider data** (name, links, announcements) is treated as untrusted: shown as text, links limited to `http(s)`.
