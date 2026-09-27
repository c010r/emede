import { useState, type ReactNode } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { defaultGuards, KIND_META, newCanaryPhrase, slug } from '../defaults';
import { linked, linkedFrom, useStore } from '../store';
import { writeNode } from '../ai';
import { StackPicker } from './StackPicker';
import { SaveTemplateModal } from './UserTemplates';
import { t, useT } from '../i18n';
import { TOOLS, type Canary, type Guards, type McpData, type ModelTier, type NodeData, type Tool } from '../types';
import { parseLines, refName, resolveMcp } from '../generators/secrets';

/** Muestra qué valores se van a escribir como referencia a variables de entorno. */
function SecretsNote({ mcp }: { mcp: McpData }) {
  const r = resolveMcp(mcp);
  if (!r.secrets.length) return null;
  const referenced = new Set([...r.env, ...r.headers].filter((x) => x.ref).map((x) => x.key));
  // ¿Pegó un valor real (no una referencia ${VAR}) en un campo que se trata como secreto?
  const pastedReal = parseLines(`${mcp.env}\n${mcp.headers ?? ''}`).some(([k, v]) => {
    const inner = v.replace(/^(Bearer|Token|Basic)\s+/i, '');
    return referenced.has(k) && inner && !refName(inner);
  });
  return (
    <div className="note">
      {t('insp.secrets', { list: r.secrets.join(', ') })}
      {pastedReal && (
        <div className="mt-1.5 text-warn-soft">{t('insp.pastedReal')}</div>
      )}
    </div>
  );
}

/**
 * Guardarraíles: lo que se tiene que cumplir se aplica con permisos y hooks de cada herramienta,
 * no solo con instrucciones que el agente podría ignorar.
 */
function GuardsField({ value, testCommand, onChange }: { value?: Guards; testCommand: string; onChange: (g: Guards) => void }) {
  const g = value ?? defaultGuards();
  const [open, setOpen] = useState(false);
  const up = (patch: Partial<Guards>) => onChange({ ...g, ...patch });
  const list = (key: 'protectPaths' | 'denyCommands' | 'askCommands' | 'allowCommands', label: string, hint: string) => (
    <label className="field">
      <span className="field-label">{label}<em>{hint}</em></span>
      <textarea className="font-mono text-[12.5px]" rows={3} value={g[key]} onChange={(e) => up({ [key]: e.target.value } as Partial<Guards>)} />
    </label>
  );
  return (
    <div className={`flex flex-col gap-1.5 rounded-[10px] border p-2.5 [&_p]:m-0 ${g.enabled ? 'border-[#f5d04788] bg-[#f5d0470a]' : 'border-line'}`}>
      <div className="flex items-center justify-between gap-2">
        <label className="check">
          <input type="checkbox" checked={g.enabled} onChange={(e) => up({ enabled: e.target.checked })} />
          <b>{t('insp.guards')}</b>
        </label>
        {g.enabled && <button className="btn ghost" onClick={() => setOpen((v) => !v)}>{open ? t('insp.hide') : t('insp.configure')}</button>}
      </div>
      <p className="text-xs text-muted">{t('insp.guardsHint')}</p>
      {g.enabled && open && (
        <>
          {list('protectPaths', t('insp.protect'), t('insp.protectHint'))}
          {list('denyCommands', t('insp.deny'), t('insp.denyHint'))}
          {list('askCommands', t('insp.ask'), t('insp.askHint'))}
          {list('allowCommands', t('insp.allow'), t('insp.allowHint'))}
          <label className="field">
            <span className="field-label">{t('insp.format')}<em>hook</em></span>
            <input className="font-mono" value={g.formatCommand} placeholder="npx prettier --write ." onChange={(e) => up({ formatCommand: e.target.value })} />
          </label>
          <label className="check text-xs">
            <input type="checkbox" checked={g.testGate} onChange={(e) => up({ testGate: e.target.checked })} />
            {t('insp.testGate')} {testCommand ? <code>{testCommand}</code> : <span className="text-[13px] whitespace-pre-wrap text-danger">{t('insp.noTest')}</span>}
          </label>
          <div className="flex gap-2">
            <label className="field">
              <span className="field-label">{t('insp.sandbox')}</span>
              <select value={g.sandbox} onChange={(e) => up({ sandbox: e.target.value as Guards['sandbox'] })}>
                <option value="workspace-write">{t('insp.sandboxWrite')}</option>
                <option value="read-only">{t('insp.sandboxRead')}</option>
              </select>
            </label>
            <label className="check text-xs">
              <input type="checkbox" checked={g.network} onChange={(e) => up({ network: e.target.checked })} />
              {t('insp.network')}
            </label>
          </div>
        </>
      )}
    </div>
  );
}

