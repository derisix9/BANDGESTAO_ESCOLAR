import React, { useMemo, useState } from 'react';
import { PayrollRecord, PayrollTaxSettings, SchoolDatabase, UserRole } from '../types';
import { dbService } from '../services/db';
import { runGlobalOperation, showAppAlert, showAppConfirm } from '../context/OperationContext';
import { useAccessControl } from '../hooks/useAccessControl';
import { FormModalHeader } from '../components/FormModalHeader';
import { SearchableSelect } from '../components/SearchableSelect';
import { TablePagination, usePagedList } from '../components/TablePagination';
import {
  DEFAULT_PAYROLL_TAX_SETTINGS,
  MONTH_LABELS,
  PAYROLL_STATUS_META,
  computePayroll,
  formatKz,
  listEligiblePeople,
  monthLabel,
  payrollRecordsToCsv,
  summarizePayrollMonth
} from '../utils/payroll';
import { Notice } from '../components/Notice';

interface FolhaPagamentoViewProps {
  db: SchoolDatabase;
  currentUserRole: UserRole;
}

const inputCls =
  'w-full h-9 px-3 bg-white border border-slate-300 text-slate-800 focus:border-[#0b1f3a] focus:outline-none text-xs';
const labelCls = 'block uppercase font-bold text-slate-700 mb-1 text-[11px]';

const SectionTitle: React.FC<{ icon: string; children: React.ReactNode }> = ({ icon, children }) => (
  <div className="flex items-center gap-2 pb-1.5 border-b border-slate-200">
    <span className="material-symbols-outlined text-[16px] text-[#0b1f3a]">{icon}</span>
    <span className="font-bold text-slate-800 text-[11px] uppercase tracking-wide">{children}</span>
  </div>
);

