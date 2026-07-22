# Servidor multijugador Golpeado (requiere Node.js + pnpm)
# Alternativa: pnpm start

$ErrorActionPreference = "Stop"
$pnpmHome = Join-Path $env:LOCALAPPDATA "pnpm"
$pnpmExe = Join-Path $pnpmHome "pnpm.exe"

$env:Path = "$pnpmHome;" + [System.Environment]::GetEnvironmentVariable("Path","Machine") + ";" + [System.Environment]::GetEnvironmentVariable("Path","User")

Push-Location $PSScriptRoot
try {
    if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
        throw "Node.js no está en el PATH. Instálalo desde https://nodejs.org/"
    }

    if (-not (Test-Path $pnpmExe) -and -not (Get-Command pnpm -ErrorAction SilentlyContinue)) {
        Write-Host "pnpm no encontrado. Descarga el binario standalone..."
        New-Item -ItemType Directory -Force -Path $pnpmHome | Out-Null
        Invoke-WebRequest -Uri "https://github.com/pnpm/pnpm/releases/download/v10.15.0/pnpm-win-x64.exe" -OutFile $pnpmExe -UseBasicParsing
        [Environment]::SetEnvironmentVariable("PNPM_HOME", $pnpmHome, "User")
        $userPath = [Environment]::GetEnvironmentVariable("Path", "User")
        if (-not $userPath) { $userPath = "" }
        if ($userPath -notlike "*$pnpmHome*") {
            [Environment]::SetEnvironmentVariable("Path", "$pnpmHome;$userPath", "User")
        }
    }

    $pnpmCmd = if (Test-Path $pnpmExe) { $pnpmExe } else { "pnpm" }

    Write-Host "Instalando dependencias con pnpm si hace falta..."
    if (-not (Test-Path (Join-Path $PSScriptRoot "node_modules"))) {
        & $pnpmCmd install
    }

    Write-Host "Iniciando servidor en http://localhost:3080"
    node server.js
}
finally {
    Pop-Location
}
