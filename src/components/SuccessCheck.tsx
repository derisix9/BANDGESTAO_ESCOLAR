import React from 'react';

/**
 * «Feito»: quadrado arredondado que aparece com ressalto e um visto que se desenha.
 * Cores adaptadas ao Bandmed: verde de sucesso e visto branco com reflexo no azul da barra lateral.
 * As animações estão em index.css (.bm-check-*). Toca uma vez.
 */
export const SuccessCheck: React.FC<{ size?: number; className?: string }> = ({ size = 72, className = '' }) => (
  <svg className={`bm-check-pop ${className}`} style={{ width: size, height: size }} viewBox="0 0 96 96" role="img" aria-label="Operação concluída">
    <defs>
      <linearGradient id="bmCheckBg" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0" stopColor="#34d399" />
        <stop offset="1" stopColor="#059669" />
      </linearGradient>
    </defs>
    <rect x="6" y="6" width="84" height="84" rx="20" fill="url(#bmCheckBg)" />
    {/* reflexo azul (cor da barra lateral) */}
    <path d="M27 51 L43 67 L73 31" pathLength={1} className="bm-check-stroke bm-check-echo" stroke="#12498A" strokeOpacity="0.85" strokeWidth="9" strokeLinecap="round" strokeLinejoin="round" fill="none" transform="translate(3 -3)" />
    <path d="M27 51 L43 67 L73 31" pathLength={1} className="bm-check-stroke" stroke="#ffffff" strokeWidth="9" strokeLinecap="round" strokeLinejoin="round" fill="none" />
  </svg>
);

export default SuccessCheck;
