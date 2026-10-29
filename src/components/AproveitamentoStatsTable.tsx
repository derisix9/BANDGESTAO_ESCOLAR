import React from 'react';
import { ClassStats, GenderCount, GenderPercent } from '../utils/aproveitamentoStats';

export interface AproveitamentoRow {
  classId: string;
  className: string;
  cycle: string;
  shift: string;
  stats: ClassStats;
  criticalSubject: string | null;
  director: string;
}

interface Props {
  rows: AproveitamentoRow[];
  totals: ClassStats;
  /** Nome da disciplina filtrada; vazio = todas. */
  subjectLabel?: string;
  /** Versão de impressão: menos colunas descritivas. */
  compact?: boolean;
}

type GroupKey = 'matriculados' | 'desistidos' | 'transferidos' | 'avaliados' | 'reprovados' | 'aprovados';

const GROUPS: Array<{ key: GroupKey; label: string; head: string; cell: string; total: string }> = [
  { key: 'matriculados', label: 'Matriculados', head: 'bg-[#0b1f3a] text-white', cell: '', total: 'bg-[#0b1f3a] text-white' },
  { key: 'desistidos', label: 'Desistidos', head: 'bg-[#5b4a0b] text-amber-100', cell: '', total: 'bg-[#5b4a0b] text-amber-100' },
  { key: 'transferidos', label: 'Transferidos', head: 'bg-[#3b2a63] text-violet-100', cell: '', total: 'bg-[#3b2a63] text-violet-100' },
  { key: 'avaliados', label: 'Avaliados', head: 'bg-[#0b3a5c] text-sky-100', cell: '', total: 'bg-[#0b3a5c] text-sky-100' },
  { key: 'reprovados', label: 'Reprovados', head: 'bg-[#5c0d0d] text-rose-200', cell: '', total: 'bg-[#7a0c0c] text-amber-200' },
  { key: 'aprovados', label: 'Aprovados', head: 'bg-[#0d3b2b] text-emerald-200', cell: '', total: 'bg-emerald-900 text-emerald-100' }
];

const SEX: Array<keyof GenderCount> = ['M', 'F', 'MF'];

const fmtPct = (v: number | null) => (v === null ? '—' : `${v}%`);

