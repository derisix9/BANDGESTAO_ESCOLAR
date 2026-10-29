/**
 * Dados que alimentam os modelos (autopreenchimento). Tudo vem da base real: aluno, matrículas,
 * notas arquivadas por ano lectivo e definições da instituição. Nada é inventado: o que o sistema não
 * guarda (ex.: data de emissão do B.I., livro/folha de registo) fica em branco e editável no documento.
 */
import type { Funcionario, SchoolDatabase, Student, StudentTrimesterRecord, Teacher } from '../types';
import { getStudentAcademicYears, getStudentArchiveForYear, getStudentRecordsForYear, findMatriculaForYear } from '../utils/studentGrades';
import { getStudentsForClass } from '../utils/classStudentsRoster';
import { normalizeText } from '../utils/curriculum';
import { sortByName } from '../utils/alphabetical';
import { classNumber, dataCurta, dataPorExtenso, upper } from './format';

export interface StudioSchool {
  name: string;
  subTitle: string;
  decree: string;
  province: string;
  municipality: string;
  address: string;
  phone: string;
  email: string;
  logoUrl: string;
  /** Localidade que abre a data ("Malanje, 12 de …"). */
  city: string;
  directorName: string;
  directorPedagogicoName: string;
  secretariaName: string;
  currentYear: string;
}

export interface StudioPerson {
  id: string;
  name: string;
  father: string;
  mother: string;
  gender: 'M' | 'F';
  birthDateIso: string;
  birthDate: string; // 17/03/2011
  birthDateExt: string; // 17 de Março de 2011
  naturalidade: string;
  municipio: string;
  provincia: string;
  bi: string;
  biIssueDate: string;
  procNumber: string;
  photo: string;
  phone: string;
}

export interface StudioEnrollment {
  year: string;
  grade: string;
  classNum: number | null;
  turma: string;
  numero: string;
  periodo: string;
  curso: string;
  /** Descrição do curso (Secretaria Académica → Cursos). Só se aplica ao Ensino Médio (10.ª–13.ª). */
  cursoDescricao: string;
  cursoCodigo: string;
  /** Nº de matrícula do cartão: posição na pauta com 3 dígitos + ano lectivo, ex.: "012-2026/2027". */
  matricula: string;
  sala: string;
}

export interface GradeRow {
  subject: string;
  byClass: Record<number, number | undefined>;
  final?: number;
}

export interface HistoryEntry {
  year: string;
  grade: string;
  classNum: number | null;
  className: string;
  records: StudentTrimesterRecord[];
  finalAverage?: number;
  result: string;
}

export interface StudioData {
  school: StudioSchool;
  person: StudioPerson;
  enrollment: StudioEnrollment;
  history: HistoryEntry[];
  /** Notas finais por classe e disciplina, para tabelas de certificado/declaração. */
  rows: GradeRow[];
  /** Média final de cada classe (arredondada) — para a "Média Final" dos certificados. */
  averageByClass: Record<number, number | undefined>;
  generatedAt: string;
}

const finalOf = (r: StudentTrimesterRecord): number | undefined => {
  const v = typeof r.mf === 'number' && r.mf > 0 ? r.mf : r.mfd;
  return typeof v === 'number' && v > 0 ? Math.round(v) : undefined;
};

export function buildSchool(db: SchoolDatabase): StudioSchool {
  const s = db.settings || ({} as SchoolDatabase['settings']);
  return {
    name: s.schoolName || 'Instituição de Ensino',
    subTitle: s.subTitle || '',
    decree: s.decreeAuthorization || '',
    province: s.province || '',
    municipality: s.municipality || '',
    address: s.address || '',
    phone: s.phone || '',
    email: s.email || '',
    logoUrl: s.logoUrl || '',
    city: s.municipality || s.province || '',
    directorName: s.directorGeral || '',
    directorPedagogicoName: s.directorPedagogico || '',
    secretariaName: s.chefeSecretaria || '',
    currentYear: s.currentAcademicYear || ''
  };
}

export function buildPerson(student: Student): StudioPerson {
  const fil = student.filiation;
  const rel = String(student.guardianRelation || '').toLowerCase();
  const father = fil?.father?.name || (rel.startsWith('pai') ? student.guardianName : '') || '';
  const mother = fil?.mother?.name || (rel.startsWith('m') ? student.guardianName : '') || '';
  const g = String(student.gender || '').toUpperCase();
  return {
    id: String(student.id),
    name: student.name || '',
    father,
    mother,
    gender: g.startsWith('F') ? 'F' : 'M',
    birthDateIso: student.birthDate || '',
    birthDate: dataCurta(student.birthDate),
    birthDateExt: dataPorExtenso(student.birthDate),
    naturalidade: student.naturalidade || student.birthPlace || student.placeOfBirth || student.birthMunicipality || '',
    municipio: student.birthMunicipality || student.naturalidade || student.birthPlace || '',
    provincia: student.birthProvince || '',
    bi: student.biNumber || student.citizenCard || '',
    biIssueDate: '',
    procNumber: student.procNumber || '',
    photo: student.docPassPhoto || student.avatar || '',
    phone: student.studentPhone || student.guardianPhone || ''
  };
}

