import { useContext } from 'react';
import { Handle, Position, type NodeProps } from '@xyflow/react';
import { IssuesContext } from '../issuesContext';
import { KIND_META } from '../defaults';
import { useStore, type FlowNode } from '../store';
import { useT } from '../i18n';

const BODY_FIELD = { project: 'memory', agent: 'prompt', skill: 'instructions', command: 'prompt', rule: 'content', mcp: '' } as const;

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
    : d.description;
  const canSource = d.kind === 'command' || d.kind === 'agent';
  const canTarget = d.kind !== 'command' && d.kind !== 'project' && d.kind !== 'rule';

  return (
    <div className={`card ${selected ? 'selected' : ''} ${busy ? 'busy' : ''}`} style={{ ['--c' as string]: meta.color }}>
      {canTarget && <Handle type="target" position={Position.Left} />}
      {issue && <span className={`card-issue ${issue}`} title={t('card.issue')}>!</span>}
      <div className="card-head">
        <span className="card-icon">{meta.icon}</span>
        <span className="card-kind">{t(`kind.${d.kind}`)}</span>
        {field && (
          <span className={`card-dot ${body.trim() ? 'ok' : ''}`} title={body.trim() ? t('card.ready') : t('card.empty')} />
        )}
      </div>
      <div className="card-name">{d.kind === 'command' ? `/${d.name}` : d.name}</div>
      {subtitle && <div className="card-sub">{subtitle}</div>}
      {busy && <div className="card-busy">{t('card.writing')}</div>}
      {canSource && <Handle type="source" position={Position.Right} />}
    </div>
  );
}
