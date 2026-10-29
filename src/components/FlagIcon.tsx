import React from 'react';

/** Bandeiras em SVG (não dependem de emojis, que em Windows aparecem como "AO"/"US"). */
export type FlagCode = 'AO' | 'US';

const Angola: React.FC = () => (
  <svg viewBox="0 0 30 20" xmlns="http://www.w3.org/2000/svg" aria-hidden="true" focusable="false">
    <rect width="30" height="10" fill="#CC092F" />
    <rect y="10" width="30" height="10" fill="#000" />
    {/* meia-engrenagem */}
    <path d="M9.2 14.2a6 6 0 0 1 11.6 0" fill="none" stroke="#FFCB00" strokeWidth="1.5" />
    <g stroke="#FFCB00" strokeWidth="1.1" strokeLinecap="round">
      <path d="M8 11.4l1.4.9M10 8.6l.9 1.3M13 7.2l.4 1.5M17 7.2l-.4 1.5M20 8.6l-.9 1.3M22 11.4l-1.4.9" />
    </g>
    {/* catana */}
    <path d="M12.3 16.6c2.7-.4 5-2.2 6.2-4.7l1 .5c-1.4 3-4 5-7.2 5.4z" fill="#FFCB00" />
    {/* estrela */}
    <path d="M15 8.9l.9 2.2 2.4.1-1.8 1.5.6 2.3-2.1-1.3-2.1 1.3.6-2.3-1.8-1.5 2.4-.1z" fill="#FFCB00" />
  </svg>
);

const USA: React.FC = () => {
  const stripes = Array.from({ length: 7 }, (_, i) => i);
  const stars: Array<[number, number]> = [];
  for (let r = 0; r < 4; r++) for (let c = 0; c < 5; c++) stars.push([1.9 + c * 2.1 + (r % 2 ? 1 : 0), 1.7 + r * 1.9]);
  return (
    <svg viewBox="0 0 30 20" xmlns="http://www.w3.org/2000/svg" aria-hidden="true" focusable="false">
      <rect width="30" height="20" fill="#fff" />
      {stripes.map((i) => (
        <rect key={i} y={(i * 2 * 20) / 13} width="30" height={20 / 13} fill="#B22234" />
      ))}
      <rect width="12.6" height={(7 * 20) / 13} fill="#3C3B6E" />
      {stars.map(([x, y], i) => (
        <circle key={i} cx={x} cy={y} r="0.55" fill="#fff" />
      ))}
    </svg>
  );
};

export const FlagIcon: React.FC<{ code: FlagCode; className?: string }> = ({ code, className = 'w-6 h-4' }) => (
  <span className={`inline-block shrink-0 overflow-hidden border border-white/40 ${className}`} style={{ lineHeight: 0 }}>
    <span className="block w-full h-full [&>svg]:w-full [&>svg]:h-full">{code === 'AO' ? <Angola /> : <USA />}</span>
  </span>
);

/** Língua da interface → bandeira. */
export const FLAG_BY_LANG: Record<string, FlagCode> = { pt: 'AO', en: 'US' };