export const AproveitamentoStatsTable: React.FC<Props> = ({ rows, totals, subjectLabel, compact }) => {
  const showCritical = !compact && !subjectLabel;
  const pad = compact ? 'py-1 px-1' : 'py-2 px-2';
  const textSize = compact ? 'text-[10px] print:text-[7pt]' : 'text-xs print:text-[9px]';
  const colSpanAll = 1 + (compact ? 0 : 1) + 21 + 1 + (showCritical ? 1 : 0) + (compact ? 0 : 1);

  const countCells = (stats: ClassStats, isTotal: boolean, border: string) =>
    GROUPS.flatMap((g) =>
      SEX.map((s) => (
        <td
          key={`${g.key}-${s}`}
          className={`${pad} text-center font-mono ${s === 'MF' ? 'font-extrabold' : 'font-medium'} ${border} ${
            isTotal ? g.total : g.cell
          } ${s === 'MF' ? 'border-r-2' : ''}`}
        >
          {stats[g.key][s]}
        </td>
      ))
    );

  const pctCells = (p: GenderPercent, isTotal: boolean, border: string) =>
    SEX.map((s) => (
      <td
        key={`pct-${s}`}
        className={`${pad} text-center font-mono ${s === 'MF' ? 'font-extrabold' : 'font-medium'} ${border} ${
          isTotal ? 'bg-[#0b1f3a] text-emerald-300' : 'text-violet-900'
        }`}
      >
        {fmtPct(p[s])}
      </td>
    ));

  return (
    <div className="overflow-x-auto print:overflow-visible w-full">
      <table className={`w-full text-left ${textSize} border border-slate-400 border-collapse print:table-auto`}>
        <thead>
          <tr className="bg-[#0b1f3a] text-white font-bold uppercase tracking-wider">
            <th rowSpan={2} className={`${pad} border border-slate-600 align-middle`}>Turma & Nível</th>
            {!compact && <th rowSpan={2} className={`${pad} border border-slate-600 align-middle`}>Ciclo (Turno)</th>}
            {GROUPS.map((g) => (
              <th key={g.key} colSpan={3} className={`${pad} text-center border border-slate-600 ${g.head}`}>
                {g.label}
              </th>
            ))}
            <th colSpan={3} className={`${pad} text-center border border-slate-600 bg-violet-900 text-violet-100`}>
              Percentagem
            </th>
            {!compact && (
              <th rowSpan={2} className={`${pad} text-center border border-slate-600 align-middle`}>Média</th>
            )}
            {showCritical && (
              <th rowSpan={2} className={`${pad} border border-slate-600 align-middle`}>Disciplina Crítica</th>
            )}
            {!compact && (
              <th rowSpan={2} className={`${pad} border border-slate-600 align-middle`}>Diretor de Turma</th>
            )}
          </tr>
          <tr className="bg-slate-700 text-white font-bold">
            {[...GROUPS.map((g) => g.key), 'pct'].flatMap((k) =>
              SEX.map((s) => (
                <th key={`${k}-${s}`} className={`${pad} text-center border border-slate-500 ${s === 'MF' ? 'border-r-2' : ''}`}>
                  {s}
                </th>
              ))
            )}
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 ? (
            <tr>
              <td colSpan={colSpanAll} className="py-8 text-center text-slate-400 font-medium">
                Nenhuma turma encontrada para os filtros selecionados.
              </td>
            </tr>
          ) : (
            rows.map((row, idx) => (
              <tr key={row.classId} className={`border-b border-slate-300 ${idx % 2 === 1 ? 'bg-[#f8fafc]' : 'bg-white'}`}>
                <td className={`${pad} font-bold text-[#0b1f3a] border border-slate-300`}>{row.className}</td>
                {!compact && (
                  <td className={`${pad} text-slate-700 border border-slate-300`}>
                    {row.cycle} ({row.shift})
                  </td>
                )}
                {countCells(row.stats, false, 'border border-slate-300')}
                {pctCells(row.stats.percentagem, false, 'border border-slate-300')}
                {!compact && (
                  <td className={`${pad} text-center font-mono font-bold border border-slate-300`}>
                    {row.stats.averageGrade ?? '—'}
                  </td>
                )}
                {showCritical && (
                  <td className={`${pad} text-slate-700 border border-slate-300`}>
                    {row.criticalSubject || 'Sem dados suficientes'}
                  </td>
                )}
                {!compact && <td className={`${pad} text-slate-800 border border-slate-300`}>{row.director}</td>}
              </tr>
            ))
          )}
          {rows.length > 0 && (
            <tr className="bg-[#0b1f3a] text-white font-bold border-t-2 border-slate-900">
              <td className={`${pad} uppercase border border-slate-600`}>TOTAL</td>
              {!compact && <td className={`${pad} text-slate-300 border border-slate-600`}>{rows.length} Turmas</td>}
              {countCells(totals, true, 'border border-slate-600')}
              {pctCells(totals.percentagem, true, 'border border-slate-600')}
              {!compact && (
                <td className={`${pad} text-center font-mono text-amber-300 border border-slate-600`}>
                  {totals.averageGrade ?? '—'}
                </td>
              )}
              {showCritical && <td className={`${pad} text-slate-400 border border-slate-600`}>—</td>}
              {!compact && <td className={`${pad} text-slate-400 border border-slate-600`}>—</td>}
            </tr>
          )}
        </tbody>
      </table>
      <p className="mt-2 text-[10px] text-slate-500 print:text-[7pt]">
        M = Masculino · F = Feminino · MF = Total. Transferidos = alunos que saíram por transferência (não inclui os que entraram). Percentagem = Aprovados ÷ Avaliados.
        {subjectLabel ? ` Disciplina: ${subjectLabel}.` : ' Todas as disciplinas (média por aluno).'}
      </p>
    </div>
  );
};
