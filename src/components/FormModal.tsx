import React from 'react';
import { FormModalHeader } from './FormModalHeader';

export interface FormModalProps {
  title: string;
  subtitle?: string;
  icon?: string;
  onClose: () => void;
  /** Chamado ao submeter (Enter ou botão). */
  onSubmit: () => void | Promise<void>;
  submitLabel?: string;
  submitDisabled?: boolean;
  submitTitle?: string;
  /** Largura máxima, por omissão max-w-3xl. */
  widthClass?: string;
  children: React.ReactNode;
}

/**
 * Janela de formulário com o mesmo aspecto do formulário das Atividades
 * Extracurriculares: fundo escurecido, cabeçalho azul, corpo com scroll e rodapé
 * com Cancelar/Guardar.
 */
export const FormModal: React.FC<FormModalProps> = ({
  title,
  subtitle,
  icon,
  onClose,
  onSubmit,
  submitLabel = 'Guardar',
  submitDisabled,
  submitTitle,
  widthClass = 'max-w-3xl',
  children
}) => (
  <div
    className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-3 sm:p-6"
    onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
  >
    <form
      onSubmit={(e) => { e.preventDefault(); if (!submitDisabled) void onSubmit(); }}
      className={`bg-white ${widthClass} w-full shadow-2xl border border-slate-400 flex flex-col max-h-[94vh]`}
    >
      <FormModalHeader title={title} subtitle={subtitle} icon={icon} onClose={onClose} />
      <div className="flex-1 overflow-y-auto p-6 space-y-5 text-xs">{children}</div>
      <div className="px-6 py-4 bg-slate-100 border-t border-slate-300 flex items-center justify-end gap-3">
        <button type="button" onClick={onClose} className="px-5 py-2 bg-slate-300 hover:bg-slate-400 text-slate-900 font-bold text-xs cursor-pointer">Cancelar</button>
        <button
          type="submit"
          disabled={submitDisabled}
          title={submitTitle}
          className="px-5 py-2 bg-[#0b1f3a] hover:bg-[#7a0c0c] text-white font-bold text-xs cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
        >
          {submitLabel}
        </button>
      </div>
    </form>
  </div>
);
