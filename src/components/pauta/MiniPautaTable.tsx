import React from 'react';
import { StudentMiniPautaItem, GradeTypeKey } from '../../types/pauta';
import { ClassRoom, Subject, InstitutionSettings } from '../../types';
import { dbService } from '../../services/db';
import {
  GradeRules,
  PautaRegime,
  EJA_LIMITS,
  calculateEjaSubtotal,
  DEFAULT_GRADE_RULES
} from '../../utils/pautaCalculations';
import { buildPautaHeader } from '../../utils/pautaHeader';
import { PautaOfficialHeader } from './PautaOfficialHeader';
import { visiblePautaRows } from '../../utils/pautaView';

interface MiniPautaTableProps {
  rows: StudentMiniPautaItem[];
  onCellChange: (rowIndex: number, field: keyof StudentMiniPautaItem, value: any) => void;
  onToggleDesistente: (rowIndex: number) => void;
  selectedGradeTypes: Set<GradeTypeKey>;
  hideDebtorGrades: boolean;
  previewHiddenOnScreen: boolean;
  /** Ocultar da listagem os alunos desistentes / transferidos. */
  hideDesistentes?: boolean;
  hideTransferidos?: boolean;
  activeClass?: ClassRoom;
  activeSubject?: Subject;
  settings?: InstitutionSettings;
  isReadOnly?: boolean;
  /** Regime de avaliação: 'transicao' (por omissão), 'exame' (6.ª/9.ª/12.ª/13.ª) ou 'eja'. */
  regime?: PautaRegime;
  /** Disciplina chave desta classe/curso (sem direito a Recurso). */
  isKeySubject?: boolean;
  gradeRules?: GradeRules;
  /** Professor/a da disciplina nesta turma (Atribuição). */
  teacherName?: string;
}

type TrimCol = {
  id: 'MAC' | 'NPP' | 'NPT' | 'SUB' | 'AAV' | 'PCP' | 'MT';
  /** Prefixo do campo em StudentMiniPautaItem (mac, npp, npt, aav, pcp, mt) — sufixo = trimestre. */
  prefix?: 'mac' | 'npp' | 'npt' | 'aav' | 'pcp' | 'mt';
  max: number;
  step: number;
  /** Escala da componente; abaixo de metade é "negativo" (a nota máxima do EJA é 14/2/4, não 20). */
  scale: number;
};

