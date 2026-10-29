import React, { useState } from 'react';
import { SchoolDatabase, SystemSettings, UserRole } from '../types';
import { dbService } from '../services/db';
import { SettingsCommitFn } from './configuracoes/settingsCommit';
import { runGlobalOperation } from '../context/OperationContext';
import { TabDadosInstituicao } from './configuracoes/TabDadosInstituicao';
import { TabAnoLetivo } from './configuracoes/TabAnoLetivo';
import { TabFinanceiro } from './configuracoes/TabFinanceiro';
import { TabRegrasNotas } from './configuracoes/TabRegrasNotas';
import { TabPerfisPermissoes } from './configuracoes/TabPerfisPermissoes';
import { TabIntegracoes } from './configuracoes/TabIntegracoes';
import { TabSegurancaBackups } from './configuracoes/TabSegurancaBackups';
import { TabUsuarios } from './configuracoes/TabUsuarios';
import { TabProtecaoDados } from './configuracoes/TabProtecaoDados';
import { TabPlanoSubscricao } from './configuracoes/TabPlanoSubscricao';
import { TabPersonalizarSistema } from './configuracoes/TabPersonalizarSistema';
import { canViewSection, getSessionUser } from '../utils/userAccess';
import { getFallbackAcademicYear } from '../utils/academicYear';
import { useFeatureMode } from '../utils/featureModes';
import { FeatureReadOnly } from '../components/FeatureReadOnly';

interface ConfiguracoesViewProps {
  db: SchoolDatabase;
  currentUserRole: UserRole;
  onOpenSqlExport?: () => void;
  onResetData: () => void;
  /** Aba a abrir de imediato (vinda do submenu "Configurações" do sidebar). */
  initialTab?: SettingsTabId;
}

export type SettingsTabId =
  | 'instituicao'
  | 'ano-letivo'
  | 'financeiro'
  | 'notas'
  | 'perfis'
  | 'integracoes'
  | 'seguranca-backups'
  | 'utilizadores'
  | 'protecao-dados'
  | 'plano-subscricao'
  | 'personalizar-sistema';

interface NavModule {
  id: SettingsTabId;
  index: number;
  label: string;
  shortLabel: string;
  icon: string;
  badge?: string;
  subtitle: string;
}

const navModules: NavModule[] = [
  {
    id: 'instituicao',
    index: 1,
    label: 'CONFIGURAÇÕES',
    shortLabel: 'Instituição',
    icon: 'apartment',
    badge: 'Ativo',
    subtitle: ''
  },
  {
    id: 'ano-letivo',
    index: 2,
    label: 'CONFIGURAÇÕES',
    shortLabel: 'Ano Letivo',
    icon: 'date_range',
    badge: '3 Trim.',
    subtitle: ''
  },
  {
    id: 'financeiro',
    index: 3,
    label: 'CONFIGURAÇÕES',
    shortLabel: 'Financeiro',
    icon: 'payments',
    badge: 'Kz AOA',
    subtitle: ''
  },
  {
    id: 'notas',
    index: 4,
    label: 'CONFIGURAÇÕES',
    shortLabel: 'Regras de Notas',
    icon: 'rule',
    badge: '0-20',
    subtitle: ''
  },
  {
    id: 'perfis',
    index: 5,
    label: 'CONFIGURAÇÕES',
    shortLabel: 'Perfis & ACL',
    icon: 'admin_panel_settings',
    badge: '5 Perfis',
    subtitle: ''
  },
  {
    id: 'integracoes',
    index: 6,
    label: 'CONFIGURAÇÕES',
    shortLabel: 'Integrações',
    icon: 'hub',
    badge: 'EMIS / AGT',
    subtitle: ''
  },
  {
    id: 'seguranca-backups',
    index: 7,
    label: 'CONFIGURAÇÕES',
    shortLabel: 'Segurança & BD',
    icon: 'security',
    badge: 'AES-256',
    subtitle: ''
  },
  {
    id: 'utilizadores',
    index: 8,
    label: 'CONFIGURAÇÕES',
    shortLabel: 'Utilizadores',
    icon: 'group_add',
    badge: 'RBAC',
    subtitle: ''
  },
  {
    id: 'protecao-dados',
    index: 9,
    label: 'CONFIGURAÇÕES',
    shortLabel: 'Proteção de Dados',
    icon: 'policy',
    badge: 'Lei 22/11',
    subtitle: ''
  },
  {
    id: 'plano-subscricao',
    index: 10,
    label: 'CONFIGURAÇÕES',
    shortLabel: 'Plano e Subscrição',
    icon: 'workspace_premium',
    badge: 'Plano',
    subtitle: ''
  },
  {
    id: 'personalizar-sistema',
    index: 11,
    label: 'CONFIGURAÇÕES',
    shortLabel: 'Personalizar Sistema',
    icon: 'tune',
    badge: 'Sistema',
    subtitle: ''
  }
];

