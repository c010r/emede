import { useEffect, useMemo, useRef, useState } from 'react';
import {
  addEdge, applyEdgeChanges, applyNodeChanges, Background, Controls, MiniMap, Panel, ReactFlow, type Connection, type Edge,
} from '@xyflow/react';
import { useShallow } from 'zustand/react/shallow';
import { setFlowOps, useStore } from '../store';
import { hasAI } from '../providers';
import { t, useI18n } from '../i18n';
import { NodeCard } from './NodeCard';
import { Inspector } from './Inspector';
import { FilesPanel } from './FilesPanel';
import { ProblemsPanel } from './ProblemsPanel';
import { QuestionsModal } from './QuestionsModal';
import { CanvasHelp } from './CanvasHelp';
import { ObsidianChip } from './ObsidianChip';
import { repairAll, requestRepair, useRepair } from '../repair';
import { KIND_META } from '../defaults';
import { writeAll } from '../ai';
import { useOutput } from '../output';
import { validate, type Issue, type Level } from '../validate';
import { IssuesContext } from '../issuesContext';
import { closeProject, downloadDesign, readDesignFile, saveCurrent } from '../projects';
import { canUseFolders } from '../fs';
import { TARGETS, type NodeKind, type Target } from '../types';
import { Logo } from './Logo';
import { useEffectiveTheme } from '../theme';

// El store aplica los cambios del lienzo con estas funciones (ver setFlowOps en store.ts).
setFlowOps({ addEdge, applyEdgeChanges, applyNodeChanges });

const nodeTypes = { card: NodeCard };

type Tab = 'inspector' | 'problems' | 'files';
export type EditorModal = 'settings' | 'design' | 'plan' | 'templates' | 'import' | 'obsidian' | 'obsidianSend';

const isTyping = (e: KeyboardEvent) => {
  const t = e.target as HTMLElement;
  return t.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(t.tagName);
};

