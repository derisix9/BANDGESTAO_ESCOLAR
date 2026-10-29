import React from 'react';
import { SchoolDatabase, Student, Matricula } from '../types';
import { dbService } from '../services/db';

interface StudentHistoryModalProps {
  db: SchoolDatabase;
  student: Student;
  onClose: () => void;
  /** Atalho para abrir a secção Matrículas já com este aluno seleccionado. */
  onNewMatricula?: (studentId: string) => void;
  /** Abre a Vista do Aluno naquele Ano Lectivo (relatórios financeiro e académico). */
  onViewYear?: (matricula: Matricula) => void;
}

const ESTADO_STYLES: Record<string, string> = {
  confirmada: 'bg-emerald-50 text-emerald-800 border-emerald-300',
  matriculado: 'bg-emerald-50 text-emerald-800 border-emerald-300',
  concluida: 'bg-blue-50 text-blue-800 border-blue-300',
  pendente: 'bg-amber-50 text-amber-800 border-amber-300',
  cancelada: 'bg-slate-100 text-slate-500 border-slate-300',
  transferida: 'bg-purple-50 text-purple-800 border-purple-300'
};

const formatKz = (v: number) =>
  `${(v || 0).toLocaleString('pt-AO', { minimumFractionDigits: 0 })} Kz`;

/**
 * Mostra o Histórico Escolar do aluno DENTRO desta instituição: uma linha por
 * Matrícula (ano lectivo, turma, tipo, estado e situação financeira), obtida
 * de `dbService.getHistoricoEscolar`. Isto é diferente da "Proveniência
 * Escolar" da ficha de cadastro, que se refere à escola anterior, fora da
 * instituição.
 */
export const StudentHistoryModal: React.FC<StudentHistoryModalProps> = ({
  db,
  student,
  onClose,
  onNewMatricula,
  onViewYear
}) => {
  const historico = dbService.getHistoricoEscolar(student.id);

  return (
    <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-3 sm:p-4">
      <div className="bg-white rounded-none max-w-2xl w-full shadow-2xl border border-slate-400 overflow-hidden flex flex-col max-h-[90vh]">
        <div className="px-6 py-4 bg-[#0b1f3a] text-white flex items-center justify-between border-b border-slate-700">
          <div className="flex items-center gap-2">
            <span className="material-symbols-outlined text-[22px]">history</span>
            <div>
              <h3 className="font-bold text-sm tracking-wide uppercase leading-tight">Histórico Escolar</h3>
              <p className="text-[11px] text-slate-300 leading-tight">
                {student.name} · Proc. {student.procNumber || '—'}
              </p>
            </div>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-white p-1 cursor-pointer">
            <span className="material-symbols-outlined text-[20px]">close</span>
          </button>
        </div>

        <div className="p-6 overflow-y-auto text-xs bg-white space-y-4">
          {historico.length === 0 ? (
            <div className="text-center py-10 text-slate-400">
              <span className="material-symbols-outlined text-[36px] block mb-2">school</span>
              Este aluno ainda não tem nenhuma matrícula registada.
              {onNewMatricula && (
                <div className="mt-3">
                  <button
                    onClick={() => onNewMatricula(student.id)}
                    className="px-4 py-2 bg-[#0b1f3a] hover:bg-[#7a0c0c] text-white font-bold text-[11px] uppercase tracking-wide cursor-pointer border border-[#0b1f3a]"
                  >
                    Matricular Agora
                  </button>
                </div>
              )}
            </div>
          ) : (
            <div className="border border-slate-300 divide-y divide-slate-200">
              {historico.map((m) => (
                <div key={m.id} className="p-3 flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-4">
                  <div className="sm:w-28 shrink-0">
                    <div className="font-bold text-[#0b1f3a] text-sm">{m.academicYear}</div>
                    <div className="text-[10px] text-slate-500 font-mono">{m.numeroMatricula}</div>
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="font-semibold text-slate-800 truncate">
                      {m.grade} — {m.className}
                      {m.shift ? ` · ${m.shift}` : ''}
                    </div>
                    <div className="text-[10px] text-slate-500 uppercase tracking-wide">
                      {m.tipo} · {m.tipoAluno}
                      {m.regime ? ` · ${m.regime}` : ''}
                    </div>
                  </div>
                  <div className="text-right shrink-0 flex items-start gap-2">
                    <div>
                      <span
                        className={`inline-block px-2 py-0.5 border text-[10px] font-bold uppercase ${
                          ESTADO_STYLES[m.estado] || 'bg-slate-100 text-slate-600 border-slate-300'
                        }`}
                      >
                        {m.estado}
                      </span>
                      <div className="text-[10px] text-slate-500 mt-1">
                        Propina: {formatKz(m.valorPropinaKz)}
                      </div>
                    </div>
                    {onViewYear && (
                      <button
                        onClick={() => onViewYear(m)}
                        title={`Ver aluno em ${m.academicYear}`}
                        className="p-1.5 border border-slate-300 text-slate-500 hover:text-[#0b1f3a] hover:border-[#0b1f3a] cursor-pointer shrink-0"
                      >
                        <span className="material-symbols-outlined text-[16px]">visibility</span>
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="px-6 py-3 bg-slate-50 border-t border-slate-200 flex justify-between items-center">
          <span className="text-[10px] text-slate-500">
            {historico.length} {historico.length === 1 ? 'matrícula registada' : 'matrículas registadas'}
          </span>
          <div className="flex items-center gap-2">
            {onNewMatricula && historico.length > 0 && (
              <button
                onClick={() => onNewMatricula(student.id)}
                className="px-4 py-2 bg-[#0b1f3a] hover:bg-[#7a0c0c] text-white font-bold text-[11px] uppercase tracking-wide cursor-pointer border border-[#0b1f3a]"
              >
                Nova Matrícula
              </button>
            )}
            <button
              onClick={onClose}
              className="px-4 py-2 bg-white hover:bg-slate-100 text-slate-700 font-bold text-[11px] uppercase tracking-wide cursor-pointer border border-slate-300"
            >
              Fechar
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
