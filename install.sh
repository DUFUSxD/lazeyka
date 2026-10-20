#!/bin/sh
# Установка/обновление «Лазейки» на macOS и Linux одной командой (на Windows — install.ps1):
#   curl -fsSL https://raw.githubusercontent.com/DUFUSxD/lazeyka/main/install.sh | sh
# Ставит в ~/Lazeyka. При обновлении mihomo и config.yaml (с secret) сохраняются.
# LAZEYKA_STORE=1 — расширение уже из магазина, нужно только ядро. LAZEYKA_FROM=<папка> — поставить из локальной копии (проверки в CI).
# Весь код — в main, вызов в последней строке: если загрузка через curl оборвётся, не выполнится ничего.
set -eu

main() {
    dst="$HOME/Lazeyka"
    tmp=$(mktemp -d)
    echo 'Скачиваю Лазейку...'
    if [ -n "${LAZEYKA_FROM:-}" ]; then
        mkdir "$tmp/src" && cp -R "$LAZEYKA_FROM/." "$tmp/src/"
    else
        curl -fsSL https://github.com/DUFUSxD/lazeyka/archive/refs/heads/main.tar.gz | tar -xz -C "$tmp"
        mv "$tmp/lazeyka-main" "$tmp/src"
    fi
    mkdir -p "$dst"
    cp -R "$tmp/src/." "$dst/"
    rm -rf "$tmp"
    chmod +x "$dst/core/"*.sh
    sh "$dst/core/mihomo.sh"

    echo ''
    if [ -n "${LAZEYKA_STORE:-}" ]; then
        echo 'Готово. Ядро запущено — вернись в браузер и открой Лазейку.'
        echo "Secret при первой установке выше (и в буфере обмена), он же лежит в $dst/core/config.yaml"
        echo 'Done. The core is running — go back to the browser and open Lazeyka.'
        return 0
    fi
    if [ "$(uname -s)" = Darwin ]; then pick='Cmd+Shift+G'; else pick='Ctrl+L'; fi
    echo 'Готово. Осталось загрузить расширение в браузер:'
    echo '  1. Открой chrome://extensions (Edge: edge://extensions, Brave: brave://extensions)'
    echo '  2. Включи «Режим разработчика» -> «Загрузить распакованное» -> выбери папку:'
    echo "     $dst/extension"
    echo "     (в окне выбора папки нажми $pick и вставь этот путь)"
    echo '  3. В расширении: Настройки -> вставь secret и ссылки на подписки -> Сохранить -> ВКЛ'
    echo "     secret при первой установке выше (и в буфере обмена, если получилось), он же лежит в $dst/core/config.yaml"
    echo 'Дальше обновления — кнопкой «Обновить» прямо в окне Лазейки.'
    if [ -z "${CI:-}" ]; then
        if [ "$(uname -s)" = Darwin ]; then open "$dst"; elif command -v xdg-open > /dev/null 2>&1; then xdg-open "$dst" > /dev/null 2>&1 || true; fi
    fi
}

main "$@"; exit
