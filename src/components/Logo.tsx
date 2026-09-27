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
    <svg className={`logo-mark${animate ? ' anim' : ''}`} width={size} height={size} viewBox="0 0 48 48" aria-hidden="true" focusable="false">
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
    <div className={`brand${small ? ' small-brand' : ''}${animate ? ' anim' : ''}`}>
      <LogoMark size={size} animate={animate} />
      <span className="brand-word">emede<span>.md</span></span>
    </div>
  );
}

const SPLASH_MS = 1700;

/** Presentación a pantalla completa al abrir la app. No bloquea clics y se va sola. */
export function Splash() {
  const [on, setOn] = useState(() => !reducedMotion());
  useEffect(() => {
    if (!on) return;
    const id = window.setTimeout(() => setOn(false), SPLASH_MS);
    return () => window.clearTimeout(id);
  }, [on]);
  if (!on) return null;
  return (
    <div className="splash" aria-hidden="true">
      <div className="splash-inner">
        <LogoMark size={112} animate />
        <div className="splash-word">emede<span>.md</span></div>
      </div>
    </div>
  );
}

const reducedMotion = () => typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
