import { useEffect, useState } from 'react';
import { useStore } from '../store';
import { findWorkingModel, listModels, probeModel } from '../llm';
import { aiOf, COMPAT_PRESETS, PROVIDER_INFO, PROVIDERS, providerLabel, type Provider } from '../providers';
import { useT } from '../i18n';

/** Ajustes de IA: proveedor, su clave, su modelo (y la URL base de los compatibles con OpenAI). */
export function AISettings() {
  const t = useT();
  const settings = useStore((s) => s.settings);
  const setSettings = useStore((s) => s.setSettings);
  const cfg = aiOf(settings);
  const info = PROVIDER_INFO[cfg.provider];
  const [models, setModels] = useState<string[]>([]);
  const [status, setStatus] = useState('');

  const setKey = (v: string) => setSettings({ keys: { ...settings.keys, [cfg.provider]: v.trim() } });
  const setModel = (v: string) => setSettings({ models: { ...settings.models, [cfg.provider]: v.trim() } });

  const load = async () => {
    const c = aiOf(useStore.getState().settings);
    setStatus(t('set.loadingModels'));
    try {
      const list = await listModels(c);
      setModels(list);
      if (!c.model && list[0]) setModel(list[0]);
      // Verificar que el modelo elegido responda; si no, pasar solo a uno que funcione.
      const current = c.model || list[0];
      if (!current) return setStatus(t('set.noModels', { provider: providerLabel(c.provider) }));
      const found = await findWorkingModel({ ...c, model: current }, list, (m) => setStatus(t('set.probing', { model: m })));
      if (found.model === current) setStatus(t('set.connected', { model: current, n: list.length }));
      else if (found.model) {
        setModel(found.model);
        setStatus(t('set.switched', { model: current, reason: found.reason, next: found.model }));
      } else setStatus(t('set.noneWork', { reason: found.reason }));
    } catch (e) {
      setStatus(`✖ ${(e as Error).message}`);
    }
  };

  // Al cambiar de proveedor o completar una clave con formato válido, se carga la lista sola.
  const ready = cfg.provider === 'compat' ? /^https?:\/\/.+/.test(cfg.baseUrl) : cfg.apiKey.length >= 20;
  useEffect(() => {
    setModels([]);
    setStatus('');
    if (!ready) return;
    const t = window.setTimeout(load, 500);
    return () => window.clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cfg.provider, cfg.apiKey, cfg.baseUrl, ready]);

  return (
    <fieldset className="settings-group">
      <legend>{t('set.ai')}</legend>
      <div className="grid grid-cols-2 gap-1.5" role="radiogroup" aria-label={t('set.providers')}>
        {PROVIDERS.map((p: Provider) => (
          <button
            key={p} role="radio" aria-checked={cfg.provider === p}
            className={`provider ${cfg.provider === p ? 'on' : ''}`}
            onClick={() => setSettings({ provider: p })}
          >
            {providerLabel(p)}
            {settings.keys?.[p] && <span className="text-xs text-muted">{t('set.keySaved')}</span>}
          </button>
        ))}
      </div>

      {cfg.provider === 'compat' && (
        <label className="field">
          <span className="field-label">{t('set.baseUrl')}</span>
          <div className="flex gap-2">
            <input value={cfg.baseUrl} spellCheck={false} placeholder="https://openrouter.ai/api/v1" onChange={(e) => setSettings({ baseUrl: e.target.value.trim() })} />
            <select value="" onChange={(e) => e.target.value && setSettings({ baseUrl: e.target.value })} aria-label={t('set.presetsAria')}>
              <option value="">{t('set.presets')}</option>
              {COMPAT_PRESETS.map((x) => <option key={x.url} value={x.url}>{x.label}</option>)}
            </select>
          </div>
        </label>
      )}

      <label className="field">
        <span className="field-label">{t('set.key', { provider: providerLabel(cfg.provider) })}
          {info.keyUrl && <em><a href={info.keyUrl} target="_blank" rel="noreferrer">{t('set.getKey')}</a></em>}
        </span>
        <input type="password" value={cfg.apiKey} placeholder={cfg.provider === 'compat' ? t('set.compatKeyPh') : info.keyPlaceholder} onChange={(e) => setKey(e.target.value)} />
      </label>
      <p className="text-xs text-muted">
        {t('set.keyWhere', { host: cfg.provider === 'compat' ? t('set.keyWhereCompat') : info.host })}
      </p>

      <label className="field">
        <span className="field-label">{t('set.model')}</span>
        <div className="flex gap-2">
          {models.length ? (
            <select value={cfg.model} onChange={(e) => setModel(e.target.value)}>
              {!models.includes(cfg.model) && <option value={cfg.model}>{cfg.model ? t('set.unavailable', { model: cfg.model }) : t('set.pickModel')}</option>}
              {models.map((m) => <option key={m} value={m}>{m}</option>)}
            </select>
          ) : (
            <input value={cfg.model} placeholder={info.defaultModel || t('set.modelPh')} onChange={(e) => setModel(e.target.value)} />
          )}
          <button className="btn" onClick={load} disabled={!ready}>{models.length ? t('set.reload') : t('set.list')}</button>
        </div>
      </label>
      {status && <p className={status.startsWith('✖') ? 'text-[13px] whitespace-pre-wrap text-danger' : 'text-xs text-muted'}>{status}</p>}
      <div className="flex gap-2">
        <button
          className="btn" disabled={!ready || !cfg.model}
          onClick={async () => {
            setStatus(t('set.probing', { model: cfg.model }));
            const r = await probeModel(aiOf(useStore.getState().settings));
            setStatus(r.ok ? t('set.works', { model: cfg.model }) : t('set.fails', { model: cfg.model, msg: r.message }));
          }}
        >{t('set.probe')}</button>
      </div>
    </fieldset>
  );
}
