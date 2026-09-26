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
    <div className="problems">
      <div className="audit-bar">
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
      {running && <p className="muted small repair-status">⏳ {status}</p>}
      {!running && report && <p className="small repair-report">{report}</p>}
      {pending > 0 && !running && (
        <button className="btn" onClick={() => useRepair.setState({ showQuestions: true })}>{t('prob.answer', { n: pending })}</button>
      )}

      {audit && (
        <div className="audit-head">
          <span className={`score ${audit.score >= 80 ? 'good' : audit.score >= 60 ? 'mid' : 'bad'}`}>{audit.score}</span>
          <span className="small">{audit.summary}</span>
        </div>
      )}

      <div className="problems-title muted small">{t('prob.pending')}</div>
      {!issues.length && (
        <div className="empty">
          <p>{t('prob.none')}</p>
          <p className="muted small">{t('prob.noneHint')}</p>
        </div>
      )}
      {issues.map((i) => (
        <div key={issueKey(i) + i.message} className={`problem ${i.level}`}>
          <button className="problem-main" onClick={() => onPick(i)} disabled={!i.nodeId && !i.path}>
            <span>{ICON[i.level]}</span>
            <span>{i.message}</span>
          </button>
          <span className="repair-how" title={t(`prob.how.${i.repair}`)}>{HOW[i.repair]}</span>
          <button className="btn ghost small" title={t('prob.ignoreTitle')} onClick={() => ignoreIssue(issueKey(i))}>{t('prob.ignore')}</button>
        </div>
      ))}
      {ignored > 0 && (
        <p className="muted small">
          {t('prob.ignoredN', { n: ignored })} <button className="linklike" onClick={restoreIgnored}>{t('prob.restore')}</button>
        </p>
      )}
      <p className="muted small legend-how">{t('prob.legend')}</p>
    </div>
  );
}
