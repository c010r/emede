import { t } from '../i18n';
import { useMemo } from 'react';
import { collapse, diffLines } from '../diff';

/** Diff por líneas con contexto; las zonas sin cambios se colapsan. */
export function DiffView({ before, after }: { before: string; after: string }) {
  const lines = useMemo(() => collapse(diffLines(before, after)), [before, after]);
  if (!before) return <pre className="border-0">{after}</pre>;
  return (
    <pre className="border-0">
      {lines.map((l, i) =>
        l.type === 'gap' ? (
          <div key={i} className="py-0.5 text-muted italic">{t('diff.same', { n: l.count })}</div>
        ) : (
          <div key={i} className={l.type === 'add' ? 'bg-[#4fd1a514] text-add' : l.type === 'del' ? 'bg-[#ff6b6b14] text-del' : ''}>
            {l.type === 'add' ? '+ ' : l.type === 'del' ? '- ' : '  '}
            {l.text}
          </div>
        ),
      )}
    </pre>
  );
}
