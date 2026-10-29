import React, { useEffect, useRef } from 'react';

export interface AppAlertModalProps {
  isOpen: boolean;
  title?: string;
  message: string;
  variant?: 'info' | 'warning' | 'error';
  onClose: () => void;
}

/**
 * Caixa de diálogo personalizada do sistema BandMed.
 * Substitui o alert() nativo do navegador (que mostra "localhost:3000 diz:")
 * por uma janela modal com a identidade visual do próprio sistema.
 */
export const AppAlertModal: React.FC<AppAlertModalProps> = ({
  isOpen,
  title,
  message,
  variant = 'warning',
  onClose
}) => {
  const okButtonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (isOpen) {
      okButtonRef.current?.focus();
    }
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Enter' || e.key === 'Escape') {
        e.preventDefault();
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const accentColor = variant === 'error' ? 'border-red-600' : variant === 'info' ? 'border-[#0b1f3a]' : 'border-[#7a0c0c]';
  const iconBg = variant === 'error' ? 'bg-red-50 border-red-500 text-red-600'
    : variant === 'info' ? 'bg-sky-50 border-sky-600 text-sky-700' : 'bg-amber-50 border-amber-500 text-amber-600';
  const icon = variant === 'error' ? 'cancel' : variant === 'info' ? 'info' : 'warning';
  const defaultTitle = variant === 'error' ? 'Erro do Sistema' : variant === 'info' ? 'Informação' : 'Atenção';

  return (
    <div
      data-no-resize
      data-acl-ignore
      className="fixed inset-0 z-[100001] flex items-center justify-center bg-black/60 backdrop-blur-xs p-4 animate-in fade-in duration-150"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
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
          <p className="text-xs font-medium text-slate-600 leading-relaxed whitespace-pre-wrap break-words max-h-[50vh] overflow-y-auto w-full">
            {message}
          </p>
        </div>

        <div className="flex justify-center px-6 pb-5">
          <button
            ref={okButtonRef}
            type="button"
            onClick={onClose}
            className="px-8 py-2 text-xs font-bold uppercase tracking-wide bg-[#0b1f3a] text-white hover:bg-[#132c52] rounded-none cursor-pointer"
          >
            Fechar
          </button>
        </div>
      </div>
    </div>
  );
};
