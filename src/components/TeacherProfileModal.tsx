import React from 'react';
import { Teacher, ClassRoom, InstitutionSettings } from '../types';
import { dbService } from '../services/db';
import { computeTeacherPerformance } from '../utils/teacherPerformance';
import { getTeacherCurricularDistribution } from '../utils/teacherSubjects';

interface TeacherProfileModalProps {
  teacher: Teacher;
  classList: ClassRoom[];
  onClose: () => void;
  settings?: InstitutionSettings;
}

export const TeacherProfileModal: React.FC<TeacherProfileModalProps> = ({
  teacher,
  classList,
  onClose,
  settings,
}) => {
  // Sempre reflete os Dados da Instituição definidos em Configurações
  const institution = settings || dbService.getSettings();
  // Indicadores de desempenho calculados a partir de dados reais (chamadas, pautas homologadas
  // e notas já lançadas) — nunca valores fictícios.
  const snapshot = dbService.getSnapshot();
  const perf = computeTeacherPerformance(teacher, snapshot);

  // A Distribuição Curricular é derivada da Grelha Horária real (db.timetable).
  // `teacher.allocatedClasses` é apenas um fallback: fica frequentemente vazio porque
  // a atribuição é feita na Grelha Horária e não no formulário do docente.
  const derivedDistribution = getTeacherCurricularDistribution(snapshot, teacher);
  const curricularDistribution =
    derivedDistribution.length > 0 ? derivedDistribution : (teacher.allocatedClasses || []);

  // Carga horária semanal real = soma das horas de todas as alocações da grelha.
  const derivedWeeklyHours = curricularDistribution.reduce(
    (acc, ac) => acc + (Number(ac.hoursWeekly) || 0),
    0
  );
  const weeklyHoursDisplay =
    derivedWeeklyHours > 0 ? Math.round(derivedWeeklyHours * 10) / 10 : (teacher.weeklyHours || 0);

  // Disciplinas distintas efetivamente lecionadas por este docente.
  const taughtSubjects = Array.from(
    new Set(curricularDistribution.map((ac) => ac.subject).filter(Boolean))
  );

  // Disciplinas leccionadas, agregadas: uma linha por disciplina com a carga horária
  // semanal somada e as turmas onde é leccionada.
  const subjectWorkload = React.useMemo(() => {
    const map = new Map<string, { subject: string; hoursWeekly: number; classNames: string[] }>();
    curricularDistribution.forEach((ac) => {
      if (!ac.subject) return;
      const existing = map.get(ac.subject);
      if (existing) {
        existing.hoursWeekly += Number(ac.hoursWeekly) || 0;
        if (ac.className && !existing.classNames.includes(ac.className)) {
          existing.classNames.push(ac.className);
        }
      } else {
        map.set(ac.subject, {
          subject: ac.subject,
          hoursWeekly: Number(ac.hoursWeekly) || 0,
          classNames: ac.className ? [ac.className] : []
        });
      }
    });
    return Array.from(map.values())
      .map((item) => ({ ...item, hoursWeekly: Math.round(item.hoursWeekly * 10) / 10 }))
      .sort((a, b) => a.subject.localeCompare(b.subject));
  }, [curricularDistribution]);

  // Turmas de que este docente é efetivamente Diretor(a) de Turma.
  const headOfClasses = React.useMemo(
    () =>
      (classList || []).filter(
        (c) =>
          (c.headTeacherId && String(c.headTeacherId) === String(teacher.id)) ||
          (c.headTeacherName &&
            c.headTeacherName.trim().toLowerCase() === teacher.name.trim().toLowerCase())
      ),
    [classList, teacher.id, teacher.name]
  );

  const handlePrint = () => {
    window.focus();
    window.print();
  };

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-xs z-50 flex items-start justify-center p-3 sm:p-4 printable-modal-overlay overflow-y-auto print:p-0 print:m-0 print:block">
      <style>{`
        @media print {
          @page {
            size: A4 portrait !important;
            margin: 8mm 8mm !important;
          }
        }
      `}</style>
      <div className="printable-document printable-portrait bg-white rounded-none max-w-4xl w-full shadow-2xl border border-slate-400 overflow-hidden flex flex-col my-4 print:my-0 print:border-none print:shadow-none print:w-full">
        {/* Modal Top Controls (Oculto na impressão) */}
        <div className="px-6 py-3 bg-[#0b1f3a] text-white flex items-center justify-between gap-3 border-b border-slate-700 no-print">
          <div className="flex items-center gap-2">
            <span className="material-symbols-outlined text-[20px] text-amber-400">badge</span>
            <h3 className="font-bold text-sm sm:text-base tracking-wide uppercase">
              Ficha de Perfil do Professor
            </h3>
          </div>

          <div className="flex items-center">
            <button
              type="button"
              onClick={onClose}
              className="text-slate-300 hover:text-white p-1 cursor-pointer transition-colors"
              title="Fechar Janela"
              aria-label="Fechar Janela"
            >
              <span className="material-symbols-outlined text-[22px]">close</span>
            </button>
          </div>
        </div>

        {/* Modal Body - Folha A4 formatada conforme Imagem 2 */}
        <div className="p-6 sm:p-8 space-y-4 text-slate-800 bg-white text-xs">
          {/* Header Institucional da Imagem 2 */}
          <div className="border-b-2 border-[#0b1f3a] pb-3 print-break-avoid">
            <div className="flex flex-wrap items-center justify-between gap-4">
              {/* Logo BM e Título */}
              <div className="flex items-center gap-3">
                <div className="w-12 h-12 bg-[#0b1f3a] border border-[#0b1f3a] flex items-center justify-center shrink-0 shadow-xs overflow-hidden">
                  <img
                    src={institution.logoUrl || '/school_emblem.png'}
                    alt={institution.schoolName}
                    className="w-full h-full object-cover"
                    referrerPolicy="no-referrer"
                  />
                </div>
                <div>
                  <h1 className="text-base sm:text-lg font-black text-[#0b1f3a] uppercase tracking-tight">
                    {institution.schoolName}
                  </h1>
                  <p className="text-[11px] font-semibold text-[#0b1f3a]/80">
                    Direcção Pedagógica & Gabinete de Recursos Humanos
                  </p>
                </div>
              </div>

              {/* Badges de Autenticação à Direita */}
              <div className="text-right flex flex-col items-end gap-0.5">
                <span className="px-2.5 py-0.5 bg-slate-100 border border-slate-300 font-mono text-[11px] font-bold text-slate-800">
                  DOC-RH/{new Date().getFullYear()}/{String(teacher.agentNumber || '042').replace(/\D/g, '').slice(-3).padStart(3, '0')}
                </span>
                <span className="text-[10px] text-slate-500 font-medium">
                  Data de Emissão: {new Date().toLocaleDateString('pt-PT')}
                </span>
                <span className="inline-flex items-center gap-1 text-[10px] font-bold text-emerald-700">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-600"></span>
                  <span>Documento Autenticado</span>
                </span>
              </div>
            </div>

            {/* Sub-faixa com Ícone de Dossier e Decreto */}
            <div className="mt-3 pt-2 border-t border-slate-200 flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <span className="w-6 h-6 rounded-none bg-amber-100 text-amber-800 flex items-center justify-center border border-amber-300">
                  <span className="material-symbols-outlined text-[16px]">assignment</span>
                </span>
                <span className="font-extrabold text-xs uppercase text-[#0b1f3a] tracking-wide">
                FICHA DE CADASTRO DE CARREIRA
                </span>
              </div>
              <span className="px-2.5 py-0.5 bg-slate-100 border border-slate-300 text-[10px] font-semibold text-slate-600">
              </span>
            </div>
          </div>

          {/* Cartão de Identificação do Docente (Imagem 2) */}
          <div className="p-3.5 bg-slate-50 border border-slate-300 flex flex-col md:flex-row items-start md:items-center justify-between gap-4 print-break-avoid">
            <div className="flex items-center gap-3.5">
              {/* Foto */}
              <div className="relative shrink-0">
                <div className="w-16 h-20 bg-slate-200 border-2 border-[#0b1f3a] overflow-hidden">
                  <img
                    src={teacher.avatar}
                    alt={teacher.name}
                    className="w-full h-full object-cover object-center"
                    onError={(e) => {
                      (e.target as HTMLElement).style.display = 'none';
                    }}
                  />
                </div>
              </div>

              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <h2 className="text-base sm:text-lg font-black text-[#0b1f3a]">
                    {teacher.name.startsWith('Prof') || teacher.name.startsWith('Dr') ? teacher.name : `Prof. ${teacher.name}`}
                  </h2>
                  <span className="px-2 py-0.5 text-[10px] font-bold uppercase bg-rose-50 text-rose-700 border border-rose-300">
                    {teacher.roleBadge || 'Não definido'}
                  </span>
                </div>
                <p className="text-xs font-semibold text-slate-700 mt-0.5">
                  {taughtSubjects.length > 0
                    ? taughtSubjects.join(' • ')
                    : teacher.department || 'Sem departamento definido'}
                </p>
                <p className="text-[11px] text-slate-600 font-mono mt-1">
                  N.º Agente: <strong className="text-slate-900">{teacher.agentNumber || 'Não preenchido'}</strong> • BI: <strong className="text-slate-900">{teacher.biNumber || 'Não preenchido'}</strong> • NIF: <strong className="text-slate-900">{teacher.nif || 'Não preenchido'}</strong>
                </p>
              </div>
            </div>

            {/* Antiguidade e Desempenho à Direita */}
            <div className="flex flex-wrap md:flex-col items-start md:items-end gap-2 shrink-0 text-xs">
              <div className="px-3 py-1 bg-white border border-slate-300 text-slate-700">
                <span className="text-[10px] font-bold text-slate-500 uppercase block">ANTIGUIDADE:</span>
                {teacher.seniorityYears !== undefined ? (
                  <span className="font-bold text-slate-900">{teacher.seniorityYears} Anos</span>
                ) : (
                  <span className="text-slate-500 italic">Não calculado</span>
                )}{' '}
                {teacher.admissionYear && (
                  <span className="text-slate-500 text-[10px]">(Admitido {teacher.admissionYear})</span>
                )}
              </div>
              {teacher.evaluationsCount > 0 && (
                <div className="px-3 py-1 bg-emerald-50 border border-emerald-300 text-emerald-900">
                  <span className="text-[10px] font-bold text-emerald-700 uppercase block">DESEMPENHO:</span>
                  <span className="font-bold">★ {teacher.rating.toFixed(1)} / 5.0</span>{' '}
                  <span className="px-1.5 py-0.2 bg-emerald-200/60 text-emerald-900 text-[9px] font-bold uppercase">
                    {teacher.rating >= 4.8 ? 'Excelente' : 'Muito Bom'}
                  </span>
                </div>
              )}
            </div>
          </div>

          {/* 1. DADOS PESSOAIS & CARREIRA PROFISSIONAL (Conforme Imagem 2) */}
          <div className="border border-slate-300 bg-white print-break-avoid">
            <div className="bg-slate-100 border-b border-slate-300 px-3 py-1.5 flex items-center gap-2">
              <span className="w-5 h-5 bg-[#0b1f3a] text-white flex items-center justify-center font-black text-[11px]">
                1
              </span>
              <h4 className="font-bold text-xs uppercase tracking-wide text-[#0b1f3a]">
                DADOS PESSOAIS & CARREIRA PROFISSIONAL
              </h4>
            </div>

            <div className="p-3.5 grid grid-cols-1 md:grid-cols-3 gap-3.5 text-xs">
              <div className="space-y-2">
                <div>
                  <span className="block text-[10px] font-bold text-slate-500 uppercase">Data de Admissão:</span>
                  <span className="font-semibold text-slate-900">{teacher.admissionDate || 'Não preenchido'}</span>
                </div>
                <div>
                  <span className="block text-[10px] font-bold text-slate-500 uppercase">Habilitações Literárias & Especialização:</span>
                  <span className="font-semibold text-slate-900 leading-snug block">
                    {teacher.degree || 'Não preenchido'}
                  </span>
                </div>
                <div>
                  <span className="block text-[10px] font-bold text-slate-500 uppercase">Morada de Residência:</span>
                  <span className="text-slate-800 leading-snug block">
                    {teacher.address || 'Não preenchido'}
                  </span>
                </div>
              </div>

              <div className="space-y-2">
                <div>
                  <span className="block text-[10px] font-bold text-slate-500 uppercase">Categoria Profissional:</span>
                  <span className="font-semibold text-slate-900 block">{teacher.category || 'Não preenchido'}</span>
                </div>
              </div>

              <div className="space-y-2">
                <div>
                  <span className="block text-[10px] font-bold text-slate-500 uppercase">Regime de Segurança Social:</span>
                  <span className="font-semibold text-slate-900">
                    INSS: {teacher.inssNumber ? `${teacher.inssNumber} (Activo)` : 'Não preenchido'}
                  </span>
                </div>
                <div>
                  <span className="block text-[10px] font-bold text-slate-500 uppercase">Contacto Telefónico:</span>
                  <span className="font-mono font-bold text-[#0b1f3a]">{teacher.phone || 'Não preenchido'}</span>
                </div>
                <div>
                  <span className="block text-[10px] font-bold text-slate-500 uppercase">E-mail Institucional:</span>
                  <span className="font-mono text-slate-800">{teacher.email || 'Não preenchido'}</span>
                </div>
              </div>
            </div>
          </div>

          {/* 2. ESTRUTURA REMUNERATÓRIA & DOMICILIAÇÃO BANCÁRIA (Conforme Imagem 2) */}
          <div className="border border-slate-300 bg-white print-break-avoid">
            <div className="bg-slate-100 border-b border-slate-300 px-3 py-1.5 flex items-center gap-2">
              <span className="w-5 h-5 bg-[#0b1f3a] text-white flex items-center justify-center font-black text-[11px]">
                2
              </span>
              <h4 className="font-bold text-xs uppercase tracking-wide text-[#0b1f3a]">
                ESTRUTURA REMUNERATÓRIA & DOMICILIAÇÃO BANCÁRIA
              </h4>
            </div>

            <div className="p-3.5 space-y-3">
              {/* 3 Cartões de Vencimento */}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div className="p-3 bg-slate-50 border border-slate-200">
                  <span className="block text-[10px] font-bold uppercase text-slate-500">SALÁRIO BASE MENSAL</span>
                  <span className="block font-mono font-black text-base text-[#0b1f3a] my-0.5">
                    Kz {(teacher.baseSalaryKz || 0).toLocaleString('pt-PT', { minimumFractionDigits: 2 })}
                  </span>
                  <span className="text-[10px] text-slate-500">Vencimento líquido contratual</span>
                </div>

                <div className="p-3 bg-slate-50 border border-slate-200">
                  <span className="block text-[10px] font-bold uppercase text-slate-500">SUBSÍDIOS / COMPLEMENTOS</span>
                  <span className="block font-mono font-bold text-base text-slate-800 my-0.5">
                    Kz {(teacher.allowancesKz || 0).toLocaleString('pt-PT', { minimumFractionDigits: 2 })}
                  </span>
                  <span className="text-[10px] text-slate-500">{teacher.allowanceDescription || 'Não preenchido'}</span>
                </div>

                <div className="p-3 bg-slate-50 border border-slate-200">
                  <span className="block text-[10px] font-bold uppercase text-slate-500">RETENÇÃO NA FONTE</span>
                  <span className="block font-mono font-bold text-base text-[#ac332b] my-0.5">
                    Kz {(teacher.retentionTaxKz || 0).toLocaleString('pt-PT', { minimumFractionDigits: 2 })}
                  </span>
                  <span className="text-[10px] text-slate-500">IRT & INSS Conforme AGT</span>
                </div>
              </div>

              {/* Domiciliação Bancária */}
              <div className="pt-2 border-t border-slate-200 grid grid-cols-1 sm:grid-cols-2 gap-3 items-center">
                <div>
                  <span className="block text-[10px] font-bold text-slate-500 uppercase">INSTITUIÇÃO BANCÁRIA HOMOLOGADA:</span>
                  <span className="font-bold text-slate-900">{teacher.bankName || 'Não preenchido'}</span>
                </div>
                <div>
                  <span className="block text-[10px] font-bold text-slate-500 uppercase">NÚMERO DE CONTA E IBAN ANGOLANO (KWANZA):</span>
                  <div className="flex items-center gap-1.5 mt-0.5">
                    {teacher.iban ? (
                      <>
                        <span className="material-symbols-outlined text-[16px] text-emerald-600">verified</span>
                        <span className="font-mono font-bold text-[#0b1f3a] bg-slate-100 px-2 py-0.5 border border-slate-300 text-xs">
                          {teacher.iban}
                        </span>
                      </>
                    ) : (
                      <span className="text-slate-500 italic text-xs">Não preenchido</span>
                    )}
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* 3. DESEMPENHO PEDAGÓGICO & ASSIDUIDADE (Conforme Imagem 2) */}
          <div className="border border-slate-300 bg-white print-break-avoid">
            <div className="bg-slate-100 border-b border-slate-300 px-3 py-1.5 flex items-center gap-2">
              <span className="w-5 h-5 bg-[#0b1f3a] text-white flex items-center justify-center font-black text-[11px]">
                3
              </span>
              <h4 className="font-bold text-xs uppercase tracking-wide text-[#0b1f3a]">
                DESEMPENHO PEDAGÓGICO & ASSIDUIDADE (ÚLTIMOS 12 MESES)
              </h4>
            </div>

            <div className="p-3.5 grid grid-cols-2 sm:grid-cols-4 gap-3 text-center">
              <div className="p-3 bg-slate-50 border border-slate-200">
                <span className="block text-[10px] font-bold uppercase text-slate-500">ASSIDUIDADE GERAL</span>
                <span className="block text-2xl font-black text-slate-900 my-0.5">
                  {perf.attendanceRatePercent !== null ? `${perf.attendanceRatePercent}%` : 'Sem dados'}
                </span>
                <span className="inline-block px-1.5 py-0.5 bg-emerald-100 text-emerald-800 text-[10px] font-bold">
                  {perf.unjustifiedAbsencesCount} Faltas Injustificadas
                </span>
              </div>

              <div className="p-3 bg-slate-50 border border-slate-200">
                <span className="block text-[10px] font-bold uppercase text-slate-500">PAUTAS A TEMPO</span>
                <span className="block text-2xl font-black text-[#0b1f3a] my-0.5">
                  {perf.timelyGradesPercent !== null ? `${perf.timelyGradesPercent}%` : 'Sem dados'}
                </span>
                <span className="inline-block px-1.5 py-0.5 bg-blue-100 text-blue-800 text-[10px] font-bold">
                  Pautas Homologadas
                </span>
              </div>

              <div className="p-3 bg-slate-50 border border-slate-200">
                <span className="block text-[10px] font-bold uppercase text-slate-500">TUTORIA DIRETA</span>
                <span className="block text-2xl font-black text-slate-900 my-0.5">
                  {perf.studentsTutoredCount}
                </span>
                <span className="inline-block px-1.5 py-0.5 bg-slate-200 text-slate-800 text-[10px] font-bold">
                  {perf.allocatedClassesCount} Turma{perf.allocatedClassesCount === 1 ? '' : 's'} Atribuída{perf.allocatedClassesCount === 1 ? '' : 's'}
                </span>
              </div>

              <div className="p-3 bg-slate-50 border border-slate-200">
                <span className="block text-[10px] font-bold uppercase text-slate-500">APROVEITAMENTO</span>
                <span className="block text-2xl font-black text-emerald-700 my-0.5">
                  {perf.averageApprovalRatePercent !== null ? `${perf.averageApprovalRatePercent}%` : 'Sem dados'}
                </span>
                <span className="inline-block px-1.5 py-0.5 bg-emerald-100 text-emerald-800 text-[10px] font-bold">
                  {perf.averageDisciplineGrade !== null ? `Média: ${perf.averageDisciplineGrade} / 20 Val.` : 'Sem notas lançadas'}
                </span>
              </div>
            </div>
          </div>

          {/* 4. DISTRIBUIÇÃO CURRICULAR & CARGA HORÁRIA LETIVA (Conforme Imagem 2) */}
          <div className="border border-slate-300 bg-white print-break-avoid">
            <div className="bg-slate-100 border-b border-slate-300 px-3 py-1.5 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="w-5 h-5 bg-[#0b1f3a] text-white flex items-center justify-center font-black text-[11px]">
                  4
                </span>
                <h4 className="font-bold text-xs uppercase tracking-wide text-[#0b1f3a]">
                  DISTRIBUIÇÃO CURRICULAR & CARGA HORÁRIA LETIVA
                </h4>
              </div>
              <span className="px-2 py-0.5 bg-white border border-slate-300 font-mono text-[10px] font-bold text-[#0b1f3a]">
                Carga Semanal: {weeklyHoursDisplay}h / Semana
              </span>
            </div>

            <div className="p-3.5 space-y-3">
              {/* Disciplinas leccionadas — agregadas por disciplina, com a carga horária
                  semanal total e as turmas onde é leccionada. */}
              <div>
                <span className="block text-[10px] font-bold uppercase text-slate-500 mb-1.5">
                  Disciplinas Leccionadas
                </span>
                {subjectWorkload.length > 0 ? (
                  <div className="border border-slate-300">
                    <table className="w-full text-xs border-collapse">
                      <thead>
                        <tr className="bg-slate-100 text-[10px] uppercase text-slate-600">
                          <th className="text-left font-bold px-2 py-1 border-b border-slate-300">Disciplina</th>
                          <th className="text-left font-bold px-2 py-1 border-b border-slate-300">Turmas</th>
                          <th className="text-right font-bold px-2 py-1 border-b border-slate-300 whitespace-nowrap">
                            Carga / Sem.
                          </th>
                        </tr>
                      </thead>
                      <tbody>
                        {subjectWorkload.map((item) => (
                          <tr key={item.subject} className="odd:bg-white even:bg-slate-50">
                            <td className="px-2 py-1.5 font-bold text-[#0b1f3a] border-b border-slate-200">
                              {item.subject}
                            </td>
                            <td className="px-2 py-1.5 text-slate-700 border-b border-slate-200">
                              {item.classNames.join(', ')}
                            </td>
                            <td className="px-2 py-1.5 text-right font-mono font-bold text-slate-900 border-b border-slate-200 whitespace-nowrap">
                              {item.hoursWeekly}h
                            </td>
                          </tr>
                        ))}
                      </tbody>
                      <tfoot>
                        <tr className="bg-slate-100">
                          <td className="px-2 py-1.5 font-bold uppercase text-[10px] text-slate-600" colSpan={2}>
                            Carga Horária Letiva Total
                          </td>
                          <td className="px-2 py-1.5 text-right font-mono font-black text-[#0b1f3a] whitespace-nowrap">
                            {weeklyHoursDisplay}h
                          </td>
                        </tr>
                      </tfoot>
                    </table>
                  </div>
                ) : (
                  <div className="text-center py-5 text-slate-400 text-xs border border-slate-200">
                    Este docente ainda não tem disciplinas atribuídas na Grelha Horária.
                  </div>
                )}
              </div>

              {/* Direção de Turma — apenas as turmas de que é efetivamente Diretor(a). */}
              <div>
                <span className="block text-[10px] font-bold uppercase text-slate-500 mb-1.5">
                  Direção de Turma
                </span>
                {headOfClasses.length > 0 ? (
                  <div className="flex flex-wrap gap-2">
                    {headOfClasses.map((cls) => (
                      <span
                        key={cls.id}
                        className="px-2.5 py-1 bg-slate-50 border border-slate-300 text-xs font-bold text-[#0b1f3a]"
                      >
                        {cls.name}
                        {cls.shift ? (
                          <span className="ml-1.5 font-normal text-[10px] text-slate-500">{cls.shift}</span>
                        ) : null}
                      </span>
                    ))}
                  </div>
                ) : (
                  <div className="text-xs text-slate-500 border border-slate-200 px-2 py-2">
                    Não é Diretor(a) de Turma no presente ano letivo.
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Assinaturas & Selo RH Oficial (Conforme Imagem 2) */}
          <div className="pt-4 border-t-2 border-[#0b1f3a] print-break-avoid">
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-6 items-end text-center">
              {/* Assinatura do Docente */}
              <div>
                <div className="font-serif italic text-base text-slate-700 h-8 flex items-end justify-center mb-1">
                </div>
                <div className="border-b border-dashed border-slate-400 mx-4 mb-1" />
                <span className="font-bold text-slate-900 uppercase block text-[11px]">
                  ASSINATURA DO DOCENTE
                </span>
                <span className="text-[10px] text-slate-500 block">
                  (Prof. {teacher.name.replace(/^Prof\.\s*/, '')})
                </span>
              </div>

              {/* Visto da Direcção Pedagógica */}
              <div>
                <div className="font-serif italic text-base text-[#0b1f3a] h-8 flex items-end justify-center mb-1">
                </div>
                <div className="border-b border-dashed border-slate-400 mx-4 mb-1" />
                <span className="font-bold text-[#0b1f3a] uppercase block text-[11px]">
                  VISTO DA DIRECÇÃO PEDAGÓGICA
                </span>
                <span className="text-[10px] text-slate-500 block">
                  ({institution.schoolName})
                </span>
              </div>
            </div>
          </div>
        </div>

        {/* Modal Footer (Oculto na impressão) */}
        <div className="px-6 py-3 bg-slate-100 border-t border-slate-300 flex items-center justify-end gap-3 no-print">
          <button
            type="button"
            onClick={handlePrint}
            className="flex items-center gap-1.5 px-4 py-2 bg-[#7a0c0c] hover:bg-[#5e0909] text-white font-bold text-xs border border-[#7a0c0c] cursor-pointer transition-colors shadow-xs"
            title="Abrir área de impressão do dispositivo"
          >
            <span className="material-symbols-outlined text-[16px]">print</span>
            <span>Imprimir</span>
          </button>
          <button
            type="button"
            onClick={onClose}
            className="px-5 py-2 bg-slate-300 hover:bg-slate-400 text-slate-800 font-bold text-xs cursor-pointer"
          >
            Fechar
          </button>
        </div>
      </div>
    </div>
  );
};
