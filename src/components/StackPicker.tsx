import { t } from '../i18n';
import { useMemo, useState } from 'react';
import { useStore } from '../store';
import { hasAI } from '../providers';
import { mergeStack, suggestStack } from '../ai';
import { canDetect, detectFromFolder } from '../detect';
import {
  CATALOG, searchTech, STACK_CATEGORIES, suggestCommands, toItem, type StackCategory, type StackItem,
} from '../stack';
import type { ProjectData } from '../types';

type Cmds = Partial<Record<'dev' | 'build' | 'test' | 'lint', string>>;

interface Proposal {
  source: string;
  items: StackItem[];
  commands: Cmds;
  note?: string;
  extra?: Partial<Pick<ProjectData, 'name' | 'description' | 'structure'>>;
}

const CAT_COLORS: Record<StackCategory, string> = {
  lang: '#f5b841', frontend: '#7c9cff', backend: '#4fd1a5', mobile: '#f07fb6', db: '#62c6e8', orm: '#8fd3ff',
  ui: '#c9a2ff', test: '#ffb47a', tooling: '#9aa3b5', infra: '#6ee7b7', services: '#f0a0ff', other: '#8b92a5',
};

export function StackPicker({ project, notify }: { project: ProjectData; notify: (m: string, e?: boolean) => void }) {
  const updateNode = useStore((s) => s.updateNode);
  const hasKey = useStore((s) => hasAI(s.settings));
  const items = project.stackItems ?? [];
  const set = (patch: Partial<ProjectData>) => updateNode('project', patch);
  const setItems = (next: StackItem[]) => set({ stackItems: next });

  const [cat, setCat] = useState<StackCategory>('lang');
  const [query, setQuery] = useState('');
  const [editing, setEditing] = useState<string | null>(null);
  const [busy, setBusy] = useState<'' | 'ai' | 'detect'>('');
  const [proposal, setProposal] = useState<Proposal | null>(null);
  const [accepted, setAccepted] = useState<Set<string>>(new Set());
  const [applyCmds, setApplyCmds] = useState(true);

  const selected = new Set(items.map((i) => i.id));
  const results = useMemo(() => searchTech(query), [query]);
  const counts = useMemo(() => {
    const c: Partial<Record<StackCategory, number>> = {};
    for (const i of items) c[i.category] = (c[i.category] ?? 0) + 1;
    return c;
  }, [items]);

  const toggle = (item: StackItem) =>
    setItems(selected.has(item.id) ? items.filter((i) => i.id !== item.id) : [...items, item]);

  const addFromQuery = () => {
    const q = query.trim();
    if (!q) return;
    const m = q.match(/^(.*?)\s+v?(\d[\w.]*)$/);
    const tech = results[0];
    const item: StackItem = tech
      ? toItem(tech, m && searchTech(m[1])[0]?.id === tech.id ? m[2] : undefined)
      : { id: `custom-${q.toLowerCase().replace(/\W+/g, '-')}`, label: q, category: cat };
    if (!selected.has(item.id)) setItems([...items, item]);
    setQuery('');
  };

  const openProposal = (p: Proposal) => {
    setProposal(p);
    setAccepted(new Set(p.items.map((i) => i.id)));
    setApplyCmds(Object.keys(p.commands).length > 0);
  };

  const applyProposal = () => {
    if (!proposal) return;
    const chosen = proposal.items.filter((i) => accepted.has(i.id));
    const patch: Partial<ProjectData> = { stackItems: mergeStack(items, chosen) };
    if (applyCmds) Object.assign(patch, proposal.commands);
    // Nombre, descripción y estructura detectados solo completan campos vacíos.
    const extra = proposal.extra ?? {};
    if (extra.name && (!project.name.trim() || project.name === 'mi-proyecto')) patch.name = extra.name;
    if (extra.description && !project.description.trim()) patch.description = extra.description;
    if (extra.structure && !project.structure.trim()) patch.structure = extra.structure;
    set(patch);
    setProposal(null);
    notify(t(applyCmds && Object.keys(proposal.commands).length ? 'stack.updatedCmds' : 'stack.updated', { n: chosen.length }));
  };

  const runAI = async () => {
    setBusy('ai');
    try {
      const s = await suggestStack();
      openProposal({ source: t('stack.aiSource'), items: s.items, commands: s.commands, note: s.reason });
    } catch (e) {
      notify((e as Error).message, true);
    } finally {
      setBusy('');
    }
  };

  const runDetect = async () => {
    setBusy('detect');
    try {
      const d = await detectFromFolder();
      if (!d) return;
      if (!d.items.length) return notify(t('stack.nothingFound'), true);
      openProposal({
        source: t('stack.detected', { sources: d.sources.join(', ') || t('stack.rootFiles') }),
        items: d.items,
        commands: d.commands,
        extra: { name: d.name, description: d.description, structure: d.structure },
      });
    } catch (e) {
      notify((e as Error).message, true);
    } finally {
      setBusy('');
    }
  };

  const fillCommands = () => {
    const c = suggestCommands(items);
    if (!Object.keys(c).length) return notify(t('stack.noCmds'), true);
    set(c);
    notify(t('stack.cmdsDone', { list: Object.keys(c).join(', ') }));
  };

  return (
    <div className="stack">
      <div className="field-label">{t('stack.label')} <em>{t('stack.chosen', { n: items.length })}</em></div>

      {/* Seleccionadas */}
      <div className="chips stack-selected">
        {!items.length && <span className="muted small">{t('stack.empty')}</span>}
        {items.map((i) =>
          editing === i.id ? (
            <input
              key={i.id} className="chip-edit" autoFocus placeholder={t('stack.version')}
              defaultValue={i.version ?? ''}
              onBlur={(e) => {
                setItems(items.map((x) => (x.id === i.id ? { ...x, version: e.target.value.trim() || undefined } : x)));
                setEditing(null);
              }}
              onKeyDown={(e) => (e.key === 'Enter' || e.key === 'Escape') && (e.target as HTMLInputElement).blur()}
            />
          ) : (
            <span key={i.id} className="chip on stack-chip" style={{ ['--c' as string]: CAT_COLORS[i.category] }}>
              <button className="chip-label" title={t('stack.versionTitle')} onClick={() => setEditing(i.id)}>
                {i.label}{i.version && <small> {i.version}</small>}
              </button>
              <button className="chip-x" title={t('stack.remove')} onClick={() => toggle(i)}>✕</button>
            </span>
          ),
        )}
      </div>

      {/* Acciones */}
      <div className="stack-actions">
        {canDetect() && (
          <button className="btn" disabled={!!busy} onClick={runDetect} title={t('stack.detectTitle')}>
            {busy === 'detect' ? t('stack.reading') : t('stack.detect')}
          </button>
        )}
        <button className="btn ai" disabled={!!busy || !hasKey} onClick={runAI} title={hasKey ? t('stack.aiTitle') : t('stack.needsAI')}>
          {busy === 'ai' ? t('stack.thinking') : t('stack.suggest')}
        </button>
        <button className="btn" disabled={!items.length} onClick={fillCommands} title={t('stack.cmdsTitle')}>
          {t('stack.cmds')}
        </button>
      </div>

      {/* Propuesta pendiente de revisión */}
      {proposal && (
        <div className="proposal">
          <div className="proposal-head">{proposal.source}</div>
          {proposal.note && <p className="muted small">{proposal.note}</p>}
          <div className="chips">
            {proposal.items.map((i) => {
              const isNew = !selected.has(i.id);
              const on = accepted.has(i.id);
              return (
                <button
                  key={i.id}
                  className={`chip ${on ? 'on' : ''}`}
                  style={{ ['--c' as string]: CAT_COLORS[i.category] }}
                  disabled={!isNew}
                  title={isNew ? '' : t('stack.already')}
                  onClick={() => setAccepted((s) => {
                    const n = new Set(s);
                    if (n.has(i.id)) n.delete(i.id); else n.add(i.id);
                    return n;
                  })}
                >
                  {isNew ? (on ? '✔ ' : '○ ') : '· '}{i.label}{i.version ? ` ${i.version}` : ''}
                </button>
              );
            })}
          </div>
          {Object.keys(proposal.commands).length > 0 && (
            <label className="check small">
              <input type="checkbox" checked={applyCmds} onChange={(e) => setApplyCmds(e.target.checked)} />
              {t('stack.applyCmds', { list: Object.entries(proposal.commands).map(([k, v]) => `${k}=${v}`).join(' · ') })}
            </label>
          )}
          <div className="row end">
            <button className="btn ghost" onClick={() => setProposal(null)}>{t('stack.discard')}</button>
            <button className="btn primary" onClick={applyProposal}>{t('stack.apply')}</button>
          </div>
        </div>
      )}

      {/* Búsqueda */}
      <div className="stack-search">
        <input
          value={query}
          placeholder={t('stack.search')}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') addFromQuery();
            if (e.key === 'Escape') setQuery('');
          }}
        />
        {query && (
          <div className="stack-results">
            {results.map((x) => (
              <button key={x.id} className={selected.has(x.id) ? 'on' : ''} onClick={() => { toggle(toItem(x)); setQuery(''); }}>
                <span className="dot" style={{ background: CAT_COLORS[x.cat] }} />
                {x.label} <span className="muted small">{t(`stackcat.${x.cat}`)}</span>
                {selected.has(x.id) && <span className="muted small">{t('stack.isChosen')}</span>}
              </button>
            ))}
            {!results.some((x) => x.label.toLowerCase() === query.trim().toLowerCase()) && (
              <button onClick={addFromQuery}>
                {t('stack.addCustom', { q: query.trim(), cat: t(`stackcat.${cat}`) })}
              </button>
            )}
          </div>
        )}
      </div>

      {/* Catálogo por categoría */}
      <div className="stack-tabs">
        {(Object.keys(STACK_CATEGORIES) as StackCategory[]).filter((c) => c !== 'other').map((c) => (
          <button key={c} className={c === cat ? 'on' : ''} style={{ ['--c' as string]: CAT_COLORS[c] }} onClick={() => setCat(c)}>
            {t(`stackcat.${c}`)}{counts[c] ? <b> {counts[c]}</b> : null}
          </button>
        ))}
      </div>
      <div className="chips">
        {CATALOG.filter((x) => x.cat === cat).map((x) => (
          <button
            key={x.id}
            className={`chip ${selected.has(x.id) ? 'on' : ''}`}
            style={{ ['--c' as string]: CAT_COLORS[x.cat] }}
            onClick={() => toggle(toItem(x))}
          >{x.label}</button>
        ))}
      </div>
    </div>
  );
}
