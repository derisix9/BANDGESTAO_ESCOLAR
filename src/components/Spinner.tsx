import React from 'react';

export interface SpinnerProps {
  /** Diâmetro em pixels (por omissão 16). */
  size?: number;
  /** Classes extra — use uma classe text-* para mudar a cor (usa currentColor, ex. "text-white" sobre botões azuis). */
  className?: string;
}

const BARS = 12;

/**
 * Indicador de carregamento estilo iOS: 12 barras arredondadas que se acendem em sequência.
 * Sem classe text-*, usa o azul da barra lateral (#12498A; mais claro no modo escuro).
 * As animações estão em index.css (.bm-spinner / bm-bar-fade).
 */
export const Spinner: React.FC<SpinnerProps> = ({ size = 16, className = '' }) => {
  const hasColor = /(^|\s)text-/.test(className);
  return (
    <svg
      className={`inline-block ${hasColor ? '' : 'bm-spinner'} ${className}`}
      style={{ width: size, height: size }}
      viewBox="0 0 100 100"
      role="status"
      aria-label="A carregar"
    >
      {Array.from({ length: BARS }, (_, i) => (
        <rect
          key={i}
          x="45.5" y="8" width="9" height="25" rx="4.5"
          fill="currentColor"
          className="bm-spinner-bar"
          transform={`rotate(${i * (360 / BARS)} 50 50)`}
          style={{ animationDelay: `${-1 + i / BARS}s` }}
        />
      ))}
    </svg>
  );
};

export default Spinner;
