/**
 * PROJEÇÃO DE DADOS POR UTILIZADOR (Aluno & Encarregado)
 * =====================================================
 * O Firebase Realtime Database não filtra listas no servidor: dar .read numa
 * colecção expõe a colecção inteira.
 *
 * Para garantir privacidade absoluta:
 * 1. Alunos e Encarregados deixam de ter .read em inst_data/{escola}/students,
 *    classes, invoices, matriculas e guardianLinks.
 * 2. Em vez disso, a equipa de gestão sincroniza a projecção individual de cada
 *    aluno e encarregado em user_projections/{escola}/{userId}.
 * 3. As regras do Firebase garantem que cada utilizador apenas pode ler a SUA
 *    própria projecção: auth.uid === $userId.
 */

import {
  AttendanceSheet,
  BolsaEstudo,
  BookLoan,
  InternalChatThread,
  ClassRoom,
  DiplomaSuperior,
  EstagioCurricular,
  GuardianStudentLink,
  InscricaoUC,
  Matricula,
  MonografiaTCC,
  SchoolDatabase,
  Student,
  TuitionInvoice,
  User
} from '../types';
import { resolveGuardianChildren } from './guardianLinks';

export interface UserProjectionData {
  userId: string;
  role: 'aluno' | 'encarregado' | string;
  updatedAt: string;
  students: Student[];
  matriculas: Matricula[];
  classes: ClassRoom[];
  invoices: TuitionInvoice[];
  guardianLinks: GuardianStudentLink[];
  homologations?: any[];
  attendanceSheets?: AttendanceSheet[];
  inscricoesUC?: InscricaoUC[];
  monografiasTCC?: MonografiaTCC[];
  estagiosCurriculares?: EstagioCurricular[];
  bolsasEstudo?: BolsaEstudo[];
  diplomasSuperior?: DiplomaSuperior[];
  /** Só as conversas em que o utilizador é participante. */
  internalChatThreads?: InternalChatThread[];
  /** Empréstimos da biblioteca do próprio aluno. */
  loans?: BookLoan[];
  /** Ensino à distância: trabalhos das turmas do aluno e SÓ as suas entregas. */
  assignments?: SchoolDatabase['assignments'];
  assignmentSubmissions?: SchoolDatabase['assignmentSubmissions'];
  /** Materiais marcados como visíveis aos alunos, das turmas do aluno. */
  teachingMaterials?: SchoolDatabase['teachingMaterials'];
  /** Só avaliações descritivas PUBLICADAS dos próprios educandos. */
  descriptiveAssessments?: SchoolDatabase['descriptiveAssessments'];
  /** Reuniões em que o educando é participante, ou coletivas da sua turma. */
  parentTeacherMeetings?: SchoolDatabase['parentTeacherMeetings'];
}

/**
 * Dados novos (passos 5/6) que aluno e encarregado podem ler. Tudo filtrado pelos
 * educandos/turmas da própria conta — nunca se envia a colecção inteira.
 */
export function buildExtraProjection(db: SchoolDatabase, classIds: Set<string>, studentIds: Set<string>) {
  const sid = (v: unknown) => String(v);
  const assignments = (db.assignments || []).filter((a) => a.status !== 'rascunho' && classIds.has(sid(a.classId)));
  const assignmentIds = new Set(assignments.map((a) => a.id));
  return {
    assignments,
    assignmentSubmissions: (db.assignmentSubmissions || []).filter(
      (x) => assignmentIds.has(x.assignmentId) && studentIds.has(sid(x.studentId))
    ),
    teachingMaterials: (db.teachingMaterials || []).filter((m) => m.visibleToStudents && classIds.has(sid(m.classId))),
    descriptiveAssessments: (db.descriptiveAssessments || []).filter(
      (d) => d.status === 'publicado' && studentIds.has(sid(d.studentId))
    ),
    parentTeacherMeetings: (db.parentTeacherMeetings || []).filter(
      (m) =>
        m.status !== 'cancelada' &&
        (m.participants || []).some((p) => studentIds.has(sid(p.studentId))) ||
        (m.type === 'coletiva' && !!m.classId && classIds.has(sid(m.classId)) && m.status !== 'cancelada')
    ).map((m) => ({
      ...m,
      // O encarregado só vê os próprios educandos na lista de participantes (privacidade dos outros).
      participants: (m.participants || []).filter((p) => studentIds.has(sid(p.studentId)))
    }))
  };
}

