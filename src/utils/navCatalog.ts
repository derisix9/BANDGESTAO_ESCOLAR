import { UserRole } from '../types';

/**
 * CATÁLOGO DO MENU (fonte única de verdade)
 * =========================================
 * Este ficheiro define TODAS as secções do sistema. O menu lateral (Sidebar) e o
 * editor de acessos por utilizador (Configurações → Criação de Utilizadores)
 * leem daqui. Para criar uma secção nova basta acrescentar um item a um grupo:
 * ela passa a aparecer sozinha na lista de permissões de cada utilizador.
 *
 * `roles` (no grupo e no item) deixou de ser uma regra fixa: é apenas o MODELO
 * INICIAL de cada perfil. O Administrador pode ligar/desligar qualquer secção
 * para cada utilizador, sem tocar no código.
 */

// ---------------------------------------------------------------------------------
// Estrutura de navegação por categoria.
//
// Cada grupo pode expandir/recolher (clique no cabeçalho) e mostra os seus itens.
// Um item marcado com `implemented: false` aparece esbatido, com o rótulo
// "Em Desenvolvimento" e não é clicável — é um lugar reservado para uma
// funcionalidade futura, para já se ver a organização final do menu.
//
// `roles`, quando indicado num item, restringe ainda mais esse item dentro de um
// grupo já visível para um conjunto maior de perfis (ex: em "Gestão Académica",
// o grupo é visível para Secretaria e Professor, mas "Professores" só aparece
// para Admin/Direção).
// ---------------------------------------------------------------------------------

export interface NavLeaf {
  /** Identificador de view usado em onNavigate. Vazio/omitido para itens "Em Desenvolvimento". */
  view?: string;
  label: string;
  icon: string;
  implemented: boolean;
  roles?: UserRole[];
}

export interface NavGroup {
  key: string;
  label: string;
  icon: string;
  roles: UserRole[];
  items: NavLeaf[];
  /** Cor do rótulo do grupo (por defeito cinza institucional). */
  accent?: 'default' | 'amber';
}

export const ALL_ROLES: UserRole[] = [
  'admin',
  'director',
  'secretaria',
  'professor',
  'financeiro',
  'aluno',
  'encarregado',
  'funcionario'
];

