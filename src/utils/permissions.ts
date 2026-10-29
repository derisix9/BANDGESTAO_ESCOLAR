import { UserRole } from '../types';
import { dbService } from '../services/db';

export type RoleKey = 'admin' | 'director' | 'secretaria' | 'professor' | 'financeiro' | 'funcionario';

export interface RolePermissionItem {
  module: string;
  action: string;
  rule: string;
  allowed: boolean;
}

export interface RoleDefinition {
  name: string;
  code: string;
  level: string;
  desc: string;
  usersCount: number;
  permissions: RolePermissionItem[];
}

export const defaultPermissionsList: Omit<RolePermissionItem, 'allowed'>[] = [
  // Alunos & Matrículas
  { module: 'Alunos & Matrículas', action: 'Criar e Matricular Novos Estudantes', rule: 'alunos.create' },
  { module: 'Alunos & Matrículas', action: 'Editar Processo Biográfico e Filiação', rule: 'alunos.edit' },
  { module: 'Alunos & Matrículas', action: 'Ver Dados Sensíveis do Aluno (NEE, Filiação)', rule: 'alunos.sensitive' },
  { module: 'Alunos & Matrículas', action: 'Emitir Ficha Biográfica e Cartão Estudante', rule: 'alunos.print_docs' },
  { module: 'Alunos & Matrículas', action: 'Eliminar ou Transferir Aluno', rule: 'alunos.delete' },

  // Pautas & Avaliações
  { module: 'Pautas & Avaliações', action: 'Lançar e Editar Avaliações Contínuas (MAC/NPP/NPT)', rule: 'pautas.edit_notas' },
  { module: 'Pautas & Avaliações', action: 'Importar Mini-Pautas via Ficheiro Excel', rule: 'pautas.import_excel' },
  { module: 'Pautas & Avaliações', action: 'Homologar Pautas Finais e Trancar Trimestre', rule: 'pautas.homologar' },
  { module: 'Pautas & Avaliações', action: 'Reabertura e Desbloqueio de Pautas', rule: 'pautas.unlock' },

  // Tesouraria & Propinas
  { module: 'Tesouraria & Propinas', action: 'Liquidar Mensalidades e Emitir Recibos Oficiais', rule: 'propinas.liquidate' },
  { module: 'Tesouraria & Propinas', action: 'Aplicar Isenções, Bolsas e Descontos', rule: 'propinas.discounts' },
  { module: 'Tesouraria & Propinas', action: 'Anular e Cancelar Faturas/Recibos Emitidos', rule: 'propinas.cancel' },
  { module: 'Tesouraria & Propinas', action: 'Consultar Relatórios Financeiros e Fecho de Caixa', rule: 'propinas.reports' },

  // Assiduidade & Aulas
  { module: 'Assiduidade & Aulas', action: 'Efetuar Chamada e Marcar Faltas Diárias', rule: 'assiduidade.mark' },
  { module: 'Assiduidade & Aulas', action: 'Justificar Faltas com Atestado Médico/Documento', rule: 'assiduidade.justify' },

  // Corpo Docente & Turmas
  { module: 'Docência & Turmas', action: 'Atribuir Disciplinas e Cargas Horárias a Professores', rule: 'professores.assign' },
  { module: 'Docência & Turmas', action: 'Criar Novas Turmas e Definir Capacidade', rule: 'turmas.manage' },
  { module: 'Docência & Turmas', action: 'Cadastrar, Editar e Eliminar Professores', rule: 'professores.manage' },
  { module: 'Docência & Turmas', action: 'Cadastrar, Editar e Eliminar Funcionários', rule: 'funcionarios.manage' },
  { module: 'Docência & Turmas', action: 'Cadastrar, Editar e Eliminar Departamentos (Curriculares e Profissionais)', rule: 'departamentos.manage' },

  // Serviços (Secção 4 a 9)
  { module: 'Serviços', action: 'Vincular e Desvincular Filhos a Encarregados de Educação', rule: 'vinculos.manage' },
  { module: 'Serviços', action: 'Registar e Acompanhar Candidaturas de Pré-Matrícula (Admissões)', rule: 'admissoes.manage' },
  { module: 'Serviços', action: 'Decidir Candidaturas (Aprovar, Lista de Espera ou Rejeitar)', rule: 'admissoes.decide' },
  { module: 'Serviços', action: 'Criar e Editar Questões e Provas do Banco de Exames', rule: 'banco_questoes.manage' },
  { module: 'Serviços', action: 'Aprovar Questões e Publicar Exames Finais, de Recurso e de Acesso', rule: 'banco_questoes.approve' },
  { module: 'Serviços', action: 'Ver e Editar Questões e Provas de Todos os Autores (Banco de Exames)', rule: 'banco_questoes.manage_all' },
  { module: 'Serviços', action: 'Publicar Avisos no Mural da Escola', rule: 'avisos.manage' },
  { module: 'Serviços', action: 'Gerir Eventos do Calendário Escolar', rule: 'calendario.manage' },
  { module: 'Serviços', action: 'Eliminar Eventos da Agenda Institucional', rule: 'calendario.delete' },
  { module: 'Serviços', action: 'Criar e Editar Planos Curriculares e Registar Tempos Leccionados', rule: 'curriculo.manage' },
  { module: 'Serviços', action: 'Aprovar, Reabrir e Arquivar Planos Curriculares', rule: 'curriculo.approve' },
  { module: 'Serviços', action: 'Gerir Atividades Extracurriculares (Inscrições, Presenças e Estados)', rule: 'extracurriculares.manage' },
  { module: 'Serviços', action: 'Gerir o Refeitório (Ementas, Inscrições, Alergias e Serviço Diário)', rule: 'refeitorio.manage' },

  // Recursos Humanos
  { module: 'Recursos Humanos', action: 'Gerar, Editar e Confirmar Pagamento da Folha de Pagamento', rule: 'rh.payroll.manage' },
  { module: 'Recursos Humanos', action: 'Realizar e Homologar Avaliações de Desempenho Docente', rule: 'rh.avaliacao.manage' },
  { module: 'Recursos Humanos', action: 'Registar e Decidir Pedidos de Férias & Licenças', rule: 'rh.ferias.manage' },

  // Logística
  { module: 'Logística', action: 'Cadastrar, Editar e Eliminar Fornecedores da Instituição', rule: 'fornecedores.manage' },
  { module: 'Logística', action: 'Gerir o Inventário de Ativos (Cadastro, Estado, Abate e Eliminação)', rule: 'patrimonio.ativos.manage' },
  { module: 'Logística', action: 'Gerir o Estoque (Itens, Entradas e Saídas de Material)', rule: 'patrimonio.estoque.manage' },
  { module: 'Logística', action: 'Gerir o Transporte Escolar (Viaturas, Rotas e Inscrição de Alunos)', rule: 'patrimonio.transporte.manage' },

  // Saúde & Segurança
  { module: 'Saúde & Segurança', action: 'Ver Fichas Médicas dos Alunos (Dado de Saúde Confidencial)', rule: 'saude.ficha_medica.view' },
  { module: 'Saúde & Segurança', action: 'Criar, Editar e Registar Ocorrências na Ficha Médica', rule: 'saude.ficha_medica.manage' },
  { module: 'Saúde & Segurança', action: 'Registar, Editar e Dar Seguimento a Incidentes Disciplinares', rule: 'saude.incidentes.manage' },
  { module: 'Saúde & Segurança', action: 'Decidir a Medida Disciplinar Final de um Incidente', rule: 'saude.incidentes.decide' },
  { module: 'Saúde & Segurança', action: 'Gerir Autorizações de Recolha e Registar Saídas à Porta', rule: 'saude.recolha.manage' },

  // Processos académicos
  { module: 'Processos Académicos', action: 'Emitir Certificados, Declarações, Diplomas e Históricos Numerados', rule: 'documentos.emitir' },
  { module: 'Processos Académicos', action: 'Anular Documentos Académicos já Emitidos', rule: 'documentos.anular' },
  { module: 'Processos Académicos', action: 'Registar Transferências, Equivalências e Anulações de Matrícula', rule: 'transferencias.manage' },
  { module: 'Processos Académicos', action: 'Preparar o Conselho de Turma e a Decisão de Transição', rule: 'conselho.manage' },
  { module: 'Processos Académicos', action: 'Homologar Decisões do Conselho de Turma', rule: 'conselho.homologar' },
  { module: 'Processos Académicos', action: 'Gerir Recuperação e Exames de Recurso', rule: 'recuperacao.manage' },

  // Biblioteca, ensino à distância, primário e portal do professor
  { module: 'Biblioteca', action: 'Gerir Empréstimos, Devoluções, Renovações e Multas da Biblioteca', rule: 'biblioteca.manage' },
  { module: 'Ensino à Distância', action: 'Criar Trabalhos Online e Corrigir Entregas', rule: 'ead.manage' },
  { module: 'Primário e Pré-escolar', action: 'Preencher e Publicar a Avaliação Descritiva por Competências', rule: 'descritiva.manage' },
  { module: 'Portal do Professor', action: 'Redigir Planos de Aulas, Sumários e Materiais de Apoio', rule: 'professor.trabalho.manage' },
  { module: 'Portal do Professor', action: 'Aprovar ou Devolver Planos de Aulas', rule: 'professor.planos.review' },

  // Financeiro avançado
  { module: 'Tesouraria & Propinas', action: 'Gerir Planos de Pagamento, Bolsas e Regras de Desconto', rule: 'financeiro.planos.manage' },
  { module: 'Tesouraria & Propinas', action: 'Importar Extrato Bancário e Conciliar Pagamentos', rule: 'financeiro.conciliacao.manage' },
  { module: 'Tesouraria & Propinas', action: 'Gerir Despesas, Contas a Pagar e Fluxo de Caixa', rule: 'financeiro.contabilidade.manage' },
  { module: 'Tesouraria & Propinas', action: 'Contabilidade: Plano de Contas, Lançamentos e Balancete', rule: 'financeiro.balancete.manage' },

  // Evasão escolar
  { module: 'Evasão Escolar', action: 'Acompanhar Alunos em Risco de Abandono (contactos, visitas, apoios)', rule: 'evasao.manage' },

  // Exames nacionais, plano individual e internato
  { module: 'Exames Nacionais', action: 'Gerir Calendário, Inscrições e Resultados dos Exames Nacionais', rule: 'exames.manage' },
  { module: 'Inclusão', action: 'Gerir Planos Educativos Individuais (dados sensíveis)', rule: 'plano_individual.manage' },
  { module: 'Internato', action: 'Gerir Quartos, Alojamento e Mensalidades do Internato', rule: 'internato.manage' },

  // Comunicação
  { module: 'Comunicação', action: 'Criar e Enviar Notificações em Massa (SMS/WhatsApp)', rule: 'comunicacao.notificacoes.manage' },
  { module: 'Comunicação', action: 'Agendar e Gerir Reuniões Pais-Professores', rule: 'comunicacao.reunioes.manage' },
  { module: 'Comunicação', action: 'Gerir Conversas de Chat com Encarregados de Educação', rule: 'comunicacao.chat.manage' },

  // Configurações & Segurança
  { module: 'Configurações Globais', action: 'Parametrizar Dados da Instituição e Assinaturas', rule: 'config.institution' },
  { module: 'Configurações Globais', action: 'Gerir Perfis de Utilizadores e Matriz ACL', rule: 'config.permissions' },
  { module: 'Configurações Globais', action: 'Executar e Restaurar Cópias de Segurança (Backup)', rule: 'config.backups' },
];

