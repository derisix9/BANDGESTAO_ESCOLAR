import React, { useMemo } from 'react';
import { SchoolDatabase } from '../types';
import { getFinancialRules } from '../utils/financialRules';
import { getFallbackAcademicYear } from '../utils/academicYear';
import { TablePagination, usePagedList } from './TablePagination';
import { Notice } from './Notice';

interface FolhaChamadaProvaModalProps {
  db: SchoolDatabase;
  classId: string;
  trimester: string;
  examDate: string;
  subjectName: string;
  roomLabel: string;
  timeSlot: string;
  onClose: () => void;
}

// Folha de Chamada / Presença de Prova — documento oficial para imprimir e
// levar fisicamente à sala de provas trimestrais, onde os alunos assinam a
// presença. Implementa também a política "Aviso Prévio em Época de Exames":
// quando essa opção está ativa em Configurações > Tabela Financeira, os
// alunos em débito aparecem assinalados com um alerta de situação irregular.
export const FolhaChamadaProvaModal: React.FC<FolhaChamadaProvaModalProps> = ({
  db,
  classId,
  trimester,
  examDate,
  subjectName,
  roomLabel,
  timeSlot,
  onClose
}) => {
  const activeClass = (db.classes || []).find((c) => String(c.id) === String(classId));

  const classStudents = useMemo(() => {
    return (db.students || [])
      .filter((s) => String(s.classId) === String(classId) && s.status !== 'transferred')
      .slice()
      .sort((a, b) => a.name.localeCompare(b.name, 'pt'));
  }, [db.students, classId]);
  const { page: pgClassStudents, setPage: setPgClassStudents, pageItems: visibleClassStudents } = usePagedList(classStudents, [classStudents.length]);

  const financialRules = useMemo(() => getFinancialRules(db.settings), [db.settings]);

  // Política: Aviso Prévio em Época de Exames — exibe alerta de situação
  // irregular nas folhas de chamada das provas trimestrais.
  const examDebtWarningActive = financialRules.blockExamsWithDebt;

  const studentsInDebt = useMemo(
    () => classStudents.filter((s) => s.financialStatus === 'debito'),
    [classStudents]
  );

  const formattedExamDate = useMemo(() => {
    if (!examDate) return '____ / ____ / ________';
    const [y, m, d] = examDate.split('-');
    return `${d}/${m}/${y}`;
  }, [examDate]);

  return (
    <div className="fixed inset-0 bg-black/60 z-50 flex items-start justify-center p-3 sm:p-4 printable-modal-overlay overflow-y-auto print:p-0 print:m-0 print:block">
      <div className="printable-document printable-portrait bg-white rounded-none max-w-4xl w-full shadow-2xl border border-slate-400 overflow-hidden flex flex-col my-4 print:my-0 print:border-none print:shadow-none print:w-full print:max-h-none">
        {/* HEADER (Oculto na impressão) */}
        <div className="px-6 py-4 bg-[#0b1f3a] text-white flex items-center justify-between border-b border-slate-700 no-print">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-none bg-white/10 flex items-center justify-center text-white border border-white/20">
              <span className="material-symbols-outlined text-[24px]">fact_check</span>
            </div>
            <div>
              <h3 className="font-bold text-sm uppercase tracking-wider">FOLHA DE PRESENÇA</h3>
              <p className="text-[11px] text-blue-200">
                {activeClass ? `${activeClass.grade} — ${activeClass.name}` : 'Turma'}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-slate-300 hover:text-white hover:bg-white/10 p-1 cursor-pointer transition-colors"
          >
            <span className="material-symbols-outlined text-[20px]">close</span>
          </button>
        </div>

        {/* Aviso de Situação Irregular (visível no ecrã, oculto na impressão) */}
        {examDebtWarningActive && studentsInDebt.length > 0 && (
          <Notice tone="warn" icon="warning">
            <span>
              <strong>{studentsInDebt.length}</strong> aluno(s) desta turma está(ão) em <strong>Situação Irregular</strong> (propinas
              em atraso). De acordo com a política "Aviso Prévio em Época de Exames", estão assinalados a vermelho na folha —
              a Secretaria deve ser informada antes da prova.
            </span>
          </Notice>
        )}

        {/* CONTEÚDO IMPRIMÍVEL */}
        <div className="p-6 sm:p-8 space-y-4 text-slate-800 bg-white text-xs overflow-y-auto">
          {/* Cabeçalho Institucional */}
          <div className="border-b-2 border-[#0b1f3a] pb-3 print-break-avoid">
            <div className="flex items-center gap-3 mb-2">
              <div className="w-12 h-12 bg-white border border-slate-300 p-0.5 flex items-center justify-center shrink-0">
                <img
                  src={db.settings?.logoUrl || '/school_emblem.png'}
                  alt={db.settings?.schoolName || 'Escola'}
                  className="w-full h-full object-contain"
                  referrerPolicy="no-referrer"
                />
              </div>
              <div>
                <h1 className="text-base sm:text-lg font-black tracking-wide text-[#0b1f3a] uppercase">
                  {db.settings?.schoolName}
                </h1>
                <p className="text-[11px] text-slate-500 font-medium">
                  {db.settings?.subTitle || `NIF: ${db.settings?.nif} • ${db.settings?.province}, Angola`}
                </p>
              </div>
            </div>
            <div className="flex flex-wrap items-center justify-between gap-3 pt-1 border-t border-slate-200">
              <div>
                <div className="text-[10px] font-bold text-sky-800 tracking-wider uppercase">Prova do Trimestre</div>
                <h2 className="text-sm sm:text-base font-black tracking-tight text-slate-900 uppercase">
                  Folha de Presença
                </h2>
                <div className="text-[11px] text-slate-500 font-semibold">
                  Ano Lectivo {db.settings?.currentAcademicYear || getFallbackAcademicYear()}
                </div>
              </div>
              <span className="px-3 py-1 bg-[#0b1f3a] text-white font-bold text-[11px] uppercase tracking-wider">
                {trimester || 'I Trimestre'}
              </span>
            </div>
          </div>

          {/* Dados da Prova */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-x-4 gap-y-2 p-3 bg-slate-50 border border-slate-200 print-break-avoid">
            <div>
              <span className="block text-[10px] uppercase font-bold text-slate-500">Turma / Classe</span>
              <span className="font-bold text-slate-900">
                {activeClass ? `${activeClass.grade} — ${activeClass.name}` : '—'}
              </span>
            </div>
            <div>
              <span className="block text-[10px] uppercase font-bold text-slate-500">Disciplina</span>
              <span className="font-bold text-slate-900">{subjectName || '________________'}</span>
            </div>
            <div>
              <span className="block text-[10px] uppercase font-bold text-slate-500">Data da Prova</span>
              <span className="font-bold text-slate-900">{formattedExamDate}</span>
            </div>
            <div>
              <span className="block text-[10px] uppercase font-bold text-slate-500">Hora / Sala</span>
              <span className="font-bold text-slate-900">
                {timeSlot || '____ : ____'} {roomLabel ? `— ${roomLabel}` : ''}
              </span>
            </div>
          </div>
          {/* Tabela de Presença */}
          <table className="w-full text-left border-collapse border border-slate-500 print:border-slate-700 print:text-[9pt]">
            <thead>
              <tr className="bg-[#0b1f3a] text-white font-bold uppercase text-[10px] tracking-wider">
                <th className="py-2 px-2 w-10 text-center border border-slate-600 print:border-slate-700">N.º</th>
                <th className="py-2 px-2 w-44 min-w-[170px] whitespace-nowrap border border-slate-600 print:border-slate-700">N.º Processo</th>
                <th className="py-2 px-2 border border-slate-600 print:border-slate-700">Nome Completo</th>
                <th className="py-2 px-2 w-28 text-center border border-slate-600 print:border-slate-700">Finanças</th>
                <th className="py-2 px-2 w-44 border border-slate-600 print:border-slate-700">Assinatura</th>
              </tr>
            </thead>
            <tbody>
              {classStudents.length === 0 && (
                <tr>
                  <td colSpan={5} className="py-6 px-3 text-center text-slate-400 border border-slate-500 print:border-slate-700">
                    Esta turma não tem alunos matriculados.
                  </td>
                </tr>
              )}
              {visibleClassStudents.map((student, idx) => {
                const isIrregular = examDebtWarningActive && student.financialStatus === 'debito';
                return (
                  <tr key={student.id} className="border-b border-slate-300 print-break-avoid">
                    <td className="py-2.5 px-2 text-center font-mono font-bold text-slate-600 border border-slate-500 print:border-slate-700">
                      {idx + 1}
                    </td>
                    <td className="py-2.5 px-2 min-w-[170px] whitespace-nowrap font-mono text-[12px] text-slate-800 border border-slate-500 print:border-slate-700">
                      {student.procNumber || '—'}
                    </td>
                    <td className="py-2.5 px-2 font-semibold text-slate-900 border border-slate-500 print:border-slate-700">{student.name}</td>
                    <td
                      className={`py-2.5 px-2 text-center border border-slate-500 print:border-slate-700 font-semibold text-[10.5px] ${
                        isIrregular ? 'text-rose-700' : 'text-slate-700'
                      }`}
                    >
                      {isIrregular ? 'Irregular' : 'Regular'}
                    </td>
                    <td className="py-2.5 px-2 border border-slate-500 print:border-slate-700">&nbsp;</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <TablePagination total={classStudents.length} page={pgClassStudents} onPageChange={setPgClassStudents} />

          {/* Rodapé de Assinaturas */}
          <div className="grid grid-cols-2 gap-8 pt-8 print-break-avoid">
            <div className="text-center">
              <div className="border-t border-slate-700 pt-1 mt-8 text-[10px] font-bold text-slate-700 uppercase">
                O (A) Vigilante
              </div>
            </div>
            <div className="text-center">
              <div className="border-t border-slate-700 pt-1 mt-8 text-[10px] font-bold text-slate-700 uppercase">
                O (A) Coordenador Pedagógico
              </div>
            </div>
          </div>

          <div className="text-[9px] text-slate-400 text-center pt-2 border-t border-slate-200">
            Documento gerado eletronicamente pelo sistema de gestão escolar — {db.settings?.schoolName}.
          </div>
        </div>

        {/* AÇÕES (Oculto na impressão) */}
        <div className="px-6 py-4 bg-slate-100 border-t border-slate-300 flex items-center justify-end gap-3 no-print">
          <button
            type="button"
            onClick={() => {
              window.focus();
              window.print();
            }}
            className="flex items-center gap-1.5 px-4 py-2 bg-[#7a0c0c] hover:bg-[#5e0909] text-white font-bold text-xs border border-[#7a0c0c] cursor-pointer transition-colors shadow-xs"
          >
            <span className="material-symbols-outlined text-[16px]">print</span>
            <span>Imprimir</span>
          </button>
          <button
            type="button"
            onClick={onClose}
            className="px-5 py-2 bg-slate-300 hover:bg-slate-400 text-slate-900 font-bold text-xs cursor-pointer"
          >
            Fechar
          </button>
        </div>
      </div>
    </div>
  );
};
