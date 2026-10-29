import React, { useEffect, useMemo, useState } from 'react';
import { SchoolDatabase, UserRole, User } from '../types';
import { getFinancialRules } from '../utils/financialRules';
import { getSubjectsForClass } from '../utils/classSubjects';
import {
  filterSubjectsForUser,
  getAllocatedClassIdsForUser,
  getTimetableEntriesForClassSubject,
  formatTimetableEntriesAsSlot
} from '../utils/teacherSubjects';
import { FolhaChamadaProvaModal } from '../components/FolhaChamadaProvaModal';

interface FolhaChamadaProvaViewProps {
  db: SchoolDatabase;
  currentUserRole: UserRole;
  currentUser?: User;
}

const TRIMESTRES = ['I Trimestre', 'II Trimestre', 'III Trimestre'];

export const FolhaChamadaProvaView: React.FC<FolhaChamadaProvaViewProps> = ({ db, currentUserRole, currentUser }) => {
  // Um professor só pode gerar folhas de chamada para as turmas onde está
  // efetivamente alocado; Admin, Direção e Secretaria têm âmbito geral.
  const allocatedClassIds = useMemo(() => getAllocatedClassIdsForUser(db, currentUser), [db, currentUser]);
  const availableClasses = useMemo(() => {
    if (!allocatedClassIds) return db.classes || []; // Admin/Secretaria/Direção: todas as turmas
    // Professor: só as turmas que lhe foram atribuídas (vazio se não tiver nenhuma).
    return (db.classes || []).filter((c) => allocatedClassIds.has(String(c.id)));
  }, [db.classes, allocatedClassIds]);

  const [classId, setClassId] = useState<string>('');
  const [trimestre, setTrimestre] = useState<string>(TRIMESTRES[0]);
  const [examDate, setExamDate] = useState<string>(new Date().toISOString().split('T')[0]);
  const [subjectName, setSubjectName] = useState<string>('');
  const [timeSlot, setTimeSlot] = useState<string>('');
  const [roomLabel, setRoomLabel] = useState<string>('');
  const [showSheet, setShowSheet] = useState(false);

  // Alinha a turma selecionada com as turmas disponíveis para este utilizador
  useEffect(() => {
    if (availableClasses.length > 0 && !availableClasses.some((c) => String(c.id) === String(classId))) {
      setClassId(String(availableClasses[0].id));
    }
  }, [availableClasses, classId]);

  const activeClass = availableClasses.find((c) => String(c.id) === String(classId));

  // Disciplinas realmente lecionadas a esta turma — prioritariamente a Atribuição
  // (Secretaria Académica), com a Grelha Horária como reforço — nunca a lista
  // genérica de todas as disciplinas do sistema. Um professor só vê aqui as
  // disciplinas que lhe estão atribuídas nesta turma.
  const subjectsForClass = useMemo(() => {
    // Disciplinas atribuídas a ESTA turma; para o professor, só as que ele
    // leciona nela (sem fallback para as restantes disciplinas da turma).
    const forClass = getSubjectsForClass(db, activeClass);
    return filterSubjectsForUser(forClass, db, currentUser, activeClass?.id).map((s) => s.name);
  }, [db, activeClass, currentUser]);

  // Sempre que a turma muda, realinha a disciplina selecionada com o que essa
  // turma efetivamente tem na Grelha Horária.
  useEffect(() => {
    if (subjectsForClass.length > 0 && !subjectsForClass.includes(subjectName)) {
      setSubjectName(subjectsForClass[0]);
    } else if (subjectsForClass.length === 0) {
      setSubjectName('');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [subjectsForClass]);

  // Horário e Sala reais da Grelha Horária para esta turma + disciplina — sugeridos
  // automaticamente; o operador só precisa de ajustar a hora se a prova ocorrer
  // num horário especial diferente do horário lectivo normal.
  const timetableEntries = useMemo(
    () => getTimetableEntriesForClassSubject(db, classId, subjectName),
    [db, classId, subjectName]
  );

  useEffect(() => {
    const suggestedSlot = timetableEntries.length > 0 ? formatTimetableEntriesAsSlot([timetableEntries[0]]) : '';
    setTimeSlot(suggestedSlot);
    const suggestedRoom = timetableEntries[0]?.room || activeClass?.room || '';
    setRoomLabel(suggestedRoom);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [timetableEntries, activeClass?.id]);

  const financialRules = useMemo(() => getFinancialRules(db.settings), [db.settings]);

  const classStudentsCount = useMemo(() => {
    if (!classId) return 0;
    return (db.students || []).filter((s) => String(s.classId) === String(classId)).length;
  }, [db.students, classId]);

  const classDebtCount = useMemo(() => {
    if (!classId) return 0;
    return (db.students || []).filter((s) => String(s.classId) === String(classId) && s.financialStatus === 'debito')
      .length;
  }, [db.students, classId]);

  return (
    <div className="flex flex-col w-full gap-6 pb-12">
      {/* Header */}
      <div>
        <div className="flex items-center gap-2 mb-1">
          <span className="text-[11px] font-bold uppercase tracking-widest text-slate-500">Serviços</span>
          <span className="w-1.5 h-1.5 rounded-none bg-[#0b1f3a]" />
          <span className="text-xs font-semibold text-[#0b1f3a]">PRESENÇA DE PROVA</span>
        </div>
        <h1 className="font-headline text-2xl lg:text-3xl font-extrabold text-[#0b1f3a] tracking-tight">
          FOLHA DE PRESENÇA
        </h1>
        <p className="text-xs text-slate-500 mt-0.5">
          Gere e imprima a folha de presença de cada turma para as provas trimestrais, com campo de assinatura para cada
          aluno.
        </p>
      </div>

      <div className="bg-white p-6 rounded-none border border-slate-300 shadow-xs space-y-5">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          <div>
            <label className="block text-[10px] uppercase font-bold text-slate-500 mb-1">Turma / Classe *</label>
            <select
              value={classId}
              onChange={(e) => setClassId(e.target.value)}
              className="w-full h-9 px-3 rounded-none bg-white text-slate-800 border border-slate-300 focus:outline-none focus:border-[#0b1f3a] text-xs"
            >
              <option value="">Selecione a turma...</option>
              {availableClasses.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.grade} — {c.name}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-[10px] uppercase font-bold text-slate-500 mb-1">Trimestre *</label>
            <select
              value={trimestre}
              onChange={(e) => setTrimestre(e.target.value)}
              className="w-full h-9 px-3 rounded-none bg-white text-slate-800 border border-slate-300 focus:outline-none focus:border-[#0b1f3a] text-xs"
            >
              {TRIMESTRES.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-[10px] uppercase font-bold text-slate-500 mb-1">Data da Prova *</label>
            <input
              type="date"
              value={examDate}
              onChange={(e) => setExamDate(e.target.value)}
              className="w-full h-9 px-3 rounded-none bg-white text-slate-800 border border-slate-300 focus:outline-none focus:border-[#0b1f3a] text-xs"
            />
          </div>

          <div>
            <label className="block text-[10px] uppercase font-bold text-slate-500 mb-1">
              Disciplina * <span className="normal-case font-normal text-slate-400">(lecionada a esta turma)</span>
            </label>
            <select
              value={subjectName}
              onChange={(e) => setSubjectName(e.target.value)}
              disabled={subjectsForClass.length === 0}
              className="w-full h-9 px-3 rounded-none bg-white text-slate-800 border border-slate-300 focus:outline-none focus:border-[#0b1f3a] text-xs disabled:bg-slate-100 disabled:text-slate-400"
            >
              {subjectsForClass.length === 0 ? (
                <option value="">Sem disciplinas</option>
              ) : (
                subjectsForClass.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))
              )}
            </select>
          </div>

          <div>
            <label className="block text-[10px] uppercase font-bold text-slate-500 mb-1">
              Hora <span className="normal-case font-normal text-slate-400"></span>
            </label>
            <input
              type="text"
              value={timeSlot}
              onChange={(e) => setTimeSlot(e.target.value)}
              placeholder="Ex: 08:30–10:00"
              className="w-full h-9 px-3 rounded-none bg-white text-slate-800 border border-slate-300 focus:outline-none focus:border-[#0b1f3a] text-xs font-mono"
            />
          </div>

          <div>
            <label className="block text-[10px] uppercase font-bold text-slate-500 mb-1">
              Sala <span className="normal-case font-normal text-slate-400"></span>
            </label>
            <input
              type="text"
              value={roomLabel}
              onChange={(e) => setRoomLabel(e.target.value)}
              placeholder="Sala"
              className="w-full h-9 px-3 rounded-none bg-white text-slate-800 border border-slate-300 focus:outline-none focus:border-[#0b1f3a] text-xs"
            />
          </div>
        </div>

        {classId && (
          <div className="flex flex-wrap items-center gap-3 p-3 bg-slate-50 border border-slate-200 text-xs">
            <span className="text-slate-600">
              Alunos matriculados nesta turma: <strong className="text-slate-900">{classStudentsCount}</strong>
            </span>
            {financialRules.blockExamsWithDebt && classDebtCount > 0 && (
              <span className="flex items-center gap-1 text-rose-700 font-semibold">
                <span className="material-symbols-outlined text-[15px]">warning</span>
                {classDebtCount} aluno(s) em situação irregular em pagamento de propinas.
              </span>
            )}
            {!financialRules.blockExamsWithDebt && (
              <span className="text-slate-400">
                Aviso Prévio em Época de Exames está desativado em Configurações
              </span>
            )}
          </div>
        )}

        <div className="pt-2 flex justify-end">
          <button
            type="button"
            disabled={!classId || !examDate}
            onClick={() => setShowSheet(true)}
            className="flex items-center gap-1.5 px-4 py-2 bg-[#0b1f3a] hover:bg-[#7a0c0c] text-white font-bold text-xs shadow-sm transition-colors cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
          >
            <span className="material-symbols-outlined text-[17px]">print</span>
            <span>IMPRIMIR</span>
          </button>
        </div>
      </div>

      {showSheet && classId && (
        <FolhaChamadaProvaModal
          db={db}
          classId={classId}
          trimester={trimestre}
          examDate={examDate}
          subjectName={subjectName}
          timeSlot={timeSlot}
          roomLabel={roomLabel}
          onClose={() => setShowSheet(false)}
        />
      )}
    </div>
  );
};