export const defaultRoles: Record<RoleKey, RoleDefinition> = {
  admin: {
    name: 'Administrador Geral',
    code: 'ADM-01',
    level: 'Nível 1 - Acesso Total',
    desc: 'Acesso irrestrito a configurações de sistema, parametrização institucional, auditoria forense e gestão global de acessos.',
    usersCount: 2,
    permissions: defaultPermissionsList.map((p) => ({ ...p, allowed: true }))
  },
  director: {
    name: 'Direção Pedagógica',
    code: 'DIR-02',
    level: 'Nível 2 - Pedagógico & Pautas',
    desc: 'Supervisão pedagógica, homologação e trancamento de pautas, aprovação de quadros de honra e gestão do corpo docente.',
    usersCount: 4,
    permissions: defaultPermissionsList.map((p) => ({
      ...p,
      allowed: !['propinas.cancel', 'config.backups', 'avisos.manage', 'calendario.delete'].includes(p.rule)
    }))
  },
  secretaria: {
    name: 'Secretaria Escolar',
    code: 'SEC-03',
    level: 'Nível 3 - Gestão Administrativa',
    desc: 'Inscrições, matrículas, processos biográficos, emissão de declarações, cartões de estudante e atendimento geral.',
    usersCount: 6,
    permissions: defaultPermissionsList.map((p) => ({
      ...p,
      allowed: [
        'alunos.create',
        'alunos.edit',
        'alunos.print_docs',
        'assiduidade.justify',
        'propinas.liquidate',
        'propinas.reports',
        'vinculos.manage',
        'admissoes.manage',
        'extracurriculares.manage',
        'refeitorio.manage',
        'saude.ficha_medica.view',
        'saude.recolha.manage',
        'comunicacao.notificacoes.manage',
        'comunicacao.reunioes.manage',
        'comunicacao.chat.manage',
        'evasao.manage',
        'exames.manage',
        'internato.manage',
        'calendario.manage',
        'documentos.emitir',
        'transferencias.manage',
        'conselho.manage',
        'recuperacao.manage',
        'financeiro.planos.manage',
        'biblioteca.manage',
        'descritiva.manage'
      ].includes(p.rule)
    }))
  },
  professor: {
    name: 'Corpo Docente',
    code: 'DOC-04',
    level: 'Nível 4 - Lançamento & Faltas',
    desc: 'Lançamento de notas em mini-pautas, importação Excel das suas disciplinas atribuídas e registo de presenças diárias.',
    usersCount: 28,
    permissions: defaultPermissionsList.map((p) => ({
      ...p,
      allowed: [
        'pautas.edit_notas',
        'pautas.import_excel',
        'assiduidade.mark',
        'banco_questoes.manage',
        'ead.manage',
        'descritiva.manage',
        'professor.trabalho.manage'
      ].includes(p.rule)
    }))
  },
  financeiro: {
    name: 'Tesouraria & Finanças',
    code: 'FIN-05',
    level: 'Nível 3 - Controlo Financeiro',
    desc: 'Cobrança de propinas, emolumentos, emissão de faturas-recibo, aplicação de políticas de mora e fechos de caixa.',
    usersCount: 3,
    permissions: defaultPermissionsList.map((p) => ({
      ...p,
      allowed: [
        'propinas.liquidate',
        'propinas.discounts',
        'propinas.cancel',
        'propinas.reports',
        'alunos.print_docs',
        'financeiro.planos.manage',
        'financeiro.conciliacao.manage',
        'financeiro.contabilidade.manage',
        'financeiro.balancete.manage'
      ].includes(p.rule)
    }))
  },
  funcionario: {
    name: 'Funcionário da Escola',
    code: 'FUN-06',
    level: 'Nível 5 - Apoio & Operações',
    desc: 'Pessoal não-docente (secretários, direção, auxiliares, operativos, técnicos e tesoureiros). Sem permissões de escrita por omissão — o Administrador deve activar, nesta matriz, apenas as acções que o cargo exige.',
    usersCount: 0,
    permissions: defaultPermissionsList.map((p) => ({ ...p, allowed: false }))
  }
};

