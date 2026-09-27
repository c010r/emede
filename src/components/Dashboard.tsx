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
    <div className="grid h-full grid-rows-[52px_1fr_auto]">
      {firstLaunch && <Splash />}
      <header className="flex min-w-0 items-center gap-2 border-b border-line bg-panel px-3.5 [&_.btn]:shrink-0">
        <Logo animate={!firstLaunch} />
        <span className="ml-1.5 text-xs text-muted max-[1100px]:hidden">{t('dash.tagline')}</span>
        <div className="flex-1" />
        <button className="btn ghost" onClick={onSettings}>{t('dash.settings')}{!hasKey && <span className="absolute top-[5px] right-1 size-[7px] rounded-full bg-danger" />}</button>
      </header>

      <main className="flex flex-col gap-7 overflow-auto px-[clamp(16px,4vw,48px)] py-6">
        <section>
          <h2 className="mb-3 text-base font-bold">{t('dash.start')}</h2>
          <div className="grid grid-cols-[repeat(auto-fill,minmax(200px,1fr))] gap-3">
            {STARTS.filter((s) => !s.needsFolders || canUseFolders()).map((s) => (
              <button key={s.mode} className="flex flex-col gap-1.5 rounded-xl border border-line bg-panel p-4 text-left text-fg transition-[border-color,translate] duration-150 hover:-translate-y-px hover:border-accent" onClick={() => (s.needsKey && !hasKey ? onSettings() : onStart(s.mode))}>
                <span className="text-[22px] text-accent">{s.icon}</span>
                <b>{t(`dash.${s.mode}.title` as MsgKey)}</b>
                <span className="text-xs text-muted">{s.needsKey && !hasKey ? t('dash.needsAI') : t(`dash.${s.mode}.text` as MsgKey)}</span>
              </button>
            ))}
          </div>
        </section>

        <section>
          <div className="flex flex-wrap items-center gap-4">
            <h2 className="m-0 text-base font-bold">{t('dash.saved')} {projects && <span className="text-muted">({projects.length})</span>}</h2>
            {!!projects?.length && (
              <input className="ml-auto max-w-[360px]" placeholder={t('dash.search')} value={query} onChange={(e) => setQuery(e.target.value)} />
            )}
          </div>

          {projects === null && <p className="text-muted">{t('dash.loading')}</p>}
          {projects?.length === 0 && <p className="text-muted">{t('dash.none')}</p>}
          {projects && projects.length > 0 && !shown.length && <p className="text-muted">{t('dash.noMatch', { q: query })}</p>}

          <div className="mt-3 grid grid-cols-[repeat(auto-fill,minmax(280px,1fr))] gap-3">
            {shown.map((p) => (
              <div key={p.id} className="proj flex flex-col gap-2 rounded-xl border border-line bg-panel p-3.5 hover:border-line-hover" onDoubleClick={() => open(p.id)}>
                <div className="flex items-baseline justify-between gap-2">
                  <b className="proj-name text-[15px] break-words">{p.name}</b>
                  <span className="text-xs text-muted">{ago(p.updatedAt)}</span>
                </div>
                {p.description && <p className="m-0 line-clamp-2 text-[13px] text-muted">{p.description}</p>}
                {p.stack.length > 0 && <div className="text-xs text-[#9fb3ff]">{p.stack.join(' · ')}</div>}
                <div className="flex gap-3 text-[13px]">
                  {(Object.keys(p.counts) as (keyof ProjectSummary['counts'])[]).filter((k) => p.counts[k]).map((k) => (
                    <span key={k} style={{ color: KIND_META[k].color }} title={t(`kind.${k}`)}>
                      {KIND_META[k].icon} {p.counts[k]}
                    </span>
                  ))}
                  {!Object.values(p.counts).some(Boolean) && <span className="text-xs text-muted">{t('dash.empty')}</span>}
                </div>
                <div className="mt-auto flex items-center gap-1">
                  <button className="btn primary px-3.5 py-[5px]" onClick={() => open(p.id)}>{t('dash.open')}</button>
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

      <footer className="border-t border-line bg-panel px-[clamp(16px,4vw,48px)] py-2.5 text-xs text-muted">
        {backend.kind === 'file' ? (
          <>{t('dash.dataFile')} <code>{backend.location}</code></>
        ) : (
          <>{t('dash.noServer')}</>
        )}
      </footer>
    </div>
  );
}
