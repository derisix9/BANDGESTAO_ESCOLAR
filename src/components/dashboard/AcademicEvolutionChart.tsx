import React, { useMemo } from 'react';
import {
  ResponsiveContainer,
  ComposedChart,
  Bar,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend
} from 'recharts';
import { SchoolDatabase } from '../../types';

interface AcademicEvolutionChartProps {
  db: SchoolDatabase;
  onNavigateToPautas?: () => void;
}

export const AcademicEvolutionChart: React.FC<AcademicEvolutionChartProps> = ({
  db,
  onNavigateToPautas
}) => {
  // 1. Processar médias reais e taxas de aprovação dos 3 trimestres
  const trimesterAcademicData = useMemo(() => {
    const students = db.students || [];
    const totalStudents = Math.max(1, students.length);

    // Calcular estatísticas reais do 1º Trimestre
    let t1Grades: number[] = [];
    students.forEach((s) => {
      if (s.trimesterGrades && s.trimesterGrades.length > 0) {
        s.trimesterGrades.forEach((tg) => {
          if (typeof tg.mt1 === 'number' && tg.mt1 > 0) {
            t1Grades.push(tg.mt1);
          }
        });
      } else if (typeof s.currentAverage === 'number' && s.currentAverage > 0) {
        t1Grades.push(s.currentAverage);
      }
    });

    const avgT1 =
      t1Grades.length > 0
        ? Math.round((t1Grades.reduce((a, b) => a + b, 0) / t1Grades.length) * 10) / 10
        : 0;
    const posT1 = t1Grades.filter((g) => g >= 9.5).length;
    const approvalRateT1 =
      t1Grades.length > 0 ? Math.round((posT1 / t1Grades.length) * 100) : 0;

    // Calcular estatísticas reais do 2º Trimestre
    let t2Grades: number[] = [];
    students.forEach((s) => {
      if (s.trimesterGrades && s.trimesterGrades.length > 0) {
        s.trimesterGrades.forEach((tg) => {
          if (typeof tg.mt2 === 'number' && tg.mt2 > 0) {
            t2Grades.push(tg.mt2);
          }
        });
      }
    });

    const avgT2 =
      t2Grades.length > 0
        ? Math.round((t2Grades.reduce((a, b) => a + b, 0) / t2Grades.length) * 10) / 10
        : 0;
    const posT2 = t2Grades.filter((g) => g >= 9.5).length;
    const approvalRateT2 =
      t2Grades.length > 0 ? Math.round((posT2 / t2Grades.length) * 100) : 0;

    // Calcular estatísticas reais do 3º Trimestre / Projeção MFD
    let t3Grades: number[] = [];
    students.forEach((s) => {
      if (s.trimesterGrades && s.trimesterGrades.length > 0) {
        s.trimesterGrades.forEach((tg) => {
          if (typeof tg.mt3 === 'number' && tg.mt3 > 0) {
            t3Grades.push(tg.mt3);
          }
        });
      }
    });

    const avgT3 =
      t3Grades.length > 0
        ? Math.round((t3Grades.reduce((a, b) => a + b, 0) / t3Grades.length) * 10) / 10
        : 0;
    const posT3 = t3Grades.filter((g) => g >= 9.5).length;
    const approvalRateT3 =
      t3Grades.length > 0 ? Math.round((posT3 / t3Grades.length) * 100) : 0;

    return [
      {
        trimestre: '1.º Trimestre',
        nomeCurto: '1.º Trim',
        mediaValores: avgT1,
        taxaAprovacao: approvalRateT1,
        alunosPositivos: Math.round((approvalRateT1 / 100) * totalStudents),
        alunosRecuperacao: Math.round(((100 - approvalRateT1) / 100) * totalStudents),
        qualitativo: avgT1 >= 14 ? 'Muito Bom' : (avgT1 >= 12 ? 'Bom' : 'Suficiente'),
        totalNotas: t1Grades.length,
        estado: 'Pautas Homologadas'
      },
      {
        trimestre: '2.º Trimestre',
        nomeCurto: '2.º Trim',
        mediaValores: avgT2,
        taxaAprovacao: approvalRateT2,
        alunosPositivos: Math.round((approvalRateT2 / 100) * totalStudents),
        alunosRecuperacao: Math.round(((100 - approvalRateT2) / 100) * totalStudents),
        qualitativo: avgT2 >= 14 ? 'Muito Bom' : (avgT2 >= 12 ? 'Bom' : 'Suficiente'),
        totalNotas: t2Grades.length,
        estado: 'Em Avaliação Contínua'
      },
      {
        trimestre: '3.º Trimestre',
        nomeCurto: '3.º Trim',
        mediaValores: avgT3,
        taxaAprovacao: approvalRateT3,
        alunosPositivos: Math.round((approvalRateT3 / 100) * totalStudents),
        alunosRecuperacao: Math.round(((100 - approvalRateT3) / 100) * totalStudents),
        qualitativo: avgT3 >= 14 ? 'Muito Bom' : (avgT3 >= 12 ? 'Bom' : 'Suficiente'),
        totalNotas: t3Grades.length,
        estado: 'Projeção / Pauta Final'
      }
    ];
  }, [db.students, db.miniPautasStore]);

  // Custom Academic Tooltip Interativo
  const CustomAcademicTooltip = ({ active, payload }: any) => {
    if (active && payload && payload.length) {
      const data = payload[0].payload;
      return (
        <div className="dashboard-chart-tooltip">
          <div className="dashboard-chart-tooltip-title flex items-center justify-between">
            <span className="font-bold text-[#0b1f3a] text-sm">{data.trimestre}</span>
            <span className="font-mono text-[10px] font-bold px-2 py-0.5 rounded bg-blue-50 text-[#0b1f3a] border border-blue-200">
              {data.estado}
            </span>
          </div>

          <div className="space-y-2 font-mono">
            <div className="flex items-center justify-between">
              <span className="text-slate-500 font-sans">Média Escolar Geral:</span>
              <span className="font-bold text-[#0b1f3a] text-[13px]">
                {data.mediaValores} / 20 valores
              </span>
            </div>

            <div className="flex items-center justify-between">
              <span className="text-slate-500 font-sans">Menção Qualitativa:</span>
              <span className="font-bold text-emerald-700 font-sans">
                {data.qualitativo}
              </span>
            </div>

            <div className="flex items-center justify-between">
              <span className="text-slate-500 font-sans">Taxa de Aproveitamento:</span>
              <span className="font-bold text-[#059669]">
                {data.taxaAprovacao}%
              </span>
            </div>

            <div className="pt-2 border-t border-slate-100 flex items-center justify-between text-[11px]">
              <span className="text-slate-500 font-sans">Aprovados / Em Risco:</span>
              <span className="font-bold text-slate-800 font-mono">
                {data.alunosPositivos} aptos • {data.alunosRecuperacao} apoio
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
      {/* Header */}
      <div className="dashboard-chart-header">
        <div>
          <div className="flex items-center gap-2">
            <span className="dashboard-chart-kicker">
              Rendimento Curricular e Pautas
            </span>
            <span className="dashboard-chart-badge">
              Escala de 0–20 Valores
            </span>
          </div>
          <h2 className="dashboard-chart-title">
            EVOLUÇÃO ACADÉMICA
          </h2>
        </div>

        {onNavigateToPautas && (
          <button
            type="button"
            onClick={onNavigateToPautas}
            className="dashboard-chart-action self-start sm:self-auto"
          >
            <span>Ver Pautas</span>
            <span className="material-symbols-outlined text-[16px]">arrow_forward</span>
          </button>
        )}
      </div>

      {/* Mini Resumo das Médias dos 3 Trimestres */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5 mb-5">
        {trimesterAcademicData.map((item) => (
          <div key={item.trimestre} data-card-hl data-stat-icon="school" className="dashboard-chart-summary dashboard-chart-summary--blue">
            <div className="flex items-center justify-between">
              <span className="dashboard-chart-summary-label">{item.nomeCurto}</span>
              {item.totalNotas > 0 ? (
                <span className="dashboard-chart-microbadge dashboard-chart-microbadge--green">
                  {item.taxaAprovacao}% aproveitamento
                </span>
              ) : (
                <span className="dashboard-chart-microbadge">
                  Sem notas
                </span>
              )}
            </div>
            <div className="dashboard-chart-summary-value">
              {item.totalNotas > 0 ? (
                <>
                  {item.mediaValores}{' '}
                  <span className="dashboard-chart-value-unit">/ 20 valores</span>
                </>
              ) : (
                <span className="text-sm font-bold">—</span>
              )}
            </div>
          </div>
        ))}
      </div>

      {/* Gráfico Composed Chart: Barras de Média + Linha de % de Aprovação */}
      <div className="dashboard-chart-plot">
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart
            data={trimesterAcademicData}
            margin={{ top: 14, right: 22, left: 2, bottom: 4 }}
          >
            <CartesianGrid strokeDasharray="4 5" vertical={false} stroke="#e7edf5" />
            <XAxis
              dataKey="nomeCurto"
              tick={{ fontSize: 10, fill: '#71839a' }}
              axisLine={false}
              tickLine={false}
              tickMargin={10}
            />
            {/* Eixo Y da Esquerda: Média Escolar (0 a 20) */}
            <YAxis
              yAxisId="left"
              domain={[0, 20]}
              tick={{ fontSize: 10, fill: '#71839a' }}
              axisLine={false}
              tickLine={false}
              tickMargin={8}
              width={38}
              tickFormatter={(v) => `${v}v`}
            />
            {/* Eixo Y da Direita: Taxa de Aprovação (0 a 100%) */}
            <YAxis
              yAxisId="right"
              orientation="right"
              domain={[0, 100]}
              tick={{ fontSize: 10, fill: '#0b9872' }}
              axisLine={false}
              tickLine={false}
              tickMargin={8}
              width={42}
              tickFormatter={(v) => `${v}%`}
            />
            <Tooltip content={<CustomAcademicTooltip />} cursor={{ fill: 'rgba(37, 99, 235, 0.055)' }} />
            <Legend
              wrapperStyle={{ paddingTop: 14, fontSize: 10 }}
              iconType="circle"
              formatter={(val) => (val === 'mediaValores' ? 'Média Curricular (0-20 val)' : 'Taxa de Aproveitamento (%)')}
            />
            <defs>
              <linearGradient id="academicAverageGradient" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#2b67b1" />
                <stop offset="100%" stopColor="#123d70" />
              </linearGradient>
            </defs>
            <Bar
              yAxisId="left"
              dataKey="mediaValores"
              name="mediaValores"
              fill="url(#academicAverageGradient)"
              radius={[7, 7, 2, 2]}
              maxBarSize={46}
            />
            <Line
              yAxisId="right"
              type="monotone"
              dataKey="taxaAprovacao"
              name="taxaAprovacao"
              stroke="#059669"
              strokeWidth={3.5}
              dot={{ r: 5, fill: '#0b9872', stroke: '#ffffff', strokeWidth: 2 }}
              activeDot={{ r: 7, fill: '#0b9872', stroke: '#ffffff', strokeWidth: 2 }}
            />
          </ComposedChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
};