/**
 * Junta a matriz gravada em Configurações com os padrões atuais. A matriz
 * guardada por uma instituição só conhece as regras que existiam no dia em que
 * foi gravada; sem esta junção, as regras criadas depois (ex.: as da secção
 * Serviços) nunca apareceriam em "Perfis & Permissões" e o Administrador não
 * as poderia ligar ou desligar. As regras em falta entram no fim da lista,
 * com o valor padrão do perfil, sem alterar a posição das já existentes.
 */
export function mergeRolesWithDefaults(
  stored?: Partial<Record<string, RoleDefinition>> | null
): Record<RoleKey, RoleDefinition> {
  const merged = { ...defaultRoles } as Record<RoleKey, RoleDefinition>;
  for (const key of Object.keys(defaultRoles) as RoleKey[]) {
    const saved = stored?.[key];
    if (!saved || !Array.isArray(saved.permissions)) continue;
    const known = new Set(saved.permissions.map((p) => p.rule));
    const missing = defaultRoles[key].permissions.filter((p) => !known.has(p.rule));
    merged[key] = { ...defaultRoles[key], ...saved, permissions: [...saved.permissions, ...missing] };
  }
  return merged;
}

/**
 * Decisão por utilizador (secção → modo → botão). É registada por
 * `utils/userAccess.ts` ao arrancar; fica aqui como gancho para não haver
 * importações circulares. Devolve `null` quando não tem opinião (regra fora do
 * catálogo) e, nesse caso, vale a matriz do perfil.
 */