/** Todas as passagens do aluno por classes, uma por Ano Lectivo, do mais antigo ao mais recente. */
export function buildHistory(db: SchoolDatabase, student: Student): HistoryEntry[] {
  const cur = db.settings?.currentAcademicYear || '';
  const years = getStudentAcademicYears(student, db.matriculas, cur);
  const entries: HistoryEntry[] = years.map((year) => {
    const records = getStudentRecordsForYear(student, year, cur);
    const archive = getStudentArchiveForYear(student, year);
    const mat = findMatriculaForYear(db.matriculas, student.id, year);
    const live = (student.trimesterGradesYear || cur) === year;
    const grade = archive?.grade || mat?.grade || (live ? student.grade : '') || '';
    const className = archive?.className || mat?.className || (live ? student.className : '') || '';
    const finals = records.map(finalOf).filter((n): n is number => typeof n === 'number');
    const avg = finals.length ? Math.round(finals.reduce((a, b) => a + b, 0) / finals.length) : archive?.finalAverage;
    const neg = records.filter((r) => r.situation === 'Não Aprovado').length;
    const rec = records.some((r) => r.situation === 'Exame de Recurso');
    const result = !records.length ? '—' : neg > 0 ? 'Não Aprovado' : rec ? 'Exame de Recurso' : 'Aprovado';
    return { year, grade, classNum: classNumber(grade), className, records, finalAverage: avg, result };
  });
  return entries.filter((e) => e.records.length || e.grade).sort((a, b) => a.year.localeCompare(b.year));
}

export function buildRows(history: HistoryEntry[], student: Student): { rows: GradeRow[]; averageByClass: Record<number, number | undefined> } {
  const map = new Map<string, GradeRow>();
  const sums: Record<number, number[]> = {};
  const add = (name: string, cls: number, v: number) => {
    const key = normalizeText(name);
    let row = map.get(key);
    if (!row) { row = { subject: name, byClass: {} }; map.set(key, row); }
    row.byClass[cls] = v;
    (sums[cls] ||= []).push(v);
  };
  for (const h of history) {
    if (h.classNum == null) continue;
    for (const r of h.records) {
      const v = finalOf(r);
      if (v !== undefined) add(r.subjectName, h.classNum, v);
    }
  }
  // Aluno sem notas por trimestre (dados antigos): usa as notas simples da disciplina na classe actual.
  const cur = classNumber(student.grade);
  if (cur != null && !Object.keys(sums).length) {
    for (const g of student.disciplineGrades || []) if (g.score > 0) add(g.subject, cur, Math.round(g.score));
  }
  const rows = [...map.values()];
  for (const r of rows) {
    const vs = Object.values(r.byClass).filter((n): n is number => typeof n === 'number');
    r.final = vs.length ? Math.round(vs.reduce((a, b) => a + b, 0) / vs.length) : undefined;
  }
  const averageByClass: Record<number, number | undefined> = {};
  for (const [k, v] of Object.entries(sums)) averageByClass[Number(k)] = Math.round(v.reduce((a, b) => a + b, 0) / v.length);
  return { rows, averageByClass };
}

/** Nº de matrícula do cartão de estudante: "012-2026/2027" (posição na pauta com 3 dígitos + ano lectivo). */
export function formatMatriculaCartao(numero: string | number, year: string): string {
  const n = Number(numero);
  if (!Number.isFinite(n) || n <= 0) return '';
  return `${String(Math.trunc(n)).padStart(3, '0')}${year ? '-' + year : ''}`;
}

/**
 * Posição do aluno na pauta da turma. A Pauta/Mini-Pauta numeram por ordem alfabética
 * (`getStudentsForClass`), por isso o cartão usa exactamente a mesma lista e a mesma ordem.
 */
export function pautaNumber(db: SchoolDatabase, student: Student, classId: string, className?: string): string {
  let roster = getStudentsForClass(String(classId || ''), db.students || []);
  let idx = roster.findIndex((s) => String(s.id) === String(student.id));
  if (idx < 0 && className) {
    // Aluno sem classId válido: recorre às colegas com o mesmo nome de turma.
    roster = sortByName((db.students || []).filter((s) => s.className && s.className === className), (s) => s.name);
    idx = roster.findIndex((s) => String(s.id) === String(student.id));
  }
  return idx >= 0 ? String(idx + 1) : '';
}

/**
 * Curso do aluno (Ensino Médio, 10.ª–13.ª): o da matrícula do ano, senão o do aluno, senão a
 * área curricular da turma, senão o curso a que a turma está vinculada. Devolve também a descrição.
 */
