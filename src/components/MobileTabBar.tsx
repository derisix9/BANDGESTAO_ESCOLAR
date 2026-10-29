import React from 'react';
import type { SchoolDatabase, User, UserRole } from '../types';
import { NAV_GROUPS } from '../utils/navCatalog';
import { canViewSection, getSessionUser } from '../utils/userAccess';
import { isMenuViewHidden } from '../utils/menuVisibility';
import { tr } from '../i18n';
import { useLang } from '../i18n/useLang';

/**
 * APP MÓVEL (telemóvel/tablet < 1024px)
 * Barra de separadores em baixo + folha "Menu" com TODAS as secções do sistema.
 * Não duplica dados nem regras: usa o mesmo catálogo (NAV_GROUPS), as mesmas
 * permissões (canViewSection / isMenuViewHidden) e as mesmas views do desktop,
 * por isso tudo continua ligado à base de dados já existente.
 */

interface Props {
  currentView: string;
  onNavigate: (view: string) => void;
  currentUserRole: UserRole;
  currentUser?: User | null;
  db?: SchoolDatabase | null;
  onLogout?: () => void;
}

/** Separadores rápidos por perfil (só entram os que o utilizador pode ver). */
const QUICK: Record<string, Array<[string, string, string]>> = {
  aluno: [['aluno_notas', 'Notas', 'grade'], ['aluno_faltas', 'Faltas', 'event_busy'], ['aluno_financeiro', 'Propinas', 'payments'], ['aluno_trabalhos', 'Trabalhos', 'assignment']],
  encarregado: [['encarregado_notas', 'Notas', 'grade'], ['encarregado_faltas', 'Faltas', 'event_busy'], ['encarregado_financeiro', 'Propinas', 'payments'], ['encarregado_comunicados', 'Avisos', 'campaign']],
  professor: [['pautas', 'Pautas', 'grading'], ['assiduidade', 'Presenças', 'fact_check'], ['professor_sumarios', 'Sumários', 'edit_note'], ['turmas', 'Turmas', 'groups']],
  funcionario: [['mural_biblioteca', 'Avisos', 'campaign'], ['biblioteca_emprestimos', 'Biblioteca', 'local_library']],
  default: [['dashboard', 'Início', 'home'], ['alunos', 'Alunos', 'school'], ['propinas', 'Propinas', 'payments'], ['assiduidade', 'Presenças', 'fact_check']]
};

export const MobileTabBar: React.FC<Props> = ({ currentView, onNavigate, currentUserRole, currentUser, db, onLogout }) => {
  const lang = useLang();
  const [open, setOpen] = React.useState(false);
  const [q, setQ] = React.useState('');
  const sessionUser = currentUser || getSessionUser();
  const accessUser = sessionUser ? sessionUser : ({ role: currentUserRole } as Pick<User, 'role' | 'access'>);

  const canSee = React.useCallback(
    (view: string) => canViewSection(accessUser, view) && !isMenuViewHidden(view, db, sessionUser as User | undefined),
    [accessUser, db, sessionUser]
  );

  const tabs = (QUICK[currentUserRole] || QUICK.default).filter(([v]) => canSee(v)).slice(0, 4);

  const groups = React.useMemo(() => {
    const needle = q.trim().toLowerCase();
    return NAV_GROUPS.map((g) => ({
      ...g,
      items: g.items.filter((i) => i.view && i.implemented && canSee(i.view) && (!needle || tr(i.label, lang).toLowerCase().includes(needle)))
    })).filter((g) => g.items.length > 0);
  }, [q, canSee, lang]);

  // Bloqueia o scroll da página por trás da folha e fecha com Esc.
  React.useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    window.addEventListener('keydown', onKey);
    return () => { document.body.style.overflow = prev; window.removeEventListener('keydown', onKey); };
  }, [open]);

  const go = (view: string) => { setOpen(false); setQ(''); if (view !== currentView) onNavigate(view); };
  const menuActive = !tabs.some(([v]) => v === currentView);

  return (
    <>
      <nav className="bm-tabbar lg:hidden" aria-label="Navegação principal" data-no-wrap data-acl-ignore>
        {tabs.map(([view, label, icon]) => (
          <button key={view} type="button" onClick={() => go(view)} className={currentView === view ? 'is-on' : ''} aria-current={currentView === view ? 'page' : undefined}>
            <span className="material-symbols-outlined">{icon}</span>
            <span>{tr(label, lang)}</span>
          </button>
        ))}
        <button type="button" onClick={() => setOpen(true)} className={menuActive ? 'is-on' : ''} aria-haspopup="dialog">
          <span className="material-symbols-outlined">apps</span>
          <span>{tr('Menu', lang)}</span>
        </button>
      </nav>

      {open && (
        <div className="bm-menu-bg lg:hidden" data-acl-ignore onClick={() => setOpen(false)}>
          <div className="bm-menu" role="dialog" aria-modal="true" aria-label="Menu" onClick={(e) => e.stopPropagation()}>
            <div className="bm-menu-grip" />
            <div className="bm-menu-head">
              <div className="bm-menu-user">
                <span className="material-symbols-outlined">account_circle</span>
                <div>
                  <strong>{sessionUser?.name || 'Utilizador'}</strong>
                  <small>{currentUserRole}</small>
                </div>
              </div>
              <button type="button" className="bm-menu-x" onClick={() => setOpen(false)} aria-label="Fechar"><span className="material-symbols-outlined">close</span></button>
            </div>
            <label className="bm-menu-search">
              <span className="material-symbols-outlined">search</span>
              <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={tr('Pesquisar secção…', lang)} type="search" />
            </label>
            <div className="bm-menu-body">
              {groups.map((g) => (
                <section key={g.key}>
                  <h3><span className="material-symbols-outlined">{g.icon}</span>{tr(g.label, lang)}</h3>
                  <div className="bm-menu-grid">
                    {g.items.map((i) => (
                      <button key={i.view} type="button" onClick={() => go(i.view!)} className={currentView === i.view ? 'is-on' : ''}>
                        <span className="material-symbols-outlined">{i.icon}</span>
                        <span>{tr(i.label, lang)}</span>
                      </button>
                    ))}
                  </div>
                </section>
              ))}
              {groups.length === 0 && <p className="bm-menu-empty">Nenhuma secção encontrada.</p>}
              {onLogout && (
                <button type="button" className="bm-menu-logout" onClick={() => { setOpen(false); onLogout(); }}>
                  <span className="material-symbols-outlined">logout</span>{tr('Terminar sessão', lang)}
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
};
