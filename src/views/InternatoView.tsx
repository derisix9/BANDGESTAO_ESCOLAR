import React, { useMemo, useState } from 'react';
import type { BoardingRoom, SchoolDatabase, UserRole } from '../types';
import { dbService } from '../services/db';
import { runGlobalOperation } from '../context/OperationContext';
import { useAccessControl } from '../hooks/useAccessControl';
import { FormModalHeader } from '../components/FormModalHeader';
import { AppConfirmModal } from '../components/AppConfirmModal';
import { SearchableSelect } from '../components/SearchableSelect';
import { Badge, Banner, ErrorLine, Kpis, ModalShell, PageHeader, THEAD, TH, TD, btnGhost, btnPrimary, fmtDate, fmtKz, inputCls, labelCls, todayIso } from '../components/moduleUi';
import { MONTHS_PT, activeAllocations, monthPeriodLabel, normGender, occupancySummary, pendingBoardingBills, roomOccupancy } from '../utils/boarding';

const RULE = 'internato.manage';
type Tab = 'quartos' | 'alojamentos' | 'mensalidades';
const GENDER_LABEL = { M: 'Masculino', F: 'Feminino', misto: 'Misto' } as const;

interface Props { db: SchoolDatabase; currentUserRole: UserRole }

export const InternatoView: React.FC<Props> = ({ db, currentUserRole }) => {
  const acl = useAccessControl(currentUserRole);
  const canManage = acl.can(RULE);
  const rooms = db.boardingRooms || [];
  const allocations = db.boardingAllocations || [];
  const [tab, setTab] = useState<Tab>('quartos');
  const now = new Date();
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth() + 1);

  const [roomForm, setRoomForm] = useState<{ id?: string; code: string; block: string; gender: BoardingRoom['gender']; beds: number; monthlyFeeKz: number; status: BoardingRoom['status'] } | null>(null);
  const [allocForm, setAllocForm] = useState<{ roomId: string; bed: number; studentId: string; startDate: string; fee: string } | null>(null);
  const [endForm, setEndForm] = useState<{ id: string; name: string; date: string } | null>(null);
  const [deletingRoom, setDeletingRoom] = useState<BoardingRoom | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ tone: 'info' | 'error'; text: string } | null>(null);

  const summary = useMemo(() => occupancySummary(rooms, allocations), [rooms, allocations]);
  const pending = useMemo(() => pendingBoardingBills(allocations, db.invoices || [], year, month), [allocations, db.invoices, year, month]);
  const pendingTotal = pending.reduce((s, a) => s + a.monthlyFeeKz, 0);
  const roomsSorted = useMemo(() => [...rooms].sort((a, b) => a.code.localeCompare(b.code, 'pt', { numeric: true })), [rooms]);
  const actives = useMemo(() => activeAllocations(allocations).sort((a, b) => a.roomCode.localeCompare(b.roomCode, 'pt', { numeric: true }) || a.bed - b.bed), [allocations]);

  const exec = async (fn: () => { success: boolean; error?: string } & Record<string, any>, loading: string, onOk?: (r: any) => void) => {
    setError(null);
    try {
      let r: any;
      await runGlobalOperation(() => { r = fn(); if (!r.success) throw new Error(r.error || 'Operação falhou.'); }, { loadingMessage: loading, requiredRule: RULE, userRole: currentUserRole });
      onOk?.(r);
      return true;
    } catch (e: any) { setError(e?.message || 'Não foi possível concluir.'); return false; }
  };

  const studentOptions = useMemo(() => {
    if (!allocForm) return [];
    const room = rooms.find((r) => r.id === allocForm.roomId);
    const lodged = new Set(activeAllocations(allocations).map((a) => a.studentId));
    return (db.students || [])
      .filter((s) => s.status === 'active' && !lodged.has(s.id) && (!room || room.gender === 'misto' || normGender(s.gender) === room.gender))
      .map((s) => ({ value: s.id, label: s.name, sublabel: s.className || s.grade }));
  }, [allocForm, rooms, allocations, db.students]);

  const freeBeds = allocForm ? (() => { const r = rooms.find((x) => x.id === allocForm.roomId); return r ? roomOccupancy(r, allocations).free : []; })() : [];

  const openAlloc = (roomId?: string) => {
    const room = rooms.find((r) => r.id === roomId && r.status === 'ativo') || rooms.find((r) => r.status === 'ativo' && roomOccupancy(r, allocations).free.length > 0);
    if (!room) { setMsg({ tone: 'error', text: 'Crie primeiro um quarto activo com camas livres.' }); return; }
    setError(null);
    setAllocForm({ roomId: room.id, bed: roomOccupancy(room, allocations).free[0] || 1, studentId: '', startDate: todayIso(), fee: String(room.monthlyFeeKz) });
  };

  return (
    <div className="flex flex-col w-full gap-6 pb-12">
      <PageHeader kicker="LOGÍSTICA" title="Internato"
        subtitle="Quartos, camas, alojamento dos alunos e mensalidades ligadas à Tesouraria."
        right={canManage ? <>
          <button className={btnGhost} onClick={() => { setError(null); setRoomForm({ code: '', block: '', gender: 'misto', beds: 4, monthlyFeeKz: 0, status: 'ativo' }); }}>Novo quarto</button>
          <button className={btnPrimary} onClick={() => openAlloc()}><span className="material-symbols-outlined text-[18px]">bed</span>Alojar aluno</button>
        </> : undefined} />
      {msg && <Banner tone={msg.tone === 'error' ? 'error' : 'info'} icon={msg.tone === 'error' ? 'error' : 'check_circle'}>{msg.text}</Banner>}
      <Kpis items={[
        { label: 'Quartos activos', value: summary.rooms, icon: 'meeting_room' },
        { label: 'Camas', value: summary.beds, icon: 'single_bed' },
        { label: 'Alojados', value: summary.occupied, icon: 'person_pin_circle' },
        { label: 'Ocupação', value: summary.rate !== null ? `${summary.rate}%` : '—', icon: 'pie_chart' }
      ]} />

      <div className="flex gap-1.5">
        {([['quartos', 'Quartos'], ['alojamentos', 'Alojamentos'], ['mensalidades', 'Mensalidades']] as Array<[Tab, string]>).map(([k, l]) => (
          <button key={k} onClick={() => setTab(k)} className={`px-3 py-1.5 rounded-lg text-[11px] font-bold ${tab === k ? 'bg-[#0b1f3a] text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}`}>{l}</button>
        ))}
      </div>

      {tab === 'quartos' && (
        <div className="bg-white border border-slate-200 rounded-2xl overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead><tr className={THEAD}><th className={TH}>Quarto</th><th className={TH}>Bloco</th><th className={TH}>Género</th><th className={`${TH} text-center`}>Ocupação</th><th className={`${TH} text-right`}>Mensalidade</th><th className={TH}>Estado</th><th className={`${TH} text-right`}>Acções</th></tr></thead>
            <tbody className="divide-y divide-slate-100">
              {roomsSorted.length === 0 && <tr><td colSpan={7} className="py-10 text-center text-slate-400">Ainda não há quartos registados.</td></tr>}
              {roomsSorted.map((r) => {
                const o = roomOccupancy(r, allocations);
                return (
                  <tr key={r.id} className="hover:bg-slate-50">
                    <td className={`${TD} font-bold text-slate-900`}>{r.code}</td>
                    <td className={TD}>{r.block || '—'}</td>
                    <td className={TD}>{GENDER_LABEL[r.gender]}</td>
                    <td className={`${TD} text-center font-mono`}>{o.occupied}/{o.capacity}</td>
                    <td className={`${TD} text-right font-mono`}>{fmtKz(r.monthlyFeeKz)}</td>
                    <td className={TD}><Badge tone={r.status === 'ativo' ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-100 text-slate-500'}>{r.status === 'ativo' ? 'Activo' : 'Inactivo'}</Badge></td>
                    <td className="py-2 px-3 text-right whitespace-nowrap">
                      {canManage && <>
                        {r.status === 'ativo' && o.free.length > 0 && <button className={btnGhost} onClick={() => openAlloc(r.id)}>Alojar</button>}{' '}
                        <button className={btnGhost} onClick={() => { setError(null); setRoomForm({ id: r.id, code: r.code, block: r.block || '', gender: r.gender, beds: r.beds, monthlyFeeKz: r.monthlyFeeKz, status: r.status }); }}>Editar</button>{' '}
                        <button className={`${btnGhost} text-red-700`} onClick={() => setDeletingRoom(r)}>Eliminar</button>
                      </>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {tab === 'alojamentos' && (
        <div className="bg-white border border-slate-200 rounded-2xl overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead><tr className={THEAD}><th className={TH}>Aluno</th><th className={TH}>Quarto</th><th className={`${TH} text-center`}>Cama</th><th className={TH}>Entrada</th><th className={`${TH} text-right`}>Mensalidade</th><th className={`${TH} text-right`}>Acções</th></tr></thead>
            <tbody className="divide-y divide-slate-100">
              {actives.length === 0 && <tr><td colSpan={6} className="py-10 text-center text-slate-400">Nenhum aluno alojado.</td></tr>}
              {actives.map((a) => (
                <tr key={a.id} className="hover:bg-slate-50">
                  <td className={`${TD} font-semibold text-slate-900`}>{a.studentName}</td>
                  <td className={TD}>{a.roomCode}</td>
                  <td className={`${TD} text-center font-mono`}>{a.bed}</td>
                  <td className={TD}>{fmtDate(a.startDate)}</td>
                  <td className={`${TD} text-right font-mono`}>{fmtKz(a.monthlyFeeKz)}</td>
                  <td className="py-2 px-3 text-right">{canManage && <button className={btnGhost} onClick={() => { setError(null); setEndForm({ id: a.id, name: a.studentName, date: todayIso() }); }}>Registar saída</button>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {tab === 'mensalidades' && (
        <div className="bg-white border border-slate-200 rounded-2xl p-5 space-y-4">
          <div className="flex flex-wrap items-end gap-3">
            <div><label className={labelCls}>Mês</label>
              <select className={inputCls} value={month} onChange={(e) => setMonth(Number(e.target.value))}>{MONTHS_PT.map((m, i) => <option key={m} value={i + 1}>{m}</option>)}</select></div>
            <div><label className={labelCls}>Ano</label><input type="number" className={inputCls} value={year} onChange={(e) => setYear(Number(e.target.value))} /></div>
            {canManage && <button className={btnPrimary} disabled={pending.length === 0}
              onClick={() => void exec(() => dbService.generateBoardingInvoices(year, month), 'A emitir facturas...', (r) => setMsg({ tone: 'info', text: `${r.created} factura(s) de internato emitida(s) para ${monthPeriodLabel(year, month)}.` }))}>
              <span className="material-symbols-outlined text-[18px]">receipt_long</span>Emitir facturas ({pending.length})
            </button>}
          </div>
          <ErrorLine message={error} />
          <p className="text-xs text-slate-600">
            {pending.length === 0 ? `Não há mensalidades por emitir para ${monthPeriodLabel(year, month)}.` : `${pending.length} aluno(s) sem factura de ${monthPeriodLabel(year, month)}, num total de ${fmtKz(pendingTotal)}.`}
          </p>
          <Banner icon="info">As facturas aparecem em Tesouraria → Pagamentos como as outras (e podem ser pagas por referência Multicaixa). Não repetem o mês já emitido. Só se emitem para alojamentos activos.</Banner>
        </div>
      )}

      {roomForm && (
        <ModalShell>
          <FormModalHeader title={roomForm.id ? 'Editar Quarto' : 'Novo Quarto'} icon="meeting_room" onClose={() => setRoomForm(null)} />
          <div className="p-6 space-y-3 overflow-y-auto">
            <ErrorLine message={error} />
            <div className="grid grid-cols-2 gap-3">
              <div><label className={labelCls}>Código</label><input className={inputCls} value={roomForm.code} onChange={(e) => setRoomForm({ ...roomForm, code: e.target.value })} /></div>
              <div><label className={labelCls}>Bloco</label><input className={inputCls} value={roomForm.block} onChange={(e) => setRoomForm({ ...roomForm, block: e.target.value })} /></div>
              <div><label className={labelCls}>Género</label>
                <select className={inputCls} value={roomForm.gender} onChange={(e) => setRoomForm({ ...roomForm, gender: e.target.value as any })}>
                  <option value="misto">Misto</option><option value="M">Masculino</option><option value="F">Feminino</option></select></div>
              <div><label className={labelCls}>Camas</label><input type="number" min={1} className={inputCls} value={roomForm.beds} onChange={(e) => setRoomForm({ ...roomForm, beds: Number(e.target.value) })} /></div>
              <div><label className={labelCls}>Mensalidade (Kz)</label><input type="number" min={0} className={inputCls} value={roomForm.monthlyFeeKz} onChange={(e) => setRoomForm({ ...roomForm, monthlyFeeKz: Number(e.target.value) })} /></div>
              <div><label className={labelCls}>Estado</label>
                <select className={inputCls} value={roomForm.status} onChange={(e) => setRoomForm({ ...roomForm, status: e.target.value as any })}><option value="ativo">Activo</option><option value="inativo">Inactivo</option></select></div>
            </div>
            <div className="flex justify-end gap-2 pt-2"><button className={btnGhost} onClick={() => setRoomForm(null)}>Cancelar</button>
              <button className={btnPrimary} onClick={async () => { if (await exec(() => dbService.saveBoardingRoom(roomForm), 'A guardar quarto...')) setRoomForm(null); }}>Guardar</button></div>
          </div>
        </ModalShell>
      )}

      {allocForm && (
        <ModalShell>
          <FormModalHeader title="Alojar Aluno" icon="bed" onClose={() => setAllocForm(null)} />
          <div className="p-6 space-y-3 overflow-y-auto">
            <ErrorLine message={error} />
            <div className="grid grid-cols-2 gap-3">
              <div><label className={labelCls}>Quarto</label>
                <select className={inputCls} value={allocForm.roomId} onChange={(e) => {
                  const r = rooms.find((x) => x.id === e.target.value)!; const fb = roomOccupancy(r, allocations).free;
                  setAllocForm({ ...allocForm, roomId: r.id, bed: fb[0] || 1, studentId: '', fee: String(r.monthlyFeeKz) });
                }}>
                  {rooms.filter((r) => r.status === 'ativo').map((r) => <option key={r.id} value={r.id}>{r.code} · {GENDER_LABEL[r.gender]} · {roomOccupancy(r, allocations).free.length} livre(s)</option>)}
                </select></div>
              <div><label className={labelCls}>Cama</label>
                <select className={inputCls} value={allocForm.bed} onChange={(e) => setAllocForm({ ...allocForm, bed: Number(e.target.value) })}>
                  {freeBeds.length === 0 && <option value={0}>Sem camas livres</option>}
                  {freeBeds.map((b) => <option key={b} value={b}>Cama {b}</option>)}
                </select></div>
              <div className="col-span-2"><label className={labelCls}>Aluno</label>
                <SearchableSelect options={studentOptions} value={allocForm.studentId} onChange={(v) => setAllocForm({ ...allocForm, studentId: v })} placeholder="Pesquise o aluno…" maxResults={50} helperText="Só aparecem alunos activos, ainda não alojados e compatíveis com o género do quarto." /></div>
              <div><label className={labelCls}>Entrada</label><input type="date" className={inputCls} value={allocForm.startDate} onChange={(e) => setAllocForm({ ...allocForm, startDate: e.target.value })} /></div>
              <div><label className={labelCls}>Mensalidade (Kz)</label><input type="number" min={0} className={inputCls} value={allocForm.fee} onChange={(e) => setAllocForm({ ...allocForm, fee: e.target.value })} /></div>
            </div>
            <div className="flex justify-end gap-2 pt-2"><button className={btnGhost} onClick={() => setAllocForm(null)}>Cancelar</button>
              <button className={btnPrimary} onClick={async () => { if (await exec(() => dbService.allocateBoarding({ roomId: allocForm.roomId, bed: allocForm.bed, studentId: allocForm.studentId, startDate: allocForm.startDate, monthlyFeeKz: allocForm.fee === '' ? undefined : Number(allocForm.fee) }), 'A alojar aluno...')) setAllocForm(null); }}>Alojar</button></div>
          </div>
        </ModalShell>
      )}

      {endForm && (
        <ModalShell>
          <FormModalHeader title="Registar Saída" subtitle={endForm.name} icon="logout" onClose={() => setEndForm(null)} />
          <div className="p-6 space-y-3">
            <ErrorLine message={error} />
            <div><label className={labelCls}>Data de saída</label><input type="date" className={inputCls} value={endForm.date} onChange={(e) => setEndForm({ ...endForm, date: e.target.value })} /></div>
            <div className="flex justify-end gap-2"><button className={btnGhost} onClick={() => setEndForm(null)}>Cancelar</button>
              <button className={btnPrimary} onClick={async () => { if (await exec(() => dbService.endBoardingAllocation(endForm.id, endForm.date), 'A registar saída...')) setEndForm(null); }}>Confirmar</button></div>
          </div>
        </ModalShell>
      )}

      <AppConfirmModal isOpen={!!deletingRoom} title="Eliminar quarto" variant="error" confirmLabel="Eliminar"
        message={`Eliminar o quarto ${deletingRoom?.code}? Se tiver histórico de alojamento, marque-o como inactivo.`}
        onConfirm={() => { const id = deletingRoom!.id; setDeletingRoom(null); void exec(() => dbService.deleteBoardingRoom(id), 'A eliminar quarto...'); }}
        onCancel={() => setDeletingRoom(null)} />
    </div>
  );
};
