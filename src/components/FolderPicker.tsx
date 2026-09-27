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
    <div className="modal-bg picker-bg" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal folder-picker" role="dialog" aria-label={t('folder.title')}>
        <div className="modal-head">
          <h2>📁 {t('folder.title')}</h2>
          <button className="btn ghost" onClick={onClose} aria-label={t('common.close')}>✕</button>
        </div>
        {list && (
          <>
            <div className="row wrap">
              <button className="btn small" disabled={!list.parent} onClick={() => list.parent && go(list.parent)}>{t('folder.up')}</button>
              <button className="btn small" onClick={() => go(list.home)}>🏠 {t('folder.home')}</button>
              {list.drives.map((d) => <button key={d} className="btn small" onClick={() => go(d)}>{d}</button>)}
            </div>
            <code className="vault-path">{list.path}{list.isVault && <span className="vault-badge"> ◆ {t('folder.isVault')}</span>}</code>
            <ul className="folder-list">
              {list.folders.length === 0 && <li className="muted small">{t('folder.empty')}</li>}
              {list.folders.map((f) => (
                <li key={f.name}>
                  <button className="folder-row" onClick={() => go(child(f.name))}>
                    📁 {f.name}
                    {f.isVault && <span className="vault-badge">◆ {t('folder.isVault')}</span>}
                  </button>
                </li>
              ))}
            </ul>
          </>
        )}
        {!list && !error && <p className="muted">{t('folder.loading')}</p>}
        {error && <p className="error">{error}</p>}
        <div className="modal-foot">
          <button className="btn" onClick={onClose}>{t('common.cancel')}</button>
          <button className="btn primary" disabled={!list} onClick={() => list && onPick(list.path)}>{t('folder.use')}</button>
        </div>
      </div>
    </div>
  );
}
