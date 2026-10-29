import React, { useState } from 'react';
import { Spinner } from './Spinner';
import { OperationStatusModal } from './OperationStatusModal';

export interface AsyncButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  children?: React.ReactNode;
  loadingText?: string;
  successText?: string;
  icon?: string;
  variant?: 'primary' | 'danger' | 'secondary' | 'outline' | 'success';
  status?: 'idle' | 'loading' | 'success';
  skipLoading?: boolean;
  useFeedbackModal?: boolean;
  onAsyncClick?: () => Promise<void> | void;
  onSuccessComplete?: () => void;
  successDuration?: number;
}

export const AsyncButton: React.FC<AsyncButtonProps> = ({
  children,
  loadingText = 'A processar...',
  successText = 'Operação feita com sucesso!',
  icon,
  variant = 'primary',
  status: controlledStatus,
  skipLoading = false,
  useFeedbackModal = true,
  onAsyncClick,
  onSuccessComplete,
  onClick,
  successDuration = 1200,
  className = '',
  disabled,
  type = 'button',
  ...rest
}) => {
  const [internalStatus, setInternalStatus] = useState<'idle' | 'loading' | 'success'>('idle');
  const [modalOpen, setModalOpen] = useState(false);

  const currentStatus = controlledStatus !== undefined ? controlledStatus : internalStatus;

  const handleClick = async (e: React.MouseEvent<HTMLButtonElement>) => {
    if (currentStatus !== 'idle') return;

    if (onClick) {
      onClick(e);
    }

    if (onAsyncClick) {
      if (!skipLoading) {
        setInternalStatus('loading');
        if (useFeedbackModal) setModalOpen(true);
      }
      try {
        const startTime = Date.now();
        await onAsyncClick();
        const elapsed = Date.now() - startTime;
        const minLoadingWait = 650;
        if (elapsed < minLoadingWait && !skipLoading) {
          await new Promise((res) => setTimeout(res, minLoadingWait - elapsed));
        }

        setInternalStatus('success');
        setTimeout(() => {
          setModalOpen(false);
          setInternalStatus('idle');
          if (onSuccessComplete) onSuccessComplete();
        }, successDuration);
      } catch (err) {
        setModalOpen(false);
        setInternalStatus('idle');
      }
    } else if (type === 'submit' && controlledStatus === undefined) {
      if (!skipLoading) {
        setInternalStatus('loading');
        if (useFeedbackModal) setModalOpen(true);
        setTimeout(() => {
          setInternalStatus('success');
          setTimeout(() => {
            setModalOpen(false);
            setInternalStatus('idle');
            if (onSuccessComplete) onSuccessComplete();
          }, successDuration);
        }, 650);
      } else {
        setInternalStatus('success');
        if (useFeedbackModal) setModalOpen(true);
        setTimeout(() => {
          setModalOpen(false);
          setInternalStatus('idle');
          if (onSuccessComplete) onSuccessComplete();
        }, successDuration);
      }
    }
  };

  const getVariantClasses = () => {
    if (currentStatus === 'success') {
      return 'bg-emerald-700 hover:bg-emerald-700 border-emerald-700 text-white font-bold';
    }

    switch (variant) {
      case 'danger':
        return 'bg-[#ac332b] hover:bg-red-800 border-[#ac332b] text-white';
      case 'secondary':
        return 'bg-slate-200 hover:bg-slate-300 border-slate-300 text-slate-800';
      case 'outline':
        return 'bg-white hover:bg-slate-50 border-slate-300 text-slate-700';
      case 'success':
        return 'bg-emerald-600 hover:bg-emerald-700 border-emerald-600 text-white';
      case 'primary':
      default:
        return 'bg-[#0b1f3a] hover:bg-[#7a0c0c] border-[#0b1f3a] text-white';
    }
  };

  return (
    <>
      <button
        type={type}
        disabled={disabled || currentStatus !== 'idle'}
        onClick={handleClick}
        className={`relative inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-none font-bold text-xs uppercase tracking-wider transition-all duration-200 cursor-pointer border select-none disabled:opacity-75 disabled:cursor-not-allowed ${getVariantClasses()} ${className}`}
        {...rest}
      >
        {currentStatus === 'loading' && (
          <>
            <Spinner size={16} className="text-white shrink-0" />
            <span>{loadingText}</span>
          </>
        )}

        {currentStatus === 'success' && (
          <>
            <span className="material-symbols-outlined text-[18px] text-white shrink-0">check_circle</span>
            <span>{successText}</span>
          </>
        )}

        {currentStatus === 'idle' && (
          <>
            {icon && <span className="material-symbols-outlined text-[17px] shrink-0">{icon}</span>}
            {children}
          </>
        )}
      </button>

      {useFeedbackModal && (
        <OperationStatusModal
          isOpen={modalOpen}
          status={currentStatus === 'loading' ? 'loading' : 'success'}
          loadingMessage={loadingText}
          successMessage={successText || 'Operação feita com sucesso!'}
        />
      )}
    </>
  );
};
