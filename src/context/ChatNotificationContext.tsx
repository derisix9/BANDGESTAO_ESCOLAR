import React, { useCallback, useEffect, useRef, useState } from 'react';
import { SchoolDatabase, User } from '../types';
import { hasPermission } from '../utils/permissions';

/**
 * Notificações em tempo real do Chat Encarregado ↔ Escola.
 * ==========================================================
 *
 * Sempre que um dos lados (Escola ou Encarregado de Educação) envia uma
 * mensagem numa conversa, o OUTRO lado deve ver, no ecrã, um aviso do tipo
 * "{Nome} respondeu" com o texto da mensagem — tal como o aviso que esta
 * própria conversa mostra quando uma tarefa é concluída. O aviso aparece em
 * qualquer ecrã da aplicação (não é preciso estar dentro da conversa) e some
 * sozinho ao fim de alguns segundos, podendo também ser fechado ou clicado
 * para abrir a conversa em causa.
 *
 * Como funciona:
 *  - `db.guardianChatThreads` já chega em tempo real (Firebase Realtime
 *    Database) a todas as sessões abertas, através do `dbService.subscribe`
 *    consumido em App.tsx — este componente só precisa de "ouvir" as mesmas
 *    alterações e comparar com o que já tinha visto.
 *  - Ao carregar a app guardamos o estado atual de cada conversa SEM disparar
 *    avisos (para não repetir todo o histórico como se fossem notificações
 *    novas). A partir daí, qualquer mensagem nova cujo remetente seja "o
 *    outro lado" gera um aviso.
 *  - Do lado do Encarregado, só interessa a conversa do(s) seu(s) educando(s)
 *    (`linkedStudentId`). Do lado da Escola, interessam todas as conversas,
 *    mas só para quem tem a permissão de gerir o chat na Matriz de Perfis.
 */

interface ChatToast {
  id: string;
  threadId: string;
  senderName: string;
  fromSchool: boolean;
  studentName: string;
  subject: string;
  content: string;
  timestamp: string;
}

const TOAST_AUTO_DISMISS_MS = 8000;
const MAX_VISIBLE_TOASTS = 4;

function truncate(text: string, max = 160): string {
  const clean = (text || '').trim();
  return clean.length > max ? `${clean.slice(0, max - 1)}…` : clean;
}

function fmtTime(iso: string): string {
  try {
    return new Date(iso).toLocaleTimeString('pt-PT', { hour: '2-digit', minute: '2-digit' });
  } catch {
    return '';
  }
}

export interface ChatMessageNotificationsProps {
  db: SchoolDatabase;
  currentUser: User | null;
  /** Chamado quando o utilizador clica no aviso — deve navegar para o separador de Chat correto. */
  onOpenChat: (threadId: string) => void;
}

