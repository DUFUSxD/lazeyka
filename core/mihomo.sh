#!/bin/sh
# Ставит и запускает ядро mihomo для «Лазейки» на macOS и Linux (на Windows — mihomo.ps1). Идемпотентный.
#   sh ~/Lazeyka/core/mihomo.sh   # скачать (если нет), создать config, зарегистрировать помощника, автозапуск, запустить
# Весь код — в main, вызов в последней строке: обновление может перезаписать этот файл прямо во время работы.
set -eu

say() { printf '%s\n' "$*"; }

# ID распакованного расширения Chromium: SHA-256 от абсолютного пути к папке (на macOS и Linux — байты UTF-8),
# первые 16 байт, шестнадцатеричные цифры 0-f → буквы a-p. На Windows путь берётся в UTF-16LE — см. mihomo.ps1.
ext_id() {
    if command -v sha256sum >/dev/null 2>&1; then h=$(printf '%s' "$1" | sha256sum); else h=$(printf '%s' "$1" | shasum -a 256); fi
    printf '%s' "$h" | cut -c1-32 | tr '0123456789abcdef' 'abcdefghijklmnop'
}

# Начало имени сборки mihomo под эту систему. x64 — compatible (без требований к AVX2), как на Windows.
asset_prefix() {
    case "$(uname -s)" in
        Darwin) os=darwin ;;
        Linux) os=linux ;;
        *) say "Неподдерживаемая система: $(uname -s)" >&2; return 1 ;;
    esac
    case "$(uname -m)" in
        x86_64 | amd64) arch=amd64-compatible ;;
        arm64 | aarch64) arch=arm64 ;;
        armv7l | armv7) arch=armv7 ;;
        armv6l) arch=armv6 ;;
        i386 | i686) arch=386 ;;
        *) say "Неподдерживаемый процессор: $(uname -m)" >&2; return 1 ;;
    esac
    printf 'mihomo-%s-%s-v' "$os" "$arch"
}

download_core() {
    say 'Скачиваю mihomo с github.com/MetaCubeX/mihomo...'
    prefix=$(asset_prefix)
    url=$(curl -fsSL https://api.github.com/repos/MetaCubeX/mihomo/releases/latest |
        grep -o '"browser_download_url": *"[^"]*"' | sed 's/.*"\(https:[^"]*\)"$/\1/' |
        grep "/${prefix}[0-9][0-9.]*\.gz\$" | head -n 1) || true
    if [ -z "$url" ]; then
        say "Не удалось найти mihomo. Скачай ${prefix}*.gz с github.com/MetaCubeX/mihomo/releases, распакуй и положи как $exe" >&2
        return 1
    fi
    curl -fsSL "$url" | gunzip > "$exe.tmp"
    chmod +x "$exe.tmp"
    mv "$exe.tmp" "$exe"
}

make_config() {
    # Secret обязателен: API mihomo по умолчанию открыт для CORS, без него любой сайт может перенастроить прокси.
    secret=$(od -An -tx1 -N16 /dev/urandom | tr -d ' \n')
    # Порты должны совпадать с extension/lib.js. MATCH,REJECT — пока расширение не залило конфиг, ничего не идёт напрямую.
    cat > "$cfg" <<EOF
mixed-port: 17890
bind-address: 127.0.0.1
allow-lan: false
external-controller: 127.0.0.1:19090
secret: "$secret"
profile:
  store-selected: true
rules:
  - MATCH,REJECT
EOF
    chmod 600 "$cfg"
    copied=''
    for c in pbcopy wl-copy 'xclip -selection clipboard' 'xsel --clipboard --input'; do
        if command -v "${c%% *}" >/dev/null 2>&1 && printf '%s' "$secret" | $c >/dev/null 2>&1; then copied=' (уже в буфере обмена)'; break; fi
    done
    say ''
    say "Secret для расширения$copied: $secret"
    say ''
}

