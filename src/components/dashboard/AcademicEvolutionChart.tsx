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
        <div className="bg-white p-4 rounded-xl shadow-2xl border border-slate-200 text-xs min-w-[260px] z-50">
          <div className="border-b border-slate-100 pb-2 mb-2 flex items-center justify-between">
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
    <div className="bg-white rounded-2xl p-6 shadow-xs border border-slate-200">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-4">
        <div>
          <div className="flex items-center gap-2">
            <span className="text-[11px] font-bold uppercase tracking-wider text-slate-400">
              Rendimento Curricular e Pautas
            </span>
            <span className="px-2 py-0.5 rounded-md bg-blue-50 text-[#0b1f3a] font-mono text-[10px] font-extrabold border border-blue-100">
              Escala de 0–20 Valores
            </span>
          </div>
          <h2 className="font-headline text-lg font-bold text-[#0b1f3a] mt-0.5">
            EVOLUÇÃO ACADEMICA
          </h2>
        </div>

        {onNavigateToPautas && (
          <button
            type="button"
            onClick={onNavigateToPautas}
            className="text-xs font-bold text-[#0b1f3a] hover:text-[#7a0c0c] flex items-center gap-1 self-start sm:self-auto transition-colors"
          >
            <span>Ver Pautas</span>
            <span className="material-symbols-outlined text-[16px]">arrow_forward</span>
          </button>
        )}
      </div>

      {/* Mini Resumo das Médias dos 3 Trimestres */}
      <div className="grid grid-cols-3 gap-2.5 mb-4">
        {trimesterAcademicData.map((item) => (
          <div key={item.trimestre} className="p-3 rounded-xl bg-slate-50 border border-slate-100">
            <div className="flex items-center justify-between">
              <span className="text-[10px] font-bold text-slate-500 uppercase">{item.nomeCurto}</span>
              {item.totalNotas > 0 ? (
                <span className="text-[9px] font-bold text-emerald-700 bg-emerald-50 px-1.5 py-0.2 rounded border border-emerald-200">
                  {item.taxaAprovacao}%
                </span>
              ) : (
                <span className="text-[9px] font-bold text-slate-500 bg-slate-100 px-1.5 py-0.2 rounded border border-slate-200">
                  Sem notas
                </span>
              )}
            </div>
            <div className="font-headline text-base font-extrabold text-[#0b1f3a] mt-1">
              {item.totalNotas > 0 ? (
                <>
                  {item.mediaValores}{' '}
                  <span className="text-[10px] font-normal text-slate-400 font-mono">/ 20 val</span>
                </>
              ) : (
                <span className="text-sm font-bold text-slate-400">—</span>
              )}
            </div>
          </div>
        ))}
      </div>

      {/* Gráfico Composed Chart: Barras de Média + Linha de % de Aprovação */}
      <div className="w-full h-64">
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart
            data={trimesterAcademicData}
            margin={{ top: 10, right: 15, left: -10, bottom: 0 }}
          >
            <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
            <XAxis
              dataKey="nomeCurto"
              tick={{ fontSize: 11, fill: '#64748b' }}
              axisLine={{ stroke: '#e2e8f0' }}
              tickLine={false}
            />
            {/* Eixo Y da Esquerda: Média Escolar (0 a 20) */}
            <YAxis
              yAxisId="left"
              domain={[0, 20]}
              tick={{ fontSize: 10, fill: '#0b1f3a' }}
              axisLine={false}
              tickLine={false}
              tickFormatter={(v) => `${v}v`}
            />
            {/* Eixo Y da Direita: Taxa de Aprovação (0 a 100%) */}
            <YAxis
              yAxisId="right"
              orientation="right"
              domain={[60, 100]}
              tick={{ fontSize: 10, fill: '#059669' }}
              axisLine={false}
              tickLine={false}
              tickFormatter={(v) => `${v}%`}
            />
            <Tooltip content={<CustomAcademicTooltip />} cursor={{ fill: '#f8fafc' }} />
            <Legend
              wrapperStyle={{ paddingTop: 10, fontSize: 11 }}
              formatter={(val) => (val === 'mediaValores' ? 'Média Curricular (0-20 val)' : 'Taxa de Aproveitamento (%)')}
            />
            <Bar
              yAxisId="left"
              dataKey="mediaValores"
              name="mediaValores"
              fill="#0b1f3a"
              radius={[4, 4, 0, 0]}
              maxBarSize={42}
            />
            <Line
              yAxisId="right"
              type="monotone"
              dataKey="taxaAprovacao"
              name="taxaAprovacao"
              stroke="#059669"
              strokeWidth={3}
              dot={{ r: 5, fill: '#059669', stroke: '#ffffff', strokeWidth: 2 }}
            />
          </ComposedChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
};
