import { SchoolDatabase, Student, Matricula, TuitionInvoice, DisciplinaryIncident } from '../types';
import { getStudentRecordsForYear, getLiveGradesYear } from './studentGrades';

/** Converte "dd/mm/aaaa" ou "aaaa-mm-dd" numa Date; null se não reconhecer o formato. */
function parseInvoiceDate(value?: string): Date | null {
  if (!value) return null;
  const iso = value.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return new Date(Number(iso[1]), Number(iso[2]) - 1, Number(iso[3]));
  const br = value.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (br) return new Date(Number(br[3]), Number(br[2]) - 1, Number(br[1]));
  return null;
}

/** Intervalo de datas [1 Set do ano de início, 31 Ago do ano seguinte] de um Ano Lectivo "2026/2027". */
function academicYearRange(academicYear: string): { start: Date; end: Date } | null {
  const [startStr, endStr] = (academicYear || '').split('/');
  const start = Number(startStr);
  const end = Number(endStr);
  if (!start || !end) return null;
  return { start: new Date(start, 8, 1), end: new Date(end, 7, 31, 23, 59, 59) };
}

/** Todas as faturas (studentId) que realmente pertencem a esta Matrícula/Ano Lectivo:
 * as geradas diretamente por ela (`generatedInvoiceIds`) mais quaisquer outras faturas
 * do aluno cuja data (pagamento ou vencimento) caia dentro do período do ano lectivo —
 * nunca se adivinha pelo texto da descrição. */
export function getStudentYearInvoices(
  db: SchoolDatabase,
  studentId: string,
  matricula: Matricula
): TuitionInvoice[] {
  const all = [...(db.invoices || []), ...(db.tuitionFees || [])] as TuitionInvoice[];
  const seen = new Set<string>();
  const generatedIds = new Set(matricula.generatedInvoiceIds || []);
  const range = academicYearRange(matricula.academicYear);

  const list: TuitionInvoice[] = [];
  for (const inv of all) {
    if (String(inv.studentId) !== String(studentId)) continue;
    const key = String(inv.id || inv.invoiceNumber);
    if (seen.has(key)) continue;

    if (generatedIds.has(inv.id)) {
      seen.add(key);
      list.push(inv);
      continue;
    }

    if (range) {
      const d = parseInvoiceDate(inv.paymentDate) || parseInvoiceDate(inv.dueDate);
      if (d && d >= range.start && d <= range.end) {
        seen.add(key);
        list.push(inv);
      }
    }
  }
  return list;
}

export interface FinancialLine {
  label: string;
  totalKz: number;
  invoice: TuitionInvoice;
}

export interface StudentYearFinancialReport {
  mesesPagos: FinancialLine[];
  totalMesesPagosKz: number;
  mesesNaoPagos: FinancialLine[];
  totalMesesNaoPagosKz: number;
  multasPagas: FinancialLine[];
  totalMultasPagasKz: number;
  multasNaoPagas: FinancialLine[];
  totalMultasNaoPagasKz: number;
  outrosPagos: FinancialLine[];
  totalOutrosPagosKz: number;
  outrosNaoPagos: FinancialLine[];
  totalOutrosNaoPagosKz: number;
  taxaMatricula?: FinancialLine & { paga: boolean };
  numeroFaturasEmitidas: number;
}

/** Relatório financeiro real da Matrícula (ano lectivo): meses de propina pagos/não pagos,
 * multas pagas/não pagas, outros serviços/emolumentos pagos/não pagos — tudo a partir das
 * faturas efetivamente gravadas para esta matrícula, nunca de valores fixos. */
export function getStudentYearFinancialReport(
  db: SchoolDatabase,
  studentId: string,
  matricula: Matricula
): StudentYearFinancialReport {
  const invoices = getStudentYearInvoices(db, studentId, matricula);

  const report: StudentYearFinancialReport = {
    mesesPagos: [],
    totalMesesPagosKz: 0,
    mesesNaoPagos: [],
    totalMesesNaoPagosKz: 0,
    multasPagas: [],
    totalMultasPagasKz: 0,
    multasNaoPagas: [],
    totalMultasNaoPagasKz: 0,
    outrosPagos: [],
    totalOutrosPagosKz: 0,
    outrosNaoPagos: [],
    totalOutrosNaoPagosKz: 0,
    numeroFaturasEmitidas: invoices.length
  };

  for (const inv of invoices) {
    const desc = inv.description || '';
    const isPago = inv.status === 'pago';
    const multaKz = Number(inv.lateFeeKz) || 0;
    const baseKz = Math.max(0, (Number(inv.totalAmountKz) || 0) - multaKz);

    // Multa por atraso, quando presente nesta fatura, conta-se sempre à parte.
    if (multaKz > 0) {
      const line: FinancialLine = { label: `Multa por atraso — ${inv.period || desc}`, totalKz: multaKz, invoice: inv };
      if (isPago) {
        report.multasPagas.push(line);
        report.totalMultasPagasKz += multaKz;
      } else {
        report.multasNaoPagas.push(line);
        report.totalMultasNaoPagasKz += multaKz;
      }
    }

    if (/taxa\s+de\s+matr[ií]cula/i.test(desc)) {
      report.taxaMatricula = { label: desc, totalKz: baseKz, invoice: inv, paga: isPago };
      continue;
    }

    const line: FinancialLine = { label: inv.period || desc, totalKz: baseKz, invoice: inv };

    if (/propina/i.test(desc)) {
      if (isPago) {
        report.mesesPagos.push(line);
        report.totalMesesPagosKz += baseKz;
      } else {
        report.mesesNaoPagos.push(line);
        report.totalMesesNaoPagosKz += baseKz;
      }
      continue;
    }

    // Tudo o resto: outros serviços/emolumentos (carteira, certificados, etc.)
    const outrosLine: FinancialLine = { label: desc || 'Serviço', totalKz: baseKz, invoice: inv };
    if (isPago) {
      report.outrosPagos.push(outrosLine);
      report.totalOutrosPagosKz += baseKz;
    } else {
      report.outrosNaoPagos.push(outrosLine);
      report.totalOutrosNaoPagosKz += baseKz;
    }
  }

  return report;
}