export const ChatMessageNotifications: React.FC<ChatMessageNotificationsProps> = ({ db, currentUser, onOpenChat }) => {
  const [toasts, setToasts] = useState<ChatToast[]>([]);
  const lastSeenRef = useRef<Map<string, string>>(new Map());
  const initializedForUserRef = useRef<string | null>(null);

  // NOTA: este widget foi escrito para um modelo de dados mais antigo de Chat
  // Encarregado↔Escola (`guardianChatThreads`, com `studentId`/`subject` por
  // conversa) que já não existe — foi substituído pelo Chat Interno genérico
  // (`db.internalChatThreads`, participantIds/participants, sem contexto de
  // aluno/assunto por conversa). Sem essa migração de modelo (fora do âmbito
  // desta correção), mantém-se inofensivo (sem avisos) em vez de rebentar.
  const threads: any[] = [];

  // Sempre que o utilizador autenticado muda (login/logout/troca de conta),
  // reiniciamos a "memória" de mensagens já vistas para este novo utilizador.
  useEffect(() => {
    if (!currentUser) {
      initializedForUserRef.current = null;
      lastSeenRef.current = new Map();
      setToasts([]);
    }
  }, [currentUser]);

  useEffect(() => {
    if (!currentUser) return;

    const isGuardian = currentUser.role === 'encarregado';
    const isSchoolStaff = !isGuardian && hasPermission(currentUser.role, 'comunicacao.chat.manage');

    // Primeiro cálculo depois de entrar na sessão: apenas regista o estado
    // atual, sem gerar avisos — evita "reviver" o histórico todo ao dar login.
    const isFirstRunForThisUser = initializedForUserRef.current !== currentUser.id;

    const map = new Map(lastSeenRef.current);
    const newToasts: ChatToast[] = [];

    threads.forEach((thread) => {
      const lastMessage = thread.messages[thread.messages.length - 1];
      if (!lastMessage) return;

      const previouslySeenId = map.get(thread.id);
      map.set(thread.id, lastMessage.id);

      if (isFirstRunForThisUser || previouslySeenId === lastMessage.id) return;

      const isRelevantThread = isGuardian ? thread.studentId === currentUser.linkedStudentId : isSchoolStaff;
      if (!isRelevantThread) return;

      const isFromOtherSide = isGuardian ? lastMessage.sender === 'escola' : lastMessage.sender === 'encarregado';
      if (!isFromOtherSide) return;

      newToasts.push({
        id: `${thread.id}:${lastMessage.id}`,
        threadId: thread.id,
        senderName: lastMessage.senderName,
        fromSchool: lastMessage.sender === 'escola',
        studentName: thread.studentName,
        subject: thread.subject,
        content: lastMessage.content,
        timestamp: lastMessage.timestamp
      });
    });

    lastSeenRef.current = map;
    initializedForUserRef.current = currentUser.id;

    if (newToasts.length > 0) {
      setToasts((prev) => [...prev, ...newToasts].slice(-MAX_VISIBLE_TOASTS));
    }
    // Reage apenas a mudanças reais nas conversas ou de utilizador — a comparação
    // fina é feita acima através do `lastSeenRef`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [threads, currentUser?.id, currentUser?.role, currentUser?.linkedStudentId]);

  const dismiss = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  useEffect(() => {
    if (toasts.length === 0) return;
    const timers = toasts.map((t) => setTimeout(() => dismiss(t.id), TOAST_AUTO_DISMISS_MS));
    return () => timers.forEach(clearTimeout);
  }, [toasts, dismiss]);

  if (!currentUser || toasts.length === 0) return null;

  return (
    <div
      className="fixed top-4 right-4 z-[99999] flex flex-col gap-2 w-[calc(100%-2rem)] max-w-sm"
      style={{ pointerEvents: 'none' }}
    >
      {toasts.map((t) => (
        <div
          key={t.id}
          role="status"
          aria-live="polite"
          onClick={() => {
            onOpenChat(t.threadId);
            dismiss(t.id);
          }}
          className="bg-white border border-slate-200 rounded-xl shadow-lg p-3 flex gap-3 items-start cursor-pointer animate-in slide-in-from-top-2 fade-in duration-200 hover:shadow-xl transition-shadow"
          style={{ pointerEvents: 'auto' }}
        >
          <div
            className="w-9 h-9 rounded-full flex items-center justify-center text-white shrink-0"
            style={{ backgroundColor: 'var(--lv-button-blue, #0b1f3a)' }}
          >
            <span className="material-symbols-outlined text-[18px]">
              {t.fromSchool ? 'forum' : 'record_voice_over'}
            </span>
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex items-center justify-between gap-2">
              <p className="text-xs font-bold text-slate-800 truncate">{t.senderName} respondeu</p>
              <span className="text-[9px] text-slate-400 shrink-0">{fmtTime(t.timestamp)}</span>
            </div>
            <p className="text-[10px] text-slate-500 truncate mb-1">
              {t.studentName} · {t.subject}
            </p>
            <p className="text-[11px] text-slate-600 leading-snug break-words [overflow-wrap:anywhere] line-clamp-3">
              {truncate(t.content)}
            </p>
          </div>
          <button
            onClick={(e) => {
              e.stopPropagation();
              dismiss(t.id);
            }}
            className="text-slate-400 hover:text-slate-600 shrink-0"
            title="Fechar aviso"
          >
            <span className="material-symbols-outlined text-[16px]">close</span>
          </button>
        </div>
      ))}
    </div>
  );
};

export default ChatMessageNotifications;
