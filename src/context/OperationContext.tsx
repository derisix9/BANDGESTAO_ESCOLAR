import { isBulkAutoConfirm } from '../utils/bulkConfirm';
import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { OperationStatusModal } from '../components/OperationStatusModal';
import { AppAlertModal } from '../components/AppAlertModal';
import { AppConfirmModal } from '../components/AppConfirmModal';
import { hasPermission } from '../utils/permissions';
import { dbService } from '../services/db';
import { UserRole } from '../types';

export class PermissionDeniedError extends Error {
  constructor(message = 'Acesso não autorizado: Esta operação está desabilitada para o seu perfil nas permissões do sistema.') {
    super(message);
    this.name = 'PermissionDeniedError';
  }
}

export interface GlobalOperationOptions {
  loadingMessage?: string;
  successMessage?: string;
  /** Pormenor opcional por baixo da mensagem de sucesso (ex.: «Fatura FT 2026/012 registada»). */
  successDetails?: string;
  /**
   * Texto de sucesso calculado DEPOIS da operação (ex.: usa o resultado). Se for curto e
   * terminar em «com sucesso» vai como título; senão vai como pormenor. Tem prioridade sobre
   * successMessage/successDetails.
   */
  resolveSuccessText?: () => string | undefined;
  errorMessage?: string;
  errorDetails?: string;
  minDuration?: number;
  successDuration?: number;
  errorDuration?: number;
  requiredRule?: string;
  userRole?: string | UserRole;
  onSuccess?: () => void;
  onError?: (err: any) => void;
}

interface OperationState {
  isOpen: boolean;
  status: 'loading' | 'success' | 'error' | 'idle';
  loadingMessage: string;
  successMessage: string;
  /** Linha de pormenor (opcional) por baixo da mensagem de sucesso. */
  successDetails?: string;
  errorMessage?: string;
  errorDetails?: string;
}

type OperationListener = (state: OperationState) => void;

class OperationEventManager {
  private listeners: Set<OperationListener> = new Set();
  private currentState: OperationState = {
    isOpen: false,
    status: 'idle',
    loadingMessage: 'A processar operação...',
    successMessage: 'Operação feita com sucesso!',
    errorMessage: 'Operação Não Realizada'
  };

  public subscribe(listener: OperationListener) {
    this.listeners.add(listener);
    listener(this.currentState);
    return () => {
      this.listeners.delete(listener);
    };
  }

  public notify(newState: Partial<OperationState>) {
    this.currentState = { ...this.currentState, ...newState };
    this.listeners.forEach((listener) => {
      try {
        listener(this.currentState);
      } catch (err) {
        console.error('Erro ao notificar listener de operação:', err);
      }
    });
  }

  public getState() {
    return this.currentState;
  }
}

export const operationManager = new OperationEventManager();

// ---------------------------------------------------------------------------
// Caixa de diálogo personalizada (substitui o alert() nativo do navegador)
// ---------------------------------------------------------------------------

export interface AppAlertState {
  isOpen: boolean;
  title?: string;
  message: string;
  variant: 'info' | 'warning' | 'error';
}

type AlertListener = (state: AppAlertState) => void;

class AppAlertManager {
  private listeners: Set<AlertListener> = new Set();
  private currentState: AppAlertState = {
    isOpen: false,
    message: '',
    variant: 'warning'
  };

  public subscribe(listener: AlertListener) {
    this.listeners.add(listener);
    listener(this.currentState);
    return () => {
      this.listeners.delete(listener);
    };
  }

  public notify(newState: Partial<AppAlertState>) {
    this.currentState = { ...this.currentState, ...newState };
    this.listeners.forEach((listener) => {
      try {
        listener(this.currentState);
      } catch (err) {
        console.error('Erro ao notificar listener de alerta:', err);
      }
    });
  }
}

export const appAlertManager = new AppAlertManager();

