import { SchoolDatabase, Teacher } from '../types';
import { getTeacherCurricularDistribution } from './teacherSubjects';

/**
 * Indicadores de desempenho pedagógico de um professor, calculados exclusivamente
 * a partir de dados reais já existentes na base de dados (chamadas registadas,
 * pautas homologadas e notas realmente lançadas).
 *
 * Nenhum valor aqui é fixo, fictício ou de preenchimento: quando não existem
 * dados suficientes para calcular um indicador, o campo correspondente fica a
 * `null` (ou 0, no caso de contagens), para que a interface mostre "Sem dados"
 * em vez de um número inventado.
 */
export interface TeacherPerformanceMetrics {
  /** % de presenças registadas nas aulas deste professor (chamadas reais). */
  attendanceRatePercent: number | null;
  /** Nº de faltas injustificadas (FI) registadas nas chamadas deste professor. */
  unjustifiedAbsencesCount: number;
  /** % das turmas/disciplinas atribuídas cuja pauta já foi homologada. */
  timelyGradesPercent: number | null;
  /** Nº de alunos realmente matriculados nas turmas atribuídas a este professor. */
  studentsTutoredCount: number;
  /** Nº de turmas/disciplinas atribuídas a este professor. */
  allocatedClassesCount: number;
  /** % de notas finais (MFD) >= 10 valores, entre as notas reais lançadas. */
  averageApprovalRatePercent: number | null;
  /** Média real das notas finais (MFD) lançadas nas disciplinas deste professor. */
  averageDisciplineGrade: number | null;
}

function normalizeText(text?: string | null): string {
  return (text || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim();
}

export function computeTeacherPerformance(teacher: Teacher, db: SchoolDatabase): TeacherPerformanceMetrics {
  // A distribuição real (Turma + Disciplina + Carga) vem sempre da Grelha Horária
  // (db.timetable) — teacher.allocatedClasses pode ficar vazio/desatualizado quando a
  // alocação é feita diretamente em Turmas → Definir Horário. Mantém o campo antigo
  // apenas como recurso, para não perder dados manualmente preenchidos.
  const realDistribution = getTeacherCurricularDistribution(db, teacher);
  const allocations = realDistribution.length > 0 ? realDistribution : (teacher.allocatedClasses || []);
  const allocatedClassesCount = allocations.length;
  const teacherNameNorm = normalizeText(teacher.name);

  // ---------------------------------------------------------------------
  // 1. Alunos tutorados: alunos REALMENTE matriculados nas turmas atribuídas.
  // ---------------------------------------------------------------------
  const allocatedClassIds = new Set(allocations.map((a) => String(a.classId)).filter(Boolean));
  const allocatedClassNames = new Set(allocations.map((a) => normalizeText(a.className)).filter(Boolean));

  const tutoredStudentIds = new Set<string>();
  (db.students || []).forEach((s) => {
    const matchesId = s.classId != null && allocatedClassIds.has(String(s.classId));
    const matchesName = !!s.className && allocatedClassNames.has(normalizeText(s.className));
    if (matchesId || matchesName) tutoredStudentIds.add(String(s.id));
  });
  const studentsTutoredCount = tutoredStudentIds.size;

  // ---------------------------------------------------------------------
  // 2. Assiduidade: com base nas folhas de chamada que este professor
  //    efetivamente registou (db.attendanceSheets), nunca um valor fixo.
  // ---------------------------------------------------------------------
  const teacherSheets = (db.attendanceSheets || []).filter(
    (sheet) =>
      (!!sheet.teacherId && !!teacher.id && String(sheet.teacherId) === String(teacher.id)) ||
      (!!sheet.teacherName && normalizeText(sheet.teacherName) === teacherNameNorm)
  );

  let presences = 0;
  let totalRecords = 0;
  let unjustifiedAbsencesCount = 0;
  teacherSheets.forEach((sheet) => {
    (sheet.students || []).forEach((st) => {
      totalRecords += 1;
      if (st.status === 'P') presences += 1;
      if (st.status === 'FI') unjustifiedAbsencesCount += 1;
    });
  });
  const attendanceRatePercent = totalRecords > 0 ? Math.round((presences / totalRecords) * 1000) / 10 : null;

  // ---------------------------------------------------------------------
  // 3. Pautas a tempo: % das turmas/disciplinas atribuídas já homologadas
  //    (db.homologations), nunca "100%" por defeito.
  // ---------------------------------------------------------------------
  let timelyGradesPercent: number | null = null;
  if (allocatedClassesCount > 0) {
    const homologations = db.homologations || [];
    const homologatedPairs = allocations.filter((a) =>
      homologations.some(
        (h) =>
          String(h.classId) === String(a.classId) &&
          normalizeText(h.subjectName) === normalizeText(a.subject)
      )
    ).length;
    timelyGradesPercent = Math.round((homologatedPairs / allocatedClassesCount) * 1000) / 10;
  }

  // ---------------------------------------------------------------------
  // 4. Aproveitamento: média e taxa de aprovação REAIS das notas lançadas
  //    (mini-pautas ou notas trimestrais dos alunos) nas disciplinas do professor.
  // ---------------------------------------------------------------------
  const allGrades: number[] = [];
  allocations.forEach((a) => {
    const subject = (db.subjects || []).find(
      (s) => normalizeText(s.name) === normalizeText(a.subject) || normalizeText(s.code) === normalizeText(a.subject)
    );
    const subjectId = subject?.id;
    const classMiniPauta = subjectId ? db.miniPautasStore?.[String(a.classId)]?.[String(subjectId)] : null;

    if (classMiniPauta && classMiniPauta.length > 0) {
      classMiniPauta.forEach((row: any) => {
        if (typeof row?.mfd === 'number') allGrades.push(row.mfd);
      });
      return;
    }

    // Sem mini-pauta gravada: usa notas trimestrais reais já lançadas ao aluno, se existirem.
    (db.students || []).forEach((s) => {
      const matchesClass =
        (s.classId != null && String(s.classId) === String(a.classId)) ||
        (!!s.className && normalizeText(s.className) === normalizeText(a.className));
      if (!matchesClass) return;
      const tg = (s.trimesterGrades || []).find((t) => normalizeText(t.subjectName) === normalizeText(a.subject));
      if (tg && typeof tg.mfd === 'number') allGrades.push(tg.mfd);
    });
  });

  const averageDisciplineGrade =
    allGrades.length > 0 ? Math.round((allGrades.reduce((x, y) => x + y, 0) / allGrades.length) * 10) / 10 : null;
  const averageApprovalRatePercent =
    allGrades.length > 0
      ? Math.round((allGrades.filter((g) => g >= 10).length / allGrades.length) * 1000) / 10
      : null;

  return {
    attendanceRatePercent,
    unjustifiedAbsencesCount,
    timelyGradesPercent,
    studentsTutoredCount,
    allocatedClassesCount,
    averageApprovalRatePercent,
    averageDisciplineGrade
  };
}