export function Editor({ openModal, notify }: { openModal: (m: EditorModal) => void; notify: (m: string, e?: boolean) => void }) {
  const { nodes, edges, selectedId, settings, canUndo, canRedo, contentVersion, overrides, excluded } = useStore(
    useShallow((s) => ({
      nodes: s.nodes, edges: s.edges, selectedId: s.selectedId, settings: s.settings,
      canUndo: s.past.length > 0, canRedo: s.future.length > 0, contentVersion: s.contentVersion,
      overrides: s.fileOverrides, excluded: s.excluded,
    })),
  );
  const lang = useI18n((s) => s.lang);
  const theme = useEffectiveTheme();
  const actions = useStore.getState();
  const [tab, setTab] = useState<Tab>('inspector');
  const [progress, setProgress] = useState('');
  const [saved, setSaved] = useState<'saved' | 'saving' | 'error'>('saved');
  const repairRequested = useRepair((s) => s.requested);
  const repairing = useRepair((s) => s.running);
  const showQuestions = useRepair((s) => s.showQuestions && s.questions.length > 0);
  const jsonRef = useRef<HTMLInputElement>(null);
  // Estado al abrir el proyecto: si nada cambió no se guarda (así abrir no altera la fecha de última edición).
  // Se compara contra el estado y no con un flag de "primera vez" porque React en desarrollo ejecuta los efectos dos veces.
  const opened = useRef({ contentVersion, overrides, excluded });
  /** Hay un cambio esperando el guardado automático. */
  const pending = useRef(false);

  /* ---------- guardado automático en el JSON ---------- */
  useEffect(() => {
    const o = opened.current;
    if (contentVersion === o.contentVersion && overrides === o.overrides && excluded === o.excluded) return;
    setSaved('saving');
    pending.current = true;
    const id = window.setTimeout(() => {
      pending.current = false;
      saveCurrent().then(() => setSaved('saved')).catch((e) => {
        setSaved('error');
        notify(t('ed.saveFailed', { msg: (e as Error).message }), true);
      });
    }, 800);
    return () => window.clearTimeout(id);
  }, [contentVersion, overrides, excluded, notify]);

  // Si se cierra o recarga la pestaña con un cambio todavía sin guardar, se guarda en el momento.
  useEffect(() => {
    const flush = () => {
      if (!pending.current) return;
      pending.current = false;
      void saveCurrent({ keepalive: true }).catch(() => undefined);
    };
    window.addEventListener('pagehide', flush);
    return () => {
      window.removeEventListener('pagehide', flush);
      flush(); // también al salir del editor (← Proyectos)
    };
  }, []);

  /* ---------- reparación automática después de generar, importar o completar con IA ---------- */
  useEffect(() => {
    if (!repairRequested) return;
    repairAll({ fresh: true })
      .then(() => {
        const { report, questions } = useRepair.getState();
        if (!questions.length && report) notify(report);
      })
      .catch((e) => notify(t('ed.repairFailed', { msg: (e as Error).message }), true));
  }, [repairRequested, notify]);

  /* ---------- deshacer / rehacer ---------- */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey) || isTyping(e)) return;
      const k = e.key.toLowerCase();
      if (k === 'z' && !e.shiftKey) useStore.getState().undo();
      else if ((k === 'z' && e.shiftKey) || k === 'y') useStore.getState().redo();
      else return;
      e.preventDefault();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  /* ---------- archivos y problemas ---------- */
  const files = useOutput();
  const issues = useMemo(
    () => validate(useStore.getState(), settings, files),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [contentVersion, settings.targets, files, lang],
  );
  const issueMap = useMemo(() => {
    const m = new Map<string, Level>();
    for (const i of issues) if (i.nodeId && i.level !== 'info' && m.get(i.nodeId) !== 'error') m.set(i.nodeId, i.level);
    return m;
  }, [issues]);
  const worst = issues.find((i) => i.level === 'error') ? 'error' : issues.find((i) => i.level === 'warn') ? 'warn' : '';

  const pickIssue = (i: Issue) => {
    if (i.nodeId) {
      actions.select(i.nodeId);
      setTab('inspector');
    } else if (i.path) setTab('files');
  };

  const toggleTarget = (t: Target) =>
    actions.setSettings({ targets: settings.targets.includes(t) ? settings.targets.filter((x) => x !== t) : [...settings.targets, t] });

  const fillAll = async () => {
    if (!hasAI(settings)) return openModal('settings');
    setProgress('0');
    try {
      await writeAll(false, (d, t) => setProgress(`${d}/${t}`));
      notify(t('ed.filled'));
      requestRepair();
    } catch (e) {
      notify((e as Error).message, true);
    } finally {
      setProgress('');
    }
  };

  const importJson = async (file: File) => {
    try {
      const { graph, warning } = await readDesignFile(file);
      actions.setGraph(graph);
      requestRepair();
      notify(`${t('ed.imported')}${warning}`, !!warning);
    } catch (e) {
      notify((e as Error).message, true);
    }
  };

  const add = (k: NodeKind) => {
    actions.addNode(k);
    setTab('inspector');
  };

  const name = nodes.find((n) => n.id === 'project')?.data.d.name ?? '';

  return (
    <IssuesContext.Provider value={issueMap}>
      <div className="grid h-full grid-cols-[200px_1fr_460px] grid-rows-[52px_1fr] [grid-template-areas:'top_top_top'_'left_canvas_right'] max-[1100px]:grid-cols-[170px_1fr] max-[1100px]:grid-rows-[52px_1fr_45vh] max-[1100px]:[grid-template-areas:'top_top'_'left_canvas'_'right_right']">
        <header className="[grid-area:top] flex min-w-0 items-center gap-2 border-b border-line bg-panel px-3.5 [&_.btn]:shrink-0">
          <button className="btn ghost" onClick={() => closeProject().catch((e) => notify((e as Error).message, true))} title={t('ed.backTitle')}>
            {t('ed.back')}
          </button>
          <Logo size={22} small />
          <span className="project-title max-w-[220px] min-w-0 shrink truncate font-semibold" title={name}>{name}</span>
          {repairing && <span className="text-xs text-accent" title={t('ed.repairingTitle')}>{t('ed.repairing')}</span>}
          <span className={`text-xs ${saved === 'saving' ? 'text-accent' : saved === 'error' ? 'text-danger' : 'text-muted'}`}>{saved === 'saving' ? t('ed.saving') : saved === 'error' ? t('ed.unsaved') : t('ed.saved')}</span>
          <ObsidianChip openModal={openModal} />
          <div className="flex gap-0.5">
            <button className="btn ghost" onClick={actions.undo} disabled={!canUndo} title={t('ed.undo')}>↶</button>
            <button className="btn ghost" onClick={actions.redo} disabled={!canRedo} title={t('ed.redo')}>↷</button>
          </div>
          <div className="flex-1" />
          <button className="btn ai" onClick={() => openModal('design')}>{t('ed.design')}</button>
          <button className="btn" onClick={() => openModal('plan')} title={t('ed.planTitle')}>📄<span className="max-[1480px]:hidden"> {t('ed.plan')}</span></button>
          <button className="btn" onClick={fillAll} disabled={!!progress} title={t('ed.fillTitle')}>
            {progress ? t('ed.filling', { p: progress }) : <>✎<span className="max-[1480px]:hidden"> {t('ed.fill')}</span></>}
          </button>
          <button className="btn" onClick={() => openModal('templates')} title={t('ed.templates')}>📚<span className="max-[1480px]:hidden"> {t('ed.templates')}</span></button>
          {canUseFolders() && <button className="btn" onClick={() => openModal('obsidian')} title={t('ed.obsidianTitle')}>📓<span className="max-[1480px]:hidden"> Obsidian</span></button>}
          {canUseFolders() && <button className="btn" onClick={() => openModal('import')} title={t('ed.importTitle')}>📥<span className="max-[1480px]:hidden"> {t('ed.import')}</span></button>}
          <button className="btn ghost" onClick={() => downloadDesign({ nodes, edges })} title={t('ed.downloadTitle')}>⬇<span className="max-[1480px]:hidden"> .json</span></button>
          <button className="btn ghost" onClick={() => jsonRef.current?.click()} title={t('ed.uploadTitle')}>⬆<span className="max-[1480px]:hidden"> .json</span></button>
          <input ref={jsonRef} type="file" accept=".json" hidden onChange={(e) => {
            if (e.target.files?.[0]) importJson(e.target.files[0]);
            e.target.value = '';
          }} />
          <button className="btn ghost" onClick={() => openModal('settings')}>⚙{!hasAI(settings) && <span className="absolute top-[5px] right-1 size-[7px] rounded-full bg-danger" />}</button>
        </header>

        <aside className="[grid-area:left] flex flex-col gap-1.5 overflow-auto border-r border-line bg-panel p-3 [&_h3]:mt-2.5 [&_h3]:mb-0.5 [&_h3]:text-[11px] [&_h3]:font-bold [&_h3]:tracking-[1px] [&_h3]:text-muted [&_h3]:uppercase">
          <h3>{t('ed.add')}</h3>
          {(['agent', 'skill', 'command', 'rule', 'mcp', 'hook'] as NodeKind[]).map((k) => (
            <button key={k} className="palette flex items-center gap-2 truncate rounded-lg border border-l-[3px] border-line border-l-(--c) bg-panel2 px-2.5 py-2 text-left text-fg hover:border-(--c)" style={{ ['--c' as string]: KIND_META[k].color }} onClick={() => add(k)}>
              <span className="w-3.5 text-center font-bold text-(--c)">{KIND_META[k].icon}</span> {t(`kind.${k}`)}
            </button>
          ))}
          <button className="palette flex items-center gap-2 truncate rounded-lg border border-l-[3px] border-line border-l-(--c) bg-panel2 px-2.5 py-2 text-left text-fg hover:border-(--c)" style={{ ['--c' as string]: 'var(--accent)' }} onClick={() => openModal('templates')}>
            <span className="w-3.5 text-center font-bold text-(--c)">📚</span> {t('ed.fromTemplate')}
          </button>
          <h3>{t('ed.targets')}</h3>
          {(Object.keys(TARGETS) as Target[]).map((tg) => (
            <label key={tg} className="check">
              <input type="checkbox" checked={settings.targets.includes(tg)} onChange={() => toggleTarget(tg)} />
              {TARGETS[tg]}
            </label>
          ))}
          <div className="mt-auto border-t border-line pt-2 text-xs text-muted [&_p]:my-0.5">
            <p><b>{t('ed.links')}</b></p>
            <p>{t('ed.link.cmdAgent')}</p>
            <p>{t('ed.link.skill')}</p>
            <p>{t('ed.link.mcp')}</p>
            <p>{t('ed.link.hint')}</p>
          </div>
        </aside>

        <main className="relative [grid-area:canvas]">
          <ReactFlow
            nodes={nodes}
            edges={edges}
            nodeTypes={nodeTypes}
            onNodesChange={actions.onNodesChange}
            onEdgesChange={actions.onEdgesChange}
            onConnect={actions.onConnect}
            isValidConnection={(c: Connection | Edge) => actions.isValidLink(c.source, c.target)}
            onNodeClick={(_, n) => { actions.select(n.id); setTab('inspector'); }}
            onEdgeDoubleClick={(_, e) => actions.removeEdge(e.id)}
            onPaneClick={() => actions.select(null)}
            fitView
            fitViewOptions={{ padding: 0.15 }}
            minZoom={0.2}
            colorMode={theme}
            deleteKeyCode={['Delete']}
            proOptions={{ hideAttribution: true }}
          >
            <Background gap={24} />
            <MiniMap pannable zoomable nodeColor={(n) => KIND_META[(n.data as { d: { kind: NodeKind } }).d.kind].color} />
            <Controls />
            <Panel position="top-left">
              <CanvasHelp />
            </Panel>
            <Panel position="top-right">
              <button className="btn" onClick={actions.autoLayout} title={t('ed.layoutTitle')}>{t('ed.layout')}</button>
            </Panel>
          </ReactFlow>
        </main>

        <section className="[grid-area:right] flex min-h-0 flex-col border-l border-line bg-panel">
          <div className="tabs">
            <button className={tab === 'inspector' ? 'on' : ''} onClick={() => setTab('inspector')}>{t('ed.tab.inspector')}</button>
            <button className={tab === 'problems' ? 'on' : ''} onClick={() => setTab('problems')}>
              {t('ed.tab.problems')} {issues.length > 0 && <span className={`badge ${worst}`}>{issues.length}</span>}
            </button>
            <button className={tab === 'files' ? 'on' : ''} onClick={() => setTab('files')}>
              {t('ed.tab.files')} <span className="badge">{files.filter((f) => !f.excluded).length}</span>
            </button>
          </div>
          <div className="min-h-0 flex-1 overflow-auto">
            {tab === 'inspector' && <Inspector key={selectedId ?? 'none'} notify={notify} />}
            {tab === 'problems' && <ProblemsPanel key={useStore.getState().projectId} issues={issues} onPick={pickIssue} notify={notify} />}
            {tab === 'files' && <FilesPanel notify={notify} />}
          </div>
        </section>
      </div>
      {showQuestions && <QuestionsModal notify={notify} />}
    </IssuesContext.Provider>
  );
}
