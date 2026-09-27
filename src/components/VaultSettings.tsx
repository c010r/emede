import { useEffect, useState } from 'react';
import { useStore } from '../store';
import { checkVault, knownVaults, type KnownVault, type VaultInfo } from '../vaultServer';
import { serverAvailable } from '../vaultDir';
import { DEFAULT_VAULT_FOLDER } from '../obsidian';
import { useT } from '../i18n';
import { FolderPicker } from './FolderPicker';

/** Misma carpeta aunque cambien mayúsculas o la barra final (Windows no distingue mayúsculas). */
const same = (a: string, b: string) => {
  const n = (p: string) => p.trim().replace(/[\\/]+$/, '').toLowerCase();
  return n(a) === n(b);
};

/**
 * Ajustes de Obsidian: el vault (uno de los que Obsidian ya conoce en el equipo, o elegido navegando las carpetas;
 * escribir la ruta queda como opción) y la carpeta de los espejos dentro de él.
 */
export function VaultSettings() {
  const t = useT();
  const path = useStore((s) => s.settings.vaultPath ?? '');
  const folder = useStore((s) => s.settings.vaultFolder ?? '');
  const set = useStore((s) => s.setSettings);
  const [info, setInfo] = useState<VaultInfo | null>(null);
  const [error, setError] = useState('');
  const [known, setKnown] = useState<KnownVault[]>([]);
  const [picking, setPicking] = useState(false);
  const [typing, setTyping] = useState(false);
  const server = serverAvailable();

  useEffect(() => {
    if (server) knownVaults().then(setKnown).catch(() => undefined);
  }, [server]);

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
          <span className="field-label">{t('set.vaultPath')}</span>
          {known.length > 0 ? (
            <div className="vault-list" role="radiogroup" aria-label={t('set.vaultKnown')}>
              <p className="muted small">{t('set.vaultKnown')}</p>
              {known.map((v) => (
                <button
                  key={v.path} role="radio" aria-checked={same(v.path, path)} disabled={!v.exists}
                  className={`provider vault-option ${same(v.path, path) ? 'on' : ''}`} onClick={() => set({ vaultPath: v.path })}
                >
                  <b>{v.name}</b>
                  <span className="muted small">{v.exists ? v.path : t('set.vaultGone', { path: v.path })}</span>
                </button>
              ))}
            </div>
          ) : (
            <p className="muted small">{t('set.vaultNoKnown')}</p>
          )}
          <div className="row wrap">
            <button className="btn" onClick={() => setPicking(true)}>📁 {known.length ? t('set.vaultPickOther') : t('set.vaultPick')}</button>
            <button className="btn ghost small" onClick={() => setTyping((v) => !v)} aria-expanded={typing}>{t('set.vaultType')}</button>
          </div>
          {typing && (
            <input
              value={path} spellCheck={false} aria-label={t('set.vaultPath')} placeholder="C:\Users\vos\Documentos\MiVault  ·  ~/Obsidian/MiVault"
              onChange={(e) => set({ vaultPath: e.target.value })}
            />
          )}
          {path.trim() && !typing && !known.some((v) => same(v.path, path)) && <code className="vault-path">{path}</code>}
          {info && (
            <p className={`small ${info.exists ? (info.isVault ? 'ok-text' : 'muted') : 'error'}`}>
              {!info.exists ? t('set.vaultMissing', { path: info.path })
                : info.isVault ? t('set.vaultOk', { path: info.path })
                : t('set.vaultNoObsidian')}
            </p>
          )}
          {error && <p className="error">{error}</p>}
          {picking && (
            <FolderPicker
              start={path.trim() || undefined}
              onClose={() => setPicking(false)}
              onPick={(p) => {
                set({ vaultPath: p });
                setPicking(false);
              }}
            />
          )}
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
