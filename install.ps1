# Установка/обновление Лазейки одной командой:
#   irm https://raw.githubusercontent.com/DUFUSxD/lazeyka/main/install.ps1 | iex
# Ставит в %LOCALAPPDATA%\Lazeyka. При обновлении mihomo.exe и config.yaml (с secret) сохраняются.
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

$dst = Join-Path $env:LOCALAPPDATA 'Lazeyka'
$zip = Join-Path $env:TEMP 'lazeyka.zip'
$src = Join-Path $env:TEMP 'lazeyka-src'

Write-Host 'Скачиваю Лазейку...'
Invoke-WebRequest 'https://github.com/DUFUSxD/lazeyka/archive/refs/heads/main.zip' -OutFile $zip -UseBasicParsing
Expand-Archive $zip $src -Force
New-Item -ItemType Directory -Force $dst | Out-Null
Copy-Item (Join-Path $src 'lazeyka-main\*') $dst -Recurse -Force
Remove-Item $zip, $src -Recurse -Force

# Отдельный процесс с Bypass: политика выполнения по умолчанию запрещает запуск .ps1-файлов
powershell.exe -NoProfile -ExecutionPolicy Bypass -File (Join-Path $dst 'core\mihomo.ps1') -Autostart
if ($LASTEXITCODE) { throw 'Ядро не установилось, см. ошибку выше.' }

Write-Host ''
Write-Host 'Готово. Осталось загрузить расширение в браузер:' -ForegroundColor Green
Write-Host '  1. Открой chrome://extensions (Edge: edge://extensions, Яндекс: browser://extensions)'
Write-Host '  2. Включи «Режим разработчика» -> «Загрузить распакованное» -> выбери папку:'
Write-Host "     $dst\extension"
Write-Host '  3. В расширении: Настройки -> вставь secret и ссылки на подписки -> Сохранить -> ВКЛ'
Write-Host "     secret при первой установке уже в буфере обмена, он же лежит в $dst\core\config.yaml"
Write-Host 'Дальше обновления — кнопкой «Обновить» прямо в окне Лазейки.'
Write-Host 'Если ставил поверх старой версии — нажми ⟳ на карточке Лазейки в chrome://extensions.'
explorer.exe (Join-Path $dst 'extension')
