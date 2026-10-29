import React, { useMemo, useState } from 'react';
import {
  SchoolDatabase,
  SchoolVehicle,
  TransportPersonKey,
  TransportRoute,
  TransportRouteStop,
  TransportShift,
  UserRole,
  VehicleStatus
} from '../types';
import { dbService } from '../services/db';
import { useAccessControl } from '../hooks/useAccessControl';
import { SearchableSelect } from '../components/SearchableSelect';
import { PublicQrCode } from '../components/PublicQrCode';
import { getPublicInstitution, publicBase } from '../utils/publicLink';
import {
  MONTHS_PT,
  RiderKind,
  buildTransportLink,
  capacityCheck,
  isMonthPaid,
  paidMonths,
  parsePersonKey,
  personKey,
  routeFee,
  routeOccupancy,
  routeRiderKeys
} from '../utils/transportPass';
import {
  LogisticsBadge,
  LogisticsDeleteModal,
  LogisticsFormFooter,
  LogisticsIconButton,
  LogisticsKpiGrid,
  LogisticsModal,
  LogisticsPageHeader,
  LogisticsPrimaryButton,
  LogisticsSearchBar,
  LogisticsSectionTitle,
  LogisticsTableCard,
  cleanText,
  formatKz,
  logisticsInputCls as inputCls,
  logisticsLabelCls as labelCls,
  logisticsSelectCls,
  logisticsThCls,
  runGlobalOperation
} from '../components/LogisticsUi';
import { TablePagination, usePagedList } from '../components/TablePagination';
import { Notice } from '../components/Notice';

interface TransporteEscolarViewProps {
  db: SchoolDatabase;
  currentUserRole: UserRole;
}

const RULE = 'patrimonio.transporte.manage';

export const VEHICLE_STATUS_LABELS: Record<VehicleStatus, string> = {
  ativo: 'Ativa',
  manutencao: 'Em manutenção',
  inativo: 'Inativa'
};

export const TRANSPORT_SHIFT_LABELS: Record<TransportShift, string> = {
  manha: 'Manhã',
  tarde: 'Tarde',
  noite: 'Noite',
  ambos: 'Manhã e Tarde'
};

const RIDER_KIND_LABEL: Record<RiderKind, string> = {
  student: 'Aluno',
  docente: 'Professor',
  funcionario: 'Funcionário'
};

const RIDER_KIND_BADGE_TONE: Record<RiderKind, 'blue' | 'green' | 'amber'> = {
  student: 'blue',
  docente: 'green',
  funcionario: 'amber'
};

type VehicleForm = Omit<SchoolVehicle, 'id' | 'code' | 'createdAt' | 'capacity'> & { capacity: string };

const emptyVehicleForm = (): VehicleForm => ({
  plate: '',
  model: '',
  capacity: '',
  driverName: '',
  driverPhone: '',
  driverLicenseNumber: '',
  status: 'ativo',
  notes: ''
});

type RouteForm = {
  name: string;
  vehicleId: string;
  shift: TransportShift;
  monthlyFee: string;
  status: 'ativa' | 'inativa';
  stops: TransportRouteStop[];
  notes: string;
};

const emptyRouteForm = (): RouteForm => ({
  name: '',
  vehicleId: '',
  shift: 'ambos',
  monthlyFee: '',
  status: 'ativa',
  stops: [{ name: '', time: '' }],
  notes: ''
});

