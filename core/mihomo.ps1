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

# Помощник для кнопок «Обновить» и «Запустить ядро» (native messaging, core/host.ps1).
# Пускает только наше расширение. ID распакованного расширения Chromium считает из пути к папке:
# SHA-256 от пути в UTF-16LE (буква диска заглавная), первые 16 байт, шестнадцатеричные цифры 0-f → буквы a-p.
function Get-ExtId([string]$path) {
    if ($path -match '^[a-z]:') { $path = $path.Substring(0, 1).ToUpper() + $path.Substring(1) }
    $hash = [Security.Cryptography.SHA256]::Create().ComputeHash([Text.Encoding]::Unicode.GetBytes($path))
    -join ($hash[0..15] | ForEach-Object { [char](97 + ($_ -shr 4)); [char](97 + ($_ -band 15)) })
}
$ext = Join-Path (Split-Path $dir -Parent) 'extension'
if (Test-Path (Join-Path $dir 'host.bat')) {
    # ID для папки установщика плюс ID из магазинов (Chrome Web Store, Edge Add-ons) — у них свои, выдаёт магазин.
    # ponytail: загрузили распакованное из другой папки — popup подскажет
    $storeIds = @() # дописать ID после первой загрузки в магазин, например 'abcdefghijklmnopabcdefghijklmnop'
    $ids = @(Get-ExtId $ext) + $storeIds
    $hostJson = Join-Path $dir 'host.json'
    $manifest = [ordered]@{
        name = 'com.lazeyka.host'; description = 'Lazeyka helper: update and start core'; path = 'host.bat'; type = 'stdio'
        allowed_origins = @($ids | ForEach-Object { "chrome-extension://$_/" })
    }
    [IO.File]::WriteAllText($hostJson, (ConvertTo-Json $manifest), (New-Object Text.UTF8Encoding $false))
    foreach ($b in 'Google\Chrome', 'Microsoft\Edge', 'Chromium', 'Yandex\YandexBrowser', 'BraveSoftware\Brave-Browser') {
        $key = "HKCU:\Software\$b\NativeMessagingHosts\com.lazeyka.host"
        if (-not (Test-Path $key)) { New-Item $key -Force | Out-Null }
        Set-Item $key $hostJson
    }
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
