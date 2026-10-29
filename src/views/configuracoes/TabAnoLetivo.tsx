import React, { useState } from 'react';
import { InstitutionSettings, UserRole } from '../../types';
import { dbService } from '../../services/db';
import { runGlobalOperation } from '../../context/OperationContext';
import { getFallbackAcademicYear, getDefaultAngolaHolidays } from '../../utils/academicYear';
import {
  anyDateToIso,
  isoToPtDate,
  countSchoolWeeks,
  formatWeeksLabel,
  formatPeriodRange,
  parsePeriodRange,
  defaultPeriodForAcademicYear,
  nextAcademicYearLabel,
  resolveActiveTrimester
} from '../../utils/academicCalendar';
import { TablePagination, usePagedList } from '../../components/TablePagination';
import { Notice } from '../../components/Notice';

interface TabAnoLetivoProps {
  settings: InstitutionSettings;
  currentUserRole?: UserRole;
  onUpdateSettings?: (newSettings: Partial<InstitutionSettings>) => void;
  onSaveAll: (options?: { loadingMessage?: string; successMessage?: string; requiredRule?: string }) => void;
  registerCommit?: (commit: (() => Partial<InstitutionSettings>) | null) => void;
}

const DEFAULT_PAUSAS = [
  { id: 1, desc: 'Pausa de Fim de Ano & Natal', periodo: '14 Dez 2024 — 05 Jan 2025', dias: '22 Dias' },
  { id: 2, desc: 'Interrupção de Carnaval', periodo: '03 Mar 2025 — 05 Mar 2025', dias: '3 Dias' },
  { id: 3, desc: 'Pausa Pedagógica da Páscoa', periodo: '12 Abr 2025 — 27 Abr 2025', dias: '16 Dias' },
  { id: 4, desc: 'Férias Maiores (Verão Académico)', periodo: '01 Ago 2025 — 31 Ago 2025', dias: '31 Dias' }
];