export const ConfiguracoesView: React.FC<ConfiguracoesViewProps> = ({
  db,
  currentUserRole,
  onOpenSqlExport,
  onResetData,
  initialTab
}) => {
  // Cada aba é uma secção ('configuracoes/<aba>') que o Administrador liga ou
  // desliga por utilizador. Só as abas permitidas podem ser abertas.
  const accessUser = getSessionUser() || ({ role: currentUserRole } as any);
  const isTabAllowed = (id: SettingsTabId) => canViewSection(accessUser, `configuracoes/${id}`);
  const allowedModules = navModules.filter((m) => isTabAllowed(m.id));
  const safeTab = (id?: SettingsTabId): SettingsTabId =>
    id && isTabAllowed(id) ? id : allowedModules[0]?.id || 'instituicao';

  // Integrações: modo definido pelo Super Admin (oculto → sem separador; leitura → só ver).
  const integrationsMode = useFeatureMode('integracoes');
  const [activeTab, setActiveTab] = useState<SettingsTabId>(safeTab(initialTab));
  const [settings, setSettings] = useState<SystemSettings>(db.settings);

  // O submenu "Configurações" do sidebar navega diretamente para uma aba
  // específica (ex: clicar em "Segurança & Backups"). Se o utilizador já
  // estiver nesta view e escolher outra aba no submenu, sincronizamos aqui.
  React.useEffect(() => {
    if (initialTab && initialTab !== activeTab) {
      setActiveTab(safeTab(initialTab));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialTab]);

  const currentIndex = navModules.findIndex((m) => m.id === activeTab);
  const currentModule = navModules[currentIndex] || navModules[0];

  const handleUpdateSettings = (newPartial: Partial<SystemSettings>) => {
    setSettings((prev) => ({ ...prev, ...newPartial }));
  };

  // ---------------------------------------------------------------------------------
  // Gravação única: o separador activo regista aqui a função que devolve as alterações
  // que tem em mão. Já não há botões "Guardar" por aba, sub-aba ou painel — só o botão
  // principal no topo. Ao mudar de aba, as alterações pendentes são recolhidas para o
  // estado do módulo, para que nada se perca antes da gravação final.
  // ---------------------------------------------------------------------------------
  const commitRef = React.useRef<SettingsCommitFn | null>(null);
  const registerCommit = React.useCallback((commit: SettingsCommitFn | null) => {
    commitRef.current = commit;
  }, []);

  const collectPendingChanges = (): SystemSettings => {
    let merged = settings;
    if (commitRef.current) {
      try {
        const partial = commitRef.current();
        if (partial && typeof partial === 'object') {
          merged = { ...settings, ...partial };
          setSettings(merged);
        }
      } catch (e) {
        console.warn('Não foi possível recolher as alterações do separador activo:', e);
      }
    }
    return merged;
  };

  // Mapeia cada separador para a regra REAL definida na Matriz de Perfis &
  // Permissões (ver `defaultPermissionsList` em `utils/permissions.ts`).
  // ATENÇÃO: 'config.edit' NÃO existe nessa matriz — nenhum interruptor a
  // controla. Antes desta correção, o botão "Guardar Alterações" verificava
  // sempre essa regra inexistente e, por não ser encontrada, `hasPermission`
  // recusava automaticamente qualquer perfil que não fosse 'admin'. Ou seja:
  // ativar 'config.institution', 'config.permissions' ou 'config.backups' para
  // a Direção, Secretaria, etc. na Matriz NUNCA tinha efeito nenhum ao gravar,
  // porque o botão principal não perguntava por essas regras — perguntava por
  // uma regra fantasma. Agora perguntamos pela regra certa consoante a aba ativa.
  const ruleForTab = (tabId: SettingsTabId): string => {
    switch (tabId) {
      case 'perfis':
        return 'config.permissions';
      case 'utilizadores':
        return 'config.permissions';
      case 'seguranca-backups':
        return 'config.backups';
      default:
        return 'config.institution';
    }
  };

  const handleSaveAll = async (options?: { loadingMessage?: string; successMessage?: string; requiredRule?: string }) => {
    const merged = collectPendingChanges();
    return await runGlobalOperation(
      async () => {
        // `merged` parte de uma cópia das definições feita ao abrir esta página. O motor de
        // acesso pode, entretanto, ter registado botões/secções novos: preserva o registo vivo
        // para esta gravação não o apagar.
        const liveRegistry = dbService.getDatabase()?.settings?.accessRegistry;
        dbService.updateSettings(liveRegistry ? { ...merged, accessRegistry: liveRegistry } : merged);
      },
      {
        requiredRule: options?.requiredRule || ruleForTab(activeTab),
        userRole: currentUserRole,
        loadingMessage: options?.loadingMessage || 'A gravar...',
        successMessage: options?.successMessage || 'Configurações salvas com sucesso!'
      }
    );
  };

  const handleSwitchTab = (tabId: SettingsTabId) => {
    if (!isTabAllowed(tabId)) return;
    // Recolhe o que estiver pendente no separador que está a ser abandonado.
    collectPendingChanges();
    commitRef.current = null;
    setActiveTab(tabId);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  return (
    <div className="flex flex-col w-full gap-5 pb-16">
      {/* Top Header Card */}
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 bg-white p-6 rounded-2xl border border-slate-200 shadow-xs">
        <div>
          <div className="flex items-center gap-2 mb-1 text-xs">
            <span className="font-bold uppercase tracking-wider text-slate-500">
              CONFIGURAÇÕES GERAIS
            </span>
            <span className="w-1.5 h-1.5 rounded-full bg-[#0b1f3a]" />
            <span className="font-bold text-[#0b1f3a]">{settings.currentAcademicYear || getFallbackAcademicYear()}</span>
          </div>
          <h1 className="font-headline text-2xl lg:text-3xl font-extrabold text-[#0b1f3a] tracking-tight">
            {currentModule.label}
          </h1>
          <p className="text-xs text-slate-500 mt-1 max-w-3xl">
            {currentModule.subtitle}
          </p>
        </div>

        <div className="flex items-center gap-2.5 shrink-0">
          <button
            type="button"
            onClick={() => handleSaveAll()}
            className="px-5 py-2 rounded-xl bg-[#0b1f3a] hover:bg-[#7a0c0c] text-white font-bold text-xs shadow-md transition-colors flex items-center gap-1.5 cursor-pointer"
          >
            <span className="material-symbols-outlined text-[17px]">save</span>
            <span>SALVAR</span>
          </button>
        </div>
      </div>

      {/* A confirmação de gravação é dada só pelo diálogo global (carregamento → visto animado)
          de runGlobalOperation em handleSaveAll — sem faixa verde solta por cima. */}

      {/* A navegação entre os módulos passou a viver exclusivamente no submenu
          "Configurações" do menu lateral (Sidebar.tsx) — a barra de abas e o
          rodapé de paginação que existiam aqui foram removidos para não haver
          duas navegações a fazer a mesma coisa. */}

      {/* ACTIVE TAB CONTENT CONTAINER - Directly below the tabs, full width, with pristine responsive layout */}
      <div className="w-full">
        {activeTab === 'instituicao' && (
          <TabDadosInstituicao
            settings={settings}
            currentUserRole={currentUserRole}
            onUpdateSettings={handleUpdateSettings}
            onSaveAll={handleSaveAll}
            registerCommit={registerCommit}
          />
        )}

        {activeTab === 'ano-letivo' && (
          <TabAnoLetivo
            settings={settings}
            currentUserRole={currentUserRole}
            onUpdateSettings={handleUpdateSettings}
            onSaveAll={handleSaveAll}
            registerCommit={registerCommit}
          />
        )}

        {activeTab === 'financeiro' && (
          <TabFinanceiro
            settings={settings}
            currentUserRole={currentUserRole}
            onUpdateSettings={handleUpdateSettings}
            onSaveAll={handleSaveAll}
            registerCommit={registerCommit}
          />
        )}

        {activeTab === 'notas' && (
          <TabRegrasNotas
            settings={settings}
            currentUserRole={currentUserRole}
            onUpdateSettings={handleUpdateSettings}
            onSaveAll={handleSaveAll}
            registerCommit={registerCommit}
          />
        )}

        {activeTab === 'perfis' && (
          <TabPerfisPermissoes
            settings={settings}
            currentUserRole={currentUserRole}
            onUpdateSettings={handleUpdateSettings}
            onSaveAll={handleSaveAll}
            registerCommit={registerCommit}
          />
        )}

        {activeTab === 'integracoes' && isTabAllowed('integracoes') && (
          <FeatureReadOnly readOnly={integrationsMode.readOnly}>
            <TabIntegracoes
              settings={settings}
              currentUserRole={currentUserRole}
              onSaveAll={handleSaveAll}
              // Em modo leitura nada é recolhido nem gravado.
              registerCommit={integrationsMode.readOnly ? () => {} : registerCommit}
            />
          </FeatureReadOnly>
        )}

        {activeTab === 'seguranca-backups' && (
          <TabSegurancaBackups
            settings={settings}
            currentUserRole={currentUserRole}
            onUpdateSettings={handleUpdateSettings}
            onSaveAll={handleSaveAll}
            registerCommit={registerCommit}
          />
        )}

        {activeTab === 'utilizadores' && (
          <TabUsuarios
            db={db}
            settings={settings}
            currentUserRole={currentUserRole}
            onUpdateSettings={handleUpdateSettings}
            onSaveAll={handleSaveAll}
            registerCommit={registerCommit}
          />
        )}

        {activeTab === 'plano-subscricao' && (
          <TabPlanoSubscricao currentUserRole={currentUserRole} />
        )}

        {activeTab === 'personalizar-sistema' && <TabPersonalizarSistema />}

        {activeTab === 'protecao-dados' && (
          <TabProtecaoDados
            settings={settings}
            currentUserRole={currentUserRole}
            onUpdateSettings={handleUpdateSettings}
            onSaveAll={handleSaveAll}
            registerCommit={registerCommit}
          />
        )}
      </div>

      {/* Pagination Footer to jump between tabs easily */}
      <div className="flex items-center justify-center p-4 bg-white rounded-2xl border border-slate-200 shadow-xs">
        <div className="flex items-center justify-center gap-1.5">
          {allowedModules.map((m) => (
            <button
              key={m.id}
              type="button"
              data-acl-ignore
              onClick={() => handleSwitchTab(m.id)}
              data-gr-choice="tab"
              aria-pressed={activeTab === m.id}
              className="w-7 h-7 text-xs flex items-center justify-center"
              title={m.label}
            >
              {m.index}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
};