export const TransporteEscolarView: React.FC<TransporteEscolarViewProps> = ({ db, currentUserRole }) => {
  const acl = useAccessControl(currentUserRole);

  const [tab, setTab] = useState<'rotas' | 'viaturas'>('rotas');
  const [searchTerm, setSearchTerm] = useState('');

  const [vehicleModalOpen, setVehicleModalOpen] = useState(false);
  const [editingVehicle, setEditingVehicle] = useState<SchoolVehicle | null>(null);
  const [vehicleForm, setVehicleForm] = useState<VehicleForm>(emptyVehicleForm());
  const [vehicleError, setVehicleError] = useState('');
  const [deletingVehicle, setDeletingVehicle] = useState<SchoolVehicle | null>(null);
  const [deleteVehicleError, setDeleteVehicleError] = useState('');

  const [routeModalOpen, setRouteModalOpen] = useState(false);
  const [editingRoute, setEditingRoute] = useState<TransportRoute | null>(null);
  const [routeForm, setRouteForm] = useState<RouteForm>(emptyRouteForm());
  const [routeError, setRouteError] = useState('');
  const [deletingRoute, setDeletingRoute] = useState<TransportRoute | null>(null);

  const [rosterRouteId, setRosterRouteId] = useState<string | null>(null);
  const [rosterKind, setRosterKind] = useState<RiderKind>('student');
  const [personToAdd, setPersonToAdd] = useState('');
  const [rosterError, setRosterError] = useState('');
  const [paymentsFor, setPaymentsFor] = useState<TransportPersonKey | null>(null);
  const [qrFor, setQrFor] = useState<TransportPersonKey | null>(null);

  const vehicles = db.vehicles || [];
  const routes = db.transportRoutes || [];
  const students = db.students || [];
  const teachers = db.teachers || [];
  const funcionarios = db.funcionarios || [];
  const academicYear = db.settings?.currentAcademicYear || String(new Date().getFullYear());

  const vehicleById = useMemo(() => new Map(vehicles.map((v) => [v.id, v])), [vehicles]);
  const studentById = useMemo(() => new Map(students.map((s) => [s.id, s])), [students]);
  const teacherById = useMemo(() => new Map(teachers.map((t) => [t.id, t])), [teachers]);
  const funcionarioById = useMemo(() => new Map(funcionarios.map((f) => [f.id, f])), [funcionarios]);
  const rosterRoute = rosterRouteId ? routes.find((r) => r.id === rosterRouteId) || null : null;

  const totalRiders = useMemo(() => new Set(routes.flatMap((r) => routeRiderKeys(r))).size, [routes]);
  const totalSeats = vehicles.filter((v) => v.status === 'ativo').reduce((sum, v) => sum + v.capacity, 0);

  /** Resolve nome e detalhe de um passageiro (aluno, professor ou funcionário) a partir da chave. */
  const riderInfo = (key: TransportPersonKey): { kind: RiderKind; name: string; detail: string } => {
    const parsed = parsePersonKey(key);
    if (!parsed) return { kind: 'student', name: key, detail: '' };
    if (parsed.kind === 'student') {
      const s = studentById.get(parsed.id);
      return s
        ? { kind: 'student', name: s.name, detail: `${s.className || s.grade} · ${s.procNumber}` }
        : { kind: 'student', name: 'Aluno removido', detail: '' };
    }
    if (parsed.kind === 'docente') {
      const t = teacherById.get(parsed.id);
      return t
        ? { kind: 'docente', name: t.name, detail: `Professor(a) · ${t.department || '—'} · ${t.agentNumber}` }
        : { kind: 'docente', name: 'Professor removido', detail: '' };
    }
    const f = funcionarioById.get(parsed.id);
    return f
      ? { kind: 'funcionario', name: f.name, detail: `Funcionário(a) · ${f.department || '—'} · ${f.employeeNumber}` }
      : { kind: 'funcionario', name: 'Funcionário removido', detail: '' };
  };

  const q = searchTerm.trim().toLowerCase();
  const filteredRoutes = useMemo(
    () =>
      routes
        .filter(
          (r) =>
            !q ||
            r.name.toLowerCase().includes(q) ||
            r.code.toLowerCase().includes(q) ||
            (r.vehicleName || '').toLowerCase().includes(q) ||
            r.stops.some((s) => s.name.toLowerCase().includes(q))
        )
        .sort((a, b) => a.name.localeCompare(b.name, 'pt')),
    [routes, q]
  );
  const { page: pgFilteredRoutes, setPage: setPgFilteredRoutes, pageItems: visibleFilteredRoutes } = usePagedList(filteredRoutes, [filteredRoutes.length]);
  const filteredVehicles = useMemo(
    () =>
      vehicles
        .filter(
          (v) =>
            !q ||
            v.plate.toLowerCase().includes(q) ||
            v.model.toLowerCase().includes(q) ||
            v.code.toLowerCase().includes(q) ||
            (v.driverName || '').toLowerCase().includes(q)
        )
        .sort((a, b) => a.plate.localeCompare(b.plate, 'pt')),
    [vehicles, q]
  );
  const { page: pgFilteredVehicles, setPage: setPgFilteredVehicles, pageItems: visibleFilteredVehicles } = usePagedList(filteredVehicles, [filteredVehicles.length]);

  const run = async (action: () => void, loadingMessage: string): Promise<{ ok: boolean; error?: string }> => {
    try {
      await runGlobalOperation(action, { loadingMessage, requiredRule: RULE, userRole: currentUserRole });
      return { ok: true };
    } catch (err: any) {
      return { ok: false, error: err?.message };
    }
  };

  // ---------- Viaturas ----------
  const openAddVehicle = () => {
    setEditingVehicle(null);
    setVehicleForm(emptyVehicleForm());
    setVehicleError('');
    setVehicleModalOpen(true);
  };

  const openEditVehicle = (v: SchoolVehicle) => {
    setEditingVehicle(v);
    setVehicleForm({
      plate: v.plate,
      model: v.model,
      capacity: String(v.capacity),
      driverName: v.driverName || '',
      driverPhone: v.driverPhone || '',
      driverLicenseNumber: v.driverLicenseNumber || '',
      status: v.status,
      notes: v.notes || ''
    });
    setVehicleError('');
    setVehicleModalOpen(true);
  };

  const handleVehicleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!acl.can(RULE)) {
      acl.guard(RULE, () => undefined);
      return;
    }
    if (!vehicleForm.plate.trim()) return setVehicleError('Indique a matrícula da viatura.');
    if (!vehicleForm.model.trim()) return setVehicleError('Indique o modelo da viatura.');
    const capacity = Number(vehicleForm.capacity);
    if (!Number.isInteger(capacity) || capacity < 1) {
      return setVehicleError('A capacidade tem de ser um número inteiro de lugares (mínimo 1).');
    }
    const payload = {
      plate: vehicleForm.plate.trim().toUpperCase(),
      model: vehicleForm.model.trim(),
      capacity,
      driverName: cleanText(vehicleForm.driverName),
      driverPhone: cleanText(vehicleForm.driverPhone),
      driverLicenseNumber: cleanText(vehicleForm.driverLicenseNumber),
      status: vehicleForm.status,
      notes: cleanText(vehicleForm.notes)
    };
    let failure = '';
    const result = await run(
      () => {
        const r = editingVehicle ? dbService.updateVehicle(editingVehicle.id, payload) : dbService.addVehicle(payload);
        if (!r.success) {
          failure = r.error || '';
          throw new Error(r.error);
        }
      },
      editingVehicle ? 'A guardar alterações da viatura...' : 'A registar viatura...'
    );
    if (result.ok) setVehicleModalOpen(false);
    else setVehicleError(failure || result.error || 'Não foi possível guardar a viatura.');
  };

  const handleDeleteVehicle = async () => {
    if (!deletingVehicle) return;
    const target = deletingVehicle;
    let failure = '';
    const result = await run(() => {
      const r = dbService.deleteVehicle(target.id);
      if (!r.success) {
        failure = r.error || '';
        throw new Error(r.error);
      }
    }, `A eliminar viatura ${target.plate}...`);
    if (result.ok) {
      setDeletingVehicle(null);
      setDeleteVehicleError('');
    } else {
      setDeleteVehicleError(failure || result.error || 'Não foi possível eliminar a viatura.');
    }
  };

  // ---------- Rotas ----------
  const openAddRoute = () => {
    setEditingRoute(null);
    setRouteForm(emptyRouteForm());
    setRouteError('');
    setRouteModalOpen(true);
  };

  const openEditRoute = (r: TransportRoute) => {
    setEditingRoute(r);
    setRouteForm({
      name: r.name,
      vehicleId: r.vehicleId || '',
      shift: r.shift,
      monthlyFee: r.monthlyFeeKz !== undefined ? String(r.monthlyFeeKz) : '',
      status: r.status,
      stops: r.stops.length ? r.stops.map((s) => ({ name: s.name, time: s.time || '' })) : [{ name: '', time: '' }],
      notes: r.notes || ''
    });
    setRouteError('');
    setRouteModalOpen(true);
  };

  const updateStop = (idx: number, patch: Partial<TransportRouteStop>) =>
    setRouteForm({ ...routeForm, stops: routeForm.stops.map((s, i) => (i === idx ? { ...s, ...patch } : s)) });

  const handleRouteSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!acl.can(RULE)) {
      acl.guard(RULE, () => undefined);
      return;
    }
    if (!routeForm.name.trim()) return setRouteError('Indique o nome da rota.');
    const stops = routeForm.stops
      .filter((s) => s.name.trim())
      .map((s) => ({ name: s.name.trim(), time: cleanText(s.time) }));
    if (stops.length === 0) return setRouteError('Adicione pelo menos uma paragem à rota.');
    const fee = routeForm.monthlyFee.trim() === '' ? undefined : Number(routeForm.monthlyFee.replace(',', '.'));
    if (fee !== undefined && (!Number.isFinite(fee) || fee < 0)) {
      return setRouteError('A mensalidade tem de ser um número igual ou superior a zero.');
    }
    const payload = {
      name: routeForm.name.trim(),
      vehicleId: cleanText(routeForm.vehicleId),
      shift: routeForm.shift,
      monthlyFeeKz: fee,
      status: routeForm.status,
      stops,
      notes: cleanText(routeForm.notes)
    };
    let failure = '';
    const result = await run(
      () => {
        const r = editingRoute ? dbService.updateTransportRoute(editingRoute.id, payload) : dbService.addTransportRoute(payload);
        if (!r.success) {
          failure = r.error || '';
          throw new Error(r.error);
        }
      },
      editingRoute ? 'A guardar alterações da rota...' : 'A registar rota...'
    );
    if (result.ok) setRouteModalOpen(false);
    else setRouteError(failure || result.error || 'Não foi possível guardar a rota.');
  };

  const handleDeleteRoute = async () => {
    if (!deletingRoute) return;
    const target = deletingRoute;
    setDeletingRoute(null);
    await run(() => {
      dbService.deleteTransportRoute(target.id);
    }, `A eliminar rota ${target.name}...`);
  };

  // ---------- Passageiros da rota (alunos, professores e funcionários) ----------
  const openRoster = (r: TransportRoute) => {
    setRosterRouteId(r.id);
    setRosterKind('student');
    setPersonToAdd('');
    setRosterError('');
    setPaymentsFor(null);
    setQrFor(null);
  };

  const personOptions = useMemo(() => {
    if (!rosterRoute) return [];
    const enrolled = new Set(routeRiderKeys(rosterRoute));
    if (rosterKind === 'student') {
      return students
        .filter((s) => s.status === 'active' && !enrolled.has(personKey('student', s.id)))
        .sort((a, b) => a.name.localeCompare(b.name, 'pt'))
        .map((s) => ({ value: s.id, label: `${s.name} — ${s.className || s.grade} (${s.procNumber})` }));
    }
    if (rosterKind === 'docente') {
      return teachers
        .filter((t) => !enrolled.has(personKey('docente', t.id)))
        .sort((a, b) => a.name.localeCompare(b.name, 'pt'))
        .map((t) => ({ value: t.id, label: `${t.name} — ${t.department || 'Sem departamento'} (${t.agentNumber})` }));
    }
    return funcionarios
      .filter((f) => !enrolled.has(personKey('funcionario', f.id)))
      .sort((a, b) => a.name.localeCompare(b.name, 'pt'))
      .map((f) => ({ value: f.id, label: `${f.name} — ${f.department || 'Sem departamento'} (${f.employeeNumber})` }));
  }, [students, teachers, funcionarios, rosterRoute, rosterKind]);

  const handleAddPerson = async () => {
    if (!rosterRoute || !personToAdd) return;
    if (!acl.can(RULE)) {
      acl.guard(RULE, () => undefined);
      return;
    }
    let failure = '';
    const result = await run(() => {
      const r = dbService.assignPersonToRoute(rosterRoute.id, personKey(rosterKind, personToAdd));
      if (!r.success) {
        failure = r.error || '';
        throw new Error(r.error);
      }
    }, `A inscrever ${RIDER_KIND_LABEL[rosterKind].toLowerCase()} na rota...`);
    if (result.ok) {
      setPersonToAdd('');
      setRosterError('');
    } else {
      setRosterError(failure || result.error || 'Não foi possível inscrever o passageiro.');
    }
  };

  const handleRemovePerson = async (key: TransportPersonKey) => {
    if (!rosterRoute) return;
    setRosterError('');
    if (paymentsFor === key) setPaymentsFor(null);
    if (qrFor === key) setQrFor(null);
    await run(() => {
      dbService.removePersonFromRoute(rosterRoute.id, key);
    }, 'A remover passageiro da rota...');
  };

  // ---------- Mensalidades ----------
  const handleTogglePayment = async (key: TransportPersonKey, month: number) => {
    if (!rosterRoute) return;
    if (!acl.can(RULE)) {
      acl.guard(RULE, () => undefined);
      return;
    }
    const paid = isMonthPaid(rosterRoute, key, academicYear, month);
    let failure = '';
    const result = await run(() => {
      const r = paid
        ? dbService.cancelTransportPayment(rosterRoute.id, key, month, academicYear)
        : dbService.registerTransportPayment(rosterRoute.id, key, month, academicYear);
      if (!r.success) {
        failure = r.error || '';
        throw new Error(r.error);
      }
    }, paid ? 'A anular pagamento...' : 'A validar pagamento da mensalidade...');
    if (!result.ok) setRosterError(failure || result.error || 'Não foi possível atualizar a mensalidade.');
    else setRosterError('');
  };

  const vehicleTone = (s: VehicleStatus): 'green' | 'amber' | 'slate' =>
    s === 'ativo' ? 'green' : s === 'manutencao' ? 'amber' : 'slate';

  const vehicleOptionsForRoute = vehicles
    .filter((v) => v.status === 'ativo' || v.id === routeForm.vehicleId)
    .sort((a, b) => a.plate.localeCompare(b.plate, 'pt'));

  const tabBtn = (key: 'rotas' | 'viaturas', label: string, icon: string, count: number) => (
    <button
      type="button"
      onClick={() => {
        setTab(key);
        setSearchTerm('');
      }}
      className={`flex items-center gap-2 px-4 py-2.5 text-xs font-bold border-b-2 transition-colors cursor-pointer ${
        tab === key ? 'border-[#0b1f3a] text-[#0b1f3a]' : 'border-transparent text-slate-500 hover:text-[#0b1f3a]'
      }`}
    >
      <span className="material-symbols-outlined text-[18px]">{icon}</span>
      <span>{label}</span>
      <span className="font-mono text-[10px] bg-slate-100 px-1.5 py-0.5 rounded">{count}</span>
    </button>
  );

  return (
    <div className="flex flex-col w-full gap-6 pb-12">
      <LogisticsPageHeader
        subsection="TRANSPORTE ESCOLAR"
        title="GESTÃO DE TRANSPORTE"
        description="Viaturas e motoristas, rotas com paragens e horários, mensalidades e os passageiros (alunos, professores e funcionários) inscritos em cada percurso."
        actions={
          acl.can(RULE) ? (
            <>
              <LogisticsPrimaryButton icon="directions_bus" label="NOVA VIATURA" onClick={openAddVehicle} variant="secondary" />
              <LogisticsPrimaryButton icon="add_road" label="NOVA ROTA" onClick={openAddRoute} />
            </>
          ) : undefined
        }
      />

      <LogisticsKpiGrid
        items={[
          { label: 'Viaturas', value: vehicles.length, icon: 'directions_bus' },
          { label: 'Rotas ativas', value: routes.filter((r) => r.status === 'ativa').length, icon: 'route' },
          { label: 'Passageiros transportados', value: totalRiders, icon: 'groups' },
          { label: 'Lugares (viaturas ativas)', value: totalSeats, icon: 'airline_seat_recline_normal' }
        ]}
      />

      <div className="flex border-b border-slate-200">
        {tabBtn('rotas', 'Rotas', 'route', routes.length)}
        {tabBtn('viaturas', 'Viaturas', 'directions_bus', vehicles.length)}
      </div>

      <LogisticsSearchBar
        value={searchTerm}
        onChange={setSearchTerm}
        placeholder={tab === 'rotas' ? 'Pesquisar por rota, código, paragem ou viatura...' : 'Pesquisar por matrícula, modelo, código ou motorista...'}
      >
        <span className="text-xs text-slate-400 font-mono">
          {tab === 'rotas' ? filteredRoutes.length : filteredVehicles.length} registos
        </span>
      </LogisticsSearchBar>

      {tab === 'rotas' ? (
        <LogisticsTableCard>
          <table className="w-full text-left text-xs">
            <thead>
              <tr className="bg-[#0b1f3a] text-white font-bold uppercase text-[10px] tracking-wider border-b border-slate-800">
                <th className="py-3.5 px-4 text-white">Rota & Código</th>
                <th className={logisticsThCls}>Viatura</th>
                <th className={logisticsThCls}>Turno</th>
                <th className={logisticsThCls}>Paragens</th>
                <th className={logisticsThCls}>Lotação</th>
                <th className={logisticsThCls}>Mensalidade</th>
                <th className={logisticsThCls}>Estado</th>
                <th className="py-3.5 px-4 text-right text-white">Ações</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {filteredRoutes.length === 0 ? (
                <tr>
                  <td colSpan={8} className="py-12 text-center text-slate-400 text-xs">
                    Nenhuma rota registada ou encontrada. Clique em "NOVA ROTA" para criar a primeira.
                  </td>
                </tr>
              ) : (
                visibleFilteredRoutes.map((r) => {
                  const vehicle = r.vehicleId ? vehicleById.get(r.vehicleId) : undefined;
                  const cap = vehicle?.capacity;
                  const occ = routeOccupancy(r);
                  const full = cap !== undefined && occ >= cap;
                  return (
                    <tr key={r.id} className="hover:bg-slate-50 transition-colors">
                      <td className="py-3.5 px-4">
                        <div className="font-bold text-[#0b1f3a]">{r.name}</div>
                        <div className="mt-0.5 text-[11px] text-slate-500 font-mono">{r.code}</div>
                      </td>
                      <td className="py-3.5 px-3 text-slate-700">
                        {vehicle ? `${vehicle.plate} · ${vehicle.model}` : <span className="text-slate-400">Sem viatura</span>}
                      </td>
                      <td className="py-3.5 px-3 text-slate-600">{TRANSPORT_SHIFT_LABELS[r.shift]}</td>
                      <td className="py-3.5 px-3 text-slate-600 max-w-[220px]">
                        <div className="truncate" title={r.stops.map((s) => s.name).join(' → ')}>
                          {r.stops.map((s) => s.name).join(' → ')}
                        </div>
                        <span className="text-[11px] text-slate-400">
                          {r.stops.length} {r.stops.length === 1 ? 'paragem' : 'paragens'}
                        </span>
                      </td>
                      <td className="py-3.5 px-3 whitespace-nowrap">
                        <span className={`font-mono font-bold ${full ? 'text-red-700' : 'text-slate-800'}`}>
                          {occ}
                          {cap !== undefined ? ` / ${cap}` : ''}
                        </span>
                        {full && <span className="ml-1.5"><LogisticsBadge tone="red">Lotação Esgotada</LogisticsBadge></span>}
                      </td>
                      <td className="py-3.5 px-3 font-mono text-slate-700 whitespace-nowrap">{formatKz(r.monthlyFeeKz)}</td>
                      <td className="py-3.5 px-3">
                        <LogisticsBadge tone={r.status === 'ativa' ? 'green' : 'slate'}>
                          {r.status === 'ativa' ? 'Ativa' : 'Inativa'}
                        </LogisticsBadge>
                      </td>
                      <td className="py-3.5 px-4 text-right">
                        <div className="flex items-center justify-end gap-1">
                          <LogisticsIconButton icon="groups" title="Ver / gerir passageiros da rota" onClick={() => openRoster(r)} />
                          {acl.can(RULE) && (
                            <>
                              <LogisticsIconButton icon="edit" title="Editar rota" hover="blue" onClick={() => openEditRoute(r)} />
                              <LogisticsIconButton icon="delete" title="Eliminar rota" hover="red" onClick={() => setDeletingRoute(r)} />
                            </>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
          <TablePagination total={filteredRoutes.length} page={pgFilteredRoutes} onPageChange={setPgFilteredRoutes} />
        </LogisticsTableCard>
      ) : (
        <LogisticsTableCard>
          <table className="w-full text-left text-xs">
            <thead>
              <tr className="bg-[#0b1f3a] text-white font-bold uppercase text-[10px] tracking-wider border-b border-slate-800">
                <th className="py-3.5 px-4 text-white">Viatura & Código</th>
                <th className={logisticsThCls}>Capacidade</th>
                <th className={logisticsThCls}>Motorista</th>
                <th className={logisticsThCls}>Rotas</th>
                <th className={logisticsThCls}>Estado</th>
                <th className="py-3.5 px-4 text-right text-white">Ações</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {filteredVehicles.length === 0 ? (
                <tr>
                  <td colSpan={6} className="py-12 text-center text-slate-400 text-xs">
                    Nenhuma viatura registada ou encontrada. Clique em "NOVA VIATURA" para adicionar a primeira.
                  </td>
                </tr>
              ) : (
                visibleFilteredVehicles.map((v) => {
                  const vRoutes = routes.filter((r) => r.vehicleId === v.id);
                  return (
                    <tr key={v.id} className="hover:bg-slate-50 transition-colors">
                      <td className="py-3.5 px-4">
                        <div className="font-bold text-[#0b1f3a] font-mono">{v.plate}</div>
                        <div className="mt-0.5 text-[11px] text-slate-500">
                          {v.model} · <span className="font-mono">{v.code}</span>
                        </div>
                      </td>
                      <td className="py-3.5 px-3 font-mono text-slate-700">{v.capacity} lugares</td>
                      <td className="py-3.5 px-3">
                        {v.driverName ? (
                          <>
                            <div className="text-slate-800 font-semibold">{v.driverName}</div>
                            {v.driverPhone && (
                              <a href={`tel:${v.driverPhone}`} className="text-[11px] font-mono text-slate-600 hover:text-[#0b1f3a]">
                                {v.driverPhone}
                              </a>
                            )}
                          </>
                        ) : (
                          <span className="text-slate-400">—</span>
                        )}
                      </td>
                      <td className="py-3.5 px-3 text-slate-600">
                        {vRoutes.length ? vRoutes.map((r) => r.name).join(', ') : <span className="text-slate-400">Nenhuma</span>}
                      </td>
                      <td className="py-3.5 px-3">
                        <LogisticsBadge tone={vehicleTone(v.status)}>{VEHICLE_STATUS_LABELS[v.status]}</LogisticsBadge>
                      </td>
                      <td className="py-3.5 px-4 text-right">
                        <div className="flex items-center justify-end gap-1">
                          {acl.can(RULE) && (
                            <>
                              <LogisticsIconButton icon="edit" title="Editar viatura" hover="blue" onClick={() => openEditVehicle(v)} />
                              <LogisticsIconButton
                                icon="delete"
                                title="Eliminar viatura"
                                hover="red"
                                onClick={() => {
                                  setDeleteVehicleError('');
                                  setDeletingVehicle(v);
                                }}
                              />
                            </>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
          <TablePagination total={filteredVehicles.length} page={pgFilteredVehicles} onPageChange={setPgFilteredVehicles} />
        </LogisticsTableCard>
      )}

      {/* Modal: Viatura */}
      {vehicleModalOpen && (
        <LogisticsModal
          title={editingVehicle ? 'Editar Viatura' : 'Nova Viatura'}
          subtitle={editingVehicle ? editingVehicle.code : 'Logística · Transporte Escolar'}
          icon="directions_bus"
          onClose={() => setVehicleModalOpen(false)}
        >
          <form onSubmit={handleVehicleSubmit} className="flex-1 overflow-y-auto p-6 text-xs space-y-5">
            <div className="space-y-3">
              <LogisticsSectionTitle icon="directions_bus">Viatura</LogisticsSectionTitle>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <div>
                  <label className={labelCls}>Matrícula *</label>
                  <input
                    type="text"
                    required
                    autoFocus
                    value={vehicleForm.plate}
                    onChange={(e) => setVehicleForm({ ...vehicleForm, plate: e.target.value })}
                    placeholder="LD-00-00-AA"
                    className={`${inputCls} font-mono uppercase`}
                  />
                </div>
                <div>
                  <label className={labelCls}>Modelo *</label>
                  <input
                    type="text"
                    value={vehicleForm.model}
                    onChange={(e) => setVehicleForm({ ...vehicleForm, model: e.target.value })}
                    placeholder="Ex.: Toyota Coaster"
                    className={inputCls}
                  />
                </div>
                <div>
                  <label className={labelCls}>Capacidade (lugares) *</label>
                  <input
                    type="number"
                    min={1}
                    step={1}
                    value={vehicleForm.capacity}
                    onChange={(e) => setVehicleForm({ ...vehicleForm, capacity: e.target.value })}
                    className={`${inputCls} font-mono`}
                  />
                </div>
                <div>
                  <label className={labelCls}>Estado</label>
                  <select
                    value={vehicleForm.status}
                    onChange={(e) => setVehicleForm({ ...vehicleForm, status: e.target.value as VehicleStatus })}
                    className={inputCls}
                  >
                    {Object.entries(VEHICLE_STATUS_LABELS).map(([k, l]) => (
                      <option key={k} value={k}>
                        {l}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
            </div>

            <div className="space-y-3">
              <LogisticsSectionTitle icon="badge">Motorista</LogisticsSectionTitle>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <div>
                  <label className={labelCls}>Nome</label>
                  <input
                    type="text"
                    value={vehicleForm.driverName || ''}
                    onChange={(e) => setVehicleForm({ ...vehicleForm, driverName: e.target.value })}
                    className={inputCls}
                  />
                </div>
                <div>
                  <label className={labelCls}>Telefone</label>
                  <input
                    type="text"
                    value={vehicleForm.driverPhone || ''}
                    onChange={(e) => setVehicleForm({ ...vehicleForm, driverPhone: e.target.value })}
                    placeholder="+244 9XX XXX XXX"
                    className={`${inputCls} font-mono`}
                  />
                </div>
                <div>
                  <label className={labelCls}>Nº da Carta de Condução</label>
                  <input
                    type="text"
                    value={vehicleForm.driverLicenseNumber || ''}
                    onChange={(e) => setVehicleForm({ ...vehicleForm, driverLicenseNumber: e.target.value })}
                    className={`${inputCls} font-mono`}
                  />
                </div>
                <div className="sm:col-span-3">
                  <label className={labelCls}>Observações</label>
                  <textarea
                    rows={2}
                    value={vehicleForm.notes || ''}
                    onChange={(e) => setVehicleForm({ ...vehicleForm, notes: e.target.value })}
                    className="w-full px-3 py-2 bg-white border border-slate-300 text-slate-800 focus:border-[#0b1f3a] focus:outline-none text-xs"
                  />
                </div>
              </div>
            </div>

            <LogisticsFormFooter
              error={vehicleError}
              onCancel={() => setVehicleModalOpen(false)}
              submitLabel={editingVehicle ? 'Guardar Alterações' : 'Registar Viatura'}
            />
          </form>
        </LogisticsModal>
      )}

      {/* Modal: Rota */}
      {routeModalOpen && (
        <LogisticsModal
          title={editingRoute ? 'Editar Rota' : 'Nova Rota'}
          subtitle={editingRoute ? editingRoute.code : 'Logística · Transporte Escolar'}
          icon="add_road"
          onClose={() => setRouteModalOpen(false)}
        >
          <form onSubmit={handleRouteSubmit} className="flex-1 overflow-y-auto p-6 text-xs space-y-5">
            <div className="space-y-3">
              <LogisticsSectionTitle icon="route">Rota</LogisticsSectionTitle>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="sm:col-span-2">
                  <label className={labelCls}>Nome da Rota *</label>
                  <input
                    type="text"
                    required
                    autoFocus
                    value={routeForm.name}
                    onChange={(e) => setRouteForm({ ...routeForm, name: e.target.value })}
                    placeholder="Ex.: Viana — Escola (Manhã)"
                    className={inputCls}
                  />
                </div>
                <div>
                  <label className={labelCls}>Viatura</label>
                  <select
                    value={routeForm.vehicleId}
                    onChange={(e) => setRouteForm({ ...routeForm, vehicleId: e.target.value })}
                    className={inputCls}
                  >
                    <option value="">Sem viatura atribuída</option>
                    {vehicleOptionsForRoute.map((v) => (
                      <option key={v.id} value={v.id}>
                        {v.plate} · {v.model} ({v.capacity} lugares)
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className={labelCls}>Turno</label>
                  <select
                    value={routeForm.shift}
                    onChange={(e) => setRouteForm({ ...routeForm, shift: e.target.value as TransportShift })}
                    className={inputCls}
                  >
                    {Object.entries(TRANSPORT_SHIFT_LABELS).map(([k, l]) => (
                      <option key={k} value={k}>
                        {l}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className={labelCls}>Mensalidade do Transporte (Kz)</label>
                  <input
                    type="text"
                    inputMode="decimal"
                    value={routeForm.monthlyFee}
                    onChange={(e) => setRouteForm({ ...routeForm, monthlyFee: e.target.value })}
                    className={`${inputCls} font-mono`}
                  />
                </div>
                <div>
                  <label className={labelCls}>Estado</label>
                  <select
                    value={routeForm.status}
                    onChange={(e) => setRouteForm({ ...routeForm, status: e.target.value as 'ativa' | 'inativa' })}
                    className={inputCls}
                  >
                    <option value="ativa">Ativa</option>
                    <option value="inativa">Inativa</option>
                  </select>
                </div>
              </div>
            </div>

            <div className="space-y-3">
              <LogisticsSectionTitle icon="pin_drop">Paragens (por ordem de percurso)</LogisticsSectionTitle>
              <div className="space-y-2">
                {routeForm.stops.map((s, idx) => (
                  <div key={idx} className="flex items-center gap-2">
                    <span className="w-6 text-center font-mono text-[11px] text-slate-400 shrink-0">{idx + 1}</span>
                    <input
                      type="text"
                      value={s.name}
                      onChange={(e) => updateStop(idx, { name: e.target.value })}
                      placeholder="Local da paragem"
                      className={inputCls}
                    />
                    <input
                      type="time"
                      value={s.time || ''}
                      onChange={(e) => updateStop(idx, { time: e.target.value })}
                      className={`${inputCls} !w-28 shrink-0 font-mono`}
                    />
                    <button
                      type="button"
                      onClick={() =>
                        setRouteForm({
                          ...routeForm,
                          stops: routeForm.stops.length > 1 ? routeForm.stops.filter((_, i) => i !== idx) : [{ name: '', time: '' }]
                        })
                      }
                      title="Remover paragem"
                      className="p-1.5 text-slate-400 hover:text-red-700 cursor-pointer shrink-0"
                    >
                      <span className="material-symbols-outlined text-[18px]">close</span>
                    </button>
                  </div>
                ))}
                <button
                  type="button"
                  onClick={() => setRouteForm({ ...routeForm, stops: [...routeForm.stops, { name: '', time: '' }] })}
                  className="flex items-center gap-1.5 text-xs font-bold text-[#0b1f3a] hover:text-[#7a0c0c] cursor-pointer"
                >
                  <span className="material-symbols-outlined text-[16px]">add</span>
                  Adicionar paragem
                </button>
              </div>
              <div>
                <label className={labelCls}>Observações</label>
                <textarea
                  rows={2}
                  value={routeForm.notes}
                  onChange={(e) => setRouteForm({ ...routeForm, notes: e.target.value })}
                  className="w-full px-3 py-2 bg-white border border-slate-300 text-slate-800 focus:border-[#0b1f3a] focus:outline-none text-xs"
                />
              </div>
            </div>

            <LogisticsFormFooter
              error={routeError}
              onCancel={() => setRouteModalOpen(false)}
              submitLabel={editingRoute ? 'Guardar Alterações' : 'Criar Rota'}
            />
          </form>
        </LogisticsModal>
      )}

      {/* Modal: Passageiros da rota (alunos, professores e funcionários) */}
      {rosterRoute && (
        <LogisticsModal
          title={rosterRoute.name}
          subtitle={`${rosterRoute.code} · ${TRANSPORT_SHIFT_LABELS[rosterRoute.shift]} · Mensalidade: ${formatKz(routeFee(db, rosterRoute))}`}
          icon="groups"
          badge={`${routeOccupancy(rosterRoute)}${
            rosterRoute.vehicleId && vehicleById.get(rosterRoute.vehicleId)
              ? ` / ${vehicleById.get(rosterRoute.vehicleId)!.capacity}`
              : ''
          } passageiros`}
          onClose={() => setRosterRouteId(null)}
          widthCls="max-w-2xl"
        >
          <div className="flex-1 overflow-y-auto p-6 text-xs space-y-5">
            {!capacityCheck(db, rosterRoute).ok && (
              <Notice tone="error" icon="no_transfer">
                {capacityCheck(db, rosterRoute).message}
              </Notice>
            )}

            <div>
              <LogisticsSectionTitle icon="pin_drop">Percurso</LogisticsSectionTitle>
              <ol className="mt-3 space-y-1.5">
                {rosterRoute.stops.map((s, i) => (
                  <li key={i} className="flex items-center gap-3 text-slate-700">
                    <span className="font-mono text-[11px] text-slate-400 w-5 text-right">{i + 1}</span>
                    <span className="flex-1">{s.name}</span>
                    {s.time && <span className="font-mono text-slate-500">{s.time}</span>}
                  </li>
                ))}
              </ol>
            </div>

            {acl.can(RULE) && rosterRoute.status === 'ativa' && (
              <div className="space-y-2">
                <LogisticsSectionTitle icon="person_add">Inscrever passageiro</LogisticsSectionTitle>
                <div className="flex border border-slate-200 w-max">
                  {(['student', 'docente', 'funcionario'] as RiderKind[]).map((k) => (
                    <button
                      key={k}
                      type="button"
                      onClick={() => {
                        setRosterKind(k);
                        setPersonToAdd('');
                      }}
                      className={`px-3 py-1.5 text-[11px] font-bold cursor-pointer transition-colors ${
                        rosterKind === k ? 'bg-[#0b1f3a] text-white' : 'bg-white text-slate-600 hover:bg-slate-50'
                      }`}
                    >
                      {RIDER_KIND_LABEL[k]}s
                    </button>
                  ))}
                </div>
                <div className="flex items-end gap-2">
                  <div className="flex-1">
                    <SearchableSelect
                      options={personOptions}
                      value={personToAdd}
                      onChange={setPersonToAdd}
                      placeholder={
                        rosterKind === 'student'
                          ? 'Pesquise por nome ou nº de processo...'
                          : rosterKind === 'docente'
                            ? 'Pesquise por nome ou nº de agente...'
                            : 'Pesquise por nome ou nº de funcionário...'
                      }
                      emptyMessage={`Nenhum(a) ${RIDER_KIND_LABEL[rosterKind].toLowerCase()} disponível`}
                    />
                  </div>
                  <button
                    type="button"
                    onClick={handleAddPerson}
                    disabled={!personToAdd || !capacityCheck(db, rosterRoute).ok}
                    className="h-9 px-4 bg-[#0b1f3a] hover:bg-[#7a0c0c] disabled:bg-slate-300 disabled:cursor-not-allowed text-white font-bold text-xs cursor-pointer transition-colors shrink-0"
                  >
                    Inscrever
                  </button>
                </div>
                {rosterError && (
                  <Notice tone="error">{rosterError}</Notice>
                )}
              </div>
            )}

            <div className="space-y-2">
              <LogisticsSectionTitle icon="groups">Passageiros inscritos</LogisticsSectionTitle>
              {routeRiderKeys(rosterRoute).length === 0 ? (
                <p className="text-slate-400 py-4 text-center">Ainda não há passageiros inscritos nesta rota.</p>
              ) : (
                <ul className="divide-y divide-slate-100 border border-slate-200">
                  {routeRiderKeys(rosterRoute).map((key) => {
                    const info = riderInfo(key);
                    const currentMonth = new Date().getMonth() + 1;
                    const monthPaid = isMonthPaid(rosterRoute, key, academicYear, currentMonth);
                    const paidCount = paidMonths(rosterRoute, key, academicYear).size;
                    return (
                      <li key={key} className="px-3 py-2 space-y-2">
                        <div className="flex items-center gap-3">
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2">
                              <span className="font-semibold text-[#0b1f3a] truncate">{info.name}</span>
                              <LogisticsBadge tone={RIDER_KIND_BADGE_TONE[info.kind]}>{RIDER_KIND_LABEL[info.kind]}</LogisticsBadge>
                            </div>
                            <div className="text-[11px] text-slate-500">{info.detail}</div>
                          </div>
                          <LogisticsBadge tone={monthPaid ? 'green' : 'red'}>
                            {monthPaid ? `${MONTHS_PT[currentMonth - 1]} pago` : 'Mensalidade em atraso'}
                          </LogisticsBadge>
                          <LogisticsIconButton
                            icon="payments"
                            title="Mensalidades do ano letivo"
                            hover="green"
                            onClick={() => setPaymentsFor(paymentsFor === key ? null : key)}
                          />
                          <LogisticsIconButton
                            icon="qr_code_2"
                            title="Ver QR do cartão de transporte"
                            hover="blue"
                            onClick={() => setQrFor(key)}
                          />
                          {acl.can(RULE) && (
                            <LogisticsIconButton icon="person_remove" title="Remover da rota" hover="red" onClick={() => handleRemovePerson(key)} />
                          )}
                        </div>

                        {paymentsFor === key && (
                          <div className="border border-slate-200 bg-slate-50 p-3 space-y-2">
                            <div className="flex items-center justify-between">
                              <span className="font-bold text-[#0b1f3a] uppercase text-[10px] tracking-wider">
                                Mensalidades · {academicYear} · {paidCount}/12 pagas
                              </span>
                              <span className="font-mono text-slate-500">{formatKz(routeFee(db, rosterRoute))} / mês</span>
                            </div>
                            <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-6 gap-1.5">
                              {MONTHS_PT.map((m, idx) => {
                                const month = idx + 1;
                                const paid = isMonthPaid(rosterRoute, key, academicYear, month);
                                const payment = (rosterRoute.payments || []).find(
                                  (p) => p.personKey === key && p.year === academicYear && p.month === month
                                );
                                return (
                                  <button
                                    key={m}
                                    type="button"
                                    disabled={!acl.can(RULE)}
                                    onClick={() => handleTogglePayment(key, month)}
                                    title={
                                      payment
                                        ? `Pago em ${new Date(payment.paidAt).toLocaleDateString('pt-PT')} · ${payment.receipt} (clique para anular)`
                                        : 'Clique para validar o pagamento'
                                    }
                                    className={`px-1.5 py-1.5 text-[10px] font-bold border cursor-pointer transition-colors disabled:cursor-not-allowed ${
                                      paid
                                        ? 'bg-emerald-600 border-emerald-700 text-white hover:bg-red-600 hover:border-red-700'
                                        : 'bg-white border-slate-300 text-slate-500 hover:border-emerald-600 hover:text-emerald-700'
                                    }`}
                                  >
                                    {m.slice(0, 3)}
                                  </button>
                                );
                              })}
                            </div>
                            <p className="text-[10px] text-slate-400">
                              Verde = mensalidade validada (clique para anular). O QR do cartão só habilita o embarque com a
                              mensalidade do mês corrente paga.
                            </p>
                          </div>
                        )}
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          </div>
        </LogisticsModal>
      )}

      {/* Modal: QR do cartão de transporte */}
      {qrFor && rosterRoute && (
        <LogisticsModal
          title="QR do Cartão de Transporte"
          subtitle={`${rosterRoute.code} · ${TRANSPORT_SHIFT_LABELS[rosterRoute.shift]}`}
          icon="qr_code_2"
          onClose={() => setQrFor(null)}
          widthCls="max-w-sm"
        >
          {(() => {
            const info = riderInfo(qrFor);
            const link = buildTransportLink(qrFor, rosterRoute, academicYear, {
              base: publicBase(),
              inst: getPublicInstitution()
            });
            const currentMonth = new Date().getMonth() + 1;
            const monthPaid = isMonthPaid(rosterRoute, qrFor, academicYear, currentMonth);
            return (
              <div className="flex-1 overflow-y-auto p-6 text-xs space-y-4 flex flex-col items-center">
                <div className="p-3 bg-white border border-slate-200 shadow-sm">
                  <PublicQrCode value={link} size={180} />
                </div>
                <div className="text-center">
                  <div className="font-bold text-[#0b1f3a] text-sm">{info.name}</div>
                  <div className="text-slate-500">{info.detail}</div>
                  <div className="font-mono text-[11px] text-slate-400 mt-1 break-all">{link}</div>
                </div>
                <LogisticsBadge tone={monthPaid ? 'green' : 'red'}>
                  {monthPaid ? 'Pronto para embarque (mensalidade em dia)' : `Mensalidade de ${MONTHS_PT[currentMonth - 1]} em atraso`}
                </LogisticsBadge>
                <p className="text-[11px] text-slate-500 text-center">
                  Este é o mesmo código gravado no cartão. A leitura é feita pela aplicação do motorista, que valida em
                  tempo real: inscrição na rota e turno, mensalidade do mês e embarque único por dia.
                </p>
              </div>
            );
          })()}
        </LogisticsModal>
      )}

      {deletingRoute && (
        <LogisticsDeleteModal
          title="Eliminar Rota"
          name={deletingRoute.name}
          code={deletingRoute.code}
          extra={
            routeOccupancy(deletingRoute)
              ? `Os ${routeOccupancy(deletingRoute)} passageiros inscritos deixarão de ter transporte atribuído.`
              : undefined
          }
          onCancel={() => setDeletingRoute(null)}
          onConfirm={handleDeleteRoute}
        />
      )}

      {deletingVehicle && (
        <div>
          <LogisticsDeleteModal
            title="Eliminar Viatura"
            name={`${deletingVehicle.plate} · ${deletingVehicle.model}`}
            code={deletingVehicle.code}
            extra={deleteVehicleError ? `⚠ ${deleteVehicleError}` : undefined}
            onCancel={() => setDeletingVehicle(null)}
            onConfirm={handleDeleteVehicle}
          />
        </div>
      )}
    </div>
  );
};
