import React, { useState, useMemo, useEffect } from 'react';
import { SchoolDatabase, UserRole, User, ClassRoom, Course, Subject, EducationLevelId, TimetableEntry } from '../types';
import { dbService } from '../services/db';
import { getAvailableSubjectsForUser, filterSubjectsForUser } from '../utils/teacherSubjects';
import { getSubjectsForClass } from '../utils/classSubjects';
import { resolveTeacherForSubject, rankTeachersForSubject } from '../utils/subjectTeacherResolver';
import { generateClassTimetable } from '../utils/timetableGenerator';
import {
  getActiveSubsystems,
  getAvailableGrades,
  getAvailableAreas,
  getCycleForGrade,
  generateSuggestedClassName,
  generateSubjectCode,
  isUpperLevelGrade
} from '../utils/educationSubsystems';
import { SearchableSelect, SearchableOption } from '../components/SearchableSelect';
import { AsyncButton } from '../components/AsyncButton';
import { FormModalHeader } from '../components/FormModalHeader';
import { runGlobalOperation, showAppAlert, showAppConfirm } from '../context/OperationContext';
import { getFallbackAcademicYear } from '../utils/academicYear';
import { useAccessControl } from '../hooks/useAccessControl';
import { KeySubjectFields } from '../components/KeySubjectFields';
import { KeySubsystemId, describeKeySubject, isKeySubjectFor, KEY_SUBSYSTEM_OPTIONS } from '../utils/keySubjects';
import { getClassNumber } from '../utils/keySubjects';
import { TablePagination, usePagedList } from '../components/TablePagination';
import { notify, Notice } from '../components/Notice';

/**
 * Secção a apresentar. Cada valor corresponde a um item próprio no sidebar
 * (grupo "Turmas & Disciplinas") — a navegação entre secções passou a ser
 * feita exclusivamente pelo menu lateral, já não existe uma barra de abas
 * interna nesta view.
 */
export type TurmasViewSection = 'turmas' | 'disciplinas' | 'horarios' | 'cursos' | 'mapa_salas';

interface TurmasViewProps {
  db: SchoolDatabase;
  currentUserRole: UserRole;
  currentUser?: User;
  /** Secção a apresentar (definida pelo item do sidebar selecionado). Por omissão: 'turmas'. */
  section?: TurmasViewSection;
  onNavigateToAttendance: (classId: string) => void;
  onNavigateToStudents: (classId?: string) => void;
  onNavigateToPautas?: () => void;
}

