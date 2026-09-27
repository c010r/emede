import { useEffect, useState } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { useStore } from '../store';
import { DEFAULT_VAULT_FOLDER, hasOwnName, pendingNotes, vaultBase } from '../obsidian';
import { currentVault, serverAvailable } from '../vaultDir';
import { useT } from '../i18n';
import type { ProjectData } from '../types';
import type { EditorModal } from './Editor';

type ChipState = { kind: 'link' } | { kind: 'unnamed' } | { kind: 'ok' } | { kind: 'pending'; n: number };

/**
 * Estado del vault de Obsidian en la barra del editor: al día, cuántas notas faltan guardar, o que falta vincularlo.
 * Con cambios pendientes, un click abre directo la vista de cambios (diff y respaldo antes de escribir).
 */
export function ObsidianChip({ openModal }: { openModal: (m: EditorModal) => void }) {
  const t = useT();
  const { nodes, edges, folder, lang, vaultPath } = useStore(useShallow((s) => ({
    nodes: s.nodes, edges: s.edges, folder: s.settings.vaultFolder || DEFAULT_VAULT_FOLDER, lang: s.settings.lang, vaultPath: s.settings.vaultPath,
  })));
  const [state, setState] = useState<ChipState | null>(null);

  // Se recalcula con una pausa: arrastrar tarjetas cambia el grafo en cada cuadro.
  useEffect(() => {
    const id = window.setTimeout(() => {
      if (!currentVault()) return setState({ kind: 'link' });
      const g = { nodes, edges };
      if (!hasOwnName(g.nodes.find((n) => n.id === 'project')!.data.d as ProjectData)) return setState({ kind: 'unnamed' });
      const n = pendingNotes(g, vaultBase(g, folder), lang).length;
      setState(n ? { kind: 'pending', n } : { kind: 'ok' });
    }, 300);
    return () => window.clearTimeout(id);
  }, [nodes, edges, folder, lang, vaultPath]);

  if (!state) return null;
  const click = () => {
    if (state.kind === 'link') openModal(serverAvailable() ? 'settings' : 'obsidian');
    else if (state.kind === 'pending') openModal('obsidianSend');
    else openModal('obsidian');
  };
  const title = {
    link: t('obs.chip.linkTitle'),
    unnamed: t('obs.chip.unnamedTitle'),
    ok: t('obs.chip.okTitle'),
    pending: t('obs.chip.pendingTitle', { n: state.kind === 'pending' ? state.n : 0 }),
  }[state.kind];

  return (
    <button className={`btn small obs-chip ${state.kind === 'pending' ? 'border-accent text-accent' : 'text-muted'}`} onClick={click} title={title}>
      📓{state.kind === 'pending' && ` ${state.n}`}
      <span className="max-[1480px]:hidden"> {t(`obs.chip.${state.kind}`)}</span>
    </button>
  );
}
