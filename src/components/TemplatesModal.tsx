import { useState } from 'react';
import { useStore } from '../store';
import { KIND_META } from '../defaults';
import { applyTemplates, existingNames, PACKS, templateKey, TEMPLATES, type Template } from '../templates';
import { t, useT, type MsgKey } from '../i18n';
import { translateTemplates } from '../ai';
import type { Lang } from '../i18n/langs';
import { MyTemplates } from './UserTemplates';

type Tab = 'packs' | 'mine' | Template['kind'];
const TABS: Tab[] = ['packs', 'mine', 'agent', 'skill', 'command', 'rule', 'mcp'];

export function TemplatesModal({ onClose, notify }: { onClose: () => void; notify: (m: string) => void }) {
  useT();
  const nodes = useStore((s) => s.nodes);
  const [tab, setTab] = useState<Tab>('packs');
  const have = existingNames(nodes);
  const byId = new Map(TEMPLATES.map((x) => [x.id, x]));

  const add = (list: Template[], from: Lang = 'es') => {
    const ids = applyTemplates(list);
    if (!ids.length) return notify(t('tpl.allThere'));
    // Las plantillas de la biblioteca están en español; las propias, en el idioma en que se guardaron.
    // Si difiere del idioma del contenido del proyecto, se traducen.
    const translating = translateTemplates(ids, from);
    notify(t(translating ? 'tpl.addedTranslating' : 'tpl.added', { n: ids.length }));
    translating?.then(() => notify(t('tpl.translated'))).catch((e) => notify(t('tpl.translateFailed', { msg: (e as Error).message })));
  };
  const title = (x: Template) => t(`tpl.${x.id}.title` as MsgKey);
  const blurb = (x: Template) => t(`tpl.${x.id}.blurb` as MsgKey);

  return (
    <div className="modal-bg" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal wide">
        <div className="modal-head">
          <h2>{t('tpl.title')}</h2>
          <button className="btn ghost" onClick={onClose}>✕</button>
        </div>
        <p className="text-xs text-muted">{t('tpl.intro')}</p>
        <div className="tabs inline">
          {TABS.map((id) => (
            <button key={id} className={tab === id ? 'on' : ''} onClick={() => setTab(id)}>{t(`tpl.tab.${id}`)}</button>
          ))}
        </div>

        {tab !== 'mine' && <div className="grid max-h-[60vh] grid-cols-[repeat(auto-fill,minmax(240px,1fr))] gap-2.5 overflow-auto">
          {tab === 'packs'
            ? PACKS.map((p) => {
                const items = p.items.map((id) => byId.get(id)!);
                const missing = items.filter((x) => !have.has(templateKey(x)));
                return (
                  <div key={p.id} className="flex flex-col gap-1.5 rounded-[10px] border border-t-[3px] border-line border-t-(--c,var(--color-accent)) bg-panel2 p-3 [&_.chip]:border-[color-mix(in_srgb,var(--c)_45%,var(--line))] [&>.btn]:mt-auto [&>.btn]:self-start">
                    <div className="font-semibold">{t(`tpl.${p.id}.title` as MsgKey)}</div>
                    <div className="text-xs text-muted">{t(`tpl.${p.id}.blurb` as MsgKey)}</div>
                    <div className="chips">
                      {items.map((x) => (
                        <span key={x.id} className="chip" style={{ ['--c' as string]: KIND_META[x.kind].color }}>
                          {KIND_META[x.kind].icon} {x.kind === 'command' ? title(x) : String(x.data.name)}
                        </span>
                      ))}
                    </div>
                    <button className="btn primary" disabled={!missing.length} onClick={() => add(items)}>
                      {missing.length ? t('tpl.addN', { n: missing.length }) : t('tpl.there')}
                    </button>
                  </div>
                );
              })
            : TEMPLATES.filter((x) => x.kind === tab).map((x) => {
                const exists = have.has(templateKey(x));
                return (
                  <div key={x.id} className="flex flex-col gap-1.5 rounded-[10px] border border-t-[3px] border-line border-t-(--c,var(--color-accent)) bg-panel2 p-3 [&_.chip]:border-[color-mix(in_srgb,var(--c)_45%,var(--line))] [&>.btn]:mt-auto [&>.btn]:self-start" style={{ ['--c' as string]: KIND_META[x.kind].color }}>
                    <div className="font-semibold">{KIND_META[x.kind].icon} {title(x)}</div>
                    <div className="text-xs text-muted">{blurb(x)}</div>
                    {x.links?.length ? <div className="text-xs text-muted">{t('tpl.links', { list: x.links.join(', ') })}</div> : null}
                    <button className="btn" disabled={exists} onClick={() => add([x])}>{exists ? t('tpl.there') : t('tpl.add')}</button>
                  </div>
                );
              })}
        </div>}
        {tab === 'mine' && <MyTemplates add={add} notify={notify} startSaving={false} />}
      </div>
    </div>
  );
}