export type UserRuleResolver = (role: string, rule: string) => boolean | null;
let userRuleResolver: UserRuleResolver | null = null;
export function registerUserRuleResolver(resolver: UserRuleResolver | null) {
  userRuleResolver = resolver;
}

/**
 * Autorização de uma regra segundo o acesso personalizado do utilizador da
 * sessão e, na falta dele, segundo a matriz do perfil.
 */
export function hasPermission(
  role: string | UserRole | undefined,
  rule: string,
  customRoles?: Record<string, RoleDefinition>
): boolean {
  if (!role) return false;
  if (!customRoles && userRuleResolver) {
    try {
      const decision = userRuleResolver(String(role), rule);
      if (decision !== null) return decision;
    } catch {
      // se o resolver falhar, cai na matriz do perfil
    }
  }
  return hasRolePermission(role, rule, customRoles);
}

/**
 * Checks if a given role has permission to execute an action — apenas pela
 * matriz do perfil (modelo inicial), sem o acesso personalizado do utilizador.
 * If permission is explicitly disabled (allowed: false), returns false.
 */
export function hasRolePermission(
  role: string | UserRole | undefined,
  rule: string,
  customRoles?: Record<string, RoleDefinition>
): boolean {
  if (!role) return false;

  // Retrieve stored permissions from settings if not passed
  let rolesStore = customRoles;
  if (!rolesStore && typeof window !== 'undefined') {
    try {
      const activeRoles = dbService?.getDatabase()?.settings?.rolePermissions;
      if (activeRoles && Object.keys(activeRoles).length > 0) {
        rolesStore = { ...defaultRoles, ...activeRoles };
      }
    } catch {
      // fallback to defaultRoles
    }
  }
  if (!rolesStore) {
    rolesStore = defaultRoles;
  }

  const roleKey = role as RoleKey;
  const roleDef = rolesStore[roleKey] || defaultRoles[roleKey];

  if (!roleDef) {
    // Read-only access for other roles
    if (rule.endsWith('.view') || rule.endsWith('.read')) return true;
    return false;
  }

  const permission = roleDef.permissions?.find((p) => p.rule === rule);
  if (permission !== undefined) {
    return permission.allowed === true;
  }

  // Regra criada depois de a matriz ter sido gravada em Configurações: a
  // matriz guardada ainda não a conhece, por isso vale o padrão do perfil
  // (em vez de bloquear, por exemplo, a Direção numa funcionalidade nova).
  const defaultPermission = defaultRoles[roleKey]?.permissions?.find((p) => p.rule === rule);
  if (defaultPermission !== undefined) {
    return defaultPermission.allowed === true;
  }

  // If the rule is not explicitly present in permissions:
  if (role === 'admin') return true;
  return false;
}
