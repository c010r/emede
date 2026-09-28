import { useState } from 'react';
import { pickDir, canUseFolders } from '../fs';
import { detectInDir } from '../detect';
import { scanProject, scanContextFromDetection, type ScanResult } from '../scanner';
import { applyDesign } from '../projects';
import { useStore } from '../store';
import { requestRepair } from '../repair';
import { hasAI } from '../providers';
import { t, useT } from '../i18n';

const COUNTS = ['agents', 'skills', 'commands', 'rules', 'mcp'] as const;

/**
 * Escanea la carpeta de un proyecto: detecta el stack y la IA arma la configuración
 * completa de agentes, skills, comandos y reglas. Nada se modifica en la carpeta.
 */
export function ScanModal({ onClose, notify }: { onClose: () => void; notify: (m: string, e?: boolean) => void }) {
  useT();
  const inEditor = useStore((s) => s.view === 'editor');
  const hasKey = useStore((s) => hasAI(s.settings));
  const [result, setResult] = useState<ScanResult | null>(null);
  const [dirName, setDirName] = useState('');
  const [detected, setDetected] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const pick = async () => {
    setError('');
    try {
      const dir = await pickDir('read');
      if (!dir) return;
      setBusy(true);
      setDirName(dir.name);
      // 1. Detección del stack, comandos y estructura.
      const det = await detectInDir(dir);
      setDetected(det.items.map((i) => i.label));
      // 2. La IA genera la configuración a partir de lo detectado.
      setResult(await scanProject(scanContextFromDetection(det)));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const apply = async () => {
    if (!result) return;
    try {
      requestRepair();
      const where = await applyDesign(result.graph);
      notify(t(where === 'new' ? 'scan.doneNew' : 'scan.doneUndo', { dir: dirName, n: result.graph.nodes.length - 1 }));
      onClose();
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const total = result ? COUNTS.reduce((a, k) => a + result[k].length, 0) : 0;

  return (
    <div className="modal-bg" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal">
        <div className="modal-head">
          <h2>{t('scan.title')}</h2>
          <button className="btn ghost" onClick={onClose}>✕</button>
        </div>
        <p className="text-muted">{t('scan.intro')}</p>
        {!hasKey && <p className="text-[13px] whitespace-pre-wrap text-danger">{t('design.needsAI')}</p>}
        {!canUseFolders() && <p className="text-[13px] whitespace-pre-wrap text-danger">{t('scan.noFolders')}</p>}

        <button className="btn primary" onClick={pick} disabled={busy || !hasKey || !canUseFolders()}>
          {busy ? t('scan.generating') : result ? t('scan.pickOther') : t('scan.pick')}
        </button>
        {error && <p className="text-[13px] whitespace-pre-wrap text-danger">{error}</p>}

        {result && (
          <>
            <div className="rounded-lg border border-line bg-panel2 px-3 py-2.5 [&_ul]:my-1.5 [&_ul]:pl-[18px]">
              <b>{dirName}</b>
              {detected.length > 0 && (
                <div className="mt-1 text-xs text-muted">{t('scan.detected')}: <span className="text-[#9fb3ff]">{detected.join(' · ')}</span></div>
              )}
              <ul>
                {COUNTS.map((k) => (
                  <li key={k} className={result[k].length ? '' : 'text-muted'}>{t(`imp.count.${k}`, { n: result[k].length })}</li>
                ))}
              </ul>
            </div>
            <p className="text-xs text-muted">{inEditor ? t('design.replaces') : t('design.newProject')}</p>
            <div className="modal-foot">
              <button className="btn" onClick={onClose}>{t('common.cancel')}</button>
              <button className="btn ai" disabled={!total} onClick={apply}>{t('scan.apply')}</button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
