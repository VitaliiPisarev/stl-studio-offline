@echo off
setlocal DisableDelayedExpansion
set "STL_STUDIO_DIR=%~dp0"
powershell.exe -NoLogo -NoProfile -Command "$ErrorActionPreference='Stop'; $app=Join-Path $env:STL_STUDIO_DIR 'STL_Studio_Offline.html'; if (!(Test-Path -LiteralPath $app)) { throw 'Extract the complete ZIP first.' }; $pf86=[Environment]::GetFolderPath('ProgramFilesX86'); $pf=[Environment]::GetFolderPath('ProgramFiles'); $local=[Environment]::GetFolderPath('LocalApplicationData'); $paths=@((Join-Path $pf86 'Microsoft\Edge\Application\msedge.exe'),(Join-Path $pf 'Microsoft\Edge\Application\msedge.exe'),(Join-Path $local 'Microsoft\Edge\Application\msedge.exe'),(Join-Path $pf 'Google\Chrome\Application\chrome.exe'),(Join-Path $pf86 'Google\Chrome\Application\chrome.exe'),(Join-Path $local 'Google\Chrome\Application\chrome.exe')); $browser=$paths | Where-Object { Test-Path -LiteralPath $_ } | Select-Object -First 1; if ($browser) { $uri=([System.Uri]$app).AbsoluteUri; Start-Process -FilePath $browser -ArgumentList ('--app='+[char]34+$uri+[char]34) } else { Start-Process -FilePath $app }"
if errorlevel 1 (
  echo Could not launch automatically. Open STL_Studio_Offline.html in Edge or Chrome.
  pause
)
endlocal
