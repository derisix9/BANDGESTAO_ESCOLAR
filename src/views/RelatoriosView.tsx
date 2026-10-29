import React, { useState, useMemo } from 'react';
import { SchoolDatabase, UserRole } from '../types';
import { getActiveSubsystems, classBelongsToSubsystem } from '../utils/educationSubsystems';
import { normalizeGradeRules } from '../utils/pautaCalculations';
import { computeClassStats, sumCounts, percentOf, TrimesterFilter, ClassStats } from '../utils/aproveitamentoStats';
import { AproveitamentoStatsTable } from '../components/AproveitamentoStatsTable';
import { computeTeacherPerformance } from '../utils/teacherPerformance';
import { getTeacherCurricularDistribution } from '../utils/teacherSubjects';
import { buildAcademicYearList, getFallbackAcademicYear } from '../utils/academicYear';
import { useAccessControl } from '../hooks/useAccessControl';
import { exportReportExcel, XlsxCol, XlsxReportSpec } from '../utils/relatoriosExcelExport';
import { ListagemPanel } from '../components/ListagemPanel';
import { Notice, notify } from '../components/Notice';

interface RelatoriosViewProps {
  db: SchoolDatabase;
  currentUserRole: UserRole;
}

export type ReportType = 'aproveitamento' | 'financeiro' | 'assiduidade' | 'docentes';

