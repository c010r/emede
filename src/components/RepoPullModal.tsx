import { useEffect, useState } from 'react';
import { useStore } from '../store';
import { pickDir, rememberDir, rememberedDir, type DirHandle } from '../fs';
import { applyRepoPull, planRepoPull, type RepoPull } from '../repoSync';
import { requestRepair } from '../repair';
import { useT } from '../i18n';
import { DiffView } from './DiffView';

/** Trae al diseño lo que cambió en el repo desde el último guardado (a mano, por un agente, en otra rama…). */
export function RepoPullModal({ onClose, notify }: { onClose: () => void; notify: (m: string, e?: boolean) => void }) {
  const t = useT();
  const [dir, setDir] = useState<DirHandle | null>(rememberedDir());
  const [plan, setPlan] = useState<RepoPull | null>(null);
  const [chosen, setChosen] = useState<Set<string>>(new Set());
  const [open, setOpen] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!dir) return;
    let alive = true;
    setBusy(true);
    setError('');
    const s = useStore.getState();
    planRepoPull(s, { targets: s.settings.targets, lang: s.settings.lang, fileOverrides: s.fileOverrides, excluded: s.excluded }, dir)
      .then((p) => {
        if (!alive) return;
        setPlan(p);
        // Por defecto: los cambios en piezas existentes. Las nuevas y las ediciones de archivo, a elección.
        setChosen(new Set(p.changes.filter((c) => c.type === 'update').map((c) => c.key)));
        setOpen(p.changes[0]?.key ?? null);
      })
      .catch((e) => setError((e as Error).message))
      .finally(() => alive && setBusy(false));
    return () => {
      alive = false;
    };
  }, [dir]);

  const choose = async () => {
    const d = await pickDir('read').catch((e) => (setError((e as Error).message), null));
    if (!d) return;
    rememberDir(d);
    setPlan(null);
    setDir(d);
  };

  const apply = () => {
    if (!plan) return;
    const st = useStore.getState();
    const selected = plan.changes.filter((c) => chosen.has(c.key));
    const { graph, overrides } = applyRepoPull(st, selected);
    st.setGraph(graph);
    for (const o of overrides) if (o) st.setOverride(o.path, o.value);
    notify(t('repo.done', { n: selected.length }));
    if (selected.some((c) => c.apply)) requestRepair();
    onClose();
  };

  const toggle = (k: string) => setChosen((s) => {
    const n = new Set(s);
    if (n.has(k)) n.delete(k); else n.add(k);
    return n;
  });
  const current = plan?.changes.find((c) => c.key === open);
  const TYPE = { update: t('repo.t.update'), create: t('repo.t.create'), file: t('repo.t.file') } as const;

  return (
    <div className="modal-bg" onMouseDown={(e) => e.target === e.currentTarget && !busy && onClose()}>
      <div className="modal wide">
        <div className="modal-head">
          <h2>{t('repo.title')}</h2>
          <button className="btn ghost" onClick={onClose} disabled={busy}>✕</button>
        </div>
        <p className="text-xs text-muted">{t('repo.intro')}</p>
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-muted">{t('write.folder')}</span> <b>{dir?.name ?? t('write.none')}</b>
          <button className="btn" onClick={choose} disabled={busy}>{dir ? t('common.change') : t('write.pickRepo')}</button>
        </div>
        {busy && <p className="text-muted">{t('repo.reading')}</p>}
        {error && <p className="text-[13px] whitespace-pre-wrap text-danger">{error}</p>}

        {plan && !busy && (
          <>
            <p className="text-xs text-muted">
              {t('repo.summary', { same: plan.same, changes: plan.changes.length })}
              {plan.missing.length > 0 && <> · {t('repo.missing', { n: plan.missing.length })}</>}
            </p>
            {plan.changes.length === 0 ? (
              <p>{t('repo.none')}</p>
            ) : (
              <div className="grid max-h-[55vh] min-h-80 grid-cols-[minmax(260px,38%)_1fr] gap-2.5">
                <div className="overflow-auto rounded-lg border border-line p-1.5">
                  {plan.changes.map((c) => (
                    <div key={c.key} className={`flex cursor-pointer items-center gap-2 rounded-md px-1.5 py-1 text-xs hover:bg-[#ffffff08] [&_code]:flex-1 [&_code]:truncate ${open === c.key ? 'bg-[#f5b84118]' : ''}`} onClick={() => setOpen(c.key)}>
                      <input type="checkbox" checked={chosen.has(c.key)} onClick={(e) => e.stopPropagation()} onChange={() => toggle(c.key)} />
                      <span>
                        <b>{c.label}</b> <span className="text-xs text-muted">{TYPE[c.type]}</span>
                        {c.type !== 'file' && c.paths.length > 0 && <div className="font-mono text-xs text-muted">{t('repo.from', { list: c.paths.join(', ') })}</div>}
                      </span>
                    </div>
                  ))}
                </div>
                <div className="flex flex-col overflow-auto rounded-lg border border-line">
                  {current ? (
                    <>
                      <p className="text-xs text-muted">{current.type === 'file' ? t('repo.fileHint') : t('repo.sides')}</p>
                      <DiffView before={current.before} after={current.after} />
                    </>
                  ) : <p className="text-xs text-muted">{t('obs.pickChange')}</p>}
                </div>
              </div>
            )}
          </>
        )}

        <div className="modal-foot">
          <button className="btn" onClick={onClose} disabled={busy}>{t('common.cancel')}</button>
          <button className="btn primary" disabled={busy || !chosen.size} onClick={apply}>{t('repo.apply', { n: chosen.size })}</button>
        </div>
      </div>
    </div>
  );
}
