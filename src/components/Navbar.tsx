import React, { useState, useRef, useEffect, useMemo } from 'react';
import { User, SchoolDatabase, SchoolNotification } from '../types';
import { dbService } from '../services/db';
import { InternalChatWidget } from './InternalChatWidget';
import { AppConfirmModal } from './AppConfirmModal';
import { useColorMode } from '../theme/colorMode';
import { Lang, tr } from '../i18n';
import { useLang } from '../i18n/useLang';
import { PushSupport, pushSupport, requestPushPermission, selectFresh, showSystemNotification } from '../utils/pushNotifications';
import { registerPushDevice } from '../services/pushDevice';

function formatRelativeTime(createdAt?: number, fallback?: string): string {
  if (!createdAt) return fallback || 'recente';
  const diff = Math.max(0, Date.now() - createdAt);
  const minutes = Math.floor(diff / (1000 * 60));
  if (minutes < 1) return 'Agora';
  if (minutes < 60) return `há ${minutes}m`;
  const hours = Math.floor(minutes / (1000 * 60 * 60));
  if (hours < 24) return `há ${hours}h`;
  const days = Math.floor(hours / 24);
  return `há ${days}d`;
}

interface NavbarProps {
  currentUser: User;
  currentAcademicYear: string;
  availableAcademicYears: string[];
  onAcademicYearChange: (year: string) => void;
  onOpenMobileMenu: () => void;
  onOpenSqlExport?: () => void;
  onResetData: () => void;
  onLogout: () => void;
  /** Só passado quando o administrador tem mais de uma escola (mãe + filiais). */
  onSwitchSchool?: () => void;
  onNavigate: (view: string, targetId?: string) => void;
  db: SchoolDatabase;
  isDesktopSidebarOpen?: boolean;
  /** Modo 'header': a navegação fica numa barra por baixo do cabeçalho (sem menu lateral no ecrã grande). */
  headerNav?: boolean;
  onToggleSidebar?: () => void;
}

