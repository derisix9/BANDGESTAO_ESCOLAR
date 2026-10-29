import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { InternalChatParticipant, InternalChatThread, SchoolDatabase, User } from '../types';
import { dbService } from '../services/db';
import {
  ROLE_LABELS,
  getInternalChatContacts,
  groupContactsByRole,
  isSchoolChatManager,
  toInternalChatParticipant
} from '../utils/internalChat';
import { Notice } from './Notice';

/**
 * CHAT INTERNO — ícone no header ao estilo Messenger/Facebook.
 * =============================================================
 * - Ícone de mensagens com badge vermelho (nº de mensagens não lidas), à
 *   semelhança do sino de notificações. Disponível para TODOS os perfis.
 * - Cada conversa é privada entre os dois participantes (`participantIds`);
 *   cada utilizador só vê as suas próprias conversas.
 * - A Escola (Admin, Direção, Secretaria — permissão `comunicacao.chat.manage`)
 *   fala com Professores, Alunos, Funcionários e Encarregados (apenas os que
 *   têm conta de utilizador). Os restantes só falam com a Escola.
 * - Aviso flutuante quando chega uma mensagem nova, em qualquer ecrã.
 */

interface InternalChatWidgetProps {
  db: SchoolDatabase;
  currentUser: User;
}

interface ChatToast {
  id: string;
  threadId: string;
  senderName: string;
  senderAvatar?: string;
  content: string;
}

const TOAST_MS = 7000;

function initials(name: string): string {
  return (name || '?')
    .split(' ')
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase())
    .join('');
}

function shortTime(iso: string): string {
  try {
    const d = new Date(iso);
    const now = new Date();
    if (d.toDateString() === now.toDateString()) {
      return d.toLocaleTimeString('pt-PT', { hour: '2-digit', minute: '2-digit' });
    }
    return d.toLocaleDateString('pt-PT', { day: '2-digit', month: '2-digit' });
  } catch {
    return '';
  }
}

const Avatar: React.FC<{ name: string; src?: string; size?: number }> = ({ name, src, size = 36 }) => {
  const [failed, setFailed] = useState(false);
  const style = { width: size, height: size, minWidth: size };
  if (src && !failed) {
    return (
      <img
        src={src}
        alt={name}
        style={style}
        onError={() => setFailed(true)}
        className="rounded-full object-cover aspect-square shrink-0 bg-slate-200"
      />
    );
  }
  return (
    <div
      style={{ ...style, fontSize: size * 0.38 }}
      className="rounded-full bg-[#0b1f3a] text-white font-bold flex items-center justify-center shrink-0"
    >
      {initials(name)}
    </div>
  );
};

