import React, { useMemo, useState } from 'react';
import { BookLoan, LibraryBook, SchoolDatabase, UserRole } from '../types';
import { dbService } from '../services/db';
import { useAccessControl } from '../hooks/useAccessControl';
import { SearchableSelect } from '../components/SearchableSelect';
import { FormModal } from '../components/FormModal';
import {
  Badge, Banner, Empty, Kpis, PageHeader, TabBar, fmtDate, inputCls, kz, labelCls, useOperation
} from '../components/portalUi';
import { BTN_ACTION, BtnIcon, IconButton } from '../components/IconButton';
import { TablePagination, usePagedList } from '../components/TablePagination';
import { Notice } from '../components/Notice';

// Botões com ícone e nome (fundo azul habitual); as ações de linha de tabela usam só ícone.
const btnPrimary = BTN_ACTION.replace('h-9', 'h-10');
const btnGhost = BTN_ACTION;
const btnDanger = 'inline-flex items-center justify-center gap-1.5 h-9 px-3 bg-[#7a0c0c] text-white text-xs font-bold rounded-lg hover:bg-[#5e0909] active:scale-[0.98] transition disabled:opacity-40 disabled:cursor-not-allowed';
import {
  computeFine, effectiveStatus, outstandingFine, summarizeLoans, toISO, DEFAULT_LIBRARY_POLICY
} from '../utils/libraryLoans';
import type { LibraryPolicy, LoanRecord } from '../utils/libraryLoans';

interface Props {
  db: SchoolDatabase;
  currentUserRole: UserRole;
}

type Tab = 'emprestimos' | 'acervo' | 'multas' | 'politica';
type BorrowerKind = 'aluno' | 'professor' | 'funcionario';

const RULE = 'biblioteca.manage';

const STATUS_META: Record<LoanRecord['status'], { label: string; tone: string }> = {
  ativo: { label: 'Ativo', tone: 'bg-blue-100 text-blue-800' },
  atrasado: { label: 'Em atraso', tone: 'bg-red-100 text-red-800' },
  devolvido: { label: 'Devolvido', tone: 'bg-emerald-100 text-emerald-800' },
  perdido: { label: 'Perdido', tone: 'bg-slate-200 text-slate-700' }
};

export const BibliotecaEmprestimosView: React.FC<Props> = ({ db, currentUserRole }) => {
  const acl = useAccessControl(currentUserRole);
  const canManage = acl.can(RULE);
  const { message, setMessage, run } = useOperation(currentUserRole);
  const [tab, setTab] = useState<Tab>('emprestimos');

  const today = toISO(new Date());
  const policy: LibraryPolicy = { ...DEFAULT_LIBRARY_POLICY, ...(db.settings?.libraryPolicy || {}) };
  const books = db.books || [];
  const loans = (db.loans || []) as BookLoan[];
  const summary = useMemo(() => summarizeLoans(loans as LoanRecord[], today, policy), [loans, today, policy]);

  return (
    <div className="space-y-4">
      <PageHeader
        eyebrow="COMUNICAÇÃO"
        title="EMPRÉSTIMOS E DEVOLUÇÕES"
        description="Registe empréstimos e devoluções. A multa é calculada pelos dias de atraso."
      />
      <Kpis
        items={[
          { label: 'Empréstimos ativos', value: summary.active },
          { label: 'Em atraso', value: summary.overdue, tone: summary.overdue > 0 ? 'danger' : 'default' },
          { label: 'Multas por cobrar', value: kz(summary.finesOutstanding), tone: summary.finesOutstanding > 0 ? 'warn' : 'default' },
          { label: 'Multa a correr (atrasos abertos)', value: kz(summary.finesRunning), tone: summary.finesRunning > 0 ? 'warn' : 'default' }
        ]}
      />
      <TabBar<Tab>
        tabs={[
          { id: 'emprestimos', label: 'Empréstimos', icon: 'swap_horiz' },
          { id: 'acervo', label: 'Acervo', icon: 'menu_book' },
          { id: 'multas', label: 'Multas', icon: 'payments' },
          { id: 'politica', label: 'Política', icon: 'tune' }
        ]}
        active={tab}
        onChange={(t) => { setTab(t); setMessage(null); }}
      />
      <Banner message={message} />
      {!canManage && (
        <Notice tone="warn">
          O seu perfil só pode consultar a biblioteca; as ações de registo estão desativadas.
        </Notice>
      )}
      {tab === 'emprestimos' && <EmprestimosTab message={message} db={db} books={books} loans={loans} today={today} policy={policy} canManage={canManage} run={run} />}
      {tab === 'acervo' && <AcervoTab message={message} books={books} canManage={canManage} run={run} />}
      {tab === 'multas' && <MultasTab loans={loans} today={today} policy={policy} canManage={canManage} run={run} />}
      {tab === 'politica' && <PoliticaTab policy={policy} canManage={canManage} run={run} />}
    </div>
  );
};

