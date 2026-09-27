import { useContext } from 'react';
import { Handle, Position, type NodeProps } from '@xyflow/react';
import { IssuesContext } from '../issuesContext';
import { KIND_META } from '../defaults';
import { useStore, type FlowNode } from '../store';
import { useT } from '../i18n';

const BODY_FIELD = { project: 'memory', agent: 'prompt', skill: 'instructions', command: 'prompt', rule: 'content', mcp: '', hook: 'command' } as const;

export function NodeCard({ id, data, selected }: NodeProps<FlowNode>) {
  const t = useT();
  const d = data.d;
  const meta = KIND_META[d.kind];
  const busy = useStore((s) => s.busy[id]);
  const issue = useContext(IssuesContext).get(id);
  const field = BODY_FIELD[d.kind];
  const body = field ? ((d as unknown as Record<string, string>)[field] ?? '') : '';
  const subtitle =
    d.kind === 'mcp' ? (d.transport === 'http' ? d.url : `${d.command} ${d.args}`)
    : d.kind === 'project' ? d.stackItems?.map((i) => i.label).join(' · ') || d.description
    : d.kind === 'hook' ? d.command || d.description
    : d.description;
  const canSource = d.kind === 'command' || d.kind === 'agent';
  const canTarget = d.kind !== 'command' && d.kind !== 'project' && d.kind !== 'rule';

  return (
    <div
      className={`relative w-[230px] rounded-[10px] border border-t-[3px] border-line border-t-(--c) bg-panel px-3 py-2.5 shadow-[0_6px_20px_#0006] ${selected ? 'border-(--c) shadow-[0_0_0_1px_var(--c),0_6px_20px_#0006]' : ''} ${busy ? 'animate-[card-pulse_1.2s_infinite]' : ''}`}
      style={{ ['--c' as string]: meta.color }}>
      {canTarget && <Handle type="target" position={Position.Left} />}
      {issue && <span className={`absolute -top-2 -right-2 grid size-5 place-items-center rounded-full text-[11px] font-bold ${issue === 'error' ? 'bg-danger text-white' : 'bg-warn text-accent-ink'}`} title={t('card.issue')}>!</span>}
      <div className="flex items-center gap-1.5 text-[11px] tracking-[.8px] text-(--c) uppercase">
        <span className="w-3.5 text-center font-bold text-(--c)">{meta.icon}</span>
        <span>{t(`kind.${d.kind}`)}</span>
        {field && (
          <span className={`ml-auto size-2 rounded-full ${body.trim() ? 'bg-ok' : 'bg-[#444b5c]'}`} title={body.trim() ? t('card.ready') : t('card.empty')} />
        )}
      </div>
      <div className="mt-1 font-semibold break-words">{d.kind === 'command' ? `/${d.name}` : d.name}</div>
      {subtitle && <div className="mt-0.5 line-clamp-2 text-xs text-muted">{subtitle}</div>}
      {busy && <div className="mt-1 text-xs text-ai">{t('card.writing')}</div>}
      {canSource && <Handle type="source" position={Position.Right} />}
    </div>
  );
}
