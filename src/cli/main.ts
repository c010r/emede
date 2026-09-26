import { existsSync } from 'node:fs';
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { parseDesign, type GenerateOptions } from '../design';
import { normalizeGraph } from '../storage';
import { setUILang, t } from '../i18n';
import { detectLang, LANG_INFO, LANGS, type Lang } from '../i18n/langs';
import { sessionCost, formatTokens } from '../tokens';
import { TARGETS, type Target } from '../types';
import type { Graph } from '../store';
import { defaultDataFile } from '../../server/store.ts';
import { compareWith, expectedFiles } from './core';

/*
 * emede en la terminal:
 *   emede generate [diseño.emede.json | --project <nombre>] [--out <carpeta>] [--targets a,b] [--lang xx] [--dry-run] [--no-backup]
 *   emede check    [diseño.emede.json | --project <nombre>] [--dir <carpeta>] [--targets a,b] [--lang xx]
 *   emede list
 * Códigos de salida: 0 bien · 1 check encontró diferencias · 2 error de uso o de datos.
 */

export interface Io {
  cwd: string;
  out: (line: string) => void;
  err: (line: string) => void;
  /** Idiomas del sistema (LANG, LC_ALL…), para los mensajes. */
  locales?: string[];
  /** Archivo de datos de la app (~/.emede/emede.json). */
  dataFile?: string;
}

interface Args {
  command?: string;
  file?: string;
  flags: Record<string, string | true>;
}

function parseArgs(argv: string[]): Args {
  const flags: Record<string, string | true> = {};
  const rest: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) {
      rest.push(a);
      continue;
    }
    const [k, v] = a.slice(2).split('=', 2);
    if (v !== undefined) flags[k] = v;
    else if (argv[i + 1] && !argv[i + 1].startsWith('--') && !['dry-run', 'no-backup', 'help', 'version'].includes(k)) flags[k] = argv[++i];
    else flags[k] = true;
  }
  return { command: rest[0], file: rest[1], flags };
}

class UsageError extends Error {}

interface Loaded {
  name: string;
  graph: Graph;
  opts: GenerateOptions;
}

/** El diseño: un .emede.json, un proyecto guardado en la app, o el único *.emede.json de la carpeta. */
async function loadDesign(args: Args, io: Io): Promise<Loaded> {
  const project = args.flags.project;
  let loaded: Loaded;
  if (typeof project === 'string') {
    const data = JSON.parse(await readFile(io.dataFile ?? defaultDataFile(), 'utf8')) as {
      settings?: { targets?: Target[]; lang?: Lang };
      projects?: Record<string, { id: string; name: string; graph: Graph; fileOverrides?: GenerateOptions['fileOverrides']; excluded?: string[] }>;
    };
    const p = Object.values(data.projects ?? {}).find((x) => x.id === project || x.name === project);
    if (!p) throw new UsageError(t('cli.noProject', { name: project }));
    loaded = {
      name: p.name, graph: normalizeGraph(p.graph),
      opts: {
        targets: data.settings?.targets ?? ['claude'], lang: data.settings?.lang ?? 'es',
        fileOverrides: p.fileOverrides ?? {}, excluded: p.excluded ?? [],
      },
    };
  } else {
    let file = args.file;
    if (!file) {
      const found = (await readdir(io.cwd)).filter((f) => f.endsWith('.emede.json'));
      if (found.length !== 1) throw new UsageError(found.length ? t('cli.manyDesigns', { list: found.join(', ') }) : t('cli.noDesign'));
      file = found[0];
    }
    const path = resolve(io.cwd, file);
    if (!existsSync(path)) throw new UsageError(t('cli.fileMissing', { path }));
    const d = parseDesign(await readFile(path, 'utf8'));
    if (d.hidden) io.err(t('app.hiddenRemoved', { n: d.hidden }).trim());
    loaded = {
      name: d.graph.nodes.find((n) => n.id === 'project')?.data.d.name ?? file,
      graph: d.graph,
      opts: {
        targets: d.generate?.targets?.length ? d.generate.targets : ['claude'], lang: d.generate?.lang ?? 'es',
        fileOverrides: d.generate?.fileOverrides ?? {}, excluded: d.generate?.excluded ?? [],
      },
    };
  }
  // Las opciones de la línea de comandos mandan sobre lo guardado.
  if (typeof args.flags.targets === 'string') {
    const list = args.flags.targets.split(',').map((x) => x.trim());
    const bad = list.filter((x) => !(x in TARGETS));
    if (bad.length) throw new UsageError(t('cli.badTarget', { list: bad.join(', '), valid: Object.keys(TARGETS).join(', ') }));
    loaded.opts.targets = list as Target[];
  }
  if (typeof args.flags.lang === 'string') {
    if (!(LANGS as readonly string[]).includes(args.flags.lang)) throw new UsageError(t('cli.badLang', { lang: args.flags.lang, valid: LANGS.join(', ') }));
    loaded.opts.lang = args.flags.lang as Lang;
  }
  return loaded;
}

