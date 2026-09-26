import { useMemo, useState } from 'react';
import { useStore } from '../store';
import { KIND_META } from '../defaults';
import { candidates, caseId, improveDescriptions, NONE, runRouting, suggestCases, type RoutingCase, type RoutingResult } from '../routing';
import { hasAI } from '../providers';
import { useT } from '../i18n';
import type { ProjectData } from '../types';

/** Prueba de enrutamiento: pedidos de ejemplo y qué agente o skill elige la IA viendo solo las descripciones. */
export function RoutingModal({ onClose, notify }: { onClose: () => void; notify: (m: string, e?: boolean) => void }) {
  const t = useT();
  const nodes = useStore((s) => s.nodes);
  const settings = useStore((s) => s.settings);
  const list = useMemo(() => candidates({ nodes, edges: [] }), [nodes]);
  const saved = (nodes.find((n) => n.id === 'project')?.data.d as ProjectData | undefined)?.routing ?? [];
  const [cases, setCases] = useState<RoutingCase[]>(saved);
  const [results, setResults] = useState<Record<string, RoutingResult>>({});
  const [busy, setBusy] = useState<'' | 'suggest' | 'run' | 'improve'>('');
  const ai = hasAI(settings);

  const persist = (next: RoutingCase[]) => {
    setCases(next);
    useStore.getState().updateNode('project', { routing: next } as Partial<ProjectData>);
  };
  const edit = (id: string, patch: Partial<RoutingCase>) => {
    persist(cases.map((c) => (c.id === id ? { ...c, ...patch } : c)));
    setResults(({ [id]: _, ...rest }) => rest);
  };
  const label = (key: string) => {
    if (key === NONE) return t('route.none');
    const c = list.find((x) => x.key === key);
    return c ? `${KIND_META[c.kind].icon} ${c.name}` : `⚠ ${key}`;
  };
  const guard = async (kind: typeof busy, fn: () => Promise<void>) => {
    setBusy(kind);
    try {
      await fn();
    } catch (e) {
      notify((e as Error).message, true);
    } finally {
      setBusy('');
    }
  };

  const suggest = () => guard('suggest', async () => {
    const more = await suggestCases(useStore.getState(), settings);
    const have = new Set(cases.map((c) => c.request.trim().toLowerCase()));
    persist([...cases, ...more.filter((c) => !have.has(c.request.toLowerCase()))]);
  });
  const run = (g = useStore.getState()) => guard('run', async () => {
    const res = await runRouting(g, cases, settings);
    setResults(Object.fromEntries(res.map((r) => [r.caseId, r])));
  });
  const improve = () => guard('improve', async () => {
    const st = useStore.getState();
    const { graph, changed } = await improveDescriptions(st, cases, Object.values(results), settings);
    if (!changed.length) return notify(t('route.noChanges'));
    st.setGraph(graph);
    notify(t('route.improved', { n: changed.length }));
    // Se vuelve a probar con las descripciones nuevas.
    const res = await runRouting(graph, cases, settings);
    setResults(Object.fromEntries(res.map((r) => [r.caseId, r])));
  });

  const done = Object.values(results);
  const ok = done.filter((r) => r.ok).length;
  const failed = done.length - ok;

  return (
    <div className="modal-bg" onMouseDown={(e) => e.target === e.currentTarget && !busy && onClose()}>
      <div className="modal wide">
        <div className="modal-head">
          <h2>{t('route.title')}</h2>
          <button className="btn ghost" onClick={onClose} disabled={!!busy}>✕</button>
        </div>
        <p className="muted small">{t('route.intro')}</p>
        {!ai && <p className="error">{t('prob.needsAI')}</p>}
        {!list.length && <p className="muted">{t('route.noPieces')}</p>}

        {list.length > 0 && (
          <>
            <div className="row wrap">
              <button className="btn ai" disabled={!ai || !!busy} onClick={suggest}>{busy === 'suggest' ? '⏳ ' : ''}{t('route.suggest')}</button>
              <button className="btn" disabled={!!busy} onClick={() => persist([...cases, { id: caseId(), request: '', expect: list[0].key }])}>{t('route.add')}</button>
              <button className="btn primary" disabled={!ai || !!busy || !cases.some((c) => c.request.trim())} onClick={() => run()}>
                {busy === 'run' ? '⏳ ' : ''}{t('route.run', { n: cases.filter((c) => c.request.trim()).length })}
              </button>
              {done.length > 0 && (
                <span className={`route-score ${failed ? 'bad' : 'good'}`}>{t('route.score', { ok, total: done.length })}</span>
              )}
              {failed > 0 && (
                <button className="btn ai" disabled={!!busy} onClick={improve} title={t('route.improveTitle')}>
                  {busy === 'improve' ? '⏳ ' : ''}{t('route.improve')}
                </button>
              )}
            </div>

            {cases.length === 0 ? <p className="muted small">{t('route.empty')}</p> : (
              <div className="route-table">
                <div className="route-row head muted small">
                  <span>{t('route.request')}</span><span>{t('route.expect')}</span><span>{t('route.chosen')}</span><span />
                </div>
                {cases.map((c) => {
                  const r = results[c.id];
                  return (
                    <div key={c.id} className={`route-row ${r ? (r.ok ? 'ok' : 'fail') : ''}`}>
                      <input value={c.request} placeholder={t('route.requestPh')} onChange={(e) => edit(c.id, { request: e.target.value })} aria-label={t('route.request')} />
                      <select value={c.expect} onChange={(e) => edit(c.id, { expect: e.target.value })} aria-label={t('route.expect')}>
                        {list.map((x) => <option key={x.key} value={x.key}>{label(x.key)}</option>)}
                        <option value={NONE}>{t('route.none')}</option>
                      </select>
                      <span className="small" title={r?.reason}>
                        {r ? <>{r.ok ? '✔' : '✖'} {label(r.chosen)}{r.reason && <div className="muted small">{r.reason}</div>}</> : <span className="muted">—</span>}
                      </span>
                      <button className="btn ghost" onClick={() => persist(cases.filter((x) => x.id !== c.id))} title={t('route.remove')} aria-label={t('route.remove')}>✕</button>
                    </div>
                  );
                })}
              </div>
            )}
          </>
        )}
        <p className="muted small">{t('route.note')}</p>
      </div>
    </div>
  );
}
