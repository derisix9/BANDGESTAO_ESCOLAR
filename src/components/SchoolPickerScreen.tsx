import React, { useEffect, useMemo, useState } from 'react';
import { getGroupOverview, type GroupOverview, type GroupSchoolStats, type MySchool } from '../services/branches';
import { Notice } from './Notice';

interface Props {
  schools: MySchool[];
  adminName?: string;
  /** Devolve uma mensagem de erro, ou nada em caso de sucesso (a página recarrega sozinha). */
  onSelect: (school: MySchool) => Promise<string | void>;
  /** Só quando o painel foi reaberto a partir da app: permite voltar sem trocar. */
  onCancel?: () => void;
  onLogout: () => void;
}

const ALL = 'todas';
const MOTHER = 'mae';
const BRANCHES = 'filiais';

const kz = (n: number) => `${Math.round(n).toLocaleString('pt-PT')} Kz`;
const num = (n: number) => n.toLocaleString('pt-AO');
const fmtBytes = (b: number): string => {
  if (!Number.isFinite(b) || b <= 0) return '0 KB';
  if (b < 1024 * 1024) return `${Math.max(1, Math.round(b / 1024))} KB`;
  if (b < 1024 ** 3) return `${(b / 1024 ** 2).toFixed(1)} MB`;
  return `${(b / 1024 ** 3).toFixed(2)} GB`;
};

const selectCls =
  'mt-3 w-full rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-xs font-semibold text-slate-700 focus:outline-none focus:ring-2 focus:ring-[#0b1f3a]/30';

type Metric = 'students' | 'users' | 'storageBytes';

/**
 * Painel do administrador de um grupo escolar (escola mãe + filiais).
 *  1. Cartões iguais aos do Dashboard, com os valores GERAIS do grupo e um filtro por escola (geral / mãe / cada filial).
 *  2. Ocupação do plano único (alunos, utilizadores, armazenamento): o plano é partilhado, por isso o consumo de
 *     todas as escolas soma-se e o limite é o do plano da escola mãe.
 *  3. Tabela de escolas com o botão «Entrar» (sem cartões repetidos).
 * Os números vêm do servidor (my_group_overview, migração 0025); cada escola continua com os dados isolados.
 */
/** Logótipo da escola; sem imagem (ou se falhar) mostra as iniciais. */
const SchoolLogo: React.FC<{ url?: string | null; name: string }> = ({ url, name }) => {
  const [broken, setBroken] = useState(false);
  const initials = name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]).join('').toUpperCase();
  return (
    <span className="w-10 h-10 rounded-lg bg-white border border-[#D3E4FE] flex items-center justify-center overflow-hidden shrink-0 shadow-xs">
      {url && !broken
        ? <img src={url} alt={`Logótipo de ${name}`} className="w-full h-full object-contain p-0.5" referrerPolicy="no-referrer" onError={() => setBroken(true)} />
        : <span className="text-xs font-extrabold text-[#12498A]">{initials || '?'}</span>}
    </span>
  );
};