const readOrNull = (root: string) => async (path: string) => {
  try {
    return await readFile(join(root, path), 'utf8');
  } catch {
    return null;
  }
};

const stamp = () => new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');

function printCost(files: Record<string, string>, targets: Target[], io: Io) {
  const locale = LANG_INFO[detectLang(io.locales ?? [])].bcp47;
  io.out(t('files.session'));
  for (const c of sessionCost(files, targets)) io.out(`  ${TARGETS[c.target].padEnd(16)} ≈${formatTokens(c.tokens, locale)}`);
}

async function generate(args: Args, io: Io): Promise<number> {
  const { name, graph, opts } = await loadDesign(args, io);
  const outDir = resolve(io.cwd, typeof args.flags.out === 'string' ? args.flags.out : '.');
  const expected = expectedFiles(graph, opts);
  const checks = await compareWith(expected, readOrNull(outDir));
  const toWrite = checks.filter((c) => c.status !== 'same');
  io.out(t('cli.generating', { name, n: Object.keys(expected).length, targets: opts.targets.map((x) => TARGETS[x]).join(', ') }));
  for (const c of checks) io.out(`  ${c.status === 'missing' ? '+' : c.status === 'changed' ? '~' : '='} ${c.path}`);
  if (args.flags['dry-run']) {
    io.out(t('cli.dryRun', { n: toWrite.length }));
    return 0;
  }
  const backup = !args.flags['no-backup'];
  const folder = `.emede-backup/${stamp()}`;
  for (const c of toWrite) {
    const target = join(outDir, c.path);
    if (backup && c.status === 'changed' && c.current !== undefined) {
      await mkdir(dirname(join(outDir, folder, c.path)), { recursive: true });
      await writeFile(join(outDir, folder, c.path), c.current, 'utf8');
    }
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, expected[c.path], 'utf8');
  }
  const changed = toWrite.filter((c) => c.status === 'changed').length;
  io.out(t('cli.written', { n: toWrite.length, dir: outDir }) + (backup && changed ? t('write.backedUp', { n: changed, folder }) : ''));
  printCost(expected, opts.targets, io);
  return 0;
}

async function check(args: Args, io: Io): Promise<number> {
  const { name, graph, opts } = await loadDesign(args, io);
  const dir = resolve(io.cwd, typeof args.flags.dir === 'string' ? args.flags.dir : '.');
  const checks = await compareWith(expectedFiles(graph, opts), readOrNull(dir));
  const bad = checks.filter((c) => c.status !== 'same');
  if (!bad.length) {
    io.out(t('cli.upToDate', { name, n: checks.length }));
    return 0;
  }
  io.err(t('cli.outOfDate', { name, n: bad.length }));
  for (const c of bad) io.err(`  ${c.status === 'missing' ? t('cli.missing') : t('cli.changed')}  ${c.path}`);
  io.err(t('cli.howToFix'));
  return 1;
}

async function listProjects(io: Io): Promise<number> {
  const file = io.dataFile ?? defaultDataFile();
  if (!existsSync(file)) {
    io.out(t('cli.noData', { file }));
    return 0;
  }
  const data = JSON.parse(await readFile(file, 'utf8')) as { projects?: Record<string, { id: string; name: string; updatedAt?: number }> };
  const list = Object.values(data.projects ?? {}).sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0));
  if (!list.length) io.out(t('dash.none'));
  for (const p of list) io.out(`${p.name.padEnd(28)} ${p.id}`);
  return 0;
}

export async function main(argv: string[], io: Io): Promise<number> {
  await setUILang(detectLang(io.locales ?? []));
  const args = parseArgs(argv);
  if (args.flags.version) {
    io.out(__EMEDE_VERSION__);
    return 0;
  }
  try {
    switch (args.command) {
      case 'generate':
        return await generate(args, io);
      case 'check':
        return await check(args, io);
      case 'list':
        return await listProjects(io);
      case undefined:
      case 'help':
        io.out(t('cli.help'));
        return 0;
      default:
        throw new UsageError(t('cli.unknown', { cmd: args.command }));
    }
  } catch (e) {
    io.err(`✖ ${(e as Error).message}`);
    if (e instanceof UsageError) io.err(t('cli.seeHelp'));
    return 2;
  }
}

declare const __EMEDE_VERSION__: string;
