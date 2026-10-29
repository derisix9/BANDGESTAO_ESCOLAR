import React from 'react';
import { User, UserRole } from '../types';
import { NAV_GROUPS, NavGroup } from '../utils/navCatalog';
import { canViewSection, getSessionUser } from '../utils/userAccess';
import { LANGS, setLang, tr } from '../i18n';
import { FlagIcon, FLAG_BY_LANG } from './FlagIcon';
import { useLang } from '../i18n/useLang';
import { playPageAnimation, useSidebarPrefs } from '../utils/sidebarPrefs';
import { isMenuViewHidden } from '../utils/menuVisibility';
import type { SchoolDatabase } from '../types';

interface SidebarProps {
  currentView: string;
  onNavigate: (view: string) => void;
  currentUserRole: UserRole;
  /** Utilizador da sessão (com o acesso personalizado). Define o que aparece no menu. */
  currentUser?: User | null;
  isMobileOpen: boolean;
  onCloseMobile: () => void;
  isDesktopOpen?: boolean;
  onToggleDesktop?: (open?: boolean) => void;
  onLogout?: () => void;
  /** Dados da escola: usados para esconder itens que dependem do nível de ensino (Superior, Descritiva). */
  db?: SchoolDatabase | null;
}

export const Sidebar: React.FC<SidebarProps> = ({
  currentView,
  onNavigate,
  currentUserRole,
  currentUser,
  isMobileOpen,
  onCloseMobile,
  isDesktopOpen = true,
  onToggleDesktop,
  onLogout,
  db
}) => {
  // Idioma do menu (pt/en/fr): troca em tempo real a partir do seletor no fim do menu.
  const lang = useLang();

  // Personalizar sistema → menu lateral (ver utils/sidebarPrefs.ts).
  const prefs = useSidebarPrefs();
  const fixedMenu = prefs.fixedMenu;                 // não expansível: tudo sempre à vista
  const dotIcons = prefs.dotIcons || fixedMenu;      // subsecções com ponto; secções com ícone
  const [justOpened, setJustOpened] = React.useState<string | null>(null);
  const [closing, setClosing] = React.useState<Record<string, boolean>>({});
  const timers = React.useRef<Record<string, number>>({});
  React.useEffect(() => () => { Object.values(timers.current).forEach((t) => window.clearTimeout(t)); }, []);
  const reduceMotion = () => typeof window !== 'undefined' && !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  const DROP_MS = 500;

  // O menu já não depende de listas de perfis escritas no código: mostra as
  // secções que o Administrador ligou para ESTE utilizador (ou, se ainda não
  // houver personalização, o modelo do perfil). Ver utils/userAccess.ts.
  const sessionUser = currentUser || getSessionUser();
  const accessUser = sessionUser ? sessionUser : ({ role: currentUserRole } as Pick<User, 'role' | 'access'>);
  const isAllowed = (roles: UserRole[]) => roles.includes(currentUserRole);

  // Um grupo "contém" a view atual se algum dos seus itens apontar exatamente
  // para ela, ou (caso de Configurações) se a view atual começar por
  // "configuracoes" — assim o grupo certo já nasce aberto.
  const groupContainsCurrentView = (group: NavGroup) =>
    group.items.some((item) => item.view && (item.view === currentView || currentView.startsWith(item.view + '/')));

  const [openGroups, setOpenGroups] = React.useState<Record<string, boolean>>(() => {
    const initial: Record<string, boolean> = {};
    NAV_GROUPS.forEach((g) => {
      initial[g.key] =
        g.key === 'geral' ||
        g.key === 'calendario' ||
        g.key === 'area_estudante' ||
        g.key === 'portal_encarregado' ||
        groupContainsCurrentView(g);
    });
    return initial;
  });

  const clearTimer = (key: string) => { if (timers.current[key]) { window.clearTimeout(timers.current[key]); delete timers.current[key]; } };

  const toggleGroup = (key: string) => {
    if (fixedMenu) return;
    const animate = prefs.dropAnim && !reduceMotion();
    clearTimer(key);
    // Clicar a meio do fecho: cancela o fecho e mantém aberto.
    if (closing[key]) {
      setClosing((p) => ({ ...p, [key]: false }));
      setOpenGroups((p) => ({ ...p, [key]: true }));
      return;
    }
    if (!openGroups[key]) {
      // Abrir: as subsecções surgem de cima para baixo.
      setOpenGroups((p) => ({ ...p, [key]: true }));
      if (animate) {
        setJustOpened(key);
        timers.current[key] = window.setTimeout(() => { setJustOpened((j) => (j === key ? null : j)); clearTimer(key); }, DROP_MS + 40);
      }
      return;
    }
    // Fechar: as subsecções recolhem de baixo para cima e só depois saem do ecrã.
    if (!animate) {
      setOpenGroups((p) => ({ ...p, [key]: false }));
      return;
    }
    setJustOpened(null);
    setClosing((p) => ({ ...p, [key]: true }));
    timers.current[key] = window.setTimeout(() => {
      setOpenGroups((p) => ({ ...p, [key]: false }));
      setClosing((p) => ({ ...p, [key]: false }));
      clearTimer(key);
    }, DROP_MS + 40);
  };

  const navItemClass = (viewId: string) => {
    const active = currentView === viewId;
    return active
      ? 'flex items-center gap-3 px-3.5 py-2.5 rounded-xl bg-white text-[#0b1f3a] font-bold shadow-md transition-all'
      : 'flex items-center gap-3 px-3.5 py-2 rounded-xl text-slate-300 hover:bg-white/10 hover:text-white transition-all text-sm font-medium';
  };

  const navItemIconClass = (viewId: string) => {
    return currentView === viewId ? 'text-[#0b1f3a]' : 'text-slate-400 group-hover:text-white';
  };

  // Menu de idioma (bandeiras SVG): fecha ao clicar fora ou com Esc.
  const [langMenuOpen, setLangMenuOpen] = React.useState(false);
  const langMenuRef = React.useRef<HTMLDivElement>(null);
  React.useEffect(() => {
    if (!langMenuOpen) return;
    const onDown = (e: MouseEvent) => {
      if (langMenuRef.current && !langMenuRef.current.contains(e.target as Node)) setLangMenuOpen(false);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setLangMenuOpen(false); };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('mousedown', onDown); document.removeEventListener('keydown', onKey); };
  }, [langMenuOpen]);

  const renderGroup = (group: NavGroup) => {
    const visibleItems = group.items.filter((item) =>
      item.view && item.implemented
        ? canViewSection(accessUser, item.view) && !isMenuViewHidden(item.view, db, sessionUser as User | undefined)
        : // Itens "Em Desenvolvimento" (sem ecrã): só como reserva de lugar do perfil do grupo.
          isAllowed(group.roles) && (!item.roles || isAllowed(item.roles))
    );
    if (visibleItems.length === 0) return null;

    const isClosing = !fixedMenu && !!closing[group.key];
    const isOpen = fixedMenu ? true : (openGroups[group.key] ?? true);
    // Secções: mesma cor (âmbar) e ícone do Portal do Professor, em maiúsculas e maiores que as subsecções.
    const labelColorClass = 'text-amber-400';
    const headerIcon = dotIcons ? (
      <span className={`material-symbols-outlined text-[22px] mr-2.5 shrink-0 ${labelColorClass}`} aria-hidden="true">{group.icon}</span>
    ) : null;
    const labelClass = `text-[15px] leading-tight font-extrabold uppercase tracking-wide ${labelColorClass}`;
    const wrapAttrs: Record<string, string> = {};
    if (prefs.dropAnim && !fixedMenu) {
      if (isClosing) wrapAttrs['data-sb-close'] = '';
      else if (justOpened === group.key) wrapAttrs['data-sb-drop'] = '';
    }

    return (
      <div key={group.key}>
        {fixedMenu ? (
          <div className="w-full flex items-center justify-between px-3 mb-1 select-none">
            <span className="flex items-center min-w-0">
              {headerIcon}
              <span className={labelClass}>{tr(group.label, lang)}</span>
            </span>
            {/* No menu não expansível a seta fica sempre visível (apenas indicativa). */}
            <span className="material-symbols-outlined text-[18px] text-amber-400 shrink-0" aria-hidden="true">expand_more</span>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => toggleGroup(group.key)}
            className="w-full flex items-center justify-between px-3 mb-1 cursor-pointer group/header"
            aria-expanded={isOpen && !isClosing}
          >
            <span className="flex items-center min-w-0 text-left">
              {headerIcon}
              <span className={`${labelClass} group-hover/header:text-white transition-colors`}>
                {tr(group.label, lang)}
              </span>
            </span>
            <span
              className={`material-symbols-outlined text-[18px] text-amber-400 shrink-0 group-hover/header:text-white transition-transform duration-300 ${
                isOpen && !isClosing ? 'rotate-0' : '-rotate-90'
              }`}
            >
              expand_more
            </span>
          </button>
        )}

        {isOpen && (
          <div data-sb-wrap="" {...wrapAttrs}>
          <div
            className="space-y-1 pb-3"
            data-sb-list=""
          >
            {visibleItems.map((item) => {
              if (!item.implemented || !item.view) {
                return (
                  <div
                    key={item.label}
                    title="Funcionalidade em desenvolvimento"
                    className="flex items-center gap-3 px-3.5 py-2 rounded-xl text-slate-500 text-sm font-medium opacity-50 cursor-not-allowed select-none"
                  >
                    {dotIcons ? <span className="bm-sb-dot" /> : <span className="material-symbols-outlined text-[20px] text-slate-600">{item.icon}</span>}
                    <span className="flex-1 truncate">{tr(item.label, lang)}</span>
                    <span className="text-[8px] uppercase font-bold tracking-wide bg-slate-700/60 text-slate-300 px-1.5 py-0.5 rounded shrink-0">
                      Em Desenv.
                    </span>
                  </div>
                );
              }

              const viewId = item.view;
              return (
                <button
                  key={viewId}
                  onClick={() => {
                    if (viewId !== currentView) playPageAnimation();
                    onNavigate(viewId);
                    onCloseMobile();
                  }}
                  data-sb-item=""
                  {...(currentView === viewId ? { 'data-sb-active': '' } : {})}
                  className={`w-full text-left cursor-pointer ${navItemClass(viewId)}`}
                >
                  {dotIcons ? (
                    <span className="bm-sb-dot" aria-hidden="true" />
                  ) : (
                    <span className={`material-symbols-outlined text-[20px] ${navItemIconClass(viewId)}`}>
                      {item.icon}
                    </span>
                  )}
                  <span className="flex-1 truncate">{tr(item.label, lang)}</span>
                </button>
              );
            })}
          </div>
          </div>
        )}
      </div>
    );
  };

  return (
    <>
      {/* Mobile Backdrop */}
      {isMobileOpen && (
        <div
          className="fixed inset-0 bg-black/60 z-40 lg:hidden backdrop-blur-xs"
          onClick={onCloseMobile}
        />
      )}

      {/* Main Aside - Supports desktop & fullscreen toggle with smooth transition */}
      <aside
        className={`fixed top-0 bottom-0 left-0 w-64 bg-[#0b1f3a] text-white z-50 flex flex-col justify-between shadow-2xl transition-transform duration-300 ${
          isMobileOpen ? 'translate-x-0' : '-translate-x-full'
        } ${
          isDesktopOpen ? 'lg:translate-x-0' : 'lg:-translate-x-full'
        }`}
      >
        <div className="flex flex-col flex-1 overflow-y-auto">
          {/* Brand Header */}
          <div className="h-16 px-4 flex items-center justify-between bg-black/20 border-b border-slate-700/50">
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 rounded-lg bg-white flex items-center justify-center p-1 shadow-sm shrink-0 overflow-hidden">
                <img
                  src="/school_emblem.png"
                  alt="BandMed Emblema"
                  className="w-full h-full object-contain"
                  referrerPolicy="no-referrer"
                />
              </div>
              <div className="flex flex-col min-w-0">
                <div className="flex items-center gap-1.5">
                  <span className="font-extrabold text-base tracking-tight text-white font-headline">BANDMED</span>
                </div>
                <span className="text-[10px] text-slate-400 tracking-wider uppercase font-medium">Gestão Escolar</span>
              </div>
            </div>
            <button
              onClick={() => {
                if (onToggleDesktop) onToggleDesktop(false);
                onCloseMobile();
              }}
              className="p-1.5 rounded-lg text-slate-300 hover:text-white hover:bg-white/15 bg-white/5 cursor-pointer flex items-center justify-center transition-colors"
              title="Fechar menu lateral"
              aria-label="Fechar menu lateral"
            >
              <span className="material-symbols-outlined text-[20px]">close</span>
            </button>
          </div>

          {/* Navigation Items — organizados por categoria, cada uma expansível */}
          <nav className="p-3 flex-1">
            {NAV_GROUPS.map((group) => renderGroup(group))}
          </nav>
        </div>

        {/* Idioma da interface: Inglês traduz todo o sistema automaticamente (dados da base de dados ficam como estão) */}
        <div data-on-navy="lang" className="px-3 py-2 border-t border-slate-700/40">
          <div className="flex items-center gap-2 text-[11px] text-slate-300 relative" ref={langMenuRef}>
            <span className="material-symbols-outlined text-[18px]" aria-hidden="true">language</span>
            <button
              type="button"
              aria-label={tr('Idioma', lang)}
              title={tr('Idioma', lang)}
              aria-haspopup="listbox"
              aria-expanded={langMenuOpen}
              onClick={() => setLangMenuOpen((o) => !o)}
              data-on-navy="select"
              className="ml-auto flex items-center gap-2 bg-white text-[11px] font-bold text-[#12498a] border border-white rounded-md px-2 py-1 cursor-pointer focus:outline-none"
            >
              <FlagIcon code={FLAG_BY_LANG[lang] || 'AO'} />
              <span>{LANGS.find((l) => l.id === lang)?.label}</span>
              <span className="material-symbols-outlined text-[16px]" aria-hidden="true">expand_less</span>
            </button>
            {langMenuOpen && (
              <ul
                role="listbox"
                data-lang-menu="true"
                aria-label={tr('Idioma', lang)}
                className="absolute right-0 bottom-full mb-1 min-w-[170px] bg-white text-[#12498a] border border-slate-300 shadow-xl z-50"
              >
                {LANGS.map((l) => (
                  <li key={l.id} role="option" aria-selected={l.id === lang}>
                    <button
                      type="button"
                      onClick={() => { setLang(l.id); setLangMenuOpen(false); }}
                      className={`w-full flex items-center gap-2.5 px-3 py-2 text-[12px] font-semibold text-left cursor-pointer hover:bg-slate-100 ${l.id === lang ? 'bg-slate-100 text-[#0b1f3a]' : ''}`}
                    >
                      <FlagIcon code={FLAG_BY_LANG[l.id] || 'AO'} />
                      <span className="flex-1">{l.label}</span>
                      {l.id === lang && <span className="material-symbols-outlined text-[16px] text-emerald-700" aria-hidden="true">check</span>}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>

        {/* Footer Brand Info */}
        <div data-on-navy="footer" className="p-3 bg-black/30 border-t border-slate-700/40">
          <div className="flex items-center justify-between text-[11px] text-slate-400">
            <div className="flex items-center gap-1.5">
              <span className="material-symbols-outlined text-[#7a0c0c] text-[16px]">verified_user</span>
              <span className="font-semibold text-slate-200">BandMed</span>
            </div>
            <span data-on-navy="chip" className="font-mono text-[10px] px-1.5 py-0.5 rounded bg-white/10 text-white">v3.4.2 Enterprise</span>
          </div>
        </div>
      </aside>
    </>
  );
};