/**
 * Mostra uma caixa de diálogo personalizada do sistema BandMed, no lugar do
 * alert() nativo do navegador (que exibe o prefixo "localhost:3000 diz:").
 */
export function showAppAlert(message: string, options?: { title?: string; variant?: 'info' | 'warning' | 'error' }) {
  appAlertManager.notify({
    isOpen: true,
    message,
    title: options?.title,
    variant: options?.variant || 'warning'
  });
}

export function closeAppAlert() {
  appAlertManager.notify({ isOpen: false });
}

// ---------------------------------------------------------------------------
// Caixa de confirmação personalizada (substitui o window.confirm() nativo do
// navegador, que mostra o prefixo "localhost:3000 diz:" em vez da identidade
// visual do sistema BandMed).
// ---------------------------------------------------------------------------

export interface AppConfirmState {
  isOpen: boolean;
  title?: string;
  message: string;
  variant: 'info' | 'warning' | 'error';
  confirmLabel?: string;
  cancelLabel?: string;
}

type ConfirmListener = (state: AppConfirmState) => void;

class AppConfirmManager {
  private listeners: Set<ConfirmListener> = new Set();
  private currentState: AppConfirmState = {
    isOpen: false,
    message: '',
    variant: 'warning'
  };
  private pendingResolve: ((value: boolean) => void) | null = null;

  public subscribe(listener: ConfirmListener) {
    this.listeners.add(listener);
    listener(this.currentState);
    return () => {
      this.listeners.delete(listener);
    };
  }

  public notify(newState: Partial<AppConfirmState>) {
    this.currentState = { ...this.currentState, ...newState };
    this.listeners.forEach((listener) => {
      try {
        listener(this.currentState);
      } catch (err) {
        console.error('Erro ao notificar listener de confirmação:', err);
      }
    });
  }

  public setPendingResolve(resolve: (value: boolean) => void) {
    this.pendingResolve = resolve;
  }

  public resolve(value: boolean) {
    const resolve = this.pendingResolve;
    this.pendingResolve = null;
    this.notify({ isOpen: false });
    if (resolve) resolve(value);
  }
}

export const appConfirmManager = new AppConfirmManager();

/**
 * Mostra uma caixa de confirmação (Sim/Não) do sistema BandMed, no lugar do
 * window.confirm() nativo do navegador. Devolve true se o utilizador confirmar.
 */
export function showAppConfirm(
  message: string,
  options?: { title?: string; variant?: 'info' | 'warning' | 'error'; confirmLabel?: string; cancelLabel?: string }
): Promise<boolean> {
  if (isBulkAutoConfirm()) return Promise.resolve(true);   // eliminação em lote já confirmada
  return new Promise((resolve) => {
    appConfirmManager.setPendingResolve(resolve);
    appConfirmManager.notify({
      isOpen: true,
      message,
      title: options?.title,
      variant: options?.variant || 'warning',
      confirmLabel: options?.confirmLabel,
      cancelLabel: options?.cancelLabel
    });
  });
}

export function resolveAppConfirm(value: boolean) {
  appConfirmManager.resolve(value);
}

// ---------------------------------------------------------------------------
// Feedback de operação para os sítios onde a gravação já foi feita pelo código
// existente (ou o fluxo é demasiado específico para o embrulhar num único
// runGlobalOperation). Usa EXACTAMENTE o mesmo diálogo do login/pagamentos:
// carregamento circular → visto animado com a mensagem a verde.
// Substitui os toasts e faixas verdes soltos ("... salvas com sucesso.").
// ---------------------------------------------------------------------------

let feedbackSeq = 0;
let loadingStartedAt = 0;
const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * Separa um texto de sucesso em título + pormenor para o diálogo: textos curtos do tipo
 * «Caixa aberta com sucesso.» viram título («Caixa aberta com sucesso!»); os restantes
 * ficam com o título padrão e o texto vai por baixo como pormenor.
 */
