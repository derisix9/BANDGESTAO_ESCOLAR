import React, { useMemo, useState } from 'react';
import { LeaveRequest, LeaveType, SchoolDatabase, UserRole } from '../types';
import { dbService } from '../services/db';
import { runGlobalOperation } from '../context/OperationContext';
import { useAccessControl } from '../hooks/useAccessControl';
import { FormModalHeader } from '../components/FormModalHeader';
import { SearchableSelect } from '../components/SearchableSelect';
import {
  DEFAULT_ANNUAL_LEAVE_ENTITLEMENT_DAYS,
  LEAVE_STATUS_META,
  LEAVE_TYPE_LABELS,
  computeLeaveBalance,
  countWorkingDays,
  leaveRequestsToCsv,
  listLeaveEligiblePeople
} from '../utils/leaveManagement';
import { TablePagination, usePagedList } from '../components/TablePagination';
import { Notice } from '../components/Notice';

interface FeriasLicencasViewProps {
  db: SchoolDatabase;
  currentUserRole: UserRole;
}

const inputCls =
  'w-full h-9 px-3 bg-white border border-slate-300 text-slate-800 focus:border-[#0b1f3a] focus:outline-none text-xs';
const labelCls = 'block uppercase font-bold text-slate-700 mb-1 text-[11px]';

