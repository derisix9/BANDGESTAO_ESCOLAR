import React, { useEffect, useRef } from 'react';

export interface AppConfirmModalProps {
  isOpen: boolean;
  title?: string;
  message: string;
  variant?: 'info' | 'warning' | 'error';
  confirmLabel?: string;
  cancelLabel?: string;
  onConfirm: () => void;
  onCancel: () => void;
}

/**
 * Caixa de confirmação (Sim/Não) do sistema BandMed.
 * Substitui o window.confirm() nativo do navegador (que mostra o prefixo
 * "localhost:3000 diz:") por uma janela modal com a identidade visual do
 * próprio sistema — o mesmo padrão já usado no AppAlertModal.
 */
export const AppConfirmModal: React.FC<AppConfirmModalProps> = ({
  isOpen,
  title,
  message,
  variant = 'warning',
  confirmLabel,
  cancelLabel,
  onConfirm,
  onCancel
}) => {
  const confirmButtonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (isOpen) {
      confirmButtonRef.current?.focus();
    }
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onCancel();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onCancel]);

  if (!isOpen) return null;

  const accentColor = variant === 'error' ? 'border-red-600' : 'border-[#7a0c0c]';
  const iconBg = variant === 'error' ? 'bg-red-50 border-red-500 text-red-600' : 'bg-amber-50 border-amber-500 text-amber-600';
  const icon = variant === 'error' ? 'cancel' : 'help';
  const defaultTitle = variant === 'error' ? 'Confirmação Necessária' : 'Atenção';

  return (
    <div
      data-no-resize
      data-acl-ignore
      className="fixed inset-0 z-[100001] flex items-center justify-center bg-black/60 backdrop-blur-xs p-4 animate-in fade-in duration-150"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onCancel();
      }}
    >
      <div
        role="alertdialog"
        aria-modal="true"
        className={`bg-white rounded-none border-2 ${accentColor} shadow-2xl w-full max-w-md mx-auto flex flex-col animate-in zoom-in-95 duration-200`}
      >
        {/* Cabeçalho identificado com o sistema, no lugar do "localhost:3000 diz:" do navegador */}
        <div className="flex items-center gap-2 px-4 py-2 bg-[#0b1f3a] text-white">
          <span className="material-symbols-outlined text-[16px]">school</span>
          <span className="text-[11px] font-bold uppercase tracking-wider">Sistema BandMed</span>
        </div>

        <div className="p-6 flex flex-col items-center text-center gap-3">
          <div className={`w-12 h-12 rounded-full border-2 flex items-center justify-center shadow-xs ${iconBg}`}>
            <span className="material-symbols-outlined text-2xl">{icon}</span>
          </div>
          <p className="text-sm font-black uppercase tracking-wide text-slate-800">
            {title || defaultTitle}
          </p>
          <p className="text-xs font-medium text-slate-600 leading-relaxed whitespace-pre-wrap break-words">
            {message}
          </p>
        </div>

        <div className="flex items-center justify-center gap-3 px-6 pb-5">
          <button
            type="button"
            onClick={onCancel}
            className="px-6 py-2 text-xs font-bold uppercase tracking-wide bg-slate-200 text-slate-700 hover:bg-slate-300 rounded-none cursor-pointer"
          >
            {cancelLabel || 'Cancelar'}
          </button>
          <button
            ref={confirmButtonRef}
            type="button"
            onClick={onConfirm}
            className="px-6 py-2 text-xs font-bold uppercase tracking-wide bg-[#0b1f3a] text-white hover:bg-[#132c52] rounded-none cursor-pointer"
          >
            {confirmLabel || 'Continuar'}
          </button>
        </div>
      </div>
    </div>
  );
};
