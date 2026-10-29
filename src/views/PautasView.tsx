import React, { useState, useEffect, useMemo, useRef } from 'react';
import { SchoolDatabase, UserRole, User, ClassRoom, Subject } from '../types';
import { GradeTypeKey, StudentMiniPautaItem, StudentPautaGeralItem, ALL_GRADE_TYPES } from '../types/pauta';
import { filterSubjectsForUser, getAllocatedClassIdsForUser } from '../utils/teacherSubjects';
import { runGlobalOperation } from '../context/OperationContext';
import { dbService } from '../services/db';
import { useAccessControl } from '../hooks/useAccessControl';
import { getStudentsForClass } from '../utils/classStudentsRoster';
import { sortPautaRowsByName } from '../utils/alphabetical';
import { getSubjectsForClass } from '../utils/classSubjects';
import {
  buildMiniPautaRows,
  buildPautaGeralRows,
  syncStoredMiniPautaRows,
  recalcMiniPautaRow,
  refreshMiniPautaStanding,
  summarizePautaGeralRow,
  getPautaRegime,
  normalizeGradeRules,
  MiniPautaCalcContext,
  PautaClassContext
} from '../utils/pautaCalculations';
import { isKeySubjectFor } from '../utils/keySubjects';
import { resolveCourseDurationYears, classAllowsRecurso, recursoBlockedReason } from '../utils/recursoRules';
import { resolveTeacherForSubject } from '../utils/subjectTeacherResolver';
import { buildPautaHeader } from '../utils/pautaHeader';
import { exportMiniPautaExcel, exportPautaFinalExcel } from '../utils/pautaExcelExport';
import { buildPautaGradeTypes, visiblePautaRows, PautaMtKey, toggleMiniPautaType, togglePautaMt, withMiniPautaLockedTypes } from '../utils/pautaView';
import { GradeTypeSelector } from '../components/pauta/GradeTypeSelector';
import { MiniPautaTable } from '../components/pauta/MiniPautaTable';
import { PautaGeralTable } from '../components/pauta/PautaGeralTable';
import { getFallbackAcademicYear, getGradeLaunchLockInfo } from '../utils/academicYear';

interface PautasViewProps {
  db: SchoolDatabase;
  currentUserRole: UserRole;
  currentUser?: User;
  onNavigateToImport?: () => void;
}

