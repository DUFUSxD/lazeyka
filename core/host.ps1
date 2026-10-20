# Помощник «Лазейки» (native messaging host): браузер запускает его по запросу расширения
# для кнопок «Обновить» и «Запустить ядро». Регистрирует его core/mihomo.ps1.
# stdout — только протокол Chrome (4 байта длины + JSON), поэтому здесь нельзя ничего печатать.
# Команды — только из списка ниже; адреса и пути из сообщения не принимаются.
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
$root = Split-Path $PSScriptRoot -Parent
$ZIP = 'https://github.com/DUFUSxD/lazeyka/archive/refs/heads/main.zip'
$stdin = [Console]::OpenStandardInput()
$stdout = [Console]::OpenStandardOutput()

function Read-Message {
    $len = New-Object byte[] 4
    if ($stdin.Read($len, 0, 4) -ne 4) { return $null }
    $n = [BitConverter]::ToInt32($len, 0)
    $buf = New-Object byte[] $n
    $got = 0
    while ($got -lt $n) {
        $r = $stdin.Read($buf, $got, $n - $got)
        if ($r -le 0) { return $null }
        $got += $r
    }
    [Text.Encoding]::UTF8.GetString($buf) | ConvertFrom-Json
}

function Send-Message($o) {
    $b = [Text.Encoding]::UTF8.GetBytes((ConvertTo-Json $o -Compress))
    $stdout.Write([BitConverter]::GetBytes($b.Length), 0, 4)
    $stdout.Write($b, 0, $b.Length)
    $stdout.Flush()
}

function Get-Version([string]$dir) { (Get-Content (Join-Path $dir 'extension\manifest.json') -Raw | ConvertFrom-Json).version }

# Через WMI, а не Start-Process: так ядро не попадает в job-объект браузера и не умрёт вместе с помощником.
# mihomo.ps1 заодно перерегистрирует помощника, если после обновления что-то поменялось.
function Start-Core {
    $ps = Join-Path $PSScriptRoot 'mihomo.ps1'
    $r = Invoke-CimMethod Win32_Process -MethodName Create -Arguments @{
        CommandLine = "powershell.exe -NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File `"$ps`""
    }
    if ($r.ReturnValue -ne 0) { throw "Не удалось запустить ядро (Win32_Process.Create: $($r.ReturnValue))" }
}

# Сначала скачиваем и распаковываем целиком и только потом трогаем установленные файлы:
# оборванная загрузка не оставит полуобновлённое расширение. mihomo.exe и config.yaml (secret) в архиве нет — они не трогаются.
function Update-App {
    $tmp = Join-Path $env:TEMP ('lazeyka-upd-' + [guid]::NewGuid().ToString('N').Substring(0, 8))
    New-Item -ItemType Directory $tmp | Out-Null
    try {
        [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
        Invoke-WebRequest $ZIP -OutFile (Join-Path $tmp 'l.zip') -UseBasicParsing
        Expand-Archive (Join-Path $tmp 'l.zip') $tmp -Force
        $src = Join-Path $tmp 'lazeyka-main'
        $ver = Get-Version $src
        Copy-Item (Join-Path $src '*') $root -Recurse -Force
        $ver
    } finally {
        Remove-Item $tmp -Recurse -Force -ErrorAction SilentlyContinue
    }
}

try {
    $msg = Read-Message
    switch ($msg.cmd) {
        'ping'   { Send-Message @{ ok = $true; version = (Get-Version $root) } }
        'start'  { Start-Core; Send-Message @{ ok = $true } }
        'update' { $v = Update-App; Start-Core; Send-Message @{ ok = $true; version = $v } }
        default  { Send-Message @{ ok = $false; error = 'Неизвестная команда' } }
    }
} catch {
    Send-Message @{ ok = $false; error = $_.Exception.Message }
}
