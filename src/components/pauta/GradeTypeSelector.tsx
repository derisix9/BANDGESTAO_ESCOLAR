import React from 'react';
import { Lock } from 'lucide-react';
import { GradeTypeKey, ALL_GRADE_TYPES, GRADE_TYPES_BY_REGIME } from '../../types/pauta';
import type { PautaRegime } from '../../utils/pautaCalculations';
import { isMiniPautaLocked, PAUTA_TOGGLEABLE_TYPES } from '../../utils/pautaView';

/** Na Pauta só estas colunas aparecem como opção: MT1/MT2/MT3 (ocultáveis) e MFD/MF (fixas). */
const PAUTA_CHIPS: GradeTypeKey[] = ['MT1', 'MT2', 'MT3', 'MFD', 'MF'];

interface GradeTypeSelectorProps {
  selectedTypes: Set<GradeTypeKey>;
  onToggleType: (key: GradeTypeKey) => void;
  onSelectAll: () => void;
  onSelectAveragesOnly: () => void;
  onSelectEvaluationsOnly: () => void;
  onResetDefaultMiniPauta: () => void;
  hideDebtorGrades: boolean;
  onToggleHideDebtorGrades: (val: boolean) => void;
  previewHiddenOnScreen: boolean;
  onTogglePreviewHiddenOnScreen: (val: boolean) => void;
  /** Ocultar da listagem os alunos desistentes / transferidos. */
  hideDesistentes?: boolean;
  onToggleHideDesistentes?: (val: boolean) => void;
  hideTransferidos?: boolean;
  onToggleHideTransferidos?: (val: boolean) => void;
  /** Quantos desistentes/transferidos há na turma (mostrado ao lado de cada opção). */
  desistentesCount?: number;
  transferidosCount?: number;
  activeTab: 'minipauta' | 'pauta';
  /** Regime de avaliação da classe: só os tipos de nota que existem nele são oferecidos. */
  regime?: PautaRegime;
}

