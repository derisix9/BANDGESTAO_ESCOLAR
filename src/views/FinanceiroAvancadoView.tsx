import React, { useMemo, useState } from 'react';
import { SchoolDatabase, UserRole } from '../types';
import type { CashSession } from '../types/processos';
import { dbService } from '../services/db';
import { runGlobalOperation } from '../context/OperationContext';
import { useAccessControl } from '../hooks/useAccessControl';
import { SearchableSelect } from '../components/SearchableSelect';
import { FormModal } from '../components/FormModal';
import { BtnIcon, IconButton } from '../components/IconButton';
import { CashSessionPanel, CloseCashModal, MonthDetailModal, SessionDetailModal } from '../components/FluxoCaixaUi';
import {
  accountsPayable,
  buildLedger,
  PAYROLL_CATEGORY,
  ASSET_INVESTMENT_CATEGORY,
  computeSessionTotals,
  applyDiscountRules,
  isOverdue,
  monthlyCashFlow,
  reconcileBank,
  toISODate,
  CashMovement,
  DiscountRule,
  OpenInvoice
} from '../utils/financeExtras';

import { BANK_FILE_ACCEPT, parseBankText, readBankStatementFile, statementTotals, type ParsedBankFile } from '../utils/bankStatementImport';
import { TablePagination, usePagedList } from '../components/TablePagination';
import { Notice } from '../components/Notice';
import { getEffectivePayrollTaxSettings } from '../utils/payroll';
import { payrollForecast, payrollChargesDue } from '../utils/payrollCashFlow';

export type FinanceiroSection = 'planos_descontos' | 'conciliacao_bancaria' | 'contabilidade';

interface Props {
  db: SchoolDatabase;
  currentUserRole: UserRole;
  section: FinanceiroSection;
}

const inputCls = 'w-full h-10 px-3 bg-white border border-slate-300 text-slate-800 focus:border-[#0b1f3a] focus:outline-none text-xs rounded-lg';
const labelCls = 'block text-[11px] font-bold text-slate-600 mb-1';
const btnPrimary = 'inline-flex items-center justify-center gap-1.5 h-10 px-4 bg-[#0b1f3a] text-white text-xs font-bold rounded-lg hover:bg-[#12315c] active:scale-[0.98] transition disabled:opacity-40 disabled:cursor-not-allowed';
const btnGhost = 'inline-flex items-center justify-center gap-1.5 h-9 px-3 bg-[#0b1f3a] text-white text-xs font-bold rounded-lg hover:bg-[#12315c] active:scale-[0.98] transition disabled:opacity-40 disabled:cursor-not-allowed';
const kz = (n: number) => `${Math.round(n).toLocaleString('pt-PT')} Kz`;
const today = () => new Date().toISOString().slice(0, 10);

type Result = { success: boolean; error?: string };

function useRunner(role: UserRole) {
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const run = async (fn: () => Result | void, loading: string, rule: string, okText: string | (() => string)) => {
    let result: Result = { success: true };
    try {
      await runGlobalOperation(
        () => { const r = fn(); if (r) result = r; if (r && r.success === false) throw new Error(r.error || 'Não foi possível concluir.'); },
        { loadingMessage: loading, requiredRule: rule, userRole: role, resolveSuccessText: () => (typeof okText === 'function' ? okText() : okText) }
      );
    } catch (err: any) {
      result = { success: false, error: err?.message || 'Sem permissão para esta operação.' };
    }
    // O sucesso é confirmado só pelo diálogo global (carregamento → visto animado): sem faixa verde.
    setMessage(result.success ? null : { ok: false, text: result.error || 'Não foi possível concluir.' });
    return result;
  };
  return { message, run };
}

function Banner({ message }: { message: { ok: boolean; text: string } | null }) {
  if (!message) return null;
  return <Notice tone={message.ok ? 'success' : 'error'}>{message.text}</Notice>;
}
const Empty = ({ text }: { text: string }) => <p className="text-xs text-slate-400 font-semibold py-8 text-center">{text}</p>;