export interface DisciplinaAssiduidade {
  subjectId: string;
  subjectName: string;
  teacherName?: string;
  presencas: number;
  faltasJustificadas: number;
  faltasInjustificadas: number;
}

/** Assiduidade real do aluno nesta Matrícula, por disciplina — construída a partir das
 * cadernetas (AttendanceSheet) da turma desse ano lectivo, nunca de contadores fixos. */
export function getStudentYearAttendanceBySubject(
  db: SchoolDatabase,
  studentId: string,
  matricula: Matricula
): DisciplinaAssiduidade[] {
  const sheets = (db.attendanceSheets || []).filter((s) => String(s.classId) === String(matricula.classId));
  const bySubject = new Map<string, DisciplinaAssiduidade>();

  for (const sheet of sheets) {
    const rec = (sheet.students || []).find((st) => String(st.studentId) === String(studentId));
    if (!rec) continue;
    const key = String(sheet.subjectId || sheet.subjectName);
    if (!bySubject.has(key)) {
      bySubject.set(key, {
        subjectId: key,
        subjectName: sheet.subjectName,
        teacherName: sheet.teacherName,
        presencas: 0,
        faltasJustificadas: 0,
        faltasInjustificadas: 0
      });
    }
    const entry = bySubject.get(key)!;
    if (!entry.teacherName && sheet.teacherName) entry.teacherName = sheet.teacherName;
    if (rec.status === 'P' || rec.status === 'A') entry.presencas += 1;
    else if (rec.status === 'FJ') entry.faltasJustificadas += 1;
    else if (rec.status === 'FI') entry.faltasInjustificadas += 1;
  }

  return Array.from(bySubject.values()).sort((a, b) => a.subjectName.localeCompare(b.subjectName));
}

/** Incidentes disciplinares reais em que o aluno participou, registados nesse Ano Lectivo. */
export function getStudentYearIncidents(
  db: SchoolDatabase,
  studentId: string,
  matricula: Matricula
): DisciplinaryIncident[] {
  return (db.disciplinaryIncidents || []).filter(
    (inc) =>
      inc.academicYear === matricula.academicYear &&
      (inc.participants || []).some((p) => String(p.studentId) === String(studentId))
  );
}

export interface StudentYearAcademicReport {
  disciplinas: ReturnType<typeof getStudentRecordsForYear>;
  situacaoGeral: 'Aprovado' | 'Não Aprovado' | 'Exame de Recurso' | 'Em Curso' | 'Sem Notas';
  assiduidade: DisciplinaAssiduidade[];
  incidentes: DisciplinaryIncident[];
  numeroFaturasEmitidas: number;
}

/** Relatório académico real da Matrícula: disciplinas/notas por trimestre (do ano "vivo" ou
 * do arquivo, conforme o ano seja o corrente ou não), assiduidade por disciplina, professores
 * por disciplina e incidentes disciplinares desse ano — tudo lido dos registos reais. */
export function getStudentYearAcademicReport(
  db: SchoolDatabase,
  student: Student,
  matricula: Matricula
): StudentYearAcademicReport {
  const currentAcademicYear = db.settings?.currentAcademicYear || getLiveGradesYear(student, matricula.academicYear);
  const disciplinas = getStudentRecordsForYear(student, matricula.academicYear, currentAcademicYear);

  let situacaoGeral: StudentYearAcademicReport['situacaoGeral'] = 'Sem Notas';
  if (disciplinas.length > 0) {
    const isLive = matricula.academicYear === getLiveGradesYear(student, currentAcademicYear);
    if (disciplinas.some((d) => d.situation === 'Não Aprovado')) situacaoGeral = 'Não Aprovado';
    else if (disciplinas.some((d) => d.situation === 'Exame de Recurso')) situacaoGeral = 'Exame de Recurso';
    else if (disciplinas.every((d) => d.situation === 'Aprovado')) situacaoGeral = 'Aprovado';
    else situacaoGeral = isLive ? 'Em Curso' : 'Sem Notas';
  }

  const assiduidade = getStudentYearAttendanceBySubject(db, student.id, matricula);
  const incidentes = getStudentYearIncidents(db, student.id, matricula);
  const numeroFaturasEmitidas = getStudentYearInvoices(db, student.id, matricula).length;

  return { disciplinas, situacaoGeral, assiduidade, incidentes, numeroFaturasEmitidas };
}