type RunFn = ReturnType<typeof useOperation>['run'];

// ---------------------------------------------------------------------------
function EmprestimosTab({ message, db, books, loans, today, policy, canManage, run }: {
  message: { ok: boolean; text: string } | null; db: SchoolDatabase; books: LibraryBook[]; loans: BookLoan[]; today: string; policy: LibraryPolicy; canManage: boolean; run: RunFn;
}) {
  const [formOpen, setFormOpen] = useState(false);
  const [kind, setKind] = useState<BorrowerKind>('aluno');
  const [borrowerId, setBorrowerId] = useState('');
  const [bookId, setBookId] = useState('');
  const [filter, setFilter] = useState('');
  const [onlyOpen, setOnlyOpen] = useState(true);
  const [lostId, setLostId] = useState<string | null>(null);
  const [lostCost, setLostCost] = useState('');

  const borrowers = useMemo(() => {
    if (kind === 'aluno') return (db.students || []).map((s) => ({ value: String(s.id), label: s.name, sublabel: `${s.procNumber} · ${s.className || s.grade}` }));
    if (kind === 'professor') return (db.teachers || []).map((t) => ({ value: String(t.id), label: t.name, sublabel: t.agentNumber }));
    return (db.funcionarios || []).map((f) => ({ value: String(f.id), label: f.name, sublabel: f.employeeNumber }));
  }, [kind, db.students, db.teachers, db.funcionarios]);

  const bookOptions = books.map((b) => ({
    value: b.id,
    label: b.title,
    sublabel: `${b.author || 'Autor n/d'} · ${b.availableCopies}/${b.totalCopies} disponível(is)`
  }));

  const issue = async () => {
    const who = borrowers.find((b) => b.value === borrowerId);
    if (!who) return run(() => ({ success: false, error: 'Escolha o leitor.' }), 'A registar empréstimo...', RULE, '');
    const ok = await run(
      () => dbService.issueBookLoan(bookId, { id: who.value, name: who.label, role: kind }),
      'A registar empréstimo...', RULE, `Empréstimo registado. Devolução prevista em ${policy.loanDays} dias.`
    );
    if (ok) { setBookId(''); setBorrowerId(''); setFormOpen(false); }
  };

  const shown = loans
    .filter((l) => !onlyOpen || (!l.returnDate && l.status !== 'devolvido' && l.status !== 'perdido'))
    .filter((l) => !filter.trim() || `${l.bookTitle} ${l.borrowerName}`.toLowerCase().includes(filter.trim().toLowerCase()));
  const { page: pgShown, setPage: setPgShown, pageItems: visibleShown } = usePagedList(shown, [shown.length]);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <p className="text-[11px] text-slate-500">Prazo de {policy.loanDays} dias · máximo de {policy.maxActiveLoans} empréstimos por leitor · {policy.maxRenewals} renovação(ões).</p>
        <button type="button" className={btnPrimary} disabled={!canManage} onClick={() => { setKind('aluno'); setBorrowerId(''); setBookId(''); setFormOpen(true); }}><BtnIcon n="bookmark_add" /> Registar empréstimo</button>
      </div>
      {formOpen && (
        <FormModal title="Registar empréstimo" subtitle="Empréstimos, Devoluções & Multas" icon="bookmark_add" widthClass="max-w-2xl" onClose={() => setFormOpen(false)} onSubmit={async () => { await issue(); }} submitLabel="Registar empréstimo" submitDisabled={!canManage || !bookId || !borrowerId}>
          <div className="grid md:grid-cols-2 gap-3">
        <div>
          <label className={labelCls}>Tipo de leitor</label>
          <select className={inputCls} value={kind} onChange={(e) => { setKind(e.target.value as BorrowerKind); setBorrowerId(''); }}>
            <option value="aluno">Aluno</option>
            <option value="professor">Professor</option>
            <option value="funcionario">Funcionário</option>
          </select>
        </div>
        <div className="md:col-span-2">
          <label className={labelCls}>Leitor</label>
          <SearchableSelect options={borrowers} value={borrowerId} onChange={setBorrowerId} placeholder="Pesquise o leitor..." />
        </div>
        <div className="md:col-span-2">
          <label className={labelCls}>Livro</label>
          <SearchableSelect options={bookOptions} value={bookId} onChange={setBookId} placeholder="Pesquise o livro..." emptyMessage="Sem livros no acervo: cadastre-os no separador Acervo." />
        </div>
          </div>
          <Banner message={message && !message.ok ? message : null} />
        </FormModal>
      )}

      <div className="flex items-center gap-3">
        <input className={`${inputCls} max-w-xs`} placeholder="Filtrar por livro ou leitor" value={filter} onChange={(e) => setFilter(e.target.value)} />
        <label className="text-xs text-slate-600 flex items-center gap-1.5">
          <input type="checkbox" checked={onlyOpen} onChange={(e) => setOnlyOpen(e.target.checked)} /> Só em aberto
        </label>
      </div>

      <div className="bg-white border border-slate-200 rounded-xl overflow-x-auto">
        {shown.length === 0 ? <Empty text="Sem empréstimos para mostrar." /> : (
          <><table className="w-full text-xs">
            <thead className="bg-[#0b1f3a] text-white font-bold uppercase text-[11px] tracking-wider text-left">
              <tr>
                <th className="text-left px-3 py-2">Livro</th><th className="text-left px-3 py-2">Leitor</th>
                <th className="text-left px-3 py-2">Saída</th><th className="text-left px-3 py-2">Devolução prevista</th>
                <th className="text-left px-3 py-2">Estado</th><th className="text-right px-3 py-2">Multa</th><th className="px-3 py-2" />
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {visibleShown.map((l) => {
                const st = effectiveStatus(l as LoanRecord, today);
                const open = !l.returnDate && l.status !== 'devolvido' && l.status !== 'perdido';
                const running = open && st === 'atrasado' ? computeFine(l.dueDate, today, policy) : 0;
                return (
                  <React.Fragment key={l.id}>
                    <tr>
                      <td className="px-3 py-2 font-semibold text-slate-800">{l.bookTitle}</td>
                      <td className="px-3 py-2 text-slate-600">{l.borrowerName}<span className="text-slate-400"> · {l.borrowerRole}</span></td>
                      <td className="px-3 py-2">{fmtDate(l.borrowDate)}</td>
                      <td className="px-3 py-2">{fmtDate(l.dueDate)}{(l.renewals || 0) > 0 ? <span className="text-slate-400"> ({l.renewals}× renovado)</span> : null}</td>
                      <td className="px-3 py-2"><Badge tone={STATUS_META[st].tone}>{STATUS_META[st].label}</Badge></td>
                      <td className="px-3 py-2 text-right">{l.fineAmount ? kz(l.fineAmount) : running ? <span className="text-amber-700">{kz(running)} (a correr)</span> : '—'}</td>
                      <td className="px-3 py-2">
                        {open && (
                          <div className="flex justify-end gap-1">
                            <IconButton icon="assignment_return" tone="success" label="Devolver" disabled={!canManage} onClick={() => run(() => dbService.returnBookLoan(l.id), 'A registar devolução...', RULE, 'Devolução registada.')} />
                            <IconButton icon="autorenew" tone="primary" label="Renovar" disabled={!canManage} onClick={() => run(() => dbService.renewBookLoan(l.id), 'A renovar...', RULE, 'Empréstimo renovado.')} />
                            <IconButton icon="report" tone="danger" label="Marcar como perdido" disabled={!canManage} onClick={() => { setLostId(lostId === l.id ? null : l.id); setLostCost(''); }} />
                          </div>
                        )}
                      </td>
                    </tr>
                    {lostId === l.id && (
                      <tr className="bg-red-50/40">
                        <td colSpan={7} className="px-3 py-2">
                          <div className="flex items-end gap-2">
                            <div>
                              <label className={labelCls}>Valor de reposição (Kz)</label>
                              <input className={inputCls} type="number" min={0} value={lostCost} onChange={(e) => setLostCost(e.target.value)} />
                            </div>
                            <button type="button" className={btnDanger} disabled={!canManage || lostCost === ''}
                              onClick={async () => { if (await run(() => dbService.markBookLost(l.id, Number(lostCost)), 'A registar perda...', RULE, 'Livro dado como perdido; o exemplar saiu do acervo.')) setLostId(null); }}>
                              <BtnIcon n="check" /> Confirmar perda
                            </button>
                          </div>
                        </td>
                      </tr>
                    )}
                  </React.Fragment>
                );
              })}
            </tbody>
          </table>
          <TablePagination total={shown.length} page={pgShown} onPageChange={setPgShown} />
          </>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
function AcervoTab({ message, books, canManage, run }: { message: { ok: boolean; text: string } | null; books: LibraryBook[]; canManage: boolean; run: RunFn }) {
  const empty = { id: '', title: '', author: '', isbn: '', category: '', shelfLocation: '', totalCopies: '1' };
  const [form, setForm] = useState(empty);
  const [formOpen, setFormOpen] = useState(false);
  const set = (k: keyof typeof empty, v: string) => setForm((f) => ({ ...f, [k]: v }));
  const { page: pgBooks, setPage: setPgBooks, pageItems: visibleBooks } = usePagedList(books, [books.length]);

  const save = async () => {
    const ok = await run(
      () => dbService.saveBook({
        id: form.id || undefined, title: form.title, author: form.author, isbn: form.isbn,
        category: form.category, shelfLocation: form.shelfLocation, totalCopies: Number(form.totalCopies)
      }),
      'A guardar livro...', RULE, form.id ? 'Livro atualizado.' : 'Livro cadastrado no acervo.'
    );
    if (ok) { setForm(empty); setFormOpen(false); }
  };

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <button type="button" className={btnPrimary} disabled={!canManage} onClick={() => { setForm(empty); setFormOpen(true); }}><BtnIcon n="library_add" /> Cadastrar livro</button>
      </div>
      {formOpen && (
        <FormModal title={form.id ? 'Editar livro' : 'Cadastrar livro'} subtitle="Acervo da biblioteca" icon="library_add" widthClass="max-w-3xl" onClose={() => { setFormOpen(false); setForm(empty); }} onSubmit={save} submitLabel={form.id ? 'Guardar alterações' : 'Cadastrar livro'} submitDisabled={!canManage || !form.title.trim()}>
          <div className="grid md:grid-cols-6 gap-3">
        <div className="md:col-span-2"><label className={labelCls}>Título *</label><input className={inputCls} value={form.title} onChange={(e) => set('title', e.target.value)} /></div>
        <div className="md:col-span-2"><label className={labelCls}>Autor</label><input className={inputCls} value={form.author} onChange={(e) => set('author', e.target.value)} /></div>
        <div><label className={labelCls}>ISBN</label><input className={inputCls} value={form.isbn} onChange={(e) => set('isbn', e.target.value)} /></div>
        <div><label className={labelCls}>Exemplares *</label><input className={inputCls} type="number" min={1} value={form.totalCopies} onChange={(e) => set('totalCopies', e.target.value)} /></div>
        <div className="md:col-span-2"><label className={labelCls}>Categoria</label><input className={inputCls} value={form.category} onChange={(e) => set('category', e.target.value)} placeholder="Geral" /></div>
        <div className="md:col-span-2"><label className={labelCls}>Localização na estante</label><input className={inputCls} value={form.shelfLocation} onChange={(e) => set('shelfLocation', e.target.value)} /></div>
          </div>
          <Banner message={message && !message.ok ? message : null} />
        </FormModal>
      )}
      <div className="bg-white border border-slate-200 rounded-xl overflow-x-auto">
        {books.length === 0 ? <Empty text="O acervo está vazio. Cadastre o primeiro livro com o botão acima." /> : (
          <><table className="w-full text-xs">
            <thead className="bg-[#0b1f3a] text-white font-bold uppercase text-[11px] tracking-wider text-left">
              <tr><th className="text-left px-3 py-2">Título</th><th className="text-left px-3 py-2">Autor</th><th className="text-left px-3 py-2">Categoria</th><th className="text-left px-3 py-2">Estante</th><th className="text-right px-3 py-2">Disponíveis</th><th className="px-3 py-2" /></tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {visibleBooks.map((b) => (
                <tr key={b.id}>
                  <td className="px-3 py-2 font-semibold text-slate-800">{b.title}</td>
                  <td className="px-3 py-2 text-slate-600">{b.author || '—'}</td>
                  <td className="px-3 py-2">{b.category}</td>
                  <td className="px-3 py-2">{b.shelfLocation || '—'}</td>
                  <td className="px-3 py-2 text-right font-mono">{b.availableCopies}/{b.totalCopies}</td>
                  <td className="px-3 py-2 text-right">
                    <IconButton icon="edit" tone="primary" label="Editar livro" disabled={!canManage} onClick={() => { setFormOpen(true); setForm({ id: b.id, title: b.title, author: b.author, isbn: b.isbn, category: b.category, shelfLocation: b.shelfLocation, totalCopies: String(b.totalCopies) }); }} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <TablePagination total={books.length} page={pgBooks} onPageChange={setPgBooks} />
          </>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
function MultasTab({ loans, today, policy, canManage, run }: { loans: BookLoan[]; today: string; policy: LibraryPolicy; canManage: boolean; run: RunFn }) {
  const [waiveId, setWaiveId] = useState<string | null>(null);
  const [reason, setReason] = useState('');
  const fined = loans.filter((l) => (l.fineAmount || 0) > 0);
  const { page: pgFined, setPage: setPgFined, pageItems: visibleFined } = usePagedList(fined, [fined.length]);
  const running = loans.filter((l) => !l.returnDate && l.status !== 'devolvido' && l.status !== 'perdido' && computeFine(l.dueDate, today, policy) > 0);

  return (
    <div className="space-y-4">
      {running.length > 0 && (
        <Notice tone="warn">
          <p className="font-bold mb-1">Atrasos ainda por devolver</p>
          <p>A multa só fica fixada quando o livro é devolvido (ou dado como perdido). Até lá, o valor abaixo é uma estimativa a hoje.</p>
          <ul className="mt-2 space-y-0.5">
            {running.map((l) => <li key={l.id}>{l.bookTitle} — {l.borrowerName}: {kz(computeFine(l.dueDate, today, policy))} (previsto devolver em {fmtDate(l.dueDate)})</li>)}
          </ul>
        </Notice>
      )}
      <div className="bg-white border border-slate-200 rounded-xl overflow-x-auto">
        {fined.length === 0 ? <Empty text="Não há multas registadas." /> : (
          <><table className="w-full text-xs">
            <thead className="bg-[#0b1f3a] text-white font-bold uppercase text-[11px] tracking-wider text-left">
              <tr><th className="text-left px-3 py-2">Livro</th><th className="text-left px-3 py-2">Leitor</th><th className="text-left px-3 py-2">Origem</th><th className="text-right px-3 py-2">Valor</th><th className="text-left px-3 py-2">Situação</th><th className="px-3 py-2" /></tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {visibleFined.map((l) => {
                const due = outstandingFine(l as LoanRecord);
                return (
                  <React.Fragment key={l.id}>
                    <tr>
                      <td className="px-3 py-2 font-semibold text-slate-800">{l.bookTitle}</td>
                      <td className="px-3 py-2">{l.borrowerName}</td>
                      <td className="px-3 py-2">{l.status === 'perdido' ? 'Reposição (perdido)' : 'Atraso'}</td>
                      <td className="px-3 py-2 text-right">{kz(l.fineAmount || 0)}</td>
                      <td className="px-3 py-2">
                        {l.finePaid ? <Badge tone="bg-emerald-100 text-emerald-800">Paga em {fmtDate(l.finePaidAt)}</Badge>
                          : l.fineWaivedReason ? <Badge tone="bg-slate-200 text-slate-700" >Perdoada: {l.fineWaivedReason}</Badge>
                          : <Badge tone="bg-amber-100 text-amber-800">Por pagar</Badge>}
                      </td>
                      <td className="px-3 py-2">
                        {due > 0 && (
                          <div className="flex justify-end gap-1">
                            <IconButton icon="payments" tone="success" label="Registar multa como paga" disabled={!canManage} onClick={() => run(() => dbService.payLoanFine(l.id), 'A registar pagamento...', RULE, 'Pagamento da multa registado (sem recibo fiscal).')} />
                            <IconButton icon="volunteer_activism" tone="primary" label="Perdoar multa" disabled={!canManage} onClick={() => { setWaiveId(waiveId === l.id ? null : l.id); setReason(''); }} />
                          </div>
                        )}
                      </td>
                    </tr>
                    {waiveId === l.id && (
                      <tr className="bg-slate-50">
                        <td colSpan={6} className="px-3 py-2">
                          <div className="flex items-end gap-2">
                            <div className="flex-1"><label className={labelCls}>Motivo do perdão (obrigatório)</label><input className={inputCls} value={reason} onChange={(e) => setReason(e.target.value)} /></div>
                            <button type="button" className={btnGhost} disabled={!canManage || reason.trim().length < 5}
                              onClick={async () => { if (await run(() => dbService.waiveLoanFine(l.id, reason), 'A perdoar multa...', RULE, 'Multa perdoada.')) setWaiveId(null); }}>
                              <BtnIcon n="check" /> Confirmar perdão
                            </button>
                          </div>
                        </td>
                      </tr>
                    )}
                  </React.Fragment>
                );
              })}
            </tbody>
          </table>
          <TablePagination total={fined.length} page={pgFined} onPageChange={setPgFined} />
          </>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
function PoliticaTab({ policy, canManage, run }: { policy: LibraryPolicy; canManage: boolean; run: RunFn }) {
  const [form, setForm] = useState({
    loanDays: String(policy.loanDays), graceDays: String(policy.graceDays), finePerDay: String(policy.finePerDay),
    fineCap: String(policy.fineCap), maxActiveLoans: String(policy.maxActiveLoans), maxRenewals: String(policy.maxRenewals),
    blockOnUnpaidFines: policy.blockOnUnpaidFines
  });
  const num = (k: keyof typeof form, label: string, hint?: string) => (
    <div>
      <label className={labelCls}>{label}</label>
      <input className={inputCls} type="number" min={0} value={String(form[k])} onChange={(e) => setForm((f) => ({ ...f, [k]: e.target.value }))} />
      
    </div>
  );
  return (
    <div className="bg-white border border-slate-200 rounded-xl p-4 space-y-4">
      <div className="grid md:grid-cols-3 gap-3">
        {num('loanDays', 'Prazo de empréstimo (dias)')}
        {num('graceDays', 'Tolerância (dias sem multa)')}
        {num('finePerDay', 'Multa por dia (Kz)')}
        {num('fineCap', 'Teto da multa (Kz)', '0 = sem teto')}
        {num('maxActiveLoans', 'Empréstimos ativos por leitor')}
        {num('maxRenewals', 'Renovações por empréstimo')}
      </div>
      <label className="text-xs text-slate-700 flex items-center gap-2">
        <input type="checkbox" checked={form.blockOnUnpaidFines} onChange={(e) => setForm((f) => ({ ...f, blockOnUnpaidFines: e.target.checked }))} />
        Bloquear novos empréstimos a quem tem multas por pagar
      </label>
      <div className="flex justify-end">
        <button type="button" className={btnPrimary} disabled={!canManage}
          onClick={() => run(() => dbService.saveLibraryPolicy({
            loanDays: Number(form.loanDays), graceDays: Number(form.graceDays), finePerDay: Number(form.finePerDay),
            fineCap: Number(form.fineCap), maxActiveLoans: Number(form.maxActiveLoans), maxRenewals: Number(form.maxRenewals),
            blockOnUnpaidFines: form.blockOnUnpaidFines
          }), 'A guardar política...', RULE, 'Política da biblioteca guardada. Vale para empréstimos novos e para as multas calculadas daqui em diante.')}>
          <BtnIcon n="save" /> Guardar política
        </button>
      </div>
    </div>
  );
}