export function resolveCourse(db: SchoolDatabase, student: Student, year?: string): { name: string; code: string; description: string } {
  const y = year || db.settings?.currentAcademicYear || '';
  const mat = findMatriculaForYear(db.matriculas, student.id, y);
  const classId = String(mat?.classId || student.classId || '');
  const classRoom = (db.classes || []).find((c) => String(c.id) === classId);
  const courses = db.courses || [];
  const linked = courses.find((c) => (c.linkedClassIds || []).map(String).includes(classId));
  const name = String(mat?.courseName || student.courseName || (classRoom as any)?.area || linked?.name || '').trim();
  const byName = name ? courses.find((c) => normalizeText(c.name) === normalizeText(name)) : undefined;
  const course = byName || (name ? undefined : linked);
  return { name: name || course?.name || '', code: course?.code || '', description: String(course?.description || '').trim() };
}

export function buildEnrollment(db: SchoolDatabase, student: Student, year?: string): StudioEnrollment {
  const y = year || db.settings?.currentAcademicYear || '';
  const mat = findMatriculaForYear(db.matriculas, student.id, y);
  const classId = String(mat?.classId || student.classId || '');
  const classRoom = (db.classes || []).find((c) => String(c.id) === classId);
  const grade = mat?.grade || student.grade || '';
  const numero = pautaNumber(db, student, classId, String(mat?.className || student.className || ''));
  const course = resolveCourse(db, student, y);
  return {
    year: y,
    grade,
    classNum: classNumber(grade),
    turma: String(student.section || (classRoom as any)?.section || '').replace(/^turma\s*/i, '') || String(student.className || '').split(/\s+/).pop() || '',
    numero,
    periodo: mat?.shift || student.shift || (classRoom as any)?.shift || '',
    curso: course.name,
    cursoDescricao: course.description,
    cursoCodigo: course.code,
    matricula: formatMatriculaCartao(numero, y),
    sala: student.classroomRoom || ''
  };
}

export function buildStudioData(db: SchoolDatabase, student: Student, year?: string): StudioData {
  const history = buildHistory(db, student);
  const { rows, averageByClass } = buildRows(history, student);
  return {
    school: buildSchool(db),
    person: buildPerson(student),
    enrollment: buildEnrollment(db, student, year),
    history,
    rows,
    averageByClass,
    generatedAt: new Date().toISOString()
  };
}

// ---------------------------------------------------------------------------------------------
// Funcionários (crachá) — docentes e restante pessoal
// ---------------------------------------------------------------------------------------------
export interface StaffPerson {
  id: string;
  name: string;
  role: string;
  department: string;
  number: string;
  bi: string;
  nif: string;
  admission: string;
  phone: string;
  photo: string;
  blood: string;
  kind: 'docente' | 'funcionario';
}

export function listStaff(db: SchoolDatabase): StaffPerson[] {
  const t = (db.teachers || []).map((x: Teacher): StaffPerson => ({
    id: `t:${x.id}`, name: x.name, role: x.degree ? `Docente · ${x.degree}` : 'Docente', department: x.department || '',
    number: x.agentNumber || '', bi: x.biNumber || '', nif: x.nif || '', admission: dataCurta(x.admissionDate), phone: x.phone || '',
    photo: x.avatar || '', blood: '', kind: 'docente'
  }));
  const f = (db.funcionarios || []).map((x: Funcionario): StaffPerson => ({
    id: `f:${x.id}`, name: x.name, role: (x.cargo === 'outro' ? x.cargoOutroDescricao : String(x.cargo)) || 'Funcionário',
    department: x.department || '', number: x.employeeNumber || '', bi: x.biNumber || '', nif: x.nif || '',
    admission: dataCurta(x.admissionDate), phone: x.phone || '', photo: x.avatar || '', blood: '', kind: 'funcionario'
  }));
  return [...t, ...f];
}

/** Subsistema de ensino do aluno a partir da classe: define qual cartão/declaração/certificado sugerir. */
export type StudioLevel = 'primario' | 'iciclo' | 'iiciclo' | 'tecnico' | 'eja';
export function levelOfGrade(grade?: string | null): StudioLevel {
  const g = String(grade || '').toLowerCase();
  if (/eja|m[oó]dulo/.test(g)) return 'eja';
  if (/t[ée]cnic/.test(g)) return 'tecnico';
  const n = classNumber(grade);
  if (n == null) return 'primario';
  if (n <= 6) return 'primario';
  if (n <= 9) return 'iciclo';
  if (n === 13) return 'tecnico';
  return 'iiciclo';
}

export const LEVEL_LABEL: Record<StudioLevel, string> = {
  primario: 'Ensino Primário',
  iciclo: 'I Ciclo do Ensino Secundário',
  iiciclo: 'II Ciclo do Ensino Secundário',
  tecnico: 'Ensino Secundário Técnico-Profissional',
  eja: 'Educação de Adultos'
};

export { upper };
