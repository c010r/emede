import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useStore } from '../store';
import { readTree, type DirHandle } from '../fs';
import {
  applyImport, DEFAULT_VAULT_FOLDER, mirror, planImport, staleNotes, syncState, unsyncedEdits, vaultBase, type VaultChange,
} from '../obsidian';
import { configuredVault, currentVault, ensureAccess, pickVault, restoreVault, serverAvailable } from '../vaultDir';
import { requestRepair } from '../repair';
import { WriteModal, type DirSource, type WritePlan } from './WriteModal';
import { DiffView } from './DiffView';
import type { ProjectData } from '../types';
import { useT } from '../i18n';

const isNote = (p: string) => p.endsWith('.md') || p.endsWith('.canvas');

/**
 * Espejo del proyecto en un vault de Obsidian: enviar (emede → Obsidian) y traer cambios (Obsidian → emede).
 * Los archivos reales de los agentes siguen yendo al repo con "Guardar en carpeta".
 */
export function ObsidianModal({ onClose, notify, onSettings, start = 'home' }: {
  onClose: () => void; notify: (m: string, e?: boolean) => void; onSettings: () => void;
  /** "send": abre directo la vista de cambios para guardar en el vault (desde el indicador de la barra). */
  start?: 'home' | 'send';
}) {
  const t = useT();
  const folder = useStore((s) => s.settings.vaultFolder || DEFAULT_VAULT_FOLDER);
  const synced = useStore((s) => !!(s.nodes.find((n) => n.id === 'project')?.data.d as ProjectData).vault);
  const [vault, setVault] = useState<DirHandle | null>(currentVault());
  const [warn, setWarn] = useState('');
  const [mode, setMode] = useState<'home' | 'send' | 'pull'>(start);
  const [changes, setChanges] = useState<VaultChange[] | null>(null);
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [chosen, setChosen] = useState<Set<string>>(new Set());
  const [open, setOpen] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const base = vaultBase(useStore.getState(), folder);

  useEffect(() => {
    if (!vault) restoreVault().then(setVault).catch(() => undefined);
  }, [vault]);

  const choose = async () => {
    setError('');
    try {
      const r = await pickVault();
      if (!r) return;
      setVault(r.dir);
      setWarn(r.looksLikeVault ? '' : t('obs.notVault', { name: r.dir.name }));
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const byPath = !!configuredVault();
  const location = (vault as { location?: string } | null)?.location ?? vault?.name;

  const source: DirSource = useMemo(() => ({
    get: () => vault,
    pick: async () => (byPath ? vault : (await pickVault())?.dir ?? null),
    label: t('obs.pickVault'),
  }), [vault, byPath, t]);

  /* ---------- enviar ---------- */
  /** Notas que había en el vault al preparar el envío. */
  const inVault = useRef<Record<string, string>>({});
  const prepare = useCallback(async (dir: DirHandle): Promise<WritePlan> => {
    if (!(await ensureAccess(dir, 'readwrite'))) throw new Error(t('obs.noWrite'));
    const g = useStore.getState();
    const m = mirror(g, base, g.settings.lang);
    const existing = await readTree(dir, base, isNote);
    inVault.current = existing;
    const hold: Record<string, string> = {};
    for (const p of unsyncedEdits(g, existing)) hold[p] = t('obs.editedThere');
    return { files: m.files, remove: staleNotes(existing, m, (g.nodes[0].data.d as ProjectData).vault), hold };
  }, [base, t]);

  const written = (_dir: DirHandle, paths: string[], removed: string[]) => {
    const g = useStore.getState();
    const p = g.nodes.find((n) => n.id === 'project')!.data.d as ProjectData;
    const m = mirror(g, base, g.settings.lang);
    const sync = syncState(base, m, paths, p.vault);
    // Piezas borradas en emede cuya nota ya no está en el vault (se borró recién o antes en Obsidian): dejan de estar pendientes.
    const gone = (path: string) => removed.includes(path) || inVault.current[path] === undefined;
    sync.notes = Object.fromEntries(Object.entries(sync.notes).filter(([id, r]) => m.paths[id] || !gone(r.path)));
    g.setVaultSync(sync);
  };

  /* ---------- traer ---------- */
  const pull = async () => {
    if (!vault) return;
    setBusy(true);
    setError('');
    try {
      if (!(await ensureAccess(vault, 'read'))) throw new Error(t('obs.noRead'));
      const files = await readTree(vault, base, isNote);
      if (!Object.keys(files).length) throw new Error(t('obs.noNotes', { base }));
      const list = planImport(useStore.getState(), base, files, useStore.getState().settings.lang);
      setNotes(files);
      setChanges(list);
      // Por defecto se aplica lo seguro: ni conflictos ni borrados.
      setChosen(new Set(list.filter((c) => !c.conflict && c.type !== 'delete').map((c) => c.key)));
      setOpen(list[0]?.key ?? null);
      setMode('pull');
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const apply = () => {
    if (!changes) return;
    const st = useStore.getState();
    const selected = changes.filter((c) => chosen.has(c.key));
    st.setGraph(applyImport(st, base, selected, notes, st.settings.lang));
    notify(t('obs.pulled', { n: selected.length }));
    if (selected.length) requestRepair();
    onClose();
  };

  if (mode === 'send')
    return (
      <WriteModal
        title={t('obs.send')} files={{}} source={source} prepare={prepare} onWritten={written}
        onClose={onClose} notify={notify}
      />
    );

  const current = changes?.find((c) => c.key === open);
  const toggle = (k: string) => setChosen((s) => {
    const n = new Set(s);
    if (n.has(k)) n.delete(k); else n.add(k);
    return n;
  });
  const TYPE = { update: t('obs.t.update'), create: t('obs.t.create'), delete: t('obs.t.delete') } as const;

  return (
    <div className="modal-bg" onMouseDown={(e) => e.target === e.currentTarget && !busy && onClose()}>
      <div className={`modal ${mode === 'pull' ? 'wide' : ''}`}>
        <div className="modal-head">
          <h2>{t('obs.title')}</h2>
          <button className="btn ghost" onClick={onClose} disabled={busy}>✕</button>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <span className="text-muted">{t('obs.vault')}</span> <code className="wrap-anywhere">{location ?? t('obs.notConfigured')}</code>
          {byPath || serverAvailable()
            ? <button className="btn" onClick={() => { onClose(); onSettings(); }}>{byPath ? t('obs.changeInSettings') : t('obs.configureInSettings')}</button>
            : <button className="btn" onClick={choose}>{vault ? t('common.change') : t('obs.pickVault')}</button>}
        </div>
        {warn && <p className="text-[13px] whitespace-pre-wrap text-danger">{warn}</p>}
        <p className="text-xs"><span className="text-muted">{t('obs.projectFolder')}</span> <code>{base}/</code>
          {!synced && <span className="text-muted">{t('obs.baseInSettings')}</span>}</p>

        {mode === 'home' && (
          <>
            <p className="text-xs text-muted">{t('obs.intro')}</p>
            <div className="grid grid-cols-2 gap-2.5 [&_.btn]:flex [&_.btn]:flex-col [&_.btn]:items-start [&_.btn]:gap-1 [&_.btn]:px-3.5 [&_.btn]:py-3 [&_.btn]:text-left [&_.btn]:whitespace-normal">
              <button className="btn primary" disabled={!vault || busy} onClick={() => setMode('send')}>
                {t('obs.send')}
                <span className="text-xs">{t('obs.sendHint')}</span>
              </button>
              <button className="btn" disabled={!vault || busy || !synced} onClick={pull} title={synced ? '' : t('obs.pullFirst')}>
                {busy ? t('obs.readingVault') : t('obs.pull')}
                <span className="text-xs text-muted">{t('obs.pullHint')}</span>
              </button>
            </div>
            <p className="text-xs text-muted">{t('obs.asSource')}</p>
          </>
        )}

        {mode === 'pull' && changes && (
          changes.length === 0 ? (
            <p>{t('obs.noChanges')}</p>
          ) : (
            <div className="grid max-h-[55vh] min-h-80 grid-cols-[minmax(260px,38%)_1fr] gap-2.5">
              <div className="overflow-auto rounded-lg border border-line p-1.5">
                {changes.map((c) => (
                  <div key={c.key} className={`flex cursor-pointer items-center gap-2 rounded-md px-1.5 py-1 text-xs hover:bg-[#ffffff08] [&_code]:flex-1 [&_code]:truncate ${open === c.key ? 'bg-[#f5b84118]' : ''}`} onClick={() => setOpen(c.key)}>
                    <input type="checkbox" checked={chosen.has(c.key)} onClick={(e) => e.stopPropagation()} onChange={() => toggle(c.key)} />
                    <span>
                      <b>{c.label}</b> <span className="text-xs text-muted">{TYPE[c.type]}</span>
                      {c.conflict && <span className="ml-2 text-[11px] whitespace-nowrap text-warn-soft" title={t('obs.conflictTitle')}>{t('obs.conflict')}</span>}
                    </span>
                  </div>
                ))}
              </div>
              <div className="flex flex-col overflow-auto rounded-lg border border-line">
                {current ? (
                  <>
                    <p className="text-xs text-muted">{t('obs.sides', { path: current.path })}</p>
                    <DiffView before={current.before} after={current.after} />
                  </>
                ) : <p className="text-xs text-muted">{t('obs.pickChange')}</p>}
              </div>
            </div>
          )
        )}

        {error && <p className="text-[13px] whitespace-pre-wrap text-danger">{error}</p>}
        {mode === 'pull' && (
          <div className="modal-foot">
            <button className="btn" onClick={() => setMode('home')}>{t('common.back')}</button>
            <button className="btn primary" disabled={!chosen.size} onClick={apply}>{t('obs.apply', { n: chosen.size })}</button>
          </div>
        )}
      </div>
    </div>
  );
}
