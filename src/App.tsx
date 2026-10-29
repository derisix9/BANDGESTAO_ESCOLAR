import React, { useState, useEffect } from 'react';
import { dbService } from './services/db';
import { recoveryPending, signupConfirmPending } from './services/supabase';
import { watchAuthState as watchSupabaseAuth, loadProfile as loadSupabaseProfile, mfaSatisfied as supabaseMfaOk, MFA_ENABLED, MFA_REQUIRED_ROLES, getPasswordGate, passwordGateBlocks, type PasswordGate } from './services/authSupabase';
import { SchoolDatabase, User, Student, UserRole } from './types';
import { Sidebar } from './components/Sidebar';
import { HeaderNav } from './components/HeaderNav';
import { useNavMode } from './utils/navModePrefs';
import { useSidebarPrefs } from './utils/sidebarPrefs';
import { Navbar } from './components/Navbar';
import { MobileTabBar } from './components/MobileTabBar';
import { SqlExportModal } from './components/SqlExportModal';
import { ReportCardModal } from './components/ReportCardModal';
import { ErrorBoundary } from './components/ErrorBoundary';
import { Spinner } from './components/Spinner';
import { OperationProvider, runGlobalOperation, showOperationSuccess } from './context/OperationContext';
import { LoginView } from './views/LoginView';
import { initPlatformLock, registerPlatformLockMap, onPlatformLockChange } from './utils/platformLock';
import { initFeatureModes, onFeatureModesChange } from './utils/featureModes';
import { NAV_GROUPS } from './utils/navCatalog';
import { PlanBlockedScreen } from './components/PlanBlockedScreen';
import { SyncStatusPill } from './components/SyncStatusPill';
import { EvasaoEscolarView } from './views/EvasaoEscolarView';
import { ContabilidadeView } from './views/ContabilidadeView';
import { SchoolPickerScreen } from './components/SchoolPickerScreen';
import { listMySchools, switchSchool, isSchoolChosen, markSchoolChosen, clearSchoolChosen, type MySchool } from './services/branches';
import { AppAlertModal } from './components/AppAlertModal';
import { onPlanLimit, PLAN_LIMIT_TITLE, type PlanLimitInfo } from './utils/planLimits';
import { clearPlanStatus, refreshPlanStatus } from './utils/planGuard';
import { getMyPlan, type MyPlan } from './services/cloud';
import { rememberedSessionExpired, clearActivity, touchActivity } from './services/sessionActivity';
import { signOutUser as signOutSupabase } from './services/authSupabase';
import { OfflineUnlockView } from './components/OfflineUnlockView';
import { isOfflineUnlocked } from './services/offlineLease';
import { getVault, isLoginBusy, VAULT_SKIP_KEY } from './services/localVault';
import { hasUnsyncedLocalChanges } from './services/localDataPolicy';
import { DashboardView } from './views/DashboardView';
import { AlunosView } from './views/AlunosView';
import { ProfessoresView } from './views/ProfessoresView';
import { FuncionariosView } from './views/FuncionariosView';
import { DepartamentosView } from './views/DepartamentosView';
import { FornecedoresView } from './views/FornecedoresView';
import { InventarioAtivosView } from './views/InventarioAtivosView';
import { ControloEstoqueView } from './views/ControloEstoqueView';
import { TransporteEscolarView } from './views/TransporteEscolarView';
import { SaudeSegurancaView } from './views/SaudeSegurancaView';
import { TurmasView } from './views/TurmasView';
import { AssiduidadeView } from './views/AssiduidadeView';
import { PautasView } from './views/PautasView';
import { PropinasView } from './views/PropinasView';
import { RelatoriosView, ListagemView } from './views/RelatoriosView';
import { DashboardPreditivoView } from './views/DashboardPreditivoView';
import { ExportacaoMEDView } from './views/ExportacaoMEDView';
import { ExamesNacionaisView } from './views/ExamesNacionaisView';
import { PlanoIndividualView } from './views/PlanoIndividualView';
import { InternatoView } from './views/InternatoView';
import { AvisosEBibliotecaView } from './views/AvisosEBibliotecaView';
import { ComunicacaoView } from './views/ComunicacaoView';
import { FolhaChamadaProvaView } from './views/FolhaChamadaProvaView';
import { VinculoFilhosView } from './views/VinculoFilhosView';
import { AdmissoesView } from './views/AdmissoesView';
import { BancoQuestoesView } from './views/BancoQuestoesView';
import { PlanoCurricularView } from './views/PlanoCurricularView';
import { AtribuicaoView } from './views/AtribuicaoView';
import { ExtracurricularesView } from './views/ExtracurricularesView';
import { RefeitorioView } from './views/RefeitorioView';
import { FolhaPagamentoView } from './views/FolhaPagamentoView';
import { AvaliacaoDesempenhoDocenteView } from './views/AvaliacaoDesempenhoDocenteView';
import { FeriasLicencasView } from './views/FeriasLicencasView';
import { ConfiguracoesView } from './views/ConfiguracoesView';
import { AlunoPortalView } from './views/AlunoPortalView';
import { ImportarPautaExcelView } from './views/ImportarPautaExcelView';
import { HomologacaoPautaView } from './views/HomologacaoPautaView';
import { EnsinoSuperiorView } from './views/EnsinoSuperiorView';
import { CalendarioEscolarView } from './views/CalendarioEscolarView';
import { PreMatriculaPublicaView } from './views/PreMatriculaPublicaView';
import { LandingView } from './views/LandingView';
import { getFallbackAcademicYear, buildAcademicYearList } from './utils/academicYear';
import { useSessionPolicy } from './hooks/useSessionPolicy';
import { enforceIpPolicy, requiresTwoFactor } from './services/securityPolicy';
import { SecurityPolicyBanner } from './components/SecurityPolicyBanner';
import { AccessEngine } from './components/AccessEngine';
import { firstAllowedConfigView, firstAllowedView, isViewAllowed } from './utils/userAccess';
import { PublicVerificationView } from './views/PublicVerificationView';
import { PublicRecordView } from './views/PublicRecordView';
import { setDataStrings } from './i18n/autoTranslate';
import { collectDataStrings } from './i18n/dataStrings';
import { PublicScannerView } from './views/PublicScannerView';
import { setPublicSecret } from './utils/publicLink';
import { applyUiPrefs } from './utils/uiPrefs';
import { newPublicSecret } from './utils/publicToken';
import { refreshPublishedRecords } from './services/publicVerify';
import { PortalProfessorView, ProfessorSection } from './views/PortalProfessorView';
import { BibliotecaEmprestimosView } from './views/BibliotecaEmprestimosView';
import { FinanceiroAvancadoView, FinanceiroSection } from './views/FinanceiroAvancadoView';
import { TrabalhosOnlineView } from './views/TrabalhosOnlineView';
import { MeusTrabalhosView } from './views/MeusTrabalhosView';
import { AvaliacaoDescritivaView } from './views/AvaliacaoDescritivaView';
import { ProcessosAcademicosView, ProcessosSection } from './views/ProcessosAcademicosView';
import { EstudioDocumentosView } from './views/EstudioDocumentosView';
import { PortalEncarregadoView, EncarregadoSection, AlunoFaltasView } from './views/PortalEncarregadoView';
import { Notice } from './components/Notice';

