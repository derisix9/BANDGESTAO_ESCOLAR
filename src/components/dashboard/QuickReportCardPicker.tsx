import React, { useState, useMemo } from 'react';
import { SchoolDatabase, Student } from '../../types';

interface QuickReportCardPickerProps {
  db: SchoolDatabase;
  isOpen: boolean;
  onClose: () => void;
  onSelectStudent: (student: Student) => void;
}

export const QuickReportCardPicker: React.FC<QuickReportCardPickerProps> = ({
  db,
  isOpen,
  onClose,
  onSelectStudent
}) => {
  const [search, setSearch] = useState('');
  const [selectedClassId, setSelectedClassId] = useState<string>('all');

  const filteredStudents = useMemo(() => {
    return (db.students || []).filter((s) => {
      const matchSearch =
        search === '' ||
        s.name.toLowerCase().includes(search.toLowerCase()) ||
        (s.procNumber && s.procNumber.toLowerCase().includes(search.toLowerCase())) ||
        (s.className && s.className.toLowerCase().includes(search.toLowerCase()));

      const matchClass = selectedClassId === 'all' || s.classId === selectedClassId;

      return matchSearch && matchClass;
    });
  }, [db.students, search, selectedClassId]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-xs z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl max-w-2xl w-full shadow-2xl border border-slate-200 overflow-hidden flex flex-col max-h-[85vh] animate-in fade-in zoom-in-95 duration-150">
        {/* Header */}
        <div className="px-6 py-4 bg-[#0b1f3a] text-white flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="material-symbols-outlined text-amber-400 text-[22px]">assignment</span>
            <div>
              <h3 className="font-headline font-bold text-base">
                Emitir Boletim
              </h3>
              <p className="text-xs text-blue-200">
                Emissão de Boletim de Nota do Aluno
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-white/80 hover:text-white p-1 rounded-lg hover:bg-white/10"
          >
            <span className="material-symbols-outlined text-[20px]">close</span>
          </button>
        </div>

        {/* Barra de Pesquisa e Filtro de Turma */}
        <div className="p-4 bg-slate-50 border-b border-slate-200 grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
          <div className="relative">
            <span className="material-symbols-outlined absolute left-3 top-2.5 text-slate-400 text-[18px]">
              search
            </span>
            <input
              type="text"
              placeholder="Pesquisar por nome ou nº de processo..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full pl-9 pr-3 py-2 bg-white rounded-xl border border-slate-300 focus:outline-none focus:border-[#0b1f3a]"
              autoFocus
            />
          </div>

          <div>
            <select
              value={selectedClassId}
              onChange={(e) => setSelectedClassId(e.target.value)}
              className="w-full px-3 py-2 bg-white rounded-xl border border-slate-300 focus:outline-none focus:border-[#0b1f3a]"
            >
              <option value="all">Todas as Turmas ({db.classes?.length || 0})</option>
              {(db.classes || []).map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name} ({c.grade} - {c.shift})
                </option>
              ))}
            </select>
          </div>
        </div>

        {/* Lista de Alunos Encontrados */}
        <div className="flex-1 overflow-y-auto p-4 space-y-2">
          {filteredStudents.length === 0 ? (
            <div className="text-center py-12 text-slate-400">
              <span className="material-symbols-outlined text-4xl mb-1 text-slate-300">person_search</span>
              <p className="text-sm font-medium">Nenhum aluno encontrado com estes critérios.</p>
            </div>
          ) : (
            filteredStudents.map((st) => (
              <div
                key={st.id}
                onClick={() => {
                  onSelectStudent(st);
                  onClose();
                }}
                className="flex items-center justify-between p-3 rounded-xl border border-slate-200 hover:border-[#0b1f3a] hover:bg-blue-50/40 cursor-pointer transition-all group"
              >
                <div className="flex items-center gap-3 min-w-0">
                  <div className="w-10 h-10 rounded-full bg-slate-200 overflow-hidden flex items-center justify-center font-bold text-slate-700 shrink-0">
                    {st.avatar ? (
                      <img
                        src={st.avatar}
                        alt={st.name}
                        className="w-full h-full object-cover"
                        referrerPolicy="no-referrer"
                      />
                    ) : (
                      st.name.charAt(0)
                    )}
                  </div>
                  <div className="min-w-0">
                    <h4 className="font-bold text-sm text-slate-900 group-hover:text-[#0b1f3a] truncate">
                      {st.name}
                    </h4>
                    <div className="flex items-center gap-2 text-xs text-slate-500">
                      <span className="font-mono">Proc: {st.procNumber}</span>
                      <span>•</span>
                      <span>{st.className || st.grade}</span>
                      <span>•</span>
                      <span className="font-semibold text-emerald-700">
                        Média: {st.currentAverage ? `${st.currentAverage} val` : 'Sem notas'}
                      </span>
                    </div>
                  </div>
                </div>

                <div className="flex items-center gap-2 shrink-0">
                  <button
                    type="button"
                    className="px-3 py-1.5 rounded-lg bg-[#0b1f3a] text-white text-xs font-bold group-hover:bg-[#16355f] flex items-center gap-1 shadow-xs"
                  >
                    <span>Emitir Boletim</span>
                    <span className="material-symbols-outlined text-[16px]">arrow_forward</span>
                  </button>
                </div>
              </div>
            ))
          )}
        </div>

        {/* Footer */}
        <div className="p-3 bg-slate-50 border-t border-slate-200 flex items-center justify-between text-xs text-slate-500">
          <span>{filteredStudents.length} alunos disponíveis</span>
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-1.5 rounded-lg text-slate-700 font-bold hover:bg-slate-200 transition-colors"
          >
            Fechar
          </button>
        </div>
      </div>
    </div>
  );
};
