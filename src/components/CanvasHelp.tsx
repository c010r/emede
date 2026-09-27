import { useState } from 'react';
import { KIND_META } from '../defaults';
import type { NodeKind } from '../types';
import { useT } from '../i18n';

const KINDS: NodeKind[] = ['project', 'agent', 'skill', 'command', 'rule', 'mcp', 'hook'];

const KEY = 'emede-canvas-help-closed';

const read = () => {
  try {
    return localStorage.getItem(KEY) === '1';
  } catch {
    return false;
  }
};

/** Explica el lienzo: cada tarjeta es una pieza que se convierte en archivos; las flechas, quién usa a quién. */
export function CanvasHelp() {
  const t = useT();
  const [closed, setClosed] = useState(read);
  const toggle = (v: boolean) => {
    setClosed(v);
    try {
      localStorage.setItem(KEY, v ? '1' : '0');
    } catch { /* sin almacenamiento: solo dura la sesión */ }
  };

  if (closed) return <button className="btn" onClick={() => toggle(false)} title={t('help.title')}>{t('help.open')}</button>;

  return (
    <div className="w-[340px] rounded-xl border border-line bg-panel px-3 py-2.5 shadow-[0_6px_24px_#0006] [&_li]:my-0.5 [&_p]:my-1.5 [&_ul]:my-1.5 [&_ul]:pl-4">
      <div className="flex items-center justify-between gap-2">
        <b>{t('help.title')}</b>
        <button className="btn ghost small" onClick={() => toggle(true)}>{t('help.gotIt')}</button>
      </div>
      <p className="text-xs">{t('help.intro')}</p>
      <ul className="text-xs">
        {KINDS.map((k) => (
          <li key={k}><span style={{ color: KIND_META[k].color }}>{KIND_META[k].icon} {t(`kind.${k}`)}</span> → {t(`help.out.${k}`)}</li>
        ))}
      </ul>
      <p className="text-xs">{t('help.arrows')}</p>
      <p className="text-xs text-muted">{t('help.edit')}</p>
    </div>
  );
}