const getDefaultViewForRole = (role: UserRole): string => {
  if (role === 'aluno') return 'aluno_notas';
  if (role === 'encarregado') return 'encarregado_financeiro';
  if (role === 'professor') return 'pautas';
  // O Funcionário (pessoal não-docente) não tem acesso ao Dashboard de gestão;
  // a sua área inicial é o Mural de Avisos & Biblioteca.
  if (role === 'funcionario') return 'mural_biblioteca';
  return 'dashboard';
};

// Admin Master: mapa secção → subsistema (uma vez, no arranque).
registerPlatformLockMap(NAV_GROUPS);

/** Tempo (ms) do indicador de carregamento entre secções, quando a animação de páginas está desligada. */
const PAGE_LOADING_MS = 350;

export default function App() {
  const [db, setDb] = useState<SchoolDatabase>(dbService.getDatabase());

  // The values restored from localStorage below are only an OPTIMISTIC first paint
  // (so a returning user doesn't flash the login screen). They are provisional until
  // the Supabase Auth listener below confirms a real, still-valid session — see
  // isAuthResolving / handleAuthStateResolved. A stale localStorage entry with no
  // matching Supabase session is never enough, by itself, to open the app.
  const [currentUser, setCurrentUser] = useState<User | null>(() => {
    try {
      const saved = localStorage.getItem('bandmed_session_user');
      if (saved) return JSON.parse(saved);
    } catch (e) {
      console.warn('Erro ao restaurar sessão:', e);
    }
    return null;
  });
  const [isAuthenticated, setIsAuthenticated] = useState<boolean>(() => {
    if (typeof window !== 'undefined') {
      const explicitLogout = sessionStorage.getItem('bandmed_explicit_logout');
      if (explicitLogout === 'true') return false;
      try {
        const savedSession = localStorage.getItem('bandmed_session_user');
        return !!savedSession;
      } catch {
        return false;
      }
    }
    return false;
  });
  // True until Supabase Auth has reported whether this browser actually holds a
  // valid session token. While true, the optimistic state above is not trusted yet.
  const [isAuthResolving, setIsAuthResolving] = useState<boolean>(true);
  // Página principal pública: visitantes sem sessão veem-na primeiro; «Entrar» abre o login.
  // A app instalada (PWA) e o endereço ?entrar=1 vão direto para o login.
  const [showLogin, setShowLogin] = useState<boolean>(() => {
    try {
      const standalone = window.matchMedia?.('(display-mode: standalone)').matches || (navigator as any).standalone === true;
      return standalone || new URLSearchParams(window.location.search).has('entrar') || sessionStorage.getItem('bm:show-login') === '1';
    } catch { return false; }
  });
  // «Entrar / Começar grátis» na página principal abre o login NUM NOVO SEPARADOR (?entrar=1).
  // Assim o botão «voltar» do navegador/telemóvel regressa à página principal, que continua aberta.
  const openLogin = (moduleKey?: string) => {
    const url = new URL(window.location.href);
    url.search = ''; url.hash = '';
    url.searchParams.set('entrar', '1');
    if (moduleKey) url.searchParams.set('modulo', moduleKey);
    const w = window.open(url.toString(), '_blank');
    if (!w) window.location.assign(url.toString());   // pop-up bloqueado: abre no mesmo separador
  };
  const [currentView, setCurrentView] = useState<string>(() => {
    try {
      const saved = localStorage.getItem('bandmed_session_user');
      if (saved) {
        const parsed = JSON.parse(saved);
        return getDefaultViewForRole(parsed.role);
      }
    } catch {
      // ignore
    }
    return getDefaultViewForRole(currentUser?.role || 'admin');
  });
  const [isMobileNavOpen, setIsMobileNavOpen] = useState<boolean>(false);
  const [isDesktopSidebarOpen, setIsDesktopSidebarOpen] = useState<boolean>(() => {
    try {
      const saved = localStorage.getItem('bandmed_sidebar_desktop_open');
      if (saved !== null) return saved === 'true';
    } catch {
      // ignore
    }
    return true;
  });

  // Personalizar sistema → navegação no cabeçalho: em ecrã grande o menu lateral dá lugar à barra por baixo do cabeçalho.
  const headerNav = useNavMode() === 'header';
  const sidebarVisible = isDesktopSidebarOpen && !headerNav;
  React.useEffect(() => {
    // Distância do topo para cabeçalhos "colantes" das páginas (cabeçalho 4rem + barra de navegação 2.75rem).
    const apply = () => document.documentElement.style.setProperty('--bm-nav-top', headerNav && window.innerWidth >= 1024 ? '6.75rem' : '4rem');
    apply();
    window.addEventListener('resize', apply);
    return () => window.removeEventListener('resize', apply);
  }, [headerNav]);

  const handleToggleSidebar = () => {
    if (typeof window !== 'undefined' && window.innerWidth < 1024) {
      setIsMobileNavOpen((prev) => !prev);
    } else {
      setIsDesktopSidebarOpen((prev) => {
        const next = !prev;
        try {
          localStorage.setItem('bandmed_sidebar_desktop_open', String(next));
        } catch {
          // ignore
        }
        return next;
      });
    }
  };

  // Modals state
  const [isSqlModalOpen, setIsSqlModalOpen] = useState<boolean>(false);
  const [reportCardStudent, setReportCardStudent] = useState<Student | null>(null);
  const [isNoticeModalOpen, setIsNoticeModalOpen] = useState<boolean>(false);
  const [attendanceClassId, setAttendanceClassId] = useState<any>(undefined);
  // Aluno pré-seleccionado ao navegar de "Alunos" (Cadastro/Histórico) para a
  // secção "Matrículas", através do botão "Matricular" / "Nova Matrícula".
  const [matriculaStudentId, setMatriculaStudentId] = useState<string | undefined>(undefined);
  const [isLogoutModalOpen, setIsLogoutModalOpen] = useState<boolean>(false);

  // Subscribe to reactive database changes
  useEffect(() => {
    const unsubscribe = dbService.subscribe((updated) => {
      setDb(updated);
    });
    return () => unsubscribe();
  }, []);

  // Personalizar sistema: as preferências vêm das definições DA ESCOLA (base de dados), iguais para todos os utilizadores dela.
  useEffect(() => {
    applyUiPrefs(db.settings?.uiPrefs);
  }, [db.settings?.uiPrefs]);

  // Calendário académico automático: o Trimestre em curso e a abertura de um novo
  // Ano Letivo passam a depender apenas das datas configuradas (ver
  // dbService.syncAcademicCalendar). Corre no arranque e de hora a hora, para que
  // a viragem aconteça mesmo com a aplicação aberta de um dia para o outro.
  useEffect(() => {
    dbService.syncAcademicCalendar();
    const timer = setInterval(() => dbService.syncAcademicCalendar(), 60 * 60 * 1000);
    return () => clearInterval(timer);
  }, []);

  // NOTA: não há backup automático no navegador. O administrador baixa/carrega o ficheiro de backup
  // em Configurações → Segurança & Backups (SchoolRestorePoints → funções SQL da migração 0012).

  const [sessionExpiredNotice, setSessionExpiredNotice] = useState(false);
  const [pwNotice, setPwNotice] = useState<string | null>(null);
  const [pwGate, setPwGate] = useState<PasswordGate | null>(null);
  const [offlineUnlock, setOfflineUnlock] = useState<{ uid: string; name?: string; needsLease: boolean; canSkip?: boolean } | null>(null);

  // Source of truth for session validity: Supabase Auth itself, not localStorage.
  // Runs once on boot and again whenever the token is refreshed, expires, or the
  // user signs out from another tab.
  useEffect(() => {
    // O perfil vem de `profiles` (RLS); perfis sensíveis só entram com 2FA (aal2).
    // Com um link de recuperação ou de confirmação de e-mail aberto, NÃO se abre sessão: o LoginView trata disso
    // ("nova palavra-passe" / escola criada → iniciar sessão).
    const stop = watchSupabaseAuth(async (session) => {
      const explicitLogout =
        typeof window !== 'undefined' && sessionStorage.getItem('bandmed_explicit_logout') === 'true';
      // "Lembrar-me": parado há mais de 60 min (mesmo com a app fechada) → termina a sessão e pede novo login.
      if (session && !recoveryPending && !signupConfirmPending && rememberedSessionExpired()) {
        clearActivity();
        try { await signOutSupabase(); } catch { /* ignore */ }
        dbService.purgeLocalData();   // não deixa os dados da escola no computador (passo 8)
        setSessionExpiredNotice(true);
        await dbService.restoreSession(null);
        setCurrentUser(null);
        setIsAuthenticated(false);
        setIsAuthResolving(false);
        return;
      }
      if (!session && !recoveryPending && !signupConfirmPending) dbService.purgeLocalData();   // restos de uma sessão anterior (ex.: navegador fechado sem sair)
      let authProfile: User | null = null;
      let usedCachedProfile = false;
      if (session && !recoveryPending && !signupConfirmPending && !explicitLogout) {
        try { authProfile = await loadSupabaseProfile(); }
        catch (e) {
          console.warn('Servidor indisponível ao carregar o perfil; a sessão mantém-se para nova tentativa.', e);
          // Sem rede: entra com o perfil guardado neste aparelho (só se for a MESMA conta da sessão), para continuar a trabalhar offline.
          try {
            const cached = JSON.parse(localStorage.getItem('bandmed_session_user') || 'null');
            if (cached?.id && cached.id === session.user.id) { authProfile = cached as User; usedCachedProfile = true; }
          } catch { /* sem cópia local */ }
        }
      }
      // Palavra-passe temporária ou expirada (decidido no servidor, migração 0045): não abre a app; o LoginView pede a nova.
      if (authProfile && !usedCachedProfile) {
        const gate = await getPasswordGate();
        if (passwordGateBlocks(gate)) {
          setPwNotice(gate.mustChange ? 'A sua palavra-passe é temporária. Inicie sessão para definir uma nova.' : 'A sua palavra-passe expirou. Inicie sessão para definir uma nova.');
          authProfile = null;
        }
      }
      let profile: User | null = null;
      let mfaOk = false;
      let awaitingOfflineUnlock = false;
      if (authProfile) {
        try { mfaOk = await supabaseMfaOk(authProfile.role); }
        catch {
          // Sem rede: o perfil guardado só vale como 2FA cumprido para perfis SEM 2FA, ou depois de confirmar a palavra-passe
          // contra o lease criado num login online completo (passo 8; ver src/services/offlineLease.ts).
          const needsLease = MFA_ENABLED && MFA_REQUIRED_ROLES.includes(authProfile.role);
          if (!usedCachedProfile) mfaOk = false;
          else if (!needsLease || isOfflineUnlocked(sessionStorage, authProfile.id)) mfaOk = true;
          else { mfaOk = false; awaitingOfflineUnlock = true; setOfflineUnlock({ uid: authProfile.id, name: authProfile.name, needsLease: true }); }
        }
      }
      // Cofre local: navegador reaberto com a sessão ainda válida. A cópia local está cifrada e só abre com a palavra-passe.
      // Online e sem alterações por sincronizar, a pessoa pode continuar sem guardar no aparelho (tudo vem do servidor).
      const vault = getVault();
      if (vault) await vault.ready();
      if (authProfile && mfaOk && !awaitingOfflineUnlock && vault && vault.isLocked() && !isLoginBusy()
          && sessionStorage.getItem(VAULT_SKIP_KEY) !== '1') {
        mfaOk = false; awaitingOfflineUnlock = true;
        setOfflineUnlock({ uid: authProfile.id, name: authProfile.name, needsLease: false,
          canSkip: !usedCachedProfile && navigator.onLine && !hasUnsyncedLocalChanges(localStorage) });
      }
      if (authProfile && mfaOk) {
        // Carrega escola, permissões e dados desta sessão.
        profile = await dbService.restoreSession(authProfile.id);
      } else if (!awaitingOfflineUnlock) {   // à espera da palavra-passe offline: não apagar o perfil guardado
        await dbService.restoreSession(null);
      }
      if (profile) {
        touchActivity(true);
        setCurrentUser(profile);
        setIsAuthenticated(true);
        setCurrentView((prev) => prev || getDefaultViewForRole(profile!.role));
      } else {
        clearSchoolChosen();
        setCurrentUser(null);
        setIsAuthenticated(false);
      }
      setIsAuthResolving(false);
    });
    return () => stop();
  }, []);

  const handleLoginSuccess = (user: User) => {
    if (typeof window !== 'undefined') {
      sessionStorage.removeItem('bandmed_explicit_logout');
    }
    setPwNotice(null);
    setCurrentUser(user);
    setIsAuthenticated(true);
    setCurrentView(getDefaultViewForRole(user.role));
  };

  // ---------------------------------------------------------------------
  // POLÍTICAS DE SEGURANÇA (Configurações → 7. Segurança & Backups)
  // ---------------------------------------------------------------------

  // Termina a sessão automaticamente ao fim do tempo de inatividade
  // configurado, registando o encerramento na trilha de auditoria.
  const { warningSecondsLeft, keepAlive } = useSessionPolicy({
    active: isAuthenticated && !!currentUser,
    userName: currentUser?.name,
    onTimeout: () => {
      void dbService.logout();
      if (typeof window !== 'undefined') {
        sessionStorage.setItem('bandmed_explicit_logout', 'true');
      }
      setCurrentUser(null);
      setIsAuthenticated(false);
    }
  });

  // Validade da palavra-passe: avisa com antecedência e assinala a expiração.
  // Vem do SERVIDOR (days_left): a validade já não depende de definições guardadas no navegador.
  const passwordStatus = React.useMemo(() => {
    const left = pwGate?.daysLeft ?? null;
    return { expired: false, daysRemaining: left, warning: left !== null && left > 0 && left <= 7 };
  }, [pwGate]);

  // Filiais: o administrador de um grupo (escola mãe + filiais) escolhe em que escola trabalhar.
  // O painel só aparece se houver mais de uma escola; as outras contas nunca o veem.
  const [schools, setSchools] = useState<MySchool[] | null>(null);
  const [schoolPickerOpen, setSchoolPickerOpen] = useState(false);
  useEffect(() => {
    if (!isAuthenticated || !currentUser) { setSchools(null); setSchoolPickerOpen(false); return; }
    if (currentUser.role !== 'admin') { setSchools([]); return; }
    let cancelled = false;
    void listMySchools()
      .then((list) => {
        if (cancelled) return;
        setSchools(list);
        if (list.length > 1 && !isSchoolChosen(currentUser.id)) setSchoolPickerOpen(true);
      })
      .catch(() => { if (!cancelled) setSchools([]); });   // sem filiais / migração 0024 por aplicar: segue normal
    return () => { cancelled = true; };
  }, [isAuthenticated, currentUser?.id]);
  const hasMultipleSchools = (schools?.length ?? 0) > 1;
  const handleSelectSchool = async (school: MySchool): Promise<string | void> => {
    if (!currentUser) return;
    if (school.isCurrent) { markSchoolChosen(currentUser.id); setSchoolPickerOpen(false); return; }
    try {
      await switchSchool(school.id);
      markSchoolChosen(currentUser.id);
      window.location.reload();   // arranque limpo na nova escola (dados locais e em tempo real isolados)
    } catch (e: any) {
      return e?.message || 'Não foi possível entrar nesta escola.';
    }
  };

  // Plano: teste de 30 dias → pendente (bloqueada) até pagar. O bloqueio é imposto pela base de dados;
  // aqui só se mostra o aviso (ecrã de bloqueio ou faixa com os dias que restam).
  const [plan, setPlan] = useState<MyPlan | null>(null);
  useEffect(() => {
    if (!isAuthenticated || !currentUser) { setPlan(null); return; }
    let cancelled = false;
    void getMyPlan().then((p) => { if (!cancelled) setPlan(p); });
    return () => { cancelled = true; };
  }, [isAuthenticated, currentUser?.id]);
  // Limite do plano atingido (alunos, utilizadores, armazenamento): o servidor recusou a gravação;
  // aqui mostra-se uma janela clara em vez de uma falha silenciosa (ver src/utils/planLimits.ts).
  const [planLimit, setPlanLimit] = useState<PlanLimitInfo | null>(null);
  useEffect(() => onPlanLimit((info) => setPlanLimit(info)), []);
  // Estado do plano (alunos/utilizadores/armazenamento) sempre à mão para recusar o cadastro ANTES de gravar.
  useEffect(() => {
    if (!isAuthenticated || !currentUser) { clearPlanStatus(); return; }
    void refreshPlanStatus(true);
    const t = window.setInterval(() => { void refreshPlanStatus(true); }, 60_000);
    return () => window.clearInterval(t);
  }, [isAuthenticated, currentUser?.id]);
  // Admin Master: carrega os subsistemas/secções bloqueados pela plataforma e redesenha o menu.
  const [, setLockTick] = useState(0);
  useEffect(() => onPlatformLockChange(() => setLockTick((n) => n + 1)), []);
  useEffect(() => {
    if (!isAuthenticated || !currentUser) return;
    void initPlatformLock();
  }, [isAuthenticated, currentUser?.id]);
  // Admin Master: modos (oculto/leitura/gravação) das áreas avançadas — Integrações e Backup automático.
  useEffect(() => onFeatureModesChange(() => setLockTick((n) => n + 1)), []);
  useEffect(() => {
    if (!isAuthenticated || !currentUser) return;
    void initFeatureModes();
    const refresh = () => { if (document.visibilityState === 'visible') void initFeatureModes(); };
    document.addEventListener('visibilitychange', refresh);
    return () => document.removeEventListener('visibilitychange', refresh);
  }, [isAuthenticated, currentUser?.id]);
  // Avisos na caixa de entrada: admissões online e transferências recebidas.
  useEffect(() => {
    if (!isAuthenticated || !currentUser) return;
    if (!['admin', 'director', 'secretaria'].includes(currentUser.role)) return;
    return dbService.startInboxWatchers();
  }, [isAuthenticated, currentUser?.id]);
  const handlePlanLogout = () => {
    void dbService.logout();
    if (typeof window !== 'undefined') sessionStorage.setItem('bandmed_explicit_logout', 'true');
    setCurrentUser(null);
    setIsAuthenticated(false);
  };

  // Sub-redes autorizadas: só é verificado quando existem intervalos de IP
  // configurados; fora deles, a sessão é encerrada e o evento auditado.
  // A decisão é do servidor (RLS + Edge Functions, migração 0043); aqui só se mostra a mensagem. Repete de 5 em 5 minutos
  // porque o IP pode mudar a meio da sessão (ex.: dados móveis).
  const [ipBlocked, setIpBlocked] = useState<{ ip: string | null } | null>(null);
  useEffect(() => {
    if (!isAuthenticated || !currentUser) return;
    let cancelled = false;
    const check = () => void enforceIpPolicy().then((result) => {
      if (cancelled || result.allowed) return;
      setIpBlocked({ ip: result.ip });
      void dbService.logout();
      setCurrentUser(null);
      setIsAuthenticated(false);
    });
    const checkPassword = () => void getPasswordGate().then((g) => {
      if (cancelled) return;
      setPwGate(g);
      if (!passwordGateBlocks(g)) return;
      setPwNotice(g.mustChange ? 'O administrador pediu que defina uma nova palavra-passe. Inicie sessão novamente.' : 'A sua palavra-passe expirou. Inicie sessão novamente para definir uma nova.');
      void dbService.logout();
      setCurrentUser(null);
      setIsAuthenticated(false);
    });
    check();
    checkPassword();
    const timer = window.setInterval(() => { check(); checkPassword(); }, 5 * 60_000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [isAuthenticated, currentUser?.id]);

  const twoFactorPending = requiresTwoFactor(currentUser?.role);

  // ---------------------------------------------------------------------
  // ACESSO POR UTILIZADOR (secções → modo → botões) — ver utils/userAccess.ts
  // ---------------------------------------------------------------------
  // Utilizador da sessão com o acesso MAIS RECENTE: se o Administrador alterar
  // as permissões enquanto esta pessoa está ligada, o menu e os botões mudam
  // em tempo real, sem ela ter de voltar a entrar.
  const sessionUser = React.useMemo<User | null>(() => {
    if (!currentUser) return null;
    const live = db.users?.find((u) => u.id === currentUser.id);
    return live ? { ...currentUser, ...live } : currentUser;
  }, [currentUser, db.users]);

  const viewAllowed = !!sessionUser && isViewAllowed(sessionUser, currentView);

  // Carregamento curto ao trocar de secção quando a «Animação ao abrir páginas» está DESLIGADA:
  // mostra o indicador e só depois a página (≈0,35 s). Com a animação ligada não há indicador.
  const pagePrefs = useSidebarPrefs();
  const [shownView, setShownView] = useState<string>(currentView);
  const viewLoading = !pagePrefs.pageAnim && shownView !== currentView;
  useEffect(() => {
    if (shownView === currentView) return;
    const t = window.setTimeout(() => setShownView(currentView), pagePrefs.pageAnim ? 0 : PAGE_LOADING_MS);
    return () => window.clearTimeout(t);
  }, [currentView, shownView, pagePrefs.pageAnim]);

  // Perdeu a secção atual (ou abriu uma que não tem)? Vai para a primeira permitida.
  useEffect(() => {
    if (!sessionUser || !isAuthenticated) return;
    if (currentView === 'configuracoes') {
      const tab = firstAllowedConfigView(sessionUser);
      if (tab) setCurrentView(tab);
      return;
    }
    if (!isViewAllowed(sessionUser, currentView)) {
      const next = firstAllowedView(sessionUser, getDefaultViewForRole(sessionUser.role));
      if (next && next !== currentView) setCurrentView(next);
    }
  }, [sessionUser, currentView, isAuthenticated]);

  const handleLogoutClick = () => {
    setIsLogoutModalOpen(true);
  };

  const handleConfirmLogout = async () => {
    setIsLogoutModalOpen(false);
    await runGlobalOperation(
      async () => {
        await dbService.logout();
        if (typeof window !== 'undefined') {
          sessionStorage.setItem('bandmed_explicit_logout', 'true');
        }
      },
      {
        loadingMessage: 'A terminar sessão no sistema com segurança...',
        successMessage: 'Sessão terminada com sucesso!'
      }
    );
    setCurrentUser(null);
    setIsAuthenticated(false);
  };

  // Tradução automática (Inglês): os dados inseridos na base de dados (nomes, turmas, moradas…) nunca são traduzidos.
  useEffect(() => {
    const t = window.setTimeout(() => setDataStrings(collectDataStrings(db)), 800);
    return () => window.clearTimeout(t);
  }, [db]);

  // Tokens públicos dos QR / códigos de barras: segredo da instituição (criado uma vez) e registos públicos
  // das pessoas já emitidas, mantidos actualizados (mensalidade, transporte) para a consulta sem login.
  setPublicSecret(db.settings?.publicVerifySecret || '');
  useEffect(() => {
    if (isAuthenticated && currentUser && db.settings && !db.settings.publicVerifySecret) {
      dbService.updateSettings({ publicVerifySecret: newPublicSecret() });
    }
  }, [isAuthenticated, currentUser?.id, db.settings?.publicVerifySecret]);
  // Publica o nome e o logótipo DA ESCOLA para o link público de Candidaturas Online (sem sessão).
  useEffect(() => {
    if (!isAuthenticated || !currentUser || !db.settings) return;
    const t = window.setTimeout(() => { void dbService.publishPublicSchoolBrand(); }, 3000);
    return () => window.clearTimeout(t);
  }, [isAuthenticated, currentUser?.id, db.settings?.logoUrl, db.settings?.schoolName, db.courses]);
  useEffect(() => {
    if (!isAuthenticated || !currentUser || !db.settings?.publicVerifySecret) return;
    const t = window.setTimeout(() => { void refreshPublishedRecords(db, dbService.activeInstitutionId); }, 8000);
    return () => window.clearTimeout(t);
  }, [isAuthenticated, currentUser?.id, db.invoices, db.transportRoutes, db.payrollRecords, db.students, db.settings?.publicVerifySecret]);

  const handleResetData = () => {
    if (confirm('Tem a certeza que deseja repor os registos padrão da instituição?')) {
      dbService.resetToDefaults();
      void showOperationSuccess('Registos institucionais repostos com sucesso!');
    }
  };

  // Pré-Matrícula Online: link público (sem login), acedido por candidatos e
  // encarregados de educação através de ?pre-matricula=1 (ver botão "Link
  // Pré-Matrícula Online" em Serviços → Admissões). Verificado antes de
  // qualquer ecrã de autenticação — esta página nunca exige sessão.
  if (typeof window !== 'undefined') {
    const params = new URLSearchParams(window.location.search);
    if (params.has('pre-matricula')) {
      const inst = params.get('inst');
      if (inst) dbService.activeInstitutionId = inst;
      return <PreMatriculaPublicaView schoolName={db.settings?.schoolName} />;
    }
    // Validação Pública de QR Code (Cartões de Estudante e Crachás):
    // Link aberto sem necessidade de login. Apresenta ficha institucional,
    // situação financeira e histórico académico (com bloqueio do trimestre em curso se devedor)
    // ou ficha do funcionário e folha de pagamento.
    if (params.get('scan') === '1') return <PublicScannerView />;
    if (params.get('public_verify') === 'true' || params.get('verify') === 'true' || params.has('pv')) {
      const inst = params.get('inst');
      if (inst) dbService.activeInstitutionId = inst;
      // QR / código de barras: o registo público vem da nuvem pelo token; sem token usa os dados locais.
      return (
        <PublicRecordView
          db={db}
          onGoToLogin={() => {
            const url = new URL(window.location.href);
            url.searchParams.delete('public_verify');
            url.searchParams.delete('verify');
            window.history.replaceState({}, '', url.toString());
            window.location.reload();
          }}
        />
      );
    }
  }

  if (isAuthResolving) {
    return (
      <div className="min-h-screen bg-[#f8fafc] flex items-center justify-center">
        <div className="flex flex-col items-center gap-3 text-slate-400">
          <Spinner size={48} />
          <span className="text-xs font-semibold uppercase tracking-wider">A verificar sessão...</span>
        </div>
      </div>
    );
  }

  if (!isAuthenticated || !currentUser) {
    if (offlineUnlock) {
      return (
        <OfflineUnlockView
          uid={offlineUnlock.uid}
          name={offlineUnlock.name}
          requireMfa={offlineUnlock.needsLease}
          canSkip={offlineUnlock.canSkip}
          onUnlocked={() => window.location.reload()}   // a chave fica no sessionStorage: ao recarregar, entra
          onCancel={() => setOfflineUnlock(null)}
        />
      );
    }
    if (!showLogin) return <LandingView onEnter={openLogin} />;
    return (
      <OperationProvider>
        {ipBlocked && (
          <Notice tone="error" icon="gpp_bad">
            Acesso recusado: o posto de trabalho{ipBlocked.ip ? ` (${ipBlocked.ip})` : ''} não pertence às redes
            autorizadas da instituição. Contacte o Administrador Geral (se foi bloqueado por engano, a equipa BandMed pode repor o acesso).
          </Notice>
        )}
        {pwNotice && (
          <Notice tone="warn">{pwNotice}</Notice>
        )}
        {sessionExpiredNotice && (
          <Notice tone="warn">A sessão terminou por inatividade (mais de 1 hora). Inicie sessão novamente.</Notice>
        )}
        <LoginView onLoginSuccess={handleLoginSuccess} />
      </OperationProvider>
    );
  }

  if (currentUser.role === 'admin' && schools === null) {
    return (
      <div className="min-h-screen bg-[#f8fafc] flex items-center justify-center">
        <Spinner size={48} />
      </div>
    );
  }
  if (schoolPickerOpen && schools && schools.length > 1) {
    const alreadyChosen = isSchoolChosen(currentUser.id);
    return (
      <SchoolPickerScreen
        schools={schools}
        adminName={currentUser.name}
        onSelect={handleSelectSchool}
        onCancel={alreadyChosen ? () => setSchoolPickerOpen(false) : undefined}
        onLogout={handlePlanLogout}
      />
    );
  }

  if (plan && !plan.active) {
    return <PlanBlockedScreen schoolName={plan.schoolName} role={currentUser.role} onLogout={handlePlanLogout} />;
  }

  return (
    <OperationProvider>
      <div className="app-shell min-h-screen bg-[#f8fafc] text-slate-800 flex flex-col font-body antialiased">
      {plan?.status === 'pago' && plan.paidDaysLeft !== null && plan.paidDaysLeft <= 15 && currentUser.role === 'admin' && (
        <Notice tone="warn">
          O plano termina em {plan.paidDaysLeft} {plan.paidDaysLeft === 1 ? 'dia' : 'dias'}. Renove para não perder o acesso.
        </Notice>
      )}
      {plan?.inGrace && (currentUser.role === 'admin' || currentUser.role === 'director') && (
        <Notice tone="warn">
          Plano expirado — tolerância concedida: restam {plan.graceDaysLeft ?? 0} {plan.graceDaysLeft === 1 ? 'dia' : 'dias'}.
          Regularize o pagamento (Configurações › Plano e Subscrição) ou a conta bloqueia sozinha.
        </Notice>
      )}
      <SyncStatusPill />
      <AppAlertModal
        isOpen={!!planLimit}
        title={planLimit ? PLAN_LIMIT_TITLE[planLimit.kind] : undefined}
        message={planLimit?.message || ''}
        variant="error"
        onClose={() => setPlanLimit(null)}
      />
      {plan?.status === 'trial' && plan.daysLeft !== null && plan.daysLeft <= 7 && currentUser.role === 'admin' && (
        <Notice tone="warn">
          Período de teste: restam {plan.daysLeft} {plan.daysLeft === 1 ? 'dia' : 'dias'}. Depois, o acesso fica bloqueado até o plano ser pago.
        </Notice>
      )}
      {/* Sidebar Navigation */}
      <Sidebar
        currentView={currentView}
        onNavigate={setCurrentView}
        currentUserRole={currentUser.role}
        currentUser={sessionUser}
        db={db}
        isMobileOpen={isMobileNavOpen}
        onCloseMobile={() => setIsMobileNavOpen(false)}
        isDesktopOpen={sidebarVisible}
        onToggleDesktop={(open) => {
          const next = typeof open === 'boolean' ? open : !isDesktopSidebarOpen;
          setIsDesktopSidebarOpen(next);
          try {
            localStorage.setItem('bandmed_sidebar_desktop_open', String(next));
          } catch {
            // ignore
          }
        }}
        onLogout={handleLogoutClick}
      />

      {/* Top Navbar */}
      <Navbar
        currentUser={currentUser}
        currentAcademicYear={db.settings?.currentAcademicYear || getFallbackAcademicYear()}
        availableAcademicYears={buildAcademicYearList(db.settings)}
        onAcademicYearChange={(year) => {
          dbService.setAcademicYear(year);
        }}
        onOpenMobileMenu={() => setIsMobileNavOpen(true)}
        isDesktopSidebarOpen={isDesktopSidebarOpen}
        headerNav={headerNav}
        onToggleSidebar={handleToggleSidebar}
        onOpenSqlExport={() => setIsSqlModalOpen(true)}
        onResetData={handleResetData}
        onLogout={handleLogoutClick}
        onSwitchSchool={hasMultipleSchools ? () => setSchoolPickerOpen(true) : undefined}
        onNavigate={(view, targetId) => {
          if (view === 'assiduidade' && targetId) {
            setAttendanceClassId(targetId);
          }
          setCurrentView(view);
        }}
        db={db}
      />

      {headerNav && (
        <HeaderNav
          currentView={currentView}
          onNavigate={setCurrentView}
          currentUserRole={currentUser.role}
          currentUser={sessionUser}
          db={db}
        />
      )}

      {/* App móvel: barra de separadores + menu com todas as secções (só < 1024px) */}
      <MobileTabBar
        currentView={currentView}
        onNavigate={setCurrentView}
        currentUserRole={currentUser.role}
        currentUser={sessionUser}
        db={db}
        onLogout={handleLogoutClick}
      />

      {/* Main Content Area */}
      <main data-app-main className={`${sidebarVisible ? 'lg:ml-64' : 'lg:ml-0'} ${headerNav ? 'lg:pt-[7.75rem]' : ''} pt-20 px-4 lg:px-8 flex-1 transition-all duration-300 min-w-0`}>
        {/* Com o menu lateral minimizado o conteúdo ocupa toda a largura; com ele aberto mantém o limite de leitura. */}
        <div className={`${sidebarVisible ? 'max-w-7xl mx-auto' : 'w-full max-w-none'} transition-[max-width] duration-300`}>
          {/* Avisos das políticas de segurança em vigor */}
          <SecurityPolicyBanner
            inactivitySecondsLeft={warningSecondsLeft}
            onKeepAlive={keepAlive}
            passwordStatus={passwordStatus}
            twoFactorPending={twoFactorPending}
            onOpenSecuritySettings={() => setCurrentView('configuracoes')}
          />

          {/* Motor de acesso: deteta botões novos e aplica o modo (ver / gravar) e os botões permitidos. */}
          <AccessEngine view={currentView} user={sessionUser} />

          {!viewAllowed && (
            <div data-acl-ignore className="p-10 my-6 bg-white rounded-2xl border border-slate-200 shadow-xs flex flex-col items-center text-center max-w-xl mx-auto">
              <span className="material-symbols-outlined text-[40px] text-slate-400 mb-2">lock</span>
              <h2 className="font-headline text-lg font-bold text-slate-900">Sem acesso a esta secção</h2>
              <p className="text-xs text-slate-500 mt-1">
                O Administrador não ativou esta secção para o seu utilizador. Se precisar dela, peça-lhe que a ative em
                Configurações → Criação de Utilizadores.
              </p>
            </div>
          )}

          {viewAllowed && viewLoading && (
            <div data-acl-ignore className="flex items-center justify-center" style={{ minHeight: '60vh' }} role="status" aria-live="polite">
              <Spinner size={44} />
            </div>
          )}

          <ErrorBoundary onReset={() => setCurrentView(getDefaultViewForRole(currentUser.role))}>
            {viewAllowed && !viewLoading && (<>
            {/* Student & Guardian Portal Views */}
            {(currentView === 'aluno_notas' || (currentUser.role === 'aluno' && currentView === 'dashboard')) && (
              <AlunoPortalView
                db={db}
                currentUser={currentUser}
                currentUserRole={currentUser.role}
                initialTab="notas"
              />
            )}

            {currentView === 'aluno_financeiro' && (
              <AlunoPortalView
                db={db}
                currentUser={currentUser}
                currentUserRole={currentUser.role}
                initialTab="financeiro"
              />
            )}

            {(currentView === 'encarregado_financeiro' || (currentUser.role === 'encarregado' && currentView === 'dashboard')) && (
              <AlunoPortalView
                db={db}
                currentUser={currentUser}
                currentUserRole={currentUser.role}
                initialTab="financeiro"
              />
            )}

            {/* Dashboard: quem decide o acesso é o editor de permissões (viewAllowed); alunos e encarregados têm o seu portal. */}
            {currentView === 'dashboard' && currentUser.role !== 'aluno' && currentUser.role !== 'encarregado' && (
              <DashboardView
                db={db}
                onNavigate={setCurrentView}
                currentUserRole={currentUser.role}
                onOpenNewStudentModal={() => setCurrentView('alunos')}
                onOpenNoticeModal={() => {
                  setCurrentView('mural_biblioteca');
                  setIsNoticeModalOpen(true);
                }}
                onOpenReportCard={(student) => setReportCardStudent(student)}
              />
            )}

            {currentView === 'alunos' && (
              <AlunosView
                db={db}
                currentUserRole={currentUser.role}
                onOpenReportCard={(student) => setReportCardStudent(student)}
                mode="cadastro"
                onNavigateToMatriculas={(studentId) => {
                  setMatriculaStudentId(studentId);
                  setCurrentView('matriculas');
                }}
              />
            )}

            {currentView === 'matriculas' && (
              <AlunosView
                db={db}
                currentUserRole={currentUser.role}
                onOpenReportCard={(student) => setReportCardStudent(student)}
                mode="matriculas"
                initialStudentId={matriculaStudentId}
                onNavigateToMatriculas={(studentId) => setMatriculaStudentId(studentId)}
              />
            )}

            {currentView === 'professores' && (
              <ProfessoresView db={db} currentUserRole={currentUser.role} />
            )}

            {currentView === 'funcionarios' && (
              <FuncionariosView db={db} currentUserRole={currentUser.role} />
            )}

            {currentView === 'departamentos' && (
                <DepartamentosView db={db} currentUserRole={currentUser.role} />
              )}

            {currentView === 'fornecedores' && (
              <FornecedoresView db={db} currentUserRole={currentUser.role} />
            )}

            {currentView === 'inventario_ativos' && (
              <InventarioAtivosView db={db} currentUserRole={currentUser.role} />
            )}

            {currentView === 'controlo_estoque' && (
              <ControloEstoqueView db={db} currentUserRole={currentUser.role} />
            )}

            {currentView === 'transporte_escolar' && (
              <TransporteEscolarView db={db} currentUserRole={currentUser.role} />
            )}

            {(currentView === 'saude_ficha_medica' ||
              currentView === 'saude_incidentes' ||
              currentView === 'saude_recolha') && (
                <SaudeSegurancaView
                  db={db}
                  currentUserRole={currentUser.role}
                  section={currentView as 'saude_ficha_medica' | 'saude_incidentes' | 'saude_recolha'}
                />
              )}

            {(currentView === 'turmas' ||
              currentView === 'disciplinas' ||
              currentView === 'horarios' ||
              currentView === 'cursos' ||
              currentView === 'mapa_salas') && (
                <TurmasView
                  db={db}
                  currentUserRole={currentUser.role}
                  currentUser={currentUser}
                  section={currentView as 'turmas' | 'disciplinas' | 'horarios' | 'cursos' | 'mapa_salas'}
                  onNavigateToAttendance={(classId) => {
                    setAttendanceClassId(classId);
                    setCurrentView('assiduidade');
                  }}
                  onNavigateToStudents={() => setCurrentView('alunos')}
                  onNavigateToPautas={() => setCurrentView('pautas')}
                />
              )}

            {currentView === 'atribuicao' && (
              <AtribuicaoView db={db} currentUserRole={currentUser.role} />
            )}

            {currentView === 'assiduidade' && (
              <AssiduidadeView
                db={db}
                currentUserRole={currentUser.role}
                currentUser={currentUser}
                initialClassId={attendanceClassId}
              />
            )}

            {currentView === 'pautas' && (
              <PautasView
                db={db}
                currentUserRole={currentUser.role}
                currentUser={currentUser}
                onNavigateToImport={() => setCurrentView('importar_pauta')}
              />
            )}

            {currentView === 'importar_pauta' && (
              <ImportarPautaExcelView
                db={db}
                currentUserRole={currentUser.role}
                currentUser={currentUser}
                onBackToPautas={() => setCurrentView('pautas')}
                onNavigateToHomologacao={() => setCurrentView('homologacao_pauta')}
              />
            )}

            {currentView === 'homologacao_pauta' && (
              <HomologacaoPautaView
                db={db}
                currentUserRole={currentUser.role}
                onBackToPautas={() => setCurrentView('pautas')}
                onNavigateToImport={() => setCurrentView('importar_pauta')}
              />
            )}

            {currentView === 'calendario_escolar' && (
              <CalendarioEscolarView
                db={db}
                currentUser={currentUser}
                currentUserRole={currentUser.role}
                onNavigate={setCurrentView}
              />
            )}

            {currentView === 'propinas' && (
              <PropinasView db={db} currentUserRole={currentUser.role} />
            )}

            {currentView === 'mural_biblioteca' && (
              <AvisosEBibliotecaView
                db={db}
                currentUser={currentUser}
                currentUserRole={currentUser.role}
                isNoticeModalOpen={isNoticeModalOpen}
                setIsNoticeModalOpen={setIsNoticeModalOpen}
                onOpenReportCard={(student) => setReportCardStudent(student)}
              />
            )}

            {(currentView === 'comunicacao_notificacoes' ||
              currentView === 'comunicacao_reunioes') && (
                <ComunicacaoView
                  db={db}
                  currentUserRole={currentUser.role}
                  section={currentView as 'comunicacao_notificacoes' | 'comunicacao_reunioes'}
                />
              )}

            {currentView === 'folha_chamada_prova' && (
              <FolhaChamadaProvaView db={db} currentUserRole={currentUser.role} currentUser={currentUser} />
            )}

            {currentView === 'vinculo_filhos' && (
              <VinculoFilhosView db={db} currentUserRole={currentUser.role} currentUser={currentUser} />
            )}

            {currentView === 'admissoes' && (
              <AdmissoesView
                db={db}
                currentUserRole={currentUser.role}
                currentUser={currentUser}
                onNavigateToMatriculas={(studentId) => {
                  setMatriculaStudentId(studentId);
                  setCurrentView('matriculas');
                }}
              />
            )}

            {currentView === 'banco_questoes' && (
              <BancoQuestoesView db={db} currentUserRole={currentUser.role} currentUser={currentUser} />
            )}

            {currentView === 'ensino_superior' && (
              <EnsinoSuperiorView
                db={db}
                currentUser={currentUser}
                currentUserRole={currentUser.role}
                onNavigateToStudent={(studentId) => {
                  setMatriculaStudentId(studentId);
                  setCurrentView('alunos');
                }}
              />
            )}

            {currentView === 'plano_curricular' && (
              <PlanoCurricularView db={db} currentUserRole={currentUser.role} />
            )}

            {currentView === 'atividades_extracurriculares' && (
              <ExtracurricularesView db={db} currentUserRole={currentUser.role} />
            )}

            {currentView === 'refeitorio' && (
              <RefeitorioView db={db} currentUserRole={currentUser.role} />
            )}

            {currentView === 'folha_pagamento' && (
              <FolhaPagamentoView db={db} currentUserRole={currentUser.role} />
            )}

            {currentView === 'avaliacao_desempenho_docente' && (
              <AvaliacaoDesempenhoDocenteView db={db} currentUserRole={currentUser.role} />
            )}

            {currentView === 'ferias_licencas' && (
              <FeriasLicencasView db={db} currentUserRole={currentUser.role} />
            )}

            {currentView === 'relatorios' && (
              <RelatoriosView db={db} currentUserRole={currentUser.role} />
            )}

            {currentView === 'listagem' && (
              <ListagemView db={db} currentUserRole={currentUser.role} />
            )}

            {currentView === 'dashboard_preditivo' && (
              <DashboardPreditivoView db={db} currentUserRole={currentUser.role} />
            )}

            {currentView === 'evasao_escolar' && (
              <EvasaoEscolarView db={db} currentUserRole={currentUser.role} />
            )}

            {currentView === 'balancete_contabilistico' && (
              <ContabilidadeView db={db} currentUserRole={currentUser.role} />
            )}

            {currentView === 'exames_nacionais' && (
              <ExamesNacionaisView db={db} currentUserRole={currentUser.role} />
            )}

            {currentView === 'plano_individual' && (
              <PlanoIndividualView db={db} currentUserRole={currentUser.role} />
            )}

            {currentView === 'internato' && (
              <InternatoView db={db} currentUserRole={currentUser.role} />
            )}

            {currentView === 'exportacao_med' && (
              <ExportacaoMEDView db={db} currentUserRole={currentUser.role} />
            )}

            {/* Portal do Professor */}
            {(currentView === 'professor_plano_aulas' ||
              currentView === 'professor_sumarios' ||
              currentView === 'professor_materiais') && (
                <PortalProfessorView
                  db={db}
                  currentUser={currentUser}
                  currentUserRole={currentUser.role}
                  section={currentView as ProfessorSection}
                />
              )}

            {/* Biblioteca: empréstimos & multas */}
            {currentView === 'biblioteca_emprestimos' && (
              <BibliotecaEmprestimosView db={db} currentUserRole={currentUser.role} />
            )}

            {/* Tesouraria: planos & bolsas, conciliação bancária, despesas & fluxo de caixa */}
            {(currentView === 'planos_descontos' ||
              currentView === 'conciliacao_bancaria' ||
              currentView === 'contabilidade') && (
                <FinanceiroAvancadoView
                  db={db}
                  currentUserRole={currentUser.role}
                  section={currentView as FinanceiroSection}
                />
              )}

            {/* Ensino à distância e avaliação descritiva */}
            {currentView === 'ead_trabalhos' && (
              <TrabalhosOnlineView db={db} currentUser={currentUser} currentUserRole={currentUser.role} />
            )}

            {currentView === 'aluno_faltas' && <AlunoFaltasView db={db} currentUser={currentUser} />}

            {currentView === 'aluno_trabalhos' && (
              <MeusTrabalhosView db={db} currentUser={currentUser} currentUserRole={currentUser.role} />
            )}

            {currentView === 'avaliacao_descritiva' && (
              <AvaliacaoDescritivaView db={db} currentUser={currentUser} currentUserRole={currentUser.role} />
            )}

            {/* Processos académicos: documentos, transferências, conselho de turma, recuperação */}
            {(currentView === 'documentos_academicos' ||
              currentView === 'transferencias' ||
              currentView === 'conselho_turma' ||
              currentView === 'recuperacao_recurso') && (
                <ProcessosAcademicosView
                  db={db}
                  currentUserRole={currentUser.role}
                  section={currentView as ProcessosSection}
                />
              )}

            {currentView === 'estudio_documentos' && (
              <EstudioDocumentosView
                db={db}
                currentUserRole={currentUser.role}
                onNavigateToStudent={(studentId) => {
                  setMatriculaStudentId(studentId);
                  setCurrentView('alunos');
                }}
              />
            )}

            {/* Portal do Encarregado de Educação */}
            {currentView === 'encarregado_notas' && (
              <AlunoPortalView
                db={db}
                currentUser={currentUser}
                currentUserRole={currentUser.role}
                initialTab="notas"
              />
            )}

            {(currentView === 'encarregado_faltas' ||
              currentView === 'encarregado_comunicados' ||
              currentView === 'encarregado_reunioes' ||
              currentView === 'encarregado_descritiva') && (
                <PortalEncarregadoView
                  db={db}
                  currentUser={currentUser}
                  section={currentView as EncarregadoSection}
                />
              )}

            {currentView.startsWith('configuracoes') && (
              <ConfiguracoesView
                db={db}
                currentUserRole={currentUser.role}
                onOpenSqlExport={() => setIsSqlModalOpen(true)}
                onResetData={handleResetData}
                initialTab={
                  currentView.includes('/')
                    ? (currentView.split('/')[1] as any)
                    : undefined
                }
              />
            )}
            </>)}
          </ErrorBoundary>
        </div>
      </main>

      {/* SQL Export Modal */}
      <SqlExportModal
        db={db}
        isOpen={isSqlModalOpen}
        onClose={() => setIsSqlModalOpen(false)}
      />

      {/* Official Report Card Modal */}
      {reportCardStudent && (
        <ErrorBoundary onReset={() => setReportCardStudent(null)}>
          <ReportCardModal
            student={reportCardStudent}
            db={db}
            onClose={() => setReportCardStudent(null)}
          />
        </ErrorBoundary>
      )}

      {/* Modal: Confirmação ao Terminar Sessão */}
      {isLogoutModalOpen && (
        <div data-no-resize data-acl-ignore className="fixed inset-0 bg-black/60 backdrop-blur-xs z-50 flex items-center justify-center p-4 animate-fade-in">
          <div className="bg-white rounded-none max-w-md w-full shadow-2xl overflow-hidden border border-slate-300">
            <div className="px-6 py-4 bg-[#0b1f3a] text-white flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="material-symbols-outlined text-[20px] text-red-400">warning</span>
                <h3 className="font-bold text-base">Terminar Sessão</h3>
              </div>
              <button
                type="button"
                onClick={() => setIsLogoutModalOpen(false)}
                className="text-slate-300 hover:text-white p-1 hover:bg-white/10 transition-colors cursor-pointer"
                title="Fechar"
              >
                <span className="material-symbols-outlined text-[20px]">close</span>
              </button>
            </div>

            <div className="p-6">
              <div className="w-12 h-12 rounded-none bg-red-100 text-[#ac332b] flex items-center justify-center mx-auto mb-4 border border-red-200">
                <span className="material-symbols-outlined text-[28px]">logout</span>
              </div>
              <h3 className="font-headline text-lg font-bold text-slate-900 text-center">
                Terminar Sessão no Sistema?
              </h3>
              <p className="text-xs text-slate-600 text-center mt-2 leading-relaxed">
                Pretende encerrar a sessão de trabalho do utilizador <strong className="text-slate-900">{currentUser.name}</strong> ({currentUser.roleTitle})? Para aceder novamente à plataforma do Complexo Escolar Privado BandMed será necessário introduzir as suas credenciais de autenticação.
              </p>
            </div>

            <div className="px-6 py-4 bg-slate-50 border-t border-slate-300 flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={() => setIsLogoutModalOpen(false)}
                className="px-4 py-2.5 rounded-none bg-slate-200 hover:bg-slate-300 text-slate-700 font-bold text-xs cursor-pointer border border-slate-300"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={handleConfirmLogout}
                className="px-5 py-2.5 rounded-none bg-[#b91c1c] hover:bg-[#7a0c0c] text-white font-bold text-xs flex items-center gap-2 cursor-pointer transition-colors shadow-none border-none"
              >
                <span className="material-symbols-outlined text-[16px]">logout</span>
                <span>Confirmar</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
    </OperationProvider>
  );
}
