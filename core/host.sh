#!/bin/sh
# Помощник «Лазейки» для macOS и Linux (native messaging host) — то же, что host.ps1 на Windows: браузер запускает его
# по запросу расширения для кнопок «Обновить» и «Запустить ядро». Регистрирует его mihomo.sh.
# stdout — только протокол Chrome (4 байта длины в порядке байтов процессора + JSON): всё остальное — в /dev/null.
# Команды — только из списка ниже; адреса и пути из сообщения не принимаются.
# Весь код — в main, вызов в последней строке: команда update перезаписывает этот файл прямо во время работы.
PATH=/usr/local/bin:/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin:${PATH:-}
TGZ='https://github.com/DUFUSxD/lazeyka/archive/refs/heads/main.tar.gz'

reply() {
    n=$(printf '%s' "$1" | wc -c | tr -d ' ')
    # shellcheck disable=SC2059 # формат собран из восьмеричных кодов байтов длины
    printf "$(printf '\\%03o\\%03o\\%03o\\%03o' $((n % 256)) $((n / 256 % 256)) $((n / 65536 % 256)) $((n / 16777216 % 256)))"
    printf '%s' "$1"
}

version() { sed -n 's/.*"version"[[:space:]]*:[[:space:]]*"\([0-9.]*\)".*/\1/p' "$1/extension/manifest.json" | head -n 1; }

start_core() { sh "$dir/mihomo.sh" > /dev/null 2>&1; }

# Сначала скачиваем и распаковываем целиком и только потом трогаем установленные файлы: оборванная загрузка
# не оставит полуобновлённое расширение. mihomo и config.yaml (secret) в архиве нет — они не трогаются.
update_app() {
    tmp=$(mktemp -d) || return 1
    if curl -fsSL "$TGZ" 2> /dev/null | tar -xz -C "$tmp" 2> /dev/null && [ -f "$tmp/lazeyka-main/extension/manifest.json" ]; then
        v=$(version "$tmp/lazeyka-main")
        cp -R "$tmp/lazeyka-main/." "$root/" && chmod +x "$root/core/"*.sh && rm -rf "$tmp" && printf '%s' "$v"
    else
        rm -rf "$tmp"
        return 1
    fi
}

main() {
    dir=$(cd "$(dirname "$0")" && pwd -P)
    root=$(dirname "$dir")
    len=$(dd bs=1 count=4 2> /dev/null | od -An -tu4 | tr -d ' \n')
    [ -n "$len" ] || return 0
    msg=$(dd bs=1 count="$len" 2> /dev/null)
    cmd=$(printf '%s' "$msg" | sed -n 's/.*"cmd"[[:space:]]*:[[:space:]]*"\([a-z]*\)".*/\1/p')
    case "$cmd" in
        ping) reply "{\"ok\":true,\"version\":\"$(version "$root")\"}" ;;
        start) if start_core; then reply '{"ok":true}'; else reply '{"ok":false,"error":"Не удалось запустить ядро: sh ~/Lazeyka/core/mihomo.sh"}'; fi ;;
        update)
            if v=$(update_app); then
                start_core
                reply "{\"ok\":true,\"version\":\"$v\"}"
            else
                reply '{"ok":false,"error":"Не удалось скачать обновление с GitHub"}'
            fi
            ;;
        *) reply '{"ok":false,"error":"Неизвестная команда"}' ;;
    esac
}

main "$@"; exit