export const MiniPautaTable: React.FC<MiniPautaTableProps> = ({
  rows,
  onCellChange,
  selectedGradeTypes,
  hideDebtorGrades,
  hideDesistentes = false,
  hideTransferidos = false,
  activeClass,
  activeSubject,
  settings,
  isReadOnly = false,
  regime = 'transicao',
  isKeySubject = false,
  gradeRules = DEFAULT_GRADE_RULES,
  teacherName
}) => {
  // Sempre reflete os Dados da Instituição definidos em Configurações
  const institution = settings || dbService.getSettings();
  const passing = gradeRules.passingGrade;
  const isExame = regime === 'exame';
  const isEJA = regime === 'eja';

  const shownRows = visiblePautaRows(rows, { hideDesistentes, hideTransferidos });

  const header = buildPautaHeader({
    kind: 'minipauta',
    settings: institution,
    activeClass,
    subject: activeSubject,
    teacherName,
    regime,
    totalStudents: shownRows.length,
    parts: { npp: selectedGradeTypes.has('NPP'), pg: selectedGradeTypes.has('PG') }
  });

  const has = (k: GradeTypeKey) => selectedGradeTypes.has(k);

  // Colunas por trimestre, conforme o regime e as colunas marcadas nos chips.
  const trimCols: TrimCol[] = (
    isEJA
      ? [
          { id: 'MAC', prefix: 'mac', max: EJA_LIMITS.MAC, step: 0.5, scale: EJA_LIMITS.MAC },
          { id: 'NPT', prefix: 'npt', max: EJA_LIMITS.NPT, step: 0.5, scale: EJA_LIMITS.NPT },
          { id: 'SUB', max: EJA_LIMITS.MAC, step: 0.5, scale: EJA_LIMITS.MAC },
          { id: 'AAV', prefix: 'aav', max: EJA_LIMITS.AAV, step: 0.5, scale: EJA_LIMITS.AAV },
          { id: 'PCP', prefix: 'pcp', max: EJA_LIMITS.PCP, step: 0.5, scale: EJA_LIMITS.PCP },
          { id: 'MT', prefix: 'mt', max: 20, step: 1, scale: 20 }
        ]
      : [
          { id: 'MAC', prefix: 'mac', max: 20, step: 1, scale: 20 },
          { id: 'NPP', prefix: 'npp', max: 20, step: 1, scale: 20 },
          { id: 'NPT', prefix: 'npt', max: 20, step: 1, scale: 20 },
          { id: 'MT', prefix: 'mt', max: 20, step: 1, scale: 20 }
        ]
  ) as TrimCol[];

  const isTrimColVisible = (c: TrimCol, t: 1 | 2 | 3): boolean => {
    if (c.id === 'MT') return has(`MT${t}` as GradeTypeKey);
    return has(c.id as GradeTypeKey);
  };
  const visibleTrimCols = (t: 1 | 2 | 3) => trimCols.filter((c) => isTrimColVisible(c, t));
  const t1Cols = visibleTrimCols(1).length;
  const t2Cols = visibleTrimCols(2).length;
  const t3Cols = visibleTrimCols(3).length;

  const showMFD = has('MFD');
  const showPG = !isExame && !isEJA && has('PG');
  const showCA = !isExame && !isEJA && has('CA');
  const showNEE = isExame && has('NEE');
  const showNEO = isExame && has('NEO');
  const showMF = isExame && has('MF');
  const showNER = isExame && has('NER');
  const finalCols =
    [showMFD, showPG, showCA, showNEE, showNEO, showMF, showNER].filter(Boolean).length + 1; // +1 para Obs

  const hiddenDash = (cls = '') => <span className={`text-slate-300 font-mono select-none ${cls}`}>-</span>;

  const renderGradeValue = (
    val: number | '' | undefined,
    isDebtor: boolean,
    isDesistente: boolean,
    isAverageCol = false,
    scale = 20
  ) => {
    if (isDesistente) return hiddenDash();
    if (isDebtor && hideDebtorGrades) {
      return (
        <span className="text-slate-400 font-mono font-bold text-xs print:text-[10px] print:text-slate-500 select-none">-</span>
      );
    }
    if (val === '' || val === undefined || val === null) {
      return <span className="text-slate-400 font-mono">-</span>;
    }
    const num = typeof val === 'number' ? val : parseFloat(val as any);
    const isNegative = !isNaN(num) && num < (passing * scale) / 20;
    const shown = Number.isInteger(num) ? num : Math.round(num * 100) / 100;
    return (
      <span
        className={`font-mono font-bold text-xs print:text-[10px] ${
          isNegative ? 'text-rose-600 font-extrabold print:text-red-600' : 'text-slate-900 print:text-black'
        } ${isAverageCol ? 'text-xs' : ''}`}
      >
        {shown}
      </span>
    );
  };

  const renderEditableCell = (
    field: keyof StudentMiniPautaItem,
    value: number | '' | undefined,
    idx: number,
    isDebtor: boolean,
    isDesistente: boolean,
    max = 20,
    step = 1
  ) => {
    if (isDesistente) return hiddenDash();
    if (isDebtor && hideDebtorGrades) {
      return (
        <span className="text-slate-400 font-mono font-bold text-xs print:text-[10px] print:text-slate-500 select-none">-</span>
      );
    }
    if (isReadOnly) return renderGradeValue(value, isDebtor, isDesistente, false, max);

    const v = value ?? '';
    const negative = typeof v === 'number' && v < (passing * max) / 20;
    return (
      <>
        <input
          type="number"
          step={step}
          min="0"
          max={max}
          value={v}
          onChange={(e) => {
            if (e.target.value === '') return onCellChange(idx, field, '');
            const n = parseFloat(e.target.value);
            onCellChange(idx, field, isNaN(n) ? '' : Math.max(0, Math.min(max, n)));
          }}
          className={`w-9 h-7 text-center rounded border font-mono text-xs font-bold transition-all print:hidden ${
            negative
              ? 'bg-rose-50 border-rose-200 text-rose-600 focus:bg-white focus:border-rose-500 focus:ring-1 focus:ring-rose-400'
              : 'bg-slate-50/90 border-slate-200 text-slate-800 hover:bg-white hover:border-slate-300 focus:bg-white focus:border-[#0b1f3a] focus:ring-1 focus:ring-[#0b1f3a]'
          }`}
        />
        <span className="hidden print:inline">{renderGradeValue(value, isDebtor, isDesistente, false, max)}</span>
      </>
    );
  };

  const subtotalOf = (row: StudentMiniPautaItem, t: 1 | 2 | 3): number | '' =>
    calculateEjaSubtotal((row as any)[`mac${t}`] ?? '', (row as any)[`npt${t}`] ?? '', {
      MAC: has('MAC'),
      NPT: has('NPT')
    });

  const trimHeaderBg: Record<1 | 2 | 3, string> = { 1: 'bg-[#0e2c53]', 2: 'bg-[#143765]', 3: 'bg-[#1a4378]' };
  const mtHeaderBg: Record<1 | 2 | 3, string> = { 1: 'bg-[#09203d]', 2: 'bg-[#0d284a]', 3: 'bg-[#123157]' };
  const trimLabel: Record<1 | 2 | 3, string> = { 1: 'I TRIMESTRE', 2: 'II TRIMESTRE', 3: 'III TRIMESTRE' };
  const trimCount: Record<1 | 2 | 3, number> = { 1: t1Cols, 2: t2Cols, 3: t3Cols };

  const subHeaderCell = (c: TrimCol, t: 1 | 2 | 3) => {
    const base = 'py-1.5 px-1 border-r border-slate-600 print:border-slate-500';
    if (c.id === 'MT') {
      return (
        <th key={`h-${t}-MT`} className={`${base} w-11 print:w-8 ${mtHeaderBg[t]} text-amber-300 font-black print:text-amber-300`}>
          {isEJA ? `MT${t}` : `MT${t}`}
        </th>
      );
    }
    if (c.id === 'SUB') {
      return (
        <th key={`h-${t}-SUB`} className={`${base} w-12 print:w-8 text-sky-200 font-black`} title="Subtotal = (MAC + NPT) / 2">
          SUB
        </th>
      );
    }
    return (
      <th key={`h-${t}-${c.id}`} className={`${base} w-11 print:w-7 text-slate-200`}>
        {c.id}
        {isEJA && <span className="block text-[8px] font-medium normal-case text-slate-300">(0–{c.max})</span>}
      </th>
    );
  };

  const bodyCell = (row: StudentMiniPautaItem, idx: number, c: TrimCol, t: 1 | 2 | 3) => {
    const { isDebtor, isDesistente } = row;
    const common = 'border-r border-slate-200 print:border-slate-300 text-center';
    if (c.id === 'MT') {
      return (
        <td key={`b-${t}-MT`} className={`py-1.5 px-1 ${common} bg-blue-50/50 font-mono font-bold print:bg-blue-50/50`}>
          {renderGradeValue((row as any)[`mt${t}`], isDebtor, isDesistente, true)}
        </td>
      );
    }
    if (c.id === 'SUB') {
      return (
        <td key={`b-${t}-SUB`} className={`py-1.5 px-1 ${common} bg-sky-50/60 font-mono font-bold`}>
          {renderGradeValue(subtotalOf(row, t), isDebtor, isDesistente, true, c.scale)}
        </td>
      );
    }
    const field = `${c.prefix}${t}` as keyof StudentMiniPautaItem;
    return (
      <td key={`b-${t}-${c.id}`} className={`py-1 px-1 ${common}`}>
        {renderEditableCell(field, (row as any)[field], idx, isDebtor, isDesistente, c.max, c.step)}
      </td>
    );
  };

  const normalizedObs = (row: StudentMiniPautaItem): string => {
    const o = String(row.obs || '').trim().toUpperCase();
    if (!o) return '';
    if (o === 'EXAME DE RECURSO') return 'RECURSO';
    if (o === 'NÃO APROVADO' || o === 'NAO APROVADO') return 'REPROVADO';
    return o;
  };

  const renderObs = (row: StudentMiniPautaItem) => {
    if (row.isTransferido) {
      return (
        <span className="pauta-badge px-2 py-0.5 rounded-full text-[10px] font-bold bg-violet-50 text-violet-700 border border-violet-200 inline-block print:text-black">
          Transferido
        </span>
      );
    }
    if (row.isDesistente) {
      return (
        <span className="pauta-badge px-2 py-0.5 rounded-full text-[10px] font-bold bg-slate-100 text-slate-600 border border-slate-200 inline-block">
          Desistente
        </span>
      );
    }
    if (row.isDebtor && hideDebtorGrades) {
      return (
        <span className="pauta-badge px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-slate-100 text-slate-500 border border-slate-300 inline-block print:text-black">
          Retido
        </span>
      );
    }
    const decisive = isExame && typeof row.mf === 'number' ? row.mf : row.mfd;
    const label = normalizedObs(row) || (typeof decisive === 'number' ? (decisive >= passing ? 'APROVADO' : 'REPROVADO') : 'PENDENTE');
    const style =
      label === 'APROVADO'
        ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
        : label === 'RECURSO'
        ? 'bg-amber-50 text-amber-700 border border-amber-200'
        : label === 'REPROVADO'
        ? 'bg-rose-50 text-rose-700 border border-rose-200'
        : 'bg-slate-100 text-slate-500 border border-slate-200';
    return <span className={`pauta-badge px-2 py-0.5 rounded-full text-[10px] font-bold inline-block ${style}`}>{label}</span>;
  };

  return (
    <div className="minipauta-print-page w-full bg-white rounded-2xl border border-slate-200/90 shadow-xs overflow-hidden print:overflow-visible print:rounded-none print:shadow-none">
      {/* Estilos de Impressão: sem bordas de sistema em nenhum "quadrado" do documento
          (moldura do cartão, linhas/colunas da tabela) nem contorno nas etiquetas da
          coluna Obs. — mantém-se apenas a cor de fundo/texto. A tabela ocupa sempre
          toda a largura útil da folha A4 Paisagem. */}
      <style>{`
        @media print {
          .minipauta-print-page {
            width: 100% !important;
            margin: 0 !important;
            padding: 0 !important;
          }
          .minipauta-print-page,
          .minipauta-print-page table,
          .minipauta-print-page thead,
          .minipauta-print-page tbody,
          .minipauta-print-page tr,
          .minipauta-print-page th,
          .minipauta-print-page td {
            border: none !important;
            outline: none !important;
          }
          .minipauta-print-page table {
            border-collapse: collapse !important;
            width: 100% !important;
          }
          .minipauta-print-page .pauta-badge {
            border: none !important;
          }
        }
      `}</style>
      {/* Cabeçalho oficial (impressão) — o mesmo modelo usado na exportação em Excel */}
      <PautaOfficialHeader header={header} />

      {/* Informação do regime de avaliação (apenas no ecrã) */}
      {(isExame || isEJA) && (
        <div className="px-4 py-2.5 bg-slate-50 border-b border-slate-200 text-[11px] text-slate-700 flex flex-wrap items-center gap-x-4 gap-y-1 no-print print:hidden">
          {isExame && (
            <>
              <span className="font-bold text-[#0b1f3a] uppercase">Classe de Exame</span>
              {isKeySubject ? (
                <span className="px-2 py-0.5 rounded-full bg-rose-50 text-[#7a0c0c] border border-rose-200 font-bold">
                  Disciplina chave — sem direito a Recurso
                </span>
              ) : (
                <span className="px-2 py-0.5 rounded-full bg-amber-50 text-amber-800 border border-amber-200 font-bold">
                  Recurso: {gradeRules.recursoMinGrade.toFixed(1)} a {(gradeRules.passingGrade - 0.1).toFixed(1)}
                </span>
              )}
            </>
          )}
          {isEJA && (
            <>
              <span className="font-bold text-[#0b1f3a] uppercase">EJA</span>
              <span>
                Subtotal = (MAC + NPT) / 2 • MT = Subtotal + AAV (0–2) + PCP (0–4) • MAC e NPT de 0 a 14
              </span>
            </>
          )}
        </div>
      )}

      <div className="overflow-x-auto print:overflow-visible">
        <table data-no-table-style className="w-full text-center text-xs border-collapse border border-slate-300 print:border-slate-400 print:text-[8pt]">
          {/* Header Rows */}
          <thead>
            <tr className="bg-[#0b1f3a] text-white font-bold uppercase text-[11px] tracking-wider border-b border-slate-700/80 print:bg-[#0b1f3a] print:text-white">
              <th rowSpan={2} className="py-2.5 px-2 w-10 border-r border-slate-600 print:border-slate-500 text-center">
                N.º
              </th>
              <th rowSpan={2} className="py-2.5 px-3 min-w-[170px] print:min-w-0 text-left border-r border-slate-600 print:border-slate-500">
                NOME COMPLETO
              </th>
              <th rowSpan={2} className="py-2.5 px-1.5 w-11 print:w-8 border-r border-slate-600 print:border-slate-500 text-center">
                Sexo
              </th>
              <th rowSpan={2} className="py-2.5 px-1.5 w-11 print:w-9 border-r border-slate-600 print:border-slate-500 text-center">
                Idade
              </th>

              {([1, 2, 3] as const).map(
                (t) =>
                  trimCount[t] > 0 && (
                    <th
                      key={`top-${t}`}
                      colSpan={trimCount[t]}
                      className={`py-2 px-1 border-r border-slate-600 print:border-slate-500 ${trimHeaderBg[t]} text-amber-300 font-extrabold tracking-wider print:text-amber-300`}
                    >
                      {trimLabel[t]}
                    </th>
                  )
              )}

              <th colSpan={finalCols} className="py-2 px-1 bg-[#7a0c0c] text-white font-extrabold tracking-wider print:bg-[#7a0c0c] print:text-white">
                {isExame ? 'CLASSIFICAÇÃO FINAL E EXAMES' : 'CLASSIFICAÇÃO FINAL'}
              </th>
            </tr>

            <tr className="bg-[#122c50] text-slate-200 font-bold uppercase text-[10px] tracking-wide border-b border-slate-700 print:bg-[#122c50] print:text-slate-200">
              {([1, 2, 3] as const).map((t) => visibleTrimCols(t).map((c) => subHeaderCell(c, t)))}

              {showMFD && <th className="py-1.5 px-1 border-r border-slate-600 print:border-slate-500 w-11 print:w-8 bg-[#5c0909] text-amber-300 font-black print:bg-[#5c0909] print:text-amber-300">MFD</th>}
              {showPG && <th className="py-1.5 px-1 border-r border-slate-600 print:border-slate-500 w-11 print:w-7 text-slate-200">PG</th>}
              {showCA && <th className="py-1.5 px-1 border-r border-slate-600 print:border-slate-500 w-10 print:w-7 text-rose-300 font-black">CA</th>}
              {showNEE && <th className="py-1.5 px-1 border-r border-slate-600 print:border-slate-500 w-11 print:w-7 text-slate-200" title="Nota do Exame Escrito (40%)">NEE</th>}
              {showNEO && <th className="py-1.5 px-1 border-r border-slate-600 print:border-slate-500 w-11 print:w-7 text-slate-200" title="Nota do Exame Oral">NEO</th>}
              {showMF && <th className="py-1.5 px-1 border-r border-slate-600 print:border-slate-500 w-11 print:w-8 bg-[#5c0909] text-amber-300 font-black print:bg-[#5c0909] print:text-amber-300" title="MF = MFD×60% + Exame×40%">MF</th>}
              {showNER && <th className="py-1.5 px-1 border-r border-slate-600 print:border-slate-500 w-11 print:w-7 text-rose-300 font-black" title="Nota do Exame de Recurso">NER</th>}
              <th className="py-1.5 px-2 min-w-[90px] print:min-w-0 text-left text-slate-200 font-bold">Resultado Final</th>
            </tr>
          </thead>

          <tbody className="divide-y divide-slate-200 print:divide-slate-300">
            {shownRows.length === 0 && (
              <tr>
                <td colSpan={20} className="py-8 text-center text-slate-400 text-xs">Nenhum aluno para mostrar com os filtros actuais.</td>
              </tr>
            )}
            {shownRows.map(({ row, index: idx, displayNum }, pos) => {
              const isDesistente = row.isDesistente;
              const isDebtor = row.isDebtor;
              const fin = 'border-r border-slate-200 print:border-slate-300 text-center';

              return (
                <tr
                  key={row.id || idx}
                  className={`border-b border-slate-200 print:border-slate-300 transition-colors ${
                    isDesistente
                      ? 'bg-slate-100/80 text-slate-400 italic print:bg-slate-100'
                      : row.isTransferido
                      ? 'bg-violet-50/50 print:bg-white'
                      : pos % 2 === 1
                      ? 'bg-[#f8fafc] hover:bg-sky-50/40'
                      : 'bg-white hover:bg-sky-50/40'
                  }`}
                >
                  <td className="py-1.5 px-2 font-mono font-bold text-slate-600 border-r border-slate-200 print:border-slate-300 print:text-black text-center">
                    {displayNum}
                  </td>
                  <td className="py-1.5 px-3 text-left border-r border-slate-200 print:border-slate-300">
                    <span className="font-semibold text-slate-900 tracking-tight text-xs print:text-[8pt] print:text-black">
                      {row?.name || 'Aluno'}
                    </span>
                  </td>
                  <td className="py-1.5 px-1 font-bold text-slate-700 border-r border-slate-200 print:border-slate-300 print:text-black text-center">
                    {row.gender}
                  </td>
                  <td className="py-1.5 px-1 font-mono font-bold text-slate-700 border-r border-slate-200 print:border-slate-300 print:text-black text-center">
                    {row.age}
                  </td>

                  {([1, 2, 3] as const).map((t) => visibleTrimCols(t).map((c) => bodyCell(row, idx, c, t)))}

                  {showMFD && (
                    <td className={`py-1.5 px-1 ${fin} bg-rose-50/60 font-mono font-black print:bg-rose-50/60`}>
                      {renderGradeValue(row.mfd, isDebtor, isDesistente, true)}
                    </td>
                  )}
                  {showPG && (
                    <td className={`py-1 px-1 ${fin}`}>{renderEditableCell('pg', row.pg, idx, isDebtor, isDesistente)}</td>
                  )}
                  {showCA && (
                    <td className={`py-1.5 px-1 ${fin} font-bold`}>{renderGradeValue(row.ca, isDebtor, isDesistente, true)}</td>
                  )}
                  {showNEE && (
                    <td className={`py-1 px-1 ${fin}`}>{renderEditableCell('nee', row.nee, idx, isDebtor, isDesistente)}</td>
                  )}
                  {showNEO && (
                    <td className={`py-1 px-1 ${fin}`}>{renderEditableCell('neo', row.neo, idx, isDebtor, isDesistente)}</td>
                  )}
                  {showMF && (
                    <td className={`py-1.5 px-1 ${fin} bg-rose-50/60 font-mono font-black print:bg-rose-50/60`}>
                      {renderGradeValue(row.mf, isDebtor, isDesistente, true)}
                    </td>
                  )}
                  {showNER && (
                    <td className={`py-1 px-1 ${fin}`}>
                      {isKeySubject ? hiddenDash() : renderEditableCell('ner', row.ner, idx, isDebtor, isDesistente)}
                    </td>
                  )}

                  <td className="py-1.5 px-2 text-left print:border-slate-300">{renderObs(row)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Local, data de emissão e assinaturas (Professor e Subdirector Pedagógico) */}
      <div className="p-6 bg-slate-50/70 border-t border-slate-200 print:bg-white print:border-0 print:p-3 print-break-avoid">
        <div className="text-center text-xs font-bold mb-8 print:text-[10px] print:mb-6">{header.placeAndDate}</div>
        <div className="flex justify-between text-center text-xs print:text-[9px]">
          <div className="flex flex-col items-center">
            <span className="font-bold text-slate-900 print:text-black">O/A Professor/a</span>
            <div className="w-56 border-b border-slate-500 mt-6 mb-1 print:border-black print:w-48" />
            <span className="text-slate-700 print:text-black font-semibold">{teacherName || activeSubject?.coordinatorName || ''}</span>
          </div>
          <div className="flex flex-col items-center">
            <span className="font-bold text-slate-900 print:text-black">O/A Subdirector/a Pedagógico/a</span>
            <div className="w-56 border-b border-slate-500 mt-6 mb-1 print:border-black print:w-48" />
            <span className="text-slate-700 print:text-black font-semibold">
              {institution?.directorPedagogico || institution?.directorGeral || ''}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
};
