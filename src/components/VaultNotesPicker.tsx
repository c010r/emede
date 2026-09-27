import { useEffect, useMemo, useState } from 'react';
import { readTree, type DirHandle } from '../fs';
import { collectNotes, DEFAULT_VAULT_FOLDER } from '../obsidian';
import { configuredVault, currentVault, ensureAccess, pickVault, restoreVault, serverAvailable } from '../vaultDir';
import { useStore } from '../store';
import { useT } from '../i18n';

const SHOW = 300;

/** Elige notas del vault de Obsidian para usarlas como plan (con sus notas enlazadas si se quiere). */
export function VaultNotesPicker({ onUse, onCancel }: { onUse: (text: string, count: number) => void; onCancel: () => void }) {
  const t = useT();
  const mirrorFolder = useStore((s) => (s.settings.vaultFolder || DEFAULT_VAULT_FOLDER).replace(/^\/+|\/+$/g, ''));
  const [vault, setVault] = useState<DirHandle | null>(currentVault());
  const [all, setAll] = useState<Record<string, string> | null>(null);
  const [filter, setFilter] = useState('');
  const [chosen, setChosen] = useState<Set<string>>(new Set());
  const [linked, setLinked] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!vault) restoreVault().then(setVault).catch(() => undefined);
  }, [vault]);

  const load = async (dir: DirHandle) => {
    setError('');
    setAll(null);
    try {
      if (!(await ensureAccess(dir, 'read'))) throw new Error(t('obs.noRead'));
      // Se salta el espejo de emede: son notas generadas, no fuente.
      setAll(await readTree(dir, '', (p) => p.endsWith('.md'), (p) => p === mirrorFolder));
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const choose = async () => {
    const r = await pickVault().catch((e) => (setError((e as Error).message), null));
    if (r) {
      setVault(r.dir);
      await load(r.dir);
    }
  };

  const paths = useMemo(() => {
    const q = filter.trim().toLowerCase();
    return Object.keys(all ?? {}).sort().filter((p) => !q || p.toLowerCase().includes(q) || all![p].toLowerCase().includes(q));
  }, [all, filter]);

  const toggle = (p: string) => setChosen((s) => {
    const n = new Set(s);
    if (n.has(p)) n.delete(p); else n.add(p);
    return n;
  });

  const use = () => onUse(collectNotes(all!, [...chosen], linked), chosen.size);

  return (
    <div className="flex flex-col gap-2 rounded-[10px] border border-line p-2.5">
      <div className="flex items-center justify-between gap-2">
        <span><span className="text-muted">{t('obs.vault')}</span> <code className="wrap-anywhere">{(vault as { location?: string } | null)?.location ?? vault?.name ?? t('obs.notConfigured')}</code></span>
        <span className="flex gap-2">
          {vault && !all && <button className="btn" onClick={() => load(vault)}>{t('notes.read')}</button>}
          {!configuredVault() && !serverAvailable() && <button className="btn" onClick={choose}>{vault ? t('common.change') : t('obs.pickVault')}</button>}
        </span>
      </div>
      {!vault && serverAvailable() && <p className="text-xs text-muted">{t('notes.configure')}</p>}
      {error && <p className="text-[13px] whitespace-pre-wrap text-danger">{error}</p>}
      {all && (
        <>
          <input value={filter} autoFocus onChange={(e) => setFilter(e.target.value)} placeholder={t('notes.search', { n: Object.keys(all).length })} />
          <div className="flex max-h-[280px] flex-col gap-1.5 overflow-auto rounded-lg bg-panel2 p-1">
            {paths.slice(0, SHOW).map((p) => (
              <label key={p} className="check text-xs">
                <input type="checkbox" checked={chosen.has(p)} onChange={() => toggle(p)} />
                <code>{p.replace(/\.md$/, '')}</code>
              </label>
            ))}
            {paths.length > SHOW && <p className="text-xs text-muted">{t('notes.more', { n: paths.length - SHOW })}</p>}
            {!paths.length && <p className="text-xs text-muted">{t('notes.none')}</p>}
          </div>
          <label className="check text-xs">
            <input type="checkbox" checked={linked} onChange={(e) => setLinked(e.target.checked)} />
            {t('notes.linked')}
          </label>
        </>
      )}
      <div className="flex justify-end gap-2">
        <button className="btn" onClick={onCancel}>{t('common.cancel')}</button>
        <button className="btn primary" disabled={!chosen.size} onClick={use}>{t('notes.use', { n: chosen.size })}</button>
      </div>
    </div>
  );
}
