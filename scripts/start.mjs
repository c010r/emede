import { spawn, spawnSync } from 'node:child_process';
import { existsSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

/*
 * `npm start`: lo único que hace falta después de bajar emede de GitHub (y de cada `git pull`).
 * 1. Verifica la versión de Node (el servidor corre .ts directo y necesita Node 24).
 * 2. Compila la app si todavía no hay build o si el código es más nuevo que el build.
 * 3. Levanta el servidor local y abre el navegador (la primera vez aparece la pantalla de instalación).
 * Está en JavaScript plano para poder avisar con claridad aunque la versión de Node sea vieja.
 * Variables: PORT (5178 por defecto), EMEDE_NO_OPEN=1 para no abrir el navegador.
 */

const MIN_NODE = 24;
const root = fileURLToPath(new URL('..', import.meta.url));
const port = Number(process.env.PORT ?? 5178);
const url = `http://127.0.0.1:${port}`;

const major = Number(process.versions.node.split('.')[0]);
if (major < MIN_NODE) {
  console.error(`emede necesita Node ${MIN_NODE} o más nuevo y tenés ${process.versions.node}. Instalalo desde https://nodejs.org y volvé a ejecutar npm start.`);
  process.exit(1);
}
if (!existsSync(join(root, 'node_modules'))) {
  console.error('Faltan las dependencias: ejecutá npm install y después npm start.');
  process.exit(1);
}

/** Fecha de modificación más nueva de un archivo o carpeta (sin entrar a las pruebas). */
function newest(path) {
  if (!existsSync(path)) return 0;
  const s = statSync(path);
  if (!s.isDirectory()) return s.mtimeMs;
  let max = 0;
  for (const e of readdirSync(path)) if (e !== '__tests__') max = Math.max(max, newest(join(path, e)));
  return max;
}

const built = join(root, 'dist', 'index.html');
const sources = ['src', 'public', 'index.html', 'package.json', 'vite.config.ts'].map((p) => newest(join(root, p)));
if (!existsSync(built) || Math.max(...sources) > statSync(built).mtimeMs) {
  console.log(existsSync(built) ? 'Hay cambios en el código: compilando emede…' : 'Primera vez: compilando emede (tarda unos segundos)…');
  // Un solo comando de texto: en Windows npm es un .cmd y necesita shell (sin argumentos sueltos que concatenar).
  const r = spawnSync('npm run build', { cwd: root, stdio: 'inherit', shell: true });
  if (r.status !== 0) {
    console.error('No se pudo compilar. Revisá el error de arriba; si faltan dependencias, ejecutá npm install.');
    process.exit(r.status ?? 1);
  }
}

/** emede ya está abierto en ese puerto. */
async function running() {
  try {
    const r = await fetch(`${url}/api/health`, { signal: AbortSignal.timeout(1000) });
    return r.ok && 'dataFile' in (await r.json());
  } catch {
    return false;
  }
}

function openBrowser() {
  if (process.env.EMEDE_NO_OPEN || process.env.CI) return;
  const [cmd, args] = process.platform === 'win32' ? ['cmd', ['/c', 'start', '""', url]]
    : process.platform === 'darwin' ? ['open', [url]] : ['xdg-open', [url]];
  try {
    spawn(cmd, args, { stdio: 'ignore', detached: true, windowsVerbatimArguments: true }).on('error', () => {}).unref();
  } catch { /* sin navegador (servidor sin escritorio): se usa la URL que muestra la consola */ }
}

if (await running()) {
  console.log(`emede ya está abierto en ${url}`);
  openBrowser();
  process.exit(0);
}

await import('../server/index.ts');
// Se abre el navegador cuando el servidor ya responde.
for (let i = 0; i < 50 && !(await running()); i++) await new Promise((r) => setTimeout(r, 100));
openBrowser();
