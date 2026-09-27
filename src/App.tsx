import { lazy, Suspense, useCallback, useEffect, useRef, useState } from 'react';
import { useStore } from './store';
import { Dashboard, type StartMode } from './components/Dashboard';
import type { EditorModal } from './components/Editor';
import { DesignModal, ModelBusyModal, SettingsModal, type BusyRequest } from './components/Modals';
import { setAutoSwitchHandler, setBusyHandler, setWaitHandler } from './llm';
import { aiOf, hasAI, migrateSettings } from './providers';
import { setCompatProxy } from './providers/openai';
import { initStorage, storage } from './storage';
import { createProject, readDesignFile } from './projects';
import type { Settings } from './types';
import { setUILang, t, useT } from './i18n';
import { detectLang } from './i18n/langs';
import { serverAvailable } from './vaultDir';
import { syncAllProjects, syncOpenProject } from './vaultAuto';

/*
 * Carga diferida: el editor (React Flow) y los modales menos usados van en chunks aparte y no frenan el arranque.
 * Ajustes queda en el bundle inicial: sin API key se abre al arrancar y tiene que aparecer junto con el dashboard.
 */
const loadEditor = () => import('./components/Editor');
const Editor = lazy(() => loadEditor().then((m) => ({ default: m.Editor })));
const PlanModal = lazy(() => import('./components/PlanModal').then((m) => ({ default: m.PlanModal })));
const TemplatesModal = lazy(() => import('./components/TemplatesModal').then((m) => ({ default: m.TemplatesModal })));
const ImportRepoModal = lazy(() => import('./components/ImportRepoModal').then((m) => ({ default: m.ImportRepoModal })));
const ObsidianModal = lazy(() => import('./components/ObsidianModal').then((m) => ({ default: m.ObsidianModal })));
const Setup = lazy(() => import('./components/Setup').then((m) => ({ default: m.Setup })));

/** Ajustes que se guardan en el JSON (la API key incluida: el archivo vive fuera de los repos). */
const SETTINGS_KEYS: (keyof Settings)[] = ['provider', 'keys', 'models', 'baseUrl', 'lang', 'uiLang', 'targets', 'vaultFolder', 'vaultPath', 'setupDone'];

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
      // Quien ya tenía la IA configurada (versiones anteriores) no necesita la pantalla de instalación.
      const setupDone = s.setupDone || hasAI({ ...s } as Settings);
      useStore.getState().setSettings({ ...s, uiLang: lang, lang: s.lang ?? lang, setupDone });
      await setUILang(lang);
      if (!alive) return;
      setCompatProxy(() => backend.kind === 'file');
      useStore.getState().setView(setupDone ? 'dashboard' : 'setup');
      setReady(true);
      // Con el dashboard ya visible, se precarga el editor para que abrir un proyecto sea inmediato.
      loadEditor().catch(() => {});
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

  /* ---------- Obsidian: las notas nuevas se guardan solas en el vault vinculado ---------- */
  const vaultPath = useStore((s) => s.settings.vaultPath?.trim() ?? '');
  useEffect(() => {
    if (!ready) return;
    const saved = (n: number) => n && notify(t('obs.autoSaved', { n }));
    const failed = (e: unknown) => notify(t('obs.autoFailed', { msg: (e as Error).message }), true);
    // Al vincular (o al arrancar con el vault ya vinculado): lo que falte de todos los proyectos.
    // La espera deja terminar de escribir la ruta en Ajustes.
    const all = vaultPath && serverAvailable() ? window.setTimeout(() => syncAllProjects(vaultPath).then(saved, failed), 1500) : undefined;
    // Después, cada pieza nueva del proyecto abierto, cuando se deja de editar un momento.
    let timer: number | undefined;
    const unsub = useStore.subscribe((s, prev) => {
      if (!vaultPath || s.view !== 'editor' || s.contentVersion === prev.contentVersion) return;
      window.clearTimeout(timer);
      timer = window.setTimeout(() => syncOpenProject().then(saved, failed), 4000);
    });
    return () => {
      window.clearTimeout(all);
      window.clearTimeout(timer);
      unsub();
    };
  }, [ready, vaultPath, notify]);

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
      {view === 'setup' ? (
        <Suspense fallback={<div className="boot">{t('app.loading')}</div>}>
          <Setup onDone={() => useStore.getState().setView('dashboard')} />
        </Suspense>
      ) : view === 'dashboard'
        ? <Dashboard onStart={start} onSettings={() => setModal('settings')} notify={notify} />
        : (
          <Suspense fallback={<div className="boot">{t('app.loading')}</div>}>
            <Editor openModal={setModal} notify={notify} />
          </Suspense>
        )}

      <input ref={jsonRef} type="file" accept=".json" hidden onChange={(e) => {
        if (e.target.files?.[0]) openJson(e.target.files[0]);
        e.target.value = '';
      }} />

      <Suspense fallback={null}>
        {modal === 'settings' && (
          <SettingsModal onClose={() => setModal(null)} onSetup={() => { setModal(null); useStore.getState().setView('setup'); }} />
        )}
        {modal === 'design' && <DesignModal onClose={() => setModal(null)} notify={notify} />}
        {modal === 'plan' && <PlanModal onClose={() => setModal(null)} notify={notify} />}
        {modal === 'templates' && <TemplatesModal onClose={() => setModal(null)} notify={notify} />}
        {modal === 'import' && <ImportRepoModal onClose={() => setModal(null)} notify={notify} allowReplace={view === 'editor'} />}
        {(modal === 'obsidian' || modal === 'obsidianSend') && (
          <ObsidianModal onClose={() => setModal(null)} notify={notify} onSettings={() => setModal('settings')} start={modal === 'obsidianSend' ? 'send' : 'home'} />
        )}
        {busyReq && <ModelBusyModal req={busyReq} onDone={() => setBusyReq(null)} />}
      </Suspense>
      {waitUntil && waitSecs > 0 && (
        <div className="wait-banner">{t('app.rateWait', { model: waitUntil.model, s: waitSecs })}</div>
      )}
      {toast && <div className={`toast ${toast.error ? 'error' : ''}`}>{toast.msg}</div>}
    </>
  );
}
