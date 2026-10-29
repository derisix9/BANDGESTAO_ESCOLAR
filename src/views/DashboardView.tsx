import React, { useState } from 'react';
import { SchoolDatabase, UserRole, Student } from '../types';
import { SubsystemsAttendanceChart } from '../components/dashboard/SubsystemsAttendanceChart';
import { FinancialEvolutionChart } from '../components/dashboard/FinancialEvolutionChart';
import { AcademicEvolutionChart } from '../components/dashboard/AcademicEvolutionChart';
import { RecentAuditLogsWidget } from '../components/dashboard/RecentAuditLogsWidget';
import { InstitutionalAgendaWidget } from '../components/dashboard/InstitutionalAgendaWidget';
import { QuickReportCardPicker } from '../components/dashboard/QuickReportCardPicker';
import { runGlobalOperation } from '../context/OperationContext';
import { useAccessControl } from '../components/useAccessControl';
import {
  buildLedger, ledgerPeriodOptions, filterLedgerByPeriod, invoicePeriodOptions, filterInvoicesByPeriod, balanceByChannel, expensesTotal, collectionSummary, CHANNEL_LABELS, PAYROLL_CATEGORY, type PaymentChannel
} from '../utils/financeExtras';

interface DashboardViewProps {
  db: SchoolDatabase;
  onNavigate: (view: string) => void;
  currentUserRole: UserRole;
  onOpenNewStudentModal: () => void;
  onOpenNoticeModal: () => void;
  onOpenReportCard?: (student: Student) => void;
}