export const TabAnoLetivo: React.FC<TabAnoLetivoProps> = ({ settings, currentUserRole, onUpdateSettings, onSaveAll, registerCommit }) => {
  // O Trimestre em curso NÃO é escolhido à mão: resulta das datas de início e
  // término definidas no calendário. Assim que um trimestre termina, o dia
  // seguinte já pertence ao trimestre seguinte.
  const currentTrimester =
    resolveActiveTrimester(settings.trimesterSchedules) || settings.currentTrimester || '1';

  const [bloqueioSumarios, setBloqueioSumarios] = useState(settings.academicLockingRules?.bloqueioSumarios ?? true);
  const [toleranciaNotas, setToleranciaNotas] = useState(settings.academicLockingRules?.toleranciaNotas ?? true);
  const [chaveFecho, setChaveFecho] = useState(settings.academicLockingRules?.chaveFecho ?? true);
  const [toleranciaSumariosHoras, setToleranciaSumariosHoras] = useState(
    settings.academicLockingRules?.toleranciaSumariosHoras ?? 48
  );
  const [janelaLancamentoNotasDias, setJanelaLancamentoNotasDias] = useState(
    settings.academicLockingRules?.janelaLancamentoNotasDias ?? 5
  );
  const [showAddPauseModal, setShowAddPauseModal] = useState(false);
  const [showCloseTrimesterModal, setShowCloseTrimesterModal] = useState(false);

  // Período de Atividade do Ano Letivo, definido no calendário (duas datas). As
  // Semanas Letivas deixam de ser escritas à mão: são sempre calculadas a partir
  // deste intervalo.
  const storedPeriod = parsePeriodRange(settings.academicPeriod);
  const initialPeriodStartIso = anyDateToIso(settings.academicPeriodStartIso) || storedPeriod.startIso;
  const initialPeriodEndIso = anyDateToIso(settings.academicPeriodEndIso) || storedPeriod.endIso;

  const [periodStartIso, setPeriodStartIso] = useState(initialPeriodStartIso);
  const [periodEndIso, setPeriodEndIso] = useState(initialPeriodEndIso);

  const academicPeriod = formatPeriodRange(periodStartIso, periodEndIso);
  const academicWeeksNumber = countSchoolWeeks(periodStartIso, periodEndIso);
  const academicWeeks = formatWeeksLabel(academicWeeksNumber, 'Semanas Letivas');

  const [showEditPeriodModal, setShowEditPeriodModal] = useState(false);
  const [tempPeriodStartIso, setTempPeriodStartIso] = useState(initialPeriodStartIso);
  const [tempPeriodEndIso, setTempPeriodEndIso] = useState(initialPeriodEndIso);
  const tempAcademicWeeksNumber = countSchoolWeeks(tempPeriodStartIso, tempPeriodEndIso);

  // Ano letivo seguinte, que o sistema abre sozinho quando o período acima terminar.
  const upcomingYear = nextAcademicYearLabel(settings.currentAcademicYear);
  const upcomingPeriod = defaultPeriodForAcademicYear(upcomingYear);

  // Cadastrar / Definir Ano Letivo pelo Admin
  const [showEditYearModal, setShowEditYearModal] = useState(false);
  const [newYearInput, setNewYearInput] = useState('');

  const handleOpenEditAcademicYear = () => {
    setNewYearInput(settings.currentAcademicYear || `${new Date().getFullYear()}/${new Date().getFullYear() + 1}`);
    setShowEditYearModal(true);
  };

  const handleSaveAcademicYear = async (e: React.FormEvent) => {
    e.preventDefault();
    const cleanYear = newYearInput.trim();
    if (!cleanYear) return;

    const existingYears = settings.availableAcademicYears || [];
    const updatedYears = existingYears.includes(cleanYear)
      ? existingYears
      : [...existingYears, cleanYear];

    await runGlobalOperation(
      async () => {
        dbService.setAcademicYear(cleanYear);
        if (onUpdateSettings) {
          onUpdateSettings({
            currentAcademicYear: cleanYear,
            availableAcademicYears: updatedYears
          });
        }
        dbService.updateSettings({
          currentAcademicYear: cleanYear,
          availableAcademicYears: updatedYears
        });
      },
      {
        loadingMessage: `A configurar Ano Letivo ${cleanYear}...`,
        successMessage: `Ano Letivo ${cleanYear} registado e ativado com sucesso!`
      }
    );

    setShowEditYearModal(false);
  };

  // Estrutura das datas e semanas dos 3 Trimestres definidas pelo Admin no
  // calendário. As Semanas Úteis não são escritas: resultam do intervalo.
  const buildInitialSchedule = (key: 't1' | 't2' | 't3') => {
    const stored = settings.trimesterSchedules?.[key];
    const startIso = anyDateToIso(stored?.startDateIso || stored?.startDate);
    const endIso = anyDateToIso(stored?.endDateIso || stored?.endDate);
    const weeks = countSchoolWeeks(startIso, endIso);
    return {
      startDate: isoToPtDate(startIso) || stored?.startDate || '',
      endDate: isoToPtDate(endIso) || stored?.endDate || '',
      startDateIso: startIso,
      endDateIso: endIso,
      examPeriod: stored?.examPeriod || '',
      examStartDateIso: anyDateToIso(stored?.examStartDateIso),
      examEndDateIso: anyDateToIso(stored?.examEndDateIso),
      gradesCouncilDate: stored?.gradesCouncilDate || '',
      gradesCouncilDateIso: anyDateToIso(stored?.gradesCouncilDateIso || stored?.gradesCouncilDate),
      weeksCount: weeks ? formatWeeksLabel(weeks) : stored?.weeksCount || '',
      weeksCountNumber: weeks || stored?.weeksCountNumber || 0,
      closed: stored?.closed || false,
      closedAt: stored?.closedAt,
      closedBy: stored?.closedBy
    };
  };

  const initialTrimesterSchedules = {
    t1: buildInitialSchedule('t1'),
    t2: buildInitialSchedule('t2'),
    t3: buildInitialSchedule('t3')
  };

  const [trimesterSchedules, setTrimesterSchedules] = useState(initialTrimesterSchedules);
  const [editingTrimester, setEditingTrimester] = useState<'1' | '2' | '3' | null>(null);
  const [trimForm, setTrimForm] = useState({
    startDateIso: '',
    endDateIso: '',
    examStartDateIso: '',
    examEndDateIso: '',
    gradesCouncilDateIso: ''
  });

  /** Semanas úteis do trimestre a ser editado, recalculadas a cada alteração de data. */
  const trimFormWeeks = countSchoolWeeks(trimForm.startDateIso, trimForm.endDateIso);

  const handleOpenEditPeriod = () => {
    setTempPeriodStartIso(periodStartIso);
    setTempPeriodEndIso(periodEndIso);
    setShowEditPeriodModal(true);
  };

  const handleSaveAcademicPeriod = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!tempPeriodStartIso || !tempPeriodEndIso) return;
    if (tempPeriodEndIso < tempPeriodStartIso) return;

    const periodLabel = formatPeriodRange(tempPeriodStartIso, tempPeriodEndIso);
    const weeksNumber = countSchoolWeeks(tempPeriodStartIso, tempPeriodEndIso);
    const weeksLabel = formatWeeksLabel(weeksNumber, 'Semanas Letivas');

    setPeriodStartIso(tempPeriodStartIso);
    setPeriodEndIso(tempPeriodEndIso);

    const payload = {
      academicPeriod: periodLabel,
      academicPeriodStartIso: tempPeriodStartIso,
      academicPeriodEndIso: tempPeriodEndIso,
      academicWeeks: weeksLabel,
      academicWeeksNumber: weeksNumber
    };

    await runGlobalOperation(
      async () => {
        if (onUpdateSettings) {
          onUpdateSettings(payload);
        }
        dbService.updateSettings(payload);
        dbService.syncAcademicCalendar();
      },
      {
        loadingMessage: 'A gravar período letivo e semanas...',
        successMessage: 'Período letivo atualizado com sucesso!'
      }
    );
    setShowEditPeriodModal(false);
  };

  const handleOpenEditTrimester = (trimKey: '1' | '2' | '3') => {
    const k = ('t' + trimKey) as 't1' | 't2' | 't3';
    const sched = trimesterSchedules[k];
    setTrimForm({
      startDateIso: anyDateToIso(sched.startDateIso || sched.startDate),
      endDateIso: anyDateToIso(sched.endDateIso || sched.endDate),
      examStartDateIso: anyDateToIso(sched.examStartDateIso),
      examEndDateIso: anyDateToIso(sched.examEndDateIso),
      gradesCouncilDateIso: anyDateToIso(sched.gradesCouncilDateIso || sched.gradesCouncilDate)
    });
    setEditingTrimester(trimKey);
  };

  const handleSaveTrimesterSchedule = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingTrimester) return;
    const k = ('t' + editingTrimester) as 't1' | 't2' | 't3';

    const weeks = countSchoolWeeks(trimForm.startDateIso, trimForm.endDateIso);
    const examPeriodLabel =
      trimForm.examStartDateIso && trimForm.examEndDateIso
        ? `${isoToPtDate(trimForm.examStartDateIso)} – ${isoToPtDate(trimForm.examEndDateIso)}`
        : isoToPtDate(trimForm.examStartDateIso) || '';

    const updated = {
      ...trimesterSchedules,
      [k]: {
        ...trimesterSchedules[k],
        startDate: isoToPtDate(trimForm.startDateIso),
        endDate: isoToPtDate(trimForm.endDateIso),
        startDateIso: trimForm.startDateIso,
        endDateIso: trimForm.endDateIso,
        examPeriod: examPeriodLabel,
        examStartDateIso: trimForm.examStartDateIso,
        examEndDateIso: trimForm.examEndDateIso,
        gradesCouncilDate: isoToPtDate(trimForm.gradesCouncilDateIso),
        gradesCouncilDateIso: trimForm.gradesCouncilDateIso,
        weeksCount: formatWeeksLabel(weeks),
        weeksCountNumber: weeks
      }
    };
    setTrimesterSchedules(updated);
    await runGlobalOperation(
      async () => {
        if (onUpdateSettings) {
          onUpdateSettings({ trimesterSchedules: updated });
        }
        dbService.updateSettings({ trimesterSchedules: updated });
        // Redefinir datas pode mudar qual o trimestre em curso — o sistema
        // recalcula-o de imediato, sem qualquer passo manual.
        dbService.syncAcademicCalendar();
      },
      {
        loadingMessage: `A atualizar datas e prazos do ${editingTrimester}.º Trimestre...`,
        successMessage: `Datas do ${editingTrimester}.º Trimestre atualizadas com sucesso!`
      }
    );
    setEditingTrimester(null);
  };

  const [pausas, setPausas] = useState(
    Array.isArray(settings.academicPauses)
      ? settings.academicPauses
      : (settings.schoolName ? DEFAULT_PAUSAS : [])
  );
  const { page: pgPausas, setPage: setPgPausas, pageItems: visiblePausas } = usePagedList(pausas, [pausas.length]);
  const [pauseToDelete, setPauseToDelete] = useState<{ id: number | string; desc: string; periodo: string; dias: string } | null>(null);

  const [novaPausaDesc, setNovaPausaDesc] = useState('');
  const [novaPausaPeriodo, setNovaPausaPeriodo] = useState('');
  const [novaPausaDias, setNovaPausaDias] = useState('');

  const handleToggleRule = (ruleKey: 'bloqueioSumarios' | 'toleranciaNotas' | 'chaveFecho') => {
    let newSumarios = bloqueioSumarios;
    let newNotas = toleranciaNotas;
    let newChave = chaveFecho;

    if (ruleKey === 'bloqueioSumarios') {
      newSumarios = !bloqueioSumarios;
      setBloqueioSumarios(newSumarios);
    } else if (ruleKey === 'toleranciaNotas') {
      newNotas = !toleranciaNotas;
      setToleranciaNotas(newNotas);
    } else if (ruleKey === 'chaveFecho') {
      newChave = !chaveFecho;
      setChaveFecho(newChave);
    }

    if (onUpdateSettings) {
      onUpdateSettings({
        academicLockingRules: {
          bloqueioSumarios: newSumarios,
          toleranciaNotas: newNotas,
          chaveFecho: newChave,
          toleranciaSumariosHoras,
          janelaLancamentoNotasDias
        }
      });
    }
  };

  // Atualiza os valores numéricos (horas de tolerância / dias úteis da janela) das regras
  // de trancamento e propaga de imediato para o estado partilhado das Configurações, para
  // que fiquem disponíveis a outros módulos (Assiduidade, Pautas) assim que forem gravados.
  const handleChangeToleranceHours = (value: number) => {
    const safeValue = Number.isFinite(value) ? Math.max(0, Math.round(value)) : 48;
    setToleranciaSumariosHoras(safeValue);
    onUpdateSettings?.({
      academicLockingRules: {
        bloqueioSumarios,
        toleranciaNotas,
        chaveFecho,
        toleranciaSumariosHoras: safeValue,
        janelaLancamentoNotasDias
      }
    });
  };

  const handleChangeJanelaDias = (value: number) => {
    const safeValue = Number.isFinite(value) ? Math.max(0, Math.round(value)) : 5;
    setJanelaLancamentoNotasDias(safeValue);
    onUpdateSettings?.({
      academicLockingRules: {
        bloqueioSumarios,
        toleranciaNotas,
        chaveFecho,
        toleranciaSumariosHoras,
        janelaLancamentoNotasDias: safeValue
      }
    });
  };

  const handleAddPause = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!novaPausaDesc || !novaPausaPeriodo) return;

    await runGlobalOperation(
      async () => {
        const updated = [
          ...pausas,
          {
            id: Date.now(),
            desc: novaPausaDesc,
            periodo: novaPausaPeriodo,
            dias: novaPausaDias || '5 Dias'
          }
        ];
        setPausas(updated);
        if (onUpdateSettings) {
          onUpdateSettings({ academicPauses: updated });
        }
        dbService.updateSettings({ academicPauses: updated });
      },
      {
        loadingMessage: 'A registar pausa pedagógica no calendário escolar...',
        successMessage: 'Operação feita com sucesso!',
        requiredRule: 'config.institution',
        userRole: currentUserRole
      }
    );

    setNovaPausaDesc('');
    setNovaPausaPeriodo('');
    setNovaPausaDias('');
    setShowAddPauseModal(false);
  };

  const handleConfirmCloseTrimester = async () => {
    setShowCloseTrimesterModal(false);
    await runGlobalOperation(
      async () => {
        // Grava o encerramento diretamente na base de dados (trimesterSchedules[tN].closed),
        // que é o que a Assiduidade e as Pautas passam a verificar para bloquear edições —
        // um simples registo de auditoria, sem esta marca, não produzia qualquer efeito real.
        dbService.closeTrimester(currentTrimester);
        const key = ('t' + currentTrimester) as 't1' | 't2' | 't3';
        const updated = {
          ...trimesterSchedules,
          [key]: { ...trimesterSchedules[key], closed: true, closedAt: new Date().toISOString() }
        };
        setTrimesterSchedules(updated);
        onUpdateSettings?.({ trimesterSchedules: updated });
      },
      {
        requiredRule: 'pautas.homologar',
        userRole: currentUserRole,
        loadingMessage: `A homologar e trancar o ${currentTrimester}.º Trimestre...`,
        successMessage: `${currentTrimester}.º Trimestre encerrado com sucesso. Sumários e lançamento de notas ficam bloqueados a partir de agora.`
      }
    );
  };

  const handleReopenTrimester = async (trim: '1' | '2' | '3') => {
    await runGlobalOperation(
      async () => {
        dbService.reopenTrimester(trim);
        const key = ('t' + trim) as 't1' | 't2' | 't3';
        const updated = {
          ...trimesterSchedules,
          [key]: { ...trimesterSchedules[key], closed: false }
        };
        setTrimesterSchedules(updated);
        onUpdateSettings?.({ trimesterSchedules: updated });
      },
      {
        requiredRule: 'pautas.unlock',
        userRole: currentUserRole,
        loadingMessage: `A reabrir o ${trim}.º Trimestre...`,
        successMessage: `${trim}.º Trimestre reaberto com sucesso.`
      }
    );
  };

  // Alterações deste separador, recolhidas pelo botão principal "Guardar Alterações".
  const buildPendingSettings = React.useCallback(
    (): Partial<InstitutionSettings> => ({
      academicPeriod,
      academicWeeks,
      academicPeriodStartIso: periodStartIso,
      academicPeriodEndIso: periodEndIso,
      academicWeeksNumber,
      trimesterSchedules,
      academicPauses: pausas,
      academicLockingRules: {
        bloqueioSumarios,
        toleranciaNotas,
        chaveFecho,
        toleranciaSumariosHoras,
        janelaLancamentoNotasDias
      }
    }),
    [
      academicPeriod,
      academicWeeks,
      periodStartIso,
      periodEndIso,
      academicWeeksNumber,
      trimesterSchedules,
      pausas,
      bloqueioSumarios,
      toleranciaNotas,
      chaveFecho,
      toleranciaSumariosHoras,
      janelaLancamentoNotasDias
    ]
  );

  React.useEffect(() => {
    registerCommit?.(buildPendingSettings);
    return () => registerCommit?.(null);
  }, [registerCommit, buildPendingSettings]);

  // Feriados Oficiais gravados na base de dados (Configurações > Ano Letivo > Feriados). Se a
  // instituição ainda não sincronizou nenhum, mostra a lista oficial angolana por omissão para
  // o Ano Letivo Vigente — sem nunca fixar um ano específico no ecrã.
  const MONTH_SHORT = ['JAN', 'FEV', 'MAR', 'ABR', 'MAI', 'JUN', 'JUL', 'AGO', 'SET', 'OUT', 'NOV', 'DEZ'];
  const storedHolidays = settings.academicHolidays && settings.academicHolidays.length > 0
    ? settings.academicHolidays
    : getDefaultAngolaHolidays(settings.currentAcademicYear || getFallbackAcademicYear()).map((h, i) => ({
        id: `holiday-default-${i}`,
        date: h.date,
        name: h.name,
        trimestre: h.trimestre
      }));
  const feriados = [...storedHolidays]
    .sort((a, b) => a.date.localeCompare(b.date))
    .map((h) => {
      const d = new Date(h.date + 'T00:00:00');
      return {
        dia: Number.isNaN(d.getTime()) ? '--' : String(d.getDate()).padStart(2, '0'),
        mes: Number.isNaN(d.getTime()) ? '' : MONTH_SHORT[d.getMonth()],
        nome: h.name,
        trim: h.trimestre || 'Feriado Nacional'
      };
    });

  const handleSyncHolidays = async () => {
    await runGlobalOperation(
      async () => {
        const merged = dbService.syncOfficialHolidays();
        onUpdateSettings?.({ academicHolidays: merged });
      },
      {
        loadingMessage: 'A sincronizar Feriados Oficiais da República de Angola...',
        successMessage: 'Calendário de Feriados Oficiais sincronizado com sucesso!'
      }
    );
  };

  return (
    <div className="flex flex-col gap-6">
      {/* Section Header Hero Panel */}
      <div className="p-6 rounded-2xl bg-white border border-slate-200 shadow-xs flex flex-col gap-4">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
          <div className="flex items-start gap-4">
            <div className="w-12 h-12 rounded-xl bg-[#0b1f3a] text-white flex items-center justify-center shrink-0 shadow-sm">
              <span className="material-symbols-outlined text-[26px]">date_range</span>
            </div>
            <div className="flex flex-col">
              <div className="flex items-center gap-2">
                <span className="text-[11px] uppercase tracking-wider text-[#ac332b] font-bold">Módulo 02</span>
                <span className="w-1 h-1 rounded-full bg-slate-300" />
                <span className="text-[11px] text-slate-500 font-medium">ANO LECTIVO E CALENDÁRIO</span>
              </div>
              <h2 className="font-headline text-xl lg:text-2xl font-bold text-slate-900">
                GESTÃO DE ANO LECTIVO
              </h2>
            </div>
          </div>

          <div className="flex items-center gap-2 shrink-0">
          
            <button
              type="button"
              onClick={() => setShowCloseTrimesterModal(true)}
              className="px-3.5 py-2 rounded-xl bg-[#ac332b] text-white hover:bg-red-800 font-bold text-xs flex items-center gap-1.5 transition-colors shadow-xs cursor-pointer"
            >
              <span className="material-symbols-outlined text-[16px]">lock_clock</span>
              <span>Encerrar</span>
            </button>
          </div>
        </div>

        {/* Active Academic Year Banner Card */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 p-4 rounded-xl bg-slate-50 border border-slate-100 items-center">
          <div className="flex flex-col">
            <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">Ano Letivo</span>
            <div className="flex items-center gap-2 mt-0.5">
              <span className="font-headline text-lg font-extrabold text-[#0b1f3a]">
                {settings.currentAcademicYear || 'Não definido'}
              </span>
              <span className="px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-800 text-[10px] font-bold">
                EM CURSO
              </span>
            </div>
          </div>
          <div className="flex flex-col">
            <div className="flex items-center justify-between">
              <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">Período de Atividade</span>
              <button
                type="button"
                onClick={handleOpenEditPeriod}
                className="btn-definir text-[11px] font-bold flex items-center gap-0.5 cursor-pointer px-2 py-0.5 rounded-lg transition-colors"
                title="Admin: Definir período de atividade letiva"
              >
                <span className="material-symbols-outlined text-[13px]">edit</span>
                <span>Definir</span>
              </button>
            </div>
            <span className="text-xs font-semibold text-slate-800 mt-0.5">{academicPeriod || 'Não definido (definir)'}</span>
          </div>
          <div className="flex flex-col">
            <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">Semanas Letivas</span>
            <span className="text-xs font-semibold text-slate-800 mt-0.5">
              {academicWeeks || 'Depende do período de atividade'}
            </span>
            <span className="text-[10px] text-slate-400 mt-0.5">
              Calculado; a seguir: {upcomingYear}
            </span>
          </div>
          <div className="flex items-center gap-2 lg:justify-end">
            <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wider"></span>
            <select
              value={settings.currentAcademicYear || ''}
              onChange={(e) => {
                dbService.setAcademicYear(e.target.value);
                if (onUpdateSettings) onUpdateSettings({ currentAcademicYear: e.target.value });
              }}
              className="px-3 py-1.5 rounded-xl bg-white hover:bg-slate-100 border border-slate-300 text-slate-800 font-bold text-xs shadow-xs focus:outline-none focus:ring-1 focus:ring-[#0b1f3a]"
            >
              {Array.from(
                new Set(
                  [
                    settings.currentAcademicYear,
                    ...(settings.availableAcademicYears || [])
                  ].filter(Boolean)
                )
              ).map((yr) => (
                <option key={yr as string} value={yr as string}>
                   {yr}
                </option>
              ))}
            </select>
            <button
              type="button"
              onClick={handleOpenEditAcademicYear}
              className="px-2 py-1.5 rounded-xl bg-slate-100 hover:bg-slate-300 text-slate-800 font-bold text-[11px] flex items-center gap-1 cursor-pointer shrink-0"
              title="Cadastrar Novo Ano Letivo"
            >
			
              <span className="material-symbols-outlined text-[14px]">add</span>
              <span>NOVO</span>
            </button>
          </div>
        </div>
      </div>

      {/* Estrutura Curricular dos 3 Trimestres */}
      <div className="flex flex-col gap-4 bg-white p-6 rounded-2xl border border-slate-200 shadow-xs">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
          <div>
            <h3 className="font-headline text-base lg:text-lg font-bold text-slate-900">
              Estrutura Curricular dos 3 Trimestres
            </h3>
          </div>
          <span className="px-3 py-1 rounded-full bg-blue-50 text-[#0b1f3a] font-mono text-[11px] font-bold border border-blue-200">
            Trimestre em Curso: {currentTrimester}.º Trimestre
          </span>
        </div>

        <div data-gr-cards="tri" className="grid grid-cols-1 lg:grid-cols-3 gap-4 mt-1">
          {/* 1º Trimestre */}
          <div
            className={`flex flex-col p-5 rounded-xl justify-between border transition-all ${
              currentTrimester === '1'
                ? 'bg-white ring-2 ring-[#0b1f3a] shadow-md border-transparent relative overflow-hidden'
                : 'bg-slate-50 border-slate-200'
            }`}
          >
            {currentTrimester === '1' && (
              <div className="absolute top-0 right-0 bg-[#0b1f3a] text-white text-[9px] font-bold px-3 py-0.5 rounded-bl-lg tracking-wider">
                EM ANDAMENTO
              </div>
            )}
            <div>
              <div className="flex items-center justify-between mb-3">
                <span className={`px-2.5 py-1 rounded-lg text-xs font-bold ${currentTrimester === '1' ? 'bg-[#0b1f3a] text-white' : 'bg-slate-200 text-slate-800'}`}>
                  1.º TRIMESTRE
                </span>
                <div className="flex items-center gap-1.5">
                  <button
                    type="button"
                    onClick={() => handleOpenEditTrimester('1')}
                    className="btn-definir flex items-center gap-1 text-[11px] font-bold px-2 py-0.5 rounded-lg transition-colors cursor-pointer"
                    title="Definir datas e semanas do 1.º Trimestre"
                  >
                    <span className="material-symbols-outlined text-[13px]">edit_calendar</span>
                    <span>Definir</span>
                  </button>
                  {trimesterSchedules.t1.closed ? (
                    <span className="flex items-center gap-1 text-[11px] text-white font-bold bg-slate-700 px-2 py-0.5 rounded-full" title="Trimestre encerrado e trancado">
                      <span className="material-symbols-outlined text-[12px]">lock</span>
                      Encerrado
                    </span>
                  ) : currentTrimester === '1' ? (
                    <span className="flex items-center gap-1 text-[11px] text-[#ac332b] font-bold bg-red-50 border border-red-200 px-2 py-0.5 rounded-full">
                      <span className="w-1.5 h-1.5 rounded-full bg-[#ac332b] animate-pulse" />
                      Ativo
                    </span>
                  ) : (
                    <span className="text-[11px] text-slate-500 font-semibold bg-slate-200 px-2 py-0.5 rounded-full">
                      Concluído
                    </span>
                  )}
                </div>
              </div>
              <div className="space-y-1.5 text-xs text-slate-700">
                <div className="flex justify-between items-center py-0.5">
                  <span className="text-slate-500">Início do Trimestre:</span>
                  <span className="font-semibold text-slate-900">{trimesterSchedules.t1.startDate || 'Não definido'}</span>
                </div>
                <div className="flex justify-between items-center py-0.5">
                  <span className="text-slate-500">Término do Trimestre:</span>
                  <span className="font-semibold text-slate-900">{trimesterSchedules.t1.endDate || 'Não definido'}</span>
                </div>
                <div className="flex justify-between items-center py-0.5">
                  <span className="text-slate-500">Provas Trimestrais:</span>
                  <span className="font-semibold text-slate-900">{trimesterSchedules.t1.examPeriod || 'Não definido'}</span>
                </div>
                <div className="flex justify-between items-center py-0.5">
                  <span className="text-slate-500">Conselho de Notas:</span>
                  <span className="font-semibold text-slate-900">{trimesterSchedules.t1.gradesCouncilDate || 'Não definido'}</span>
                </div>
              </div>
            </div>

            <div className="mt-4 pt-3 border-t border-slate-200 flex items-center justify-between text-xs">
              <span className="text-slate-600 font-semibold">{trimesterSchedules.t1.weeksCount || 'Não definido'}</span>
              {trimesterSchedules.t1.closed ? (
                <button
                  type="button"
                  onClick={() => handleReopenTrimester('1')}
                  className="px-2.5 py-1 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold text-xs transition-colors cursor-pointer flex items-center gap-1"
                  title="Reabrir trimestre para edição"
                >
                  <span className="material-symbols-outlined text-[14px]">lock_open</span>
                  Reabrir
                </button>
              ) : currentTrimester === '1' ? (
                <span className="text-xs font-bold text-emerald-800 flex items-center gap-1">
                  <span className="material-symbols-outlined text-[16px]">check_circle</span>
                  <span>Trimestre Vigente</span>
                </span>
              ) : (
                <span className="text-[11px] text-slate-500 font-semibold flex items-center gap-1">
                  <span className="material-symbols-outlined text-[14px]">schedule</span>
                  <span>Automático por datas</span>
                </span>
              )}
            </div>
          </div>

          {/* 2º Trimestre */}
          <div
            className={`flex flex-col p-5 rounded-xl justify-between border transition-all ${
              currentTrimester === '2'
                ? 'bg-white ring-2 ring-[#0b1f3a] shadow-md border-transparent relative overflow-hidden'
                : 'bg-slate-50 border-slate-200'
            }`}
          >
            {currentTrimester === '2' && (
              <div className="absolute top-0 right-0 bg-[#0b1f3a] text-white text-[9px] font-bold px-3 py-0.5 rounded-bl-lg tracking-wider">
                EM ANDAMENTO
              </div>
            )}
            <div>
              <div className="flex items-center justify-between mb-3">
                <span className={`px-2.5 py-1 rounded-lg text-xs font-bold ${currentTrimester === '2' ? 'bg-[#0b1f3a] text-white' : 'bg-slate-200 text-slate-800'}`}>
                  2.º TRIMESTRE
                </span>
                <div className="flex items-center gap-1.5">
                  <button
                    type="button"
                    onClick={() => handleOpenEditTrimester('2')}
                    className="btn-definir flex items-center gap-1 text-[11px] font-bold px-2 py-0.5 rounded-lg transition-colors cursor-pointer"
                    title="Definir datas e semanas do 2.º Trimestre"
                  >
                    <span className="material-symbols-outlined text-[13px]">edit_calendar</span>
                    <span>Definir</span>
                  </button>
                  {trimesterSchedules.t2.closed ? (
                    <span className="flex items-center gap-1 text-[11px] text-white font-bold bg-slate-700 px-2 py-0.5 rounded-full" title="Trimestre encerrado e trancado">
                      <span className="material-symbols-outlined text-[12px]">lock</span>
                      Encerrado
                    </span>
                  ) : currentTrimester === '2' ? (
                    <span className="flex items-center gap-1 text-[11px] text-[#ac332b] font-bold bg-red-50 border border-red-200 px-2 py-0.5 rounded-full">
                      <span className="w-1.5 h-1.5 rounded-full bg-[#ac332b] animate-pulse" />
                      Ativo
                    </span>
                  ) : (
                    <span className="text-[11px] text-slate-500 font-semibold bg-slate-200 px-2 py-0.5 rounded-full">
                      Inativo
                    </span>
                  )}
                </div>
              </div>
              <div className="space-y-1.5 text-xs text-slate-700">
                <div className="flex justify-between items-center py-0.5">
                  <span className="text-slate-500">Início do Trimestre:</span>
                  <span className="font-semibold text-slate-900">{trimesterSchedules.t2.startDate || 'Não definido'}</span>
                </div>
                <div className="flex justify-between items-center py-0.5">
                  <span className="text-slate-500">Término do Trimestre:</span>
                  <span className="font-semibold text-slate-900">{trimesterSchedules.t2.endDate || 'Não definido'}</span>
                </div>
                <div className="flex justify-between items-center py-0.5">
                  <span className="text-slate-500">Provas Trimestrais:</span>
                  <span className="font-bold text-[#0b1f3a]">{trimesterSchedules.t2.examPeriod || 'Não definido'}</span>
                </div>
                <div className="flex justify-between items-center py-0.5">
                  <span className="text-slate-500">Conselho de Notas:</span>
                  <span className="font-semibold text-slate-900">{trimesterSchedules.t2.gradesCouncilDate || 'Não definido'}</span>
                </div>
              </div>
            </div>

            <div className="mt-4 pt-3 border-t border-slate-200 flex items-center justify-between text-xs">
              <span className="text-slate-600 font-semibold">{trimesterSchedules.t2.weeksCount || 'Não definido'}</span>
              {trimesterSchedules.t2.closed ? (
                <button
                  type="button"
                  onClick={() => handleReopenTrimester('2')}
                  className="px-2.5 py-1 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold text-xs transition-colors cursor-pointer flex items-center gap-1"
                  title="Reabrir trimestre para edição"
                >
                  <span className="material-symbols-outlined text-[14px]">lock_open</span>
                  Reabrir
                </button>
              ) : currentTrimester === '2' ? (
                <span className="text-xs font-bold text-emerald-800 flex items-center gap-1">
                  <span className="material-symbols-outlined text-[16px]">check_circle</span>
                  <span>Trimestre Vigente</span>
                </span>
              ) : (
                <span className="text-[11px] text-slate-500 font-semibold flex items-center gap-1">
                  <span className="material-symbols-outlined text-[14px]">schedule</span>
                  <span>Automático por datas</span>
                </span>
              )}
            </div>
          </div>

          {/* 3º Trimestre */}
          <div
            className={`flex flex-col p-5 rounded-xl justify-between border transition-all ${
              currentTrimester === '3'
                ? 'bg-white ring-2 ring-[#0b1f3a] shadow-md border-transparent relative overflow-hidden'
                : 'bg-slate-50 border-slate-200'
            }`}
          >
            {currentTrimester === '3' && (
              <div className="absolute top-0 right-0 bg-[#0b1f3a] text-white text-[9px] font-bold px-3 py-0.5 rounded-bl-lg tracking-wider">
                EM ANDAMENTO
              </div>
            )}
            <div>
              <div className="flex items-center justify-between mb-3">
                <span className={`px-2.5 py-1 rounded-lg text-xs font-bold ${currentTrimester === '3' ? 'bg-[#0b1f3a] text-white' : 'bg-slate-200 text-slate-800'}`}>
                  3.º TRIMESTRE
                </span>
                <div className="flex items-center gap-1.5">
                  <button
                    type="button"
                    onClick={() => handleOpenEditTrimester('3')}
                    className="btn-definir flex items-center gap-1 text-[11px] font-bold px-2 py-0.5 rounded-lg transition-colors cursor-pointer"
                    title="Definir datas e semanas do 3.º Trimestre"
                  >
                    <span className="material-symbols-outlined text-[13px]">edit_calendar</span>
                    <span>Definir</span>
                  </button>
                  {trimesterSchedules.t3.closed ? (
                    <span className="flex items-center gap-1 text-[11px] text-white font-bold bg-slate-700 px-2 py-0.5 rounded-full" title="Trimestre encerrado e trancado">
                      <span className="material-symbols-outlined text-[12px]">lock</span>
                      Encerrado
                    </span>
                  ) : currentTrimester === '3' ? (
                    <span className="flex items-center gap-1 text-[11px] text-[#ac332b] font-bold bg-red-50 border border-red-200 px-2 py-0.5 rounded-full">
                      <span className="w-1.5 h-1.5 rounded-full bg-[#ac332b] animate-pulse" />
                      Ativo
                    </span>
                  ) : (
                    <span className="text-[11px] text-slate-500 font-semibold bg-slate-200 px-2 py-0.5 rounded-full">
                      Planeado
                    </span>
                  )}
                </div>
              </div>
              <div className="space-y-1.5 text-xs text-slate-700">
                <div className="flex justify-between items-center py-0.5">
                  <span className="text-slate-500">Início do Trimestre:</span>
                  <span className="font-semibold text-slate-900">{trimesterSchedules.t3.startDate || 'Não definido'}</span>
                </div>
                <div className="flex justify-between items-center py-0.5">
                  <span className="text-slate-500">Término do Trimestre:</span>
                  <span className="font-semibold text-slate-900">{trimesterSchedules.t3.endDate || 'Não definido'}</span>
                </div>
                <div className="flex justify-between items-center py-0.5">
                  <span className="text-slate-500">Exames Nacionais:</span>
                  <span className="font-semibold text-slate-900">{trimesterSchedules.t3.examPeriod || 'Não definido'}</span>
                </div>
                <div className="flex justify-between items-center py-0.5">
                  <span className="text-slate-500">Divulgação Final:</span>
                  <span className="font-semibold text-slate-900">{trimesterSchedules.t3.gradesCouncilDate || 'Não definido'}</span>
                </div>
              </div>
            </div>

            <div className="mt-4 pt-3 border-t border-slate-200 flex items-center justify-between text-xs">
              <span className="text-slate-600 font-semibold">{trimesterSchedules.t3.weeksCount || 'Não definido'}</span>
              {trimesterSchedules.t3.closed ? (
                <button
                  type="button"
                  onClick={() => handleReopenTrimester('3')}
                  className="px-2.5 py-1 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold text-xs transition-colors cursor-pointer flex items-center gap-1"
                  title="Reabrir trimestre para edição"
                >
                  <span className="material-symbols-outlined text-[14px]">lock_open</span>
                  Reabrir
                </button>
              ) : currentTrimester === '3' ? (
                <span className="text-xs font-bold text-emerald-800 flex items-center gap-1">
                  <span className="material-symbols-outlined text-[16px]">check_circle</span>
                  <span>Trimestre Vigente</span>
                </span>
              ) : (
                <span className="text-[11px] text-slate-500 font-semibold flex items-center gap-1">
                  <span className="material-symbols-outlined text-[14px]">schedule</span>
                  <span>Automático por datas</span>
                </span>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Pausas Letivas & Regras de Trancamento */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Pausas Letivas (7 cols) */}
        <div className="lg:col-span-7 flex flex-col gap-4 bg-white p-6 rounded-2xl border border-slate-200 shadow-xs">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2.5">
              <span className="material-symbols-outlined text-[#0b1f3a] text-[22px]">beach_access</span>
              <h3 className="font-headline text-base font-bold text-slate-900">
                Interrupções & Pausas ({pausas.length})
              </h3>
            </div>
            <button
              type="button"
              onClick={() => setShowAddPauseModal(true)}
              className="px-3 py-1.5 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-800 font-bold text-xs flex items-center gap-1 transition-colors cursor-pointer"
            >
              <span className="material-symbols-outlined text-[15px]">add</span>
              <span>ADICIONAR</span>
            </button>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead>
                <tr className="bg-[#0b1f3a] text-white uppercase tracking-wider font-bold border-b border-slate-800 text-[11px]">
                  <th className="py-2.5 px-3 rounded-l-lg">Descrição da Pausa</th>
                  <th className="py-2.5 px-3">Período</th>
                  <th className="py-2.5 px-3">Duração</th>
                  <th className="py-2.5 px-3 text-right rounded-r-lg">Ação</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 text-slate-700">
                {visiblePausas.map((p) => (
                  <tr key={p.id} className="hover:bg-slate-50 transition-colors">
                    <td className="py-3 px-3 font-semibold text-slate-900">{p.desc}</td>
                    <td className="py-3 px-3 text-slate-600">{p.periodo}</td>
                    <td className="py-3 px-3">
                      <span className="px-2 py-0.5 rounded bg-slate-100 text-slate-800 text-[11px] font-mono font-semibold">
                        {p.dias}
                      </span>
                    </td>
                    <td className="py-3 px-3 text-right">
                      <button
                        type="button"
                        onClick={() => setPauseToDelete(p)}
                        className="p-1 text-slate-400 hover:text-red-600 rounded-lg hover:bg-red-50 cursor-pointer"
                        title="Remover pausa"
                      >
                        <span className="material-symbols-outlined text-[18px]">delete</span>
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <TablePagination total={pausas.length} page={pgPausas} onPageChange={setPgPausas} />
          </div>
        </div>

        {/* Regras de Trancamento (5 cols) */}
        <div className="lg:col-span-5 flex flex-col gap-4 bg-white p-6 rounded-2xl border border-slate-200 shadow-xs">
          <div className="flex items-center gap-2.5">
            <span className="material-symbols-outlined text-[#ac332b] text-[22px]">gavel</span>
            <h3 className="font-headline text-base font-bold text-slate-900">
              Regras de Trancamento
            </h3>
          </div>

          <div className="flex flex-col gap-3">
            {/* Rule 1 */}
            <div className="p-3.5 rounded-xl bg-slate-50 border border-slate-100 flex items-start justify-between gap-3">
              <div className="flex flex-col">
                <span className="font-bold text-slate-800 text-xs">Bloqueio Automático de Sumários</span>
                <span className="text-[11px] text-slate-500 mt-0.5">
                  Professor fica impedido de editar aula lecionada após prazo legal.
                </span>
                <div className="mt-1 flex items-center gap-1.5">
                  <span className="text-[11px] text-slate-600 font-semibold">Tolerância:</span>
                  <input
                    type="number"
                    min={0}
                    value={toleranciaSumariosHoras}
                    onChange={(e) => handleChangeToleranceHours(parseInt(e.target.value, 10))}
                    disabled={!bloqueioSumarios}
                    className="w-14 px-1.5 py-0.5 rounded-lg bg-white border border-slate-300 text-[11px] font-mono font-bold text-[#ac332b] text-center outline-none focus:ring-1 focus:ring-[#0b1f3a] disabled:bg-slate-100 disabled:text-slate-400"
                  />
                  <span className="font-mono text-[11px] text-[#ac332b] font-bold">Horas</span>
                </div>
              </div>
              <button
                type="button"
                onClick={() => handleToggleRule('bloqueioSumarios')}
                className={`w-10 h-5 rounded-full transition-colors relative cursor-pointer shrink-0 mt-1 ${
                  bloqueioSumarios ? 'bg-[#0b1f3a]' : 'bg-slate-300'
                }`}
              >
                <div
                  className={`w-3.5 h-3.5 rounded-full bg-white transition-transform absolute top-0.5 ${
                    bloqueioSumarios ? 'right-0.5' : 'left-0.5'
                  }`}
                />
              </button>
            </div>

            {/* Rule 2 */}
            <div className="p-3.5 rounded-xl bg-slate-50 border border-slate-100 flex items-start justify-between gap-3">
              <div className="flex flex-col">
                <span className="font-bold text-slate-800 text-xs">Prazo de Lançamento de Provas</span>
                <span className="text-[11px] text-slate-500 mt-0.5">
                  Janela para inserir notas de MAC e Provas Trimestrais na pauta digital.
                </span>
                <div className="mt-1 flex items-center gap-1.5">
                  <span className="text-[11px] text-slate-600 font-semibold">Janela:</span>
                  <input
                    type="number"
                    min={0}
                    value={janelaLancamentoNotasDias}
                    onChange={(e) => handleChangeJanelaDias(parseInt(e.target.value, 10))}
                    disabled={!toleranciaNotas}
                    className="w-14 px-1.5 py-0.5 rounded-lg bg-white border border-slate-300 text-[11px] font-mono font-bold text-[#0b1f3a] text-center outline-none focus:ring-1 focus:ring-[#0b1f3a] disabled:bg-slate-100 disabled:text-slate-400"
                  />
                  <span className="font-mono text-[11px] text-[#0b1f3a] font-bold">Dias Úteis</span>
                </div>
              </div>
              <button
                type="button"
                onClick={() => handleToggleRule('toleranciaNotas')}
                className={`w-10 h-5 rounded-full transition-colors relative cursor-pointer shrink-0 mt-1 ${
                  toleranciaNotas ? 'bg-[#0b1f3a]' : 'bg-slate-300'
                }`}
              >
                <div
                  className={`w-3.5 h-3.5 rounded-full bg-white transition-transform absolute top-0.5 ${
                    toleranciaNotas ? 'right-0.5' : 'left-0.5'
                  }`}
                />
              </button>
            </div>

            {/* Rule 3 */}
            <div className="p-3.5 rounded-xl bg-slate-50 border border-slate-100 flex items-start justify-between gap-3">
              <div className="flex flex-col">
                <span className="font-bold text-slate-800 text-xs">Chave Criptográfica de Fecho</span>
                <span className="text-[11px] text-slate-500 mt-0.5">
                  Exige assinatura eletrónica do Diretor Pedagógico para trancar o trimestre.
                </span>
                <span className="mt-1 font-mono text-[11px] text-slate-600 font-semibold">
                  Exigência Legal MED
                </span>
              </div>
              <button
                type="button"
                onClick={() => handleToggleRule('chaveFecho')}
                className={`w-10 h-5 rounded-full transition-colors relative cursor-pointer shrink-0 mt-1 ${
                  chaveFecho ? 'bg-[#0b1f3a]' : 'bg-slate-300'
                }`}
              >
                <div
                  className={`w-3.5 h-3.5 rounded-full bg-white transition-transform absolute top-0.5 ${
                    chaveFecho ? 'right-0.5' : 'left-0.5'
                  }`}
                />
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Feriados Oficiais da República de Angola */}
      <div className="flex flex-col gap-4 bg-white p-6 rounded-2xl border border-slate-200 shadow-xs">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
          <div className="flex items-center gap-2.5">
            <span className="material-symbols-outlined text-[#ac332b] text-[22px]">flag</span>
            <div>
              <h3 className="font-headline text-base font-bold text-slate-900">
                Feriados Oficiais da República de Angola
              </h3>
              <p className="text-xs text-slate-500">
                Dias não letivos integrados obrigatoriamente no controlo de faltas e presenças docentes.
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={handleSyncHolidays}
            className="px-3.5 py-1.5 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-800 font-bold text-xs flex items-center gap-1.5 transition-colors self-start cursor-pointer"
          >
            <span className="material-symbols-outlined text-[16px]">sync</span>
            <span>Sincronizar</span>
          </button>
        </div>

        <div data-gr-cards className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          {feriados.map((f, i) => (
            <div key={i} className="p-3 rounded-xl bg-slate-50 border border-slate-100 flex items-center gap-3">
              <div className="w-10 h-10 rounded-lg bg-white border border-slate-200 flex flex-col items-center justify-center font-mono text-[11px] font-bold text-[#ac332b] shrink-0">
                <span>{f.dia}</span>
                <span className="text-[9px] -mt-1 uppercase">{f.mes}</span>
              </div>
              <div className="flex flex-col min-w-0">
                <span className="text-xs font-bold text-slate-800 truncate">{f.nome}</span>
                <span className="text-[11px] text-slate-500 truncate">{f.trim}</span>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Footer Actions */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-4 bg-white rounded-2xl border border-slate-200 shadow-xs">
        <div className="flex items-center gap-2 text-slate-500 text-xs">
          <span className="material-symbols-outlined text-slate-400">verified_user</span>
          <span>
            Trimestre ativo no sistema: <strong className="text-slate-800">{currentTrimester}.º Trimestre</strong>
          </span>
        </div>
        
      </div>

      {/* Modal Nova Pausa */}
      {showAddPauseModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs animate-in fade-in">
          <div className="bg-white rounded-2xl p-6 max-w-md w-full border border-slate-200 shadow-2xl flex flex-col gap-4">
            <div className="flex items-center justify-between pb-2 border-b border-slate-100">
              <h3 className="font-headline font-bold text-slate-900 text-base">Adicionar Interrupção / Pausa</h3>
              <button
                type="button"
                onClick={() => setShowAddPauseModal(false)}
                className="p-1 rounded-lg text-slate-400 hover:bg-slate-100 cursor-pointer"
              >
                <span className="material-symbols-outlined text-[20px]">close</span>
              </button>
            </div>
            <form onSubmit={handleAddPause} className="flex flex-col gap-3 text-xs">
              <div>
                <label className="block font-bold text-slate-700 mb-1">Descrição</label>
                <input
                  type="text"
                  required
                  placeholder="ex: Pausa Pedagógica Trimestral"
                  value={novaPausaDesc}
                  onChange={(e) => setNovaPausaDesc(e.target.value)}
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl outline-none focus:ring-1 focus:ring-[#0b1f3a]"
                />
              </div>
              <div>
                <label className="block font-bold text-slate-700 mb-1">Período de Datas</label>
                <input
                  type="text"
                  required
                  placeholder="ex: 15 Mai 2025 — 18 Mai 2025"
                  value={novaPausaPeriodo}
                  onChange={(e) => setNovaPausaPeriodo(e.target.value)}
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl outline-none focus:ring-1 focus:ring-[#0b1f3a]"
                />
              </div>
              <div>
                <label className="block font-bold text-slate-700 mb-1">Duração Total</label>
                <input
                  type="text"
                  placeholder="ex: 4 Dias"
                  value={novaPausaDias}
                  onChange={(e) => setNovaPausaDias(e.target.value)}
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl outline-none focus:ring-1 focus:ring-[#0b1f3a]"
                />
              </div>
              <div className="flex justify-end gap-2 pt-3 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setShowAddPauseModal(false)}
                  className="px-3 py-1.5 rounded-xl bg-slate-100 text-slate-700 font-bold cursor-pointer"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  className="px-4 py-1.5 rounded-xl bg-[#0b1f3a] text-white font-bold hover:bg-[#7a0c0c] cursor-pointer"
                >
                  Registar Pausa
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal Encerrar Trimestre */}
      {showCloseTrimesterModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs animate-in fade-in">
          <div className="bg-white rounded-2xl p-6 max-w-md w-full border border-slate-200 shadow-2xl flex flex-col gap-4">
            <div className="flex items-center gap-3 pb-2 border-b border-slate-100">
              <div className="w-10 h-10 rounded-xl bg-red-50 text-[#ac332b] flex items-center justify-center">
                <span className="material-symbols-outlined text-[24px]">lock</span>
              </div>
              <div>
                <h3 className="font-headline font-bold text-slate-900 text-base">Encerrar e Trancar Trimestre</h3>
                <span className="text-xs text-slate-500">Ação administrativa do Conselho Pedagógico</span>
              </div>
            </div>
            <p className="text-xs text-slate-600 leading-relaxed">
              Tem a certeza de que deseja encerrar e trancar o <strong>{currentTrimester}.º Trimestre</strong> do ano letivo <strong>{settings.currentAcademicYear || getFallbackAcademicYear()}</strong>?
              Após a confirmação, os professores não poderão alterar notas ou diários sem autorização explícita da Direção.
            </p>
            <div className="flex justify-end gap-2 pt-3 border-t border-slate-100 text-xs">
              <button
                type="button"
                onClick={() => setShowCloseTrimesterModal(false)}
                className="px-3 py-1.5 rounded-xl bg-slate-100 text-slate-700 font-bold cursor-pointer"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={handleConfirmCloseTrimester}
                className="px-4 py-1.5 rounded-xl bg-[#ac332b] text-white font-bold hover:bg-red-800 cursor-pointer"
              >
                Confirmar Encerramento
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal Eliminar Pausa Pedagógica com Padrão de Eliminar Turma */}
      {pauseToDelete && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-xs z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-none max-w-md w-full p-6 border border-slate-300 shadow-2xl">
            <div className="w-12 h-12 rounded-none bg-red-100 text-red-700 flex items-center justify-center mx-auto mb-4 border border-red-300">
              <span className="material-symbols-outlined text-[28px]">delete_forever</span>
            </div>
            <h3 className="font-headline text-lg font-bold text-slate-900 text-center">
              Eliminar Pausa Pedagógica da Base de Dados?
            </h3>
            <p className="text-xs text-slate-600 text-center mt-2 leading-relaxed">
              Tem a certeza de que deseja eliminar a pausa <strong>{pauseToDelete.desc}</strong> ({pauseToDelete.periodo} • {pauseToDelete.dias})? Esta ação é definitiva na base de dados.
            </p>
            <div className="mt-6 flex items-center justify-end gap-2">
              <button
                onClick={() => setPauseToDelete(null)}
                className="px-4 py-2 rounded-none bg-slate-200 hover:bg-slate-300 text-slate-700 font-bold text-xs border border-slate-300 cursor-pointer transition-colors"
                type="button"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={async () => {
                  const p = pauseToDelete;
                  setPauseToDelete(null);
                  await runGlobalOperation(
                    async () => {
                      const updated = pausas.filter((item) => item.id !== p.id);
                      setPausas(updated);
                      if (onUpdateSettings) {
                        onUpdateSettings({ academicPauses: updated });
                      }
                      dbService.updateSettings({ ...settings, academicPauses: updated });
                    },
                    {
                      requiredRule: 'config.institution',
                      userRole: currentUserRole,
                      loadingMessage: `A eliminar pausa pedagógica ${p.desc}...`,
                      successMessage: 'Operação feita com sucesso!'
                    }
                  );
                }}
                className="px-5 py-2.5 rounded-none bg-[#b91c1c] hover:bg-[#7a0c0c] text-white font-bold text-xs flex items-center gap-2 cursor-pointer transition-colors shadow-none border-none"
              >
                <span className="material-symbols-outlined text-[16px]">delete</span>
                <span>Eliminar</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal Definir Período de Atividade & Semanas Letivas */}
      {showEditPeriodModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs animate-in fade-in">
          <div className="bg-white rounded-2xl p-6 max-w-md w-full border border-slate-200 shadow-2xl flex flex-col gap-4">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-blue-50 text-[#0b1f3a] flex items-center justify-center">
                  <span className="material-symbols-outlined text-[24px]">calendar_month</span>
                </div>
                <div>
                  <h3 className="font-headline font-bold text-slate-900 text-base">Definir Período & Semanas</h3>
                  <span className="text-xs text-slate-500">Configuração oficial definida pelo Administrador</span>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setShowEditPeriodModal(false)}
                className="text-slate-400 hover:text-slate-700 cursor-pointer"
              >
                <span className="material-symbols-outlined text-[20px]">close</span>
              </button>
            </div>

            <form onSubmit={handleSaveAcademicPeriod} className="flex flex-col gap-4 text-xs">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="flex flex-col gap-1">
                  <label className="font-bold text-slate-700 uppercase tracking-wider text-[11px]">
                    Início do Ano Letivo
                  </label>
                  <input
                    type="date"
                    required
                    value={tempPeriodStartIso}
                    onChange={(e) => setTempPeriodStartIso(e.target.value)}
                    className="w-full px-3.5 py-2.5 bg-slate-50 text-slate-900 rounded-xl border border-slate-200 outline-none focus:bg-white focus:ring-2 focus:ring-[#0b1f3a] text-xs font-semibold"
                  />
                </div>

                <div className="flex flex-col gap-1">
                  <label className="font-bold text-slate-700 uppercase tracking-wider text-[11px]">
                    Término do Ano Letivo
                  </label>
                  <input
                    type="date"
                    required
                    min={tempPeriodStartIso || undefined}
                    value={tempPeriodEndIso}
                    onChange={(e) => setTempPeriodEndIso(e.target.value)}
                    className="w-full px-3.5 py-2.5 bg-slate-50 text-slate-900 rounded-xl border border-slate-200 outline-none focus:bg-white focus:ring-2 focus:ring-[#0b1f3a] text-xs font-semibold"
                  />
                </div>
              </div>

              <div className="flex flex-col gap-1">
                <label className="font-bold text-slate-700 uppercase tracking-wider text-[11px]">
                  Semanas Letivas (calculado automaticamente)
                </label>
                <div className="w-full px-3.5 py-2.5 bg-slate-100 text-slate-700 rounded-xl border border-slate-200 text-xs font-bold flex items-center justify-between">
                  <span>{tempAcademicWeeksNumber ? formatWeeksLabel(tempAcademicWeeksNumber, 'Semanas Letivas') : '—'}</span>
                  <span className="text-[10px] font-medium text-slate-500">
                    {formatPeriodRange(tempPeriodStartIso, tempPeriodEndIso) || 'Defina as duas datas'}
                  </span>
                </div>
                <span className="text-[10px] text-slate-400">
                  Contagem dos dias úteis (segunda a sexta) do intervalo definido acima.
                </span>
              </div>

              <Notice tone="info" icon="event_repeat">
                <span>
                  Terminado este período, o sistema arquiva o Ano Letivo {settings.currentAcademicYear || '—'} como ano
                  passado e abre sozinho o Ano Letivo {upcomingYear} ({formatPeriodRange(upcomingPeriod.startIso, upcomingPeriod.endIso)}).
                </span>
              </Notice>

              <div className="flex justify-end gap-2 pt-3 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setShowEditPeriodModal(false)}
                  className="px-3.5 py-2 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold cursor-pointer"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 rounded-xl bg-[#0b1f3a] hover:bg-[#122c50] text-white font-bold cursor-pointer"
                >
                  Guardar
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal Definir Datas & Prazos do Trimestre Selecionado */}
      {editingTrimester && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs animate-in fade-in">
          <div className="bg-white rounded-2xl p-6 max-w-lg w-full border border-slate-200 shadow-2xl flex flex-col gap-4">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-blue-50 text-[#0b1f3a] flex items-center justify-center">
                  <span className="material-symbols-outlined text-[24px]">edit_calendar</span>
                </div>
                <div>
                  <h3 className="font-headline font-bold text-slate-900 text-base">
                    Definir Datas: {editingTrimester}.º Trimestre
                  </h3>
                  <span className="text-xs text-slate-500">Definição oficial de datas e prazos de avaliação</span>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setEditingTrimester(null)}
                className="text-slate-400 hover:text-slate-700 cursor-pointer"
              >
                <span className="material-symbols-outlined text-[20px]">close</span>
              </button>
            </div>

            <form onSubmit={handleSaveTrimesterSchedule} className="flex flex-col gap-3 text-xs">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="flex flex-col gap-1">
                  <label className="font-bold text-slate-700 uppercase tracking-wider text-[10px]">
                    Início do Trimestre
                  </label>
                  <input
                    type="date"
                    required
                    value={trimForm.startDateIso}
                    onChange={(e) => setTrimForm({ ...trimForm, startDateIso: e.target.value })}
                    className="w-full px-3 py-2 bg-slate-50 text-slate-900 rounded-xl border border-slate-200 outline-none focus:bg-white focus:ring-2 focus:ring-[#0b1f3a] text-xs font-semibold"
                  />
                </div>

                <div className="flex flex-col gap-1">
                  <label className="font-bold text-slate-700 uppercase tracking-wider text-[10px]">
                    Término do Trimestre
                  </label>
                  <input
                    type="date"
                    required
                    min={trimForm.startDateIso || undefined}
                    value={trimForm.endDateIso}
                    onChange={(e) => setTrimForm({ ...trimForm, endDateIso: e.target.value })}
                    className="w-full px-3 py-2 bg-slate-50 text-slate-900 rounded-xl border border-slate-200 outline-none focus:bg-white focus:ring-2 focus:ring-[#0b1f3a] text-xs font-semibold"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="flex flex-col gap-1">
                  <label className="font-bold text-slate-700 uppercase tracking-wider text-[10px]">
                    Provas Trimestrais / Exames — Início
                  </label>
                  <input
                    type="date"
                    min={trimForm.startDateIso || undefined}
                    max={trimForm.endDateIso || undefined}
                    value={trimForm.examStartDateIso}
                    onChange={(e) => setTrimForm({ ...trimForm, examStartDateIso: e.target.value })}
                    className="w-full px-3 py-2 bg-slate-50 text-slate-900 rounded-xl border border-slate-200 outline-none focus:bg-white focus:ring-2 focus:ring-[#0b1f3a] text-xs font-semibold"
                  />
                </div>

                <div className="flex flex-col gap-1">
                  <label className="font-bold text-slate-700 uppercase tracking-wider text-[10px]">
                    Provas Trimestrais / Exames — Término
                  </label>
                  <input
                    type="date"
                    min={trimForm.examStartDateIso || trimForm.startDateIso || undefined}
                    max={trimForm.endDateIso || undefined}
                    value={trimForm.examEndDateIso}
                    onChange={(e) => setTrimForm({ ...trimForm, examEndDateIso: e.target.value })}
                    className="w-full px-3 py-2 bg-slate-50 text-slate-900 rounded-xl border border-slate-200 outline-none focus:bg-white focus:ring-2 focus:ring-[#0b1f3a] text-xs font-semibold"
                  />
                </div>

                <div className="flex flex-col gap-1">
                  <label className="font-bold text-slate-700 uppercase tracking-wider text-[10px]">
                    Conselho de Notas / Divulgação
                  </label>
                  <input
                    type="date"
                    value={trimForm.gradesCouncilDateIso}
                    onChange={(e) => setTrimForm({ ...trimForm, gradesCouncilDateIso: e.target.value })}
                    className="w-full px-3 py-2 bg-slate-50 text-slate-900 rounded-xl border border-slate-200 outline-none focus:bg-white focus:ring-2 focus:ring-[#0b1f3a] text-xs font-semibold"
                  />
                </div>
              </div>

              <div className="flex flex-col gap-1">
                <label className="font-bold text-slate-700 uppercase tracking-wider text-[10px]">
                  Semanas Úteis do Trimestre (calculado automaticamente)
                </label>
                <div className="w-full px-3 py-2 bg-slate-100 text-slate-700 rounded-xl border border-slate-200 text-xs font-bold flex items-center justify-between">
                  <span>{trimFormWeeks ? formatWeeksLabel(trimFormWeeks) : '—'}</span>
                  <span className="text-[10px] font-medium text-slate-500">
                    {formatPeriodRange(trimForm.startDateIso, trimForm.endDateIso) || 'Defina o início e o término'}
                  </span>
                </div>
                <span className="text-[10px] text-slate-400">
                  Dias úteis (segunda a sexta) entre o início e o término do trimestre.
                </span>
              </div>

              <Notice tone="info" icon="info">
                <span>
                  A passagem de trimestre é automática: terminado este trimestre, o dia seguinte já pertence ao
                  trimestre seguinte, segundo as datas aqui definidas.
                </span>
              </Notice>

              <div className="flex justify-end gap-2 pt-3 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setEditingTrimester(null)}
                  className="px-3.5 py-2 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold cursor-pointer"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 rounded-xl bg-[#0b1f3a] hover:bg-[#122c50] text-white font-bold cursor-pointer"
                >
                  Guardar Datas do {editingTrimester}.º Trimestre
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
      {/* Modal para Cadastrar / Definir Ano Letivo pelo Admin */}
      {showEditYearModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4 backdrop-blur-xs">
          <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-xl border border-slate-200">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100">
              <div className="flex items-center gap-2">
                <span className="p-2 rounded-xl bg-blue-50 text-[#0b1f3a] material-symbols-outlined text-[20px]">
                  calendar_month
                </span>
                <div>
                  <h3 className="font-headline text-base font-bold text-slate-900">
                    Definir / Cadastrar Ano Letivo
                  </h3>
                  <p className="text-[11px] text-slate-500">
                    O ano letivo em vigor aplica-se a todas as turmas, pautas e matrículas
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setShowEditYearModal(false)}
                className="text-slate-400 hover:text-slate-600 rounded-lg p-1 cursor-pointer"
              >
                <span className="material-symbols-outlined text-[20px]">close</span>
              </button>
            </div>

            <form onSubmit={handleSaveAcademicYear} className="mt-4 space-y-4">
              <div className="flex flex-col gap-1.5">
                <label className="font-bold text-slate-700 uppercase tracking-wider text-[10px]">
                  Designação do Ano Letivo
                </label>
                <input
                  type="text"
                  value={newYearInput}
                  onChange={(e) => setNewYearInput(e.target.value)}
                  placeholder="Ex.: 2024/2025, 2025/2026"
                  required
                  className="w-full px-3.5 py-2.5 bg-slate-50 text-slate-900 rounded-xl border border-slate-200 outline-none focus:bg-white focus:ring-2 focus:ring-[#0b1f3a] text-sm font-bold"
                />
                <div className="flex flex-wrap gap-1.5 mt-1">
                  <span className="text-[10px] text-slate-400 self-center">Sugestões:</span>
                  {[
                    `${new Date().getFullYear() - 1}/${new Date().getFullYear()}`,
                    `${new Date().getFullYear()}/${new Date().getFullYear() + 1}`,
                    `${new Date().getFullYear() + 1}/${new Date().getFullYear() + 2}`
                  ].map((sug) => (
                    <button
                      key={sug}
                      type="button"
                      onClick={() => setNewYearInput(sug)}
                      className="px-2 py-0.5 rounded-md bg-slate-100 hover:bg-slate-200 text-slate-700 text-[10px] font-mono font-semibold cursor-pointer"
                    >
                      {sug}
                    </button>
                  ))}
                </div>
              </div>

              {settings.availableAcademicYears && settings.availableAcademicYears.length > 0 && (
                <div className="p-3 bg-slate-50 rounded-xl border border-slate-100">
                  <div className="text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-1.5">
                    Anos Letivos Já Registados na Base de Dados:
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {settings.availableAcademicYears.map((ay) => (
                      <button
                        key={ay}
                        type="button"
                        onClick={() => setNewYearInput(ay)}
                        className={`px-2.5 py-1 rounded-lg text-xs font-bold transition-all cursor-pointer ${
                          newYearInput === ay
                            ? 'bg-[#0b1f3a] text-white'
                            : 'bg-white border border-slate-200 text-slate-700 hover:bg-slate-100'
                        }`}
                      >
                        {ay}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              <div className="flex justify-end gap-2 pt-3 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setShowEditYearModal(false)}
                  className="px-3.5 py-2 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold text-xs cursor-pointer"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 rounded-xl bg-[#0b1f3a] hover:bg-[#122c50] text-white font-bold text-xs cursor-pointer flex items-center gap-1.5"
                >
                  <span className="material-symbols-outlined text-[16px]">check_circle</span>
                  <span>Guardar</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
