import { SectionAccess, SectionMode, User, UserAccess, UserRole } from '../types';
import { dbService } from '../services/db';
import { NAV_GROUPS } from './navCatalog';
import { isPlatformSectionBlocked } from './platformLock';
import { isFeatureSectionHidden } from './featureModes';
import { defaultPermissionsList, hasRolePermission, registerUserRuleResolver } from './permissions';

/**
 * ACESSO POR UTILIZADOR
 * =====================
 * Três níveis de controlo, por utilizador:
 *
 *   1. SECÇÃO  — aparece (ou não) no menu lateral e pode (ou não) ser aberta.
 *   2. MODO    — dentro de uma secção ativa: 'read' (só ver) ou 'write' (ver e gravar).
 *   3. AÇÃO    — dentro de uma secção em 'write': que botões/ações ficam disponíveis.
 *
 * O que NÃO está personalizado herda o modelo do perfil (a matriz de "Perfis &
 * Permissões" e os `roles` do catálogo do menu). Assim, utilizadores antigos e
 * secções/botões novos continuam a funcionar sem ninguém ter de os configurar.
 *
 * AVISO: isto controla a interface (menu, rotas, botões e regras `can()`).
 * Não substitui regras de segurança no servidor.
 */

// ---------------------------------------------------------------------------
// Chaves seguras para a base de dados
// ---------------------------------------------------------------------------

/**
 * O Firebase Realtime Database recusa chaves com `. / $ # [ ]`. Como os ids de
 * secção ('configuracoes/ano-letivo') e as regras ('alunos.create') os têm, TODA
 * a chave gravada em `user.access` e em `settings.accessRegistry` passa por aqui.
 * É idempotente: accessKey(accessKey(x)) === accessKey(x).
 * (Uma chave inválida faria falhar a sincronização inteira da instituição.)
 */