export const InternalChatWidget: React.FC<InternalChatWidgetProps> = ({ db, currentUser }) => {
  const [panelOpen, setPanelOpen] = useState(false);
  const [tab, setTab] = useState<'conversas' | 'contactos'>('conversas');
  const [search, setSearch] = useState('');
  const [openThreadId, setOpenThreadId] = useState<string | null>(null);
  const [minimized, setMinimized] = useState(false);
  const [draft, setDraft] = useState('');
  const [error, setError] = useState('');
  const [toasts, setToasts] = useState<ChatToast[]>([]);

  const containerRef = useRef<HTMLDivElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const lastSeenRef = useRef<Map<string, string>>(new Map());
  const initRef = useRef<string | null>(null);

  const users = db.users || [];
  const allThreads = db.internalChatThreads || [];

  // Só as conversas em que o utilizador participa — privacidade total.
  const myThreads = useMemo<InternalChatThread[]>(
    () =>
      allThreads
        .filter((t) => t.participantIds.includes(currentUser.id))
        .sort((a, b) => new Date(b.lastMessageAt).getTime() - new Date(a.lastMessageAt).getTime()),
    [allThreads, currentUser.id]
  );

  const unreadOf = useCallback(
    (t: InternalChatThread) =>
      t.messages.filter((m) => m.senderId !== currentUser.id && !m.readBy.includes(currentUser.id)).length,
    [currentUser.id]
  );

  const totalUnread = useMemo(() => myThreads.reduce((sum, t) => sum + unreadOf(t), 0), [myThreads, unreadOf]);

  /** Dados atuais do "outro" participante (nome/foto vêm da conta, com fallback ao guardado na conversa). */
  const otherOf = useCallback(
    (t: InternalChatThread): InternalChatParticipant => {
      const stored = t.participants.find((p) => p.id !== currentUser.id) || t.participants[0];
      const live = users.find((u) => u.id === stored.id);
      return live ? toInternalChatParticipant(live) : stored;
    },
    [users, currentUser.id]
  );

  const contacts = useMemo(() => getInternalChatContacts(currentUser, users), [currentUser, users]);
  const filteredContacts = useMemo(() => {
    const q = search.trim().toLowerCase();
    return q ? contacts.filter((u) => `${u.name} ${u.roleTitle} ${ROLE_LABELS[u.role] || ''}`.toLowerCase().includes(q)) : contacts;
  }, [contacts, search]);
  const contactGroups = useMemo(() => groupContactsByRole(filteredContacts), [filteredContacts]);

  const filteredThreads = useMemo(() => {
    const q = search.trim().toLowerCase();
    return q ? myThreads.filter((t) => otherOf(t).name.toLowerCase().includes(q)) : myThreads;
  }, [myThreads, search, otherOf]);

  const openThread = useMemo(() => myThreads.find((t) => t.id === openThreadId) || null, [myThreads, openThreadId]);

  // Fechar painel ao clicar fora
  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) setPanelOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, []);

  // Marcar como lida a conversa aberta (e mensagens que chegam enquanto está aberta)
  useEffect(() => {
    if (openThread && !minimized && unreadOf(openThread) > 0) {
      dbService.markInternalChatThreadRead(openThread.id);
    }
  }, [openThread, minimized, unreadOf]);

  // Scroll para a última mensagem
  useEffect(() => {
    if (openThread && !minimized) bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [openThread?.messages.length, openThread?.id, minimized]);

  // Avisos de mensagens novas (sem repetir o histórico ao entrar)
  useEffect(() => {
    const first = initRef.current !== currentUser.id;
    const map = new Map(lastSeenRef.current);
    const fresh: ChatToast[] = [];

    myThreads.forEach((t) => {
      const last = t.messages[t.messages.length - 1];
      if (!last) return;
      const prev = map.get(t.id);
      map.set(t.id, last.id);
      if (first || prev === last.id) return;
      if (last.senderId === currentUser.id) return;
      // Conversa aberta e visível: não incomoda
      if (openThreadId === t.id && !minimized) return;
      fresh.push({
        id: `${t.id}:${last.id}`,
        threadId: t.id,
        senderName: last.senderName,
        senderAvatar: users.find((u) => u.id === last.senderId)?.avatar || last.senderAvatar,
        content: last.content
      });
    });

    lastSeenRef.current = map;
    initRef.current = currentUser.id;
    if (fresh.length) setToasts((p) => [...p, ...fresh].slice(-3));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [myThreads, currentUser.id]);

  useEffect(() => {
    if (!toasts.length) return;
    const timers = toasts.map((t) => setTimeout(() => setToasts((p) => p.filter((x) => x.id !== t.id)), TOAST_MS));
    return () => timers.forEach(clearTimeout);
  }, [toasts]);

  const openChat = (threadId: string) => {
    setOpenThreadId(threadId);
    setMinimized(false);
    setPanelOpen(false);
    setError('');
    setToasts((p) => p.filter((t) => t.threadId !== threadId));
  };

  const startWith = (user: User) => {
    const res = dbService.getOrCreateInternalChatThread(toInternalChatParticipant(user));
    if (res.success && res.thread) {
      setSearch('');
      openChat(res.thread.id);
    } else {
      setError(res.error || 'Não foi possível abrir a conversa.');
    }
  };

  const send = () => {
    if (!openThread || !draft.trim()) return;
    const res = dbService.sendInternalChatMessage(openThread.id, draft);
    if (res.success) {
      setDraft('');
      setError('');
    } else {
      setError(res.error || 'Erro ao enviar.');
    }
  };

  const other = openThread ? otherOf(openThread) : null;
  const isSchool = isSchoolChatManager(currentUser.role);

  return (
    <div className="relative" ref={containerRef}>
      {/* Ícone do header */}
      <button
        type="button"
        onClick={() => setPanelOpen((v) => !v)}
        className={`p-2 rounded-lg transition-all relative cursor-pointer ${
          panelOpen ? 'bg-white/15 text-white' : 'text-blue-200 hover:text-white hover:bg-white/10'
        }`}
        aria-label="Mensagens"
        title="Mensagens"
      >
        <span className="material-symbols-outlined text-[20px]">chat</span>
        {totalUnread > 0 && (
          <span className="absolute -top-1 -right-1 px-1.5 min-w-[18px] h-[18px] flex items-center justify-center rounded-full text-[10px] font-black bg-red-600 text-white shadow-xs animate-pulse">
            {totalUnread > 9 ? '9+' : totalUnread}
          </span>
        )}
      </button>

      {/* Painel de conversas / contactos */}
      {panelOpen && (
        <div className="fixed sm:absolute right-2 sm:right-0 left-2 sm:left-auto top-16 sm:top-auto sm:mt-2 sm:w-96 bg-white text-slate-800 rounded-xl shadow-2xl border border-slate-200 z-50 overflow-hidden">
          <div className="px-4 pt-3 pb-2 bg-slate-50 border-b border-slate-200">
            <h3 className="text-sm font-extrabold text-[#0b1f3a]">Mensagens</h3>
            <p className="text-[11px] text-slate-500 mb-2">
              {isSchool
                ? 'Fale com professores, alunos, funcionários e encarregados.'
                : 'Fale com a Direção / Secretaria da escola.'}
            </p>
            <div className="relative">
              <span className="material-symbols-outlined text-[16px] text-slate-400 absolute left-2.5 top-1/2 -translate-y-1/2">
                search
              </span>
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Pesquisar pessoas…"
                className="w-full pl-8 pr-3 py-1.5 rounded-full bg-slate-200/70 text-xs focus:outline-none focus:ring-2 focus:ring-blue-400"
              />
            </div>
            <div className="flex gap-1 mt-2">
              {(['conversas', 'contactos'] as const).map((t) => (
                <button
                  key={t}
                  type="button"
                  onClick={() => setTab(t)}
                  className={`flex-1 py-1 rounded-full text-[11px] font-bold cursor-pointer transition-colors ${
                    tab === t ? 'bg-[#0b1f3a] text-white' : 'text-slate-600 hover:bg-slate-200'
                  }`}
                >
                  {t === 'conversas' ? `Conversas${totalUnread ? ` (${totalUnread})` : ''}` : 'Contactos'}
                </button>
              ))}
            </div>
          </div>

          <div className="max-h-[60vh] sm:max-h-96 overflow-y-auto">
            {tab === 'conversas' ? (
              filteredThreads.length === 0 ? (
                <div className="py-10 text-center text-slate-400 text-xs px-6">
                  <span className="material-symbols-outlined text-[36px] block mb-1">forum</span>
                  Ainda não tem conversas.
                  <button
                    type="button"
                    onClick={() => setTab('contactos')}
                    className="block mx-auto mt-2 text-blue-600 font-bold cursor-pointer hover:underline"
                  >
                    Iniciar uma conversa
                  </button>
                </div>
              ) : (
                filteredThreads.map((t) => {
                  const o = otherOf(t);
                  const last = t.messages[t.messages.length - 1];
                  const unread = unreadOf(t);
                  return (
                    <button
                      key={t.id}
                      type="button"
                      onClick={() => openChat(t.id)}
                      className={`w-full flex items-center gap-3 px-4 py-2.5 text-left hover:bg-slate-100 cursor-pointer transition-colors ${
                        unread ? 'bg-blue-50/60' : ''
                      }`}
                    >
                      <Avatar name={o.name} src={o.avatar} size={44} />
                      <div className="min-w-0 flex-1">
                        <div className="flex items-baseline justify-between gap-2">
                          <span className={`text-xs truncate ${unread ? 'font-extrabold' : 'font-bold'}`}>{o.name}</span>
                          <span className="text-[10px] text-slate-400 shrink-0">{shortTime(t.lastMessageAt)}</span>
                        </div>
                        <div className="text-[10px] text-slate-400 truncate">{o.roleTitle || ROLE_LABELS[o.role]}</div>
                        <div className={`text-[11px] truncate ${unread ? 'font-bold text-slate-800' : 'text-slate-500'}`}>
                          {last ? `${last.senderId === currentUser.id ? 'Você: ' : ''}${last.content}` : 'Sem mensagens'}
                        </div>
                      </div>
                      {unread > 0 && <span className="w-2.5 h-2.5 rounded-full bg-red-600 shrink-0" aria-label="Não lida" />}
                    </button>
                  );
                })
              )
            ) : contactGroups.length === 0 ? (
              <div className="py-10 text-center text-slate-400 text-xs px-6">
                Nenhum contacto disponível.
                {isSchool && (
                  <div className="mt-1">Encarregados só aparecem depois de terem uma conta de utilizador criada.</div>
                )}
              </div>
            ) : (
              contactGroups.map((g) => (
                <div key={g.key}>
                  <div className="px-4 py-1.5 bg-slate-50 border-y border-slate-100 text-[10px] font-extrabold uppercase tracking-wide text-slate-500 flex items-center gap-1.5">
                    <span className="material-symbols-outlined text-[14px]">{g.icon}</span>
                    {g.label} ({g.users.length})
                  </div>
                  {g.users.map((u) => (
                    <button
                      key={u.id}
                      type="button"
                      onClick={() => startWith(u)}
                      className="w-full flex items-center gap-3 px-4 py-2 text-left hover:bg-slate-100 cursor-pointer transition-colors"
                    >
                      <Avatar name={u.name} src={u.avatar} size={36} />
                      <div className="min-w-0">
                        <div className="text-xs font-bold truncate">{u.name}</div>
                        <div className="text-[10px] text-slate-400 truncate">{u.roleTitle || ROLE_LABELS[u.role]}</div>
                      </div>
                    </button>
                  ))}
                </div>
              ))
            )}
          </div>
          {error && <Notice tone="error">{error}</Notice>}
        </div>
      )}

      {/* Janela de conversa (canto inferior direito, como no Facebook) */}
      {openThread && other && (
        <div
          className={`fixed bottom-0 right-2 sm:right-6 w-[calc(100vw-1rem)] sm:w-[340px] bg-white text-slate-800 rounded-t-xl shadow-2xl border border-slate-300 z-[60] flex flex-col ${
            minimized ? '' : 'h-[min(28rem,80vh)]'
          }`}
        >
          <div className="flex items-center gap-2 px-3 py-2 bg-[#0b1f3a] text-white rounded-t-xl">
            <button
              type="button"
              onClick={() => setMinimized((v) => !v)}
              className="flex items-center gap-2 min-w-0 flex-1 text-left cursor-pointer"
            >
              <Avatar name={other.name} src={other.avatar} size={30} />
              <div className="min-w-0">
                <div className="text-xs font-bold truncate leading-tight">{other.name}</div>
                <div className="text-[10px] text-blue-200 truncate leading-tight">
                  {other.roleTitle || ROLE_LABELS[other.role]}
                </div>
              </div>
              {minimized && unreadOf(openThread) > 0 && (
                <span className="ml-auto px-1.5 h-[18px] min-w-[18px] flex items-center justify-center rounded-full text-[10px] font-black bg-red-600">
                  {unreadOf(openThread)}
                </span>
              )}
            </button>
            <button
              type="button"
              onClick={() => setMinimized((v) => !v)}
              className="p-1 rounded hover:bg-white/10 cursor-pointer"
              title={minimized ? 'Expandir' : 'Minimizar'}
            >
              <span className="material-symbols-outlined text-[18px]">{minimized ? 'expand_less' : 'remove'}</span>
            </button>
            <button
              type="button"
              onClick={() => {
                setOpenThreadId(null);
                setDraft('');
              }}
              className="p-1 rounded hover:bg-white/10 cursor-pointer"
              title="Fechar"
            >
              <span className="material-symbols-outlined text-[18px]">close</span>
            </button>
          </div>

          {!minimized && (
            <>
              <div className="flex-1 overflow-y-auto px-3 py-3 space-y-2 bg-slate-50">
                {openThread.messages.length === 0 && (
                  <div className="text-center text-[11px] text-slate-400 py-6">
                    <Avatar name={other.name} src={other.avatar} size={56} />
                    <div className="font-bold text-slate-600 mt-2">{other.name}</div>
                    Diga olá para começar a conversa.
                  </div>
                )}
                {openThread.messages.map((m) => {
                  const mine = m.senderId === currentUser.id;
                  return (
                    <div key={m.id} className={`flex items-end gap-1.5 ${mine ? 'justify-end' : 'justify-start'}`}>
                      {!mine && <Avatar name={other.name} src={other.avatar} size={24} />}
                      <div className={`max-w-[75%] ${mine ? 'items-end' : 'items-start'} flex flex-col`}>
                        <div
                          className={`px-3 py-1.5 rounded-2xl text-xs whitespace-pre-wrap break-words ${
                            mine ? 'bg-blue-600 text-white rounded-br-sm' : 'bg-slate-200 text-slate-800 rounded-bl-sm'
                          }`}
                        >
                          {m.content}
                        </div>
                        <span className="text-[9px] text-slate-400 mt-0.5 px-1">{shortTime(m.timestamp)}</span>
                      </div>
                    </div>
                  );
                })}
                <div ref={bottomRef} />
              </div>
              {error && <Notice tone="error">{error}</Notice>}
              <div className="flex items-end gap-2 p-2 border-t border-slate-200 bg-white">
                <textarea
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !e.shiftKey) {
                      e.preventDefault();
                      send();
                    }
                  }}
                  rows={1}
                  placeholder="Escreva uma mensagem…"
                  className="flex-1 resize-none max-h-24 px-3 py-2 rounded-2xl bg-slate-100 text-xs focus:outline-none focus:ring-2 focus:ring-blue-400"
                />
                <button
                  type="button"
                  onClick={send}
                  disabled={!draft.trim()}
                  className="p-2 rounded-full text-blue-600 hover:bg-blue-50 disabled:text-slate-300 disabled:hover:bg-transparent cursor-pointer"
                  title="Enviar"
                >
                  <span className="material-symbols-outlined text-[20px]">send</span>
                </button>
              </div>
            </>
          )}
        </div>
      )}

      {/* Avisos de mensagens novas */}
      {toasts.length > 0 && (
        <div className="fixed top-20 right-3 z-[70] flex flex-col gap-2 w-72 max-w-[calc(100vw-1.5rem)]">
          {toasts.map((t) => (
            <div
              key={t.id}
              className="flex items-start gap-2.5 bg-white text-slate-800 rounded-xl shadow-2xl border border-slate-200 p-3 cursor-pointer hover:bg-slate-50"
              onClick={() => openChat(t.threadId)}
              role="alert"
            >
              <Avatar name={t.senderName} src={t.senderAvatar} size={36} />
              <div className="min-w-0 flex-1">
                <div className="text-xs font-extrabold truncate">{t.senderName}</div>
                <div className="text-[11px] text-slate-600 line-clamp-2 break-words">{t.content}</div>
              </div>
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  setToasts((p) => p.filter((x) => x.id !== t.id));
                }}
                className="text-slate-400 hover:text-slate-700 cursor-pointer"
                aria-label="Fechar aviso"
              >
                <span className="material-symbols-outlined text-[16px]">close</span>
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};
