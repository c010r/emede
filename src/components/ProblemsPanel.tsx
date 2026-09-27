import { useMemo, useState } from 'react';
import { RoutingModal } from './RoutingModal';
import { issueKey, type Issue } from '../validate';
import { useStore } from '../store';
import { hasAI } from '../providers';
import { ignoreIssue, repairAll, restoreIgnored, useRepair } from '../repair';
import type { ProjectData } from '../types';
import { useT } from '../i18n';

const ICON = { error: '⛔', warn: '⚠', info: 'ℹ' } as const;
const HOW = { auto: '🔧', ai: '✨', ask: '❓' } as const;


/** Color del borde izquierdo de cada problema según su gravedad. */
const LEVEL_BORDER: Record<string, string> = { error: 'border-l-danger', warn: 'border-l-warn', info: 'border-l-info' };
export function ProblemsPanel({ issues, onPick, notify }: {
  issues: Issue[];
  onPick: (i: Issue) => void;
  notify: (m: string, e?: boolean) => void;
}) {
  const t = useT();
  const hasKey = useStore((s) => hasAI(s.settings));
  const ignored = useStore((s) => (s.nodes.find((n) => n.id === 'project')?.data.d as ProjectData | undefined)?.review?.ignored.length ?? 0);
  const { running, status, report, audit, questions } = useRepair();
  const [routing, setRouting] = useState(false);
  const pending = useMemo(() => questions.length, [questions]);

  const run = (withAudit: boolean) =>
    repairAll({ audit: withAudit, fresh: true }).catch((e) => notify((e as Error).message, true));

  return (
    <div className="flex flex-col gap-1 p-2.5">
      <div className="mb-1 flex flex-wrap items-center gap-2.5">
        <button className="btn primary" disabled={running || !issues.length} onClick={() => run(false)}
          title={t('prob.repairAllTitle')}>
          {t('prob.repairAll')}
        </button>
        <button className="btn ai" disabled={running || !hasKey} onClick={() => run(true)} title={hasKey ? t('prob.auditTitle') : t('prob.needsAI')}>
          {t('prob.audit')}
        </button>
        <button className="btn" onClick={() => setRouting(true)} title={t('route.buttonTitle')}>{t('route.button')}</button>
      </div>
      {routing && <RoutingModal onClose={() => setRouting(false)} notify={notify} />}
      {running && <p className="mx-0.5 mt-0.5 mb-1 text-xs text-muted">⏳ {status}</p>}
      {!running && report && <p className="mx-0.5 mt-0.5 mb-1 text-xs text-fg">{report}</p>}
      {pending > 0 && !running && (
        <button className="btn" onClick={() => useRepair.setState({ showQuestions: true })}>{t('prob.answer', { n: pending })}</button>
      )}

      {audit && (
        <div className="mb-1 flex items-center gap-2.5 text-[13px]">
          <span className={`min-w-11 rounded-lg px-1.5 py-0.5 text-center text-xl font-extrabold ${audit.score >= 80 ? 'bg-[#4fd1a51a] text-ok' : audit.score >= 60 ? 'bg-[#ffb4471a] text-warn-soft' : 'bg-[#ff6b6b1a] text-del'}`}>{audit.score}</span>
          <span className="text-xs">{audit.summary}</span>
        </div>
      )}

      <div className="mx-0.5 mt-2 mb-0 text-xs tracking-[.8px] text-muted uppercase">{t('prob.pending')}</div>
      {!issues.length && (
        <div className="p-6 text-muted">
          <p>{t('prob.none')}</p>
          <p className="text-xs text-muted">{t('prob.noneHint')}</p>
        </div>
      )}
      {issues.map((i) => (
        <div key={issueKey(i) + i.message} className={`flex items-center gap-2 rounded-lg border border-l-[3px] border-line bg-panel2 px-2.5 py-2 text-left text-[13px] text-fg ${LEVEL_BORDER[i.level] ?? 'border-l-muted'}`}>
          <button className="flex flex-1 gap-2 text-left disabled:cursor-default" onClick={() => onPick(i)} disabled={!i.nodeId && !i.path}>
            <span>{ICON[i.level]}</span>
            <span>{i.message}</span>
          </button>
          <span className="cursor-help text-[13px]" title={t(`prob.how.${i.repair}`)}>{HOW[i.repair]}</span>
          <button className="btn ghost small" title={t('prob.ignoreTitle')} onClick={() => ignoreIssue(issueKey(i))}>{t('prob.ignore')}</button>
        </div>
      ))}
      {ignored > 0 && (
        <p className="text-xs text-muted">
          {t('prob.ignoredN', { n: ignored })} <button className="text-accent underline" onClick={restoreIgnored}>{t('prob.restore')}</button>
        </p>
      )}
      <p className="mt-2 text-xs text-muted">{t('prob.legend')}</p>
    </div>
  );
}