export function successParts(text: string): { message: string; details?: string } {
  const t = (text || '').trim();
  if (!t) return { message: 'Operação feita com sucesso!' };
  if (t.length <= 60 && /com sucesso[.!]?$/i.test(t)) return { message: t.replace(/\.$/, '!') };
  return { message: 'Operação feita com sucesso!', details: t };
}

export interface OperationFeedbackOptions {
  /** Texto pequeno por baixo do título (ex.: o pormenor do que foi gravado). */
  details?: string;
  /** Mensagem do carregamento, se o diálogo ainda não estiver aberto. */
  loadingMessage?: string;
  minDuration?: number;
  successDuration?: number;
}

/** Abre o diálogo de carregamento já (antes de uma chamada demorada). */
export function beginOperationLoading(loadingMessage = 'A processar operação...') {
  feedbackSeq++;
  loadingStartedAt = Date.now();
  operationManager.notify({
    isOpen: true,
    status: 'loading',
    loadingMessage,
    successMessage: '',
    successDetails: undefined,
    errorMessage: '',
    errorDetails: undefined
  });
}

/**
 * Fecha o carregamento aberto por beginOperationLoading() se, passado um instante,
 * ninguém o tiver convertido em sucesso/erro (ex.: a operação falhou e o erro é
 * mostrado de outra forma). Não toca em diálogos que outra operação tenha aberto.
 */
export function cancelOperationLoading(delayMs = 150) {
  const seq = feedbackSeq;
  setTimeout(() => {
    const st = operationManager.getState();
    if (seq === feedbackSeq && st.isOpen && st.status === 'loading') {
      operationManager.notify({ isOpen: false, status: 'idle' });
    }
  }, delayMs);
}

/**
 * Mostra o sucesso de uma operação: se já houver um carregamento aberto converte-o em
 * sucesso; senão mostra o carregamento (tempo mínimo) e depois o visto animado.
 */
export async function showOperationSuccess(
  message: string = 'Operação feita com sucesso!',
  options?: OperationFeedbackOptions
): Promise<void> {
  const bulk = isBulkAutoConfirm();
  const minDuration = bulk ? 0 : (options?.minDuration ?? 650);
  const baseDuration = bulk ? 0 : (options?.successDuration ?? 1200);
  // Se houver pormenor para ler, dá mais tempo (até 3 s extra).
  const extra = !bulk && options?.details ? Math.min(3000, options.details.length * 22) : 0;

  const cur = operationManager.getState();
  const wasLoading = cur.isOpen && cur.status === 'loading';
  const seq = ++feedbackSeq;

  // minDuration 0 = o chamador já mostrou o seu próprio progresso: vai direto ao sucesso.
  if (!wasLoading && minDuration > 0) {
    loadingStartedAt = Date.now();
    operationManager.notify({
      isOpen: true,
      status: 'loading',
      loadingMessage: options?.loadingMessage || 'A processar operação...',
      successMessage: '',
      successDetails: undefined,
      errorMessage: '',
      errorDetails: undefined
    });
  }

  const elapsed = Date.now() - loadingStartedAt;
  if (elapsed < minDuration) await sleep(minDuration - elapsed);
  if (seq !== feedbackSeq) return;   // outra operação tomou o diálogo

  operationManager.notify({
    isOpen: true,
    status: 'success',
    successMessage: message,
    successDetails: options?.details,
    errorMessage: '',
    errorDetails: undefined
  });

  await sleep(baseDuration + extra);
  if (seq !== feedbackSeq) return;
  operationManager.notify({ isOpen: false, status: 'idle', successDetails: undefined });
}

/**
 * Mostra «Operação Não Realizada» (vermelho) com o motivo — para recusas e falhas
 * que antes apareciam como toast/faixa solta.
 */
