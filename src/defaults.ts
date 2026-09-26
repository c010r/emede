import type { Guards, NodeData, NodeKind } from './types';

export const KIND_META: Record<NodeKind, { label: string; color: string; icon: string }> = {
  project: { label: 'Proyecto', color: '#f5b841', icon: '◆' },
  agent: { label: 'Agente', color: '#7c9cff', icon: '◉' },
  skill: { label: 'Skill', color: '#4fd1a5', icon: '✦' },
  command: { label: 'Comando', color: '#f07fb6', icon: '/' },
  rule: { label: 'Regla', color: '#c9a2ff', icon: '§' },
  mcp: { label: 'MCP', color: '#62c6e8', icon: '⇄' },
};

export function emptyData(kind: NodeKind, name = ''): NodeData {
  switch (kind) {
    case 'project':
      return {
        kind, name: name || 'mi-proyecto', description: '', stackItems: [], stack: '', dev: '', build: '', test: '', lint: '',
        structure: '', conventions: '', memory: '', canary: defaultCanary(), guards: defaultGuards(),
      };
    case 'agent':
      return { kind, name: name || 'nuevo-agente', description: '', model: 'inherit', tools: ['read', 'search'], prompt: '' };
    case 'skill':
      return { kind, name: name || 'nueva-skill', description: '', instructions: '' };
    case 'command':
      return { kind, name: name || 'nuevo-comando', description: '', argumentHint: '', prompt: '' };
    case 'rule':
      return { kind, name: name || 'nueva-regla', description: '', globs: '', alwaysApply: true, content: '' };
    case 'mcp':
      return { kind, name: name || 'servidor', transport: 'stdio', command: 'npx', args: '', url: '', env: '', headers: '' };
  }
}

/** Conexiones permitidas en el lienzo: origen → destino. */
export const VALID_LINKS: Array<[NodeKind, NodeKind]> = [
  ['command', 'agent'],
  ['command', 'skill'],
  ['agent', 'skill'],
  ['agent', 'mcp'],
];

export const slug = (s: string) =>
  s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'item';

/** Marca de canario única por proyecto (difícil de producir por casualidad). */
export const newCanaryPhrase = () =>
  `🐤 CANARIO-${Array.from({ length: 4 }, () => 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'[Math.floor(Math.random() * 32)]).join('')}`;

export const defaultCanary = () => ({ enabled: true, phrase: newCanaryPhrase(), agents: true });

/** Guardarraíles razonables para cualquier proyecto: proteger secretos y pedir confirmación en lo irreversible. */
export const defaultGuards = (): Guards => ({
  enabled: true,
  protectPaths: ['.env', '.env.*', 'secrets/**', '**/*.pem', '**/*.key'].join('\n'),
  denyCommands: ['git push --force', 'git reset --hard', 'sudo'].join('\n'),
  askCommands: ['git push', 'rm -rf', 'npm publish'].join('\n'),
  allowCommands: '',
  formatCommand: '',
  testGate: false,
  sandbox: 'workspace-write',
  network: false,
});
