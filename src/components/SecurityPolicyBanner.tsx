import React from 'react';

/**
 * Faixa de avisos das POLÍTICAS DE SEGURANÇA em vigor. Aparece apenas quando
 * uma política configurada em Configurações → 7. Segurança & Backups produz
 * efeito sobre a sessão atual:
 *
 *   • contagem decrescente antes do encerramento por inatividade;
 *   • palavra-passe expirada ou a expirar, segundo a validade configurada;
 *   • 2FA obrigatório ainda por configurar no perfil.
 */
export const SecurityPolicyBanner: React.FC<{
  /** Segundos que faltam para a sessão terminar por inatividade (null = sem aviso). */
  inactivitySecondsLeft: number | null;
  onKeepAlive: () => void;
  passwordStatus: { expired: boolean; daysRemaining: number | null; warning: boolean };
  twoFactorPending: boolean;
  onOpenSecuritySettings?: () => void;
}> = ({ inactivitySecondsLeft, onKeepAlive, passwordStatus, twoFactorPending, onOpenSecuritySettings }) => {
  const messages: Array<{ key: string; tone: 'danger' | 'warning' | 'info'; icon: string; text: string; action?: React.ReactNode }> = [];

  if (inactivitySecondsLeft !== null) {
    messages.push({
      key: 'inactivity',
      tone: 'danger',
      icon: 'timer',
      text: `A sessão termina em ${inactivitySecondsLeft}s por inatividade, conforme a política de segurança da instituição.`,
      action: (
        <button
          type="button"
          onClick={onKeepAlive}
          className="px-3 py-1 text-[11px] font-bold uppercase tracking-wide bg-white text-[#0b1f3a] border border-white/70 hover:bg-slate-100 cursor-pointer"
        >
          Continuar sessão
        </button>
      )
    });
  }

  if (passwordStatus.expired) {
    messages.push({
      key: 'password-expired',
      tone: 'danger',
      icon: 'key_off',
      text: 'A sua palavra-passe ultrapassou o prazo de validade definido nas políticas de acesso. Renove-a para manter o acesso aos módulos críticos.'
    });
  } else if (passwordStatus.warning && passwordStatus.daysRemaining !== null) {
    messages.push({
      key: 'password-warning',
      tone: 'warning',
      icon: 'key',
      text: `A sua palavra-passe expira dentro de ${passwordStatus.daysRemaining} dia(s), segundo a validade configurada pela instituição.`
    });
  }

  if (twoFactorPending) {
    messages.push({
      key: 'two-factor',
      tone: 'info',
      icon: 'shield_lock',
      text: 'A autenticação de dois fatores está ativa e é obrigatória para o seu perfil. Configure o segundo fator na sua conta.',
      action: onOpenSecuritySettings ? (
        <button
          type="button"
          onClick={onOpenSecuritySettings}
          className="px-3 py-1 text-[11px] font-bold uppercase tracking-wide bg-white text-[#0b1f3a] border border-white/70 hover:bg-slate-100 cursor-pointer"
        >
          Abrir Segurança
        </button>
      ) : undefined
    });
  }

  if (messages.length === 0) return null;

  const toneClass = {
    danger: 'bg-[#b91c1c] text-white border-[#7a0c0c]',
    warning: 'bg-amber-500 text-[#1c1c1a] border-amber-600',
    info: 'bg-[#0b1f3a] text-white border-[#12335e]'
  } as const;

  return (
    <div data-acl-ignore className="print:hidden flex flex-col gap-px">
      {messages.map((msg) => (
        <div
          key={msg.key}
          className={`flex items-center justify-between gap-3 px-4 py-2 border-b ${toneClass[msg.tone]}`}
        >
          <div className="flex items-center gap-2">
            <span className="material-symbols-outlined text-[18px]">{msg.icon}</span>
            <span className="text-[11px] font-semibold">{msg.text}</span>
          </div>
          {msg.action}
        </div>
      ))}
    </div>
  );
};