/** Canario de contexto: marca que el agente repite; si desaparece, perdió las instrucciones y puede empezar a inventar. */
function CanaryField({ value, onChange }: { value?: Canary; onChange: (c: Canary) => void }) {
  const c = value ?? { enabled: false, phrase: newCanaryPhrase(), agents: true };
  const style = c.style ?? 'marker';
  return (
    <div className={`flex flex-col gap-1.5 rounded-[10px] border p-2.5 [&_p]:m-0 ${c.enabled ? 'border-[#f5d04788] bg-[#f5d0470a]' : 'border-line'}`}>
      <label className="check">
        <input type="checkbox" checked={c.enabled} onChange={(e) => onChange({ ...c, enabled: e.target.checked })} />
        <b>{t('insp.canary')}</b>
      </label>
      <p className="text-xs text-muted">{t('insp.canaryHint')}</p>
      {c.enabled && (
        <>
          <div className="chips">
            <button
              className={`chip ${style === 'marker' ? 'on' : ''}`}
              onClick={() => onChange({ ...c, style: 'marker', phrase: newCanaryPhrase() })}
            >{t('insp.canaryMarker')}</button>
            <button
              className={`chip ${style === 'name' ? 'on' : ''}`}
              onClick={() => onChange({ ...c, style: 'name', phrase: '' })}
            >{t('insp.canaryName')}</button>
          </div>
          <div className="flex gap-2">
            <input
              value={c.phrase}
              placeholder={style === 'name' ? t('insp.canaryNamePh') : '🐤 CANARIO-XXXX'}
              autoFocus={style === 'name' && !c.phrase}
              onChange={(e) => onChange({ ...c, phrase: e.target.value })}
            />
            {style === 'marker' && (
              <button className="btn" title={t('insp.canaryRegen')} onClick={() => onChange({ ...c, phrase: newCanaryPhrase() })}>↻</button>
            )}
          </div>
          <p className="text-xs text-muted">
            {style === 'name'
              ? t('insp.canaryNameInfo', { name: c.phrase.trim() || t('insp.canaryYourName') })
              : t('insp.canaryMarkerInfo')}
          </p>
          <label className="check text-xs">
            <input type="checkbox" checked={c.agents} onChange={(e) => onChange({ ...c, agents: e.target.checked })} />
            {t('insp.canaryAgents')}
          </label>
        </>
      )}
    </div>
  );
}

function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <label className="field">
      <span className="field-label">{label}{hint && <em>{hint}</em>}</span>
      {children}
    </label>
  );
}

