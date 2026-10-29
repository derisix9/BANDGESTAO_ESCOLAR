import React, { useState, useMemo } from 'react';
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend
} from 'recharts';
import { SchoolDatabase, EducationSubsystem } from '../../types';
import { getActiveSubsystems, getSubsystemForGrade } from '../../utils/educationSubsystems';

interface SubsystemsAttendanceChartProps {
  db: SchoolDatabase;
}

const SUBSYSTEM_COLORS = [
  '#0b1f3a', // Navy Blue
  '#1d4ed8', // Royal Blue
  '#059669', // Emerald
  '#7a0c0c', // Crimson Wine
  '#d97706'  // Amber / Gold
];

export const SubsystemsAttendanceChart: React.FC<SubsystemsAttendanceChartProps> = ({ db }) => {
  const [viewMode, setViewMode] = useState<'semana' | 'subsistema'>('semana');

  // 1. Obter dinamicamente os sub-sistemas ativos configurados na instituição
  const activeSubsystems: EducationSubsystem[] = useMemo(() => {
    return getActiveSubsystems(db.settings?.selectedSubsystems);
  }, [db.settings?.selectedSubsystems]);

  // 2. Calcular dados estatísticos reais de cada sub-sistema a partir do banco de dados
  const subsystemStats = useMemo(() => {
    return activeSubsystems.map((sub, index) => {
      const studentsInSub = (db.students || []).filter((s) => {
        const detected = getSubsystemForGrade(s.grade || '');
        if (detected) return detected.id === sub.id;
        const normCycle = (s.cycle || '').toLowerCase();
        return normCycle.includes(sub.shortName.toLowerCase()) || normCycle.includes(sub.name.toLowerCase());
      });

      const studentCount = studentsInSub.length;
      const avgAttendance =
        studentCount > 0
          ? Math.round(
              (studentsInSub.reduce((acc, s) => acc + (typeof s.attendanceRate === 'number' ? s.attendanceRate : 100), 0) /
                studentCount) *
                10
            ) / 10
          : null;

      const studentsWithGrade = studentsInSub.filter((s) => typeof s.currentAverage === 'number' && s.currentAverage > 0);
      const avgGrade =
        studentsWithGrade.length > 0
          ? Math.round((studentsWithGrade.reduce((acc, s) => acc + (s.currentAverage as number), 0) / studentsWithGrade.length) * 10) / 10
          : null;

      const classesInSub = (db.classes || []).filter((c) => {
        const detected = getSubsystemForGrade(c.grade || '');
        if (detected) return detected.id === sub.id;
        const normCycle = (c.cycle || '').toLowerCase();
        return normCycle.includes(sub.shortName.toLowerCase()) || normCycle.includes(sub.name.toLowerCase());
      }).length;

      return {
        id: sub.id,
        name: sub.name,
        shortName: sub.shortName,
        fullName: sub.fullName,
        icon: sub.icon,
        color: SUBSYSTEM_COLORS[index % SUBSYSTEM_COLORS.length],
        studentCount,
        classesCount: classesInSub,
        avgAttendance,
        avgGrade
      };
    });
  }, [activeSubsystems, db.students, db.classes]);

  // 3. Dados semanais REAIS: taxa de presença por dia da semana, calculada a partir das
  //    folhas de chamada (db.attendanceSheets) realmente registadas — nunca uma variação
  //    artificial aplicada sobre a média. Sem chamadas registadas nesse dia, o valor fica
  //    a null e o gráfico simplesmente não desenha ponto/barra para esse dia.
  const weeklyData = useMemo(() => {
    const days = [
      { key: 'Segunda', label: 'Segunda-feira', dow: 1 },
      { key: 'Terça', label: 'Terça-feira', dow: 2 },
      { key: 'Quarta', label: 'Quarta-feira', dow: 3 },
      { key: 'Quinta', label: 'Quinta-feira', dow: 4 },
      { key: 'Sexta', label: 'Sexta-feira', dow: 5 }
    ];

    const sheets = db.attendanceSheets || [];

    // Mapa classId -> subsystemId, para poder agregar cada folha de chamada ao sub-sistema certo.
    const classSubsystem: Record<string, string> = {};
    (db.classes || []).forEach((c) => {
      const detected = getSubsystemForGrade(c.grade || '');
      if (detected) {
        classSubsystem[String(c.id)] = detected.id;
        return;
      }
      const normCycle = (c.cycle || '').toLowerCase();
      const match = activeSubsystems.find(
        (sub) => normCycle.includes(sub.shortName.toLowerCase()) || normCycle.includes(sub.name.toLowerCase())
      );
      if (match) classSubsystem[String(c.id)] = match.id;
    });

    return days.map((d) => {
      const row: Record<string, any> = {
        dia: d.key,
        diaCompleto: d.label
      };

      subsystemStats.forEach((sub) => {
        const daySheets = sheets.filter((sheet) => {
          if (classSubsystem[String(sheet.classId)] !== sub.id) return false;
          const parsed = new Date(sheet.date);
          return !isNaN(parsed.getTime()) && parsed.getDay() === d.dow;
        });

        let presences = 0;
        let total = 0;
        daySheets.forEach((sheet) => {
          (sheet.students || []).forEach((st) => {
            total += 1;
            if (st.status === 'P' || st.status === 'A') presences += 1;
          });
        });

        const rate = total > 0 ? Math.round((presences / total) * 1000) / 10 : null;
        row[sub.id] = rate;
        row[`${sub.id}_alunos`] = total > 0 ? presences : 0;
        row[`${sub.id}_total`] = total;
      });

      return row;
    });
  }, [subsystemStats, db.attendanceSheets, db.classes, activeSubsystems]);

  // 4. Preparar dados comparativos por sub-sistema direto
  const subsystemComparisonData = useMemo(() => {
    return subsystemStats.map((sub) => ({
      name: sub.shortName,
      fullName: sub.name,
      taxaAssiduidade: sub.avgAttendance,
      mediaAcademica: sub.avgGrade,
      totalAlunos: sub.studentCount,
      totalTurmas: sub.classesCount,
      color: sub.color
    }));
  }, [subsystemStats]);

  // Custom Tooltip Interativo para recharts com todas as estatísticas detalhadas
  const CustomWeeklyTooltip = ({ active, payload, label }: any) => {
    if (active && payload && payload.length) {
      const currentDay = weeklyData.find((d) => d.dia === label)?.diaCompleto || label;
      return (
        <div className="bg-white p-3.5 rounded-xl shadow-xl border border-slate-200 text-xs min-w-[240px] z-50">
          <div className="flex items-center justify-between border-b border-slate-100 pb-2 mb-2">
            <span className="font-bold text-[#0b1f3a] text-[13px]">{currentDay}</span>
            <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-blue-50 text-[#0b1f3a] font-bold">
              Assiduidade Real
            </span>
          </div>

          <div className="space-y-2">
            {payload.map((item: any) => {
              const subObj = subsystemStats.find((s) => s.id === item.dataKey);
              if (!subObj) return null;
              const presentCount = item.payload[`${subObj.id}_alunos`] ?? Math.round((item.value / 100) * subObj.studentCount);

              return (
                <div key={item.dataKey} className="flex items-center justify-between gap-3">
                  <div className="flex items-center gap-1.5">
                    <span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: item.color }} />
                    <span className="text-slate-700 font-semibold">{subObj.shortName}:</span>
                  </div>
                  <div className="flex items-center gap-2 font-mono">
                    <span className="font-bold text-slate-900">{item.value}%</span>
                    <span className="text-[10px] text-slate-400">
                      ({presentCount}/{subObj.studentCount} alunos)
                    </span>
                  </div>
                </div>
              );
            })}
          </div>

          <div className="mt-2.5 pt-2 border-t border-slate-100 text-[10px] text-slate-500 flex items-center justify-between">
            <span>Sub-sistemas Ativos:</span>
            <span className="font-bold text-[#0b1f3a]">{activeSubsystems.length} Níveis</span>
          </div>
        </div>
      );
    }
    return null;
  };

  const CustomSubsystemTooltip = ({ active, payload }: any) => {
    if (active && payload && payload.length) {
      const data = payload[0].payload;
      return (
        <div className="bg-white p-3.5 rounded-xl shadow-xl border border-slate-200 text-xs min-w-[250px] z-50">
          <div className="border-b border-slate-100 pb-2 mb-2">
            <h4 className="font-bold text-[#0b1f3a] text-sm">{data.fullName}</h4>
            <span className="text-[10px] text-slate-400">Métricas Consolidadas no Banco de Dados</span>
          </div>

          <div className="space-y-1.5 font-mono">
            <div className="flex items-center justify-between">
              <span className="text-slate-600">Assiduidade Geral:</span>
              <span className="font-bold text-[#059669]">{data.taxaAssiduidade !== null ? `${data.taxaAssiduidade}%` : 'Sem dados'}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-slate-600">Média Pedagógica:</span>
              <span className="font-bold text-[#0b1f3a]">{data.mediaAcademica !== null ? `${data.mediaAcademica} / 20 val` : 'Sem notas'}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-slate-600">Alunos Matriculados:</span>
              <span className="font-bold text-slate-900">{data.totalAlunos} alunos</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-slate-600">Turmas Ativas:</span>
              <span className="font-bold text-slate-900">{data.totalTurmas} turmas</span>
            </div>
          </div>
        </div>
      );
    }
    return null;
  };

  return (
    <div className="bg-white rounded-2xl p-6 shadow-xs border border-slate-200">
      {/* Header com os Sub-sistemas Dinâmicos */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-4">
        <div>
          <div className="flex items-center gap-2">
            <span className="text-[11px] font-bold uppercase tracking-wider text-slate-400">
              Monitorização Académica & Assiduidade
            </span>
            <span className="px-2 py-0.5 rounded-md bg-blue-50 text-[#0b1f3a] font-mono text-[10px] font-extrabold border border-blue-100">
              {activeSubsystems.length} Sub-sistemas Ativos
            </span>
          </div>
          <h2 className="font-headline text-lg font-bold text-[#0b1f3a] mt-0.5">
            MONITORAMENTO GERAL
          </h2>
        </div>

        {/* Toggle Semana vs Sub-sistema */}
        <div className="flex items-center gap-1 bg-slate-100 p-1 rounded-xl text-xs self-start sm:self-auto">
          <button
            type="button"
            onClick={() => setViewMode('semana')}
            className={`px-3 py-1.5 rounded-lg font-bold transition-all ${
              viewMode === 'semana'
                ? 'bg-white text-[#0b1f4a] shadow-xs'
                : 'text-slate-500 hover:text-slate-800 font-medium'
            }`}
          >
            Visão Semanal
          </button>
          <button
            type="button"
            onClick={() => setViewMode('subsistema')}
            className={`px-3 py-1.5 rounded-lg font-bold transition-all ${
              viewMode === 'subsistema'
                ? 'bg-white text-[#0b1f4a] shadow-xs'
                : 'text-slate-500 hover:text-slate-800 font-medium'
            }`}
          >
            Por Sub-sistema
          </button>
        </div>
      </div>

      {/* LISTA DINÂMICA DOS SUB-SISTEMAS ATIVOS DA ESCOLA (Substitui as métricas estáticas de ciclo) */}
      <div className="w-full bg-slate-50 rounded-xl p-4 border border-slate-100 mb-4">
        <div className="text-[11px] font-bold text-slate-500 uppercase tracking-wider mb-2.5 flex items-center justify-between">
          <span>Sub-sistemas de Ensino em Funcionamento:</span>
          <span className="text-[10px] text-slate-400 font-normal">
            Taxa média de frequência em tempo real
          </span>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-2.5">
          {subsystemStats.map((sub) => (
            <div
              key={sub.id}
              className="flex items-center gap-2 p-2 rounded-lg bg-white border border-slate-200 shadow-2xs hover:border-slate-300 transition-colors"
              title={`${sub.fullName} — ${sub.studentCount} alunos matriculados, ${sub.classesCount} turmas`}
            >
              <span
                className="w-3 h-3 rounded-full shrink-0"
                style={{ backgroundColor: sub.color }}
              />
              <div className="min-w-0">
                <div className="text-[11px] font-bold text-slate-800 truncate" title={sub.shortName}>
                  {sub.shortName}
                </div>
                <div className="text-[11px] font-mono font-extrabold text-[#0b1f3a]">
                  {sub.avgAttendance !== null ? `${sub.avgAttendance}%` : 'Sem dados'}{' '}
                  <span className="text-[10px] font-normal text-slate-400">
                    ({sub.studentCount} al.)
                  </span>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* CHART INTERATIVO (RECHARTS) COM TOOLTIP COMPLETO */}
      <div className="w-full h-64">
        <ResponsiveContainer width="100%" height="100%">
          {viewMode === 'semana' ? (
            <BarChart
              data={weeklyData}
              margin={{ top: 10, right: 10, left: -15, bottom: 0 }}
              barGap={4}
            >
              <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
              <XAxis
                dataKey="dia"
                tick={{ fontSize: 11, fill: '#64748b' }}
                axisLine={{ stroke: '#e2e8f0' }}
                tickLine={false}
              />
              <YAxis
                domain={[85, 100]}
                tick={{ fontSize: 10, fill: '#94a3b8' }}
                axisLine={false}
                tickLine={false}
                tickFormatter={(v) => `${v}%`}
              />
              <Tooltip content={<CustomWeeklyTooltip />} cursor={{ fill: '#f8fafc' }} />
              <Legend
                wrapperStyle={{ paddingTop: 10, fontSize: 11 }}
                formatter={(value) => {
                  const s = subsystemStats.find((item) => item.id === value);
                  return s ? s.shortName : value;
                }}
              />
              {subsystemStats.map((sub) => (
                <Bar
                  key={sub.id}
                  dataKey={sub.id}
                  name={sub.id}
                  fill={sub.color}
                  radius={[3, 3, 0, 0]}
                  maxBarSize={22}
                />
              ))}
            </BarChart>
          ) : (
            <BarChart
              data={subsystemComparisonData}
              margin={{ top: 10, right: 10, left: -15, bottom: 0 }}
            >
              <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
              <XAxis
                dataKey="name"
                tick={{ fontSize: 11, fill: '#64748b' }}
                axisLine={{ stroke: '#e2e8f0' }}
                tickLine={false}
              />
              <YAxis
                domain={[80, 100]}
                tick={{ fontSize: 10, fill: '#94a3b8' }}
                axisLine={false}
                tickLine={false}
                tickFormatter={(v) => `${v}%`}
              />
              <Tooltip content={<CustomSubsystemTooltip />} cursor={{ fill: '#f8fafc' }} />
              <Bar
                dataKey="taxaAssiduidade"
                name="Assiduidade Média (%)"
                fill="#0b1f3a"
                radius={[4, 4, 0, 0]}
                maxBarSize={36}
              />
            </BarChart>
          )}
        </ResponsiveContainer>
      </div>
    </div>
  );
};