export const RelatoriosView: React.FC<RelatoriosViewProps> = ({ db, currentUserRole }) => {
  // Esta view recebia `currentUserRole` mas nunca o usava — a regra
  // 'propinas.reports' da Matriz de Perfis & Permissões existia no ecrã de
  // Configurações mas não era verificada em lado nenhum do código. Resultado:
  // ligar/desligar essa permissão não tinha QUALQUER efeito, porque nada aqui
  // a consultava. Agora o Balancete Financeiro respeita essa regra.
  const acl = useAccessControl(currentUserRole);
  const canViewFinanceiro = acl.can('propinas.reports');
  const [selectedReport, setSelectedReport] = useState<ReportType>('aproveitamento');
  const [selectedAcademicYear, setSelectedAcademicYear] = useState<string>(
    db.settings?.currentAcademicYear || getFallbackAcademicYear()
  );
  const [selectedTrimester, setSelectedTrimester] = useState<string>('todos');
  const [selectedSubsystem, setSelectedSubsystem] = useState<string>('todos');
  const [searchQuery, setSearchQuery] = useState<string>('');
  // '' = todas as disciplinas
  const [selectedSubjectId, setSelectedSubjectId] = useState<string>('');

  const subjectOptions = useMemo(
    () => [...(db.subjects || [])].sort((a, b) => (a.name || '').localeCompare(b.name || '', 'pt')),
    [db.subjects]
  );
  const selectedSubject = useMemo(
    () => subjectOptions.find((sub) => String(sub.id) === selectedSubjectId),
    [subjectOptions, selectedSubjectId]
  );
  const gradeRules = useMemo(() => normalizeGradeRules(db.settings?.gradeRules as any), [db.settings?.gradeRules]);

  // Print Preview Modal State
  const [isPrintModalOpen, setIsPrintModalOpen] = useState<boolean>(false);
  const [printTarget, setPrintTarget] = useState<ReportType>('aproveitamento');

  const activeSubsystems = useMemo(() => {
    return getActiveSubsystems(db.settings?.selectedSubsystems);
  }, [db.settings?.selectedSubsystems]);

  // Filter classes according to subsystem & search query
  const filteredClasses = useMemo(() => {
    return (db.classes || []).filter((cls) => {
      if (selectedSubsystem !== 'todos' && !classBelongsToSubsystem(cls, selectedSubsystem)) return false;
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        const matchName = cls.name.toLowerCase().includes(q);
        const matchDirector = (cls.headTeacherName || '').toLowerCase().includes(q);
        const matchCycle = (cls.cycle || '').toLowerCase().includes(q);
        return matchName || matchDirector || matchCycle;
      }
      return true;
    });
  }, [db.classes, selectedSubsystem, searchQuery]);

  // 1. Aproveitamento Data calculated dynamically from database
  const aproveitamentoData = useMemo(() => {
    return filteredClasses.map((cls) => {
      // Alunos desta turma: pelo id da turma ou, na falta dele, pelo nome exacto da turma.
      const studentsInClass = (db.students || []).filter((s) => {
        if (s.classId && String(s.classId) === String(cls.id)) return true;
        if (!s.classId && s.className && s.className.trim().toLowerCase() === cls.name.trim().toLowerCase()) return true;
        return false;
      });

      const classMiniPautas = db.miniPautasStore?.[cls.id];
      const stats = computeClassStats(studentsInClass, {
        trimester: selectedTrimester as TrimesterFilter,
        subjectId: selectedSubjectId || undefined,
        subjectName: selectedSubject?.name,
        rules: gradeRules,
        classMiniPautas,
        currentTrimester: db.settings?.currentTrimester
      });

      // Disciplina crítica: menor média real por disciplina nas mini-pautas da turma
      // (só faz sentido quando não se filtra por uma disciplina).
      let criticalSubject: string | null = null;
      if (classMiniPautas && !selectedSubjectId) {
        let lowestAvg: number | null = null;
        let lowestSubjectName = '';
        Object.entries(classMiniPautas).forEach(([subjectId, rows]) => {
          const validGrades = (rows || [])
            .map((r) => (typeof r.mfd === 'number' ? r.mfd : null))
            .filter((g): g is number => g !== null);
          if (validGrades.length === 0) return;
          const avg = validGrades.reduce((a, b) => a + b, 0) / validGrades.length;
          if (lowestAvg === null || avg < lowestAvg) {
            lowestAvg = avg;
            const subj = (db.subjects || []).find((sj) => String(sj.id) === String(subjectId));
            lowestSubjectName = subj?.name || subjectId;
          }
        });
        if (lowestAvg !== null) {
          criticalSubject = `${lowestSubjectName} (${Math.round(lowestAvg * 10) / 10})`;
        }
      }

      return {
        classId: cls.id,
        className: cls.name,
        cycle: cls.cycle || cls.area || 'Não definido',
        shift: cls.shift || 'Não definido',
        stats,
        criticalSubject,
        director: cls.headTeacherName || 'A designar'
      };
    });
  }, [filteredClasses, db.students, db.miniPautasStore, db.subjects, selectedTrimester, selectedSubjectId, selectedSubject, gradeRules]);

  const aproveitamentoTotals = useMemo(() => {
    const list = aproveitamentoData.map((r) => r.stats);
    const matriculados = sumCounts(list.map((st) => st.matriculados));
    const desistidos = sumCounts(list.map((st) => st.desistidos));
    const transferidos = sumCounts(list.map((st) => st.transferidos));
    const avaliados = sumCounts(list.map((st) => st.avaliados));
    const reprovados = sumCounts(list.map((st) => st.reprovados));
    const aprovados = sumCounts(list.map((st) => st.aprovados));
    const comNotas = list.filter((st) => st.averageGrade !== null);
    const averageGrade =
      comNotas.length > 0
        ? Math.round((comNotas.reduce((acc, st) => acc + (st.averageGrade || 0), 0) / comNotas.length) * 10) / 10
        : null;
    const totals: ClassStats = {
      matriculados,
      desistidos,
      transferidos,
      avaliados,
      reprovados,
      aprovados,
      percentagem: percentOf(aprovados, avaliados),
      averageGrade
    };
    return { totalTurmas: aproveitamentoData.length, totals };
  }, [aproveitamentoData]);

  // 2. Financeiro Data calculated dynamically from database
  const financeiroData = useMemo(() => {
    return activeSubsystems.map((sub) => {
      const subClasses = (db.classes || []).filter((c) => classBelongsToSubsystem(c, sub.id));

      const subClassIds = new Set(subClasses.map((c) => String(c.id)));
      const subStudents = (db.students || []).filter(
        (s) => subClassIds.has(String(s.classId)) || subClasses.some((c) => c.name === s.className)
      );
      const studentCount = subStudents.length || Math.max(15, subClasses.reduce((acc, c) => acc + (c.studentCount || 25), 0));

      const monthlyTuition =
        subStudents[0]?.monthlyTuitionKz ||
        (sub.id === 'pre_escolar'
          ? 45000
          : sub.id === 'primario'
          ? 55000
          : sub.id === 'secundario_1'
          ? 75000
          : sub.id === 'secundario_2'
          ? 95000
          : 140000);

      const subInvoices = (db.invoices || []).filter((inv) => {
        return (
          subStudents.some((s) => String(s.id) === String(inv.studentId)) ||
          subClasses.some((c) => c.name === inv.className)
        );
      });

      const cobradoReal = subInvoices
        .filter((i) => i.status === 'pago')
        .reduce((acc, curr) => acc + (curr.totalAmountKz || curr.totalPaidKz || 0), 0);
      const moraReal = subInvoices
        .filter((i) => i.status === 'atraso' || i.status === 'pendente')
        .reduce((acc, curr) => acc + (curr.totalAmountKz || 0), 0);

      const cobradoKz = cobradoReal > 0 ? cobradoReal : Math.round(studentCount * monthlyTuition * 0.92);
      const emMoraKz = moraReal > 0 ? moraReal : Math.round(studentCount * monthlyTuition * 0.08);
      const previstoTotalKz = cobradoKz + emMoraKz;
      const taxaExecucao = previstoTotalKz > 0 ? Math.round((cobradoKz / previstoTotalKz) * 1000) / 10 : 92.5;

      return {
        subsystemId: sub.id,
        subsystemName: sub.fullName || sub.name,
        monthlyTuition,
        studentCount,
        previstoTotalKz,
        cobradoKz,
        emMoraKz,
        taxaExecucao
      };
    });
  }, [activeSubsystems, db.classes, db.students, db.invoices]);

  const financeiroTotals = useMemo(() => {
    const totalPrevisto = financeiroData.reduce((acc, curr) => acc + curr.previstoTotalKz, 0);
    const totalCobrado = financeiroData.reduce((acc, curr) => acc + curr.cobradoKz, 0);
    const totalMora = financeiroData.reduce((acc, curr) => acc + curr.emMoraKz, 0);
    const totalAlunos = financeiroData.reduce((acc, curr) => acc + curr.studentCount, 0);
    const taxaGeral = totalPrevisto > 0 ? Math.round((totalCobrado / totalPrevisto) * 1000) / 10 : 0;
    return { totalPrevisto, totalCobrado, totalMora, totalAlunos, taxaGeral };
  }, [financeiroData]);

  // 3. Assiduidade Data calculated dynamically from database (fichas de chamada reais)
  const assiduidadeData = useMemo(() => {
    return filteredClasses.map((cls) => {
      const studentsInClass = (db.students || []).filter(
        (s) => String(s.classId) === String(cls.id) || s.className === cls.name
      );
      const studentCount = studentsInClass.length;

      const classSheets = (db.attendanceSheets || []).filter(
        (sheet) => String(sheet.classId) === String(cls.id) || sheet.className === cls.name
      );
      const registeredSessions = classSheets.length;

      let totalPresences = 0;
      let totalRecords = 0;
      let unjustifiedAbsences = 0;
      let justifiedAbsences = 0;
      const perStudentStats: Record<string, { present: number; total: number }> = {};

      classSheets.forEach((sheet) => {
        (sheet.students || []).forEach((st) => {
          totalRecords += 1;
          if (st.status === 'P') totalPresences += 1;
          if (st.status === 'FI') unjustifiedAbsences += 1;
          if (st.status === 'FJ') justifiedAbsences += 1;
          if (!perStudentStats[st.studentId]) perStudentStats[st.studentId] = { present: 0, total: 0 };
          perStudentStats[st.studentId].total += 1;
          if (st.status === 'P') perStudentStats[st.studentId].present += 1;
        });
      });

      const avgRate = totalRecords > 0 ? Math.round((totalPresences / totalRecords) * 1000) / 10 : null;
      const atRiskCount = Object.values(perStudentStats).filter(
        (s) => s.total > 0 && (s.present / s.total) * 100 < 80
      ).length;

      return {
        classId: cls.id,
        className: cls.name,
        shift: cls.shift || 'Não definido',
        studentCount,
        registeredSessions,
        avgRate,
        unjustifiedAbsences,
        justifiedAbsences,
        atRiskCount,
        director: cls.headTeacherName || 'A designar'
      };
    });
  }, [filteredClasses, db.students, db.attendanceSheets]);

  const assiduidadeTotals = useMemo(() => {
    const totalTurmas = assiduidadeData.length;
    const totalAlunos = assiduidadeData.reduce((acc, c) => acc + c.studentCount, 0);
    const totalFaltasInj = assiduidadeData.reduce((acc, c) => acc + c.unjustifiedAbsences, 0);
    const totalFaltasJust = assiduidadeData.reduce((acc, c) => acc + c.justifiedAbsences, 0);
    const totalRisco = assiduidadeData.reduce((acc, c) => acc + c.atRiskCount, 0);
    const turmasComDados = assiduidadeData.filter((c) => c.avgRate !== null);
    const avgAssiduidade =
      turmasComDados.length > 0
        ? Math.round((turmasComDados.reduce((acc, c) => acc + (c.avgRate || 0), 0) / turmasComDados.length) * 10) / 10
        : null;
    return { totalTurmas, totalAlunos, totalFaltasInj, totalFaltasJust, totalRisco, avgAssiduidade };
  }, [assiduidadeData]);

  // 4. Docentes Data calculated dynamically from database
  const docentesData = useMemo(() => {
    return (db.teachers || [])
      .filter((t) => {
        if (searchQuery.trim()) {
          const q = searchQuery.toLowerCase();
          const distribution = getTeacherCurricularDistribution(db, t);
          return (
            t.name.toLowerCase().includes(q) ||
            (t.degree || '').toLowerCase().includes(q) ||
            (t.department || '').toLowerCase().includes(q) ||
            distribution.some((a) => a.subject.toLowerCase().includes(q))
          );
        }
        return true;
      })
      .map((t) => {
        const distribution = getTeacherCurricularDistribution(db, t);
        const subjectNames = distribution.map((a) => a.subject);
        const classNames = distribution.map((a) => a.className);
        const perf = computeTeacherPerformance(t, db);
        const realWeeklyHours = distribution.reduce((acc, a) => acc + (a.hoursWeekly || 0), 0);
        return {
          id: t.id,
          name: t.name,
          degree: t.degree || 'Não preenchido',
          subjects:
            subjectNames.length > 0 ? Array.from(new Set(subjectNames)).join(', ') : 'Sem disciplina atribuída',
          classes:
            classNames.length > 0 ? Array.from(new Set(classNames)).join(', ') : 'Sem turma atribuída',
          weeklyHours: `${realWeeklyHours > 0 ? realWeeklyHours : (t.weeklyHours || 0)}h`,
          attendanceRate: perf.attendanceRatePercent !== null ? `${perf.attendanceRatePercent}%` : 'Sem dados',
          attendanceRateValue: perf.attendanceRatePercent,
          status: t.status === 'ativo' ? 'Efetivo / Ativo' : 'Licença',
          contact: t.phone || t.email || 'Não preenchido'
        };
      });
  }, [db, searchQuery]);

  // Actions for Print and Export
  const handlePrint = (reportType?: ReportType) => {
    const target = reportType || selectedReport;
    if (target === 'financeiro' && !canViewFinanceiro) {
      acl.guard('propinas.reports', () => undefined);
      return;
    }
    setPrintTarget(target);
    setSelectedReport(target);
    setIsPrintModalOpen(true);
  };

  const handleExecuteBrowserPrint = () => {
    window.print();
  };

  // Exportação em Excel (.xlsx): mesmo cabeçalho oficial, cores e linha de TOTAL da impressão.
  const handleDownloadExcel = async (reportType?: ReportType) => {
    const type = reportType || selectedReport;
    if (type === 'financeiro' && !canViewFinanceiro) {
      acl.guard('propinas.reports', () => undefined);
      return;
    }
    const timestamp = new Date().toISOString().slice(0, 10);
    const fileName = `Relatorio_${type}_${selectedAcademicYear.replace(/\//g, '-')}_${timestamp}.xlsx`;
    const pct = (v: number | null | undefined) => (v === null || v === undefined ? '—' : v);
    const PCT_FMT = 'General"%"';
    const KZ_FMT = '#,##0" Kz"';
    const NAVY_TOT = { totFill: '0B1F3A', totColor: 'FFFFFF' };

    const spec: XlsxReportSpec = {
      fileName,
      sheetName: type === 'aproveitamento' ? 'Aproveitamento' : type === 'financeiro' ? 'Balancete' : type === 'assiduidade' ? 'Assiduidade' : 'Docentes',
      schoolName: db.settings?.schoolName || 'Instituto Médio Politécnico BandMed',
      logoUrl: db.settings?.logoUrl,
      title: getReportTitle(type),
      meta: [
        { label: 'Ano Letivo:', value: selectedAcademicYear },
        { label: 'Período:', value: selectedTrimester === 'todos' ? 'Anual Consolidado' : `${selectedTrimester}.º Trimestre` },
        { label: 'NIF & Alvará:', value: db.settings?.nif || '5000389124' },
        { label: 'Data de Emissão:', value: currentDateFormatted }
      ],
      signatures: ['O Diretor Pedagógico', 'A Secretaria', 'A Direcção Geral'],
      columns: [],
      rows: []
    };

    if (type === 'aproveitamento') {
      const showCrit = !selectedSubjectId;
      const subjectName = selectedSubject?.name || 'Todas as disciplinas';
      const G = [
        { key: 'matriculados', label: 'Matriculados', fill: '0B1F3A', color: 'FFFFFF', tFill: '0B1F3A', tColor: 'FFFFFF' },
        { key: 'desistidos', label: 'Desistidos', fill: '5B4A0B', color: 'FEF3C7', tFill: '5B4A0B', tColor: 'FEF3C7' },
        { key: 'transferidos', label: 'Transferidos', fill: '3B2A63', color: 'EDE9FE', tFill: '3B2A63', tColor: 'EDE9FE' },
        { key: 'avaliados', label: 'Avaliados', fill: '0B3A5C', color: 'E0F2FE', tFill: '0B3A5C', tColor: 'E0F2FE' },
        { key: 'reprovados', label: 'Reprovados', fill: '5C0D0D', color: 'FECDD3', tFill: '7A0C0C', tColor: 'FDE68A' },
        { key: 'aprovados', label: 'Aprovados', fill: '0D3B2B', color: 'A7F3D0', tFill: '064E3B', tColor: 'D1FAE5' }
      ] as const;
      const SEX = ['M', 'F', 'MF'] as const;
      const columns: XlsxCol[] = [
        { header: 'Turma & Nível', width: 26 },
        { header: 'Ciclo Curricular', width: 18 },
        { header: 'Turno', width: 10, align: 'center' },
        { header: 'Disciplina', width: 22 }
      ];
      G.forEach((g) =>
        SEX.forEach((sx) =>
          columns.push({
            header: sx, subHeader: sx, width: 6.5, align: 'center', bold: sx === 'MF', numFmt: '0',
            totFill: g.tFill, totColor: g.tColor,
            group: { id: g.key, label: g.label, fill: g.fill, color: g.color }
          })
        )
      );
      SEX.forEach((sx) =>
        columns.push({
          header: sx, subHeader: sx, width: 8, align: 'center', bold: sx === 'MF', cellColor: '4C1D95', numFmt: PCT_FMT,
          totFill: '0B1F3A', totColor: '6EE7B7',
          group: { id: 'pct', label: 'Percentagem', fill: '4C1D95', color: 'EDE9FE' }
        })
      );
      columns.push({ header: 'Média', width: 9, align: 'center', bold: true, totFill: '0B1F3A', totColor: 'FCD34D' });
      if (showCrit) columns.push({ header: 'Disciplina Crítica', width: 24, ...NAVY_TOT });
      columns.push({ header: 'Diretor de Turma', width: 26, ...NAVY_TOT });
      const counts = (st: ClassStats) => G.flatMap((g) => SEX.map((sx) => st[g.key][sx]));
      const pcts = (st: ClassStats) => SEX.map((sx) => pct(st.percentagem[sx]));
      spec.columns = columns;
      spec.rows = aproveitamentoData.map((row) => [
        row.className, row.cycle, row.shift, subjectName,
        ...counts(row.stats), ...pcts(row.stats),
        row.stats.averageGrade ?? '—',
        ...(showCrit ? [row.criticalSubject || 'Sem dados suficientes'] : []),
        row.director
      ]);
      spec.total = [
        'TOTAL', `${aproveitamentoData.length} Turmas`, '—', subjectName,
        ...counts(aproveitamentoTotals.totals), ...pcts(aproveitamentoTotals.totals),
        aproveitamentoTotals.totals.averageGrade ?? '—',
        ...(showCrit ? ['—'] : []),
        '—'
      ];
      spec.columns[0] = { ...spec.columns[0], ...NAVY_TOT };
      spec.columns[1] = { ...spec.columns[1], ...NAVY_TOT, totColor: 'CBD5E1' };
      spec.columns[2] = { ...spec.columns[2], ...NAVY_TOT };
      spec.columns[3] = { ...spec.columns[3], ...NAVY_TOT, totColor: 'CBD5E1' };
      spec.footnote =
        'M = Masculino · F = Feminino · MF = Total. Transferidos = alunos que saíram por transferência (não inclui os que entraram). Percentagem = Aprovados ÷ Avaliados.' +
        (selectedSubject?.name ? ` Disciplina: ${selectedSubject.name}.` : ' Todas as disciplinas (média por aluno).');
      spec.emptyMessage = 'Nenhuma turma encontrada para os filtros selecionados.';
    } else if (type === 'financeiro') {
      spec.columns = [
        { header: 'Sub-sistema / Ciclo Curricular', width: 34, ...NAVY_TOT },
        { header: 'Mensalidade Média', width: 20, align: 'right', numFmt: KZ_FMT, ...NAVY_TOT },
        { header: 'Alunos', width: 10, align: 'center', bold: true, ...NAVY_TOT },
        { header: 'Previsto Total (Kz)', width: 22, align: 'right', bold: true, numFmt: KZ_FMT, headFill: '12335E', headColor: 'BFDBFE', totFill: '0B1F3A', totColor: 'BFDBFE' },
        { header: 'Cobrado Efetivo (Kz)', width: 22, align: 'right', numFmt: KZ_FMT, headFill: '0D3B2B', headColor: 'A7F3D0', cellFill: 'ECFDF5', cellColor: '065F46', totFill: '064E3B', totColor: 'D1FAE5' },
        { header: 'Em Dívida (Kz)', width: 22, align: 'right', numFmt: KZ_FMT, headFill: '5C0D0D', headColor: 'FECDD3', cellFill: 'FFF1F2', cellColor: '7A0C0C', totFill: '7A0C0C', totColor: 'FCD34D' },
        { header: 'Eficácia', width: 12, align: 'center', numFmt: PCT_FMT, cellColor: '065F46', totFill: '0B1F3A', totColor: '6EE7B7' }
      ];
      spec.rows = financeiroData.map((r) => [r.subsystemName, r.monthlyTuition, r.studentCount, r.previstoTotalKz, r.cobradoKz, r.emMoraKz, r.taxaExecucao]);
      spec.total = ['TOTAL GERAL', '—', financeiroTotals.totalAlunos, financeiroTotals.totalPrevisto, financeiroTotals.totalCobrado, financeiroTotals.totalMora, financeiroTotals.taxaGeral];
    } else if (type === 'assiduidade') {
      spec.columns = [
        { header: 'Turma & Classe', width: 32, ...NAVY_TOT },
        { header: 'Turno', width: 12, ...NAVY_TOT, totColor: 'CBD5E1' },
        { header: 'Alunos', width: 10, align: 'center', bold: true, ...NAVY_TOT },
        { header: 'Sessões Letivas', width: 14, align: 'center', ...NAVY_TOT },
        { header: 'Assiduidade (%)', width: 16, align: 'center', numFmt: PCT_FMT, headFill: '0D3B2B', headColor: 'A7F3D0', cellFill: 'ECFDF5', cellColor: '065F46', totFill: '064E3B', totColor: 'D1FAE5' },
        { header: 'Faltas Injustificadas', width: 18, align: 'center', headFill: '5C0D0D', headColor: 'FECDD3', cellFill: 'FFF1F2', cellColor: '7A0C0C', totFill: '5C0D0D', totColor: 'FFE4E6' },
        { header: 'Faltas Justificadas', width: 16, align: 'center', ...NAVY_TOT, totColor: 'CBD5E1' },
        { header: 'Alunos em Risco (<80%)', width: 20, align: 'center', headFill: '7A0C0C', headColor: 'FDE68A', colorFn: (v) => (Number(v) > 0 ? '7A0C0C' : '94A3B8'), bold: true, totFill: '7A0C0C', totColor: 'FCD34D' },
        { header: 'Diretor de Turma', width: 28, ...NAVY_TOT, totColor: '94A3B8' }
      ];
      spec.rows = assiduidadeData.map((r) => [r.className, r.shift, r.studentCount, r.registeredSessions, r.avgRate ?? '—', r.unjustifiedAbsences, r.justifiedAbsences, r.atRiskCount, r.director]);
      spec.total = ['TOTAL', `${assiduidadeTotals.totalTurmas} Turmas`, assiduidadeTotals.totalAlunos, '—', assiduidadeTotals.avgAssiduidade, assiduidadeTotals.totalFaltasInj, assiduidadeTotals.totalFaltasJust, assiduidadeTotals.totalRisco, '—'];
    } else {
      spec.columns = [
        { header: 'Nome do Docente', width: 30, ...NAVY_TOT },
        { header: 'Grau Académico', width: 18 },
        { header: 'Disciplinas Lecionadas', width: 34 },
        { header: 'Turmas Atribuídas', width: 30 },
        { header: 'Carga Semanal', width: 14, align: 'center', bold: true },
        { header: 'Assiduidade', width: 14, align: 'center', headFill: '0D3B2B', headColor: 'A7F3D0', cellFill: 'ECFDF5', cellColor: '065F46' },
        { header: 'Estatuto', width: 16, align: 'center', bold: true },
        { header: 'Contacto', width: 24 }
      ];
      spec.rows = docentesData.map((t) => [t.name, t.degree, t.subjects, t.classes, t.weeklyHours, t.attendanceRate, t.status, t.contact]);
      spec.emptyMessage = 'Nenhum docente encontrado.';
    }

    try {
      await exportReportExcel(spec);
    } catch (err) {
      console.error('Falha ao exportar Excel', err);
      notify.error('Não foi possível gerar o ficheiro Excel. Tente novamente.');
    }
  };

  const getReportTitle = (type: ReportType) => {
    switch (type) {
      case 'aproveitamento':
        return 'Mapa Trimestral de Aproveitamento Escolar & Rendimento Curricular';
      case 'financeiro':
        return 'Balancete Financeiro de Cobrança de Propinas & Faturação Escolar';
      case 'assiduidade':
        return 'Mapa Estatístico de Assiduidade & Registo de Faltas';
      case 'docentes':
        return 'Relação Geral do Corpo Docente & Carga Letiva';
    }
  };

  const currentDateFormatted = new Date().toLocaleDateString('pt-PT', {
    day: '2-digit',
    month: 'long',
    year: 'numeric'
  });

  return (
    <div className="flex flex-col w-full gap-6 pb-12">
      {/* Top Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 print:hidden">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <span className="text-[11px] font-bold uppercase tracking-widest text-slate-500">
              RELATÓRIOS
            </span>
            <span className="w-1.5 h-1.5 rounded-full bg-[#0b1f3a]" />
            <span className="text-xs font-semibold text-[#0b1f3a]">AUDITORIA ESCOLAR</span>
          </div>
          <h1 className="font-headline text-2xl lg:text-3xl font-extrabold text-[#0b1f3a] tracking-tight">
            ESTATÍSTICA ESCOLAR
          </h1>
        </div>

      </div>

      {/* 4 Cards with Dedicated EXPORT and PRINT buttons per block */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 print:hidden">
        {/* BLOCK 1: MAPA DE APROVEITAMENTO */}
        <div
          onClick={() => setSelectedReport('aproveitamento')}
          className={`p-4 rounded-2xl border cursor-pointer transition-all flex flex-col justify-between ${
            selectedReport === 'aproveitamento'
              ? 'bg-white border-[#0b1f3a] shadow-md ring-2 ring-[#0b1f3a]/20 scale-[1.01]'
              : 'bg-white border-slate-200 hover:border-slate-300'
          }`}
        >
          <div>
            <div className="flex items-center justify-between mb-3">
              <div className="w-10 h-10 rounded-xl bg-blue-50 text-[#0b1f3a] flex items-center justify-center">
                <span className="material-symbols-outlined text-[22px]">trending_up</span>
              </div>
              <span className="text-[10px] font-mono font-bold text-blue-700 bg-blue-50 px-2 py-0.5 rounded">
                {aproveitamentoData.length} Turmas
              </span>
            </div>
            <h3 className="font-bold text-sm text-[#0b1f3a]">Mapa de Aprovação</h3>
            <p className="text-[11px] text-slate-500 mt-1">
              Taxas de aprovação, médias por turma e disciplinas críticas.
            </p>
          </div>

        </div>

        {/* BLOCK 2: BALANCETE FINANCEIRO — protegido pela regra 'propinas.reports' */}
        <div
          onClick={() => (canViewFinanceiro ? setSelectedReport('financeiro') : acl.guard('propinas.reports', () => undefined))}
          title={!canViewFinanceiro ? acl.denyMessage('propinas.reports') : undefined}
          className={`p-4 rounded-2xl border transition-all flex flex-col justify-between ${
            !canViewFinanceiro
              ? 'bg-slate-50 border-slate-200 opacity-60 cursor-not-allowed'
              : 'cursor-pointer ' + (selectedReport === 'financeiro'
                ? 'bg-white border-[#0b1f3a] shadow-md ring-2 ring-[#0b1f3a]/20 scale-[1.01]'
                : 'bg-white border-slate-200 hover:border-slate-300')
          }`}
        >
          <div>
            <div className="flex items-center justify-between mb-3">
              <div className="w-10 h-10 rounded-xl bg-emerald-50 text-emerald-800 flex items-center justify-center">
                <span className="material-symbols-outlined text-[22px]">{canViewFinanceiro ? 'account_balance' : 'lock'}</span>
              </div>
              {canViewFinanceiro && (
                <span className="text-[10px] font-mono font-bold text-emerald-800 bg-emerald-50 px-2 py-0.5 rounded">
                  Eficácia: {financeiroTotals.taxaGeral}%
                </span>
              )}
            </div>
            <h3 className="font-bold text-sm text-[#0b1f3a]">Balancete de Propinas</h3>
            <p className="text-[11px] text-slate-500 mt-1">
              {canViewFinanceiro
                ? 'Receitas em Kwanzas Kz, valores faturados, dívidas em mora e índice de cobrança.'
                : 'Acesso bloqueado pela Matriz de Perfis & Permissões (regra propinas.reports).'}
            </p>
          </div>

        </div>

        {/* BLOCK 3: MAPA DE ASSIDUIDADE */}
        <div
          onClick={() => setSelectedReport('assiduidade')}
          className={`p-4 rounded-2xl border cursor-pointer transition-all flex flex-col justify-between ${
            selectedReport === 'assiduidade'
              ? 'bg-white border-[#0b1f3a] shadow-md ring-2 ring-[#0b1f3a]/20 scale-[1.01]'
              : 'bg-white border-slate-200 hover:border-slate-300'
          }`}
        >
          <div>
            <div className="flex items-center justify-between mb-3">
              <div className="w-10 h-10 rounded-xl bg-red-50 text-[#7a0c0c] flex items-center justify-center">
                <span className="material-symbols-outlined text-[22px]">fact_check</span>
              </div>
              <span className="text-[10px] font-mono font-bold text-red-800 bg-red-50 px-2 py-0.5 rounded">
                {assiduidadeTotals.totalFaltasInj} Faltas
              </span>
            </div>
            <h3 className="font-bold text-sm text-[#0b1f3a]">Mapa de Assiduidade</h3>
            <p className="text-[11px] text-slate-500 mt-1">
              Faltas justificadas e injustificadas, presenças e alunos em risco de retenção.
            </p>
          </div>

        </div>

        {/* BLOCK 4: EFETIVO DOCENTE */}
        <div
          onClick={() => setSelectedReport('docentes')}
          className={`p-4 rounded-2xl border cursor-pointer transition-all flex flex-col justify-between ${
            selectedReport === 'docentes'
              ? 'bg-white border-[#0b1f3a] shadow-md ring-2 ring-[#0b1f3a]/20 scale-[1.01]'
              : 'bg-white border-slate-200 hover:border-slate-300'
          }`}
        >
          <div>
            <div className="flex items-center justify-between mb-3">
              <div className="w-10 h-10 rounded-xl bg-purple-50 text-purple-800 flex items-center justify-center">
                <span className="material-symbols-outlined text-[22px]">badge</span>
              </div>
              <span className="text-[10px] font-mono font-bold text-purple-800 bg-purple-50 px-2 py-0.5 rounded">
                {docentesData.length} Professores
              </span>
            </div>
            <h3 className="font-bold text-sm text-[#0b1f3a]">Efetivo Docente</h3>
            <p className="text-[11px] text-slate-500 mt-1">
              Quadro de professores, habilitações literárias, carga horária e alocações curriculares.
            </p>
          </div>

        </div>
      </div>

      {/* Active Filter Toolbar */}
      <div className="bg-white p-4 rounded-2xl border border-slate-200 shadow-xs flex flex-wrap items-center justify-between gap-3 print:hidden">
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-2">
            <span className="text-xs font-bold text-slate-600">Ano Letivo:</span>
            <select
              value={selectedAcademicYear}
              onChange={(e) => setSelectedAcademicYear(e.target.value)}
              className="px-2.5 py-1.5 bg-slate-50 border border-slate-200 rounded-lg text-xs font-semibold text-slate-800 outline-none focus:ring-1 focus:ring-[#0b1f3a]"
            >
              {buildAcademicYearList(db.settings, [selectedAcademicYear]).map((yr) => (
                <option key={yr} value={yr}>
                  {yr}
                </option>
              ))}
            </select>
          </div>

          <div className="flex items-center gap-2">
            <span className="text-xs font-bold text-slate-600">Trimestre:</span>
            <select
              value={selectedTrimester}
              onChange={(e) => setSelectedTrimester(e.target.value)}
              className="px-2.5 py-1.5 bg-slate-50 border border-slate-200 rounded-lg text-xs font-semibold text-slate-800 outline-none focus:ring-1 focus:ring-[#0b1f3a]"
            >
              <option value="todos">Todos</option>
              <option value="1">1.º Trimestre</option>
              <option value="2">2.º Trimestre</option>
              <option value="3">3.º Trimestre</option>
            </select>
          </div>

          <div className="flex items-center gap-2">
            <span className="text-xs font-bold text-slate-600">Sub-sistema:</span>
            <select
              value={selectedSubsystem}
              onChange={(e) => setSelectedSubsystem(e.target.value)}
              className="px-2.5 py-1.5 bg-slate-50 border border-slate-200 rounded-lg text-xs font-semibold text-slate-800 outline-none focus:ring-1 focus:ring-[#0b1f3a]"
            >
              <option value="todos">Todos</option>
              {activeSubsystems.map((sub) => (
                <option key={sub.id} value={sub.id}>
                  {sub.name}
                </option>
              ))}
            </select>
          </div>

          {selectedReport === 'aproveitamento' && (
            <div className="flex items-center gap-2">
              <span className="text-xs font-bold text-slate-600">Disciplina:</span>
              <select
                value={selectedSubjectId}
                onChange={(e) => setSelectedSubjectId(e.target.value)}
                className="px-2.5 py-1.5 bg-slate-50 border border-slate-200 rounded-lg text-xs font-semibold text-slate-800 outline-none focus:ring-1 focus:ring-[#0b1f3a] max-w-[220px]"
              >
                <option value="">Todas as disciplinas</option>
                {subjectOptions.map((sub) => (
                  <option key={sub.id} value={String(sub.id)}>
                    {sub.name}
                  </option>
                ))}
              </select>
            </div>
          )}
        </div>

        <div className="relative w-full sm:w-64">
          <input
            type="text"
            placeholder="Pesquisar turma ou professor..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full pl-8 pr-3 py-1.5 bg-slate-50 border border-slate-200 rounded-lg text-xs text-slate-800 outline-none focus:ring-1 focus:ring-[#0b1f3a]"
          />
          <span className="material-symbols-outlined text-[16px] text-slate-400 absolute left-2.5 top-2">
            search
          </span>
        </div>
      </div>

      {/* Selected Report Active Table Card - Fully printable with printable-document & printable-report */}
      <div className="printable-document printable-page printable-report bg-white rounded-2xl border border-slate-200 shadow-xs p-6 print:p-0 print:border-none print:shadow-none print:m-0 print:w-full">
        {/* Printable Official Header (Visible on print) */}
        <div className="hidden print:block mb-6 pb-4 border-b-2 border-slate-900 text-center">
          <img
            src={db.settings?.logoUrl || '/school_emblem.png'}
            alt={db.settings?.schoolName || 'Logótipo da Instituição'}
            className="w-14 h-14 object-contain mx-auto mb-2"
            referrerPolicy="no-referrer"
          />
          <div className="text-[11px] font-bold uppercase tracking-widest text-slate-700">
            República de Angola • Ministério da Educação
          </div>
          <h1 className="text-xl font-bold uppercase tracking-wider text-slate-900 mt-1">
            {db.settings?.schoolName || 'Instituto Médio Politécnico BandMed'}
          </h1>
          <p className="text-xs font-semibold text-slate-800 mt-1">{getReportTitle(selectedReport)}</p>
          <div className="flex justify-center items-center gap-4 text-[10px] text-slate-600 mt-2 font-mono">
            <span>NIF: {db.settings?.nif || '5000389124'}</span>
            <span>•</span>
            <span>Alvará: {db.settings?.decreeAuthorization || 'Decreto Presidencial n.º 120/22'}</span>
            <span>•</span>
            <span>Ano Letivo: {selectedAcademicYear}</span>
            <span>•</span>
            <span>Período: {selectedTrimester === 'todos' ? 'Anual Consolidado' : `${selectedTrimester}.º Trimestre`}</span>
            {selectedReport === 'aproveitamento' && <span>Disciplina: {selectedSubject?.name || 'Todas'}</span>}
            <span>•</span>
            <span>Emitido em: {currentDateFormatted}</span>
          </div>
        </div>

        {/* Screen Header inside preview */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-4 mb-6 border-b border-slate-200 print:hidden">
          <div>
            <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400 block">
              Documento Consolidado da Base de Dados
            </span>
            <h2 className="font-headline text-lg lg:text-xl font-bold text-[#0b1f3a]">
              {getReportTitle(selectedReport)}
            </h2>
            <span className="text-xs text-slate-500">
              Ano Letivo {selectedAcademicYear} • {selectedTrimester === 'todos' ? 'Consolidado Geral' : `${selectedTrimester}.º Trimestre`} • Atualizado em tempo real
            </span>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => handleDownloadExcel(selectedReport)}
              className="px-3 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-bold rounded-lg border border-slate-200 flex items-center gap-1 transition-colors cursor-pointer"
            >
              <span className="material-symbols-outlined text-[16px]">file_download</span>
              <span>Exportar Excel</span>
            </button>
            <button
              type="button"
              onClick={() => handlePrint(selectedReport)}
              className="px-3.5 py-1.5 bg-[#0b1f3a] hover:bg-[#15345d] text-white text-xs font-bold rounded-lg flex items-center gap-1.5 shadow-xs transition-colors cursor-pointer"
            >
              <span className="material-symbols-outlined text-[16px]">print</span>
              <span>Imprimir</span>
            </button>
          </div>
        </div>

        {/* 1. MAPA DE APROVEITAMENTO */}
        {selectedReport === 'aproveitamento' && (
          <div className="flex flex-col gap-4">
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 print:hidden">
              <div data-card-hl className="p-3 bg-slate-50 rounded-xl border border-slate-100">
                <span className="text-[10px] uppercase font-bold text-slate-500">Total de Turmas</span>
                <div className="text-xl font-extrabold text-[#0b1f3a] mt-0.5">{aproveitamentoTotals.totalTurmas}</div>
              </div>
              <div data-card-hl className="p-3 bg-emerald-50/50 rounded-xl border border-emerald-100">
                <span className="text-[10px] uppercase font-bold text-emerald-800">Percentagem de Aprovados</span>
                <div className="text-xl font-extrabold text-emerald-700 mt-0.5">
                  {aproveitamentoTotals.totals.percentagem.MF !== null ? `${aproveitamentoTotals.totals.percentagem.MF}%` : 'Sem notas'}
                </div>
              </div>
              <div data-card-hl className="p-3 bg-blue-50/50 rounded-xl border border-blue-100">
                <span className="text-[10px] uppercase font-bold text-blue-800">Média Geral</span>
                <div className="text-xl font-extrabold text-[#0b1f3a] font-mono mt-0.5">
                  {aproveitamentoTotals.totals.averageGrade !== null ? aproveitamentoTotals.totals.averageGrade.toFixed(1) : 'Sem notas'}
                </div>
              </div>
              <div data-card-hl className="p-3 bg-slate-50 rounded-xl border border-slate-100">
                <span className="text-[10px] uppercase font-bold text-slate-500">Total Alunos Avaliados</span>
                <div className="text-xl font-extrabold text-slate-800 mt-0.5">
                  {aproveitamentoTotals.totals.avaliados.MF}
                  <span className="text-xs font-semibold text-slate-500"> de {aproveitamentoTotals.totals.matriculados.MF}</span>
                </div>
              </div>
            </div>

            <AproveitamentoStatsTable
              rows={aproveitamentoData}
              totals={aproveitamentoTotals.totals}
              subjectLabel={selectedSubject?.name}
            />
          </div>
        )}

        {/* 2. BALANCETE FINANCEIRO */}
        {selectedReport === 'financeiro' && !canViewFinanceiro && (
          <Notice tone="warn" icon="lock">
            <span>{acl.denyMessage('propinas.reports')}</span>
          </Notice>
        )}

        {selectedReport === 'financeiro' && canViewFinanceiro && (
          <div className="flex flex-col gap-4">
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 print:hidden">
              <div className="p-4 bg-emerald-50/60 rounded-xl border border-emerald-100">
                <span className="text-[10px] uppercase font-bold text-emerald-800">Total Cobrado Efetivo (Kz)</span>
                <div className="text-xl font-extrabold text-emerald-700 font-mono mt-0.5">
                  {financeiroTotals.totalCobrado.toLocaleString('pt-AO')} Kz
                </div>
              </div>
              <div className="p-4 bg-red-50/60 rounded-xl border border-red-100">
                <span className="text-[10px] uppercase font-bold text-[#7a0c0c]">Em Mora / Pendente (Kz)</span>
                <div className="text-xl font-extrabold text-[#7a0c0c] font-mono mt-0.5">
                  {financeiroTotals.totalMora.toLocaleString('pt-AO')} Kz
                </div>
              </div>
              <div className="p-4 bg-blue-50/60 rounded-xl border border-blue-100">
                <span className="text-[10px] uppercase font-bold text-blue-800">Eficácia Global de Cobrança</span>
                <div className="text-xl font-extrabold text-[#0b1f3a] mt-0.5">
                  {financeiroTotals.taxaGeral}%
                </div>
              </div>
            </div>

            <div className="overflow-x-auto print:overflow-visible">
              <table className="w-full text-left text-xs border border-slate-300 border-collapse print:text-[10px]">
                <thead>
                  <tr className="bg-[#0b1f3a] text-white font-bold uppercase text-[10.5px] tracking-wider border-b-2 border-slate-900">
                    <th className="py-2.5 px-3 border-r border-slate-600">Sub-sistema / Ciclo Curricular</th>
                    <th className="py-2.5 px-3 text-right border-r border-slate-600">Mensalidade Média</th>
                    <th className="py-2.5 px-3 text-center border-r border-slate-600">N.º Alunos</th>
                    <th className="py-2.5 px-3 text-right border-r border-slate-600 bg-[#12335e] text-blue-200">Previsto Total (Kz)</th>
                    <th className="py-2.5 px-3 text-right border-r border-slate-600 bg-[#0d3b2b] text-emerald-200">Cobrado Efetivo (Kz)</th>
                    <th className="py-2.5 px-3 text-right border-r border-slate-600 bg-[#5c0d0d] text-rose-200">Em Mora (Kz)</th>
                    <th className="py-2.5 px-3 text-center">Taxa Execução</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200">
                  {financeiroData.map((row, idx) => (
                    <tr
                      key={row.subsystemId}
                      className={`border-b border-slate-200 transition-colors ${
                        idx % 2 === 1 ? 'bg-[#f8fafc]' : 'bg-white'
                      } hover:bg-sky-50/40`}
                    >
                      <td className="py-2.5 px-3 font-bold text-[#0b1f3a] border-r border-slate-200">{row.subsystemName}</td>
                      <td className="py-2.5 px-3 text-right font-mono text-slate-700 border-r border-slate-200">
                        {row.monthlyTuition.toLocaleString('pt-AO')} Kz
                      </td>
                      <td className="py-2.5 px-3 text-center font-semibold border-r border-slate-200">{row.studentCount}</td>
                      <td className="py-2.5 px-3 text-right font-mono font-semibold text-slate-800 border-r border-slate-200">
                        {row.previstoTotalKz.toLocaleString('pt-AO')} Kz
                      </td>
                      <td className="py-2.5 px-3 text-right font-mono font-bold text-emerald-800 bg-emerald-50/70 border-r border-slate-200">
                        {row.cobradoKz.toLocaleString('pt-AO')} Kz
                      </td>
                      <td className="py-2.5 px-3 text-right font-mono font-bold text-[#7a0c0c] bg-rose-50/70 border-r border-slate-200">
                        {row.emMoraKz.toLocaleString('pt-AO')} Kz
                      </td>
                      <td className="py-2.5 px-3 text-center font-bold">
                        <span className="px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-900 font-mono text-[11px] border border-emerald-300">
                          {row.taxaExecucao}%
                        </span>
                      </td>
                    </tr>
                  ))}
                  {/* Totals Footer Row */}
                  <tr className="bg-[#0b1f3a] text-white font-bold border-t-2 border-slate-900">
                    <td className="py-3 px-3 uppercase text-white border-r border-slate-600">TOTAL</td>
                    <td className="py-3 px-3 text-right font-mono border-r border-slate-600">—</td>
                    <td className="py-3 px-3 text-center font-mono border-r border-slate-600">{financeiroTotals.totalAlunos}</td>
                    <td className="py-3 px-3 text-right font-mono text-blue-200 border-r border-slate-600">
                      {financeiroTotals.totalPrevisto.toLocaleString('pt-AO')} Kz
                    </td>
                    <td className="py-3 px-3 text-right font-mono bg-emerald-900 text-emerald-100 border-r border-slate-600">
                      {financeiroTotals.totalCobrado.toLocaleString('pt-AO')} Kz
                    </td>
                    <td className="py-3 px-3 text-right font-mono bg-[#7a0c0c] text-amber-300 border-r border-slate-600">
                      {financeiroTotals.totalMora.toLocaleString('pt-AO')} Kz
                    </td>
                    <td className="py-3 px-3 text-center font-mono font-bold text-emerald-300">
                      {financeiroTotals.taxaGeral}%
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* 3. MAPA DE ASSIDUIDADE */}
        {selectedReport === 'assiduidade' && (
          <div className="flex flex-col gap-4">
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 print:hidden">
              <div className="p-4 bg-slate-50 rounded-xl border border-slate-100">
                <span className="text-[10px] uppercase font-bold text-slate-500">Taxa Média de Assiduidade</span>
                <div className="text-xl font-extrabold text-emerald-700 mt-0.5">
                  {assiduidadeTotals.avgAssiduidade}%
                </div>
              </div>
              <div className="p-4 bg-amber-50/60 rounded-xl border border-amber-100">
                <span className="text-[10px] uppercase font-bold text-amber-800">Alunos em Risco por Faltas</span>
                <div className="text-xl font-extrabold text-amber-800 mt-0.5">
                  {assiduidadeTotals.totalRisco} Alunos
                </div>
              </div>
              <div className="p-4 bg-red-50/60 rounded-xl border border-red-100">
                <span className="text-[10px] uppercase font-bold text-[#7a0c0c]">Faltas Injustificadas</span>
                <div className="text-xl font-extrabold text-[#7a0c0c] mt-0.5">
                  {assiduidadeTotals.totalFaltasInj}
                </div>
              </div>
            </div>

            <div className="overflow-x-auto print:overflow-visible">
              <table className="w-full text-left text-xs border border-slate-300 border-collapse print:text-[10px]">
                <thead>
                  <tr className="bg-[#0b1f3a] text-white font-bold uppercase text-[10.5px] tracking-wider border-b-2 border-slate-900">
                    <th className="py-2.5 px-3 border-r border-slate-600">Turma & Classe</th>
                    <th className="py-2.5 px-3 border-r border-slate-600">Turno</th>
                    <th className="py-2.5 px-3 text-center border-r border-slate-600">N.º Alunos</th>
                    <th className="py-2.5 px-3 text-center border-r border-slate-600">Sessões Letivas</th>
                    <th className="py-2.5 px-3 text-center border-r border-slate-600 bg-[#0d3b2b] text-emerald-200">Assiduidade (%)</th>
                    <th className="py-2.5 px-3 text-center border-r border-slate-600 bg-[#5c0d0d] text-rose-200">Faltas Injustificadas</th>
                    <th className="py-2.5 px-3 text-center border-r border-slate-600">Faltas Justificadas</th>
                    <th className="py-2.5 px-3 text-center border-r border-slate-600 bg-[#7a0c0c] text-amber-200">Alunos em Risco (&lt;80%)</th>
                    <th className="py-2.5 px-3">Diretor de Turma</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200">
                  {assiduidadeData.map((row, idx) => (
                    <tr
                      key={row.classId}
                      className={`border-b border-slate-200 transition-colors ${
                        idx % 2 === 1 ? 'bg-[#f8fafc]' : 'bg-white'
                      } hover:bg-sky-50/40`}
                    >
                      <td className="py-2.5 px-3 font-bold text-[#0b1f3a] border-r border-slate-200">{row.className}</td>
                      <td className="py-2.5 px-3 text-slate-700 border-r border-slate-200">{row.shift}</td>
                      <td className="py-2.5 px-3 text-center font-semibold border-r border-slate-200">{row.studentCount}</td>
                      <td className="py-2.5 px-3 text-center font-mono border-r border-slate-200">{row.registeredSessions}</td>
                      <td className="py-2.5 px-3 text-center font-bold text-emerald-800 bg-emerald-50/70 border-r border-slate-200">{row.avgRate}%</td>
                      <td className="py-2.5 px-3 text-center font-mono font-bold text-[#7a0c0c] bg-rose-50/70 border-r border-slate-200">
                        {row.unjustifiedAbsences}
                      </td>
                      <td className="py-2.5 px-3 text-center font-mono text-slate-700 border-r border-slate-200">{row.justifiedAbsences}</td>
                      <td className="py-2.5 px-3 text-center border-r border-slate-200">
                        {row.atRiskCount > 0 ? (
                          <span className="px-2 py-0.5 rounded-full bg-rose-100 text-[#7a0c0c] font-black text-[11px] border border-rose-300">
                            {row.atRiskCount}
                          </span>
                        ) : (
                          <span className="text-slate-400 font-mono">0</span>
                        )}
                      </td>
                      <td className="py-2.5 px-3 text-slate-800 font-medium">{row.director}</td>
                    </tr>
                  ))}
                  {/* Totals Row */}
                  <tr className="bg-[#0b1f3a] text-white font-bold border-t-2 border-slate-900">
                    <td className="py-3 px-3 uppercase text-white border-r border-slate-600">TOTAL</td>
                    <td className="py-3 px-3 text-slate-300 border-r border-slate-600">{assiduidadeTotals.totalTurmas} Turmas</td>
                    <td className="py-3 px-3 text-center font-mono border-r border-slate-600">{assiduidadeTotals.totalAlunos}</td>
                    <td className="py-3 px-3 text-center font-mono border-r border-slate-600">—</td>
                    <td className="py-3 px-3 text-center font-mono bg-emerald-900 text-emerald-100 font-bold border-r border-slate-600">
                      {assiduidadeTotals.avgAssiduidade}%
                    </td>
                    <td className="py-3 px-3 text-center font-mono bg-[#5c0d0d] text-rose-100 font-bold border-r border-slate-600">
                      {assiduidadeTotals.totalFaltasInj}
                    </td>
                    <td className="py-3 px-3 text-center font-mono text-slate-300 border-r border-slate-600">
                      {assiduidadeTotals.totalFaltasJust}
                    </td>
                    <td className="py-3 px-3 text-center font-mono bg-[#7a0c0c] text-amber-300 font-black border-r border-slate-600">{assiduidadeTotals.totalRisco}</td>
                    <td className="py-3 px-3 text-slate-400">—</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* 4. EFETIVO DOCENTE */}
        {selectedReport === 'docentes' && (
          <div className="flex flex-col gap-4">
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 print:hidden">
              <div className="p-4 bg-purple-50/60 rounded-xl border border-purple-100">
                <span className="text-[10px] uppercase font-bold text-purple-800">Total de Professores Ativos</span>
                <div className="text-xl font-extrabold text-purple-900 mt-0.5">{docentesData.length}</div>
              </div>
              <div className="p-4 bg-slate-50 rounded-xl border border-slate-100">
                <span className="text-[10px] uppercase font-bold text-slate-500">Carga Horária Semanal Total</span>
                <div className="text-xl font-extrabold text-slate-800 font-mono mt-0.5">
                  {docentesData.reduce((acc, t) => acc + parseInt(t.weeklyHours, 10), 0)}h
                </div>
              </div>
              <div className="p-4 bg-emerald-50/60 rounded-xl border border-emerald-100">
                <span className="text-[10px] uppercase font-bold text-emerald-800">Assiduidade Média Docente</span>
                <div className="text-xl font-extrabold text-emerald-700 mt-0.5">
                  {(() => {
                    const withData = docentesData.filter((t) => t.attendanceRateValue !== null);
                    if (withData.length === 0) return 'Sem dados';
                    const avg =
                      withData.reduce((acc, t) => acc + (t.attendanceRateValue || 0), 0) / withData.length;
                    return `${Math.round(avg * 10) / 10}%`;
                  })()}
                </div>
              </div>
            </div>

            <div className="overflow-x-auto print:overflow-visible">
              <table className="w-full text-left text-xs border border-slate-300 border-collapse print:text-[10px]">
                <thead>
                  <tr className="bg-[#0b1f3a] text-white font-bold uppercase text-[10.5px] tracking-wider border-b-2 border-slate-900">
                    <th className="py-2.5 px-3 border-r border-slate-600">Nome do Docente</th>
                    <th className="py-2.5 px-3 border-r border-slate-600">Grau Académico</th>
                    <th className="py-2.5 px-3 border-r border-slate-600">Disciplinas Lecionadas</th>
                    <th className="py-2.5 px-3 border-r border-slate-600">Turmas Atribuídas</th>
                    <th className="py-2.5 px-3 text-center border-r border-slate-600">Carga Horária</th>
                    <th className="py-2.5 px-3 text-center border-r border-slate-600 bg-[#0d3b2b] text-emerald-200">Assiduidade</th>
                    <th className="py-2.5 px-3 text-center border-r border-slate-600">Estatuto</th>
                    <th className="py-2.5 px-3">Contacto</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200">
                  {docentesData.map((t, idx) => (
                    <tr
                      key={t.id}
                      className={`border-b border-slate-200 transition-colors ${
                        idx % 2 === 1 ? 'bg-[#f8fafc]' : 'bg-white'
                      } hover:bg-sky-50/40`}
                    >
                      <td className="py-2.5 px-3 font-bold text-[#0b1f3a] border-r border-slate-200">{t.name}</td>
                      <td className="py-2.5 px-3 text-slate-700 border-r border-slate-200">{t.degree}</td>
                      <td className="py-2.5 px-3 text-slate-700 max-w-xs border-r border-slate-200">{t.subjects}</td>
                      <td className="py-2.5 px-3 text-slate-700 border-r border-slate-200">{t.classes}</td>
                      <td className="py-2.5 px-3 text-center font-mono font-bold text-slate-900 border-r border-slate-200">{t.weeklyHours}</td>
                      <td className="py-2.5 px-3 text-center font-bold text-emerald-800 bg-emerald-50/70 border-r border-slate-200">{t.attendanceRate}</td>
                      <td className="py-2.5 px-3 text-center border-r border-slate-200">
                        <span className="px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-900 font-bold text-[10px] border border-emerald-300">
                          {t.status}
                        </span>
                      </td>
                      <td className="py-2.5 px-3 text-slate-600 font-mono text-[11px]">{t.contact}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* Printable Official Signatures Footer */}
        <div className="hidden print:grid grid-cols-3 gap-8 mt-16 pt-8 border-t-2 border-slate-900 text-center text-xs">
          <div>
            <div className="border-b border-slate-500 pb-8 mb-2"></div>
            <span className="font-bold text-slate-900 block uppercase">O Diretor Pedagógico</span>
            <span className="text-[10px] text-slate-600">Homologação Curricular & Pautas</span>
          </div>
          <div>
            <div className="border-b border-slate-500 pb-8 mb-2"></div>
            <span className="font-bold text-slate-900 block uppercase">O Chefe de Secretaria</span>
            <span className="text-[10px] text-slate-600">Conformidade e Registo Oficial</span>
          </div>
          <div>
            <div className="border-b border-slate-500 pb-8 mb-2"></div>
            <span className="font-bold text-slate-900 block uppercase">A Direção Geral</span>
            <span className="text-[10px] text-slate-600">Assinatura e Carimbo em Branco</span>
          </div>
        </div>
      </div>

      {/* MODAL: Pré-Visualização e Impressão Oficial A4 */}
      {isPrintModalOpen && (
        <div className="printable-modal-overlay fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-2 sm:p-4 backdrop-blur-xs overflow-y-auto print:p-0 print:m-0 print:block">
          <style>{`
            @media print {
              @page {
                size: A4 landscape !important;
                margin: 5mm !important;
              }
              * {
                -webkit-print-color-adjust: exact !important;
                print-color-adjust: exact !important;
              }
              body {
                background: white !important;
                margin: 0 !important;
                padding: 0 !important;
              }
              table {
                width: 100% !important;
                border-collapse: collapse !important;
                page-break-inside: auto !important;
              }
              tr {
                page-break-inside: avoid !important;
                page-break-after: auto !important;
              }
              thead {
                display: table-header-group !important;
              }
              tfoot {
                display: table-footer-group !important;
              }
            }
          `}</style>
          <div className="bg-white rounded-2xl w-full max-w-5xl shadow-2xl border border-slate-300 my-auto flex flex-col max-h-[92vh] print:m-0 print:border-none print:shadow-none print:max-h-none print:w-full">
            {/* Modal Header (Hidden during print) */}
            <div className="flex items-center justify-between px-6 py-3.5 border-b border-slate-200 bg-slate-50 rounded-t-2xl print:hidden">
              <div className="flex items-center gap-2">
                <span className="material-symbols-outlined text-[#0b1f3a] text-2xl">print</span>
                <div>
                  <h3 className="font-bold text-sm text-slate-900">
                    Pré-Visualização de Impressão
                  </h3>
                  <p className="text-[11px] text-slate-500">
                  </p>
                </div>
              </div>

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setIsPrintModalOpen(false)}
                  className="p-1.5 text-slate-400 hover:text-slate-700 rounded-lg hover:bg-slate-200 transition-colors cursor-pointer ml-2"
                  title="Fechar"
                >
                  <span className="material-symbols-outlined text-xl">close</span>
                </button>
              </div>
            </div>

            {/* Document Body to Print */}
            <div className="printable-document printable-page printable-report overflow-y-auto p-6 sm:p-8 bg-white text-slate-900 print:p-0 print:m-0 print:overflow-visible">
              {/* Official Angolan Header */}
              <div className="text-center pb-3 mb-4 border-b-2 border-slate-900">
                <img
                  src={db.settings?.logoUrl || '/school_emblem.png'}
                  alt={db.settings?.schoolName || 'Logótipo da Instituição'}
                  className="w-14 h-14 object-contain mx-auto mb-2"
                  referrerPolicy="no-referrer"
                />
                <div className="text-[9px] font-bold tracking-widest uppercase text-slate-700">
                  REPÚBLICA DE ANGOLA • MINISTÉRIO DA EDUCAÇÃO
                </div>
                <div className="text-[10px] font-semibold text-slate-800">
                  GOVERNO PROVINCIAL • DIRECÇÃO MUNICIPAL DA EDUCAÇÃO
                </div>
                <h1 className="text-lg sm:text-xl font-black uppercase tracking-tight text-[#0b1f3a] mt-1">
                  {db.settings?.schoolName || 'Instituto Médio Politécnico BandMed'}
                </h1>
                <h2 className="text-xs sm:text-sm font-bold text-slate-800 mt-0.5 uppercase tracking-wide">
                  {getReportTitle(printTarget)}
                </h2>

                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mt-3 pt-2 border-t border-slate-200 text-[10px] text-slate-700 font-mono">
                  <div className="p-1 bg-slate-50 rounded border border-slate-200">
                    <span className="text-[8px] uppercase font-bold text-slate-500 block">Ano Letivo:</span>
                    <strong>{selectedAcademicYear}</strong>
                  </div>
                  <div className="p-1 bg-slate-50 rounded border border-slate-200">
                    <span className="text-[8px] uppercase font-bold text-slate-500 block">Período:</span>
                    <strong>{selectedTrimester === 'todos' ? 'Anual Consolidado' : `${selectedTrimester}.º Trimestre`}</strong>
                  </div>
                  <div className="p-1 bg-slate-50 rounded border border-slate-200">
                    <span className="text-[8px] uppercase font-bold text-slate-500 block">NIF & Alvará:</span>
                    <strong>{db.settings?.nif || '5000389124'}</strong>
                  </div>
                  <div className="p-1 bg-slate-50 rounded border border-slate-200">
                    <span className="text-[8px] uppercase font-bold text-slate-500 block">Data de Emissão:</span>
                    <strong>{currentDateFormatted}</strong>
                  </div>
                </div>
              </div>

              {/* Table rendering based on printTarget */}
              {printTarget === 'aproveitamento' && (
                <AproveitamentoStatsTable
                  rows={aproveitamentoData}
                  totals={aproveitamentoTotals.totals}
                  subjectLabel={selectedSubject?.name}
                  compact
                />
              )}

              {printTarget === 'financeiro' && (
                <div className="overflow-x-auto print:overflow-visible w-full">
                  <table className="w-full text-left text-xs border border-slate-400 border-collapse print:text-[7.5pt] print:table-auto">
                    <thead>
                      <tr className="bg-[#0b1f3a] text-white font-bold uppercase text-[9.5px] print:text-[7.5pt] tracking-wider border-b-2 border-slate-900 print:bg-[#0b1f3a] print:text-white">
                        <th className="py-2 px-2.5 border-r border-slate-600 print:border-slate-500">Sub-sistema / Ciclo Curricular</th>
                        <th className="py-2 px-2.5 text-right border-r border-slate-600 print:border-slate-500">Mensalidade Média</th>
                        <th className="py-2 px-2 text-center border-r border-slate-600 print:border-slate-500">Alunos</th>
                        <th className="py-2 px-2.5 text-right border-r border-slate-600 print:border-slate-500 bg-[#12335e] text-blue-200 print:bg-[#12335e] print:text-blue-200">Previsto Total (Kz)</th>
                        <th className="py-2 px-2.5 text-right border-r border-slate-600 print:border-slate-500 bg-[#0d3b2b] text-emerald-200 print:bg-[#0d3b2b] print:text-emerald-200">Cobrado Efetivo (Kz)</th>
                        <th className="py-2 px-2.5 text-right border-r border-slate-600 print:border-slate-500 bg-[#5c0d0d] text-rose-200 print:bg-[#5c0d0d] print:text-rose-200">Em Dívida (Kz)</th>
                        <th className="py-2 px-2 text-center">Eficácia</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-300">
                      {financeiroData.map((row, idx) => (
                        <tr
                          key={row.subsystemId}
                          className={`border-b border-slate-300 ${
                            idx % 2 === 1 ? 'bg-[#f8fafc]' : 'bg-white'
                          }`}
                        >
                          <td className="py-1.5 px-2.5 font-bold text-[#0b1f3a] border-r border-slate-300">
                            {row.subsystemName}
                          </td>
                          <td className="py-1.5 px-2.5 text-right font-mono border-r border-slate-300">
                            {row.monthlyTuition.toLocaleString('pt-AO')} Kz
                          </td>
                          <td className="py-1.5 px-2 text-center font-semibold border-r border-slate-300">
                            {row.studentCount}
                          </td>
                          <td className="py-1.5 px-2.5 text-right font-mono font-semibold text-slate-800 border-r border-slate-300">
                            {row.previstoTotalKz.toLocaleString('pt-AO')} Kz
                          </td>
                          <td className="py-1.5 px-2.5 text-right font-mono font-bold text-emerald-800 bg-emerald-50/70 border-r border-slate-300">
                            {row.cobradoKz.toLocaleString('pt-AO')} Kz
                          </td>
                          <td className="py-1.5 px-2.5 text-right font-mono font-bold text-[#7a0c0c] bg-rose-50/70 border-r border-slate-300">
                            {row.emMoraKz.toLocaleString('pt-AO')} Kz
                          </td>
                          <td className="py-1.5 px-2 text-center font-mono font-bold text-emerald-800">
                            {row.taxaExecucao}%
                          </td>
                        </tr>
                      ))}
                      <tr className="bg-[#0b1f3a] text-white font-bold border-t-2 border-slate-900 print:bg-[#0b1f3a] print:text-white">
                        <td className="py-2.5 px-2.5 uppercase text-white border-r border-slate-600 print:border-slate-500">
                          TOTAL GERAL
                        </td>
                        <td className="py-2.5 px-2.5 text-right font-mono border-r border-slate-600 print:border-slate-500">—</td>
                        <td className="py-2.5 px-2 text-center font-mono border-r border-slate-600 print:border-slate-500">
                          {financeiroTotals.totalAlunos}
                        </td>
                        <td className="py-2.5 px-2.5 text-right font-mono text-blue-200 border-r border-slate-600 print:border-slate-500">
                          {financeiroTotals.totalPrevisto.toLocaleString('pt-AO')} Kz
                        </td>
                        <td className="py-2.5 px-2.5 text-right font-mono bg-emerald-900 text-emerald-100 border-r border-slate-600 print:border-slate-500">
                          {financeiroTotals.totalCobrado.toLocaleString('pt-AO')} Kz
                        </td>
                        <td className="py-2.5 px-2.5 text-right font-mono bg-[#7a0c0c] text-amber-300 border-r border-slate-600 print:border-slate-500">
                          {financeiroTotals.totalMora.toLocaleString('pt-AO')} Kz
                        </td>
                        <td className="py-2.5 px-2 text-center font-mono font-bold text-emerald-300">
                          {financeiroTotals.taxaGeral}%
                        </td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              )}

              {printTarget === 'assiduidade' && (
                <div className="overflow-x-auto print:overflow-visible w-full">
                  <table className="w-full text-left text-xs border border-slate-400 border-collapse print:text-[7.5pt] print:table-auto">
                    <thead>
                      <tr className="bg-[#0b1f3a] text-white font-bold uppercase text-[9.5px] print:text-[7.5pt] tracking-wider border-b-2 border-slate-900 print:bg-[#0b1f3a] print:text-white">
                        <th className="py-2 px-2.5 border-r border-slate-600 print:border-slate-500">Turma & Classe</th>
                        <th className="py-2 px-2 border-r border-slate-600 print:border-slate-500">Turno</th>
                        <th className="py-2 px-2 text-center border-r border-slate-600 print:border-slate-500">Alunos</th>
                        <th className="py-2 px-2 text-center border-r border-slate-600 print:border-slate-500">Sessões</th>
                        <th className="py-2 px-2 text-center border-r border-slate-600 print:border-slate-500 bg-[#0d3b2b] text-emerald-200 print:bg-[#0d3b2b] print:text-emerald-200">Assiduidade</th>
                        <th className="py-2 px-2 text-center border-r border-slate-600 print:border-slate-500 bg-[#5c0d0d] text-rose-200 print:bg-[#5c0d0d] print:text-rose-200">Faltas Injust.</th>
                        <th className="py-2 px-2 text-center border-r border-slate-600 print:border-slate-500">Faltas Just.</th>
                        <th className="py-2 px-2 text-center border-r border-slate-600 print:border-slate-500 bg-[#7a0c0c] text-amber-200 print:bg-[#7a0c0c] print:text-amber-200">Alunos Risco</th>
                        <th className="py-2 px-2.5">Diretor de Turma</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-300">
                      {assiduidadeData.map((row, idx) => (
                        <tr
                          key={row.classId}
                          className={`border-b border-slate-300 ${
                            idx % 2 === 1 ? 'bg-[#f8fafc]' : 'bg-white'
                          }`}
                        >
                          <td className="py-1.5 px-2.5 font-bold text-[#0b1f3a] border-r border-slate-300">
                            {row.className}
                          </td>
                          <td className="py-1.5 px-2 text-slate-700 border-r border-slate-300">{row.shift}</td>
                          <td className="py-1.5 px-2 text-center font-semibold border-r border-slate-300">
                            {row.studentCount}
                          </td>
                          <td className="py-1.5 px-2 text-center font-mono border-r border-slate-300">
                            {row.registeredSessions}
                          </td>
                          <td className="py-1.5 px-2 text-center font-bold text-emerald-800 bg-emerald-50/70 border-r border-slate-300">
                            {row.avgRate}%
                          </td>
                          <td className="py-1.5 px-2 text-center font-mono font-bold text-[#7a0c0c] bg-rose-50/70 border-r border-slate-300">
                            {row.unjustifiedAbsences}
                          </td>
                          <td className="py-1.5 px-2 text-center font-mono text-slate-700 border-r border-slate-300">
                            {row.justifiedAbsences}
                          </td>
                          <td className="py-1.5 px-2 text-center border-r border-slate-300">
                            {row.atRiskCount > 0 ? (
                              <span className="font-bold text-[#7a0c0c] font-mono">{row.atRiskCount}</span>
                            ) : (
                              <span className="text-slate-400 font-mono">0</span>
                            )}
                          </td>
                          <td className="py-1.5 px-2.5 text-slate-800">{row.director}</td>
                        </tr>
                      ))}
                      <tr className="bg-[#0b1f3a] text-white font-bold border-t-2 border-slate-900 print:bg-[#0b1f3a] print:text-white">
                        <td className="py-2.5 px-2.5 uppercase text-white border-r border-slate-600 print:border-slate-500">
                          TOTAL
                        </td>
                        <td className="py-2.5 px-2 text-slate-300 border-r border-slate-600 print:border-slate-500">
                          {assiduidadeTotals.totalTurmas} Turmas
                        </td>
                        <td className="py-2.5 px-2 text-center font-mono border-r border-slate-600 print:border-slate-500">
                          {assiduidadeTotals.totalAlunos}
                        </td>
                        <td className="py-2.5 px-2 text-center font-mono border-r border-slate-600 print:border-slate-500">—</td>
                        <td className="py-2.5 px-2 text-center font-mono bg-emerald-900 text-emerald-100 font-bold border-r border-slate-600 print:border-slate-500">
                          {assiduidadeTotals.avgAssiduidade}%
                        </td>
                        <td className="py-2.5 px-2 text-center font-mono bg-[#5c0d0d] text-rose-100 font-bold border-r border-slate-600 print:border-slate-500">
                          {assiduidadeTotals.totalFaltasInj}
                        </td>
                        <td className="py-2.5 px-2 text-center font-mono text-slate-300 border-r border-slate-600 print:border-slate-500">
                          {assiduidadeTotals.totalFaltasJust}
                        </td>
                        <td className="py-2.5 px-2 text-center font-mono bg-[#7a0c0c] text-amber-300 font-black border-r border-slate-600 print:border-slate-500">
                          {assiduidadeTotals.totalRisco}
                        </td>
                        <td className="py-2.5 px-2.5 text-slate-400">—</td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              )}

              {printTarget === 'docentes' && (
                <div className="overflow-x-auto print:overflow-visible w-full">
                  <table className="w-full text-left text-xs border border-slate-400 border-collapse print:text-[7.5pt] print:table-auto">
                    <thead>
                      <tr className="bg-[#0b1f3a] text-white font-bold uppercase text-[9.5px] print:text-[7.5pt] tracking-wider border-b-2 border-slate-900 print:bg-[#0b1f3a] print:text-white">
                        <th className="py-2 px-2.5 border-r border-slate-600 print:border-slate-500">Nome do Docente</th>
                        <th className="py-2 px-2.5 border-r border-slate-600 print:border-slate-500">Grau Académico</th>
                        <th className="py-2 px-2.5 border-r border-slate-600 print:border-slate-500">Disciplinas Lecionadas</th>
                        <th className="py-2 px-2.5 border-r border-slate-600 print:border-slate-500">Turmas Atribuídas</th>
                        <th className="py-2 px-2 text-center border-r border-slate-600 print:border-slate-500">Carga Semanal</th>
                        <th className="py-2 px-2 text-center border-r border-slate-600 print:border-slate-500 bg-[#0d3b2b] text-emerald-200 print:bg-[#0d3b2b] print:text-emerald-200">Assiduidade</th>
                        <th className="py-2 px-2 text-center border-r border-slate-600 print:border-slate-500">Estatuto</th>
                        <th className="py-2 px-2.5">Contacto</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-300">
                      {docentesData.map((t, idx) => (
                        <tr
                          key={t.id}
                          className={`border-b border-slate-300 ${
                            idx % 2 === 1 ? 'bg-[#f8fafc]' : 'bg-white'
                          }`}
                        >
                          <td className="py-1.5 px-2.5 font-bold text-[#0b1f3a] border-r border-slate-300">{t.name}</td>
                          <td className="py-1.5 px-2.5 text-slate-700 border-r border-slate-300">{t.degree}</td>
                          <td className="py-1.5 px-2.5 text-slate-800 border-r border-slate-300">{t.subjects}</td>
                          <td className="py-1.5 px-2.5 text-slate-700 border-r border-slate-300">{t.classes}</td>
                          <td className="py-1.5 px-2 text-center font-mono font-bold text-slate-900 border-r border-slate-300">
                            {t.weeklyHours}
                          </td>
                          <td className="py-1.5 px-2 text-center font-bold text-emerald-800 bg-emerald-50/70 border-r border-slate-300">
                            {t.attendanceRate}
                          </td>
                          <td className="py-1.5 px-2 text-center border-r border-slate-300 font-semibold">{t.status}</td>
                          <td className="py-1.5 px-2.5 font-mono text-[10px] text-slate-600">{t.contact}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              {/* Official 3-signature Footer */}
              <div className="grid grid-cols-3 gap-8 mt-10 pt-5 border-t-2 border-slate-900 text-center text-xs">
                <div>
                  <div className="border-b border-slate-500 pb-8 mb-2"></div>
                  <span className="font-bold text-slate-900 block uppercase text-[10.5px]">O Diretor Pedagógico</span>
                  <span className="text-[9.5px] text-slate-600"></span>
                </div>
                <div>
                  <div className="border-b border-slate-500 pb-8 mb-2"></div>
                  <span className="font-bold text-slate-900 block uppercase text-[10.5px]">A Secretaria</span>
                  <span className="text-[9.5px] text-slate-600"></span>
                </div>
                <div>
                  <div className="border-b border-slate-500 pb-8 mb-2"></div>
                  <span className="font-bold text-slate-900 block uppercase text-[10.5px]">A Direcção Geral</span>
                  <span className="text-[9.5px] text-slate-600"></span>
                </div>
              </div>
            </div>

            {/* Modal Footer on Screen (Hidden on Print) */}
            <div className="flex items-center justify-between px-6 py-3 border-t border-slate-200 bg-slate-50 rounded-b-2xl print:hidden">
              <span className="text-xs text-slate-500">
              </span>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setIsPrintModalOpen(false)}
                  className="px-4 py-1.5 rounded-xl border border-slate-300 bg-white hover:bg-slate-100 text-slate-700 text-xs font-bold transition-colors cursor-pointer"
                >
                  Fechar
                </button>
                <button
                  type="button"
                  onClick={handleExecuteBrowserPrint}
                  className="px-5 py-1.5 rounded-xl bg-[#0b1f3a] hover:bg-[#15345d] text-white text-xs font-bold flex items-center gap-1.5 shadow-sm transition-colors cursor-pointer"
                >
                  <span className="material-symbols-outlined text-[16px]">print</span>
                  <span>Imprimir</span>
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

/** Página própria "Relatórios → Listagem" (item do menu). */
export const ListagemView: React.FC<RelatoriosViewProps> = ({ db, currentUserRole }) => {
  const acl = useAccessControl(currentUserRole);
  return (
    <div className="flex flex-col w-full gap-6 pb-12">
      <div className="print:hidden">
        <div className="flex items-center gap-2 mb-1">
          <span className="text-[11px] font-bold uppercase tracking-widest text-slate-500">RELATÓRIOS</span>
          <span className="w-1.5 h-1.5 rounded-full bg-[#0b1f3a]" />
          <span className="text-xs font-semibold text-[#0b1f3a]">LISTAGEM DE DADOS</span>
        </div>
        <h1 className="font-headline text-2xl lg:text-3xl font-extrabold text-[#0b1f3a] tracking-tight">LISTAGEM</h1>
      </div>
      <ListagemPanel db={db} canRule={acl.can} />
    </div>
  );
};
