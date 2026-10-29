import React from 'react';

export type IconButtonTone = 'neutral' | 'primary' | 'danger' | 'success' | 'info';

export interface IconButtonProps {
  /** Nome do ícone Material Symbols (ex.: "add", "edit", "delete"). */
  icon: string;
  /** Texto do tooltip e do leitor de ecrã (obrigatório: o botão não tem texto visível). */
  label: string;
  onClick?: () => void;
  disabled?: boolean;
  tone?: IconButtonTone;
  /** "solid" = botão de ação principal (fundo azul); "plain" = botão de linha de tabela. */
  variant?: 'solid' | 'plain';
  /** Tooltip alternativo quando desativado (ex.: falta de permissão). */
  disabledTitle?: string;
  /** Mostra o texto do rótulo ao lado do ícone (apenas na variante "solid"). */
  showText?: boolean;
}

const PLAIN: Record<IconButtonTone, string> = {
  neutral: 'text-slate-500 hover:text-[#0b1f3a] hover:bg-slate-100',
  primary: 'text-[#0b1f3a] hover:bg-slate-100',
  info: 'text-slate-500 hover:text-blue-700 hover:bg-slate-100',
  success: 'text-slate-500 hover:text-emerald-700 hover:bg-emerald-50',
  danger: 'text-slate-400 hover:text-red-600 hover:bg-red-50'
};

/** Botão só com ícone, no estilo dos botões de ação das Atividades Extracurriculares. */
export const IconButton: React.FC<IconButtonProps> = ({
  icon,
  label,
  onClick,
  disabled,
  tone = 'neutral',
  variant = 'plain',
  disabledTitle,
  showText = false
}) => {
  const solidWithText = variant === 'solid' && showText;
  const cls =
    variant === 'solid'
      ? solidWithText
        ? 'h-10 px-4 gap-2 rounded-xl bg-[#0b1f3a] hover:bg-[#7a0c0c] text-white text-xs font-bold shadow-sm active:scale-[0.98] transition-all'
        : tone === 'danger'
          ? 'w-10 h-10 rounded-xl bg-red-600 hover:bg-red-700 text-white shadow-sm active:scale-[0.98] transition-all'
          : 'w-10 h-10 rounded-xl bg-[#0b1f3a] hover:bg-[#7a0c0c] text-white shadow-sm active:scale-[0.98] transition-all'
      : `p-1.5 rounded-lg ${PLAIN[tone]}`;
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={disabled && disabledTitle ? disabledTitle : label}
      aria-label={label}
      className={`inline-flex items-center justify-center shrink-0 cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed ${cls}`}
    >
      <span className="material-symbols-outlined text-[18px]" aria-hidden="true">{icon}</span>
      {solidWithText && <span>{label}</span>}
    </button>
  );
};

/** Ícone pequeno para dentro de botões com texto (ex.: <BtnIcon n="save" /> Guardar). */
export const BtnIcon: React.FC<{ n: string }> = ({ n }) => (
  <span className="material-symbols-outlined text-[16px] leading-none" aria-hidden="true">{n}</span>
);

/** Botão de ação (fundo azul habitual) com ícone e nome — para botões fora de linhas de tabela. */
export const BTN_ACTION = 'inline-flex items-center justify-center gap-1.5 h-9 px-3 bg-[#0b1f3a] text-white text-xs font-bold rounded-lg hover:bg-[#12315c] active:scale-[0.98] transition disabled:opacity-40 disabled:cursor-not-allowed';
