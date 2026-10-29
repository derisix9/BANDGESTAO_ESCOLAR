import { ClassRoom, SchoolDatabase, Subject, SubjectClassAssignment } from '../types';
import { isUpperLevelGrade, normalizeGradeKey } from './educationSubsystems';

function normalizeText(text?: string): string {
  return (text || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim();
}

/** Compara anos letivos de forma tolerante ("2025/2026" = "2025-2026" = "2025 / 2026"). */
function sameAcademicYear(a?: string | null, b?: string | null): boolean {
  if (!a || !b) return true; // sem ano num dos lados: não exclui
  const da = String(a).replace(/\D/g, '');
  const db = String(b).replace(/\D/g, '');
  if (!da || !db) return true;
  return da === db || da.includes(db) || db.includes(da);
}

/**
 * ÚNICA regra usada para decidir se uma Atribuição (Secretaria Académica →
 * Atribuição) se aplica a uma Classe/Curso/Turma. Partilhada por Notas,
 * Assiduidade, Folha de Chamada, Banco de Questões e pelo filtro de turmas do
 * Professor, para que todos vejam exactamente as mesmas disciplinas.
 *
 *  • Classe: comparada sem pontuação/ordinais ("9.ª Classe" = "9ª Classe").
 *  • Curso: só conta a partir da 10.ª classe (como em Atribuição). Nas classes
 *    anteriores é ignorado — uma turma do Ensino Primário/I Ciclo pode ter
 *    `area` preenchida sem que isso queira dizer que tem Curso.
 *    `courseName === undefined` = "não filtrar por curso".
 *  • Ano letivo: comparação tolerante ao formato.
 *  • Turmas: `classIds` preenchido restringe às turmas listadas.
 */
export function assignmentAppliesTo(
  a: SubjectClassAssignment,
  target: {
    grade?: string | null;
    courseName?: string | null;
    academicYear?: string | null;
    classId?: string | number | null;
  }
): boolean {
  if (!target.grade) return false;
  if (normalizeGradeKey(a.grade) !== normalizeGradeKey(target.grade)) return false;
  if (!sameAcademicYear(a.academicYear, target.academicYear)) return false;
  if (target.courseName !== undefined && isUpperLevelGrade(target.grade)) {
    if (normalizeText(target.courseName || undefined) !== normalizeText(a.courseName)) return false;
  }
  if (target.classId != null && a.classIds && a.classIds.length > 0) {
    return a.classIds.some((id) => String(id) === String(target.classId));
  }
  return true;
}

/**
 * Disciplinas oficialmente atribuídas a uma Classe (+ Curso, quando aplicável)
 * em Secretaria Académica → Atribuição — a ÚNICA fonte usada para decidir
 * quais disciplinas uma Classe/Turma tem.
 *
 * IMPORTANTE: uma Classe sem nenhuma Atribuição lançada devolve uma lista
 * VAZIA. Não há fallback para Horário, Alocação de professores ou Plano
 * Curricular — essas fontes não são específicas o suficiente por Turma/Curso
 * (podiam pertencer a outra variante da mesma Classe, ou a outro Curso) e
 * causavam contaminação cruzada: uma turma sem Atribuição acabava por
 * "herdar" disciplinas de outra turma/classe. Só classes com Atribuição
 * realmente preenchida na Secretaria Académica mostram disciplinas; as
 * restantes mostram "Nenhuma disciplina atribuída" até serem preenchidas.
 *
 * Cada nome de disciplina encontrado é casado com `db.subjects` (por nome/
 * código normalizado) para preservar o `id` real usado nas notas guardadas;
 * se a disciplina atribuída ainda não estiver formalmente cadastrada em
 * Disciplinas, cria-se uma entrada mínima só para permitir mostrar/lançar a
 * coluna, tal como já acontece em `getAvailableSubjectsForUser`.
 *
 * `classId`, quando indicado, restringe às Atribuições que incluem essa Turma
 * específica: uma Atribuição com `classIds` preenchido só se aplica às turmas
 * ali listadas; uma Atribuição sem `classIds` (ou vazio) continua a aplicar-se
 * a TODAS as turmas da Classe/Curso, como sempre aconteceu.
 */
export function getAssignedSubjectsForGrade(
  db: SchoolDatabase,
  grade?: string | null,
  courseName?: string | null,
  academicYear?: string | null,
  classId?: string | number | null
): Subject[] {
  const allSubjects = db.subjects || [];
  if (!grade) return [];

  const assignments = (db.subjectAssignments || []).filter((a) =>
    assignmentAppliesTo(a, { grade, courseName, academicYear, classId })
  );

  if (assignments.length === 0) return [];

  const taughtNames = new Set<string>();
  assignments.forEach((a) => {
    if (a.subjectName) taughtNames.add(normalizeText(a.subjectName));
  });

  const matched: Subject[] = [];
  const seen = new Set<string>();

  taughtNames.forEach((taughtNorm) => {
    const found = allSubjects.find(
      (s) => normalizeText(s.name) === taughtNorm || normalizeText(s.code) === taughtNorm
    );
    if (found) {
      const key = normalizeText(found.name);
      if (!seen.has(key)) {
        seen.add(key);
        matched.push(found);
      }
      return;
    }

    // Disciplina atribuída mas ainda sem cadastro formal em Disciplinas:
    // cria-se uma entrada mínima só para não perder a coluna.
    if (!seen.has(taughtNorm)) {
      seen.add(taughtNorm);
      const originalName = assignments.find((a) => normalizeText(a.subjectName) === taughtNorm)?.subjectName || taughtNorm;

      matched.push({
        id: `grade-sub-${normalizeText(grade)}-${taughtNorm.replace(/\s+/g, '-').slice(0, 20)}`,
        name: originalName,
        code: originalName.slice(0, 3).toUpperCase(),
        cycle: 'Ensino Regular',
        weeklyHours: 4,
        status: 'Aprovada'
      });
    }
  });

  return matched;
}

/**
 * Disciplinas efetivamente atribuídas a uma turma/classe específica — usadas
 * na Pauta Geral (uma coluna por disciplina) e no "Foco Curricular" da
 * Mini-Pauta. NUNCA a lista completa de disciplinas da instituição, e NUNCA
 * disciplinas de outras turmas/classes: uma turma sem Atribuição preenchida
 * na Secretaria Académica devolve uma lista vazia (ver `getAssignedSubjectsForGrade`).
 */
export function getSubjectsForClass(db: SchoolDatabase, classRoom?: ClassRoom | null): Subject[] {
  if (!classRoom) return [];
  return getAssignedSubjectsForGrade(db, classRoom.grade, classRoom.area, classRoom.academicYear, classRoom.id);
}

/**
 * Disciplinas atribuídas a uma Classe (+ Curso, quando aplicável), tal como
 * definidas na Secretaria Académica → Atribuição — usadas em formulários que
 * ainda não têm uma turma concreta selecionada (ex.: Novo Plano Curricular,
 * que é definido por Classe e reutilizado por todas as turmas dessa Classe).
 * Soma a Atribuição com o Plano Curricular já cadastrado para essa Classe
 * (união, não substituição — uma Atribuição parcialmente preenchida não deve
 * esconder disciplinas já existentes no Plano Curricular). Se não houver
 * nenhuma das duas fontes para essa Classe, devolve todas as disciplinas da
 * instituição para não bloquear o preenchimento do formulário.
 */
export function getSubjectsForGrade(db: SchoolDatabase, grade?: string | null, courseName?: string | null): Subject[] {
  const allSubjects = db.subjects || [];
  if (!grade) return allSubjects;

  const assignments = (db.subjectAssignments || []).filter((a) => {
    if (normalizeText(a.grade) !== normalizeText(grade)) return false;
    const courseKey = normalizeText(courseName || undefined);
    const assignmentCourseKey = normalizeText(a.courseName);
    if (courseKey || assignmentCourseKey) {
      return courseKey === assignmentCourseKey;
    }
    return true;
  });

  const taughtNames = new Set(assignments.map((a) => normalizeText(a.subjectName)));

  // Soma o Plano Curricular já cadastrado para esta Classe, sempre — não só
  // quando a Atribuição está totalmente vazia.
  (db.curriculumPlans || []).forEach((plan) => {
    if (normalizeText(plan.grade) === normalizeText(grade) && plan.subjectName) {
      taughtNames.add(normalizeText(plan.subjectName));
    }
  });

  if (taughtNames.size === 0) return allSubjects;

  const matched: Subject[] = [];
  const seen = new Set<string>();

  taughtNames.forEach((taughtNorm) => {
    const found = allSubjects.find((s) => normalizeText(s.name) === taughtNorm || normalizeText(s.code) === taughtNorm);
    if (found) {
      const key = normalizeText(found.name);
      if (!seen.has(key)) {
        seen.add(key);
        matched.push(found);
      }
      return;
    }
    if (!seen.has(taughtNorm)) {
      seen.add(taughtNorm);
      const originalName =
        assignments.find((a) => normalizeText(a.subjectName) === taughtNorm)?.subjectName ||
        (db.curriculumPlans || []).find((p) => normalizeText(p.subjectName) === taughtNorm)?.subjectName ||
        taughtNorm;
      matched.push({
        id: `grade-sub-${normalizeText(grade)}-${taughtNorm.replace(/\s+/g, '-').slice(0, 20)}`,
        name: originalName,
        code: originalName.slice(0, 3).toUpperCase(),
        cycle: 'Ensino Regular',
        weeklyHours: 4,
        status: 'Aprovada'
      });
    }
  });

  return matched;
}
