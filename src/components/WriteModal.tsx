import { useEffect, useMemo, useState } from 'react';
import { ensureWrite, pickDir, readText, rememberDir, rememberedDir, removeFile, writeText, type DirHandle } from '../fs';
import { diffLines, diffStats } from '../diff';
import { DiffView } from './DiffView';
import type { FileMap } from '../types';
import { t, useT } from '../i18n';

type Status = 'new' | 'changed' | 'same' | 'removed';
interface Row {
  path: string;
  status: Status;
  before: string;
  after: string;
  added: number;
  removed: number;
  /** Motivo para no tocarlo por defecto. */
  hold?: string;
}

/** Qué escribir y qué borrar, calculado recién cuando se conoce la carpeta. */
export interface WritePlan {
  files: FileMap;
  remove?: string[];
  /** Ruta → motivo: se muestran pero quedan sin marcar. */
  hold?: Record<string, string>;
}

/** De dónde sale la carpeta (por defecto, la del repo recordada en la sesión). */
export interface DirSource {
  get: () => DirHandle | null;
  pick: () => Promise<DirHandle | null>;
  label: string;
}

const repoDir: DirSource = {
  get: rememberedDir,
  pick: async () => {
    const d = await pickDir('readwrite');
    if (d) rememberDir(d);
    return d;
  },
  get label() {
    return t('write.pickRepo');
  },
};

const norm = (s: string) => s.replace(/\r\n/g, '\n');
const stamp = () => new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');

/**
 * Escribe los archivos en una carpeta local mostrando antes qué se crea, qué cambia (con diff) y qué queda igual.
 * Los archivos que se reemplazan se respaldan en .emede-backup/<fecha>/ (opcional, activado por defecto).
 */
