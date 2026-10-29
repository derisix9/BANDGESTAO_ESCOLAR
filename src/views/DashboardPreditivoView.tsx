import React, { useMemo, useState } from 'react';
import { SchoolDatabase, UserRole } from '../types';
import { getFallbackAcademicYear } from '../utils/academicYear';
import { TablePagination, usePagedList } from '../components/TablePagination';

interface DashboardPreditivoViewProps {
  db: SchoolDatabase;
  currentUserRole: UserRole;
}

type RiskLevel = 'alto' | 'medio' | 'baixo';

const riskBadge: Record<RiskLevel, { label: string; tone: string }> = {
  alto: { label: 'Risco Alto', tone: 'bg-red-50 text-red-700' },
  medio: { label: 'Risco Médio', tone: 'bg-amber-50 text-amber-700' },
  baixo: { label: 'Risco Baixo', tone: 'bg-emerald-50 text-emerald-700' }
};

function Badge({ tone, children }: { tone: string; children: React.ReactNode }) {
  return <span className={`px-2 py-0.5 rounded text-[10px] font-bold whitespace-nowrap ${tone}`}>{children}</span>;
}

function KpiGrid({ items }: { items: Array<{ label: string; value: React.ReactNode; icon: string; tone?: 'default' | 'warn' | 'danger' }> }) {
  return (
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
      {items.map((k) => {
        const tone =
          k.tone === 'danger' ? 'bg-red-50 text-red-700' : k.tone === 'warn' ? 'bg-amber-50 text-amber-700' : 'bg-slate-100 text-[#0b1f3a]';
        return (
          <div key={k.label} className="bg-white border border-slate-200 rounded-2xl p-4 flex items-center gap-3">
            <div className={`w-10 h-10 flex items-center justify-center rounded-lg shrink-0 ${tone}`}>
              <span className="material-symbols-outlined text-[22px]">{k.icon}</span>
            </div>
            <div className="min-w-0">
              <div className="font-mono text-xl font-extrabold text-[#0b1f3a] leading-none truncate">{k.value}</div>
              <div className="text-[11px] text-slate-500 font-semibold mt-1">{k.label}</div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

function EmptyState({ icon, text }: { icon: string; text: string }) {
  return (
    <div className="flex flex-col items-center justify-center py-12 text-slate-400 gap-2">
      <span className="material-symbols-outlined text-[36px]">{icon}</span>
      <p className="text-xs font-semibold">{text}</p>
    </div>
  );
}

/** Média simples de uma lista de números, ignorando valores inválidos. */
function avg(values: number[]): number | null {
  const valid = values.filter((v) => typeof v === 'number' && !Number.isNaN(v) && v > 0);
  if (valid.length === 0) return null;
  return valid.reduce((a, b) => a + b, 0) / valid.length;
}

export const DashboardPreditivoView: React.FC<DashboardPreditivoViewProps> = ({ db }) => {
  const [tab, setTab] = useState<'academico' | 'assiduidade' | 'financeiro'>('academico');
  const academicYear = db.settings?.currentAcademicYear || getFallbackAcademicYear();

  // ---------------------------------------------------------------------
  // 1. Risco académico — projeta a média final de cada turma a partir da
  // evolução MT1 → MT2 → MT3 já lançada nas mini-pautas / pautas trimestrais.
  // Esta é a MESMA base de dados do Relatório de Aproveitamento (subsecção 1),
  // mas aqui não mostramos o estado atual: calculamos a tendência entre
  // trimestres para antecipar turmas que arriscam terminar o ano abaixo da
  // média de transição (10 valores), antes do fecho do 3.º trimestre.
  // ---------------------------------------------------------------------
  const academicRisk = useMemo(() => {
    return (db.classes || []).map((cls) => {
      const students = (db.students || []).filter(
        (s) => String(s.classId) === String(cls.id) || s.className === cls.name
      );

      const mt1All: number[] = [];
      const mt2All: number[] = [];
      const mt3All: number[] = [];
      students.forEach((s) => {
        (s.trimesterGrades || []).forEach((r) => {
          if (r.mt1) mt1All.push(r.mt1);
          if (r.mt2) mt2All.push(r.mt2);
          if (r.mt3) mt3All.push(r.mt3);
        });
      });

      const m1 = avg(mt1All);
      const m2 = avg(mt2All);
      const m3 = avg(mt3All);

      // Tendência: usamos o par mais recente disponível.
      let trend: number | null = null;
      let base: number | null = null;
      if (m2 !== null && m3 !== null) {
        trend = m3 - m2;
        base = m3;
      } else if (m1 !== null && m2 !== null) {
        trend = m2 - m1;
        base = m2;
      } else {
        base = m1 ?? m2 ?? m3;
      }

      const projected = base !== null ? Math.min(20, Math.max(0, base + (trend || 0))) : null;

      let risk: RiskLevel = 'baixo';
      if (projected !== null) {
        if (projected < 10) risk = 'alto';
        else if (projected < 11.5 || (trend !== null && trend < -0.5)) risk = 'medio';
      }

      return {
        classId: cls.id,
        className: cls.name,
        studentCount: students.length,
        m1,
        m2,
        m3,
        trend,
        projected,
        risk,
        director: cls.headTeacherName || 'A designar'
      };
    });
  }, [db.classes, db.students]);
  const { page: pgAcademicRisk, setPage: setPgAcademicRisk, pageItems: visibleAcademicRisk } = usePagedList(academicRisk, [academicRisk.length]);

  const academicTotals = useMemo(() => {
    const comDados = academicRisk.filter((c) => c.projected !== null);
    const turmasRiscoAlto = academicRisk.filter((c) => c.risk === 'alto').length;
    const turmasTendenciaNegativa = academicRisk.filter((c) => c.trend !== null && c.trend < 0).length;
    const alunosEmTurmasDeRisco = academicRisk.filter((c) => c.risk !== 'baixo').reduce((acc, c) => acc + c.studentCount, 0);
    const taxaProjetada =
      comDados.length > 0
        ? Math.round((comDados.filter((c) => (c.projected || 0) >= 10).length / comDados.length) * 1000) / 10
        : null;
    return { turmasRiscoAlto, turmasTendenciaNegativa, alunosEmTurmasDeRisco, taxaProjetada };
  }, [academicRisk]);

  // ---------------------------------------------------------------------
  // 2. Risco de assiduidade/abandono — reaproveita as fichas de chamada já
  // usadas no Relatório de Assiduidade (subsecção 1), mas isola as turmas
  // cuja taxa de presença caiu abaixo de 80%, sinal preditivo de risco de
  // abandono escolar.
  // ---------------------------------------------------------------------
  const attendanceRisk = useMemo(() => {
    return (db.classes || []).map((cls) => {
      const sheets = (db.attendanceSheets || []).filter(
        (sheet) => String(sheet.classId) === String(cls.id) || sheet.className === cls.name
      );
      let present = 0;
      let total = 0;
      const perStudent: Record<string, { present: number; total: number }> = {};
      sheets.forEach((sheet) => {
        (sheet.students || []).forEach((st) => {
          total += 1;
          if (st.status === 'P') present += 1;
          if (!perStudent[st.studentId]) perStudent[st.studentId] = { present: 0, total: 0 };
          perStudent[st.studentId].total += 1;
          if (st.status === 'P') perStudent[st.studentId].present += 1;
        });
      });
      const rate = total > 0 ? Math.round((present / total) * 1000) / 10 : null;
      const atRiskStudents = Object.values(perStudent).filter((s) => s.total > 0 && (s.present / s.total) * 100 < 80).length;
      let risk: RiskLevel = 'baixo';
      if (rate !== null) {
        if (rate < 75) risk = 'alto';
        else if (rate < 85) risk = 'medio';
      }
      return { classId: cls.id, className: cls.name, rate, atRiskStudents, risk };
    });
  }, [db.classes, db.attendanceSheets]);
  const { page: pgAttendanceRisk, setPage: setPgAttendanceRisk, pageItems: visibleAttendanceRisk } = usePagedList(attendanceRisk, [attendanceRisk.length]);

  const attendanceTotals = useMemo(() => {
    const turmasRiscoAlto = attendanceRisk.filter((c) => c.risk === 'alto').length;
    const totalAlunosRisco = attendanceRisk.reduce((acc, c) => acc + c.atRiskStudents, 0);
    return { turmasRiscoAlto, totalAlunosRisco };
  }, [attendanceRisk]);

  // ---------------------------------------------------------------------
  // 3. Risco financeiro — reaproveita as faturas de propinas já usadas no
  // Balancete Financeiro (subsecção 1), agrupadas por turma, sinalizando as
  // turmas com maior proporção de valores em mora face ao previsto.
  // ---------------------------------------------------------------------
  const financialRisk = useMemo(() => {
    return (db.classes || []).map((cls) => {
      const students = (db.students || []).filter(
        (s) => String(s.classId) === String(cls.id) || s.className === cls.name
      );
      const studentIds = new Set(students.map((s) => String(s.id)));
      const invoices = (db.invoices || []).filter(
        (inv) => studentIds.has(String(inv.studentId)) || inv.className === cls.name
      );
      const cobrado = invoices
        .filter((inv) => inv.status === 'pago')
        .reduce((acc, inv) => acc + (inv.totalAmountKz || inv.totalPaidKz || 0), 0);
      const emMora = invoices
        .filter((inv) => inv.status === 'atraso' || inv.status === 'pendente')
        .reduce((acc, inv) => acc + (inv.totalAmountKz || 0), 0);
      const previsto = cobrado + emMora;
      const rate = previsto > 0 ? Math.round((emMora / previsto) * 1000) / 10 : null;
      let risk: RiskLevel = 'baixo';
      if (rate !== null) {
        if (rate > 30) risk = 'alto';
        else if (rate > 15) risk = 'medio';
      }
      return { classId: cls.id, className: cls.name, previsto, emMora, rate, risk, studentCount: students.length };
    });
  }, [db.classes, db.invoices]);
  const { page: pgFinancialRisk, setPage: setPgFinancialRisk, pageItems: visibleFinancialRisk } = usePagedList(financialRisk, [financialRisk.length]);

  const financialTotals = useMemo(() => {
    const turmasRiscoAlto = financialRisk.filter((c) => c.risk === 'alto').length;
    const totalEmMora = financialRisk.reduce((acc, c) => acc + c.emMora, 0);
    return { turmasRiscoAlto, totalEmMora };
  }, [financialRisk]);

  const fmtKz = (v: number) => `${v.toLocaleString('pt-PT')} Kz`;

  return (
    <div className="flex flex-col w-full gap-6 pb-12">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <span className="text-[11px] font-bold uppercase tracking-widest text-slate-500">RELATÓRIOS</span>
            <span className="w-1.5 h-1.5 rounded-full bg-[#0b1f3a]" />
            <span className="text-xs font-semibold text-[#0b1f3a]">AUDITORIA ESCOLAR</span>
          </div>
          <h1 className="font-headline text-2xl lg:text-3xl font-extrabold text-[#0b1f3a] tracking-tight">ANÁLISE ESCOLAR</h1>
          <p className="text-xs text-slate-500 mt-0.5 max-w-3xl">
            Ano Letivo {academicYear} · Antecipação de risco académico, de assiduidade e financeiro, calculada a partir da evolução dos
            dados já lançados no sistema.
          </p>
        </div>
      </div>

      <KpiGrid
        items={[
          { label: 'Turmas c/ Risco Acad. Alto', value: academicTotals.turmasRiscoAlto, icon: 'trending_down', tone: academicTotals.turmasRiscoAlto > 0 ? 'danger' : 'default' },
          { label: 'Alunos em Turmas de Risco', value: academicTotals.alunosEmTurmasDeRisco, icon: 'groups', tone: 'warn' },
          { label: 'Taxa de Transição Projetada', value: academicTotals.taxaProjetada !== null ? `${academicTotals.taxaProjetada}%` : '—', icon: 'insights' },
          { label: 'Turmas c/ Risco de Abandono', value: attendanceTotals.turmasRiscoAlto, icon: 'event_busy', tone: attendanceTotals.turmasRiscoAlto > 0 ? 'danger' : 'default' }
        ]}
      />

      <div className="flex items-center gap-2 border-b border-slate-200 overflow-x-auto">
        {[
          { id: 'academico', label: 'Risco Académico', icon: 'school' },
          { id: 'assiduidade', label: 'Risco de Abandono', icon: 'event_busy' },
          { id: 'financeiro', label: 'Risco Financeiro', icon: 'payments' }
        ].map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id as typeof tab)}
            className={`px-4 py-2.5 text-xs font-bold flex items-center gap-1.5 border-b-2 -mb-px transition-colors ${
              tab === t.id ? 'border-[#0b1f3a] text-[#0b1f3a]' : 'border-transparent text-slate-400 hover:text-slate-600'
            }`}
          >
            <span className="material-symbols-outlined text-[16px]">{t.icon}</span>
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'academico' && (
        <div className="bg-white border border-slate-200 rounded-2xl overflow-hidden">
          {academicRisk.length === 0 ? (
            <EmptyState icon="school" text="Sem turmas com pautas lançadas para projetar tendência." />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead>
                  <tr className="bg-[#0b1f3a] text-white font-bold uppercase text-[10px] tracking-wider border-b border-slate-800">
                    <th className="py-3 px-4 text-white">Turma</th>
                    <th className="py-3 px-3 text-white">Diretor de Turma</th>
                    <th className="py-3 px-3 text-white">MT1</th>
                    <th className="py-3 px-3 text-white">MT2</th>
                    <th className="py-3 px-3 text-white">MT3</th>
                    <th className="py-3 px-3 text-white">Tendência</th>
                    <th className="py-3 px-3 text-white">Média Projetada</th>
                    <th className="py-3 px-4 text-white">Nível de Risco</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {visibleAcademicRisk.map((c) => (
                    <tr key={c.classId} className="hover:bg-slate-50 transition-colors">
                      <td className="py-3 px-4 font-bold text-[#0b1f3a]">{c.className}</td>
                      <td className="py-3 px-3 text-slate-600">{c.director}</td>
                      <td className="py-3 px-3 font-mono text-slate-600">{c.m1 !== null ? c.m1.toFixed(1) : '—'}</td>
                      <td className="py-3 px-3 font-mono text-slate-600">{c.m2 !== null ? c.m2.toFixed(1) : '—'}</td>
                      <td className="py-3 px-3 font-mono text-slate-600">{c.m3 !== null ? c.m3.toFixed(1) : '—'}</td>
                      <td className={`py-3 px-3 font-mono font-bold ${c.trend !== null && c.trend < 0 ? 'text-red-600' : 'text-emerald-600'}`}>
                        {c.trend !== null ? `${c.trend > 0 ? '+' : ''}${c.trend.toFixed(1)}` : '—'}
                      </td>
                      <td className="py-3 px-3 font-mono font-bold text-slate-800">{c.projected !== null ? c.projected.toFixed(1) : '—'}</td>
                      <td className="py-3 px-4">
                        <Badge tone={riskBadge[c.risk].tone}>{riskBadge[c.risk].label}</Badge>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <TablePagination total={academicRisk.length} page={pgAcademicRisk} onPageChange={setPgAcademicRisk} />
            </div>
          )}
        </div>
      )}

      {tab === 'assiduidade' && (
        <div className="bg-white border border-slate-200 rounded-2xl overflow-hidden">
          {attendanceRisk.length === 0 ? (
            <EmptyState icon="event_busy" text="Sem fichas de chamada registadas para calcular risco de abandono." />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead>
                  <tr className="bg-[#0b1f3a] text-white font-bold uppercase text-[10px] tracking-wider border-b border-slate-800">
                    <th className="py-3 px-4 text-white">Turma</th>
                    <th className="py-3 px-3 text-white">Taxa de Assiduidade</th>
                    <th className="py-3 px-3 text-white">Alunos Abaixo de 80%</th>
                    <th className="py-3 px-4 text-white">Nível de Risco</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {visibleAttendanceRisk.map((c) => (
                    <tr key={c.classId} className="hover:bg-slate-50 transition-colors">
                      <td className="py-3 px-4 font-bold text-[#0b1f3a]">{c.className}</td>
                      <td className="py-3 px-3 font-mono text-slate-600">{c.rate !== null ? `${c.rate}%` : '—'}</td>
                      <td className="py-3 px-3 font-mono text-slate-600">{c.atRiskStudents}</td>
                      <td className="py-3 px-4">
                        <Badge tone={riskBadge[c.risk].tone}>{riskBadge[c.risk].label}</Badge>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <TablePagination total={attendanceRisk.length} page={pgAttendanceRisk} onPageChange={setPgAttendanceRisk} />
            </div>
          )}
        </div>
      )}

      {tab === 'financeiro' && (
        <div className="bg-white border border-slate-200 rounded-2xl overflow-hidden">
          {financialRisk.length === 0 ? (
            <EmptyState icon="payments" text="Sem faturação suficiente para calcular risco financeiro por turma." />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead>
                  <tr className="bg-[#0b1f3a] text-white font-bold uppercase text-[10px] tracking-wider border-b border-slate-800">
                    <th className="py-3 px-4 text-white">Turma</th>
                    <th className="py-3 px-3 text-white">Previsto</th>
                    <th className="py-3 px-3 text-white">Em Mora</th>
                    <th className="py-3 px-3 text-white">% em Mora</th>
                    <th className="py-3 px-4 text-white">Nível de Risco</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {visibleFinancialRisk.map((c) => (
                    <tr key={c.classId} className="hover:bg-slate-50 transition-colors">
                      <td className="py-3 px-4 font-bold text-[#0b1f3a]">{c.className}</td>
                      <td className="py-3 px-3 font-mono text-slate-600">{fmtKz(c.previsto)}</td>
                      <td className="py-3 px-3 font-mono text-slate-600">{fmtKz(c.emMora)}</td>
                      <td className="py-3 px-3 font-mono text-slate-600">{c.rate !== null ? `${c.rate}%` : '—'}</td>
                      <td className="py-3 px-4">
                        <Badge tone={riskBadge[c.risk].tone}>{riskBadge[c.risk].label}</Badge>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <TablePagination total={financialRisk.length} page={pgFinancialRisk} onPageChange={setPgFinancialRisk} />
            </div>
          )}
        </div>
      )}
    </div>
  );
};
