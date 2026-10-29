import React from 'react';
import { Spinner } from './Spinner';
import { SuccessCheck } from './SuccessCheck';

export interface OperationStatusModalProps {
  isOpen: boolean;
  status: 'loading' | 'success' | 'error';
  loadingMessage?: string;
  successMessage?: string;
  /** Linha de pormenor opcional por baixo da mensagem de sucesso. */
  successDetails?: string;
  errorMessage?: string;
  errorDetails?: string;
}

export const OperationStatusModal: React.FC<OperationStatusModalProps> = ({
  isOpen,
  status,
  loadingMessage = 'A processar operação...',
  successMessage = 'Operação feita com sucesso!',
  successDetails,
  errorMessage = 'Operação Não Realizada',
  errorDetails
}) => {
  if (!isOpen) return null;

  return (
    <div data-no-resize data-acl-ignore className="fixed inset-0 z-[100000] flex items-center justify-center bg-black/60 backdrop-blur-xs p-4 animate-in fade-in duration-150 select-none pointer-events-auto">
      <div
        className={`bg-white rounded-none border-2 shadow-2xl p-8 max-w-sm w-full mx-auto flex flex-col items-center justify-center text-center min-h-[190px] transition-all ${
          status === 'error' ? 'border-red-600' : 'border-[#0b1f3a]'
        }`}
      >
        {status === 'loading' && (
          <div className="flex flex-col items-center gap-4 py-2 animate-in fade-in">
            {/* Circular spinner */}
            <Spinner size={64} />
            <p className="text-xs font-bold text-slate-700 uppercase tracking-wider">
              {loadingMessage}
            </p>
          </div>
        )}

        {status === 'success' && (
          <div className="flex flex-col items-center gap-3 py-2 animate-in zoom-in-95 duration-200">
            <SuccessCheck size={76} />
            {/* Success message in GREEN LETTERS as requested */}
            <p className="text-base font-black text-emerald-600 tracking-wide uppercase mt-1">
              {successMessage}
            </p>
            {successDetails && (
              <p className="text-xs font-semibold text-slate-600 mt-0.5 max-w-xs leading-relaxed break-words max-h-40 overflow-y-auto">
                {successDetails}
              </p>
            )}
          </div>
        )}

        {status === 'error' && (
          <div className="flex flex-col items-center gap-2 py-2 animate-in zoom-in-95 duration-200">
            {/* Red error/block circle */}
            <div className="w-14 h-14 rounded-full bg-red-50 border-2 border-red-500 flex items-center justify-center text-red-600 shadow-xs">
              <span className="material-symbols-outlined text-3xl">cancel</span>
            </div>
            {/* Error message in RED LETTERS as requested: Operação Não Realizada */}
            <p className="text-base font-black text-red-600 tracking-wide uppercase mt-1">
              {errorMessage}
            </p>
            {errorDetails && (
              <p className="text-xs font-semibold text-slate-600 mt-0.5 max-w-xs leading-relaxed">
                {errorDetails}
              </p>
            )}
          </div>
        )}
      </div>
    </div>
  );
};
