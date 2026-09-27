import { useRef, useState } from 'react';
import { designFromPlan, PLAN_MAX_CHARS } from '../ai';
import { applyDesign } from '../projects';
import { useStore } from '../store';
import { aiOf, hasAI, PROVIDER_INFO, providerLabel } from '../providers';
import { canUseFolders } from '../fs';
import { VaultNotesPicker } from './VaultNotesPicker';
import { t, useT } from '../i18n';

/** Límite de adjuntos inline de Gemini (~20 MB por pedido, contando el base64). */
const PDF_MAX_BYTES = 14 * 1024 * 1024;
const TEXT_EXT = /\.(md|markdown|mdx|txt|text)$/i;

async function toBase64(file: File): Promise<string> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

const kb = (n: number) => (n > 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)} MB` : `${Math.ceil(n / 1024)} KB`);

/**
 * Carga un plan generado por IA (PRD, plan de implementación, roadmap) y lo convierte en la configuración de agentes.
 * Acepta texto pegado, archivos .md/.txt y PDF (lo lee la IA directamente, si el proveedor lo soporta).
 */
export function PlanModal({ onClose, notify }: { onClose: () => void; notify: (m: string, e?: boolean) => void }) {
  useT();
  const inEditor = useStore((s) => s.view === 'editor');
  const hasKey = useStore((s) => hasAI(s.settings));
  const [text, setText] = useState('');
  const [pdf, setPdf] = useState<{ name: string; size: number; data: string } | null>(null);
  const [keepPlan, setKeepPlan] = useState(true);
  const [keepProject, setKeepProject] = useState(inEditor);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [drag, setDrag] = useState(false);
  const [fromVault, setFromVault] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const load = async (file: File) => {
    setErr('');
    try {
      if (file.type === 'application/pdf' || /\.pdf$/i.test(file.name)) {
        const provider = aiOf(useStore.getState().settings).provider;
        if (!PROVIDER_INFO[provider].pdf) throw new Error(t('plan.noPdf', { provider: providerLabel(provider) }));
        if (file.size > PDF_MAX_BYTES) throw new Error(t('plan.pdfTooBig', { size: kb(file.size), max: kb(PDF_MAX_BYTES) }));
        setPdf({ name: file.name, size: file.size, data: await toBase64(file) });
        setText('');
      } else if (TEXT_EXT.test(file.name) || file.type.startsWith('text/')) {
        setText(await file.text());
        setPdf(null);
      } else throw new Error(t('plan.badFormat'));
    } catch (e) {
      setErr((e as Error).message);
    }
  };

  const run = async () => {
    setBusy(true);
    setErr('');
    try {
      const graph = await designFromPlan({
        text, pdf: pdf ? { name: pdf.name, data: pdf.data } : undefined, keepPlan, keepProject: keepProject && inEditor,
      });
      const where = await applyDesign(graph);
      notify(where === 'new' ? t('plan.created') : t('plan.generated'));
      onClose();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const tooLong = text.length > PLAN_MAX_CHARS;
  const ready = (!!text.trim() || !!pdf) && !tooLong && hasKey;

  return (
    <div className="modal-bg" onMouseDown={(e) => e.target === e.currentTarget && !busy && onClose()}>
      <div className="modal wide">
        <div className="modal-head">
          <h2>{t('plan.title')}</h2>
          <button className="btn ghost" onClick={onClose} disabled={busy}>✕</button>
        </div>
        <p className="text-muted">{t('plan.intro')}</p>

        {fromVault ? (
          <VaultNotesPicker
            onCancel={() => setFromVault(false)}
            onUse={(notes, n) => {
              setText(notes);
              setPdf(null);
              setFromVault(false);
              setErr(n ? '' : t('notes.noneChosen'));
            }}
          />
        ) : (
        <div
          className={`flex flex-col gap-2 rounded-[10px] border border-dashed p-2.5 ${drag ? 'border-ai bg-[#a78bfa12]' : 'border-line'}`}
          onDragOver={(e) => { e.preventDefault(); setDrag(true); }}
          onDragLeave={() => setDrag(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDrag(false);
            const f = e.dataTransfer.files?.[0];
            if (f) load(f);
          }}
        >
          {pdf ? (
            <div className="flex gap-2">
              <span>📕 <b>{pdf.name}</b> <span className="text-xs text-muted">({kb(pdf.size)})</span></span>
              <button className="btn ghost" onClick={() => setPdf(null)}>{t('plan.remove')}</button>
            </div>
          ) : (
            <textarea
              rows={12}
              className="font-mono"
              value={text}
              autoFocus
              placeholder={t('plan.placeholder')}
              onChange={(e) => setText(e.target.value)}
            />
          )}
          <div className="flex items-center justify-between gap-2">
            <span className="flex gap-2">
              <button className="btn" onClick={() => fileRef.current?.click()}>{t('plan.upload')}</button>
              {canUseFolders() && <button className="btn" onClick={() => setFromVault(true)} title={t('plan.fromObsidianTitle')}>{t('plan.fromObsidian')}</button>}
            </span>
            {!pdf && text && (
              <span className={`text-xs ${tooLong ? 'text-danger' : 'text-muted'}`}>
                {t('plan.chars', { n: text.length.toLocaleString() })}{tooLong ? t('plan.max', { n: PLAN_MAX_CHARS.toLocaleString() }) : ''}
              </span>
            )}
          </div>
          <input
            ref={fileRef} type="file" hidden accept=".md,.markdown,.mdx,.txt,.pdf,text/plain,text/markdown,application/pdf"
            onChange={(e) => {
              if (e.target.files?.[0]) load(e.target.files[0]);
              e.target.value = '';
            }}
          />
        </div>
        )}

        <label className="check">
          <input type="checkbox" checked={keepPlan} onChange={(e) => setKeepPlan(e.target.checked)} />
          {t('plan.keepPlan')}
          {pdf && keepPlan && <span className="text-xs text-muted">{t('plan.pdfTranscribed')}</span>}
        </label>
        {inEditor ? (
          <>
            <label className="check">
              <input type="checkbox" checked={keepProject} onChange={(e) => setKeepProject(e.target.checked)} />
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
          <button className="btn" onClick={onClose} disabled={busy}>{t('common.cancel')}</button>
          <button className="btn ai" disabled={!ready || busy} onClick={run}>
            {busy ? t('plan.busy') : t('plan.run')}
          </button>
        </div>
      </div>
    </div>
  );
}