/** Localiza o registo de aluno associado a um utilizador com perfil "aluno". */
export function findStudentForUser(user: User, students: Student[] = []): Student | undefined {
  if (!user || students.length === 0) return undefined;

  if (user.linkedStudentId) {
    const byId = students.find((s) => String(s.id) === String(user.linkedStudentId));
    if (byId) return byId;
  }

  if (user.processNumber) {
    const proc = user.processNumber.trim().toLowerCase();
    const byProc = students.find((s) => s.procNumber && s.procNumber.trim().toLowerCase() === proc);
    if (byProc) return byProc;
  }

  if (user.email) {
    const email = user.email.trim().toLowerCase();
    const byEmail = students.find((s) => s.email && s.email.trim().toLowerCase() === email);
    if (byEmail) return byEmail;
  }

  if (user.name) {
    const name = user.name.trim().toLowerCase();
    const byName = students.find((s) => s.name && s.name.trim().toLowerCase() === name);
    if (byName) return byName;
  }

  return undefined;
}

/** Conversas privadas em que o utilizador é um dos dois participantes. */
function threadsOf(userId: string, db: SchoolDatabase): InternalChatThread[] {
  return (db.internalChatThreads || []).filter((t) => (t.participantIds || []).map(String).includes(String(userId)));
}

/** Constrói a projecção pessoal e restrita para uma conta de Aluno. */
export function buildProjectionForAluno(user: User, db: SchoolDatabase): UserProjectionData {
  const allStudents = db.students || [];
  const targetStudent = findStudentForUser(user, allStudents);

  if (!targetStudent) {
    return {
      userId: user.id,
      role: 'aluno',
      updatedAt: new Date().toISOString(),
      students: [],
      matriculas: [],
      classes: [],
      invoices: [],
      guardianLinks: [],
      homologations: [],
      attendanceSheets: [],
      internalChatThreads: threadsOf(user.id, db),
      loans: [],
      assignments: [],
      assignmentSubmissions: [],
      teachingMaterials: [],
      descriptiveAssessments: [],
      parentTeacherMeetings: []
    };
  }

  const studentIdStr = String(targetStudent.id);
  const matriculas = (db.matriculas || []).filter(
    (m) => String(m.studentId) === studentIdStr || (m.studentName && m.studentName === targetStudent.name)
  );

  const classIds = new Set<string>();
  if (targetStudent.classId) classIds.add(String(targetStudent.classId));
  matriculas.forEach((m) => {
    if (m.classId) classIds.add(String(m.classId));
  });

  const classes = (db.classes || []).filter((c) => classIds.has(String(c.id)));
  const invoices = (db.invoices || []).filter((i) => String(i.studentId) === studentIdStr);
  const guardianLinks = (db.guardianLinks || []).filter((l) => String(l.studentId) === studentIdStr);
  const homologations = (db.homologations || []).filter((h) => classIds.has(String(h.classId)));
  const attendanceSheets = (db.attendanceSheets || []).filter((a) => classIds.has(String(a.classId)));
  const inscricoesUC = (db.inscricoesUC || []).filter((i) => String(i.studentId) === studentIdStr);
  const monografiasTCC = (db.monografiasTCC || []).filter((m) => String(m.studentId) === studentIdStr);
  const estagiosCurriculares = (db.estagiosCurriculares || []).filter((e) => String(e.studentId) === studentIdStr);
  const bolsasEstudo = (db.bolsasEstudo || []).filter((b) => String(b.studentId) === studentIdStr);
  const diplomasSuperior = (db.diplomasSuperior || []).filter((d) => String(d.studentId) === studentIdStr);
  const internalChatThreads = threadsOf(user.id, db);
  const studentNameKey = (targetStudent.name || '').trim().toLowerCase();
  const loans = studentNameKey
    ? (db.loans || []).filter((l) => (l.borrowerName || '').trim().toLowerCase() === studentNameKey)
    : [];

  return {
    userId: user.id,
    role: 'aluno',
    updatedAt: new Date().toISOString(),
    students: [targetStudent],
    matriculas,
    classes,
    invoices,
    guardianLinks,
    homologations,
    attendanceSheets,
    inscricoesUC,
    monografiasTCC,
    estagiosCurriculares,
    bolsasEstudo,
    diplomasSuperior,
    internalChatThreads,
    loans,
    ...buildExtraProjection(db, classIds, new Set([studentIdStr]))
  };
}