export const FeriasLicencasView: React.FC<FeriasLicencasViewProps> = ({ db, currentUserRole }) => {
  const acl = useAccessControl(currentUserRole);
  const today = new Date().toISOString().slice(0, 10);

  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | LeaveRequest['status']>('all');
  const [typeFilter, setTypeFilter] = useState<'all' | LeaveType>('all');

  const [isFormOpen, setIsFormOpen] = useState(false);
  const [personId, setPersonId] = useState('');
  const [type, setType] = useState<LeaveType>('ferias');
  const [typeDescription, setTypeDescription] = useState('');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [reason, setReason] = useState('');
  const [formError, setFormError] = useState('');

  const [viewing, setViewing] = useState<LeaveRequest | null>(null);
  const [deciding, setDeciding] = useState<{ request: LeaveRequest; decision: 'aprovado' | 'rejeitado' } | null>(null);
  const [decisionNotes, setDecisionNotes] = useState('');
  const [cancelling, setCancelling] = useState<LeaveRequest | null>(null);
  const [cancelReason, setCancelReason] = useState('');
  const [deleting, setDeleting] = useState<LeaveRequest | null>(null);

  const [balancePersonId, setBalancePersonId] = useState('');

  const requests = db.leaveRequests || [];
  const entitlementDays = db.settings?.annualLeaveEntitlementDays || DEFAULT_ANNUAL_LEAVE_ENTITLEMENT_DAYS;
  const people = useMemo(() => listLeaveEligiblePeople(db), [db]);
  const personOptions = useMemo(
    () => people.map((p) => ({ value: p.id, label: p.name, sublabel: `${p.role}${p.type === 'professor' ? ' · Docente' : ' · Funcionário'}` })),
    [people]
  );

  const filtered = useMemo(() => {
    const q = searchTerm.trim().toLowerCase();
    return requests
      .filter((r) => statusFilter === 'all' || r.status === statusFilter)
      .filter((r) => typeFilter === 'all' || r.type === typeFilter)
      .filter((r) => !q || r.personName.toLowerCase().includes(q) || r.personRole.toLowerCase().includes(q))
      .sort((a, b) => new Date(b.requestedAt).getTime() - new Date(a.requestedAt).getTime());
  }, [requests, searchTerm, statusFilter, typeFilter]);
  const { page: pgFiltered, setPage: setPgFiltered, pageItems: visibleFiltered } = usePagedList(filtered, [filtered.length]);

  const pendingCount = requests.filter((r) => r.status === 'pendente').length;
  const onLeaveToday = requests.filter((r) => r.status === 'aprovado' && r.startDate <= today && today <= r.endDate).length;
  const approvedCount = requests.filter((r) => r.status === 'aprovado').length;

  const run = async (action: () => void, loadingMessage: string): Promise<{ ok: boolean; error?: string }> => {
    try {
      await runGlobalOperation(action, { loadingMessage, requiredRule: 'rh.ferias.manage', userRole: currentUserRole });
      return { ok: true };
    } catch (err: any) {
      return { ok: false, error: err?.message };
    }
  };

  const openNew = () => {
    setPersonId('');
    setType('ferias');
    setTypeDescription('');
    setStartDate('');
    setEndDate('');
    setReason('');
    setFormError('');
    setIsFormOpen(true);
  };

  const previewWorkingDays = useMemo(() => (startDate && endDate ? countWorkingDays(startDate, endDate) : 0), [startDate, endDate]);

  const handleSubmit = async () => {
    if (!acl.can('rh.ferias.manage')) {
      acl.guard('rh.ferias.manage', () => undefined);
      return;
    }
    if (!personId) {
      setFormError('Selecione o docente ou funcionário.');
      return;
    }

    let failure = '';
    const result = await run(() => {
      const r = dbService.createLeaveRequest({
        personId,
        type,
        typeDescription: typeDescription.trim() || undefined,
        startDate,
        endDate,
        reason: reason.trim() || undefined
      });
      if (!r.success) {
        failure = r.error || '';
        throw new Error(r.error);
      }
    }, 'A registar pedido de férias/licença...');

    if (result.ok) setIsFormOpen(false);
    else setFormError(failure || result.error || 'Não foi possível registar o pedido.');
  };

  const handleDecide = async () => {
    if (!deciding) return;
    const { request, decision } = deciding;
    setDeciding(null);
    await run(() => {
      dbService.decideLeaveRequest(request.id, decision, decisionNotes.trim() || undefined);
    }, decision === 'aprovado' ? `A aprovar pedido de ${request.personName}...` : `A rejeitar pedido de ${request.personName}...`);
    setDecisionNotes('');
  };

  const handleComplete = async (request: LeaveRequest) => {
    await run(() => {
      dbService.completeLeaveRequest(request.id);
    }, `A concluir período de ausência de ${request.personName}...`);
  };

  const handleCancel = async () => {
    if (!cancelling) return;
    const target = cancelling;
    setCancelling(null);
    await run(() => {
      dbService.cancelLeaveRequest(target.id, cancelReason.trim() || undefined);
    }, `A cancelar pedido de ${target.personName}...`);
    setCancelReason('');
  };

  const handleDelete = async () => {
    if (!deleting) return;
    const target = deleting;
    setDeleting(null);
    await run(() => {
      dbService.deleteLeaveRequest(target.id);
    }, `A eliminar pedido de ${target.personName}...`);
  };

  const handleExportCsv = () => {
    const csv = leaveRequestsToCsv(filtered);
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'ferias_licencas.csv';
    a.click();
    URL.revokeObjectURL(url);
  };

  const balancePerson = people.find((p) => p.id === balancePersonId);
  const balance = balancePerson
    ? computeLeaveBalance(balancePerson.id, new Date().getFullYear(), requests, entitlementDays)
    : null;

  return (
    <div className="flex flex-col w-full gap-6 pb-12">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <span className="text-[11px] font-bold uppercase tracking-widest text-slate-500">RECURSOS HUMANOS</span>
            <span className="w-1.5 h-1.5 rounded-full bg-[#0b1f3a]" />
            <span className="text-xs font-semibold text-[#0b1f3a]">SERVIÇOS</span>
          </div>
          <h1 className="font-headline text-2xl lg:text-3xl font-extrabold text-[#0b1f3a] tracking-tight">
            GESTÃO DE FÉRIAS E LICENÇAS
          </h1>
          <p className="text-xs text-slate-500 mt-0.5">
            Pedidos de férias, licenças e faltas justificadas de docentes e funcionários, com cálculo automático de
            dias úteis e deteção de sobreposição de datas.
          </p>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          <button onClick={handleExportCsv} className="flex items-center gap-2 px-3 py-2.5 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold text-xs shrink-0">
            <span className="material-symbols-outlined text-[18px]">download</span>
            <span>CSV</span>
          </button>
          {acl.can('rh.ferias.manage') && (
            <button onClick={openNew} className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-[#0b1f3a] hover:bg-[#7a0c0c] active:scale-[0.98] transition-all duration-200 text-white font-bold text-xs shadow-sm shrink-0">
              <span className="material-symbols-outlined text-[18px]">beach_access</span>
              <span>NOVO PEDIDO</span>
            </button>
          )}
        </div>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {[
          { label: 'Pedidos', value: requests.length, icon: 'event_note' },
          { label: 'Pendentes', value: pendingCount, icon: 'schedule' },
          { label: 'Aprovados', value: approvedCount, icon: 'check_circle' },
          { label: 'Em Ausência Hoje', value: onLeaveToday, icon: 'flight_takeoff' }
        ].map((k) => (
          <div key={k.label} className="bg-white border border-slate-200 rounded-2xl p-4 flex items-center gap-3">
            <div className="w-10 h-10 bg-slate-100 text-[#0b1f3a] flex items-center justify-center rounded-lg shrink-0">
              <span className="material-symbols-outlined text-[22px]">{k.icon}</span>
            </div>
            <div>
              <div className="font-mono text-xl font-extrabold text-[#0b1f3a] leading-none">{k.value}</div>
              <div className="text-[11px] text-slate-500 font-semibold mt-1">{k.label}</div>
            </div>
          </div>
        ))}
      </div>

      {/* Saldo de Férias */}
      <div className="bg-white p-4 rounded-2xl border border-slate-200 shadow-xs flex flex-col md:flex-row items-center gap-4">
        <div className="w-full md:w-80">
          <SearchableSelect
            label="Consultar Saldo de Férias"
            options={personOptions}
            value={balancePersonId}
            onChange={setBalancePersonId}
            placeholder="Selecione um docente ou funcionário"
          />
        </div>
        {balance && (
          <div className="flex flex-wrap items-center gap-4 text-xs">
            <div>
              <span className="block text-[10px] uppercase font-bold text-slate-500">Direito Anual</span>
              <span className="font-mono font-bold text-slate-800">{balance.entitlementDays} dias</span>
            </div>
            <div>
              <span className="block text-[10px] uppercase font-bold text-slate-500">Usados</span>
              <span className="font-mono font-bold text-slate-800">{balance.usedDays} dias</span>
            </div>
            <div>
              <span className="block text-[10px] uppercase font-bold text-slate-500">Pendentes</span>
              <span className="font-mono font-bold text-amber-700">{balance.pendingDays} dias</span>
            </div>
            <div>
              <span className="block text-[10px] uppercase font-bold text-slate-500">Saldo Restante</span>
              <span className="font-mono font-extrabold text-[#0b1f3a]">{balance.remainingDays} dias</span>
            </div>
          </div>
        )}
      </div>

      {/* Filtros */}
      <div className="bg-white p-4 rounded-2xl border border-slate-200 shadow-xs flex flex-col md:flex-row items-center justify-between gap-3">
        <div className="relative flex items-center w-full md:w-96 border border-slate-400/30 bg-slate-50/60 focus-within:border-slate-400/70 focus-within:bg-white transition-colors">
          <span className="material-symbols-outlined ml-3 text-slate-400 text-[18px] shrink-0">search</span>
          <input
            type="text"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            placeholder="Pesquisar por nome ou cargo..."
            className="w-full h-9 pl-2 pr-3 bg-transparent border-0 outline-none focus:ring-0 text-xs text-slate-800 placeholder:text-slate-400"
          />
        </div>
        <div className="flex flex-wrap items-center gap-3 w-full md:w-auto">
          <select value={typeFilter} onChange={(e) => setTypeFilter(e.target.value as any)} className="h-9 px-3 rounded-lg bg-slate-100 text-xs font-semibold text-slate-700 border-0 focus:ring-1 focus:ring-[#0b1f3a]">
            <option value="all">Todos os Tipos</option>
            {(Object.keys(LEAVE_TYPE_LABELS) as LeaveType[]).map((t) => (
              <option key={t} value={t}>
                {LEAVE_TYPE_LABELS[t]}
              </option>
            ))}
          </select>
          <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value as any)} className="h-9 px-3 rounded-lg bg-slate-100 text-xs font-semibold text-slate-700 border-0 focus:ring-1 focus:ring-[#0b1f3a]">
            <option value="all">Todos os Estados</option>
            <option value="pendente">Pendente</option>
            <option value="aprovado">Aprovado</option>
            <option value="rejeitado">Rejeitado</option>
            <option value="concluido">Concluído</option>
            <option value="cancelado">Cancelado</option>
          </select>
        </div>
      </div>

      {/* Tabela */}
      <div className="bg-white rounded-2xl border border-slate-200 shadow-xs overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead>
              <tr className="bg-[#0b1f3a] text-white font-bold uppercase text-[10px] tracking-wider border-b border-slate-800">
                <th className="py-3.5 px-4 text-white">Nome & Cargo</th>
                <th className="py-3.5 px-3 text-white">Tipo</th>
                <th className="py-3.5 px-3 text-white">Período</th>
                <th className="py-3.5 px-3 text-white">Dias Úteis</th>
                <th className="py-3.5 px-3 text-white">Estado</th>
                <th className="py-3.5 px-4 text-right text-white">Ações</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {filtered.length === 0 ? (
                <tr>
                  <td colSpan={6} className="py-12 text-center text-slate-400 text-xs">
                    Nenhum pedido encontrado. Clique em "NOVO PEDIDO" para registar o primeiro.
                  </td>
                </tr>
              ) : (
                visibleFiltered.map((r) => (
                  <tr key={r.id} className="hover:bg-slate-50 transition-colors">
                    <td className="py-3.5 px-4">
                      <div className="font-bold text-[#0b1f3a]">{r.personName}</div>
                      <div className="text-[11px] text-slate-500">{r.personRole}</div>
                    </td>
                    <td className="py-3.5 px-3 text-slate-700">{r.type === 'outro' ? r.typeDescription || 'Outro' : LEAVE_TYPE_LABELS[r.type]}</td>
                    <td className="py-3.5 px-3 font-mono text-slate-600">
                      {new Date(r.startDate).toLocaleDateString('pt-PT')} – {new Date(r.endDate).toLocaleDateString('pt-PT')}
                    </td>
                    <td className="py-3.5 px-3 font-mono text-slate-700">{r.workingDaysCount}</td>
                    <td className="py-3.5 px-3">
                      <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${LEAVE_STATUS_META[r.status].badge}`}>
                        {LEAVE_STATUS_META[r.status].label}
                      </span>
                    </td>
                    <td className="py-3.5 px-4 text-right">
                      <div className="flex items-center justify-end gap-1">
                        <button onClick={() => setViewing(r)} className="p-1.5 rounded-lg text-slate-500 hover:text-[#0b1f3a] hover:bg-slate-100 active:scale-[0.98] transition-all cursor-pointer" title="Ver pedido">
                          <span className="material-symbols-outlined text-[18px]">visibility</span>
                        </button>
                        {acl.can('rh.ferias.manage') && r.status === 'pendente' && (
                          <>
                            <button
                              onClick={() => setDeciding({ request: r, decision: 'aprovado' })}
                              className="p-1.5 rounded-lg text-slate-500 hover:text-emerald-700 hover:bg-slate-100 active:scale-[0.98] transition-all cursor-pointer"
                              title="Aprovar"
                            >
                              <span className="material-symbols-outlined text-[18px]">check_circle</span>
                            </button>
                            <button
                              onClick={() => setDeciding({ request: r, decision: 'rejeitado' })}
                              className="p-1.5 rounded-lg text-slate-500 hover:text-red-700 hover:bg-slate-100 active:scale-[0.98] transition-all cursor-pointer"
                              title="Rejeitar"
                            >
                              <span className="material-symbols-outlined text-[18px]">cancel</span>
                            </button>
                          </>
                        )}
                        {acl.can('rh.ferias.manage') && r.status === 'aprovado' && r.endDate <= today && (
                          <button onClick={() => handleComplete(r)} className="p-1.5 rounded-lg text-slate-500 hover:text-blue-700 hover:bg-slate-100 active:scale-[0.98] transition-all cursor-pointer" title="Marcar como concluído">
                            <span className="material-symbols-outlined text-[18px]">task_alt</span>
                          </button>
                        )}
                        {acl.can('rh.ferias.manage') && (r.status === 'pendente' || r.status === 'aprovado') && (
                          <button onClick={() => setCancelling(r)} className="p-1.5 rounded-lg text-slate-400 hover:text-amber-700 hover:bg-amber-50 active:scale-[0.98] transition-all cursor-pointer" title="Cancelar pedido">
                            <span className="material-symbols-outlined text-[18px]">block</span>
                          </button>
                        )}
                        {acl.can('rh.ferias.manage') && (
                          <button onClick={() => setDeleting(r)} className="p-1.5 rounded-lg text-slate-400 hover:text-red-700 hover:bg-red-50 active:scale-[0.98] transition-all cursor-pointer" title="Eliminar pedido">
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
          <TablePagination total={filtered.length} page={pgFiltered} onPageChange={setPgFiltered} />
        </div>
      </div>

      {/* Modal: Ver Pedido */}
      {viewing && (
        <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-3 sm:p-6" onClick={(e) => { if (e.target === e.currentTarget) setViewing(null); }}>
          <div className="bg-white max-w-lg w-full shadow-2xl border border-slate-400 overflow-hidden flex flex-col max-h-[94vh]">
            <FormModalHeader
              title={viewing.personName}
              subtitle={viewing.type === 'outro' ? viewing.typeDescription : LEAVE_TYPE_LABELS[viewing.type]}
              icon="beach_access"
              badge={LEAVE_STATUS_META[viewing.status].label}
              onClose={() => setViewing(null)}
            />
            <div className="flex-1 overflow-y-auto p-6 text-xs space-y-1.5">
              {(
                [
                  ['Cargo', viewing.personRole],
                  ['Início', new Date(viewing.startDate).toLocaleDateString('pt-PT')],
                  ['Fim', new Date(viewing.endDate).toLocaleDateString('pt-PT')],
                  ['Dias Úteis', String(viewing.workingDaysCount)],
                  ['Solicitado por', viewing.requestedByName],
                  ['Decidido por', viewing.decidedByName]
                ] as Array<[string, string | undefined]>
              )
                .filter(([, v]) => !!v)
                .map(([k, v]) => (
                  <div key={k} className="flex justify-between border-b border-slate-100 py-1.5 gap-4">
                    <span className="uppercase font-bold text-[10px] tracking-wide text-slate-500 shrink-0">{k}</span>
                    <span className="text-right text-slate-800 break-words">{v}</span>
                  </div>
                ))}
              {viewing.reason && (
                <div className="border-t border-slate-100 pt-2 mt-1">
                  <span className="block text-[10px] uppercase font-bold text-slate-500 mb-1">Motivo</span>
                  <p className="text-slate-800 whitespace-pre-wrap break-words">{viewing.reason}</p>
                </div>
              )}
              {viewing.decisionNotes && (
                <div className="border-t border-slate-100 pt-2 mt-1">
                  <span className="block text-[10px] uppercase font-bold text-slate-500 mb-1">Notas da Decisão</span>
                  <p className="text-slate-800 whitespace-pre-wrap break-words">{viewing.decisionNotes}</p>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Modal: Novo Pedido */}
      {isFormOpen && (
        <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-3 sm:p-6" onClick={(e) => { if (e.target === e.currentTarget) setIsFormOpen(false); }}>
          <div className="bg-white max-w-lg w-full shadow-2xl border border-slate-400 overflow-hidden flex flex-col max-h-[94vh]">
            <FormModalHeader title="Novo Pedido de Férias/Licença" icon="beach_access" onClose={() => setIsFormOpen(false)} />
            <form onSubmit={(e) => e.preventDefault()} className="flex-1 overflow-y-auto p-6 text-xs space-y-4">
              <SearchableSelect label="Docente ou Funcionário *" options={personOptions} value={personId} onChange={setPersonId} placeholder="Selecione a pessoa" />

              <div>
                <label className={labelCls}>Tipo *</label>
                <select value={type} onChange={(e) => setType(e.target.value as LeaveType)} className={inputCls}>
                  {(Object.keys(LEAVE_TYPE_LABELS) as LeaveType[]).map((t) => (
                    <option key={t} value={t}>
                      {LEAVE_TYPE_LABELS[t]}
                    </option>
                  ))}
                </select>
              </div>

              {type === 'outro' && (
                <div>
                  <label className={labelCls}>Descrição do Tipo *</label>
                  <input type="text" value={typeDescription} onChange={(e) => setTypeDescription(e.target.value)} className={inputCls} />
                </div>
              )}

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className={labelCls}>Data de Início *</label>
                  <input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} className={inputCls} />
                </div>
                <div>
                  <label className={labelCls}>Data de Fim *</label>
                  <input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} min={startDate} className={inputCls} />
                </div>
              </div>

              {startDate && endDate && (
                <p className="text-[11px] text-slate-500">
                  Equivale a <span className="font-bold text-[#0b1f3a]">{previewWorkingDays}</span> dia(s) úteis (segunda a sexta).
                </p>
              )}

              <div>
                <label className={labelCls}>Motivo (opcional)</label>
                <textarea rows={2} value={reason} onChange={(e) => setReason(e.target.value)} className="w-full px-3 py-2 bg-white border border-slate-300 text-slate-800 focus:border-[#0b1f3a] focus:outline-none text-xs resize-none" />
              </div>

              {formError && (
                <Notice tone="error" icon="error">
                  <span>{formError}</span>
                </Notice>
              )}

              <div className="pt-4 flex items-center justify-end gap-2 border-t border-slate-300">
                <button type="button" onClick={() => setIsFormOpen(false)} className="px-4 py-2 bg-slate-200 hover:bg-slate-300 text-slate-800 font-bold text-xs cursor-pointer border border-slate-300">
                  Cancelar
                </button>
                <button type="button" onClick={handleSubmit} className="px-5 py-2 bg-[#0b1f3a] hover:bg-[#7a0c0c] text-white font-bold text-xs cursor-pointer transition-colors border border-[#0b1f3a] flex items-center gap-1.5">
                  <span className="material-symbols-outlined text-[16px]">save</span>
                  <span>REGISTAR PEDIDO</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal: Aprovar/Rejeitar */}
      {deciding && (
        <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4">
          <div className="bg-white max-w-md w-full shadow-2xl overflow-hidden border border-slate-300">
            <FormModalHeader
              title={deciding.decision === 'aprovado' ? 'Aprovar Pedido' : 'Rejeitar Pedido'}
              icon={deciding.decision === 'aprovado' ? 'check_circle' : 'cancel'}
              onClose={() => setDeciding(null)}
            />
            <div className="p-6 space-y-3 text-xs">
              <p className="text-slate-600">
                {deciding.decision === 'aprovado' ? 'Aprovar' : 'Rejeitar'} o pedido de{' '}
                <span className="font-bold">{deciding.request.personName}</span> ({deciding.request.workingDaysCount} dia(s) úteis)?
              </p>
              <div>
                <label className={labelCls}>Notas (opcional)</label>
                <textarea rows={2} value={decisionNotes} onChange={(e) => setDecisionNotes(e.target.value)} className="w-full px-3 py-2 bg-white border border-slate-300 text-slate-800 focus:border-[#0b1f3a] focus:outline-none text-xs resize-none" />
              </div>
            </div>
            <div className="px-6 py-4 bg-slate-50 border-t border-slate-300 flex items-center justify-end gap-2">
              <button type="button" onClick={() => setDeciding(null)} className="px-4 py-2.5 bg-slate-200 hover:bg-slate-300 text-slate-700 font-bold text-xs cursor-pointer border border-slate-300">
                Voltar
              </button>
              <button
                type="button"
                onClick={handleDecide}
                className={`px-5 py-2.5 text-white font-bold text-xs flex items-center gap-2 cursor-pointer transition-colors border-none ${
                  deciding.decision === 'aprovado' ? 'bg-emerald-700 hover:bg-emerald-800' : 'bg-red-700 hover:bg-red-800'
                }`}
              >
                <span className="material-symbols-outlined text-[16px]">{deciding.decision === 'aprovado' ? 'check_circle' : 'cancel'}</span>
                <span>{deciding.decision === 'aprovado' ? 'Aprovar' : 'Rejeitar'}</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal: Cancelar */}
      {cancelling && (
        <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4">
          <div className="bg-white max-w-md w-full shadow-2xl overflow-hidden border border-slate-300">
            <FormModalHeader title="Cancelar Pedido" icon="block" onClose={() => setCancelling(null)} />
            <div className="p-6 space-y-3 text-xs">
              <p className="text-slate-600">
                Cancelar o pedido de <span className="font-bold">{cancelling.personName}</span>?
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
                <span className="material-symbols-outlined text-[16px]">block</span>
                <span>Cancelar Pedido</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal: Eliminar */}
      {deleting && (
        <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4">
          <div className="bg-white max-w-md w-full shadow-2xl overflow-hidden border border-slate-300">
            <FormModalHeader title="Eliminar Pedido" icon="warning" onClose={() => setDeleting(null)} />
            <div className="p-6">
              <h3 className="font-headline text-lg font-bold text-slate-900 text-center">Eliminar pedido de "{deleting.personName}"?</h3>
              <p className="text-xs text-slate-600 text-center mt-2 leading-relaxed">Esta ação não pode ser desfeita.</p>
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
    </div>
  );
};
