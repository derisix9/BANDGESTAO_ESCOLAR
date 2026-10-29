import React, { useMemo, useState } from 'react';
import { KEY_SUBSYSTEM_OPTIONS, KeySubsystemId } from '../utils/keySubjects';

interface KeySubjectFieldsProps {
  keySubsystems: KeySubsystemId[];
  keyCourses: string[];
  onChange: (next: { keySubsystems: KeySubsystemId[]; keyCourses: string[] }) => void;
  /** Cursos em que a disciplina é efectivamente leccionada (Atribuição). */
  taughtCourses: string[];
  /** Todos os cursos do Ensino Médio cadastrados (fallback e "mostrar todos"). */
  allCourses: string[];
}

/**
 * Marcação de "Disciplina Chave" no cadastro/edição de disciplinas.
 * Primário/I Ciclo: por subsistema (6.ª e 9.ª classes). Ensino Médio: por curso
 * onde a disciplina é leccionada (12.ª e 13.ª classes). Disciplinas chave não têm
 * direito a Exame de Recurso.
 */
export const KeySubjectFields: React.FC<KeySubjectFieldsProps> = ({
  keySubsystems,
  keyCourses,
  onChange,
  taughtCourses,
  allCourses
}) => {
  const [showAll, setShowAll] = useState(false);

  const courseOptions = useMemo(() => {
    const base = !showAll && taughtCourses.length > 0 ? taughtCourses : allCourses;
    return Array.from(new Set([...base, ...keyCourses])).sort((a, b) => a.localeCompare(b, 'pt'));
  }, [showAll, taughtCourses, allCourses, keyCourses]);

  const toggleSubsystem = (id: KeySubsystemId) => {
    const next = keySubsystems.includes(id) ? keySubsystems.filter((x) => x !== id) : [...keySubsystems, id];
    onChange({ keySubsystems: next, keyCourses });
  };
  const toggleCourse = (name: string) => {
    const next = keyCourses.includes(name) ? keyCourses.filter((x) => x !== name) : [...keyCourses, name];
    onChange({ keySubsystems, keyCourses: next });
  };

  return (
    <div className="border border-slate-300 bg-slate-50/60 p-3 space-y-3">
      <div className="flex items-center gap-2">
        <span className="material-symbols-outlined text-[18px] text-[#7a0c0c]">key</span>
        <span className="font-bold text-slate-800 uppercase tracking-wider">Disciplina Chave</span>
      </div>
      <div>
        <div className="text-[10px] font-bold uppercase text-slate-600 mb-1">Subsistema de ensino</div>
        <div className="flex flex-wrap gap-3">
          {KEY_SUBSYSTEM_OPTIONS.map((opt) => (
            <label key={opt.id} className="flex items-center gap-2 cursor-pointer select-none text-slate-800 font-semibold">
              <input
                type="checkbox"
                checked={keySubsystems.includes(opt.id)}
                onChange={() => toggleSubsystem(opt.id)}
                className="w-4 h-4 rounded-none border-slate-300 text-[#7a0c0c] focus:ring-[#7a0c0c]"
              />
              <span>
                {opt.label} <span className="text-slate-500 font-normal">({opt.exam})</span>
              </span>
            </label>
          ))}
        </div>
      </div>

      <div>
        <div className="flex items-center justify-between mb-1">
          <div className="text-[10px] font-bold uppercase text-slate-600">
            Lista de Cursos
          </div>
          {taughtCourses.length > 0 && (
            <button
              type="button"
              onClick={() => setShowAll((v) => !v)}
              className="text-[10px] font-bold text-[#0b1f3a] underline cursor-pointer"
            >
              {showAll ? 'Só cursos onde é leccionada' : 'Mostrar todos os cursos'}
            </button>
          )}
        </div>
        {courseOptions.length === 0 ? (
          <p className="text-[10px] text-slate-500">Nenhum curso cadastrado.</p>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5 max-h-36 overflow-y-auto pr-1">
            {courseOptions.map((c) => (
              <label key={c} className="flex items-center gap-2 cursor-pointer select-none text-slate-800">
                <input
                  type="checkbox"
                  checked={keyCourses.includes(c)}
                  onChange={() => toggleCourse(c)}
                  className="w-4 h-4 rounded-none border-slate-300 text-[#7a0c0c] focus:ring-[#7a0c0c]"
                />
                <span className="truncate" title={c}>{c}</span>
              </label>
            ))}
          </div>
        )}
        {taughtCourses.length === 0 && courseOptions.length > 0 && (
          <p className="text-[10px] text-slate-500 mt-1">
            Esta disciplina ainda não foi atribuída a nenhum curso (Secretaria Académica → Atribuição); a lista mostra todos os cursos.
          </p>
        )}
      </div>
    </div>
  );
};
