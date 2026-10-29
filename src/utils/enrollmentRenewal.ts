/**
 * Renovação anual de matrícula (Janeiro): do resultado do conselho de turma à matrícula do ano seguinte.
 *
 * Para cada aluno que tinha matrícula no ano lectivo anterior, decide (sem gravar nada):
 *  - aprovado            → matricula na classe seguinte;
 *  - reprovado           → repete a mesma classe;
 *  - condicional         → só depois da recuperação: aprovada em tudo promove, reprovada em alguma repete;
 *                          com recuperação por concluir fica bloqueado;
 *  - última classe (13.ª) aprovada → conclui o ciclo (não se matricula).
 * Escolhe a turma de destino (mesma secção e turno, depois a que tiver vaga) e respeita a lotação.
 * Dívidas de propinas em mora avisam ou bloqueiam, conforme a política da escola.
 * Sem decisão homologada o aluno fica bloqueado; a secretaria pode decidir manualmente (fica registado).
 * Lógica pura e testável: o `db.ts` só fornece os dados e grava o resultado.
 */
import type { ClassRoom, Matricula, Student, TuitionInvoice } from '../types';
import type { ClassCouncilRecord, RecoveryRecord } from '../types/processos';
import { indexInvoicesByStudent, isInvoiceInMora, localISODate } from './financialSituation';

/** Última classe do ensino geral: aprovado nela, conclui o ciclo. */
export const FINAL_GRADE_NUMBER = 13;

export type RenewalAction = 'promover' | 'repetir' | 'concluir';
export type RenewalStatus = 'pronto' | 'aviso' | 'bloqueado' | 'feito';
export type RenewalReasonCode =
  | 'sem-conselho' | 'conselho-nao-homologado' | 'sem-entrada-conselho' | 'recuperacao-pendente'
  | 'classe-sem-numero' | 'sem-turma' | 'turma-cheia' | 'sem-tabela-financeira' | 'divida' | 'ja-matriculado';
export type DebtPolicy = 'avisar' | 'bloquear';
export type ManualDecision = 'promover' | 'repetir';

export interface RenewalClassOption { id: string; name: string; free: number | null }

export interface RenewalRow {
  studentId: string;
  name: string;
  previousClassName: string;
  previousGrade: string;
  /** Decisão do conselho (ou 'manual' quando a secretaria decidiu sem conselho). */
  basis: 'aprovado' | 'reprovado' | 'condicional' | 'manual' | null;
  action: RenewalAction | null;
  targetGrade: string;
  targetClassId: string;
  targetClassName: string;
  status: RenewalStatus;
  /** Motivos que bloqueiam a renovação. */
  blockers: { code: RenewalReasonCode; text: string }[];
  /** Avisos que não bloqueiam. */
  warnings: string[];
  debtKz: number;
  /** Turmas do ano de destino que servem este aluno (para a secretaria trocar). */
  classOptions: RenewalClassOption[];
  /** A decisão pode ser tomada à mão (falta conselho / recuperação). */
  canDecideManually: boolean;
  manual: boolean;
}

export interface RenewalPlan {
  rows: RenewalRow[];
  previousYear: string;
  targetYear: string;
  /** Turmas do ano anterior sem conselho homologado (explica os alunos bloqueados). */
  pendingCouncils: { classId: string; className: string; students: number }[];
  counts: { pronto: number; aviso: number; bloqueado: number; feito: number; concluem: number };
}

export interface RenewalInput {
  targetYear: string;
  students: Student[];
  matriculas: Matricula[];
  classes: ClassRoom[];
  classCouncils?: ClassCouncilRecord[];
  recoveryRecords?: RecoveryRecord[];
  invoices?: Pick<TuitionInvoice, 'studentId' | 'status' | 'dueDate' | 'totalAmountKz'>[];
  /** Verdadeiro quando há Tabela Financeira para a classe (nunca se inventam valores). */
  hasTuition: (grade: string) => boolean;
  debtPolicy?: DebtPolicy;
  todayISO?: string;
  /** Limita o plano a estes alunos (execução por fatias); as lotações contam as matrículas já gravadas. */
  onlyStudentIds?: string[];
  manualDecisions?: Record<string, ManualDecision>;
  /** Turma de destino escolhida à mão, por aluno. */
  classOverrides?: Record<string, string>;
}