export async function showOperationError(
  details: string,
  options?: { message?: string; duration?: number }
): Promise<void> {
  const seq = ++feedbackSeq;
  operationManager.notify({
    isOpen: true,
    status: 'error',
    successMessage: '',
    successDetails: undefined,
    errorMessage: options?.message || 'Operação Não Realizada',
    errorDetails: details
  });
  await sleep(options?.duration ?? Math.min(6000, 2200 + details.length * 20));
  if (seq !== feedbackSeq) return;
  operationManager.notify({ isOpen: false, status: 'idle' });
}

/**
 * Função global para executar qualquer operação de inserção, alteração ou eliminação
 * com efeito de carregamento visual circular e mensagem de confirmação de sucesso (verde)
 * ou erro / bloqueio por permissão (vermelho: "Operação Não Realizada").
 */
export async function runGlobalOperation<T>(
  action: () => Promise<T> | T,
  options?: GlobalOperationOptions
): Promise<T> {
  const loadingMessage = options?.loadingMessage || 'A processar operação...';
  const successMessage = options?.successMessage || 'Operação feita com sucesso!';
  const errorMessage = options?.errorMessage || 'Operação Não Realizada';
  const bulk = isBulkAutoConfirm();   // eliminação em lote: sem pausas artificiais de 650 ms + 1,2 s por registo
  const minDuration = bulk ? 0 : (options?.minDuration ?? 650);
  const successDuration = bulk ? 0 : (options?.successDuration ?? 1200);
  const errorDuration = options?.errorDuration ?? 2200;

  // 1. Iniciar carregamento circular visual
  feedbackSeq++;   // qualquer feedback pós-operação pendente deixa de poder fechar este diálogo
  operationManager.notify({
    isOpen: true,
    status: 'loading',
    loadingMessage,
    successMessage,
    successDetails: undefined,
    errorMessage
  });

  const startTime = Date.now();

  // 2. Verificação de permissões RBAC se especificada
  if (options?.requiredRule) {
    const role = options.userRole || dbService.getDatabase()?.currentUser?.role || 'admin';
    const isAllowed = hasPermission(role, options.requiredRule);

    if (!isAllowed) {
      // Manter o carregamento circular pelo tempo mínimo
      const elapsed = Date.now() - startTime;
      if (elapsed < minDuration) {
        await new Promise((resolve) => setTimeout(resolve, minDuration - elapsed));
      }

      // Apresentar modal vermelho com "Operação Não Realizada"
      operationManager.notify({
        isOpen: true,
        status: 'error',
        loadingMessage,
        successMessage: '',
        errorMessage: 'Operação Não Realizada',
        errorDetails:
          options?.errorDetails ||
          `Acesso bloqueado: A permissão [${options.requiredRule}] está desabilitada para o perfil [${role}].`
      });

      await new Promise((resolve) => setTimeout(resolve, errorDuration));

      operationManager.notify({
        isOpen: false,
        status: 'idle'
      });

      const err = new PermissionDeniedError(
        `Ação não permitida: A permissão [${options.requiredRule}] está desabilitada.`
      );
      if (options?.onError) {
        options.onError(err);
      }
      throw err;
    }
  }

  let result: T;

  try {
    result = await action();
    const elapsed = Date.now() - startTime;
    if (elapsed < minDuration) {
      await new Promise((resolve) => setTimeout(resolve, minDuration - elapsed));
    }

    // Sucesso verde
    let finalSuccessMessage = successMessage;
    let finalSuccessDetails = options?.successDetails;
    if (options?.resolveSuccessText) {
      try {
        const resolved = options.resolveSuccessText();
        if (resolved) {
          const parts = successParts(resolved);
          finalSuccessMessage = parts.message;
          finalSuccessDetails = parts.details;
        }
      } catch { /* mantém a mensagem padrão */ }
    }
    operationManager.notify({
      isOpen: true,
      status: 'success',
      loadingMessage,
      successMessage: finalSuccessMessage,
      successDetails: finalSuccessDetails,
      errorMessage: ''
    });

    await new Promise((resolve) => setTimeout(resolve, successDuration));

    operationManager.notify({
      isOpen: false,
      status: 'idle',
      successDetails: undefined
    });

    if (options?.onSuccess) {
      options.onSuccess();
    }

    return result;
  } catch (error: any) {
    const elapsed = Date.now() - startTime;
    if (elapsed < minDuration) {
      await new Promise((resolve) => setTimeout(resolve, minDuration - elapsed));
    }

    // Erro vermelho: "Operação Não Realizada"
    operationManager.notify({
      isOpen: true,
      status: 'error',
      loadingMessage,
      successMessage: '',
      errorMessage: options?.errorMessage || 'Operação Não Realizada',
      errorDetails: error?.message || options?.errorDetails || 'Não foi possível concluir a ação pretendida.'
    });

    await new Promise((resolve) => setTimeout(resolve, errorDuration));

    operationManager.notify({
      isOpen: false,
      status: 'idle'
    });

    if (options?.onError) {
      options.onError(error);
    }
    throw error;
  }
}

