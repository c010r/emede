import { useEffect, useState } from 'react';
import { useStore } from '../store';
import { checkVault, type VaultInfo } from '../vaultServer';
import { serverAvailable } from '../vaultDir';
import { DEFAULT_VAULT_FOLDER } from '../obsidian';
import { useT } from '../i18n';

/** Ajustes de Obsidian: ruta del vault en el disco y carpeta de los espejos dentro de él. */
export function VaultSettings() {
  const t = useT();
  const path = useStore((s) => s.settings.vaultPath ?? '');
  const folder = useStore((s) => s.settings.vaultFolder ?? '');
  const set = useStore((s) => s.setSettings);
  const [info, setInfo] = useState<VaultInfo | null>(null);
  const [error, setError] = useState('');
  const server = serverAvailable();

  useEffect(() => {
    setInfo(null);
    setError('');
    if (!server || !path.trim()) return;
    const t = window.setTimeout(() => {
      checkVault(path.trim()).then(setInfo).catch((e) => setError((e as Error).message));
    }, 400);
    return () => window.clearTimeout(t);
  }, [path, server]);

  return (
    <fieldset className="settings-group">
      <legend>{t('set.obsidian')}</legend>
      {server ? (
        <>
          <label className="field">
            <span className="field-label">{t('set.vaultPath')}</span>
            <input
              value={path} spellCheck={false} placeholder="C:\Users\vos\Documentos\MiVault  ·  ~/Obsidian/MiVault"
              onChange={(e) => set({ vaultPath: e.target.value })}
            />
          </label>
          {info && (
            <p className={`small ${info.exists ? (info.isVault ? 'ok-text' : 'muted') : 'error'}`}>
              {!info.exists ? t('set.vaultMissing', { path: info.path })
                : info.isVault ? t('set.vaultOk', { path: info.path })
                : t('set.vaultNoObsidian')}
            </p>
          )}
          {error && <p className="error">{error}</p>}
        </>
      ) : (
        <p className="muted small">{t('set.vaultNoServer')}</p>
      )}
      <label className="field">
        <span className="field-label">{t('set.vaultFolder')}</span>
        <input value={folder} placeholder={DEFAULT_VAULT_FOLDER} onChange={(e) => set({ vaultFolder: e.target.value })} />
      </label>
      <p className="muted small">{t('set.vaultFolderHint', { path: (folder || DEFAULT_VAULT_FOLDER).replace(/^\/+|\/+$/g, '') })}</p>
    </fieldset>
  );
}