# Помощник для кнопок «Обновить» и «Запустить ядро» (native messaging, host.sh). Пускает только наше расширение:
# ID папки установщика плюс ID из магазинов (store-ids.txt — общий с Windows).
register_host() {
    chmod +x "$dir/host.sh"
    ext="$(cd "$dir/.." && pwd -P)/extension"
    origins="\"chrome-extension://$(ext_id "$ext")/\""
    if [ -f "$dir/store-ids.txt" ]; then
        for id in $(grep -E '^[a-p]{32}$' "$dir/store-ids.txt" || true); do origins="$origins, \"chrome-extension://$id/\""; done
    fi
    json="{
  \"name\": \"com.lazeyka.host\",
  \"description\": \"Lazeyka helper: update and start core\",
  \"path\": \"$dir/host.sh\",
  \"type\": \"stdio\",
  \"allowed_origins\": [$origins]
}"
    if [ "$(uname -s)" = Darwin ]; then
        base="$HOME/Library/Application Support"
        browsers='Google/Chrome Chromium Microsoft_Edge BraveSoftware/Brave-Browser Yandex/YandexBrowser Vivaldi'
    else
        base="${XDG_CONFIG_HOME:-$HOME/.config}"
        browsers='google-chrome chromium microsoft-edge BraveSoftware/Brave-Browser yandex-browser vivaldi'
    fi
    # для установленных браузеров (есть папка профиля) и всегда для Chrome — его ставят чаще всего уже после Лазейки
    for b in $browsers; do
        b=$(printf '%s' "$b" | tr '_' ' ')
        case "$b" in Google/Chrome | google-chrome) ;; *) [ -d "$base/$b" ] || continue ;; esac
        mkdir -p "$base/$b/NativeMessagingHosts"
        printf '%s\n' "$json" > "$base/$b/NativeMessagingHosts/com.lazeyka.host.json"
    done
}

running() { pgrep -f "$exe -d" >/dev/null 2>&1; }

# Запуск при входе в систему и сам запуск — через launchd / systemd --user: так ядро не зависит от процесса,
# который его запустил (помощника браузер завершает сразу после ответа). Нет их — автозапуск рабочего стола и setsid.
start_core() {
    if [ "$(uname -s)" = Darwin ]; then
        plist="$HOME/Library/LaunchAgents/com.lazeyka.mihomo.plist"
        mkdir -p "$HOME/Library/LaunchAgents"
        cat > "$plist" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>com.lazeyka.mihomo</string>
  <key>ProgramArguments</key><array><string>$exe</string><string>-d</string><string>$dir</string></array>
  <key>RunAtLoad</key><true/>
</dict>
</plist>
EOF
        domain="gui/$(id -u)"
        if launchctl print "$domain/com.lazeyka.mihomo" >/dev/null 2>&1 || launchctl bootstrap "$domain" "$plist" >/dev/null 2>&1; then
            running || launchctl kickstart "$domain/com.lazeyka.mihomo" >/dev/null 2>&1 || true
            say 'Автозапуск: LaunchAgent com.lazeyka.mihomo.'
            return 0
        fi
    elif command -v systemctl >/dev/null 2>&1 && systemctl --user show-environment >/dev/null 2>&1; then
        unit="${XDG_CONFIG_HOME:-$HOME/.config}/systemd/user/lazeyka-mihomo.service"
        mkdir -p "$(dirname "$unit")"
        cat > "$unit" <<EOF
[Unit]
Description=Lazeyka mihomo core

[Service]
ExecStart="$exe" -d "$dir"
Restart=on-failure

[Install]
WantedBy=default.target
EOF
        systemctl --user daemon-reload
        systemctl --user enable lazeyka-mihomo.service >/dev/null 2>&1
        running || systemctl --user start lazeyka-mihomo.service
        say 'Автозапуск: systemd --user, служба lazeyka-mihomo.'
        return 0
    else
        auto="${XDG_CONFIG_HOME:-$HOME/.config}/autostart"
        mkdir -p "$auto"
        printf '[Desktop Entry]\nType=Application\nName=Lazeyka mihomo\nExec=sh "%s"\nNoDisplay=true\nX-GNOME-Autostart-enabled=true\n' \
            "$dir/mihomo.sh" > "$auto/lazeyka-mihomo.desktop"
        say 'Автозапуск: ~/.config/autostart/lazeyka-mihomo.desktop.'
    fi
    # запасной путь: отдельная сессия, чтобы ядро пережило завершение помощника
    running && return 0
    if command -v setsid >/dev/null 2>&1; then
        setsid "$exe" -d "$dir" >/dev/null 2>&1 < /dev/null &
    else
        nohup "$exe" -d "$dir" >/dev/null 2>&1 < /dev/null &
    fi
}

main() {
    dir=$(cd "$(dirname "$0")" && pwd -P)
    exe="$dir/mihomo"
    cfg="$dir/config.yaml"
    [ -x "$exe" ] || download_core
    [ -f "$cfg" ] || make_config
    register_host
    start_core
    if running; then say 'mihomo запущен (127.0.0.1:17890, API 127.0.0.1:19090).'; else say 'mihomo запускается…'; fi
}

main "$@"; exit
