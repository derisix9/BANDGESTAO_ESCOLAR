/**
 * CATÁLOGO DAS LISTAGENS (Relatórios → Listagem)
 * ==============================================
 * Cada entrada descreve UMA listagem imprimível de uma secção do sistema: de onde vêm as linhas
 * (`rows`), que colunas mostrar (`cols`) e quais são somáveis (`sum`). O painel `ListagemPanel` só
 * desenha, filtra, imprime e exporta para Excel — para acrescentar uma listagem nova basta
 * acrescentar uma entrada a `BASE`.
 *
 * Acesso: `sec` é o id da secção do menu (o mesmo que controla o acesso do utilizador) e `rule`,
 * quando existe, é uma regra extra da Matriz de Permissões (dados financeiros → 'propinas.reports').
 */
import type { SchoolDatabase } from '../types';
import { buildPostings, computeTrialBalance, resolveAccountingOptions } from './accounting';
import { computeDropoutRisk, resolveDropoutThresholds, DROPOUT_LEVEL_META, dropoutAlertLabel, CLOSED_STATUSES } from './dropoutRisk';

export type Cell = string | number | null | undefined;

export interface ListCol {
  h: string;
  get: (row: any, db: SchoolDatabase) => Cell;
  align?: 'left' | 'center' | 'right';
  /** Valor monetário em Kz (formatado e somável). */
  kz?: boolean;
  /** Número somável (sem moeda). */
  num?: boolean;
}

export interface ListDef {
  id: string;
  group: string;
  label: string;
  icon: string;
  /** Id da secção do menu que controla o acesso. */
  sec: string;
  /** Regra extra da Matriz de Permissões. */
  rule?: string;
  rows: (db: SchoolDatabase) => any[];
  cols: ListCol[];
}

/* ------------------------------------------------------------------ utilitários */

const ACCENTS: Record<string, string> = {
  nao: 'não', sim: 'sim', matricula: 'matrícula', matriculado: 'matriculado', pendente: 'pendente',
  concluida: 'concluída', concluido: 'concluído', cancelada: 'cancelada', cancelado: 'cancelado',
  transferida: 'transferida', confirmada: 'confirmada', licenca: 'licença', licencas: 'licenças',
  ferias: 'férias', medica: 'médica', medico: 'médico', paternidade: 'paternidade', maternidade: 'maternidade',
  vencimento: 'vencimento', luto: 'luto', outro: 'outro', escolha: 'escolha', multipla: 'múltipla',
  verdadeiro: 'verdadeiro', falso: 'falso', desenvolvimento: 'desenvolvimento', resposta: 'resposta', curta: 'curta',
  almoco: 'almoço', pequeno: 'pequeno', lanche: 'lanche', manha: 'manhã', integral: 'integral',
  debito: 'débito', isento: 'isento', atraso: 'atraso', pago: 'pago', pendentes: 'pendentes',
  rascunho: 'rascunho', submetido: 'submetido', aprovado: 'aprovado', devolvido: 'devolvido',
  ativo: 'ativo', inativo: 'inativo', manutencao: 'manutenção', avariado: 'avariado',
  aprovada: 'aprovada', revisao: 'revisão', gravissima: 'gravíssima', disciplina: 'disciplina',
  servida: 'servida', ausente: 'ausente', aberto: 'aberto', fechado: 'fechado', pedido: 'pedido',
  recusada: 'recusada', entregue: 'entregue', temporaria: 'temporária', permanente: 'permanente',
  restricao: 'restrição', autorizacao: 'autorização', encarregado: 'encarregado', saida: 'saída',
  entrada: 'entrada', ajuste: 'ajuste', transferencia: 'transferência', reuniao: 'reunião',
  agendada: 'agendada', realizada: 'realizada', publicado: 'publicado', aluno: 'aluno', professor: 'professor',
  funcionario: 'funcionário', acesso: 'acesso', retificacao: 'retificação', eliminacao: 'eliminação',
  portabilidade: 'portabilidade', oposicao: 'oposição', limitacao: 'limitação', em: 'em', analise: 'análise',
  resolvido: 'resolvido', negado: 'negado', recebido: 'recebido', emitido: 'emitido', anulado: 'anulado',
  administrativo: 'administrativo', seguranca: 'segurança', limpeza: 'limpeza', director: 'diretor', diretor: 'diretor',
  multicaixa: 'multicaixa', numerario: 'numerário', cartao: 'cartão', cheque: 'cheque', deposito: 'depósito',
};

/** "licenca_maternidade" → "Licença maternidade" (acentua as palavras conhecidas). */
export function lab(v: unknown): string {
  if (v === null || v === undefined || v === '') return '—';
  const raw = String(v);
  if (/[\sÀ-ÿ]/.test(raw) && !raw.includes('_')) return raw;
  const words = raw.replace(/[_-]+/g, ' ').trim().split(/\s+/).map((w) => ACCENTS[w.toLowerCase()] ?? w.toLowerCase());
  const s = words.join(' ');
  return s.charAt(0).toUpperCase() + s.slice(1);
}

export const dt = (v: unknown): string => {
  if (!v) return '—';
  const s = String(v);
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return `${m[3]}/${m[2]}/${m[1]}`;
  return s;
};

const yn = (v: unknown) => (v ? 'Sim' : 'Não');
const n = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : Number(v) || 0);
const arr = <T = any>(v: unknown): T[] => (Array.isArray(v) ? (v as T[]) : []);
const join = (v: unknown, sep = ', ') => arr<string>(v).filter(Boolean).join(sep);
const MONTHS = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'];

