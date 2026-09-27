import { useEffect, useState } from 'react';
import { listFolders, type FolderList } from '../vaultServer';
import { useT } from '../i18n';

/**
 * Explorador de carpetas del equipo (a través del servidor local) para elegir el vault sin escribir la ruta.
 * Muestra solo carpetas y marca las que son vaults de Obsidian.
 */
export function FolderPicker({ start, onPick, onClose }: { start?: string; onPick: (path: string) => void; onClose: () => void }) {
  const t = useT();
  const [list, setList] = useState<FolderList | null>(null);
  const [error, setError] = useState('');

  const go = (path: string) => {
    setError('');
    listFolders(path).then(setList).catch((e) => {
      setError((e as Error).message);
      // Si la carpeta inicial ya no existe, se abre la carpeta personal.
      if (!list) listFolders('').then(setList).catch(() => undefined);
    });
  };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => go(start ?? ''), []);
  useEffect(() => {
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', esc);
    return () => window.removeEventListener('keydown', esc);
  }, [onClose]);

  const sep = list?.path.includes('\\') ? '\\' : '/';
  const child = (name: string) => (list!.path.endsWith(sep) ? list!.path + name : `${list!.path}${sep}${name}`);

  return (
    <div className="modal-bg z-70" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal w-[min(620px,calc(100vw-32px))]" role="dialog" aria-label={t('folder.title')}>
        <div className="modal-head">
          <h2>📁 {t('folder.title')}</h2>
          <button className="btn ghost" onClick={onClose} aria-label={t('common.close')}>✕</button>
        </div>
        {list && (
          <>
            <div className="flex flex-wrap items-center gap-2">
              <button className="btn small" disabled={!list.parent} onClick={() => list.parent && go(list.parent)}>{t('folder.up')}</button>
              <button className="btn small" onClick={() => go(list.home)}>🏠 {t('folder.home')}</button>
              {list.drives.map((d) => <button key={d} className="btn small" onClick={() => go(d)}>{d}</button>)}
            </div>
            <code className="wrap-anywhere">{list.path}{list.isVault && <span className="ml-auto text-xs text-ai"> ◆ {t('folder.isVault')}</span>}</code>
            <ul className="m-0 max-h-[45vh] list-none overflow-auto rounded-lg border border-line p-0">
              {list.folders.length === 0 && <li className="text-xs text-muted">{t('folder.empty')}</li>}
              {list.folders.map((f) => (
                <li key={f.name}>
                  <button className="flex w-full items-center gap-2 border-b border-line px-2.5 py-[7px] text-left text-fg hover:bg-panel2" onClick={() => go(child(f.name))}>
                    📁 {f.name}
                    {f.isVault && <span className="ml-auto text-xs text-ai">◆ {t('folder.isVault')}</span>}
                  </button>
                </li>
              ))}
            </ul>
          </>
        )}
        {!list && !error && <p className="text-muted">{t('folder.loading')}</p>}
        {error && <p className="text-[13px] whitespace-pre-wrap text-danger">{error}</p>}
        <div className="modal-foot">
          <button className="btn" onClick={onClose}>{t('common.cancel')}</button>
          <button className="btn primary" disabled={!list} onClick={() => list && onPick(list.path)}>{t('folder.use')}</button>
        </div>
      </div>
    </div>
  );
}