export const FolhaPagamentoView: React.FC<FolhaPagamentoViewProps> = ({ db, currentUserRole }) => {
  const acl = useAccessControl(currentUserRole);
  const today = new Date();

  const [month, setMonth] = useState<number>(today.getMonth() + 1);
  const [year, setYear] = useState<number>(today.getFullYear());
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | PayrollRecord['status']>('all');

  const [generatingFor, setGeneratingFor] = useState<{ personId: string; existing?: PayrollRecord } | null>(null);
  const [allowancesOverride, setAllowancesOverride] = useState('');
  const [bonusKz, setBonusKz] = useState('');
  const [bonusDescription, setBonusDescription] = useState('');
  const [otherDeductionsKz, setOtherDeductionsKz] = useState('');
  const [otherDeductionsDescription, setOtherDeductionsDescription] = useState('');
  const [notes, setNotes] = useState('');
  const [formError, setFormError] = useState('');

  const [viewing, setViewing] = useState<PayrollRecord | null>(null);
  const [paying, setPaying] = useState<PayrollRecord | null>(null);
  const [paymentMethod, setPaymentMethod] = useState<NonNullable<PayrollRecord['paymentMethod']>>('transferencia');
  const [paymentDate, setPaymentDate] = useState(today.toISOString().slice(0, 10));
  const [cancelling, setCancelling] = useState<PayrollRecord | null>(null);
  const [cancelReason, setCancelReason] = useState('');
  const [deleting, setDeleting] = useState<PayrollRecord | null>(null);

  const [isTaxModalOpen, setIsTaxModalOpen] = useState(false);
  const [taxDraft, setTaxDraft] = useState<PayrollTaxSettings>(dbService.getPayrollTaxSettings());
  const [taxError, setTaxError] = useState('');

  const people = useMemo(() => listEligiblePeople(db), [db]);
  const records = db.payrollRecords || [];
  const tax = dbService.getPayrollTaxSettings();

  const monthRecords = useMemo(() => {
    const map = new Map<string, PayrollRecord>();
    records
      .filter((r) => r.referenceMonth === month && r.referenceYear === year)
      .forEach((r) => map.set(r.personId, r));
    return map;
  }, [records, month, year]);

  const summary = useMemo(() => summarizePayrollMonth(records, month, year), [records, month, year]);

  const rows = useMemo(() => {
    const q = searchTerm.trim().toLowerCase();
    return people
      .map((p) => ({ person: p, record: monthRecords.get(p.id) }))
      .filter(({ person }) => !q || person.name.toLowerCase().includes(q) || person.role.toLowerCase().includes(q))
      .filter(({ record }) => {
        if (statusFilter === 'all') return true;
        if (statusFilter === 'pendente') return !record || record.status === 'pendente';
        return record?.status === statusFilter;
      })
      .sort((a, b) => a.person.name.localeCompare(b.person.name, 'pt'));
  }, [people, monthRecords, searchTerm, statusFilter]);
  const { page, setPage, pageItems: visibleRows } = usePagedList(rows, [searchTerm, statusFilter]);

  const run = async (action: () => void, loadingMessage: string): Promise<{ ok: boolean; error?: string }> => {
    try {
      await runGlobalOperation(action, { loadingMessage, requiredRule: 'rh.payroll.manage', userRole: currentUserRole });
      return { ok: true };
    } catch (err: any) {
      return { ok: false, error: err?.message };
    }
  };

  const yearOptions = useMemo(() => {
    const years = new Set<number>([year]);
    records.forEach((r) => years.add(r.referenceYear));
    years.add(today.getFullYear());
    return Array.from(years).sort((a, b) => b - a);
  }, [records, year]);

  const openGenerate = (personId: string, existing?: PayrollRecord) => {
    setGeneratingFor({ personId, existing });
    setAllowancesOverride(existing ? String(existing.allowancesKz) : '');
    setBonusKz(existing ? String(existing.bonusKz) : '');
    setBonusDescription(existing?.bonusDescription || '');
    setOtherDeductionsKz(existing ? String(existing.otherDeductionsKz) : '');
    setOtherDeductionsDescription(existing?.otherDeductionsDescription || '');
    setNotes(existing?.notes || '');
    setFormError('');
  };

  const previewPerson = generatingFor ? people.find((p) => p.id === generatingFor.personId) : undefined;
  const previewComputation = useMemo(() => {
    if (!previewPerson) return null;
    return computePayroll(
      {
        baseSalaryKz: previewPerson.baseSalaryKz || 0,
        allowancesKz: allowancesOverride !== '' ? Number(allowancesOverride) : previewPerson.allowancesKz || 0,
        bonusKz: Number(bonusKz) || 0,
        otherDeductionsKz: Number(otherDeductionsKz) || 0
      },
      tax
    );
  }, [previewPerson, allowancesOverride, bonusKz, otherDeductionsKz, tax]);

  const handleGenerate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!generatingFor) return;
    if (!acl.can('rh.payroll.manage')) {
      acl.guard('rh.payroll.manage', () => undefined);
      return;
    }

    let failure = '';
    const result = await run(() => {
      const r = dbService.generatePayrollRecord({
        personId: generatingFor.personId,
        referenceMonth: month,
        referenceYear: year,
        allowancesOverrideKz: allowancesOverride !== '' ? Number(allowancesOverride) : undefined,
        bonusKz: Number(bonusKz) || 0,
        bonusDescription: bonusDescription.trim() || undefined,
        otherDeductionsKz: Number(otherDeductionsKz) || 0,
        otherDeductionsDescription: otherDeductionsDescription.trim() || undefined,
        notes: notes.trim() || undefined
      });
      if (!r.success) {
        failure = r.error || '';
        throw new Error(r.error);
      }
    }, generatingFor.existing ? 'A recalcular recibo de vencimento...' : 'A gerar recibo de vencimento...');

    if (result.ok) setGeneratingFor(null);
    else setFormError(failure || result.error || 'Não foi possível gerar o recibo.');
  };

  const handleBulkGenerate = async () => {
    if (!acl.can('rh.payroll.manage')) {
      acl.guard('rh.payroll.manage', () => undefined);
      return;
    }
    const confirmed = await showAppConfirm(
      `Gerar recibos de vencimento para todas as pessoas elegíveis sem recibo em ${monthLabel(month)}/${year}? Recibos já existentes não serão alterados.`,
      { title: 'Gerar Folha do Mês', variant: 'info', confirmLabel: 'Gerar' }
    );
    if (!confirmed) return;

    await run(() => {
      dbService.bulkGeneratePayroll(month, year);
    }, `A gerar folha de pagamento de ${monthLabel(month)}/${year}...`);
  };

  const handleConfirmPayment = async () => {
    if (!paying) return;
    const target = paying;
    setPaying(null);
    let failure = '';
    await run(() => {
      const r = dbService.markPayrollPaid(target.id, paymentMethod, paymentDate);
      if (!r.success) {
        failure = r.error || '';
        throw new Error(r.error);
      }
    }, `A confirmar pagamento de ${target.personName}...`);
    if (failure) showAppAlert(failure, { title: 'Não foi possível confirmar', variant: 'error' });
  };

  const handleCancel = async () => {
    if (!cancelling) return;
    const target = cancelling;
    setCancelling(null);
    await run(() => {
      dbService.cancelPayrollRecord(target.id, cancelReason.trim() || undefined);
    }, `A cancelar recibo de ${target.personName}...`);
    setCancelReason('');
  };

  const handleDelete = async () => {
    if (!deleting) return;
    const target = deleting;
    setDeleting(null);
    await run(() => {
      dbService.deletePayrollRecord(target.id);
    }, `A eliminar recibo de ${target.personName}...`);
  };

  const handleExportCsv = () => {
    const csv = payrollRecordsToCsv(summary.records);
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `folha_pagamento_${monthLabel(month)}_${year}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const addBracket = () => {
    setTaxDraft({
      ...taxDraft,
      irtBrackets: [...taxDraft.irtBrackets, { uptoKz: null, ratePercent: 0 }]
    });
  };

  const handleSaveTax = async () => {
    setTaxError('');
    if (taxDraft.irtBrackets.length === 0) {
      setTaxError('A tabela de IRT precisa de pelo menos um escalão.');
      return;
    }
    if (!acl.can('rh.payroll.manage')) {
      acl.guard('rh.payroll.manage', () => undefined);
      return;
    }
    await run(() => {
      dbService.savePayrollTaxSettings(taxDraft);
    }, 'A guardar tabela de retenção (INSS/IRT)...');
    setIsTaxModalOpen(false);
  };

  return (
    <div className="flex flex-col w-full gap-6 pb-12">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <span className="text-[11px] font-bold uppercase tracking-widest text-slate-500">RECURSOS HUMANOS</span>
            <span className="w-1.5 h-1.5 rounded-full bg-[#0b1f3a]" />
            <span className="text-xs font-semibold text-[#0b1f3a]">FOLHA DE PAGAMENTO</span>
          </div>
          <h1 className="font-headline text-2xl lg:text-3xl font-extrabold text-[#0b1f3a] tracking-tight">
            PAGAMENTO DE SALÁRIO
          </h1>
          <p className="text-xs text-slate-500 mt-0.5">
            Recibos de vencimento mensais de docentes e funcionários, com cálculo automático de INSS (3%) e IRT
            progressivo. A tabela de retenção é uma referência de gestão — confirme sempre com a AGT.
          </p>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          {acl.can('rh.payroll.manage') && (
            <button
              onClick={() => {
                setTaxDraft(dbService.getPayrollTaxSettings());
                setIsTaxModalOpen(true);
              }}
              className="flex items-center gap-2 px-3 py-2.5 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold text-xs shrink-0"
            >
              <span className="material-symbols-outlined text-[18px]">tune</span>
              <span>TABELA INSS/IRT</span>
            </button>
          )}
          <button
            onClick={handleExportCsv}
            className="flex items-center gap-2 px-3 py-2.5 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold text-xs shrink-0"
          >
            <span className="material-symbols-outlined text-[18px]">download</span>
            <span>CSV</span>
          </button>
          {acl.can('rh.payroll.manage') && (
            <button
              onClick={handleBulkGenerate}
              className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-[#0b1f3a] hover:bg-[#7a0c0c] active:scale-[0.98] transition-all duration-200 text-white font-bold text-xs shadow-sm shrink-0"
            >
              <span className="material-symbols-outlined text-[18px]">request_quote</span>
              <span>GERAR FOLHA DO MÊS</span>
            </button>
          )}
        </div>
      </div>

      {/* Seletor de período */}
      <div className="bg-white p-4 rounded-2xl border border-slate-200 shadow-xs flex flex-col md:flex-row items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <select
            value={month}
            onChange={(e) => setMonth(Number(e.target.value))}
            className="h-9 px-3 rounded-lg bg-slate-100 text-xs font-semibold text-slate-700 border-0 focus:ring-1 focus:ring-[#0b1f3a]"
          >
            {MONTH_LABELS.map((label, idx) => (
              <option key={label} value={idx + 1}>
                {label}
              </option>
            ))}
          </select>
          <select
            value={year}
            onChange={(e) => setYear(Number(e.target.value))}
            className="h-9 px-3 rounded-lg bg-slate-100 text-xs font-semibold text-slate-700 border-0 focus:ring-1 focus:ring-[#0b1f3a]"
          >
            {yearOptions.map((y) => (
              <option key={y} value={y}>
                {y}
              </option>
            ))}
          </select>
        </div>
        <div className="relative flex items-center w-full md:w-72 border border-slate-400/30 bg-slate-50/60 focus-within:border-slate-400/70 focus-within:bg-white transition-colors">
          <span className="material-symbols-outlined ml-3 text-slate-400 text-[18px] shrink-0">search</span>
          <input
            type="text"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            placeholder="Pesquisar por nome ou cargo..."
            className="w-full h-9 pl-2 pr-3 bg-transparent border-0 outline-none focus:ring-0 text-xs text-slate-800 placeholder:text-slate-400"
          />
        </div>
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value as any)}
          className="h-9 px-3 rounded-lg bg-slate-100 text-xs font-semibold text-slate-700 border-0 focus:ring-1 focus:ring-[#0b1f3a]"
        >
          <option value="all">Todos os Estados</option>
          <option value="pendente">Pendente / Não gerado</option>
          <option value="pago">Pago</option>
          <option value="cancelado">Cancelado</option>
        </select>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        {[
          { label: 'Recibos Gerados', value: summary.count, icon: 'receipt_long' },
          { label: 'Pagos', value: summary.paidCount, icon: 'check_circle' },
          { label: 'Pendentes', value: summary.pendingCount, icon: 'schedule' },
          { label: 'Total Bruto', value: formatKz(summary.totalGross), icon: 'payments' },
          { label: 'Total Líquido', value: formatKz(summary.totalNet), icon: 'account_balance_wallet' }
        ].map((k) => (
          <div key={k.label} className="bg-white border border-slate-200 rounded-2xl p-4 flex items-center gap-3">
            <div className="w-10 h-10 bg-slate-100 text-[#0b1f3a] flex items-center justify-center rounded-lg shrink-0">
              <span className="material-symbols-outlined text-[22px]">{k.icon}</span>
            </div>
            <div className="min-w-0">
              <div className="font-mono text-base font-extrabold text-[#0b1f3a] leading-none truncate">{k.value}</div>
              <div className="text-[11px] text-slate-500 font-semibold mt-1">{k.label}</div>
            </div>
          </div>
        ))}
      </div>

      {/* Tabela */}
      <div className="bg-white rounded-2xl border border-slate-200 shadow-xs overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead>
              <tr className="bg-[#0b1f3a] text-white font-bold uppercase text-[10px] tracking-wider border-b border-slate-800">
                <th className="py-3.5 px-4 text-white">Nome & Cargo</th>
                <th className="py-3.5 px-3 text-white">Salário Base</th>
                <th className="py-3.5 px-3 text-white">Bruto</th>
                <th className="py-3.5 px-3 text-white">INSS / IRT</th>
                <th className="py-3.5 px-3 text-white">Líquido</th>
                <th className="py-3.5 px-3 text-white">Estado</th>
                <th className="py-3.5 px-4 text-right text-white">Ações</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {rows.length === 0 ? (
                <tr>
                  <td colSpan={7} className="py-12 text-center text-slate-400 text-xs">
                    Nenhum docente ou funcionário encontrado para os filtros selecionados.
                  </td>
                </tr>
              ) : (
                visibleRows.map(({ person, record }) => (
                  <tr key={person.id} className="hover:bg-slate-50 transition-colors">
                    <td className="py-3.5 px-4">
                      <div className="font-bold text-[#0b1f3a]">{person.name}</div>
                      <div className="text-[11px] text-slate-500">
                        {person.role} {person.type === 'professor' ? '· Docente' : '· Funcionário'}
                      </div>
                    </td>
                    <td className="py-3.5 px-3 font-mono text-slate-700">{formatKz(person.baseSalaryKz)}</td>
                    <td className="py-3.5 px-3 font-mono text-slate-700">{record ? formatKz(record.grossSalaryKz) : '—'}</td>
                    <td className="py-3.5 px-3 font-mono text-slate-500">
                      {record ? `${formatKz(record.inssEmployeeKz)} / ${formatKz(record.irtKz)}` : '—'}
                    </td>
                    <td className="py-3.5 px-3 font-mono font-bold text-[#0b1f3a]">
                      {record ? formatKz(record.netSalaryKz) : '—'}
                    </td>
                    <td className="py-3.5 px-3">
                      {record ? (
                        <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${PAYROLL_STATUS_META[record.status].badge}`}>
                          {PAYROLL_STATUS_META[record.status].label}
                        </span>
                      ) : (
                        <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-slate-100 text-slate-500">Não gerado</span>
                      )}
                    </td>
                    <td className="py-3.5 px-4 text-right">
                      <div className="flex items-center justify-end gap-1">
                        {record && (
                          <button
                            onClick={() => setViewing(record)}
                            className="p-1.5 rounded-lg text-slate-500 hover:text-[#0b1f3a] hover:bg-slate-100 active:scale-[0.98] transition-all cursor-pointer"
                            title="Ver recibo"
                          >
                            <span className="material-symbols-outlined text-[18px]">visibility</span>
                          </button>
                        )}
                        {acl.can('rh.payroll.manage') && (record?.status !== 'pago') && (
                          <button
                            onClick={() => openGenerate(person.id, record)}
                            className="p-1.5 rounded-lg text-slate-500 hover:text-blue-700 hover:bg-slate-100 active:scale-[0.98] transition-all cursor-pointer"
                            title={record ? 'Recalcular recibo' : 'Gerar recibo'}
                          >
                            <span className="material-symbols-outlined text-[18px]">{record ? 'edit' : 'add_circle'}</span>
                          </button>
                        )}
                        {acl.can('rh.payroll.manage') && record && record.status === 'pendente' && (
                          <button
                            onClick={() => {
                              setPaying(record);
                              setPaymentDate(today.toISOString().slice(0, 10));
                            }}
                            className="p-1.5 rounded-lg text-slate-500 hover:text-emerald-700 hover:bg-slate-100 active:scale-[0.98] transition-all cursor-pointer"
                            title="Confirmar pagamento"
                          >
                            <span className="material-symbols-outlined text-[18px]">paid</span>
                          </button>
                        )}
                        {acl.can('rh.payroll.manage') && record && record.status !== 'cancelado' && (
                          <button
                            onClick={() => setCancelling(record)}
                            className="p-1.5 rounded-lg text-slate-400 hover:text-amber-700 hover:bg-amber-50 active:scale-[0.98] transition-all cursor-pointer"
                            title="Cancelar recibo"
                          >
                            <span className="material-symbols-outlined text-[18px]">cancel</span>
                          </button>
                        )}
                        {acl.can('rh.payroll.manage') && record && record.status !== 'pago' && (
                          <button
                            onClick={() => setDeleting(record)}
                            className="p-1.5 rounded-lg text-slate-400 hover:text-red-700 hover:bg-red-50 active:scale-[0.98] transition-all cursor-pointer"
                            title="Eliminar recibo"
                          >
                            <span className="material-symbols-outlined text-[18px]">delete</span>
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
          <TablePagination total={rows.length} page={page} onPageChange={setPage} />
        </div>
      </div>

      {/* Modal: Gerar/Recalcular Recibo */}
      {generatingFor && previewPerson && (
        <div
          className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-3 sm:p-6"
          onClick={(e) => {
            if (e.target === e.currentTarget) setGeneratingFor(null);
          }}
        >
          <div className="bg-white max-w-xl w-full shadow-2xl border border-slate-400 overflow-hidden flex flex-col max-h-[94vh]">
            <FormModalHeader
              title={generatingFor.existing ? 'Recalcular Recibo' : 'Gerar Recibo de Vencimento'}
              subtitle={`${previewPerson.name} · ${monthLabel(month)}/${year}`}
              icon="request_quote"
              onClose={() => setGeneratingFor(null)}
            />
            <form onSubmit={handleGenerate} className="flex-1 overflow-y-auto p-6 text-xs space-y-5">
              <div className="space-y-3">
                <SectionTitle icon="payments">Componentes Salariais</SectionTitle>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label className={labelCls}>Salário Base (Kz)</label>
                    <input type="text" disabled value={formatKz(previewPerson.baseSalaryKz)} className={`${inputCls} bg-slate-50 text-slate-500`} />
                  </div>
                  <div>
                    <label className={labelCls}>Subsídios (Kz)</label>
                    <input
                      type="number"
                      min={0}
                      value={allowancesOverride}
                      onChange={(e) => setAllowancesOverride(e.target.value)}
                      placeholder={String(previewPerson.allowancesKz || 0)}
                      className={inputCls}
                    />
                  </div>
                  <div>
                    <label className={labelCls}>Bónus / Prémio (Kz)</label>
                    <input type="number" min={0} value={bonusKz} onChange={(e) => setBonusKz(e.target.value)} className={inputCls} />
                  </div>
                  <div>
                    <label className={labelCls}>Descrição do Bónus</label>
                    <input type="text" value={bonusDescription} onChange={(e) => setBonusDescription(e.target.value)} className={inputCls} />
                  </div>
                  <div>
                    <label className={labelCls}>Outros Descontos (Kz)</label>
                    <input
                      type="number"
                      min={0}
                      value={otherDeductionsKz}
                      onChange={(e) => setOtherDeductionsKz(e.target.value)}
                      className={inputCls}
                    />
                  </div>
                  <div>
                    <label className={labelCls}>Motivo do Desconto</label>
                    <input
                      type="text"
                      value={otherDeductionsDescription}
                      onChange={(e) => setOtherDeductionsDescription(e.target.value)}
                      className={inputCls}
                    />
                  </div>
                </div>
              </div>

              {previewComputation && (
                <div className="space-y-2 bg-slate-50 border border-slate-200 rounded-lg p-4">
                  <SectionTitle icon="calculate">Simulação</SectionTitle>
                  <div className="grid grid-cols-2 gap-y-1.5 text-[11px] pt-2">
                    <span className="text-slate-500">Salário Bruto</span>
                    <span className="text-right font-mono font-bold text-slate-800">{formatKz(previewComputation.grossSalaryKz)}</span>
                    <span className="text-slate-500">INSS ({tax.inssEmployeeRatePercent}%)</span>
                    <span className="text-right font-mono text-red-700">− {formatKz(previewComputation.inssEmployeeKz)}</span>
                    <span className="text-slate-500">IRT</span>
                    <span className="text-right font-mono text-red-700">− {formatKz(previewComputation.irtKz)}</span>
                    <span className="font-bold text-slate-800 pt-1 border-t border-slate-200 mt-1">Salário Líquido</span>
                    <span className="text-right font-mono font-extrabold text-[#0b1f3a] pt-1 border-t border-slate-200 mt-1">
                      {formatKz(previewComputation.netSalaryKz)}
                    </span>
                  </div>
                </div>
              )}

              <div>
                <label className={labelCls}>Observações</label>
                <textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} className="w-full px-3 py-2 bg-white border border-slate-300 text-slate-800 focus:border-[#0b1f3a] focus:outline-none text-xs resize-none" />
              </div>

              {formError && (
                <Notice tone="error" icon="error">
                  <span>{formError}</span>
                </Notice>
              )}

              <div className="pt-4 flex items-center justify-end gap-2 border-t border-slate-300">
                <button type="button" onClick={() => setGeneratingFor(null)} className="px-4 py-2 bg-slate-200 hover:bg-slate-300 text-slate-800 font-bold text-xs cursor-pointer border border-slate-300">
                  Cancelar
                </button>
                <button type="submit" className="px-5 py-2 bg-[#0b1f3a] hover:bg-[#7a0c0c] text-white font-bold text-xs cursor-pointer transition-colors border border-[#0b1f3a] flex items-center gap-1.5">
                  <span className="material-symbols-outlined text-[16px]">save</span>
                  <span>{generatingFor.existing ? 'RECALCULAR' : 'GERAR RECIBO'}</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal: Ver Recibo */}
      {viewing && (
        <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-3 sm:p-6" onClick={(e) => { if (e.target === e.currentTarget) setViewing(null); }}>
          <div className="bg-white max-w-lg w-full shadow-2xl border border-slate-400 overflow-hidden flex flex-col max-h-[94vh]">
            <FormModalHeader
              title="Recibo de Vencimento"
              subtitle={`${viewing.personName} · ${monthLabel(viewing.referenceMonth)}/${viewing.referenceYear}`}
              icon="receipt_long"
              badge={PAYROLL_STATUS_META[viewing.status].label}
              onClose={() => setViewing(null)}
            />
            <div className="flex-1 overflow-y-auto p-6 text-xs space-y-1.5">
              {(
                [
                  ['Cargo', viewing.personRole],
                  ['Salário Base', formatKz(viewing.baseSalaryKz)],
                  ['Subsídios', formatKz(viewing.allowancesKz)],
                  ['Bónus', viewing.bonusKz ? formatKz(viewing.bonusKz) : undefined],
                  ['Salário Bruto', formatKz(viewing.grossSalaryKz)],
                  ['INSS (Trabalhador)', `− ${formatKz(viewing.inssEmployeeKz)}`],
                  ['IRT', `− ${formatKz(viewing.irtKz)}`],
                  ['Outros Descontos', viewing.otherDeductionsKz ? `− ${formatKz(viewing.otherDeductionsKz)}` : undefined],
                  ['Salário Líquido', formatKz(viewing.netSalaryKz)],
                  ['Banco', viewing.bankName],
                  ['IBAN', viewing.iban],
                  ['Data de Pagamento', viewing.paymentDate],
                  ['Método de Pagamento', viewing.paymentMethod]
                ] as Array<[string, string | undefined]>
              )
                .filter(([, v]) => !!v)
                .map(([k, v]) => (
                  <div key={k} className="flex justify-between border-b border-slate-100 py-1.5 gap-4">
                    <span className="uppercase font-bold text-[10px] tracking-wide text-slate-500 shrink-0">{k}</span>
                    <span className="font-mono font-semibold text-slate-800 text-right break-words">{v}</span>
                  </div>
                ))}
              {viewing.notes && (
                <div className="border-t border-slate-100 pt-2 mt-1">
                  <span className="block text-[10px] uppercase font-bold text-slate-500 mb-1">Observações</span>
                  <p className="text-slate-800 whitespace-pre-wrap break-words">{viewing.notes}</p>
                </div>
              )}
              <p className="text-[10px] text-slate-400 pt-2">
                Gerado por {viewing.generatedByName} em {new Date(viewing.generatedAt).toLocaleString('pt-PT')}
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Modal: Confirmar Pagamento */}
      {paying && (
        <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4">
          <div className="bg-white max-w-md w-full shadow-2xl overflow-hidden border border-slate-300">
            <FormModalHeader title="Confirmar Pagamento" icon="paid" onClose={() => setPaying(null)} />
            <div className="p-6 space-y-4 text-xs">
              <p className="text-slate-600">
                Confirmar o pagamento de <span className="font-bold">{formatKz(paying.netSalaryKz)}</span> a{' '}
                <span className="font-bold">{paying.personName}</span>?
              </p>
              <div>
                <label className={labelCls}>Método de Pagamento</label>
                <select value={paymentMethod} onChange={(e) => setPaymentMethod(e.target.value as any)} className={inputCls}>
                  <option value="transferencia">Transferência Bancária</option>
                  <option value="multicaixa">Multicaixa</option>
                  <option value="numerario">Numerário</option>
                  <option value="cheque">Cheque</option>
                </select>
              </div>
              <div>
                <label className={labelCls}>Data de Pagamento</label>
                <input type="date" value={paymentDate} onChange={(e) => setPaymentDate(e.target.value)} className={inputCls} />
              </div>
            </div>
            <div className="px-6 py-4 bg-slate-50 border-t border-slate-300 flex items-center justify-end gap-2">
              <button type="button" onClick={() => setPaying(null)} className="px-4 py-2.5 bg-slate-200 hover:bg-slate-300 text-slate-700 font-bold text-xs cursor-pointer border border-slate-300">
                Cancelar
              </button>
              <button type="button" onClick={handleConfirmPayment} className="px-5 py-2.5 bg-emerald-700 hover:bg-emerald-800 text-white font-bold text-xs flex items-center gap-2 cursor-pointer transition-colors border-none">
                <span className="material-symbols-outlined text-[16px]">check_circle</span>
                <span>Confirmar</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal: Cancelar Recibo */}
      {cancelling && (
        <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4">
          <div className="bg-white max-w-md w-full shadow-2xl overflow-hidden border border-slate-300">
            <FormModalHeader title="Cancelar Recibo" icon="cancel" onClose={() => setCancelling(null)} />
            <div className="p-6 space-y-3 text-xs">
              <p className="text-slate-600">
                Cancelar o recibo de <span className="font-bold">{cancelling.personName}</span> referente a{' '}
                {monthLabel(cancelling.referenceMonth)}/{cancelling.referenceYear}?
              </p>
              <div>
                <label className={labelCls}>Motivo (opcional)</label>
                <textarea rows={2} value={cancelReason} onChange={(e) => setCancelReason(e.target.value)} className="w-full px-3 py-2 bg-white border border-slate-300 text-slate-800 focus:border-[#0b1f3a] focus:outline-none text-xs resize-none" />
              </div>
            </div>
            <div className="px-6 py-4 bg-slate-50 border-t border-slate-300 flex items-center justify-end gap-2">
              <button type="button" onClick={() => setCancelling(null)} className="px-4 py-2.5 bg-slate-200 hover:bg-slate-300 text-slate-700 font-bold text-xs cursor-pointer border border-slate-300">
                Voltar
              </button>
              <button type="button" onClick={handleCancel} className="px-5 py-2.5 bg-amber-700 hover:bg-amber-800 text-white font-bold text-xs flex items-center gap-2 cursor-pointer transition-colors border-none">
                <span className="material-symbols-outlined text-[16px]">cancel</span>
                <span>Cancelar Recibo</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal: Eliminar */}
      {deleting && (
        <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4">
          <div className="bg-white max-w-md w-full shadow-2xl overflow-hidden border border-slate-300">
            <FormModalHeader title="Eliminar Recibo" icon="warning" onClose={() => setDeleting(null)} />
            <div className="p-6">
              <h3 className="font-headline text-lg font-bold text-slate-900 text-center">Eliminar recibo de "{deleting.personName}"?</h3>
              <p className="text-xs text-slate-600 text-center mt-2 leading-relaxed">
                O recibo referente a {monthLabel(deleting.referenceMonth)}/{deleting.referenceYear} será removido permanentemente.
              </p>
            </div>
            <div className="px-6 py-4 bg-slate-50 border-t border-slate-300 flex items-center justify-end gap-2">
              <button type="button" onClick={() => setDeleting(null)} className="px-4 py-2.5 bg-slate-200 hover:bg-slate-300 text-slate-700 font-bold text-xs cursor-pointer border border-slate-300">
                Cancelar
              </button>
              <button type="button" onClick={handleDelete} className="px-5 py-2.5 bg-[#b91c1c] hover:bg-[#7a0c0c] text-white font-bold text-xs flex items-center gap-2 cursor-pointer transition-colors border-none">
                <span className="material-symbols-outlined text-[16px]">delete</span>
                <span>Eliminar</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal: Tabela INSS/IRT */}
      {isTaxModalOpen && (
        <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-3 sm:p-6" onClick={(e) => { if (e.target === e.currentTarget) setIsTaxModalOpen(false); }}>
          <div className="bg-white max-w-xl w-full shadow-2xl border border-slate-400 overflow-hidden flex flex-col max-h-[94vh]">
            <FormModalHeader title="Tabela de Retenção (INSS / IRT)" subtitle="Referência de gestão — confirme com a AGT" icon="tune" onClose={() => setIsTaxModalOpen(false)} />
            <div className="flex-1 overflow-y-auto p-6 text-xs space-y-5">
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <div>
                  <label className={labelCls}>INSS Trabalhador (%)</label>
                  <input
                    type="number"
                    step="0.1"
                    value={taxDraft.inssEmployeeRatePercent}
                    onChange={(e) => setTaxDraft({ ...taxDraft, inssEmployeeRatePercent: Number(e.target.value) })}
                    className={inputCls}
                  />
                </div>
                <div>
                  <label className={labelCls}>INSS Patronal (%)</label>
                  <input
                    type="number"
                    step="0.1"
                    value={taxDraft.inssEmployerRatePercent}
                    onChange={(e) => setTaxDraft({ ...taxDraft, inssEmployerRatePercent: Number(e.target.value) })}
                    className={inputCls}
                  />
                </div>
                <div>
                  <label className={labelCls}>Isenção de IRT (Kz)</label>
                  <input
                    type="number"
                    value={taxDraft.irtExemptionThresholdKz}
                    onChange={(e) => setTaxDraft({ ...taxDraft, irtExemptionThresholdKz: Number(e.target.value) })}
                    className={inputCls}
                  />
                </div>
              </div>

              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <SectionTitle icon="stacked_line_chart">Escalões Progressivos de IRT</SectionTitle>
                  <button type="button" onClick={addBracket} className="text-[11px] font-bold text-[#0b1f3a] hover:underline shrink-0 ml-2">
                    + Adicionar Escalão
                  </button>
                </div>
                {taxDraft.irtBrackets.map((b, idx) => (
                  <div key={idx} className="grid grid-cols-[1fr_1fr_auto] gap-2 items-center">
                    <input
                      type="number"
                      placeholder="Até (Kz) — vazio = sem limite"
                      value={b.uptoKz ?? ''}
                      onChange={(e) => {
                        const brackets = [...taxDraft.irtBrackets];
                        brackets[idx] = { ...b, uptoKz: e.target.value === '' ? null : Number(e.target.value) };
                        setTaxDraft({ ...taxDraft, irtBrackets: brackets });
                      }}
                      className={inputCls}
                    />
                    <input
                      type="number"
                      step="0.1"
                      placeholder="Taxa (%)"
                      value={b.ratePercent}
                      onChange={(e) => {
                        const brackets = [...taxDraft.irtBrackets];
                        brackets[idx] = { ...b, ratePercent: Number(e.target.value) };
                        setTaxDraft({ ...taxDraft, irtBrackets: brackets });
                      }}
                      className={inputCls}
                    />
                    <button
                      type="button"
                      onClick={() => setTaxDraft({ ...taxDraft, irtBrackets: taxDraft.irtBrackets.filter((_, i) => i !== idx) })}
                      className="p-1.5 text-slate-400 hover:text-red-700 cursor-pointer"
                      title="Remover escalão"
                    >
                      <span className="material-symbols-outlined text-[18px]">delete</span>
                    </button>
                  </div>
                ))}
                <button
                  type="button"
                  onClick={() => setTaxDraft(DEFAULT_PAYROLL_TAX_SETTINGS)}
                  className="text-[11px] text-slate-400 hover:text-slate-600 underline"
                >
                  Repor tabela de referência por omissão
                </button>
              </div>

              {taxError && (
                <Notice tone="error" icon="error">
                  <span>{taxError}</span>
                </Notice>
              )}
            </div>
            <div className="px-6 py-4 bg-slate-50 border-t border-slate-300 flex items-center justify-end gap-2 shrink-0">
              <button type="button" onClick={() => setIsTaxModalOpen(false)} className="px-4 py-2.5 bg-slate-200 hover:bg-slate-300 text-slate-700 font-bold text-xs cursor-pointer border border-slate-300">
                Cancelar
              </button>
              <button type="button" onClick={handleSaveTax} className="px-5 py-2.5 bg-[#0b1f3a] hover:bg-[#7a0c0c] text-white font-bold text-xs flex items-center gap-2 cursor-pointer transition-colors border-none">
                <span className="material-symbols-outlined text-[16px]">save</span>
                <span>Guardar Tabela</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
