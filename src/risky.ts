import type { FileOverride } from './store';
import type { NodeData, ProjectData } from './types';
import { resolveGuards } from './generators/guards';
import { t } from './i18n';

/*
 * Un diseño (.emede.json) o un paquete de plantillas (.emede-pack.json) que viene de otra persona puede traer
 * comandos que los agentes ejecutan en el equipo: servidores MCP, el formateador que corre después de cada edición,
 * los tests que se exigen antes de terminar, comandos que se aprueban sin preguntar, o ediciones manuales de los
 * archivos que configuran hooks y permisos. No se bloquean (son parte del diseño), pero se muestran al abrirlo
 * para que se revisen antes de guardar los archivos.
 */

export interface RunsCommand {
  what: 'mcp' | 'format' | 'gate' | 'allow' | 'override';
  /** Nombre de la pieza o ruta del archivo. */
  name?: string;
  value: string;
}

/** Archivos generados que definen qué se ejecuta: hooks, permisos, MCP y el script de guarda. */
const EXEC_FILE = /(^|\/)(settings(\.local)?\.json|hooks\.json|opencode\.jsonc?|config\.toml|\.?mcp\.json|agent-guard\.mjs)$/;

export function commandsIn(data: Partial<NodeData>[], overrides: Record<string, FileOverride> = {}): RunsCommand[] {
  const out: RunsCommand[] = [];
  for (const d of data) {
    if (d.kind === 'mcp' && d.transport !== 'http' && d.command?.trim())
      out.push({ what: 'mcp', name: d.name, value: [d.command, d.args].map((x) => x?.trim()).filter(Boolean).join(' ') });
    if (d.kind === 'project') {
      const g = resolveGuards({ test: '', lint: '', ...d } as ProjectData);
      if (!g) continue;
      if (g.format) out.push({ what: 'format', value: g.format });
      if (g.gate) out.push({ what: 'gate', value: g.gate });
      for (const c of g.allow) out.push({ what: 'allow', value: c });
    }
  }
  for (const path of Object.keys(overrides)) if (EXEC_FILE.test(path)) out.push({ what: 'override', name: path, value: '' });
  return out;
}

const MAX = 8;

/** Aviso para mostrar al abrir el archivo (vacío si no ejecuta nada). */
export function commandsWarning(list: RunsCommand[]): string {
  if (!list.length) return '';
  const label = (c: RunsCommand) =>
    c.what === 'override' ? t('risk.override', { name: c.name ?? '' })
      : `${c.what === 'mcp' ? t('risk.mcp', { name: c.name ?? '' }) : t(`risk.${c.what}` as const)}: \`${c.value}\``;
  const shown = list.slice(0, MAX).map(label);
  if (list.length > MAX) shown.push(t('risk.more', { n: list.length - MAX }));
  return t('risk.warning', { list: shown.join('; ') });
}