export const Navbar: React.FC<NavbarProps> = ({
  currentUser,
  currentAcademicYear,
  availableAcademicYears,
  onAcademicYearChange,
  onOpenMobileMenu,
  onResetData,
  onLogout,
  onSwitchSchool,
  onNavigate,
  db,
  isDesktopSidebarOpen = true,
  headerNav = false,
  onToggleSidebar
}) => {
  const [showNotifications, setShowNotifications] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [isSearchOpen, setIsSearchOpen] = useState(false);
  const [hasRecentAlert, setHasRecentAlert] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const { mode: colorMode, toggle: toggleColorMode } = useColorMode();
  const lang: Lang = useLang();
  // Notificações do sistema: com a aplicação aberta em segundo plano mostram-se daqui; com a aplicação FECHADA chegam por push,
  // se a escola o ligou (Configurações → Integrações → Notificações) e este aparelho está registado.
  const [pushState, setPushState] = useState<PushSupport>(() => pushSupport());
  const shownSystemRef = useRef<Set<string> | null>(null);
  const searchContainerRef = useRef<HTMLDivElement>(null);
  const notificationsContainerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleFullscreenChange = () => {
      setIsFullscreen(!!document.fullscreenElement);
    };
    document.addEventListener('fullscreenchange', handleFullscreenChange);
    return () => document.removeEventListener('fullscreenchange', handleFullscreenChange);
  }, []);

  const toggleFullscreen = () => {
    if (!document.fullscreenElement) {
      document.documentElement.requestFullscreen?.().catch(() => {});
    } else {
      document.exitFullscreen?.().catch(() => {});
    }
  };

  // Close dropdowns on click outside
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (searchContainerRef.current && !searchContainerRef.current.contains(e.target as Node)) {
        setIsSearchOpen(false);
      }
      if (notificationsContainerRef.current && !notificationsContainerRef.current.contains(e.target as Node)) {
        setShowNotifications(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Listen to real-time school notifications
  useEffect(() => {
    const handleNewNotif = () => {
      setHasRecentAlert(true);
      const timer = setTimeout(() => setHasRecentAlert(false), 5000);
      return () => clearTimeout(timer);
    };

    window.addEventListener('bandmed:school_notification', handleNewNotif);
    return () => window.removeEventListener('bandmed:school_notification', handleNewNotif);
  }, []);

  // Lembrete em tempo real, só para Professores que coordenam turma (Diretor de
  // Turma): mantém no sino do cabeçalho o aviso de alunos sem Apreciação do
  // Conselho de Turma no boletim. Recalculado sempre que os dados de alunos/
  // turmas mudarem, para nunca deixar o Diretor de Turma esquecer-se.
  useEffect(() => {
    if (currentUser.role === 'professor') {
      dbService.syncCouncilAppreciationReminders(currentUser.id);
    }
  }, [currentUser.role, currentUser.id, db.students, db.classes]);

  const notifications = useMemo(
    () => dbService.getNotifications(currentUser.role, currentUser.id),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [db.notifications, db.invoices, db.events, db.students, currentUser.role, currentUser.id]
  );

  const unreadCount = useMemo(() => {
    return notifications.filter((n) => !n.read).length;
  }, [notifications]);

  // Mostra no sistema as notificações novas quando o separador está oculto. Na primeira
  // passagem só memoriza as que já existem, para não despejar o histórico ao abrir a app.
  useEffect(() => {
    if (shownSystemRef.current === null) {
      shownSystemRef.current = new Set(notifications.map((n) => n.id));
      return;
    }
    const seen = shownSystemRef.current;
    const fresh = selectFresh(notifications, seen);
    fresh.forEach((n) => seen.add(n.id));
    if (pushState !== 'granted' || typeof document === 'undefined' || !document.hidden) return;
    fresh.forEach((n) => {
      void showSystemNotification({ id: n.id, title: n.title, message: n.message, priority: n.priority });
    });
  }, [notifications, pushState]);

  // O navegador só deixa pedir a permissão depois de um gesto do utilizador e mostra sempre a
  // sua própria janela (que não é personalizável). Por isso mostramos primeiro a confirmação do
  // sistema: «Agora não» não toca no navegador (nada fica bloqueado); «Permitir» chama-o.
  const [pushConfirmOpen, setPushConfirmOpen] = useState(false);
  const handleEnablePush = () => setPushConfirmOpen(true);
  const confirmEnablePush = async () => {
    setPushConfirmOpen(false);
    const state = await requestPushPermission();
    setPushState(state);
    if (state === 'granted') void registerPushDevice(true);
  };
  // Permissão já dada (nesta ou noutra sessão): garante que o servidor conhece este aparelho para a escola e o utilizador actuais.
  useEffect(() => {
    if (pushState === 'granted') void registerPushDevice();
  }, [pushState]);

  // Compute live search results across multiple entities
  const searchResults = React.useMemo(() => {
    const query = searchTerm.trim().toLowerCase();
    if (!query) return null;

    const matchedStudents = (db.students || [])
      .filter(
        (s) =>
          s.name.toLowerCase().includes(query) ||
          s.procNumber.toLowerCase().includes(query) ||
          (s.className && s.className.toLowerCase().includes(query))
      )
      .slice(0, 4);

    const matchedClasses = (db.classes || [])
      .filter(
        (c) =>
          c.name.toLowerCase().includes(query) ||
          (c.room && c.room.toLowerCase().includes(query)) ||
          (c.academicYear && c.academicYear.toLowerCase().includes(query))
      )
      .slice(0, 3);

    const matchedTeachers = (db.teachers || [])
      .filter(
        (t) =>
          t.name.toLowerCase().includes(query) ||
          (t.department && t.department.toLowerCase().includes(query)) ||
          (t.agentNumber && t.agentNumber.toLowerCase().includes(query))
      )
      .slice(0, 3);

    const matchedSubjects = (db.subjects || [])
      .filter(
        (sub) =>
          sub.name.toLowerCase().includes(query) ||
          sub.code.toLowerCase().includes(query)
      )
      .slice(0, 3);

    const matchedInvoices = (db.invoices || [])
      .filter(
        (inv) =>
          inv.invoiceNumber.toLowerCase().includes(query) ||
          inv.studentName.toLowerCase().includes(query) ||
          inv.period.toLowerCase().includes(query)
      )
      .slice(0, 3);

    const totalCount =
      matchedStudents.length +
      matchedClasses.length +
      matchedTeachers.length +
      matchedSubjects.length +
      matchedInvoices.length;

    return {
      students: matchedStudents,
      classes: matchedClasses,
      teachers: matchedTeachers,
      subjects: matchedSubjects,
      invoices: matchedInvoices,
      totalCount
    };
  }, [searchTerm, db]);

  const handleSelectResult = (view: string, id?: string) => {
    setIsSearchOpen(false);
    setSearchTerm('');
    onNavigate(view, id);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' && searchResults && searchResults.totalCount > 0) {
      if (searchResults.students.length > 0) {
        handleSelectResult('alunos', searchResults.students[0].id);
      } else if (searchResults.classes.length > 0) {
        handleSelectResult('turmas');
      } else if (searchResults.teachers.length > 0) {
        handleSelectResult('professores');
      } else if (searchResults.subjects.length > 0) {
        handleSelectResult('disciplinas');
      } else if (searchResults.invoices.length > 0) {
        handleSelectResult('propinas');
      }
    } else if (e.key === 'Escape') {
      setIsSearchOpen(false);
    }
  };

  return (
    <>
    <header data-app-header className={`fixed top-0 left-0 right-0 h-16 bg-[#0b1f3a] text-white z-30 flex items-center justify-between px-4 lg:px-8 transition-all duration-300 ${
      isDesktopSidebarOpen && !headerNav ? 'lg:left-64' : 'lg:left-0'
    } ${headerNav ? '' : 'shadow-md'}`}>
      {/* Left: Hamburger & Search bar (No border, no background fill) */}
      <div className="flex items-center gap-3 flex-1 max-w-xl">
        {/* Left: Menu button (três barras) para abrir menu lateral mesmo em tela cheia */}
        <button
          type="button"
          onClick={() => {
            if (onToggleSidebar) {
              onToggleSidebar();
            } else {
              onOpenMobileMenu();
            }
          }}
          className={`p-2 rounded-lg cursor-pointer flex items-center justify-center shrink-0 transition-all text-blue-200 hover:text-white hover:bg-white/10 ${
            isDesktopSidebarOpen || headerNav ? 'lg:hidden' : 'flex'
          }`}
          aria-label="Abrir menu lateral"
          title="Abrir menu lateral"
        >
          <span className="material-symbols-outlined text-[24px]">
            menu
          </span>
        </button>

        {/* Caixa de pesquisa: borda suave e visível nos modos claro e escuro (ver theme-dark.css) */}
        <div ref={searchContainerRef} className="relative w-full max-w-md hidden sm:block">
          <div data-on-navy="searchbox" className="flex items-center gap-2 px-3 py-1.5 rounded-lg border focus-within:ring-0 transition-all duration-200">
            <span className="material-symbols-outlined text-blue-300 text-[20px] shrink-0">
              search
            </span>
            <input
              type="text"
              value={searchTerm}
              onChange={(e) => {
                setSearchTerm(e.target.value);
                setIsSearchOpen(true);
              }}
              onFocus={() => setIsSearchOpen(true)}
              onKeyDown={handleKeyDown}
              placeholder="Pesquisar alunos, turmas, professores, disciplinas..."
              data-on-navy="search"
              data-bare-field
              className="w-full bg-transparent border-0 text-xs text-white placeholder:text-blue-200/70 focus:outline-none focus:ring-0 font-body"
            />
            {searchTerm && (
              <button
                type="button"
                onClick={() => {
                  setSearchTerm('');
                  setIsSearchOpen(false);
                }}
                className="text-blue-300 hover:text-white text-xs p-1 cursor-pointer"
                title="Limpar pesquisa"
              >
                <span className="material-symbols-outlined text-[16px]">close</span>
              </button>
            )}
          </div>

          {/* Live Search Results Floating Panel */}
          {isSearchOpen && searchResults && (
            <div className="absolute top-full left-0 right-0 mt-2 bg-white text-slate-800 rounded-none shadow-2xl border border-slate-300 z-50 max-h-[75vh] overflow-y-auto divide-y divide-slate-100 text-xs animate-fade-in">
              {searchResults.totalCount === 0 ? (
                <div className="p-4 text-center text-slate-500 italic">
                  Nenhum resultado encontrado para "{searchTerm}".
                </div>
              ) : (
                <>
                  {/* Students */}
                  {searchResults.students.length > 0 && (
                    <div className="p-2">
                      <div className="text-[10px] uppercase font-bold text-slate-400 px-2 py-1 flex items-center gap-1">
                        <span className="material-symbols-outlined text-[14px] text-[#0b1f3a]">school</span>
                        <span>Alunos ({searchResults.students.length})</span>
                      </div>
                      {searchResults.students.map((s) => (
                        <button
                          key={s.id}
                          type="button"
                          onClick={() => handleSelectResult('alunos', s.id)}
                          className="w-full text-left px-2.5 py-2 hover:bg-slate-50 flex items-center justify-between group cursor-pointer"
                        >
                          <div className="flex items-center gap-2.5">
                            <img
                              src={s.avatar || '/avatar-padrao.png'}
                              alt=""
                              className="w-6 h-6 rounded-full object-cover border border-slate-200"
                            />
                            <div>
                              <span className="font-bold text-slate-900 group-hover:text-[#0b1f3a] block leading-tight">
                                {s.name}
                              </span>
                              <span className="text-[10px] text-slate-500 font-mono">
                                Proc: #{s.procNumber} • {s.className}
                              </span>
                            </div>
                          </div>
                          <span className="text-[10px] font-semibold text-blue-700 uppercase">Ver Aluno →</span>
                        </button>
                      ))}
                    </div>
                  )}

                  {/* Classes */}
                  {searchResults.classes.length > 0 && (
                    <div className="p-2">
                      <div className="text-[10px] uppercase font-bold text-slate-400 px-2 py-1 flex items-center gap-1">
                        <span className="material-symbols-outlined text-[14px] text-[#0b1f3a]">groups</span>
                        <span>Turmas ({searchResults.classes.length})</span>
                      </div>
                      {searchResults.classes.map((c) => (
                        <button
                          key={c.id}
                          type="button"
                          onClick={() => handleSelectResult('turmas', c.id)}
                          className="w-full text-left px-2.5 py-2 hover:bg-slate-50 flex items-center justify-between group cursor-pointer"
                        >
                          <div>
                            <span className="font-bold text-slate-900 group-hover:text-[#0b1f3a] block">
                              {c.name}
                            </span>
                            <span className="text-[10px] text-slate-500">
                              {c.room} • {c.shift} • Ano {c.academicYear}
                            </span>
                          </div>
                          <span className="text-[10px] font-semibold text-blue-700 uppercase">Abrir Turma →</span>
                        </button>
                      ))}
                    </div>
                  )}

                  {/* Teachers */}
                  {searchResults.teachers.length > 0 && (
                    <div className="p-2">
                      <div className="text-[10px] uppercase font-bold text-slate-400 px-2 py-1 flex items-center gap-1">
                        <span className="material-symbols-outlined text-[14px] text-[#0b1f3a]">badge</span>
                        <span>Professores ({searchResults.teachers.length})</span>
                      </div>
                      {searchResults.teachers.map((t) => (
                        <button
                          key={t.id}
                          type="button"
                          onClick={() => handleSelectResult('professores', t.id)}
                          className="w-full text-left px-2.5 py-2 hover:bg-slate-50 flex items-center justify-between group cursor-pointer"
                        >
                          <div>
                            <span className="font-bold text-slate-900 group-hover:text-[#0b1f3a] block">
                              {t.name}
                            </span>
                            <span className="text-[10px] text-slate-500">
                              {t.department} • Agente: {t.agentNumber}
                            </span>
                          </div>
                          <span className="text-[10px] font-semibold text-blue-700 uppercase">Perfil →</span>
                        </button>
                      ))}
                    </div>
                  )}

                  {/* Subjects */}
                  {searchResults.subjects.length > 0 && (
                    <div className="p-2">
                      <div className="text-[10px] uppercase font-bold text-slate-400 px-2 py-1 flex items-center gap-1">
                        <span className="material-symbols-outlined text-[14px] text-[#0b1f3a]">menu_book</span>
                        <span>Disciplinas ({searchResults.subjects.length})</span>
                      </div>
                      {searchResults.subjects.map((sub) => (
                        <button
                          key={sub.id}
                          type="button"
                          onClick={() => handleSelectResult('disciplinas')}
                          className="w-full text-left px-2.5 py-2 hover:bg-slate-50 flex items-center justify-between group cursor-pointer"
                        >
                          <div>
                            <span className="font-bold text-slate-900 group-hover:text-[#0b1f3a] block">
                              {sub.name}
                            </span>
                            <span className="text-[10px] text-slate-500 font-mono">
                              Código: {sub.code} • Carga: {sub.weeklyHours || 4}h/semana
                            </span>
                          </div>
                          <span className="text-[10px] font-semibold text-blue-700 uppercase">Matriz →</span>
                        </button>
                      ))}
                    </div>
                  )}

                  {/* Invoices */}
                  {searchResults.invoices.length > 0 && (
                    <div className="p-2">
                      <div className="text-[10px] uppercase font-bold text-slate-400 px-2 py-1 flex items-center gap-1">
                        <span className="material-symbols-outlined text-[14px] text-[#0b1f3a]">receipt_long</span>
                        <span>Faturas & Propinas ({searchResults.invoices.length})</span>
                      </div>
                      {searchResults.invoices.map((inv) => (
                        <button
                          key={inv.id}
                          type="button"
                          onClick={() => handleSelectResult('propinas', inv.id)}
                          className="w-full text-left px-2.5 py-2 hover:bg-slate-50 flex items-center justify-between group cursor-pointer"
                        >
                          <div>
                            <span className="font-bold text-slate-900 group-hover:text-[#0b1f3a] block">
                              {inv.invoiceNumber} — {inv.studentName}
                            </span>
                            <span className="text-[10px] text-slate-500 font-mono">
                              {inv.period} • {Number(inv.totalAmountKz).toLocaleString()} Kz ({inv.status})
                            </span>
                          </div>
                          <span className="text-[10px] font-semibold text-blue-700 uppercase">Tesouraria →</span>
                        </button>
                      ))}
                    </div>
                  )}
                </>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Right: Actions, Academic Year Combobox & User Profile (No borders, no fill) */}
      <div className="flex items-center gap-3 lg:gap-4">
        {/* Academic Year Combobox: No borders, no background fill, full year switching */}
        <div className="hidden lg:flex items-center text-xs text-blue-100">
          {currentUser.role === 'aluno' || currentUser.role === 'encarregado' ? (
            // Alunos e encarregados só consultam: alternar o Ano Letivo Institucional muda o
            // ano ativo da escola inteira. Eles escolhem o ano a consultar no próprio portal.
            <span className="text-slate-300 font-bold text-xs pr-1 py-0.5" title="Ano Letivo Ativo da instituição">
              {currentAcademicYear}
            </span>
          ) : (
            <select
              data-bare-field
              value={currentAcademicYear}
              onChange={(e) => onAcademicYearChange(e.target.value)}
              className="bg-transparent text-slate-300 font-bold text-xs border-0 focus:outline-none cursor-pointer pr-1 py-0.5"
              title="Alternar Ano Letivo Institucional"
            >
              {availableAcademicYears.map((yr) => (
                <option key={yr} value={yr} className="bg-[#0b1f3a] text-white font-semibold">
                  {yr}
                </option>
              ))}
            </select>
          )}
        </div>

        {/* Fullscreen Toggle Button */}
        <button
          type="button"
          onClick={toggleFullscreen}
          className="p-2 rounded-lg text-blue-200 hover:text-white hover:bg-white/10 cursor-pointer hidden md:flex items-center justify-center transition-colors"
          title={isFullscreen ? 'Sair do Modo de Ecrã Inteiro' : 'Modo de Ecrã Inteiro (Tela Cheia)'}
          aria-label="Alternar Ecrã Inteiro"
        >
          <span className="material-symbols-outlined text-[20px]">
            {isFullscreen ? 'fullscreen_exit' : 'fullscreen'}
          </span>
        </button>

        {/* Modo Dia / Noite: só o ícone (sol ou lua). Fica ao lado do chat. */}
        <button
          type="button"
          onClick={toggleColorMode}
          className="color-mode-toggle p-2 rounded-lg text-blue-200 hover:text-white hover:bg-white/10 cursor-pointer flex items-center justify-center transition-colors"
          title={colorMode === 'dark' ? 'Mudar para o modo claro (dia)' : 'Mudar para o modo escuro (noite)'}
          aria-label={colorMode === 'dark' ? 'Mudar para o modo claro' : 'Mudar para o modo escuro'}
          aria-pressed={colorMode === 'dark'}
        >
          <span className="material-symbols-outlined text-[20px]" aria-hidden="true">
            {colorMode === 'dark' ? 'light_mode' : 'dark_mode'}
          </span>
        </button>

        {/* Chat Interno (estilo Messenger) — disponível para todos os perfis */}
        <InternalChatWidget db={db} currentUser={currentUser} />

        {/* Notifications Icon with Real-Time Badge */}
        <div className="relative" ref={notificationsContainerRef}>
          <button
            onClick={() => setShowNotifications(!showNotifications)}
            className={`p-2 rounded-lg transition-all relative cursor-pointer ${
              hasRecentAlert
                ? 'bg-red-600 text-white ring-2 ring-red-400 scale-105'
                : 'text-blue-200 hover:text-white hover:bg-white/10'
            }`}
            aria-label="Notificações Escolares"
            title={
              pushState === 'default'
                ? 'Notificações Escolares em Tempo Real — abra para ativar os avisos do sistema'
                : 'Notificações Escolares em Tempo Real'
            }
          >
            <span className="material-symbols-outlined text-[20px]">{pushState === 'granted' ? 'notifications_active' : 'notifications'}</span>
            {pushState === 'default' && (
              <span aria-hidden="true" className="absolute bottom-1 right-1 w-2 h-2 rounded-full bg-amber-400 border border-[#0b1f3a]" />
            )}
            {unreadCount > 0 && (
              <span className="absolute -top-1 -right-1 px-1.5 min-w-[18px] h-[18px] flex items-center justify-center rounded-full text-[10px] font-black bg-red-600 text-white shadow-xs animate-pulse">
                {unreadCount > 9 ? '9+' : unreadCount}
              </span>
            )}
          </button>

          {showNotifications && (
            <div className="absolute right-0 mt-2 w-80 sm:w-96 bg-white text-slate-800 rounded-none shadow-2xl border border-slate-300 z-50 text-xs overflow-hidden">
              <div className="bg-slate-50 px-3.5 py-2.5 border-b border-slate-200 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className="font-bold text-slate-800 text-sm">Notificações</span>
                  <span className="flex items-center gap-1 text-[10px] text-emerald-700 bg-emerald-100/80 px-1.5 py-0.5 font-medium border border-emerald-300">
                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-600 animate-ping inline-block" />
                    Tempo Real
                  </span>
                </div>
                <div className="flex items-center gap-1">
                  {unreadCount > 0 && (
                    <button
                      onClick={() => dbService.markAllNotificationsAsRead()}
                      className="text-[11px] text-blue-700 hover:text-blue-900 font-medium px-2 py-0.5 hover:bg-blue-50 cursor-pointer"
                      title="Marcar todas como lidas"
                    >
                      Marcar lidas
                    </button>
                  )}
                  {notifications.length > 0 && (
                    <button
                      onClick={() => dbService.clearAllNotifications()}
                      className="text-[11px] text-slate-400 hover:text-red-600 font-medium px-1 py-0.5 cursor-pointer"
                      title="Limpar histórico"
                    >
                      Limpar
                    </button>
                  )}
                </div>
              </div>

              {/* Avisos do sistema (push): estado e ativação, no mesmo sítio das notificações */}
              {pushState !== 'unsupported' && (
                <div className="px-3.5 py-2 border-b border-slate-200 bg-slate-50 flex items-center justify-between gap-3">
                  {pushState === 'granted' ? (
                    <span className="flex items-center gap-1.5 text-[11px] text-emerald-700 font-medium">
                      <span className="material-symbols-outlined text-[16px]">check_circle</span>
                      {tr('Notificações do sistema', lang)}: ON
                    </span>
                  ) : pushState === 'denied' ? (
                    <span className="flex items-center gap-1.5 text-[11px] text-slate-500">
                      <span className="material-symbols-outlined text-[16px]">block</span>
                      Avisos do sistema bloqueados no navegador. Permita-os nas definições do site.
                    </span>
                  ) : (
                    <>
                      <span className="text-[11px] text-slate-600 leading-snug">
                        Receber um aviso do sistema quando esta página estiver em segundo plano.
                      </span>
                      <button
                        type="button"
                        onClick={() => {
                          setShowNotifications(false);
                          handleEnablePush();
                        }}
                        className="shrink-0 px-2.5 py-1 text-[11px] font-bold bg-[#0b1f3a] text-white hover:bg-[#12335e] cursor-pointer"
                      >
                        {tr('Ativar notificações', lang)}
                      </button>
                    </>
                  )}
                </div>
              )}

              <div className="max-h-80 overflow-y-auto divide-y divide-slate-100">
                {notifications.length === 0 ? (
                  <div className="py-8 text-center px-4">
                    <span className="material-symbols-outlined text-slate-300 text-[36px]">notifications_off</span>
                    <p className="text-slate-500 text-xs mt-1">Não existem notificações pendentes.</p>
                    <p className="text-[10px] text-slate-400">Novos avisos e eventos escolares surgirão aqui em tempo real.</p>
                  </div>
                ) : (
                  notifications.map((n) => {
                    const iconColor =
                      n.type === 'finance'
                        ? 'text-emerald-700 bg-emerald-50 border-emerald-200'
                        : n.type === 'notice'
                        ? n.priority === 'urgente'
                          ? 'text-red-700 bg-red-50 border-red-200'
                          : 'text-blue-700 bg-blue-50 border-blue-200'
                        : n.type === 'attendance'
                        ? 'text-amber-700 bg-amber-50 border-amber-200'
                        : n.type === 'academic'
                        ? 'text-purple-700 bg-purple-50 border-purple-200'
                        : 'text-slate-700 bg-slate-100 border-slate-200';

                    const iconSymbol =
                      n.type === 'finance'
                        ? 'payments'
                        : n.type === 'notice'
                        ? 'campaign'
                        : n.type === 'attendance'
                        ? 'event_available'
                        : n.type === 'academic'
                        ? 'assignment'
                        : 'notifications';

                    return (
                      <div
                        key={n.id}
                        onClick={() => {
                          dbService.markNotificationAsRead(n.id);
                          if (n.linkView) {
                            onNavigate(n.linkView, n.linkId);
                            setShowNotifications(false);
                          }
                        }}
                        className={`p-3 transition-colors cursor-pointer flex gap-3 items-start group ${
                          !n.read ? 'bg-blue-50/50 hover:bg-blue-50' : 'hover:bg-slate-50'
                        }`}
                      >
                        <div
                          className={`w-7 h-7 rounded-none flex items-center justify-center shrink-0 border mt-0.5 ${iconColor}`}
                        >
                          <span className="material-symbols-outlined text-[16px]">{iconSymbol}</span>
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center justify-between gap-1">
                            <div className="flex items-center gap-1.5 truncate">
                              {!n.read && <span className="w-1.5 h-1.5 rounded-full bg-red-600 shrink-0" />}
                              <span
                                className={`text-[11px] truncate ${
                                  !n.read ? 'font-bold text-slate-900' : 'font-medium text-slate-700'
                                }`}
                              >
                                {n.title}
                              </span>
                            </div>
                            <span className="text-[10px] text-slate-400 shrink-0 font-mono">
                              {formatRelativeTime(n.createdAt, n.timestamp)}
                            </span>
                          </div>
                          <p className="text-[11px] text-slate-600 mt-0.5 line-clamp-2 leading-relaxed">
                            {n.message}
                          </p>
                        </div>
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            dbService.deleteNotification(n.id);
                          }}
                          className="opacity-0 group-hover:opacity-100 text-slate-300 hover:text-red-500 transition-opacity p-0.5 shrink-0"
                          title="Remover"
                        >
                          <span className="material-symbols-outlined text-[14px]">close</span>
                        </button>
                      </div>
                    );
                  })
                )}
              </div>

              <div className="p-2 bg-slate-50 border-t border-slate-200 flex items-center justify-between text-[11px]">
                <button
                  onClick={() => {
                    onNavigate('mural_biblioteca');
                    setShowNotifications(false);
                  }}
                  className="text-blue-700 hover:text-blue-900 font-semibold flex items-center gap-1 cursor-pointer"
                >
                  <span className="material-symbols-outlined text-[14px]">campaign</span>
                  <span>Avisos & Notificações</span>
                </button>
                <span className="text-[10px] text-slate-400">BandMed Live</span>
              </div>
            </div>
          )}
        </div>

        {/* User Identity Chip */}
        <div className="flex items-center gap-2 pl-2 border-l border-white/20">
          <img
            src={currentUser.avatar}
            alt={currentUser.name}
            className="w-8 h-8 aspect-square rounded-full object-cover ring-2 ring-white/30 shadow-xs shrink-0"
          />
          <div className="hidden xl:flex flex-col text-left">
            <span className="text-xs font-bold text-white leading-tight truncate max-w-[140px]">
              {currentUser.name}
            </span>
            <span className="text-[10px] text-blue-200 truncate max-w-[140px]">
              {currentUser.roleTitle}
            </span>
          </div>

          {onSwitchSchool && (
            <button
              onClick={onSwitchSchool}
              className="p-1 text-blue-200 hover:text-white rounded transition-colors cursor-pointer"
              title="Trocar de escola"
            >
              <span className="material-symbols-outlined text-[18px]">swap_horiz</span>
            </button>
          )}
          <button
            onClick={onLogout}
            className="p-1 text-blue-200 hover:text-red-300 rounded transition-colors cursor-pointer"
            title="Terminar Sessão"
          >
            <span className="material-symbols-outlined text-[18px]">logout</span>
          </button>
        </div>
      </div>
    </header>

    <AppConfirmModal
      isOpen={pushConfirmOpen}
      title={tr('Ativar notificações', lang)}
      message="Quer receber avisos do sistema (mensagens, comunicados e cobranças) quando esta página estiver em segundo plano? Em seguida o navegador vai pedir a sua confirmação final: escolha «Permitir» nessa janela. Pode desativar mais tarde nas definições do site."
      variant="warning"
      confirmLabel="Permitir"
      cancelLabel="Agora não"
      onConfirm={confirmEnablePush}
      onCancel={() => setPushConfirmOpen(false)}
    />
    </>
  );
};
