# Ставит и запускает ядро mihomo для расширения «Лазейка». Идемпотентный: можно запускать сколько угодно раз.
#   powershell -ExecutionPolicy Bypass -File mihomo.ps1             # скачать (если нет), создать config, запустить
#   powershell -ExecutionPolicy Bypass -File mihomo.ps1 -Autostart  # то же + запуск при входе в Windows
param([switch]$Autostart)
$ErrorActionPreference = 'Stop'
$dir = $PSScriptRoot
$exe = Join-Path $dir 'mihomo.exe'
$cfg = Join-Path $dir 'config.yaml'

if (-not (Test-Path $exe)) {
    Write-Host 'Скачиваю mihomo с github.com/MetaCubeX/mihomo...'
    $ProgressPreference = 'SilentlyContinue'  # в PS 5.1 прогресс-бар замедляет загрузку в разы
    [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12  # старые Win10
    # compatible — сборка без требований к AVX2, пойдёт на любом x64
    $asset = try {
        (Invoke-RestMethod 'https://api.github.com/repos/MetaCubeX/mihomo/releases/latest').assets |
            Where-Object name -match '^mihomo-windows-amd64-compatible-v\d+\.\d+\.\d+\.zip$' | Select-Object -First 1
    } catch { $null }
    if (-not $asset) {
        throw "Не удалось скачать mihomo. Скачай mihomo-windows-amd64-compatible-*.zip с github.com/MetaCubeX/mihomo/releases, распакуй и положи exe сюда как $exe"
    }
    $zip = Join-Path $dir 'mihomo.zip'
    $tmp = Join-Path $dir 'tmp'
    Invoke-WebRequest $asset.browser_download_url -OutFile $zip -UseBasicParsing
    Expand-Archive $zip $tmp -Force
    Move-Item (Get-ChildItem $tmp -Filter *.exe | Select-Object -First 1).FullName $exe
    Remove-Item $zip, $tmp -Recurse -Force
}

if (-not (Test-Path $cfg)) {
    # Secret обязателен: API mihomo по умолчанию открыт для CORS, без него любой сайт может перенастроить прокси.
    $secret = [guid]::NewGuid().ToString('N')
    # Порты должны совпадать с extension/lib.js. MATCH,REJECT — пока расширение не залило конфиг, ничего не идёт напрямую.
    @"
mixed-port: 17890
bind-address: 127.0.0.1
allow-lan: false
external-controller: 127.0.0.1:19090
secret: "$secret"
profile:
  store-selected: true
rules:
  - MATCH,REJECT
"@ | Set-Content $cfg -Encoding ascii
    Set-Clipboard $secret
    Write-Host "Secret для расширения (уже в буфере обмена): $secret"
}

if ($Autostart) {
    $cmd = "powershell.exe -NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File `"$PSCommandPath`""
    Set-ItemProperty 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Run' LazeykaMihomo $cmd
    Write-Host 'Добавлено в автозагрузку.'
}

if (Get-Process mihomo -ErrorAction SilentlyContinue | Where-Object Path -eq $exe) {
    Write-Host 'mihomo уже запущен.'
} else {
    Start-Process $exe -ArgumentList '-d', "`"$dir`"" -WindowStyle Hidden
    Write-Host 'mihomo запущен (127.0.0.1:17890, API 127.0.0.1:19090).'
}
