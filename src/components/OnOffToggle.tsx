import React from 'react';

interface OnOffToggleProps {
  on: boolean;
  onChange: (v: boolean) => void;
  onLabel: string;
  offLabel: string;
  disabled?: boolean;
  ariaLabel?: string;
  width?: number;
  height?: number;
}

/**
 * Interruptor ligar/desligar: OFF = vermelho (botão à esquerda), ON = verde (botão à direita).
 * Usa <div role="switch"> com estilos inline para não ser afectado pelas regras globais de <button>.
 */
export const OnOffToggle: React.FC<OnOffToggleProps> = ({ on, onChange, onLabel, offLabel, disabled, ariaLabel, width, height = 28 }) => {
  const pad = 3;
  const knob = height - pad * 2;
  const gap = 6;   // espaço entre o texto e o botão redondo
  const edge = 9;  // margem do texto no lado oposto ao botão
  const toggle = () => { if (!disabled) onChange(!on); };
  const fs = height <= 26 ? 9 : 10;
  const textStyle: React.CSSProperties = {
    gridArea: '1 / 1', fontWeight: 800, fontSize: fs, letterSpacing: '.04em', textTransform: 'uppercase',
    whiteSpace: 'nowrap', color: '#fff', pointerEvents: 'none', textAlign: on ? 'left' : 'right',
  };
  return (
    <div
      role="switch"
      aria-checked={on}
      aria-label={ariaLabel || `${offLabel} / ${onLabel}`}
      aria-disabled={disabled || undefined}
      tabIndex={disabled ? -1 : 0}
      onClick={toggle}
      onKeyDown={(e) => { if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); toggle(); } }}
      title={on ? onLabel : offLabel}
      style={{
        position: 'relative', display: 'inline-grid', alignItems: 'center', height, minWidth: width, borderRadius: height,
        flexShrink: 0, userSelect: 'none', boxSizing: 'border-box',
        // A largura acompanha o comprimento do texto: os dois rótulos ocupam a mesma célula (o do estado
        // inactivo fica invisível), por isso o interruptor tem sempre o tamanho do rótulo mais comprido.
        paddingLeft: on ? edge : knob + pad + gap, paddingRight: on ? knob + pad + gap : edge,
        background: on ? '#16a34a' : '#dc2626', boxShadow: 'inset 0 1px 3px rgba(0,0,0,.25), 0 0 0 2px #e5e7eb',
        transition: 'background-color .18s', cursor: disabled ? 'not-allowed' : 'pointer', opacity: disabled ? 0.4 : 1,
      }}
    >
      <span
        style={{
          position: 'absolute', top: pad, left: on ? undefined : pad, right: on ? pad : undefined, width: knob, height: knob, borderRadius: '50%',
          background: 'radial-gradient(circle at 35% 30%, #ffffff, #d4d4d8)', boxShadow: '0 1px 3px rgba(0,0,0,.4)',
        }}
      />
      <span style={{ ...textStyle, visibility: on ? 'hidden' : 'visible' }}>{offLabel}</span>
      <span style={{ ...textStyle, visibility: on ? 'visible' : 'hidden' }}>{onLabel}</span>
    </div>
  );
};