export const SchoolPickerScreen: React.FC<Props> = ({ schools, adminName, onSelect, onCancel, onLogout }) => {
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [overview, setOverview] = useState<GroupOverview | null>(null);
  const [loading, setLoading] = useState(true);

  // Filtros por cartão (cada cartão tem o seu, como no Dashboard); o filtro do topo aplica-se a todos.
  const [fStudents, setFStudents] = useState(ALL);
  const [fTeachers, setFTeachers] = useState(ALL);
  const [fAttendance, setFAttendance] = useState(ALL);
  const [fCollection, setFCollection] = useState(ALL);
  const [fBalance, setFBalance] = useState(ALL);
  const [fExpenses, setFExpenses] = useState(ALL);
  const [uStudents, setUStudents] = useState(ALL);
  const [uUsers, setUUsers] = useState(ALL);
  const [uStorage, setUStorage] = useState(ALL);

  useEffect(() => {
    let cancelled = false;
    const load = () => getGroupOverview().then((o) => { if (!cancelled) { setOverview(o); setLoading(false); } });
    void load();
    const t = setInterval(() => void load(), 60_000);
    return () => { cancelled = true; clearInterval(t); };
  }, []);

  const mother = schools.find((s) => s.isMother);
  const branches = schools.filter((s) => !s.isMother);
  const stats = overview?.schools ?? [];
  const limits = overview?.limits;

  const setAll = (v: string) => {
    [setFStudents, setFTeachers, setFAttendance, setFCollection, setFBalance, setFExpenses, setUStudents, setUUsers, setUStorage].forEach((f) => f(v));
  };
  const topFilter = useMemo(() => {
    const vals = [fStudents, fTeachers, fAttendance, fCollection, fBalance, fExpenses, uStudents, uUsers, uStorage];
    return vals.every((v) => v === vals[0]) ? vals[0] : 'misto';
  }, [fStudents, fTeachers, fAttendance, fCollection, fBalance, fExpenses, uStudents, uUsers, uStorage]);

  const pick = async (s: MySchool) => {
    if (busyId || s.status !== 'active') return;
    setBusyId(s.id); setError('');
    const err = await onSelect(s);
    if (err) { setError(err); setBusyId(null); }
  };

  const pickFilter = (filter: string): GroupSchoolStats[] => {
    if (filter === ALL) return stats;
    if (filter === MOTHER) return stats.filter((s) => s.isMother);
    if (filter === BRANCHES) return stats.filter((s) => !s.isMother);
    return stats.filter((s) => s.id === filter);
  };
  const sum = (list: GroupSchoolStats[], f: (s: GroupSchoolStats) => number) => list.reduce((a, s) => a + (f(s) || 0), 0);

  const schoolOptions = (
    <>
      {stats.some((s) => s.isMother) && <option value={MOTHER}>Só a escola mãe</option>}
      {stats.some((s) => !s.isMother) && <option value={BRANCHES}>Só as filiais</option>}
      {stats.map((s) => (
        <option key={s.id} value={s.id}>{s.isMother ? 'Mãe · ' : 'Filial · '}{s.name}</option>
      ))}
    </>
  );
  const filterSelect = (value: string, onChange: (v: string) => void, label: string) => (
    <select aria-label={label} className={selectCls} value={value} onChange={(e) => onChange(e.target.value)}>
      <option value={ALL}>Todas as escolas (geral)</option>
      {schoolOptions}
    </select>
  );

  // ---- Valores dos cartões do Dashboard (somados sobre as escolas escolhidas) ----
  const stu = pickFilter(fStudents);
  const totalStudents = sum(stu, (s) => s.students.total);
  const regularStudents = sum(stu, (s) => s.students.regular);
  const debtStudents = sum(stu, (s) => s.students.debt);

  const tea = pickFilter(fTeachers);
  const totalTeachers = sum(tea, (s) => s.teachers);
  const totalDepartments = new Set(tea.flatMap((s) => s.departments)).size;
  const totalClasses = sum(tea, (s) => s.classes);

  const att = pickFilter(fAttendance);
  const attStudents = sum(att, (s) => s.students.total);
  const attRate = attStudents > 0 ? (sum(att, (s) => s.students.attendanceSum) / attStudents).toFixed(1) : '100.0';
  const attAbsences = sum(att, (s) => s.students.absences);

  const col = pickFilter(fCollection);
  const invoiced = sum(col, (s) => s.invoices.invoiced);
  const collected = sum(col, (s) => s.invoices.collected);
  const pendingInv = sum(col, (s) => s.invoices.pending);
  const collectedPct = invoiced > 0 ? Math.round((collected / invoiced) * 100) : 0;

  const bal = pickFilter(fBalance);
  const entradas = sum(bal, (s) => s.invoices.entradas);
  const saidas = sum(bal, (s) => s.expenses.paid + s.payroll.paid + s.assets.value);
  const saldo = entradas - saidas;

  const exp = pickFilter(fExpenses);
  const expTotal = sum(exp, (s) => s.expenses.paid + s.payroll.paid + s.assets.value);
  const expCount = sum(exp, (s) => s.expenses.paidCount + s.payroll.paidCount + s.assets.count);
  const payables = sum(exp, (s) => s.expenses.payables);

  const totalAllStudents = sum(stats, (s) => s.students.total);
  const totalAllClasses = sum(stats, (s) => s.classes);

  // ---- Ocupação do plano (único, partilhado) ----
  const meter = (used: number, limit: number | null | undefined) => {
    const unlimited = limit === null || limit === undefined;
    const pct = unlimited ? 0 : limit! > 0 ? Math.min(100, Math.round((used / limit!) * 100)) : 100;
    const full = !unlimited && used >= limit!;
    const bar = full ? 'bg-red-600' : pct >= 85 ? 'bg-amber-500' : 'bg-emerald-600';
    return { unlimited, pct, full, bar };
  };

  const occupationCard = (
    metric: Metric, label: string, icon: string, color: string, filter: string, setFilter: (v: string) => void, format: (n: number) => string
  ) => {
    const used = sum(pickFilter(filter), (s) => s.usage[metric]);
    const groupUsed = overview?.usage[metric] ?? 0;
    const limit = limits ? limits[metric] : null;
    const m = meter(groupUsed, limit);
    const own = meter(used, limit);
    const shown = filter === ALL ? m : own;
    return (
      <div className={`kpi-card ${color} p-3 flex flex-col justify-between`}>
        <div className="flex items-start justify-between">
          <div>
            <span className="kpi-label text-[10px] uppercase tracking-wider font-bold">{label}</span>
            <div className="kpi-value font-headline text-xl font-extrabold mt-0.5">
              {format(used)}
              <span className="kpi-sub text-xs font-bold">
                {' '}{filter === ALL ? `/ ${m.unlimited ? '∞' : format(limit!)}` : `de ${m.unlimited ? '∞' : format(limit!)} do plano`}
              </span>
            </div>
          </div>
          <div className="kpi-icon w-8 h-8"><span className="material-symbols-outlined text-[18px]">{icon}</span></div>
        </div>
        {filterSelect(filter, setFilter, `Filtrar ${label} por escola`)}
        <div className="mt-3 h-2.5 w-full rounded-full bg-white/70 overflow-hidden border border-slate-300/60" role="progressbar" aria-valuenow={shown.pct} aria-valuemin={0} aria-valuemax={100} aria-label={label}>
          <div className={`h-full ${shown.bar} transition-all`} style={{ width: `${Math.max(shown.unlimited ? 4 : 2, shown.pct)}%` }} />
        </div>
        <div className="kpi-foot mt-2 pt-2 border-t flex items-center justify-between text-xs">
          <span className="kpi-sub font-medium">{shown.unlimited ? 'Ilimitado' : `${shown.pct}% do limite do plano`}</span>
          {m.full
            ? <span className="kpi-chip kpi-tag-red px-2 py-0.5 font-bold text-[11px]">Limite atingido</span>
            : <span className="kpi-chip px-2 py-0.5 font-bold text-[11px]">{stats.length} {stats.length === 1 ? 'escola' : 'escolas'}</span>}
        </div>
      </div>
    );
  };

  const hasData = stats.length > 0 && !!overview;
  const glass = { backgroundColor: 'rgba(255,255,255,0.14)', borderColor: 'rgba(255,255,255,0.22)' };

  // ---- Tabela de escolas: ocupação do plano + botão de entrar (sem cartões redundantes) ----
  const entryTable = () => {
    const rows = [...(mother ? [mother] : []), ...branches];
    const cell = (used: number, limit: number | null | undefined, fmt: (n: number) => string, note?: string) => {
      const m = meter(used, limit);
      return (
        <td className="px-4 py-3 min-w-[160px]">
          <div className="flex items-center justify-between text-xs font-bold text-[#12498A]">
            <span>{fmt(used)}</span>
            <span className="text-slate-500 font-semibold">{m.unlimited ? '—' : `${m.pct}%`}</span>
          </div>
          <div className="mt-1 h-1.5 w-full rounded-full bg-white/80 overflow-hidden">
            <div className={`h-full ${m.bar}`} style={{ width: `${Math.max(m.unlimited ? 3 : 2, m.pct)}%` }} />
          </div>
          {note && <div className="mt-0.5 text-[10px] text-slate-500 font-semibold">{note}</div>}
        </td>
      );
    };
    const registered = stats.reduce((n, x) => n + x.students.total, 0);
    const inPlan = overview?.usage.students ?? 0;
    return (
      <div className="picker-table mt-4 bg-white border border-slate-200 rounded-2xl overflow-hidden shadow-xs">
        <div className="px-4 py-3 border-b border-slate-200 flex items-center justify-between gap-3">
          <span className="text-sm font-extrabold text-[#12498A] font-headline">Gerenciamento{hasData ? ' · Escolas' : ''}</span>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-[#12498A] text-white text-[11px] uppercase tracking-wider font-bold text-left">
                <th className="px-4 py-3 w-14">Logo</th>
                <th className="px-4 py-3">Escola</th>
                <th className="px-4 py-3">Alunos</th>
                <th className="px-4 py-3">Utilizadores</th>
                <th className="px-4 py-3">Armazenamento</th>
                <th className="px-4 py-3 text-right">Ações</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((sc, i) => {
                const st = stats.find((x) => x.id === sc.id);
                const disabled = sc.status !== 'active';
                return (
                  <tr key={sc.id} className={`border-b border-[#D3E4FE] hover:bg-[#D3E4FE]/70 transition-colors ${i % 2 === 0 ? 'bg-[#EFF4FF]' : 'bg-[#E5EEFF]/70'}`}>
                    <td className="px-4 py-3"><SchoolLogo url={st?.logoUrl} name={sc.name} /></td>
                    <td className="px-4 py-3">
                      <div className="font-bold text-[#12498A] flex items-center gap-2">
                        {sc.name}
                        {sc.isCurrent && <span className="text-[9px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded bg-emerald-600 text-white">Atual</span>}
                        {disabled && <span className="text-[9px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded bg-red-600 text-white">Indisponível</span>}
                      </div>
                      <div className="text-[10px] font-bold uppercase tracking-wider text-slate-500">{sc.isMother ? 'Escola mãe' : 'Filial'}{sc.nif ? ` · NIF ${sc.nif}` : ''}</div>
                    </td>
                    {hasData && st ? (
                      <>
                        {cell(st.usage.students, limits?.students, num, st.students.total > st.usage.students ? `de ${num(st.students.total)} registados` : undefined)}
                        {cell(st.usage.users, limits?.users, num)}
                        {cell(st.usage.storageBytes, limits?.storageBytes, fmtBytes)}
                      </>
                    ) : (
                      <>
                        <td className="px-4 py-3 text-xs font-bold text-[#12498A]">{num(sc.studentsCount)}</td>
                        <td className="px-4 py-3 text-xs font-bold text-[#12498A]">{sc.usersCount}</td>
                        <td className="px-4 py-3 text-xs font-bold text-slate-400">—</td>
                      </>
                    )}
                    <td className="px-4 py-3">
                      <div className="flex justify-end">
                        <button
                          type="button"
                          onClick={() => pick(sc)}
                          disabled={disabled || !!busyId}
                          title={busyId === sc.id ? 'A entrar…' : sc.isCurrent && onCancel ? 'Continuar nesta escola' : 'Entrar na escola'}
                          aria-label={`Entrar em ${sc.name}`}
                          className="picker-enter-btn"
                        >
                          <span className="material-symbols-outlined text-[20px]">{busyId === sc.id ? 'hourglass_top' : 'login'}</span>
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
              {hasData && (
                <tr className="picker-total-row font-extrabold">
                  <td className="px-4 py-3" colSpan={2}>Total do plano</td>
                  <td className="px-4 py-3">{num(overview!.usage.students)} / {limits?.students == null ? '∞' : num(limits.students)}</td>
                  <td className="px-4 py-3">{num(overview!.usage.users)} / {limits?.users == null ? '∞' : num(limits.users)}</td>
                  <td className="px-4 py-3">{fmtBytes(overview!.usage.storageBytes)} / {limits?.storageBytes == null ? '∞' : fmtBytes(limits.storageBytes)}</td>
                  <td className="px-4 py-3" />
                </tr>
              )}
            </tbody>
          </table>
        </div>
      
      </div>
    );
  };


  return (
    <div className="min-h-screen w-full bg-[#f8fafc] p-4 sm:p-8 font-body antialiased text-slate-800">
      <div className="max-w-7xl mx-auto flex flex-col gap-6 pb-12">
        {/* Cabeçalho azul, igual ao do Dashboard */}
        <div className="rounded-2xl bg-[#0b1f3a] text-white p-6 lg:p-7 shadow-md relative overflow-hidden border border-slate-800">
          <div className="absolute right-0 top-0 bottom-0 w-1/3 opacity-10 flex items-center justify-end pointer-events-none pr-8">
            <span className="material-symbols-outlined text-[140px]">hub</span>
          </div>
          <div className="relative z-10 flex flex-col lg:flex-row lg:items-center justify-between gap-4">
            <div>
              <p className="text-[11px] font-bold uppercase tracking-wider text-blue-200">Painel de Gerenciamento de Escola</p>
              <h1 className="font-headline text-2xl lg:text-3xl font-extrabold text-white tracking-tight mt-1">
                {adminName ? `${adminName.split(' ')[0]}. ` : ''}Em que escola quer trabalhar?
              </h1>
            </div>
            <div className="flex flex-wrap items-center gap-3 self-start lg:self-auto">
              <div className="px-3.5 py-2 rounded-xl text-left border" style={glass}>
                <span className="text-[10px] uppercase font-bold text-[#bfdbfe] block">Plano Ativo</span>
                <span className="font-headline text-base font-extrabold text-white">{overview?.planName ?? 'Sem plano'}</span>
              </div>
              {hasData && (
                <div className="px-3.5 py-2 rounded-xl text-left border" style={glass}>
                  <span className="text-[10px] uppercase font-bold text-[#bfdbfe] block">Total Geral</span>
                  <span className="font-headline text-base font-extrabold text-white">{num(totalAllStudents)} Alunos     |          {totalAllClasses} Turmas</span>
                </div>
              )}
              <div className="flex gap-2">
                {onCancel && (
                  <button type="button" onClick={onCancel} className="picker-hdr-btn">
                    Voltar
                  </button>
                )}
                <button type="button" onClick={onLogout} className="picker-hdr-btn">
                  <span className="material-symbols-outlined text-[18px]">logout</span>Sair
                </button>
              </div>
            </div>
          </div>
        </div>

        {error && <Notice tone="error">{error}</Notice>}

        {loading && <div className="text-sm text-slate-500">A carregar os indicadores…</div>}
        {!loading && !hasData && (
          <Notice tone="warn">
            Os indicadores estão indisponíveis no momento...
          </Notice>
        )}

        {hasData && (
          <>
            {/* Filtro geral */}
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-white border border-slate-200 rounded-xl px-4 py-3">
              <div className="flex items-center gap-2 text-sm font-bold text-[#0b1f3a]">
                <span className="material-symbols-outlined text-[20px]">filter_alt</span>
                Filtro
              </div>
              <select
                aria-label="Filtrar todos os cartões por escola"
                className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm font-semibold text-slate-700 focus:outline-none focus:ring-2 focus:ring-[#0b1f3a]/30 sm:min-w-[320px]"
                value={topFilter}
                onChange={(e) => { if (e.target.value !== 'misto') setAll(e.target.value); }}
              >
                {topFilter === 'misto' && <option value="misto">Filtros individuais por cartão</option>}
                <option value={ALL}>Geral</option>
                {schoolOptions}
              </select>
            </div>

            {/* Cartões do Dashboard — valores gerais, com filtro por escola */}
            <section>
              <h2 className="text-xs font-bold uppercase tracking-wider text-slate-500 mb-3">Indicadores</h2>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                <div className="kpi-card kpi-blue p-3 flex flex-col justify-between">
                  <div className="flex items-start justify-between">
                    <div>
                      <span className="kpi-label text-[10px] uppercase tracking-wider font-bold">Total de Alunos</span>
                      <div className="kpi-value font-headline text-xl font-extrabold mt-0.5">{num(totalStudents)}</div>
                    </div>
                    <div className="kpi-icon w-8 h-8"><span className="material-symbols-outlined text-[18px]">school</span></div>
                  </div>
                  {filterSelect(fStudents, setFStudents, 'Filtrar alunos por escola')}
                  <div className="kpi-foot mt-2 pt-2 border-t flex items-center justify-between text-xs">
                    <span className="kpi-chip kpi-tag-green px-2 py-0.5 font-bold font-mono text-[11px]">{num(regularStudents)} Regulares</span>
                    <span className="kpi-sub kpi-text-red font-bold">{num(debtStudents)} em Mora</span>
                  </div>
                </div>

                <div className="kpi-card kpi-violet p-3 flex flex-col justify-between">
                  <div className="flex items-start justify-between">
                    <div>
                      <span className="kpi-label text-[10px] uppercase tracking-wider font-bold">Corpo Docente</span>
                      <div className="kpi-value font-headline text-xl font-extrabold mt-0.5">{num(totalTeachers)}</div>
                    </div>
                    <div className="kpi-icon w-8 h-8"><span className="material-symbols-outlined text-[18px]">badge</span></div>
                  </div>
                  {filterSelect(fTeachers, setFTeachers, 'Filtrar docentes por escola')}
                  <div className="kpi-foot mt-2 pt-2 border-t flex items-center justify-between text-xs">
                    <span className="kpi-sub font-medium">{totalDepartments || 1} Departamentos</span>
                    <span className="kpi-chip px-2 py-0.5 font-bold text-[11px]">{totalClasses} Turmas</span>
                  </div>
                </div>

                <div className="kpi-card kpi-amber p-3 flex flex-col justify-between">
                  <div className="flex items-start justify-between">
                    <div>
                      <span className="kpi-label text-[10px] uppercase tracking-wider font-bold">Assiduidade Geral</span>
                      <div className="kpi-value font-headline text-xl font-extrabold mt-0.5">{attRate}%</div>
                    </div>
                    <div className="kpi-icon w-8 h-8"><span className="material-symbols-outlined text-[18px]">fact_check</span></div>
                  </div>
                  {filterSelect(fAttendance, setFAttendance, 'Filtrar assiduidade por escola')}
                  <div className="kpi-foot mt-2 pt-2 border-t flex items-center justify-between text-xs">
                    <span className="kpi-sub">{num(attStudents)} alunos avaliados</span>
                    <span className="kpi-chip kpi-tag-red px-2 py-0.5 font-bold text-[11px]">{num(attAbsences)} faltas totais</span>
                  </div>
                </div>

                <div className="kpi-card kpi-green p-3 flex flex-col justify-between">
                  <div className="flex items-start justify-between">
                    <div>
                      <span className="kpi-label text-[10px] uppercase tracking-wider font-bold">Cobrança Registada</span>
                      <div className="kpi-value font-headline text-2xl font-extrabold mt-0.5">
                        {Math.round(collected).toLocaleString('pt-PT')} <span className="kpi-unit text-xs font-bold">Kz</span>
                      </div>
                    </div>
                    <div className="kpi-icon w-8 h-8"><span className="material-symbols-outlined text-[18px]">payments</span></div>
                  </div>
                  {filterSelect(fCollection, setFCollection, 'Filtrar cobrança por escola')}
                  <div className="kpi-foot mt-2 pt-2 border-t flex items-center justify-between text-xs">
                    <span className="kpi-chip kpi-tag-green px-2 py-0.5 font-bold text-[11px]">{collectedPct}% cobrado</span>
                    <span className="kpi-sub kpi-text-red font-bold">{num(pendingInv)} pendentes</span>
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-4">
                <div className={`kpi-card ${saldo < 0 ? 'kpi-red' : 'kpi-cyan'} p-3 flex flex-col justify-between`}>
                  <div className="flex items-start justify-between">
                    <div>
                      <span className="kpi-label text-[10px] uppercase tracking-wider font-bold">Saldo na Conta da Instituição</span>
                      <div className="kpi-value font-headline text-2xl font-extrabold mt-0.5">
                        {Math.round(saldo).toLocaleString('pt-PT')} <span className="kpi-unit text-xs font-bold">Kz</span>
                      </div>
                      <span className="kpi-sub text-[11px]">Entradas − Saídas</span>
                    </div>
                    <div className="kpi-icon w-8 h-8"><span className="material-symbols-outlined text-[18px]">account_balance_wallet</span></div>
                  </div>
                  {filterSelect(fBalance, setFBalance, 'Filtrar saldo por escola')}
                  <div className="kpi-foot mt-2 pt-2 border-t flex items-center justify-between text-xs">
                    <span className="kpi-chip kpi-tag-green px-2 py-0.5 font-bold text-[11px]">Entradas {kz(entradas)}</span>
                    <span className="kpi-sub kpi-text-red font-bold">Saídas {kz(saidas)}</span>
                  </div>
                </div>

                <div className="kpi-card kpi-red p-3 flex flex-col justify-between">
                  <div className="flex items-start justify-between">
                    <div>
                      <span className="kpi-label text-[10px] uppercase tracking-wider font-bold">Total de Despesas</span>
                      <div className="kpi-value font-headline text-2xl font-extrabold mt-0.5">
                        {Math.round(expTotal).toLocaleString('pt-PT')} <span className="kpi-unit text-xs font-bold">Kz</span>
                      </div>
                      <span className="kpi-sub text-[11px]">Gastos pagos, incluindo a folha de pagamento</span>
                    </div>
                    <div className="kpi-icon w-8 h-8"><span className="material-symbols-outlined text-[18px]">receipt_long</span></div>
                  </div>
                  {filterSelect(fExpenses, setFExpenses, 'Filtrar despesas por escola')}
                  <div className="kpi-foot mt-2 pt-2 border-t flex items-center justify-between text-xs">
                    <span className="kpi-sub">{expCount} {expCount === 1 ? 'pagamento' : 'pagamentos'}</span>
                    <span className="kpi-sub font-bold">A pagar: {kz(payables)}</span>
                  </div>
                </div>
              </div>
            </section>

            {/* Ocupação do plano único */}
            <section>
              <div className="flex flex-wrap items-end justify-between gap-2 mb-3">
                <h2 className="text-xs font-bold uppercase tracking-wider text-slate-500">Armazenamento</h2>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                {occupationCard('students', 'Alunos no plano', 'school', 'kpi-blue', uStudents, setUStudents, num)}
                {occupationCard('users', 'Utilizadores no plano', 'group', 'kpi-violet', uUsers, setUUsers, num)}
                {occupationCard('storageBytes', 'Armazenamento no plano', 'database', 'kpi-cyan', uStorage, setUStorage, fmtBytes)}
              </div>

              {/* Escolas: ocupação do plano + entrar */}
              {entryTable()}
            </section>
          </>
        )}

        {/* Sem dados do grupo (falha de rede): a mesma tabela, para nunca ficar sem forma de entrar */}
        {!hasData && !loading && (mother || branches.length > 0) && <section>{entryTable()}</section>}
      </div>
    </div>
  );
};
