import React from 'react';
import type { SchoolDatabase, User, UserRole } from '../types';
import { NAV_GROUPS, NavGroup } from '../utils/navCatalog';
import { canViewSection, getSessionUser } from '../utils/userAccess';
import { isMenuViewHidden } from '../utils/menuVisibility';
import { playPageAnimation } from '../utils/sidebarPrefs';
import { tr } from '../i18n';
import { useLang } from '../i18n/useLang';

interface HeaderNavProps {
  currentView: string;
  onNavigate: (view: string) => void;
  currentUserRole: UserRole;
  currentUser?: User | null;
  db?: SchoolDatabase | null;
}

/**
 * Navegação no cabeçalho (Personalizar sistema → "Navegação das secções" = Cabeçalho).
 * Barra fixa por baixo do cabeçalho com as secções; ao passar o rato (ou clicar/tocar) numa secção
 * abre-se a lista das suas subsecções. Usa o mesmo catálogo e as mesmas permissões do menu lateral.
 * Só aparece em ecrãs grandes; em telemóvel continua a abrir o menu lateral pelo botão ☰.
 */
export const HeaderNav: React.FC<HeaderNavProps> = ({ currentView, onNavigate, currentUserRole, currentUser, db }) => {
  const lang = useLang();
  const sessionUser = currentUser || getSessionUser();
  const accessUser = sessionUser ? sessionUser : ({ role: currentUserRole } as Pick<User, 'role' | 'access'>);
  const isAllowed = (roles: UserRole[]) => roles.includes(currentUserRole);

  const [open, setOpen] = React.useState<{ key: string; left: number; top: number } | null>(null);
  const closeTimer = React.useRef<number | null>(null);
  const barRef = React.useRef<HTMLElement>(null);

  const cancelClose = () => { if (closeTimer.current) { window.clearTimeout(closeTimer.current); closeTimer.current = null; } };
  const scheduleClose = () => { cancelClose(); closeTimer.current = window.setTimeout(() => setOpen(null), 160); };
  React.useEffect(() => () => cancelClose(), []);

  const openFor = (key: string, el: HTMLElement) => {
    cancelClose();
    const r = el.getBoundingClientRect();
    const panelW = 280;
    const left = Math.max(8, Math.min(r.left, window.innerWidth - panelW - 8));
    setOpen({ key, left, top: r.bottom });
  };

  // Fecha ao clicar fora, com Esc ou ao rolar a barra.
  React.useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      const t = e.target as HTMLElement;
      if (!t.closest?.('[data-hnav-panel]') && !barRef.current?.contains(t)) setOpen(null);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(null); };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('mousedown', onDown); document.removeEventListener('keydown', onKey); };
  }, [open]);

  const visibleItemsOf = (group: NavGroup) =>
    group.items.filter((item) =>
      item.view && item.implemented
        ? canViewSection(accessUser, item.view) && !isMenuViewHidden(item.view, db, sessionUser as User | undefined)
        : isAllowed(group.roles) && (!item.roles || isAllowed(item.roles))
    );

  const groups = NAV_GROUPS.map((g) => ({ group: g, items: visibleItemsOf(g) })).filter((x) => x.items.length > 0);
  const openGroup = open ? groups.find((x) => x.group.key === open.key) : null;
  const containsCurrent = (items: NavGroup['items']) =>
    items.some((i) => i.view && (i.view === currentView || currentView.startsWith(i.view + '/')));

  return (
    <>
      <nav
        ref={barRef}
        data-hnav-bar=""
        aria-label="Navegação das secções"
        className="hidden lg:flex fixed left-0 right-0 top-[calc(4rem-1px)] h-[calc(2.75rem+1px)] pt-px z-30 bg-[#0b1f3a] text-white items-stretch px-4 lg:px-8 gap-1 overflow-x-auto shadow-md"
        onMouseLeave={scheduleClose}
      >
        {groups.map(({ group, items }) => {
          const active = containsCurrent(items);
          const isOpen = open?.key === group.key;
          return (
            <button
              key={group.key}
              type="button"
              data-hnav-item=""
              {...(active ? { 'data-hnav-active': '' } : {})}
              aria-haspopup="menu"
              aria-expanded={isOpen}
              onMouseEnter={(e) => openFor(group.key, e.currentTarget)}
              onFocus={(e) => openFor(group.key, e.currentTarget)}
              onClick={(e) => (isOpen ? setOpen(null) : openFor(group.key, e.currentTarget))}
              className={`flex items-center gap-1.5 px-3 text-[12px] font-extrabold uppercase tracking-wide whitespace-nowrap cursor-pointer border-b-2 transition-colors ${
                active ? 'text-white border-amber-400' : 'text-amber-400 border-transparent hover:text-white'
              } ${isOpen ? 'bg-white/10 text-white' : ''}`}
            >
              <span className="material-symbols-outlined text-[18px]" aria-hidden="true">{group.icon}</span>
              {tr(group.label, lang)}
              <span className={`material-symbols-outlined text-[16px] transition-transform ${isOpen ? 'rotate-180' : ''}`} aria-hidden="true">expand_more</span>
            </button>
          );
        })}
      </nav>

      {open && openGroup && (
        <div
          data-hnav-panel=""
          role="menu"
          onMouseEnter={cancelClose}
          onMouseLeave={scheduleClose}
          style={{ left: open.left, top: open.top }}
          className="hidden lg:block fixed z-[60] w-[280px] max-h-[calc(100vh-8rem)] overflow-y-auto bg-white text-slate-800 border border-slate-300 shadow-2xl py-1 px-1"
        >
          {openGroup.items.map((item) => {
            if (!item.implemented || !item.view) {
              return (
                <div key={item.label} title="Funcionalidade em desenvolvimento" className="flex items-center gap-3 px-4 py-2 text-[13px] text-slate-400 opacity-60 cursor-not-allowed select-none">
                  <span className="material-symbols-outlined text-[18px]">{item.icon}</span>
                  <span className="flex-1 truncate">{tr(item.label, lang)}</span>
                  <span className="text-[8px] uppercase font-bold bg-slate-200 text-slate-600 px-1.5 py-0.5">Em Desenv.</span>
                </div>
              );
            }
            const viewId = item.view;
            const current = currentView === viewId;
            return (
              <button
                key={viewId}
                type="button"
                role="menuitem"
                data-hnav-item=""
                {...(current ? { 'data-hnav-active': '' } : {})}
                onClick={() => {
                  if (viewId !== currentView) playPageAnimation();
                  onNavigate(viewId);
                  setOpen(null);
                }}
                className={`w-full flex items-center gap-3 px-4 py-2 text-left text-[13px] cursor-pointer transition-colors hover:bg-slate-100 ${
                  current ? 'bg-slate-100 font-bold text-[#0b1f3a]' : 'font-medium text-slate-700'
                }`}
              >
                <span className="material-symbols-outlined text-[18px] text-[#0b1f3a]">{item.icon}</span>
                <span className="flex-1 truncate">{tr(item.label, lang)}</span>
                {current && <span className="material-symbols-outlined text-[16px] text-emerald-700" aria-hidden="true">check</span>}
              </button>
            );
          })}
        </div>
      )}
    </>
  );
};