export function WriteModal({ files, onClose, notify, title, source = repoDir, prepare, onWritten }: {
  files: FileMap;
  onClose: () => void;
  notify: (m: string, e?: boolean) => void;
  title?: string;
  source?: DirSource;
  prepare?: (dir: DirHandle) => Promise<WritePlan>;
  onWritten?: (dir: DirHandle, written: string[], removed: string[]) => void;
}) {
  useT();
  const [dir, setDir] = useState<DirHandle | null>(source.get());
  const [rows, setRows] = useState<Row[] | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [open, setOpen] = useState<string | null>(null);
  const [backup, setBackup] = useState(true);
  const [state, setState] = useState<'idle' | 'reading' | 'writing'>('idle');
  const [error, setError] = useState('');

  useEffect(() => {
    if (!dir) return;
    let alive = true;
    setState('reading');
    (async () => {
      const plan: WritePlan = prepare ? await prepare(dir) : { files };
      const out: Row[] = [];
      for (const [path, after] of Object.entries(plan.files)) {
        const before = await readText(dir, path);
        const hold = plan.hold?.[path];
        if (before === null) out.push({ path, status: 'new', before: '', after, added: after.split('\n').length, removed: 0, hold });
        else if (norm(before) === norm(after)) out.push({ path, status: 'same', before, after, added: 0, removed: 0 });
        else out.push({ path, status: 'changed', before, after, ...diffStats(diffLines(before, after)), hold });
      }
      for (const path of plan.remove ?? []) {
        const before = (await readText(dir, path)) ?? '';
        out.push({ path, status: 'removed', before, after: '', added: 0, removed: before.split('\n').length, hold: plan.hold?.[path] });
      }
      if (!alive) return;
      setRows(out);
      setSelected(new Set(out.filter((r) => r.status !== 'same' && !r.hold).map((r) => r.path)));
      setOpen(out.find((r) => r.status === 'changed')?.path ?? null);
      setState('idle');
    })().catch((e) => {
      setError((e as Error).message);
      setState('idle');
    });
    return () => {
      alive = false;
    };
  }, [dir, files, prepare]);

  const choose = async () => {
    setError('');
    const d = await source.pick().catch((e) => (setError((e as Error).message), null));
    if (!d) return;
    setRows(null);
    setDir(d);
  };

  const write = async () => {
    if (!dir || !rows) return;
    setState('writing');
    setError('');
    try {
      if (!(await ensureWrite(dir))) throw new Error(t('write.noPermission'));
      const chosen = rows.filter((r) => selected.has(r.path));
      const replaced = chosen.filter((r) => r.status === 'changed' || r.status === 'removed');
      const folder = `.emede-backup/${stamp()}`;
      if (backup) for (const r of replaced) await writeText(dir, `${folder}/${r.path}`, r.before);
      const written = chosen.filter((r) => r.status !== 'removed');
      const removed = chosen.filter((r) => r.status === 'removed');
      for (const r of written) await writeText(dir, r.path, r.after);
      for (const r of removed) await removeFile(dir, r.path);
      onWritten?.(dir, [...written.map((r) => r.path), ...(rows.filter((r) => r.status === 'same').map((r) => r.path))], removed.map((r) => r.path));
      notify(
        t('write.written', { n: written.length, dir: dir.name }) +
        (removed.length ? t('write.removedN', { n: removed.length }) : '') +
        (backup && replaced.length ? t('write.backedUp', { n: replaced.length, folder }) : ''),
      );
      onClose();
    } catch (e) {
      setError((e as Error).message);
      setState('idle');
    }
  };

  const groups = useMemo(() => {
    const by = (s: Status) => rows?.filter((r) => r.status === s) ?? [];
    return [
      { status: 'changed' as const, title: t('write.g.changed'), hint: t('write.g.changedHint'), rows: by('changed') },
      { status: 'new' as const, title: t('write.g.new'), hint: t('write.g.newHint'), rows: by('new') },
      { status: 'removed' as const, title: t('write.g.removed'), hint: t('write.g.removedHint'), rows: by('removed') },
      { status: 'same' as const, title: t('write.g.same'), hint: t('write.g.sameHint'), rows: by('same') },
    ].filter((g) => g.rows.length);
  }, [rows]);

  const toggle = (p: string) => setSelected((s) => {
    const n = new Set(s);
    if (n.has(p)) n.delete(p); else n.add(p);
    return n;
  });
  const current = rows?.find((r) => r.path === open);
  const replacing = rows?.filter((r) => r.status === 'changed' && selected.has(r.path)).length ?? 0;

  return (
    <div className="modal-bg" onMouseDown={(e) => e.target === e.currentTarget && state !== 'writing' && onClose()}>
      <div className="modal wide">
        <div className="modal-head">
          <h2>{title ?? t('write.title')}</h2>
          <button className="btn ghost" onClick={onClose} disabled={state === 'writing'}>✕</button>
        </div>

        <div className="row">
          <span className="muted">{t('write.folder')}</span> <b>{dir?.name ?? t('write.none')}</b>
          <button className="btn" onClick={choose}>{dir ? t('common.change') : source.label}</button>
        </div>
        {state === 'reading' && <p className="muted">{t('write.comparing')}</p>}
        {error && <p className="error">{error}</p>}

        {rows && (
          <div className="write-grid">
            <div className="write-list">
              {groups.map((g) => (
                <div key={g.status}>
                  <div className={`write-group ${g.status}`}>{g.title} ({g.rows.length}) <span className="muted small">{g.hint}</span></div>
                  {g.rows.map((r) => (
                    <div key={r.path} className={`write-row ${open === r.path ? 'on' : ''}`} onClick={() => setOpen(r.path)}>
                      <input
                        type="checkbox" disabled={r.status === 'same'} checked={selected.has(r.path)}
                        onClick={(e) => e.stopPropagation()} onChange={() => toggle(r.path)}
                      />
                      <code>{r.path}</code>
                      {r.hold && <span className="hold" title={r.hold}>⚠ {r.hold}</span>}
                      {r.status === 'changed' && <span className="stat"><i className="add">+{r.added}</i> <i className="del">−{r.removed}</i></span>}
                    </div>
                  ))}
                </div>
              ))}
            </div>
            <div className="write-diff">
              {current ? (
                <DiffView before={current.before} after={current.after} />
              ) : (
                <p className="muted small">{t('write.pickFile')}</p>
              )}
            </div>
          </div>
        )}

        {rows && (
          <>
            <label className="check">
              <input type="checkbox" checked={backup} onChange={(e) => setBackup(e.target.checked)} />
              {t('write.backup')}
            </label>
            {replacing > 0 && !backup && (
              <p className="error">{t('write.noBackup', { n: replacing })}</p>
            )}
          </>
        )}

        <div className="modal-foot">
          <button className="btn" onClick={onClose} disabled={state === 'writing'}>{t('common.cancel')}</button>
          <button className="btn primary" disabled={!rows || !selected.size || state !== 'idle'} onClick={write}>
            {state === 'writing' ? t('write.writing') : t('write.go', { n: selected.size })}
          </button>
        </div>
      </div>
    </div>
  );
}
