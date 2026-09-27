import { useEffect, useState } from 'react';
import { useStore } from './store';

export type EffectiveTheme = 'dark' | 'light';

/**
 * Tema oscuro/claro efectivo: resuelve "system" contra prefers-color-scheme y sigue los cambios en vivo.
 * Lo usa App.tsx (para el data-theme del <html>, ver styles.css) y Editor.tsx (colorMode de React Flow,
 * que trae su propia paleta oscura/clara y no la sigue solo).
 */
export function useEffectiveTheme(): EffectiveTheme {
  const setting = useStore((s) => s.settings.theme) ?? 'dark';
  const [effective, setEffective] = useState<EffectiveTheme>(setting === 'light' ? 'light' : 'dark');
  useEffect(() => {
    const media = typeof window.matchMedia === 'function' ? window.matchMedia('(prefers-color-scheme: light)') : null;
    const compute = (): EffectiveTheme => (setting === 'system' ? (media?.matches ? 'light' : 'dark') : setting);
    setEffective(compute());
    if (setting !== 'system' || !media) return;
    const onChange = () => setEffective(compute());
    media.addEventListener('change', onChange);
    return () => media.removeEventListener('change', onChange);
  }, [setting]);
  return effective;
}