export const GradeTypeSelector: React.FC<GradeTypeSelectorProps> = ({
  selectedTypes,
  onToggleType,
  hideDebtorGrades,
  onToggleHideDebtorGrades,
  previewHiddenOnScreen,
  onTogglePreviewHiddenOnScreen,
  hideDesistentes = false,
  onToggleHideDesistentes,
  hideTransferidos = false,
  onToggleHideTransferidos,
  desistentesCount = 0,
  transferidosCount = 0,
  regime = 'transicao',
  activeTab,
}) => {
  const allowed = new Set<GradeTypeKey>(GRADE_TYPES_BY_REGIME[regime]);
  const isPauta = activeTab === 'pauta';
  // Pauta: só MT1, MT2 e MT3 se podem desmarcar (ocultar), MFD e MF ficam sempre.
  // Mini-Pauta: todas as avaliações do regime; MT1, MT2, MT3 e MFD ficam sempre marcadas.
  const visibleTypes = isPauta
    ? ALL_GRADE_TYPES.filter((gt) => PAUTA_CHIPS.includes(gt.key) && allowed.has(gt.key))
    : ALL_GRADE_TYPES.filter((gt) => allowed.has(gt.key));
  const isLocked = (key: GradeTypeKey) =>
    isPauta ? !PAUTA_TOGGLEABLE_TYPES.includes(key as (typeof PAUTA_TOGGLEABLE_TYPES)[number]) : isMiniPautaLocked(key);
  const allMtHidden = isPauta && !selectedTypes.has('MT1') && !selectedTypes.has('MT2') && !selectedTypes.has('MT3');
  return (
    <div className="bg-white p-3.5 rounded-xl border border-slate-200 shadow-2xs mb-4 no-print print:hidden">
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
        {/* Grade Column Filter Chips */}
        <div className="flex-1">
          <div className="flex flex-wrap gap-1.5">
            {visibleTypes.map((gt) => {
              const locked = isLocked(gt.key);
              // Colunas fixas aparecem sempre marcadas.
              const isSelected = locked ? true : selectedTypes.has(gt.key);
              return (
                <button
                  key={gt.key}
                  type="button"
                  disabled={locked}
                  aria-disabled={locked}
                  onClick={() => {
                    if (!locked) onToggleType(gt.key);
                  }}
                  title={
                    locked
                      ? `${gt.key}: ${gt.description} — coluna fixa, não pode ser desmarcada`
                      : `${gt.key}: ${gt.description}`
                  }
                  className={`px-2.5 py-1 text-xs font-bold rounded-lg border transition-all flex items-center gap-1.5 ${
                    locked ? 'cursor-not-allowed opacity-80' : 'cursor-pointer'
                  } ${
                    isSelected
                      ? 'bg-[#0b1f3a] text-white border-[#0b1f3a] shadow-2xs'
                      : 'bg-slate-50 text-slate-500 border-slate-200 hover:bg-slate-100 hover:border-slate-300'
                  }`}
                >
                  {locked ? (
                    <Lock className="w-3 h-3 text-amber-400" aria-hidden="true" />
                  ) : (
                    <span
                      className={`w-3 h-3 rounded-full flex items-center justify-center text-[8px] ${
                        isSelected ? 'bg-amber-400 text-slate-900 font-black' : 'bg-slate-300 text-slate-600'
                      }`}
                    >
                      {isSelected ? '✓' : ''}
                    </span>
                  )}
                  <span>{gt.label}</span>
                </button>
              );
            })}
          </div>
        </div>

        {/* Debtor Students Retention Options */}
        <div className="lg:border-l lg:border-slate-200 lg:pl-4 flex flex-col justify-center gap-2 min-w-[280px]">
     <div className="flex flex-col space-y-2"> 
  {/* Checkbox 1: Ocultar Devedores */}
  <label className="flex items-center gap-2 cursor-pointer text-xs font-semibold text-slate-800 select-none">
    <input 
      type="checkbox" 
      checked={hideDebtorGrades} 
      onChange={(e) => onToggleHideDebtorGrades(e.target.checked)} 
      className="w-4 h-4 rounded text-[#7a0c0c] border-slate-300 focus:ring-[#7a0c0c]" 
    />
    <span>Ocultar Notas dos Devedores</span>
  </label>

  {/* Sub-checkbox condicional: Pré-visualizar notas ocultas */}
  {hideDebtorGrades && (
    <label className="flex items-center gap-2 cursor-pointer text-[11px] font-medium text-slate-600 pl-6 select-none">
      <input 
        type="checkbox" 
        checked={previewHiddenOnScreen} 
        onChange={(e) => onTogglePreviewHiddenOnScreen(e.target.checked)} 
        className="w-3.5 h-3.5 rounded text-amber-600 border-slate-300 focus:ring-amber-500" 
      />
      <span className="text-amber-800 font-semibold">Pré-visualizar notas ocultas</span>
    </label>
  )}

  {/* Checkbox 2: Ocultar alunos desistentes */}
  {onToggleHideDesistentes && (
    <label className="flex items-center gap-2 cursor-pointer text-xs font-semibold text-slate-800 select-none">
      <input 
        type="checkbox" 
        checked={hideDesistentes} 
        onChange={(e) => onToggleHideDesistentes(e.target.checked)} 
        className="w-4 h-4 rounded text-[#7a0c0c] border-slate-300 focus:ring-[#7a0c0c]" 
      />
      <span>Ocultar alunos desistentes ({desistentesCount})</span>
    </label>
  )}

  {/* Checkbox 3: Ocultar alunos transferidos */}
  {onToggleHideTransferidos && (
    <label className="flex items-center gap-2 cursor-pointer text-xs font-semibold text-slate-800 select-none">
      <input 
        type="checkbox" 
        checked={hideTransferidos} 
        onChange={(e) => onToggleHideTransferidos(e.target.checked)} 
        className="w-4 h-4 rounded text-[#7a0c0c] border-slate-300 focus:ring-[#7a0c0c]" 
    />
    <span>Ocultar alunos transferidos ({transferidosCount})</span>
  </label>
  )}

</div>
        </div>
      </div>
    </div>
  );
};
