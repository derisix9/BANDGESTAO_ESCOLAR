import React, { useState, useEffect } from 'react';
import { SchoolDatabase, AttendanceSheet, AttendanceStatus, AttendanceStudentItem, UserRole, User, Subject } from '../types';
import { dbService } from '../services/db';
import { useAccessControl } from '../hooks/useAccessControl';
import {
  filterSubjectsForUser,
  getAllocatedClassIdsForUser,
  getDayOfWeekFromDate,
  getTimetableEntriesForClassSubjectDay,
  formatTimetableEntriesAsSlot
} from '../utils/teacherSubjects';
import { getSubjectsForClass } from '../utils/classSubjects';
import { getStudentsForClass } from '../utils/classStudentsRoster';
import { resolveTeacherForSubject } from '../utils/subjectTeacherResolver';
import { runGlobalOperation, showOperationSuccess } from '../context/OperationContext';
import { getSummaryLockInfo } from '../utils/academicYear';
import { findSummariesForLesson, formatSummaryForAttendance } from '../utils/teacherWork';
import { TablePagination, usePagedList } from '../components/TablePagination';

interface AssiduidadeViewProps {
  db: SchoolDatabase;
  currentUserRole: UserRole;
  currentUser?: User;
  initialClassId?: string | number;
}

export const AssiduidadeView: React.FC<AssiduidadeViewProps> = ({
  db,
  currentUserRole,
  currentUser,
  initialClassId
}) => {
  // Professor só vê/regista assiduidade das turmas onde está efetivamente alocado.
  // Admin, Direção Pedagógica e Secretaria têm âmbito geral (todas as turmas).
  const allocatedClassIds = React.useMemo(
    () => getAllocatedClassIdsForUser(db, currentUser),
    [db, currentUser]
  );
  const availableClasses = React.useMemo(() => {
    if (!allocatedClassIds) return db.classes; // Admin/Secretaria/Direção: todas as turmas
    // Professor: só as turmas que lhe foram atribuídas (vazio se não tiver nenhuma).
    return db.classes.filter((c) => allocatedClassIds.has(String(c.id)));
  }, [db.classes, allocatedClassIds]);

  const [selectedClassId, setSelectedClassId] = useState<string>(() => {
    if (initialClassId && availableClasses.some((c) => String(c.id) === String(initialClassId))) {
      return String(initialClassId);
    }
    return availableClasses[0]?.id ? String(availableClasses[0].id) : '';
  });

  // Active Class primeiro, para que a lista de disciplinas venha da Atribuição
  // (Secretaria Académica) desta Classe/Curso — não de todas as disciplinas do sistema.
  const activeClassForSubjects = availableClasses.find((c) => String(c.id) === String(selectedClassId)) || availableClasses[0];
  const availableSubjects = React.useMemo(() => {
    // Só as disciplinas atribuídas a ESTA turma. Sem Atribuição preenchida,
    // fica vazio — não cai para a lista geral de disciplinas da instituição.
    const forClass = getSubjectsForClass(db, activeClassForSubjects);
    return filterSubjectsForUser(forClass, db, currentUser, activeClassForSubjects?.id);
  }, [db, activeClassForSubjects, currentUser]);

  const [selectedSubjectId, setSelectedSubjectId] = useState<string>(
    availableSubjects[0]?.id ? String(availableSubjects[0].id) : ''
  );
  const [selectedDate, setSelectedDate] = useState<string>(
    (() => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; })()
  );
  const [timeSlot, setTimeSlot] = useState<string>('08:30–10:00');
  const [lessonSummary, setLessonSummary] = useState<string>('');
  const [isSigned, setIsSigned] = useState<boolean>(false);
  const [signedBy, setSignedBy] = useState<string>('');
  const [signedAt, setSignedAt] = useState<string>('');
  const [sheetStatus, setSheetStatus] = useState<'aberto' | 'sincronizado' | 'homologado'>('aberto');
  const [isHistoryModalOpen, setIsHistoryModalOpen] = useState<boolean>(false);
  const [sheetPendingDelete, setSheetPendingDelete] = useState<AttendanceSheet | null>(null);

  // Auto-align selected subject with available disciplines
  useEffect(() => {
    if (availableSubjects.length > 0 && !availableSubjects.some((s) => String(s.id) === String(selectedSubjectId))) {
      setSelectedSubjectId(String(availableSubjects[0].id));
    } else if (availableSubjects.length === 0 && selectedSubjectId !== '') {
      setSelectedSubjectId('');
    }
  }, [availableSubjects, selectedSubjectId]);

  // Auto-align selected class with the classes this user is allowed to see
  useEffect(() => {
    if (availableClasses.length > 0 && !availableClasses.some((c) => String(c.id) === String(selectedClassId))) {
      setSelectedClassId(String(availableClasses[0].id));
    }
  }, [availableClasses, selectedClassId]);

  // Active Class & Subject from DB
  const activeClass = activeClassForSubjects;
  // Só disciplinas atribuídas a esta turma (e, para professores, que ele lecione).
  // Sem correspondência fica um marcador vazio — nunca uma disciplina não atribuída.
  const activeSubject: Subject =
    availableSubjects.find((s) => String(s.id) === String(selectedSubjectId)) ||
    availableSubjects[0] ||
    ({ id: '', name: '', code: '', cycle: '', weeklyHours: 0 } as Subject);
  // Ordem alfabética (A–Z) pelo nome completo — igual à Pauta e Mini-Pautas.
  const classStudents = activeClass ? getStudentsForClass(activeClass.id, db.students || [], activeClass.name) : [];
  const { page: pgClassStudents, setPage: setPgClassStudents, pageItems: visibleClassStudents } = usePagedList(classStudents, [classStudents.length]);

  // Horário oficial (Definir Horário, em Turmas/Disciplinas) para esta turma + disciplina, no dia da aula selecionada.
  const selectedDayOfWeek = getDayOfWeekFromDate(selectedDate);
  const scheduledEntriesToday = React.useMemo(
    () => getTimetableEntriesForClassSubjectDay(db, activeClass?.id, activeSubject?.name, selectedDayOfWeek),
    [db, activeClass?.id, activeSubject?.name, selectedDayOfWeek]
  );
  const autoTimeSlot = React.useMemo(() => formatTimetableEntriesAsSlot(scheduledEntriesToday), [scheduledEntriesToday]);
  const isScheduledToday = scheduledEntriesToday.length > 0;

  // Apenas Admin e Direção Pedagógica podem registar a chamada em qualquer dia;
  // o professor só pode fazê-lo no dia em que efetivamente lecciona a disciplina àquela turma.
  // Matriz ACL (Configurações → Perfis & Permissões): marcar chamada e
  // justificar faltas passam a depender das regras assiduidade.mark e
  // assiduidade.justify, e não do cargo escrito no código.
  const acl = useAccessControl(currentUserRole);
  const canMarkAttendance = acl.can('assiduidade.mark');
  const canJustifyAbsence = acl.can('assiduidade.justify');

  const canBypassScheduleLock = currentUserRole === 'admin' || currentUserRole === 'director';
  const isProfessorBlockedToday = currentUserRole === 'professor' && !canBypassScheduleLock && !isScheduledToday;

  // Regras de Trancamento definidas em Configurações > Ano Letivo & Calendário: bloqueia a
  // edição do sumário se o Trimestre a que a data pertence já foi Encerrado, ou se já passou
  // a tolerância (em horas) configurada desde o fim do dia da aula. A Direção Pedagógica e a
  // Administração continuam a poder editar sempre — só o professor fica sujeito ao prazo.
  const academicLock = React.useMemo(
    () => getSummaryLockInfo(db.settings, selectedDate),
    [db.settings, selectedDate]
  );
  const isLockedByCalendar = academicLock.locked && !canBypassScheduleLock;
  const isEditingBlocked = isProfessorBlockedToday || isLockedByCalendar;
  const editingBlockedReason = isProfessorBlockedToday
    ? 'Fora do dia lectivo desta disciplina — registo bloqueado'
    : isLockedByCalendar
    ? academicLock.reason
    : undefined;

  // Local student attendance map for currently active session
  const [studentsAttendance, setStudentsAttendance] = useState<Record<string, { status: AttendanceStatus; note: string; entryTime: string }>>({});

  // Sync state whenever Class, Subject, Date or Database changes
  useEffect(() => {
    if (!activeClass) return;

    // Look for existing attendance sheet in database
    const savedSheets = db.attendanceSheets || (db.attendance ? [db.attendance] : []);
    const existingSheet = savedSheets.find(
      (s) =>
        String(s.classId) === String(activeClass.id) &&
        String(s.subjectId) === String(activeSubject?.id) &&
        s.date === selectedDate
    );

    if (existingSheet) {
      setLessonSummary(existingSheet.lessonSummary || '');
      setIsSigned(Boolean(existingSheet.isDigitallySigned));
      setSignedBy(existingSheet.signedBy || '');
      setSignedAt(existingSheet.signedAt || '');
      setSheetStatus(existingSheet.status || 'aberto');
      setTimeSlot(existingSheet.timeSlot || '08:30–10:00');

      const mapping: Record<string, { status: AttendanceStatus; note: string; entryTime: string }> = {};
      classStudents.forEach((student) => {
        const item = existingSheet.students?.find((st) => String(st.studentId) === String(student.id));
        if (item) {
          mapping[student.id] = {
            status: item.status,
            note: item.note || '',
            entryTime: item.entryTime || (item.status === 'P' ? '08:30' : item.status === 'A' ? '08:45' : '—')
          };
        } else {
          mapping[student.id] = {
            status: 'P',
            note: '',
            entryTime: '08:30'
          };
        }
      });
      setStudentsAttendance(mapping);
    } else {
      // Draft / New attendance session for this date & class
      // Sem texto de modelo: o sumário vem da secção "Sumários das Aulas" (efeito abaixo) ou é escrito aqui.
      setLessonSummary('');
      setIsSigned(false);
      setSignedBy('');
      setSignedAt('');
      setSheetStatus('aberto');

      // Auto-preenche o Horário com o tempo lectivo oficial definido em Turmas/Disciplinas
      // para esta disciplina, nesta turma, no dia da semana correspondente à data selecionada.
      if (autoTimeSlot) {
        setTimeSlot(autoTimeSlot);
      }

      const mapping: Record<string, { status: AttendanceStatus; note: string; entryTime: string }> = {};
      classStudents.forEach((student) => {
        mapping[student.id] = {
          status: 'P',
          note: '',
          entryTime: '08:30'
        };
      });
      setStudentsAttendance(mapping);
    }
  }, [selectedClassId, selectedSubjectId, selectedDate, db.attendanceSheets, db.attendance, autoTimeSlot]);

  // Sumário diário (secção Sumários das Aulas) -> aparece sozinho em "Sumário da Aula" da assiduidade
  // para a mesma turma + disciplina + data. Declarado depois do efeito de sincronização para o sobrepor.
  const linkedSummaries = React.useMemo(
    () => (activeClass && activeSubject?.name ? findSummariesForLesson(db.lessonSummaries, String(activeClass.id), activeSubject.name, selectedDate) : []),
    [db.lessonSummaries, activeClass, activeSubject?.name, selectedDate]
  );
  const linkedSummaryText = React.useMemo(() => formatSummaryForAttendance(linkedSummaries), [linkedSummaries]);
  // Depende também das folhas gravadas: o efeito de sincronização acima repõe o texto da folha
  // sempre que a base de dados muda, e o sumário do professor tem de voltar a prevalecer.
  useEffect(() => {
    if (linkedSummaryText) setLessonSummary(linkedSummaryText);
  }, [linkedSummaryText, selectedClassId, selectedSubjectId, selectedDate, db.attendanceSheets, db.attendance]);

  const handleStatusChange = (studentId: string, status: AttendanceStatus) => {
    // Marcar presença/falta exige assiduidade.mark; converter uma falta em
    // justificada (FJ) exige, além disso, assiduidade.justify.
    if (!canMarkAttendance) {
      acl.guard('assiduidade.mark', () => undefined);
      return;
    }
    if (status === 'FJ' && !canJustifyAbsence) {
      acl.guard('assiduidade.justify', () => undefined);
      return;
    }

    setStudentsAttendance((prev) => {
      const current = prev[studentId] || { status: 'P', note: '', entryTime: '08:30' };
      let entryTime = current.entryTime;
      if (status === 'P') entryTime = '08:30';
      else if (status === 'A') entryTime = '08:45';
      else if (status === 'FI') entryTime = 'FALTOU';
      else entryTime = '—';

      return {
        ...prev,
        [studentId]: {
          ...current,
          status,
          entryTime
        }
      };
    });
  };

  const handleNoteChange = (studentId: string, note: string) => {
    if (!canJustifyAbsence) {
      acl.guard('assiduidade.justify', () => undefined);
      return;
    }
    setStudentsAttendance((prev) => ({
      ...prev,
      [studentId]: {
        ...(prev[studentId] || { status: 'P', note: '', entryTime: '08:30' }),
        note
      }
    }));
  };

  const handleMarkAllPresent = () => {
    if (!canMarkAttendance) {
      acl.guard('assiduidade.mark', () => undefined);
      return;
    }
    const updated: Record<string, { status: AttendanceStatus; note: string; entryTime: string }> = {};
    classStudents.forEach((s) => {
      updated[s.id] = {
        status: 'P',
        note: studentsAttendance[s.id]?.note || '',
        entryTime: '08:30'
      };
    });
    setStudentsAttendance(updated);
  };

  const buildCurrentSheet = (signed: boolean = isSigned): AttendanceSheet => {
    const d = new Date(selectedDate);
    const dayNames = ['Domingo', 'Segunda-feira', 'Terça-feira', 'Quarta-feira', 'Quinta-feira', 'Sexta-feira', 'Sábado'];
    const monthNames = ['Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho', 'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'];
    const formattedDate = `${dayNames[d.getDay()]}, ${d.getDate()} de ${monthNames[d.getMonth()]} de ${d.getFullYear()}`;

    const studentItems: AttendanceStudentItem[] = classStudents.map((st) => {
      const rec = studentsAttendance[st.id] || { status: 'P', note: '', entryTime: '08:30' };
      return {
        studentId: String(st.id),
        studentName: st.name,
        procNumber: st.procNumber || '—',
        avatar: st.avatar || '/avatar-padrao.png',
        status: rec.status,
        entryTime: rec.entryTime,
        note: rec.note,
        cumulativeAbsencesCount: (st.unexcusedAbsences || 0) + (rec.status === 'FI' ? 1 : 0),
        absencePercentage: st.attendanceRate ? Math.max(0, 100 - st.attendanceRate) : 0
      };
    });

    // O professor da caderneta é quem lecciona ESTA disciplina nesta turma (Atribuição/
    // Grelha Horária) — nunca o Diretor de Turma, que é um cargo administrativo distinto.
    const resolvedTeacherName = activeSubject
      ? resolveTeacherForSubject(db, activeSubject, activeClass?.id)
      : '';
    const currentTeacher =
      db.teachers.find(
        (t) => resolvedTeacherName && t.name.trim().toLowerCase() === resolvedTeacherName.trim().toLowerCase()
      ) || (currentUserRole === 'professor' ? db.teachers.find((t) => t.id === currentUser?.id) : undefined);

    return {
      id: `att-${activeClass?.id}-${activeSubject?.id}-${selectedDate}`,
      date: selectedDate,
      formattedDate,
      classId: activeClass?.id || 'turma-1',
      className: activeClass?.name || 'Turma A',
      subjectId: activeSubject?.id || 'sub-1',
      subjectName: activeSubject?.name || 'Disciplina',
      teacherId: currentTeacher?.id || '',
      teacherName: currentTeacher?.name || resolvedTeacherName || db.currentUser.name || 'A designar',
      timeSlot,
      room: activeClass?.room || 'Sala de Aulas',
      status: signed ? 'homologado' : 'sincronizado',
      lessonSummary: lessonSummary || 'Aula curricular devidamente ministrada com registo diário de assiduidade.',
      isDigitallySigned: signed,
      signedBy: signed ? (signedBy || db.currentUser.name) : undefined,
      signedAt: signed ? (signedAt || `${new Date().toLocaleDateString('pt-PT')} ${new Date().toLocaleTimeString('pt-PT', { hour: '2-digit', minute: '2-digit' })} (IP 192.168.10.42)`) : undefined,
      students: studentItems
    };
  };

  const handleLoadSheet = (sheet: AttendanceSheet) => {
    setSelectedClassId(String(sheet.classId));
    setSelectedSubjectId(String(sheet.subjectId));
    setSelectedDate(sheet.date);
    if (sheet.timeSlot) setTimeSlot(sheet.timeSlot);
    setLessonSummary(sheet.lessonSummary || '');
    setIsSigned(Boolean(sheet.isDigitallySigned));
    setSignedBy(sheet.signedBy || '');
    setSignedAt(sheet.signedAt || '');
    setSheetStatus(sheet.status || 'aberto');

    const mapping: Record<string, { status: AttendanceStatus; note: string; entryTime: string }> = {};
    if (sheet.students && sheet.students.length > 0) {
      sheet.students.forEach((item) => {
        mapping[item.studentId] = {
          status: item.status,
          note: item.note || '',
          entryTime: item.entryTime || (item.status === 'P' ? '08:30' : item.status === 'A' ? '08:45' : '—')
        };
      });
    }
    setStudentsAttendance(mapping);
    setIsHistoryModalOpen(false);
    void showOperationSuccess('Caderneta carregada com sucesso!', {
      details: `Caderneta de "${sheet.className}" (${sheet.subjectName} - ${sheet.date}).`
    });
  };

  const handleDeleteSheet = (sheet: AttendanceSheet) => {
    setSheetPendingDelete(sheet);
  };

  const confirmDeleteSheet = async () => {
    if (!sheetPendingDelete) return;
    const sheet = sheetPendingDelete;
    await runGlobalOperation(
      async () => {
        dbService.deleteAttendanceSheet(sheet.id);
        setSheetPendingDelete(null);
      },
      {
        loadingMessage: 'A eliminar caderneta da base de dados...',
        successMessage: 'Operação feita com sucesso!',
        successDetails: `Caderneta da turma "${sheet.className}" eliminada da base de dados.`,
        requiredRule: 'assiduidade.mark',
        userRole: currentUserRole
      }
    );
  };

  const handleSaveSheet = async () => {
    if (isProfessorBlockedToday) {
      await runGlobalOperation(
        async () => {
          throw new Error('O professor só pode registar a chamada no dia em que lecciona esta disciplina a esta turma.');
        },
        {
          loadingMessage: 'A verificar o horário lectivo desta disciplina...',
          errorMessage: 'Registo Fora do Dia Lectivo',
          errorDetails: 'Segundo a Grelha Horária desta turma, não há aula de "' + (activeSubject?.name || 'disciplina') + '" na data selecionada. Só a Direção Pedagógica ou a Administração podem registar chamadas fora do dia lectivo.'
        }
      );
      return;
    }
    if (isLockedByCalendar) {
      await runGlobalOperation(
        async () => {
          throw new Error(academicLock.reason || 'Prazo de edição do sumário expirado.');
        },
        {
          loadingMessage: 'A verificar as Regras de Trancamento do Ano Letivo...',
          errorMessage: 'Sumário Bloqueado',
          errorDetails: academicLock.reason || 'Consulte a Direção Pedagógica para reabrir o trimestre em Configurações > Ano Letivo.'
        }
      );
      return;
    }
    if (!isSigned) {
      await runGlobalOperation(
        async () => {
          throw new Error('Sem uma caderneta ser homologada pelo professor não deve ser gravada na base de dados.');
        },
        {
          loadingMessage: 'A verificar conformidade pedagógica da caderneta...',
          errorMessage: 'Caderneta Não Homologada',
          errorDetails: 'Sem a caderneta ser homologada e rubricada digitalmente pelo professor, não é permitido gravar na base de dados.'
        }
      );
      return;
    }

    await runGlobalOperation(
      async () => {
        const sheet = buildCurrentSheet(isSigned);
        dbService.saveAttendanceSheet(sheet);
      },
      {
        loadingMessage: 'A gravar caderneta diária na base de dados...',
        successMessage: 'Caderneta homologada gravada com sucesso!',
        successDetails: 'Caderneta Diária gravada e sincronizada na base de dados.',
        requiredRule: 'assiduidade.mark',
        userRole: currentUserRole
      }
    );
  };

  const handleSignSheet = async () => {
    if (isProfessorBlockedToday) {
      await runGlobalOperation(
        async () => {
          throw new Error('O professor só pode registar a chamada no dia em que lecciona esta disciplina a esta turma.');
        },
        {
          loadingMessage: 'A verificar o horário lectivo desta disciplina...',
          errorMessage: 'Registo Fora do Dia Lectivo',
          errorDetails: 'Segundo a Grelha Horária desta turma, não há aula de "' + (activeSubject?.name || 'disciplina') + '" na data selecionada. Só a Direção Pedagógica ou a Administração podem registar chamadas fora do dia lectivo.'
        }
      );
      return;
    }
    if (isLockedByCalendar) {
      await runGlobalOperation(
        async () => {
          throw new Error(academicLock.reason || 'Prazo de edição do sumário expirado.');
        },
        {
          loadingMessage: 'A verificar as Regras de Trancamento do Ano Letivo...',
          errorMessage: 'Sumário Bloqueado',
          errorDetails: academicLock.reason || 'Consulte a Direção Pedagógica para reabrir o trimestre em Configurações > Ano Letivo.'
        }
      );
      return;
    }
    await runGlobalOperation(
      async () => {
        const signer = db.currentUser.name || (currentUserRole === 'professor' ? 'Prof. Titular' : 'Coordenação Pedagógica');
        const nowStamp = `${new Date().toLocaleDateString('pt-PT')} ${new Date().toLocaleTimeString('pt-PT', { hour: '2-digit', minute: '2-digit' })} (IP 192.168.10.42)`;
        setIsSigned(true);
        setSignedBy(signer);
        setSignedAt(nowStamp);
        setSheetStatus('homologado');

        const sheet = buildCurrentSheet(true);
        sheet.isDigitallySigned = true;
        sheet.signedBy = signer;
        sheet.signedAt = nowStamp;
        sheet.status = 'homologado';

        dbService.saveAttendanceSheet(sheet);
      },
      {
        loadingMessage: 'A homologar e rubricar digitalmente caderneta...',
        requiredRule: 'assiduidade.mark',
        userRole: currentUserRole,
        successMessage: 'Caderneta homologada com sucesso!',
        successDetails: 'Caderneta Diária rubricada digitalmente e homologada no sistema.'
      }
    );
  };

  const handlePrintSheet = async () => {
    if (!isSigned) {
      await runGlobalOperation(
        async () => {
          throw new Error('A caderneta diária necessita de ser homologada e rubricada digitalmente pelo professor antes da impressão.');
        },
        {
          loadingMessage: 'A verificar conformidade de impressão...',
          errorMessage: 'Impressão Não Permitida',
          errorDetails: 'A caderneta de frequência só pode ser impressa após homologação com rubrica digital do professor.'
        }
      );
      return;
    }
    window.print();
  };

  // Stats calculation from real current records
  const totalStudents = classStudents.length;
  const countP = Object.values(studentsAttendance).filter((r) => r.status === 'P').length;
  const countFJ = Object.values(studentsAttendance).filter((r) => r.status === 'FJ').length;
  const countFI = Object.values(studentsAttendance).filter((r) => r.status === 'FI').length;
  const countA = Object.values(studentsAttendance).filter((r) => r.status === 'A').length;
  const presenceRate = totalStudents > 0 ? Math.round(((countP + countA) / totalStudents) * 100) : 100;

  const allRecordedSheets = db.attendanceSheets || [];

  return (
    <div className="flex flex-col w-full gap-6 pb-12 printable-document printable-landscape">
      <style>{`
        @media print {
          @page {
            size: A4 landscape !important;
            margin: 4mm 5mm !important;
          }
        }
      `}</style>
      {/* Screen Header (Hidden during Print) */}
      <div className="print:hidden flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-slate-300 pb-4">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <span className="text-[11px] font-bold uppercase tracking-widest text-slate-500">
              SERVIÇO
            </span>
            <span className="w-1.5 h-1.5 bg-[#0b1f3a]" />
            <span className="text-xs font-semibold text-[#0b1f3a]">LIVRO DE PRESENÇA</span>
            <span className="px-2 py-0.5 text-[10px] font-mono font-bold bg-slate-100 text-slate-700 border border-slate-300">
              {allRecordedSheets.length} cadernetas registadas
            </span>
          </div>
          <h1 className="font-headline text-2xl lg:text-3xl font-extrabold text-[#0b1f3a] tracking-tight">
            REGISTO DE ASSIDUIDADE 
          </h1>
          <p className="text-xs text-slate-500 mt-0.5">
            Lançamento de presenças, faltas justificadas (FJ), injustificadas (FI) e sumário.
          </p>
        </div>

        {/* Action Buttons Strip */}
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => setIsHistoryModalOpen(true)}
            className="px-3.5 py-2 rounded-none bg-white hover:bg-slate-100 text-slate-800 font-bold text-xs flex items-center gap-1.5 border border-slate-300 transition-colors shadow-none cursor-pointer"
            title="Ver histórico de cadernetas gravadas na base de dados"
          >
            <span className="material-symbols-outlined text-[17px] text-[#0b1f3a]">history_edu</span>
            <span>Histórico</span>
          </button>

          <button
            type="button"
            onClick={handleMarkAllPresent}
            {...acl.buttonProps('assiduidade.mark')}
            className="px-3.5 py-2 rounded-none bg-emerald-800 hover:bg-emerald-900 text-white font-bold text-xs flex items-center gap-1.5 border border-emerald-900 transition-colors shadow-none cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
            title="Marcar todos os estudantes da turma como Presentes"
          >
            <span className="material-symbols-outlined text-[17px]">done_all</span>
            <span>Todos Presentes</span>
          </button>

          <button
            type="button"
            onClick={handleSaveSheet}
            disabled={isEditingBlocked || !canMarkAttendance}
            className={`px-4 py-2 rounded-none font-bold text-xs flex items-center gap-1.5 border transition-colors shadow-none ${
              isEditingBlocked
                ? 'bg-slate-100 text-slate-400 border-slate-200 cursor-not-allowed'
                : isSigned
                ? 'bg-[#0b1f3a] hover:bg-slate-800 text-white border-[#0b1f3a] cursor-pointer'
                : 'bg-slate-100 hover:bg-slate-200 text-slate-700 border-slate-300 cursor-pointer'
            }`}
            title={
              isEditingBlocked
                ? editingBlockedReason
                : isSigned
                ? 'Gravar caderneta homologada na base de dados institucional'
                : 'Requer homologação docente (rubrica) antes de gravar na base de dados'
            }
          >
            <span className="material-symbols-outlined text-[17px] text-amber-500">
              {isSigned ? 'save' : 'lock'}
            </span>
            <span>Gravar</span>
            {!isSigned && (
              <span className="text-[9px] px-1 py-0.2 bg-amber-100 text-amber-800 font-semibold uppercase">
                Requer Rubrica
              </span>
            )}
          </button>

          <button
            type="button"
            onClick={handlePrintSheet}
            className={`px-3.5 py-2 rounded-none font-bold text-xs flex items-center gap-1.5 border transition-colors shadow-none cursor-pointer ${
              isSigned
                ? 'bg-slate-700 hover:bg-slate-800 text-white border-slate-700'
                : 'bg-slate-100 hover:bg-slate-200 text-slate-500 border-slate-300'
            }`}
            title={
              isSigned
                ? 'Imprimir Folha Diária de Presenças A4'
                : 'Impressão bloqueada até ser homologada pelo professor'
            }
          >
            <span className="material-symbols-outlined text-[17px]">
              {isSigned ? 'print' : 'lock'}
            </span>
            <span>Imprimir</span>
          </button>
        </div>
      </div>

      {/* Class, Subject, Date & Schedule Controls (Hidden in Print) */}
      <div className="print:hidden bg-white p-4 rounded-none border border-slate-300 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 text-xs">
        <div>
          <div className="flex items-center justify-between mb-1">
            <label className="block uppercase font-bold text-slate-600 text-[11px]">
              Turma & Classe
            </label>
            {currentUserRole === 'professor' && (
              <span className="text-[10px] text-blue-700 font-semibold">
                (Suas turmas)
              </span>
            )}
          </div>
          <select
            value={selectedClassId}
            onChange={(e) => setSelectedClassId(e.target.value)}
            className="w-full h-9 px-3 rounded-none bg-white border border-slate-300 font-bold text-slate-800 focus:outline-none focus:border-[#0b1f3a]"
          >
            {availableClasses.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name} ({c.room})
              </option>
            ))}
          </select>
        </div>

        <div>
          <div className="flex items-center justify-between mb-1">
            <label className="block uppercase font-bold text-slate-600 text-[11px]">
              Disciplina
            </label>
            {currentUserRole === 'professor' && (
              <span className="text-[10px] text-blue-700 font-semibold">
                (Suas disciplinas)
              </span>
            )}
          </div>
          <select
            value={selectedSubjectId}
            onChange={(e) => setSelectedSubjectId(e.target.value)}
            className="w-full h-9 px-3 rounded-none bg-white border border-slate-300 font-bold text-slate-800 focus:outline-none focus:border-[#0b1f3a]"
          >
            {availableSubjects.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name} ({s.code})
              </option>
            ))}
          </select>
        </div>

        <div>
          <label className="block uppercase font-bold text-slate-600 mb-1 text-[11px]">
            Data da Aula
          </label>
          <input
            type="date"
            value={selectedDate}
            onChange={(e) => setSelectedDate(e.target.value)}
            className="w-full h-9 px-3 rounded-none bg-white border border-slate-300 font-medium text-slate-800 focus:outline-none focus:border-[#0b1f3a]"
          />
        </div>

        <div>
          <div className="flex items-center justify-between mb-1">
            <label className="block uppercase font-bold text-slate-600 text-[11px]">
              Horário
            </label>
            {isScheduledToday && (
              <span className="text-[10px] text-emerald-700 font-semibold" title="Preenchido automaticamente com base na Grelha Horária da turma">
                (Automático)
              </span>
            )}
          </div>
          <input
            type="text"
            value={timeSlot}
            onChange={(e) => setTimeSlot(e.target.value)}
            readOnly={isScheduledToday}
            className={`w-full h-9 px-3 rounded-none border border-slate-300 font-medium text-slate-800 focus:outline-none focus:border-[#0b1f3a] ${
              isScheduledToday ? 'bg-slate-100 cursor-not-allowed' : 'bg-white'
            }`}
          />
        </div>
      </div>

      {/* Aviso de bloqueio: professor a tentar registar chamada fora do dia lectivo da disciplina */}
      {isProfessorBlockedToday && (
        <div className="print:hidden flex items-start gap-2 bg-rose-50 border border-rose-300 text-rose-800 px-4 py-3 text-xs font-semibold">
          <span className="material-symbols-outlined text-[18px] text-rose-700">lock</span>
          <span>
            Segundo a Grelha Horária desta turma, não há aula de <strong>{activeSubject?.name || 'disciplina'}</strong> em{' '}
            {selectedDayOfWeek || 'fim-de-semana'}. Pode consultar registos anteriores no Histórico, mas o registo de
            uma nova chamada só é permitido no dia lectivo desta disciplina (ou pela Direção Pedagógica / Administração).
          </span>
        </div>
      )}

      {/* Aviso de bloqueio: Regras de Trancamento do Ano Letivo (trimestre encerrado ou tolerância expirada) */}
      {!isProfessorBlockedToday && isLockedByCalendar && (
        <div className="print:hidden flex items-start gap-2 bg-rose-50 border border-rose-300 text-rose-800 px-4 py-3 text-xs font-semibold">
          <span className="material-symbols-outlined text-[18px] text-rose-700">lock_clock</span>
          <span>{academicLock.reason}</span>
        </div>
      )}

      {/* KPI Stats Strip */}
      <div className="print:hidden grid grid-cols-2 sm:grid-cols-6 gap-3 text-center">
        <div className="bg-white p-3 rounded-none border border-slate-300">
          <span className="text-[10px] uppercase font-bold text-slate-500 block">Total Alunos</span>
          <span className="font-headline text-xl font-bold text-[#0b1f3a]">{totalStudents}</span>
        </div>
        <div className="bg-white p-3 rounded-none border border-slate-300">
          <span className="text-[10px] uppercase font-bold text-emerald-800 block">Presentes (P)</span>
          <span className="font-headline text-xl font-bold text-emerald-800">{countP}</span>
        </div>
        <div className="bg-white p-3 rounded-none border border-slate-300">
          <span className="text-[10px] uppercase font-bold text-amber-800 block">Faltas Just. (FJ)</span>
          <span className="font-headline text-xl font-bold text-amber-800">{countFJ}</span>
        </div>
        <div className="bg-white p-3 rounded-none border border-slate-300">
          <span className="text-[10px] uppercase font-bold text-[#7a0c0c] block">Faltas Inj. (FI)</span>
          <span className="font-headline text-xl font-bold text-[#7a0c0c]">{countFI}</span>
        </div>
        <div className="bg-white p-3 rounded-none border border-slate-300">
          <span className="text-[10px] uppercase font-bold text-orange-800 block">Atrasos (A)</span>
          <span className="font-headline text-xl font-bold text-orange-800">{countA}</span>
        </div>
        <div className="bg-white p-3 rounded-none border border-slate-300">
          <span className="text-[10px] uppercase font-bold text-[#0b1f3a] block">Taxa Presença</span>
          <span className="font-headline text-xl font-bold text-[#0b1f3a]">{presenceRate}%</span>
        </div>
      </div>

      {/* Print-Only Official Header */}
      <div className="hidden print:flex items-center gap-3 border-b-2 border-black pb-4 mb-4 text-center">
        <img
          src={db.settings?.logoUrl || '/school_emblem.png'}
          alt={db.settings?.schoolName || 'Logótipo da Instituição'}
          className="w-14 h-14 object-contain shrink-0"
          referrerPolicy="no-referrer"
        />
        <div className="flex-1">
          <h2 className="text-sm font-bold uppercase tracking-wider">República de Angola</h2>
          <h3 className="text-xs font-semibold uppercase">{db.settings?.schoolName || 'Complexo Escolar Privado BandMed'}</h3>
          <p className="text-[10px] text-gray-600">{db.settings?.address} • NIF: {db.settings?.nif}</p>
          <h1 className="text-base font-extrabold uppercase mt-2 tracking-wide">
            Caderneta Diária de Presenças & Sumário de Aula
          </h1>
          <div className="flex justify-between text-xs mt-3 pt-2 border-t border-black">
            <span><strong>Turma:</strong> {activeClass?.name} ({activeClass?.room})</span>
            <span><strong>Disciplina:</strong> {activeSubject?.name}</span>
            <span><strong>Data:</strong> {selectedDate} ({timeSlot})</span>
          </div>
        </div>
      </div>

      {/* Real Attendance Table */}
      <div className="bg-white rounded-none border border-slate-300 overflow-hidden print:border-black">
        <div className="p-3 bg-slate-50 border-b border-slate-300 flex items-center justify-between print:hidden">
          <div className="flex items-center gap-2">
            <span className="material-symbols-outlined text-[#0b1f3a] text-[20px]">how_to_reg</span>
            <span className="font-bold text-xs text-slate-800">
              Folha de Presenças: {activeClass?.name} • {activeSubject?.name}
            </span>
          </div>
          <div className="flex items-center gap-2">
            <span className={`px-2 py-0.5 text-[10px] font-bold uppercase border ${
              sheetStatus === 'homologado'
                ? 'bg-emerald-100 text-emerald-900 border-emerald-300'
                : 'bg-amber-100 text-amber-900 border-amber-300'
            }`}>
              {sheetStatus === 'homologado' ? 'Homologada' : 'Em Aberto'}
            </span>
            <span className="text-[11px] text-slate-500 font-mono">
              {selectedDate} ({timeSlot})
            </span>
          </div>
        </div>

        {/* Cabeçalho fixo: a tabela rola dentro desta caixa e o <thead> fica preso ao topo. */}
        <div className="overflow-x-auto overflow-y-auto max-h-[calc(100vh-15rem)] min-h-[16rem] print:max-h-none print:overflow-visible">
          <table data-no-sticky-header className="w-full text-left text-xs border-collapse border border-slate-300 print:border-slate-400 print:text-[8.5pt]">
            <thead>
              <tr className="bg-[#0b1f3a] text-white font-bold uppercase text-[10px] tracking-wider border-b-2 border-slate-900 print:bg-[#0b1f3a] print:text-white">
                <th className="sticky top-0 z-10 bg-[#0b1f3a] print:static py-2.5 px-3 w-12 text-center border-r border-slate-700/80 print:border-slate-500">N.º</th>
                <th className="sticky top-0 z-10 bg-[#0b1f3a] print:static py-2.5 px-3 border-r border-slate-700/80 print:border-slate-500">Aluno & Proc.</th>
                <th className="sticky top-0 z-10 bg-[#0b1f3a] print:static py-2.5 px-3 text-center border-r border-slate-700/80 print:border-slate-500">Estado de Assiduidade</th>
                <th className="sticky top-0 z-10 bg-[#0b1f3a] print:static py-2.5 px-3 text-center border-r border-slate-700/80 print:border-slate-500 w-24">Hora/Entrada</th>
                <th className="sticky top-0 z-10 bg-[#0b1f3a] print:static py-2.5 px-4 border-r border-slate-700/80 print:border-slate-500">Observações / Justificação</th>
                <th className="sticky top-0 z-10 bg-[#0b1f3a] print:static py-2.5 px-3 text-center w-28">Assiduidade Acumulada</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200 print:divide-slate-300">
              {classStudents.length === 0 ? (
                <tr>
                  <td colSpan={6} className="py-8 text-center text-slate-400 text-xs">
                    Nenhum aluno matriculado nesta turma. Selecione outra turma acima.
                  </td>
                </tr>
              ) : (
                visibleClassStudents.map((student, idx) => {
                  const rec = studentsAttendance[student.id] || { status: 'P', note: '', entryTime: '08:30' };

                  return (
                    <tr
                      key={student.id}
                      className={`transition-colors border-b border-slate-200 print:border-slate-300 ${
                        idx % 2 === 1 ? 'bg-[#f8fafc]' : 'bg-white'
                      } hover:bg-sky-50/40`}
                    >
                      <td className="py-2 px-3 text-center font-mono font-bold text-slate-600 border-r border-slate-200 print:border-slate-300">
                        {String(idx + 1).padStart(2, '0')}
                      </td>
                      <td className="py-2 px-3 border-r border-slate-200 print:border-slate-300">
                        <div className="flex items-center gap-2.5">
                          <img
                            src={student.avatar || '/avatar-padrao.png'}
                            alt={student.name}
                            className="w-7 h-7 rounded-none object-cover border border-slate-300 print:hidden"
                          />
                          <div>
                            <span className="font-bold text-[#0b1f3a] text-xs block print:text-black">{student.name}</span>
                            <span className="text-[10px] text-slate-500 font-mono">Proc: #{student.procNumber}</span>
                          </div>
                        </div>
                      </td>
                      <td className="py-2 px-3 border-r border-slate-200 print:border-slate-300">
                        {/* Screen Button Group */}
                        <div className="flex items-center justify-center gap-1.5 print:hidden">
                          {/* P */}
                          <button
                            type="button"
                            onClick={() => handleStatusChange(student.id, 'P')}
                            disabled={!canMarkAttendance}
                            {...acl.buttonProps('assiduidade.mark')}
                            data-gr-choice="presente"
                            aria-pressed={rec.status === 'P'}
                            className="w-8 h-7 text-xs flex items-center justify-center"
                            title="Presente"
                          >
                            P
                          </button>

                          {/* FJ */}
                          <button
                            type="button"
                            onClick={() => handleStatusChange(student.id, 'FJ')}
                            disabled={!canJustifyAbsence}
                            {...acl.buttonProps('assiduidade.justify')}
                            data-gr-choice="fj"
                            aria-pressed={rec.status === 'FJ'}
                            className="w-8 h-7 text-xs flex items-center justify-center"
                            title="Falta Justificada"
                          >
                            FJ
                          </button>

                          {/* FI */}
                          <button
                            type="button"
                            onClick={() => handleStatusChange(student.id, 'FI')}
                            disabled={!canMarkAttendance}
                            {...acl.buttonProps('assiduidade.mark')}
                            data-gr-choice="fi"
                            aria-pressed={rec.status === 'FI'}
                            className="w-8 h-7 text-xs flex items-center justify-center"
                            title="Falta Injustificada"
                          >
                            FI
                          </button>

                          {/* A */}
                          <button
                            type="button"
                            onClick={() => handleStatusChange(student.id, 'A')}
                            disabled={!canMarkAttendance}
                            {...acl.buttonProps('assiduidade.mark')}
                            data-gr-choice="atraso"
                            aria-pressed={rec.status === 'A'}
                            className="w-8 h-7 text-xs flex items-center justify-center"
                            title="Atraso"
                          >
                            A
                          </button>
                        </div>

                        {/* Print Mode Status Text */}
                        <div className="hidden print:block text-center font-bold">
                          {rec.status === 'P' ? 'Presente (P)' : rec.status === 'FJ' ? 'Falta Justificada (FJ)' : rec.status === 'FI' ? 'Falta Injustificada (FI)' : 'Atraso (A)'}
                        </div>
                      </td>

                      <td className="py-2 px-3 text-center font-mono text-[11px] text-slate-600 border-r border-slate-200 print:border-slate-300">
                        {rec.entryTime || '—'}
                      </td>

                      <td className="py-2 px-4 border-r border-slate-200 print:border-slate-300">
                        <input
                          type="text"
                          value={rec.note || ''}
                          onChange={(e) => handleNoteChange(student.id, e.target.value)}
                          disabled={!canJustifyAbsence}
                          placeholder="Adicionar nota justificativa..."
                          className="w-full h-7 px-2 text-xs text-slate-800 placeholder:text-slate-400 bg-white border border-slate-300 focus:outline-none focus:border-[#0b1f3a] print:border-none print:p-0"
                        />
                      </td>

                      <td className="py-2 px-3 text-center">
                        <div className="text-[11px]">
                          <span className="font-bold text-slate-800">{student.attendanceRate ?? 100}%</span>
                          <span className="text-[10px] text-slate-500 block font-mono">
                            {student.unexcusedAbsences || 0} FI / {student.excusedAbsences || 0} FJ
                          </span>
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
          <TablePagination total={classStudents.length} page={pgClassStudents} onPageChange={setPgClassStudents} />
        </div>
      </div>

      {/* Lesson Summary & Teacher Homologation Section */}
      <div className="bg-white rounded-none border border-slate-300 p-5 flex flex-col md:flex-row gap-6 print:border-black">
        <div className="flex-1">
          <div className="flex items-center justify-between mb-2">
            <div>
              <label htmlFor="lesson-summary-field" className="block uppercase font-bold text-xs text-slate-800 tracking-wide">
                Sumário da Aula<span className="text-red-500">*</span>
              </label>
              <span className="text-[11px] text-slate-500">
                Registo legal dos conteúdos lecionados
              </span>
              {linkedSummaries.length > 0 && (
                <span className="mt-1 flex items-center gap-1 text-[10px] font-semibold text-emerald-800 print:hidden">
                  <span className="material-symbols-outlined text-[13px]">sync</span>
                  Preenchido automaticamente a partir de Sumários das Aulas (aula n.º {linkedSummaries.map((e) => e.lessonNumber).join(', ')})
                </span>
              )}
            </div>
            <div className="flex items-center gap-2 print:hidden">
              <button
                type="button"
                onClick={() => setLessonSummary('')}
                className="text-[11px] text-slate-400 hover:text-red-600 font-semibold cursor-pointer"
                title="Limpar campo de sumário"
              >
                Limpar
              </button>
            </div>
          </div>
          <textarea
            id="lesson-summary-field"
            rows={4}
            value={lessonSummary}
            onChange={(e) => setLessonSummary(e.target.value)}
            disabled={isEditingBlocked}
            className={`w-full p-3.5 rounded-none border border-slate-300 text-xs text-slate-800 leading-relaxed focus:outline-none focus:border-[#0b1f3a] focus:ring-1 focus:ring-[#0b1f3a] print:border-black ${
              isEditingBlocked ? 'bg-slate-100 text-slate-400 cursor-not-allowed' : 'bg-white'
            }`}
            placeholder="Escreva aqui o sumário oficial da aula: objetivos pedagógicos, temas abordados, exercícios realizados e orientações de TPC para os estudantes..."
          />
          <div className="flex items-center justify-between mt-1 text-[11px] text-slate-400">
            <span>O sumário fica gravado na caderneta e disponível para auditoria da Direção Pedagógica.</span>
            <span className="font-mono">{lessonSummary.length} caracteres</span>
          </div>
        </div>

        <div className="w-full md:w-80 flex flex-col justify-between p-4 bg-slate-50 border border-slate-300 print:bg-transparent print:border-black">
          <div>
            <span className="text-[10px] uppercase font-bold text-slate-500 block mb-1">
              Homologação Docente Digital
            </span>
            <div className="flex items-center gap-2 mb-2">
              <span className={`material-symbols-outlined text-[20px] ${isSigned ? 'text-emerald-800' : 'text-amber-700'}`}>
                {isSigned ? 'verified' : 'pending'}
              </span>
              <span className="font-bold text-xs text-[#0b1f3a]">
                {isSigned ? 'Caderneta Digital Rubricada' : 'Aguardando Assinatura'}
              </span>
            </div>
            {isSigned ? (
              <p className="text-[11px] text-slate-600 leading-tight">
                Rubricado por: <strong>{signedBy}</strong>
                <br />
                <span className="text-[10px] text-slate-500 font-mono">{signedAt}</span>
              </p>
            ) : (
              <p className="text-[11px] text-slate-500">
                A rubrica fecha a folha de presença e grava o registo permanente no histórico institucional.
              </p>
            )}
          </div>

          <div className="mt-3 flex gap-2 print:hidden">
            <button
              type="button"
              onClick={handleSignSheet}
              disabled={isEditingBlocked}
              className={`flex-1 py-2 px-3 rounded-none font-bold text-xs transition-colors flex items-center justify-center gap-1.5 border ${
                isEditingBlocked
                  ? 'bg-slate-100 text-slate-400 border-slate-200 cursor-not-allowed'
                  : 'bg-[#0b1f3a] hover:bg-[#7a0c0c] text-white border-[#0b1f3a] cursor-pointer'
              }`}
              title={isEditingBlocked ? editingBlockedReason : undefined}
            >
              <span className="material-symbols-outlined text-[16px]">{isEditingBlocked ? 'lock' : 'draw'}</span>
              <span>{isSigned ? 'Atualizar Rubrica' : 'Rubricar Digitalmente'}</span>
            </button>
          </div>
        </div>
      </div>

      {/* History Modal */}
      {isHistoryModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 animate-fade-in print:hidden">
          <div className="bg-white rounded-none border border-slate-400 w-full max-w-4xl max-h-[90vh] flex flex-col shadow-2xl">
            <div className="p-4 bg-[#0b1f3a] text-white flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="material-symbols-outlined text-[20px]">history_edu</span>
                <h3 className="font-bold text-sm">Histórico de Cadernetas</h3>
              </div>
              <button
                type="button"
                onClick={() => setIsHistoryModalOpen(false)}
                className="text-white hover:text-slate-300 p-1 cursor-pointer"
              >
                <span className="material-symbols-outlined text-[20px]">close</span>
              </button>
            </div>

            <div className="p-4 overflow-y-auto flex-1">
              {allRecordedSheets.length === 0 ? (
                <div className="text-center py-12 text-slate-400 text-xs">
                  Ainda não existem cadernetas gravadas no histórico.
                </div>
              ) : (
                <div className="divide-y divide-slate-200 border border-slate-300">
                  {allRecordedSheets.map((sheet) => {
                    const studentCount = sheet.students?.length || 0;
                    const presCount = sheet.students?.filter((s) => s.status === 'P' || s.status === 'A').length || 0;
                    const rate = studentCount > 0 ? Math.round((presCount / studentCount) * 100) : 0;

                    return (
                      <div
                        key={sheet.id}
                        className="p-3.5 hover:bg-slate-50 flex flex-col sm:flex-row sm:items-center justify-between gap-3"
                      >
                        <div>
                          <div className="flex items-center gap-2">
                            <span className="font-bold text-xs text-[#0b1f3a]">{sheet.className}</span>
                            <span className="text-slate-400">•</span>
                            <span className="font-semibold text-xs text-slate-700">{sheet.subjectName}</span>
                            <span className={`px-2 py-0.2 rounded-none text-[10px] font-bold uppercase border ${
                              sheet.status === 'homologado'
                                ? 'bg-emerald-100 text-emerald-900 border-emerald-300'
                                : 'bg-slate-100 text-slate-700 border-slate-300'
                            }`}>
                              {sheet.status || 'aberto'}
                            </span>
                          </div>
                          <p className="text-[11px] text-slate-500 mt-0.5">
                            Data: <strong>{sheet.date}</strong> ({sheet.timeSlot || '08:30–10:00'}) • Docente: {sheet.teacherName}
                          </p>
                          <p className="text-[11px] text-slate-600 line-clamp-1 italic mt-1">
                            "{sheet.lessonSummary}"
                          </p>
                        </div>

                        <div className="flex items-center gap-3 shrink-0">
                          <div className="text-right">
                            <span className="font-mono font-bold text-xs text-[#0b1f3a] block">{rate}% Presenças</span>
                            <span className="text-[10px] text-slate-400 font-mono">
                              {presCount} / {studentCount} alunos
                            </span>
                          </div>

                          <button
                            type="button"
                            onClick={() => handleLoadSheet(sheet)}
                            className="px-3 py-1.5 rounded-none bg-[#0b1f3a] hover:bg-slate-800 text-white font-bold text-xs cursor-pointer border border-[#0b1f3a] flex items-center gap-1 shadow-xs"
                            title="Carregar registo completo desta aula"
                          >
                            <span className="material-symbols-outlined text-[15px]">file_open</span>
                            <span></span>
                          </button>

                          <button
                            type="button"
                            onClick={() => handleDeleteSheet(sheet)}
                            className="px-2.5 py-1.5 rounded-none bg-red-600 hover:bg-red-700 text-white font-bold text-xs cursor-pointer border border-red-700 flex items-center gap-1 shadow-xs transition-colors"
                            title="Eliminar caderneta"
                          >
                            <span className="material-symbols-outlined text-[16px]">delete</span>
                            <span></span>
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            <div className="p-3 bg-slate-100 border-t border-slate-300 text-right">
              <button
                type="button"
                onClick={() => setIsHistoryModalOpen(false)}
                className="px-4 py-2 rounded-none bg-white border border-slate-300 text-xs font-bold text-slate-700 hover:bg-slate-200 cursor-pointer"
              >
                Fechar
              </button>
            </div>

            {/* In-app Confirmation Dialog to eliminate sheet */}
            {sheetPendingDelete && (
              <div className="absolute inset-0 bg-black/60 z-30 flex items-center justify-center p-4">
                <div className="bg-white border-2 border-red-500 max-w-md w-full p-5 shadow-2xl animate-fade-in">
                  <div className="flex items-center gap-3 text-red-600 mb-3">
                    <span className="material-symbols-outlined text-[28px]">warning</span>
                    <h4 className="font-extrabold text-sm uppercase tracking-wider text-slate-900">
                      Confirmar Eliminação
                    </h4>
                  </div>
                  <p className="text-xs text-slate-700 mb-4 leading-relaxed">
                    Tem a certeza que deseja eliminar a caderneta da turma{' '}
                    <strong className="text-[#0b1f3a]">{sheetPendingDelete.className}</strong> ({sheetPendingDelete.subjectName}) registada na data{' '}
                    <strong className="text-[#0b1f3a]">{sheetPendingDelete.date}</strong>?
                  </p>
                  <p className="text-[11px] text-red-600 font-semibold mb-5 bg-red-50 p-2 border border-red-200">
                    Esta ação é irreversível e removerá as presenças desta aula do histórico.
                  </p>
                  <div className="flex items-center justify-end gap-2">
                    <button
                      type="button"
                      onClick={() => setSheetPendingDelete(null)}
                      className="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold text-xs border border-slate-300 cursor-pointer"
                    >
                      Cancelar
                    </button>
                    <button
                      type="button"
                      onClick={confirmDeleteSheet}
                      className="px-4 py-2 bg-red-600 hover:bg-red-700 text-white font-bold text-xs flex items-center gap-1.5 cursor-pointer shadow-sm"
                    >
                      <span className="material-symbols-outlined text-[16px]">delete_forever</span>
                      <span>Eliminar</span>
                    </button>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};
