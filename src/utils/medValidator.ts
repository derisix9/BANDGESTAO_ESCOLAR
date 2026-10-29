/**
 * VALIDADOR DA EXPORTAÇÃO PARA O MED (GEPE)
 * =========================================
 * Corre ANTES de gerar o ficheiro e devolve a lista de problemas por escola,
 * turma, aluno e docente, para a secretaria os corrigir em vez de o GEPE
 * recusar o ficheiro.
 *
 * ATENÇÃO — o que isto NÃO é: o MED não publica um esquema oficial do ficheiro
 * nem uma API de submissão (o SIGE é recolhido por canais próprios do
 * Ministério). Por isso este validador confere a CONSISTÊNCIA INTERNA dos dados
 * que alimentam as 4 folhas que o sistema já exporta (campos obrigatórios,
 * formatos, duplicados, totais que não batem, idades implausíveis). Quando o
 * Ministério fornecer o modelo oficial, acrescentam-se as regras em RULES sem
 * mexer na interface.
 *
 * Gravidade: 'erro' = o dado está em falta ou é impossível (bloqueia a
 * confiança no ficheiro); 'aviso' = suspeito, mas pode ser legítimo.
 */

import type { ClassRoom, SchoolDatabase, Student, Teacher } from '../types';
import type { MedExportData, MedPeriod } from './medExport';
import { ANGOLA_DIVISIONS } from '../data/angolaDivisions';
import { academicYearStart } from './academicYear';

export type MedSeverity = 'erro' | 'aviso';
export type MedEntityType = 'escola' | 'turma' | 'aluno' | 'docente' | 'folha';

export interface MedIssue {
  severity: MedSeverity;
  /** Folha do ficheiro MED afectada (1–4). */
  sheet: 1 | 2 | 3 | 4;
  entityType: MedEntityType;
  entityId: string;
  entityName: string;
  /** Contexto curto: turma do aluno, departamento do docente… */
  context?: string;
  field: string;
  code: string;
  message: string;
}

export interface MedValidationResult {
  issues: MedIssue[];
  errors: number;
  warnings: number;
  /** Estatística rápida para o painel. */
  checked: { alunos: number; turmas: number; docentes: number };
  ok: boolean;
}

export interface MedEntityGroup {
  key: string;
  entityType: MedEntityType;
  entityId: string;
  entityName: string;
  context?: string;
  issues: MedIssue[];
  errors: number;
}

// ---------------------------------------------------------------------------
// Formatos
// ---------------------------------------------------------------------------

const VALID_SHIFTS = ['Manhã', 'Tarde', 'Integral', 'Pós-Laboral', 'Noite'];
const VALID_NATURES = ['Pública', 'Privada', 'Comparticipada'];
/** Telemóvel angolano: 9 dígitos começados por 9, com ou sem +244 / 244. */
const PHONE_AO = /^(?:\+?244)?9\d{8}$/;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
/** BI angolano: 9 dígitos + 2 letras + 3 dígitos (ex.: 004567890LA041). */
const BI_AO = /^\d{9}[A-Za-z]{2}\d{3}$/;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** Idade completa em `reference`; null se a data não existir no calendário. (Igual a `ageOn` de admissions.ts, sem arrastar dependências.) */
function ageOn(iso: string, reference: Date): number | null {
  if (!ISO_DATE.test(iso)) return null;
  const [y, m, d] = iso.split('-').map(Number);
  const birth = new Date(y, m - 1, d);
  if (Number.isNaN(birth.getTime()) || birth.getMonth() !== m - 1 || birth.getDate() !== d) return null;
  let age = reference.getFullYear() - y;
  if (reference.getMonth() < m - 1 || (reference.getMonth() === m - 1 && reference.getDate() < d)) age -= 1;
  return age;
}

