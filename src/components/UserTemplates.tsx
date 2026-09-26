import { useCallback, useEffect, useRef, useState } from 'react';
import { useStore } from '../store';
import { KIND_META } from '../defaults';
import { storage } from '../storage';
import { downloadPack, packFromNodes, parsePack, type UserPack } from '../userTemplates';
import { hiddenWarning } from '../projects';
import { existingNames, templateKey, type Template } from '../templates';
import { useT } from '../i18n';

/** Lista de plantillas propias guardadas (en el mismo JSON que los proyectos). */
export function useUserPacks() {
  const [packs, setPacks] = useState<UserPack[] | null>(null);
  const [error, setError] = useState('');
  const reload = useCallback(() => {
    storage().listTemplates().then(setPacks).catch((e) => setError((e as Error).message));
  }, []);
  useEffect(reload, [reload]);
  return { packs, error, reload };
}

/** Formulario: elegir piezas del lienzo, ponerle nombre y guardar el paquete. */
export function SaveTemplateForm({ preselect, onSaved, onCancel }: { preselect: string[]; onSaved: (p: UserPack) => void; onCancel: () => void }) {
  const t = useT();
  const nodes = useStore((s) => s.nodes).filter((n) => n.data.d.kind !== 'project');
  const [chosen, setChosen] = useState<Set<string>>(new Set(preselect.filter((id) => nodes.some((n) => n.id === id))));
  const first = nodes.find((n) => chosen.has(n.id))?.data.d;
  const [title, setTitle] = useState(chosen.size === 1 && first ? first.name : '');
  const [blurb, setBlurb] = useState(chosen.size === 1 && first && 'description' in first ? String(first.description ?? '') : '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const toggle = (id: string) => setChosen((s) => {
    const n = new Set(s);
    if (n.has(id)) n.delete(id); else n.add(id);
    return n;
  });
  const save = async () => {
    setBusy(true);
    setError('');
    try {
      const st = useStore.getState();
      const pack = packFromNodes(st, [...chosen], { title, blurb, lang: st.settings.lang });
      await storage().putTemplate(pack);
      onSaved(pack);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="utpl-form">
      <label className="field">
        <span>{t('utpl.name')}</span>
        <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder={t('utpl.namePh')} autoFocus />
      </label>
      <label className="field">
        <span>{t('utpl.blurb')}</span>
        <input value={blurb} onChange={(e) => setBlurb(e.target.value)} placeholder={t('utpl.blurbPh')} />
      </label>
      <div className="muted small">{t('utpl.pieces')}</div>
      {nodes.length === 0 ? <p className="muted small">{t('utpl.noPieces')}</p> : (
        <div className="utpl-pieces">
          {nodes.map((n) => (
            <label key={n.id} className="check">
              <input type="checkbox" checked={chosen.has(n.id)} onChange={() => toggle(n.id)} />
              {KIND_META[n.data.d.kind].icon} {n.data.d.kind === 'command' ? '/' : ''}{n.data.d.name || '—'}
            </label>
          ))}
        </div>
      )}
      <p className="muted small">{t('utpl.noSecrets')}</p>
      {error && <p className="error">{error}</p>}
      <div className="row">
        <button className="btn" onClick={onCancel} disabled={busy}>{t('common.cancel')}</button>
        <button className="btn primary" onClick={save} disabled={busy || !chosen.size || !title.trim()}>{t('utpl.save', { n: chosen.size })}</button>
      </div>
    </div>
  );
}

/** Pestaña "Mis plantillas" del modal de plantillas. */
export function MyTemplates({ add, notify, startSaving }: { add: (items: Template[], lang: UserPack['lang']) => void; notify: (m: string) => void; startSaving: boolean }) {
  const t = useT();
  const nodes = useStore((s) => s.nodes);
  const selectedId = useStore((s) => s.selectedId);
  const { packs, error, reload } = useUserPacks();
  const [saving, setSaving] = useState(startSaving);
  const file = useRef<HTMLInputElement>(null);
  const have = existingNames(nodes);

  const importFile = async (f: File) => {
    try {
      const { pack, hidden } = parsePack(await f.text());
      await storage().putTemplate(pack);
      reload();
      notify([t('utpl.imported', { name: pack.title, n: pack.items.length }), hiddenWarning(hidden)].filter(Boolean).join(' '));
    } catch (e) {
      notify((e as Error).message);
    }
  };
  const remove = async (p: UserPack) => {
    await storage().removeTemplate(p.id);
    reload();
    notify(t('utpl.removed', { name: p.title }));
  };

  if (saving)
    return (
      <SaveTemplateForm
        preselect={selectedId && selectedId !== 'project' ? [selectedId] : []}
        onCancel={() => setSaving(false)}
        onSaved={(p) => {
          setSaving(false);
          reload();
          notify(t('utpl.saved', { name: p.title }));
        }}
      />
    );

  return (
    <>
      <div className="row wrap">
        <button className="btn primary" onClick={() => setSaving(true)}>{t('utpl.new')}</button>
        <button className="btn" onClick={() => file.current?.click()}>{t('utpl.import')}</button>
        <input ref={file} type="file" accept=".json,application/json" hidden
          onChange={(e) => {
            const f = e.target.files?.[0];
            e.target.value = '';
            if (f) void importFile(f);
          }} />
      </div>
      {error && <p className="error">{error}</p>}
      {packs && !packs.length && <p className="muted small">{t('utpl.empty')}</p>}
      <div className="tpl-grid">
        {(packs ?? []).map((p) => {
          const missing = p.items.filter((x) => !have.has(templateKey(x)));
          return (
            <div key={p.id} className="tpl">
              <div className="tpl-title">{p.title}</div>
              {p.blurb && <div className="muted small">{p.blurb}</div>}
              <div className="chips">
                {p.items.map((x) => (
                  <span key={x.id} className="chip" style={{ ['--c' as string]: KIND_META[x.kind].color }}>
                    {KIND_META[x.kind].icon} {x.kind === 'command' ? '/' : ''}{x.title}
                  </span>
                ))}
              </div>
              <div className="row">
                <button className="btn primary" disabled={!missing.length} onClick={() => add(p.items, p.lang)}>
                  {missing.length ? t('tpl.addN', { n: missing.length }) : t('tpl.there')}
                </button>
                <button className="btn ghost" onClick={() => downloadPack(p)} title={t('utpl.exportTitle')}>⬇</button>
                <button className="btn ghost danger" onClick={() => remove(p)} title={t('utpl.delete')}>🗑</button>
              </div>
            </div>
          );
        })}
      </div>
    </>
  );
}

/** Guardar como plantilla desde el Inspector. */
export function SaveTemplateModal({ id, onClose, notify }: { id: string; onClose: () => void; notify: (m: string) => void }) {
  const t = useT();
  return (
    <div className="modal-bg" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal">
        <div className="modal-head">
          <h2>{t('utpl.saveTitle')}</h2>
          <button className="btn ghost" onClick={onClose}>✕</button>
        </div>
        <p className="muted small">{t('utpl.saveIntro')}</p>
        <SaveTemplateForm preselect={[id]} onCancel={onClose} onSaved={(p) => {
          notify(t('utpl.saved', { name: p.title }));
          onClose();
        }} />
      </div>
    </div>
  );
}
