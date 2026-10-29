/**
 * SUPLEMENTO AO DIPLOMA (padrão MESCTI / Bolonha)
 * ===============================================
 * Documento que acompanha o diploma e detalha o percurso: UCs aprovadas por ano e semestre com ECTS e
 * classificação, estágios, TCC e classificação final. Função pura: recebe os dados e devolve o conteúdo,
 * para poder ser testada e impressa sem lógica na vista.
 */
import type {
  DiplomaSuperior,
  EstagioCurricular,
  InscricaoUC,
  MonografiaTCC,
  UnidadeCurricular
} from '../types/superior';
import { latestResultPerUC, qualitativeMentionMESCTI, NOTA_APROVACAO } from './superiorCalculations';

export interface SupplementRow {
  ucId: string;
  code: string;
  name: string;
  year: number;
  semester: number;
  creditsECTS: number;
  /** Nota final. Ausente em equivalências sem nota. */
  grade?: number;
  mention?: string;
  academicYear: string;
  /** Texto da origem: época de aprovação ou "Equivalência — instituição". */
  origem: string;
}

export interface SupplementYearGroup {
  year: number;
  rows: SupplementRow[];
  totalECTS: number;
}

export interface DiplomaSupplement {
  diplomaCode: string;
  registerNumber: string;
  studentName: string;
  studentProcNumber: string;
  courseName: string;
  degreeTitle: string;
  years: SupplementYearGroup[];
  totalECTS: number;
  estagios: Array<{ code: string; local: string; hours: number; grade?: number }>;
  tcc?: { theme: string; advisor: string; grade?: number; defenseDate?: string };
  finalGradeCurricular: number;
  finalCourseGrade: number;
  finalMention: string;
}

const EPOCA_LABEL: Record<string, string> = {
  dispensa: 'Dispensa de exame',
  normal: 'Exame normal',
  recurso: 'Recurso',
  especial: 'Época especial',
  frequencia: 'Frequência',
  equivalencia: 'Equivalência'
};

export function buildDiplomaSupplement(input: {
  diploma: DiplomaSuperior;
  inscricoes: InscricaoUC[];
  ucs?: UnidadeCurricular[];
  estagios?: EstagioCurricular[];
  tcc?: MonografiaTCC | null;
}): DiplomaSupplement {
  const { diploma } = input;
  const studentInscs = input.inscricoes.filter((i) => String(i.studentId) === String(diploma.studentId));
  const approved = latestResultPerUC(studentInscs).filter(
    (i) => i.status === 'aprovado' || (typeof i.notaFinal === 'number' && i.notaFinal >= NOTA_APROVACAO)
  );
  const ucById = new Map((input.ucs || []).map((u) => [String(u.id), u]));

  const rows: SupplementRow[] = approved.map((i) => {
    const catalog = ucById.get(String(i.ucId));
    const eq = i.equivalencia;
    const grade = typeof i.notaFinal === 'number' ? i.notaFinal : eq?.notaOrigem;
    return {
      ucId: String(i.ucId),
      code: i.ucCode || catalog?.code || '',
      name: i.ucName || catalog?.name || '',
      year: catalog?.year ?? i.year,
      semester: typeof catalog?.semester === 'number' ? catalog.semester : i.semester,
      creditsECTS: i.creditsECTS || catalog?.creditsECTS || 0,
      grade,
      mention: typeof grade === 'number' ? qualitativeMentionMESCTI(grade) : undefined,
      academicYear: i.academicYear,
      origem: eq ? `Equivalência — ${eq.instituicaoOrigem}` : EPOCA_LABEL[i.epocaAprovacao || ''] || ''
    };
  });
  rows.sort((a, b) => a.year - b.year || a.semester - b.semester || a.code.localeCompare(b.code));

  const years: SupplementYearGroup[] = [];
  for (const row of rows) {
    let g = years.find((y) => y.year === row.year);
    if (!g) {
      g = { year: row.year, rows: [], totalECTS: 0 };
      years.push(g);
    }
    g.rows.push(row);
    g.totalECTS += row.creditsECTS;
  }

  return {
    diplomaCode: diploma.code,
    registerNumber: diploma.registerNumber,
    studentName: diploma.studentName,
    studentProcNumber: diploma.studentProcNumber,
    courseName: diploma.courseName,
    degreeTitle: diploma.degreeTitle,
    years,
    totalECTS: rows.reduce((s, r) => s + r.creditsECTS, 0),
    estagios: (input.estagios || [])
      .filter((e) => String(e.studentId) === String(diploma.studentId))
      .map((e) => ({ code: e.code, local: e.institutionOrCompany, hours: e.completedHours, grade: e.finalGrade })),
    tcc: input.tcc
      ? { theme: input.tcc.theme, advisor: input.tcc.advisorName, grade: input.tcc.defenseGrade, defenseDate: input.tcc.defenseDate }
      : undefined,
    finalGradeCurricular: diploma.finalGradeCurricular,
    finalCourseGrade: diploma.finalCourseGrade,
    finalMention: diploma.finalMention
  };
}