const norm = (v?: string | null) =>
  String(v || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().toLowerCase();

const compact = (v?: string | null) => String(v || '').replace(/[\s-]/g, '');

export function isValidAngolanPhone(v?: string | null): boolean {
  return PHONE_AO.test(compact(v));
}

export function isValidBi(v?: string | null): boolean {
  return BI_AO.test(compact(v));
}

function gradeNumber(grade?: string): number | null {
  const m = String(grade || '').match(/(\d+)/);
  return m ? parseInt(m[1], 10) : null;
}

/** Idade "esperada" na classe: 1.ª classe aos 6 anos (Lei de Bases). Só 1.ª–13.ª. */
export function expectedAgeForGrade(grade?: string): number | null {
  const n = gradeNumber(grade);
  if (n === null || n < 1 || n > 13) return null;
  return n + 5;
}

function classOfStudent(classes: ClassRoom[], s: Student): ClassRoom | undefined {
  return (
    classes.find((c) => String(c.id) === String(s.classId)) ||
    classes.find((c) => c.name && c.name === s.className)
  );
}

// ---------------------------------------------------------------------------
// Validação
// ---------------------------------------------------------------------------

export function validateMedData(db: SchoolDatabase, period: MedPeriod, data: MedExportData): MedValidationResult {
  const issues: MedIssue[] = [];
  const add = (i: Omit<MedIssue, 'severity'> & { severity?: MedSeverity }) =>
    issues.push({ severity: 'erro', ...i });

  const st: any = db.settings || {};
  const classes = db.classes || [];
  const students = db.students || [];
  const teachers = db.teachers || [];

  // ---- Folha 1: escola -----------------------------------------------------
  const school = { entityType: 'escola' as const, entityId: 'escola', entityName: st.schoolName || 'Escola', sheet: 1 as const };
  const required: Array<[string, string, string]> = [
    ['codigo_med', st.medCode, 'Código MED da escola em falta'],
    ['nome_instituicao', st.schoolName, 'Nome da instituição em falta'],
    ['provincia', st.province, 'Província em falta'],
    ['municipio', st.municipality, 'Município em falta'],
    ['natureza_escola', st.schoolNature, 'Natureza da escola (Pública/Privada/Comparticipada) em falta'],
    ['diretor_geral', st.directorGeral, 'Nome do director em falta'],
    ['decreto_criacao', st.decreeAuthorization, 'Decreto/Diário da República de criação em falta']
  ];
  for (const [field, value, message] of required) {
    if (!String(value || '').trim()) add({ ...school, field, code: 'ESC_CAMPO_EM_FALTA', message });
  }
  for (const [field, value, message] of [
    ['comuna', st.commune, 'Comuna em falta'],
    ['bairro_localidade', st.bairro || st.address, 'Bairro/localidade em falta'],
    ['email_contacto', st.email, 'Email institucional em falta'],
    ['telefone_contacto', st.phone, 'Telefone da escola em falta']
  ] as Array<[string, string, string]>) {
    if (!String(value || '').trim()) add({ ...school, severity: 'aviso', field, code: 'ESC_CAMPO_EM_FALTA', message });
  }
  if (st.medCode && !/^[A-Za-z0-9][A-Za-z0-9\-_/.]{2,}$/.test(String(st.medCode).trim())) {
    add({ ...school, field: 'codigo_med', code: 'ESC_MED_FORMATO', message: 'O código MED só pode ter letras, números e - _ / . (mínimo 3 caracteres).' });
  }
  if (st.schoolNature && !VALID_NATURES.includes(st.schoolNature)) {
    add({ ...school, field: 'natureza_escola', code: 'ESC_NATUREZA', message: `Natureza "${st.schoolNature}" inválida. Use Pública, Privada ou Comparticipada.` });
  }
  if (st.province) {
    const prov = ANGOLA_DIVISIONS.find((p) => norm(p.name) === norm(st.province));
    if (!prov) {
      add({ ...school, field: 'provincia', code: 'ESC_PROVINCIA', message: `Província "${st.province}" não existe na divisão político-administrativa (Lei 14/24).` });
    } else if (st.municipality) {
      const mun = prov.municipalities.find((m) => norm(m.name) === norm(st.municipality));
      if (!mun) {
        add({ ...school, field: 'municipio', code: 'ESC_MUNICIPIO', message: `Município "${st.municipality}" não pertence à província ${prov.name}.` });
      } else if (st.commune && !mun.communes.some((c) => norm(c) === norm(st.commune))) {
        add({ ...school, severity: 'aviso', field: 'comuna', code: 'ESC_COMUNA', message: `Comuna "${st.commune}" não consta no município ${mun.name}.` });
      }
    }
  }
  if (st.phone && !isValidAngolanPhone(st.phone)) {
    add({ ...school, severity: 'aviso', field: 'telefone_contacto', code: 'ESC_TELEFONE', message: 'Telefone fora do formato angolano (9 dígitos começados por 9).' });
  }
  if (st.email && !EMAIL.test(String(st.email).trim())) {
    add({ ...school, field: 'email_contacto', code: 'ESC_EMAIL', message: 'Email institucional inválido.' });
  }

  // ---- Turmas --------------------------------------------------------------
  const studentsByClass = new Map<string, number>();
  for (const s of students) {
    const c = classOfStudent(classes, s);
    if (c) studentsByClass.set(String(c.id), (studentsByClass.get(String(c.id)) || 0) + 1);
  }
  for (const c of classes) {
    const base = { entityType: 'turma' as const, entityId: String(c.id), entityName: c.name || String(c.id), sheet: 3 as const };
    if (!String(c.grade || '').trim()) add({ ...base, sheet: 2, field: 'classe', code: 'TURMA_SEM_CLASSE', message: 'Turma sem classe definida: os alunos saem como "Por Classificar".' });
    if (!VALID_SHIFTS.includes(c.shift)) add({ ...base, field: 'turno', code: 'TURMA_TURNO', message: `Turno "${c.shift || ''}" inválido. Use ${VALID_SHIFTS.join(', ')}.` });
    const n = studentsByClass.get(String(c.id)) || 0;
    if (c.maxCapacity > 0 && n > c.maxCapacity) {
      add({ ...base, severity: 'aviso', sheet: 2, field: 'lotacao', code: 'TURMA_LOTACAO', message: `${n} alunos para uma lotação de ${c.maxCapacity}.` });
    }
  }

  // ---- Alunos (folha 2) ----------------------------------------------------
  const seenProc = new Map<string, Student>();
  const seenBi = new Map<string, Student>();
  // Mesma data de referência do censo que a folha 2 (31/12 do ano em que o ano lectivo começa).
  const startYear = academicYearStart(st.currentAcademicYear);
  const reference = Number.isFinite(startYear) ? new Date(startYear, 11, 31) : new Date();
  for (const s of students) {
    const cls = classOfStudent(classes, s);
    const base = {
      entityType: 'aluno' as const, entityId: String(s.id), entityName: s.name || String(s.id),
      context: cls?.name || s.className || undefined, sheet: 2 as const
    };
    if (!cls) {
      add({ ...base, severity: 'aviso', field: 'turma', code: 'ALUNO_SEM_TURMA', message: 'Aluno sem turma atribuída: não entra na Matrícula Inicial.' });
      continue;
    }
    if (s.status === 'transferred') {
      add({ ...base, severity: 'aviso', field: 'estado', code: 'ALUNO_TRANSFERIDO', message: 'Aluno transferido ainda conta na Matrícula Inicial desta turma.' });
    }
    if (!String(s.name || '').trim() || String(s.name).trim().split(/\s+/).length < 2) {
      add({ ...base, field: 'nome', code: 'ALUNO_NOME', message: 'Nome incompleto (indique pelo menos nome e apelido).' });
    }
    // Género: sem ele o sistema "adivinha" pelo nome, o que falseia as colunas M/F.
    if (!String(s.gender || '').trim()) {
      add({ ...base, field: 'genero', code: 'ALUNO_GENERO', message: 'Género não preenchido: o sistema adivinha pelo nome, o que pode falsear as colunas M/F.' });
    }
    // Data de nascimento e idade
    if (!s.birthDate) {
      add({ ...base, field: 'data_nascimento', code: 'ALUNO_NASC_EM_FALTA', message: 'Data de nascimento em falta: sai como "Idade Desconhecida".' });
    } else if (!ISO_DATE.test(s.birthDate) || ageOn(s.birthDate, reference) === null) {
      add({ ...base, field: 'data_nascimento', code: 'ALUNO_NASC_INVALIDA', message: `Data de nascimento "${s.birthDate}" inválida.` });
    } else {
      const age = ageOn(s.birthDate, reference)!;
      if (age < 3 || age > 60) {
        add({ ...base, field: 'data_nascimento', code: 'ALUNO_IDADE_IMPOSSIVEL', message: `Idade de ${age} anos é implausível para um aluno.` });
      } else {
        const exp = expectedAgeForGrade(cls.grade || s.grade);
        if (exp !== null && age - exp >= 4) {
          add({ ...base, severity: 'aviso', field: 'idade', code: 'ALUNO_DISTORCAO', message: `${age} anos na ${cls.grade} (esperado ~${exp}): distorção idade-classe de ${age - exp} anos. Confirme a data de nascimento.` });
        } else if (exp !== null && age - exp <= -2) {
          add({ ...base, severity: 'aviso', field: 'idade', code: 'ALUNO_IDADE_BAIXA', message: `${age} anos na ${cls.grade} (esperado ~${exp}): confirme a data de nascimento.` });
        }
      }
    }
    // Duplicados
    const proc = compact(s.procNumber);
    if (proc) {
      const prev = seenProc.get(proc);
      if (prev) add({ ...base, field: 'n_processo', code: 'ALUNO_PROC_DUPLICADO', message: `Nº de processo ${s.procNumber} repetido (também em "${prev.name}").` });
      else seenProc.set(proc, s);
    }
    const bi = compact(s.biNumber).toUpperCase();
    if (bi) {
      if (!isValidBi(bi)) {
        add({ ...base, severity: 'aviso', field: 'bi', code: 'ALUNO_BI_FORMATO', message: `BI "${s.biNumber}" fora do formato (9 dígitos + 2 letras + 3 dígitos).` });
      }
      const prev = seenBi.get(bi);
      if (prev) add({ ...base, field: 'bi', code: 'ALUNO_BI_DUPLICADO', message: `BI ${s.biNumber} repetido (também em "${prev.name}").` });
      else seenBi.set(bi, s);
    }
  }

  // ---- Docentes (folha 4) --------------------------------------------------
  const seenAgent = new Map<string, Teacher>();
  const teacherRows = new Map(data.corpoDocente.map((r) => [r.nome, r]));
  for (const t of teachers) {
    const base = { entityType: 'docente' as const, entityId: String(t.id), entityName: t.name || String(t.id), context: t.department || undefined, sheet: 4 as const };
    if (!String(t.name || '').trim()) add({ ...base, field: 'nome', code: 'DOC_NOME', message: 'Nome do docente em falta.' });
    if (!String(t.agentNumber || '').trim()) {
      add({ ...base, severity: 'aviso', field: 'n_agente', code: 'DOC_AGENTE', message: 'Sem nº de agente: o ficheiro usa o ID interno.' });
    } else {
      const k = compact(t.agentNumber).toUpperCase();
      const prev = seenAgent.get(k);
      if (prev) add({ ...base, field: 'n_agente', code: 'DOC_AGENTE_DUPLICADO', message: `Nº de agente ${t.agentNumber} repetido (também em "${prev.name}").` });
      else seenAgent.set(k, t);
    }
    if (!String(t.gender || '').trim()) add({ ...base, field: 'genero', code: 'DOC_GENERO', message: 'Género do docente não preenchido.' });
    if (!String(t.degree || '').trim()) add({ ...base, field: 'habilitacoes', code: 'DOC_HABILITACOES', message: 'Habilitações literárias em falta (coluna obrigatória da folha 4).' });
    if (!String(t.department || '').trim()) add({ ...base, severity: 'aviso', field: 'especialidade', code: 'DOC_ESPECIALIDADE', message: 'Especialidade/departamento em falta.' });
    const row = teacherRows.get(t.name);
    if (t.status === 'ativo' && row && row.numTurmas === 0) {
      add({ ...base, severity: 'aviso', field: 'turmas', code: 'DOC_SEM_TURMAS', message: 'Docente activo sem turmas atribuídas.' });
    }
  }

  // ---- Folha 3: totais coerentes --------------------------------------------
  const matriculaPorClasse = new Map<string, number>();
  for (const r of data.matriculaInicial) {
    matriculaPorClasse.set(r.classe, (matriculaPorClasse.get(r.classe) || 0) + r.inscritosM + r.inscritosF);
  }
  const avalPorClasse = new Map<string, number>();
  data.aproveitamento.forEach((r, i) => {
    const name = `${r.classe} · ${r.curso} · ${r.turno}`;
    const base = { entityType: 'folha' as const, entityId: `aprov-${i}`, entityName: name, sheet: 3 as const };
    for (const [g, aval, aprov, reprov, desist] of [
      ['M', r.avalM, r.aprovM, r.reprovM, r.desistM],
      ['F', r.avalF, r.aprovF, r.reprovF, r.desistF]
    ] as Array<[string, number, number, number, number]>) {
      if (aprov + reprov > aval) {
        add({ ...base, field: `aprov_reprov_${g}`, code: 'APROV_SOMA', message: `Género ${g}: aprovados (${aprov}) + reprovados (${reprov}) excedem os avaliados (${aval}).` });
      }
      if ([aval, aprov, reprov, desist].some((n) => n < 0 || !Number.isFinite(n))) {
        add({ ...base, field: `valores_${g}`, code: 'APROV_NEGATIVO', message: `Género ${g}: há valores negativos ou inválidos.` });
      }
    }
    avalPorClasse.set(r.classe, (avalPorClasse.get(r.classe) || 0) + r.avalM + r.avalF);
  });
  for (const [classe, aval] of avalPorClasse) {
    const mat = matriculaPorClasse.get(classe) || 0;
    if (aval > mat) {
      add({ entityType: 'folha', entityId: `classe-${classe}`, entityName: classe, sheet: 3, field: 'avaliados', code: 'APROV_MAIOR_QUE_MATRICULA', message: `${aval} avaliados mas só ${mat} matriculados na ${classe}.` });
    }
  }
  if (period !== 'anual' && data.aproveitamento.length > 0 && data.aproveitamento.every((r) => r.avalM + r.avalF === 0)) {
    add({ entityType: 'folha', entityId: 'aprov-vazio', entityName: `${period}.º Trimestre`, sheet: 3, severity: 'aviso', field: 'avaliados', code: 'APROV_SEM_NOTAS', message: 'Nenhum aluno avaliado neste trimestre: confirme se as notas já foram lançadas.' });
  }
  if (data.matriculaInicial.length === 0) {
    add({ entityType: 'folha', entityId: 'matricula-vazia', entityName: 'Matrícula Inicial', sheet: 2, field: 'matricula', code: 'MATRICULA_VAZIA', message: 'Nenhum aluno com turma atribuída: a folha 2 sai vazia.' });
  }

  const errors = issues.filter((i) => i.severity === 'erro').length;
  return {
    issues,
    errors,
    warnings: issues.length - errors,
    checked: { alunos: students.length, turmas: classes.length, docentes: teachers.length },
    ok: errors === 0
  };
}

// ---------------------------------------------------------------------------
// Apresentação
// ---------------------------------------------------------------------------

/** Agrupa os problemas por entidade (um cartão por aluno/turma/docente), erros primeiro. */
export function groupIssuesByEntity(issues: MedIssue[]): MedEntityGroup[] {
  const map = new Map<string, MedEntityGroup>();
  for (const i of issues) {
    const key = `${i.entityType}:${i.entityId}`;
    let g = map.get(key);
    if (!g) {
      g = { key, entityType: i.entityType, entityId: i.entityId, entityName: i.entityName, context: i.context, issues: [], errors: 0 };
      map.set(key, g);
    }
    g.issues.push(i);
    if (i.severity === 'erro') g.errors += 1;
  }
  const order: Record<MedEntityType, number> = { escola: 0, turma: 1, folha: 2, docente: 3, aluno: 4 };
  return [...map.values()].sort(
    (a, b) => (b.errors > 0 ? 1 : 0) - (a.errors > 0 ? 1 : 0) || order[a.entityType] - order[b.entityType] || a.entityName.localeCompare(b.entityName, 'pt')
  );
}

const csvCell = (v: unknown) => `"${String(v ?? '').replace(/"/g, '""')}"`;

/** CSV (separador ";", como o resto do sistema) para a secretaria corrigir em lote. */
export function medIssuesToCsv(issues: MedIssue[]): string {
  const head = ['Gravidade', 'Folha', 'Tipo', 'Nome', 'Contexto', 'Campo', 'Código', 'Problema'];
  const rows = issues.map((i) => [i.severity, i.sheet, i.entityType, i.entityName, i.context || '', i.field, i.code, i.message]);
  return '\ufeff' + [head, ...rows].map((r) => r.map(csvCell).join(';')).join('\r\n');
}
