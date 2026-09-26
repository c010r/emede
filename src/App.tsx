import { useCallback, useEffect, useRef, useState } from 'react';
import { useStore } from './store';
import { Dashboard, type StartMode } from './components/Dashboard';
import { Editor, type EditorModal } from './components/Editor';
import { DesignModal, ModelBusyModal, SettingsModal, type BusyRequest } from './components/Modals';
import { PlanModal } from './components/PlanModal';
import { TemplatesModal } from './components/TemplatesModal';
import { ImportRepoModal } from './components/ImportRepoModal';
import { ObsidianModal } from './components/ObsidianModal';
import { setAutoSwitchHandler, setBusyHandler, setWaitHandler } from './llm';
import { aiOf, hasAI, migrateSettings } from './providers';
import { setCompatProxy } from './providers/openai';
import { initStorage, storage } from './storage';
import { createProject, readDesignFile } from './projects';
import type { Settings } from './types';
import { setUILang, t, useT } from './i18n';
import { detectLang } from './i18n/langs';

/** Ajustes que se guardan en el JSON (la API key incluida: el archivo vive fuera de los repos). */
const SETTINGS_KEYS: (keyof Settings)[] = ['provider', 'keys', 'models', 'baseUrl', 'lang', 'uiLang', 'targets', 'vaultFolder', 'vaultPath'];

export default function App() {
  useT();
  const view = useStore((s) => s.view);
  const [ready, setReady] = useState(false);
  const [bootError, setBootError] = useState('');
  const [modal, setModal] = useState<EditorModal | null>(null);
  const [toast, setToast] = useState<{ msg: string; error?: boolean } | null>(null);
  const [busyReq, setBusyReq] = useState<BusyRequest | null>(null);
  const [waitUntil, setWaitUntil] = useState<{ model: string; until: number } | null>(null);
  const [, tick] = useState(0);
  const timer = useRef<number>(undefined);
  const jsonRef = useRef<HTMLInputElement>(null);

  const notify = useCallback((msg: string, error = false) => {
    setToast({ msg, error });
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setToast(null), error ? 8000 : 3500);
  }, []);

  /* ---------- arranque: JSON de datos + ajustes; siempre se empieza en el dashboard ---------- */
  useEffect(() => {
    let alive = true;
    (async () => {
      const backend = await initStorage();
      const saved = await backend.getSettings().catch(() => ({}));
      if (!alive) return;
      const s = migrateSettings(saved);
      // Primera vez: interfaz y contenido en el idioma del navegador.
      const lang = s.uiLang ?? detectLang();
      useStore.getState().setSettings({ ...s, uiLang: lang, lang: s.lang ?? lang });
      await setUILang(lang);
      if (!alive) return;
      setCompatProxy(() => backend.kind === 'file');
      useStore.getState().setView('dashboard');
      setReady(true);
      if (!hasAI(useStore.getState().settings)) setModal('settings');
    })().catch((e) => setBootError((e as Error).message));
    return () => {
      alive = false;
    };
  }, []);

  /* ---------- idioma de la interfaz ---------- */
  const uiLangSetting = useStore((s) => s.settings.uiLang);
  useEffect(() => {
    if (ready && uiLangSetting) setUILang(uiLangSetting).catch((e) => notify((e as Error).message, true));
  }, [ready, uiLangSetting, notify]);

  /* ---------- los ajustes se guardan en el JSON cuando cambian ---------- */
  useEffect(() => {
    if (!ready) return;
    let timer: number | undefined;
    const unsub = useStore.subscribe((s, prev) => {
      if (s.settings === prev.settings) return;
      window.clearTimeout(timer);
      timer = window.setTimeout(() => {
        const pick = Object.fromEntries(SETTINGS_KEYS.map((k) => [k, s.settings[k]]));
        storage().putSettings(pick).catch((e) => notify(t('app.settingsSaveFailed', { msg: (e as Error).message }), true));
      }, 500);
    });
    return () => {
      unsub();
      window.clearTimeout(timer);
    };
  }, [ready, notify]);

  /* ---------- IA: modelo saturado, cambio automático y espera por límite ---------- */
  useEffect(() => {
    setBusyHandler((model, message) => new Promise((resolve) => setBusyReq({ model, message, resolve })));
    setAutoSwitchHandler((from, to) => {
      const s = useStore.getState().settings;
      useStore.getState().setSettings({ models: { ...s.models, [aiOf(s).provider]: to } });
      notify(t('app.modelSwitched', { from, to }));
    });
    setWaitHandler((model, ms) => setWaitUntil({ model, until: Date.now() + ms }));
    return () => {
      setBusyHandler(null);
      setAutoSwitchHandler(null);
      setWaitHandler(null);
    };
  }, [notify]);

  useEffect(() => {
    if (!waitUntil) return;
    const id = window.setInterval(() => (Date.now() >= waitUntil.until ? setWaitUntil(null) : tick((n) => n + 1)), 500);
    return () => window.clearInterval(id);
  }, [waitUntil]);

  /* ---------- acciones del dashboard ---------- */
  const start = async (mode: StartMode) => {
    try {
      // Con IA o desde un plan, el proyecto se crea recién cuando hay resultado (cancelar no deja proyectos vacíos).
      if (mode === 'ai') return setModal('design');
      if (mode === 'plan') return setModal('plan');
      if (mode === 'repo') return setModal('import');
      if (mode === 'json') return jsonRef.current?.click();
      await createProject();
      if (mode === 'templates') setModal('templates');
    } catch (e) {
      notify((e as Error).message, true);
    }
  };

  const openJson = async (file: File) => {
    try {
      const { graph, warning } = await readDesignFile(file);
      await createProject(graph);
      notify(`${t('app.openedJson', { file: file.name })}${warning}`, !!warning);
    } catch (e) {
      notify((e as Error).message, true);
    }
  };

  if (bootError) return <div className="boot error">{t('app.bootError', { msg: bootError })}</div>;
  if (!ready) return <div className="boot">{t('app.loading')}</div>;

  const waitSecs = waitUntil ? Math.max(0, Math.ceil((waitUntil.until - Date.now()) / 1000)) : 0;

  return (
    <>
      {view === 'dashboard'
        ? <Dashboard onStart={start} onSettings={() => setModal('settings')} notify={notify} />
        : <Editor openModal={setModal} notify={notify} />}

      <input ref={jsonRef} type="file" accept=".json" hidden onChange={(e) => {
        if (e.target.files?.[0]) openJson(e.target.files[0]);
        e.target.value = '';
      }} />

      {modal === 'settings' && <SettingsModal onClose={() => setModal(null)} />}
      {modal === 'design' && <DesignModal onClose={() => setModal(null)} notify={notify} />}
      {modal === 'plan' && <PlanModal onClose={() => setModal(null)} notify={notify} />}
      {modal === 'templates' && <TemplatesModal onClose={() => setModal(null)} notify={notify} />}
      {modal === 'import' && <ImportRepoModal onClose={() => setModal(null)} notify={notify} allowReplace={view === 'editor'} />}
      {modal === 'obsidian' && <ObsidianModal onClose={() => setModal(null)} notify={notify} onSettings={() => setModal('settings')} />}
      {busyReq && <ModelBusyModal req={busyReq} onDone={() => setBusyReq(null)} />}
      {waitUntil && waitSecs > 0 && (
        <div className="wait-banner">{t('app.rateWait', { model: waitUntil.model, s: waitSecs })}</div>
      )}
      {toast && <div className={`toast ${toast.error ? 'error' : ''}`}>{toast.msg}</div>}
    </>
  );
}
