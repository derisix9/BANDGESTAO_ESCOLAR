import { TablePagination, usePagedList } from '../components/TablePagination';
import { isCashRegisterRequired } from '../utils/platformLock';
import React, { useState, useEffect, useDeferredValue } from 'react';
import { SchoolDatabase, TuitionInvoice, UserRole } from '../types';
import { dbService } from '../services/db';
import { InvoiceReceiptModal } from '../components/InvoiceReceiptModal';
import { PayByReference } from '../components/PayByReference';
import { PaymentModal } from '../components/PaymentModal';
import { ServicesCatalogModal } from '../components/ServicesCatalogModal';
import { runGlobalOperation, AsyncButton, showAppAlert } from '../context/OperationContext';
import { useAccessControl } from '../hooks/useAccessControl';
import { Notice } from '../components/Notice';

interface PropinasViewProps {
  db: SchoolDatabase;
  currentUserRole: UserRole;
}

export const PropinasView: React.FC<PropinasViewProps> = ({ db, currentUserRole }) => {
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [classFilter, setClassFilter] = useState<string>('all');
  const [isInvoiceModalOpen, setIsInvoiceModalOpen] = useState(false);
  const [isServicesModalOpen, setIsServicesModalOpen] = useState(false);
  const [paymentModalFee, setPaymentModalFee] = useState<TuitionInvoice | null>(null);
  const [batchFees, setBatchFees] = useState<TuitionInvoice[] | null>(null);
  const [invoiceToDelete, setInvoiceToDelete] = useState<TuitionInvoice | null>(null);
  const [selectedFeeForReceipt, setSelectedFeeForReceipt] = useState<TuitionInvoice | null>(null);
  const [submitStatus, setSubmitStatus] = useState<'idle' | 'loading' | 'success'>('idle');

  // Matriz ACL (Configurações → Perfis & Permissões): decide, por perfil, quem
  // pode liquidar, anular ou consultar. Substitui a verificação fixa por cargo.
  const acl = useAccessControl(currentUserRole);

  // Form State for Payment
  const [paymentMethod, setPaymentMethod] = useState<'mcx' | 'multicaixa' | 'numerario' | 'tpa' | 'debito'>('mcx');

  // Sem caixa aberta não se regista nenhum pagamento (o bloqueio também existe na base de dados).
  const cashOpen = !isCashRegisterRequired() || (db.cashSessions || []).some((c) => c.status === 'aberto');

  // Avisos (caixa fechada, nada selecionado…) NÃO são sucessos: vão numa caixa de aviso do sistema.
  // O sucesso das operações é dado só pelo diálogo global (carregamento → visto animado).
  const showWarning = (msg: string) => showAppAlert(msg, { variant: 'warning' });

  const feesList = React.useMemo(() => {
    const list: TuitionInvoice[] = [];
    const seen = new Set<string>();
    const all = [...(db.invoices || []), ...(db.tuitionFees || [])] as TuitionInvoice[];
    for (const item of all) {
      const key = String(item.id || item.invoiceNumber);
      if (!seen.has(key)) {
        seen.add(key);
        list.push(item);
      }
    }
    return list;
  }, [db.invoices, db.tuitionFees]);

  // Índice de alunos (uma só passagem) em vez de db.students.find() por cada fatura.
  const studentById = React.useMemo(() => {
    const m = new Map<string, (typeof db.students)[number]>();
    for (const st of db.students || []) m.set(String(st.id), st);
    return m;
  }, [db.students]);

  // A escrita na pesquisa não bloqueia o ecrã: o filtro corre com o valor "diferido".
  const deferredSearch = useDeferredValue(searchTerm);

  const filteredFees = React.useMemo(() => {
    const q = deferredSearch.trim().toLowerCase();
    return feesList.filter((fee) => {
      if (statusFilter !== 'all' && fee.status !== statusFilter) return false;
      const student = studentById.get(String(fee.studentId));
      if (classFilter !== 'all' && !(student?.classId === classFilter || fee.className?.includes(classFilter))) return false;
      if (!q) return true;
      const studentName = fee.studentName || student?.name || '';
      return (
        (fee.invoiceNumber && fee.invoiceNumber.toLowerCase().includes(q)) ||
        (fee.period && fee.period.toLowerCase().includes(q)) ||
        studentName.toLowerCase().includes(q) ||
        (fee.procNumber && fee.procNumber.toLowerCase().includes(q))
      );
    });
  }, [feesList, studentById, deferredSearch, statusFilter, classFilter]);

  // Paginação: só se desenham 50 linhas de cada vez (milhares de linhas com imagens é o que pesava).
  const { page, setPage, pageItems: visibleFees } = usePagedList(filteredFees, [deferredSearch, statusFilter, classFilter]);

  // KPI Calculations
  const totalBilledKz = feesList.reduce((acc, f) => acc + (Number(f.totalAmountKz) || 0), 0);
  const totalPaidKz = feesList
    .filter((f) => f.status === 'pago')
    .reduce((acc, f) => acc + (Number(f.totalAmountKz) || 0), 0);
  const totalLateKz = feesList
    .filter((f) => f.status === 'atraso')
    .reduce((acc, f) => acc + (Number(f.totalAmountKz) || 0), 0);
  const totalPendingKz = feesList
    .filter((f) => f.status === 'pendente')
    .reduce((acc, f) => acc + (Number(f.totalAmountKz) || 0), 0);

  const handleOpenPaymentModal = (fee: TuitionInvoice) => {
    if (!cashOpen) { showWarning('Caixa fechada: abra a caixa para registar pagamentos.'); return; }
    setPaymentModalFee(fee);
    setPaymentMethod('mcx');
  };

  const isPayable = (f: TuitionInvoice) => f.status !== 'pago' && Number(f.totalAmountKz || 0) > 0;
  // A seleção de linhas é a global das tabelas (caixas à esquerda + barra "Pagar selecionados").
  useEffect(() => {
    const onBulkPay = (e: Event) => {
      const ids: string[] = (e as CustomEvent).detail?.ids || [];
      const list = feesList.filter((f) => ids.includes(String(f.id)) && isPayable(f));
      if (list.length === 0) { showWarning('Selecione faturas por pagar (com valor) para liquidar em lote.'); return; }
      if (!cashOpen) { showWarning('Caixa fechada: abra a caixa para registar pagamentos.'); return; }
      setBatchFees(list);
      setPaymentMethod('mcx');
    };
    window.addEventListener('bm-bulk-pay', onBulkPay);
    return () => window.removeEventListener('bm-bulk-pay', onBulkPay);
  }, [feesList, cashOpen]);

  const handleConfirmBatchPayment = async () => {
    if (!batchFees || batchFees.length === 0) return;
    if (!cashOpen) { showWarning('Caixa fechada: abra a caixa para registar pagamentos.'); return; }
    const list = batchFees;
    await runGlobalOperation(
      async () => {
        for (const f of list) dbService.addPayment(f.id, paymentMethod, f.totalAmountKz);
        setBatchFees(null);
      },
      {
        loadingMessage: `A processar liquidação de ${list.length} faturas...`,
        successMessage: 'Operação feita com sucesso!',
        successDetails: `${list.length} faturas liquidadas em lote.`,
        requiredRule: 'propinas.liquidate',
        userRole: currentUserRole
      }
    );
  };

  const handleConfirmPayment = async () => {
    if (!paymentModalFee) return;
    if (!cashOpen) { showWarning('Caixa fechada: abra a caixa para registar pagamentos.'); return; }

    await runGlobalOperation(
      async () => {
        dbService.addPayment(paymentModalFee.id, paymentMethod, paymentModalFee.totalAmountKz);
        setPaymentModalFee(null);
      },
      {
        loadingMessage: `A processar liquidação da fatura ${paymentModalFee.invoiceNumber}...`,
        successMessage: 'Operação feita com sucesso!',
        successDetails: `Pagamento da fatura ${paymentModalFee.invoiceNumber} registado no sistema.`,
        requiredRule: 'propinas.liquidate',
        userRole: currentUserRole
      }
    );
  };

  const handleDeleteInvoice = async (fee: TuitionInvoice) => {
    await runGlobalOperation(
      async () => {
        dbService.deleteTuitionFee(fee.id);
      },
      {
        loadingMessage: `A eliminar fatura ${fee.invoiceNumber || fee.id}...`,
        successMessage: 'Operação feita com sucesso!',
        successDetails: `Fatura ${fee.invoiceNumber || fee.id} eliminada.`,
        requiredRule: 'propinas.cancel',
        userRole: currentUserRole
      }
    );
  };

  return (
    <div className="flex flex-col w-full gap-6 pb-12">
      {/* Screen Header (Hidden during Print) */}
      <div className="print:hidden flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-slate-300 pb-4">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <span className="text-[11px] font-bold uppercase tracking-widest text-slate-500">
              Tesouraria E Gestão Financeira
            </span>
            <span className="w-1.5 h-1.5 bg-[#0b1f3a]" />
            <span className="text-xs font-semibold text-[#0b1f3a]"></span>
            <span className="px-2 py-0.5 text-[10px] font-mono font-bold bg-slate-100 text-slate-700 border border-slate-300">
              {feesList.length} faturas registadas
            </span>
          </div>
          <h1 className="font-headline text-2xl lg:text-3xl font-extrabold text-[#0b1f3a] tracking-tight">
            PAGAMENTOS DE PROPINAS E SERVIÇOS
          </h1>
          <p className="text-xs text-slate-500 mt-0.5">
          </p>
        </div>

        {/* Action Buttons */}
        <div className="flex flex-wrap items-center gap-2">
          {(acl.can('propinas.discounts') || acl.can('propinas.liquidate')) && (
            <>
              <button
                type="button"
                onClick={() => setIsServicesModalOpen(true)}
                className="px-4 py-2.5 rounded-none bg-[#0b1f3a] hover:bg-[#132f54] text-white font-bold text-xs flex items-center gap-2 transition-all shadow-none border border-[#0b1f3a] cursor-pointer shrink-0"
                title="Cadastrar e gerir catálogo de serviços e emolumentos da escola"
              >
                <span className="material-symbols-outlined text-[18px]">category</span>
                <span>Gerir Serviços</span>
              </button>

              <button
                type="button"
                onClick={() => {
                  if (!cashOpen) return;
                  setSubmitStatus('idle');
                  setIsInvoiceModalOpen(true);
                }}
                disabled={!cashOpen}
                title={cashOpen ? undefined : 'Caixa fechada: abra a caixa em Despesas & Fluxo de Caixa.'}
                className="px-4 py-2.5 rounded-none bg-[#0b1f3a] hover:bg-[#132f54] text-white font-bold text-xs flex items-center gap-2 transition-all shadow-none border border-[#0b1f3a] cursor-pointer shrink-0 disabled:opacity-40 disabled:cursor-not-allowed"
              >
                <span className="material-symbols-outlined text-[18px]">add_card</span>
                <span>Novo Pagamento</span>
              </button>
            </>
          )}
        </div>
      </div>

      {!cashOpen && (
        <Notice tone="error" icon="lock">
          <span>Caixa fechada: não é possível registar pagamentos de propinas ou de outros serviços. Abra a caixa em <b>Despesas &amp; Fluxo de Caixa</b> para continuar.</span>
        </Notice>
      )}

      {/* KPI Cards Strip - Cards de Estatística com Cores Correspondentes ao Sistema */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 print:hidden">
        {/* Total Facturado - Azul suave com elementos institucionais #0b1f3a */}
        <div data-solid-card className="bg-[#eff4ff] rounded-none p-4 sm:p-5 border-2 border-[#0b1f3a] shadow-xs flex flex-col justify-between relative overflow-hidden">
          <div className="flex items-center justify-between gap-2">
            <span className="text-[10px] uppercase font-black text-[#0b1f3a] tracking-wider block">
              Total Facturado
            </span>
            <div className="w-8 h-8 rounded-none bg-[#0b1f3a] text-white flex items-center justify-center shrink-0 shadow-xs">
              <span className="material-symbols-outlined text-[18px]">receipt_long</span>
            </div>
          </div>
          <div className="font-headline text-2xl sm:text-3xl font-black text-[#0b1f3a] mt-3">
            {totalBilledKz.toLocaleString()} <span className="text-xs font-bold text-slate-700">Kz</span>
          </div>
          <div className="mt-3 pt-2.5 border-t border-blue-200 flex items-center justify-between text-[11px]">
            <span className="text-slate-700 font-medium">Faturas emitidas</span>
            <span className="px-2 py-0.5 bg-[#0b1f3a] text-white font-mono font-bold text-[10px]">
              {feesList.length} Total
            </span>
          </div>
        </div>

        {/* Total Cobrado - Verde esmeralda com indicadores de liquidação */}
        <div data-solid-card className="bg-emerald-50 rounded-none p-4 sm:p-5 border-2 border-emerald-500 shadow-xs flex flex-col justify-between relative overflow-hidden">
          <div className="flex items-center justify-between gap-2">
            <span className="text-[10px] uppercase font-black text-emerald-900 tracking-wider block">
              Total Cobrado (Liquidado)
            </span>
            <div className="w-8 h-8 rounded-none bg-emerald-600 text-white flex items-center justify-center shrink-0 shadow-xs">
              <span className="material-symbols-outlined text-[18px]">check_circle</span>
            </div>
          </div>
          <div className="font-headline text-2xl sm:text-3xl font-black text-emerald-900 mt-3">
            {totalPaidKz.toLocaleString()} <span className="text-xs font-bold text-emerald-700">Kz</span>
          </div>
          <div className="mt-3 pt-2.5 border-t border-emerald-200 flex items-center justify-between text-[11px]">
            <span className="text-emerald-800 font-medium">Liquidação Efetiva</span>
            <span className="px-2 py-0.5 bg-emerald-600 text-white font-mono font-bold text-[10px]">
              {totalBilledKz > 0 ? Math.round((totalPaidKz / totalBilledKz) * 100) : 0}% Cobrado
            </span>
          </div>
        </div>

        {/* Em Atraso - Fundo vinho/avermelhado para destacar valores vencidos e juros */}
        <div data-solid-card className="bg-red-50 rounded-none p-4 sm:p-5 border-2 border-[#7a0c0c] shadow-xs flex flex-col justify-between relative overflow-hidden">
          <div className="flex items-center justify-between gap-2">
            <span className="text-[10px] uppercase font-black text-[#7a0c0c] tracking-wider block">
              Em Atraso (Mora Ativa)
            </span>
            <div className="w-8 h-8 rounded-none bg-[#7a0c0c] text-white flex items-center justify-center shrink-0 shadow-xs">
              <span className="material-symbols-outlined text-[18px]">warning</span>
            </div>
          </div>
          <div className="font-headline text-2xl sm:text-3xl font-black text-[#7a0c0c] mt-3">
            {totalLateKz.toLocaleString()} <span className="text-xs font-bold text-red-700">Kz</span>
          </div>
          <div className="mt-3 pt-2.5 border-t border-red-200 flex items-center justify-between text-[11px]">
            <span className="text-[#7a0c0c] font-medium">Juros de mora ativos</span>
            <span className="px-2 py-0.5 bg-[#7a0c0c] text-white font-mono font-bold text-[10px]">
              {feesList.filter((f) => f.status === 'atraso').length} em mora
            </span>
          </div>
        </div>

        {/* Pendente - Fundo âmbar/dourado para faturas dentro do prazo */}
        <div data-solid-card className="bg-amber-50 rounded-none p-4 sm:p-5 border-2 border-amber-500 shadow-xs flex flex-col justify-between relative overflow-hidden">
          <div className="flex items-center justify-between gap-2">
            <span className="text-[10px] uppercase font-black text-amber-950 tracking-wider block">
              Pendente (A Vencer)
            </span>
            <div className="w-8 h-8 rounded-none bg-amber-600 text-white flex items-center justify-center shrink-0 shadow-xs">
              <span className="material-symbols-outlined text-[18px]">schedule</span>
            </div>
          </div>
          <div className="font-headline text-2xl sm:text-3xl font-black text-amber-950 mt-3">
            {totalPendingKz.toLocaleString()} <span className="text-xs font-bold text-amber-800">Kz</span>
          </div>
          <div className="mt-3 pt-2.5 border-t border-amber-200 flex items-center justify-between text-[11px]">
            <span className="text-amber-900 font-medium">Dentro do prazo legal</span>
            <span className="px-2 py-0.5 bg-amber-600 text-white font-mono font-bold text-[10px]">
              {feesList.filter((f) => f.status === 'pendente').length} a vencer
            </span>
          </div>
        </div>
      </div>

      {/* Filter Bar */}
      <div className="print:hidden bg-white p-4 rounded-none border border-slate-300 flex flex-col md:flex-row items-center justify-between gap-3 shadow-xs">
        {/* Caixa de Pesquisa com borda conforme Imagem 1 */}
        <div className="relative flex items-center w-full md:w-80 border border-slate-300 bg-white rounded-none focus-within:border-[#0b1f3a] focus-within:ring-1 focus-within:ring-[#0b1f3a]/20 transition-all shadow-2xs">
          <span className="material-symbols-outlined ml-3 text-slate-500 text-[18px] shrink-0">
            search
          </span>
          <input
            type="text"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            placeholder="Pesquisar fatura, aluno, processo ou mês..."
            className="w-full h-9 pl-2 pr-8 bg-transparent border-0 border-none outline-none focus:ring-0 text-xs text-slate-900 font-semibold placeholder:text-slate-400"
          />
          {searchTerm && (
            <button
              type="button"
              onClick={() => setSearchTerm('')}
              className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-700 cursor-pointer"
              title="Limpar pesquisa"
            >
              <span className="material-symbols-outlined text-[16px]">close</span>
            </button>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-3 w-full md:w-auto">
          {/* Turma Filter */}
          <select
            value={classFilter}
            onChange={(e) => setClassFilter(e.target.value)}
            className="h-9 px-3 rounded-none bg-white border border-slate-300 text-xs font-semibold text-slate-700 focus:outline-none focus:border-[#0b1f3a]"
          >
            <option value="all">Todas as Turmas</option>
            {db.classes.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>

          {/* Status Filter */}
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="h-9 px-3 rounded-none bg-white border border-slate-300 text-xs font-semibold text-slate-700 focus:outline-none focus:border-[#0b1f3a]"
          >
            <option value="all">Todos os Estados</option>
            <option value="pago">Pagas (Liquidadas)</option>
            <option value="atraso">Em Atraso (Mora)</option>
            <option value="pendente">Pendentes (A Vencer)</option>
          </select>

          <span className="text-xs text-slate-500 font-mono font-bold">
            {filteredFees.length} faturas encontradas
          </span>
        </div>
      </div>

      {/* Tuition Fees Table */}
      <div className="bg-white rounded-none border border-slate-300 overflow-hidden print:border-black">
        {/* Cabeçalho fixo garantido por CSS próprio (scroll vertical no wrapper + thead sticky). */}
        <div data-no-sticky-header className="overflow-auto max-h-[68vh] print:max-h-none print:overflow-visible">
          <table className="w-full text-left text-xs border-collapse">
            <thead className="sticky top-0 z-20 bg-[#0b1f3a] print:static">
              <tr className="bg-[#0b1f3a] text-white font-bold uppercase text-[10px] tracking-wider">
                <th className="py-3.5 px-4 border-r border-slate-700">Fatura & Descrição</th>
                <th className="py-3.5 px-3 border-r border-slate-700">Aluno & Processo</th>
                <th className="py-3.5 px-3 border-r border-slate-700">Período / Turma</th>
                <th className="py-3.5 px-3 border-r border-slate-700">Total (Kz)</th>
                <th className="py-3.5 px-3 border-r border-slate-700">Vencimento</th>
                <th className="py-3.5 px-3 border-r border-slate-700">Referência MCX</th>
                <th className="py-3.5 px-3 border-r border-slate-700">Estado</th>
                <th className="py-3.5 px-4 text-right">Ações</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200">
              {filteredFees.length === 0 ? (
                <tr>
                  <td colSpan={8} className="py-12 text-center text-slate-400 text-xs">
                    Nenhuma fatura encontrada com os filtros selecionados.
                  </td>
                </tr>
              ) : (
                visibleFees.map((fee) => {
                  const student = studentById.get(String(fee.studentId));
                  const studentName = fee.studentName || student?.name || 'Aluno';
                  const procNum = fee.procNumber || student?.procNumber || '—';
                  const className = fee.className || student?.className || '10º Ano';

                  return (
                    <tr key={fee.id} data-invoice-id={String(fee.id)} className="hover:bg-slate-50 transition-colors">
                      <td className="py-3 px-4 border-r border-slate-200">
                        <div className="font-bold text-[#0b1f3a] font-mono text-xs">{fee.invoiceNumber}</div>
                        <span className="text-slate-500 text-[11px] block">{fee.description}</span>
                      </td>

                      <td className="py-3 px-3 border-r border-slate-200">
                        <div className="flex items-center gap-2">
                          {(fee.avatar || student?.avatar) ? (
                            <img
                              src={fee.avatar || student?.avatar}
                              alt={studentName}
                              loading="lazy"
                              decoding="async"
                              className="w-6 h-6 rounded-none object-cover border border-slate-300"
                            />
                          ) : (
                            <span className="w-6 h-6 shrink-0 flex items-center justify-center bg-slate-200 text-slate-600 border border-slate-300 text-[10px] font-bold">
                              {(studentName.trim()[0] || 'A').toUpperCase()}
                            </span>
                          )}
                          <div>
                            <div className="font-semibold text-slate-800">{studentName}</div>
                            <span className="text-slate-500 font-mono text-[10px]">Proc: #{procNum}</span>
                          </div>
                        </div>
                      </td>

                      <td className="py-3 px-3 border-r border-slate-200">
                        <span className="font-medium text-slate-800 block">{fee.period}</span>
                        <span className="text-[10px] text-slate-500">{className}</span>
                      </td>

                      <td className="py-3 px-3 border-r border-slate-200">
                        <div className="font-bold text-[#0b1f3a] font-mono text-xs">
                          {Number(fee.totalAmountKz || 0).toLocaleString()} Kz
                        </div>
                        {Number(fee.lateFeeKz || 0) > 0 && (
                          <span className="text-[10px] text-[#7a0c0c] block font-bold">
                            +{Number(fee.lateFeeKz).toLocaleString()} Kz mora
                          </span>
                        )}
                      </td>

                      <td className="py-3 px-3 font-mono text-slate-700 border-r border-slate-200">
                        {fee.dueDate}
                      </td>

                      <td className="py-3 px-3 border-r border-slate-200">
                        {fee.status !== 'pago' ? (
                          <PayByReference invoice={fee} variant="staff" canCancel={acl.can('propinas.liquidate')} />
                        ) : fee.multicaixaRef ? (
                          <div className="text-[11px] font-mono">
                            <span className="text-slate-500 block text-[10px]">Ent: {fee.multicaixaEntity}</span>
                            <span className="font-bold text-slate-800">{fee.multicaixaRef}</span>
                          </div>
                        ) : (
                          <span className="text-slate-400 italic text-[11px]">Balcão / Caixa</span>
                        )}
                      </td>

                      <td className="py-3 px-3 border-r border-slate-200">
                        {fee.status === 'pago' ? (
                          <span className="px-2 py-0.5 rounded-none bg-emerald-100 text-emerald-800 font-bold text-[10px] border border-emerald-300 block text-center">
                            PAGO
                          </span>
                        ) : fee.status === 'atraso' ? (
                          <span className="px-2 py-0.5 rounded-none bg-red-100 text-[#7a0c0c] font-bold text-[10px] border border-red-300 block text-center">
                            EM ATRASO
                          </span>
                        ) : (
                          <span className="px-2 py-0.5 rounded-none bg-amber-100 text-amber-900 font-bold text-[10px] border border-amber-300 block text-center">
                            PENDENTE
                          </span>
                        )}
                      </td>

                      <td className="py-3 px-4 text-right">
                        <div className="flex items-center justify-end gap-1.5">
                          {fee.status !== 'pago' && acl.can('propinas.liquidate') && (() => {
                            const isZeroValue = Number(fee.totalAmountKz || 0) === 0;
                            return (
                              <button
                                type="button"
                                onClick={() => !isZeroValue && acl.guard('propinas.liquidate', () => handleOpenPaymentModal(fee))}
                                disabled={isZeroValue || !cashOpen}
                                className="px-2.5 py-1 rounded-none bg-emerald-700 hover:bg-emerald-800 text-white font-bold text-[11px] flex items-center gap-1 border border-emerald-700 cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed disabled:bg-slate-400 disabled:border-slate-400 disabled:hover:bg-slate-400"
                                title={isZeroValue ? 'Fatura sem valor (0 Kz) — não há montante a pagar.' : !cashOpen ? 'Caixa fechada: abra a caixa para registar pagamentos.' : 'Liquidar Pagamento'}
                              >
                                <span className="material-symbols-outlined text-[14px]">payments</span>
                                <span>Pagar</span>
                              </button>
                            );
                          })()}

                          <button
                            type="button"
                            onClick={() => setSelectedFeeForReceipt(fee)}
                            className="p-1.5 rounded-none text-slate-700 hover:text-[#0b1f3a] hover:bg-slate-200 cursor-pointer border border-transparent hover:border-slate-300"
                            title="Visualizar e Imprimir Recibo / Factura"
                          >
                            <span className="material-symbols-outlined text-[18px]">receipt</span>
                          </button>

                          <button
                            type="button"
                            onClick={() => acl.guard('propinas.cancel', () => setInvoiceToDelete(fee))}
                            {...acl.buttonProps('propinas.cancel')}
                            className="p-1.5 rounded-none text-red-600 hover:bg-red-50 cursor-pointer border border-transparent hover:border-red-300 disabled:opacity-40 disabled:cursor-not-allowed"
                            title="Eliminar fatura da base de dados"
                          >
                            <span className="material-symbols-outlined text-[18px]">delete</span>
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
          <TablePagination total={filteredFees.length} page={page} onPageChange={setPage} />
        </div>
      </div>

      {/* Modal: Pagamento em lote */}
      {batchFees && (
        <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4 animate-fade-in">
          <div className="bg-white rounded-none max-w-lg w-full shadow-2xl border border-slate-400 overflow-hidden flex flex-col max-h-[92vh]">
            <div className="px-5 py-4 bg-[#0b1f3a] text-white flex items-center justify-between border-b border-slate-700">
              <div className="flex items-center gap-2">
                <span className="material-symbols-outlined text-[20px]">point_of_sale</span>
                <h3 className="font-bold text-sm uppercase tracking-wider">Liquidação em Lote ({batchFees.length})</h3>
              </div>
              <button type="button" onClick={() => setBatchFees(null)} className="text-slate-300 hover:text-white cursor-pointer">
                <span className="material-symbols-outlined text-[20px]">close</span>
              </button>
            </div>
            <div className="p-5 space-y-4 text-xs bg-white overflow-y-auto">
              <div className="border border-slate-200 divide-y divide-slate-100 max-h-48 overflow-y-auto">
                {batchFees.map((f) => (
                  <div key={f.id} className="flex items-center justify-between gap-3 px-3 py-2">
                    <div className="min-w-0">
                      <div className="font-mono font-bold text-[#0b1f3a]">{f.invoiceNumber}</div>
                      <div className="text-slate-500 truncate">{f.studentName} · {f.period}</div>
                    </div>
                    <span className="font-mono font-bold text-slate-800 shrink-0">{Number(f.totalAmountKz).toLocaleString()} Kz</span>
                  </div>
                ))}
              </div>
              <div className="flex justify-between pt-2 border-t border-slate-200 text-sm">
                <span className="font-bold text-slate-800">Total a Liquidar:</span>
                <span className="font-mono font-extrabold text-[#0b1f3a]">{batchFees.reduce((a, f) => a + (Number(f.totalAmountKz) || 0), 0).toLocaleString()} Kz</span>
              </div>
              <div>
                <label className="block uppercase font-bold text-slate-700 mb-1.5 text-[11px]">Canal / Método de Pagamento *</label>
                <select value={paymentMethod} onChange={(e) => setPaymentMethod(e.target.value as any)} className="w-full h-10 px-3 border border-slate-300 text-xs font-semibold">
                  <option value="mcx">Multicaixa Express (MCX)</option>
                  <option value="multicaixa">Referência Multicaixa (ATM/Online)</option>
                  <option value="tpa">TPA Terminal Físico (Cartão)</option>
                  <option value="numerario">Numerário / Caixa Balcão</option>
                  <option value="debito">Transferência Bancária / Débito</option>
                </select>
              </div>
              <div className="pt-3 flex items-center justify-end gap-3 border-t border-slate-300">
                <button type="button" onClick={() => setBatchFees(null)} className="px-4 py-3 bg-slate-200 hover:bg-slate-300 text-slate-800 font-bold text-xs cursor-pointer border border-slate-300">
                  Cancelar
                </button>
                <AsyncButton
                  type="button"
                  variant="success"
                  icon="payments"
                  loadingText="A processar pagamentos..."
                  successText="Operação feita com sucesso!"
                  onAsyncClick={handleConfirmBatchPayment}
                  disabled={!cashOpen}
                  className="px-8 py-3 text-sm font-extrabold"
                >
                  Pagar {batchFees.length} faturas
                </AsyncButton>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Payment Confirmation Modal */}
      {paymentModalFee && (
        <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4 animate-fade-in">
          <div className="bg-white rounded-none max-w-md w-full shadow-2xl border border-slate-400 overflow-hidden flex flex-col">
            <div className="px-5 py-4 bg-[#0b1f3a] text-white flex items-center justify-between border-b border-slate-700">
              <div className="flex items-center gap-2">
                <span className="material-symbols-outlined text-[20px]">point_of_sale</span>
                <h3 className="font-bold text-sm uppercase tracking-wider">Registar Liquidação de Propina</h3>
              </div>
              <button
                type="button"
                onClick={() => setPaymentModalFee(null)}
                className="text-slate-300 hover:text-white cursor-pointer"
              >
                <span className="material-symbols-outlined text-[20px]">close</span>
              </button>
            </div>

            <div className="p-5 space-y-4 text-xs bg-white">
              <div className="p-3 bg-slate-50 border border-slate-200">
                <div className="flex justify-between mb-1">
                  <span className="text-slate-500 font-bold uppercase text-[10px]">Fatura / Documento</span>
                  <span className="font-mono font-bold text-[#0b1f3a]">{paymentModalFee.invoiceNumber}</span>
                </div>
                <div className="flex justify-between mb-1">
                  <span className="text-slate-500">Aluno:</span>
                  <span className="font-bold text-slate-800">{paymentModalFee.studentName}</span>
                </div>
                <div className="flex justify-between mb-1">
                  <span className="text-slate-500">Período:</span>
                  <span className="font-semibold text-slate-800">{paymentModalFee.period}</span>
                </div>
                <div className="flex justify-between pt-2 border-t border-slate-200 text-sm">
                  <span className="font-bold text-slate-800">Total a Liquidar:</span>
                  <span className="font-mono font-extrabold text-[#0b1f3a]">
                    {Number(paymentModalFee.totalAmountKz).toLocaleString()} Kz
                  </span>
                </div>
              </div>

              <div>
                <label className="block uppercase font-bold text-slate-700 mb-1.5 text-[11px]">
                  Canal / Método de Pagamento *
                </label>
                <div className="grid grid-cols-1 gap-2">
                  {[
                    { id: 'mcx', label: 'Multicaixa Express (MCX)', icon: 'smartphone' },
                    { id: 'multicaixa', label: 'Referência Multicaixa (ATM/Online)', icon: 'pin' },
                    { id: 'tpa', label: 'TPA Terminal Físico (Cartão)', icon: 'credit_card' },
                    { id: 'numerario', label: 'Numerário / Caixa Balcão', icon: 'payments' },
                    { id: 'debito', label: 'Transferência Bancária / Débito', icon: 'account_balance' }
                  ].map((method) => (
                    <label
                      key={method.id}
                      className={`flex items-center gap-2.5 p-2.5 border cursor-pointer transition-colors ${
                        paymentMethod === method.id
                          ? 'bg-blue-50 border-[#0b1f3a] font-bold text-[#0b1f3a]'
                          : 'bg-white border-slate-300 text-slate-700 hover:bg-slate-50'
                      }`}
                    >
                      <input
                        type="radio"
                        name="payMethod"
                        value={method.id}
                        checked={paymentMethod === method.id}
                        onChange={() => setPaymentMethod(method.id as any)}
                        className="accent-[#0b1f3a]"
                      />
                      <span className="material-symbols-outlined text-[18px]">{method.icon}</span>
                      <span>{method.label}</span>
                    </label>
                  ))}
                </div>
              </div>

              <div className="pt-3 flex items-center justify-end gap-3 border-t border-slate-300">
                <button
                  type="button"
                  onClick={() => setPaymentModalFee(null)}
                  className="px-4 py-2 bg-slate-200 hover:bg-slate-300 text-slate-800 font-bold text-xs cursor-pointer border border-slate-300"
                >
                  Cancelar
                </button>
                <AsyncButton
                  type="button"
                  variant="primary"
                  icon="verified"
                  loadingText="A confirmar pagamento..."
                  successText="Operação feita com sucesso!"
                  onAsyncClick={handleConfirmPayment}
                  disabled={!cashOpen}
                  className="bg-emerald-800 hover:bg-emerald-900 border-emerald-900"
                >
                  Confirmar & Emitir Recibo
                </AsyncButton>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Modal: Catálogo de Serviços e Emolumentos */}
      {isServicesModalOpen && (
        <ServicesCatalogModal onClose={() => setIsServicesModalOpen(false)} />
      )}

      {/* Modal: Formulário de Pagamento (Imagens 5 e 6) */}
      {isInvoiceModalOpen && (
        <PaymentModal
          db={db}
          onClose={() => setIsInvoiceModalOpen(false)}
          onOpenServicesCatalog={() => setIsServicesModalOpen(true)}
          onSuccess={(newInv) => {
            setIsInvoiceModalOpen(false);
            setSelectedFeeForReceipt(newInv);
          }}
        />
      )}

      {/* Modal: Fatura / Recibo de Pagamento (Imagens 1 e 2) */}
      {selectedFeeForReceipt && (
        <InvoiceReceiptModal
          invoice={selectedFeeForReceipt}
          onClose={() => setSelectedFeeForReceipt(null)}
          institutionSettings={db.settings}
        />
      )}

      {/* ========================================================================= */}
      {/* MODAL: CONFIRMAR ELIMINAÇÃO DE FATURA (CONFORME IMAGEM 1) */}
      {/* ========================================================================= */}
      {invoiceToDelete && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs animate-in fade-in">
          <div className="bg-white max-w-md w-full rounded-none shadow-2xl overflow-hidden border border-slate-400">
            {/* Header com estilo institucional idêntico à Imagem 1 */}
            <div className="bg-[#0b1f3a] text-white px-5 py-3.5 flex items-center justify-between border-b border-slate-800">
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 rounded-none bg-white/10 flex items-center justify-center border border-white/10 text-white">
                  <span className="material-symbols-outlined text-[18px]">delete</span>
                </div>
                <div>
                  <h3 className="font-headline font-bold text-base text-white tracking-tight leading-none">
                    Eliminar Fatura
                  </h3>
                  <p className="text-[11px] text-sky-200 mt-1 font-semibold truncate max-w-[280px]">
                    {invoiceToDelete.invoiceNumber || invoiceToDelete.id} • {invoiceToDelete.studentName}
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setInvoiceToDelete(null)}
                className="w-7 h-7 rounded-none flex items-center justify-center text-slate-300 hover:text-white hover:bg-white/10 transition-colors cursor-pointer"
                title="Fechar"
              >
                <span className="material-symbols-outlined text-[18px]">close</span>
              </button>
            </div>

            {/* Conteúdo idêntico à Imagem 1 */}
            <div className="p-6">
              <div className="w-12 h-12 rounded-none bg-red-100 text-[#a12626] flex items-center justify-center mx-auto mb-4 border border-red-200">
                <span className="material-symbols-outlined text-[28px]">delete_forever</span>
              </div>
              <h3 className="font-headline text-lg font-bold text-slate-900 text-center">
                Eliminar Fatura da Base de Dados?
              </h3>
              <p className="text-xs text-slate-600 text-center mt-2 leading-relaxed">
                Tem a certeza de que deseja eliminar a fatura <strong>{invoiceToDelete.invoiceNumber || invoiceToDelete.id}</strong> ({invoiceToDelete.studentName} • {invoiceToDelete.period || invoiceToDelete.description}) no valor de <strong>{Number(invoiceToDelete.totalAmountKz || 0).toLocaleString()} Kz</strong>? Esta ação é definitiva na base de dados.
              </p>
              <div className="mt-6 flex items-center justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setInvoiceToDelete(null)}
                  className="px-4 py-2 rounded-none bg-slate-200 hover:bg-slate-300 text-slate-700 font-bold text-xs border border-slate-300 cursor-pointer transition-colors"
                >
                  Cancelar
                </button>
                <button
                  type="button"
                  onClick={async () => {
                    const fee = invoiceToDelete;
                    setInvoiceToDelete(null);
                    await handleDeleteInvoice(fee);
                  }}
                  className="px-5 py-2.5 rounded-none bg-[#b91c1c] hover:bg-[#7a0c0c] text-white font-bold text-xs flex items-center gap-2 cursor-pointer transition-colors shadow-none border-none"
                >
                  <span className="material-symbols-outlined text-[16px]">delete</span>
                  <span>Eliminar</span>
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