interface OperationContextType {
  runOperation: <T>(action: () => Promise<T> | T, options?: GlobalOperationOptions) => Promise<T>;
  isOperating: boolean;
  status: 'loading' | 'success' | 'error' | 'idle';
  loadingMessage: string;
  successMessage: string;
  errorMessage?: string;
  errorDetails?: string;
}

const OperationContext = createContext<OperationContextType>({
  runOperation: runGlobalOperation,
  isOperating: false,
  status: 'idle',
  loadingMessage: 'A processar operação...',
  successMessage: 'Operação feita com sucesso!',
  errorMessage: 'Operação Não Realizada'
});

export const OperationProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [opState, setOpState] = useState<OperationState>(() => operationManager.getState());
  const [alertState, setAlertState] = useState<AppAlertState>({ isOpen: false, message: '', variant: 'warning' });
  const [confirmState, setConfirmState] = useState<AppConfirmState>({ isOpen: false, message: '', variant: 'warning' });

  useEffect(() => {
    return operationManager.subscribe((state) => {
      setOpState(state);
    });
  }, []);

  useEffect(() => {
    return appAlertManager.subscribe((state) => {
      setAlertState(state);
    });
  }, []);

  useEffect(() => {
    return appConfirmManager.subscribe((state) => {
      setConfirmState(state);
    });
  }, []);

  const runOperation = useCallback(
    <T,>(action: () => Promise<T> | T, options?: GlobalOperationOptions) => {
      return runGlobalOperation<T>(action, options);
    },
    []
  );

  return (
    <OperationContext.Provider
      value={{
        runOperation,
        isOperating: opState.status === 'loading',
        status: opState.status,
        loadingMessage: opState.loadingMessage,
        successMessage: opState.successMessage,
        errorMessage: opState.errorMessage,
        errorDetails: opState.errorDetails
      }}
    >
      {children}

      <OperationStatusModal
        isOpen={opState.isOpen && opState.status !== 'idle'}
        status={opState.status === 'loading' ? 'loading' : opState.status === 'error' ? 'error' : 'success'}
        loadingMessage={opState.loadingMessage}
        successMessage={opState.successMessage}
        successDetails={opState.successDetails}
        errorMessage={opState.errorMessage}
        errorDetails={opState.errorDetails}
      />

      <AppAlertModal
        isOpen={alertState.isOpen}
        title={alertState.title}
        message={alertState.message}
        variant={alertState.variant}
        onClose={closeAppAlert}
      />

      <AppConfirmModal
        isOpen={confirmState.isOpen}
        title={confirmState.title}
        message={confirmState.message}
        variant={confirmState.variant}
        confirmLabel={confirmState.confirmLabel}
        cancelLabel={confirmState.cancelLabel}
        onConfirm={() => resolveAppConfirm(true)}
        onCancel={() => resolveAppConfirm(false)}
      />
    </OperationContext.Provider>
  );
};

export const useGlobalOperation = () => useContext(OperationContext);

export { AsyncButton } from '../components/AsyncButton';
