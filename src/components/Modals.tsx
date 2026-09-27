import { useEffect, useState, type ReactNode } from 'react';
import { useStore } from '../store';
import { hasAI } from '../providers';
import { listModels, modelComparer, probeModel } from '../llm';
import { aiOf, providerLabel } from '../providers';
import { AISettings } from './AISettings';
import { designFromIdea } from '../ai';
import { applyDesign } from '../projects';
import { LANG_INFO, LANGS, type Lang } from '../i18n/langs';
import { t, useT, type MsgKey } from '../i18n';
import { VaultSettings } from './VaultSettings';

function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  return (
    <div className="modal-bg" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal">
        <div className="modal-head">
          <h2>{title}</h2>
          <button className="btn ghost" onClick={onClose}>✕</button>
        </div>
        {children}
      </div>
    </div>
  );
}

/** Idioma de la interfaz y del contenido generado (en Ajustes y en la pantalla de instalación). */
export function LanguageFields() {
  useT();
  const { settings, setSettings } = useStore();
  const langs = LANGS.map((l) => <option key={l} value={l}>{LANG_INFO[l].native}</option>);
  return (
    <>
      <div className="flex gap-2">
        <label className="field">
          <span className="field-label">🌐 {t('set.uiLang')}</span>
          <select value={settings.uiLang ?? 'es'} onChange={(e) => setSettings({ uiLang: e.target.value as Lang })}>{langs}</select>
        </label>
        <label className="field">
          <span className="field-label">{t('set.contentLang')}</span>
          <select value={settings.lang} onChange={(e) => setSettings({ lang: e.target.value as Lang })}>{langs}</select>
        </label>
      </div>
      <p className="text-xs text-muted">{t('set.contentLangHint')}</p>
    </>
  );
}

export function SettingsModal({ onClose, onSetup }: { onClose: () => void; onSetup?: () => void }) {
  useT();
  return (
    <Modal title={t('set.title')} onClose={onClose}>
      <LanguageFields />
      <AISettings />
      <VaultSettings />
      <div className="modal-foot">
        {onSetup && <button className="btn ghost" onClick={onSetup}>{t('setup.reopen')}</button>}
        <button className="btn primary" onClick={onClose}>{t('common.done')}</button>
      </div>
    </Modal>
  );
}

const IDEAS: MsgKey[] = ['design.idea1', 'design.idea2', 'design.idea3', 'design.idea4'];