export const PautasView: React.FC<PautasViewProps> = ({ db, currentUserRole, currentUser, onNavigateToImport }) => {
  // Navigation Tabs: 'minipauta' (Mini Pauta por Disciplina) vs 'pauta' (Pauta Geral)
  const [activeTab, setActiveTab] = useState<'minipauta' | 'pauta'>('minipauta');
  // A Pauta Geral (todas as disciplinas da classe) é só para Admin, Secretaria,
  // Direção Geral e Direção Pedagógica. O Professor vê apenas a sua Mini-Pauta.
  const canSeePautaGeral = currentUserRole !== 'professor';
  useEffect(() => {
    if (!canSeePautaGeral && activeTab !== 'minipauta') setActiveTab('minipauta');
  }, [canSeePautaGeral, activeTab]);

  // Turmas visíveis no seletor "Turma": Admin/Direção/Secretaria veem todas;
  // um Professor só vê as turmas onde está efetivamente alocado (Atribuição/
  // Alocação/Horário), nunca a lista completa de turmas da instituição.
  const allocatedClassIds = useMemo(() => getAllocatedClassIdsForUser(db, currentUser), [db, currentUser]);
  const availableClasses = useMemo(() => {
    const all = db.classes || [];
    if (!allocatedClassIds) return all; // Admin/Secretaria/Direção Geral/Pedagógico: todas as turmas
    // Professor: SÓ as turmas que lhe foram atribuídas. Sem nenhuma atribuição
    // a lista fica vazia ("Nenhuma turma atribuída a si") em vez de mostrar tudo.
    return all.filter((c) => allocatedClassIds.has(String(c.id)));
  }, [db.classes, allocatedClassIds]);

  const [selectedClassId, setSelectedClassId] = useState<string>(
    availableClasses[0]?.id ? String(availableClasses[0].id) : ''
  );

  // Disciplina(s) oferecidas no seletor "Disciplina da Mini-Pauta": têm de ser as
  // disciplinas REALMENTE ATRIBUÍDAS à turma selecionada (Secretaria Académica →
  // Atribuição, via getSubjectsForClass — a mesma lógica já usada em TurmasView >
  // Horários), e não a lista geral de "disciplinas deste professor" em qualquer
  // turma. Antes, este seletor chamava getAvailableSubjectsForUser diretamente,
  // ignorando por completo a turma selecionada.
  const activeClassForSubjects = useMemo(
    () => availableClasses.find((c) => String(c.id) === String(selectedClassId)) || availableClasses[0],
    [availableClasses, selectedClassId]
  );

  const availableSubjects = useMemo(() => {
    // Só as disciplinas oficialmente atribuídas a ESTA turma (Secretaria
    // Académica → Atribuição). Sem fallback: uma turma sem Atribuição
    // preenchida não deve mostrar disciplinas de outra turma/classe, nem a
    // lista geral de disciplinas da instituição — fica vazia até a
    // Secretaria preencher a Atribuição dessa turma.
    const forClass = getSubjectsForClass(db, activeClassForSubjects);
    return filterSubjectsForUser(forClass, db, currentUser, activeClassForSubjects?.id);
  }, [db, activeClassForSubjects, currentUser]);

  const [selectedSubjectId, setSelectedSubjectId] = useState<string>(
    availableSubjects[0]?.id ? String(availableSubjects[0].id) : ''
  );

  const [isDirectorSigned, setIsDirectorSigned] = useState<boolean>(
    () => !!db.pauta?.isDirectorSigned || db.pauta?.status === 'homologada'
  );

  useEffect(() => {
    if (db.pauta?.isDirectorSigned || db.pauta?.status === 'homologada') {
      setIsDirectorSigned(true);
    }
  }, [db.pauta?.isDirectorSigned, db.pauta?.status]);

  // Current academic year from institution settings
  const currentAcademicYear = db.settings?.currentAcademicYear || getFallbackAcademicYear();

  // Exportação em Excel — mesmo cabeçalho oficial e mesma descrição da impressão.
  const handleExportExcel = async () => {
    const institution = db.settings;
    // Respeita "ocultar desistentes/transferidos": as linhas ocultas saem do Excel e re-numera-se.
    const visFilter = { hideDesistentes, hideTransferidos };
    const exportMiniRows = visiblePautaRows(miniPautaRows, visFilter).map(({ row, displayNum }) => ({ ...row, num: displayNum }));
    const exportGeralRows = visiblePautaRows(pautaGeralRows, visFilter).map(({ row, displayNum }) => ({ ...row, num: displayNum }));
    await runGlobalOperation(
      async () => {
        const header = buildPautaHeader({
          kind: activeTab === 'minipauta' ? 'minipauta' : 'pauta',
          settings: institution,
          activeClass,
          subject: activeTab === 'minipauta' ? activeSubject : undefined,
          teacherName,
          regime,
          totalStudents: activeTab === 'minipauta' ? exportMiniRows.length : exportGeralRows.length,
          parts: { npp: selectedGradeTypes.has('NPP'), pg: selectedGradeTypes.has('PG') }
        });
        if (activeTab === 'minipauta') {
          await exportMiniPautaExcel({
            rows: exportMiniRows,
            header,
            regime,
            selectedGradeTypes,
            isKeySubject,
            passingGrade: gradeRules.passingGrade,
            recursoMinGrade: gradeRules.recursoMinGrade,
            roundHalfUp: gradeRules.roundHalfUp,
            hideDebtorGrades,
            signatures: {
              teacher: teacherName || activeSubject?.coordinatorName || '',
              classHead: activeClass?.headTeacherName || 'Director de Turma',
              pedagogicDirector: institution?.directorPedagogico || institution?.directorGeral || 'Director Pedagógico'
            }
          });
        } else {
          await exportPautaFinalExcel({
            rows: exportGeralRows,
            subjects: classSubjects,
            header,
            regime,
            selectedGradeTypes: pautaGradeTypes,
            isKey: (sb) => isKeySubjectFor(sb, activeClass?.grade, activeClass?.area),
            passingGrade: gradeRules.passingGrade,
            hideDebtorGrades,
            signatures: {
              classHead: activeClass?.headTeacherName || 'Director de Turma',
              pedagogicDirector: institution?.directorPedagogico || 'Director Pedagógico',
              generalDirector: institution?.directorGeral || 'Director Geral'
            }
          });
        }
      },
      {
        loadingMessage: 'A gerar o ficheiro Excel...',
        successMessage: 'Ficheiro Excel exportado com sucesso!',
        errorMessage: 'Não foi possível exportar para Excel'
      }
    );
  };

  // Print guard: "sem uma pauta ou mini pauta ser homologada não pode ser impressão"
  const handlePrintDocument = async () => {
    const isHomologada = isDirectorSigned || db.pauta?.status === 'homologada';
    if (!isHomologada) {
      await runGlobalOperation(
        async () => {
          throw new Error('Sem uma pauta ou mini pauta ser homologada não pode ser impressa.');
        },
        {
          loadingMessage: 'A verificar homologação pedagógica...',
          errorMessage: 'Impressão Bloqueada',
          errorDetails: 'Sem a homologação da Direção Pedagógica, a pauta ou mini-pauta não possui validade oficial para ser emitida ou impressa.'
        }
      );
      return;
    }
    window.print();
  };

  // Filter for Grade Types (MT1, MT2, MT3, MFD, MF, MAC, NPP, NPT, PG, CA)
  const [selectedGradeTypes, setSelectedGradeTypes] = useState<Set<GradeTypeKey>>(
    // Modelo oficial: MAC, NPT, MT, MFD. NPP e PG só entram automaticamente quando a
    // disciplina já tem esse tipo de nota lançado (ver efeito abaixo) ou se forem marcados.
    // MT1, MT2, MT3 e MFD são fixas na Mini-Pauta (nunca desmarcadas).
    withMiniPautaLockedTypes(ALL_GRADE_TYPES.map((g) => g.key).filter((k) => k !== 'NPP' && k !== 'PG' && k !== 'CA'))
  );

  // Pauta: só MT1, MT2 e MT3 se podem desmarcar, e isso apenas OCULTA a coluna. Este estado é
  // independente do da Mini-Pauta e não entra em nenhum cálculo, por isso nenhuma nota muda.
  const [pautaMtVisible, setPautaMtVisible] = useState<Set<PautaMtKey>>(new Set<PautaMtKey>(['MT1', 'MT2', 'MT3']));

  // Financial Compliance: Hide debtor grades on print option
  const [hideDebtorGrades, setHideDebtorGrades] = useState<boolean>(true);
  const [previewHiddenOnScreen, setPreviewHiddenOnScreen] = useState<boolean>(false);
  // Ocultar da listagem (ecrã, impressão e Excel) os alunos desistentes e/ou transferidos.
  const [hideDesistentes, setHideDesistentes] = useState<boolean>(false);
  const [hideTransferidos, setHideTransferidos] = useState<boolean>(false);
 
 // Structural placeholders ONLY: used so grade calculations don't crash before the
 // institution has registered any class/subject. They are never shown as if real —
 // the selectors above already render "Nenhuma turma cadastrada" in that case.
  const fallbackClass: ClassRoom = useMemo(() => ({
    id: '',
    name: '',
    grade: '',
    section: '',
    cycle: '',
    area: '',
    shift: 'Manhã',
    room: '',
    studentCount: 0,
    maxCapacity: 0,
    headTeacherId: '',
    headTeacherName: '',
    academicYear: db.settings?.currentAcademicYear || ''
  }), [db.settings?.currentAcademicYear]);

  const fallbackSubject: Subject = useMemo(() => ({
    id: '',
    name: '',
    code: '',
    cycle: '',
    weeklyHours: 0,
    area: ''
  }), []);
  // Ensure selectedClassId is valid (dentro das turmas visíveis a este utilizador)
  useEffect(() => {
    if (availableClasses.length > 0 && !availableClasses.some((c) => String(c.id) === String(selectedClassId))) {
      setSelectedClassId(String(availableClasses[0].id));
    }
  }, [availableClasses, selectedClassId]);

  // Ensure selectedSubjectId is valid
  useEffect(() => {
    if (availableSubjects.length > 0 && !availableSubjects.some((s) => String(s.id) === String(selectedSubjectId))) {
      setSelectedSubjectId(String(availableSubjects[0].id));
    } else if (availableSubjects.length === 0 && selectedSubjectId !== '') {
      setSelectedSubjectId('');
    }
  }, [availableSubjects, selectedSubjectId]);

  const activeClass = availableClasses.find((c) => String(c.id) === String(selectedClassId)) || availableClasses[0] || fallbackClass;

  // Regras & Escala de Notas configuradas em Configurações (aba TabRegrasNotas).
  // Estas regras passam a ser o "contrato" usado por TODOS os cálculos da Pauta
  // e Mini-Pauta, em vez de valores fixos no código.
  const gradeRules = useMemo(() => normalizeGradeRules(db.settings?.gradeRules as any), [db.settings?.gradeRules]);

  // Avaliações (MAC/NPP/NPT) marcadas nos chips. Uma avaliação desmarcada significa que
  // o professor não aplicou essa prova, logo NÃO conta na média do trimestre (MT).
  const hasMAC = selectedGradeTypes.has('MAC');
  const hasNPP = selectedGradeTypes.has('NPP');
  const hasNPT = selectedGradeTypes.has('NPT');
  const hasNEE = selectedGradeTypes.has('NEE');
  const hasNEO = selectedGradeTypes.has('NEO');
  const hasNER = selectedGradeTypes.has('NER');
  const hasAAV = selectedGradeTypes.has('AAV');
  const hasPCP = selectedGradeTypes.has('PCP');
  const enabledEval = useMemo(
    () => ({ MAC: hasMAC, NPP: hasNPP, NPT: hasNPT, NEE: hasNEE, NEO: hasNEO, NER: hasNER, AAV: hasAAV, PCP: hasPCP }),
    [hasMAC, hasNPP, hasNPT, hasNEE, hasNEO, hasNER, hasAAV, hasPCP]
  );
  const activeSubject =
    availableSubjects.find((s) => String(s.id) === String(selectedSubjectId)) ||
    availableSubjects[0] ||
    fallbackSubject;

  // Regime de avaliação da classe: 'exame' (6.ª, 9.ª, 12.ª, 13.ª), 'eja' ou 'transicao'.
  // Decide as colunas (NEE/NEO/NER, AAV/PCP...) e as regras de Recurso.
  const regime = useMemo(
    () => getPautaRegime(activeClass?.grade, activeClass?.name, activeClass?.area),
    [activeClass?.grade, activeClass?.name, activeClass?.area]
  );

  // Colunas que a Pauta mostra (impressão, ecrã e Excel): MT visíveis + MFD + MF.
  const pautaGradeTypes = useMemo(() => buildPautaGradeTypes(pautaMtVisible, regime), [pautaMtVisible, regime]);
  const isKeySubject = useMemo(
    () => isKeySubjectFor(activeSubject, activeClass?.grade, activeClass?.area),
    [activeSubject, activeClass?.grade, activeClass?.area]
  );
  const teacherName = useMemo(
    () => (activeSubject?.name ? resolveTeacherForSubject(db, activeSubject, activeClass?.id) : ''),
    [db, activeSubject, activeClass?.id]
  );
  // Duração do curso da turma (3 ou 4 anos): decide em que classe (12.ª ou 13.ª) há Exame de Recurso.
  const courseDurationYears = useMemo(
    () => resolveCourseDurationYears(db.courses, activeClass),
    [db.courses, activeClass?.id, activeClass?.area]
  );
  const recursoBlockedMsg = useMemo(
    () => (regime === 'exame' && !classAllowsRecurso(activeClass?.grade, courseDurationYears) ? recursoBlockedReason(activeClass?.grade, courseDurationYears) : ''),
    [regime, activeClass?.grade, courseDurationYears]
  );
  const classCtx: PautaClassContext = useMemo(
    () => ({
      labels: [activeClass?.name, activeClass?.area],
      courseName: activeClass?.area,
      enabled: enabledEval,
      currentTrimester: db.settings?.currentTrimester,
      courseDurationYears
    }),
    [activeClass?.name, activeClass?.area, enabledEval, db.settings?.currentTrimester, courseDurationYears]
  );
  const calcCtx: MiniPautaCalcContext = useMemo(
    () => ({ regime, classGrade: activeClass?.grade, isKeySubject, rules: gradeRules, enabled: enabledEval, courseDurationYears }),
    [regime, activeClass?.grade, isKeySubject, gradeRules, enabledEval, courseDurationYears]
  );

  const isPreviousAcademicYear = activeClass?.academicYear ? activeClass.academicYear !== currentAcademicYear : false;

  // Regras de Trancamento definidas em Configurações > Ano Letivo & Calendário: bloqueia o
  // lançamento de notas do Trimestre atualmente em curso se ele já tiver sido Encerrado, ou
  // se já tiver passado a janela de dias úteis configurada desde o Término Letivo. A Direção
  // Pedagógica e a Administração continuam a poder lançar/corrigir notas sempre.
  const currentTrimester = (db.settings?.currentTrimester || '1') as '1' | '2' | '3';
  const gradeLaunchLock = useMemo(
    () => getGradeLaunchLockInfo(db.settings, currentTrimester),
    [db.settings, currentTrimester]
  );
  const isLockedByCalendar = gradeLaunchLock.locked && currentUserRole === 'professor';
  const isTeacherReadOnly = currentUserRole === 'professor' && (isPreviousAcademicYear || isLockedByCalendar);
  const isSecretaria = currentUserRole === 'secretaria';

  // Matriz ACL: quem lança notas, importa Excel e homologa passa a ser decidido
  // em Configurações → Perfis & Permissões, e não por cargo fixo no código.
  const acl = useAccessControl(currentUserRole);
  const canEditGrades = acl.can('pautas.edit_notas');
  const canHomologate = acl.can('pautas.homologar');
  const isReadOnlyMode = isTeacherReadOnly || !canEditGrades;

  // Students belonging strictly to the selected class
  const classStudents = useMemo(() => {
    return getStudentsForClass(selectedClassId, db.students || [], activeClass?.name);
  }, [selectedClassId, db.students, activeClass?.name]);

  // Subjects taught in the active class — a Pauta Geral só pode mostrar as
  // disciplinas realmente lecionadas NESTA turma/classe (horário, alocação de
  // professores ou plano curricular da classe), nunca todas as disciplinas
  // cadastradas na instituição.
  // Foco Curricular da Pauta Geral = TODAS as disciplinas atribuídas a esta
  // turma (Secretaria Académica → Atribuição), sempre a lista completa, nunca
  // uma única disciplina nem disciplinas de outra turma. Sem Atribuição
  // preenchida para esta turma, fica vazia (não usa a disciplina da
  // Mini-Pauta como substituto, para não mostrar uma coluna não atribuída).
  const classSubjects = useMemo(() => filterSubjectsForUser(getSubjectsForClass(db, activeClass), db, currentUser, activeClass?.id), [
    db,
    activeClass,
    currentUser
  ]);

  // Persistent cache of edited grades per class, subject, and student
  const [gradesCache, setGradesCache] = useState<Record<string, Record<string, Record<string, StudentMiniPautaItem>>>>({});

  // Refs holding the latest values of things that change identity very often
  // (every Firebase Realtime Database sync replaces db.students/classStudents
  // with a brand-new array, even when nothing relevant actually changed). These
  // refs let the "reload rows" effects below read the CURRENT data without
  // being re-triggered by every background sync, which used to wipe out grades
  // the professor had just typed (and any MT1/MT2/MT3/MFD calculated from them)
  // before they had a chance to click "Salvar" — they simply kept resetting
  // back to blank/zero.
  const classStudentsRef = useRef(classStudents);
  useEffect(() => {
    classStudentsRef.current = classStudents;
  }, [classStudents]);

  const dbStudentsRef = useRef(db.students);
  useEffect(() => {
    dbStudentsRef.current = db.students;
  }, [db.students]);

  const gradesCacheRef = useRef(gradesCache);
  useEffect(() => {
    gradesCacheRef.current = gradesCache;
  }, [gradesCache]);

  // Main Grade Rows state
  const [miniPautaRows, setMiniPautaRows] = useState<StudentMiniPautaItem[]>(() => {
    const subjectCache = gradesCache[selectedClassId]?.[selectedSubjectId];
    return buildMiniPautaRows(classStudents, selectedSubjectId, db.students, subjectCache, gradeRules, {
      regime,
      classGrade: activeClass?.grade,
      isKeySubject,
      enabled: enabledEval,
      currentTrimester: db.settings?.currentTrimester,
      subjectName: (db.subjects || []).find((x: any) => String(x.id) === String(selectedSubjectId))?.name
    });
  });

  const [pautaGeralRows, setPautaGeralRows] = useState<StudentPautaGeralItem[]>(() => {
    const classCache = gradesCache[selectedClassId];
    return buildPautaGeralRows(classStudents, classSubjects, db.students, classCache, activeClass?.grade, gradeRules, classCtx);
  });

  // Rebuild rows ONLY when the professor actually switches turma or disciplina.
  // IMPORTANT: this must NOT depend on `classStudents` / `db.students` directly.
  // Those get a brand-new array reference on every Firebase Realtime Database
  // sync (see services/db.ts onValue listener), including syncs triggered by
  // the professor's OWN "Salvar" click a moment earlier. Depending on them here
  // caused this effect to re-run while notes were still being typed, discarding
  // the in-progress mac1/npp1/npt1 values (and the mt1/mt2/mt3/mfd computed
  // from them) and replacing them with blank/zero rows — which is what made it
  // look like the MT1/MT2/MT3/MFD calculations "never happened".
  useEffect(() => {
    const stored = dbService.getMiniPautaRows(selectedClassId, selectedSubjectId);
    if (stored && Array.isArray(stored) && stored.length > 0) {
      // Recalcula MT1/MT2/MT3/MFD/CA a partir do MAC/NPP/NPT guardados, em vez
      // de confiar ciegamente no valor persistido. Registos gravados antes desta
      // correção (ou importados/editados numa versão anterior com bug) tinham
      // mt1/mt2/mt3/mfd fixados em 0 mesmo com MAC/NPP/NPT lançados — e como o
      // cálculo só corria ao editar uma célula, esses zeros ficavam "presos" para
      // sempre em cada carregamento da Mini-Pauta.
      // A situação (Desistente/Transferido) sai SEMPRE da ficha actual do aluno e das notas
      // reais — nunca de sinalizadores gravados com regras antigas.
      const synced = syncStoredMiniPautaRows(
        stored as StudentMiniPautaItem[], classStudentsRef.current, selectedSubjectId, dbStudentsRef.current || [], gradeRules,
        { ...calcCtx, currentTrimester: db.settings?.currentTrimester, subjectName: (db.subjects || []).find((x: any) => String(x.id) === String(selectedSubjectId))?.name }
      );
      const recalculated = refreshMiniPautaStanding(
        synced.map((row: StudentMiniPautaItem) => recalcMiniPautaRow(row, calcCtx)),
        dbStudentsRef.current || [],
        { ...calcCtx, currentTrimester: db.settings?.currentTrimester }
      );
      // Ordem alfabética pelo nome do aluno (e renumeração 1, 2, 3…).
      setMiniPautaRows(sortPautaRowsByName(recalculated));
      return;
    }
    const subjectCache = gradesCacheRef.current[selectedClassId]?.[selectedSubjectId];
    setMiniPautaRows(
      buildMiniPautaRows(classStudentsRef.current, selectedSubjectId, dbStudentsRef.current, subjectCache, gradeRules, {
        regime,
        classGrade: activeClass?.grade,
        isKeySubject,
        enabled: enabledEval,
        currentTrimester: db.settings?.currentTrimester,
        subjectName: (db.subjects || []).find((x: any) => String(x.id) === String(selectedSubjectId))?.name
      })
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedClassId, selectedSubjectId]);

  useEffect(() => {
    const classCache = gradesCacheRef.current[selectedClassId];
    setPautaGeralRows(
      buildPautaGeralRows(classStudentsRef.current, classSubjects, dbStudentsRef.current, classCache, activeClass?.grade, gradeRules, classCtx)
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedClassId, activeClass?.grade, gradeRules, classCtx]);

  // Quando o professor marca/desmarca MAC, NPP ou NPT, recalcula já as médias:
  // MT = média apenas das avaliações marcadas E com nota lançada.
  const evalFlagsInitRef = useRef(true);
  useEffect(() => {
    if (evalFlagsInitRef.current) {
      evalFlagsInitRef.current = false;
      return;
    }
    const recalculated = miniPautaRows.map((row) => recalcMiniPautaRow(row, calcCtx));
    setMiniPautaRows(recalculated);

    // Mantém a Pauta Geral sincronizada para a disciplina seleccionada.
    setPautaGeralRows((prev) =>
      prev.map((studentRow, i) => {
        const r = recalculated[i];
        if (!r || r.isDesistente) return studentRow;
        return summarizePautaGeralRow(
          {
            ...studentRow,
            subjectGrades: {
              ...studentRow.subjectGrades,
              [selectedSubjectId]: { mt1: r.mt1, mt2: r.mt2, mt3: r.mt3, mfd: r.mfd, mf: r.mf ?? '', ner: r.ner ?? '' }
            }
          },
          classSubjects,
          activeClass?.grade,
          gradeRules,
          regime,
          classCtx
        );
      })
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabledEval, regime]);

  // Se a disciplina já tem NPP ou PG lançados, marca-os (uma única vez por turma/disciplina)
  // para que as médias existentes não mudem em silêncio.
  const autoKeyRef = useRef('');
  useEffect(() => {
    const key = `${selectedClassId}|${selectedSubjectId}`;
    if (autoKeyRef.current === key || miniPautaRows.length === 0) return;
    autoKeyRef.current = key;
    const isNum = (v: unknown) => typeof v === 'number';
    const hasNPP = miniPautaRows.some((r) => isNum(r.npp1) || isNum(r.npp2) || isNum(r.npp3));
    const hasPG = regime === 'transicao' && miniPautaRows.some((r) => isNum(r.pg));
    if (hasNPP || hasPG) {
      setSelectedGradeTypes((prev) => {
        const next = new Set(prev);
        if (hasNPP) next.add('NPP');
        if (hasPG) next.add('PG');
        return next;
      });
    }
  }, [miniPautaRows, selectedClassId, selectedSubjectId, regime]);

  // Toggle single grade type
  const handleToggleGradeType = (key: GradeTypeKey) => {
    if (activeTab === 'pauta') {
      // Pauta: só MT1/MT2/MT3, e só para mostrar/ocultar (as notas não são tocadas).
      setPautaMtVisible((prev) => togglePautaMt(prev, key));
      return;
    }
    // Mini-Pauta: MT1/MT2/MT3/MFD ficam sempre marcadas.
    setSelectedGradeTypes((prev) => toggleMiniPautaType(prev, key));
  };

  // Preset Handlers
  const handleSelectAllTypes = () => {
    setSelectedGradeTypes(withMiniPautaLockedTypes(ALL_GRADE_TYPES.map((g) => g.key)));
  };

  const handleSelectAveragesOnly = () => {
    setSelectedGradeTypes(withMiniPautaLockedTypes(['MT1', 'MT2', 'MT3', 'MFD', 'MF']));
  };

  const handleSelectEvaluationsOnly = () => {
    setSelectedGradeTypes(withMiniPautaLockedTypes(['MAC', 'NPP', 'NPT', 'PG']));
  };

  const handleResetDefaultMiniPauta = () => {
    setSelectedGradeTypes(withMiniPautaLockedTypes(ALL_GRADE_TYPES.map((g) => g.key)));
  };

  // Real-time calculation when editing a grade cell in Mini-Pauta
  const handleMiniPautaCellChange = (rowIndex: number, field: keyof StudentMiniPautaItem, value: any) => {
    // Sem a regra "pautas.edit_notas" na matriz ACL, a célula não aceita edição.
    if (!canEditGrades) {
      acl.guard('pautas.edit_notas', () => undefined);
      return;
    }

    const current = miniPautaRows[rowIndex];
    if (!current) return;
    const edited = { ...current, [field]: value } as StudentMiniPautaItem;
    // Recalcula MT1-3, MFD, MF, CA e situação conforme o regime (transição / exame / EJA).
    const row = recalcMiniPautaRow(edited, calcCtx);

    setMiniPautaRows((prev) => {
      const updated = [...prev];
      updated[rowIndex] = row;
      return updated;
    });

    setGradesCache((prev) => {
      const classCache = prev[selectedClassId] || {};
      const subjectCache = classCache[selectedSubjectId] || {};
      return {
        ...prev,
        [selectedClassId]: {
          ...classCache,
          [selectedSubjectId]: {
            ...subjectCache,
            [row.studentId]: row
          }
        }
      };
    });

    // Sincroniza também a nota desta disciplina na Pauta Geral (MF e situação do aluno).
    setPautaGeralRows((prev) => {
      const updated = [...prev];
      const studentRow = updated[rowIndex];
      if (studentRow && !row.isDesistente) {
        updated[rowIndex] = summarizePautaGeralRow(
          {
            ...studentRow,
            subjectGrades: {
              ...studentRow.subjectGrades,
              [selectedSubjectId]: { mt1: row.mt1, mt2: row.mt2, mt3: row.mt3, mfd: row.mfd, mf: row.mf ?? '', ner: row.ner ?? '' }
            }
          },
          classSubjects,
          activeClass?.grade,
          gradeRules,
          regime,
          classCtx
        );
      }
      return updated;
    });
  };

  // Toggle student as Desistente
  const handleToggleDesistente = (rowIndex: number) => {
    setMiniPautaRows((prev) => {
      const updated = [...prev];
      const target = { ...updated[rowIndex] };
      target.isDesistente = !target.isDesistente;
      updated[rowIndex] = target.isDesistente ? { ...target, obs: 'Desistente' } : recalcMiniPautaRow(target, calcCtx);
      return updated;
    });

    setPautaGeralRows((prev) => {
      const updated = [...prev];
      if (updated[rowIndex]) {
        const studentRow = { ...updated[rowIndex], isDesistente: !updated[rowIndex].isDesistente };
        updated[rowIndex] = summarizePautaGeralRow(studentRow, classSubjects, activeClass?.grade, gradeRules, regime, classCtx);
      }
      return updated;
    });
  };

  // Stats calculation
  const totalStudents = miniPautaRows.length;
  const debtorStudentsCount = miniPautaRows.filter((r) => r.isDebtor).length;
  const desistentesCount = miniPautaRows.filter((r) => r.isDesistente).length;
  const activeStudentsCount = totalStudents - desistentesCount;

  // Nota decisiva: nas classes de exame é a MF (quando há exame lançado), senão a MFD.
  const validMfds = miniPautaRows
    .filter((r) => !r.isDesistente && typeof (regime === 'exame' && typeof r.mf === 'number' ? r.mf : r.mfd) === 'number')
    .map((r) => (regime === 'exame' && typeof r.mf === 'number' ? r.mf : r.mfd) as number);

  const averageScore = validMfds.length > 0 ? (validMfds.reduce((a, b) => a + b, 0) / validMfds.length).toFixed(1) : '0.0';
  const approvedCount = validMfds.filter((score) => score >= gradeRules.passingGrade).length;
  const approvalRate = activeStudentsCount > 0 ? Math.round((approvedCount / activeStudentsCount) * 100) : 0;
  const resourceCount = validMfds.filter((score) => score < gradeRules.passingGrade).length;

  return (
    <div className="flex flex-col w-full gap-5 pb-16 printable-document">
      {/* Impressão das pautas: A4 horizontal definido SÓ por esta regra @page (sem "página nomeada"
          no contentor, que obrigava o navegador a quebrar a página e a ignorar a orientação). */}
      <style>{`
        @media print {
          @page {
            size: A4 landscape !important;
            margin: 4mm 5mm !important;
          }
        }
      `}</style>
      {/* Action Header & Tabs Navigation */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 no-print print:hidden">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <span className="text-[11px] font-bold uppercase tracking-widest text-slate-500">
              Gestão Acadêmica
            </span>
             <span className="text-[11px] font-bold uppercase tracking-widest text-slate-500">|
            </span>
            <span className="text-xs font-semibold text-[#0b1f3a]">
              {activeTab === 'minipauta' ? 'Mini-Pauta' : 'Pauta Final'}
            </span>
          </div>
          <h1 className="font-headline text-2xl lg:text-3xl font-extrabold text-[#0b1f3a] tracking-tight">GESTÃO DE NOTAS
          </h1>
        </div>

        {/* Global Action Buttons */}
        <div className="flex flex-wrap items-center gap-2">
          {/* Importar Pauta (Excel) — disponível para Admin/Direção Pedagógica/Secretaria em
              âmbito geral, e para o Professor apenas em âmbito da(s) disciplina(s) que lecciona. */}
          {onNavigateToImport && acl.can('pautas.import_excel') && (
            <button
              onClick={() => acl.guard('pautas.import_excel', () => onNavigateToImport())}
              className="px-3.5 py-2 rounded-xl bg-white hover:bg-slate-50 text-[#0b1f3a] border border-slate-300 font-bold text-xs flex items-center gap-1.5 shadow-2xs transition-colors cursor-pointer"
              title="Importar notas a partir de um ficheiro Excel/CSV"
            >
              <span className="material-symbols-outlined text-[18px]">upload_file</span>
              <span>Importar</span>
            </button>
          )}

          <button
            onClick={handleExportExcel}
            className="px-3.5 py-2 rounded-xl bg-white hover:bg-slate-50 text-[#0b1f3a] border border-slate-300 font-bold text-xs flex items-center gap-1.5 shadow-2xs transition-colors cursor-pointer"
            title="Exportar esta pauta para Excel (mesmo cabeçalho da impressão)"
          >
            <span className="material-symbols-outlined text-[18px] text-emerald-700">table_view</span>
            <span>Exportar</span>
          </button>

          {/* Print Button - Blocked if not homologated */}
          <button
            onClick={handlePrintDocument}
            className={`px-4 py-2.5 rounded-xl font-bold text-xs flex items-center gap-2 shadow-xs transition-all cursor-pointer ${
              isDirectorSigned || db.pauta?.status === 'homologada'
                ? 'bg-[#0b1f3a] hover:bg-[#122c50] text-white'
                : 'bg-slate-200 hover:bg-slate-300 text-slate-600'
            }`}
            title={
              isDirectorSigned || db.pauta?.status === 'homologada'
                ? 'Imprimir documento pedagógico oficial'
                : 'A impressão só é permitida após homologação pela Direção Pedagógica'
            }
          >
            <span className="material-symbols-outlined text-[18px] text-amber-400">
              {isDirectorSigned || db.pauta?.status === 'homologada' ? 'print' : 'lock'}
            </span>
            <span>Imprimir</span>
            {(!isDirectorSigned && db.pauta?.status !== 'homologada') && (
              <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-100 text-amber-800 font-semibold">Bloqueado
              </span>
            )}
          </button>

          {/* Gravar notas: depende da regra pautas.edit_notas na matriz ACL */}
          {canEditGrades && (
            <button
              onClick={async () => {
                if (isTeacherReadOnly) {
                  await runGlobalOperation(
                    async () => {
                      throw new Error(
                        isPreviousAcademicYear
                          ? 'Os professores não podem alterar notas de mini pautas de anos lectivos anteriores.'
                          : gradeLaunchLock.reason || 'Lançamento de notas bloqueado pelas Regras de Trancamento do Ano Letivo.'
                      );
                    },
                    {
                      loadingMessage: 'A verificar permissão lectiva...',
                      errorMessage: isPreviousAcademicYear ? 'Ano Lectivo Anterior Bloqueado' : 'Lançamento de Notas Bloqueado',
                      errorDetails: isPreviousAcademicYear
                        ? 'Apenas é permitido o lançamento e alteração de notas para o ano lectivo corrente em curso.'
                        : gradeLaunchLock.reason || 'Consulte a Direção Pedagógica para reabrir o trimestre em Configurações > Ano Letivo.'
                    }
                  );
                  return;
                }

                await runGlobalOperation(
                  async () => {
                    // Avaliações desmarcadas (prova não realizada) não são gravadas, para que a
                    // média guardada coincida com a mostrada no ecrã.
                    const rowsToSave = miniPautaRows.map((r) => ({
                      ...r,
                      mac1: enabledEval.MAC ? r.mac1 : '', mac2: enabledEval.MAC ? r.mac2 : '', mac3: enabledEval.MAC ? r.mac3 : '',
                      npp1: enabledEval.NPP ? r.npp1 : '', npp2: enabledEval.NPP ? r.npp2 : '', npp3: enabledEval.NPP ? r.npp3 : '',
                      npt1: enabledEval.NPT ? r.npt1 : '', npt2: enabledEval.NPT ? r.npt2 : '', npt3: enabledEval.NPT ? r.npt3 : '',
                      nee: enabledEval.NEE ? r.nee ?? '' : '', neo: enabledEval.NEO ? r.neo ?? '' : '', ner: enabledEval.NER ? r.ner ?? '' : '',
                      aav1: enabledEval.AAV ? r.aav1 ?? '' : '', aav2: enabledEval.AAV ? r.aav2 ?? '' : '', aav3: enabledEval.AAV ? r.aav3 ?? '' : '',
                      pcp1: enabledEval.PCP ? r.pcp1 ?? '' : '', pcp2: enabledEval.PCP ? r.pcp2 ?? '' : '', pcp3: enabledEval.PCP ? r.pcp3 ?? '' : ''
                    }));
                    dbService.saveMiniPautaRows(selectedClassId, selectedSubjectId, rowsToSave, currentUser?.name);
                    await dbService.pushToCloudStorage();
                  },
                  {
                    loadingMessage: 'A gravar notas e a sincronizar na base de dados...',
                    successMessage: 'Pauta e notas gravadas com sucesso na base de dados!',
                    requiredRule: 'pautas.edit_notas',
                    userRole: currentUserRole
                  }
                );
              }}
              disabled={isTeacherReadOnly || !canEditGrades}
              className={`px-3.5 py-2 rounded-xl font-bold text-xs flex items-center gap-1.5 shadow-2xs transition-colors ${
                isTeacherReadOnly
                  ? 'bg-slate-300 text-slate-500 cursor-not-allowed'
                  : 'bg-[#0b1f3a] hover:bg-[#122c50] text-white cursor-pointer'
              }`}
              title={isTeacherReadOnly ? (isPreviousAcademicYear ? 'Bloqueado para anos lectivos anteriores' : gradeLaunchLock.reason) : 'Gravar notas na base de dados'}
            >
              <span className="material-symbols-outlined text-[18px]">
                {isTeacherReadOnly ? 'lock' : 'cloud_sync'}
              </span>
              <span>Enviar Notas</span>
            </button>
          )}

          {/* Homologate Button for Admin and Direção Pedagógica (Secretaria cannot homologate) */}
          {canHomologate && (
            <button
              onClick={async () => {
                const directorName = db.settings?.directorPedagogico || db.settings?.directorGeral || 'Director Pedagógico';
                await runGlobalOperation(
                  async () => {
                    setIsDirectorSigned(true);
                    dbService.markPautaAsSigned(directorName);
                    await dbService.pushToCloudStorage();
                  },
                  {
                    loadingMessage: `A homologar com ${directorName}...`,
                    successMessage: `Pauta homologada pela Direção Pedagógica (${directorName})!`,
                    requiredRule: 'pautas.homologar',
                    userRole: currentUserRole
                  }
                );
              }}
              className="px-3.5 py-2 rounded-xl bg-[#7a0c0c] hover:bg-[#8f1010] text-white font-bold text-xs flex items-center gap-1.5 shadow-2xs transition-colors cursor-pointer"
            >
              <span className="material-symbols-outlined text-[18px]">verified</span>
              <span>{isDirectorSigned ? 'Homologada' : 'Homologar'}</span>
            </button>
          )}

          {/* Secretaria Info Badge */}
          {isSecretaria && !canEditGrades && (
            <span className="px-3 py-1.5 rounded-xl bg-blue-50 text-blue-900 border border-blue-200 text-xs font-bold flex items-center gap-1.5">
              <span className="material-symbols-outlined text-[16px] text-blue-600">visibility</span>
              <span>Consulta & Impressão Oficial</span>
            </span>
          )}
        </div>
      </div>

      {/* TWO PRIMARY TABS (Mini Pauta & Pauta) */}
      {/* Requirement: "CRIA DUAS ABAS UMA PARA MINI PAUTA E OUTRA PARA PAUTA." */}
      <div className="bg-slate-100 p-1.5 rounded-2xl flex items-center gap-2 border border-slate-200 no-print print:hidden shadow-2xs max-w-fit">
        <button
          type="button"
          onClick={() => setActiveTab('minipauta')}
          className={`px-5 py-2.5 rounded-xl font-bold text-xs transition-all flex items-center gap-2 cursor-pointer ${
            activeTab === 'minipauta'
              ? 'bg-[#0b1f3a] text-white shadow-xs'
              : 'text-slate-600 hover:text-slate-900 hover:bg-white/60'
          }`}
        >
          <span className="material-symbols-outlined text-[18px]">view_week</span>
          <span>Mini-Pauta</span>
          <span className="px-1.5 py-0.5 rounded-full text-[10px] font-mono bg-white/20 text-white">
            Trimestral
          </span>
        </button>

        {canSeePautaGeral && (
        <button
          type="button"
          onClick={() => setActiveTab('pauta')}
          className={`px-5 py-2.5 rounded-xl font-bold text-xs transition-all flex items-center gap-2 cursor-pointer ${
            activeTab === 'pauta'
              ? 'bg-[#0b1f3a] text-white shadow-xs'
              : 'text-slate-600 hover:text-slate-900 hover:bg-white/60'
          }`}
        >
          <span className="material-symbols-outlined text-[18px]">table_chart</span>
          <span>Pauta Final</span>
          <span className="px-1.5 py-0.5 rounded-full text-[10px] font-mono bg-amber-400 text-slate-900 font-black">
            Geral
          </span>
        </button>
        )}
      </div>


      {/* Class & Subject Selectors */}
      <div className="bg-white p-4 rounded-2xl border border-slate-200 shadow-2xs grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs no-print print:hidden">
        <div>
          <label className="block uppercase font-bold text-slate-500 mb-1">Turma</label>
          <select
            value={selectedClassId}
            onChange={(e) => setSelectedClassId(e.target.value)}
            className="w-full h-9 px-3 rounded-lg bg-slate-100 font-bold text-slate-800 focus:bg-white focus:ring-1 focus:ring-[#0b1f3a]"
          >
            {(!availableClasses || availableClasses.length === 0) ? (
              <option value="">
                {currentUserRole === 'professor' ? 'Nenhuma turma atribuída a si' : 'Nenhuma turma cadastrada'}
              </option>
            ) : (
              availableClasses.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name} ({c.room})
                </option>
              ))
            )}
          </select>
        </div>

        <div>
          <div className="flex items-center justify-between mb-1">
            <label className="block uppercase font-bold text-slate-500 text-[11px]">
              {activeTab === 'minipauta' ? 'Disciplina' : 'Todas Disciplinas'}
            </label>
            {currentUserRole === 'professor' && (
              <span className="text-[10px] text-blue-700 font-semibold">(Suas disciplinas)</span>
            )}
          </div>
          <select
            value={selectedSubjectId}
            onChange={(e) => setSelectedSubjectId(e.target.value)}
            disabled={activeTab === 'pauta'}
            className={`w-full h-9 px-3 rounded-lg font-bold text-slate-800 focus:bg-white focus:ring-1 focus:ring-[#0b1f3a] ${
              activeTab === 'pauta' ? 'bg-slate-200 text-slate-500 cursor-not-allowed' : 'bg-slate-100'
            }`}
          >
            {availableSubjects.length === 0 ? (
              <option value="">Nenhuma disciplina</option>
            ) : (
              availableSubjects.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name} ({s.code})
                </option>
              ))
            )}
          </select>
        </div>

        <div>
          <label className="block uppercase font-bold text-slate-500 mb-1">Ano Lectivo</label>
          <div className="relative flex items-center">
            <input
              type="text"
              readOnly
              value={`${db.settings?.currentAcademicYear || getFallbackAcademicYear()}${activeClass?.shift ? ` •   (${activeClass.shift})` : ' • Presencial'}`}
              className="w-full h-9 px-3 pr-8 rounded-lg bg-slate-100 font-bold text-slate-700 text-xs border border-slate-200 cursor-default truncate select-none shadow-2xs"
              title="Ano Lectivo corrente em curso definido nas configurações da instituição"
            />
            <div className="absolute right-2.5 flex items-center gap-1.5 pointer-events-none">
              <span
                className="w-2 h-2 rounded-full bg-emerald-500"
                title="Ano letivo corrente ativo"
              />
              <span className="material-symbols-outlined text-slate-400 text-[14px]">
                lock
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* Warning if teacher is viewing a previous academic year class */}
      {isTeacherReadOnly && isPreviousAcademicYear && (
        <div className="p-3 bg-amber-50 border border-amber-200 rounded-xl flex items-center gap-2 text-amber-900 text-xs font-medium no-print print:hidden">
          <span className="material-symbols-outlined text-amber-600 text-[18px]">lock</span>
          <span>
            <strong>Modo Somente Leitura:</strong> Esta turma pertence ao ano lectivo anterior ({activeClass?.academicYear}). Os professores estão impossibilitados de alterar notas de mini pautas de anos anteriores.
          </span>
        </div>
      )}

      {/* Warning if the current trimester's grade launch window is locked (Regras de Trancamento) */}
      {isTeacherReadOnly && !isPreviousAcademicYear && isLockedByCalendar && (
        <div className="p-3 bg-amber-50 border border-amber-200 rounded-xl flex items-center gap-2 text-amber-900 text-xs font-medium no-print print:hidden">
          <span className="material-symbols-outlined text-amber-600 text-[18px]">lock_clock</span>
          <span>
            <strong>Lançamento de Notas Bloqueado:</strong> {gradeLaunchLock.reason}
          </span>
        </div>
      )}

      {recursoBlockedMsg && (
        <div className="no-print print:hidden bg-amber-50 border border-amber-200 text-amber-900 text-xs font-semibold rounded-xl px-3 py-2">
          {recursoBlockedMsg} Notas negativas nesta classe resultam em REPROVADO.
        </div>
      )}

      {/* KPI Stats Strip */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-center no-print print:hidden">
        <div className="bg-white p-3 rounded-xl border border-slate-200 shadow-2xs">
          <span className="text-[10px] uppercase font-bold text-slate-400 block">Média da Turma</span>
          <span className="font-headline text-2xl font-extrabold text-[#0b1f3a]">{averageScore}</span>
          <span className="text-[10px] text-slate-400">     Valores</span>
        </div>

        <div className="bg-white p-3 rounded-xl border border-slate-200 shadow-2xs">
          <span className="text-[10px] uppercase font-bold text-emerald-700 block">Taxa de Aproveitamento</span>
          <span className="font-headline text-2xl font-extrabold text-emerald-700">{approvalRate}%</span>
          <span className="text-[10px] text-slate-400">          {approvedCount} de {activeStudentsCount} alunos aptos</span>
        </div>

        <div className="bg-white p-3 rounded-xl border border-slate-200 shadow-2xs">
          <span className="text-[10px] uppercase font-bold text-[#7a0c0c] block">Em Recurso / Reprovados</span>
          <span className="font-headline text-2xl font-extrabold text-[#7a0c0c]">{resourceCount}  </span>
          <span className="text-[10px] text-slate-400">           Classificação &lt; 10 valores</span>
        </div>

        <div className="bg-white p-3 rounded-xl border border-slate-200 shadow-2xs">
          <span className="text-[10px] uppercase font-bold text-amber-700 block">Alunos com Propinas Pendentes</span>
          <span className="font-headline text-2xl font-extrabold text-amber-800">{debtorStudentsCount}   </span>
          <span className="text-[10px] text-slate-400">
            {hideDebtorGrades ?         'Notas ocultadas ao imprimir' : 'Visível'}
          </span>
        </div>
      </div>

      {/* Interactive Grade Type Selector & Debtor Controls */}
      {/* Requirements:
          1. "DEVE SER POSSIVEL SELECIONAR QUAIS TIPOS DE NOTAS (MT1,MT2,MT3,MFD,MF,MAC,NPP,NPT,PG,CA) VAI CONSTAR OU SER VISTO NA PAUTA OU MINI PAUTA."
          2. "COLOQUE OPÇÃO DE VER E OCULTAR NOTAS DOS ALUNOS DEVEDORES DA PAUTA AO IMPIRMIR."
      */}
      <GradeTypeSelector
        selectedTypes={activeTab === 'pauta' ? pautaGradeTypes : selectedGradeTypes}
        onToggleType={handleToggleGradeType}
        onSelectAll={handleSelectAllTypes}
        onSelectAveragesOnly={handleSelectAveragesOnly}
        onSelectEvaluationsOnly={handleSelectEvaluationsOnly}
        onResetDefaultMiniPauta={handleResetDefaultMiniPauta}
        hideDebtorGrades={hideDebtorGrades}
        onToggleHideDebtorGrades={setHideDebtorGrades}
        previewHiddenOnScreen={previewHiddenOnScreen}
        onTogglePreviewHiddenOnScreen={setPreviewHiddenOnScreen}
        hideDesistentes={hideDesistentes}
        onToggleHideDesistentes={setHideDesistentes}
        hideTransferidos={hideTransferidos}
        onToggleHideTransferidos={setHideTransferidos}
        desistentesCount={miniPautaRows.filter((r) => r.isDesistente && !r.isTransferido).length}
        transferidosCount={miniPautaRows.filter((r) => r.isTransferido).length}
        activeTab={activeTab}
        regime={regime}
      />

      {/* TAB CONTENT 1: MINI-PAUTA */}
      {activeTab === 'minipauta' && (
        <MiniPautaTable
          rows={miniPautaRows}
          onCellChange={handleMiniPautaCellChange}
          onToggleDesistente={handleToggleDesistente}
          selectedGradeTypes={selectedGradeTypes}
          hideDebtorGrades={hideDebtorGrades}
          hideDesistentes={hideDesistentes}
          hideTransferidos={hideTransferidos}
          previewHiddenOnScreen={previewHiddenOnScreen}
          activeClass={activeClass}
          activeSubject={activeSubject}
          settings={db.settings}
          isReadOnly={isReadOnlyMode}
          regime={regime}
          isKeySubject={isKeySubject}
          gradeRules={gradeRules}
          teacherName={teacherName}
        />
      )}

      {/* TAB CONTENT 2: PAUTA GERAL */}
      {activeTab === 'pauta' && canSeePautaGeral && (
        <PautaGeralTable
          rows={pautaGeralRows}
          subjects={classSubjects}
          selectedGradeTypes={pautaGradeTypes}
          hideDebtorGrades={hideDebtorGrades}
          hideDesistentes={hideDesistentes}
          hideTransferidos={hideTransferidos}
          previewHiddenOnScreen={previewHiddenOnScreen}
          activeClass={activeClass}
          onToggleDesistente={handleToggleDesistente}
          settings={db.settings}
          regime={regime}
          gradeRules={gradeRules}
          classCtx={classCtx}
        />
      )}
    </div>
  );
};
