import { useMemo } from 'react';
import { useStore } from './store';
import { render } from './generators';
import { computeOutput, type OutputFile } from './files';

export { computeOutput, toWrite, type OutputFile } from './files';

/**
 * Archivos finales del proyecto. Solo se regeneran cuando cambia el contenido
 * (contentVersion), no al mover nodos por el lienzo.
 */
export function useOutput(): OutputFile[] {
  const version = useStore((s) => s.contentVersion);
  const lang = useStore((s) => s.settings.lang);
  const targets = useStore((s) => s.settings.targets);
  const overrides = useStore((s) => s.fileOverrides);
  const excluded = useStore((s) => s.excluded);
  const generated = useMemo(() => {
    const { nodes, edges } = useStore.getState();
    return render({ nodes, edges }, { lang, targets });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [version, lang, targets]);
  return useMemo(() => computeOutput(generated, overrides, excluded), [generated, overrides, excluded]);
}