export function DesignModal({ onClose, notify }: { onClose: () => void; notify: (m: string, e?: boolean) => void }) {
  useT();
  const [idea, setIdea] = useState('');
  const inEditor = useStore((s) => s.view === 'editor');
  const [keep, setKeep] = useState(inEditor);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const hasKey = useStore((s) => hasAI(s.settings));

  const run = async () => {
    setBusy(true);
    setErr('');
    try {
      const where = await applyDesign(await designFromIdea(idea, keep && inEditor));
      notify(where === 'new' ? t('design.created') : t('design.done'));
      onClose();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal title={t('design.title')} onClose={onClose}>
      <p className="text-muted">{t('design.intro')}</p>
      <textarea
        rows={7} value={idea} autoFocus
        placeholder={t('design.placeholder')}
        onChange={(e) => setIdea(e.target.value)}
      />
      <div className="chips">
        {IDEAS.map((i) => <button key={i} className="chip" onClick={() => setIdea(t(i))}>{t(i).slice(0, 42)}…</button>)}
      </div>
      {inEditor ? (
        <>
          <label className="check">
            <input type="checkbox" checked={keep} onChange={(e) => setKeep(e.target.checked)} />
            {t('design.keep')}
          </label>
          <p className="text-xs text-muted">{t('design.replaces')}</p>
        </>
      ) : (
        <p className="text-xs text-muted">{t('design.newProject')}</p>
      )}
      {!hasKey && <p className="text-[13px] whitespace-pre-wrap text-danger">{t('design.needsAI')}</p>}
      {err && <p className="text-[13px] whitespace-pre-wrap text-danger">{err}</p>}
      <div className="modal-foot">
        <button className="btn" onClick={onClose}>{t('common.cancel')}</button>
        <button className="btn ai" disabled={busy || !idea.trim() || !hasKey} onClick={run}>
          {busy ? t('design.busy') : t('design.run')}
        </button>
      </div>
    </Modal>
  );
}

export interface BusyRequest {
  model: string;
  message: string;
  resolve: (model: string | null) => void;
}

type Probe = { ok: boolean; message: string } | 'probando';

/** Se abre cuando el modelo actual falla por saturación o cuota; prueba alternativas y permite elegir. */
export function ModelBusyModal({ req, onDone }: { req: BusyRequest; onDone: () => void }) {
  useT();
  const { settings, setSettings } = useStore();
  const [models, setModels] = useState<string[]>([]);
  const [probes, setProbes] = useState<Record<string, Probe>>({});
  const [choice, setChoice] = useState('');
  const [err, setErr] = useState('');

  useEffect(() => {
    let alive = true;
    const cfg = aiOf(settings);
    Promise.all([listModels(cfg), modelComparer(cfg.provider)])
      .then(async ([list, compare]) => {
        const others = list.filter((m) => m !== req.model).sort(compare);
        if (!alive) return;
        setModels(others);
        setChoice(others[0] ?? '');
        // Probar los 8 candidatos más prometedores para mostrar cuáles responden de verdad.
        const toTest = others.slice(0, 8);
        setProbes(Object.fromEntries(toTest.map((m) => [m, 'probando' as Probe])));
        let picked = false;
        await Promise.all(toTest.map(async (m) => {
          const r = await probeModel(cfg, m);
          if (!alive) return;
          setProbes((p) => ({ ...p, [m]: r }));
          if (r.ok && !picked) {
            picked = true;
            setChoice(m);
          }
        }));
      })
      .catch((e) => setErr((e as Error).message));
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settings.provider, req.model]);

  const finish = (model: string | null, makeDefault = false) => {
    if (model && makeDefault) setSettings({ models: { ...settings.models, [aiOf(settings).provider]: model } });
    req.resolve(model);
    onDone();
  };

  const label = (m: string) => {
    const p = probes[m];
    if (!p) return m;
    if (p === 'probando') return t('busy.testing', { model: m });
    return p.ok ? `✔ ${m}` : `✖ ${m}`;
  };
  const selected = probes[choice];
  const working = Object.values(probes).filter((p) => p !== 'probando' && p.ok).length;
  const testing = Object.values(probes).some((p) => p === 'probando');

  return (
    <Modal title={t('busy.title')} onClose={() => finish(null)}>
      <p>
        <code>{req.model}</code>: {req.message}
      </p>
      <label className="field">
        <span className="field-label">
          {t('busy.other')}
          <em>{testing ? t('busy.probing') : t('busy.working', { n: working })}</em>
        </span>
        <select value={choice} onChange={(e) => setChoice(e.target.value)} disabled={!models.length}>
          {!models.length && <option>{err ? t('busy.listFailed') : t('busy.loading')}</option>}
          {models.map((m) => <option key={m} value={m}>{label(m)}</option>)}
        </select>
      </label>
      {selected && selected !== 'probando' && !selected.ok && <p className="text-[13px] whitespace-pre-wrap text-danger">{selected.message}</p>}
      {!testing && models.length > 0 && working === 0 && (
        <p className="text-[13px] whitespace-pre-wrap text-danger">
          {t('busy.none', { provider: providerLabel(aiOf(settings).provider) })}
        </p>
      )}
      {err && <p className="text-[13px] whitespace-pre-wrap text-danger">{err}</p>}
      <p className="text-xs text-muted">{t('busy.default')}</p>
      <div className="modal-foot">
        <button className="btn ghost" onClick={() => finish(null)}>{t('common.cancel')}</button>
        <button className="btn" onClick={() => finish(req.model)}>{t('busy.retry')}</button>
        <button className="btn primary" disabled={!choice} onClick={() => finish(choice, true)}>
          {choice ? t('busy.use', { model: choice }) : t('busy.useAny')}
        </button>
      </div>
    </Modal>
  );
}
