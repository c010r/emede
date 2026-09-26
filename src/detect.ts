import { CATALOG, suggestCommands, toItem, type StackItem } from './stack';
import { canUseFolders, pickDir, type DirHandle } from './fs';

/* Detección del stack leyendo la raíz de un repositorio local (File System Access API). */

export interface Detection {
  name: string;
  description: string;
  items: StackItem[];
  commands: Partial<Record<'dev' | 'build' | 'test' | 'lint', string>>;
  structure: string;
  /** Archivos que se leyeron, para mostrarle al usuario de dónde salió cada cosa. */
  sources: string[];
}

/** Archivos de manifiesto cuyo contenido se lee para buscar dependencias. */
const MANIFESTS = [
  'package.json', 'pyproject.toml', 'requirements.txt', 'requirements-dev.txt', 'Pipfile', 'go.mod', 'Cargo.toml',
  'composer.json', 'Gemfile', 'pom.xml', 'build.gradle', 'build.gradle.kts', 'pubspec.yaml',
];
const IGNORED_DIRS = /^(\.|node_modules$|dist$|build$|out$|target$|vendor$|venv$|__pycache__$|coverage$)/;

export const canDetect = canUseFolders;

export async function detectFromFolder(): Promise<Detection | null> {
  const root = await pickDir('read');
  return root ? detectInDir(root) : null;
}

/** Detecta stack, comandos y estructura en la raíz de una carpeta ya abierta. */
export async function detectInDir(root: DirHandle): Promise<Detection> {
  const names: string[] = [];
  const dirs: string[] = [];
  const texts: Record<string, string> = {};
  for await (const entry of root.values()) {
    names.push(entry.name);
    if (entry.kind === 'directory') {
      if (!IGNORED_DIRS.test(entry.name)) dirs.push(entry.name);
    } else if (MANIFESTS.includes(entry.name) || entry.name.endsWith('.csproj')) {
      texts[entry.name] = await (await entry.getFile()).text();
    }
  }

  // package.json: dependencias exactas con versión
  let pkg: { name?: string; description?: string; scripts?: Record<string, string>; packageManager?: string;
    dependencies?: Record<string, string>; devDependencies?: Record<string, string> } = {};
  try {
    if (texts['package.json']) pkg = JSON.parse(texts['package.json']);
  } catch { /* package.json inválido: se ignora */ }
  const jsDeps: Record<string, string> = { ...pkg.dependencies, ...pkg.devDependencies };
  const otherText = Object.entries(texts).filter(([n]) => n !== 'package.json').map(([, t]) => t.toLowerCase()).join('\n');

  const fileMatch = (pattern: string) =>
    pattern.startsWith('*') ? names.some((n) => n.endsWith(pattern.slice(1))) : names.includes(pattern);
  const depInText = (dep: string) =>
    new RegExp(`(^|[^\\w.-])${dep.toLowerCase().replace(/[.*+?^${}()|[\]\\/]/g, '\\$&')}([^\\w-]|$)`, 'm').test(otherText);

  const items: StackItem[] = [];
  for (const tech of CATALOG) {
    const jsDep = tech.deps?.find((d) => d in jsDeps);
    if (jsDep) {
      items.push(toItem(tech, majorVersion(jsDeps[jsDep])));
      continue;
    }
    if (tech.files?.some(fileMatch) || tech.deps?.some(depInText)) items.push(toItem(tech));
  }
  // packageManager: "pnpm@9.1.0" en package.json cuenta aunque falte el lockfile
  const pmField = pkg.packageManager?.split('@')[0];
  if (pmField && !items.some((i) => i.id === pmField)) {
    const t = CATALOG.find((c) => c.id === pmField);
    if (t) items.push(toItem(t));
  }
  // Con TypeScript, JavaScript sobra como ítem aparte
  if (items.some((i) => i.id === 'typescript')) {
    const js = items.findIndex((i) => i.id === 'javascript');
    if (js >= 0) items.splice(js, 1);
  }

  // Comandos: los scripts reales de package.json mandan sobre lo deducido
  const commands = { ...suggestCommands(items) };
  if (pkg.scripts) {
    const pm = items.find((i) => ['pnpm', 'yarn', 'bun', 'npm'].includes(i.id))?.id ?? 'npm';
    const run = { npm: 'npm run', pnpm: 'pnpm', yarn: 'yarn', bun: 'bun run' }[pm as 'npm'];
    const pick = (...keys: string[]) => keys.find((k) => pkg.scripts![k]);
    const map = { dev: pick('dev', 'start:dev', 'start'), build: pick('build'), test: pick('test'), lint: pick('lint', 'check') };
    for (const [k, script] of Object.entries(map)) if (script) commands[k as keyof typeof commands] = `${run} ${script}`;
  }

  return {
    name: pkg.name ?? root.name,
    description: pkg.description ?? '',
    items,
    commands,
    structure: dirs.length ? dirs.sort().map((d) => `- \`${d}/\``).join('\n') : '',
    sources: Object.keys(texts),
  };
}

/** "^19.1.0" → "19"; "~0.4.2" → "0.4"; rangos raros → undefined. */
function majorVersion(range: string | undefined): string | undefined {
  const m = range?.match(/(\d+)(?:\.(\d+))?/);
  if (!m) return undefined;
  return m[1] === '0' && m[2] ? `0.${m[2]}` : m[1];
}