/** "2026/2027" → "2025/2026"; '' se o formato não for reconhecido. */
export function previousAcademicYear(year: string): string {
  const m = /^(\d{4})\s*[/-]\s*(\d{4})$/.exec((year || '').trim());
  if (!m) return '';
  return `${Number(m[1]) - 1}/${Number(m[2]) - 1}`;
}

export function gradeNumber(grade?: string): number | null {
  const m = String(grade || '').match(/(\d+)/);
  return m ? parseInt(m[1], 10) : null;
}

const norm = (s?: string) => String(s || '').trim().toLowerCase();
const sectionOf = (c: ClassRoom) => norm(c.section);

function isActiveMatricula(m: Matricula) {
  return m.estado !== 'cancelada' && m.estado !== 'transferida';
}

/** Resultado do aluno depois da recuperação (decisão condicional). */
function resolveConditional(studentId: string, year: string, records: RecoveryRecord[]): 'aprovado' | 'reprovado' | 'pendente' | 'sem-registo' {
  const mine = records.filter((r) => r.academicYear === year && String(r.studentId) === String(studentId));
  if (mine.length === 0) return 'sem-registo';
  if (mine.some((r) => r.outcome === 'pendente')) return 'pendente';
  if (mine.some((r) => r.outcome === 'reprovado')) return 'reprovado';
  return 'aprovado';
}

