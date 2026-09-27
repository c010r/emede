import { useState } from 'react';
import { pickDir } from '../fs';
import { importFromRepo, type ImportResult } from '../importers/repo';
import { createProject, saveCurrent } from '../projects';
import { useStore } from '../store';
import { requestRepair } from '../repair';
import { useT } from '../i18n';

const COUNTS: (keyof ImportResult['counts'])[] = ['agents', 'skills', 'commands', 'rules', 'mcp'];

/** Arma el diseño a partir de la configuración de agentes que ya tiene un repo. */
export function ImportRepoModal({ onClose, notify, allowReplace = true }: {
  onClose: () => void;
  notify: (m: string, e?: boolean) => void;
  /** Desde el dashboard no hay proyecto abierto: solo se puede crear uno nuevo. */
  allowReplace?: boolean;
}) {
  const t = useT();
  const [result, setResult] = useState<ImportResult | null>(null);
  const [dirName, setDirName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const pick = async () => {
    setError('');
    try {
      const dir = await pickDir('read');
      if (!dir) return;
      setBusy(true);
      setDirName(dir.name);
      setResult(await importFromRepo(dir));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const total = result ? Object.values(result.counts).reduce((a, b) => a + b, 0) : 0;
  const hasMemory = !!result?.graph.nodes.find((n) => n.id === 'project' && n.data.d.kind === 'project' && n.data.d.memory.trim());

  const apply = async (asNew: boolean) => {
    if (!result) return;
    try {
      if (asNew) {
        await saveCurrent();
        await createProject(result.graph);
      } else useStore.getState().setGraph(result.graph);
      requestRepair();
    } catch (e) {
      return setError((e as Error).message);
    }
    notify(t(asNew ? 'imp.doneNew' : 'imp.doneUndo', { dir: dirName, n: total }));
    onClose();
  };

  return (
    <div className="modal-bg" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal">
        <div className="modal-head">
          <h2>{t('imp.title')}</h2>
          <button className="btn ghost" onClick={onClose}>✕</button>
        </div>
        <p className="text-muted">{t('imp.intro')}</p>
        <button className="btn primary" onClick={pick} disabled={busy}>{busy ? t('imp.reading') : result ? t('imp.pickOther') : t('imp.pick')}</button>
        {error && <p className="text-[13px] whitespace-pre-wrap text-danger">{error}</p>}

        {result && (
          <>
            <div className="rounded-lg border border-line bg-panel2 px-3 py-2.5 [&_ul]:my-1.5 [&_ul]:pl-[18px]">
              <b>{dirName}</b>
              <ul>
                <li>{hasMemory ? t('imp.memory') : t('imp.noMemory')}</li>
                {COUNTS.map((k) => (
                  <li key={k} className={result.counts[k] ? '' : 'text-muted'}>{t(`imp.count.${k}`, { n: result.counts[k] })}</li>
                ))}
                <li>{t('imp.links', { n: result.graph.edges.length })}</li>
              </ul>
              {result.sources.length > 0 && (
                <details>
                  <summary className="text-xs text-muted">{t('imp.sources', { n: result.sources.length })}</summary>
                  <div className="font-mono text-xs">{result.sources.map((s) => <div key={s}>{s}</div>)}</div>
                </details>
              )}
            </div>
            {result.hidden.length > 0 && (
              <div className="note warn">
                {t('imp.hidden', { n: result.hidden.length })}
                <div className="font-mono text-xs">
                  {result.hidden.map((h) => <div key={h.path}>{h.path}: {h.count}</div>)}
                </div>
              </div>
            )}
            {!total && !hasMemory && <p className="text-muted">{t('imp.nothing')}</p>}
            <div className="modal-foot">
              {allowReplace && <button className="btn" onClick={() => apply(false)}>{t('imp.replace')}</button>}
              <button className="btn primary" onClick={() => apply(true)}>{t('imp.asNew')}</button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
