# Instalador de emede para Windows (PowerShell 5.1 o más nuevo).
#
#   irm https://raw.githubusercontent.com/c010r/emede/main/install.ps1 | iex
#   (o, con el proyecto ya bajado: doble clic en install.cmd)
#
# Instala lo que falte (Git y Node.js 24, con winget), baja emede (o lo actualiza si ya está),
# instala sus dependencias y lo abre en el navegador. Variables opcionales:
#   $env:EMEDE_DIR   carpeta donde instalarlo (por defecto $HOME\emede, o la carpeta del script si ya es emede)
#   $env:EMEDE_REPO  repositorio a clonar (por defecto https://github.com/c010r/emede.git)

$ErrorActionPreference = 'Stop'
$NodeMajor = 24
$Repo = if ($env:EMEDE_REPO) { $env:EMEDE_REPO } else { 'https://github.com/c010r/emede.git' }

function Say($msg) { Write-Host "`n> $msg" -ForegroundColor Yellow }
# Corta el instalador. Con throw (no exit): instalado con "irm | iex", exit cerraría la ventana de PowerShell del usuario.
function Fail($msg) { throw "EMEDE: $msg" }
function Have($cmd) { [bool](Get-Command $cmd -ErrorAction SilentlyContinue) }

# Lo que instala winget queda en el PATH del sistema, pero no en el de esta ventana: se vuelve a leer.
function Refresh-Path {
  $env:Path = [Environment]::GetEnvironmentVariable('Path', 'Machine') + ';' + [Environment]::GetEnvironmentVariable('Path', 'User')
}

function Winget-Install($id, $name) {
  if (-not (Have winget)) {
    Fail "Falta $name y este Windows no tiene winget. Instalalo a mano ($(if ($id -like 'Git*') { 'https://git-scm.com' } else { 'https://nodejs.org' })) y volvé a ejecutar el instalador."
  }
  Say "Instalando $name (puede pedir permiso de administrador)..."
  winget install --id $id --exact --silent --accept-package-agreements --accept-source-agreements --disable-interactivity
  # 0: instalado; -1978335189: ya estaba instalado (sin actualización disponible).
  if ($LASTEXITCODE -ne 0 -and $LASTEXITCODE -ne -1978335189) { Fail "No se pudo instalar $name (winget terminó con el código $LASTEXITCODE)." }
  Refresh-Path
}

function Node-Ok {
  if (-not (Have node)) { return $false }
  return [int](node -p "process.versions.node.split('.')[0]") -ge $NodeMajor
}

try {
  # ---------- 1. Git ----------
  if (-not (Have git)) { Winget-Install 'Git.Git' 'Git' }
  if (-not (Have git)) { Fail 'Git quedó instalado pero esta ventana no lo encuentra. Cerrala, abrí una nueva y volvé a ejecutar el instalador.' }

  # ---------- 2. Node.js 24 ----------
  if (-not (Node-Ok)) {
    if (Have node) { Say "Tenés Node.js $(node -v); emede necesita $NodeMajor o más nuevo." }
    Winget-Install 'OpenJS.NodeJS.LTS' "Node.js $NodeMajor"
  }
  if (-not (Node-Ok)) {
    Fail "No se pudo dejar Node.js $NodeMajor listo en esta ventana. Cerrala, abrí una nueva y volvé a ejecutar el instalador (o instalalo desde https://nodejs.org)."
  }
  Say "Node.js $(node -v) y $(git --version) listos."

  # ---------- 3. Bajar o actualizar emede ----------
  $here = if ($PSScriptRoot) { $PSScriptRoot } else { $null }
  $dir = $env:EMEDE_DIR
  if (-not $dir -and $here -and (Test-Path "$here\package.json") -and (Select-String -Path "$here\package.json" -Pattern '"name": "emede"' -Quiet)) { $dir = $here }
  if (-not $dir) { $dir = Join-Path $HOME 'emede' }

  if (Test-Path "$dir\.git") {
    Say "Actualizando emede en $dir..."
    git -C $dir pull --ff-only
    if ($LASTEXITCODE -ne 0) { Say 'No se pudo actualizar (¿hay cambios locales?): sigo con la versión que ya está.' }
  } elseif ((Test-Path $dir) -and (Get-ChildItem $dir -Force | Select-Object -First 1)) {
    Fail "$dir ya existe y no es una copia de emede. Elegí otra carpeta: `$env:EMEDE_DIR='C:\otra\carpeta' y volvé a ejecutar el instalador."
  } else {
    Say "Bajando emede en $dir..."
    git clone --depth 1 $Repo $dir
    if ($LASTEXITCODE -ne 0) { Fail 'No se pudo bajar emede. Revisá la conexión a internet.' }
  }

  # ---------- 4. Dependencias y primer arranque ----------
  Set-Location $dir
  Say 'Instalando las dependencias (tarda un minuto)...'
  npm ci --no-audit --no-fund --loglevel=error
  if ($LASTEXITCODE -ne 0) { Fail 'No se pudieron instalar las dependencias. Revisá el error de arriba.' }

  Say '¡Listo! Abriendo emede en el navegador...'
  Write-Host "  Para cerrarlo: Ctrl+C en esta ventana."
  Write-Host "  Para volver a abrirlo: cd `"$dir`"; npm start`n"
  npm start
} catch {
  Write-Host "`nX $($_.Exception.Message -replace '^EMEDE: ', '')" -ForegroundColor Red
  # Desde install.cmd (archivo) se informa el error con el código de salida; con "irm | iex", la ventana queda abierta.
  if ($PSCommandPath) { exit 1 }
}
