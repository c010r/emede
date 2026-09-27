import { useEffect, useState, type CSSProperties } from 'react';

/*
 * Logo de emede: una "M" armada como un grafo de nodos (el lienzo del editor) cuyo nodo central es la IA
 * y del que baja una flecha, el "↓" de Markdown: del diseño visual salen los archivos .md.
 * Con `animate`, el grafo se arma pieza por pieza: aristas que se dibujan, nodos que aparecen, la IA que late
 * y la flecha que cae. Con prefers-reduced-motion la animación se omite (styles.css).
 */

/** Nodos de la M, en el orden en que se recorre el trazo. */
const NODES: [number, number][] = [[11, 35], [11, 13], [24, 25], [37, 13], [37, 35]];
const AI = 2;

export function LogoMark({ size = 28, animate = false }: { size?: number; animate?: boolean }) {
  return (
    <svg className={`logo-mark flex-none overflow-visible${animate ? ' anim' : ''}`} width={size} height={size} viewBox="0 0 48 48" aria-hidden="true" focusable="false">
      <rect className="lm-frame" x="1.5" y="1.5" width="45" height="45" rx="11" />
      <polyline className="lm-edge" points={NODES.map((p) => p.join(',')).join(' ')} pathLength={1} />
      <path className="lm-arrow" d="M24 29v9m-4.5-4.5L24 38l4.5-4.5" />
      {NODES.map(([x, y], i) => (
        <circle
          key={i}
          className={i === AI ? 'lm-node ai' : 'lm-node'}
          cx={x}
          cy={y}
          r={i === AI ? 4.2 : 3.4}
          style={{ '--i': i, transformOrigin: `${x}px ${y}px` } as CSSProperties}
        />
      ))}
    </svg>
  );
}

/** Marca + nombre, como aparece en la barra superior. */
export function Logo({ size = 28, animate = false, small = false }: { size?: number; animate?: boolean; small?: boolean }) {
  return (
    <div className={`brand flex items-center font-extrabold ${small ? 'gap-1.5 text-[15px]' : 'gap-2 text-[19px]'} tracking-[-.5px]${animate ? ' anim' : ''}`}>
      <LogoMark size={size} animate={animate} />
      {/* En el editor el nombre del proyecto importa más: debajo de 1500 px queda solo la marca. */}
      <span className={`brand-word${small ? ' max-[1500px]:hidden' : ''}`}>emede</span>
    </div>
  );
}

/** Duración de la presentación; el desvanecido final está en styles.css (.splash). */
const SPLASH_MS = 5000;

/**
 * Presentación a pantalla completa al abrir la app; después queda el dashboard.
 * Tapa la interfaz, así que un clic o una tecla la saltean (y ese clic no llega a lo que hay debajo).
 */
export function Splash() {
  const [on, setOn] = useState(() => !reducedMotion());
  useEffect(() => {
    if (!on) return;
    const skip = () => setOn(false);
    const id = window.setTimeout(skip, SPLASH_MS);
    window.addEventListener('keydown', skip);
    return () => {
      window.clearTimeout(id);
      window.removeEventListener('keydown', skip);
    };
  }, [on]);
  if (!on) return null;
  return (
    <div className="splash fixed inset-0 z-100 grid cursor-pointer place-items-center bg-bg" aria-hidden="true" onClick={() => setOn(false)}>
      <div className="flex flex-col items-center gap-3.5">
        <LogoMark size={112} animate />
        <div className="splash-word text-[34px] font-extrabold tracking-[-1px]">emede</div>
      </div>
    </div>
  );
}

const reducedMotion = () => typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