export const NAV_GROUPS: NavGroup[] = [
  {
    key: 'geral',
    label: 'Painel Principal',
    icon: 'space_dashboard',
    roles: ['admin', 'director', 'secretaria'],
    items: [{ view: 'dashboard', label: 'Dashboard', icon: 'dashboard', implemented: true }]
  },


  {
    key: 'secretaria',
    label: 'Secretaria',
    icon: 'contact_page',
    // O grupo inclui 'professor' apenas para que "Alunos" (abaixo) fique visível a
    // docentes, tal como já acontecia antes desta reorganização; os restantes itens
    // restringem-se explicitamente à gestão/secretaria.
    roles: ALL_ROLES,
    items: [
      { view: 'admissoes', label: 'Admissão', icon: 'how_to_reg', implemented: true, roles: ['admin', 'director', 'secretaria'] },
      { view: 'matriculas', label: 'Matrículas', icon: 'assignment_turned_in', implemented: true, roles: ['admin', 'director', 'secretaria'] },
      { view: 'alunos', label: 'Alunos', icon: 'person_add', implemented: true, roles: ['admin', 'director', 'secretaria']},
      { view: 'vinculo_filhos', label: 'Vínculos de Filhos', icon: 'link', implemented: true, roles: ['admin', 'director', 'secretaria'] },
      { view: 'turmas', label: 'Turmas', icon: 'groups', implemented: true, roles: ['admin', 'director', 'secretaria'] },
      { view: 'disciplinas', label: 'Disciplinas', icon: 'table_rows', implemented: true, roles: ['admin', 'director', 'secretaria'] },
      { view: 'atribuicao', label: 'Atribuição', icon: 'assignment_ind', implemented: true, roles: ['admin', 'director', 'secretaria'] },
      { view: 'cursos', label: 'Cursos', icon: 'school', implemented: true, roles: ['admin', 'director', 'secretaria'] },
      { view: 'horarios', label: 'Horários', icon: 'calendar_month', implemented: true, roles: ['admin', 'director', 'secretaria'] },
      { view: 'mapa_salas', label: 'Mapa de Salas', icon: 'apartment', implemented: true, roles: ['admin', 'director', 'secretaria'] },
      { view: 'departamentos', label: 'Departamentos', icon: 'account_tree', implemented: true, roles: ['admin', 'director', 'secretaria'] },
      { view: 'calendario_escolar', label: 'Calendário', icon: 'event', implemented: true},
      { view: 'documentos_academicos', label: 'Documentos', icon: 'workspace_premium', implemented: true, roles: ['admin', 'director', 'secretaria'] },
      { view: 'estudio_documentos', label: 'Emissão', icon: 'design_services', implemented: true, roles: ['admin', 'director', 'secretaria'] },
      { view: 'transferencias', label: 'Transferências', icon: 'swap_horiz', implemented: true, roles: ['admin', 'director', 'secretaria'] }
    ]
  },

  {
    key: 'pedagogico',
    label: 'Pedagógico',
    icon: 'auto_stories',
    // O docente entra no grupo para chegar a "Lançar Notas", "Assiduidade", "Folha de
    // Chamada" e "Banco de Questões".
    roles: ['admin', 'director', 'secretaria', 'professor'],
    items: [
      { view: 'pautas', label: 'Lançar Notas', icon: 'assignment', implemented: true },
      { view: 'assiduidade', label: 'Assiduidade', icon: 'event_available', implemented: true },
      { view: 'conselho_turma', label: 'Conselho de Turma', icon: 'gavel', implemented: true, roles: ['admin', 'director', 'secretaria'] },
      { view: 'recuperacao_recurso', label: 'Recuperação', icon: 'published_with_changes', implemented: true, roles: ['admin', 'director', 'secretaria'] },
      // "Importar Pauta (Excel)" e "Homologação de Pauta" ficam dentro de
      // "Lançar Notas" (âmbito por disciplina do professor, ou geral para
      // Admin/Pedagógico) — não repetir aqui no menu.
      { view: 'folha_chamada_prova', label: 'Folha de Presença', icon: 'fact_check', implemented: true },
      { view: 'ensino_superior', label: 'Ensino Superior', icon: 'account_balance', implemented: true },
      { view: 'banco_questoes', label: 'Banco de Questões', icon: 'quiz', implemented: true, roles: ['admin', 'director', 'professor'] },
      { view: 'exames_nacionais', label: 'Exames Nacionais', icon: 'event_note', implemented: true, roles: ['admin', 'director', 'secretaria'] },
      { view: 'plano_individual', label: 'Plano Individual', icon: 'volunteer_activism', implemented: true, roles: ['admin', 'director'] },
      { view: 'plano_curricular', label: 'Plano Curricular', icon: 'menu_book', implemented: true, roles: ['admin', 'director', 'secretaria'] },
      { view: 'atividades_extracurriculares', label: 'Extracurriculares', icon: 'sports_soccer', implemented: true, roles: ['admin', 'director', 'secretaria'] },
      { view: 'avaliacao_descritiva', label: 'Avaliação Descritiva', icon: 'child_care', implemented: true, roles: ['admin', 'director', 'secretaria', 'professor'] },
      { view: 'ead_trabalhos', label: 'Trabalhos Online', icon: 'cast_for_education', implemented: true, roles: ['admin', 'director', 'professor'] }
    ]
  },

  {
    key: 'rh',
    label: 'Recursos Humanos',
    icon: 'badge',
    roles: ['admin', 'director'],
    items: [
      { view: 'professores', label: 'Professores', icon: 'school', implemented: true },
      { view: 'funcionarios', label: 'Funcionários', icon: 'groups', implemented: true },
      { view: 'folha_pagamento', label: 'Folha Salarial', icon: 'request_quote', implemented: true },
      { view: 'avaliacao_desempenho_docente', label: 'Desempenho', icon: 'insights', implemented: true },
      { view: 'ferias_licencas', label: 'Férias e Licenças', icon: 'beach_access', implemented: true }
    ]
  },

  {
    key: 'tesouraria',
    label: 'Tesouraria',
    icon: 'payments',
    roles: ['admin', 'secretaria', 'financeiro'],
    items: [
      { view: 'propinas', label: 'Pagamentos', icon: 'payments', implemented: true },
      { view: 'planos_descontos', label: 'Bolsas e Descontos', icon: 'percent', implemented: true },
      { view: 'conciliacao_bancaria', label: 'Conciliação Bancária', icon: 'account_balance', implemented: true, roles: ['admin', 'financeiro'] },
      { view: 'contabilidade', label: 'Fluxo de Caixa', icon: 'receipt_long', implemented: true, roles: ['admin', 'financeiro'] },
      { view: 'balancete_contabilistico', label: 'Contabilidade', icon: 'balance', implemented: true, roles: ['admin', 'financeiro'] }
    ]
  },

  {
    key: 'logistica',
    label: 'Logística',
    icon: 'inventory_2',
    // 'secretaria' entra no grupo apenas para o item "Refeitório" (tal como já
    // acontecia antes desta reorganização); os restantes itens continuam
    // restritos à gestão.
    roles: ['admin', 'director', 'secretaria'],
    items: [
      { view: 'fornecedores', label: 'Fornecedores', icon: 'local_shipping', implemented: true, roles: ['admin', 'director'] },
      { view: 'inventario_ativos', label: 'Inventário', icon: 'inventory_2', implemented: true, roles: ['admin', 'director'] },
      { view: 'controlo_estoque', label: 'Stock', icon: 'warehouse', implemented: true, roles: ['admin', 'director'] },
      { view: 'transporte_escolar', label: 'Transporte', icon: 'directions_bus', implemented: true, roles: ['admin', 'director'] },
      { view: 'internato', label: 'Internato', icon: 'bed', implemented: true, roles: ['admin', 'director', 'secretaria'] },
      { view: 'refeitorio', label: 'Refeitório', icon: 'restaurant', implemented: true }
    ]
  },

  {
    key: 'saude_seguranca',
    label: 'Saúde & Segurança',
    icon: 'health_and_safety',
    roles: ['admin', 'director', 'secretaria'],
    items: [
      { view: 'saude_ficha_medica', label: 'Ficha Médica', icon: 'medical_information', implemented: true },
      { view: 'saude_incidentes', label: 'Incidentes', icon: 'report', implemented: true },
      { view: 'saude_recolha', label: 'Autorizações', icon: 'badge', implemented: true }
    ]
  },

  {
    key: 'comunicacao',
    label: 'Comunicação',
    icon: 'campaign',
    roles: ALL_ROLES,
    items: [
      { view: 'mural_biblioteca', label: 'Avisos e Biblioteca', icon: 'campaign', implemented: true },
      { view: 'biblioteca_emprestimos', label: 'Empréstimos e Multas', icon: 'local_library', implemented: true, roles: ['admin', 'director', 'secretaria', 'funcionario'] },
      { view: 'comunicacao_notificacoes', label: 'Notificações', icon: 'sms', implemented: true, roles: ['admin', 'director', 'secretaria'] },
      { view: 'comunicacao_reunioes', label: 'Reuniões', icon: 'groups_2', implemented: true, roles: ['admin', 'director', 'secretaria'] }
    ]
  },

  {
    key: 'relatorios',
    label: 'Relatórios',
    icon: 'bar_chart',
    roles: ['admin', 'director', 'secretaria'],
    items: [
      { view: 'relatorios', label: 'Estatísticas', icon: 'bar_chart', implemented: true },
      { view: 'listagem', label: 'Listagem', icon: 'list_alt', implemented: true },
      { view: 'dashboard_preditivo', label: 'Análises', icon: 'trending_up', implemented: true },
      { view: 'evasao_escolar', label: 'Evasão Escolar', icon: 'person_off', implemented: true },
      { view: 'exportacao_med', label: 'Exportação', icon: 'flag', implemented: true }
    ]
  },

  {
    key: 'configuracoes',
    label: 'Configurações',
    icon: 'settings',
    roles: ['admin', 'director'],
    items: [
      { view: 'configuracoes/instituicao', label: 'Instituição', icon: 'apartment', implemented: true },
      { view: 'configuracoes/ano-letivo', label: 'Ano Letivo', icon: 'date_range', implemented: true },
      { view: 'configuracoes/financeiro', label: 'Tabela Financeira', icon: 'request_quote', implemented: true },
      { view: 'configuracoes/notas', label: 'Regras de Notas', icon: 'rule', implemented: true },
      { view: 'configuracoes/perfis', label: 'Permissões', icon: 'admin_panel_settings', implemented: true },
      { view: 'configuracoes/integracoes', label: 'Integrações', icon: 'hub', implemented: true },
      { view: 'configuracoes/seguranca-backups', label: 'Segurança e Backups', icon: 'security', implemented: true },
      { view: 'configuracoes/utilizadores', label: 'Utilizadores', icon: 'group_add', implemented: true },
      { view: 'configuracoes/protecao-dados', label: 'Proteção de Dados', icon: 'policy', implemented: true },
      { view: 'configuracoes/plano-subscricao', label: 'Plano e Subscrição', icon: 'workspace_premium', implemented: true },
      { view: 'configuracoes/personalizar-sistema', label: 'Personalizar Sistema', icon: 'tune', implemented: true }
    ]
  },

  {
    key: 'portal_professor',
    label: 'Portal do Professor',
    icon: 'cast_for_education',
    roles: ['admin', 'director', 'professor'],
    accent: 'amber',
    items: [
      { view: 'professor_plano_aulas', label: 'Plano de Aulas', icon: 'event_note', implemented: true },
      { view: 'professor_sumarios', label: 'Sumários', icon: 'edit_note', implemented: true },
      { view: 'professor_materiais', label: 'Materiais de Apoio', icon: 'folder_open', implemented: true }
    ]
  },

  {
    key: 'area_estudante',
    label: 'Portal do Aluno',
    icon: 'school',
    roles: ['aluno'],
    accent: 'amber',
    items: [
      { view: 'aluno_notas', label: 'Consultar Notas', icon: 'assignment', implemented: true },
      { view: 'aluno_faltas', label: 'Faltas', icon: 'event_busy', implemented: true },
      { view: 'aluno_financeiro', label: 'Finanças', icon: 'account_balance_wallet', implemented: true },
      { view: 'aluno_trabalhos', label: 'Meus Trabalhos', icon: 'assignment_turned_in', implemented: true },
      { view: 'ensino_superior', label: 'Cadeiras & ECTS', icon: 'account_balance', implemented: true }
    ]
  },

  {
    key: 'portal_encarregado',
    label: 'Portal do Encarregado',
    icon: 'family_restroom',
    roles: ['encarregado'],
    accent: 'amber',
    items: [
      { view: 'encarregado_notas', label: 'Notas', icon: 'assignment', implemented: true },
      { view: 'encarregado_faltas', label: 'Faltas', icon: 'event_busy', implemented: true },
      { view: 'encarregado_comunicados', label: 'Comunicados', icon: 'campaign', implemented: true },
      { view: 'encarregado_reunioes', label: 'Reuniões', icon: 'groups_2', implemented: true },
      { view: 'encarregado_descritiva', label: 'Avaliação Descritiva', icon: 'child_care', implemented: true },
      { view: 'encarregado_financeiro', label: 'Finanças', icon: 'payments', implemented: true },
      { view: 'ensino_superior', label: 'Cadeiras Superiores', icon: 'account_balance', implemented: true }
    ]
  }
];

