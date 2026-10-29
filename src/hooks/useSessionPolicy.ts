import { useEffect, useRef, useState } from 'react';
import { getSecurityPolicies, securityAudit } from '../services/securityPolicy';
import { touchActivity, lastActivityAt, effectiveIdleMinutes } from '../services/sessionActivity';

/**
 * Aplica a política "Inatividade de Sessão" definida em Configurações →
 * Segurança & Backups. Ao fim do tempo configurado sem qualquer interação do
 * utilizador (rato, teclado, toque ou deslocamento), a sessão é terminada e o
 * evento fica registado na trilha de auditoria.
 *
 * Um minuto antes do fim é emitido um aviso, para o utilizador poder continuar
 * o trabalho sem perder o que está a fazer.
 *
 * O valor é relido a cada tique: se o Administrador alterar a política, ela
 * passa a valer imediatamente, sem necessidade de voltar a entrar.
 */
export function useSessionPolicy(options: {
  active: boolean;
  userName?: string;
  onTimeout: () => void;
}) {
  const { active, userName, onTimeout } = options;
  const lastActivityRef = useRef<number>(Date.now());
  const warnedRef = useRef(false);
  const [warningSecondsLeft, setWarningSecondsLeft] = useState<number | null>(null);

  // Regista a última interação do utilizador.
  useEffect(() => {
    if (!active) return;

    const markActivity = () => {
      lastActivityRef.current = Date.now();
      touchActivity();
      if (warnedRef.current) {
        warnedRef.current = false;
        setWarningSecondsLeft(null);
      }
    };

    const windowEvents: Array<keyof WindowEventMap> = ['mousemove', 'mousedown', 'keydown', 'touchstart', 'scroll', 'wheel'];
    windowEvents.forEach((evt) => window.addEventListener(evt, markActivity, { passive: true }));
    document.addEventListener('visibilitychange', markActivity);
    return () => {
      windowEvents.forEach((evt) => window.removeEventListener(evt, markActivity));
      document.removeEventListener('visibilitychange', markActivity);
    };
  }, [active]);

  // Verifica o tempo decorrido de 5 em 5 segundos.
  useEffect(() => {
    if (!active) {
      setWarningSecondsLeft(null);
      return;
    }

    const interval = window.setInterval(() => {
      // Com "Lembrar-me" o limite é 60 min (ou menos, se a política da escola for menor).
      const minutes = effectiveIdleMinutes(getSecurityPolicies().sessionTimeoutMinutes);
      if (!minutes || minutes <= 0) {
        setWarningSecondsLeft(null);
        return;
      }

      const limitMs = minutes * 60_000;
      // A última atividade conta também a de outros separadores (guardada em localStorage).
      const lastActive = Math.max(lastActivityRef.current, lastActivityAt() ?? 0);
      const idleMs = Date.now() - lastActive;
      const remaining = limitMs - idleMs;

      if (remaining <= 0) {
        securityAudit({
          action: 'Sessão Terminada por Inatividade',
          details: `Sessão de "${userName || 'utilizador'}" encerrada automaticamente após ${minutes} minutos sem atividade, conforme a política de segurança em vigor.`,
          userName
        });
        warnedRef.current = false;
        setWarningSecondsLeft(null);
        lastActivityRef.current = Date.now();
        onTimeout();
        return;
      }

      if (remaining <= 60_000) {
        warnedRef.current = true;
        setWarningSecondsLeft(Math.ceil(remaining / 1000));
      } else if (warnedRef.current) {
        warnedRef.current = false;
        setWarningSecondsLeft(null);
      }
    }, 5000);

    return () => window.clearInterval(interval);
  }, [active, onTimeout, userName]);

  const keepAlive = () => {
    lastActivityRef.current = Date.now();
    touchActivity(true);
    warnedRef.current = false;
    setWarningSecondsLeft(null);
  };

  return { warningSecondsLeft, keepAlive };
}