/** Constrói a projecção pessoal e restrita para uma conta de Encarregado de Educação. */
export function buildProjectionForEncarregado(user: User, db: SchoolDatabase): UserProjectionData {
  const allStudents = db.students || [];
  const allLinks = db.guardianLinks || [];
  const children = resolveGuardianChildren(user, allStudents, allLinks);

  const childrenStudents = children.map((c) => c.student);
  const childIds = new Set(childrenStudents.map((s) => String(s.id)));

  const matriculas = (db.matriculas || []).filter((m) => childIds.has(String(m.studentId)));

  const classIds = new Set<string>();
  childrenStudents.forEach((s) => {
    if (s.classId) classIds.add(String(s.classId));
  });
  matriculas.forEach((m) => {
    if (m.classId) classIds.add(String(m.classId));
  });

  const classes = (db.classes || []).filter((c) => classIds.has(String(c.id)));
  const invoices = (db.invoices || []).filter((i) => childIds.has(String(i.studentId)));

  const guardianEmail = user.email ? user.email.trim().toLowerCase() : '';

  const guardianLinks = allLinks.filter(
    (l) =>
      l.guardianUserId === user.id ||
      (guardianEmail && l.guardianEmail && l.guardianEmail.trim().toLowerCase() === guardianEmail) ||
      childIds.has(String(l.studentId))
  );

  const homologations = (db.homologations || []).filter((h) => classIds.has(String(h.classId)));
  const attendanceSheets = (db.attendanceSheets || []).filter((a) => classIds.has(String(a.classId)));
  const inscricoesUC = (db.inscricoesUC || []).filter((i) => childIds.has(String(i.studentId)));
  const monografiasTCC = (db.monografiasTCC || []).filter((m) => childIds.has(String(m.studentId)));
  const estagiosCurriculares = (db.estagiosCurriculares || []).filter((e) => childIds.has(String(e.studentId)));
  const bolsasEstudo = (db.bolsasEstudo || []).filter((b) => childIds.has(String(b.studentId)));
  const diplomasSuperior = (db.diplomasSuperior || []).filter((d) => childIds.has(String(d.studentId)));

  return {
    userId: user.id,
    role: 'encarregado',
    updatedAt: new Date().toISOString(),
    internalChatThreads: threadsOf(user.id, db),
    students: childrenStudents,
    matriculas,
    classes,
    invoices,
    guardianLinks,
    homologations,
    attendanceSheets,
    inscricoesUC,
    monografiasTCC,
    estagiosCurriculares,
    bolsasEstudo,
    diplomasSuperior,
    ...buildExtraProjection(db, classIds, childIds)
  };
}

/** Gera a projecção de todos os utilizadores que precisam de vista filtrada (alunos e encarregados). */
export function buildAllUserProjections(db: SchoolDatabase): Record<string, UserProjectionData> {
  const users = db.users || [];
  const projections: Record<string, UserProjectionData> = {};

  for (const user of users) {
    if (user.role === 'aluno') {
      projections[user.id] = buildProjectionForAluno(user, db);
    } else if (user.role === 'encarregado') {
      projections[user.id] = buildProjectionForEncarregado(user, db);
    }
  }

  return projections;
}
