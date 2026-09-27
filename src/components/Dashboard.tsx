import { useCallback, useEffect, useMemo, useState } from 'react';
import { KIND_META } from '../defaults';
import { storage, type ProjectSummary } from '../storage';
import { deleteProject, duplicateProject, openProject } from '../projects';
import { useStore } from '../store';
import { hasAI } from '../providers';
import { canUseFolders } from '../fs';
import { t, uiLang, useT, type MsgKey } from '../i18n';
import { LANG_INFO } from '../i18n/langs';
import { Logo, Splash } from './Logo';

export type StartMode = 'blank' | 'ai' | 'plan' | 'templates' | 'repo' | 'json';

const ago = (time: number) => {
  const m = Math.round((Date.now() - time) / 60000);
  if (m < 1) return t('time.now');
  if (m < 60) return t('time.min', { n: m });
  const h = Math.round(m / 60);
  if (h < 24) return t('time.hours', { n: h });
  const d = Math.round(h / 24);
  return d < 30 ? t('time.days', { n: d }) : new Date(time).toLocaleDateString(LANG_INFO[uiLang()].bcp47);
};

const STARTS: { mode: StartMode; icon: string; needsFolders?: boolean; needsKey?: boolean }[] = [
  { mode: 'blank', icon: '＋' },
  { mode: 'ai', icon: '✨', needsKey: true },
  { mode: 'plan', icon: '📄', needsKey: true },
  { mode: 'templates', icon: '📚' },
  { mode: 'repo', icon: '📥', needsFolders: true },
  { mode: 'json', icon: '⬆' },
];

/** La presentación completa va solo al abrir la app; al volver del editor se anima el logo de la barra. */
let launched = false;

export function Dashboard({ onStart, onSettings, notify }: {
  onStart: (mode: StartMode) => void;
  onSettings: () => void;
  notify: (m: string, e?: boolean) => void;
}) {
  useT();
  const hasKey = useStore((s) => hasAI(s.settings));
  const [projects, setProjects] = useState<ProjectSummary[] | null>(null);
  const [query, setQuery] = useState('');
  const [confirm, setConfirm] = useState<string | null>(null);
  const [firstLaunch] = useState(() => !launched);
  useEffect(() => {
    launched = true;
  }, []);
  const backend = storage();

  const reload = useCallback(() => {
    backend.list().then(setProjects).catch((e) => notify((e as Error).message, true));
  }, [backend, notify]);
  useEffect(reload, [reload]);

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (projects ?? []).filter((p) => !q || `${p.name} ${p.description} ${p.stack.join(' ')}`.toLowerCase().includes(q));
  }, [projects, query]);

  const open = async (id: string) => {
    if (!(await openProject(id))) notify(t('dash.notFound'), true);
  };

  return (
    <div className="dash">
      {firstLaunch && <Splash />}
      <header className="top">
        <Logo animate={!firstLaunch} />
        <span className="tagline">{t('dash.tagline')}</span>
        <div className="spacer" />
        <button className="btn ghost" onClick={onSettings}>{t('dash.settings')}{!hasKey && <span className="warn-dot" />}</button>
      </header>

      <main className="dash-body">
        <section>
          <h2>{t('dash.start')}</h2>
          <div className="start-grid">
            {STARTS.filter((s) => !s.needsFolders || canUseFolders()).map((s) => (
              <button key={s.mode} className="start" onClick={() => (s.needsKey && !hasKey ? onSettings() : onStart(s.mode))}>
                <span className="start-icon">{s.icon}</span>
                <b>{t(`dash.${s.mode}.title` as MsgKey)}</b>
                <span className="muted small">{s.needsKey && !hasKey ? t('dash.needsAI') : t(`dash.${s.mode}.text` as MsgKey)}</span>
              </button>
            ))}
          </div>
        </section>

        <section>
          <div className="dash-row">
            <h2>{t('dash.saved')} {projects && <span className="muted">({projects.length})</span>}</h2>
            {!!projects?.length && (
              <input className="dash-search" placeholder={t('dash.search')} value={query} onChange={(e) => setQuery(e.target.value)} />
            )}
          </div>

          {projects === null && <p className="muted">{t('dash.loading')}</p>}
          {projects?.length === 0 && <p className="muted">{t('dash.none')}</p>}
          {projects && projects.length > 0 && !shown.length && <p className="muted">{t('dash.noMatch', { q: query })}</p>}

          <div className="proj-grid">
            {shown.map((p) => (
              <div key={p.id} className="proj" onDoubleClick={() => open(p.id)}>
                <div className="proj-head">
                  <b className="proj-name">{p.name}</b>
                  <span className="muted small">{ago(p.updatedAt)}</span>
                </div>
                {p.description && <p className="proj-desc">{p.description}</p>}
                {p.stack.length > 0 && <div className="proj-stack">{p.stack.join(' · ')}</div>}
                <div className="proj-counts">
                  {(Object.keys(p.counts) as (keyof ProjectSummary['counts'])[]).filter((k) => p.counts[k]).map((k) => (
                    <span key={k} style={{ color: KIND_META[k].color }} title={t(`kind.${k}`)}>
                      {KIND_META[k].icon} {p.counts[k]}
                    </span>
                  ))}
                  {!Object.values(p.counts).some(Boolean) && <span className="muted small">{t('dash.empty')}</span>}
                </div>
                <div className="proj-actions">
                  <button className="btn primary" onClick={() => open(p.id)}>{t('dash.open')}</button>
                  <button className="btn ghost" title={t('dash.duplicate')} onClick={async () => { await duplicateProject(p.id); reload(); }}>⧉</button>
                  {confirm === p.id ? (
                    <>
                      <button className="btn ghost danger" onClick={async () => { await deleteProject(p.id); setConfirm(null); reload(); notify(t('dash.deleted', { name: p.name })); }}>{t('dash.confirmDelete')}</button>
                      <button className="btn ghost" onClick={() => setConfirm(null)}>{t('common.cancel')}</button>
                    </>
                  ) : (
                    <button className="btn ghost" title={t('dash.delete')} onClick={() => setConfirm(p.id)}>🗑</button>
                  )}
                </div>
              </div>
            ))}
          </div>
        </section>
      </main>

      <footer className="dash-foot muted small">
        {backend.kind === 'file' ? (
          <>{t('dash.dataFile')} <code>{backend.location}</code></>
        ) : (
          <>{t('dash.noServer')}</>
        )}
      </footer>
    </div>
  );
}
