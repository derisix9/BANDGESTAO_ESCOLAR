import React, { useMemo } from 'react';
import {
  ResponsiveContainer,
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend
} from 'recharts';
import { SchoolDatabase } from '../../types';

interface FinancialEvolutionChartProps {
  db: SchoolDatabase;
  onNavigateToPropinas?: () => void;
}

export const FinancialEvolutionChart: React.FC<FinancialEvolutionChartProps> = ({
  db,
  onNavigateToPropinas
}) => {
  // Ano letivo em vigor, tal como definido em Configurações > Ano Letivo (ex.: "2026/2027").
  // Nunca anos fixos no código: o primeiro ano cobre Setembro–Dezembro e o segundo
  // Janeiro–Julho, conforme o calendário escolar angolano.
  const academicYearLabel = (db.settings?.currentAcademicYear || '').trim();

  const { firstYear, secondYear } = useMemo(() => {
    const years = (academicYearLabel.match(/\d{4}/g) || []).map(Number);
    if (years.length >= 2) {
      return { firstYear: years[0], secondYear: years[1] };
    }
    if (years.length === 1) {
      return { firstYear: years[0], secondYear: years[0] + 1 };
    }
    const now = new Date();
    // Antes de Setembro ainda se está na segunda metade do ano letivo anterior.
    const start = now.getMonth() >= 8 ? now.getFullYear() : now.getFullYear() - 1;
    return { firstYear: start, secondYear: start + 1 };
  }, [academicYearLabel]);

  const academicYearDisplay = academicYearLabel || `${firstYear}/${secondYear}`;

  // 1. Processar dados reais de faturação e liquidação de mensalidades / propinas por mês
  const monthlyFinancialData = useMemo(() => {
    const months = [
      { key: 'Set', label: 'Setembro', year: firstYear },
      { key: 'Out', label: 'Outubro', year: firstYear },
      { key: 'Nov', label: 'Novembro', year: firstYear },
      { key: 'Dez', label: 'Dezembro', year: firstYear },
      { key: 'Jan', label: 'Janeiro', year: secondYear },
      { key: 'Fev', label: 'Fevereiro', year: secondYear },
      { key: 'Mar', label: 'Março', year: secondYear },
      { key: 'Abr', label: 'Abril', year: secondYear },
      { key: 'Mai', label: 'Maio', year: secondYear },
      { key: 'Jun', label: 'Junho', year: secondYear },
      { key: 'Jul', label: 'Julho', year: secondYear }
    ];

    const invoices = db.invoices || [];

    return months.map((m) => {
      // Filtrar faturas que correspondem a este período — apenas dados reais da base de dados.
      const periodInvoices = invoices.filter((inv) => {
        const p = (inv.period || '').toLowerCase();
        return p.includes(m.label.toLowerCase()) || p.includes(m.key.toLowerCase());
      });

      const faturadoKz = periodInvoices.reduce((acc, inv) => acc + (inv.totalAmountKz || 0), 0);
      const cobradoKz = periodInvoices
        .filter((inv) => inv.status === 'pago')
        .reduce((acc, inv) => acc + (inv.totalAmountKz || 0), 0);
      const recibosCount = periodInvoices.filter((inv) => inv.status === 'pago').length;

      // Sem faturas emitidas neste período: o mês fica a zero. Nunca se projeta ou
      // inventa uma taxa de cobrança "realista" para um período sem dados reais.
      const pendenteKz = Math.max(0, faturadoKz - cobradoKz);
      const taxaCobranca = faturadoKz > 0 ? Math.round((cobradoKz / faturadoKz) * 100) : 0;

      return {
        mes: m.key,
        mesCompleto: `${m.label} de ${m.year}`,
        faturado: faturadoKz,
        cobrado: cobradoKz,
        pendente: pendenteKz,
        taxaCobranca,
        recibos: recibosCount
      };
    });
  }, [db.invoices, db.students, firstYear, secondYear]);

  // Totais consolidados
  const totals = useMemo(() => {
    const totalFaturado = monthlyFinancialData.reduce((acc, curr) => acc + curr.faturado, 0);
    const totalCobrado = monthlyFinancialData.reduce((acc, curr) => acc + curr.cobrado, 0);
    const totalPendente = totalFaturado - totalCobrado;
    const taxaGeral = totalFaturado > 0 ? Math.round((totalCobrado / totalFaturado) * 100) : 0;

    return {
      totalFaturado,
      totalCobrado,
      totalPendente,
      taxaGeral
    };
  }, [monthlyFinancialData]);

  // Custom Tooltip Financeiro Interativo com Hover Detalhado
  const CustomFinancialTooltip = ({ active, payload, label }: any) => {
    if (active && payload && payload.length) {
      const data = payload[0].payload;
      return (
        <div className="dashboard-chart-tooltip">
          <div className="dashboard-chart-tooltip-title flex items-center justify-between">
            <span className="font-bold text-[#0b1f3a] text-sm">{data.mesCompleto}</span>
            <span className="font-mono text-[10px] font-bold px-2 py-0.5 rounded bg-emerald-50 text-emerald-800 border border-emerald-200">
              {data.taxaCobranca}% Cobrado
            </span>
          </div>

          <div className="space-y-2 font-mono">
            <div className="flex items-center justify-between">
              <span className="text-slate-500 font-sans">Cobrança Realizada:</span>
              <span className="font-bold text-emerald-700">
                {data.cobrado.toLocaleString()} Kz
              </span>
            </div>

            <div className="flex items-center justify-between">
              <span className="text-slate-500 font-sans">Faturação Emitida:</span>
              <span className="font-bold text-[#0b1f3a]">
                {data.faturado.toLocaleString()} Kz
              </span>
            </div>

            <div className="flex items-center justify-between">
              <span className="text-slate-500 font-sans">Saldo em Aberto:</span>
              <span className="font-bold text-[#7a0c0c]">
                {data.pendente.toLocaleString()} Kz
              </span>
            </div>

            <div className="pt-2 border-t border-slate-100 flex items-center justify-between text-[11px]">
              <span className="text-slate-500 font-sans">Recibos Emitidos:</span>
              <span className="font-bold text-slate-800 font-mono">
                {data.recibos} recibos
              </span>
            </div>
          </div>
        </div>
      );
    }
    return null;
  };

  return (
    <div className="dashboard-chart-panel">
      {/* Top Header */}
      <div className="dashboard-chart-header">
        <div>
          <div className="flex items-center gap-2">
            <span className="dashboard-chart-kicker">
              Rendimento Financeiro e Faturas
            </span>
            <span className="dashboard-chart-badge dashboard-chart-badge--green">
              AOA
            </span>
            <span className="dashboard-chart-badge">
              Ano Letivo {academicYearDisplay}
            </span>
          </div>
          <h2 className="dashboard-chart-title">
            EVOLUÇÃO FINANCEIRA
          </h2>
        </div>

        {onNavigateToPropinas && (
          <button
            type="button"
            onClick={onNavigateToPropinas}
            className="dashboard-chart-action self-start sm:self-auto"
          >
            <span>Ver Faturas</span>
            <span className="material-symbols-outlined text-[16px]">arrow_forward</span>
          </button>
        )}
      </div>

      {/* KPI Cards Financeiros Sintéticos */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-5">
        <div data-card-hl data-stat-icon="payments" className="dashboard-chart-summary dashboard-chart-summary--green">
          <span className="dashboard-chart-summary-label">
            Total Cobrado no Ano Letivo {academicYearDisplay}
          </span>
          <div className="dashboard-chart-summary-value">
            {totals.totalCobrado.toLocaleString()}{' '}
            <span className="dashboard-chart-value-unit">Kz</span>
          </div>
        </div>

        <div data-card-hl data-stat-icon="receipt_long" className="dashboard-chart-summary dashboard-chart-summary--blue">
          <span className="dashboard-chart-summary-label">
            Faturação Curricular Prevista
          </span>
          <div className="dashboard-chart-summary-value">
            {totals.totalFaturado.toLocaleString()}{' '}
            <span className="dashboard-chart-value-unit">Kz</span>
          </div>
        </div>

        <div data-card-hl data-stat-icon="insights" className="dashboard-chart-summary dashboard-chart-summary--red">
          <span className="dashboard-chart-summary-label">
            Eficácia Global de Cobrança
          </span>
          <div className="dashboard-chart-summary-value">
            <span>{totals.taxaGeral}%</span>
            <span className="dashboard-chart-value-unit">
              {totals.totalPendente.toLocaleString()} Kz em mora
            </span>
          </div>
        </div>
      </div>

      {/* Gráfico Recharts Interativo de Evolução Financeira */}
      <div className="dashboard-chart-plot">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart
            data={monthlyFinancialData}
            margin={{ top: 14, right: 18, left: 4, bottom: 4 }}
          >
            <defs>
              <linearGradient id="colorCobrado" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="#059669" stopOpacity={0.4} />
                <stop offset="95%" stopColor="#059669" stopOpacity={0.0} />
              </linearGradient>
              <linearGradient id="colorFaturado" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="#0b1f3a" stopOpacity={0.25} />
                <stop offset="95%" stopColor="#0b1f3a" stopOpacity={0.0} />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="4 5" vertical={false} stroke="#e7edf5" />
            <XAxis
              dataKey="mes"
              tick={{ fontSize: 10, fill: '#71839a' }}
              axisLine={false}
              tickLine={false}
              tickMargin={10}
              minTickGap={8}
            />
            <YAxis
              tick={{ fontSize: 10, fill: '#71839a' }}
              axisLine={false}
              tickLine={false}
              tickMargin={8}
              width={48}
              tickFormatter={(v) => `${(v / 1000000).toFixed(1)}M`}
            />
            <Tooltip content={<CustomFinancialTooltip />} cursor={{ stroke: '#a9bdd4', strokeDasharray: '4 4' }} />
            <Legend
              wrapperStyle={{ paddingTop: 14, fontSize: 10 }}
              iconType="circle"
              formatter={(value) => (value === 'cobrado' ? 'Cobrança Realizada (Kz)' : 'Faturação Prevista (Kz)')}
            />
            <Area
              type="monotone"
              dataKey="faturado"
              stroke="#0b1f3a"
              strokeWidth={2.5}
              fillOpacity={1}
              fill="url(#colorFaturado)"
              activeDot={{ r: 5, fill: '#173d6a', stroke: '#fff', strokeWidth: 2 }}
              name="faturado"
            />
            <Area
              type="monotone"
              dataKey="cobrado"
              stroke="#059669"
              strokeWidth={3}
              fillOpacity={1}
              fill="url(#colorCobrado)"
              activeDot={{ r: 6, fill: '#059669', stroke: '#fff', strokeWidth: 2 }}
              name="cobrado"
            />
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
};
