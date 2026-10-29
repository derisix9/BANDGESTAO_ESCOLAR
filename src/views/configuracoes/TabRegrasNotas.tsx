import React, { useState } from 'react';
import { InstitutionSettings, UserRole } from '../../types';
import { dbService } from '../../services/db';
import { showAppAlert, showOperationSuccess } from '../../context/OperationContext';


interface TabRegrasNotasProps {
  settings: InstitutionSettings;
  currentUserRole?: UserRole;
  onUpdateSettings?: (newSettings: Partial<InstitutionSettings>) => void;
  onSaveAll: (options?: { loadingMessage?: string; successMessage?: string; requiredRule?: string }) => void;
  registerCommit?: (commit: (() => Partial<InstitutionSettings>) | null) => void;
}

export const TabRegrasNotas: React.FC<TabRegrasNotasProps> = ({ settings, currentUserRole, onUpdateSettings, onSaveAll, registerCommit }) => {
  const initialRules = (settings.gradeRules as any) || {};

  const [macPeso, setMacPeso] = useState<number>(initialRules.macWeight ?? 30);
  const [ppPeso, setPpPeso] = useState<number>(initialRules.ppWeight ?? 30);
  const [ptPeso, setPtPeso] = useState<number>(initialRules.ptWeight ?? 40);

  const [notaAprovacao, setNotaAprovacao] = useState<number>(initialRules.passingGrade ?? 10.0);
  const [notaRecursoMin, setNotaRecursoMin] = useState<number>(initialRules.recursoMinGrade ?? 7.0);
  const [dispensaExameVal, setDispensaExameVal] = useState<number>(initialRules.examWaiverGrade ?? 14.0);
  const [bloqueioFracionario, setBloqueioFracionario] = useState<boolean>(initialRules.strictDecimal ?? true);
  const [arredondamentoOficial, setArredondamentoOficial] = useState<boolean>(initialRules.roundHalfUp ?? true);
  const [maxNeg6e9, setMaxNeg6e9] = useState<number>(initialRules.maxNegativasRecurso6e9 ?? 2);
  const [maxNeg12e13, setMaxNeg12e13] = useState<number>(initialRules.maxNegativasRecurso12e13 ?? 4);
  const [maxFaltas, setMaxFaltas] = useState<number>(initialRules.maxAbsencePercent ?? 25);

  const totalPeso = macPeso + ppPeso + ptPeso;
  const isPesoValido = totalPeso === 100;

  const handleReporPadraoMED = () => {
    setMacPeso(30);
    setPpPeso(30);
    setPtPeso(40);
    setNotaAprovacao(10.0);
    setNotaRecursoMin(7.0);
    setDispensaExameVal(14.0);
    setBloqueioFracionario(true);
    setArredondamentoOficial(true);
    setMaxNeg6e9(2);
    setMaxNeg12e13(4);
    setMaxFaltas(25);

    if (onUpdateSettings) {
      onUpdateSettings({
        gradeRules: {
          macWeight: 30,
          ppWeight: 30,
          ptWeight: 40,
          passingGrade: 10.0,
          recursoMinGrade: 7.0,
          examWaiverGrade: 14.0,
          strictDecimal: true,
          roundHalfUp: true,
          maxNegativasRecurso6e9: 2,
          maxNegativasRecurso12e13: 4,
          maxAbsencePercent: 25
        }
      });
    }

    void showOperationSuccess('Parâmetros restaurados!', { details: 'Norma oficial MED de Angola: MAC 30%, PP 30%, PT 40%.' });
  };

  // Alterações pendentes, recolhidas pelo botão principal "Guardar Alterações".
  const buildPendingSettings = React.useCallback(
    (): Partial<InstitutionSettings> => ({
      gradeRules: {
        macWeight: macPeso,
        ppWeight: ppPeso,
        ptWeight: ptPeso,
        passingGrade: notaAprovacao,
        recursoMinGrade: notaRecursoMin,
        examWaiverGrade: dispensaExameVal,
        strictDecimal: bloqueioFracionario,
        roundHalfUp: arredondamentoOficial,
        maxNegativasRecurso6e9: maxNeg6e9,
        maxNegativasRecurso12e13: maxNeg12e13,
        maxAbsencePercent: maxFaltas
      }
    }),
    [macPeso, ppPeso, ptPeso, notaAprovacao, notaRecursoMin, dispensaExameVal, bloqueioFracionario, arredondamentoOficial, maxNeg6e9, maxNeg12e13, maxFaltas]
  );

  React.useEffect(() => {
    const commit = () => {
      if (!isPesoValido) {
        showAppAlert(
          `A soma dos pesos da Média Trimestral deve ser exatamente 100%. O valor atual é de ${totalPeso}%.`,
          { title: 'Atenção', variant: 'warning' }
        );
        return {};
      }
      dbService.addAuditLog({
        userName: '',
        userRole: 'Diretor Pedagógico',
        action: 'Atualização do Regulamento de Notas',
        details: `Pesos ajustados para MAC (${macPeso}%), PP (${ppPeso}%), PT (${ptPeso}%). Dispensa: ${dispensaExameVal} val.`,
        module: 'pautas',
        timestamp: '',
        badgeColor: '#0b1f3a'
      });
      return buildPendingSettings();
    };
    registerCommit?.(commit);
    return () => registerCommit?.(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [registerCommit, buildPendingSettings, isPesoValido, totalPeso, macPeso, ppPeso, ptPeso, dispensaExameVal]);

  return (
    <div className="flex flex-col gap-6">
      {/* Top Header */}
      <div className="p-6 rounded-2xl bg-white border border-slate-200 shadow-xs flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="w-11 h-11 rounded-xl bg-slate-100 flex items-center justify-center text-[#0b1f3a] shrink-0">
            <span className="material-symbols-outlined text-[26px]">rule</span>
          </div>
          <div>
            <div className="flex items-center gap-2">
              <span className="text-[11px] uppercase tracking-wider text-[#ac332b] font-bold">Módulo 04</span>
              <span className="w-1 h-1 rounded-full bg-slate-300" />
              <span className="text-[11px] text-slate-500 font-medium">REGRAS DE NOTAS</span>
            </div>
            <h2 className="font-headline text-lg lg:text-xl font-bold text-slate-900">
              Regulamento de Avaliação e Escala de Notas
            </h2>
          </div>
        </div>

        <span className="px-3 py-1.5 rounded-full bg-slate-100 text-slate-800 font-mono text-xs font-bold self-start">
          0 — 20 VALORES
        </span>
      </div>

      {/* Bloco 1: Escala Numérica Oficial */}
      <section className="bg-white p-6 rounded-2xl border border-slate-200 shadow-xs flex flex-col gap-4">
        <div className="flex items-center justify-between pb-3 border-b border-slate-100">
          <div>
            <h3 className="font-headline text-base lg:text-lg font-bold text-slate-900">
              1. Escala Numérica
            </h3>
            <p className="text-xs text-slate-500">
              Intervalos de transição, condições de recurso e regras matemáticas de arredondamento de pauta.
            </p>
          </div>
          <span className="material-symbols-outlined text-[#ac332b] text-[22px]">verified</span>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <div className="p-4 rounded-xl bg-slate-50 border border-slate-100 flex flex-col justify-between">
            <div>
              <span className="text-[10px] font-bold text-emerald-800 uppercase tracking-wider">
                Transição Direta
              </span>
              <div className="flex items-center gap-1 mt-1">
                <input
                  type="number"
                  step="0.5"
                  min="9"
                  max="15"
                  value={notaAprovacao}
                  onChange={(e) => setNotaAprovacao(parseFloat(e.target.value) || 10)}
                  className="w-16 px-2 py-1 bg-white border border-slate-300 rounded-lg font-headline text-xl font-extrabold text-slate-900 text-center outline-none focus:ring-1 focus:ring-[#0b1f3a]"
                />
                <span className="text-slate-600 font-bold text-sm">a 20</span>
              </div>
              <p className="text-xs text-slate-500 mt-2">
                Aprovado por aproveitamento curricular sem necessidade de prova de recurso.
              </p>
            </div>
            <div className="mt-3 pt-2 border-t border-slate-200 text-[11px] font-bold text-emerald-800">
              Condição: Aprovado
            </div>
          </div>

          <div className="p-4 rounded-xl bg-slate-50 border border-slate-100 flex flex-col justify-between">
            <div>
              <span className="text-[10px] font-bold text-amber-800 uppercase tracking-wider">
                Intervalo de Recurso
              </span>
              <div className="flex items-center gap-1 mt-1">
                <input
                  type="number"
                  step="0.5"
                  min="5"
                  max="9.5"
                  value={notaRecursoMin}
                  onChange={(e) => setNotaRecursoMin(parseFloat(e.target.value) || 7)}
                  className="w-16 px-2 py-1 bg-white border border-slate-300 rounded-lg font-headline text-xl font-extrabold text-slate-900 text-center outline-none focus:ring-1 focus:ring-[#0b1f3a]"
                />
                <span className="text-slate-600 font-bold text-sm">a {(notaAprovacao - 0.1).toFixed(1)}</span>
              </div>
              <p className="text-xs text-slate-500 mt-2">
                Só nas classes de exame (6.ª, 9.ª, 12.ª e 13.ª) e fora das disciplinas chave. Nas classes de transição não há recurso.
              </p>
              <div className="mt-2 space-y-1.5 text-[11px] text-slate-700">
                <label className="flex items-center justify-between gap-2">
                  <span>Máx. negativas — 6.ª e 9.ª</span>
                  <input
                    type="number"
                    min={0}
                    max={20}
                    value={maxNeg6e9}
                    onChange={(e) => setMaxNeg6e9(Math.max(0, parseInt(e.target.value, 10) || 0))}
                    className="w-14 px-1.5 py-0.5 bg-white border border-slate-300 rounded-lg font-bold text-center outline-none focus:ring-1 focus:ring-[#0b1f3a]"
                  />
                </label>
                <label className="flex items-center justify-between gap-2">
                  <span>Máx. negativas — 12.ª e 13.ª</span>
                  <input
                    type="number"
                    min={0}
                    max={20}
                    value={maxNeg12e13}
                    onChange={(e) => setMaxNeg12e13(Math.max(0, parseInt(e.target.value, 10) || 0))}
                    className="w-14 px-1.5 py-0.5 bg-white border border-slate-300 rounded-lg font-bold text-center outline-none focus:ring-1 focus:ring-[#0b1f3a]"
                  />
                </label>
                <label className="flex items-center justify-between gap-2">
                  <span>Máx. faltas injustificadas (%) — conselho</span>
                  <input
                    type="number"
                    min={1}
                    max={100}
                    value={maxFaltas}
                    onChange={(e) => setMaxFaltas(Math.min(100, Math.max(1, parseInt(e.target.value, 10) || 25)))}
                    className="w-14 px-1.5 py-0.5 bg-white border border-slate-300 rounded-lg font-bold text-center outline-none focus:ring-1 focus:ring-[#0b1f3a]"
                  />
                </label>
              </div>
            </div>
            <div className="mt-3 pt-2 border-t border-slate-200 text-[11px] font-bold text-amber-800">
              Condição: Exame de Recurso
            </div>
          </div>

          <div className="p-4 rounded-xl bg-slate-50 border border-slate-100 flex flex-col justify-between">
            <div>
              <span className="text-[10px] font-bold text-[#ac332b] uppercase tracking-wider">
                Reprovação Direta
              </span>
              <div className="font-headline text-2xl font-extrabold text-[#ac332b] mt-1">
                &lt; {notaRecursoMin.toFixed(1)}
              </div>
              <p className="text-xs text-slate-500 mt-2">
                Retenção automática no ano letivo. Sem direito a realização de prova de recurso.
              </p>
            </div>
            <div className="mt-3 pt-2 border-t border-slate-200 text-[11px] font-bold text-[#ac332b]">
              Condição: Reprovado
            </div>
          </div>

          <div className="p-4 rounded-xl bg-slate-50 border border-slate-100 flex flex-col justify-between">
            <div>
              <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">
                Arredondamento
              </span>
              <div className="flex items-center justify-between mt-1">
                <span className="font-headline text-2xl font-extrabold text-[#0b1f3a]">&gt;= 0.50</span>
                <button
                  type="button"
                  onClick={() => setArredondamentoOficial(!arredondamentoOficial)}
                  className={`w-9 h-5 rounded-full transition-colors relative cursor-pointer ${
                    arredondamentoOficial ? 'bg-[#0b1f3a]' : 'bg-slate-300'
                  }`}
                >
                  <div
                    className={`w-3.5 h-3.5 rounded-full bg-white transition-transform absolute top-0.5 ${
                      arredondamentoOficial ? 'right-0.5' : 'left-0.5'
                    }`}
                  />
                </button>
              </div>
              <p className="text-xs text-slate-500 mt-2">
                Médias com centésimas superiores ou iguais a 0.50 arredondam para o valor inteiro acima (ex: 9.5 &rarr; 10).
              </p>
            </div>
            <div className="mt-3 pt-2 border-t border-slate-200 text-[11px] font-mono font-bold text-slate-700">
              {arredondamentoOficial ? 'Ativado' : 'Desativado'}
            </div>
          </div>
        </div>

        {/* Toggle Fracionário */}
        <div className="p-4 rounded-xl bg-slate-50 border border-slate-100 flex items-center justify-between">
          <div className="flex flex-col">
            <span className="font-bold text-slate-800 text-xs">Bloqueio Rigoroso de Inserção Fracionária</span>
            <span className="text-[11px] text-slate-500 mt-0.5">
              Impede que professores lancem notas com mais de uma casa decimal (aceita apenas formato ex: 14.5 ou 15.0).
            </span>
          </div>
          <button
            type="button"
            onClick={() => setBloqueioFracionario(!bloqueioFracionario)}
            className={`w-11 h-6 rounded-full transition-colors relative cursor-pointer shrink-0 ${
              bloqueioFracionario ? 'bg-[#0b1f3a]' : 'bg-slate-300'
            }`}
          >
            <div
              className={`w-4 h-4 rounded-full bg-white transition-transform absolute top-1 ${
                bloqueioFracionario ? 'right-1' : 'left-1'
              }`}
            />
          </button>
        </div>
      </section>

      {/* Bloco 2: Fórmula e Composição da Média Trimestral (MT) */}
      <section className="bg-white p-6 rounded-2xl border border-slate-200 shadow-xs flex flex-col gap-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 pb-3 border-b border-slate-100">
          <div>
            <h3 className="font-headline text-base lg:text-lg font-bold text-slate-900">
              2. Fórmula da Média Trimestral
            </h3>
            <p className="text-xs text-slate-500">
              Ponderação percentual regulamentada para cálculo automático das notas em todas as cadernetas.
            </p>
          </div>
      
        </div>

        {/* Validation bar */}
        <div
          className={`p-3 rounded-xl flex items-center justify-between text-xs font-bold ${
            isPesoValido
              ? 'bg-emerald-50 text-emerald-800 border border-emerald-200'
              : 'bg-red-50 text-red-800 border border-red-200'
          }`}
        >
          <div className="flex items-center gap-2">
            <span className="material-symbols-outlined text-[18px]">
              {isPesoValido ? 'check_circle' : 'warning'}
            </span>
            <span>
              Soma total das ponderações: <strong>{totalPeso}%</strong>
            </span>
          </div>
          {!isPesoValido && (
            <span className="text-[11px] font-normal">
              Ajuste os valores para que a soma seja exatamente 100%.
            </span>
          )}
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {/* MAC */}
          <div className="p-4 rounded-xl bg-slate-50 border border-slate-100 flex flex-col gap-3">
            <div className="flex items-center justify-between">
              <span className="font-headline font-bold text-slate-900 text-sm">
                MAC
              </span>
              <div className="flex items-center gap-1">
                <input
                  type="number"
                  min="0"
                  max="100"
                  value={macPeso}
                  onChange={(e) => setMacPeso(parseInt(e.target.value) || 0)}
                  className="w-14 px-2 py-1 text-center font-bold bg-white border border-slate-300 rounded-lg text-slate-900"
                />
                <span className="font-bold text-slate-700 text-xs">%</span>
              </div>
            </div>
            <p className="text-xs text-slate-500">
              MÉDIA DAS AVALIAÇÕES CONTINUA
            </p>
          
          </div>

          {/* PP */}
          <div className="p-4 rounded-xl bg-slate-50 border border-slate-100 flex flex-col gap-3">
            <div className="flex items-center justify-between">
              <span className="font-headline font-bold text-slate-900 text-sm">
                NPP
              </span>
              <div className="flex items-center gap-1">
                <input
                  type="number"
                  min="0"
                  max="100"
                  value={ppPeso}
                  onChange={(e) => setPpPeso(parseInt(e.target.value) || 0)}
                  className="w-14 px-2 py-1 text-center font-bold bg-white border border-slate-300 rounded-lg text-slate-900"
                />
                <span className="font-bold text-slate-700 text-xs">%</span>
              </div>
            </div>
            <p className="text-xs text-slate-500">
             NOTA DA PROVA DO PROFESSOR</p>
          </div>

          {/* PT */}
          <div className="p-4 rounded-xl bg-slate-50 border border-slate-100 flex flex-col gap-3">
            <div className="flex items-center justify-between">
              <span className="font-headline font-bold text-slate-900 text-sm">
                NPT
              </span>
              <div className="flex items-center gap-1">
                <input
                  type="number"
                  min="0"
                  max="100"
                  value={ptPeso}
                  onChange={(e) => setPtPeso(parseInt(e.target.value) || 0)}
                  className="w-14 px-2 py-1 text-center font-bold bg-white border border-slate-300 rounded-lg text-slate-900"
                />
                <span className="font-bold text-slate-700 text-xs">%</span>
              </div>
            </div>
            <p className="text-xs text-slate-500">
              NOTA DA PROVA TRIMESTRAL
            </p>
          
          </div>
        </div>
      </section>

      {/* Bloco 3: Regras de Exame Final e Dispensa */}
      <section className="bg-white p-6 rounded-2xl border border-slate-200 shadow-xs flex flex-col gap-4">
        <div className="pb-3 border-b border-slate-100">
          <h3 className="font-headline text-base lg:text-lg font-bold text-slate-900">
            3. Regime de Dispensa de Exame
          </h3>
          <p className="text-xs text-slate-500">
            Critérios para atribuição de dispensa automática de exame.
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="p-4 rounded-xl bg-slate-50 border border-slate-100 flex flex-col justify-between gap-2">
            <div>
              <span className="font-bold text-slate-800 uppercase tracking-wider text-[11px]">
                Mínimo para Dispensa de Exame
              </span>
              <div className="flex items-baseline gap-2 mt-2">
                <span className="font-headline text-lg font-bold text-slate-700">&gt;=</span>
                <input
                  type="number"
                  step="0.5"
                  min="10"
                  max="18"
                  value={dispensaExameVal}
                  onChange={(e) => setDispensaExameVal(parseFloat(e.target.value) || 14)}
                  className="w-20 px-2 py-1 bg-white border border-slate-300 rounded-lg font-headline text-2xl font-extrabold text-emerald-800 text-center outline-none focus:ring-1 focus:ring-[#0b1f3a]"
                />
                <span className="text-xs text-slate-500 font-semibold">Valores</span>
              </div>
            </div>
          </div>

          <div className="p-4 rounded-xl bg-slate-50 border border-slate-100 flex flex-col justify-between gap-2">
            <div>
              <span className="font-bold text-slate-800 uppercase tracking-wider text-[11px]">
                Classificação Final de Alunos em Exame
              </span>
              <div className="font-headline text-xl font-bold text-slate-900 mt-2 font-mono">
                (CAP × 0.40) + (Exame × 0.60)
              </div>
              <p className="text-slate-500 text-[11px] mt-2">
                Fórmula do Ministério da Educação para alunos que prestam exame de fim de ano.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* Bloco 4: Menções Qualitativas */}
      <section className="bg-white p-6 rounded-2xl border border-slate-200 shadow-xs flex flex-col gap-4">
        <div className="pb-3 border-b border-slate-100">
          <h3 className="font-headline text-base lg:text-lg font-bold text-slate-900">
            4. Menções Qualitativas do Boletim
          </h3>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead>
              <tr className="bg-[#0b1f3a] text-white uppercase tracking-wider font-bold border-b border-slate-800 text-[11px]">
                <th className="py-3 px-4 rounded-l-lg">Intervalo Numérico</th>
                <th className="py-3 px-4">Menção Qualitativa</th>
                <th className="py-3 px-4">Efeito Curricular</th>
                <th className="py-3 px-4 text-right rounded-r-lg">Estatuto de Pauta</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 text-slate-700">
              <tr className="hover:bg-slate-50/80 transition-colors">
                <td className="py-3 px-4 font-mono font-bold text-slate-900">19 — 20</td>
                <td className="py-3 px-4 font-bold text-[#0b1f3a]">Excelente</td>
                <td className="py-3 px-4 text-slate-600">Menção de Louvor & Quadro de Honra Institucional</td>
                <td className="py-3 px-4 text-right">
                  <span className="px-2 py-0.5 rounded bg-blue-50 text-[#0b1f3a] font-bold text-[11px]">
                    Louvor
                  </span>
                </td>
              </tr>
              <tr className="hover:bg-slate-50/80 transition-colors">
                <td className="py-3 px-4 font-mono font-bold text-slate-900">16 — 18</td>
                <td className="py-3 px-4 font-bold text-emerald-800">Muito Bom</td>
                <td className="py-3 px-4 text-slate-600">Aprovado com Mérito Académico</td>
                <td className="py-3 px-4 text-right">
                  <span className="px-2 py-0.5 rounded bg-emerald-50 text-emerald-800 font-bold text-[11px]">
                    Aprovado
                  </span>
                </td>
              </tr>
              <tr className="hover:bg-slate-50/80 transition-colors">
                <td className="py-3 px-4 font-mono font-bold text-slate-900">14 — 15</td>
                <td className="py-3 px-4 font-bold text-slate-800">Bom</td>
                <td className="py-3 px-4 text-slate-600">Aprovado Satisfatoriamente</td>
                <td className="py-3 px-4 text-right">
                  <span className="px-2 py-0.5 rounded bg-slate-100 text-slate-700 font-bold text-[11px]">
                    Aprovado
                  </span>
                </td>
              </tr>
              <tr className="hover:bg-slate-50/80 transition-colors">
                <td className="py-3 px-4 font-mono font-bold text-slate-900">10 — 13</td>
                <td className="py-3 px-4 font-bold text-slate-800">Suficiente</td>
                <td className="py-3 px-4 text-slate-600">Transita de Ano no Limiar Mínimo</td>
                <td className="py-3 px-4 text-right">
                  <span className="px-2 py-0.5 rounded bg-slate-100 text-slate-700 font-bold text-[11px]">
                    Transita
                  </span>
                </td>
              </tr>
              <tr className="hover:bg-slate-50/80 transition-colors">
                <td className="py-3 px-4 font-mono font-bold text-[#ac332b]">0 — 9</td>
                <td className="py-3 px-4 font-bold text-[#ac332b]">Insuficiente</td>
                <td className="py-3 px-4 text-slate-600">Encaminhado para Recurso ou Retenção</td>
                <td className="py-3 px-4 text-right">
                  <span className="px-2 py-0.5 rounded bg-red-50 text-[#ac332b] font-bold text-[11px]">
                    Recurso / Reprova
                  </span>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>

      {/* Bloco 5: Ações e Botão Guardar */}
      <div className="p-6 rounded-2xl bg-white border border-slate-200 shadow-xs flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h4 className="font-bold text-slate-900 text-sm">
            Políticas de Trancamento & Retificação de Pautas
          </h4>
          <p className="text-xs text-slate-500 mt-0.5">
            Retificações administrativas só são permitidas durante 7 dias úteis após afixação e exigem parecer da Direção Pedagógica.
          </p>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          <button
            type="button"
            onClick={handleReporPadraoMED}
            className="px-3.5 py-2 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-800 font-bold text-xs transition-colors cursor-pointer"
          >
            Repor Padrão
          </button>
        </div>
      </div>
    </div>
  );
};