export function planAnnualRenewal(input: RenewalInput): RenewalPlan {
  const targetYear = input.targetYear;
  const previousYear = previousAcademicYear(targetYear);
  const today = input.todayISO || localISODate();
  const policy: DebtPolicy = input.debtPolicy || 'avisar';
  const councils = input.classCouncils || [];
  const recoveries = input.recoveryRecords || [];
  const only = input.onlyStudentIds ? new Set(input.onlyStudentIds.map(String)) : null;
  const studentById = new Map(input.students.map((s) => [String(s.id), s] as const));
  const invoicesBy = indexInvoicesByStudent(input.invoices as any);

  // Lotação das turmas do ano de destino: matrículas já gravadas + as que este plano vai atribuindo.
  const targetClasses = input.classes.filter((c) => c.academicYear === targetYear);
  const used = new Map<string, number>();
  for (const m of input.matriculas) {
    if (m.academicYear !== targetYear || !isActiveMatricula(m)) continue;
    used.set(String(m.classId), (used.get(String(m.classId)) || 0) + 1);
  }
  const freeOf = (c: ClassRoom): number | null => (c.maxCapacity > 0 ? c.maxCapacity - (used.get(String(c.id)) || 0) : null);

  // Matrícula do ano anterior de cada aluno (a mais recente, se houver mais de uma).
  const prevByStudent = new Map<string, Matricula>();
  for (const m of input.matriculas) {
    if (m.academicYear !== previousYear || !isActiveMatricula(m)) continue;
    const k = String(m.studentId);
    const cur = prevByStudent.get(k);
    if (!cur || String(m.createdAt || '') > String(cur.createdAt || '')) prevByStudent.set(k, m);
  }
  const alreadyByStudent = new Map<string, Matricula>();
  for (const m of input.matriculas) {
    if (m.academicYear === targetYear && isActiveMatricula(m)) alreadyByStudent.set(String(m.studentId), m);
  }

  const councilFor = (classId: string) => councils.find((c) => c.academicYear === previousYear && String(c.classId) === String(classId));

  const candidates = [...prevByStudent.values()]
    .filter((m) => !only || only.has(String(m.studentId)))
    .filter((m) => {
      const st = studentById.get(String(m.studentId));
      return !!st && st.status !== 'transferred' && st.status !== 'suspended';
    })
    .sort((a, b) => (a.className || '').localeCompare(b.className || '', 'pt') || (a.studentName || '').localeCompare(b.studentName || '', 'pt'));

  const rows: RenewalRow[] = [];
  const pendingMap = new Map<string, { classId: string; className: string; students: number }>();
  let concluem = 0;

  for (const prev of candidates) {
    const st = studentById.get(String(prev.studentId))!;
    const id = String(st.id);
    const row: RenewalRow = {
      studentId: id, name: st.name, previousClassName: prev.className || '', previousGrade: prev.grade || '',
      basis: null, action: null, targetGrade: '', targetClassId: '', targetClassName: '',
      status: 'pronto', blockers: [], warnings: [], debtKz: 0, classOptions: [], canDecideManually: false, manual: false
    };
    const block = (code: RenewalReasonCode, text: string) => row.blockers.push({ code, text });

    const already = alreadyByStudent.get(id);
    if (already) {
      row.status = 'feito';
      row.targetGrade = already.grade; row.targetClassId = String(already.classId); row.targetClassName = already.className;
      row.blockers.push({ code: 'ja-matriculado', text: `Já matriculado em ${targetYear} (${already.numeroMatricula}).` });
      rows.push(row);
      continue;
    }

    // 1) Decisão: manual, ou conselho homologado (+ recuperação quando condicional).
    const manual = input.manualDecisions?.[id];
    const council = councilFor(prev.classId);
    const entry = council?.entries.find((e) => String(e.studentId) === id);
    let action: RenewalAction | null = null;
    if (manual) {
      row.basis = 'manual'; row.manual = true;
      action = manual === 'promover' ? 'promover' : 'repetir';
      row.warnings.push('Decisão tomada manualmente, sem conselho de turma homologado.');
    } else if (!council) {
      block('sem-conselho', `Não há conselho de turma de ${prev.className || 'a turma'} em ${previousYear}.`);
      row.canDecideManually = true;
    } else if (council.status !== 'homologado') {
      block('conselho-nao-homologado', `O conselho de ${prev.className || 'a turma'} ainda não foi homologado.`);
      row.canDecideManually = true;
    } else if (!entry) {
      block('sem-entrada-conselho', 'O aluno não consta do conselho de turma.');
      row.canDecideManually = true;
    } else if (entry.decision === 'aprovado') {
      row.basis = 'aprovado'; action = 'promover';
    } else if (entry.decision === 'reprovado') {
      row.basis = 'reprovado'; action = 'repetir';
    } else {
      row.basis = 'condicional';
      const r = resolveConditional(id, previousYear, recoveries);
      if (r === 'aprovado') { action = 'promover'; row.warnings.push('Aprovado após recuperação.'); }
      else if (r === 'reprovado') { action = 'repetir'; row.warnings.push('Reprovado na recuperação: repete a classe.'); }
      else {
        block('recuperacao-pendente', r === 'pendente' ? 'Recuperação por concluir.' : 'Decisão condicional sem processo de recuperação registado.');
        row.canDecideManually = true;
      }
    }
    if (!manual && (!council || council.status !== 'homologado')) {
      const k = String(prev.classId);
      const p = pendingMap.get(k) || { classId: k, className: prev.className || k, students: 0 };
      p.students += 1; pendingMap.set(k, p);
    }
    row.action = action;

    // 2) Classe de destino.
    let reserved = '';
    const n = gradeNumber(prev.grade);
    if (action && n === null) {
      block('classe-sem-numero', `A classe "${prev.grade}" não tem número: escolha a turma na matrícula individual.`);
      row.action = action = null;
    }
    if (action === 'promover' && n !== null && n >= FINAL_GRADE_NUMBER) {
      row.action = 'concluir';
      row.warnings.push('Concluiu a última classe: não se matricula.');
      concluem += 1;
      row.status = 'pronto';
      rows.push(row);
      continue;
    }

    if (action && n !== null) {
      const targetN = action === 'promover' ? n + 1 : n;
      const prevClass = input.classes.find((c) => String(c.id) === String(prev.classId));
      const area = norm(prevClass?.area || prev.courseName);
      let pool = targetClasses.filter((c) => gradeNumber(c.grade) === targetN);
      const sameArea = pool.filter((c) => !area || !c.area || norm(c.area) === area);
      pool = sameArea;
      const prevSection = prevClass ? sectionOf(prevClass) : '';
      const prevShift = prevClass ? norm(prevClass.shift) : norm(prev.shift);
      const score = (c: ClassRoom) => (sectionOf(c) === prevSection ? 0 : 2) + (norm(c.shift) === prevShift ? 0 : 1);
      pool = [...pool].sort((a, b) => score(a) - score(b) || a.name.localeCompare(b.name, 'pt'));
      row.classOptions = pool.map((c) => ({ id: String(c.id), name: c.name, free: freeOf(c) }));
      row.targetGrade = pool[0]?.grade || '';

      if (pool.length === 0) {
        const label = action === 'promover' ? `${targetN}.ª Classe` : (prev.grade || `${targetN}.ª Classe`);
        block('sem-turma', `Não existe turma de ${label}${area ? ` (${prevClass?.area || prev.courseName})` : ''} em ${targetYear}.`);
      } else {
        const override = input.classOverrides?.[id];
        const chosen = override ? pool.find((c) => String(c.id) === String(override)) : pool.find((c) => (freeOf(c) ?? 1) > 0);
        if (override && !chosen) {
          block('sem-turma', 'A turma escolhida não serve para esta classe.');
        } else if (!chosen) {
          block('turma-cheia', `Todas as turmas de ${pool[0].grade} em ${targetYear} estão cheias.`);
        } else if ((freeOf(chosen) ?? 1) <= 0) {
          block('turma-cheia', `A turma ${chosen.name} está cheia.`);
        } else {
          row.targetClassId = String(chosen.id); row.targetClassName = chosen.name; row.targetGrade = chosen.grade;
          if (!input.hasTuition(chosen.grade)) block('sem-tabela-financeira', `Falta a Tabela Financeira da classe "${chosen.grade}" (Configurações → Financeiro).`);
          else { reserved = String(chosen.id); used.set(reserved, (used.get(reserved) || 0) + 1); }
        }
      }
    }

    // 3) Dívidas em mora.
    const inv = invoicesBy.get(id) || [];
    const mora = inv.filter((i) => isInvoiceInMora(i as any, today));
    if (mora.length > 0) {
      row.debtKz = mora.reduce((s, i) => s + (Number((i as any).totalAmountKz) || 0), 0);
      const txt = `${mora.length} fatura(s) em mora (${row.debtKz.toLocaleString('pt-AO')} Kz).`;
      if (policy === 'bloquear') block('divida', txt); else row.warnings.push(txt);
    }

    row.status = row.blockers.length > 0 ? 'bloqueado' : row.warnings.length > 0 ? 'aviso' : 'pronto';
    // Bloqueado depois de reservar vaga (ex.: dívida): devolve a vaga, para não ocupar um lugar que não será usado.
    if (row.status === 'bloqueado' && reserved) used.set(reserved, (used.get(reserved) || 1) - 1);
    rows.push(row);
  }

  const counts = { pronto: 0, aviso: 0, bloqueado: 0, feito: 0, concluem };
  for (const r of rows) {
    if (r.action === 'concluir') continue;
    counts[r.status] += 1;
  }
  return { rows, previousYear, targetYear, pendingCouncils: [...pendingMap.values()], counts };
}
