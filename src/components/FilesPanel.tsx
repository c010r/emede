import { useState } from 'react';
import { useStore } from '../store';
import { noteFor } from '../generators';
import { toWrite, useOutput, type OutputFile } from '../output';
import { canUseFolders } from '../fs';
import { WriteModal } from './WriteModal';
import { RepoPullModal } from './RepoPullModal';
import { DiffView } from './DiffView';
import { uiLang, useT } from '../i18n';
import { LANG_INFO } from '../i18n/langs';
import { ALWAYS_LOADED_WARN, estimateTokens, formatTokens, sessionCost } from '../tokens';
import { TARGETS } from '../types';

export function FilesPanel({ notify }: { notify: (msg: string, error?: boolean) => void }) {
  const t = useT();
  const files = useOutput();
  const setOverride = useStore((s) => s.setOverride);
  const toggleExcluded = useStore((s) => s.toggleExcluded);
  const projectName = useStore((s) => s.nodes.find((n) => n.id === 'project')?.data.d.name || 'proyecto');
  const [sel, setSel] = useState('');
  const [draft, setDraft] = useState<string | null>(null);
  const [showDiff, setShowDiff] = useState(false);
  const [writing, setWriting] = useState(false);
  const [pulling, setPulling] = useState(false);

  const targets = useStore((s) => s.settings.targets);
  const current: OutputFile | undefined = files.find((f) => f.path === sel) ?? files[0];
  const tok = (n: number) => formatTokens(n, LANG_INFO[uiLang()].bcp47);
  const active = files.filter((f) => !f.excluded);

  const zip = async () => {
    const { default: JSZip } = await import('jszip'); // solo se carga al descargar
    const z = new JSZip();
    for (const [p, c] of Object.entries(toWrite(files))) z.file(p, c);
    const a = document.createElement('a');
    a.href = URL.createObjectURL(await z.generateAsync({ type: 'blob' }));
    a.download = t('files.zipName', { name: projectName });
    a.click();
    URL.revokeObjectURL(a.href);
  };

  const select = (p: string) => {
    setSel(p);
    setDraft(null);
    setShowDiff(false);
  };

  if (!files.length) return <div className="p-6 text-muted"><p>{t('files.noTargets')}</p></div>;

  const groups = files.reduce<Record<string, OutputFile[]>>((acc, f) => {
    const dir = f.path.includes('/') ? f.path.slice(0, f.path.lastIndexOf('/')) : '·';
    (acc[dir] ??= []).push(f);
    return acc;
  }, {});
  const note = current && noteFor(current.path);

  return (
    <div className="flex h-full flex-col">
      <div className="flex gap-2 border-b border-line p-3">
        <button className="btn primary" onClick={zip} disabled={!active.length}>⬇ ZIP ({active.length})</button>
        {canUseFolders() && (
          <button className="btn" onClick={() => setWriting(true)} disabled={!active.length}
            title={t('files.writeTitle')}>{t('files.write')}</button>
        )}
        {canUseFolders() && (
          <button className="btn" onClick={() => setPulling(true)} title={t('repo.buttonTitle')}>{t('repo.button')}</button>
        )}
      </div>

      <div className="flex flex-col gap-0.5 border-b border-line px-3 py-2" title={t('files.sessionHint')}>
        <div className="text-xs text-muted">{t('files.session')}</div>
        {sessionCost(toWrite(files), targets).map((c) => (
          <div key={c.target} className={`flex justify-between text-xs ${c.tokens > ALWAYS_LOADED_WARN ? 'text-warn' : ''}`}>
            <span>{TARGETS[c.target]}</span>
            <span className="font-mono">≈{tok(c.tokens)}</span>
          </div>
        ))}
      </div>

      <div className="max-h-[38%] shrink-0 overflow-auto border-b border-line px-3 py-2">
        {Object.entries(groups).map(([dir, list]) => (
          <div key={dir}>
            {dir !== '·' && <div className="mt-1.5 font-mono text-xs text-muted">{dir}/</div>}
            {list.map((f) => (
              <button
                key={f.path}
                className={`flex w-full items-center gap-1.5 rounded-[5px] py-[3px] pr-2 text-left font-mono text-[12.5px] hover:bg-panel2 ${f.path === current?.path ? 'bg-[#f5b84122] text-accent' : 'text-fg'} ${dir !== '·' ? 'pl-5' : 'pl-2'} ${f.excluded ? 'line-through opacity-45' : ''}`}
                onClick={() => select(f.path)}
                title={f.excluded ? t('files.excludedTitle') : f.stale ? t('files.staleTitle') : ''}
              >
                {f.path.split('/').at(-1)}
                <span className="ml-auto font-mono text-[10px] text-muted" title={t('files.tokensTitle')}>≈{tok(estimateTokens(f.content))}</span>
                {f.edited && <span className={`tag ${f.stale ? 'warn' : ''}`}>{f.stale ? t('files.editedStale') : t('files.edited')}</span>}
                {f.excluded && <span className="tag">{t('files.excluded')}</span>}
              </button>
            ))}
          </div>
        ))}
      </div>

      {current && (
        <div className="flex min-h-0 flex-1 flex-col">
          <div className="flex items-center justify-between px-3 py-2 [&_code]:text-xs [&_code]:text-accent">
            <code>{current.path}</code>
            <div className="flex gap-2">
              {draft === null ? (
                <>
                  <button className="btn ghost" onClick={() => navigator.clipboard.writeText(current.content).then(() => notify(t('files.copied')))}>{t('files.copy')}</button>
                  <button className="btn ghost" onClick={() => setDraft(current.content)}>{t('files.edit')}</button>
                  <button className="btn ghost" onClick={() => toggleExcluded(current.path)}>{current.excluded ? t('files.include') : t('files.exclude')}</button>
                </>
              ) : (
                <>
                  <button className="btn ghost" onClick={() => setDraft(null)}>{t('common.cancel')}</button>
                  <button
                    className="btn primary"
                    onClick={() => {
                      setOverride(current.path, draft === current.generated ? null : { content: draft, base: current.generated });
                      setDraft(null);
                      notify(draft === current.generated ? t('files.noChange') : t('files.editSaved'));
                    }}
                  >{t('files.saveEdit')}</button>
                </>
              )}
            </div>
          </div>

          {note && <div className="note">ℹ {note}</div>}
          {current.edited && draft === null && (
            <div className={`note ${current.stale ? 'warn' : ''}`}>
              {current.stale
                ? t('files.staleNote')
                : t('files.editedNote')}
              <div className="mt-1.5 flex gap-2">
                <button className="btn ghost" onClick={() => setShowDiff((v) => !v)}>{showDiff ? t('files.hideDiff') : t('files.showDiff')}</button>
                <button className="btn ghost danger" onClick={() => { setOverride(current.path, null); setShowDiff(false); }}>{t('files.discard')}</button>
              </div>
            </div>
          )}

          {draft !== null ? (
            <textarea className="min-h-60 flex-1 resize-none rounded-none border-x-0 font-mono text-[12.5px]" value={draft} onChange={(e) => setDraft(e.target.value)} autoFocus />
          ) : showDiff ? (
            <DiffView before={current.generated} after={current.content} />
          ) : (
            <pre className={current.excluded ? 'opacity-50' : ''}>{current.content}</pre>
          )}
        </div>
      )}

      {pulling && <RepoPullModal onClose={() => setPulling(false)} notify={notify} />}
      {writing && <WriteModal files={toWrite(files)} onClose={() => setWriting(false)} notify={notify} />}
    </div>
  );
}
