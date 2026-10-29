import React, { useState, useMemo } from 'react';
import { isCashRegisterRequired } from '../utils/platformLock';
import { Spinner } from './Spinner';
import { SchoolDatabase, Student, TuitionInvoice, InvoiceItem, SchoolServiceItem } from '../types';
import { dbService } from '../services/db';
import { runGlobalOperation, AsyncButton } from '../context/OperationContext';
import { getFinancialRules, computeTuitionCharges, countEnrolledSiblings } from '../utils/financialRules';
import { getFallbackAcademicYear } from '../utils/academicYear';
import { getPaidTuitionMonths } from '../utils/paidTuitionMonths';
import { SearchableSelect, SearchableOption } from './SearchableSelect';
import { Notice } from './Notice';

interface PaymentModalProps {
  db: SchoolDatabase;
  onClose: () => void;
  onSuccess: (invoice: TuitionInvoice) => void;
  onOpenServicesCatalog?: () => void;
}

const MONTHS_LIST = [
  'Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho',
  'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'
];

interface CartItem {
  id: string;
  code: string;
  name: string;
  priceKz: number;
  quantity: number;
  periodRef: string;
  taxRegime: string;
}

export const PaymentModal: React.FC<PaymentModalProps> = ({
  db,
  onClose,
  onSuccess,
  onOpenServicesCatalog
}) => {
  const students = db.students || [];
  const servicesCatalog: SchoolServiceItem[] = dbService.getServices();
  const currentUser = dbService.getCurrentUser();

  // Selected student — no default selection; the operator must pick one explicitly
  const [selectedStudentId, setSelectedStudentId] = useState<string>('');

  // Tuition months
  const [includeTuition, setIncludeTuition] = useState<boolean>(true);
  const currentMonthName = MONTHS_LIST[new Date().getMonth()];
  const [selectedMonths, setSelectedMonths] = useState<string[]>([currentMonthName]);

  // Outros Emolumentos e Serviços (Shopping Cart) — starts empty; the operator adds real items
  const [cartItems, setCartItems] = useState<CartItem[]>([]);

  // Inputs for adding a service
  const [serviceInputName, setServiceInputName] = useState<string>('');
  const [serviceInputValue, setServiceInputValue] = useState<number | string>(3500);
  const [serviceInputCode, setServiceInputCode] = useState<string>('EMOL-01');

  // Automatic Transaction Number
  const [autoTransactionNumber] = useState<string>(() => dbService.getNextTransactionNumber());

  // Payment details
  const [paymentMethod, setPaymentMethod] = useState<'tpa' | 'mcx' | 'debito' | 'numerario'>('tpa');
  const [paymentDate, setPaymentDate] = useState<string>(new Date().toISOString().split('T')[0]);
  const [isSubmitting, setIsSubmitting] = useState(false);
  // Sem caixa aberta não é possível registar pagamentos de propinas nem de outros serviços.
  const cashOpen = !isCashRegisterRequired() || (db.cashSessions || []).some((c) => c.status === 'aberto');

  // Valor a liquidar agora — só é editável (inferior ao total) quando "Permitir
  // Pagamentos Parciais (Amortização)" está activo em Configurações.
  const [partialAmountInput, setPartialAmountInput] = useState<number | ''>('');

  const selectedStudent = useMemo(() => {
    return students.find((s) => String(s.id) === String(selectedStudentId));
  }, [students, selectedStudentId]);

  // No fictitious fallback amount: if this student has no monthly tuition value
  // configured, treat it as 0 so the operator notices and fills it in, rather
  // than silently charging a made-up figure.
  const monthlyTuition = selectedStudent?.monthlyTuitionKz || 0;

  // Meses de propina já pagos por este aluno (no ano lectivo activo): ficam com selo "PAGO" e bloqueados.
  const activeYear = db.settings?.currentAcademicYear || getFallbackAcademicYear();
  const paidMonths = useMemo(
    () => getPaidTuitionMonths(db.invoices, selectedStudentId, activeYear),
    [db.invoices, selectedStudentId, activeYear]
  );
  // Ao escolher o aluno (ou mudarem os meses pagos): tira da seleção os meses já pagos e, se ficar vazia,
  // propõe o mês actual ou o primeiro mês ainda em aberto.
  React.useEffect(() => {
    setSelectedMonths((prev) => {
      const kept = prev.filter((m) => !paidMonths.has(m));
      if (kept.length) return kept.length === prev.length ? prev : kept;
      const firstOpen = paidMonths.has(currentMonthName) ? MONTHS_LIST.find((m) => !paidMonths.has(m)) : currentMonthName;
      return firstOpen ? [firstOpen] : [];
    });
  }, [paidMonths, currentMonthName]);
  const allMonthsPaid = !!selectedStudent && paidMonths.size >= MONTHS_LIST.length;
  const monthlyTuitionMissing = includeTuition && !!selectedStudent && !selectedStudent.monthlyTuitionKz;

  // Políticas de Prazos & Multas configuradas em Configurações > Tabela Financeira
  // (Módulo 03) — aplicadas automaticamente a cada pagamento de propinas registado.
  const financialRules = useMemo(() => getFinancialRules(db.settings), [db.settings]);

  const siblingCount = useMemo(() => {
    if (!selectedStudent) return 0;
    return countEnrolledSiblings(students, selectedStudent);
  }, [students, selectedStudent]);

  const paymentDateObj = useMemo(() => {
    const [y, m, d] = paymentDate.split('-').map(Number);
    return new Date(y || new Date().getFullYear(), (m || 1) - 1, d || 1);
  }, [paymentDate]);

  const tuitionCharges = useMemo(() => {
    if (!includeTuition || monthlyTuition <= 0) {
      return computeTuitionCharges({
        months: [],
        monthlyTuitionKz: 0,
        paymentDate: paymentDateObj,
        rules: financialRules,
        siblingCount
      });
    }
    return computeTuitionCharges({
      months: selectedMonths,
      monthlyTuitionKz: monthlyTuition,
      paymentDate: paymentDateObj,
      rules: financialRules,
      siblingCount
    });
  }, [includeTuition, monthlyTuition, selectedMonths, paymentDateObj, financialRules, siblingCount]);

  // Aviso de bloqueio: aluno com propinas em atraso e a instituição optou por
  // restringir a emissão de certificados/declarações a quem está em débito.
  const isStudentBlockedByDebt =
    !!selectedStudent &&
    selectedStudent.financialStatus === 'debito' &&
    financialRules.blockCertificatesWithDebt;

  // Opções do seletor pesquisável de alunos (pesquisa por nome, turma e nº de processo).
  const studentOptions: SearchableOption[] = useMemo(
    () =>
      students.map((s) => ({
        value: String(s.id),
        label: s.name,
        sublabel: `Turma: ${s.className || 'Sem turma'} • Processo nº ${s.procNumber || 'S/N'}`,
        badge: s.procNumber || undefined,
        avatar: s.avatar || undefined,
      })),
    [students]
  );

  const toggleMonth = (m: string) => {
    if (paidMonths.has(m)) return;
    if (selectedMonths.includes(m)) {
      if (selectedMonths.length > 1) {
        setSelectedMonths(selectedMonths.filter((item) => item !== m));
      }
    } else {
      setSelectedMonths([...selectedMonths, m]);
    }
  };

  // Handle service selection from catalog dropdown/datalist
  const handleSelectCatalogService = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    const val = e.target.value;
    setServiceInputName(val);
    const found = servicesCatalog.find(
      (s) => s.name.toLowerCase() === val.toLowerCase() || s.code.toLowerCase() === val.toLowerCase()
    );
    if (found) {
      setServiceInputValue(found.defaultPriceKz);
      setServiceInputCode(found.code);
    }
  };

  // Quick add from catalog pill
  const handleQuickAddService = (srv: SchoolServiceItem) => {
    const existingIndex = cartItems.findIndex((c) => c.code === srv.code || c.name === srv.name);
    if (existingIndex >= 0) {
      // Increase quantity
      setCartItems((prev) =>
        prev.map((item, idx) => (idx === existingIndex ? { ...item, quantity: item.quantity + 1 } : item))
      );
    } else {
      const newItem: CartItem = {
        id: `cart-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        code: srv.code,
        name: srv.name,
        priceKz: srv.defaultPriceKz,
        quantity: 1,
        periodRef: db.settings?.currentAcademicYear || getFallbackAcademicYear(),
        taxRegime: srv.taxRegime || 'Isento (Art. 12 CIVA)'
      };
      setCartItems((prev) => [...prev, newItem]);
    }
  };

  // Add custom or catalog service from text box
  const handleAddToCart = (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!serviceInputName.trim()) return;

    const numVal = Math.max(0, Number(serviceInputValue) || 0);
    const matchedService = servicesCatalog.find(
      (s) => s.name.toLowerCase() === serviceInputName.trim().toLowerCase()
    );

    const newItem: CartItem = {
      id: `cart-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      code: matchedService?.code || serviceInputCode || `EMOL-${Math.floor(10 + Math.random() * 90)}`,
      name: serviceInputName.trim(),
      priceKz: numVal,
      quantity: 1,
      periodRef: db.settings?.currentAcademicYear || getFallbackAcademicYear(),
      taxRegime: matchedService?.taxRegime || 'Isento (Art. 12 CIVA)'
    };

    setCartItems((prev) => [...prev, newItem]);
    setServiceInputName('');
    setServiceInputValue(3500);
    setServiceInputCode(`EMOL-${Math.floor(10 + Math.random() * 90)}`);
  };

  const handleUpdateCartQuantity = (id: string, delta: number) => {
    setCartItems((prev) =>
      prev
        .map((item) => {
          if (item.id === id) {
            const newQty = item.quantity + delta;
            return newQty > 0 ? { ...item, quantity: newQty } : null;
          }
          return item;
        })
        .filter(Boolean) as CartItem[]
    );
  };

  const handleRemoveFromCart = (id: string) => {
    setCartItems((prev) => prev.filter((item) => item.id !== id));
  };

  // Totals calculations
  // Valor líquido de propinas já com a multa por mora somada e os descontos
  // (pagamento antecipado + agregado familiar) subtraídos, conforme configurado
  // em Configurações > Tabela Financeira.
  const tuitionTotal = tuitionCharges.totalAmountKz;
  const servicesTotal = cartItems.reduce((sum, item) => sum + item.priceKz * item.quantity, 0);
  const subtotal = tuitionTotal + servicesTotal;
  const stampDuty = Math.round(subtotal * 0.001); // Imposto de Selo (0.1%)
  const grandTotal = subtotal + stampDuty;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedStudent) return;
    if (isSubmitting) return;
    if (!cashOpen) return;
    setIsSubmitting(true);

    // Build Invoice Items
    const items: InvoiceItem[] = [];

    if (includeTuition && selectedMonths.length > 0) {
      items.push({
        code: 'PROP-ESC',
        description: `Propinas Escolares Regulares (${selectedMonths.join(', ')})`,
        periodOrRef: `${selectedMonths.join(', ')} / 2026`,
        unitPriceKz: monthlyTuition,
        quantity: selectedMonths.length,
        discountKz: tuitionCharges.totalDiscountKz,
        taxRegime: 'Isento (Art. 12 CIVA)',
        liquidTotalKz: tuitionTotal
      });

      if (tuitionCharges.lateFeeKz > 0) {
        items.push({
          code: 'MULTA-MORA',
          description: `Multa por Atraso no Pagamento (${financialRules.lateFeePercent}%)`,
          periodOrRef: `${selectedMonths.join(', ')} / 2026`,
          unitPriceKz: tuitionCharges.lateFeeKz,
          quantity: 1,
          discountKz: 0,
          taxRegime: 'Isento (Art. 12 CIVA)',
          liquidTotalKz: tuitionCharges.lateFeeKz
        });
      }
    }

    cartItems.forEach((c) => {
      items.push({
        code: c.code,
        description: c.name,
        periodOrRef: c.periodRef,
        unitPriceKz: c.priceKz,
        quantity: c.quantity,
        discountKz: 0,
        taxRegime: c.taxRegime,
        liquidTotalKz: c.priceKz * c.quantity
      });
    });

    const methodLabels: Record<string, string> = {
      tpa: 'TPA Multicaixa / Caixa Geral',
      mcx: 'Multicaixa Express (MCX)',
      debito: 'Depósito / Transferência Bancária',
      numerario: 'Numerário / Dinheiro em Mão'
    };

    const currentYear = new Date().getFullYear();
    const now = new Date();
    const day = String(paymentDateObj.getDate()).padStart(2, '0');
    const month = String(paymentDateObj.getMonth() + 1).padStart(2, '0');
    const formattedPaymentDate = `${day}/${month}/${paymentDateObj.getFullYear()}`;
    const nextInvNumber = dbService.getNextInvoiceNumber();
    const receiptNum = `RC ${currentYear}/${nextInvNumber.replace(`FT ${currentYear}/`, '')}`;
    const operatorString = `${currentUser?.name || 'Operador'} (${currentUser?.roleTitle || 'Operador de Caixa'})`;

    // Nome do(s) desconto(s) efetivamente aplicado(s), de acordo com as Políticas
    // de Prazos & Multas configuradas — para constar no recibo/fatura oficial.
    const discountNameParts: string[] = [];
    if (tuitionCharges.isEarly && tuitionCharges.earlyDiscountKz > 0) {
      discountNameParts.push(`Pagamento Antecipado (${financialRules.discountPercent}%)`);
    }
    if (tuitionCharges.hasSiblingDiscount && tuitionCharges.siblingDiscountKz > 0) {
      discountNameParts.push(`Agregado Familiar (${financialRules.siblingDiscountPercent}%)`);
    }
    const discountName = discountNameParts.length > 0 ? discountNameParts.join(' + ') : 'Sem Desconto';

    // Pagamento parcial: só é permitido se "Permitir Pagamentos Parciais
    // (Amortização)" estiver activo em Configurações. Caso contrário, o valor a
    // liquidar é sempre o total da fatura.
    const amountBeingPaid = financialRules.allowPartialPayments
      ? Math.min(grandTotal, Math.max(0, Number(partialAmountInput) || grandTotal))
      : grandTotal;
    const isFullyPaid = amountBeingPaid >= grandTotal;

    const invoiceData: Partial<TuitionInvoice> & { studentId: string; totalAmountKz: number } = {
      invoiceNumber: nextInvNumber,
      studentId: String(selectedStudent.id),
      studentName: selectedStudent.name,
      procNumber: selectedStudent.procNumber || '',
      avatar: selectedStudent.avatar,
      className: selectedStudent.className || '',
      guardianName: selectedStudent.guardianName || 'Encarregado de Educação',
      guardianNif: selectedStudent.guardianNif || '',
      guardianPhone: selectedStudent.guardianPhone || '',
      guardianAddress: selectedStudent.address || '',
      studentBiNumber: selectedStudent.biNumber || '',
      operatorName: operatorString,
      description: `Liquidação de ${items.map((i) => i.description.split('(')[0].trim()).join(' + ')}`,
      period: selectedMonths.length > 0 ? selectedMonths.join(', ') : currentMonthName,
      dueDate: formattedPaymentDate,
      totalAmountKz: grandTotal,
      baseAmountKz: subtotal,
      lateFeeKz: tuitionCharges.lateFeeKz,
      status: isFullyPaid ? 'pago' : 'pendente',
      daysLate: tuitionCharges.maxDaysLate,
      method: paymentMethod,
      methodLabel: methodLabels[paymentMethod] || 'TPA Multicaixa',
      bankName: 'Caixa Central / Tesouraria Escolar',
      transactionNumber: autoTransactionNumber,
      paymentDate: formattedPaymentDate,
      receiptNumber: receiptNum,
      receiptGeneratedAt: `${formattedPaymentDate} ${now.toLocaleTimeString('pt-PT', { hour: '2-digit', minute: '2-digit' })}`,
      // Sem hash SAF-T real disponível neste sistema — nunca mostra um valor fixo/inventado.
      items: items,
      subtotalKz: subtotal,
      discountName,
      discountAmountKz: tuitionCharges.totalDiscountKz,
      stampDutyKz: stampDuty,
      totalPaidKz: amountBeingPaid,
      selectedMonths: selectedMonths
    };

    try {
      await runGlobalOperation(
        async () => {
          const created = dbService.recordFullPaymentInvoice(invoiceData);
          setIsSubmitting(false);
          onSuccess(created);
        },
        {
          loadingMessage: 'A processar pagamento e emitir recibo...',
          successMessage: 'Operação feita com sucesso!'
        }
      );
    } catch (err) {
      setIsSubmitting(false);
    }
  };

  return (
    <div
      className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-3 sm:p-6 animate-fade-in"
      onClick={(e) => {
        if (e.target === e.currentTarget && !isSubmitting) onClose();
      }}
    >
      <div className="bg-white rounded-none max-w-4xl w-full shadow-2xl border border-slate-400 overflow-hidden flex flex-col max-h-[95vh]">
        {/* HEADER */}
        <div className="px-6 py-4 bg-[#0b1f3a] text-white flex items-center justify-between border-b border-slate-700 shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-none bg-white/10 flex items-center justify-center text-white border border-white/20">
              <span className="material-symbols-outlined text-[24px]">point_of_sale</span>
            </div>
            <div>
              <h3 className="font-bold text-sm uppercase tracking-wider">
                Registo de Pagamento de Propinas & Serviços
              </h3>
              <p className="text-[11px] text-blue-200">
                Emissão de Recibo Oficial Certificado com N.º de Transação Sequencial
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-slate-300 hover:text-white hover:bg-white/10 p-1 cursor-pointer transition-colors"
          >
            <span className="material-symbols-outlined text-[20px]">close</span>
          </button>
        </div>

        {/* FORM CONTAINER */}
        <form onSubmit={handleSubmit} className="flex-1 overflow-y-auto p-6 space-y-6 text-xs bg-white">
          {!cashOpen && (
            <Notice tone="error" icon="lock">
              <span>Caixa fechada: não é possível registar pagamentos. Abra a caixa em <b>Despesas &amp; Fluxo de Caixa</b> para continuar.</span>
            </Notice>
          )}
          {/* SEÇÃO 1: SELEÇÃO E DADOS DO ALUNO */}
          <div className="space-y-3">
            <div className="flex items-center justify-between border-b border-slate-300 pb-1.5">
              <span className="font-bold text-slate-800 uppercase tracking-wider text-[11px] flex items-center gap-1.5">
                <span className="material-symbols-outlined text-[17px] text-[#0b1f3a]">person_search</span>
                1. Seleção do Estudante
              </span>
              <span className="text-[11px] text-slate-500">
                Total de Alunos Matriculados: <strong>{students.length}</strong>
              </span>
            </div>

            {/* Seletor pesquisável (igual ao do Delegado / Diretor de Turma): ao escrever, mostra os alunos
                correspondentes com foto, turma e nº de processo; ao escolher, fica selecionado para o pagamento. */}
            <SearchableSelect
              id="payment-student"
              label="Aluno para pagamento — pesquise por nome, turma ou nº de processo"
              required
              options={studentOptions}
              value={selectedStudentId}
              onChange={(val) => setSelectedStudentId(val)}
              placeholder="Digite o nome, a turma ou o nº de processo do aluno..."
              emptyMessage="Nenhum aluno encontrado"
            />

            {/* Selected Student Information Card */}
            {selectedStudent && (
              <div className="p-3.5 bg-slate-50 border border-slate-300 flex flex-wrap items-center gap-4">
                <img
                  src={selectedStudent.avatar || '/avatar-padrao.png'}
                  alt={selectedStudent.name}
                  className="w-12 h-14 object-cover border border-[#0b1f3a] shrink-0"
                />
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-x-6 gap-y-1 text-xs flex-1">
                  <div>
                    <span className="text-slate-500 block text-[10px] uppercase">Nome Completo:</span>
                    <strong className="text-slate-900 font-bold">{selectedStudent.name}</strong>
                  </div>
                  <div>
                    <span className="text-slate-500 block text-[10px] uppercase">Turma / Turno:</span>
                    <span className="font-semibold text-slate-800">{selectedStudent.className || '—'}</span>
                  </div>
                  <div>
                    <span className="text-slate-500 block text-[10px] uppercase">Bilhete de Identidade (BI):</span>
                    <span className="font-mono font-bold text-slate-800">{selectedStudent.biNumber || '—'}</span>
                  </div>
                  <div>
                    <span className="text-slate-500 block text-[10px] uppercase">Propina Mensal Base:</span>
                    <span className="font-mono font-bold text-[#0b1f3a]">
                      {monthlyTuition.toLocaleString('pt-PT', { minimumFractionDigits: 2 })} Kz
                    </span>
                    {monthlyTuitionMissing && (
                      <span className="block text-[10px] font-bold text-amber-700 mt-0.5">
                        Sem propina configurada para este aluno — defina o valor em Alunos.
                      </span>
                    )}
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* SEÇÃO 2: PROPINAS ESCOLARES (MENSALIDADES) */}
          <div className="space-y-3">
            <div className="flex items-center justify-between border-b border-slate-300 pb-1.5">
              <label className="font-bold text-slate-800 uppercase tracking-wider text-[11px] flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={includeTuition}
                  onChange={(e) => setIncludeTuition(e.target.checked)}
                  className="w-4 h-4 accent-[#0b1f3a] rounded-none cursor-pointer"
                />
                <span className="flex items-center gap-1.5">
                  <span className="material-symbols-outlined text-[17px] text-[#0b1f3a]">calendar_month</span>
                  2. Propinas Escolares (Mensalidades)
                </span>
              </label>
              {includeTuition && (
                <span className="font-mono font-bold text-[#0b1f3a] text-xs">
                  {selectedMonths.length} Mês(es) = {tuitionTotal.toLocaleString('pt-PT', { minimumFractionDigits: 2 })} Kz
                </span>
              )}
            </div>

            {includeTuition && (
              <div className="p-3.5 bg-slate-50 border border-slate-300 space-y-2">
                {allMonthsPaid && <p className="text-emerald-700 text-[11px] font-bold">Todos os meses deste ano lectivo já estão pagos.</p>}
                {!allMonthsPaid && paidMonths.size > 0 && <p className="text-slate-600 text-[11px]">{paidMonths.size} mês(es) já pago(s) — só os meses em aberto podem ser selecionados.</p>}
                <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-6 gap-2">
                  {MONTHS_LIST.map((m) => {
                    const isPaid = paidMonths.has(m);
                    const isSelected = !isPaid && selectedMonths.includes(m);
                    return (
                      <button
                        key={m}
                        type="button"
                        disabled={isPaid}
                        title={isPaid ? `${m} já está pago` : undefined}
                        data-testid={isPaid ? `month-paid-${m}` : `month-${m}`}
                        onClick={() => toggleMonth(m)}
                        className={`h-9 px-2 text-xs font-bold border transition-colors flex items-center justify-center gap-1 ${
                          isPaid
                            ? 'bg-emerald-50 text-emerald-800 border-emerald-300 cursor-not-allowed'
                            : isSelected
                              ? 'bg-[#0b1f3a] text-white border-[#0b1f3a] cursor-pointer'
                              : 'bg-white text-slate-700 border-slate-300 hover:bg-slate-100 cursor-pointer'
                        }`}
                      >
                        {isPaid && <span className="material-symbols-outlined text-[14px]">verified</span>}
                        {isSelected && <span className="material-symbols-outlined text-[14px]">check</span>}
                        <span className={isPaid ? 'opacity-80' : ''}>{m}</span>
                        {isPaid && <span className="ml-0.5 px-1.5 py-px rounded bg-emerald-600 text-white text-[9px] font-extrabold tracking-wider">PAGO</span>}
                      </button>
                    );
                  })}
                </div>
              </div>
            )}
          </div>

          {/* SEÇÃO 3: OUTROS EMOLUMENTOS E SERVIÇOS (COM CARRINHO DE COMPRAS) */}
          <div className="space-y-3">
            <div className="flex items-center justify-between border-b border-slate-300 pb-1.5">
              <span className="font-bold text-slate-800 uppercase tracking-wider text-[11px] flex items-center gap-1.5">
                <span className="material-symbols-outlined text-[17px] text-[#0b1f3a]">shopping_cart</span>
                3. Outros Emolumentos e Serviços
              </span>

              {onOpenServicesCatalog && (
                <button
                  type="button"
                  onClick={onOpenServicesCatalog}
                  className="text-xs text-[#0b1f3a] hover:underline font-bold flex items-center gap-1 cursor-pointer"
                >
                  <span className="material-symbols-outlined text-[15px]">settings</span>
                  <span>Gerir Catálogo de Serviços</span>
                </button>
              )}
            </div>

            {/* Input Box to type service name and value */}
            <div className="p-3.5 bg-slate-50 border border-slate-300 space-y-3">
              <div className="grid grid-cols-1 sm:grid-cols-12 gap-2.5 items-end">
                <div className="sm:col-span-7">
                  <label className="block uppercase font-bold text-slate-700 mb-1 text-[11px]">
                    Nome ou Descrição do Serviço / Emolumento
                  </label>
                  <div className="relative">
                    <input
                      type="text"
                      list="services-catalog-list"
                      value={serviceInputName}
                      onChange={handleSelectCatalogService}
                      placeholder="Ex: Declaração de Frequência, Bata de Laboratório, etc..."
                      className="w-full h-9 px-3 bg-white border border-slate-300 text-slate-900 font-semibold focus:border-[#0b1f3a] focus:outline-none"
                    />
                    <datalist id="services-catalog-list">
                      {servicesCatalog.map((s) => (
                        <option key={s.id} value={s.name}>
                          {s.name} ({s.defaultPriceKz.toLocaleString('pt-PT')} Kz)
                        </option>
                      ))}
                    </datalist>
                  </div>
                </div>

                <div className="sm:col-span-3">
                  <label className="block uppercase font-bold text-slate-700 mb-1 text-[11px]">
                    Valor do Serviço (Kz)
                  </label>
                  <input
                    type="number"
                    min={0}
                    step={100}
                    value={serviceInputValue}
                    onChange={(e) => setServiceInputValue(e.target.value)}
                    className="w-full h-9 px-3 bg-white border border-slate-300 font-mono font-bold text-slate-900 focus:border-[#0b1f3a] focus:outline-none"
                  />
                </div>

                <div className="sm:col-span-2">
                  <button
                    type="button"
                    onClick={() => handleAddToCart()}
                    className="w-full h-9 bg-[#0b1f3a] hover:bg-[#7a0c0c] text-white font-bold text-xs flex items-center justify-center gap-1 cursor-pointer transition-colors border border-[#0b1f3a]"
                  >
                    <span className="material-symbols-outlined text-[16px]">add_shopping_cart</span>
                    <span>Adicionar</span>
                  </button>
                </div>
              </div>

              {/* Shopping Cart Table of Added Services */}
              <div className="mt-3 border border-slate-300 bg-white">
                <div className="px-3 py-2 bg-slate-100 border-b border-slate-300 flex items-center justify-between font-bold text-slate-700 text-[11px] uppercase">
                  <span>Carrinho de Serviços Selecionados ({cartItems.length})</span>
                  <span className="font-mono text-[#0b1f3a]">
                    Total Serviços: {servicesTotal.toLocaleString('pt-PT', { minimumFractionDigits: 2 })} Kz
                  </span>
                </div>

                {cartItems.length === 0 ? (
                  <div className="p-4 text-center text-slate-400 italic">
                    Nenhum emolumento ou serviço adicional adicionado ao carrinho.
                  </div>
                ) : (
                  <table className="w-full text-left text-xs border-collapse">
                    <thead>
                      <tr className="bg-slate-50 text-slate-600 border-b border-slate-200">
                        <th className="p-2 w-20">Código</th>
                        <th className="p-2">Descrição do Serviço</th>
                        <th className="p-2 w-24 text-center">Qtd</th>
                        <th className="p-2 w-32 text-right">Preço Unit. (Kz)</th>
                        <th className="p-2 w-32 text-right">Total (Kz)</th>
                        <th className="p-2 w-14 text-center">Ação</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-200">
                      {cartItems.map((item) => (
                        <tr key={item.id} className="hover:bg-slate-50">
                          <td className="p-2 font-mono font-bold text-[#0b1f3a]">{item.code}</td>
                          <td className="p-2 font-medium text-slate-900">{item.name}</td>
                          <td className="p-2 text-center">
                            <div className="inline-flex items-center border border-slate-300 bg-white">
                              <button
                                type="button"
                                onClick={() => handleUpdateCartQuantity(item.id, -1)}
                                className="px-1.5 py-0.5 text-slate-600 hover:bg-slate-100 cursor-pointer font-bold"
                              >
                                -
                              </button>
                              <span className="px-2 font-mono font-bold">{item.quantity}</span>
                              <button
                                type="button"
                                onClick={() => handleUpdateCartQuantity(item.id, 1)}
                                className="px-1.5 py-0.5 text-slate-600 hover:bg-slate-100 cursor-pointer font-bold"
                              >
                                +
                              </button>
                            </div>
                          </td>
                          <td className="p-2 text-right font-mono text-slate-800">
                            {item.priceKz.toLocaleString('pt-PT', { minimumFractionDigits: 2 })} Kz
                          </td>
                          <td className="p-2 text-right font-mono font-bold text-[#0b1f3a]">
                            {(item.priceKz * item.quantity).toLocaleString('pt-PT', { minimumFractionDigits: 2 })} Kz
                          </td>
                          <td className="p-2 text-center">
                            <button
                              type="button"
                              onClick={() => handleRemoveFromCart(item.id)}
                              className="text-slate-400 hover:text-red-700 p-1 cursor-pointer"
                              title="Remover do Carrinho"
                            >
                              <span className="material-symbols-outlined text-[16px]">delete</span>
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            </div>
          </div>

          {/* SEÇÃO 4: DETALHES DE LIQUIDAÇÃO & DADOS DO OPERADOR */}
          <div className="space-y-3">
            <div className="flex items-center justify-between border-b border-slate-300 pb-1.5">
              <span className="font-bold text-slate-800 uppercase tracking-wider text-[11px] flex items-center gap-1.5">
                <span className="material-symbols-outlined text-[17px] text-[#0b1f3a]">account_balance_wallet</span>
                4. Dados de Liquidação & Caixa
              </span>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
              <div>
                <label className="block uppercase font-bold text-slate-700 mb-1 text-[11px]">
                  N.º de Transação
                </label>
                <div className="h-9 px-3 bg-slate-100 border border-slate-300 font-mono font-bold text-[#0b1f3a] flex items-center justify-between">
                  <span>{autoTransactionNumber}</span>
                  <span className="text-[10px] px-1.5 py-0.5 bg-blue-100 text-blue-800 font-bold">
                  </span>
                </div>
              </div>

              <div>
                <label className="block uppercase font-bold text-slate-700 mb-1 text-[11px]">
                  Operador de Caixa
                </label>
                <div className="h-9 px-3 bg-slate-100 border border-slate-300 font-bold text-slate-800 flex items-center truncate">
                  {currentUser?.name || 'Operador'} ({currentUser?.roleTitle || 'Secretaria Geral'})
                </div>
              </div>

              <div>
                <label className="block uppercase font-bold text-slate-700 mb-1 text-[11px]">
                  Data do Pagamento *
                </label>
                <input
                  type="date"
                  required
                  value={paymentDate}
                  onChange={(e) => setPaymentDate(e.target.value)}
                  className="w-full h-9 px-3 bg-white border border-slate-300 font-semibold text-slate-800 focus:border-[#0b1f3a] focus:outline-none"
                />
              </div>

              <div className="sm:col-span-2 lg:col-span-3">
                <label className="block uppercase font-bold text-slate-700 mb-1 text-[11px]">
                  Forma de Pagamento
                </label>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                  {[
                    { id: 'tpa', label: 'TPA Multicaixa', icon: 'credit_card' },
                    { id: 'mcx', label: 'Multicaixa Express', icon: 'smartphone' },
                    { id: 'debito', label: 'Depósito Bancário', icon: 'account_balance' },
                    { id: 'numerario', label: 'Numerário / Caixa', icon: 'payments' }
                  ].map((m) => (
                    <button
                      key={m.id}
                      type="button"
                      onClick={() => setPaymentMethod(m.id as any)}
                      className={`h-9 px-2 text-xs font-bold border flex items-center justify-center gap-1.5 transition-colors cursor-pointer ${
                        paymentMethod === m.id
                          ? 'bg-[#0b1f3a] text-white border-[#0b1f3a]'
                          : 'bg-white text-slate-700 border-slate-300 hover:bg-slate-100'
                      }`}
                    >
                      <span className="material-symbols-outlined text-[16px]">{m.icon}</span>
                      <span>{m.label}</span>
                    </button>
                  ))}
                </div>
              </div>
            </div>
          </div>

          {/* Avisos: Políticas de Prazos & Multas aplicadas automaticamente */}
          {includeTuition && tuitionCharges.notes.length > 0 && (
            <div
              className={`p-3 text-xs border flex items-start gap-2 ${
                tuitionCharges.isLate
                  ? 'bg-rose-50 border-rose-300 text-rose-800'
                  : 'bg-emerald-50 border-emerald-300 text-emerald-800'
              }`}
            >
              <span className="material-symbols-outlined text-[16px] mt-0.5">
                {tuitionCharges.isLate ? 'warning' : 'sell'}
              </span>
              <ul className="list-disc list-inside space-y-0.5">
                {tuitionCharges.notes.map((note, idx) => (
                  <li key={idx}>{note}</li>
                ))}
              </ul>
            </div>
          )}

          {/* Aviso: aluno em débito, com emissão de certificados/declarações bloqueada */}
          {isStudentBlockedByDebt && (
            <Notice tone="warn" icon="block">
              <span>
                <strong>{selectedStudent?.name}</strong> encontra-se em débito. Segundo a política de
                Restrições por Inadimplência configurada, a emissão de certificados/declarações para este
                aluno permanece bloqueada até à regularização integral das propinas em atraso.
              </span>
            </Notice>
          )}

          {/* QUADRO DE RESUMO FINANCEIRO */}
          <div className="flex flex-col sm:flex-row justify-end items-end pt-2">
            <div className="w-full sm:w-80 bg-slate-50 border border-slate-300 p-3.5 space-y-2 text-xs">
              <div className="flex justify-between text-slate-600">
                <span>Base de Propinas:</span>
                <span className="font-mono font-semibold">
                  {tuitionCharges.baseAmountKz.toLocaleString('pt-PT', { minimumFractionDigits: 2 })} Kz
                </span>
              </div>
              {tuitionCharges.earlyDiscountKz > 0 && (
                <div className="flex justify-between text-emerald-700">
                  <span>Desconto Pagamento Antecipado ({financialRules.discountPercent}%):</span>
                  <span className="font-mono font-semibold">
                    − {tuitionCharges.earlyDiscountKz.toLocaleString('pt-PT', { minimumFractionDigits: 2 })} Kz
                  </span>
                </div>
              )}
              {tuitionCharges.siblingDiscountKz > 0 && (
                <div className="flex justify-between text-emerald-700">
                  <span>Desconto Agregado Familiar ({financialRules.siblingDiscountPercent}%):</span>
                  <span className="font-mono font-semibold">
                    − {tuitionCharges.siblingDiscountKz.toLocaleString('pt-PT', { minimumFractionDigits: 2 })} Kz
                  </span>
                </div>
              )}
              {tuitionCharges.lateFeeKz > 0 && (
                <div className="flex justify-between text-rose-700">
                  <span>Multa por Mora ({financialRules.lateFeePercent}%):</span>
                  <span className="font-mono font-semibold">
                    + {tuitionCharges.lateFeeKz.toLocaleString('pt-PT', { minimumFractionDigits: 2 })} Kz
                  </span>
                </div>
              )}
              <div className="flex justify-between text-slate-600 pt-1 border-t border-slate-200">
                <span>Subtotal Propinas:</span>
                <span className="font-mono font-semibold">
                  {tuitionTotal.toLocaleString('pt-PT', { minimumFractionDigits: 2 })} Kz
                </span>
              </div>
              <div className="flex justify-between text-slate-600">
                <span>Subtotal Serviços / Emolumentos:</span>
                <span className="font-mono font-semibold">
                  {servicesTotal.toLocaleString('pt-PT', { minimumFractionDigits: 2 })} Kz
                </span>
              </div>
              <div className="flex justify-between text-slate-600 border-b border-slate-200 pb-2">
                <span>Imposto de Selo Legal (0.1%):</span>
                <span className="font-mono">
                  {stampDuty.toLocaleString('pt-PT', { minimumFractionDigits: 2 })} Kz
                </span>
              </div>
              <div className="flex justify-between items-center text-[#0b1f3a] pt-1">
                <span className="font-black text-xs uppercase tracking-wider">TOTAL A LIQUIDAR:</span>
                <span className="font-mono font-black text-base">
                  {grandTotal.toLocaleString('pt-PT', { minimumFractionDigits: 2 })} Kz
                </span>
              </div>

              {financialRules.allowPartialPayments && (
                <div className="pt-2 border-t border-slate-200">
                  <label className="block text-[11px] font-bold text-slate-700 mb-1">
                    Valor a Pagar Agora (Amortização Parcial Permitida)
                  </label>
                  <input
                    type="number"
                    min={0}
                    max={grandTotal}
                    step={100}
                    placeholder={grandTotal.toLocaleString('pt-PT')}
                    value={partialAmountInput}
                    onChange={(e) =>
                      setPartialAmountInput(e.target.value === '' ? '' : Math.max(0, Number(e.target.value)))
                    }
                    className="w-full px-2.5 py-1.5 text-xs bg-white border border-slate-300 font-mono font-bold text-slate-900 focus:outline-hidden focus:ring-2 focus:ring-[#0b1f3a]"
                  />
                  {typeof partialAmountInput === 'number' && partialAmountInput > 0 && partialAmountInput < grandTotal && (
                    <span className="block mt-1 text-[10px] text-amber-700 font-semibold">
                      Fatura registada como <strong>PENDENTE</strong> — saldo remanescente de{' '}
                      {(grandTotal - partialAmountInput).toLocaleString('pt-PT')} Kz.
                    </span>
                  )}
                </div>
              )}
            </div>
          </div>

          {/* ACTIONS FOOTER */}
          <div className="pt-4 flex items-center justify-between border-t border-slate-300">
            <div className="text-slate-500 text-[11px]">
              O recibo de quitação fiscal será emitido logo após a confirmação.
            </div>

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={onClose}
                disabled={isSubmitting}
                className="px-4 py-2 bg-slate-200 hover:bg-slate-300 text-slate-800 font-bold text-xs cursor-pointer border border-slate-300"
              >
                Cancelar
              </button>

              <button
                type="submit"
                disabled={isSubmitting || !cashOpen || grandTotal <= 0 || !selectedStudent || monthlyTuitionMissing}
                title={cashOpen ? undefined : 'Caixa fechada: abra a caixa para registar pagamentos.'}
                className="px-6 py-2 bg-[#0b1f3a] hover:bg-[#7a0c0c] text-white font-bold text-xs cursor-pointer transition-colors border border-[#0b1f3a] flex items-center gap-1.5 disabled:opacity-50"
              >
                {isSubmitting ? (
                  <>
                    <Spinner size={16} className="text-white" />
                    <span>A Processar Pagamento...</span>
                  </>
                ) : (
                  <>
                    <span className="material-symbols-outlined text-[16px]">receipt</span>
                    <span>PAGAR</span>
                  </>
                )}
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
};
