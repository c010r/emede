import { t } from '../i18n';
import { useMemo } from 'react';
import { collapse, diffLines } from '../diff';

/** Diff por líneas con contexto; las zonas sin cambios se colapsan. */
export function DiffView({ before, after }: { before: string; after: string }) {
  const lines = useMemo(() => collapse(diffLines(before, after)), [before, after]);
  if (!before) return <pre className="diff">{after}</pre>;
  return (
    <pre className="diff">
      {lines.map((l, i) =>
        l.type === 'gap' ? (
          <div key={i} className="diff-gap">{t('diff.same', { n: l.count })}</div>
        ) : (
          <div key={i} className={`diff-${l.type}`}>
            {l.type === 'add' ? '+ ' : l.type === 'del' ? '- ' : '  '}
            {l.text}
          </div>
        ),
      )}
    </pre>
  );
}