export const TurmasView: React.FC<TurmasViewProps> = ({
  db,
  currentUserRole,
  currentUser,
  section = 'turmas',
  onNavigateToAttendance,
  onNavigateToStudents,
  onNavigateToPautas
}) => {
  // Matriz ACL (Configurações → Perfis & Permissões): criar/editar/eliminar
  // turmas, cursos e disciplinas exige turmas.manage; alocar um docente a um
  // tempo lectivo exige professores.assign.
  const acl = useAccessControl(currentUserRole);
  const canAssignTeachers = acl.can('professores.assign');

  // Education subsystems and grades configured by institution settings
  const activeSubsystems = useMemo(
    () => getActiveSubsystems(db.settings?.selectedSubsystems),
    [db.settings?.selectedSubsystems]
  );

  const availableGrades = useMemo(
    () => getAvailableGrades(db.settings?.selectedSubsystems),
    [db.settings?.selectedSubsystems]
  );

  // ---------------------------------------------------------------------------------
  // A secção apresentada é definida externamente pelo item do sidebar selecionado
  // (prop `section`). Mapeia-se aqui para os identificadores internos usados nas
  // condições de renderização abaixo ('disciplinas' -> 'matriz', 'mapa_salas' -> 'salas').
  // Já não existe estado interno de aba nem barra de navegação por abas nesta view.
  // ---------------------------------------------------------------------------------
  const activeTab: 'turmas' | 'horarios' | 'cursos' | 'matriz' | 'salas' =
    section === 'disciplinas' ? 'matriz' : section === 'mapa_salas' ? 'salas' : section;

  // Schedule Management State (Definir Horários por Disciplina e Período)
  const [selectedTimetableClassId, setSelectedTimetableClassId] = useState<string>('');
  const [slotDay, setSlotDay] = useState<
    'Segunda-feira' | 'Terça-feira' | 'Quarta-feira' | 'Quinta-feira' | 'Sexta-feira'
  >('Segunda-feira');
  const [slotTimeStart, setSlotTimeStart] = useState('07:30');
  const [slotTimeEnd, setSlotTimeEnd] = useState('08:15');
  const [slotSubject, setSlotSubject] = useState('');
  const [slotTeacher, setSlotTeacher] = useState('');
  const [slotRoom, setSlotRoom] = useState('');

  // Search queries
  const [turmaSearch, setTurmaSearch] = useState('');
  // Filtra a listagem de Turmas pelo Ano Letivo Vigente definido em Configurações >
  // Ano Letivo & Calendário — por omissão só mostra as turmas do ano corrente,
  // evitando que turmas de anos anteriores se acumulem indefinidamente na lista.
  const [turmaYearFilter, setTurmaYearFilter] = useState<'current' | 'all'>('current');
  const [cursoSearch, setCursoSearch] = useState('');
  const [disciplineSearch, setDisciplineSearch] = useState('');
  const [disciplinePage, setDisciplinePage] = useState(1);
  const itemsPerPage = 8;

  // Modals state
  const [showNovaTurmaModal, setShowNovaTurmaModal] = useState(false);
  const [showNovoCursoModal, setShowNovoCursoModal] = useState(false);
  const [showNovaDisciplinaModal, setShowNovaDisciplinaModal] = useState(false);
  const [selectedScheduleClass, setSelectedScheduleClass] = useState<ClassRoom | null>(null);
  const [selectedStudentsClass, setSelectedStudentsClass] = useState<ClassRoom | null>(null);
  // Impressão oficial da Matriz de Disciplinas (aba "Disciplinas") — modal
  // próprio, no mesmo padrão de impressão (printable-document) já usado na
  // Grelha Horária, para que o botão IMPRIMIR imprima só a matriz curricular
  // e não o ecrã inteiro da aplicação.
  const [showDisciplinasPrintModal, setShowDisciplinasPrintModal] = useState(false);

  // CRUD Editing & Delete Confirmation States
  const [editingClass, setEditingClass] = useState<ClassRoom | null>(null);
  const [classToDelete, setClassToDelete] = useState<ClassRoom | null>(null);

  const [editingCourse, setEditingCourse] = useState<Course | null>(null);
  const [courseToDelete, setCourseToDelete] = useState<Course | null>(null);

  const [editingSubject, setEditingSubject] = useState<Subject | null>(null);
  const [subjectToDelete, setSubjectToDelete] = useState<Subject | null>(null);
  const [keyInfoSubject, setKeyInfoSubject] = useState<Subject | null>(null);

  // Edit Class form fields
  const [editClassName, setEditClassName] = useState('');
  const [editClassGrade, setEditClassGrade] = useState('');
  const [editClassSection, setEditClassSection] = useState('A');
  const [editClassArea, setEditClassArea] = useState('');
  const [editClassShift, setEditClassShift] = useState<'Manhã' | 'Tarde' | 'Integral'>('Manhã');
  const [editClassRoom, setEditClassRoom] = useState('');
  const [editClassCapacity, setEditClassCapacity] = useState(30);
  const [editClassHeadTeacherId, setEditClassHeadTeacherId] = useState('');
  const [editClassDelegate, setEditClassDelegate] = useState('');

  // Edit Course form fields
  const [editCourseName, setEditCourseName] = useState('');
  const [editCourseCode, setEditCourseCode] = useState('');
  const [editCourseLevel, setEditCourseLevel] = useState<EducationLevelId>('secundario_2');
  const [editCourseCycle, setEditCourseCycle] = useState('II Ciclo / Ensino Médio');
  const [editCourseDuration, setEditCourseDuration] = useState(3);
  const [editCourseCoordinator, setEditCourseCoordinator] = useState('');
  const [editCourseDescription, setEditCourseDescription] = useState('');
  const [editCourseStatus, setEditCourseStatus] = useState<'ativo' | 'inativo'>('ativo');
  /** Turmas vinculadas ao curso em edição. */
  const [editCourseClassIds, setEditCourseClassIds] = useState<string[]>([]);

  // Edit Subject form fields
  const [editSubName, setEditSubName] = useState('');
  const [editSubCode, setEditSubCode] = useState('');
  const [editSubArea, setEditSubArea] = useState('');
  const [editSubHours, setEditSubHours] = useState(4);
  const [editSubCoordinator, setEditSubCoordinator] = useState('');
  const [editSubStatus, setEditSubStatus] = useState<'Aprovada' | 'Em Revisão' | 'Pendente'>('Aprovada');
  const [editSubDescription, setEditSubDescription] = useState('');

  // Real Database Lists
  const classesList = db.classes || [];
  const subjectsList = useMemo(() => {
    return getAvailableSubjectsForUser(db, currentUser);
  }, [db, currentUser]);
  const coursesList = db.courses || [];
  const teachersList = db.teachers || [];
  const studentsList = db.students || [];

  // ==========================================
  // REAL COMPUTED KPIS
  // ==========================================
  const totalTurmas = classesList.length;

  /**
   * Seletor de Turmas Vinculadas, partilhado pelos formulários de criação e de
   * edição de curso. As turmas escolhidas passam a ter este curso como área
   * curricular assim que o curso for gravado.
   */
  const renderLinkedClassesPicker = (
    selectedIds: string[],
    setSelectedIds: (ids: string[]) => void,
    courseName: string
  ) => {
    const toggle = (classId: string) => {
      setSelectedIds(
        selectedIds.includes(classId)
          ? selectedIds.filter((id) => id !== classId)
          : [...selectedIds, classId]
      );
    };

    return (
      <div>
        <div className="flex items-center justify-between mb-1">
          <label className="block font-bold text-slate-700 uppercase tracking-wider">
            Turmas Vinculadas a Este Curso
          </label>
          <span className="text-[10px] font-bold text-slate-500">
            {selectedIds.length} de {classesList.length} selecionada(s)
          </span>
        </div>

        {classesList.length === 0 ? (
          <div className="px-3 py-3 border border-dashed border-slate-300 text-[11px] text-slate-500">
            Ainda não existem turmas cadastradas. Crie primeiro as turmas no separador "Turmas" e volte aqui para as
            vincular a este curso.
          </div>
        ) : (
          <div className="max-h-44 overflow-y-auto border border-slate-300 divide-y divide-slate-100">
            {classesList.map((cls) => {
              const checked = selectedIds.includes(cls.id);
              const takenByOther =
                !!cls.area && cls.area !== courseName && !checked;
              return (
                <label
                  key={cls.id}
                  className={`flex items-center gap-2 px-3 py-2 cursor-pointer transition-colors ${
                    checked ? 'bg-blue-50' : 'hover:bg-slate-50'
                  }`}
                >
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={() => toggle(cls.id)}
                    className="accent-[#0b1f3a] w-3.5 h-3.5 shrink-0"
                  />
                  <span className="font-bold text-slate-800 text-[11px] shrink-0">{cls.name}</span>
                  <span className="text-[10px] text-slate-500 truncate">
                    {cls.grade} · {cls.shift} · {cls.room || 'sala por atribuir'}
                  </span>
                  {takenByOther && (
                    <span className="ml-auto text-[9px] font-bold text-amber-700 bg-amber-50 border border-amber-200 px-1.5 py-0.5 shrink-0">
                      {cls.area}
                    </span>
                  )}
                </label>
              );
            })}
          </div>
        )}
       
      </div>
    );
  };
  const totalDisciplinas = subjectsList.length;
  const totalCursos = coursesList.length;

  const { totalStudentsCount, totalCapacity, avgOccupancyPct, morningCount, afternoonCount, allocatedHeadTeachersCount } = useMemo(() => {
    let stuCount = 0;
    let capCount = 0;
    let morning = 0;
    let afternoon = 0;
    let withHeadTeacher = 0;

    classesList.forEach((c) => {
      // Calculate real enrolled students from database for this class
      const enrolledInClass = studentsList.filter((s) => String(s.classId) === String(c.id)).length;
      stuCount += enrolledInClass;
      capCount += c.maxCapacity || 30;
      if (c.shift === 'Manhã') morning++;
      else if (c.shift === 'Tarde') afternoon++;
      if (c.headTeacherId || (c.headTeacherName && c.headTeacherName !== 'A designar')) {
        withHeadTeacher++;
      }
    });

    const pct = capCount > 0 ? Math.round((stuCount / capCount) * 100) : 0;
    return {
      totalStudentsCount: stuCount,
      totalCapacity: capCount,
      avgOccupancyPct: pct,
      morningCount: morning,
      afternoonCount: afternoon,
      allocatedHeadTeachersCount: withHeadTeacher
    };
  }, [classesList, studentsList]);

  // Real physical rooms distribution
  const realRooms = useMemo(() => {
    const roomMap = new Map<string, { morning?: ClassRoom; afternoon?: ClassRoom; capacity: number }>();
    classesList.forEach((c) => {
      const roomName = c.room || 'Sala Geral';
      const existing = roomMap.get(roomName) || { capacity: c.maxCapacity || 30 };
      if (c.shift === 'Manhã') existing.morning = c;
      if (c.shift === 'Tarde') existing.afternoon = c;
      existing.capacity = Math.max(existing.capacity, c.maxCapacity || 30);
      roomMap.set(roomName, existing);
    });
    return Array.from(roomMap.entries()).map(([name, data]) => ({
      name,
      capacity: data.capacity,
      morningClass: data.morning,
      afternoonClass: data.afternoon
    }));
  }, [classesList]);

  // ==========================================
  // NEW CLASS FORM STATE
  // ==========================================
  const initialGrade = availableGrades[0] || '10ª Classe';
  const [newClassGrade, setNewClassGrade] = useState<string>(initialGrade);
  const [newClassSection, setNewClassSection] = useState('A');
  const isUpperLevel = isUpperLevelGrade(newClassGrade);

  // Available courses or areas depending on grade
  const availableAreasForGrade = useMemo(
    () => getAvailableAreas(db.settings?.selectedSubsystems, newClassGrade),
    [db.settings?.selectedSubsystems, newClassGrade]
  );

  // Courses available for upper level
  const coursesForSelectedGrade = useMemo(() => {
    if (!isUpperLevel) return [];
    const isHigher = newClassGrade.toLowerCase().includes('licenciatura') ||
      newClassGrade.toLowerCase().includes('bacharelato') ||
      newClassGrade.toLowerCase().includes('mestrado');

    return coursesList.filter((c) => {
      if (isHigher) return c.level === 'superior';
      return c.level === 'secundario_2' || c.cycle.includes('Médio') || c.cycle.includes('II Ciclo');
    });
  }, [isUpperLevel, newClassGrade, coursesList]);

  const [newClassArea, setNewClassArea] = useState<string>(() => {
    if (isUpperLevel && coursesForSelectedGrade.length > 0) {
      return coursesForSelectedGrade[0].name;
    }
    return availableAreasForGrade[0] || 'Tronco Comum';
  });

  const [newClassName, setNewClassName] = useState<string>(() =>
    generateSuggestedClassName(initialGrade, 'A', newClassArea)
  );
  const [newClassShift, setNewClassShift] = useState<'Manhã' | 'Tarde' | 'Integral'>('Manhã');
  const [newClassRoom, setNewClassRoom] = useState('');
  const [newClassCapacity, setNewClassCapacity] = useState(30);
  const [newClassHeadTeacherId, setNewClassHeadTeacherId] = useState(
    teachersList[0]?.id || ''
  );
  const [newClassDelegate, setNewClassDelegate] = useState('');

  // Keep newClassArea and newClassName updated when grade changes
  useEffect(() => {
    if (isUpperLevel) {
      const match = coursesForSelectedGrade[0];
      const selected = match ? match.name : availableAreasForGrade[0] || '';
      setNewClassArea(selected);
      setNewClassName(generateSuggestedClassName(newClassGrade, newClassSection, selected));
    } else {
      const first = availableAreasForGrade[0] || 'Geral';
      setNewClassArea(first);
      setNewClassName(generateSuggestedClassName(newClassGrade, newClassSection, first));
    }
  }, [newClassGrade, isUpperLevel, coursesForSelectedGrade, availableAreasForGrade, newClassSection]);

  // Subject options for SearchableSelect
  const subjectOptions: SearchableOption[] = useMemo(() => {
    return subjectsList.map((s) => ({
      value: s.name,
      label: s.name,
      sublabel: `${s.code} • ${s.area || s.cycle}`,
      badge: `${s.weeklyHours}h/sem`,
      icon: 'menu_book'
    }));
  }, [subjectsList]);

  // Teacher options for SearchableSelect
  const teacherOptions: SearchableOption[] = useMemo(() => {
    return teachersList.map((t) => ({
      value: t.id,
      label: t.name,
      sublabel: `${t.department || 'Docente'} • Agente nº ${t.agentNumber}`,
      avatar: t.avatar,
      badge: t.degree || 'Licenciado'
    }));
  }, [teachersList]);

  // Opções de docente ordenadas por afinidade com a disciplina seleccionada no
  // formulário de alocação de tempos lectivos.
  const teacherOptionsForSlot: SearchableOption[] = useMemo(() => {
    if (!slotSubject.trim()) return teacherOptions;
    return rankTeachersForSubject(db, slotSubject.trim()).map((t) => ({
      value: t.id,
      label: t.name,
      sublabel: `${t.department || 'Docente'} • Agente nº ${t.agentNumber}`,
      avatar: t.avatar,
      badge: t.degree || 'Licenciado'
    }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [db, slotSubject, teacherOptions]);

  // Student options for SearchableSelect
  const studentOptions: SearchableOption[] = useMemo(() => {
    return studentsList.map((s) => ({
      value: s.name,
      label: s.name,
      sublabel: `Processo nº ${s.procNumber} • Turma: ${s.className || 'Não alocado'}`,
      avatar: s.avatar || s.docPassPhoto,
      badge: `Nº ${s.procNumber}`
    }));
  }, [studentsList]);

  // Alunos filtrados para a turma/ano em criação para eleição de Delegado
  const newClassStudentOptions: SearchableOption[] = useMemo(() => {
    const filtered = studentsList.filter((s) => {
      if (newClassName && s.className === newClassName) return true;
      if (newClassGrade && (s.grade === newClassGrade || s.className?.startsWith(newClassGrade))) return true;
      return !s.classId || s.className === 'Não alocado';
    });
    const listToUse = filtered.length > 0 ? filtered : studentsList;
    return listToUse.map((s) => ({
      value: s.name,
      label: s.name,
      sublabel: `Processo nº ${s.procNumber} • ${s.className || s.grade || 'Não alocado'}`,
      avatar: s.avatar || s.docPassPhoto,
      badge: `Proc: ${s.procNumber}`
    }));
  }, [studentsList, newClassName, newClassGrade]);

  // Alunos matriculados especificamente na turma em edição para eleição de Delegado
  const editingClassStudentOptions: SearchableOption[] = useMemo(() => {
    if (!editingClass) return [];
    const enrolled = studentsList.filter(
      (s) => String(s.classId) === String(editingClass.id) || s.className === editingClass.name
    );
    return enrolled.map((s) => ({
      value: s.name,
      label: s.name,
      sublabel: `Processo nº ${s.procNumber} • ${s.biNumber || s.className || 'Matriculado'}`,
      avatar: s.avatar || s.docPassPhoto,
      badge: `Proc: ${s.procNumber}`
    }));
  }, [editingClass, studentsList]);

  // Turma selecionada para a secção de Definir Horários
  const activeTimetableClass = useMemo(() => {
    return (
      classesList.find((c) => c.id === selectedTimetableClassId) ||
      classesList[0] ||
      null
    );
  }, [classesList, selectedTimetableClassId]);

  // Disciplinas para o formulário de Horários desta turma: prioritariamente as
  // atribuídas na Secretaria Académica → Atribuição para a Classe/Curso desta
  // turma; sem Atribuição preenchida, cai para a lista geral disponível ao utilizador.
  const timetableSubjectsList = useMemo(() => {
    // Só as disciplinas atribuídas a ESTA turma (Secretaria Académica →
    // Atribuição). Sem Atribuição preenchida para a turma, fica vazio — não
    // cai para a lista geral de disciplinas, que misturaria disciplinas de
    // outras turmas/classes.
    const forClass = getSubjectsForClass(db, activeTimetableClass);
    return filterSubjectsForUser(forClass, db, currentUser, activeTimetableClass?.id);
  }, [db, activeTimetableClass, currentUser]);

  const timetableSubjectOptions: SearchableOption[] = useMemo(() => {
    return timetableSubjectsList.map((s) => ({
      value: s.name,
      label: s.name,
      sublabel: `${s.code} • ${s.area || s.cycle}`,
      badge: `${s.weeklyHours}h/sem`,
      icon: 'menu_book'
    }));
  }, [timetableSubjectsList]);

  // Course options for SearchableSelect
  const courseOptions: SearchableOption[] = useMemo(() => {
    if (isUpperLevel && coursesForSelectedGrade.length > 0) {
      return coursesForSelectedGrade.map((c) => ({
        value: c.name,
        label: c.name,
        sublabel: `${c.cycle} • Duração: ${c.durationYears || 3} Anos`,
        badge: c.code,
        icon: 'menu_book'
      }));
    }
    return availableAreasForGrade.map((a) => ({
      value: a,
      label: a,
      icon: 'category'
    }));
  }, [isUpperLevel, coursesForSelectedGrade, availableAreasForGrade]);

  // ==========================================
  // NEW DISCIPLINE FORM STATE & AUTO CODE
  // ==========================================
  const [newSubCode, setNewSubCode] = useState('');
  const [newSubName, setNewSubName] = useState('');
  const [newSubDescription, setNewSubDescription] = useState('');
  const [newSubArea, setNewSubArea] = useState('Tronco Comum');
  const [newSubHours, setNewSubHours] = useState(4);
  const [newSubCoordinator, setNewSubCoordinator] = useState(
    teachersList[0]?.name || ''
  );
  const [newSubStatus, setNewSubStatus] = useState<'Aprovada' | 'Em Revisão' | 'Pendente'>('Aprovada');
  const [duplicateWarning, setDuplicateWarning] = useState(false);
  // Disciplina Chave (sem direito a Exame de Recurso nas classes de exame)
  const [newSubKeySubsystems, setNewSubKeySubsystems] = useState<KeySubsystemId[]>([]);
  const [newSubKeyCourses, setNewSubKeyCourses] = useState<string[]>([]);
  const [editSubKeySubsystems, setEditSubKeySubsystems] = useState<KeySubsystemId[]>([]);
  const [editSubKeyCourses, setEditSubKeyCourses] = useState<string[]>([]);

  // Cursos do Ensino Médio (12.ª/13.ª) para marcar a disciplina como chave do curso.
  const allMedioCourseNames = useMemo(
    () =>
      Array.from(
        new Set(
          [
            ...(db.courses || []).filter((c) => c.level !== 'superior').map((c) => c.name),
            ...(db.classes || [])
              .filter((c) => (getClassNumber(c.grade) || 0) >= 10 && c.area)
              .map((c) => c.area as string)
          ].filter(Boolean)
        )
      ),
    [db.courses, db.classes]
  );
  const getTaughtCourseNames = (subjectName: string): string[] => {
    const n = subjectName.trim().toLowerCase();
    if (!n) return [];
    return Array.from(
      new Set(
        (db.subjectAssignments || [])
          .filter((a) => (a.subjectName || '').trim().toLowerCase() === n && (getClassNumber(a.grade) || 0) >= 10 && a.courseName)
          .map((a) => a.courseName as string)
      )
    );
  };

  // Auto-generate code when discipline name changes.
  // A disciplina NÃO pertence a um ciclo: é partilhada por todos os níveis de ensino da instituição.
  const handleDisciplineNameChange = (name: string) => {
    setNewSubName(name);
    if (!name.trim()) {
      setNewSubCode('');
      setDuplicateWarning(false);
      return;
    }
    const result = generateSubjectCode(name, subjectsList);
    setNewSubCode(result.code);
    setDuplicateWarning(result.isDuplicateInSameCycle);
  };

  // ==========================================
  // NEW COURSE FORM STATE
  // ==========================================
  const [newCourseName, setNewCourseName] = useState('');
  const [newCourseCode, setNewCourseCode] = useState('');
  const [newCourseLevel, setNewCourseLevel] = useState<'secundario_2' | 'superior'>('secundario_2');
  const [newCourseDuration, setNewCourseDuration] = useState(3);
  const [newCourseCoordinator, setNewCourseCoordinator] = useState(teachersList[0]?.name || '');
  const [newCourseDescription, setNewCourseDescription] = useState('');
  /** Turmas que ficam vinculadas ao curso a ser criado (ver picker no formulário). */
  const [newCourseClassIds, setNewCourseClassIds] = useState<string[]>([]);

  const handleCourseNameChange = (name: string) => {
    setNewCourseName(name);
    if (!newCourseCode || newCourseCode.length <= 4) {
      const codeSuggestion = name
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/[^a-zA-Z\s]/g, '')
        .split(/\s+/)
        .filter((w) => !['de', 'e', 'da', 'do', 'em', 'para'].includes(w.toLowerCase()))
        .slice(0, 4)
        .map((w) => w[0])
        .join('')
        .toUpperCase();
      setNewCourseCode(codeSuggestion || 'CRS');
    }
  };

  // ==========================================
  // FORM SUBMISSION HANDLERS
  // ==========================================
  const handleCreateClass = (e: React.FormEvent) => {
    e.preventDefault();
    if (!acl.can('turmas.manage')) {
      acl.guard('turmas.manage', () => undefined);
      return;
    }
    if (!newClassName.trim()) return;

    const teacherObj = teachersList.find((t) => t.id === newClassHeadTeacherId) || teachersList[0];
    const resolvedCycle = getCycleForGrade(newClassGrade);

    dbService.addClass({
      name: newClassName.trim(),
      grade: newClassGrade,
      section: newClassSection.trim().toUpperCase(),
      cycle: resolvedCycle,
      area: newClassArea,
      shift: newClassShift,
      room: newClassRoom.trim(),
      studentCount: 0,
      maxCapacity: Number(newClassCapacity) || 30,
      headTeacherId: teacherObj ? teacherObj.id : '',
      headTeacherName: teacherObj ? teacherObj.name : 'A designar',
      delegateName: newClassDelegate.trim() || 'A eleger pela turma',
      academicYear: db.settings?.currentAcademicYear || getFallbackAcademicYear()
    });

    // Reset form
    setShowNovaTurmaModal(false);
  };

  const handleCreateCourse = (e: React.FormEvent) => {
    e.preventDefault();
    if (!acl.can('turmas.manage')) {
      acl.guard('turmas.manage', () => undefined);
      return;
    }
    if (!newCourseName.trim() || !newCourseCode.trim()) return;

    const cycleLabel =
      newCourseLevel === 'superior' ? 'Ensino Superior' : 'II Ciclo / Ensino Médio';

    dbService.addCourse({
      name: newCourseName.trim(),
      code: newCourseCode.trim().toUpperCase(),
      level: newCourseLevel,
      cycle: cycleLabel,
      durationYears: Number(newCourseDuration) || 3,
      coordinatorName: newCourseCoordinator || 'A designar',
      description: newCourseDescription.trim() || 'Curso Técnico-Profissional e Académico oficial',
      status: 'ativo'
    });

    // Reset and close
    setNewCourseName('');
    setNewCourseCode('');
    setNewCourseDescription('');
    setShowNovoCursoModal(false);
  };

  const handleCreateSubject = (e: React.FormEvent) => {
    e.preventDefault();
    if (!acl.can('turmas.manage')) {
      acl.guard('turmas.manage', () => undefined);
      return;
    }
    if (!newSubName.trim() || !newSubCode.trim()) return;

    const initials = (newSubCoordinator || 'Coordenação')
      .split(' ')
      .filter(Boolean)
      .slice(0, 2)
      .map((w) => w[0].toUpperCase())
      .join('');

    dbService.addSubject({
      code: newSubCode.toUpperCase().trim(),
      name: newSubName.trim(),
      area: newSubArea,
      weeklyHours: Number(newSubHours) || 4,
      description: newSubDescription.trim() || 'Unidade Curricular da Base Nacional',
      coordinatorName: newSubCoordinator || 'Docente Coordenador',
      coordinatorAvatar: initials || 'DC',
      status: newSubStatus,
      keySubsystems: newSubKeySubsystems,
      keyCourses: newSubKeyCourses
    });

    setNewSubCode('');
    setNewSubName('');
    setNewSubDescription('');
    setNewSubKeySubsystems([]);
    setNewSubKeyCourses([]);
    setShowNovaDisciplinaModal(false);
  };

  // ==========================================
  // EDIT & DELETE HANDLERS
  // ==========================================
  const handleOpenEditClass = (cls: ClassRoom) => {
    setEditingClass(cls);
    setEditClassName(cls.name);
    setEditClassGrade(cls.grade);
    setEditClassSection(cls.section || 'A');
    setEditClassArea(cls.area || 'Tronco Comum');
    setEditClassShift(cls.shift as 'Manhã' | 'Tarde' | 'Integral');
    setEditClassRoom(cls.room || '');
    setEditClassCapacity(cls.maxCapacity || 30);
    setEditClassHeadTeacherId(cls.headTeacherId || '');
    setEditClassDelegate(cls.delegateName || '');
  };

  const handleUpdateClass = (e: React.FormEvent) => {
    e.preventDefault();
    if (!acl.can('turmas.manage')) {
      acl.guard('turmas.manage', () => undefined);
      return;
    }
    if (!editingClass) return;
    const teacherObj = teachersList.find((t) => t.id === editClassHeadTeacherId);
    dbService.updateClass(editingClass.id, {
      name: editClassName.trim() || editingClass.name,
      grade: editClassGrade || editingClass.grade,
      section: editClassSection.trim().toUpperCase() || editingClass.section,
      area: editClassArea || editingClass.area,
      shift: editClassShift,
      room: editClassRoom.trim() || editingClass.room,
      maxCapacity: Number(editClassCapacity) || 30,
      headTeacherId: teacherObj ? teacherObj.id : '',
      headTeacherName: teacherObj ? teacherObj.name : 'A designar',
      delegateName: editClassDelegate.trim() || 'A eleger pela turma'
    });
    setEditingClass(null);
  };

  const handleOpenEditCourse = (course: Course) => {
    setEditingCourse(course);
    // Turmas vinculadas: as gravadas no curso, mais as que já apontam para ele
    // através da área curricular (vínculos criados antes desta funcionalidade).
    setEditCourseClassIds(
      Array.from(
        new Set([
          ...(course.linkedClassIds || []),
          ...classesList.filter((c) => c.area === course.name).map((c) => c.id)
        ])
      )
    );
    setEditCourseName(course.name);
    setEditCourseCode(course.code);
    setEditCourseLevel(course.level || 'secundario_2');
    setEditCourseCycle(course.cycle || 'II Ciclo / Ensino Médio');
    setEditCourseDuration(course.durationYears || 3);
    setEditCourseCoordinator(course.coordinatorName || '');
    setEditCourseDescription(course.description || '');
    setEditCourseStatus(course.status || 'ativo');
  };

  const handleUpdateCourse = (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingCourse) return;
    dbService.updateCourse(editingCourse.id, {
      name: editCourseName.trim(),
      code: editCourseCode.trim().toUpperCase(),
      level: editCourseLevel,
      cycle: editCourseLevel === 'superior' ? 'Ensino Superior' : 'II Ciclo / Ensino Médio',
      durationYears: Number(editCourseDuration) || 3,
      coordinatorName: editCourseCoordinator.trim() || 'A designar',
      description: editCourseDescription.trim(),
      status: editCourseStatus
    });
    setEditingCourse(null);
  };

  const handleOpenEditSubject = (sub: Subject) => {
    setEditingSubject(sub);
    setEditSubName(sub.name);
    setEditSubCode(sub.code);
    setEditSubArea(sub.area || 'Tronco Comum');
    setEditSubHours(sub.weeklyHours || 4);
    setEditSubCoordinator(sub.coordinatorName || '');
    setEditSubStatus(sub.status || 'Aprovada');
    setEditSubDescription(sub.description || '');
    setEditSubKeySubsystems(sub.keySubsystems || []);
    setEditSubKeyCourses(sub.keyCourses || []);
  };

  const handleUpdateSubject = (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingSubject) return;
    dbService.updateSubject(editingSubject.id, {
      name: editSubName.trim(),
      code: editSubCode.trim().toUpperCase(),
      cycle: '',
      area: editSubArea,
      weeklyHours: Number(editSubHours) || 4,
      coordinatorName: editSubCoordinator.trim() || 'Docente Coordenador',
      status: editSubStatus,
      description: editSubDescription.trim(),
      keySubsystems: editSubKeySubsystems,
      keyCourses: editSubKeyCourses
    });
    setEditingSubject(null);
  };

  // ==========================================
  // FILTERING & PAGINATION
  // ==========================================
  const filteredClasses = useMemo(() => {
    const q = turmaSearch.toLowerCase().trim();
    const currentYear = db.settings?.currentAcademicYear;
    return classesList.filter((cls) => {
      if (!cls) return false;
      // Filtro por Ano Letivo Vigente: turmas sem ano letivo registado (dados
      // antigos) continuam visíveis, para não desaparecerem da listagem.
      if (turmaYearFilter === 'current' && currentYear && cls.academicYear && cls.academicYear !== currentYear) {
        return false;
      }
      // Text search
      if (!q) return true;
      return (
        (cls.name || '').toLowerCase().includes(q) ||
        (cls.grade || '').toLowerCase().includes(q) ||
        (cls.area || '').toLowerCase().includes(q) ||
        (cls.room || '').toLowerCase().includes(q) ||
        (cls.headTeacherName || '').toLowerCase().includes(q) ||
        (cls.delegateName || '').toLowerCase().includes(q)
      );
    });
  }, [classesList, turmaSearch, turmaYearFilter, db.settings?.currentAcademicYear]);
  const { page: pgFilteredClasses, setPage: setPgFilteredClasses, pageItems: visibleFilteredClasses } = usePagedList(filteredClasses, [filteredClasses.length]);

  const filteredCourses = useMemo(() => {
    const q = cursoSearch.toLowerCase().trim();
    return coursesList.filter((crs) => {
      if (!crs) return false;
      if (!q) return true;
      return (
        crs.name.toLowerCase().includes(q) ||
        crs.code.toLowerCase().includes(q) ||
        crs.cycle.toLowerCase().includes(q) ||
        (crs.coordinatorName && crs.coordinatorName.toLowerCase().includes(q))
      );
    });
  }, [coursesList, cursoSearch]);
  const { page: pgFilteredCourses, setPage: setPgFilteredCourses, pageItems: visibleFilteredCourses } = usePagedList(filteredCourses, [filteredCourses.length]);

  const filteredSubjects = useMemo(() => {
    const q = disciplineSearch.toLowerCase().trim();
    return subjectsList.filter((sub) => {
      if (!sub) return false;
      if (!q) return true;
      return (
        (sub.name || '').toLowerCase().includes(q) ||
        (sub.code || '').toLowerCase().includes(q) ||
        (sub.description && sub.description.toLowerCase().includes(q)) ||
        (sub.area || '').toLowerCase().includes(q) ||
        (sub.coordinatorName && sub.coordinatorName.toLowerCase().includes(q))
      );
    });
  }, [subjectsList, disciplineSearch]);
  const { page: pgFilteredSubjects, setPage: setPgFilteredSubjects, pageItems: visibleFilteredSubjects } = usePagedList(filteredSubjects, [filteredSubjects.length]);

  const totalSubjectPages = Math.ceil(filteredSubjects.length / itemsPerPage) || 1;
  const paginatedSubjects = useMemo(() => {
    const start = (disciplinePage - 1) * itemsPerPage;
    return filteredSubjects.slice(start, start + itemsPerPage);
  }, [filteredSubjects, disciplinePage, itemsPerPage]);

  // Timetable helpers & structure
  const getStandardSlotsForShift = (shift: string) => {
    if (shift === 'Tarde') {
      return [
        { label: '1º Tempo (12:45 - 13:30)', start: '12:45', end: '13:30', isBreak: false },
        { label: '2º Tempo (13:30 - 14:15)', start: '13:30', end: '14:15', isBreak: false },
        { label: 'INTERVALO (14:15 - 14:45)', start: '14:15', end: '14:45', isBreak: true },
        { label: '3º Tempo (14:45 - 15:30)', start: '14:45', end: '15:30', isBreak: false },
        { label: '4º Tempo (15:30 - 16:15)', start: '15:30', end: '16:15', isBreak: false },
        { label: 'INTERVALO (16:15 - 16:30)', start: '16:15', end: '16:30', isBreak: true },
        { label: '5º Tempo (16:30 - 17:15)', start: '16:30', end: '17:15', isBreak: false }
      ];
    }
    return [
      { label: '1º Tempo (07:30 - 08:15)', start: '07:30', end: '08:15', isBreak: false },
      { label: '2º Tempo (08:15 - 09:00)', start: '08:15', end: '09:00', isBreak: false },
      { label: 'INTERVALO (09:00 - 09:30)', start: '09:00', end: '09:30', isBreak: true },
      { label: '3º Tempo (09:30 - 10:15)', start: '09:30', end: '10:15', isBreak: false },
      { label: '4º Tempo (10:15 - 11:00)', start: '10:15', end: '11:00', isBreak: false },
      { label: 'INTERVALO (11:00 - 11:15)', start: '11:00', end: '11:15', isBreak: true },
      { label: '5º Tempo (11:15 - 12:00)', start: '11:15', end: '12:00', isBreak: false }
    ];
  };

  const getWeeklyTimetable = (cls: ClassRoom | null) => {
    if (!cls) return [];
    const isMorning = cls.shift !== 'Tarde';
    const slots = isMorning
      ? [
          { time: '07:30 - 08:15', start: '07:30', isBreak: false },
          { time: '08:15 - 09:00', start: '08:15', isBreak: false },
          { time: '09:00 - 09:30', start: '09:00', isBreak: true },
          { time: '09:30 - 10:15', start: '09:30', isBreak: false },
          { time: '10:15 - 11:00', start: '10:15', isBreak: false },
          { time: '11:00 - 11:15', start: '11:00', isBreak: true },
          { time: '11:15 - 12:00', start: '11:15', isBreak: false }
        ]
      : [
          { time: '12:45 - 13:30', start: '12:45', isBreak: false },
          { time: '13:30 - 14:15', start: '13:30', isBreak: false },
          { time: '14:15 - 14:45', start: '14:15', isBreak: true },
          { time: '14:45 - 15:30', start: '14:45', isBreak: false },
          { time: '15:30 - 16:15', start: '15:30', isBreak: false },
          { time: '16:15 - 16:30', start: '16:15', isBreak: true },
          { time: '16:30 - 17:15', start: '16:30', isBreak: false }
        ];

    // Buscar tempos da base de dados para esta turma
    const dbEntries = (db.timetable || []).filter((t) => String(t.classId) === String(cls.id));

    if (dbEntries.length > 0) {
      return slots.map((s) => {
        if (s.isBreak) {
          return {
            time: s.time,
            isBreak: true,
            seg: { subject: 'INTERVALO' },
            ter: { subject: 'INTERVALO' },
            qua: { subject: 'INTERVALO' },
            qui: { subject: 'INTERVALO' },
            sex: { subject: 'INTERVALO' }
          };
        }

        const getEntry = (dayName: string) => {
          const match = dbEntries.find(
            (e) =>
              e.dayOfWeek.toLowerCase().startsWith(dayName.toLowerCase()) &&
              (e.timeStart === s.start || e.timeStart.startsWith(s.start.substring(0, 4)))
          );
          if (!match) return null;
          return {
            subject: match.subject,
            teacher: match.teacherName,
            room: match.room || cls.room
          };
        };

        return {
          time: s.time,
          isBreak: false,
          seg: getEntry('Segunda'),
          ter: getEntry('Terça'),
          qua: getEntry('Quarta'),
          qui: getEntry('Quinta'),
          sex: getEntry('Sexta')
        };
      });
    }

    // Caso não tenha sido definido ainda na base de dados, apresentar estado real de "por definir"
    // (sem inventar disciplinas/docentes que não foram alocados pela Coordenação).
    return slots.map((s) => {
      if (s.isBreak) {
        return {
          time: s.time,
          isBreak: true,
          seg: { subject: 'INTERVALO' },
          ter: { subject: 'INTERVALO' },
          qua: { subject: 'INTERVALO' },
          qui: { subject: 'INTERVALO' },
          sex: { subject: 'INTERVALO' }
        };
      }
      return {
        time: s.time,
        isBreak: false,
        seg: null,
        ter: null,
        qua: null,
        qui: null,
        sex: null
      };
    });
  };

  const sectionHeader: Record<TurmasViewSection, { title: string; subtitle: string }> = {
    turmas: {
      title: 'GESTÃO DE TURMAS',
      subtitle:
        'Estrutura de turmas, alocação de diretores de turma e ocupação de sala.'
    },
    disciplinas: {
      title: 'GESTÃO DE DISCIPLINAS',
      subtitle: 'Matriz curricular de disciplinas por ciclo e área.'
    },
    horarios: {
      title: 'GESTÃO DE HORÁRIOS',
      subtitle: 'Definir horários por disciplina, docente e período letivo para cada turma.'
    },
    cursos: {
      title: 'GESTÃO DE CURSOS',
      subtitle: 'Gerir e cadastrar cursos e respetivas turmas vinculadas.'
    },
    mapa_salas: {
      title: 'MAPAS DE SALAS',
      subtitle: 'Mapa de ocupação real das salas físicas da instituição, por turno.'
    }
  };
  const { title: pageTitle, subtitle: pageSubtitle } = sectionHeader[section];

  return (
    <div className="flex flex-col w-full gap-6 pb-12">
      {/* Top Banner / Page Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 bg-white p-6 lg:p-8 rounded-2xl border border-slate-200 shadow-sm relative overflow-hidden">
        <div className="absolute -right-12 -top-12 w-64 h-64 rounded-full bg-slate-100 pointer-events-none blur-2xl" />
        <div className="flex flex-col z-10">
          <h1 className="font-headline text-2xl lg:text-3xl font-extrabold text-[#0b1f3a] tracking-tight">
            {pageTitle}
          </h1>
          <p className="text-sm text-slate-500 mt-1 max-w-3xl leading-relaxed">
            {pageSubtitle}
          </p>
        </div>
      </div>

      {/* Real KPI Cards Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {/* KPI 1: Total de Turmas */}
        <div className="relative bg-white p-3 rounded-xl border border-slate-200 shadow-xs flex flex-col justify-between overflow-hidden">
          <div className="absolute top-0 left-0 right-0 h-1 bg-[#0b1f3a]" />
          <div className="flex items-start justify-between">
            <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">
              Total de Turmas
            </span>
            <div className="w-7 h-7 rounded-lg bg-slate-100 flex items-center justify-center text-[#0b1f3a]">
              <span className="material-symbols-outlined text-[18px]">meeting_room</span>
            </div>
          </div>
          <div className="mt-2 flex flex-col">
            <span className="font-headline text-xl font-extrabold text-[#0b1f3a] leading-tight">
              {totalTurmas}
            </span>
            <div className="flex items-center gap-1.5 mt-1 text-xs text-slate-500">
              <span>{realRooms.length} Salas Físicas</span>
            </div>
          </div>
          <div className="mt-2 pt-1.5 border-t border-slate-100 flex items-center justify-between text-xs text-slate-500">
            <span>Manhã: {morningCount}</span>
            <span>Tarde: {afternoonCount}</span>
          </div>
        </div>

        {/* KPI 2: Cursos & Disciplinas */}
        <div className="relative bg-white p-3 rounded-xl border border-slate-200 shadow-xs flex flex-col justify-between overflow-hidden">
          <div className="absolute top-0 left-0 right-0 h-1 bg-[#4d5f7d]" />
          <div className="flex items-start justify-between">
            <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">
              Total de Disciplinas
            </span>
            <div className="w-7 h-7 rounded-lg bg-slate-100 flex items-center justify-center text-[#0b1f3a]">
              <span className="material-symbols-outlined text-[18px]">auto_stories</span>
            </div>
          </div>
          <div className="mt-2 flex flex-col">
            <span className="font-headline text-xl font-extrabold text-[#0b1f3a] leading-tight">
              {totalDisciplinas}
            </span>
            <div className="flex items-center gap-1.5 mt-1 text-xs text-slate-500">
              <span className="font-semibold text-[#0b1f3a]">{totalCursos}  Cursos Cadastrados</span>
            </div>
          </div>
          <div className="mt-2 pt-1.5 border-t border-slate-100 flex items-center justify-between text-xs text-slate-500">
            <span>Total de Alunos: {totalStudentsCount}</span>
          </div>
        </div>

        {/* KPI 3: Ocupação Média de Salas */}
        <div className="relative bg-white p-3 rounded-xl border border-slate-200 shadow-xs flex flex-col justify-between overflow-hidden">
          <div className="absolute top-0 left-0 right-0 h-1 bg-[#ac332b]" />
          <div className="flex items-start justify-between">
            <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">
              Ocupação Média de Salas
            </span>
            <div className="w-7 h-7 rounded-lg bg-red-50 flex items-center justify-center text-[#ac332b]">
              <span className="material-symbols-outlined text-[18px]">groups</span>
            </div>
          </div>
          <div className="mt-2 flex flex-col">
            <span className="font-headline text-xl font-extrabold text-[#0b1f3a] leading-tight">
              {avgOccupancyPct}%
            </span>
            <div className="flex items-center gap-1.5 mt-1 text-xs text-slate-600">
              <span className="font-semibold text-slate-800">
                {totalStudentsCount} / {totalCapacity} Lugares
              </span>
            </div>
          </div>
          <div className="w-full bg-slate-100 rounded-full h-1.5 mt-2 overflow-hidden">
            <div
              className="bg-[#ac332b] h-full rounded-full transition-all duration-500"
              style={{ width: `${Math.min(avgOccupancyPct, 100)}%` }}
            />
          </div>
        </div>

        {/* KPI 4: Diretores de Turma */}
        <div className="relative bg-white p-3 rounded-xl border border-slate-200 shadow-xs flex flex-col justify-between overflow-hidden">
          <div className="absolute top-0 left-0 right-0 h-1 bg-[#001a52]" />
          <div className="flex items-start justify-between">
            <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">
              Diretores de Turmas
            </span>
            <div className="w-7 h-7 rounded-lg bg-blue-50 flex items-center justify-center text-[#0b1f3a]">
              <span className="material-symbols-outlined text-[18px]">assignment_ind</span>
            </div>
          </div>
          <div className="mt-2 flex flex-col">
            <div className="flex items-baseline gap-1.5">
              <span className="font-headline text-xl font-extrabold text-[#0b1f3a] leading-tight">
                {allocatedHeadTeachersCount} / {totalTurmas}
              </span>
              <span className="text-xs font-mono text-slate-500 font-bold">
                ({totalTurmas > 0 ? Math.round((allocatedHeadTeachersCount / totalTurmas) * 100) : 0}%)
              </span>
            </div>
            <div className="flex items-center gap-1.5 mt-1 text-xs text-slate-500">
              <span className="font-semibold text-[#0b1f3a]">
                {allocatedHeadTeachersCount === totalTurmas ? 'Alocação Plena' : `${totalTurmas - allocatedHeadTeachersCount} Pendentes`}
              </span>
              <span>•</span>
              <span>{teachersList.length} Professores</span>
            </div>
          </div>
          <div className="mt-2 pt-1.5 border-t border-slate-100 flex items-center justify-between text-xs text-slate-500">
            <span className="flex items-center gap-1.5 font-semibold text-slate-700">
              <span className="w-2 h-2 rounded-full bg-emerald-600" />
              Docentes Ativos
            </span>
            <span className="font-mono text-[11px]">Ano {db.settings?.currentAcademicYear || getFallbackAcademicYear()}</span>
          </div>
        </div>
      </div>

      {/* ========================================================================= */}
      {/* TAB 1: LISTAGEM DE TURMAS EM TABELA (Cabeçalho Azul #0b1f3a) */}
      {/* ========================================================================= */}
      {activeTab === 'turmas' && (
        <div className="flex flex-col gap-4">
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
            <div className="flex items-center gap-2.5">
              <span className="w-2.5 h-2.5 rounded-full bg-[#0b1f3a]" />
              <div>
                <h2 className="font-headline text-lg font-bold text-slate-900 tracking-tight">
                  Turmas Cadastradas
                </h2>
               
              </div>
            </div>

            <div className="flex items-center gap-2">
              <div className="flex items-center gap-1 bg-slate-100 p-0.5 rounded-lg text-[10.5px] font-bold shrink-0">
                <button
                  type="button"
                  onClick={() => setTurmaYearFilter('current')}
                  title="Mostrar apenas turmas do Ano Letivo Vigente"
                  className={`px-2.5 py-1.5 rounded-md transition-colors ${
                    turmaYearFilter === 'current' ? 'bg-[#0b1f3a] text-white shadow-xs' : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  {db.settings?.currentAcademicYear || 'Ano Vigente'}
                </button>
                <button
                  type="button"
                  onClick={() => setTurmaYearFilter('all')}
                  title="Mostrar turmas de todos os anos letivos"
                  className={`px-2.5 py-1.5 rounded-md transition-colors ${
                    turmaYearFilter === 'all' ? 'bg-[#0b1f3a] text-white shadow-xs' : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  Todos os Anos
                </button>
              </div>

              <div className="relative flex items-center border border-slate-400/30 bg-slate-50/60 rounded-none focus-within:border-slate-400/70 focus-within:bg-white transition-colors">
                <span className="material-symbols-outlined ml-2.5 text-slate-400 text-[16px] shrink-0">
                  search
                </span>
                <input
                  value={turmaSearch}
                  onChange={(e) => setTurmaSearch(e.target.value)}
                  className="pl-2 pr-3 py-1.5 bg-transparent border-0 border-none outline-none focus:ring-0 text-slate-800 text-xs w-64 placeholder:text-slate-400"
                  placeholder="Pesquisar turma, curso, sala ou diretor..."
                  type="text"
                />
              </div>

              <button
                onClick={() => acl.guard('turmas.manage', () => setShowNovaTurmaModal(true))}
                {...acl.buttonProps('turmas.manage')}
                className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl bg-[#0b1f3a] hover:bg-[#7a0c0c] active:scale-[0.98] text-white font-bold text-xs transition-all duration-200 shadow-xs cursor-pointer shrink-0"
                type="button"
              >
                <span className="material-symbols-outlined text-[16px]">add</span>
                <span>CADASTRAR</span>
              </button>
            </div>
          </div>

          {/* Tabela de Turmas com Cabeçalho Azul #0b1f3a */}
          <div className="bg-white rounded-2xl border border-slate-200 shadow-xs overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="bg-[#0b1f3a] text-white font-bold text-xs uppercase tracking-wider">
                    <th className="py-3.5 px-4">Turma / Designação</th>
                    <th className="py-3.5 px-4">Classe / Ciclo</th>
                    <th className="py-3.5 px-4">Curso</th>
                    <th className="py-3.5 px-4">Período / Sala</th>
                    <th className="py-3.5 px-4 text-center">Vagas</th>
                    <th className="py-3.5 px-4">Diretor(a) de Turma</th>
                    <th className="py-3.5 px-4">Delegado(a)</th>
                    <th className="py-3.5 px-4 text-right">Ações</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 text-xs text-slate-800">
                  {filteredClasses.length > 0 ? (
                    visibleFilteredClasses.map((cls) => {
                      const capacity = cls.maxCapacity || 30;
                      const students = cls.studentCount || 0;
                      const occupancyPct = capacity > 0 ? Math.round((students / capacity) * 100) : 0;
                      const isMorning = cls.shift === 'Manhã';

                      return (
                        <tr key={cls.id} className="hover:bg-slate-50/80 transition-colors">
                          <td className="py-3 px-4 font-bold text-slate-900">
                            <div className="flex items-center gap-2">
                              <div data-solid-blue="true" className="w-7 h-7 rounded-lg bg-[#12498a] text-white flex items-center justify-center font-bold text-xs shrink-0">
                                {cls.section || 'A'}
                              </div>
                              <span className="font-headline font-bold text-slate-900">{cls.name}</span>
                            </div>
                          </td>

                          <td className="py-3 px-4">
                            <span className="font-semibold text-slate-800 block">{cls.grade}</span>
                            <span className="text-[11px] text-slate-500 block truncate max-w-[170px]">
                              {cls.cycle || 'Ensino Médio'}
                            </span>
                          </td>

                          <td className="py-3 px-4">
                            <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-blue-50 text-[#0b1f3a] font-bold text-[11px]">
                              <span className="material-symbols-outlined text-[14px]">school</span>
                              {cls.area || 'Tronco Comum'}
                            </span>
                          </td>

                          <td className="py-3 px-4">
                            <div className="flex items-center gap-2">
                              <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-semibold ${
                                isMorning ? 'bg-amber-50 text-amber-800' : 'bg-indigo-50 text-indigo-800'
                              }`}>
                                <span className={`material-symbols-outlined text-[13px] ${isMorning ? 'text-amber-500' : 'text-indigo-500'}`}>
                                  {isMorning ? 'wb_sunny' : 'bedtime'}
                                </span>
                                {cls.shift}
                              </span>
                              <span className="font-mono text-slate-700 text-[11px] font-medium">
                                {cls.room || '—'}
                              </span>
                            </div>
                          </td>

                          <td className="py-3 px-4 text-center">
                            <div className="flex flex-col items-center gap-1 min-w-[100px]">
                              <span className="font-mono font-bold text-slate-700 text-[11px]">
                                {students} / {capacity} ({occupancyPct}%)
                              </span>
                              <div className="w-24 bg-slate-100 rounded-full h-1.5 overflow-hidden">
                                <div
                                  className={`h-full rounded-full ${
                                    occupancyPct >= 100 ? 'bg-[#ac332b]' : 'bg-[#0b1f3a]'
                                  }`}
                                  style={{ width: `${Math.min(occupancyPct, 100)}%` }}
                                />
                              </div>
                            </div>
                          </td>

                          <td className="py-3 px-4">
                            <div className="flex items-center gap-2">
                              {(() => {
                                const ht = teachersList.find(
                                  (t) => t.id === cls.headTeacherId || t.name === cls.headTeacherName
                                );
                                if (ht?.avatar) {
                                  return (
                                    <img
                                      src={ht.avatar}
                                      alt={cls.headTeacherName || 'DT'}
                                      className="w-6 h-6 rounded-full object-cover border border-slate-300 shrink-0"
                                      referrerPolicy="no-referrer"
                                    />
                                  );
                                }
                                return (
                                  <div className="w-6 h-6 rounded-full bg-[#0b1f3a] text-white flex items-center justify-center font-bold text-[9px] shrink-0">
                                    {(cls.headTeacherName || 'DT').split(' ').slice(0, 2).map((w) => w[0]).join('')}
                                  </div>
                                );
                              })()}
                              <span className="font-medium text-slate-800 truncate max-w-[150px]">
                                {cls.headTeacherName || 'A designar'}
                              </span>
                            </div>
                          </td>

                          <td className="py-3 px-4 text-slate-700 text-[11px] font-medium">
                            <span className="truncate max-w-[130px] block font-mono">
                              {cls.delegateName || 'A eleger'}
                            </span>
                          </td>

                          <td className="py-3 px-4 text-right">
                            <div className="flex items-center justify-end gap-1">
                              <button
                                onClick={() => setSelectedScheduleClass(cls)}
                                className="p-1.5 hover:bg-slate-100 rounded-lg text-slate-600 hover:text-[#0b1f3a] transition-all active:scale-[0.95]"
                                title="Ver Horário Semanal"
                                type="button"
                              >
                                <span className="material-symbols-outlined text-[18px]">calendar_today</span>
                              </button>
                              <button
                                onClick={() => setSelectedStudentsClass(cls)}
                                className="p-1.5 hover:bg-slate-100 rounded-lg text-slate-600 hover:text-[#0b1f3a] transition-all active:scale-[0.95] cursor-pointer"
                                title="Ver Alunos Matriculados & Lotação"
                                type="button"
                              >
                                <span className="material-symbols-outlined text-[18px]">group</span>
                              </button>
                              <button
                                onClick={() => handleOpenEditClass(cls)}
                                className="p-1.5 hover:bg-slate-100 rounded-lg text-slate-600 hover:text-blue-700 transition-all active:scale-[0.95] cursor-pointer"
                                title="Editar Turma, Turno, Sala e Diretor"
                                type="button"
                              >
                                <span className="material-symbols-outlined text-[18px]">edit</span>
                              </button>
                              <button
                                onClick={() => {
                                  if (onNavigateToPautas) onNavigateToPautas();
                                }}
                                className="p-1.5 hover:bg-slate-100 rounded-lg text-slate-600 hover:text-[#0b1f3a] transition-all active:scale-[0.95] cursor-pointer"
                                title="Pauta de Avaliação"
                                type="button"
                              >
                                <span className="material-symbols-outlined text-[18px]">grading</span>
                              </button>
                              <button
                                onClick={() => setClassToDelete(cls)}
                                className="p-1.5 hover:bg-red-50 rounded-lg text-red-500 hover:text-red-700 transition-all active:scale-[0.95] cursor-pointer"
                                title="Eliminar Turma da Base de Dados"
                                type="button"
                              >
                                <span className="material-symbols-outlined text-[18px]">delete</span>
                              </button>
                            </div>
                          </td>
                        </tr>
                      );
                    })
                  ) : (
                    <tr>
                      <td colSpan={8} className="py-12 text-center text-slate-400">
                        <div className="flex flex-col items-center justify-center gap-3 max-w-md mx-auto">
                          <div className="w-12 h-12 rounded-full bg-blue-50 text-[#0b1f3a] flex items-center justify-center">
                            <span className="material-symbols-outlined text-[28px]">group_add</span>
                          </div>
                          <div className="font-bold text-slate-800 text-sm">
                            {classesList.length === 0 ? 'Nenhuma turma cadastrada na base de dados' : 'Nenhuma turma encontrada com os filtros selecionados'}
                          </div>
                          <p className="text-xs text-slate-500">
                            {classesList.length === 0
                              ? 'A base de dados está limpa e pronta para os seus dados reais. Clique no botão abaixo para adicionar uma turma.'
                              : 'Tente alterar os termos de pesquisa ou o filtro de subsistema.'}
                          </p>
                          {classesList.length === 0 && (
                            <button
                              onClick={() => setShowNovaTurmaModal(true)}
                              className="flex items-center gap-2 px-4 py-2 rounded-xl bg-[#0b1f3a] hover:bg-[#7a0c0c] active:scale-[0.98] text-white font-bold text-xs transition-all shadow-sm cursor-pointer"
                              type="button"
                            >
                              <span className="material-symbols-outlined text-[16px]">add</span>
                              <span>Cadastrar Primeira Turma</span>
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
              <TablePagination total={filteredClasses.length} page={pgFilteredClasses} onPageChange={setPgFilteredClasses} />
            </div>

            <div className="py-3 px-4 bg-slate-50 border-t border-slate-100 flex items-center justify-between text-xs text-slate-500">
              <span className="font-semibold text-slate-700">Ano Letivo {db.settings?.currentAcademicYear || getFallbackAcademicYear()}</span>
            </div>
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* TAB HORÁRIOS: DEFINIR HORÁRIOS POR DISCIPLINA E PERÍODO DE CADA TURMA     */}
      {/* ========================================================================= */}
      {activeTab === 'horarios' && (
        <div className="flex flex-col gap-6">
          {/* Header e Seleção de Turma */}
          <div className="bg-white p-5 rounded-none border border-slate-200 shadow-xs flex flex-col lg:flex-row lg:items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-none bg-[#0b1f3a] text-white flex items-center justify-center shrink-0">
                <span className="material-symbols-outlined text-[24px]">calendar_month</span>
              </div>
              <div>
                
              </div>
            </div>

            {/* Selector de Turma */}
            <div className="flex flex-wrap items-center gap-3">
              <div className="flex items-center gap-2">
                <label className="text-xs font-bold text-slate-700 uppercase tracking-wider">
                  Turma:
                </label>
                <select
                  value={activeTimetableClass?.id || ''}
                  onChange={(e) => {
                    setSelectedTimetableClassId(e.target.value);
                    const chosen = classesList.find((c) => c.id === e.target.value);
                    if (chosen) {
                      setSlotRoom(chosen.room || '');
                    }
                  }}
                  className="px-3 py-2 bg-white border border-slate-300 rounded-none text-xs font-bold text-slate-800 focus:outline-none focus:border-[#0b1f3a]"
                >
                  {classesList.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name} ({c.grade} • {c.shift} • {c.room})
                    </option>
                  ))}
                </select>
              </div>

              {activeTimetableClass && (
                <button
                  type="button"
                  onClick={() => setSelectedScheduleClass(activeTimetableClass)}
                  className="px-3.5 py-2 rounded-none bg-[#0b1f3a] hover:bg-[#7a0c0c] text-white font-bold text-xs uppercase tracking-wider flex items-center gap-1.5 transition-colors cursor-pointer"
                >
                  <span className="material-symbols-outlined text-[16px]">visibility</span>
                  <span>Ver Horário</span>
                </button>
              )}
            </div>
          </div>

          {activeTimetableClass && (
            <>
              {/* Informações da Turma e Ações Rápidas */}
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
                <div className="bg-white p-4 rounded-none border border-slate-200 shadow-xs">
                  <span className="text-[11px] font-bold text-slate-500 uppercase tracking-wider block">Turma / Ciclo</span>
                  <div className="font-headline text-base font-extrabold text-[#0b1f3a] mt-1">
                    {activeTimetableClass.name}
                  </div>
                  <span className="text-xs text-slate-600 font-medium">
                    {activeTimetableClass.grade} • {activeTimetableClass.cycle || 'Ensino Geral'}
                  </span>
                </div>

                <div className="bg-white p-4 rounded-none border border-slate-200 shadow-xs">
                  <span className="text-[11px] font-bold text-slate-500 uppercase tracking-wider block">Período / Sala</span>
                  <div className="font-headline text-base font-extrabold text-[#0b1f3a] mt-1">
                    {activeTimetableClass.shift}
                  </div>
                  <span className="text-xs text-slate-600 font-medium">
                    {activeTimetableClass.room || '—'}
                  </span>
                </div>

                <div className="bg-white p-4 rounded-none border border-slate-200 shadow-xs">
                  <span className="text-[11px] font-bold text-slate-500 uppercase tracking-wider block">Diretor(a) de Turma</span>
                  <div className="font-headline text-base font-extrabold text-[#0b1f3a] mt-1 truncate">
                    {activeTimetableClass.headTeacherName || 'A designar'}
                  </div>
                  <span className="text-xs text-slate-600 font-medium truncate block">
                    Delegado: {activeTimetableClass.delegateName || 'A eleger'}
                  </span>
                </div>

                <div className="bg-white p-4 rounded-none border border-slate-200 shadow-xs flex flex-col justify-between">
                  <div>
                    <span className="text-[11px] font-bold text-slate-500 uppercase tracking-wider block">Tempo Total</span>
                    <div className="font-headline text-base font-extrabold text-[#0b1f3a] mt-1 flex items-center gap-1.5">
                      <span>{(db.timetable || []).filter((t) => String(t.classId) === String(activeTimetableClass.id)).length} Tempos</span>
                    </div>
                  </div>
  
                </div>
              </div>

              {/* Formulário: Alocar / Definir Tempo Lectivo */}
              <div className="bg-white p-5 rounded-none border border-slate-200 shadow-xs">
                <div className="flex items-center gap-2 pb-3 border-b border-slate-200 mb-4">
                  <span className="material-symbols-outlined text-[20px] text-[#0b1f3a]">add_circle</span>
                  <h3 className="font-headline text-sm font-bold text-slate-900 uppercase tracking-wide">
                    Alocar Tempo Lectivo — {activeTimetableClass.name}
                  </h3>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3 items-end">
                  {/* Dia da Semana */}
                  <div>
                    <label className="block font-bold text-slate-700 uppercase tracking-wider text-[11px] mb-1">
                      Dia da Semana
                    </label>
                    <select
                      value={slotDay}
                      onChange={(e) => setSlotDay(e.target.value as any)}
                      className="w-full px-3 py-2 bg-white border border-slate-300 rounded-none text-xs font-bold text-slate-800 focus:outline-none focus:border-[#0b1f3a]"
                    >
                      <option value="Segunda-feira">Segunda-feira</option>
                      <option value="Terça-feira">Terça-feira</option>
                      <option value="Quarta-feira">Quarta-feira</option>
                      <option value="Quinta-feira">Quinta-feira</option>
                      <option value="Sexta-feira">Sexta-feira</option>
                    </select>
                  </div>

                  {/* Horário / Tempo Lectivo */}
                  <div>
                    <label className="block font-bold text-slate-700 uppercase tracking-wider text-[11px] mb-1">
                      Período / Tempo Lectivo
                    </label>
                    <select
                      value={`${slotTimeStart}-${slotTimeEnd}`}
                      onChange={(e) => {
                        const [start, end] = e.target.value.split('-');
                        setSlotTimeStart(start);
                        setSlotTimeEnd(end);
                      }}
                      className="w-full px-3 py-2 bg-white border border-slate-300 rounded-none text-xs font-bold text-slate-800 focus:outline-none focus:border-[#0b1f3a]"
                    >
                      {getStandardSlotsForShift(activeTimetableClass.shift)
                        .filter((s) => !s.isBreak)
                        .map((slot, sIdx) => (
                          <option key={sIdx} value={`${slot.start}-${slot.end}`}>
                            {slot.label}
                          </option>
                        ))}
                    </select>
                  </div>

                  {/* Disciplina */}
                  <div>
                    <SearchableSelect
                      label="Disciplina"
                      options={timetableSubjectOptions}
                      value={slotSubject}
                      onChange={(val) => {
                        setSlotSubject(val);
                        // Sugere automaticamente o docente REAL da disciplina (grelha,
                        // alocação, coordenador ou departamento) em vez de deixar ficar
                        // o primeiro docente da lista / o Diretor de Turma.
                        const subj = subjectsList.find((sb) => sb.name === val) || { name: val };
                        setSlotTeacher(resolveTeacherForSubject(db, subj as any, activeTimetableClass.id));
                      }}
                      placeholder="Selecionar disciplina..."
                      allowCustom={true}
                      emptyMessage="Nenhuma disciplina atribuída a esta turma (preencha a Atribuição na Secretaria Académica)"
                    />
                  </div>

                  {/* Docente */}
                  <div>
                    <SearchableSelect
                      label="Docente / Professor"
                      options={teacherOptionsForSlot}
                      value={slotTeacher}
                      onChange={(val) => {
                        const foundTeacher = teachersList.find((t) => t.id === val || t.name === val);
                        setSlotTeacher(foundTeacher ? foundTeacher.name : val);
                      }}
                      placeholder="Docente titular..."
                      allowCustom={true}
                      emptyMessage="Nenhum docente cadastrado"
                    />
                  </div>

                  {/* Botão de Gravar Tempo */}
                  <div>
                    <AsyncButton
                      type="button"
                      variant="primary"
                      icon="save"
                      loadingText="A gravar no horário..."
                      successText="Operação feita com sucesso!"
                      onAsyncClick={async () => {
                        if (!slotSubject.trim()) return;

                        // Regra: não permitir alocar disciplina num horário que já
                        // tem outra disciplina alocada para esta turma.
                        const conflict = dbService.findTimetableConflict(
                          activeTimetableClass.id,
                          slotDay,
                          slotTimeStart
                        );
                        if (conflict) {
                          showAppAlert(
                            `Não é possível alocar. Já existe a disciplina "${conflict.subject}" ` +
                              `(${conflict.teacherName || 'sem docente'}) alocada em ${conflict.dayOfWeek} ` +
                              `às ${conflict.timeStart}. Remova essa alocação primeiro se quiser substituí-la.`,
                            { title: 'Conflito no Horário', variant: 'error' }
                          );
                          return;
                        }

                        if (!canAssignTeachers) {
                          acl.guard('professores.assign', () => undefined);
                          return;
                        }

                        // Sem docente escolhido, resolve-se pela disciplina. Nunca se
                        // atribui o Diretor de Turma por omissão: o tempo lectivo fica
                        // antes "por atribuir".
                        const teacherName =
                          slotTeacher.trim() ||
                          resolveTeacherForSubject(
                            db,
                            (subjectsList.find((sb) => sb.name === slotSubject.trim()) || { name: slotSubject.trim() }) as any,
                            activeTimetableClass.id
                          );
                        const roomName = slotRoom.trim() || activeTimetableClass.room || '';
                        try {
                          dbService.saveTimetableEntry({
                            classId: activeTimetableClass.id,
                            dayOfWeek: slotDay,
                            timeStart: slotTimeStart,
                            timeEnd: slotTimeEnd,
                            subject: slotSubject.trim(),
                            teacherName,
                            room: roomName
                          });
                          setSlotSubject('');
                        } catch (err: any) {
                          notify.error(err?.message || 'Não foi possível gravar o tempo lectivo: horário já ocupado.', { duration: 0 });
                        }
                      }}
                      className="w-full h-[38px] text-xs font-bold uppercase tracking-wider"
                    >
                      Cadastrar
                    </AsyncButton>
                  </div>
                </div>

                {/* Gerador Automático de Horários — abaixo do botão de Cadastrar.
                    Preenche TODOS os tempos livres da turma de uma só vez, respeitando
                    a carga horária semanal exacta de cada disciplina, distribuindo-a de
                    forma equilibrada de Segunda a Sexta e nunca colocando um docente em
                    conflito com outra turma no mesmo dia/tempo lectivo. */}
                <div className="mt-3 pt-3 border-t border-slate-100 flex flex-col sm:flex-row sm:items-center justify-end gap-2">
                  <span className="text-[11px] text-slate-500 font-medium mr-auto">
                    Gera automaticamente todos os tempos livres desta turma a partir da carga horária.
                  </span>
                  <AsyncButton
                    type="button"
                    variant="primary"
                    icon="auto_awesome"
                    loadingText="A gerar horário automaticamente..."
                    successText="Horário gerado com sucesso!"
                    onAsyncClick={async () => {
                      if (!canAssignTeachers) {
                        acl.guard('professores.assign', () => undefined);
                        return;
                      }
                      if (subjectsList.length === 0) {
                        notify.warn('Não existem disciplinas cadastradas. Registe as disciplinas antes de gerar o horário.');
                        return;
                      }
                      const hasExisting = (db.timetable || []).some(
                        (t) => String(t.classId) === String(activeTimetableClass.id)
                      );
                      if (hasExisting) {
                        // Caixa de confirmação do próprio sistema (não o window.confirm()
                        // nativo do navegador) — mesma identidade visual do resto da app.
                        const confirmed = await showAppConfirm(
                          'Já existem tempos lectivos gravados para esta turma. Gerar automaticamente vai SUBSTITUIR toda a grelha actual desta turma. Deseja continuar?',
                          {
                            title: 'Gerar Horário Automaticamente',
                            variant: 'warning',
                            confirmLabel: 'Substituir e Gerar',
                            cancelLabel: 'Cancelar'
                          }
                        );
                        if (!confirmed) return;
                        // Só limpa a grelha actual desta turma depois de confirmado.
                        dbService.setTimetableForClass(activeTimetableClass.id, []);
                      }

                      const slots = getStandardSlotsForShift(activeTimetableClass.shift)
                        .filter((s) => !s.isBreak)
                        .map((s) => ({ start: s.start, end: s.end }));

                      const { entries, warnings } = generateClassTimetable(
                        db,
                        activeTimetableClass,
                        subjectsList,
                        slots
                      );

                      if (entries.length === 0) {
                        showAppAlert(warnings[0] || 'Não foi possível gerar o horário.', {
                          title: 'Gerador de Horários',
                          variant: 'error'
                        });
                        return;
                      }

                      // Mesma lógica do botão GRAVAR: nunca aloca uma disciplina num
                      // dia/tempo que já esteja ocupado no horário — cada tempo gerado
                      // passa pelo mesmo dbService.saveTimetableEntry (que verifica
                      // findTimetableConflict) usado no Cadastro manual, em vez de
                      // substituir a grelha de uma só vez sem essa verificação.
                      const skipped: string[] = [];
                      entries.forEach((entry) => {
                        try {
                          dbService.saveTimetableEntry({ classId: activeTimetableClass.id, ...entry });
                        } catch (err: any) {
                          skipped.push(`${entry.dayOfWeek} ${entry.timeStart} (${entry.subject})`);
                        }
                      });

                      const allWarnings = [...warnings];
                      if (skipped.length > 0) {
                        allWarnings.push(
                          `Não foi possível gravar ${skipped.length} tempo(s) porque já estavam ocupados no horário: ${skipped.join('; ')}.`
                        );
                      }

                      if (allWarnings.length > 0) {
                        showAppAlert(allWarnings.join('\n\n'), {
                          title: 'Horário gerado com avisos',
                          variant: 'warning'
                        });
                      }
                    }}
                    className="w-full sm:w-auto px-6 h-[42px] text-xs font-bold uppercase tracking-wider shrink-0"
                  >
                    Gerar Horário
                  </AsyncButton>
				     <AsyncButton
                      type="button"
                      variant="outline"
                      loadingText="A limpar matriz..."
                      successText="Operação feita com sucesso!"
                      onAsyncClick={async () => {
                        dbService.setTimetableForClass(activeTimetableClass.id, []);
                      }}
                      data-tone="danger"
                      className="py-1.5 px-2.5 text-white border border-red-600 cursor-pointer"
                      title="Limpar todos os tempos lectivos desta turma"
                      aria-label="Limpar todos os tempos lectivos desta turma"
                    >
                      <span className="material-symbols-outlined text-[18px] text-white">delete</span>
                    </AsyncButton>
                </div>
              </div>

              {/* Tabela Interativa de Horários da Turma */}
              <div className="bg-white rounded-none border border-slate-200 shadow-xs overflow-hidden">
                <div className="p-4 bg-slate-50 border-b border-slate-200 flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="material-symbols-outlined text-[18px] text-[#0b1f3a]">grid_on</span>
                    <h3 className="font-headline text-sm font-bold text-slate-900 uppercase tracking-wide">
                      Grelha Semanal — {activeTimetableClass.name}
                    </h3>
                  </div>
                  <span className="text-xs text-slate-500 font-medium">
                    Clique em <strong className="text-red-700">X</strong> para remover um tempo adicionado
                  </span>
                </div>

                <div className="overflow-x-auto">
                  <table className="w-full text-left border-collapse text-xs">
                    <thead>
                      <tr className="bg-[#0b1f3a] text-white font-bold text-xs uppercase tracking-wider">
                        <th className="py-3 px-4 w-36 border-r border-slate-700">Horário / Tempo</th>
                        <th className="py-3 px-4 border-r border-slate-700">Segunda-feira</th>
                        <th className="py-3 px-4 border-r border-slate-700">Terça-feira</th>
                        <th className="py-3 px-4 border-r border-slate-700">Quarta-feira</th>
                        <th className="py-3 px-4 border-r border-slate-700">Quinta-feira</th>
                        <th className="py-3 px-4">Sexta-feira</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-200">
                      {getStandardSlotsForShift(activeTimetableClass.shift).map((slot, rIdx) => {
                        if (slot.isBreak) {
                          return (
                            <tr key={rIdx} className="bg-amber-50/70 text-amber-900 font-bold">
                              <td className="py-2.5 px-4 font-mono font-bold bg-amber-100/50 border-r border-slate-200">
                                {slot.start} - {slot.end}
                              </td>
                              <td colSpan={5} className="py-2.5 px-4 text-center tracking-wider text-xs uppercase">
                                ✦ INTERVALO / RECREIO DOS ALUNOS ✦
                              </td>
                            </tr>
                          );
                        }

                        const daysList: ('Segunda-feira' | 'Terça-feira' | 'Quarta-feira' | 'Quinta-feira' | 'Sexta-feira')[] = [
                          'Segunda-feira',
                          'Terça-feira',
                          'Quarta-feira',
                          'Quinta-feira',
                          'Sexta-feira'
                        ];

                        return (
                          <tr key={rIdx} className="hover:bg-slate-50/80 transition-colors">
                            <td className="py-3 px-4 font-mono font-bold text-slate-800 bg-slate-50 border-r border-slate-200">
                              <div>{slot.label.split('(')[0]}</div>
                              <div className="text-[10px] text-slate-500 font-normal">{slot.start} - {slot.end}</div>
                            </td>

                            {daysList.map((dayName, dIdx) => {
                              const entry = (db.timetable || []).find(
                                (t) =>
                                  String(t.classId) === String(activeTimetableClass.id) &&
                                  t.dayOfWeek.toLowerCase().startsWith(dayName.toLowerCase().substring(0, 3)) &&
                                  (t.timeStart === slot.start || t.timeStart.startsWith(slot.start.substring(0, 4)))
                              );

                              return (
                                <td key={dIdx} className="py-3 px-3 border-r border-slate-200 align-top">
                                  {entry ? (
                                    <div className="bg-slate-50 border border-slate-200 p-2 relative group hover:border-[#0b1f3a] transition-all">
                                      <button
                                        type="button"
                                        onClick={() =>
                                          runGlobalOperation(
                                            async () => {
                                              dbService.deleteTimetableEntry(entry.id);
                                            },
                                            {
                                              loadingMessage: 'A eliminar tempo lectivo...',
                              requiredRule: 'professores.assign',
                              userRole: currentUserRole,
                                              successMessage: 'Operação feita com sucesso!'
                                            }
                                          )
                                        }
                                        className="absolute top-1 right-1 w-5 h-5 inline-flex items-center justify-center rounded-md bg-[#dc2626] hover:bg-[#b91c1c] !text-white transition-colors cursor-pointer"
                                        title="Remover tempo da base de dados"
                                      >
                                        <span className="material-symbols-outlined text-[14px] !text-white">close</span>
                                      </button>
                                      <div className="font-bold text-[#0b1f3a] text-xs leading-tight pr-4">
                                        {entry.subject}
                                      </div>
                                      <div className="text-[11px] text-slate-600 font-medium mt-1 truncate">
                                        {entry.teacherName}
                                      </div>
                                      <div className="text-[10px] text-slate-400 font-mono mt-0.5">
                                        {entry.room || activeTimetableClass.room}
                                      </div>
                                    </div>
                                  ) : (
                                    <button
                                      type="button"
                                      onClick={() => {
                                        setSlotDay(dayName);
                                        setSlotTimeStart(slot.start);
                                        setSlotTimeEnd(slot.end);
                                      }}
                                      className="w-full py-3 px-2 border border-dashed border-slate-300 hover:border-[#0b1f3a] hover:bg-blue-50/50 text-slate-400 hover:text-[#0b1f3a] text-center text-[11px] font-medium transition-all cursor-pointer"
                                    >
                                      + Alocar
                                    </button>
                                  )}
                                </td>
                              );
                            })}
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>

                <div className="p-4 bg-slate-50 border-t border-slate-200 flex flex-col sm:flex-row items-center justify-between gap-3">
                  <div className="text-xs text-slate-500 font-medium">
                    Horários sincronizados automaticamente.
                  </div>
                </div>
              </div>
            </>
          )}
        </div>
      )}
      {activeTab === 'cursos' && (
        <div className="flex flex-col gap-4">
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
            <div className="flex items-center gap-2.5">
              <span className="w-2.5 h-2.5 rounded-full bg-[#0b1f3a]" />
              <div>
                <h2 className="font-headline text-lg font-bold text-slate-900 tracking-tight">
                  Cursos Cadastrados
                </h2>
               
              </div>
            </div>

            <div className="flex items-center gap-2">
              <div className="relative flex items-center border border-slate-400/30 bg-slate-50/60 rounded-none focus-within:border-slate-400/70 focus-within:bg-white transition-colors">
                <span className="material-symbols-outlined ml-2.5 text-slate-400 text-[16px] shrink-0">
                  search
                </span>
                <input
                  value={cursoSearch}
                  onChange={(e) => setCursoSearch(e.target.value)}
                  className="pl-2 pr-3 py-1.5 bg-transparent border-0 border-none outline-none focus:ring-0 text-slate-800 text-xs w-64 placeholder:text-slate-400"
                  placeholder="Pesquisar curso, código ou coordenador..."
                  type="text"
                />
              </div>

              <button
                onClick={() => acl.guard('turmas.manage', () => setShowNovoCursoModal(true))}
                {...acl.buttonProps('turmas.manage')}
                className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl bg-[#0b1f3a] hover:bg-[#7a0c0c] active:scale-[0.98] text-white font-bold text-xs transition-all duration-200 shadow-xs cursor-pointer shrink-0"
                type="button"
              >
                <span className="material-symbols-outlined text-[16px]">add</span>
                <span>CADASTRAR</span>
              </button>
            </div>
          </div>

          {/* Tabela de Cursos com Cabeçalho Azul #0b1f3a */}
          <div className="bg-white rounded-2xl border border-slate-200 shadow-xs overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="bg-[#0b1f3a] text-white font-bold text-xs uppercase tracking-wider">
                    <th className="py-3.5 px-4 w-28">Código</th>
                    <th className="py-3.5 px-4">Designação Oficial do Curso</th>
                    <th className="py-3.5 px-4">Ciclo / Nível de Ensino</th>
                    <th className="py-3.5 px-4 text-center">Duração</th>
                    <th className="py-3.5 px-4">Docente Coordenador</th>
                    <th className="py-3.5 px-4 text-center">Turmas Vinculadas</th>
                    <th className="py-3.5 px-4 text-center">Estado</th>
                    <th className="py-3.5 px-4 text-right">Ações</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 text-xs text-slate-800">
                  {filteredCourses.length > 0 ? (
                    visibleFilteredCourses.map((crs) => {
                      const linkedClasses = classesList.filter(
                        (c) => c.area && (c.area.toLowerCase().includes(crs.name.toLowerCase()) || crs.name.toLowerCase().includes(c.area.toLowerCase()))
                      );

                      return (
                        <tr key={crs.id} className="hover:bg-slate-50/80 transition-colors">
                          <td className="py-3 px-4 font-mono font-bold text-[#0b1f3a] text-[13px]">
                            {crs.code}
                          </td>

                          <td className="py-3 px-4 font-bold text-slate-900">
                            <div>
                              <span>{crs.name}</span>
                              {crs.description && (
                                <span className="block text-[11px] font-normal text-slate-500 mt-0.5 line-clamp-1">
                                  {crs.description}
                                </span>
                              )}
                            </div>
                          </td>

                          <td className="py-3 px-4">
                            <span className="px-2.5 py-0.5 rounded-full bg-slate-100 text-slate-700 font-medium text-[11px]">
                              {crs.cycle}
                            </span>
                          </td>

                          <td className="py-3 px-4 text-center font-mono font-semibold text-slate-700">
                            {crs.durationYears || 3} Anos Letivos
                          </td>

                          <td className="py-3 px-4">
                            <div className="flex items-center gap-2">
                              <div className="w-6 h-6 rounded-full bg-[#0b1f3a] text-white flex items-center justify-center font-bold text-[9px] shrink-0">
                                {(crs.coordinatorName || 'CD').split(' ').slice(0, 2).map((w) => w[0]).join('')}
                              </div>
                              <span className="font-medium text-slate-800">
                                {crs.coordinatorName || 'Coordenação'}
                              </span>
                            </div>
                          </td>

                          <td className="py-3 px-4 text-center font-mono font-bold text-[#0b1f3a]">
                            {linkedClasses.length} Turmas
                          </td>

                          <td className="py-3 px-4 text-center">
                            <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-emerald-50 text-emerald-800 border border-emerald-200">
                              <span className="w-1.5 h-1.5 rounded-full bg-emerald-600" />
                              {crs.status === 'ativo' ? 'Ativo' : 'Inativo'}
                            </span>
                          </td>

                          <td className="py-3 px-4 text-right">
                            <div className="flex items-center justify-end gap-1">
                              <button
                                onClick={() => handleOpenEditCourse(crs)}
                                className="p-1.5 hover:bg-slate-100 rounded-lg text-slate-600 hover:text-blue-700 transition-all active:scale-[0.95] cursor-pointer"
                                title="Editar Curso Curricular"
                                type="button"
                              >
                                <span className="material-symbols-outlined text-[18px]">edit</span>
                              </button>
                              <button
                                onClick={() => setCourseToDelete(crs)}
                                className="p-1.5 hover:bg-red-50 rounded-lg text-red-500 hover:text-red-700 transition-all active:scale-[0.95] cursor-pointer"
                                title="Eliminar Curso da Base de Dados"
                                type="button"
                              >
                                <span className="material-symbols-outlined text-[18px]">delete</span>
                              </button>
                            </div>
                          </td>
                        </tr>
                      );
                    })
                  ) : (
                    <tr>
                      <td colSpan={8} className="py-12 text-center text-slate-400">
                        <div className="flex flex-col items-center justify-center gap-3 max-w-md mx-auto">
                          <div className="w-12 h-12 rounded-full bg-blue-50 text-[#0b1f3a] flex items-center justify-center">
                            <span className="material-symbols-outlined text-[28px]">school</span>
                          </div>
                          <div className="font-bold text-slate-800 text-sm">
                            {coursesList.length === 0 ? 'Nenhum curso cadastrado na base de dados' : 'Nenhum curso encontrado na pesquisa'}
                          </div>
                          <p className="text-xs text-slate-500">
                            {coursesList.length === 0
                              ? ''
                              : 'Verifique a grafia do nome ou código do curso procurado.'}
                          </p>
                          {coursesList.length === 0 && (
                            <button
                              onClick={() => setShowNovoCursoModal(true)}
                              className="flex items-center gap-2 px-4 py-2 rounded-xl bg-[#0b1f3a] hover:bg-[#7a0c0c] active:scale-[0.98] text-white font-bold text-xs transition-all shadow-sm cursor-pointer"
                              type="button"
                            >
                              <span className="material-symbols-outlined text-[16px]">add</span>
                              <span>Criar Primeiro Curso</span>
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
              <TablePagination total={filteredCourses.length} page={pgFilteredCourses} onPageChange={setPgFilteredCourses} />
            </div>

            <div className="py-3 px-4 bg-slate-50 border-t border-slate-100 flex items-center justify-between text-xs text-slate-500">
              <span>Total de {filteredCourses.length} cursos homologados</span>
            </div>
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* TAB 3: MATRIZ DE DISCIPLINAS EM TABELA (Cabeçalho Azul #0b1f3a) */}
      {/* ========================================================================= */}
      {activeTab === 'matriz' && (
        <div className="flex flex-col gap-4" id="matriz-curricular">
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
            <div className="flex items-center gap-2.5">
              <span className="w-2.5 h-2.5 rounded-full bg-[#ac332b]" />
              <div>
                <h2 className="font-headline text-lg font-bold text-slate-900 tracking-tight">
                  Disciplinas Cadastradas
                </h2>
                
              </div>
            </div>

            <div className="flex items-center gap-2">
              <div className="relative flex items-center border border-slate-400/30 bg-slate-50/60 rounded-none focus-within:border-slate-400/70 focus-within:bg-white transition-colors">
                <span className="material-symbols-outlined ml-2.5 text-slate-400 text-[16px] shrink-0">
                  search
                </span>
                <input
                  value={disciplineSearch}
                  onChange={(e) => {
                    setDisciplineSearch(e.target.value);
                    setDisciplinePage(1);
                  }}
                  className="pl-2 pr-3 py-1.5 bg-transparent border-0 border-none outline-none focus:ring-0 text-slate-800 text-xs w-56 placeholder:text-slate-400"
                  placeholder="Filtrar disciplina ou código..."
                  type="text"
                />
              </div>

              <button
                onClick={() => {
                  setNewSubName('');
                  setNewSubCode('');
                  setDuplicateWarning(false);
                  if (!acl.can('turmas.manage')) {
                    acl.guard('turmas.manage', () => undefined);
                    return;
                  }
                  setShowNovaDisciplinaModal(true);
                }}
                className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl bg-[#0b1f3a] hover:bg-[#7a0c0c] active:scale-[0.98] text-white font-bold text-xs transition-all duration-200 shadow-xs cursor-pointer shrink-0"
                type="button"
              >
                <span className="material-symbols-outlined text-[16px]">add</span>
                <span>CADASTRAR</span>
              </button>

              <button
                onClick={() => setShowDisciplinasPrintModal(true)}
                className="px-3.5 py-1.5 bg-white hover:bg-slate-50 text-slate-800 font-bold text-xs rounded-xl shadow-xs border border-slate-200 flex items-center gap-1.5 transition-colors cursor-pointer active:scale-[0.98]"
                type="button"
              >
                <span className="material-symbols-outlined text-[16px] text-[#ac332b]">print</span>
                <span>IMPRIMIR</span>
              </button>
            </div>
          </div>

          {/* Data Table Container com Cabeçalho Azul #0b1f3a */}
          <div className="bg-white rounded-2xl border border-slate-200 shadow-xs overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="bg-[#0b1f3a] text-white font-bold text-xs uppercase tracking-wider">
                    <th className="py-3.5 px-4 w-28">Código</th>
                    <th className="py-3.5 px-4">Nome da Disciplina</th>
                    <th className="py-3.5 px-4">Área</th>
                    <th className="py-3.5 px-4 text-center">Carga Semanal</th>
                    <th className="py-3.5 px-4">Docente Coordenador</th>
                    <th className="py-3.5 px-4 text-center">Planificação Pedagógica</th>
                    <th className="py-3.5 px-4 text-right">Ações</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 text-xs text-slate-800">
                  {paginatedSubjects.length > 0 ? (
                    paginatedSubjects.map((sub) => {
                      const isApproved = sub.status === 'Aprovada' || !sub.status;
                      const avatarInitials =
                        sub.coordinatorAvatar ||
                        (sub.coordinatorName
                          ? sub.coordinatorName.split(' ').slice(0, 2).map((w) => w[0]).join('')
                          : 'DC');

                      return (
                        <tr key={sub.id} className="hover:bg-slate-50/80 transition-colors">
                          <td className="py-3.5 px-4 font-mono text-[13px] font-bold text-[#0b1f3a]">
                            {sub.code}
                          </td>
                          <td className="py-3.5 px-4 font-semibold text-slate-900">
                            {sub.name}
                            <span className="block text-slate-500 font-normal text-[11px] mt-0.5">
                              {sub.description || 'Unidade Curricular da Matriz Oficial'}
                            </span>
                          </td>
                          <td className="py-3.5 px-4">
                            <span className="text-[11px] font-medium px-2.5 py-0.5 rounded-full bg-slate-100 text-slate-700">
                              {sub.area || 'Tronco Comum'}
                            </span>
                          </td>
                          <td className="py-3.5 px-4 text-center font-mono font-semibold text-slate-700">
                            {sub.weeklyHours} Tempos ({sub.weeklyHours * 45} min)
                          </td>
                          <td className="py-3.5 px-4">
                            <div className="flex items-center gap-2">
                              {(() => {
                                const coordTeacher = teachersList.find(
                                  (t) => t.name === sub.coordinatorName
                                );
                                const photo =
                                  coordTeacher?.avatar ||
                                  (sub.coordinatorAvatar &&
                                  (sub.coordinatorAvatar.startsWith('http') ||
                                    sub.coordinatorAvatar.startsWith('data:'))
                                    ? sub.coordinatorAvatar
                                    : null);
                                if (photo) {
                                  return (
                                    <img
                                      src={photo}
                                      alt={sub.coordinatorName || 'DC'}
                                      className="w-6 h-6 rounded-full object-cover border border-slate-300 shrink-0"
                                      referrerPolicy="no-referrer"
                                    />
                                  );
                                }
                                return (
                                  <div className="w-6 h-6 rounded-full bg-[#0b1f3a] text-white flex items-center justify-center font-bold text-[9px] shrink-0">
                                    {avatarInitials}
                                  </div>
                                );
                              })()}
                              <span className="font-medium text-slate-800">
                                {sub.coordinatorName || 'Prof. Coordenador'}
                              </span>
                            </div>
                          </td>
                          <td className="py-3.5 px-4 text-center">
                            <span
                              className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-semibold ${
                                isApproved
                                  ? 'bg-emerald-50 text-emerald-800 border border-emerald-200'
                                  : 'bg-amber-50 text-amber-800 border border-amber-200'
                              }`}
                            >
                              <span className={`w-1.5 h-1.5 rounded-full ${isApproved ? 'bg-emerald-600' : 'bg-amber-600'}`} />
                              {sub.status || 'Aprovada'}
                            </span>
                          </td>
                          <td className="py-3.5 px-4 text-right">
                            <div className="flex items-center justify-end gap-1">
                              {((sub.keySubsystems && sub.keySubsystems.length > 0) || (sub.keyCourses && sub.keyCourses.length > 0)) && (
                                <button
                                  onClick={() => setKeyInfoSubject(sub)}
                                  className="p-1.5 hover:bg-rose-50 rounded-lg text-[#7a0c0c] transition-all active:scale-[0.95] cursor-pointer"
                                  title={`Disciplina chave — ver onde é chave (${describeKeySubject(sub)})`}
                                  aria-label="Ver cursos e turmas onde é disciplina chave"
                                  type="button"
                                >
                                  <span className="material-symbols-outlined text-[18px]">key</span>
                                </button>
                              )}
                              <button
                                onClick={() => handleOpenEditSubject(sub)}
                                className="p-1.5 hover:bg-slate-100 rounded-lg text-slate-600 hover:text-blue-700 transition-all active:scale-[0.95] cursor-pointer"
                                title="Editar Disciplina"
                                type="button"
                              >
                                <span className="material-symbols-outlined text-[18px]">edit</span>
                              </button>
                              <button
                                onClick={() => setSubjectToDelete(sub)}
                                className="p-1.5 hover:bg-red-50 rounded-lg text-red-500 hover:text-red-700 transition-all active:scale-[0.95] cursor-pointer"
                                title="Eliminar Disciplina da Matriz"
                                type="button"
                              >
                                <span className="material-symbols-outlined text-[18px]">delete</span>
                              </button>
                            </div>
                          </td>
                        </tr>
                      );
                    })
                  ) : (
                    <tr>
                      <td colSpan={7} className="py-12 text-center text-slate-400">
                        <div className="flex flex-col items-center justify-center gap-3 max-w-md mx-auto">
                          <div className="w-12 h-12 rounded-full bg-blue-50 text-[#0b1f3a] flex items-center justify-center">
                            <span className="material-symbols-outlined text-[28px]">library_add</span>
                          </div>
                          <div className="font-bold text-slate-800 text-sm">
                            {subjectsList.length === 0 ? 'Nenhuma disciplina cadastrada na base de dados' : 'Nenhuma disciplina curricular encontrada'}
                          </div>
                          <p className="text-xs text-slate-500">
                            {subjectsList.length === 0
                              ? 'A matriz de disciplinas está limpa e pronta para os seus dados reais com geração automática de código (ex: MAT01, MAT02).'
                              : 'Verifique o filtro ou pesquise por outro termo.'}
                          </p>
                          {subjectsList.length === 0 && (
                            <button
                              onClick={() => {
                                setNewSubName('');
                                setNewSubCode('');
                                setShowNovaDisciplinaModal(true);
                              }}
                              className="flex items-center gap-2 px-4 py-2 rounded-xl bg-[#0b1f3a] hover:bg-[#7a0c0c] active:scale-[0.98] text-white font-bold text-xs transition-all shadow-sm cursor-pointer"
                              type="button"
                            >
                              <span className="material-symbols-outlined text-[16px]">add</span>
                              <span>Cadastrar Primeira Disciplina</span>
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>

            {/* Table Footer / Pagination */}
            <div className="py-3 px-4 bg-white border-t border-slate-100 flex flex-col sm:flex-row items-center justify-between text-xs text-slate-500 gap-2">
              <span>
                Mostrando {Math.min(filteredSubjects.length, itemsPerPage)} de {filteredSubjects.length} disciplinas curriculares registadas
              </span>
              <div className="flex items-center gap-1">
                <button
                  onClick={() => setDisciplinePage((p) => Math.max(1, p - 1))}
                  disabled={disciplinePage <= 1}
                  className="p-1.5 rounded-lg hover:bg-slate-100 text-slate-700 disabled:opacity-30 transition-all active:scale-[0.95] cursor-pointer"
                  type="button"
                >
                  <span className="material-symbols-outlined text-[18px]">chevron_left</span>
                </button>
                {Array.from({ length: totalSubjectPages }, (_, i) => i + 1).map((pageNum) => (
                  <button
                    key={pageNum}
                    onClick={() => setDisciplinePage(pageNum)}
                    className={`px-2.5 py-1 rounded-lg text-xs font-bold transition-all active:scale-[0.95] cursor-pointer ${
                      disciplinePage === pageNum
                        ? 'bg-[#0b1f3a] text-white shadow-xs'
                        : 'hover:bg-slate-100 text-slate-700'
                    }`}
                    type="button"
                  >
                    {pageNum}
                  </button>
                ))}
                <button
                  onClick={() => setDisciplinePage((p) => Math.min(totalSubjectPages, p + 1))}
                  disabled={disciplinePage >= totalSubjectPages}
                  className="p-1.5 rounded-lg hover:bg-slate-100 text-slate-700 disabled:opacity-30 transition-all active:scale-[0.95] cursor-pointer"
                  type="button"
                >
                  <span className="material-symbols-outlined text-[18px]">chevron_right</span>
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* MODAL: RESUMO DE SALAS (REAL DA BASE DE DADOS) */}
      {/* ========================================================================= */}
      {/* ========================================================================= */}
      {/* TAB 5: MAPA DE SALAS (Ocupação Real de Salas) */}
      {/* ========================================================================= */}
      {activeTab === 'salas' && (
        <div className="flex flex-col gap-4">
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
            <div className="flex items-center gap-2.5">
              <span className="w-2.5 h-2.5 rounded-full bg-[#0b1f3a]" />
              <div>
                <h2 className="font-headline text-lg font-bold text-slate-900 tracking-tight">
                  Mapeamento de Vagas
                </h2>
               
              </div>
            </div>
          </div>

          <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-xs">
            <div data-gr-cards className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 text-xs">
              {realRooms.map((room, idx) => {
                const isOccupiedMorning = Boolean(room.morningClass);
                const isOccupiedAfternoon = Boolean(room.afternoonClass);
                return (
                  <div key={idx} className="p-3.5 bg-slate-50 border border-slate-200 flex flex-col gap-1.5">
                    <div className="flex justify-between items-center">
                      <span className="font-bold text-slate-900">{room.name}</span>
                      <span
                        className={`w-2.5 h-2.5 rounded-full ${
                          isOccupiedMorning && isOccupiedAfternoon
                            ? 'bg-[#ac332b]'
                            : isOccupiedMorning || isOccupiedAfternoon
                            ? 'bg-amber-500'
                            : 'bg-emerald-500'
                        }`}
                        title={
                          isOccupiedMorning && isOccupiedAfternoon
                            ? 'Ocupada Manhã e Tarde'
                            : isOccupiedMorning
                            ? 'Ocupada na Manhã'
                            : isOccupiedAfternoon
                            ? 'Ocupada na Tarde'
                            : 'Disponível'
                        }
                      />
                    </div>
                    <span className="text-[11px] text-slate-500">Capacidade: {room.capacity} Lugares</span>
                    <div className="text-[11px] text-slate-700 flex flex-col gap-0.5">
                      <span>Manhã: <strong>{room.morningClass?.name || 'Livre'}</strong></span>
                      <span>Tarde: <strong>{room.afternoonClass?.name || 'Livre'}</strong></span>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* MODAL: CRIAR NOVA TURMA */}
      {/* ========================================================================= */}
      {showNovaTurmaModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs animate-in fade-in">
          <div className="bg-white w-full max-w-lg rounded-none shadow-2xl overflow-hidden border border-slate-400 max-h-[90vh] flex flex-col">
            <FormModalHeader
              title="Criar Nova Turma"
              subtitle="Registo de turma e atribuição do responsável da turma"
              icon="group_add"
              onClose={() => setShowNovaTurmaModal(false)}
            />

            <form
              onSubmit={(e) => {
                e.preventDefault();
              }}
              className="p-6 space-y-4 text-xs overflow-y-auto"
            >
              <div>
                <label className="block font-bold text-slate-700 uppercase tracking-wider mb-1">
                  Nome da Turma <span className="text-red-500">*</span>
                </label>
                <input
                  type="text"
                  required
                  value={newClassName}
                  onChange={(e) => setNewClassName(e.target.value)}
                  placeholder="ex: 10ª Classe • Turma A"
                  className="w-full px-3 py-2 bg-white border border-slate-300 rounded-none focus:border-[#0b1f3a] focus:ring-1 focus:ring-[#0b1f3a] focus:outline-none text-xs font-semibold text-slate-800"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-bold text-slate-700 uppercase tracking-wider mb-1">
                    Classe / Ano
                  </label>
                  <select
                    value={newClassGrade}
                    onChange={(e) => {
                      const selectedG = e.target.value;
                      setNewClassGrade(selectedG);
                    }}
                    className="w-full px-3 py-2 bg-white border border-slate-300 rounded-none focus:border-[#0b1f3a] focus:ring-1 focus:ring-[#0b1f3a] focus:outline-none text-xs font-semibold text-slate-800"
                  >
                    {activeSubsystems.map((sub) => (
                      <optgroup key={sub.id} label={`${sub.fullName}`}>
                        {sub.grades.map((g) => (
                          <option key={g} value={g}>
                            {g}
                          </option>
                        ))}
                      </optgroup>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block font-bold text-slate-700 uppercase tracking-wider mb-1">
                    Secção / Turma
                  </label>
                  <input
                    type="text"
                    required
                    value={newClassSection}
                    onChange={(e) => {
                      const sec = e.target.value;
                      setNewClassSection(sec);
                      setNewClassName(generateSuggestedClassName(newClassGrade, sec, newClassArea));
                    }}
                    placeholder="ex: A, B, C..."
                    className="w-full px-3 py-2 bg-white border border-slate-300 rounded-none focus:border-[#0b1f3a] focus:ring-1 focus:ring-[#0b1f3a] focus:outline-none text-xs text-slate-800"
                  />
                </div>
              </div>

              {/* CURSO / ÁREA CURRICULAR COM BUSCA E OPÇÃO DE CRIAR CURSO */}
              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="block font-bold text-slate-700 uppercase tracking-wider text-[11px]">
                    {isUpperLevel ? 'Curso / Especialidade Curricular' : 'Área Curricular'}
                  </label>
                  {isUpperLevel && (
                    <button
                      type="button"
                      onClick={() => setShowNovoCursoModal(true)}
                      className="text-[#0b1f3a] font-bold text-[11px] hover:underline flex items-center gap-1 cursor-pointer"
                    >
                      <span className="material-symbols-outlined text-[14px]">add</span>
                      <span>+ Novo Curso</span>
                    </button>
                  )}
                </div>

                <SearchableSelect
                  options={courseOptions}
                  value={newClassArea}
                  onChange={(val) => {
                    setNewClassArea(val);
                    setNewClassName(generateSuggestedClassName(newClassGrade, newClassSection, val));
                  }}
                  placeholder={
                    isUpperLevel
                      ? 'Pesquisar curso oficial da 10ª classe ao superior...'
                      : 'Selecione a área curricular...'
                  }
                  allowCustom={true}
                  helperText={
                    isUpperLevel
                      ? 'Apresenta os cursos técnicos e médios homologados para esta classe.'
                      : undefined
                  }
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-bold text-slate-700 uppercase tracking-wider mb-1">
                    Turno
                  </label>
                  <select
                    value={newClassShift}
                    onChange={(e) => setNewClassShift(e.target.value as any)}
                    className="w-full px-3 py-2 bg-white border border-slate-300 rounded-none focus:border-[#0b1f3a] focus:ring-1 focus:ring-[#0b1f3a] focus:outline-none text-xs text-slate-800"
                  >
                    <option value="Manhã">Manhã (07:30 - 12:30)</option>
                    <option value="Tarde">Tarde (13:00 - 18:00)</option>
                    <option value="Integral">Integral</option>
                  </select>
                </div>

                <div>
                  <label className="block font-bold text-slate-700 uppercase tracking-wider mb-1">
                    Sala de Aulas
                  </label>
                  <input
                    type="text"
                    required
                    value={newClassRoom}
                    onChange={(e) => setNewClassRoom(e.target.value)}
                    placeholder="ex: Sala B-104"
                    className="w-full px-3 py-2 bg-white border border-slate-300 rounded-none focus:border-[#0b1f3a] focus:ring-1 focus:ring-[#0b1f3a] focus:outline-none text-xs text-slate-800"
                  />
                </div>
              </div>

              <div>
                <label className="block font-bold text-slate-700 uppercase tracking-wider mb-1">
                  Lotação Máxima (Alunos)
                </label>
                <input
                  type="number"
                  min="10"
                  max="60"
                  required
                  value={newClassCapacity}
                  onChange={(e) => setNewClassCapacity(Number(e.target.value))}
                  className="w-full px-3 py-2 bg-white border border-slate-300 rounded-none focus:border-[#0b1f3a] focus:ring-1 focus:ring-[#0b1f3a] focus:outline-none text-xs text-slate-800"
                />
              </div>

              {/* DIRETOR DE TURMA COM BUSCA AUTOMÁTICA DE PROFESSORES */}
              <div>
                <SearchableSelect
                  label="Diretor(a) de Turma"
                  options={teacherOptions}
                  value={newClassHeadTeacherId}
                  onChange={(val) => setNewClassHeadTeacherId(val)}
                  placeholder="Pesquisar professor por nome, agente ou departamento..."
                  emptyMessage="Nenhum professor encontrado com esse nome"
                  helperText=""
                />
              </div>

              {/* DELEGADO DE TURMA COM BUSCA AUTOMÁTICA DE ALUNOS NA TURMA/ANO */}
              <div>
                <SearchableSelect
                  label="Delegado(a) de Turma"
                  options={newClassStudentOptions}
                  value={newClassDelegate}
                  onChange={(val) => {
                    const found = studentsList.find((s) => s.id === val || s.name === val);
                    setNewClassDelegate(found ? found.name : val);
                  }}
                  placeholder="Pesquisar aluno desta turma/ano ou digite manualmente..."
                  allowCustom={true}
                  emptyMessage="Nenhum aluno encontrado para este ano/turma"
                  helperText=""
                />
              </div>

              <div className="pt-3 border-t border-slate-200 flex items-center justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setShowNovaTurmaModal(false)}
                  className="px-4 py-2 rounded-none bg-slate-200 hover:bg-slate-300 text-slate-800 font-bold text-xs border border-slate-300 transition-colors cursor-pointer"
                >
                  Cancelar
                </button>
                <AsyncButton
                  type="button"
                  variant="primary"
                  icon="save"
                  loadingText="A cadastrar turma..."
                  successText="Operação feita com sucesso!"
                  onAsyncClick={async () => {
                    if (!newClassName.trim()) return;
                    const teacherObj = teachersList.find((t) => t.id === newClassHeadTeacherId) || teachersList[0];
                    const resolvedCycle = getCycleForGrade(newClassGrade);
                    dbService.addClass({
                      name: newClassName.trim(),
                      grade: newClassGrade,
                      section: newClassSection.trim().toUpperCase(),
                      cycle: resolvedCycle,
                      area: newClassArea,
                      shift: newClassShift,
                      room: newClassRoom.trim(),
                      studentCount: 0,
                      maxCapacity: Number(newClassCapacity) || 30,
                      headTeacherId: teacherObj ? teacherObj.id : '',
                      headTeacherName: teacherObj ? teacherObj.name : 'A designar',
                      delegateName: newClassDelegate.trim() || 'A eleger pela turma',
                      academicYear: db.settings?.currentAcademicYear || getFallbackAcademicYear()
                    });
                  }}
                  onSuccessComplete={() => setShowNovaTurmaModal(false)}
                >
                  CADASTRAR
                </AsyncButton>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* MODAL: CRIAR NOVO CURSO (10.ª CLASSE AO ENSINO SUPERIOR) */}
      {/* ========================================================================= */}
      {showNovoCursoModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs animate-in fade-in">
          <div className="bg-white w-full max-w-lg rounded-none shadow-2xl overflow-hidden border border-slate-400 max-h-[90vh] flex flex-col">
            <FormModalHeader
              title="Criar Novo Curso"
              subtitle="10.ª Classe ao Ensino Superior"
              icon="school"
              onClose={() => setShowNovoCursoModal(false)}
            />

            <form
              onSubmit={(e) => e.preventDefault()}
              className="p-6 space-y-4 text-xs overflow-y-auto"
            >
              <div>
                <label className="block font-bold text-slate-700 uppercase tracking-wider mb-1">
                  Designação do Curso <span className="text-red-500">*</span>
                </label>
                <input
                  type="text"
                  required
                  value={newCourseName}
                  onChange={(e) => handleCourseNameChange(e.target.value)}
                  placeholder="ex: Ciências Físicas e Biológicas, Técnico de Informática..."
                  className="w-full px-3 py-2 bg-white border border-slate-300 rounded-none focus:border-[#0b1f3a] focus:ring-1 focus:ring-[#0b1f3a] focus:outline-none text-xs font-semibold text-slate-800"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-bold text-slate-700 uppercase tracking-wider mb-1">
                    Sigla / Código <span className="text-red-500">*</span>
                  </label>
                  <input
                    type="text"
                    required
                    value={newCourseCode}
                    onChange={(e) => setNewCourseCode(e.target.value.toUpperCase())}
                    placeholder="ex: CFB, TINF, DIR"
                    className="w-full px-3 py-2 bg-white border border-slate-300 rounded-none focus:border-[#0b1f3a] focus:ring-1 focus:ring-[#0b1f3a] focus:outline-none text-xs font-mono font-bold text-slate-800"
                  />
                </div>

                <div>
                  <label className="block font-bold text-slate-700 uppercase tracking-wider mb-1">
                    Nível / Subsistema
                  </label>
                  <select
                    value={newCourseLevel}
                    onChange={(e) => setNewCourseLevel(e.target.value as any)}
                    className="w-full px-3 py-2 bg-white border border-slate-300 rounded-none focus:border-[#0b1f3a] focus:ring-1 focus:ring-[#0b1f3a] focus:outline-none text-xs font-semibold text-slate-800"
                  >
                    <option value="secundario_2">II Ciclo / Ensino Médio (10ª - 13ª)</option>
                    <option value="superior">Ensino Superior (Licenciatura/Bacharelato)</option>
                  </select>
                </div>
              </div>

              <div>
                <label className="block font-bold text-slate-700 uppercase tracking-wider mb-1">
                  Duração Curricular (Anos)
                </label>
                <input
                  type="number"
                  min="1"
                  max="6"
                  required
                  value={newCourseDuration}
                  onChange={(e) => setNewCourseDuration(Number(e.target.value))}
                  className="w-full px-3 py-2 bg-white border border-slate-300 rounded-none focus:border-[#0b1f3a] focus:ring-1 focus:ring-[#0b1f3a] focus:outline-none text-xs font-mono font-bold text-slate-800"
                />
              </div>

              {/* COORDENADOR DE CURSO COM BUSCA AUTOMÁTICA DE PROFESSORES */}
              <div>
                <SearchableSelect
                  label="Docente Coordenador do Curso"
                  options={teacherOptions}
                  value={newCourseCoordinator}
                  onChange={(val, opt) => setNewCourseCoordinator(opt?.label || val)}
                  placeholder="Pesquisar professor cadastrado para coordenar o curso..."
                  emptyMessage="Nenhum professor encontrado"
                />
              </div>

              {renderLinkedClassesPicker(newCourseClassIds, setNewCourseClassIds, newCourseName.trim())}

              <div>
                <label className="block font-bold text-slate-700 uppercase tracking-wider mb-1">
                  Perfil de Saída / Descrição Curricular
                </label>
                <textarea
                  rows={2}
                  value={newCourseDescription}
                  onChange={(e) => setNewCourseDescription(e.target.value)}
                  placeholder="Objetivos pedagógicos, competências e saídas profissionais do curso..."
                  className="w-full px-3 py-2 bg-white border border-slate-300 rounded-none focus:border-[#0b1f3a] focus:ring-1 focus:ring-[#0b1f3a] focus:outline-none text-xs text-slate-800"
                />
              </div>

              <div className="pt-3 border-t border-slate-200 flex items-center justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setShowNovoCursoModal(false)}
                  className="px-4 py-2 rounded-none bg-slate-200 hover:bg-slate-300 text-slate-800 font-bold text-xs border border-slate-300 transition-colors cursor-pointer"
                >
                  Cancelar
                </button>
                <AsyncButton
                  type="button"
                  variant="primary"
                  icon="school"
                  loadingText="A registar curso..."
                  successText="Operação feita com sucesso!"
                  onAsyncClick={async () => {
                    if (!newCourseName.trim() || !newCourseCode.trim()) return;
                    const cycleLabel =
                      newCourseLevel === 'superior' ? 'Ensino Superior' : 'II Ciclo / Ensino Médio';
                    const created = dbService.addCourse({
                      name: newCourseName.trim(),
                      code: newCourseCode.trim().toUpperCase(),
                      level: newCourseLevel,
                      cycle: cycleLabel,
                      durationYears: Number(newCourseDuration) || 3,
                      coordinatorName: newCourseCoordinator || 'A designar',
                      description: newCourseDescription.trim() || 'Curso Técnico-Profissional e Académico oficial',
                      status: 'ativo',
                      linkedClassIds: newCourseClassIds
                    });
                    // Aplica o vínculo às turmas escolhidas (a área curricular de
                    // cada uma passa a ser este curso).
                    dbService.setCourseLinkedClasses(created.id, newCourseClassIds);
                    setNewCourseName('');
                    setNewCourseCode('');
                    setNewCourseDescription('');
                    setNewCourseClassIds([]);
                  }}
                  onSuccessComplete={() => setShowNovoCursoModal(false)}
                >
                  CADASTRAR
                </AsyncButton>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* MODAL: ADICIONAR DISCIPLINA (GERAÇÃO AUTOMÁTICA DE CÓDIGO & PROFESSORES REAIS) */}
      {/* ========================================================================= */}
      {showNovaDisciplinaModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs animate-in fade-in">
          <div className="bg-white w-full max-w-lg rounded-none shadow-2xl overflow-hidden border border-slate-400 max-h-[90vh] flex flex-col">
            <FormModalHeader
              title="Adicionar Disciplina"
              subtitle="adição de disciplina e designação de carga horária semanal"
              icon="library_add"
              onClose={() => setShowNovaDisciplinaModal(false)}
            />

            <form
              onSubmit={(e) => e.preventDefault()}
              className="p-6 space-y-4 text-xs overflow-y-auto"
            >
              {/* Nome da disciplina que dispara geração automática de código */}
              <div>
                <label className="block font-bold text-slate-700 uppercase tracking-wider mb-1">
                  Nome da Disciplina <span className="text-red-500">*</span>
                </label>
                <input
                  type="text"
                  required
                  value={newSubName}
                  onChange={(e) => handleDisciplineNameChange(e.target.value)}
                  placeholder="ex: Matemática, Física, Biologia, Língua Portuguesa..."
                  className="w-full px-3 py-2 bg-white border border-slate-300 rounded-none focus:border-[#0b1f3a] focus:ring-1 focus:ring-[#0b1f3a] focus:outline-none text-xs font-semibold text-slate-800"
                />
                
              </div>

              {/* Código gerado automaticamente + Aviso de Duplicidade */}
              <div className="grid grid-cols-1 gap-3">
                <div>
                  <label className="block font-bold text-slate-700 uppercase tracking-wider mb-1">
                    Código Auto <span className="text-red-500">*</span>
                  </label>
                  <input
                    type="text"
                    required
                    value={newSubCode}
                    onChange={(e) => setNewSubCode(e.target.value.toUpperCase())}
                    placeholder="ex: MAT01"
                    className="w-full px-3 py-2 bg-white border border-slate-300 rounded-none focus:border-[#0b1f3a] focus:ring-1 focus:ring-[#0b1f3a] focus:outline-none text-xs font-mono font-bold text-[#0b1f3a]"
                  />
                </div>

              </div>

              {duplicateWarning && (
                <Notice tone="warn" icon="warning">
                  <div className="flex flex-col">
                    <span className="font-bold">Aviso: Disciplina já cadastrada</span>
                    <span className="text-[11px] text-amber-800">
                      Já existe uma disciplina chamada "{newSubName}". As disciplinas são partilhadas por todos os níveis de ensino, por isso não é necessário cadastrá-la novamente.
                    </span>
                  </div>
                </Notice>
              )}

              <div>
                <label className="block font-bold text-slate-700 uppercase tracking-wider mb-1">
                  Ementa / Descrição Resumida
                </label>
                <input
                  type="text"
                  value={newSubDescription}
                  onChange={(e) => setNewSubDescription(e.target.value)}
                  placeholder="ex: Álgebra Linear, Geometria Analítica e Funções Reais..."
                  className="w-full px-3 py-2 bg-white border border-slate-300 rounded-none focus:border-[#0b1f3a] focus:ring-1 focus:ring-[#0b1f3a] focus:outline-none text-xs text-slate-800"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-bold text-slate-700 uppercase tracking-wider mb-1">
                    Carga Semanal (Tempos)
                  </label>
                  <input
                    type="number"
                    min="1"
                    max="10"
                    required
                    value={newSubHours}
                    onChange={(e) => setNewSubHours(Number(e.target.value))}
                    className="w-full px-3 py-2 bg-white border border-slate-300 rounded-none focus:border-[#0b1f3a] focus:ring-1 focus:ring-[#0b1f3a] focus:outline-none text-xs font-mono font-bold text-slate-800"
                  />
                </div>

                <div>
                  <label className="block font-bold text-slate-700 uppercase tracking-wider mb-1">
                    Planificação Pedagógica
                  </label>
                  <select
                    value={newSubStatus}
                    onChange={(e) => setNewSubStatus(e.target.value as any)}
                    className="w-full px-3 py-2 bg-white border border-slate-300 rounded-none focus:border-[#0b1f3a] focus:ring-1 focus:ring-[#0b1f3a] focus:outline-none text-xs text-slate-800 font-semibold"
                  >
                    <option value="Aprovada">Aprovada</option>
                    <option value="Em Revisão">Em Revisão</option>
                    <option value="Pendente">Pendente</option>
                  </select>
                </div>
              </div>

              {/* DOCENTE PREENCHIDO AUTOMATICAMENTE COM OS DOCENTES CADASTRADOS */}
              <div>
                <SearchableSelect
                  label="Docente Coordenador da Disciplina"
                  options={teacherOptions}
                  value={newSubCoordinator}
                  onChange={(val, opt) => setNewSubCoordinator(opt?.label || val)}
                  placeholder="Pesquisar professor por nome ou departamento..."
                  emptyMessage="Nenhum professor encontrado"
                  helperText=""
                />
              </div>

              <KeySubjectFields
                keySubsystems={newSubKeySubsystems}
                keyCourses={newSubKeyCourses}
                onChange={(v) => {
                  setNewSubKeySubsystems(v.keySubsystems);
                  setNewSubKeyCourses(v.keyCourses);
                }}
                taughtCourses={getTaughtCourseNames(newSubName)}
                allCourses={allMedioCourseNames}
              />

              <div className="pt-3 border-t border-slate-200 flex items-center justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setShowNovaDisciplinaModal(false)}
                  className="px-4 py-2 rounded-none bg-slate-200 hover:bg-slate-300 text-slate-800 font-bold text-xs border border-slate-300 transition-colors cursor-pointer"
                >
                  Cancelar
                </button>
                <AsyncButton
                  type="button"
                  variant="primary"
                  icon="save"
                  loadingText="A cadastrar disciplina..."
                  successText="Operação feita com sucesso!"
                  onAsyncClick={async () => {
                    if (!newSubName.trim() || !newSubCode.trim()) return;
                    const initials = (newSubCoordinator || 'Coordenação')
                      .split(' ')
                      .filter(Boolean)
                      .slice(0, 2)
                      .map((w) => w[0].toUpperCase())
                      .join('');

                    dbService.addSubject({
                      code: newSubCode.toUpperCase().trim(),
                      name: newSubName.trim(),
                      area: newSubArea,
                      weeklyHours: Number(newSubHours) || 4,
                      description: newSubDescription.trim() || 'Unidade Curricular da Base Nacional',
                      coordinatorName: newSubCoordinator || 'Docente Coordenador',
                      coordinatorAvatar: initials || 'DC',
                      status: newSubStatus,
                      keySubsystems: newSubKeySubsystems,
                      keyCourses: newSubKeyCourses
                    });

                    setNewSubCode('');
                    setNewSubName('');
                    setNewSubDescription('');
                    setNewSubKeySubsystems([]);
                    setNewSubKeyCourses([]);
                  }}
                  onSuccessComplete={() => setShowNovaDisciplinaModal(false)}
                >
                  CADASTRAR
                </AsyncButton>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* MODAL: HORÁRIO DA TURMA COM SUPORTE OFICIAL A IMPRESSÃO */}
      {/* ========================================================================= */}
      {selectedScheduleClass && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs animate-in fade-in overflow-y-auto printable-modal-overlay">
          {/* O Horário Escolar é SEMPRE impresso em A4 Paisagem (horizontal): a grelha tem
              cinco dias da semana lado a lado e ficava cortada em folha vertical. */}
          <style>{`
            @media print {
              @page {
                size: A4 landscape !important;
                margin: 5mm 6mm !important;
              }
              .horario-print-page {
                width: 100% !important;
                margin: 0 !important;
                padding: 6mm 4mm !important;
              }
              .horario-print-page table {
                width: 100% !important;
                border-collapse: collapse !important;
                table-layout: fixed !important;
              }
              .horario-print-page th,
              .horario-print-page td {
                -webkit-print-color-adjust: exact !important;
                print-color-adjust: exact !important;
                word-break: break-word !important;
              }
            }
          `}</style>
          <div className="printable-document print-landscape bg-white w-full max-w-4xl rounded-none shadow-2xl overflow-hidden border border-slate-400 flex flex-col my-6 print:m-0 print:max-w-none print:border-none print:shadow-none">
            {/* Top Control Bar (Oculto na impressão) */}
            <div className="px-6 py-3 bg-[#0b1f3a] text-white flex items-center justify-between no-print print:hidden">
              <div className="flex items-center gap-2">
                <span className="material-symbols-outlined text-amber-400 text-[20px]">calendar_month</span>
                <span className="font-bold text-sm">HORÁRIO  ESCOLAR — {selectedScheduleClass.name}</span>
              </div>
              <div className="flex items-center gap-3">
                <button
                  type="button"
                  onClick={() => setSelectedScheduleClass(null)}
                  className="text-slate-400 hover:text-white p-1 rounded-none cursor-pointer"
                >
                  <span className="material-symbols-outlined text-[20px]">close</span>
                </button>
              </div>
            </div>

            {/* Printable Schedule Content */}
            <div className="horario-print-page p-8 text-slate-800 font-sans leading-relaxed text-xs">
              {/* Official Letterhead */}
              <div className="text-center border-b-2 border-[#0b1f3a] pb-5 mb-5">
                <div className="flex items-center justify-center gap-3 mb-2">
                  <div className="w-12 h-12 rounded-none bg-white border border-slate-200 flex items-center justify-center p-1 shadow-xs overflow-hidden">
                    <img
                      src={db.settings?.logoUrl || '/school_emblem.png'}
                      alt={db.settings?.schoolName || 'Emblema Institucional'}
                      className="w-full h-full object-contain"
                      referrerPolicy="no-referrer"
                    />
                  </div>
                </div>
                <h1 className="text-xl font-bold uppercase tracking-tight text-[#0b1f3a] mt-0.5">
                  {db.settings?.schoolName || 'Complexo Escolar Privado BandMed'}
                </h1>
                <p className="text-[10px] text-slate-500 mt-0.5">
                  {db.settings?.decreeAuthorization ? `${db.settings.decreeAuthorization} • ` : ''}NIF: {db.settings?.nif || '—'}
                </p>
                <p className="text-[10px] text-slate-500">
                  {db.settings?.address || 'Avenida 21 de Janeiro, Luanda'} • Contacto: {db.settings?.phone || '(+244) 923 456 789'}
                </p>
                <div className="inline-block mt-2.5 px-4 py-1 bg-slate-100 border border-slate-300 font-bold text-xs uppercase tracking-wider text-[#7a0c0c]">
                  Horário — Ano Lectivo {db.settings?.currentAcademicYear || getFallbackAcademicYear()}
                </div>
              </div>

              {/* Class Info Box */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 p-3.5 bg-slate-50 border border-slate-300 mb-5 text-xs">
                <div>
                  <span className="text-[10px] text-slate-500 uppercase font-bold block">Turma & Nível</span>
                  <strong className="text-[#0b1f3a] text-sm block">{selectedScheduleClass.name}</strong>
                  <span className="text-[10px] text-slate-600 font-semibold">{selectedScheduleClass.grade} • {selectedScheduleClass.cycle || 'Geral'}</span>
                </div>
                <div>
                  <span className="text-[10px] text-slate-500 uppercase font-bold block">Turno & Sala</span>
                  <strong className="text-slate-800 block">{selectedScheduleClass.shift}</strong>
                  <span className="text-[10px] text-slate-600 block">{selectedScheduleClass.room || '—'}</span>
                </div>
                <div>
                  <span className="text-[10px] text-slate-500 uppercase font-bold block">Diretor(a) de Turma</span>
                  <strong className="text-slate-800 block truncate">{selectedScheduleClass.headTeacherName || 'A designar'}</strong>
                  <span className="text-[10px] text-slate-600 block">Coordenação Pedagógica</span>
                </div>
                <div>
                  <span className="text-[10px] text-slate-500 uppercase font-bold block">Delegado(a) de Turma</span>
                  <strong className="text-slate-800 block truncate">{selectedScheduleClass.delegateName || 'A eleger'}</strong>
                  <span className="text-[10px] text-slate-600 block">Representante dos Alunos</span>
                </div>
              </div>

              {/* Timetable Table */}
              <div className="overflow-x-auto mb-6">
                <table className="w-full text-left text-xs border-collapse border border-slate-300">
                  <thead>
                    <tr className="bg-[#0b1f3a] text-white uppercase text-[10px] font-bold">
                      <th className="py-2.5 px-3 w-28 border border-slate-300 text-center">Horário</th>
                      <th className="py-2.5 px-3 border border-slate-300">Segunda-feira</th>
                      <th className="py-2.5 px-3 border border-slate-300">Terça-feira</th>
                      <th className="py-2.5 px-3 border border-slate-300">Quarta-feira</th>
                      <th className="py-2.5 px-3 border border-slate-300">Quinta-feira</th>
                      <th className="py-2.5 px-3 border border-slate-300">Sexta-feira</th>
                    </tr>
                  </thead>
                  <tbody>
                    {getWeeklyTimetable(selectedScheduleClass).map((row, idx) => {
                      const isBreak =
                        Boolean(row.isBreak) ||
                        (typeof row.seg === 'object' && row.seg?.subject === 'INTERVALO');

                      const formatCell = (entry: any) => {
                        if (isBreak) {
                          return (
                            <span className="inline-block px-2 py-0.5 bg-amber-100 text-amber-900 border border-amber-300 font-bold text-[10px] tracking-wider uppercase">
                              INTERVALO
                            </span>
                          );
                        }
                        if (!entry) {
                          return <span className="text-slate-300 text-[11px]">—</span>;
                        }
                        const subName = typeof entry === 'string' ? entry : entry.subject;
                        const teacher = typeof entry === 'string' ? '' : entry.teacher;
                        const room = typeof entry === 'string' ? '' : entry.room;
                        if (subName === 'INTERVALO') {
                          return (
                            <span className="inline-block px-2 py-0.5 bg-amber-100 text-amber-900 border border-amber-300 font-bold text-[10px] tracking-wider uppercase">
                              INTERVALO
                            </span>
                          );
                        }
                        return (
                          <div className="flex flex-col">
                            <span className="font-bold text-[#0b1f3a] text-xs leading-snug">{subName}</span>
                            {teacher && (
                              <span className="text-[10px] text-slate-500 font-medium truncate mt-0.5">
                                {teacher} {room && room !== selectedScheduleClass.room ? `(${room})` : ''}
                              </span>
                            )}
                          </div>
                        );
                      };

                      return (
                        <tr
                          key={idx}
                          className={
                            isBreak
                              ? 'bg-amber-50/80 font-bold text-amber-900'
                              : idx % 2 === 0
                              ? 'bg-white'
                              : 'bg-slate-50/60'
                          }
                        >
                          <td className="py-2.5 px-3 font-mono font-bold text-slate-700 bg-slate-100/70 border border-slate-300 text-center whitespace-nowrap">
                            {row.time}
                          </td>
                          <td className={`py-2 px-3 border border-slate-300 ${isBreak ? 'text-center' : ''}`}>
                            {formatCell(row.seg)}
                          </td>
                          <td className={`py-2 px-3 border border-slate-300 ${isBreak ? 'text-center' : ''}`}>
                            {formatCell(row.ter)}
                          </td>
                          <td className={`py-2 px-3 border border-slate-300 ${isBreak ? 'text-center' : ''}`}>
                            {formatCell(row.qua)}
                          </td>
                          <td className={`py-2 px-3 border border-slate-300 ${isBreak ? 'text-center' : ''}`}>
                            {formatCell(row.qui)}
                          </td>
                          <td className={`py-2 px-3 border border-slate-300 ${isBreak ? 'text-center' : ''}`}>
                            {formatCell(row.sex)}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              {/* Official Signatures and Authentication for Print */}
              <div className="grid grid-cols-2 gap-10 text-center font-sans text-xs pt-6 border-t border-slate-300 mt-6">
                <div>
                  <div className="h-10 border-b border-slate-400 mx-4" />
                  <span className="font-bold text-slate-800 block mt-1">O (A) Diretor(a) de Turma</span>
                  <span className="text-[10px] text-slate-500">{selectedScheduleClass.headTeacherName || 'Coordenação'}</span>
                </div>
                <div>
                  <div className="h-10 border-b border-slate-400 mx-4" />
                  <span className="font-bold text-slate-800 block mt-1">O (A) Diretor (a) Pedagógico (a)</span>
                  <span className="text-[10px] text-slate-500">{db.settings?.directorPedagogico || 'A designar'}</span>
                </div>
              </div>

              <div className="text-center text-[10px] text-slate-400 font-sans mt-6">
                Documento emitido pelo Sistema BandMed v3.4.2 em {new Date().toLocaleDateString('pt-PT')} • Válido para o Ano Lectivo {db.settings?.currentAcademicYear || getFallbackAcademicYear()}
              </div>
            </div>

            {/* Modal Bottom Bar (Oculto na impressão) */}
            <div className="px-6 py-3.5 bg-slate-100 border-t border-slate-300 flex items-center justify-between no-print print:hidden">
              <span className="text-xs text-slate-500 font-medium">
                Matriz curricular sincronizada
              </span>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => window.print()}
                  className="px-4 py-2 rounded-none bg-[#7a0c0c] hover:bg-[#5e0909] text-white font-bold text-xs flex items-center gap-1.5 transition-colors cursor-pointer shadow-xs"
                >
                  <span className="material-symbols-outlined text-[16px]">print</span>
                  <span>Imprimir</span>
                </button>
                <button
                  type="button"
                  onClick={() => setSelectedScheduleClass(null)}
                  className="px-4 py-2 rounded-none bg-slate-300 hover:bg-slate-400 text-slate-800 font-bold text-xs transition-colors cursor-pointer"
                >
                  Fechar
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* MODAL: IMPRESSÃO OFICIAL DA MATRIZ DE DISCIPLINAS                          */}
      {/* ========================================================================= */}
      {showDisciplinasPrintModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs animate-in fade-in overflow-y-auto printable-modal-overlay">
          <style>{`
            @media print {
              @page {
                size: A4 landscape !important;
                margin: 5mm 6mm !important;
              }
              .disciplinas-print-page table {
                width: 100% !important;
                border-collapse: collapse !important;
              }
            }
          `}</style>
          <div className="printable-document print-landscape bg-white w-full max-w-4xl rounded-none shadow-2xl overflow-hidden border border-slate-400 flex flex-col my-6 print:m-0 print:max-w-none print:border-none print:shadow-none">
            {/* Barra Superior (Oculta na impressão) */}
            <div className="px-6 py-3 bg-[#0b1f3a] text-white flex items-center justify-between no-print print:hidden">
              <div className="flex items-center gap-2">
                <span className="material-symbols-outlined text-amber-400 text-[20px]">menu_book</span>
                <span className="font-bold text-sm">MATRIZ CURRICULAR DE DISCIPLINAS</span>
              </div>
              <button
                type="button"
                onClick={() => setShowDisciplinasPrintModal(false)}
                className="text-slate-400 hover:text-white p-1 rounded-none cursor-pointer"
              >
                <span className="material-symbols-outlined text-[20px]">close</span>
              </button>
            </div>

            {/* Conteúdo Imprimível */}
            <div className="disciplinas-print-page p-8 text-slate-800 font-sans leading-relaxed text-xs">
              {/* Cabeçalho Institucional */}
              <div className="text-center border-b-2 border-[#0b1f3a] pb-5 mb-5">
                <div className="flex items-center justify-center gap-3 mb-2">
                  <div className="w-12 h-12 rounded-none bg-white border border-slate-200 flex items-center justify-center p-1 shadow-xs overflow-hidden">
                    <img
                      src={db.settings?.logoUrl || '/school_emblem.png'}
                      alt={db.settings?.schoolName || 'Emblema Institucional'}
                      className="w-full h-full object-contain"
                      referrerPolicy="no-referrer"
                    />
                  </div>
                </div>
                <h1 className="text-xl font-bold uppercase tracking-tight text-[#0b1f3a] mt-0.5">
                  {db.settings?.schoolName || 'Complexo Escolar Privado BandMed'}
                </h1>
                <p className="text-[10px] text-slate-500 mt-0.5">
                  {db.settings?.decreeAuthorization ? `${db.settings.decreeAuthorization} • ` : ''}NIF: {db.settings?.nif || '—'}
                </p>
                <p className="text-[10px] text-slate-500">
                  {db.settings?.address || 'Avenida 21 de Janeiro, Luanda'} • Contacto: {db.settings?.phone || '(+244) 923 456 789'}
                </p>
                <div className="inline-block mt-2.5 px-4 py-1 bg-slate-100 border border-slate-300 font-bold text-xs uppercase tracking-wider text-[#7a0c0c]">
                  Matriz Curricular — Ano Lectivo {db.settings?.currentAcademicYear || getFallbackAcademicYear()}
                </div>
              </div>

              <div className="overflow-x-auto mb-6">
                <table className="w-full text-left text-xs border-collapse border border-slate-300">
                  <thead>
                    <tr className="bg-[#0b1f3a] text-white uppercase text-[10px] font-bold">
                      <th className="py-2.5 px-3 border border-slate-300">Código</th>
                      <th className="py-2.5 px-3 border border-slate-300">Disciplina</th>
                      <th className="py-2.5 px-3 border border-slate-300">Área</th>
                      <th className="py-2.5 px-3 border border-slate-300 text-center">Carga Horária Semanal</th>
                      <th className="py-2.5 px-3 border border-slate-300">Coordenador</th>
                      <th className="py-2.5 px-3 border border-slate-300 text-center">Estado</th>
                    </tr>
                  </thead>
                  <tbody>
                    {visibleFilteredSubjects.map((sub, idx) => (
                      <tr key={sub.id} className={idx % 2 === 0 ? 'bg-white' : 'bg-slate-50/60'}>
                        <td className="py-2 px-3 border border-slate-300 font-mono font-bold">{sub.code}</td>
                        <td className="py-2 px-3 border border-slate-300 font-bold text-[#0b1f3a]">{sub.name}</td>
                        <td className="py-2 px-3 border border-slate-300">{sub.area || 'Tronco Comum'}</td>
                        <td className="py-2 px-3 border border-slate-300 text-center font-mono">{sub.weeklyHours}h/sem</td>
                        <td className="py-2 px-3 border border-slate-300">{sub.coordinatorName || 'A designar'}</td>
                        <td className="py-2 px-3 border border-slate-300 text-center">{sub.status || 'Aprovada'}</td>
                      </tr>
                    ))}
                    {filteredSubjects.length === 0 && (
                      <tr>
                        <td colSpan={6} className="py-6 px-3 border border-slate-300 text-center text-slate-400">
                          Nenhuma disciplina encontrada.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
                <TablePagination total={filteredSubjects.length} page={pgFilteredSubjects} onPageChange={setPgFilteredSubjects} />
              </div>

              <div className="text-center text-[10px] text-slate-400 font-sans mt-6">
                Documento emitido pelo Sistema BandMed v3.4.2 em {new Date().toLocaleDateString('pt-PT')} • Válido para o Ano Lectivo {db.settings?.currentAcademicYear || getFallbackAcademicYear()}
              </div>
            </div>

            {/* Barra Inferior (Oculta na impressão) */}
            <div className="px-6 py-3.5 bg-slate-100 border-t border-slate-300 flex items-center justify-between no-print print:hidden">
              <span className="text-xs text-slate-500 font-medium">
                {filteredSubjects.length} disciplina(s) na matriz curricular
              </span>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => window.print()}
                  className="px-4 py-2 rounded-none bg-[#7a0c0c] hover:bg-[#5e0909] text-white font-bold text-xs flex items-center gap-1.5 transition-colors cursor-pointer shadow-xs"
                >
                  <span className="material-symbols-outlined text-[16px]">print</span>
                  <span>Imprimir</span>
                </button>
                <button
                  type="button"
                  onClick={() => setShowDisciplinasPrintModal(false)}
                  className="px-4 py-2 rounded-none bg-slate-300 hover:bg-slate-400 text-slate-800 font-bold text-xs transition-colors cursor-pointer"
                >
                  Fechar
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* MODAL: ALUNOS DA TURMA */}
      {/* ========================================================================= */}
      {selectedStudentsClass && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs animate-in fade-in">
          <div className="bg-white w-full max-w-2xl rounded-none shadow-2xl overflow-hidden border border-slate-400 max-h-[85vh] flex flex-col">
            <FormModalHeader
              title={`Alunos Matriculados — ${selectedStudentsClass.name}`}
              subtitle="Registo institucional de estudantes associados a esta turma"
              icon="badge"
              onClose={() => setSelectedStudentsClass(null)}
            />

            <div className="p-6 overflow-y-auto">
              {(() => {
                const classStudents = studentsList.filter((stu) => String(stu.classId) === String(selectedStudentsClass.id));
                const maxCap = selectedStudentsClass.maxCapacity || 30;
                const occPct = Math.round((classStudents.length / maxCap) * 100);

                return (
                  <>
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 mb-4 p-3 bg-slate-50 border border-slate-200 text-xs">
                      <div>
                        <span className="text-slate-500 block">Lotação & Ocupação Real da Sala:</span>
                        <div className="flex items-center gap-2 mt-0.5">
                          <span className="font-bold text-[#0b1f3a] text-sm">
                            {classStudents.length} / {maxCap} Estudantes
                          </span>
                          <span className="px-2 py-0.5 bg-blue-100 text-[#0b1f3a] font-bold text-[10px]">
                            {occPct}% Ocupação
                          </span>
                        </div>
                      </div>

                      <button
                        onClick={() => {
                          setSelectedStudentsClass(null);
                          onNavigateToStudents(selectedStudentsClass.id);
                        }}
                        className="text-[#0b1f3a] hover:text-[#7a0c0c] font-bold flex items-center gap-1 cursor-pointer text-xs self-start sm:self-auto"
                      >
                        <span>Gerir Matrículas no Módulo Alunos</span>
                        <span className="material-symbols-outlined text-[16px]">arrow_forward</span>
                      </button>
                    </div>

                    <div className="space-y-2 max-h-96 overflow-y-auto">
                      {classStudents.length > 0 ? (
                        classStudents.map((stu) => (
                          <div
                            key={stu.id}
                            className="p-3 bg-white hover:bg-slate-50 border border-slate-200 flex items-center justify-between text-xs transition-colors"
                          >
                            <div className="flex items-center gap-3">
                              <div className="w-9 h-11 bg-slate-100 border border-slate-300 overflow-hidden shrink-0">
                                <img
                                  src={stu.docPassPhoto || stu.avatar || '/avatar-padrao.png'}
                                  alt={stu.name}
                                  className="w-full h-full object-cover object-center"
                                />
                              </div>
                              <div>
                                <span className="font-bold text-slate-900 block">{stu.name}</span>
                                <div className="flex items-center gap-2 text-slate-500 text-[11px] font-mono">
                                  <span>Proc. #{stu.procNumber}</span>
                                  <span>•</span>
                                  <span>{stu.gender === 'F' || stu.gender === 'Feminino' ? 'Feminino' : 'Masculino'}</span>
                                  <span>•</span>
                                  <span>BI: {stu.biNumber || stu.citizenCard || 'Pendente'}</span>
                                </div>
                              </div>
                            </div>
                            <div className="flex items-center gap-2">
                              <span className="px-2 py-0.5 bg-emerald-50 text-emerald-800 font-bold text-[11px] border border-emerald-300">
                                {stu.attendanceRate || 100}% Assiduidade
                              </span>
                            </div>
                          </div>
                        ))
                      ) : (
                        <div className="py-10 text-center text-slate-400 bg-slate-50 border border-dashed border-slate-200">
                          <span className="material-symbols-outlined text-[32px] text-slate-300 block mb-2">
                            group_off
                          </span>
                          <p className="font-bold text-slate-700 text-xs">
                            Nenhum aluno matriculado nesta turma ainda.
                          </p>
                          <p className="text-[11px] text-slate-400 mt-1 max-w-sm mx-auto">
                            Pode matricular novos estudantes ou transferi-los para esta turma no módulo de Alunos.
                          </p>
                        </div>
                      )}
                    </div>
                  </>
                );
              })()}

              <div className="pt-4 mt-4 border-t border-slate-200 flex items-center justify-between text-xs">
                <button
                  onClick={() => {
                    const id = selectedStudentsClass.id;
                    setSelectedStudentsClass(null);
                    onNavigateToAttendance(id);
                  }}
                  className="px-4 py-2 rounded-none bg-slate-100 hover:bg-slate-200 text-slate-800 font-bold flex items-center gap-1.5 border border-slate-300 transition-colors cursor-pointer"
                  type="button"
                >
                  <span className="material-symbols-outlined text-[16px]">event_available</span>
                  <span>Fazer Chamada / Assiduidade</span>
                </button>
                <button
                  onClick={() => setSelectedStudentsClass(null)}
                  className="px-4 py-2 rounded-none bg-[#0b1f3a] hover:bg-[#7a0c0c] text-white font-bold transition-colors cursor-pointer"
                  type="button"
                >
                  Fechar
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* MODAL: EDITAR TURMA */}
      {/* ========================================================================= */}
      {editingClass && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs animate-in fade-in">
          <div className="bg-white w-full max-w-xl rounded-none shadow-2xl overflow-hidden border border-slate-400 max-h-[90vh] flex flex-col">
            <FormModalHeader
              title={`Editar Turma: ${editingClass.name}`}
              subtitle="Actualizar informações curriculares e atribuição de direcção"
              icon="edit"
              onClose={() => setEditingClass(null)}
            />

            <form
              onSubmit={(e) => e.preventDefault()}
              className="p-6 space-y-4 text-xs overflow-y-auto"
            >
              <div>
                <label className="block font-bold text-slate-700 uppercase tracking-wider mb-1">
                  Designação da Turma <span className="text-red-500">*</span>
                </label>
                <input
                  type="text"
                  required
                  value={editClassName}
                  onChange={(e) => setEditClassName(e.target.value)}
                  className="w-full px-3 py-2 bg-white border border-slate-300 rounded-none focus:border-[#0b1f3a] focus:ring-1 focus:ring-[#0b1f3a] focus:outline-none text-xs font-bold text-slate-800"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-bold text-slate-700 uppercase tracking-wider mb-1">
                    Classe / Ano
                  </label>
                  <input
                    type="text"
                    required
                    value={editClassGrade}
                    onChange={(e) => setEditClassGrade(e.target.value)}
                    className="w-full px-3 py-2 bg-white border border-slate-300 rounded-none focus:border-[#0b1f3a] focus:ring-1 focus:ring-[#0b1f3a] focus:outline-none text-xs font-semibold text-slate-800"
                  />
                </div>
                <div>
                  <label className="block font-bold text-slate-700 uppercase tracking-wider mb-1">
                    Turma / Letra
                  </label>
                  <input
                    type="text"
                    required
                    maxLength={3}
                    value={editClassSection}
                    onChange={(e) => setEditClassSection(e.target.value.toUpperCase())}
                    className="w-full px-3 py-2 bg-white border border-slate-300 rounded-none focus:border-[#0b1f3a] focus:ring-1 focus:ring-[#0b1f3a] focus:outline-none text-xs font-bold text-center text-slate-800"
                  />
                </div>
              </div>

              <div>
                <label className="block font-bold text-slate-700 uppercase tracking-wider mb-1">
                  Curso / Área Curricular
                </label>
                <input
                  type="text"
                  value={editClassArea}
                  onChange={(e) => setEditClassArea(e.target.value)}
                  className="w-full px-3 py-2 bg-white border border-slate-300 rounded-none focus:border-[#0b1f3a] focus:ring-1 focus:ring-[#0b1f3a] focus:outline-none text-xs font-medium text-slate-800"
                />
              </div>

              <div className="grid grid-cols-3 gap-3">
                <div>
                  <label className="block font-bold text-slate-700 uppercase tracking-wider mb-1">
                    Turno
                  </label>
                  <select
                    value={editClassShift}
                    onChange={(e) => setEditClassShift(e.target.value as any)}
                    className="w-full px-3 py-2 bg-white border border-slate-300 rounded-none focus:border-[#0b1f3a] focus:ring-1 focus:ring-[#0b1f3a] focus:outline-none text-xs font-bold text-slate-800"
                  >
                    <option value="Manhã">Manhã (07h-12h)</option>
                    <option value="Tarde">Tarde (12h30-17h)</option>
                    <option value="Integral">Integral</option>
                  </select>
                </div>
                <div>
                  <label className="block font-bold text-slate-700 uppercase tracking-wider mb-1">
                    Sala Física
                  </label>
                  <input
                    type="text"
                    required
                    value={editClassRoom}
                    onChange={(e) => setEditClassRoom(e.target.value)}
                    className="w-full px-3 py-2 bg-white border border-slate-300 rounded-none focus:border-[#0b1f3a] focus:ring-1 focus:ring-[#0b1f3a] focus:outline-none text-xs font-mono font-bold text-slate-800"
                  />
                </div>
                <div>
                  <label className="block font-bold text-slate-700 uppercase tracking-wider mb-1">
                    Lotação Máx.
                  </label>
                  <input
                    type="number"
                    min="1"
                    max="60"
                    required
                    value={editClassCapacity}
                    onChange={(e) => setEditClassCapacity(Number(e.target.value))}
                    className="w-full px-3 py-2 bg-white border border-slate-300 rounded-none focus:border-[#0b1f3a] focus:ring-1 focus:ring-[#0b1f3a] focus:outline-none text-xs font-mono font-bold text-slate-800"
                  />
                </div>
              </div>

              <div>
                <SearchableSelect
                  label="Docente Diretor de Turma (DT)"
                  options={teacherOptions}
                  value={editClassHeadTeacherId}
                  onChange={(val) => setEditClassHeadTeacherId(val)}
                  placeholder="Pesquisar professor cadastrado para Diretor de Turma..."
                  emptyMessage="Nenhum docente encontrado"
                  helperText="Selecione o professor responsável pelo acompanhamento pedagógico desta turma."
                />
              </div>

              {/* DELEGADO DE TURMA COM BUSCA DOS ALUNOS MATRICULADOS NA TURMA */}
              <div>
                <SearchableSelect
                  label="Delegado(a) de Turma"
                  options={editingClassStudentOptions.length > 0 ? editingClassStudentOptions : studentOptions}
                  value={editClassDelegate}
                  onChange={(val) => {
                    const found = studentsList.find((s) => s.id === val || s.name === val);
                    setEditClassDelegate(found ? found.name : val);
                  }}
                  placeholder="Pesquisar aluno matriculado nesta turma..."
                  allowCustom={true}
                  emptyMessage="Nenhum aluno matriculado encontrado (pode digitar manualmente)"
                  helperText={
                    editingClassStudentOptions.length > 0
                      ? `Mostrando ${editingClassStudentOptions.length} aluno(s) matriculado(s) na turma ${editingClass.name}.`
                      : `Ainda não existem alunos registados em ${editingClass.name}. Pode pesquisar na base geral ou digitar o nome.`
                  }
                />
              </div>

              <div className="pt-3 border-t border-slate-200 flex items-center justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setEditingClass(null)}
                  className="px-4 py-2 rounded-none bg-slate-200 hover:bg-slate-300 text-slate-800 font-bold text-xs border border-slate-300 transition-colors cursor-pointer"
                >
                  Cancelar
                </button>
                <AsyncButton
                  type="button"
                  variant="primary"
                  icon="save"
                  loadingText="A atualizar turma..."
                  successText="Operação feita com sucesso!"
                  onAsyncClick={async () => {
                    const teacherObj = teachersList.find((t) => t.id === editClassHeadTeacherId);
                    dbService.updateClass(editingClass.id, {
                      name: editClassName.trim() || editingClass.name,
                      grade: editClassGrade || editingClass.grade,
                      section: editClassSection.trim().toUpperCase() || editingClass.section,
                      area: editClassArea || editingClass.area,
                      shift: editClassShift,
                      room: editClassRoom.trim() || editingClass.room,
                      maxCapacity: Number(editClassCapacity) || 30,
                      headTeacherId: teacherObj ? teacherObj.id : '',
                      headTeacherName: teacherObj ? teacherObj.name : 'A designar',
                      delegateName: editClassDelegate.trim() || 'A eleger pela turma'
                    });
                  }}
                  onSuccessComplete={() => setEditingClass(null)}
                >
                  SALVAR ALTERAÇÕES
                </AsyncButton>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* MODAL: VALIDAÇÃO E ELIMINAÇÃO SEGURA DE TURMA */}
      {/* ========================================================================= */}
      {classToDelete && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs animate-in fade-in">
          <div className="bg-white max-w-md w-full rounded-none shadow-2xl overflow-hidden border border-slate-400">
            <FormModalHeader
              title="Eliminar Turma"
              subtitle={classToDelete.name}
              icon="delete"
              onClose={() => setClassToDelete(null)}
            />

            <div className="p-6">
              {(() => {
                const enrolled = studentsList.filter((s) => String(s.classId) === String(classToDelete.id)).length;
                if (enrolled > 0) {
                  return (
                    <div>
                      <div className="w-12 h-12 rounded-none bg-amber-100 text-amber-800 flex items-center justify-center mx-auto mb-4 border border-amber-300">
                        <span className="material-symbols-outlined text-[28px]">lock</span>
                      </div>
                      <h3 className="font-headline text-lg font-bold text-slate-900 text-center">
                        Turma com Matrículas Ativas
                      </h3>
                      <p className="text-xs text-slate-600 text-center mt-2 leading-relaxed">
                        Não é possível eliminar a turma <strong>{classToDelete.name}</strong> porque existem{' '}
                        <span className="font-bold text-amber-900">{enrolled} aluno(s) com matrícula ativa</span> associados a esta turma na base de dados.
                      </p>
                      <Notice tone="warn">
                        Transfira ou remova as matrículas dos alunos antes de eliminar a turma.
                      </Notice>
                      <div className="mt-6 flex items-center justify-end gap-2">
                        <button
                          onClick={() => {
                            const cls = classToDelete;
                            setClassToDelete(null);
                            setSelectedStudentsClass(cls);
                          }}
                          className="px-4 py-2 rounded-none bg-[#0b1f3a] text-white font-bold text-xs hover:bg-[#7a0c0c] cursor-pointer transition-colors"
                          type="button"
                        >
                          Ver Alunos Desta Turma
                        </button>
                        <button
                          onClick={() => setClassToDelete(null)}
                          className="px-4 py-2 rounded-none bg-slate-200 hover:bg-slate-300 text-slate-700 font-bold text-xs border border-slate-300 cursor-pointer transition-colors"
                          type="button"
                        >
                          Fechar
                        </button>
                      </div>
                    </div>
                  );
                }

                return (
                  <div>
                    <div className="w-12 h-12 rounded-none bg-red-100 text-red-700 flex items-center justify-center mx-auto mb-4 border border-red-300">
                      <span className="material-symbols-outlined text-[28px]">delete_forever</span>
                    </div>
                    <h3 className="font-headline text-lg font-bold text-slate-900 text-center">
                      Eliminar Turma da Base de Dados?
                    </h3>
                    <p className="text-xs text-slate-600 text-center mt-2 leading-relaxed">
                      Tem a certeza de que deseja eliminar a turma <strong>{classToDelete.name}</strong> ({classToDelete.shift} • {classToDelete.room})? Esta ação é definitiva na base de dados.
                    </p>
                    <div className="mt-6 flex items-center justify-end gap-2">
                      <button
                        onClick={() => setClassToDelete(null)}
                        className="px-4 py-2 rounded-none bg-slate-200 hover:bg-slate-300 text-slate-700 font-bold text-xs border border-slate-300 cursor-pointer transition-colors"
                        type="button"
                      >
                        Cancelar
                      </button>
                      <button
                        type="button"
                        onClick={async () => {
                          const cls = classToDelete;
                          setClassToDelete(null);
                          await runGlobalOperation(
                            async () => {
                              dbService.deleteClass(cls.id);
                            },
                            {
                              loadingMessage: `A eliminar turma ${cls.name}...`,
                              requiredRule: 'turmas.manage',
                              userRole: currentUserRole,
                              successMessage: 'Operação feita com sucesso!'
                            }
                          );
                        }}
                        className="px-5 py-2.5 rounded-none bg-[#b91c1c] hover:bg-[#7a0c0c] text-white font-bold text-xs flex items-center gap-2 cursor-pointer transition-colors shadow-none border-none"
                      >
                        <span className="material-symbols-outlined text-[16px]">delete</span>
                        <span>Eliminar</span>
                      </button>
                    </div>
                  </div>
                );
              })()}
            </div>
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* MODAL: EDITAR CURSO */}
      {/* ========================================================================= */}
      {editingCourse && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs animate-in fade-in">
          <div className="bg-white w-full max-w-lg rounded-none shadow-2xl overflow-hidden border border-slate-400 max-h-[90vh] flex flex-col">
            <FormModalHeader
              title="Editar Curso Curricular"
              subtitle={editingCourse.name}
              icon="edit"
              onClose={() => setEditingCourse(null)}
            />

            <form
              onSubmit={(e) => e.preventDefault()}
              className="p-6 space-y-4 text-xs overflow-y-auto"
            >
              <div>
                <label className="block font-bold text-slate-700 uppercase tracking-wider mb-1">
                  Designação Oficial do Curso <span className="text-red-500">*</span>
                </label>
                <input
                  type="text"
                  required
                  value={editCourseName}
                  onChange={(e) => setEditCourseName(e.target.value)}
                  className="w-full px-3 py-2 bg-white border border-slate-300 rounded-none focus:border-[#0b1f3a] focus:ring-1 focus:ring-[#0b1f3a] focus:outline-none text-xs font-bold text-slate-800"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-bold text-slate-700 uppercase tracking-wider mb-1">
                    Código do Curso <span className="text-red-500">*</span>
                  </label>
                  <input
                    type="text"
                    required
                    value={editCourseCode}
                    onChange={(e) => setEditCourseCode(e.target.value.toUpperCase())}
                    className="w-full px-3 py-2 bg-white border border-slate-300 rounded-none focus:border-[#0b1f3a] focus:ring-1 focus:ring-[#0b1f3a] focus:outline-none text-xs font-mono font-bold uppercase text-slate-800"
                  />
                </div>
                <div>
                  <label className="block font-bold text-slate-700 uppercase tracking-wider mb-1">
                    Nível de Ensino
                  </label>
                  <select
                    value={editCourseLevel}
                    onChange={(e) => setEditCourseLevel(e.target.value as any)}
                    className="w-full px-3 py-2 bg-white border border-slate-300 rounded-none focus:border-[#0b1f3a] focus:ring-1 focus:ring-[#0b1f3a] focus:outline-none text-xs font-semibold text-slate-800"
                  >
                    <option value="secundario_2">II Ciclo / Ensino Médio</option>
                    <option value="superior">Ensino Superior</option>
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-bold text-slate-700 uppercase tracking-wider mb-1">
                    Duração Curricular (Anos)
                  </label>
                  <input
                    type="number"
                    min="1"
                    max="6"
                    required
                    value={editCourseDuration}
                    onChange={(e) => setEditCourseDuration(Number(e.target.value))}
                    className="w-full px-3 py-2 bg-white border border-slate-300 rounded-none focus:border-[#0b1f3a] focus:ring-1 focus:ring-[#0b1f3a] focus:outline-none text-xs font-mono font-bold text-slate-800"
                  />
                </div>
                <div>
                  <label className="block font-bold text-slate-700 uppercase tracking-wider mb-1">
                    Estado do Curso
                  </label>
                  <select
                    value={editCourseStatus}
                    onChange={(e) => setEditCourseStatus(e.target.value as any)}
                    className="w-full px-3 py-2 bg-white border border-slate-300 rounded-none focus:border-[#0b1f3a] focus:ring-1 focus:ring-[#0b1f3a] focus:outline-none text-xs font-bold text-slate-800"
                  >
                    <option value="ativo">Ativo</option>
                    <option value="inativo">Inativo</option>
                  </select>
                </div>
              </div>

              <div>
                <SearchableSelect
                  label="Docente Coordenador do Curso"
                  options={teacherOptions}
                  value={editCourseCoordinator}
                  onChange={(val, opt) => setEditCourseCoordinator(opt?.label || val)}
                  placeholder="Pesquisar professor para coordenador..."
                  emptyMessage="Nenhum professor encontrado"
                />
              </div>

              {renderLinkedClassesPicker(editCourseClassIds, setEditCourseClassIds, editCourseName.trim())}

              <div>
                <label className="block font-bold text-slate-700 uppercase tracking-wider mb-1">
                  Perfil de Saída / Descrição
                </label>
                <textarea
                  rows={2}
                  value={editCourseDescription}
                  onChange={(e) => setEditCourseDescription(e.target.value)}
                  className="w-full px-3 py-2 bg-white border border-slate-300 rounded-none focus:border-[#0b1f3a] focus:ring-1 focus:ring-[#0b1f3a] focus:outline-none text-xs text-slate-800"
                />
              </div>

              <div className="pt-3 border-t border-slate-200 flex items-center justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setEditingCourse(null)}
                  className="px-4 py-2 rounded-none bg-slate-200 hover:bg-slate-300 text-slate-800 font-bold text-xs border border-slate-300 transition-colors cursor-pointer"
                >
                  Cancelar
                </button>
                <AsyncButton
                  type="button"
                  variant="primary"
                  icon="save"
                  loadingText="A atualizar curso..."
                  successText="Operação feita com sucesso!"
                  onAsyncClick={async () => {
                    dbService.updateCourse(editingCourse.id, {
                      name: editCourseName.trim(),
                      code: editCourseCode.trim().toUpperCase(),
                      level: editCourseLevel,
                      cycle: editCourseLevel === 'superior' ? 'Ensino Superior' : 'II Ciclo / Ensino Médio',
                      durationYears: Number(editCourseDuration) || 3,
                      coordinatorName: editCourseCoordinator.trim() || 'A designar',
                      description: editCourseDescription.trim(),
                      status: editCourseStatus
                    });
                    dbService.setCourseLinkedClasses(editingCourse.id, editCourseClassIds);
                  }}
                  onSuccessComplete={() => setEditingCourse(null)}
                >
                  SALVAR ALTERAÇÕES
                </AsyncButton>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* MODAL: ELIMINAR CURSO */}
      {/* ========================================================================= */}
      {courseToDelete && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs animate-in fade-in">
          <div className="bg-white max-w-md w-full rounded-none shadow-2xl overflow-hidden border border-slate-400">
            <FormModalHeader
              title="Eliminar Curso"
              subtitle={courseToDelete.name}
              icon="delete"
              onClose={() => setCourseToDelete(null)}
            />

            <div className="p-6">
              <div className="w-12 h-12 rounded-none bg-red-100 text-red-700 flex items-center justify-center mx-auto mb-4 border border-red-300">
                <span className="material-symbols-outlined text-[28px]">warning</span>
              </div>
              <h3 className="font-headline text-lg font-bold text-slate-900 text-center">
                Eliminar Curso da Matriz?
              </h3>
              <p className="text-xs text-slate-600 text-center mt-2 leading-relaxed">
                Deseja eliminar o curso <strong>{courseToDelete.name}</strong> ({courseToDelete.code}) da base de dados institucional?
              </p>
              <div className="mt-6 flex items-center justify-end gap-2">
                <button
                  onClick={() => setCourseToDelete(null)}
                  className="px-4 py-2 rounded-none bg-slate-200 hover:bg-slate-300 text-slate-700 font-bold text-xs border border-slate-300 cursor-pointer transition-colors"
                  type="button"
                >
                  Cancelar
                </button>
                <button
                  type="button"
                  onClick={async () => {
                    const crs = courseToDelete;
                    setCourseToDelete(null);
                    await runGlobalOperation(
                      async () => {
                        dbService.deleteCourse(crs.id);
                      },
                      {
                        loadingMessage: `A eliminar curso ${crs.name}...`,
                              requiredRule: 'turmas.manage',
                              userRole: currentUserRole,
                        successMessage: 'Operação feita com sucesso!'
                      }
                    );
                  }}
                  className="px-5 py-2.5 rounded-none bg-[#b91c1c] hover:bg-[#7a0c0c] text-white font-bold text-xs flex items-center gap-2 cursor-pointer transition-colors shadow-none border-none"
                >
                  <span className="material-symbols-outlined text-[16px]">delete</span>
                  <span>Eliminar</span>
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* MODAL: EDITAR DISCIPLINA */}
      {/* ========================================================================= */}
      {editingSubject && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs animate-in fade-in">
          <div className="bg-white w-full max-w-lg rounded-none shadow-2xl overflow-hidden border border-slate-400 max-h-[90vh] flex flex-col">
            <FormModalHeader
              title="Editar Disciplina Curricular"
              subtitle={editingSubject.name}
              icon="edit"
              onClose={() => setEditingSubject(null)}
            />

            <form
              onSubmit={(e) => e.preventDefault()}
              className="p-6 space-y-4 text-xs overflow-y-auto"
            >
              <div>
                <label className="block font-bold text-slate-700 uppercase tracking-wider mb-1">
                  Nome da Disciplina <span className="text-red-500">*</span>
                </label>
                <input
                  type="text"
                  required
                  value={editSubName}
                  onChange={(e) => setEditSubName(e.target.value)}
                  className="w-full px-3 py-2 bg-white border border-slate-300 rounded-none focus:border-[#0b1f3a] focus:ring-1 focus:ring-[#0b1f3a] focus:outline-none text-xs font-semibold text-slate-800"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-bold text-slate-700 uppercase tracking-wider mb-1">
                    Código <span className="text-red-500">*</span>
                  </label>
                  <input
                    type="text"
                    required
                    value={editSubCode}
                    onChange={(e) => setEditSubCode(e.target.value.toUpperCase())}
                    className="w-full px-3 py-2 bg-white border border-slate-300 rounded-none focus:border-[#0b1f3a] focus:ring-1 focus:ring-[#0b1f3a] focus:outline-none text-xs font-mono font-bold uppercase text-slate-800"
                  />
                </div>
                <div>
                  <label className="block font-bold text-slate-700 uppercase tracking-wider mb-1">
                    Carga Horária (Tempos)
                  </label>
                  <input
                    type="number"
                    min="1"
                    max="12"
                    required
                    value={editSubHours}
                    onChange={(e) => setEditSubHours(Number(e.target.value))}
                    className="w-full px-3 py-2 bg-white border border-slate-300 rounded-none focus:border-[#0b1f3a] focus:ring-1 focus:ring-[#0b1f3a] focus:outline-none text-xs font-mono font-bold text-slate-800"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-bold text-slate-700 uppercase tracking-wider mb-1">
                    Estado de Homologação
                  </label>
                  <select
                    value={editSubStatus}
                    onChange={(e) => setEditSubStatus(e.target.value as any)}
                    className="w-full px-3 py-2 bg-white border border-slate-300 rounded-none focus:border-[#0b1f3a] focus:ring-1 focus:ring-[#0b1f3a] focus:outline-none text-xs font-bold text-slate-800"
                  >
                    <option value="Aprovada">Aprovada</option>
                    <option value="Em Revisão">Em Revisão</option>
                    <option value="Pendente">Pendente</option>
                  </select>
                </div>
              </div>

              <div>
                <SearchableSelect
                  label="Docente Coordenador da Disciplina"
                  options={teacherOptions}
                  value={editSubCoordinator}
                  onChange={(val, opt) => setEditSubCoordinator(opt?.label || val)}
                  placeholder="Pesquisar professor por nome ou departamento..."
                  emptyMessage="Nenhum professor encontrado"
                />
              </div>

              <KeySubjectFields
                keySubsystems={editSubKeySubsystems}
                keyCourses={editSubKeyCourses}
                onChange={(v) => {
                  setEditSubKeySubsystems(v.keySubsystems);
                  setEditSubKeyCourses(v.keyCourses);
                }}
                taughtCourses={getTaughtCourseNames(editSubName)}
                allCourses={allMedioCourseNames}
              />

              <div>
                <label className="block font-bold text-slate-700 uppercase tracking-wider mb-1">
                  Ementa / Descrição
                </label>
                <textarea
                  rows={2}
                  value={editSubDescription}
                  onChange={(e) => setEditSubDescription(e.target.value)}
                  className="w-full px-3 py-2 bg-white border border-slate-300 rounded-none focus:border-[#0b1f3a] focus:ring-1 focus:ring-[#0b1f3a] focus:outline-none text-xs text-slate-800"
                />
              </div>

              <div className="pt-3 border-t border-slate-200 flex items-center justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setEditingSubject(null)}
                  className="px-4 py-2 rounded-none bg-slate-200 hover:bg-slate-300 text-slate-800 font-bold text-xs border border-slate-300 transition-colors cursor-pointer"
                >
                  Cancelar
                </button>
                <AsyncButton
                  type="button"
                  variant="primary"
                  icon="save"
                  loadingText="A atualizar disciplina..."
                  successText="Operação feita com sucesso!"
                  onAsyncClick={async () => {
                    dbService.updateSubject(editingSubject.id, {
                      name: editSubName.trim(),
                      code: editSubCode.trim().toUpperCase(),
                      cycle: '',
                      area: editSubArea,
                      weeklyHours: Number(editSubHours) || 4,
                      coordinatorName: editSubCoordinator.trim() || 'Docente Coordenador',
                      status: editSubStatus,
                      description: editSubDescription.trim(),
                      keySubsystems: editSubKeySubsystems,
                      keyCourses: editSubKeyCourses
                    });
                  }}
                  onSuccessComplete={() => setEditingSubject(null)}
                >
                  SALVAR ALTERAÇÕES
                </AsyncButton>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL: ONDE A DISCIPLINA É CHAVE */}
      {keyInfoSubject && (() => {
        const sub = keyInfoSubject;
        const turmas = classesList.filter((c) => isKeySubjectFor(sub, c.grade, c.area));
        return (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs" onClick={(e) => { if (e.target === e.currentTarget) setKeyInfoSubject(null); }}>
            <div className="bg-white max-w-lg w-full rounded-none shadow-2xl overflow-hidden border border-slate-400 flex flex-col max-h-[90vh]">
              <FormModalHeader title="Disciplina Chave" subtitle={sub.name} onClose={() => setKeyInfoSubject(null)} />
              <div className="p-5 space-y-4 text-xs overflow-y-auto">
                <div>
                  <div className="font-bold uppercase text-[#0b1f3a] mb-1.5">Níveis de ensino</div>
                  {(sub.keySubsystems || []).length ? (
                    <ul className="space-y-1">
                      {KEY_SUBSYSTEM_OPTIONS.filter((o) => sub.keySubsystems?.includes(o.id)).map((o) => (
                        <li key={o.id} className="px-3 py-1.5 bg-slate-50 border border-slate-200">{o.label} — exame da {o.exam}</li>
                      ))}
                    </ul>
                  ) : <p className="text-slate-500">Nenhum.</p>}
                </div>
                <div>
                  <div className="font-bold uppercase text-[#0b1f3a] mb-1.5">Cursos</div>
                  {(sub.keyCourses || []).length ? (
                    <ul className="space-y-1">
                      {(sub.keyCourses || []).map((c) => <li key={c} className="px-3 py-1.5 bg-slate-50 border border-slate-200">{c}</li>)}
                    </ul>
                  ) : <p className="text-slate-500">Nenhum.</p>}
                </div>
                <div>
                  <div className="font-bold uppercase text-[#0b1f3a] mb-1.5">Turmas ({turmas.length})</div>
                  {turmas.length ? (
                    <ul className="space-y-1">
                      {turmas.map((c) => (
                        <li key={c.id} className="px-3 py-1.5 bg-slate-50 border border-slate-200 flex justify-between gap-2">
                          <span className="font-semibold">{c.name}</span>
                          <span className="text-slate-500">{c.grade}{c.area ? ` · ${c.area}` : ''} · {c.academicYear}</span>
                        </li>
                      ))}
                    </ul>
                  ) : <p className="text-slate-500">Nenhuma turma cadastrada nestas condições.</p>}
                </div>
              </div>
              <div className="px-5 py-3 border-t border-slate-200 bg-slate-50 flex justify-end">
                <button type="button" onClick={() => setKeyInfoSubject(null)} data-tone="grey" className="px-5 py-2 text-white font-bold text-xs cursor-pointer">Fechar</button>
              </div>
            </div>
          </div>
        );
      })()}

      {/* ========================================================================= */}
      {/* MODAL: ELIMINAR DISCIPLINA */}
      {/* ========================================================================= */}
      {subjectToDelete && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs animate-in fade-in">
          <div className="bg-white max-w-md w-full rounded-none shadow-2xl overflow-hidden border border-slate-400">
            <FormModalHeader
              title="Eliminar Disciplina"
              subtitle={subjectToDelete.name}
              icon="delete"
              onClose={() => setSubjectToDelete(null)}
            />

            <div className="p-6">
              <div className="w-12 h-12 rounded-none bg-red-100 text-red-700 flex items-center justify-center mx-auto mb-4 border border-red-300">
                <span className="material-symbols-outlined text-[28px]">warning</span>
              </div>
              <h3 className="font-headline text-lg font-bold text-slate-900 text-center">
                Eliminar Disciplina da Matriz?
              </h3>
              <p className="text-xs text-slate-600 text-center mt-2 leading-relaxed">
                Pretende eliminar a disciplina <strong>{subjectToDelete.name}</strong> ({subjectToDelete.code}) da matriz curricular institucional?
              </p>
              <div className="mt-6 flex items-center justify-end gap-2">
                <button
                  onClick={() => setSubjectToDelete(null)}
                  className="px-4 py-2 rounded-none bg-slate-200 hover:bg-slate-300 text-slate-700 font-bold text-xs border border-slate-300 cursor-pointer transition-colors"
                  type="button"
                >
                  Cancelar
                </button>
                <button
                  type="button"
                  onClick={async () => {
                    const sbj = subjectToDelete;
                    setSubjectToDelete(null);
                    await runGlobalOperation(
                      async () => {
                        dbService.deleteSubject(sbj.id);
                      },
                      {
                        loadingMessage: `A eliminar disciplina ${sbj.name}...`,
                              requiredRule: 'turmas.manage',
                              userRole: currentUserRole,
                        successMessage: 'Operação feita com sucesso!'
                      }
                    );
                  }}
                  className="px-5 py-2.5 rounded-none bg-[#b91c1c] hover:bg-[#7a0c0c] text-white font-bold text-xs flex items-center gap-2 cursor-pointer transition-colors shadow-none border-none"
                >
                  <span className="material-symbols-outlined text-[16px]">delete</span>
                  <span>Eliminar</span>
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