/** Hoje em AAAA-MM-DD, na hora local (não em UTC). */
export function todayLocalISO(d: Date = new Date()): string {
  const p = (x: number) => String(x).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/** Formata um valor para ecrã / impressão. */
export function fmtCell(v: Cell, col?: Pick<ListCol, 'kz' | 'num'>): string {
  if (v === null || v === undefined || v === '') return '—';
  if (typeof v === 'number') {
    const s = v.toLocaleString('pt-PT', { maximumFractionDigits: 2 });
    return col?.kz ? `${s} Kz` : s;
  }
  return String(v);
}

const sortBy = <T,>(list: T[], key: (x: T) => string) =>
  [...list].sort((a, b) => key(a).localeCompare(key(b), 'pt'));

/* ------------------------------------------------------------------ definições */

/** Lançamentos da Contabilidade (mesmas opções do ecrã: regime e amortizações), do mais antigo para o mais recente. */
function contabPostings(db: SchoolDatabase) {
  return buildPostings(
    { invoices: arr<any>(db.invoices), expenses: arr<any>(db.expenses), payroll: arr<any>(db.payrollRecords), assets: arr<any>(db.assets), manual: arr<any>(db.journalEntries) },
    resolveAccountingOptions(db.settings?.accountingOptions), todayLocalISO()
  ).sort((a, b) => a.date.localeCompare(b.date));
}

const G_SEC = 'Secretaria';
const G_PED = 'Pedagógico';
const G_RH = 'Recursos Humanos';
const G_TES = 'Tesouraria';
const G_LOG = 'Logística';
const G_SAU = 'Saúde & Segurança';
const G_COM = 'Comunicação';
const G_ADM = 'Administração';

const BASE: ListDef[] = [
  /* ---------------- Secretaria (tudo, excepto Emissão e Documentos) ---------------- */
  {
    id: 'admissoes', group: G_SEC, label: 'Admissões', icon: 'how_to_reg', sec: 'admissoes',
    rows: (db) => arr(db.admissions),
    cols: [
      { h: 'Código', get: (r) => r.code }, { h: 'Candidato', get: (r) => r.name },
      { h: 'Sexo', get: (r) => r.gender }, { h: 'Nascimento', get: (r) => dt(r.birthDate) },
      { h: 'Classe', get: (r) => r.desiredGrade }, { h: 'Curso', get: (r) => r.desiredCourse },
      { h: 'Encarregado', get: (r) => r.guardianName }, { h: 'Contacto', get: (r) => r.guardianPhone || r.phone },
      { h: 'Estado', get: (r) => lab(r.status) },
    ],
  },
  {
    id: 'matriculas', group: G_SEC, label: 'Matrículas', icon: 'assignment_turned_in', sec: 'matriculas',
    rows: (db) => arr(db.matriculas),
    cols: [
      { h: 'N.º Matrícula', get: (r) => r.numeroMatricula || r.numeroDeMatricula }, { h: 'Ano Letivo', get: (r) => r.academicYear },
      { h: 'Aluno', get: (r) => r.studentName }, { h: 'Proc.', get: (r) => r.studentProcNumber },
      { h: 'Classe', get: (r) => r.grade }, { h: 'Turma', get: (r) => r.className }, { h: 'Turno', get: (r) => r.shift },
      { h: 'Tipo', get: (r) => lab(r.tipo) }, { h: 'Data', get: (r) => dt(r.dataMatricula) },
      { h: 'Matrícula (Kz)', get: (r) => n(r.valorMatriculaKz), kz: true, align: 'right' },
      { h: 'Propina (Kz)', get: (r) => n(r.valorPropinaKz), kz: true, align: 'right' },
      { h: 'Estado', get: (r) => lab(r.estado) },
    ],
  },
  {
    id: 'alunos', group: G_SEC, label: 'Alunos', icon: 'person_add', sec: 'alunos',
    rows: (db) => sortBy(arr<any>(db.students), (s) => s.name || ''),
    cols: [
      { h: 'Proc.', get: (r) => r.procNumber }, { h: 'Nome', get: (r) => r.name }, { h: 'Sexo', get: (r) => r.gender },
      { h: 'Nascimento', get: (r) => dt(r.birthDate) }, { h: 'B.I.', get: (r) => r.biNumber || r.citizenCard },
      { h: 'Classe', get: (r) => r.grade }, { h: 'Turma', get: (r) => r.className }, { h: 'Curso', get: (r) => r.courseName },
      { h: 'Encarregado', get: (r) => r.guardianName }, { h: 'Contacto', get: (r) => r.guardianPhone || r.studentPhone },
      { h: 'Estado', get: (r) => lab(r.status) },
    ],
  },
  {
    id: 'vinculos', group: G_SEC, label: 'Vínculos de Filhos', icon: 'link', sec: 'vinculo_filhos',
    rows: (db) => arr(db.guardianLinks),
    cols: [
      { h: 'Encarregado', get: (r) => r.guardianName }, { h: 'E-mail', get: (r) => r.guardianEmail },
      { h: 'Aluno', get: (r) => r.studentName }, { h: 'Proc.', get: (r) => r.studentProcNumber },
      { h: 'Parentesco', get: (r) => lab(r.relation) }, { h: 'Resp. financeiro', get: (r) => yn(r.financialResponsible) },
      { h: 'Vinculado em', get: (r) => dt(r.linkedAt) }, { h: 'Estado', get: (r) => lab(r.status) },
    ],
  },
  {
    id: 'turmas', group: G_SEC, label: 'Turmas', icon: 'groups', sec: 'turmas',
    rows: (db) => sortBy(arr<any>(db.classes), (c) => c.name || ''),
    cols: [
      { h: 'Turma', get: (r) => r.name }, { h: 'Classe', get: (r) => r.grade }, { h: 'Ciclo', get: (r) => r.cycle },
      { h: 'Turno', get: (r) => r.shift }, { h: 'Sala', get: (r) => r.room },
      { h: 'Alunos', get: (r) => n(r.studentCount), num: true, align: 'center' },
      { h: 'Capacidade', get: (r) => n(r.maxCapacity), num: true, align: 'center' },
      { h: 'Diretor de turma', get: (r) => r.headTeacherName }, { h: 'Ano Letivo', get: (r) => r.academicYear },
    ],
  },
  {
    id: 'disciplinas', group: G_SEC, label: 'Disciplinas', icon: 'table_rows', sec: 'disciplinas',
    rows: (db) => sortBy(arr<any>(db.subjects), (s) => s.name || ''),
    cols: [
      { h: 'Código', get: (r) => r.code }, { h: 'Disciplina', get: (r) => r.name }, { h: 'Ciclo', get: (r) => r.cycle },
      { h: 'Área', get: (r) => r.area }, { h: 'Horas/semana', get: (r) => n(r.weeklyHours), num: true, align: 'center' },
      { h: 'Coordenador', get: (r) => r.coordinatorName }, { h: 'Estado', get: (r) => lab(r.status) },
    ],
  },
  {
    id: 'atribuicoes', group: G_SEC, label: 'Atribuição de Disciplinas', icon: 'assignment_ind', sec: 'atribuicao',
    rows: (db) => arr(db.subjectAssignments),
    cols: [
      { h: 'Ano Letivo', get: (r) => r.academicYear }, { h: 'Classe', get: (r) => r.grade }, { h: 'Curso', get: (r) => r.courseName },
      { h: 'Disciplina', get: (r) => r.subjectName }, { h: 'Professor', get: (r) => r.teacherName },
      { h: 'Turmas', get: (r, db) => arr<string>(r.classIds).map((id) => arr<any>(db.classes).find((c) => String(c.id) === String(id))?.name || id).join(', ') },
    ],
  },
  {
    id: 'cursos', group: G_SEC, label: 'Cursos', icon: 'school', sec: 'cursos',
    rows: (db) => arr(db.courses),
    cols: [
      { h: 'Código', get: (r) => r.code }, { h: 'Curso', get: (r) => r.name }, { h: 'Nível', get: (r) => lab(r.level) },
      { h: 'Ciclo', get: (r) => r.cycle }, { h: 'Duração (anos)', get: (r) => n(r.durationYears), num: true, align: 'center' },
      { h: 'Classes', get: (r) => join(r.grades) }, { h: 'Coordenador', get: (r) => r.coordinatorName }, { h: 'Estado', get: (r) => lab(r.status) },
    ],
  },
  {
    id: 'horarios', group: G_SEC, label: 'Horários', icon: 'calendar_month', sec: 'horarios',
    rows: (db) => arr(db.timetable),
    cols: [
      { h: 'Dia', get: (r) => r.dayOfWeek },
      { h: 'Turma', get: (r, db) => arr<any>(db.classes).find((c) => String(c.id) === String(r.classId))?.name || r.classId },
      { h: 'Início', get: (r) => r.timeStart }, { h: 'Fim', get: (r) => r.timeEnd },
      { h: 'Disciplina', get: (r) => r.subject }, { h: 'Professor', get: (r) => r.teacherName }, { h: 'Sala', get: (r) => r.room },
    ],
  },
  {
    id: 'departamentos', group: G_SEC, label: 'Departamentos', icon: 'account_tree', sec: 'departamentos',
    rows: (db) => arr(db.departments),
    cols: [
      { h: 'Código', get: (r) => r.code }, { h: 'Departamento', get: (r) => r.name }, { h: 'Tipo', get: (r) => lab(r.kind) },
      { h: 'Descrição', get: (r) => r.description }, { h: 'Estado', get: (r) => lab(r.status) },
    ],
  },
  {
    id: 'calendario', group: G_SEC, label: 'Calendário Escolar', icon: 'event', sec: 'calendario_escolar',
    rows: (db) => sortBy(arr<any>(db.events), (e) => String(e.date || '')),
    cols: [
      { h: 'Data', get: (r) => dt(r.date) }, { h: 'Hora', get: (r) => r.time }, { h: 'Evento', get: (r) => r.title },
      { h: 'Categoria', get: (r) => lab(r.category) }, { h: 'Descrição', get: (r) => r.description },
    ],
  },
  {
    id: 'transferencias', group: G_SEC, label: 'Transferências', icon: 'swap_horiz', sec: 'transferencias',
    rows: (db) => arr(db.studentTransfers),
    cols: [
      { h: 'Código', get: (r) => r.code }, { h: 'Tipo', get: (r) => lab(r.kind) }, { h: 'Aluno', get: (r) => r.studentName },
      { h: 'Proc.', get: (r) => r.studentProcNumber }, { h: 'Data', get: (r) => dt(r.date) },
      { h: 'Outra escola', get: (r) => r.otherSchool }, { h: 'Motivo', get: (r) => r.reason }, { h: 'Estado', get: (r) => lab(r.status) },
    ],
  },

  /* ---------------- Pedagógico ---------------- */
  {
    id: 'assiduidade', group: G_PED, label: 'Histórico de Assiduidade', icon: 'event_available', sec: 'assiduidade',
    rows: (db) => sortBy(arr<any>(db.attendanceSheets), (a) => String(a.date || '')).reverse(),
    cols: [
      { h: 'Data', get: (r) => dt(r.date) }, { h: 'Turma', get: (r) => r.className }, { h: 'Disciplina', get: (r) => r.subjectName },
      { h: 'Professor', get: (r) => r.teacherName }, { h: 'Horário', get: (r) => r.timeSlot },
      { h: 'Alunos', get: (r) => arr(r.students).length, num: true, align: 'center' },
      { h: 'Presenças', get: (r) => arr<any>(r.students).filter((s) => /pres/i.test(String(s.status))).length, num: true, align: 'center' },
      { h: 'Faltas', get: (r) => arr<any>(r.students).filter((s) => /falt|aus/i.test(String(s.status))).length, num: true, align: 'center' },
      { h: 'Estado', get: (r) => lab(r.status) },
    ],
  },
  {
    id: 'evasao_risco', group: G_PED, label: 'Evasão Escolar — Alunos em Risco', icon: 'person_off', sec: 'evasao_escolar',
    rows: (db) => {
      const t = resolveDropoutThresholds(db.settings?.dropoutThresholds);
      return computeDropoutRisk({
        students: arr<any>(db.students), attendanceSheets: arr<any>(db.attendanceSheets), invoices: arr<any>(db.invoices),
        followUps: arr<any>(db.dropoutFollowUps), thresholds: t,
      })
        .filter((r) => !(r.level === 'baixo' && !r.lastFollowUp))
        .map((r) => ({ ...r, _stale: t.staleDays }));
    },
    cols: [
      { h: 'Aluno', get: (r) => r.name }, { h: 'Turma', get: (r) => r.className },
      { h: 'Risco', get: (r) => DROPOUT_LEVEL_META[r.level as 'alto' | 'medio' | 'baixo'].label },
      { h: 'Pontos', get: (r) => n(r.score), num: true, align: 'center' },
      { h: 'Motivos', get: (r) => join(r.reasons, '; ') },
      { h: 'Presença (%)', get: (r) => (r.attendanceRate === null ? '' : n(r.attendanceRate)), align: 'center' },
      { h: 'Média', get: (r) => (r.average === null ? '' : n(r.average)), align: 'center' },
      { h: 'Propinas em atraso', get: (r) => n(r.lateInvoices), num: true, align: 'center' },
      { h: 'Encarregado', get: (r) => r.guardianName }, { h: 'Contacto', get: (r) => r.guardianPhone },
      { h: 'Estado do caso', get: (r) => (r.caseStatus ? lab(r.caseStatus) : 'Sem acompanhamento') },
      { h: 'Alerta', get: (r) => (r.alert && !CLOSED_STATUSES.includes(r.caseStatus) ? dropoutAlertLabel(r.alert, r._stale) : '') },
    ],
  },
  {
    id: 'evasao_acompanhamentos', group: G_PED, label: 'Evasão Escolar — Acompanhamentos', icon: 'support_agent', sec: 'evasao_escolar',
    rows: (db) => sortBy(arr<any>(db.dropoutFollowUps), (f) => String(f.date || '')).reverse(),
    cols: [
      { h: 'Data', get: (r) => dt(r.date) }, { h: 'Aluno', get: (r) => r.studentName }, { h: 'Turma', get: (r) => r.className },
      { h: 'Tipo', get: (r) => lab(r.kind) }, { h: 'Nota', get: (r) => r.note }, { h: 'Resultado', get: (r) => r.outcome },
      { h: 'Próxima ação', get: (r) => dt(r.nextActionDate) }, { h: 'Estado do caso', get: (r) => lab(r.caseStatus) },
      { h: 'Registado por', get: (r) => r.createdBy },
    ],
  },
  {
    id: 'banco_questoes', group: G_PED, label: 'Banco de Questões', icon: 'quiz', sec: 'banco_questoes',
    rows: (db) => arr(db.questions),
    cols: [
      { h: 'Código', get: (r) => r.code }, { h: 'Disciplina', get: (r) => r.subjectName }, { h: 'Classe', get: (r) => r.grade },
      { h: 'Tema', get: (r) => r.topic }, { h: 'Tipo', get: (r) => lab(r.type) }, { h: 'Dificuldade', get: (r) => lab(r.difficulty) },
      { h: 'Pontos', get: (r) => n(r.defaultPoints), num: true, align: 'center' }, { h: 'Autor', get: (r) => r.authorName },
      { h: 'Estado', get: (r) => lab(r.status) },
    ],
  },
  {
    id: 'provas', group: G_PED, label: 'Provas', icon: 'description', sec: 'banco_questoes',
    rows: (db) => arr(db.examPapers),
    cols: [
      { h: 'Código', get: (r) => r.code }, { h: 'Título', get: (r) => r.title }, { h: 'Tipo', get: (r) => lab(r.type) },
      { h: 'Disciplina', get: (r) => r.subjectName }, { h: 'Classe', get: (r) => r.grade }, { h: 'Ano Letivo', get: (r) => r.academicYear },
      { h: 'Trimestre', get: (r) => r.trimester }, { h: 'Data', get: (r) => dt(r.examDate) },
      { h: 'Duração (min)', get: (r) => n(r.durationMinutes), num: true, align: 'center' },
      { h: 'Pontos', get: (r) => n(r.targetPoints), num: true, align: 'center' }, { h: 'Estado', get: (r) => lab(r.status) },
    ],
  },
  {
    id: 'plano_curricular', group: G_PED, label: 'Plano Curricular', icon: 'menu_book', sec: 'plano_curricular',
    rows: (db) => arr(db.curriculumPlans),
    cols: [
      { h: 'Código', get: (r) => r.code }, { h: 'Ano Letivo', get: (r) => r.academicYear }, { h: 'Disciplina', get: (r) => r.subjectName },
      { h: 'Classe', get: (r) => r.grade }, { h: 'Horas/semana', get: (r) => n(r.weeklyHours), num: true, align: 'center' },
      { h: 'Unidades', get: (r) => arr(r.units).length, num: true, align: 'center' }, { h: 'Autor', get: (r) => r.authorName },
      { h: 'Estado', get: (r) => lab(r.status) },
    ],
  },
  {
    id: 'extracurriculares', group: G_PED, label: 'Extracurriculares', icon: 'sports_soccer', sec: 'atividades_extracurriculares',
    rows: (db) => arr(db.extracurricularActivities),
    cols: [
      { h: 'Código', get: (r) => r.code }, { h: 'Atividade', get: (r) => r.name }, { h: 'Categoria', get: (r) => lab(r.category) },
      { h: 'Coordenador', get: (r) => r.coordinatorName }, { h: 'Local', get: (r) => r.venue },
      { h: 'Início', get: (r) => dt(r.startDate) }, { h: 'Fim', get: (r) => dt(r.endDate) },
      { h: 'Vagas', get: (r) => n(r.capacity), num: true, align: 'center' },
      { h: 'Inscritos', get: (r) => arr(r.enrollments).length, num: true, align: 'center' }, { h: 'Estado', get: (r) => lab(r.status) },
    ],
  },
  {
    id: 'plano_aulas', group: G_PED, label: 'Planos de Aulas', icon: 'event_note', sec: 'professor_plano_aulas',
    rows: (db) => arr(db.lessonPlans),
    cols: [
      { h: 'Ano Letivo', get: (r) => r.academicYear }, { h: 'Professor', get: (r) => r.teacherName }, { h: 'Turma', get: (r) => r.className },
      { h: 'Disciplina', get: (r) => r.subjectName }, { h: 'Trimestre', get: (r) => r.trimester }, { h: 'Semana', get: (r) => dt(r.weekStart) },
      { h: 'Tema', get: (r) => r.topic }, { h: 'Estado', get: (r) => lab(r.status) },
    ],
  },
  {
    id: 'sumarios', group: G_PED, label: 'Sumários', icon: 'edit_note', sec: 'professor_sumarios',
    rows: (db) => sortBy(arr<any>(db.lessonSummaries), (s) => String(s.date || '')).reverse(),
    cols: [
      { h: 'Data', get: (r) => dt(r.date) }, { h: 'Professor', get: (r) => r.teacherName }, { h: 'Turma', get: (r) => r.className },
      { h: 'Disciplina', get: (r) => r.subjectName }, { h: 'Aula n.º', get: (r) => n(r.lessonNumber), align: 'center' },
      { h: 'Tema', get: (r) => r.topic }, { h: 'Sumário', get: (r) => r.summary },
    ],
  },
  {
    id: 'materiais', group: G_PED, label: 'Materiais de Apoio', icon: 'folder_open', sec: 'professor_materiais',
    rows: (db) => arr(db.teachingMaterials),
    cols: [
      { h: 'Título', get: (r) => r.title }, { h: 'Professor', get: (r) => r.teacherName }, { h: 'Turma', get: (r) => r.className },
      { h: 'Disciplina', get: (r) => r.subjectName }, { h: 'Visível aos alunos', get: (r) => yn(r.visibleToStudents) },
      { h: 'Ligação', get: (r) => r.link }, { h: 'Criado em', get: (r) => dt(r.createdAt) },
    ],
  },
  {
    id: 'evolucao_academica', group: G_PED, label: 'Evolução Académica', icon: 'trending_up', sec: 'relatorios',
    rows: (db) =>
      sortBy(arr<any>(db.classes), (c) => c.name || '').map((c) => {
        const st = arr<any>(db.students).filter((s) => (s.classId && String(s.classId) === String(c.id)) || (!s.classId && s.className === c.name));
        const withAvg = st.filter((s) => n(s.currentAverage) > 0);
        const avg = withAvg.length ? withAvg.reduce((a, s) => a + n(s.currentAverage), 0) / withAvg.length : 0;
        const withAtt = st.filter((s) => n(s.attendanceRate) > 0);
        const att = withAtt.length ? withAtt.reduce((a, s) => a + n(s.attendanceRate), 0) / withAtt.length : 0;
        return {
          turma: c.name, classe: c.grade, alunos: st.length, media: Math.round(avg * 10) / 10,
          positivos: withAvg.filter((s) => n(s.currentAverage) >= 10).length,
          negativos: withAvg.filter((s) => n(s.currentAverage) < 10).length,
          assiduidade: Math.round(att * 10) / 10,
        };
      }),
    cols: [
      { h: 'Turma', get: (r) => r.turma }, { h: 'Classe', get: (r) => r.classe },
      { h: 'Alunos', get: (r) => r.alunos, num: true, align: 'center' },
      { h: 'Média (0–20)', get: (r) => r.media, align: 'center' },
      { h: 'Positivos', get: (r) => r.positivos, num: true, align: 'center' },
      { h: 'Negativos', get: (r) => r.negativos, num: true, align: 'center' },
      { h: 'Assiduidade (%)', get: (r) => r.assiduidade, align: 'center' },
    ],
  },

  /* ---------------- Recursos Humanos (tudo) ---------------- */
  {
    id: 'professores', group: G_RH, label: 'Professores', icon: 'school', sec: 'professores',
    rows: (db) => sortBy(arr<any>(db.teachers), (t) => t.name || ''),
    cols: [
      { h: 'N.º Agente', get: (r) => r.agentNumber }, { h: 'Nome', get: (r) => r.name }, { h: 'Departamento', get: (r) => r.department },
      { h: 'Grau', get: (r) => r.degree }, { h: 'Categoria', get: (r) => r.category }, { h: 'Admissão', get: (r) => dt(r.admissionDate) },
      { h: 'Horas/semana', get: (r) => n(r.weeklyHours), num: true, align: 'center' }, { h: 'Contacto', get: (r) => r.phone || r.email },
      { h: 'Estado', get: (r) => lab(r.status) },
    ],
  },
  {
    id: 'funcionarios', group: G_RH, label: 'Funcionários', icon: 'groups', sec: 'funcionarios',
    rows: (db) => sortBy(arr<any>(db.funcionarios), (t) => t.name || ''),
    cols: [
      { h: 'N.º', get: (r) => r.employeeNumber }, { h: 'Nome', get: (r) => r.name }, { h: 'Cargo', get: (r) => r.cargoOutroDescricao || lab(r.cargo) },
      { h: 'Departamento', get: (r) => r.department }, { h: 'Admissão', get: (r) => dt(r.admissionDate) },
      { h: 'Contacto', get: (r) => r.phone || r.email }, { h: 'Estado', get: (r) => lab(r.status) },
    ],
  },
  {
    id: 'folha', group: G_RH, label: 'Folha Salarial', icon: 'request_quote', sec: 'folha_pagamento',
    rows: (db) => arr(db.payrollRecords),
    cols: [
      { h: 'Mês', get: (r) => `${MONTHS[(n(r.referenceMonth) || 1) - 1] || r.referenceMonth}/${r.referenceYear}` },
      { h: 'Nome', get: (r) => r.personName }, { h: 'Cargo', get: (r) => r.personRole }, { h: 'Departamento', get: (r) => r.department },
      { h: 'Bruto (Kz)', get: (r) => n(r.grossSalaryKz), kz: true, align: 'right' },
      { h: 'INSS (Kz)', get: (r) => n(r.inssEmployeeKz), kz: true, align: 'right' },
      { h: 'IRT (Kz)', get: (r) => n(r.irtKz), kz: true, align: 'right' },
      { h: 'Líquido (Kz)', get: (r) => n(r.netSalaryKz), kz: true, align: 'right' },
      { h: 'Estado', get: (r) => lab(r.status) },
    ],
  },
  {
    id: 'ferias', group: G_RH, label: 'Férias e Licenças', icon: 'beach_access', sec: 'ferias_licencas',
    rows: (db) => arr(db.leaveRequests),
    cols: [
      { h: 'Nome', get: (r) => r.personName }, { h: 'Cargo', get: (r) => r.personRole }, { h: 'Tipo', get: (r) => r.typeDescription || lab(r.type) },
      { h: 'Início', get: (r) => dt(r.startDate) }, { h: 'Fim', get: (r) => dt(r.endDate) },
      { h: 'Dias úteis', get: (r) => n(r.workingDaysCount), num: true, align: 'center' }, { h: 'Estado', get: (r) => lab(r.status) },
    ],
  },
  {
    id: 'desempenho', group: G_RH, label: 'Desempenho Docente', icon: 'insights', sec: 'avaliacao_desempenho_docente',
    rows: (db) => arr(db.teacherEvaluations),
    cols: [
      { h: 'Professor', get: (r) => r.teacherName }, { h: 'Departamento', get: (r) => r.department }, { h: 'Ano Letivo', get: (r) => r.academicYear },
      { h: 'Período', get: (r) => r.period }, { h: 'Avaliador', get: (r) => r.evaluatorName }, { h: 'Data', get: (r) => dt(r.evaluationDate) },
      { h: 'Nota final', get: (r) => r.finalScore, align: 'center' }, { h: 'Classificação', get: (r) => lab(r.classification) },
      { h: 'Estado', get: (r) => lab(r.status) },
    ],
  },

  /* ---------------- Tesouraria (dados financeiros → regra propinas.reports) ---------------- */
  {
    id: 'pagamentos', group: G_TES, label: 'Pagamentos (Propinas)', icon: 'payments', sec: 'propinas',
    rows: (db) => sortBy(arr<any>(db.invoices), (i) => String(i.dueDate || '')),
    cols: [
      { h: 'Fatura', get: (r) => r.invoiceNumber }, { h: 'Recibo', get: (r) => r.receiptNumber }, { h: 'Aluno', get: (r) => r.studentName },
      { h: 'Turma', get: (r) => r.className }, { h: 'Período', get: (r) => r.period }, { h: 'Vencimento', get: (r) => dt(r.dueDate) },
      { h: 'Pago em', get: (r) => dt(r.paymentDate) }, { h: 'Método', get: (r) => r.methodLabel || lab(r.method) },
      { h: 'Total (Kz)', get: (r) => n(r.totalAmountKz), kz: true, align: 'right' }, { h: 'Estado', get: (r) => lab(r.status) },
    ],
  },
  {
    id: 'tabela_financeira', group: G_TES, label: 'Tabela Financeira (Serviços)', icon: 'request_quote', sec: 'propinas',
    rows: (db) => arr(db.services),
    cols: [
      { h: 'Código', get: (r) => r.code }, { h: 'Serviço', get: (r) => r.name }, { h: 'Categoria', get: (r) => lab(r.category) },
      { h: 'Descrição', get: (r) => r.description }, { h: 'Regime fiscal', get: (r) => r.taxRegime },
      { h: 'Preço (Kz)', get: (r) => n(r.defaultPriceKz), kz: true, align: 'right' }, { h: 'Ativo', get: (r) => yn(r.active) },
    ],
  },
  {
    id: 'bolsas_regras', group: G_TES, label: 'Bolsas e Descontos — Regras', icon: 'percent', sec: 'planos_descontos',
    rows: (db) => arr(db.discountRules),
    cols: [
      { h: 'Regra', get: (r) => r.label }, { h: 'Tipo', get: (r) => (r.kind === 'percent' ? 'Percentagem' : 'Valor fixo') },
      { h: 'Valor', get: (r) => (r.kind === 'percent' ? `${n(r.value)}%` : `${n(r.value).toLocaleString('pt-PT')} Kz`) },
      { h: 'A partir do irmão n.º', get: (r) => r.minSiblingPosition || '—', align: 'center' },
      { h: 'Pagar até ao dia', get: (r) => r.paidByDay || '—', align: 'center' },
      { h: 'Acumulável', get: (r) => yn(r.stackable) }, { h: 'Ativa', get: (r) => yn(r.active !== false) },
    ],
  },
  {
    id: 'bolsas_planos', group: G_TES, label: 'Planos de Pagamento', icon: 'event_repeat', sec: 'planos_descontos',
    rows: (db) => arr(db.paymentPlans),
    cols: [
      { h: 'Aluno', get: (r) => r.studentName }, { h: 'Ano Letivo', get: (r) => r.academicYear }, { h: 'Descrição', get: (r) => r.description },
      { h: 'Prestações', get: (r) => arr(r.installments).length, num: true, align: 'center' },
      { h: 'Total (Kz)', get: (r) => n(r.total), kz: true, align: 'right' }, { h: 'Estado', get: (r) => lab(r.status) },
    ],
  },
  {
    id: 'fluxo_caixa', group: G_TES, label: 'Fluxo de Caixa (Sessões)', icon: 'receipt_long', sec: 'contabilidade',
    rows: (db) => sortBy(arr<any>(db.cashSessions), (c) => String(c.openedAt || '')).reverse(),
    cols: [
      { h: 'Abertura', get: (r) => dt(r.openedAt) }, { h: 'Aberta por', get: (r) => r.openedBy }, { h: 'Fecho', get: (r) => dt(r.closedAt) },
      { h: 'Fechada por', get: (r) => r.closedBy },
      { h: 'Fundo inicial (Kz)', get: (r) => n(r.openingFloat), kz: true, align: 'right' },
      { h: 'Entradas (Kz)', get: (r) => n(r.totalIn), kz: true, align: 'right' },
      { h: 'Saídas (Kz)', get: (r) => n(r.cashOut), kz: true, align: 'right' },
      { h: 'Diferença (Kz)', get: (r) => n(r.difference), kz: true, align: 'right' }, { h: 'Estado', get: (r) => lab(r.status) },
    ],
  },
  {
    id: 'despesas', group: G_TES, label: 'Despesas', icon: 'outbox', sec: 'contabilidade',
    rows: (db) => sortBy(arr<any>(db.expenses), (e) => String(e.date || '')).reverse(),
    cols: [
      { h: 'Data', get: (r) => dt(r.date) }, { h: 'Fornecedor', get: (r) => r.supplier }, { h: 'Categoria', get: (r) => r.category },
      { h: 'Descrição', get: (r) => r.description }, { h: 'Vencimento', get: (r) => dt(r.dueDate) }, { h: 'Pago em', get: (r) => dt(r.paidDate) },
      { h: 'Valor (Kz)', get: (r) => n(r.amount), kz: true, align: 'right' },
    ],
  },
  {
    id: 'contab_balancete', group: G_TES, label: 'Contabilidade — Balancete de Verificação', icon: 'balance', sec: 'balancete_contabilistico',
    rows: (db) => computeTrialBalance(contabPostings(db)).rows,
    cols: [
      { h: 'Conta', get: (r) => r.account.code }, { h: 'Designação', get: (r) => r.account.name },
      { h: 'Débito (Kz)', get: (r) => n(r.debit), kz: true, align: 'right' }, { h: 'Crédito (Kz)', get: (r) => n(r.credit), kz: true, align: 'right' },
      { h: 'Saldo devedor (Kz)', get: (r) => n(r.balanceDebit), kz: true, align: 'right' }, { h: 'Saldo credor (Kz)', get: (r) => n(r.balanceCredit), kz: true, align: 'right' },
    ],
  },
  {
    id: 'contab_lancamentos', group: G_TES, label: 'Contabilidade — Lançamentos', icon: 'receipt', sec: 'balancete_contabilistico',
    rows: (db) => contabPostings(db),
    cols: [
      { h: 'Data', get: (r) => dt(r.date) }, { h: 'Descrição', get: (r) => r.description }, { h: 'Referência', get: (r) => r.reference },
      { h: 'Contas a débito', get: (r) => join(arr<any>(r.lines).filter((l) => l.debit > 0).map((l) => l.account)) },
      { h: 'Contas a crédito', get: (r) => join(arr<any>(r.lines).filter((l) => l.credit > 0).map((l) => l.account)) },
      { h: 'Origem', get: (r) => ({ auto: 'Automático', manual: 'Manual', amortizacao: 'Amortização', fecho: 'Fecho do ano' } as Record<string, string>)[r.source] || r.source },
      { h: 'Valor (Kz)', get: (r) => arr<any>(r.lines).reduce((t, l) => t + (Number(l.debit) || 0), 0), kz: true, align: 'right' },
    ],
  },
  {
    id: 'evolucao_financeira', group: G_TES, label: 'Evolução Financeira', icon: 'show_chart', sec: 'propinas',
    rows: (db) => {
      const map = new Map<string, { faturado: number; cobrado: number; divida: number; faturas: number }>();
      const slot = (k: string) => {
        if (!map.has(k)) map.set(k, { faturado: 0, cobrado: 0, divida: 0, faturas: 0 });
        return map.get(k)!;
      };
      for (const i of arr<any>(db.invoices)) {
        const due = String(i.dueDate || '').slice(0, 7);
        if (due) {
          const s = slot(due);
          s.faturado += n(i.totalAmountKz);
          s.faturas += 1;
          if (i.status !== 'pago') s.divida += n(i.totalAmountKz);
        }
        const paid = String(i.paymentDate || '').slice(0, 7);
        if (i.status === 'pago' && paid) slot(paid).cobrado += n(i.totalPaidKz || i.totalAmountKz);
      }
      return [...map.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => ({ mes: k, ...v }));
    },
    cols: [
      { h: 'Mês', get: (r) => { const [y, m] = String(r.mes).split('-'); return `${MONTHS[Number(m) - 1] || m}/${y}`; } },
      { h: 'Faturas', get: (r) => r.faturas, num: true, align: 'center' },
      { h: 'Faturado (Kz)', get: (r) => r.faturado, kz: true, align: 'right' },
      { h: 'Cobrado (Kz)', get: (r) => r.cobrado, kz: true, align: 'right' },
      { h: 'Em dívida (Kz)', get: (r) => r.divida, kz: true, align: 'right' },
    ],
  },

  /* ---------------- Logística ---------------- */
  {
    id: 'fornecedores', group: G_LOG, label: 'Fornecedores', icon: 'local_shipping', sec: 'fornecedores',
    rows: (db) => sortBy(arr<any>(db.suppliers), (s) => s.name || ''),
    cols: [
      { h: 'Código', get: (r) => r.code }, { h: 'Fornecedor', get: (r) => r.name }, { h: 'NIF', get: (r) => r.nif },
      { h: 'Categoria', get: (r) => lab(r.category) }, { h: 'Contacto', get: (r) => r.contactPerson }, { h: 'Telefone', get: (r) => r.phone },
      { h: 'E-mail', get: (r) => r.email }, { h: 'Província', get: (r) => r.province }, { h: 'Estado', get: (r) => lab(r.status) },
    ],
  },
  {
    id: 'inventario', group: G_LOG, label: 'Inventário de Ativos', icon: 'inventory_2', sec: 'inventario_ativos',
    rows: (db) => arr(db.assets),
    cols: [
      { h: 'Código', get: (r) => r.code }, { h: 'Ativo', get: (r) => r.name }, { h: 'Categoria', get: (r) => lab(r.category) },
      { h: 'Local', get: (r) => r.location }, { h: 'Responsável', get: (r) => r.responsibleName }, { h: 'Aquisição', get: (r) => dt(r.acquisitionDate) },
      { h: 'Valor (Kz)', get: (r) => n(r.acquisitionValueKz), kz: true, align: 'right' },
      { h: 'Condição', get: (r) => lab(r.condition) }, { h: 'Estado', get: (r) => lab(r.status) },
    ],
  },
  {
    id: 'stock_itens', group: G_LOG, label: 'Stock — Itens', icon: 'warehouse', sec: 'controlo_estoque',
    rows: (db) => sortBy(arr<any>(db.stockItems), (s) => s.name || ''),
    cols: [
      { h: 'Código', get: (r) => r.code }, { h: 'Item', get: (r) => r.name }, { h: 'Categoria', get: (r) => r.category },
      { h: 'Unidade', get: (r) => r.unitOtherDescricao || lab(r.unit) },
      { h: 'Quantidade', get: (r) => n(r.currentQuantity), num: true, align: 'center' },
      { h: 'Mínimo', get: (r) => n(r.minQuantity), num: true, align: 'center' }, { h: 'Local', get: (r) => r.location },
      { h: 'Fornecedor', get: (r) => r.supplierName },
    ],
  },
  {
    id: 'stock_mov', group: G_LOG, label: 'Stock — Movimentações (entradas e saídas)', icon: 'swap_vert', sec: 'controlo_estoque',
    rows: (db) => sortBy(arr<any>(db.stockMovements), (m) => String(m.date || '')).reverse(),
    cols: [
      { h: 'Data', get: (r) => dt(r.date) }, { h: 'Item', get: (r) => r.itemName }, { h: 'Tipo', get: (r) => lab(r.type) },
      { h: 'Quantidade', get: (r) => n(r.quantity), num: true, align: 'center' }, { h: 'Motivo', get: (r) => r.reason },
      { h: 'Documento', get: (r) => r.relatedDocument }, { h: 'Responsável', get: (r) => r.performedByName },
    ],
  },
  {
    id: 'transp_rotas', group: G_LOG, label: 'Transporte — Rotas', icon: 'route', sec: 'transporte_escolar',
    rows: (db) => arr(db.transportRoutes),
    cols: [
      { h: 'Código', get: (r) => r.code }, { h: 'Rota', get: (r) => r.name }, { h: 'Viatura', get: (r) => r.vehicleName }, { h: 'Turno', get: (r) => lab(r.shift) },
      { h: 'Paragens', get: (r) => arr(r.stops).map((s: any) => s.name).join(' → ') },
      { h: 'Passageiros', get: (r) => arr(r.studentIds).length + arr(r.teacherIds).length + arr(r.funcionarioIds).length, num: true, align: 'center' },
      { h: 'Mensalidade (Kz)', get: (r) => n(r.monthlyFeeKz), kz: true, align: 'right' }, { h: 'Estado', get: (r) => lab(r.status) },
    ],
  },
  {
    id: 'transp_viaturas', group: G_LOG, label: 'Transporte — Viaturas', icon: 'directions_bus', sec: 'transporte_escolar',
    rows: (db) => arr(db.vehicles),
    cols: [
      { h: 'Código', get: (r) => r.code }, { h: 'Matrícula', get: (r) => r.plate }, { h: 'Modelo', get: (r) => r.model },
      { h: 'Lotação', get: (r) => n(r.capacity), num: true, align: 'center' }, { h: 'Motorista', get: (r) => r.driverName },
      { h: 'Telefone', get: (r) => r.driverPhone }, { h: 'Carta n.º', get: (r) => r.driverLicenseNumber }, { h: 'Estado', get: (r) => lab(r.status) },
    ],
  },
  {
    id: 'ref_inscricoes', group: G_LOG, label: 'Refeitório — Inscrições', icon: 'restaurant', sec: 'refeitorio',
    rows: (db) => arr(db.canteenSubscriptions),
    cols: [
      { h: 'Código', get: (r) => r.code }, { h: 'Aluno', get: (r) => r.studentName }, { h: 'Proc.', get: (r) => r.studentProcNumber },
      { h: 'Turma', get: (r) => r.className }, { h: 'Refeições', get: (r) => arr<string>(r.meals).map(lab).join(', ') },
      { h: 'Início', get: (r) => dt(r.startDate) }, { h: 'Fim', get: (r) => dt(r.endDate) },
      { h: 'Alergias', get: (r) => join(r.allergies) }, { h: 'Estado', get: (r) => lab(r.status) },
    ],
  },
  {
    id: 'ref_servicos', group: G_LOG, label: 'Refeitório — Registos de Serviço', icon: 'room_service', sec: 'refeitorio',
    rows: (db) => sortBy(arr<any>(db.canteenServices), (s) => String(s.date || '')).reverse(),
    cols: [
      { h: 'Data', get: (r) => dt(r.date) }, { h: 'Refeição', get: (r) => lab(r.mealType) },
      { h: 'Servidas', get: (r) => arr<any>(r.entries).filter((e) => e.status === 'servida').length, num: true, align: 'center' },
      { h: 'Ausentes', get: (r) => arr<any>(r.entries).filter((e) => e.status === 'ausente').length, num: true, align: 'center' },
      { h: 'Extras', get: (r) => arr<any>(r.entries).filter((e) => e.extra).length, num: true, align: 'center' },
      { h: 'Registado por', get: (r) => r.createdBy },
    ],
  },

  /* ---------------- Saúde & Segurança ---------------- */
  {
    id: 'ficha_medica', group: G_SAU, label: 'Fichas Médicas', icon: 'medical_information', sec: 'saude_ficha_medica',
    rows: (db) => arr(db.medicalRecords),
    cols: [
      { h: 'Código', get: (r) => r.code }, { h: 'Aluno', get: (r) => r.studentName }, { h: 'Proc.', get: (r) => r.studentProcNumber },
      { h: 'Turma', get: (r) => r.className }, { h: 'Grupo sanguíneo', get: (r) => r.bloodType },
      { h: 'Alergias', get: (r) => arr<any>(r.allergies).map((a) => a.substance).join(', ') },
      { h: 'Condições', get: (r) => arr<any>(r.conditions).map((c) => c.name).join(', ') },
      { h: 'Vacinação', get: (r) => lab(r.vaccinationStatus) }, { h: 'Médico', get: (r) => r.physicianName },
    ],
  },
  {
    id: 'incidentes', group: G_SAU, label: 'Incidentes', icon: 'report', sec: 'saude_incidentes',
    rows: (db) => sortBy(arr<any>(db.disciplinaryIncidents), (i) => String(i.date || '')).reverse(),
    cols: [
      { h: 'Código', get: (r) => r.code }, { h: 'Data', get: (r) => dt(r.date) }, { h: 'Local', get: (r) => r.location },
      { h: 'Categoria', get: (r) => r.categoryOther || lab(r.category) }, { h: 'Gravidade', get: (r) => lab(r.severity) },
      { h: 'Envolvidos', get: (r) => arr<any>(r.participants).map((p) => p.studentName).join(', ') },
      { h: 'Descrição', get: (r) => r.description }, { h: 'Estado', get: (r) => lab(r.status) },
    ],
  },
  {
    id: 'autorizacoes', group: G_SAU, label: 'Autorizações e Restrições', icon: 'badge', sec: 'saude_recolha',
    rows: (db) => arr(db.pickupAuthorizations),
    cols: [
      { h: 'Código', get: (r) => r.code }, { h: 'Aluno', get: (r) => r.studentName }, { h: 'Turma', get: (r) => r.className },
      { h: 'Tipo', get: (r) => lab(r.kind) }, { h: 'Pessoa', get: (r) => r.personName }, { h: 'Parentesco', get: (r) => r.relationOther || lab(r.relation) },
      { h: 'Telefone', get: (r) => r.phone }, { h: 'Válida de', get: (r) => dt(r.validFrom) }, { h: 'Até', get: (r) => dt(r.validUntil) },
      { h: 'Estado', get: (r) => lab(r.status) },
    ],
  },
  {
    id: 'saidas', group: G_SAU, label: 'Registos de Saídas', icon: 'logout', sec: 'saude_recolha',
    rows: (db) => sortBy(arr<any>(db.pickupRecords), (r) => `${r.date || ''} ${r.time || ''}`).reverse(),
    cols: [
      { h: 'Data', get: (r) => dt(r.date) }, { h: 'Hora', get: (r) => r.time }, { h: 'Aluno', get: (r) => r.studentName },
      { h: 'Turma', get: (r) => r.className }, { h: 'Recolhido por', get: (r) => r.personName }, { h: 'Parentesco', get: (r) => r.personRelation },
      { h: 'Motivo', get: (r) => r.reasonOther || lab(r.reason) }, { h: 'Resultado', get: (r) => lab(r.outcome) },
      { h: 'Registado por', get: (r) => r.registeredBy },
    ],
  },

  /* ---------------- Comunicação ---------------- */
  {
    id: 'avisos', group: G_COM, label: 'Avisos', icon: 'campaign', sec: 'mural_biblioteca',
    rows: (db) => sortBy(arr<any>(db.notices), (a) => String(a.date || '')).reverse(),
    cols: [
      { h: 'Data', get: (r) => dt(r.date) }, { h: 'Título', get: (r) => r.title }, { h: 'Autor', get: (r) => r.author },
      { h: 'Prioridade', get: (r) => lab(r.priority) }, { h: 'Destinatários', get: (r) => arr<string>(r.targetRoles).map(lab).join(', ') },
      { h: 'Leituras', get: (r) => n(r.readsCount), num: true, align: 'center' },
    ],
  },
  {
    id: 'acervo', group: G_COM, label: 'Acervo da Biblioteca', icon: 'menu_book', sec: 'mural_biblioteca',
    rows: (db) => sortBy(arr<any>(db.books), (b) => b.title || ''),
    cols: [
      { h: 'Título', get: (r) => r.title }, { h: 'Autor', get: (r) => r.author }, { h: 'ISBN', get: (r) => r.isbn },
      { h: 'Categoria', get: (r) => r.category }, { h: 'Estante', get: (r) => r.shelfLocation },
      { h: 'Exemplares', get: (r) => n(r.totalCopies), num: true, align: 'center' },
      { h: 'Disponíveis', get: (r) => n(r.availableCopies), num: true, align: 'center' },
    ],
  },
  {
    id: 'emprestimos', group: G_COM, label: 'Empréstimos', icon: 'local_library', sec: 'biblioteca_emprestimos',
    rows: (db) => sortBy(arr<any>(db.loans), (l) => String(l.borrowDate || '')).reverse(),
    cols: [
      { h: 'Livro', get: (r) => r.bookTitle }, { h: 'Leitor', get: (r) => r.borrowerName }, { h: 'Perfil', get: (r) => lab(r.borrowerRole) },
      { h: 'Empréstimo', get: (r) => dt(r.borrowDate) }, { h: 'Prazo', get: (r) => dt(r.dueDate) }, { h: 'Devolução', get: (r) => dt(r.returnDate) },
      { h: 'Renovações', get: (r) => n(r.renewals), num: true, align: 'center' }, { h: 'Estado', get: (r) => lab(r.status) },
    ],
  },
  {
    id: 'multas', group: G_COM, label: 'Multas da Biblioteca', icon: 'gavel', sec: 'biblioteca_emprestimos',
    rows: (db) => arr<any>(db.loans).filter((l) => n(l.fineAmount) > 0),
    cols: [
      { h: 'Livro', get: (r) => r.bookTitle }, { h: 'Leitor', get: (r) => r.borrowerName }, { h: 'Prazo', get: (r) => dt(r.dueDate) },
      { h: 'Devolução', get: (r) => dt(r.returnDate) }, { h: 'Multa (Kz)', get: (r) => n(r.fineAmount), kz: true, align: 'right' },
      { h: 'Paga', get: (r) => yn(r.finePaid) }, { h: 'Pagamento', get: (r) => dt(r.finePaidAt) }, { h: 'Isenção', get: (r) => r.fineWaivedReason },
    ],
  },
  {
    id: 'notificacoes', group: G_COM, label: 'Notificações (SMS / WhatsApp)', icon: 'sms', sec: 'comunicacao_notificacoes',
    rows: (db) => sortBy(arr<any>(db.smsWhatsappNotifications), (x) => String(x.createdAt || '')).reverse(),
    cols: [
      { h: 'Código', get: (r) => r.code }, { h: 'Canal', get: (r) => lab(r.channel) }, { h: 'Título', get: (r) => r.title },
      { h: 'Público', get: (r) => r.className || lab(r.audienceType) }, { h: 'Criada em', get: (r) => dt(r.createdAt) },
      { h: 'Enviadas', get: (r) => n(r.sentCount), num: true, align: 'center' }, { h: 'Falhadas', get: (r) => n(r.failedCount), num: true, align: 'center' },
      { h: 'Estado', get: (r) => lab(r.status) },
    ],
  },
  {
    id: 'reunioes', group: G_COM, label: 'Reuniões', icon: 'groups_2', sec: 'comunicacao_reunioes',
    rows: (db) => sortBy(arr<any>(db.parentTeacherMeetings), (m) => String(m.date || '')).reverse(),
    cols: [
      { h: 'Código', get: (r) => r.code }, { h: 'Data', get: (r) => dt(r.date) }, { h: 'Hora', get: (r) => r.startTime },
      { h: 'Tipo', get: (r) => lab(r.type) }, { h: 'Título', get: (r) => r.title }, { h: 'Turma', get: (r) => r.className },
      { h: 'Professor', get: (r) => r.teacherName }, { h: 'Local', get: (r) => r.location },
      { h: 'Participantes', get: (r) => arr(r.participants).length, num: true, align: 'center' }, { h: 'Estado', get: (r) => lab(r.status) },
    ],
  },

  /* ---------------- Administração ---------------- */
  {
    id: 'utilizadores', group: G_ADM, label: 'Utilizadores', icon: 'group_add', sec: 'configuracoes/utilizadores',
    rows: (db) => sortBy(arr<any>(db.users), (u) => u.name || ''),
    cols: [
      { h: 'Nome', get: (r) => r.name }, { h: 'Utilizador', get: (r) => r.username }, { h: 'E-mail', get: (r) => r.email },
      { h: 'Perfil', get: (r) => r.roleTitle || lab(r.role) }, { h: 'Telefone', get: (r) => r.phone },
    ],
  },
  {
    id: 'titulares', group: G_ADM, label: 'Pedidos de Titulares de Dados', icon: 'policy', sec: 'configuracoes/protecao-dados',
    rows: (db) => arr(db.dataSubjectRequests),
    cols: [
      { h: 'Código', get: (r) => r.code }, { h: 'Pedido em', get: (r) => dt(r.requestedAt) }, { h: 'Requerente', get: (r) => r.requesterName },
      { h: 'Qualidade', get: (r) => lab(r.requesterRelation) }, { h: 'Aluno', get: (r) => r.studentName }, { h: 'Tipo', get: (r) => lab(r.type) },
      { h: 'Resolvido em', get: (r) => dt(r.resolvedAt) }, { h: 'Estado', get: (r) => lab(r.status) },
    ],
  },
];

/** Listagens financeiras: além do acesso à secção, exigem a regra 'propinas.reports'. */
export const FINANCE_RULE = 'propinas.reports';
const FINANCE_IDS = new Set([
  'pagamentos', 'tabela_financeira', 'bolsas_regras', 'bolsas_planos', 'fluxo_caixa', 'despesas', 'evolucao_financeira',
]);

export const LISTAGENS: ListDef[] = BASE.map((l) => (FINANCE_IDS.has(l.id) ? { ...l, rule: FINANCE_RULE } : l));

export const LISTAGEM_GROUPS: string[] = Array.from(new Set(LISTAGENS.map((l) => l.group)));

/** Listagens que o utilizador pode abrir: acesso à secção do menu E, se houver, à regra extra. */
export function visibleListagens(
  can: (sectionId: string) => boolean,
  canRule: (rule: string) => boolean = () => true
): ListDef[] {
  return LISTAGENS.filter((l) => can(l.sec) && (!l.rule || canRule(l.rule)));
}

/** Filtra as linhas (já convertidas em texto) pela pesquisa, em todas as células. */
export function filterRows(rows: string[][], query: string): number[] {
  const q = query.trim().toLowerCase();
  const idx: number[] = [];
  rows.forEach((r, i) => {
    if (!q || r.some((c) => c.toLowerCase().includes(q))) idx.push(i);
  });
  return idx;
}

/** Linha de TOTAL: soma das colunas `kz`/`num`; null se não houver nenhuma. */
export function totalsRow(cols: ListCol[], rawRows: Cell[][]): Cell[] | null {
  if (!cols.some((c) => c.kz || c.num)) return null;
  let labelled = false;
  return cols.map((c, ci) => {
    if (c.kz || c.num) return rawRows.reduce((a, r) => a + (typeof r[ci] === 'number' ? (r[ci] as number) : 0), 0);
    if (!labelled) {
      labelled = true;
      return `TOTAL (${rawRows.length})`;
    }
    return '';
  });
}
