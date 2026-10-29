import React, { useState, useMemo } from 'react';
import { SchoolDatabase, User, UserRole, Student, TuitionInvoice } from '../types';
import { dbService } from '../services/db';
import { runGlobalOperation } from '../context/OperationContext';
import { ReportCardModal } from '../components/ReportCardModal';
import { InvoiceReceiptModal } from '../components/InvoiceReceiptModal';
import { PayByReference } from '../components/PayByReference';
import { getFallbackAcademicYear, getAcademicYearStatus, academicYearStatusLabel } from '../utils/academicYear';
import {
  findMatriculaForYear,
  getLiveGradesYear,
  getStudentAcademicYears,
  getStudentArchiveForYear,
  getStudentRecordsForYear
} from '../utils/studentGrades';
import { normalizeGradeRules, recomputeTrimesterRecord } from '../utils/pautaCalculations';
import { resolveGuardianChildren, relationLabel, isStudentAdult } from '../utils/guardianLinks';
import { Notice } from '../components/Notice';

interface AlunoPortalViewProps {
  db: SchoolDatabase;
  currentUser: User;
  currentUserRole: UserRole;
  initialTab?: 'notas' | 'financeiro';
}

export const AlunoPortalView: React.FC<AlunoPortalViewProps> = ({
  db,
  currentUser,
  currentUserRole,
  initialTab
}) => {
  // Determine if viewing as Aluno or Encarregado
  const isEncarregado = currentUserRole === 'encarregado';

  // Default active tab based on role and preference
  const [activeTab, setActiveTab] = useState<'notas' | 'financeiro'>(() => {
    if (initialTab) return initialTab;
    return isEncarregado ? 'financeiro' : 'notas';
  });

  // O menu lateral decide o separador: acompanha a mudança de secção sem precisar dos botões.
  React.useEffect(() => {
    if (initialTab) setActiveTab(initialTab);
  }, [initialTab]);

  // Ano Lectivo Ativo — vem de Configurações > Ano Letivo (base de dados). As opções do
  // seletor (mais abaixo) são só os anos em que ESTE aluno tem registo real.
  const currentAcademicYear = db.settings?.currentAcademicYear || getFallbackAcademicYear();

  // Ano lectivo escolhido pelo utilizador (validado contra as opções reais mais abaixo) e trimestre
  const [requestedYear, setRequestedYear] = useState<string>(currentAcademicYear);
  const [selectedTrimester, setSelectedTrimester] = useState<number>(
    Number(db.settings?.currentTrimester || 1)
  ); // trimestre lectivo em vigência, de Configurações > Ano Letivo

  // Send Report Card modal
  const [isSendModalOpen, setIsSendModalOpen] = useState(false);
  const [isReportModalOpen, setIsReportModalOpen] = useState(false);
  const [customMessage, setCustomMessage] = useState(
    'Estimado(a) Encarregado(a), disponibilizo o meu boletim de aproveitamento escolar com as notas atualizadas na sua área para consulta e impressão.'
  );

  // Encarregado: educandos a que esta conta tem acesso (vínculos ativos + ficha, menos os
  // desvinculados). Ver utils/guardianLinks.ts — é a única porta de acesso dos filhos.
  const guardianChildren = useMemo(
    () => (currentUserRole === 'encarregado' ? resolveGuardianChildren(currentUser, db.students || [], db.guardianLinks || []) : []),
    [currentUser, currentUserRole, db.students, db.guardianLinks]
  );
  const [selectedChildId, setSelectedChildId] = useState<string>('');

  // Find the relevant student
  const student: Student | undefined = useMemo(() => {
    if (!db.students || db.students.length === 0) return undefined;

    if (currentUserRole === 'aluno') {
      // Find by process number or email or name
      const byProc = db.students.find(
        (s) => currentUser.processNumber && s.procNumber.toLowerCase() === currentUser.processNumber.toLowerCase()
      );
      if (byProc) return byProc;

      const byEmail = db.students.find(
        (s) => currentUser.email && s.email.toLowerCase() === currentUser.email.toLowerCase()
      );
      if (byEmail) return byEmail;

      const byName = db.students.find(
        (s) => currentUser.name && s.name.toLowerCase().includes(currentUser.name.toLowerCase())
      );
      if (byName) return byName;
    }

    if (currentUserRole === 'encarregado') {
      // Nunca cai para "outro aluno qualquer": sem vínculo, sem acesso.
      const chosen = guardianChildren.find((c) => c.student.id === selectedChildId) || guardianChildren[0];
      return chosen?.student;
    }

    // No match found: never fall back to an arbitrary student — that would
    // leak another student's grades/finances to whoever is logged in.
    return undefined;
  }, [db.students, currentUser, currentUserRole, guardianChildren, selectedChildId]);

  // O bloqueio "aguardando envio do boletim" só se aplica a alunos MAIORES de
  // idade (autonomia do próprio aluno para decidir partilhar as notas). Para
  // alunos MENORES, o Encarregado de Educação tem sempre acesso às notas do
  // seu educando, independentemente de qualquer envio/permissão do aluno.
  const isStudentMinor = student ? !isStudentAdult(student.birthDate) : false;
  const requiresBoletimSendByStudent = !isStudentMinor;

  // Anos Lectivos em que o aluno tem registo real (matrículas, notas arquivadas e o ano ativo).
  const academicYearOptions = useMemo(
    () => (student ? getStudentAcademicYears(student, db.matriculas, currentAcademicYear) : [currentAcademicYear]),
    [student, db.matriculas, currentAcademicYear]
  );
  const selectedYear = academicYearOptions.includes(requestedYear) ? requestedYear : currentAcademicYear;
  const isCurrentYearSelected = selectedYear === currentAcademicYear;
  // Se as notas "vivas" do aluno pertencem ao ano escolhido lê-se de trimesterGrades; caso
  // contrário, do arquivo desse ano (ver utils/studentGrades.ts).
  const isLiveYearSelected = !!student && selectedYear === getLiveGradesYear(student, currentAcademicYear);

  // Turma/curso que o aluno tinha no ano escolhido (matrícula ou arquivo), não a turma de hoje.
  const yearMatricula = student ? findMatriculaForYear(db.matriculas, student.id, selectedYear) : undefined;
  const yearArchive = student ? getStudentArchiveForYear(student, selectedYear) : undefined;
  const displayClassName = isLiveYearSelected
    ? student?.className || student?.grade
    : yearArchive?.className || yearMatricula?.className || yearArchive?.grade || yearMatricula?.grade;
  const displayCourseName = isLiveYearSelected ? student?.courseName : yearMatricula?.courseName || student?.courseName;

  const handleYearChange = (year: string) => {
    setRequestedYear(year);
    // Ano corrente abre no trimestre em vigência; anos passados abrem na Pauta Geral.
    setSelectedTrimester(year === currentAcademicYear ? Number(db.settings?.currentTrimester || 1) : 4);
  };

  // Check debtor status
  const isDebtor = Boolean(
    student &&
      (student.financialStatus === 'debito' || !student.isTuitionPaidCurrentMonth)
  );

  // Active trimester from system settings (usually 2)
  const currentSystemTrimester = Number(db.settings?.currentTrimester || 1);
  const isCurrentTrimesterSelected = isCurrentYearSelected && selectedTrimester === currentSystemTrimester;

  // Linha de pauta de UMA disciplina para este aluno. Campos são '' (vazio) quando a
  // disciplina ainda não tem nota lançada — nunca um valor inventado. Mesma regra já
  // aplicada em buildPautaGeralRows/buildMiniPautaRows (utils/pautaCalculations.ts):
  // "Nunca se inventam notas [...] o que produzia pautas credíveis mas falsas."
  type PortalGradeRow = {
    subjectId: string;
    subjectName: string;
    mac1: number | '';
    npp1: number | '';
    npt1: number | '';
    mt1: number | '';
    mac2: number | '';
    npp2: number | '';
    npt2: number | '';
    mt2: number | '';
    mac3: number | '';
    npp3: number | '';
    npt3: number | '';
    mt3: number | '';
    mfd: number | '';
  };

  // Regras de Notas & Escala configuradas em Configurações > Regras & Escala de Notas
  // (pesos MAC/PP/PT, arredondamento) — as mesmas usadas pelas Pautas oficiais.
  const gradeRules = useMemo(() => normalizeGradeRules(db.settings?.gradeRules), [db.settings?.gradeRules]);

  // Grade records — cruza o currículo real da instituição (db.subjects) com as notas
  // trimestrais realmente lançadas para o aluno (student.trimesterGrades). Disciplinas
  // sem nota lançada aparecem vazias em vez de desaparecerem ou mostrarem números falsos.
  const trimesterGrades: PortalGradeRow[] = useMemo(() => {
    if (!student) return [];

    // Notas do ANO LECTIVO ESCOLHIDO (ano "vivo" ou arquivo) — nunca as de outro ano.
    const recorded = getStudentRecordsForYear(student, selectedYear, currentAcademicYear);
    // O currículo configurado só descreve o ano em curso; num ano passado mostram-se as
    // disciplinas que realmente têm nota registada nesse ano.
    const curriculum = isLiveYearSelected && db.subjects && db.subjects.length > 0 ? db.subjects : [];

    // Quando não há currículo configurado em Configurações > Disciplinas, mas o aluno já
    // tem notas gravadas, mostramos essas disciplinas (nunca perder dados reais); quando
    // não há nenhum dos dois, a pauta fica genuinamente vazia (ver render mais abaixo).
    const subjectList: { id: string; name: string }[] =
      curriculum.length > 0
        ? curriculum.map((s) => ({ id: s.id, name: s.name }))
        : recorded.map((r) => ({ id: r.subjectId, name: r.subjectName }));

    return subjectList.map((subj) => {
      const rec = recorded.find(
        (tg) => String(tg.subjectId) === String(subj.id) || tg.subjectName.toLowerCase() === subj.name.toLowerCase()
      );

      if (!rec) {
        return {
          subjectId: subj.id,
          subjectName: subj.name,
          mac1: '', npp1: '', npt1: '', mt1: '',
          mac2: '', npp2: '', npt2: '', mt2: '',
          mac3: '', npp3: '', npt3: '', mt3: '',
          mfd: ''
        };
      }

      const { mt1, mt2, mt3, mfd } = recomputeTrimesterRecord(rec, gradeRules);

      return {
        subjectId: subj.id,
        subjectName: subj.name,
        mac1: rec.mac1, npp1: rec.npp1, npt1: rec.npt1, mt1,
        mac2: rec.mac2, npp2: rec.npp2, npt2: rec.npt2, mt2,
        mac3: rec.mac3, npp3: rec.npp3, npt3: rec.npt3, mt3,
        mfd
      };
    });
  }, [student, selectedYear, currentAcademicYear, isLiveYearSelected, db.subjects, gradeRules]);

  const hasAnyGradeLaunched = trimesterGrades.some(
    (g) => g.mac1 !== '' || g.npp1 !== '' || g.npt1 !== '' || g.mac2 !== '' || g.npp2 !== '' || g.npt2 !== '' || g.mac3 !== '' || g.npp3 !== '' || g.npt3 !== ''
  );

  // Statistics calculation for selected trimester
  const stats = useMemo(() => {
    if (!trimesterGrades || trimesterGrades.length === 0) {
      return { average: 0, positive: 0, negative: 0, count: 0 };
    }

    let sum = 0;
    let positive = 0;
    let negative = 0;

    trimesterGrades.forEach((g) => {
      const grade =
        selectedTrimester === 1
          ? g.mt1
          : selectedTrimester === 2
          ? g.mt2
          : selectedTrimester === 3
          ? g.mt3
          : g.mfd;

      if (typeof grade === 'number' && !isNaN(grade)) {
        sum += grade;
        if (grade >= 10) positive++;
        else negative++;
      }
    });

    const count = positive + negative;
    const average = count > 0 ? Math.round((sum / count) * 10) / 10 : 0;

    return { average, positive, negative, count };
  }, [trimesterGrades, selectedTrimester]);

  // All invoices/tuition fees belonging to the current student (real records from
  // Propinas/Matrícula — não são inventados aqui, apenas filtrados por studentId).
  const studentInvoices: TuitionInvoice[] = useMemo(() => {
    if (!student) return [];
    const all = [...(db.invoices || []), ...(db.tuitionFees || [])] as TuitionInvoice[];
    const seen = new Set<string>();
    const list: TuitionInvoice[] = [];
    for (const inv of all) {
      const key = String(inv.id || inv.invoiceNumber);
      if (String(inv.studentId) === String(student.id) && !seen.has(key)) {
        seen.add(key);
        list.push(inv);
      }
    }
    return list;
  }, [db.invoices, db.tuitionFees, student]);

  // Tuition months tracker — reconstruído a partir das faturas reais de propina
  // (TuitionInvoice.period, gerado em generateMonthlyBatchInvoices/matrícula como
  // "<Mês> <Ano>"), casadas com o Ano Lectivo selecionado. Nenhum valor fixo.
  const monthsTracker = useMemo(() => {
    const academicMonths = [
      { month: 'Setembro', key: '09' },
      { month: 'Outubro', key: '10' },
      { month: 'Novembro', key: '11' },
      { month: 'Dezembro', key: '12' },
      { month: 'Janeiro', key: '01' },
      { month: 'Fevereiro', key: '02' },
      { month: 'Março', key: '03' },
      { month: 'Abril', key: '04' },
      { month: 'Maio', key: '05' },
      { month: 'Junho', key: '06' },
      { month: 'Julho', key: '07' }
    ];

    const [startYearStr, endYearStr] = (selectedYear || '').split('/');
    const startYear = Number(startYearStr) || new Date().getFullYear();
    const endYear = Number(endYearStr) || startYear + 1;
    const firstHalf = new Set(['Setembro', 'Outubro', 'Novembro', 'Dezembro']);

    return academicMonths.map(({ month, key }) => {
      const year = firstHalf.has(month) ? startYear : endYear;
      const periodLabel = `${month} ${year}`;
      const invoice = studentInvoices.find((inv) => inv.period === periodLabel);

      return {
        month,
        key,
        paid: invoice?.status === 'pago',
        late: invoice?.status === 'atraso',
        amountKz: invoice?.totalAmountKz,
        receipt: invoice?.status === 'pago' ? invoice.receiptNumber || invoice.invoiceNumber : undefined,
        date:
          invoice?.status === 'pago' && invoice.paymentDate
            ? new Date(invoice.paymentDate).toLocaleDateString('pt-AO')
            : undefined,
        invoice
      };
    });
  }, [studentInvoices, selectedYear]);

  // Coordenadas Bancárias Oficiais — lidas de Configurações > Financeiro
  // (db.settings.bankAccounts), só contas ativas. Sem instituição a configurar,
  // não há dados fixos a mostrar em alternativa.
  const bankAccounts = useMemo(() => {
    const configured = db.settings?.bankAccounts || [];
    return configured
      .filter((b) => b.active)
      .map((b) => ({
        bank: b.bankName,
        iban: b.iban,
        entity: b.multicaixaEntity || '---',
        holder: b.accountHolder
      }));
  }, [db.settings?.bankAccounts]);

  // Recibo selecionado para 2.ª via (modal oficial de Fatura-Recibo)
  const [receiptInvoice, setReceiptInvoice] = useState<TuitionInvoice | null>(null);

  // Handle Send Report Card to Guardian
  const handleSendReportCard = async () => {
    if (!student) return;

    let sent = false;
    try {
    await runGlobalOperation(
      async () => {
        // O aluno não escreve na ficha: o servidor grava a marca e propaga-a à área do encarregado.
        sent = await dbService.sendBoletimToGuardian(student.id);
        if (!sent) throw new Error('Não foi possível enviar o boletim. Verifique a ligação e tente novamente.');
      },
      {
        loadingMessage: `A transferir e disponibilizar o boletim oficial na área do encarregado...`,
        successMessage: `Boletim de notas enviado com sucesso para a área do encarregado!`
      }
    );
    } catch {
      sent = false;
    }

    if (!sent) return;
    setIsSendModalOpen(false);
  };

  if (!student) {
    return (
      <div className="p-8 text-center bg-white rounded-2xl border border-slate-200">
        <span className="material-symbols-outlined text-4xl text-slate-400 mb-2">school</span>
        <h3 className="text-lg font-bold text-slate-800">Nenhum registo de estudante associado</h3>
        <p className="text-xs text-slate-500 mt-1">
          Não foi possível localizar uma ficha de aluno associada ao utilizador com sessão iniciada.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Encarregado com vários educandos: seletor de filho */}
      {isEncarregado && guardianChildren.length > 1 && (
        <div className="bg-white border border-slate-200 rounded-2xl p-3 flex flex-wrap items-center gap-2">
          <span className="text-[11px] font-bold uppercase tracking-wider text-slate-500 mr-1">Os meus educandos</span>
          {guardianChildren.map((c) => {
            const active = c.student.id === student.id;
            return (
              <button
                key={c.student.id}
                type="button"
                onClick={() => setSelectedChildId(c.student.id)}
                className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-colors cursor-pointer ${
                  active ? 'bg-[#0b1f3a] text-white' : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
                }`}
                title={c.link ? relationLabel(c.link) : 'Associado pela ficha do aluno'}
              >
                {c.student.name.split(' ')[0]} · {c.student.className || c.student.grade || 'Sem turma'}
              </button>
            );
          })}
        </div>
      )}

      {/* Header Profile Banner */}
      <div className="bg-gradient-to-r from-[#0b1f3a] via-[#122b50] to-[#1f4277] text-white p-6 rounded-2xl shadow-lg border border-slate-800">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-6">
          <div className="flex items-center gap-4">
            <div className="w-16 h-16 rounded-2xl bg-white/10 border border-white/20 p-1 flex items-center justify-center overflow-hidden shrink-0 shadow-inner">
              {student.avatar ? (
                <img
                  src={student.avatar}
                  alt={student.name}
                  className="w-full h-full object-cover rounded-xl"
                  referrerPolicy="no-referrer"
                />
              ) : (
                <span className="material-symbols-outlined text-3xl text-blue-200">person</span>
              )}
            </div>

            <div>
              <div className="flex flex-wrap items-center gap-2 mb-1">
                <h1 className="text-xl font-bold font-headline tracking-tight">{student.name}</h1>
                <span
                  data-proc-badge=""
                  className="px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider bg-white/20 text-white"
                  style={{ color: '#ffffff' }}
                >
                  Nº Proc: {student.procNumber}
                </span>
                {isDebtor ? (
                  <span className="px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider bg-rose-500/80 text-white flex items-center gap-1">
                    <span className="material-symbols-outlined text-[12px]">warning</span>
                    Pendente
                  </span>
                ) : (
                  <span className="px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider bg-emerald-500/80 text-white flex items-center gap-1">
                    <span className="material-symbols-outlined text-[12px]">verified</span>
                    Regularizado
                  </span>
                )}
              </div>

              <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-blue-100/80">
                <span className="flex items-center gap-1">
                  <span className="material-symbols-outlined text-[14px]">class</span>
                  Turma: {displayClassName || '—'}
                </span>
                <span className="flex items-center gap-1">
                  <span className="material-symbols-outlined text-[14px]">school</span>
                  Curso: {displayCourseName || 'Ensino Geral'}
                </span>
                <span className="flex items-center gap-1">
                  <span className="material-symbols-outlined text-[14px]">supervisor_account</span>
                  Encarregado: {student.guardianName || 'Não registado'}
                </span>
              </div>
            </div>
          </div>

          {/* Action: Send report card button */}
          {!isEncarregado && (
            <div className="flex items-center gap-2 shrink-0">
              {student.boletimEnviadoAoEncarregado ? (
                <div className="flex items-center gap-2">
                  <span className="hidden sm:inline-flex items-center gap-1.5 text-xs text-emerald-300 font-semibold bg-emerald-950/60 px-3 py-1.5 rounded-xl border border-emerald-500/40">
                    <span className="material-symbols-outlined text-[16px] text-emerald-400">check_circle</span>
                    Boletim Ativo na Área do Encarregado
                  </span>
                  <button
                    type="button"
                    onClick={() => setIsSendModalOpen(true)}
                    className="px-3.5 py-2 bg-white/15 hover:bg-white/25 text-white font-bold text-xs rounded-xl transition-all flex items-center gap-1.5 cursor-pointer"
                    title="Atualizar ou reenviar o boletim com notas atualizadas para a área do encarregado"
                  >
                    <span className="material-symbols-outlined text-base">sync</span>
                    <span>Atualizar Envio</span>
                  </button>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => setIsSendModalOpen(true)}
                  className="px-4 py-2.5 bg-amber-400 hover:bg-amber-300 text-slate-900 font-bold text-xs rounded-xl shadow-md transition-all flex items-center gap-2 cursor-pointer active:scale-95"
                >
                  <span className="material-symbols-outlined text-lg">forward_to_inbox</span>
                  <span>Enviar Boletim ao Encarregado</span>
                </button>
              )}
            </div>
          )}
        </div>
      </div>

      {/* O separador (notas / finanças) é escolhido pelo menu lateral (initialTab); os dois botões internos foram removidos. */}

      {/* TAB 1: NOTAS POR TRIMESTRE, DISCIPLINAS E ANOS LECTIVOS */}
      {activeTab === 'notas' && (
        <div className="space-y-6">
          {/* CRITICAL CHECK FOR GUARDIAN AREA:
              "SIGNIFICA QUE NA AREA DO ENCARREGADO SÓ SERA POSSIVEL IMPRIMIR BOLETIM E VER AS NOTAS DO ESTUDANTE CASO O ESTUDANTE ENVIAR O BOLETIM PARA ELE." */}
          {isEncarregado && requiresBoletimSendByStudent && !student.boletimEnviadoAoEncarregado ? (
            <div className="bg-white rounded-2xl border border-slate-200 shadow-xs p-8 sm:p-10 text-center max-w-2xl mx-auto my-6 space-y-4">
              <div className="w-16 h-16 rounded-2xl bg-amber-50 text-amber-600 flex items-center justify-center mx-auto border border-amber-200 shadow-inner">
                <span className="material-symbols-outlined text-3xl">lock</span>
              </div>
              <div>
                <span className="px-3 py-1 rounded-full text-[11px] font-bold uppercase tracking-wider bg-amber-100 text-amber-800 inline-block mb-2">
                  Boletim Não Disponibilizado
                </span>
                <h3 className="text-lg font-bold text-slate-900">
                  Aguardando Envio do Boletim pelo Estudante
                </h3>
              </div>
              <div className="p-4 bg-slate-50 rounded-xl border border-slate-200 text-left text-xs text-slate-600 space-y-1 mt-4">
                <div className="font-semibold text-slate-800 flex items-center gap-1.5">
                  <span className="material-symbols-outlined text-base text-slate-500">info</span>
                  Procedimento
                </div>
                <p className="text-[11px] text-slate-500 leading-relaxed">
                  Para promover a autonomia e responsabilidade pedagógica, o boletim é inicialmente disponibilizado na área do educando, que procede ao envio digital para a área do encarregado de educação.
                </p>
              </div>
            </div>
          ) : (
            <>
              {isEncarregado && requiresBoletimSendByStudent && student.boletimEnviadoAoEncarregado && (
                <div className="p-4 bg-emerald-50 border border-emerald-200 rounded-2xl flex flex-wrap items-center justify-between gap-3 text-emerald-950">
                  <div className="flex items-center gap-3">
                    <span className="material-symbols-outlined text-emerald-600 text-2xl">verified</span>
                    <div>
                      <h4 className="text-xs font-bold text-emerald-950">
                        Boletim Disponibilizado pelo Estudante
                      </h4>
                      <p className="text-[11px] text-emerald-800 mt-0.5">
                        O estudante <strong>{student.name}</strong> enviou este boletim diretamente para a sua área institucional{student.boletimEnviadoEm ? ` em ${new Date(student.boletimEnviadoEm).toLocaleDateString('pt-PT', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })}` : ''}.
                      </p>
                    </div>
                  </div>
                </div>
              )}

              {isEncarregado && isStudentMinor && (
                <div className="p-4 bg-blue-50 border border-blue-200 rounded-2xl flex flex-wrap items-center justify-between gap-3 text-blue-950">
                  <div className="flex items-center gap-3">
                    <span className="material-symbols-outlined text-blue-600 text-2xl">shield_person</span>
                    <div>
                      <h4 className="text-xs font-bold text-blue-950">
                        Acesso Automático — Educando Menor de Idade
                      </h4>
                      <p className="text-[11px] text-blue-800 mt-0.5">
                        Por <strong>{student.name}</strong> ser menor de 18 anos, as suas notas e boletim ficam sempre disponíveis nesta área, sem depender de envio ou autorização do próprio educando.
                      </p>
                    </div>
                  </div>
                </div>
              )}

              {/* Filtering Bar */}
              <div className="bg-white p-4 rounded-2xl border border-slate-200 shadow-xs flex flex-wrap items-center justify-between gap-4">
                <div className="flex flex-wrap items-center gap-3">
                  <div>
                    <label className="block text-[11px] font-bold text-slate-500 mb-1">
                      Ano Lectivo
                    </label>
                    <select
                      value={selectedYear}
                      onChange={(e) => handleYearChange(e.target.value)}
                      className="h-9 px-3 text-xs font-bold rounded-lg border border-slate-300 bg-slate-50 focus:ring-1 focus:ring-[#0b1f3a]"
                    >
                      {academicYearOptions.map((year) => (
                        <option key={year} value={year}>
                          {year} ({academicYearStatusLabel(getAcademicYearStatus(year, currentAcademicYear))})
                        </option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label className="block text-[11px] font-bold text-slate-500 mb-1">
                      Período Curricular
                    </label>
                    <div className="flex items-center gap-1 bg-slate-100 p-1 rounded-lg border border-slate-200">
                      {[
                        { id: 1, label: '1.º Trimestre' },
                        { id: 2, label: '2.º Trimestre' },
                        { id: 3, label: '3.º Trimestre' },
                        { id: 4, label: 'Pauta Geral' }
                      ].map((trim) => (
                        <button
                          key={trim.id}
                          type="button"
                          onClick={() => setSelectedTrimester(trim.id)}
                          className={`px-3 py-1.5 rounded-md text-xs font-bold transition-all cursor-pointer ${
                            selectedTrimester === trim.id
                              ? 'bg-[#0b1f3a] text-white shadow-xs'
                              : 'text-slate-600 hover:text-slate-900'
                          }`}
                        >
                          {trim.label}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>

                {/* Quick Metrics */}
                {!(isDebtor && isCurrentTrimesterSelected) && (
                  <div className="flex items-center gap-4 text-xs font-semibold">
                    <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-blue-50 text-blue-900 border border-blue-200">
                      <span>Média do Período:</span>
                      <strong className="font-mono text-sm">{stats.count > 0 ? stats.average : '—'}</strong>
                    </div>
                    <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-emerald-50 text-emerald-900 border border-emerald-200">
                      <span>Positivas:</span>
                      <strong className="font-mono text-sm">{stats.positive}</strong>
                    </div>
                    {stats.negative > 0 && (
                      <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-rose-50 text-rose-900 border border-rose-200">
                        <span>Negativas:</span>
                        <strong className="font-mono text-sm">{stats.negative}</strong>
                      </div>
                    )}
                  </div>
                )}
              </div>

          {/* CRITICAL DEBTOR RESTRICTION CHECK:
              "OS ALUNOS DEVEDORES NÃO DEVEM VER AS NOTAS DO TRIMESTRE EM VIGENCIA." */}
          {isDebtor && isCurrentTrimesterSelected ? (
            <div className="p-8 rounded-2xl bg-gradient-to-br from-rose-50 to-amber-50 border-2 border-rose-200 shadow-sm text-center">
              <div className="w-14 h-14 mx-auto mb-4 rounded-2xl bg-rose-100 text-rose-700 flex items-center justify-center shadow-inner">
                <span className="material-symbols-outlined text-3xl">lock</span>
              </div>
              <h3 className="text-base font-bold text-slate-900">
                Notas do {currentSystemTrimester}.º Trimestre em Vigência Bloqueadas
              </h3>
              <p className="text-xs text-slate-600 max-w-xl mx-auto mt-2 leading-relaxed">
                De acordo com as normas financeiras do {db.settings?.schoolName || 'estabelecimento'}, a visualização das
                avaliações (MAC, NPP, NPT e MT) do <strong>trimestre lectivo em vigência</strong> está temporariamente
                condicionada à liquidação das propinas pendentes do presente ano letivo.
              </p>
              <div className="mt-5 flex flex-wrap items-center justify-center gap-3">
                <button
                  type="button"
                  onClick={() => setActiveTab('financeiro')}
                  className="px-4 py-2.5 bg-[#0b1f3a] hover:bg-[#15345d] text-white font-bold text-xs rounded-xl shadow-sm transition-all flex items-center gap-2 cursor-pointer"
                >
                  <span className="material-symbols-outlined text-base">payments</span>
                  <span>Ver Situação Financeira & Coordenadas</span>
                </button>
                {currentSystemTrimester > 1 && (
                  <button
                    type="button"
                    onClick={() => setSelectedTrimester(currentSystemTrimester - 1)}
                    className="px-4 py-2.5 bg-white hover:bg-slate-100 text-slate-700 font-bold text-xs rounded-xl border border-slate-300 transition-all flex items-center gap-1.5 cursor-pointer"
                  >
                    <span className="material-symbols-outlined text-base">history</span>
                    <span>Consultar {currentSystemTrimester - 1}.º Trimestre (Histórico)</span>
                  </button>
                )}
              </div>
            </div>
          ) : (
            /* Table of Grades */
            <div className="bg-white rounded-2xl border border-slate-200 shadow-xs overflow-hidden">
              <div className="p-4 bg-slate-50 border-b border-slate-200 flex items-center justify-between">
                <div>
                  <h3 className="text-sm font-bold text-slate-900 flex items-center gap-2">
                    <span className="material-symbols-outlined text-blue-600 text-lg">fact_check</span>
                    Pauta de Aproveitamento Escolar — {selectedTrimester === 4 ? 'Resumo Anual' : `${selectedTrimester}.º Trimestre`}
                  </h3>
                  <p className="text-[11px] text-slate-500 mt-0.5">
                    Ano Lectivo {selectedYear} • Escala Oficial Angolana (0 a 20 Valores • Positiva &ge; 10.0)
                  </p>
                </div>

                <button
                  type="button"
                  onClick={() => setIsReportModalOpen(true)}
                  className="px-3.5 py-1.5 bg-[#0b1f3a] hover:bg-[#15345d] text-white rounded-lg text-xs font-bold flex items-center gap-1.5 cursor-pointer transition-colors shadow-xs"
                >
                  <span className="material-symbols-outlined text-base text-amber-400">print</span>
                  <span>Imprimir Boletim</span>
                </button>
              </div>

              {trimesterGrades.length === 0 ? (
                <div className="p-10 text-center">
                  <span className="material-symbols-outlined text-4xl text-slate-300 mb-2">inventory_2</span>
                  <h4 className="text-sm font-bold text-slate-700">Sem notas registadas no Ano Lectivo {selectedYear}</h4>
                  <p className="text-xs text-slate-500 mt-1 max-w-md mx-auto">
                    {isCurrentYearSelected
                      ? 'Ainda não há disciplinas nem avaliações lançadas para este aluno no ano em curso.'
                      : 'Este ano lectivo não tem notas arquivadas para este aluno na base de dados.'}
                  </p>
                </div>
              ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse border border-slate-300 print:border-slate-400 text-xs print:text-[8pt]">
                  <thead>
                    <tr className="bg-[#0b1f3a] text-white uppercase font-bold text-[10px] print:bg-[#0b1f3a] print:text-white">
                      <th className="py-2.5 px-3 border border-slate-600 print:border-slate-500 text-center w-10">#</th>
                      <th className="py-2.5 px-3.5 border border-slate-600 print:border-slate-500 font-extrabold">Disciplina Curricular</th>
                      {selectedTrimester !== 4 ? (
                        <>
                          <th className="py-2.5 px-3 border border-slate-600 print:border-slate-500 text-center bg-[#0d2647] print:bg-[#0d2647]">MAC (30%)</th>
                          <th className="py-2.5 px-3 border border-slate-600 print:border-slate-500 text-center bg-[#0d2647] print:bg-[#0d2647]">NPP (30%)</th>
                          <th className="py-2.5 px-3 border border-slate-600 print:border-slate-500 text-center bg-[#0d2647] print:bg-[#0d2647]">NPT (40%)</th>
                          <th className="py-2.5 px-3 border border-slate-600 print:border-slate-500 text-center bg-[#7a0c0c] text-amber-300 font-black print:bg-[#7a0c0c] print:text-amber-300">
                            Média ({selectedTrimester}.º Trim)
                          </th>
                        </>
                      ) : (
                        <>
                          <th className="py-2.5 px-3 border border-slate-600 print:border-slate-500 text-center bg-[#0d2647] print:bg-[#0d2647]">MT 1.º Trim</th>
                          <th className="py-2.5 px-3 border border-slate-600 print:border-slate-500 text-center bg-[#12335e] print:bg-[#12335e]">MT 2.º Trim</th>
                          <th className="py-2.5 px-3 border border-slate-600 print:border-slate-500 text-center bg-[#183f73] print:bg-[#183f73]">MT 3.º Trim</th>
                          <th className="py-2.5 px-3 border border-slate-600 print:border-slate-500 text-center bg-[#7a0c0c] text-amber-300 font-black print:bg-[#7a0c0c] print:text-amber-300">
                            MFD (Final)
                          </th>
                        </>
                      )}
                      <th className="py-2.5 px-3 border border-slate-600 print:border-slate-500 text-center font-extrabold">Situação</th>
                      <th className="py-2.5 px-3.5 border border-slate-600 print:border-slate-500 font-extrabold">Apreciação Pedagógica</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-200 print:divide-slate-300">
                    {trimesterGrades.map((g, idx) => {
                      const mac = selectedTrimester === 1 ? g.mac1 : selectedTrimester === 2 ? g.mac2 : g.mac3;
                      const npp = selectedTrimester === 1 ? g.npp1 : selectedTrimester === 2 ? g.npp2 : g.npp3;
                      const npt = selectedTrimester === 1 ? g.npt1 : selectedTrimester === 2 ? g.npt2 : g.npt3;
                      const mt = selectedTrimester === 1 ? g.mt1 : selectedTrimester === 2 ? g.mt2 : selectedTrimester === 3 ? g.mt3 : g.mfd;

                      const hasMt = typeof mt === 'number';
                      const isPositive = hasMt && mt >= 10;
                      const fmt = (v: number | '') => (typeof v === 'number' ? v.toFixed(1) : '—');

                      return (
                        <tr key={g.subjectId || idx} className={`${idx % 2 === 1 ? 'bg-[#f8fafc]' : 'bg-white'} hover:bg-blue-50/30 transition-colors`}>
                          <td className="py-2 px-3 border border-slate-300 print:border-slate-300 font-mono text-slate-500 text-center font-bold">{idx + 1}</td>
                          <td className="py-2 px-3.5 border border-slate-300 print:border-slate-300 font-bold text-[#0b1f3a]">{g.subjectName}</td>

                          {selectedTrimester !== 4 ? (
                            <>
                              <td className="py-2 px-3 border border-slate-300 print:border-slate-300 text-center font-mono text-slate-700">{fmt(mac)}</td>
                              <td className="py-2 px-3 border border-slate-300 print:border-slate-300 text-center font-mono text-slate-700">{fmt(npp)}</td>
                              <td className="py-2 px-3 border border-slate-300 print:border-slate-300 text-center font-mono text-slate-700">{fmt(npt)}</td>
                              <td className="py-2 px-3 border border-slate-300 print:border-slate-300 text-center font-mono font-bold text-sm bg-blue-50/50 print:bg-blue-50/50">
                                <span
                                  className={`px-2 py-0.5 rounded-md font-bold ${
                                    !hasMt ? 'text-slate-400' : isPositive ? 'text-emerald-800' : 'text-rose-700 font-black'
                                  }`}
                                >
                                  {fmt(mt)}
                                </span>
                              </td>
                            </>
                          ) : (
                            <>
                              <td className="py-2 px-3 border border-slate-300 print:border-slate-300 text-center font-mono text-slate-700">{fmt(g.mt1)}</td>
                              <td className="py-2 px-3 border border-slate-300 print:border-slate-300 text-center font-mono text-slate-700">{fmt(g.mt2)}</td>
                              <td className="py-2 px-3 border border-slate-300 print:border-slate-300 text-center font-mono text-slate-700">{fmt(g.mt3)}</td>
                              <td className="py-2 px-3 border border-slate-300 print:border-slate-300 text-center font-mono font-black text-sm bg-rose-50/70 text-[#7a0c0c] print:bg-rose-50/70">
                                <span
                                  className={`px-2 py-0.5 rounded-md ${
                                    !hasMt ? 'text-slate-400' : isPositive ? 'text-emerald-800' : 'text-rose-800'
                                  }`}
                                >
                                  {fmt(g.mfd)}
                                </span>
                              </td>
                            </>
                          )}

                          <td className="py-2 px-3 border border-slate-300 print:border-slate-300 text-center">
                            <span
                              className={`px-2.5 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider inline-block ${
                                !hasMt
                                  ? 'bg-slate-100 text-slate-500 border border-slate-200'
                                  : isPositive
                                  ? 'bg-emerald-50 text-emerald-800 border border-emerald-200'
                                  : 'bg-rose-50 text-rose-800 border border-rose-200'
                              }`}
                            >
                              {!hasMt ? 'Sem Nota' : isPositive ? 'Positiva' : 'Negativa'}
                            </span>
                          </td>

                          <td className="py-2 px-3.5 border border-slate-300 print:border-slate-300 text-slate-600 text-[11px]">
                            {!hasMt
                              ? 'Ainda sem avaliação lançada pelo docente.'
                              : mt >= 16
                              ? 'Excelente aproveitamento e dedicação contínua.'
                              : mt >= 14
                              ? 'Bom desempenho curricular e pontualidade.'
                              : mt >= 10
                              ? 'Aproveitamento satisfatório com margem de melhoria.'
                              : 'Requer reforço pedagógico urgente e apoio no estudo.'}
                          </td>
                        </tr>
                      );
                    })}

                    {/* Summary / Total Footer Row */}
                    <tr className="bg-[#0b1f3a] text-white font-bold print:bg-[#0b1f3a] print:text-white">
                      <td colSpan={selectedTrimester !== 4 ? 5 : 5} className="py-2 px-3.5 border border-slate-600 print:border-slate-500 uppercase text-right text-[10px]">
                        {selectedTrimester === 4 ? 'Média Final Geral (MFD):' : `Média Geral do ${selectedTrimester}.º Trimestre:`}
                      </td>
                      <td className="py-2 px-3 border border-slate-600 print:border-slate-500 text-center font-mono font-black text-sm text-amber-300 bg-[#7a0c0c] print:bg-[#7a0c0c]">
                        {stats.count > 0 ? stats.average : '—'}
                      </td>
                      <td className="py-2 px-3 border border-slate-600 print:border-slate-500 text-center text-[10px] text-emerald-300 font-bold bg-[#0d2647] print:bg-[#0d2647]">
                        {stats.count === 0 ? '—' : Number(stats.average) >= 10 ? 'Aprovado' : 'Não Aprovado'}
                      </td>
                      <td className="py-2 px-3.5 border border-slate-600 print:border-slate-500 text-[11px] text-slate-200">
                        {stats.positive} positivas • {stats.negative} negativas
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>
              )}
            </div>
          )}
          </>
          )}
        </div>
      )}

      {/* TAB 2: SITUAÇÃO FINANCEIRA DO ESTUDANTE */}
      {activeTab === 'financeiro' && (
        <div className="space-y-6">
          {/* Status summary banner */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div className="p-5 rounded-2xl bg-white border border-slate-200 shadow-xs flex items-center gap-4">
              <div
                className={`w-12 h-12 rounded-xl flex items-center justify-center ${
                  isDebtor ? 'bg-rose-100 text-rose-700' : 'bg-emerald-100 text-emerald-700'
                }`}
              >
                <span className="material-symbols-outlined text-2xl">
                  {isDebtor ? 'error' : 'verified'}
                </span>
              </div>
              <div>
                <span className="text-[11px] font-bold text-slate-500 uppercase tracking-wider block">
                  Estado Geral das Propinas
                </span>
                <span
                  className={`text-base font-bold ${
                    isDebtor ? 'text-rose-700' : 'text-emerald-700'
                  }`}
                >
                  {isDebtor ? 'Mensalidades em Débito' : 'Situação Regularizada'}
                </span>
              </div>
            </div>

            <div className="p-5 rounded-2xl bg-white border border-slate-200 shadow-xs flex items-center gap-4">
              <div className="w-12 h-12 rounded-xl bg-blue-100 text-blue-700 flex items-center justify-center">
                <span className="material-symbols-outlined text-2xl">payments</span>
              </div>
              <div>
                <span className="text-[11px] font-bold text-slate-500 uppercase tracking-wider block">
                  Propina Mensal Fixada
                </span>
                <span className="text-base font-bold text-slate-900 font-mono">
                  {(student.monthlyTuitionKz || 25000).toLocaleString('pt-AO')} Kz
                </span>
              </div>
            </div>

            <div className="p-5 rounded-2xl bg-white border border-slate-200 shadow-xs flex items-center gap-4">
              <div className="w-12 h-12 rounded-xl bg-amber-100 text-amber-700 flex items-center justify-center">
                <span className="material-symbols-outlined text-2xl">event</span>
              </div>
              <div>
                <span className="text-[11px] font-bold text-slate-500 uppercase tracking-wider block">
                  Dia de Vencimento
                </span>
                <span className="text-base font-bold text-slate-900">
                  Dia {db.settings?.financialRules?.paymentDueDay || 10} de cada mês
                </span>
              </div>
            </div>
          </div>

          {/* Month-by-Month Payment History */}
          <div className="bg-white rounded-2xl border border-slate-200 shadow-xs overflow-hidden">
            <div className="p-4 bg-slate-50 border-b border-slate-200 flex items-center justify-between">
              <div>
                <h3 className="text-sm font-bold text-slate-900 flex items-center gap-2">
                  <span className="material-symbols-outlined text-emerald-600 text-lg">calendar_month</span>
                  Extrato Mensal de Propinas — Ano Lectivo {selectedYear}
                </h3>
                <p className="text-[11px] text-slate-500 mt-0.5">
                  Registo dos pagamentos liquidados e mensalidades a vencer
                </p>
              </div>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse border border-slate-300 text-xs">
                <thead>
                  <tr className="bg-[#0b1f3a] text-white border-b border-slate-600 font-bold uppercase tracking-wider text-[10px]">
                    <th className="py-2.5 px-4 border-r border-slate-600">Mês de Referência</th>
                    <th className="py-2.5 px-4 border-r border-slate-600">Valor Mensal</th>
                    <th className="py-2.5 px-4 border-r border-slate-600 text-center">Estado</th>
                    <th className="py-2.5 px-4 border-r border-slate-600">Recibo de Liquidação</th>
                    <th className="py-2.5 px-4 border-r border-slate-600">Data do Pagamento</th>
                    <th className="py-2.5 px-4 text-right">Comprovativo</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200">
                  {monthsTracker.map((m, idx) => (
                    <tr key={m.key} className={`${idx % 2 === 1 ? 'bg-[#f8fafc]' : 'bg-white'} hover:bg-blue-50/20 transition-colors`}>
                      <td className="py-3 px-4 border-r border-slate-200 font-bold text-slate-800 flex items-center gap-2">
                        <span className="material-symbols-outlined text-slate-400 text-base">receipt</span>
                        <span>{m.month}</span>
                      </td>
                      <td className="py-3 px-4 border-r border-slate-200 font-mono font-semibold text-slate-700">
                        {(m.amountKz ?? student.monthlyTuitionKz ?? 0).toLocaleString('pt-AO')} Kz
                      </td>
                      <td className="py-3.5 px-4 text-center">
                        <span
                          className={`px-2.5 py-1 rounded-full text-[10px] font-bold uppercase tracking-wider ${
                            m.paid
                              ? 'bg-emerald-100 text-emerald-800'
                              : m.late
                              ? 'bg-rose-100 text-rose-800 animate-pulse'
                              : 'bg-slate-100 text-slate-600'
                          }`}
                        >
                          {m.paid ? 'Liquidado' : m.late ? 'Em Atraso' : 'A Vencer'}
                        </span>
                      </td>
                      <td className="py-3.5 px-4 font-mono text-slate-600">
                        {m.receipt || '---'}
                      </td>
                      <td className="py-3.5 px-4 text-slate-500">
                        {m.date || '---'}
                      </td>
                      <td className="py-3.5 px-4 text-right">
                        {m.paid && m.invoice ? (
                          <button
                            type="button"
                            onClick={() => setReceiptInvoice(m.invoice!)}
                            className="px-2.5 py-1 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-lg text-[11px] font-semibold transition-colors inline-flex items-center gap-1 cursor-pointer"
                          >
                            <span className="material-symbols-outlined text-[14px]">download</span>
                            <span>Recibo</span>
                          </button>
                        ) : m.invoice ? (
                          <div className="flex flex-col items-end gap-1">
                            <PayByReference invoice={m.invoice} variant="portal" />
                            <span className="text-slate-400 text-[11px]">Pendente</span>
                          </div>
                        ) : (
                          <span className="text-slate-400 text-[11px]">Pendente</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* Official Bank Coordinates for Payment */}
          <div className="p-6 bg-white rounded-2xl border border-slate-200 shadow-xs space-y-4">
            <div className="border-b border-slate-100 pb-3">
              <h3 className="text-sm font-bold text-slate-900 flex items-center gap-2">
                <span className="material-symbols-outlined text-indigo-700 text-lg">account_balance</span>
                Coordenadas Bancárias para Depósito
              </h3>
           
            </div>

            {bankAccounts.length === 0 && (
              <Notice tone="warn">
                Nenhuma conta bancária foi adicionada ainda &gt; Contacte a secretaria para obter as coordenadas de pagamento.
              </Notice>
            )}

            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              {bankAccounts.map((b, idx) => (
                <div key={idx} className="p-4 rounded-xl bg-slate-50 border border-slate-200 flex flex-col justify-between gap-3">
                  <div>
                    <span className="text-xs font-bold text-slate-900 block">{b.bank}</span>
                    <span className="text-[10px] text-slate-500 block mt-0.5">Titular: {b.holder}</span>
                  </div>

                  <div className="p-2.5 bg-white rounded-lg border border-slate-200">
                    <span className="text-[10px] text-slate-400 uppercase font-mono block">IBAN Oficial:</span>
                    <span className="font-mono text-xs font-bold text-slate-800 break-all select-all">
                      {b.iban}
                    </span>
                    <div className="mt-1.5 flex items-center justify-between text-[11px] font-semibold text-slate-600">
                      <span>Entidade MCX:</span>
                      <strong className="font-mono text-indigo-700">{b.entity}</strong>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* MODAL: 2.ª via da Fatura-Recibo de uma mensalidade liquidada */}
      {receiptInvoice && (
        <InvoiceReceiptModal
          invoice={receiptInvoice}
          institutionSettings={db.settings}
          onClose={() => setReceiptInvoice(null)}
        />
      )}

      {/* MODAL: Visualizar & Imprimir Boletim Escolar Oficial */}
      {isReportModalOpen && student && (
        <ReportCardModal
          student={student}
          db={db}
          academicYear={selectedYear}
          onClose={() => setIsReportModalOpen(false)}
        />
      )}

      {/* MODAL: Enviar Boletim de Notas ao Encarregado de Educação */}
      {isSendModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs p-4 animate-in fade-in">
          <div className="bg-white rounded-2xl max-w-lg w-full p-6 shadow-2xl border border-slate-200 animate-in zoom-in-95">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3 mb-4">
              <div className="flex items-center gap-2">
                <span className="material-symbols-outlined text-amber-500 text-2xl">forward_to_inbox</span>
                <h3 className="font-bold text-base text-slate-900">
                  Enviar Boletim Escolar ao Encarregado
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setIsSendModalOpen(false)}
                className="text-slate-400 hover:text-slate-600 p-1 cursor-pointer"
              >
                <span className="material-symbols-outlined text-xl">close</span>
              </button>
            </div>

            <div className="space-y-4 text-xs">
              {/* Guardian Info Card */}
              <div className="p-3.5 rounded-xl bg-slate-50 border border-slate-200 space-y-1.5">
                <div className="font-bold text-slate-800 flex items-center gap-1.5">
                  <span className="material-symbols-outlined text-base text-slate-500">person</span>
                  Destinatário: {student.guardianName || 'Encarregado de Educação'}
                </div>
                <div className="text-slate-600 flex items-center gap-4">
                  <span>E-mail: <strong>{student.guardianEmail || 'encarregado@exemplo.ao'}</strong></span>
                  <span>Telemóvel: <strong>{student.guardianPhone || '+244 923 000 000'}</strong></span>
                </div>
              </div>

              {/* Destination Area Explanation */}
              <Notice tone="info">
                <div className="font-bold flex items-center gap-1.5 text-xs text-blue-900">
                  <span className="material-symbols-outlined text-base text-blue-700">security</span>
                  Disponibilização Direta na Área do Encarregado
                </div>
                <p className="text-[11px] text-blue-800 leading-relaxed">
                  O boletim de notas será enviado da sua área de estudante para a <strong>Área do Encarregado</strong> no sistema.
                </p>
                <p className="text-[11px] text-blue-700 leading-relaxed font-semibold">
                  • O seu encarregado de educação poderá consultar o aproveitamento, notas dos 3 trimestres e emitir a impressão oficial da pauta.
                </p>
              </Notice>

              {/* Message to guardian */}
              <div>
                <label className="block font-bold text-slate-700 mb-1">
                  Nota ou Mensagem para o Encarregado:
                </label>
                <textarea
                  rows={3}
                  value={customMessage}
                  onChange={(e) => setCustomMessage(e.target.value)}
                  className="w-full p-2.5 rounded-xl border border-slate-300 text-xs text-slate-800 focus:ring-1 focus:ring-[#0b1f3a]"
                  placeholder="Escreva uma mensagem de acompanhamento..."
                />
              </div>

              <div className="p-3 bg-emerald-50 rounded-xl border border-emerald-200 text-emerald-900 flex items-center gap-2">
                <span className="material-symbols-outlined text-emerald-600 text-lg">verified</span>
                <span>As notas oficiais, médias e situação pedagógica serão sincronizadas de imediato.</span>
              </div>
            </div>

            <div className="flex items-center justify-end gap-2 mt-5 pt-3 border-t border-slate-100">
              <button
                type="button"
                onClick={() => setIsSendModalOpen(false)}
                className="px-4 py-2.5 text-xs font-semibold text-slate-600 hover:bg-slate-100 rounded-xl cursor-pointer"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={handleSendReportCard}
                className="px-5 py-2.5 bg-[#0b1f3a] hover:bg-[#15345d] text-white text-xs font-bold rounded-xl shadow-md transition-all flex items-center gap-1.5 cursor-pointer"
              >
                <span className="material-symbols-outlined text-base">send</span>
                <span>Enviar para Área do Encarregado</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