export function accessKey(raw: string): string {
  return String(raw)
    .replace(/\./g, '~d')
    .replace(/\//g, '~s')
    .replace(/\$/g, '~c')
    .replace(/#/g, '~h')
    .replace(/\[/g, '~o')
    .replace(/\]/g, '~e');
}

// ---------------------------------------------------------------------------
// Catálogo de secções (derivado do menu lateral)
// ---------------------------------------------------------------------------

export interface AccessSection {
  id: string;
  label: string;
  icon: string;
  groupKey: string;
  groupLabel: string;
  /** Perfis que a recebem ligada no modelo inicial. */
  templateRoles: UserRole[];
}

export const ACCESS_SECTIONS: AccessSection[] = NAV_GROUPS.flatMap((group) =>
  group.items
    .filter((item) => item.implemented && item.view)
    .map((item) => ({
      id: item.view as string,
      label: item.label,
      icon: item.icon,
      groupKey: group.key,
      groupLabel: group.label,
      templateRoles: group.roles.filter((r) => !item.roles || item.roles.includes(r))
    }))
);

/** Portais próprios de Aluno/Encarregado: nunca aparecem para o Administrador. */
const PORTAL_GROUPS = new Set(['area_estudante', 'portal_encarregado']);

const SECTION_BY_ID: Record<string, AccessSection> = Object.fromEntries(ACCESS_SECTIONS.map((s) => [s.id, s]));

export function getSection(id: string): AccessSection | undefined {
  return SECTION_BY_ID[id];
}

/** Ecrãs internos que pertencem a uma secção do menu (não têm entrada própria). */
const SUBVIEW_PARENT: Record<string, string> = {
  importar_pauta: 'pautas',
  homologacao_pauta: 'pautas'
};

export function sectionIdForView(view: string): string {
  return SUBVIEW_PARENT[view] || view;
}

// ---------------------------------------------------------------------------
// Regras declaradas por secção
// (as regras já existentes em `defaultPermissionsList` ficam associadas à
// secção onde são usadas; o resto é descoberto em tempo de execução)
// ---------------------------------------------------------------------------

export const SECTION_RULES: Record<string, string[]> = {
  admissoes: ['admissoes.manage', 'admissoes.decide'],
  matriculas: ['alunos.create'],
  alunos: ['alunos.create', 'alunos.edit', 'alunos.sensitive', 'alunos.print_docs', 'alunos.delete'],
  vinculo_filhos: ['vinculos.manage'],
  turmas: ['turmas.manage'],
  disciplinas: ['turmas.manage'],
  cursos: ['turmas.manage'],
  horarios: ['turmas.manage'],
  mapa_salas: ['turmas.manage'],
  atribuicao: ['professores.assign'],
  departamentos: ['departamentos.manage'],
  pautas: ['pautas.edit_notas', 'pautas.import_excel', 'pautas.homologar', 'pautas.unlock'],
  assiduidade: ['assiduidade.mark', 'assiduidade.justify'],
  banco_questoes: ['banco_questoes.manage', 'banco_questoes.approve', 'banco_questoes.manage_all'],
  mural_biblioteca: ['avisos.manage'],
  calendario_escolar: ['calendario.manage'],
  dashboard: ['calendario.delete'],
  plano_curricular: ['curriculo.manage', 'curriculo.approve'],
  atividades_extracurriculares: ['extracurriculares.manage'],
  professores: ['professores.manage'],
  funcionarios: ['funcionarios.manage'],
  folha_pagamento: ['rh.payroll.manage'],
  avaliacao_desempenho_docente: ['rh.avaliacao.manage'],
  ferias_licencas: ['rh.ferias.manage'],
  propinas: ['propinas.liquidate', 'propinas.discounts', 'propinas.cancel', 'propinas.reports'],
  fornecedores: ['fornecedores.manage'],
  inventario_ativos: ['patrimonio.ativos.manage'],
  controlo_estoque: ['patrimonio.estoque.manage'],
  transporte_escolar: ['patrimonio.transporte.manage'],
  refeitorio: ['refeitorio.manage'],
  saude_ficha_medica: ['saude.ficha_medica.view', 'saude.ficha_medica.manage'],
  saude_incidentes: ['saude.incidentes.manage', 'saude.incidentes.decide'],
  saude_recolha: ['saude.recolha.manage'],
  comunicacao_notificacoes: ['comunicacao.notificacoes.manage', 'comunicacao.chat.manage'],
  comunicacao_reunioes: ['comunicacao.reunioes.manage'],
  evasao_escolar: ['evasao.manage'],
  exames_nacionais: ['exames.manage'],
  plano_individual: ['plano_individual.manage'],
  internato: ['internato.manage'],
  balancete_contabilistico: ['financeiro.balancete.manage'],
  'configuracoes/instituicao': ['config.institution'],
  'configuracoes/ano-letivo': ['config.institution'],
  'configuracoes/financeiro': ['config.institution'],
  'configuracoes/notas': ['config.institution'],
  'configuracoes/integracoes': ['config.institution'],
  'configuracoes/protecao-dados': ['config.institution'],
  'configuracoes/personalizar-sistema': ['config.institution'],
  'configuracoes/perfis': ['config.permissions'],
  'configuracoes/utilizadores': ['config.permissions'],
  'configuracoes/seguranca-backups': ['config.backups']
};

/** Regras de "ver/consultar": valem em modo leitura, desde que o botão esteja ligado. */
const READ_KIND_RULES = new Set([
  'alunos.sensitive',
  'alunos.print_docs',
  'propinas.reports',
  'saude.ficha_medica.view'
]);

export function isReadRule(rule: string): boolean {
  return READ_KIND_RULES.has(rule) || rule.endsWith('.view') || rule.endsWith('.read');
}

const RULE_LABEL: Record<string, string> = Object.fromEntries(defaultPermissionsList.map((p) => [p.rule, p.action]));
export function labelForRule(rule: string): string {
  return RULE_LABEL[rule] || rule;
}

const SECTIONS_BY_RULE: Record<string, string[]> = {};
for (const [sid, rules] of Object.entries(SECTION_RULES)) {
  for (const r of rules) (SECTIONS_BY_RULE[r] ||= []).push(sid);
}

// ---------------------------------------------------------------------------
// Modelo inicial do perfil
// ---------------------------------------------------------------------------

/** Modelo do perfil para uma secção: o que o utilizador recebe sem personalização. */
export function roleTemplateForSection(role: string, sectionId: string): SectionAccess {
  const section = SECTION_BY_ID[sectionId];
  const enabled = !!section && section.templateRoles.includes(role as UserRole);

  const rules = SECTION_RULES[sectionId] || [];
  const actions: Record<string, boolean> = {};
  for (const rule of rules) actions[accessKey(rule)] = hasRolePermission(role, rule);

  const writeRules = rules.filter((r) => !isReadRule(r));
  // Sem regras de gravação declaradas não havia restrição antes → mantém 'write'.
  const mode: SectionMode =
    writeRules.length === 0 || writeRules.some((r) => actions[accessKey(r)]) ? 'write' : 'read';

  return { enabled, mode, actions };
}

// ---------------------------------------------------------------------------
// Resolução por utilizador
// ---------------------------------------------------------------------------

/** Utilizador da sessão, com o acesso mais recente (lido da lista viva de utilizadores). */
export function getSessionUser(): User | null {
  try {
    // Acessores baratos: getDatabase() monta uma cópia da base inteira e isto corre a cada verificação.
    const current = dbService.getCurrentUser();
    if (!current) return null;
    const live = dbService.getUsers().find((u) => u.id === current.id);
    const resolvedAccess = current.access || live?.access;
    return {
      ...(live || current),
      role: current.role,
      institutionId: current.institutionId,
      access: resolvedAccess
    };
  } catch {
    return null;
  }
}

export function sectionAccessFor(user: Pick<User, 'role' | 'access'> | null | undefined, sectionId: string): SectionAccess {
  if (!user) return { enabled: false, mode: 'read', actions: {} };
  // O Administrador Geral nunca pode ficar sem acesso (evita bloquear o sistema),
  // exceto nos portais de Aluno/Encarregado, que não lhe pertencem.
  if (user.role === 'admin') {
    const section = SECTION_BY_ID[sectionId];
    if (section && PORTAL_GROUPS.has(section.groupKey)) return { enabled: false, mode: 'read', actions: {} };
    return { enabled: true, mode: 'write', actions: {} };
  }

  const custom = user.access?.sections?.[accessKey(sectionId)];
  if (!custom) {
    return roleTemplateForSection(user.role, sectionId);
  }

  // Quando o utilizador tem a secção personalizada pelo Administrador:
  // A personalização é a fonte autoritativa de verdade!
  const rules = SECTION_RULES[sectionId] || [];
  const actions: Record<string, boolean> = {};

  for (const r of rules) {
    const k = accessKey(r);
    if (custom.actions && custom.actions[k] !== undefined) {
      // Se o administrador configurou explicitamente o botão/ação (ligado ou desligado):
      actions[k] = custom.actions[k];
    } else {
      // Se não houver configuração explícita deste botão na personalização:
      // Se a secção está em modo de gravação ('write'), todas as ações da secção ficam autorizadas;
      // Se está em modo 'read', apenas as regras de consulta/leitura são permitidas.
      actions[k] = custom.mode === 'write' ? true : isReadRule(r);
    }
  }

  // Incorporar botões e ações adicionais guardadas na personalização
  if (custom.actions) {
    for (const [k, v] of Object.entries(custom.actions)) {
      if (actions[k] === undefined) actions[k] = v;
    }
  }

  return {
    enabled: custom.enabled,
    mode: custom.mode,
    actions
  };
}

/** Esta secção já foi configurada explicitamente para este utilizador? */
export function isSectionCustomized(user: Pick<User, 'access'>, sectionId: string): boolean {
  return !!user.access?.sections?.[accessKey(sectionId)];
}

export function canViewSection(user: Pick<User, 'role' | 'access'> | null | undefined, sectionId: string): boolean {
  if (isPlatformSectionBlocked(sectionId)) return false;
  // Área avançada oculta pelo Super Admin (Integrações): invisível para a escola.
  if (isFeatureSectionHidden(sectionId)) return false;
  return sectionAccessFor(user, sectionId).enabled;
}

export function sectionMode(user: Pick<User, 'role' | 'access'> | null | undefined, sectionId: string): SectionMode {
  return sectionAccessFor(user, sectionId).mode;
}

/**
 * Valor por omissão de um botão que o Administrador ainda não configurou.
 *  • Secção NÃO personalizada → liberta (o comportamento de sempre; quem manda
 *    é a matriz do perfil, para nenhum botão existente desaparecer de repente).
 *  • Secção personalizada → liberta todas as ações autorizadas.
 */
export function defaultForDetectedAction(destructive?: boolean, customized?: boolean): boolean {
  return true;
}

/** Um botão detetado (chave 'btn:...') está disponível para o utilizador nesta secção? */
export function canUserAction(
  user: Pick<User, 'role' | 'access'> | null | undefined,
  sectionId: string,
  actionKey: string,
  destructive?: boolean
): boolean {
  if (!user) return false;
  if (user.role === 'admin') return true;
  const access = sectionAccessFor(user, sectionId);
  if (!access.enabled || access.mode !== 'write') return false;
  const explicit = access.actions[accessKey(actionKey)];
  return explicit === undefined
    ? true
    : explicit;
}

// Secção ativa no ecrã: desempata regras que existem em várias secções
// (ex.: 'turmas.manage' vale para Turmas, Disciplinas, Cursos...).
let activeSectionId: string | null = null;
export function setActiveAccessSection(sectionId: string | null) {
  activeSectionId = sectionId;
}

/** Decisão de uma regra declarada para um utilizador. `null` = regra fora do catálogo. */
export function canUserRule(user: Pick<User, 'role' | 'access'>, rule: string): boolean | null {
  if (user.role === 'admin') return true;
  const sections = SECTIONS_BY_RULE[rule];
  if (!sections || sections.length === 0) return null;

  const allowedIn = (sid: string): boolean => {
    const access = sectionAccessFor(user, sid);
    if (!access.enabled) return false;
    if (!isReadRule(rule) && access.mode !== 'write') return false;
    const explicit = access.actions[accessKey(rule)];
    if (explicit !== undefined) return explicit;
    // Se a secção foi expressamente personalizada e está em modo de gravação,
    // a regra pertence a esta secção e deve ser permitida em vez de herdar o bloqueio da role padrão:
    if (isSectionCustomized(user, sid) && access.mode === 'write') {
      return true;
    }
    return hasRolePermission(user.role, rule);
  };

  // Se estivermos dentro de uma secção ativa e ela permitir, devolve true
  if (activeSectionId && sections.includes(activeSectionId)) {
    const activeAllowed = allowedIn(activeSectionId);
    if (activeAllowed) return true;
  }

  // Devolve true se qualquer uma das secções autorizadas para esta regra permitir
  return sections.some(allowedIn);
}

// Liga o `hasPermission` (usado em toda a aplicação) a esta decisão por utilizador.
registerUserRuleResolver((role, rule) => {
  const user = getSessionUser();
  if (!user) return null;
  // Se a regra for consultada para o utilizador da sessão, a decisão personalizada tem primazia
  return canUserRule(user, rule);
});

// ---------------------------------------------------------------------------
// Navegação
// ---------------------------------------------------------------------------

export function visibleSections(user: Pick<User, 'role' | 'access'> | null | undefined): AccessSection[] {
  return ACCESS_SECTIONS.filter((s) => canViewSection(user, s.id));
}

/** Primeira view que o utilizador pode abrir (para redirecionar quando perde a atual). */
export function firstAllowedView(user: Pick<User, 'role' | 'access'> | null | undefined, preferred?: string): string | null {
  if (preferred && canViewSection(user, sectionIdForView(preferred))) return preferred;
  return visibleSections(user)[0]?.id ?? null;
}

/** A view atual (incluindo 'configuracoes' sem aba) pode ser aberta? */
export function isViewAllowed(user: Pick<User, 'role' | 'access'> | null | undefined, view: string): boolean {
  if (view === 'configuracoes') return visibleSections(user).some((s) => s.id.startsWith('configuracoes/'));
  const sid = sectionIdForView(view);
  // Ecrãs fora do catálogo do menu (rotas novas): o Administrador vê sempre; os
  // restantes só se o Administrador os tiver ligado na lista "Secções novas".
  if (!SECTION_BY_ID[sid]) {
    if (user?.role === 'admin') return true;
    return user?.access?.sections?.[accessKey(sid)]?.enabled === true;
  }
  return canViewSection(user, sid);
}

/** Primeira aba de Configurações que o utilizador pode abrir. */
export function firstAllowedConfigView(user: Pick<User, 'role' | 'access'> | null | undefined): string | null {
  return visibleSections(user).find((s) => s.id.startsWith('configuracoes/'))?.id ?? null;
}

// ---------------------------------------------------------------------------
// Modelo completo para o editor e resumo
// ---------------------------------------------------------------------------

export function buildFullAccess(user: Pick<User, 'role' | 'access'>): UserAccess {
  const sections: Record<string, SectionAccess> = {};
  for (const s of ACCESS_SECTIONS) sections[accessKey(s.id)] = sectionAccessFor(user, s.id);
  return { version: 1, sections };
}

export function summarizeAccess(user: Pick<User, 'role' | 'access'>) {
  let enabled = 0;
  let write = 0;
  for (const s of ACCESS_SECTIONS) {
    const a = sectionAccessFor(user, s.id);
    if (a.enabled) {
      enabled += 1;
      if (a.mode === 'write') write += 1;
    }
  }
  return { enabled, write, read: enabled - write, total: ACCESS_SECTIONS.length };
}

// ---------------------------------------------------------------------------
// Classificação de botões (deteção automática)
// ---------------------------------------------------------------------------

export type ButtonKind = 'write' | 'read' | 'ignore';

export interface ButtonClass {
  kind: ButtonKind;
  destructive: boolean;
}

// Botões que NUNCA se controlam: navegação, fechar, cancelar, pesquisar, etc.
const IGNORE_LABEL =
  /^(cancelar|fechar|voltar|sair|ok|entendi|entendido|n[aã]o|sim|limpar( filtros?)?|pesquisar|procurar|filtrar|ver|visualizar|abrir|imprimir|exportar|descarregar|baixar|detalhes|expandir|recolher|seguinte|anterior|pr[oó]ximo|mais|menos|hoje|fechar menu)$/i;
const IGNORE_ICON = new Set([
  'close', 'arrow_back', 'arrow_forward', 'expand_more', 'expand_less', 'chevron_left', 'chevron_right',
  'search', 'print', 'visibility', 'visibility_off', 'download', 'filter_list', 'menu', 'refresh',
  'first_page', 'last_page', 'navigate_before', 'navigate_next', 'more_vert', 'more_horiz', 'info', 'help'
]);

const WRITE_LABEL =
  /(novo|nova|adicionar|acrescentar|criar|cadastrar|registar|registrar|editar|alterar|atualizar|actualizar|eliminar|excluir|apagar|remover|guardar|salvar|gravar|confirmar|liquidar|anular|aprovar|rejeitar|homologar|reabrir|arquivar|importar|lan[cç]ar|enviar|atribuir|matricular|transferir|decidir|gerar|emitir|publicar|desbloquear|bloquear|trancar|vincular|desvincular|inscrever|agendar|submeter|restaurar|repor|abate|substituir|duplicar|marcar|justificar|pagar|receber|processar|fechar caixa|conceder|revogar|ativar|desativar|activar|desactivar|resetar|redefinir)/i;
const WRITE_ICON = new Set([
  'add', 'add_circle', 'add_box', 'edit', 'edit_square', 'delete', 'delete_forever', 'save', 'check', 'check_circle',
  'person_add', 'cloud_upload', 'upload', 'upload_file', 'send', 'publish', 'restore', 'lock_open', 'lock',
  'how_to_reg', 'link', 'link_off', 'playlist_add', 'post_add', 'note_add', 'drive_file_rename_outline', 'done_all'
]);

const DESTRUCTIVE =
  /(eliminar|excluir|apagar|remover|anular|abate|rejeitar|desvincular|restaurar|repor|transferir|reabrir|desbloquear|revogar|desativar|desactivar|resetar|redefinir|substituir)/i;
const DESTRUCTIVE_ICON = new Set(['delete', 'delete_forever', 'link_off', 'restore', 'lock_open', 'person_remove']);

export function classifyButton(label: string, icon?: string): ButtonClass {
  const l = (label || '').trim();
  const i = (icon || '').trim();

  if (l && IGNORE_LABEL.test(l)) return { kind: 'ignore', destructive: false };
  if (!l && i && IGNORE_ICON.has(i)) return { kind: 'ignore', destructive: false };

  const destructive = DESTRUCTIVE.test(l) || DESTRUCTIVE_ICON.has(i);
  const isWrite = WRITE_LABEL.test(l) || (!l && WRITE_ICON.has(i)) || destructive;
  return { kind: isWrite ? 'write' : 'read', destructive };
}

export function slugifyAction(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[0-9]+/g, '')
    .replace(/[^a-z_]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48);
}