// ---------------------------------------------------------------------------
// Planos, bolsas e descontos
// ---------------------------------------------------------------------------
function PlanosTab({ db, role }: { db: SchoolDatabase; role: UserRole }) {
  const acl = useAccessControl(role);
  const { message, run } = useRunner(role);
  const can = acl.can('financeiro.planos.manage');
  const rule = 'financeiro.planos.manage';

  const [studentId, setStudentId] = useState('');
  const [description, setDescription] = useState('Dívida de propinas');
  const [total, setTotal] = useState('');
  const [count, setCount] = useState('3');
  const [firstDue, setFirstDue] = useState(today());
  const [planOpen, setPlanOpen] = useState(false);
  const [ruleOpen, setRuleOpen] = useState(false);
  const [openPlanId, setOpenPlanId] = useState<string | null>(null);

  const [rLabel, setRLabel] = useState('');
  const [rKind, setRKind] = useState<'percent' | 'fixed'>('percent');
  const [rValue, setRValue] = useState('');
  const [rSibling, setRSibling] = useState('');
  const [rDay, setRDay] = useState('');
  const [rStack, setRStack] = useState(false);

  const [simBase, setSimBase] = useState('50000');
  const [simSibling, setSimSibling] = useState('1');
  const [simDay, setSimDay] = useState('');

  const rules = (db.discountRules || []).filter((r) => r.active !== false);
  const sim = useMemo(() => {
    const base = Number(simBase);
    if (!(base > 0)) return null;
    return applyDiscountRules(base, rules as DiscountRule[], {
      siblingPosition: Number(simSibling) || 1,
      paymentDay: simDay ? Number(simDay) : undefined
    });
  }, [simBase, simSibling, simDay, rules]);

  const plans = db.paymentPlans || [];
  const { page: pgPlans, setPage: setPgPlans, pageItems: visiblePlans } = usePagedList(plans, [plans.length]);
  const students = (db.students || []).map((s) => ({ value: String(s.id), label: s.name, sublabel: `${s.procNumber} · ${s.className || s.grade}` }));

  return (
    <div className="space-y-6">
      <Banner message={message} />
      <section className="space-y-3">
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <h2 className="text-sm font-bold text-[#0b1f3a]">Planos de pagamento</h2>
          <button type="button" className={btnPrimary} disabled={!can} title={can ? undefined : acl.denyMessage(rule)} onClick={() => { setStudentId(''); setDescription('Dívida de propinas'); setTotal(''); setCount('3'); setFirstDue(today()); setPlanOpen(true); }}>
            <BtnIcon n="add_card" /> Novo plano de pagamento
          </button>
        </div>
        {plans.length === 0 ? <Empty text="Sem planos de pagamento." /> : (
          <div className="bg-white border border-slate-200 rounded-xl overflow-x-auto">
            <table className="w-full text-xs">
              <thead className="bg-[#0b1f3a] text-white font-bold uppercase text-[11px] tracking-wider text-left"><tr><th className="p-3">Aluno</th><th className="p-3">Descrição</th><th className="p-3 text-right">Total</th><th className="p-3 text-center">Prestações</th><th className="p-3">Estado</th><th className="p-3 text-right">Ações</th></tr></thead>
              <tbody>
                {visiblePlans.map((p) => {
                  const paid = p.installments.filter((i) => i.paid).length;
                  const open = openPlanId === p.id;
                  return (
                    <React.Fragment key={p.id}>
                      <tr className="border-t border-slate-100 hover:bg-slate-50/60">
                        <td className="p-3 font-semibold">{p.studentName}</td>
                        <td className="p-3">{p.description}</td>
                        <td className="p-3 text-right font-mono">{kz(p.total)}</td>
                        <td className="p-3 text-center">{paid}/{p.installments.length}</td>
                        <td className={`p-3 font-bold capitalize ${p.status === 'ativo' ? 'text-blue-700' : p.status === 'concluido' ? 'text-emerald-700' : 'text-slate-400'}`}>{p.status}</td>
                        <td className="p-3"><div className="flex items-center gap-1 justify-end">
                          <IconButton icon={open ? 'expand_less' : 'checklist'} tone="primary" label={open ? 'Ocultar prestações' : 'Ver e marcar prestações'} onClick={() => setOpenPlanId(open ? null : p.id)} />
                          {p.status === 'ativo' && <IconButton icon="cancel" tone="danger" label="Cancelar plano" disabled={!can} onClick={() => run(() => dbService.cancelPaymentPlan(p.id), 'A cancelar...', rule, 'Plano cancelado.')} />}
                        </div></td>
                      </tr>
                      {open && (
                        <tr className="bg-slate-50/70"><td colSpan={6} className="p-3">
                          <div className="flex flex-wrap gap-2">
                            {p.installments.map((i) => (
                              <label key={i.number} className={`border rounded-lg px-2 py-1 flex items-center gap-2 ${i.paid ? 'bg-emerald-50 border-emerald-200' : !i.paid && i.dueDate < today() && p.status === 'ativo' ? 'bg-red-50 border-red-200' : 'bg-white border-slate-200'}`}>
                                <input type="checkbox" checked={!!i.paid} disabled={!can || p.status === 'cancelado'} onChange={(e) => run(() => dbService.setInstallmentPaid(p.id, i.number, e.target.checked), 'A atualizar...', rule, 'Prestação atualizada.')} />
                                {i.number}.ª · {i.dueDate} · {kz(i.amount)}
                              </label>
                            ))}
                          </div>
                        </td></tr>
                      )}
                    </React.Fragment>
                  );
                })}
              </tbody>
            </table>
            <TablePagination total={plans.length} page={pgPlans} onPageChange={setPgPlans} />
          </div>
        )}
        <p className="text-[11px] text-slate-400">O plano é um calendário de acompanhamento. Marcar uma prestação como paga não emite recibo: para isso use Pagamentos & Propinas.</p>
      </section>

      <section className="space-y-3">
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <h2 className="text-sm font-bold text-[#0b1f3a]">Bolsas e descontos por regra</h2>
          <button type="button" className={btnPrimary} disabled={!can} title={can ? undefined : acl.denyMessage(rule)} onClick={() => { setRLabel(''); setRKind('percent'); setRValue(''); setRSibling(''); setRDay(''); setRStack(false); setRuleOpen(true); }}>
            <BtnIcon n="redeem" /> Nova regra de desconto
          </button>
        </div>
        {(db.discountRules || []).length === 0 ? <Empty text="Sem regras de desconto." /> : (
          <div className="bg-white border border-slate-200 rounded-xl overflow-x-auto">
            <table className="w-full text-xs">
              <thead className="bg-[#0b1f3a] text-white font-bold uppercase text-[11px] tracking-wider text-left"><tr><th className="p-3">Regra</th><th className="p-3">Desconto</th><th className="p-3">Condições</th><th className="p-3">Acumulação</th><th className="p-3">Estado</th><th className="p-3 text-right">Ações</th></tr></thead>
              <tbody>
                {(db.discountRules || []).map((r) => (
                  <tr key={r.id} className="border-t border-slate-100 hover:bg-slate-50/60">
                    <td className="p-3 font-semibold">{r.label}</td>
                    <td className="p-3 font-mono">{r.kind === 'percent' ? `${r.value}%` : kz(r.value)}</td>
                    <td className="p-3">{[r.minSiblingPosition ? `a partir do irmão ${r.minSiblingPosition}` : '', r.paidByDay ? `pago até dia ${r.paidByDay}` : ''].filter(Boolean).join(' · ') || '—'}</td>
                    <td className="p-3">{r.stackable ? 'Acumulável' : 'Não acumulável (vale a melhor)'}</td>
                    <td className={`p-3 font-bold ${r.active === false ? 'text-slate-400' : 'text-emerald-700'}`}>{r.active === false ? 'Inativa' : 'Ativa'}</td>
                    <td className="p-3"><div className="flex items-center gap-1 justify-end">
                      <IconButton icon={r.active === false ? 'toggle_off' : 'toggle_on'} tone="primary" label={r.active === false ? 'Ativar regra' : 'Desativar regra'} disabled={!can} onClick={() => run(() => dbService.saveDiscountRule({ ...r, active: r.active === false }), 'A atualizar...', rule, 'Regra atualizada.')} />
                      <IconButton icon="delete" tone="danger" label="Eliminar regra" disabled={!can} onClick={() => run(() => { dbService.deleteDiscountRule(r.id); }, 'A eliminar...', rule, 'Regra eliminada.')} />
                    </div></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <div className="bg-slate-50 border border-slate-200 rounded-xl p-4 grid md:grid-cols-4 gap-3 items-end">
          <div><label className={labelCls}>Simular: propina base (Kz)</label><input className={inputCls} value={simBase} onChange={(e) => setSimBase(e.target.value)} /></div>
          <div><label className={labelCls}>Posição entre irmãos</label><input className={inputCls} value={simSibling} onChange={(e) => setSimSibling(e.target.value)} /></div>
          <div><label className={labelCls}>Dia do pagamento</label><input className={inputCls} value={simDay} onChange={(e) => setSimDay(e.target.value)} /></div>
          <div className="text-xs">{sim ? <><div>Desconto: <b>{kz(sim.discount)}</b></div><div>A pagar: <b>{kz(sim.final)}</b></div><div className="text-slate-400">{sim.applied.map((a) => a.label).join(', ') || 'nenhuma regra aplicável'}</div></> : <span className="text-slate-400">Indique um valor base.</span>}</div>
        </div>
        <p className="text-[11px] text-slate-400">As regras servem de tabela de referência e simulação. Não alteram automaticamente as faturas já geradas.</p>
      </section>

      {planOpen && (
        <FormModal title="Novo plano de pagamento" subtitle="Planos, Bolsas & Descontos" icon="add_card" widthClass="max-w-2xl" onClose={() => setPlanOpen(false)} submitLabel="Criar plano" submitDisabled={!can || !studentId}
          onSubmit={async () => { const r = await run(() => dbService.createPaymentPlan({ studentId, description, total: Number(total), count: Number(count), firstDueISO: firstDue }), 'A criar plano...', rule, 'Plano criado.'); if (r.success) setPlanOpen(false); }}>
          <div><SearchableSelect label="Aluno" options={students} value={studentId} onChange={setStudentId} placeholder="Pesquisar aluno" /></div>
          <div><label className={labelCls}>Descrição</label><input className={inputCls} value={description} onChange={(e) => setDescription(e.target.value)} /></div>
          <div className="grid md:grid-cols-3 gap-3">
            <div><label className={labelCls}>Total (Kz)</label><input className={inputCls} inputMode="numeric" value={total} onChange={(e) => setTotal(e.target.value)} /></div>
            <div><label className={labelCls}>N.º de prestações (máx. 24)</label><input className={inputCls} inputMode="numeric" value={count} onChange={(e) => setCount(e.target.value)} /></div>
            <div><label className={labelCls}>1.º vencimento</label><input type="date" className={inputCls} value={firstDue} onChange={(e) => setFirstDue(e.target.value)} /></div>
          </div>
          <Banner message={message && !message.ok ? message : null} />
        </FormModal>
      )}
      {ruleOpen && (
        <FormModal title="Nova regra de desconto" subtitle="Bolsas e descontos por regra" icon="redeem" widthClass="max-w-2xl" onClose={() => setRuleOpen(false)} submitLabel="Guardar regra" submitDisabled={!can || !rLabel.trim()}
          onSubmit={async () => { const r = await run(() => dbService.saveDiscountRule({ label: rLabel, kind: rKind, value: Number(rValue.replace(',', '.')), minSiblingPosition: rSibling ? Number(rSibling) : undefined, paidByDay: rDay ? Number(rDay) : undefined, stackable: rStack, active: true }), 'A guardar regra...', rule, 'Regra guardada.'); if (r.success) setRuleOpen(false); }}>
          <div><label className={labelCls}>Nome da regra</label><input className={inputCls} value={rLabel} onChange={(e) => setRLabel(e.target.value)} placeholder="ex.: Bolsa de mérito" /></div>
          <div className="grid md:grid-cols-2 gap-3">
            <div><label className={labelCls}>Tipo</label><select className={inputCls} value={rKind} onChange={(e) => setRKind(e.target.value as any)}><option value="percent">Percentagem</option><option value="fixed">Valor fixo (Kz)</option></select></div>
            <div><label className={labelCls}>Valor</label><input className={inputCls} inputMode="decimal" value={rValue} onChange={(e) => setRValue(e.target.value)} /></div>
            <div><label className={labelCls}>A partir do irmão n.º (opcional)</label><input className={inputCls} inputMode="numeric" value={rSibling} onChange={(e) => setRSibling(e.target.value)} /></div>
            <div><label className={labelCls}>Pago até ao dia (opcional)</label><input className={inputCls} inputMode="numeric" value={rDay} onChange={(e) => setRDay(e.target.value)} /></div>
          </div>
          <label className="text-[11px] text-slate-700 flex items-center gap-2"><input type="checkbox" checked={rStack} onChange={(e) => setRStack(e.target.checked)} />Acumula com outras</label>
          <Banner message={message && !message.ok ? message : null} />
        </FormModal>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Conciliação bancária
// ---------------------------------------------------------------------------
function ConciliacaoTab({ db, role }: { db: SchoolDatabase; role: UserRole }) {
  const acl = useAccessControl(role);
  const { message, run } = useRunner(role);
  const can = acl.can('financeiro.conciliacao.manage');
  const rule = 'financeiro.conciliacao.manage';
  const [pasted, setPasted] = useState('');
  const [preview, setPreview] = useState<(ParsedBankFile & { fileName: string }) | null>(null);
  const [reading, setReading] = useState(false);
  const [manualFor, setManualFor] = useState<string | null>(null);
  const [manualInvoice, setManualInvoice] = useState('');

  const pendingLines = (db.bankStatementLines || []).filter((l) => l.status === 'por_conciliar');
  const openInvoices: OpenInvoice[] = (db.invoices || [])
    .filter((i) => i.status !== 'pago' && i.status !== 'isento')
    .map((i) => ({ id: String(i.id), amount: i.totalAmountKz, dueDate: toISODate(i.dueDate), reference: i.multicaixaRef, studentName: i.studentName }));
  const result = useMemo(
    () => reconcileBank(pendingLines.map((l) => ({ id: l.id, date: l.date, amount: l.amount, description: l.description, reference: l.reference })), openInvoices),
    [pendingLines.length, openInvoices.length, db.bankStatementLines, db.invoices] // eslint-disable-line react-hooks/exhaustive-deps
  );
  const { page: pgMatches, setPage: setPgMatches, pageItems: visibleMatches } = usePagedList(result.matches, [result.matches.length]);
  const { page: pgUnmatchedLines, setPage: setPgUnmatchedLines, pageItems: visibleUnmatchedLines } = usePagedList(result.unmatchedLines, [result.unmatchedLines.length]);
  const all = db.bankStatementLines || [];
  const conciliadas = all.filter((l) => l.status === 'conciliada');
  const ignoradas = all.filter((l) => l.status === 'ignorada');

  const loadFile = async (file: File) => {
    setReading(true);
    try {
      const parsed = await readBankStatementFile(file);
      setPreview({ ...parsed, fileName: file.name });
    } catch (err: any) {
      setPreview({ format: 'csv', lines: [], skipped: 0, errors: [`Não foi possível ler "${file.name}": ${err?.message || 'ficheiro inválido'}.`], fileName: file.name });
    } finally {
      setReading(false);
    }
  };
  const loadPasted = () => setPreview({ ...parseBankText(pasted, 'colado.csv'), fileName: 'texto colado' });

  const importPreview = () => {
    if (!preview || preview.lines.length === 0) return;
    let info = '';
    run(() => {
      const r = dbService.importBankStatementLines(preview.lines);
      info = `${r.imported} linhas importadas, ${r.duplicates} repetidas ignoradas.`;
    }, 'A importar extrato...', rule, () => info);
    setPreview(null);
    setPasted('');
  };
  const previewTotals = preview ? statementTotals(preview.lines) : null;
  const candidatesFor = (lineAmount: number) => {
    const exact = openInvoices.filter((i) => i.amount === lineAmount);
    return exact.length > 0 ? exact : openInvoices;
  };

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-xs">
        {[['Por conciliar', pendingLines.length, 'text-amber-700'], ['Conciliadas', conciliadas.length, 'text-emerald-700'], ['Ignoradas', ignoradas.length, 'text-slate-500'], ['Valor por conciliar', kz(pendingLines.filter((l) => l.amount > 0).reduce((t, l) => t + l.amount, 0)), 'text-[#0b1f3a]']].map(([label, value, color]) => (
          <div key={String(label)} className="bg-white border border-slate-200 rounded-xl p-3"><div className="text-[10px] uppercase font-bold text-slate-400">{label}</div><div className={`text-lg font-black ${color}`}>{value}</div></div>
        ))}
      </div>
      <div className="bg-white border border-slate-200 rounded-xl p-4 space-y-3">
        <label className={labelCls}>Extrato bancário — carregue o ficheiro do banco (CSV, Excel .xlsx/.xls/.ods, OFX ou XML camt.053)</label>
        <input type="file" accept={BANK_FILE_ACCEPT} disabled={!can || reading} className="text-xs" title={can ? undefined : acl.denyMessage(rule)}
          onChange={async (e) => { const f = e.target.files?.[0]; if (f) await loadFile(f); e.target.value = ''; }} />
        <details className="text-[11px] text-slate-500">
          <summary className="cursor-pointer font-semibold">Ou cole o texto do extrato</summary>
          <textarea className={`${inputCls} h-24 py-2 font-mono mt-2`} value={pasted} onChange={(e) => setPasted(e.target.value)} placeholder={'Data;Descrição;Débito;Crédito;Referência\n05/10/2026;Transf. Encarregado Silva;;45.000,00;123456789'} />
          <button className={`${btnGhost} mt-2`} disabled={!can || !pasted.trim()} onClick={loadPasted}><BtnIcon n="preview" /> Pré-visualizar</button>
        </details>
        <p className="text-[11px] text-slate-400">Colunas reconhecidas pelo cabeçalho: Data, Descrição, Valor (ou Crédito/Débito separados) e Referência. Títulos e linhas de total antes/depois da tabela são ignorados.</p>
        {reading && <p className="text-xs text-slate-500">A ler ficheiro...</p>}
        {preview && (
          <div className="border border-slate-200 rounded-lg p-3 space-y-2 bg-slate-50">
            <div className="text-xs"><b>{preview.fileName}</b> · formato {preview.format.toUpperCase()} · {previewTotals!.count} movimentos
              {previewTotals!.count > 0 && <> · de {previewTotals!.from} a {previewTotals!.to} · créditos <b className="text-emerald-700">{kz(previewTotals!.credits)}</b> · débitos <b className="text-slate-600">{kz(previewTotals!.debits)}</b></>}
              {preview.skipped > 0 && <span className="text-slate-400"> · {preview.skipped} linhas ignoradas (títulos/totais)</span>}</div>
            {preview.lines.length > 0 && (
              <div className="max-h-40 overflow-auto bg-white border border-slate-200 rounded">
                <table className="w-full text-[11px]"><tbody>{preview.lines.slice(0, 8).map((l, i) => (
                  <tr key={i} className="border-b border-slate-100"><td className="p-1.5 whitespace-nowrap">{l.date}</td><td className="p-1.5">{l.description}</td><td className="p-1.5 text-right font-mono">{kz(l.amount)}</td><td className="p-1.5 font-mono text-slate-500">{l.reference || ''}</td></tr>
                ))}</tbody></table>
                {preview.lines.length > 8 && <div className="p-1.5 text-[10px] text-slate-400">e mais {preview.lines.length - 8} movimentos...</div>}
              </div>
            )}
            {preview.errors.length > 0 && <ul className="text-[11px] text-red-700 list-disc pl-4">{preview.errors.slice(0, 6).map((e) => <li key={e}>{e}</li>)}{preview.errors.length > 6 && <li>e mais {preview.errors.length - 6}...</li>}</ul>}
            <div className="flex gap-2">
              <button className={btnPrimary} disabled={!can || preview.lines.length === 0} onClick={importPreview}><BtnIcon n="upload_file" /> Importar {preview.lines.length} movimentos</button>
              <button className={btnGhost} onClick={() => setPreview(null)}><BtnIcon n="close" /> Cancelar</button>
            </div>
          </div>
        )}
      </div>
      <Banner message={message} />

      <h2 className="text-sm font-bold text-[#0b1f3a]">Correspondências sugeridas ({result.matches.length})</h2>
      <p className="text-[11px] text-slate-500">Nada é dado como pago sem a sua confirmação. "Exata" = referência e valor iguais; "Provável" = só o valor coincide e há uma única fatura em aberto com ele.</p>
      {result.matches.length === 0 ? <Empty text="Sem correspondências para confirmar." /> : (
        <div className="bg-white border border-slate-200 rounded-xl overflow-x-auto">
          <table className="w-full text-xs">
            <thead className="bg-[#0b1f3a] text-white font-bold uppercase text-[11px] tracking-wider text-left"><tr><th className="p-3 text-right">Valor</th><th className="p-3">Data</th><th className="p-3">Descrição / Ref.</th><th className="p-3">Fatura sugerida</th><th className="p-3">Confiança</th><th className="p-3 text-right">Ações</th></tr></thead>
            <tbody>
              {visibleMatches.map((m) => (
                <tr key={m.line.id} className="border-t border-slate-100 hover:bg-slate-50/60">
                  <td className="p-3 text-right font-mono font-bold">{kz(m.line.amount)}</td>
                  <td className="p-3 whitespace-nowrap">{m.line.date}</td>
                  <td className="p-3">{m.line.description}{m.line.reference ? <div className="text-[10px] text-slate-400">ref. {m.line.reference}</div> : null}</td>
                  <td className="p-3"><b>{m.invoice.studentName}</b><div className="text-[10px] text-slate-400">vence {m.invoice.dueDate || '—'}</div></td>
                  <td className={`p-3 font-bold ${m.confidence === 'exata' ? 'text-emerald-700' : 'text-amber-700'}`}>{m.confidence === 'exata' ? 'Exata' : 'Provável'}</td>
                  <td className="p-3"><div className="flex items-center gap-1 justify-end">
                    <IconButton icon="check_circle" tone="success" label="Confirmar conciliação" disabled={!can} onClick={() => run(() => dbService.confirmBankMatch(m.line.id, m.invoice.id), 'A conciliar...', rule, 'Pagamento conciliado e fatura liquidada.')} />
                  </div></td>
                </tr>
              ))}
            </tbody>
          </table>
          <TablePagination total={result.matches.length} page={pgMatches} onPageChange={setPgMatches} />
        </div>
      )}

      <h2 className="text-sm font-bold text-[#0b1f3a]">Linhas sem correspondência ({result.unmatchedLines.length})</h2>
      {result.unmatchedLines.length === 0 ? <Empty text="Tudo conciliado." /> : (
        <div className="bg-white border border-slate-200 rounded-xl overflow-x-auto">
          <table className="w-full text-xs">
            <thead className="bg-[#0b1f3a] text-white font-bold uppercase text-[11px] tracking-wider text-left"><tr><th className="p-3 text-right">Valor</th><th className="p-3">Data</th><th className="p-3">Descrição</th><th className="p-3">Referência</th><th className="p-3 text-right">Ações</th></tr></thead>
            <tbody>
              {visibleUnmatchedLines.map((l) => (
                <React.Fragment key={l.id}>
                  <tr className="border-t border-slate-100 hover:bg-slate-50/60">
                    <td className="p-3 text-right font-mono font-bold">{kz(l.amount)}{l.amount <= 0 && <div className="text-[10px] text-slate-400 font-normal">débito</div>}</td>
                    <td className="p-3 whitespace-nowrap">{l.date}</td>
                    <td className="p-3">{l.description}</td>
                    <td className="p-3 font-mono text-slate-500">{l.reference || '—'}</td>
                    <td className="p-3"><div className="flex items-center gap-1 justify-end">
                      {l.amount > 0 && <IconButton icon="link" tone="primary" label="Associar a fatura" disabled={!can} onClick={() => { setManualFor(manualFor === l.id ? null : l.id); setManualInvoice(''); }} />}
                      <IconButton icon="visibility_off" tone="danger" label="Ignorar linha" disabled={!can} onClick={() => run(() => { dbService.ignoreBankLine(l.id); }, 'A ignorar...', rule, 'Linha ignorada.')} />
                    </div></td>
                  </tr>
                  {manualFor === l.id && (
                    <tr className="bg-slate-50/70"><td colSpan={5} className="p-3">
                      <div className="flex items-end gap-2">
                        <div className="flex-1"><SearchableSelect label="Fatura em aberto" value={manualInvoice} onChange={setManualInvoice} placeholder="Pesquisar aluno ou valor" options={candidatesFor(l.amount).map((i) => ({ value: i.id, label: `${i.studentName || 'Fatura'} · ${kz(i.amount)}`, sublabel: `vence ${i.dueDate || '—'}${i.reference ? ` · ref. ${i.reference}` : ''}`, badge: i.amount === l.amount ? 'valor igual' : 'valor diferente' }))} /></div>
                        <IconButton variant="solid" icon="check" label="Confirmar conciliação" disabled={!can || !manualInvoice} onClick={() => run(() => dbService.confirmBankMatch(l.id, manualInvoice), 'A conciliar...', rule, 'Pagamento conciliado e fatura liquidada.').then((r) => { if (r.success) setManualFor(null); })} />
                      </div>
                    </td></tr>
                  )}
                </React.Fragment>
              ))}
            </tbody>
          </table>
          <TablePagination total={result.unmatchedLines.length} page={pgUnmatchedLines} onPageChange={setPgUnmatchedLines} />
        </div>
      )}
      <p className="text-[11px] text-slate-400">A conciliação lê ficheiros de extrato (CSV, Excel, OFX, XML). Não há ligação direta ao banco nem à EMIS/Multicaixa: isso exige contrato e credenciais da escola.</p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Despesas, contas a pagar e fluxo de caixa
// ---------------------------------------------------------------------------
function ContabilidadeTab({ db, role }: { db: SchoolDatabase; role: UserRole }) {
  const acl = useAccessControl(role);
  const { message, run } = useRunner(role);
  const can = acl.can('financeiro.contabilidade.manage');
  const rule = 'financeiro.contabilidade.manage';
  const [supplier, setSupplier] = useState('');
  const [category, setCategory] = useState('');
  const [description, setDescription] = useState('');
  const [amount, setAmount] = useState('');
  const [date, setDate] = useState(today());
  const [dueDate, setDueDate] = useState('');
  const [paidNow, setPaidNow] = useState(false);
  const [detailMonth, setDetailMonth] = useState<string | null>(null);
  const [closingCash, setClosingCash] = useState(false);
  const [viewSession, setViewSession] = useState<CashSession | null>(null);

  const expenses = db.expenses || [];
  const sessions: CashSession[] = db.cashSessions || [];
  const openSession = sessions.find((c) => c.status === 'aberto');
  const ledger = useMemo(() => buildLedger((db.invoices || []) as any, expenses as any, (db.payrollRecords || []) as any, (db.assets || []) as any), [db.invoices, expenses, db.payrollRecords, db.assets]);
  const live = useMemo(() => {
    if (!openSession) return null;
    const done = new Set<string>(sessions.filter((c) => c.status === 'fechado').flatMap((c) => c.movementIds || []));
    return computeSessionTotals(ledger, openSession.openedAt, openSession.openingFloat, done);
  }, [openSession, sessions, ledger]);
  const cashClosedMsg = 'Caixa fechada: abra a caixa para registar pagamentos.';
  const payables = accountsPayable(expenses);
  const { page: pgPayables, setPage: setPgPayables, pageItems: visiblePayables } = usePagedList(payables, [payables.length]);
  const overdueTotal = payables.filter((e) => isOverdue(e, today())).reduce((s, e) => s + e.amount, 0);

  // Fluxo mensal: soma TODOS os movimentos do mês (entradas de todos os meios e saídas pagas),
  // independentemente de quantas caixas foram abertas/fechadas nesse mês. Usa o mesmo livro do detalhe.
  const flow = useMemo(() => {
    const movements: CashMovement[] = ledger.map((e) => ({
      date: e.date,
      amount: e.kind === 'entrada' ? e.amount : -e.amount,
      source: e.kind === 'entrada' ? 'propinas' : e.category === PAYROLL_CATEGORY ? 'folha_pagamento' : e.category === ASSET_INVESTMENT_CATEGORY ? 'investimento_ativos' : 'despesa'
    }));
    return monthlyCashFlow(movements, 0);
  }, [ledger]);
  const { page: pgFlow, setPage: setPgFlow, pageItems: visibleFlow } = usePagedList(flow, [flow.length]);

  // Folha: previsão de saídas (recibos pendentes + encargos INSS/IRT por entregar) e geração das contas a pagar dos encargos.
  const payrollTax = useMemo(() => getEffectivePayrollTaxSettings(db), [db]);
  const paidChargeIds = useMemo(() => expenses.filter((e) => e.id.startsWith('enc-') && e.paidDate).map((e) => e.id), [expenses]);
  const forecast = useMemo(() => payrollForecast((db.payrollRecords || []) as any, payrollTax, paidChargeIds), [db.payrollRecords, payrollTax, paidChargeIds]);
  const chargesPending = useMemo(() => {
    const have = new Set(expenses.map((e) => e.id));
    return payrollChargesDue((db.payrollRecords || []) as any, payrollTax).filter((d) => !have.has(d.id)).length;
  }, [db.payrollRecords, payrollTax, expenses]);

  return (
    <div className="space-y-6">
      <Banner message={message} />
      <CashSessionPanel
        openSession={openSession}
        live={live}
        sessions={sessions}
        can={can}
        denyMessage={acl.denyMessage(rule)}
        onOpen={async (openingFloat, note) => (await run(() => dbService.openCashSession({ openingFloat, note }), 'A abrir caixa...', rule, 'Caixa aberta com sucesso.')).success}
        onRequestClose={() => setClosingCash(true)}
        onViewSession={setViewSession}
      />
      <section className="space-y-3">
        <h2 className="text-sm font-bold text-[#0b1f3a]">Registar despesa</h2>
        <div className="bg-white border border-slate-200 rounded-xl p-4 grid md:grid-cols-4 gap-3 items-end">
          <div><label className={labelCls}>Fornecedor</label><input className={inputCls} value={supplier} onChange={(e) => setSupplier(e.target.value)} list="fornecedores-lista" /><datalist id="fornecedores-lista">{(db.suppliers || []).map((s: any) => <option key={s.id} value={s.name} />)}</datalist></div>
          <div><label className={labelCls}>Categoria</label><input className={inputCls} value={category} onChange={(e) => setCategory(e.target.value)} placeholder="ex.: Água e luz" /></div>
          <div className="md:col-span-2"><label className={labelCls}>Descrição</label><input className={inputCls} value={description} onChange={(e) => setDescription(e.target.value)} /></div>
          <div><label className={labelCls}>Valor (Kz)</label><input className={inputCls} inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} /></div>
          <div><label className={labelCls}>Data da despesa</label><input type="date" className={inputCls} value={date} onChange={(e) => setDate(e.target.value)} /></div>
          <div><label className={labelCls}>Pagar até</label><input type="date" className={inputCls} value={dueDate} onChange={(e) => setDueDate(e.target.value)} disabled={paidNow} /></div>
          <label className="text-[11px] text-slate-700 flex items-center gap-2 h-10" title={openSession ? undefined : cashClosedMsg}><input type="checkbox" checked={paidNow && !!openSession} disabled={!openSession} onChange={(e) => setPaidNow(e.target.checked)} />Já paga{!openSession && <span className="text-red-600">(caixa fechada)</span>}</label>
          <div className="md:col-span-4 flex justify-end"><button className={btnPrimary} disabled={!can} title={can ? undefined : acl.denyMessage(rule)} onClick={async () => {
            const r = await run(() => dbService.saveExpense({ supplier: supplier.trim() || undefined, category, description: description.trim() || undefined, amount: Number(amount.replace(',', '.')), date, dueDate: paidNow ? undefined : dueDate || undefined, paidDate: paidNow ? date : undefined }), 'A guardar despesa...', rule, 'Despesa registada.');
            if (r.success) { setSupplier(''); setCategory(''); setDescription(''); setAmount(''); setDueDate(''); setPaidNow(false); }
          }}><BtnIcon n="save" /> Guardar despesa</button></div>
        </div>
      </section>

      <section className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-sm font-bold text-[#0b1f3a]">Folha de pagamento: previsão de saídas</h2>
          <button type="button" className={btnPrimary} disabled={!can} title={can ? undefined : acl.denyMessage(rule)}
            onClick={() => run(() => dbService.syncPayrollChargePayables(), 'A gerar encargos da folha...', rule, 'Encargos da folha (INSS/IRT) actualizados nas contas a pagar.')}>
            <BtnIcon n="account_balance" /> Gerar encargos INSS/IRT{chargesPending > 0 ? ` (${chargesPending})` : ''}
          </button>
        </div>
        {forecast.length === 0 ? <Empty text="Sem recibos pendentes nem encargos da folha por pagar." /> : (
          <div className="bg-white border border-slate-200 rounded-xl overflow-x-auto">
            <table className="w-full text-xs">
              <thead className="bg-[#0b1f3a] text-white font-bold uppercase text-[11px] tracking-wider text-left"><tr><th className="p-3">Mês de referência</th><th className="p-3 text-right">Salários por pagar (líquido)</th><th className="p-3 text-right">Encargos INSS/IRT por pagar</th><th className="p-3 text-right">Total previsto</th></tr></thead>
              <tbody>
                {forecast.map((m) => (
                  <tr key={m.month} className="border-t border-slate-100">
                    <td className="p-3 font-semibold">{m.month}</td>
                    <td className="p-3 text-right font-mono">{kz(m.pendingNet)}{m.pendingCount > 0 && <span className="text-slate-400"> ({m.pendingCount})</span>}</td>
                    <td className="p-3 text-right font-mono">{kz(m.chargesDue)}</td>
                    <td className="p-3 text-right font-mono font-bold">{kz(m.pendingNet + m.chargesDue)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <p className="text-[11px] text-slate-400">O salário líquido pago já entra no fluxo de caixa. Os encargos (INSS trabalhador + patronal e IRT retido) entram quando forem marcados como pagos em Contas a pagar. Os prazos (INSS até ao dia 10 e IRT até ao fim do mês seguinte) são de referência: confirme com o contabilista.</p>
      </section>

      <section className="space-y-3">
        <h2 className="text-sm font-bold text-[#0b1f3a]">Contas a pagar ({payables.length}){overdueTotal > 0 && <span className="ml-2 text-red-700">em atraso: {kz(overdueTotal)}</span>}</h2>
        {payables.length === 0 ? <Empty text="Sem contas a pagar." /> : (
          <div className="bg-white border border-slate-200 rounded-xl overflow-x-auto">
            <table className="w-full text-xs">
              <thead className="bg-[#0b1f3a] text-white font-bold uppercase text-[11px] tracking-wider text-left"><tr><th className="p-3 text-right">Valor</th><th className="p-3">Categoria</th><th className="p-3">Fornecedor</th><th className="p-3">Vencimento</th><th className="p-3">Estado</th><th className="p-3 text-right">Ações</th></tr></thead>
              <tbody>
                {visiblePayables.map((e) => (
                  <tr key={e.id} className="border-t border-slate-100 hover:bg-slate-50/60">
                    <td className="p-3 text-right font-mono font-bold">{kz(e.amount)}</td>
                    <td className="p-3">{e.category}</td>
                    <td className="p-3">{e.supplier || '—'}</td>
                    <td className="p-3 whitespace-nowrap">{e.dueDate || 'sem prazo'}</td>
                    <td className="p-3">{isOverdue(e, today()) ? <span className="text-red-700 font-bold">EM ATRASO</span> : <span className="text-slate-500">A pagar</span>}</td>
                    <td className="p-3"><div className="flex items-center gap-1 justify-end">
                      <IconButton icon="paid" tone="success" label="Marcar como paga hoje" disabled={!can || !openSession} disabledTitle={cashClosedMsg} onClick={() => run(() => { dbService.markExpensePaid(e.id, today()); }, 'A marcar paga...', rule, 'Despesa marcada como paga hoje.')} />
                      <IconButton icon="delete" tone="danger" label="Eliminar despesa" disabled={!can} onClick={() => run(() => { dbService.deleteExpense(e.id); }, 'A eliminar...', rule, 'Despesa eliminada.')} />
                    </div></td>
                  </tr>
                ))}
              </tbody>
            </table>
            <TablePagination total={payables.length} page={pgPayables} onPageChange={setPgPayables} />
          </div>
        )}
      </section>

      <section className="space-y-3">
        <h2 className="text-sm font-bold text-[#0b1f3a]">Fluxo de caixa mensal</h2>
        {flow.length === 0 ? <Empty text="Ainda não há movimentos pagos." /> : (
          <div className="bg-white border border-slate-200 rounded-xl overflow-x-auto">
            <table className="w-full text-xs">
              <thead className="bg-[#0b1f3a] text-white font-bold uppercase text-[11px] tracking-wider text-left"><tr><th className="p-3">Mês</th><th className="p-3 text-right">Entradas</th><th className="p-3 text-right">Saídas</th><th className="p-3 text-right">Líquido</th><th className="p-3 text-right">Saldo</th><th className="p-3 text-right">Ação</th></tr></thead>
              <tbody>{visibleFlow.map((m) => (
                <tr key={m.month} className="border-t border-slate-100"><td className="p-3 font-semibold">{m.month}</td><td className="p-3 text-right">{kz(m.inflow)}</td><td className="p-3 text-right">{kz(m.outflow)}</td><td className={`p-3 text-right font-bold ${m.net < 0 ? 'text-red-700' : 'text-emerald-700'}`}>{kz(m.net)}</td><td className="p-3 text-right font-bold">{kz(m.closingBalance)}</td><td className="p-3 text-right"><button className={btnGhost} onClick={() => setDetailMonth(m.month)}>Ver detalhes</button></td></tr>
              ))}</tbody>
            </table>
            <TablePagination total={flow.length} page={pgFlow} onPageChange={setPgFlow} />
          </div>
        )}
        <p className="text-[11px] text-slate-400">Cada mês soma todas as entradas (numerário, TPA, Multicaixa e outros) e todas as saídas pagas em qualquer dia desse mês, em todas as caixas abertas e fechadas. O saldo é acumulado mês a mês. A folha de pagamento paga e o valor investido em activos (Inventário de Activos, no mês da data de aquisição) entram como despesas.</p>
      </section>

      {detailMonth && (() => {
        const idx = flow.findIndex((m) => m.month === detailMonth);
        const openingBalance = idx > 0 ? flow[idx - 1].closingBalance : 0;
        return <MonthDetailModal month={detailMonth} openingBalance={openingBalance} entries={ledger.filter((e) => e.date.slice(0, 7) === detailMonth)} onClose={() => setDetailMonth(null)} />;
      })()}
      {closingCash && openSession && live && (
        <CloseCashModal session={openSession} live={live} onCancel={() => setClosingCash(false)} onConfirm={async (countedCash, note) => {
          const r = await run(() => dbService.closeCashSession({ sessionId: openSession.id, countedCash, note }), 'A fechar caixa...', rule, 'Caixa fechada com sucesso.');
          if (r.success) setClosingCash(false);
        }} />
      )}
      {viewSession && <SessionDetailModal session={viewSession} ledger={ledger} onClose={() => setViewSession(null)} />}
    </div>
  );
}

const TITLES: Record<FinanceiroSection, { title: string; subtitle: string }> = {
  planos_descontos: { title: 'BOLSAS, DESCONTOS E PLANOS', subtitle: 'Prestações, regras de desconto e simulação.' },
  conciliacao_bancaria: { title: 'CONCILIAÇÃO BANCÁRIA', subtitle: 'Importe o extrato e confirme que pagamentos correspondem a que faturas.' },
  contabilidade: { title: 'FLUXOS DE CAIXA E DESPESAS', subtitle: 'Abertura e fecho de caixa, despesas, contas a pagar e fluxo de caixa mensal.' }
};

export const FinanceiroAvancadoView: React.FC<Props> = ({ db, currentUserRole, section }) => {
  const head = TITLES[section];
  return (
    <div className="p-4 md:p-6 space-y-4">
      <div>
        <h1 className="text-xl font-bold text-[#0b1f3a]">{head.title}</h1>
        <p className="text-xs text-slate-500">{head.subtitle}</p>
      </div>
      {section === 'planos_descontos' && <PlanosTab db={db} role={currentUserRole} />}
      {section === 'conciliacao_bancaria' && <ConciliacaoTab db={db} role={currentUserRole} />}
      {section === 'contabilidade' && <ContabilidadeTab db={db} role={currentUserRole} />}
    </div>
  );
};
