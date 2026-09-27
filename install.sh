#!/usr/bin/env bash
# Instalador de emede para Linux y macOS.
#
#   curl -fsSL https://raw.githubusercontent.com/c010r/emede/main/install.sh | bash
#   (o, con el proyecto ya bajado: bash install.sh)
#
# Instala lo que falte (Git y Node.js 24), baja emede (o lo actualiza si ya está), instala sus dependencias
# y lo abre en el navegador. Variables opcionales:
#   EMEDE_DIR   carpeta donde instalarlo (por defecto ~/emede, o la carpeta del script si ya es emede)
#   EMEDE_REPO  repositorio a clonar (por defecto https://github.com/c010r/emede.git)
set -euo pipefail

NODE_MAJOR=24
NVM_VERSION=v0.40.8
REPO="${EMEDE_REPO:-https://github.com/c010r/emede.git}"

say() { printf '\n\033[1;33m▸ %s\033[0m\n' "$*"; }
fail() { printf '\n\033[1;31m✖ %s\033[0m\n' "$*" >&2; exit 1; }
have() { command -v "$1" >/dev/null 2>&1; }

# Paquetes del sistema con el gestor que haya (Git y lo que necesita nvm para bajar Node).
# sudo solo si hace falta (en contenedores se suele ser root).
install_packages() {
  SUDO=''
  if [ "$(uname)" != Darwin ] && [ "$(id -u)" -ne 0 ]; then
    have sudo || fail "Hace falta instalar $* y no hay sudo. Instalalos a mano y volvé a ejecutar el instalador."
    SUDO='sudo'
  fi
  if [ "$(uname)" = Darwin ]; then
    have brew || fail "En macOS instalá Homebrew (https://brew.sh) o Git (xcode-select --install) y volvé a ejecutar el instalador."
    brew install "$@"
  elif have apt-get; then $SUDO apt-get update -qq && $SUDO env DEBIAN_FRONTEND=noninteractive apt-get install -y -qq "$@"
  elif have dnf; then $SUDO dnf install -y -q "$@"
  elif have yum; then $SUDO yum install -y -q "$@"
  elif have pacman; then $SUDO pacman -Sy --noconfirm --needed "$@"
  elif have zypper; then $SUDO zypper --non-interactive install "$@"
  elif have apk; then $SUDO apk add --no-cache "$@"
  else fail "No reconozco el gestor de paquetes de este sistema. Instalá $* a mano y volvé a ejecutar el instalador."
  fi
}

# ---------- 1. Git (y curl, para bajar nvm) ----------
missing=()
have git || missing+=(git)
have curl || missing+=(curl)
if [ ${#missing[@]} -gt 0 ]; then
  say "Instalando ${missing[*]}…"
  pkgs=("${missing[@]}")
  have apt-get && pkgs+=(ca-certificates)
  install_packages "${pkgs[@]}"
fi

# ---------- 2. Node.js 24 con nvm (sin tocar el Node del sistema) ----------
node_ok() { have node && [ "$(node -p 'process.versions.node.split(".")[0]')" -ge "$NODE_MAJOR" ]; }
export NVM_DIR="${NVM_DIR:-$HOME/.nvm}"
if ! node_ok; then
  if [ ! -s "$NVM_DIR/nvm.sh" ]; then
    say "Instalando nvm ${NVM_VERSION} (administra las versiones de Node.js)…"
    curl -fsSL "https://raw.githubusercontent.com/nvm-sh/nvm/${NVM_VERSION}/install.sh" | PROFILE=/dev/null bash >/dev/null
  fi
  # shellcheck source=/dev/null
  . "$NVM_DIR/nvm.sh"
  say "Instalando Node.js ${NODE_MAJOR}…"
  nvm install "$NODE_MAJOR" >/dev/null
  nvm alias default "$NODE_MAJOR" >/dev/null
  # Para que las terminales nuevas encuentren node y npm (npm start, git pull…).
  for rc in "$HOME/.bashrc" "$HOME/.zshrc"; do
    if [ -f "$rc" ] && ! grep -q 'NVM_DIR/nvm.sh' "$rc"; then
      printf '\nexport NVM_DIR="%s"\n[ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh"\n' "$NVM_DIR" >> "$rc"
    fi
  done
fi
node_ok || fail "No se pudo instalar Node.js ${NODE_MAJOR}. Instalalo desde https://nodejs.org y volvé a ejecutar el instalador."
say "Node.js $(node -v) y $(git --version) listos."

# ---------- 3. Bajar o actualizar emede ----------
here="$(cd "$(dirname "${BASH_SOURCE[0]:-.}")" 2>/dev/null && pwd || pwd)"
if [ -z "${EMEDE_DIR:-}" ] && [ -f "$here/package.json" ] && grep -q '"name": "emede"' "$here/package.json"; then
  EMEDE_DIR="$here"
fi
EMEDE_DIR="${EMEDE_DIR:-$HOME/emede}"

if [ -d "$EMEDE_DIR/.git" ]; then
  say "Actualizando emede en $EMEDE_DIR…"
  git -C "$EMEDE_DIR" pull --ff-only || say "No se pudo actualizar (¿hay cambios locales?): sigo con la versión que ya está."
elif [ -e "$EMEDE_DIR" ] && [ -n "$(ls -A "$EMEDE_DIR" 2>/dev/null)" ]; then
  fail "$EMEDE_DIR ya existe y no es una copia de emede. Elegí otra carpeta: EMEDE_DIR=/otra/carpeta bash install.sh"
else
  say "Bajando emede en $EMEDE_DIR…"
  git clone --depth 1 "$REPO" "$EMEDE_DIR"
fi

# ---------- 4. Dependencias y primer arranque ----------
cd "$EMEDE_DIR"
say "Instalando las dependencias (tarda un minuto)…"
npm ci --no-audit --no-fund --loglevel=error

say "¡Listo! Abriendo emede en el navegador…"
printf '  Para cerrarlo: Ctrl+C en esta terminal.\n  Para volver a abrirlo: cd "%s" && npm start\n\n' "$EMEDE_DIR"
exec npm start