export const DashboardView: React.FC<DashboardViewProps> = ({
  db,
  onNavigate,
  currentUserRole,
  onOpenNewStudentModal,
  onOpenNoticeModal,
  onOpenReportCard
}) => {
  const [isReportCardPickerOpen, setIsReportCardPickerOpen] = useState(false);
  const acl = useAccessControl(currentUserRole);
  const canSeeTreasury = acl.can('propinas.reports') || acl.can('financeiro.contabilidade.manage');
  const [collectionKind, setCollectionKind] = useState<string>('todos');
  const [collectionPeriod, setCollectionPeriod] = useState<string>('todo');
  const [balanceChannel, setBalanceChannel] = useState<string>('todos');
  const [expenseCategory, setExpenseCategory] = useState<string>('todas');
  const [balancePeriod, setBalancePeriod] = useState<string>('todo');
  const [expensePeriod, setExpensePeriod] = useState<string>('todo');

  const totalStudents = db.students?.length || 0;
  const regularStudents = db.students?.filter((s) => s.financialStatus !== 'debito').length || 0;
  const debtStudents = db.students?.filter((s) => s.financialStatus === 'debito').length || 0;

  const totalTeachers = db.teachers?.length || 0;
  const teacherDepartments = Array.from(
    new Set((db.teachers || []).map((t) => t.department).filter(Boolean))
  );
  const totalClasses = db.classes?.length || 0;

  // Real attendance rate computed from students (nunca substituir um 0% real por um valor de preenchimento)
  const avgAttendanceRate =
    totalStudents > 0
      ? (
          db.students.reduce((acc, s) => acc + (typeof s.attendanceRate === 'number' ? s.attendanceRate : 100), 0) / totalStudents
        ).toFixed(1)
      : '100.0';

  const totalAbsences = db.students?.reduce((acc, s) => acc + (s.unexcusedAbsences || 0), 0) || 0;

  // Real financial invoice execution
  const invoices = db.invoices || [];
  // Cobrança Registada com filtro por tipo: Propinas, multas e cada categoria de serviço do catálogo.
  const serviceCategoryOf = React.useCallback(
    (code: string) => {
      const cat = (db.services || []).find((x) => x.code === code)?.category;
      const names: Record<string, string> = { propinas: 'Propinas', matricula: 'Matrículas', declaracao: 'Declarações', uniforme: 'Uniformes', cartao: 'Cartões', geral: 'Outros serviços' };
      return cat ? names[cat] : undefined;
    },
    [db.services]
  );
  const collection = React.useMemo(
    () => collectionSummary(filterInvoicesByPeriod(invoices as any[], collectionPeriod), collectionKind, serviceCategoryOf),
    [invoices, collectionKind, collectionPeriod, serviceCategoryOf]
  );
  const collectionPeriods = React.useMemo(() => invoicePeriodOptions(invoices as any[]), [invoices]);
  const collectionKinds = React.useMemo(() => collectionSummary(invoices as any, 'todos', serviceCategoryOf).kinds, [invoices, serviceCategoryOf]);
  const totalInvoicedKz = collection.invoiced;
  const totalCollectedKz = collection.collected;
  const pendingInvoicesCount = collection.pending;
  // Sem faturação lançada não há cobrança para mostrar — nunca inventar uma percentagem
  // "provável" quando ainda não foi feita nenhuma cobrança real.
  const collectionPercent = totalInvoicedKz > 0 ? Math.round((totalCollectedKz / totalInvoicedKz) * 100) : 0;

  // Tesouraria: livro de caixa (entradas das faturas pagas; saídas = despesas pagas + folha de pagamento paga)
  const ledger = React.useMemo(
    () => buildLedger(invoices as any, (db.expenses || []) as any, (db.payrollRecords || []) as any, (db.assets || []) as any),
    [invoices, db.expenses, db.payrollRecords, db.assets]
  );
  const periodOptions = React.useMemo(() => ledgerPeriodOptions(ledger), [ledger]);
  const balance = React.useMemo(
    () => balanceByChannel(filterLedgerByPeriod(ledger, balancePeriod), balanceChannel as PaymentChannel | 'todos'),
    [ledger, balanceChannel, balancePeriod]
  );
  const expenseCategories = React.useMemo(
    () => [...new Set(ledger.filter((e) => e.kind === 'saida').map((e) => e.category))].sort((a, b) => a.localeCompare(b, 'pt')),
    [ledger]
  );
  const expenses = React.useMemo(
    () => expensesTotal(filterLedgerByPeriod(ledger, expensePeriod), expenseCategory),
    [ledger, expenseCategory, expensePeriod]
  );
  const payablesTotal = (db.expenses || []).filter((e) => !e.paidDate).reduce((s, e) => s + e.amount, 0);
  const kzFmt = (n: number) => `${n.toLocaleString('pt-PT')} Kz`;
  const selectCls = 'mt-3 w-full rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-xs font-semibold text-slate-700 focus:outline-none focus:ring-2 focus:ring-[#0b1f3a]/30';

  // Subsystems distribution
  const subsystemSummary = React.useMemo(() => {
    const map: Record<string, { count: number; totalTuition: number }> = {};
    (db.students || []).forEach((s) => {
      const cycle = s.cycle || 'Ensino Secundário';
      if (!map[cycle]) map[cycle] = { count: 0, totalTuition: 0 };
      map[cycle].count += 1;
      map[cycle].totalTuition += s.monthlyTuitionKz || 0;
    });
    return map;
  }, [db.students]);

  return (
    <div className="flex flex-col w-full gap-6 pb-12">
      {/* Top Header in Sidebar Blue #0b1f3a */}
      <div data-app-header className="rounded-2xl bg-[#0b1f3a] text-white p-6 lg:p-7 shadow-md relative overflow-hidden border border-slate-800">
        <div className="absolute right-0 top-0 bottom-0 w-1/3 opacity-10 flex items-center justify-end pointer-events-none pr-8">
          <span className="material-symbols-outlined text-[140px]">dashboard</span>
        </div>
        <div className="relative z-10 flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div>
            <h1 className="font-headline text-2xl lg:text-3xl font-extrabold text-white tracking-tight">
              PAINEL PRINCIPAL
            </h1>
            <p className="text-xs text-blue-200 mt-1 font-medium">
              Ano Letivo {db.settings.currentAcademicYear} • {db.settings.schoolName}
            </p>
          </div>

          <div className="flex items-center gap-3 self-start md:self-auto">
            <div
              className="px-3.5 py-2 rounded-xl text-left border"
              style={{ backgroundColor: 'rgba(255,255,255,0.14)', borderColor: 'rgba(255,255,255,0.22)' }}
            >
              <span className="text-[10px] uppercase font-bold text-[#bfdbfe] block">Total    de Turmas</span>
              <span className="font-headline text-base font-extrabold text-white">
              {totalClasses}
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* 4 Stats KPI Cards (Dynamic Real Database Values) */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {/* Card 1: Total Alunos */}
        <div className="kpi-card kpi-blue p-3 flex flex-col justify-between">
          <div className="flex items-start justify-between">
            <div>
              <span className="kpi-label text-[10px] uppercase tracking-wider font-bold">Total de Alunos</span>
              <div className="kpi-value font-headline text-xl font-extrabold mt-0.5">{totalStudents}</div>
            </div>
            <div className="kpi-icon w-8 h-8">
              <span className="material-symbols-outlined text-[18px]">school</span>
            </div>
          </div>
          <div className="kpi-foot mt-2 pt-2 border-t flex items-center justify-between text-xs">
            <span className="kpi-chip kpi-tag-green px-2 py-0.5 font-bold font-mono text-[11px]">
              {regularStudents} Regulares
            </span>
            <span className="kpi-sub kpi-text-red font-bold">{debtStudents} em Mora</span>
          </div>
        </div>

        {/* Card 2: Corpo Docente */}
        <div className="kpi-card kpi-violet p-3 flex flex-col justify-between">
          <div className="flex items-start justify-between">
            <div>
              <span className="kpi-label text-[10px] uppercase tracking-wider font-bold">Corpo Docente</span>
              <div className="kpi-value font-headline text-xl font-extrabold mt-0.5">{totalTeachers}</div>
            </div>
            <div className="kpi-icon w-8 h-8">
              <span className="material-symbols-outlined text-[18px]">badge</span>
            </div>
          </div>
          <div className="kpi-foot mt-2 pt-2 border-t flex items-center justify-between text-xs">
            <span className="kpi-sub font-medium">
              {teacherDepartments.length || 1} Departamentos
            </span>
            <span className="kpi-chip px-2 py-0.5 font-bold text-[11px]">
              {totalTeachers > 0 ? '100% ativo' : 'Sem docentes'}
            </span>
          </div>
        </div>

        {/* Card 3: Assiduidade Hoje */}
        <div className="kpi-card kpi-amber p-3 flex flex-col justify-between">
          <div className="flex items-start justify-between">
            <div>
              <span className="kpi-label text-[10px] uppercase tracking-wider font-bold">Assiduidade</span>
              <div className="kpi-value font-headline text-xl font-extrabold mt-0.5">{avgAttendanceRate}%</div>
            </div>
            <div className="kpi-icon w-8 h-8">
              <span className="material-symbols-outlined text-[18px]">fact_check</span>
            </div>
          </div>
          <div className="kpi-foot mt-2 pt-2 border-t flex items-center justify-between text-xs">
            <span className="kpi-sub">{totalStudents} alunos avaliados</span>
            <span className="kpi-chip kpi-tag-red px-2 py-0.5 font-bold text-[11px]">
              {totalAbsences} Faltas
            </span>
          </div>
        </div>

        {/* Card 4: Cobrança de Propinas */}
        <div className="kpi-card kpi-green p-3 flex flex-col justify-between">
          <div className="flex items-start justify-between">
            <div>
              <span className="kpi-label text-[10px] uppercase tracking-wider font-bold">PAGAMENTOS</span>
              <div className="kpi-value font-headline text-2xl font-extrabold mt-0.5">
                {totalCollectedKz.toLocaleString()} <span className="kpi-unit text-xs font-bold">Kz</span>
              </div>
            </div>
            <div className="kpi-icon w-8 h-8">
              <span className="material-symbols-outlined text-[18px]">payments</span>
            </div>
          </div>
          <select
            aria-label="Filtrar cobrança por tipo"
            className={selectCls}
            value={collectionKind}
            onChange={(e) => setCollectionKind(e.target.value)}
          >
            <option value="todos">Todos</option>
            {collectionKinds.map((k) => (
              <option key={k} value={k}>{k}</option>
            ))}
          </select>
          <select
            aria-label="Filtrar cobrança por período"
            className="mt-2 w-full rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-xs font-semibold text-slate-700 focus:outline-none focus:ring-2 focus:ring-[#0b1f3a]/30"
            value={collectionPeriod}
            onChange={(e) => setCollectionPeriod(e.target.value)}
          >
            <option value="todo">Todo o período</option>
            {collectionPeriods.map((o) => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
          <div className="kpi-foot mt-2 pt-2 border-t flex items-center justify-between text-xs">
            <span className="kpi-chip kpi-tag-green px-2 py-0.5 font-bold text-[11px]">
              {collectionPercent}% cobrado
            </span>
            <span className="kpi-sub kpi-text-red font-bold">{pendingInvoicesCount} pendentes</span>
          </div>
        </div>
      </div>


      {/* Tesouraria: saldo da instituição e despesas, com filtros */}
      {canSeeTreasury && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className={`kpi-card ${balance.total < 0 ? 'kpi-red' : 'kpi-cyan'} p-3 flex flex-col justify-between`}>
            <div className="flex items-start justify-between">
              <div>
                <span className="kpi-label text-[10px] uppercase tracking-wider font-bold">Lucro</span>
                <div className="kpi-value font-headline text-2xl font-extrabold mt-0.5">
                  {balance.total.toLocaleString('pt-PT')} <span className="kpi-unit text-xs font-bold">Kz</span>
                </div>
              </div>
              <div className="kpi-icon w-8 h-8">
                <span className="material-symbols-outlined text-[18px]">account_balance_wallet</span>
              </div>
            </div>
            <select aria-label="Filtrar saldo por meio de pagamento" className={selectCls} value={balanceChannel} onChange={(e) => setBalanceChannel(e.target.value)}>
              <option value="todos">Todas as contas</option>
              {(Object.keys(CHANNEL_LABELS) as PaymentChannel[]).map((c) => (
                <option key={c} value={c}>{CHANNEL_LABELS[c]}</option>
              ))}
            </select>
            <select aria-label="Filtrar por período" className="mt-2 w-full rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-xs font-semibold text-slate-700 focus:outline-none focus:ring-2 focus:ring-[#0b1f3a]/30" value={balancePeriod} onChange={(e) => setBalancePeriod(e.target.value)}>
              <option value="todo">Todo o período</option>
              {periodOptions.map((o) => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </select>
            <div className="kpi-foot mt-2 pt-2 border-t flex items-center justify-between text-xs">
              <span className="kpi-chip kpi-tag-green px-2 py-0.5 font-bold text-[11px]">Entradas {kzFmt(balance.entradas)}</span>
              <span className="kpi-sub kpi-text-red font-bold">Saídas {kzFmt(balance.saidas)}</span>
            </div>
          </div>

          <div className="kpi-card kpi-red p-3 flex flex-col justify-between">
            <div className="flex items-start justify-between">
              <div>
                <span className="kpi-label text-[10px] uppercase tracking-wider font-bold">DESPESAS</span>
                <div className="kpi-value font-headline text-2xl font-extrabold mt-0.5">
                  {expenses.total.toLocaleString('pt-PT')} <span className="kpi-unit text-xs font-bold">Kz</span>
                </div>
              </div>
              <div className="kpi-icon w-8 h-8">
                <span className="material-symbols-outlined text-[18px]">receipt_long</span>
              </div>
            </div>
            <select aria-label="Filtrar despesas por categoria" className={selectCls} value={expenseCategory} onChange={(e) => setExpenseCategory(e.target.value)}>
              <option value="todas">Todas as categorias</option>
              {expenseCategories.map((c) => (
                <option key={c} value={c}>{c === PAYROLL_CATEGORY ? `${c} (salários)` : c}</option>
              ))}
            </select>
            <select aria-label="Filtrar por período" className="mt-2 w-full rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-xs font-semibold text-slate-700 focus:outline-none focus:ring-2 focus:ring-[#0b1f3a]/30" value={expensePeriod} onChange={(e) => setExpensePeriod(e.target.value)}>
              <option value="todo">Todo o período</option>
              {periodOptions.map((o) => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </select>
            <div className="kpi-foot mt-2 pt-2 border-t flex items-center justify-between text-xs">
              <span className="kpi-sub">{expenses.count} {expenses.count === 1 ? 'pagamento' : 'pagamentos'}</span>
              <span className="kpi-sub font-bold">A pagar: {kzFmt(payablesTotal)}</span>
            </div>
          </div>
        </div>
      )}

      {/* Secção principal: todos os painéis em largura total, um debaixo do outro */}
      <div className="flex flex-col gap-6 w-full">
        {/* Painéis analíticos */}
        <div className="w-full flex flex-col gap-6">
          {/* Gráfico 1: Evolução da Assiduidade por Sub-sistema Ativo (Dinâmico com Recharts) */}
          <SubsystemsAttendanceChart db={db} />

          {/* Gráfico 2: Evolução Financeira de Cobrança e Faturação (Recharts interativo) */}
          <FinancialEvolutionChart db={db} onNavigateToPropinas={() => onNavigate('propinas')} />

          {/* Gráfico 3: Evolução Académica nos 3 Trimestres (Recharts interativo) */}
          <AcademicEvolutionChart db={db} onNavigateToPautas={() => onNavigate('pautas')} />

          {/* Tuition Collection Progress by Cycle */}
          <div className="bg-white rounded-2xl p-6 shadow-xs border border-slate-200">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 mb-4">
              <div>
                <span className="text-[11px] font-bold uppercase tracking-wider text-slate-400">
                  EXECUÇÃO DE MENSALIDADES
                </span>
                <h2 className="font-headline text-lg font-bold text-[#0b1f3a]">
                  COBRANÇAS DE PROPINAS
                </h2>
              </div>
              <button
                onClick={() => onNavigate('propinas')}
                className="text-xs font-bold text-[#0b1f3a] hover:text-[#7a0c0c] flex items-center gap-1"
              >
                <span>Ver Pagamentosa</span>
                <span className="material-symbols-outlined text-[16px]">arrow_forward</span>
              </button>
            </div>

            <div className="space-y-4">
              {Object.keys(subsystemSummary).length > 0 ? (
                Object.entries(subsystemSummary).map(([cycle, data]) => {
                  const cycleStudents = db.students.filter((s) => (s.cycle || 'Ensino Secundário') === cycle);
                  const regularCount = cycleStudents.filter((s) => s.financialStatus !== 'debito').length;
                  const pct = cycleStudents.length > 0 ? Math.round((regularCount / cycleStudents.length) * 100) : 100;
                  return (
                    <div key={cycle}>
                      <div className="flex items-center justify-between text-xs mb-1">
                        <span className="font-semibold text-slate-800">
                          {cycle} • {data.count} {data.count === 1 ? 'aluno matriculado' : 'alunos matriculados'}
                        </span>
                        <span className="font-mono font-bold text-slate-800">
                          {data.totalTuition.toLocaleString()} Kz/mês ({pct}%)
                        </span>
                      </div>
                      <div className="w-full h-2.5 rounded-full bg-slate-100 overflow-hidden flex">
                        <div className="bg-[#0b1f3a] h-full" style={{ width: `${pct}%` }} />
                        <div className="bg-[#7a0c0c] h-full" style={{ width: `${100 - pct}%` }} />
                      </div>
                    </div>
                  );
                })
              ) : (
                <div className="py-6 text-center text-slate-400 text-xs">
                  Sem dados de propinas ainda. Adicione turmas e matricule alunos para visualizar a projeção mensal por ciclo de ensino.
                </div>
              )}
            </div>
          </div>

          {/* Notices & Announcements Table */}
          <div className="bg-white rounded-2xl p-6 shadow-xs border border-slate-200">
            <div className="flex items-center justify-between mb-4">
              <div>
                <span className="text-[11px] font-bold uppercase tracking-wider text-slate-400">
                  COMUNICADOS
                </span>
                <h2 className="font-headline text-lg font-bold text-[#0b1f3a]">
                  AVISOS RECENTES
                </h2>
              </div>
              <button
                onClick={() => onNavigate('mural_biblioteca')}
                className="text-xs font-bold text-[#0b1f3a] hover:text-[#7a0c0c] flex items-center gap-1"
				>
             <span>Ver Avisos</span>
                <span className="material-symbols-outlined text-[16px]">arrow_forward</span>
              </button>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead>
                  <tr className="bg-[#0b1f3a] text-white font-bold uppercase text-[10px] tracking-wider">
                    <th className="py-3.5 px-4 border-r border-slate-700">Título do Aviso</th>
                    <th className="py-3.5 px-3 border-r border-slate-700">Autor</th>
                    <th className="py-3.5 px-3 border-r border-slate-700">Urgência</th>
                    <th className="py-3.5 px-3">Data</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {db.notices.map((n) => (
                    <tr key={n.id} className="hover:bg-slate-50 transition-colors">
                      <td className="py-3 px-3">
                        <div className="font-bold text-[#0b1f3a]">{n.title}</div>
                        <span className="text-slate-500 text-[11px] truncate block max-w-sm">{n.excerpt}</span>
                      </td>
                      <td className="py-3 px-3 text-slate-700 font-medium">{n.author}</td>
                      <td className="py-3 px-3">
                        <span
                          className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                            n.priority === 'urgente'
                              ? 'bg-red-100 text-red-800'
                              : n.priority === 'alta'
                              ? 'bg-amber-100 text-amber-900'
                              : 'bg-slate-100 text-slate-700'
                          }`}
                        >
                          {n.priority.toUpperCase()}
                        </span>
                      </td>
                      <td className="py-3 px-3 text-slate-500 font-mono text-[11px]">{n.date}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>

        {/* Atalhos, auditoria e agenda */}
        <div className="w-full flex flex-col gap-6">
          {/* Quick Shortcuts */}
          <div className="bg-white rounded-2xl p-6 shadow-xs border border-slate-200">
            <div className="flex items-center gap-2 mb-2">
              <span className="material-symbols-outlined text-[#7a0c0c] text-[20px]">bolt</span>
              <h2 className="font-headline text-base font-bold text-[#0b1f3a]">ATALHOS</h2>
            </div>
            <p className="text-xs text-slate-500 mb-4">AÇÕES OPERACIONAIS NO SISTEMA</p>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
              <button
                onClick={() => onNavigate('pautas')}
                className="p-2 rounded-lg bg-slate-50 hover:bg-slate-100 border border-slate-200 flex flex-col items-center justify-center text-center gap-0.5 transition-all group"
              >
                <span className="material-symbols-outlined text-[#0b1f3a] group-hover:scale-110 transition-transform text-[20px]">
                  assignment_turned_in
                </span>
                <span className="font-bold text-xs text-[#0b1f3a]">Lançar Notas</span>
              </button>

              <button
                onClick={() => onNavigate('propinas')}
                className="p-2 rounded-lg bg-slate-50 hover:bg-slate-100 border border-slate-200 flex flex-col items-center justify-center text-center gap-0.5 transition-all group"
              >
                <span className="material-symbols-outlined text-[#0b1f3a] group-hover:scale-110 transition-transform text-[20px]">
                  receipt_long
                </span>
                <span className="font-bold text-xs text-[#0b1f3a]">Emitir Recibo</span>
              </button>

              <button
                type="button"
                onClick={() => {
                  runGlobalOperation(
                    () => {
                      setIsReportCardPickerOpen(true);
                    },
                    {
                      requiredRule: 'alunos.print_docs',
                      userRole: currentUserRole,
                      loadingMessage: 'A verificar permissões de emissão...',
                      successMessage: 'Acesso autorizado!'
                    }
                  );
                }}
                className="p-2 rounded-lg bg-slate-50 hover:bg-slate-100 border border-slate-200 flex flex-col items-center justify-center text-center gap-0.5 transition-all group cursor-pointer"
                title="Emitir Boletim Oficial de Notas com os 3 Trimestres"
              >
                <span className="material-symbols-outlined text-[#7a0c0c] group-hover:scale-110 transition-transform text-[20px]">
                  assignment
                </span>
                <span className="font-bold text-xs text-[#7a0c0c]">Boletim de Notas</span>
              </button>
            </div>
          </div>

          {/* Widget 1: Auditoria & Logs / Atividades Recentes em Tempo Real */}
          <RecentAuditLogsWidget initialDb={db} onNavigate={onNavigate} />

          {/* Widget 2: Agenda Institucional & Eventos Próximos em Tempo Real */}
          <InstitutionalAgendaWidget
            initialDb={db}
            currentUserRole={currentUserRole}
            onNavigate={onNavigate}
          />
        </div>
      </div>

      {/* Modal de Seleção Rápida de Aluno para Emissão do Boletim de Notas Oficial */}
      <QuickReportCardPicker
        db={db}
        isOpen={isReportCardPickerOpen}
        onClose={() => setIsReportCardPickerOpen(false)}
        onSelectStudent={(st) => {
          runGlobalOperation(
            () => {
              if (onOpenReportCard) {
                onOpenReportCard(st);
              } else {
                onNavigate('alunos');
              }
            },
            {
              requiredRule: 'alunos.print_docs',
              userRole: currentUserRole,
              loadingMessage: 'A preparar dados do boletim...',
              successMessage: 'Boletim emitido com sucesso!'
            }
          );
        }}
      />
    </div>
  );
};