export function Inspector({ notify }: { notify: (msg: string, error?: boolean) => void }) {
  // Solo lo que usa el panel: arrastrar otros nodos no lo vuelve a dibujar.
  useT();
  const node = useStore((s) => s.nodes.find((n) => n.id === s.selectedId));
  const busy = useStore((s) => (s.selectedId ? !!s.busy[s.selectedId] : false));
  const { updateNode, removeNode } = useStore.getState();
  const [savingTpl, setSavingTpl] = useState(false);
  const connections = useStore(
    useShallow((s) => {
      if (!s.selectedId) return [];
      const g = { nodes: s.nodes, edges: s.edges };
      const id = s.selectedId;
      return [
        ...[...linkedFrom(g, id, 'command'), ...linkedFrom(g, id, 'agent')].map((x) => `← ${t(`kind.${x.kind}`)}: ${x.name}`),
        ...[...linked(g, id, 'agent'), ...linked(g, id, 'skill'), ...linked(g, id, 'mcp')].map((x) => `→ ${t(`kind.${x.kind}`)}: ${x.name}`),
      ];
    }),
  );
  const [aiErr, setAiErr] = useState('');

  if (!node)
    return (
      <div className="p-6 text-muted">
        <p>{t('insp.select')}</p>
        <p className="text-muted">{t('insp.connectHint')}</p>
      </div>
    );

  const d = node.data.d;
  const set = (patch: Partial<NodeData>) => updateNode(node.id, patch);
  const text = (key: string, label: string, opts: { hint?: string; rows?: number; mono?: boolean; placeholder?: string } = {}) => {
    const value = (d as unknown as Record<string, string>)[key] ?? '';
    return (
      <Field label={label} hint={opts.hint}>
        {opts.rows ? (
          <textarea
            rows={opts.rows} className={opts.mono ? 'font-mono text-[12.5px]' : ''} value={value} placeholder={opts.placeholder}
            onChange={(e) => set({ [key]: e.target.value } as Partial<NodeData>)}
          />
        ) : (
          <input value={value} placeholder={opts.placeholder} onChange={(e) => set({ [key]: e.target.value } as Partial<NodeData>)} />
        )}
      </Field>
    );
  };

  const ai = async () => {
    setAiErr('');
    try {
      await writeNode(node.id, true);
      notify(t('insp.written'));
    } catch (e) {
      setAiErr((e as Error).message);
    }
  };
  const aiButton = (label: string) => (
    <div className="flex flex-col gap-1.5">
      <button className="btn ai" disabled={busy} onClick={ai}>
        {busy ? t('insp.writing') : `✨ ${label}`}
      </button>
      {aiErr && <div className="text-[13px] whitespace-pre-wrap text-danger">{aiErr}</div>}
    </div>
  );

  const meta = KIND_META[d.kind];

  return (
    <div className="flex flex-col gap-2.5 p-3.5" key={node.id}>
      <div className="flex items-center gap-2 border-b border-line pb-2" style={{ ['--c' as string]: meta.color }}>
        <span className="w-3.5 text-center font-bold text-(--c)">{meta.icon}</span>
        <b>{t(`kind.${d.kind}`)}</b>
        {d.kind !== 'project' && (
          <>
            <button className="btn ghost" onClick={() => setSavingTpl(true)} title={t('utpl.saveTitle')}>{t('utpl.saveAs')}</button>
            <button className="btn ghost danger" onClick={() => removeNode(node.id)}>{t('insp.delete')}</button>
          </>
        )}
        {savingTpl && <SaveTemplateModal id={node.id} onClose={() => setSavingTpl(false)} notify={notify} />}
      </div>

      <Field label={t('insp.name')} hint={d.kind === 'project' ? undefined : t('insp.file', { name: slug(d.name) })}>
        <input value={d.name} onChange={(e) => set({ name: e.target.value })} />
      </Field>

      {d.kind === 'project' && (
        <>
          {text('description', t('insp.description'), { rows: 2, placeholder: t('insp.descriptionPh') })}
          <StackPicker project={d} notify={notify} />
          {text('stack', t('insp.stackNotes'), { rows: 2, placeholder: t('insp.stackNotesPh') })}
          <div className="grid grid-cols-2 gap-2">
            {text('dev', 'Dev', { placeholder: 'npm run dev' })}
            {text('build', 'Build', { placeholder: 'npm run build' })}
            {text('test', 'Test', { placeholder: 'npm test' })}
            {text('lint', 'Lint', { placeholder: 'npm run lint' })}
          </div>
          {text('structure', t('insp.structure'), { rows: 3, placeholder: t('insp.structurePh') })}
          {text('conventions', t('insp.conventions'), { rows: 3, placeholder: t('insp.conventionsPh') })}
          {aiButton(d.memory.trim() ? t('insp.improveMemory') : t('insp.writeMemory'))}
          <CanaryField value={d.canary} onChange={(canary) => set({ canary })} />
          <GuardsField value={d.guards} testCommand={d.test} onChange={(guards) => set({ guards })} />
          {text('plan', t('insp.plan'), { hint: t('insp.planHint'), rows: 5, mono: true, placeholder: t('insp.planPh') })}
          {text('memory', t('insp.memory'), { hint: 'CLAUDE.md / AGENTS.md / GEMINI.md…', rows: 16, mono: true, placeholder: t('insp.memoryPh') })}
        </>
      )}

      {d.kind === 'agent' && (
        <>
          {text('description', t('insp.description'), { hint: t('insp.whenInvoke'), rows: 2 })}
          <Field label={t('insp.model')}>
            <select value={d.model} onChange={(e) => set({ model: e.target.value as ModelTier })}>
              {(['inherit', 'fast', 'balanced', 'powerful'] as const).map((m) => <option key={m} value={m}>{t(`insp.model.${m}`)}</option>)}
            </select>
          </Field>
          <Field label={t('insp.tools')}>
            <div className="chips">
              {TOOLS.map((tool: Tool) => (
                <button
                  key={tool} className={`chip ${d.tools.includes(tool) ? 'on' : ''}`}
                  onClick={() => set({ tools: d.tools.includes(tool) ? d.tools.filter((x) => x !== tool) : [...d.tools, tool] })}
                >{t(`tool.${tool}`)}</button>
              ))}
            </div>
          </Field>
          {aiButton(d.prompt.trim() ? t('insp.improvePrompt') : t('insp.writePrompt'))}
          {text('prompt', t('insp.systemPrompt'), { rows: 16, mono: true })}
        </>
      )}

      {d.kind === 'skill' && (
        <>
          {text('description', t('insp.description'), { hint: t('insp.whenUse'), rows: 2 })}
          {aiButton(d.instructions.trim() ? t('insp.improveInstructions') : t('insp.writeInstructions'))}
          {text('instructions', t('insp.instructions'), { rows: 18, mono: true })}
        </>
      )}

      {d.kind === 'command' && (
        <>
          {text('description', t('insp.description'), { rows: 2 })}
          {text('argumentHint', t('insp.args'), { placeholder: '[issue-id]' })}
          {aiButton(d.prompt.trim() ? t('insp.improvePrompt') : t('insp.writePrompt'))}
          {text('prompt', t('insp.prompt'), { hint: t('insp.useArgs'), rows: 14, mono: true })}
        </>
      )}

      {d.kind === 'rule' && (
        <>
          {text('description', t('insp.description'), { rows: 2 })}
          <label className="check">
            <input type="checkbox" checked={d.alwaysApply} onChange={(e) => set({ alwaysApply: e.target.checked })} />
            {t('insp.always')}
          </label>
          {!d.alwaysApply && text('globs', 'Globs', { placeholder: 'src/**/*.ts, *.tsx' })}
          {aiButton(d.content.trim() ? t('insp.improveRule') : t('insp.writeRule'))}
          {text('content', t('insp.content'), { rows: 12, mono: true })}
        </>
      )}

      {d.kind === 'mcp' && (
        <>
          <Field label={t('insp.transport')}>
            <select value={d.transport} onChange={(e) => set({ transport: e.target.value as 'stdio' | 'http' })}>
              <option value="stdio">{t('insp.stdio')}</option>
              <option value="http">{t('insp.http')}</option>
            </select>
          </Field>
          {d.transport === 'stdio' ? (
            <>
              {text('command', t('insp.command'), { placeholder: 'npx' })}
              {text('args', t('insp.args'), { placeholder: '-y @modelcontextprotocol/server-github' })}
              {text('env', t('insp.env'), { hint: t('insp.envHint'), rows: 3, mono: true })}
            </>
          ) : (
            <>
              {text('url', 'URL', { placeholder: 'https://mcp.ejemplo.com/mcp' })}
              {text('headers', t('insp.headers'), { hint: t('insp.headersHint'), rows: 2, mono: true, placeholder: 'Authorization=Bearer ${GITHUB_TOKEN}' })}
            </>
          )}
          <SecretsNote mcp={d} />
        </>
      )}

      {connections.length > 0 && (
        <div className="border-t border-line pt-2 text-xs text-muted">
          {connections.map((l) => <div key={l}>{l}</div>)}
        </div>
      )}
    </div>
  );
}
