import React, { useState, useMemo } from 'react';
import { showOperationSuccess, successParts } from '../context/OperationContext';
import {
  SchoolDatabase,
  User,
  UserRole,
  UnidadeCurricular,
  InscricaoUC,
  MonografiaTCC,
  EstagioCurricular,
  BolsaEstudo,
  DiplomaSuperior,
  EpocaExame
} from '../types';
import {
  checkPrerequisites,
  checkYearTransitionEligibility,
  calculateWeightedAverageECTS,
  calculateCourseFinalGrade,
  calculateSuperiorTuition,
  calculateCurricularAverage,
  checkDiplomaEligibility,
  checkScholarshipMaintenance,
  resolveInscricaoResult,
  buildEquivalencia,
  calculateCadeirasEmFalta,
  allocateRegisterNumber,
  NOTA_DISPENSA,
  qualitativeMentionMESCTI
} from '../utils/superiorCalculations';
import { dbService } from '../services/db';
import { buildDiplomaSupplement } from '../utils/diplomaSupplement';
import { TablePagination, usePagedList } from '../components/TablePagination';
import { Notice } from '../components/Notice';

interface Props {
  db: SchoolDatabase;
  currentUser: User;
  currentUserRole: UserRole;
  onNavigateToStudent?: (studentId: string) => void;
}

type ActiveTab =
  | 'ucs'
  | 'inscricoes'
  | 'epocas_exame'
  | 'estagios'
  | 'monografias'
  | 'diplomas'
  | 'propinas_bolsas';

export const EnsinoSuperiorView: React.FC<Props> = ({
  db,
  currentUser,
  currentUserRole
}) => {
  const [activeTab, setActiveTab] = useState<ActiveTab>('ucs');
  const [selectedCourseId, setSelectedCourseId] = useState<string>('all');
  const [selectedYear, setSelectedYear] = useState<number | 'all'>('all');
  const [selectedSemester, setSelectedSemester] = useState<1 | 2 | 'all'>('all');
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Modals state
  const [showUCModal, setShowUCModal] = useState(false);
  const [editingUC, setEditingUC] = useState<Partial<UnidadeCurricular> | null>(null);

  const [showInscricaoModal, setShowInscricaoModal] = useState(false);
  const [showEquivModal, setShowEquivModal] = useState(false);
  const [equivForm, setEquivForm] = useState({
    studentId: '',
    ucId: '',
    instituicaoOrigem: '',
    notaOrigem: '',
    contaParaMedia: false,
    despacho: ''
  });
  const [newInscricao, setNewInscricao] = useState<{
    studentId: string;
    ucId: string;
    academicYear: string;
  }>({
    studentId: '',
    ucId: '',
    academicYear: db.settings?.currentAcademicYear || '2026/2027'
  });

  const [showTCCModal, setShowTCCModal] = useState(false);
  const [editingTCC, setEditingTCC] = useState<Partial<MonografiaTCC> | null>(null);

  const [showEstagioModal, setShowEstagioModal] = useState(false);
  const [editingEstagio, setEditingEstagio] = useState<Partial<EstagioCurricular> | null>(null);

  const [showBolsaModal, setShowBolsaModal] = useState(false);
  const [editingBolsa, setEditingBolsa] = useState<Partial<BolsaEstudo> | null>(null);

  const [showDiplomaModal, setShowDiplomaModal] = useState(false);

  // Gerador de propina por ECTS
  const [tuitionStudentId, setTuitionStudentId] = useState('');
  const [tuitionSemester, setTuitionSemester] = useState<1 | 2>(1);
  const [tuitionPrice, setTuitionPrice] = useState('');
  const [tuitionMonths, setTuitionMonths] = useState('6');
  const [selectedDiplomaForPrint, setSelectedDiplomaForPrint] = useState<DiplomaSuperior | null>(null);
  const [printMode, setPrintMode] = useState<'diploma' | 'suplemento'>('diploma');
  const [supplementDiploma, setSupplementDiploma] = useState<DiplomaSuperior | null>(null);

  // Collections from db
  const ucs = db.unidadesCurriculares || [];
  const inscricoes = db.inscricoesUC || [];
  const { page: pgB, setPage: setPgB, pageItems: visibleB } = usePagedList(inscricoes, [inscricoes.length]);
  const { page: pgA, setPage: setPgA, pageItems: visibleA } = usePagedList(inscricoes, [inscricoes.length]);
  const monografias = db.monografiasTCC || [];
  const { page: pgMonografias, setPage: setPgMonografias, pageItems: visibleMonografias } = usePagedList(monografias, [monografias.length]);
  const estagios = db.estagiosCurriculares || [];
  const { page: pgEstagios, setPage: setPgEstagios, pageItems: visibleEstagios } = usePagedList(estagios, [estagios.length]);
  const bolsas = db.bolsasEstudo || [];
  const { page: pgBolsas, setPage: setPgBolsas, pageItems: visibleBolsas } = usePagedList(bolsas, [bolsas.length]);
  const diplomas = db.diplomasSuperior || [];
  const { page: pgDiplomas, setPage: setPgDiplomas, pageItems: visibleDiplomas } = usePagedList(diplomas, [diplomas.length]);
  const students = db.students || [];
  const courses = (db.courses || []).filter(
    (c) => c.level === 'superior' || c.cycle?.toLowerCase().includes('superior') || true
  );

  const isManagement = ['admin', 'director', 'secretaria'].includes(currentUserRole);
  const isProfessor = currentUserRole === 'professor';
  const isStudent = currentUserRole === 'aluno';
  const isGuardian = currentUserRole === 'encarregado';

  // Helper notification
  // O sucesso é dado pelo diálogo global (carregamento → visto animado), igual ao login e aos pagamentos.
  const notifySuccess = (msg: string) => {
    const { message, details } = successParts(msg);
    void showOperationSuccess(message, details ? { details } : undefined);
  };

  const notifyError = (msg: string) => {
    setErrorMessage(msg);
    setTimeout(() => setErrorMessage(null), 5000);
  };

  // Filtered UCs
  const filteredUCs = useMemo(() => {
    return ucs.filter((uc) => {
      if (selectedCourseId !== 'all' && uc.courseId !== selectedCourseId) return false;
      if (selectedYear !== 'all' && uc.year !== selectedYear) return false;
      if (selectedSemester !== 'all' && uc.semester !== selectedSemester) return false;
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        return (
          uc.code.toLowerCase().includes(q) ||
          uc.name.toLowerCase().includes(q) ||
          uc.courseName.toLowerCase().includes(q)
        );
      }
      return true;
    });
  }, [ucs, selectedCourseId, selectedYear, selectedSemester, searchQuery]);
  const { page: pgFilteredUCs, setPage: setPgFilteredUCs, pageItems: visibleFilteredUCs } = usePagedList(filteredUCs, [filteredUCs.length]);

  // Handle Save UC
  const handleSaveUC = (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingUC?.name || !editingUC?.code || !editingUC?.courseId) {
      notifyError('Preencha os campos obrigatórios da Unidade Curricular.');
      return;
    }
    const courseObj = courses.find((c) => c.id === editingUC.courseId);
    dbService.saveUnidadeCurricular({
      ...editingUC,
      courseName: courseObj?.name || editingUC.courseName || 'Licenciatura'
    });
    setShowUCModal(false);
    setEditingUC(null);
    notifySuccess('Unidade Curricular guardada com sucesso!');
  };

  // Handle Save Inscrição with Prerequisite check
  const handleCreateInscricao = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newInscricao.studentId || !newInscricao.ucId) {
      notifyError('Selecione o estudante e a Unidade Curricular.');
      return;
    }

    const student = students.find((s) => s.id === newInscricao.studentId);
    const targetUC = ucs.find((u) => u.id === newInscricao.ucId);
    if (!student || !targetUC) return;

    // Check if already inscribed
    const existing = inscricoes.find(
      (i) => i.studentId === student.id && i.ucId === targetUC.id && i.academicYear === newInscricao.academicYear
    );
    if (existing) {
      notifyError(`O estudante já tem inscrição na UC ${targetUC.code} para o ano ${newInscricao.academicYear}.`);
      return;
    }

    // Check prerequisites
    const studentInscs = inscricoes.filter((i) => i.studentId === student.id);
    const prereqCheck = checkPrerequisites(targetUC, studentInscs, ucs);

    if (!prereqCheck.allowed) {
      const missingList = prereqCheck.missingPrerequisites.map((m) => `${m.code} - ${m.name}`).join('; ');
      notifyError(
        `Inscrição bloqueada! O estudante não cumpre as precedências obrigatórias: ${missingList}. É necessário ter aprovação prévia nestas cadeiras.`
      );
      return;
    }

    // Check arrears
    const studentCurricularYear = targetUC.year;
    const transitionCheck = checkYearTransitionEligibility(
      studentInscs,
      studentCurricularYear,
      2,
      12,
      ucs.filter((u) => u.courseId === targetUC.courseId)
    );
    if (!transitionCheck.eligible) {
      notifyError(
        `Aviso regulamentar MESCTI: ${transitionCheck.reason}`
      );
      return;
    }

    const studentYearNum = parseInt(student.grade?.replace(/\D/g, '') || '1', 10);
    const isAtraso = studentYearNum > targetUC.year;

    dbService.saveInscricaoUC({
      studentId: student.id,
      studentName: student.name,
      studentProcNumber: student.procNumber || 'S/N',
      courseId: targetUC.courseId,
      courseName: targetUC.courseName,
      ucId: targetUC.id,
      ucCode: targetUC.code,
      ucName: targetUC.name,
      academicYear: newInscricao.academicYear,
      year: targetUC.year,
      semester: targetUC.semester === 'anual' ? 1 : targetUC.semester,
      creditsECTS: targetUC.creditsECTS,
      isCadeiraAtraso: isAtraso,
      status: 'inscrito'
    });

    setShowInscricaoModal(false);
    setNewInscricao({
      studentId: '',
      ucId: '',
      academicYear: db.settings?.currentAcademicYear || '2026/2027'
    });
    notifySuccess(
      `Estudante ${student.name} inscrito em ${targetUC.code} (${targetUC.creditsECTS} ECTS)!`
    );
  };

  // Equivalência / transferência: reconhece uma UC feita noutra instituição ou curso.
  const handleCreateEquivalencia = (e: React.FormEvent) => {
    e.preventDefault();
    const student = students.find((s) => s.id === equivForm.studentId);
    const targetUC = ucs.find((u) => u.id === equivForm.ucId);
    if (!student || !targetUC) {
      notifyError('Selecione o estudante e a Unidade Curricular.');
      return;
    }
    const nota = equivForm.notaOrigem.trim() === '' ? undefined : parseFloat(equivForm.notaOrigem.replace(',', '.'));
    const result = buildEquivalencia({
      uc: targetUC,
      student: { id: student.id, name: student.name, procNumber: student.procNumber },
      academicYear: db.settings?.currentAcademicYear || '',
      equivalencia: {
        instituicaoOrigem: equivForm.instituicaoOrigem,
        notaOrigem: nota === undefined || Number.isNaN(nota) ? undefined : nota,
        contaParaMedia: equivForm.contaParaMedia,
        despacho: equivForm.despacho.trim() || undefined
      },
      existing: inscricoes
    });
    if (result.ok === false) {
      notifyError(result.error);
      return;
    }
    dbService.saveInscricaoUC(result.inscricao);
    setShowEquivModal(false);
    setEquivForm({ studentId: '', ucId: '', instituicaoOrigem: '', notaOrigem: '', contaParaMedia: false, despacho: '' });
    notifySuccess(`Equivalência a ${targetUC.code} registada para ${student.name} (${targetUC.creditsECTS} ECTS).`);
  };

  // Grade updates in Épocas de Exame
  const handleUpdateGrade = (
    inscId: string,
    field: 'notaFrequencia' | 'notaExameNormal' | 'notaRecurso' | 'notaEspecial',
    valueStr: string
  ) => {
    const parsed = valueStr === '' ? undefined : parseFloat(valueStr.replace(',', '.'));
    const val = parsed === undefined || Number.isNaN(parsed) ? undefined : Math.min(20, Math.max(0, parsed));
    const item = inscricoes.find((i) => i.id === inscId);
    if (!item) return;
    // Uma equivalência não tem épocas: lançar notas apagaria o reconhecimento.
    if (item.equivalencia) {
      notifyError('Esta UC foi reconhecida por equivalência; não tem épocas de exame.');
      return;
    }

    const updated = { ...item, [field]: val };
    // Regras das épocas (dispensa, melhor nota aprovada, reprovação) vivem em superiorCalculations.ts, onde são testadas.
    const result = resolveInscricaoResult(updated);

    dbService.saveInscricaoUC({
      ...updated,
      notaFinal: result.notaFinal,
      epocaAprovacao: result.epocaAprovacao,
      status: result.status
    });
  };

  // Handle Save TCC
  const handleSaveTCC = (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingTCC?.studentId || !editingTCC?.theme || !editingTCC?.advisorName) {
      notifyError('Preencha os campos obrigatórios do TCC.');
      return;
    }
    const student = students.find((s) => s.id === editingTCC.studentId);
    dbService.saveMonografiaTCC({
      ...editingTCC,
      studentName: student?.name || editingTCC.studentName || 'Estudante',
      studentProcNumber: student?.procNumber || editingTCC.studentProcNumber || 'S/N'
    });
    setShowTCCModal(false);
    setEditingTCC(null);
    notifySuccess('Trabalho de Conclusão de Curso (TCC) atualizado!');
  };

  // Handle Save Estágio
  const handleSaveEstagio = (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingEstagio?.studentId || !editingEstagio?.institutionOrCompany) {
      notifyError('Preencha os campos obrigatórios do Estágio.');
      return;
    }
    const student = students.find((s) => s.id === editingEstagio.studentId);
    dbService.saveEstagioCurricular({
      ...editingEstagio,
      studentName: student?.name || editingEstagio.studentName || 'Estudante',
      studentProcNumber: student?.procNumber || editingEstagio.studentProcNumber || 'S/N'
    });
    setShowEstagioModal(false);
    setEditingEstagio(null);
    notifySuccess('Registo de Estágio Curricular guardado!');
  };

  // Handle Save Bolsa
  const handleSaveBolsa = (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingBolsa?.studentId || !editingBolsa?.sponsorName) {
      notifyError('Preencha os campos obrigatórios da Bolsa de Estudo.');
      return;
    }
    const student = students.find((s) => s.id === editingBolsa.studentId);
    dbService.saveBolsaEstudo({
      ...editingBolsa,
      studentName: student?.name || editingBolsa.studentName || 'Estudante',
      studentProcNumber: student?.procNumber || editingBolsa.studentProcNumber || 'S/N'
    });
    setShowBolsaModal(false);
    setEditingBolsa(null);
    notifySuccess('Bolsa de Estudo registada com sucesso!');
  };

  // Propina do semestre: calcula a partir das UCs inscritas e da bolsa; gera a fatura na Tesouraria.
  const canBill = ['admin', 'director', 'secretaria', 'financeiro'].includes(currentUserRole);
  const computeTuition = () => {
    const student = students.find((s) => s.id === tuitionStudentId);
    const price = parseFloat(tuitionPrice.replace(',', '.'));
    if (!student || !Number.isFinite(price) || price <= 0) return null;
    const year = db.settings?.currentAcademicYear || '';
    const inSemester = inscricoes.filter(
      (i) => i.studentId === student.id && i.academicYear === year && i.semester === tuitionSemester && i.status !== 'anulado'
    );
    const enrolledECTS = inSemester.reduce((sum, i) => sum + (i.creditsECTS || 0), 0);
    const bolsa = bolsas.find((b) => b.studentId === student.id && b.status === 'ativa' && (!b.academicYear || b.academicYear === year));
    const history = inscricoes.filter((i) => i.studentId === student.id);
    let bolsaToApply = bolsa || null;
    let bolsaWarning: string[] = [];
    if (bolsa) {
      const maintenance = checkScholarshipMaintenance(
        bolsa,
        calculateCurricularAverage(history).average,
        calculateCadeirasEmFalta(
          ucs.filter((u) => inSemester.some((i) => i.courseId === u.courseId)),
          history,
          Math.max(1, ...inSemester.map((i) => i.year))
        ).length
      );
      if (!maintenance.maintained) {
        bolsaToApply = null;
        bolsaWarning = maintenance.reasons;
      }
    }
    const months = Math.max(1, parseInt(tuitionMonths, 10) || 1);
    const calc = calculateSuperiorTuition(enrolledECTS, price, bolsaToApply, 0, months);
    return { student, year, enrolledECTS, price, calc, bolsaWarning, hasBolsa: !!bolsa };
  };

  const handleGenerateTuition = () => {
    const t = computeTuition();
    if (!t) { notifyError('Escolha o estudante e indique o valor por ECTS.'); return; }
    if (t.enrolledECTS <= 0) { notifyError('O estudante não tem UCs inscritas neste semestre.'); return; }
    const period = `${t.year} · ${tuitionSemester}.º semestre`;
    const duplicate = (db.invoices || []).some((i) => i.studentId === t.student.id && i.period === period);
    if (duplicate) { notifyError(`Já existe fatura de ${period} para ${t.student.name}.`); return; }
    const due = new Date(Date.now() + 15 * 86400000).toISOString().split('T')[0];
    dbService.createInvoice({
      studentId: t.student.id,
      studentName: t.student.name,
      procNumber: t.student.procNumber || 'S/N',
      avatar: (t.student as any).avatar || '',
      className: t.student.grade || '',
      guardianName: (t.student as any).guardianName || '',
      guardianNif: (t.student as any).guardianNif || '',
      period,
      description: `Propina ${tuitionSemester}.º semestre — ${t.enrolledECTS} ECTS × ${t.price.toLocaleString('pt-PT')} Kz`,
      baseAmountKz: t.calc.grossAmountKz,
      lateFeeKz: 0,
      totalAmountKz: t.calc.netAmountKz,
      subtotalKz: t.calc.grossAmountKz,
      discountName: t.calc.scholarshipName,
      discountAmountKz: t.calc.discountAmountKz,
      dueDate: due,
      status: t.calc.netAmountKz === 0 ? 'isento' : 'pendente',
      academicYear: t.year
    } as any);
    notifySuccess(`Fatura de ${period} gerada para ${t.student.name}: ${t.calc.netAmountKz.toLocaleString('pt-PT')} Kz.`);
  };

  // Issue Diploma
  const handleIssueDiploma = (studentId: string) => {
    const student = students.find((s) => s.id === studentId);
    if (!student) return;

    if (diplomas.some((d) => d.studentId === student.id && d.status !== 'anulado')) {
      notifyError(`${student.name} já tem diploma emitido.`);
      return;
    }

    // Histórico completo do estudante (todas as inscrições, de todos os anos)
    const studentInscs = inscricoes.filter((i) => i.studentId === student.id);
    const courseId = studentInscs[0]?.courseId || '';
    const courseName = studentInscs[0]?.courseName || student.courseName || (student as any).course || '';
    const tcc = monografias.find((m) => m.studentId === student.id);
    const studentEstagios = estagios.filter((e) => e.studentId === student.id);

    const eligibility = checkDiplomaEligibility({
      ucsDoCurso: ucs.filter((u) => u.courseId === courseId),
      inscricoes: studentInscs,
      tcc,
      estagios: studentEstagios
    });
    if (!eligibility.eligible) {
      notifyError(`Diploma bloqueado: ${eligibility.reasons.join(' ')}`);
      return;
    }

    const weightedAvg = calculateCurricularAverage(studentInscs);
    const finalCourseCalc = calculateCourseFinalGrade(weightedAvg.average, tcc?.defenseGrade);
    if (!finalCourseCalc.approved) {
      notifyError(`Diploma bloqueado: ${finalCourseCalc.reason}`);
      return;
    }

    const yearNow = new Date().getFullYear();
    // Maior número do ano + 1 (não depende de quantos registos existem, logo não repete após apagar)
    const registerNumber = allocateRegisterNumber(diplomas, yearNow);
    const settings = db.settings || ({} as NonNullable<typeof db.settings>);

    let newDip: DiplomaSuperior;
    try {
    newDip = dbService.saveDiplomaSuperior({
      studentId: student.id,
      studentName: student.name,
      studentProcNumber: student.procNumber || 'S/N',
      courseId,
      courseName,
      degreeGranted: 'Licenciatura',
      degreeTitle: `Licenciado em ${courseName}`,
      academicYearConcluded: db.settings?.currentAcademicYear || `${yearNow - 1}/${yearNow}`,
      completionDate: tcc?.defenseDate || new Date().toISOString().split('T')[0],
      finalGradeCurricular: weightedAvg.average,
      tccGrade: tcc?.defenseGrade,
      finalCourseGrade: finalCourseCalc.finalGrade,
      finalMention: finalCourseCalc.finalMention,
      totalCreditsECTS: eligibility.totalECTS,
      registerNumber,
      // Livro e folha são dados do registo oficial da instituição: ficam por preencher em vez de inventados.
      registryBook: settings.diplomaRegistryBook || '',
      registryPage: '',
      issueDate: new Date().toISOString().split('T')[0],
      rectorName: settings.rectorName || '',
      academicDirectorName: settings.academicDirectorName || settings.directorPedagogico || '',
      status: 'emitido'
    });
    } catch (err) {
      notifyError(err instanceof Error ? err.message : 'Não foi possível emitir o diploma.');
      return;
    }

    notifySuccess(`Diploma de ${student.name} emitido com Média Final de ${finalCourseCalc.finalGrade} (${finalCourseCalc.finalMention})!`);
    setSelectedDiplomaForPrint(newDip);
  };

  const supplement = useMemo(() => {
    if (!supplementDiploma) return null;
    return buildDiplomaSupplement({
      diploma: supplementDiploma,
      inscricoes,
      ucs,
      estagios,
      tcc: monografias.find((m) => m.studentId === supplementDiploma.studentId && m.status === 'defendido') || null
    });
  }, [supplementDiploma, inscricoes, ucs, estagios, monografias]);

  return (
    <div className="space-y-6 pb-12">
      {/* Header Banner */}
      <div className="bg-gradient-to-r from-indigo-900 via-slate-900 to-blue-900 text-white rounded-2xl p-6 shadow-xl border border-indigo-700/40">
        <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <span className="px-2.5 py-0.5 rounded-full text-xs font-semibold bg-amber-500/20 text-amber-300 border border-amber-500/30">
                Padrão MESCTI — República de Angola
              </span>
              <span className="px-2.5 py-0.5 rounded-full text-xs font-semibold bg-blue-500/20 text-blue-300 border border-blue-500/30">
                Regime Semestral / 30 ECTS
              </span>
            </div>
            <h1 className="text-2xl md:text-3xl font-extrabold tracking-tight">
              Gestão de Ensino Superior & Créditos ECTS
            </h1>
            <p className="text-sm text-slate-300 mt-1 max-w-3xl">
              Estrutura curricular semestral, precedências obrigatórias, 4 épocas de exame (Frequência, Normal, Recurso e Especial),
              acompanhamento de estágios, defesa de monografias/TCC, diplomas oficiais e propinas proporcionais a créditos.
            </p>
          </div>

          <div className="flex items-center gap-3">
            {isManagement && (
              <>
                <button
                  onClick={() => {
                    setEditingUC({
                      creditsECTS: 6,
                      year: 1,
                      semester: 1,
                      type: 'obrigatoria',
                      prerequisites: [],
                      status: 'ativo'
                    });
                    setShowUCModal(true);
                  }}
                  className="px-4 py-2.5 bg-blue-600 hover:bg-blue-500 text-white font-medium rounded-xl shadow-md flex items-center gap-2 transition"
                >
                  <span className="material-symbols-outlined text-lg">add_circle</span>
                  Nova UC
                </button>

                <button
                  onClick={() => setShowInscricaoModal(true)}
                  className="px-4 py-2.5 bg-amber-600 hover:bg-amber-500 text-white font-medium rounded-xl shadow-md flex items-center gap-2 transition"
                >
                  <span className="material-symbols-outlined text-lg">how_to_reg</span>
                  Inscrever em UC
                </button>

                <button
                  onClick={() => setShowEquivModal(true)}
                  className="px-4 py-2.5 bg-emerald-700 hover:bg-emerald-600 text-white font-medium rounded-xl shadow-md flex items-center gap-2 transition"
                >
                  <span className="material-symbols-outlined text-lg">swap_horiz</span>
                  Equivalência
                </button>
              </>
            )}
          </div>
        </div>

        {/* Global Notifications */}
        {errorMessage && (
          <div className="mt-4 p-3 bg-rose-900/60 border border-rose-500/40 text-rose-200 rounded-xl flex items-center gap-2 text-sm">
            <span className="material-symbols-outlined">warning</span>
            {errorMessage}
          </div>
        )}

        {/* Quick KPI Stats */}
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3 mt-6">
          <div className="bg-slate-800/60 border border-slate-700/50 rounded-xl p-3">
            <p className="text-xs text-slate-400 font-medium">Unidades Curriculares</p>
            <p className="text-xl font-bold text-white mt-1">{ucs.length}</p>
          </div>
          <div className="bg-slate-800/60 border border-slate-700/50 rounded-xl p-3">
            <p className="text-xs text-slate-400 font-medium">Inscrições Ativas</p>
            <p className="text-xl font-bold text-amber-400 mt-1">{inscricoes.length}</p>
          </div>
          <div className="bg-slate-800/60 border border-slate-700/50 rounded-xl p-3">
            <p className="text-xs text-slate-400 font-medium">TCCs / Monografias</p>
            <p className="text-xl font-bold text-blue-400 mt-1">{monografias.length}</p>
          </div>
          <div className="bg-slate-800/60 border border-slate-700/50 rounded-xl p-3">
            <p className="text-xs text-slate-400 font-medium">Estágios Curriculares</p>
            <p className="text-xl font-bold text-emerald-400 mt-1">{estagios.length}</p>
          </div>
          <div className="bg-slate-800/60 border border-slate-700/50 rounded-xl p-3">
            <p className="text-xs text-slate-400 font-medium">Bolsas (INAGBE / Mérito)</p>
            <p className="text-xl font-bold text-purple-400 mt-1">{bolsas.length}</p>
          </div>
          <div className="bg-slate-800/60 border border-slate-700/50 rounded-xl p-3">
            <p className="text-xs text-slate-400 font-medium">Diplomas Emitidos</p>
            <p className="text-xl font-bold text-cyan-400 mt-1">{diplomas.length}</p>
          </div>
        </div>
      </div>

      {/* Tabs Navigation */}
      <div className="flex border-b border-slate-200 dark:border-slate-800 overflow-x-auto gap-2 pb-1 scrollbar-thin">
        {[
          { id: 'ucs', label: '1. Plano Curricular & UCs', icon: 'menu_book' },
          { id: 'inscricoes', label: '2. Inscrições & Precedências', icon: 'rule' },
          { id: 'epocas_exame', label: '3. Pauta & Épocas de Exame', icon: 'fact_check' },
          { id: 'estagios', label: '4. Estágios Curriculares', icon: 'domain' },
          { id: 'monografias', label: '5. Monografias & TCC', icon: 'school' },
          { id: 'diplomas', label: '6. Diplomas & Suplemento', icon: 'workspace_premium' },
          { id: 'propinas_bolsas', label: '7. Propinas ECTS & Bolsas', icon: 'payments' }
        ].map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id as ActiveTab)}
            className={`flex items-center gap-2 px-4 py-2.5 font-medium text-sm rounded-xl whitespace-nowrap transition-all ${
              activeTab === tab.id
                ? 'bg-blue-600 text-white shadow-md'
                : 'text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-slate-800'
            }`}
          >
            <span className="material-symbols-outlined text-lg">{tab.icon}</span>
            {tab.label}
          </button>
        ))}
      </div>

      {/* Filter Toolbar */}
      <div className="bg-white dark:bg-slate-900 p-4 rounded-xl border border-slate-200 dark:border-slate-800 shadow-sm flex flex-col md:flex-row gap-3 items-center justify-between">
        <div className="flex flex-wrap items-center gap-3 w-full md:w-auto">
          {/* Search */}
          <div className="relative min-w-[240px]">
            <span className="material-symbols-outlined absolute left-3 top-2.5 text-slate-400 text-lg">search</span>
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Pesquisar UC, código, estudante..."
              className="w-full pl-9 pr-3 py-2 text-sm bg-slate-50 dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>

          {/* Course Filter */}
          <select
            value={selectedCourseId}
            onChange={(e) => setSelectedCourseId(e.target.value)}
            className="text-sm bg-slate-50 dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            <option value="all">Todos os Cursos Superiores</option>
            {courses.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>

          {/* Year Filter */}
          <select
            value={selectedYear}
            onChange={(e) => setSelectedYear(e.target.value === 'all' ? 'all' : parseInt(e.target.value, 10))}
            className="text-sm bg-slate-50 dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            <option value="all">Todos os Anos</option>
            <option value="1">1.º Ano</option>
            <option value="2">2.º Ano</option>
            <option value="3">3.º Ano</option>
            <option value="4">4.º Ano</option>
            <option value="5">5.º Ano</option>
          </select>

          {/* Semester Filter */}
          <select
            value={selectedSemester}
            onChange={(e) => setSelectedSemester(e.target.value === 'all' ? 'all' : (parseInt(e.target.value, 10) as 1 | 2))}
            className="text-sm bg-slate-50 dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            <option value="all">Todos os Semestres</option>
            <option value="1">1.º Semestre</option>
            <option value="2">2.º Semestre</option>
          </select>
        </div>

        <div className="text-xs text-slate-500 dark:text-slate-400 self-end md:self-auto">
          Ano Letivo Ativo: <span className="font-semibold text-slate-700 dark:text-slate-200">{db.settings?.currentAcademicYear || '2026/2027'}</span>
        </div>
      </div>

      {/* TAB 1: UCs & PLANO CURRICULAR */}
      {activeTab === 'ucs' && (
        <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-sm overflow-hidden">
          <div className="p-4 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between">
            <div>
              <h2 className="text-lg font-bold text-slate-900 dark:text-white">
                Catálogo de Unidades Curriculares (UCs)
              </h2>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Regime semestral por créditos ECTS (30 ECTS por semestre, 60 ECTS anuais) com carga horária de contacto (T, P, TP, PL).
              </p>
            </div>
            <span className="text-xs bg-blue-100 dark:bg-blue-900/40 text-blue-800 dark:text-blue-300 font-semibold px-2.5 py-1 rounded-full">
              {filteredUCs.length} UC(s) listadas
            </span>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-sm">
              <thead>
                <tr className="bg-slate-50 dark:bg-slate-800/60 border-b border-slate-200 dark:border-slate-800 text-xs text-slate-600 dark:text-slate-300 font-semibold">
                  <th className="p-3">Código</th>
                  <th className="p-3">Unidade Curricular</th>
                  <th className="p-3">Curso & Departamento</th>
                  <th className="p-3 text-center">Ano / Semestre</th>
                  <th className="p-3 text-center">Créditos ECTS</th>
                  <th className="p-3">Carga Horária (Contacto / Autónomo)</th>
                  <th className="p-3">Precedências Obrigatórias</th>
                  <th className="p-3 text-right">Ações</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {visibleFilteredUCs.map((uc) => {
                  const prereqCount = uc.prerequisites?.length || 0;
                  const prereqNames = (uc.prerequisites || [])
                    .map((pid) => ucs.find((u) => u.id === pid)?.code || pid)
                    .join(', ');

                  return (
                    <tr key={uc.id} className="hover:bg-slate-50/70 dark:hover:bg-slate-800/40 transition">
                      <td className="p-3 font-mono font-bold text-blue-600 dark:text-blue-400">
                        {uc.code}
                      </td>
                      <td className="p-3">
                        <div className="font-semibold text-slate-900 dark:text-white">{uc.name}</div>
                        <div className="text-xs text-slate-500 capitalize">{uc.type}</div>
                      </td>
                      <td className="p-3 text-xs text-slate-600 dark:text-slate-400">
                        <div className="font-medium text-slate-800 dark:text-slate-200">{uc.courseName}</div>
                        {uc.department && <div className="text-slate-400">Dep: {uc.department}</div>}
                      </td>
                      <td className="p-3 text-center text-xs">
                        <span className="font-semibold">{uc.year}.º Ano</span>
                        <div className="text-slate-400">{uc.semester === 'anual' ? 'Anual' : `${uc.semester}.º Semestre`}</div>
                      </td>
                      <td className="p-3 text-center">
                        <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-bold bg-amber-100 dark:bg-amber-900/40 text-amber-800 dark:text-amber-300">
                          {uc.creditsECTS} ECTS
                        </span>
                      </td>
                      <td className="p-3 text-xs text-slate-600 dark:text-slate-400">
                        <div><strong className="text-slate-800 dark:text-slate-200">{uc.totalHours}h</strong> totais</div>
                        <div className="text-[11px] text-slate-400">
                          T:{uc.contactHours.teorica}h | P:{uc.contactHours.pratica}h | TP:{uc.contactHours.teoricoPratica}h | PL:{uc.contactHours.laboratorial}h
                        </div>
                      </td>
                      <td className="p-3 text-xs">
                        {prereqCount > 0 ? (
                          <span className="inline-flex items-center gap-1 text-rose-600 dark:text-rose-400 font-medium">
                            <span className="material-symbols-outlined text-xs">lock</span>
                            {prereqNames}
                          </span>
                        ) : (
                          <span className="text-slate-400 text-xs italic">Sem pré-requisitos</span>
                        )}
                      </td>
                      <td className="p-3 text-right">
                        {isManagement && (
                          <div className="flex items-center justify-end gap-1">
                            <button
                              onClick={() => {
                                setEditingUC(uc);
                                setShowUCModal(true);
                              }}
                              className="p-1.5 text-slate-500 hover:text-blue-600 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg transition"
                              title="Editar UC"
                            >
                              <span className="material-symbols-outlined text-sm">edit</span>
                            </button>
                            <button
                              onClick={() => {
                                if (confirm(`Deseja remover a Unidade Curricular ${uc.name}?`)) {
                                  dbService.deleteUnidadeCurricular(uc.id);
                                  notifySuccess('Unidade Curricular removida.');
                                }
                              }}
                              className="p-1.5 text-slate-500 hover:text-rose-600 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg transition"
                              title="Remover UC"
                            >
                              <span className="material-symbols-outlined text-sm">delete</span>
                            </button>
                          </div>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            <TablePagination total={filteredUCs.length} page={pgFilteredUCs} onPageChange={setPgFilteredUCs} />
          </div>
        </div>
      )}

      {/* TAB 2: INSCRIÇÕES & PRECEDÊNCIAS */}
      {activeTab === 'inscricoes' && (
        <div className="space-y-6">
          <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 p-5 shadow-sm">
            <h2 className="text-lg font-bold text-slate-900 dark:text-white mb-2">
              Regras Oficiais de Inscrição & Transição com Precedências (MESCTI)
            </h2>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-xs">
              <div className="p-3.5 bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800/40 rounded-xl">
                <div className="font-bold text-blue-900 dark:text-blue-300 flex items-center gap-1 mb-1">
                  <span className="material-symbols-outlined text-sm">lock</span>
                  1. Precedência Estrita
                </div>
                <p className="text-blue-800 dark:text-blue-200">
                  Um estudante só pode inscrever-se numa UC se tiver obtido aprovação (&ge;10 valores) em todas as cadeiras pré-requisito cadastradas.
                </p>
              </div>

              <div className="p-3.5 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800/40 rounded-xl">
                <div className="font-bold text-amber-900 dark:text-amber-300 flex items-center gap-1 mb-1">
                  <span className="material-symbols-outlined text-sm">swap_horiz</span>
                  2. Cadeiras de Transição (Atraso)
                </div>
                <p className="text-amber-800 dark:text-amber-200">
                  A transição de ano curricular permite no máximo <strong>2 cadeiras em atraso</strong> ou <strong>12 créditos ECTS</strong>. Acima desse limite, o aluno fica retido no ano anterior.
                </p>
              </div>

              <div className="p-3.5 bg-emerald-50 dark:bg-emerald-900/20 border border-emerald-200 dark:border-emerald-800/40 rounded-xl">
                <div className="font-bold text-emerald-900 dark:text-emerald-300 flex items-center gap-1 mb-1">
                  <span className="material-symbols-outlined text-sm">functions</span>
                  3. Média Ponderada por ECTS
                </div>
                <p className="text-emerald-800 dark:text-emerald-200">
                  Fórmula oficial: &Sigma;(Nota &times; ECTS) / &Sigma;ECTS. Cada UC contribui para o histórico curricular proporcionalmente ao seu peso em créditos.
                </p>
              </div>
            </div>
          </div>

          {/* Inscrições Table */}
          <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-sm overflow-hidden">
            <div className="p-4 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between">
              <div>
                <h3 className="font-bold text-slate-900 dark:text-white">Inscrições Curriculares dos Estudantes</h3>
                <p className="text-xs text-slate-500">Registo oficial de matrícula semestral por cadeira.</p>
              </div>
              <span className="text-xs font-semibold px-2.5 py-1 bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 rounded-lg">
                Total: {inscricoes.length}
              </span>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead>
                  <tr className="bg-slate-50 dark:bg-slate-800/60 border-b border-slate-200 dark:border-slate-800 text-xs text-slate-600 dark:text-slate-300 font-semibold">
                    <th className="p-3">Estudante</th>
                    <th className="p-3">Unidade Curricular</th>
                    <th className="p-3 text-center">Ano / Semestre</th>
                    <th className="p-3 text-center">ECTS</th>
                    <th className="p-3 text-center">Cadeira em Atraso?</th>
                    <th className="p-3 text-center">Estado</th>
                    <th className="p-3 text-center">Classificação Final</th>
                    <th className="p-3 text-right">Ações</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                  {visibleA.map((insc) => (
                    <tr key={insc.id} className="hover:bg-slate-50/70 dark:hover:bg-slate-800/40">
                      <td className="p-3">
                        <div className="font-semibold text-slate-900 dark:text-white">{insc.studentName}</div>
                        <div className="text-xs text-slate-400 font-mono">Proc: {insc.studentProcNumber}</div>
                      </td>
                      <td className="p-3">
                        <div className="font-medium text-blue-600 dark:text-blue-400">{insc.ucCode}</div>
                        <div className="text-xs text-slate-600 dark:text-slate-300">{insc.ucName}</div>
                      </td>
                      <td className="p-3 text-center text-xs">
                        {insc.year}.º Ano ({insc.semester}.º Sem)
                      </td>
                      <td className="p-3 text-center font-bold text-xs text-slate-700 dark:text-slate-300">
                        {insc.creditsECTS} ECTS
                      </td>
                      <td className="p-3 text-center">
                        {insc.isCadeiraAtraso ? (
                          <span className="px-2 py-0.5 rounded text-[11px] font-bold bg-amber-100 dark:bg-amber-900/40 text-amber-800 dark:text-amber-300">
                            Cadeira de Transição
                          </span>
                        ) : (
                          <span className="text-xs text-slate-400">Regular</span>
                        )}
                      </td>
                      <td className="p-3 text-center">
                        <span
                          className={`px-2.5 py-0.5 rounded-full text-xs font-semibold ${
                            insc.status === 'aprovado'
                              ? 'bg-emerald-100 dark:bg-emerald-900/40 text-emerald-800 dark:text-emerald-300'
                              : insc.status === 'reprovado'
                              ? 'bg-rose-100 dark:bg-rose-900/40 text-rose-800 dark:text-rose-300'
                              : 'bg-blue-100 dark:bg-blue-900/40 text-blue-800 dark:text-blue-300'
                          }`}
                        >
                          {insc.status.toUpperCase()}
                        </span>
                      </td>
                      <td className="p-3 text-center">
                        {typeof insc.notaFinal === 'number' ? (
                          <span
                            className={`font-bold ${
                              insc.notaFinal >= 10 ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400'
                            }`}
                          >
                            {insc.notaFinal} val ({insc.epocaAprovacao || 'final'})
                          </span>
                        ) : (
                          <span className="text-slate-400 text-xs italic">A frequentar</span>
                        )}
                      </td>
                      <td className="p-3 text-right">
                        {isManagement && (
                          <button
                            onClick={() => {
                              if (confirm(`Deseja anular a inscrição de ${insc.studentName} na UC ${insc.ucCode}?`)) {
                                dbService.deleteInscricaoUC(insc.id);
                                notifySuccess('Inscrição anulada.');
                              }
                            }}
                            className="p-1.5 text-slate-400 hover:text-rose-600 rounded-lg"
                            title="Anular Inscrição"
                          >
                            <span className="material-symbols-outlined text-sm">cancel</span>
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <TablePagination total={inscricoes.length} page={pgA} onPageChange={setPgA} />
            </div>
          </div>
        </div>
      )}

      {/* TAB 3: ÉPOCAS DE EXAME & PAUTAS */}
      {activeTab === 'epocas_exame' && (
        <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-sm overflow-hidden">
          <div className="p-4 border-b border-slate-200 dark:border-slate-800 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div>
              <h2 className="text-lg font-bold text-slate-900 dark:text-white">
                Pauta Semestral por Épocas de Exame
              </h2>
              <p className="text-xs text-slate-500">
                Lançamento oficial com 4 épocas: <strong>Dispensa (&ge;{NOTA_DISPENSA})</strong>, <strong>Exame Normal (1.ª Época)</strong>, <strong>Recurso (2.ª Época)</strong> e <strong>Época Especial</strong>.
              </p>
            </div>
            <div className="flex items-center gap-2">
              <span className="px-3 py-1 bg-amber-50 dark:bg-amber-900/30 text-amber-800 dark:text-amber-300 text-xs rounded-lg font-medium border border-amber-300/30">
                Dispensa &ge; {NOTA_DISPENSA} val
              </span>
              <span className="px-3 py-1 bg-emerald-50 dark:bg-emerald-900/30 text-emerald-800 dark:text-emerald-300 text-xs rounded-lg font-medium border border-emerald-300/30">
                Aprovação &ge; 10 val
              </span>
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="bg-slate-50 dark:bg-slate-800/60 border-b border-slate-200 dark:border-slate-800 text-xs text-slate-600 dark:text-slate-300 font-semibold">
                  <th className="p-3">Estudante</th>
                  <th className="p-3">Cadeira / UC</th>
                  <th className="p-3 text-center w-28">Frequência (0-20)</th>
                  <th className="p-3 text-center w-28">Exame Normal (1.ª Época)</th>
                  <th className="p-3 text-center w-28">Recurso (2.ª Época)</th>
                  <th className="p-3 text-center w-28">Época Especial</th>
                  <th className="p-3 text-center">Classificação Final</th>
                  <th className="p-3 text-center">Situação</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {visibleB.map((insc) => {
                  const canEdit = isManagement || isProfessor;
                  const isDispensado = typeof insc.notaFrequencia === 'number' && insc.notaFrequencia >= NOTA_DISPENSA;

                  return (
                    <tr key={insc.id} className="hover:bg-slate-50/70 dark:hover:bg-slate-800/40">
                      <td className="p-3">
                        <div className="font-semibold text-slate-900 dark:text-white">{insc.studentName}</div>
                        <div className="text-xs text-slate-400 font-mono">Proc: {insc.studentProcNumber}</div>
                      </td>
                      <td className="p-3">
                        <span className="font-bold text-blue-600 dark:text-blue-400 font-mono">{insc.ucCode}</span>
                        <div className="text-xs text-slate-600 dark:text-slate-300">{insc.ucName}</div>
                      </td>

                      {/* Nota Frequência */}
                      <td className="p-3 text-center">
                        {canEdit ? (
                          <input
                            type="number"
                            min="0"
                            max="20"
                            step="0.1"
                            value={insc.notaFrequencia ?? ''}
                            onChange={(e) => handleUpdateGrade(insc.id, 'notaFrequencia', e.target.value)}
                            placeholder="0-20"
                            className="w-20 text-center py-1 text-xs border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 rounded focus:ring-1 focus:ring-blue-500"
                          />
                        ) : (
                          <span className="font-semibold">{insc.notaFrequencia ?? '—'}</span>
                        )}
                      </td>

                      {/* Exame Normal */}
                      <td className="p-3 text-center">
                        {isDispensado ? (
                          <span className="text-xs font-semibold text-emerald-600 dark:text-emerald-400">
                            Dispensado
                          </span>
                        ) : canEdit ? (
                          <input
                            type="number"
                            min="0"
                            max="20"
                            step="0.1"
                            value={insc.notaExameNormal ?? ''}
                            onChange={(e) => handleUpdateGrade(insc.id, 'notaExameNormal', e.target.value)}
                            placeholder="0-20"
                            className="w-20 text-center py-1 text-xs border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 rounded focus:ring-1 focus:ring-blue-500"
                          />
                        ) : (
                          <span className="font-semibold">{insc.notaExameNormal ?? '—'}</span>
                        )}
                      </td>

                      {/* Recurso */}
                      <td className="p-3 text-center">
                        {canEdit ? (
                          <input
                            type="number"
                            min="0"
                            max="20"
                            step="0.1"
                            value={insc.notaRecurso ?? ''}
                            onChange={(e) => handleUpdateGrade(insc.id, 'notaRecurso', e.target.value)}
                            placeholder="0-20"
                            className="w-20 text-center py-1 text-xs border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 rounded focus:ring-1 focus:ring-blue-500"
                          />
                        ) : (
                          <span className="font-semibold">{insc.notaRecurso ?? '—'}</span>
                        )}
                      </td>

                      {/* Especial */}
                      <td className="p-3 text-center">
                        {canEdit ? (
                          <input
                            type="number"
                            min="0"
                            max="20"
                            step="0.1"
                            value={insc.notaEspecial ?? ''}
                            onChange={(e) => handleUpdateGrade(insc.id, 'notaEspecial', e.target.value)}
                            placeholder="0-20"
                            className="w-20 text-center py-1 text-xs border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 rounded focus:ring-1 focus:ring-blue-500"
                          />
                        ) : (
                          <span className="font-semibold">{insc.notaEspecial ?? '—'}</span>
                        )}
                      </td>

                      {/* Nota Final */}
                      <td className="p-3 text-center font-bold">
                        {typeof insc.notaFinal === 'number' ? (
                          <span
                            className={
                              insc.notaFinal >= 10 ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400'
                            }
                          >
                            {insc.notaFinal} val
                          </span>
                        ) : (
                          <span className="text-slate-400 font-normal text-xs">—</span>
                        )}
                      </td>

                      {/* Situação */}
                      <td className="p-3 text-center">
                        <span
                          className={`px-2 py-0.5 rounded text-xs font-semibold ${
                            insc.status === 'aprovado'
                              ? 'bg-emerald-100 dark:bg-emerald-900/40 text-emerald-800 dark:text-emerald-300'
                              : insc.status === 'reprovado'
                              ? 'bg-rose-100 dark:bg-rose-900/40 text-rose-800 dark:text-rose-300'
                              : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400'
                          }`}
                        >
                          {insc.status.toUpperCase()}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            <TablePagination total={inscricoes.length} page={pgB} onPageChange={setPgB} />
          </div>
        </div>
      )}

      {/* TAB 4: ESTÁGIOS CURRICULARES */}
      {activeTab === 'estagios' && (
        <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-sm overflow-hidden">
          <div className="p-4 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between">
            <div>
              <h2 className="text-lg font-bold text-slate-900 dark:text-white">Estágios Curriculares & Profissionais</h2>
              <p className="text-xs text-slate-500">
                Acompanhamento em entidades de acolhimento (Hospitais, Tribunais, Ministérios, Empresas) com tutor docente e supervisor externo.
              </p>
            </div>
            {isManagement && (
              <button
                onClick={() => {
                  setEditingEstagio({
                    totalRequiredHours: 300,
                    completedHours: 0,
                    status: 'em_curso'
                  });
                  setShowEstagioModal(true);
                }}
                className="px-3.5 py-2 bg-blue-600 hover:bg-blue-500 text-white font-medium rounded-xl text-xs flex items-center gap-1.5 transition"
              >
                <span className="material-symbols-outlined text-sm">add</span>
                Novo Estágio
              </button>
            )}
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="bg-slate-50 dark:bg-slate-800/60 border-b border-slate-200 dark:border-slate-800 text-xs text-slate-600 dark:text-slate-300 font-semibold">
                  <th className="p-3">Código</th>
                  <th className="p-3">Estudante & Curso</th>
                  <th className="p-3">Entidade de Acolhimento</th>
                  <th className="p-3">Supervisão (Docente / Entidade)</th>
                  <th className="p-3 text-center">Horas (Cumpridas / Total)</th>
                  <th className="p-3 text-center">Estado</th>
                  <th className="p-3 text-center">Nota Final</th>
                  <th className="p-3 text-right">Ações</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {visibleEstagios.map((est) => {
                  const progressPct = Math.round((est.completedHours / est.totalRequiredHours) * 100);

                  return (
                    <tr key={est.id} className="hover:bg-slate-50/70 dark:hover:bg-slate-800/40">
                      <td className="p-3 font-mono font-bold text-xs text-blue-600 dark:text-blue-400">
                        {est.code}
                      </td>
                      <td className="p-3">
                        <div className="font-semibold text-slate-900 dark:text-white">{est.studentName}</div>
                        <div className="text-xs text-slate-500">{est.courseName}</div>
                      </td>
                      <td className="p-3 text-xs">
                        <div className="font-bold text-slate-800 dark:text-slate-200">{est.institutionOrCompany}</div>
                        {est.sector && <div className="text-slate-400">Setor: {est.sector}</div>}
                      </td>
                      <td className="p-3 text-xs text-slate-600 dark:text-slate-400">
                        <div><strong>Tutor:</strong> {est.tutorTeacherName}</div>
                        <div><strong>Supervisor:</strong> {est.supervisorName}</div>
                      </td>
                      <td className="p-3 text-center">
                        <div className="text-xs font-bold text-slate-800 dark:text-slate-200">
                          {est.completedHours}h / {est.totalRequiredHours}h ({progressPct}%)
                        </div>
                        <div className="w-24 bg-slate-200 dark:bg-slate-700 h-1.5 rounded-full mx-auto mt-1 overflow-hidden">
                          <div
                            className="bg-emerald-500 h-full rounded-full"
                            style={{ width: `${Math.min(100, progressPct)}%` }}
                          />
                        </div>
                      </td>
                      <td className="p-3 text-center">
                        <span
                          className={`px-2 py-0.5 rounded text-xs font-semibold ${
                            est.status === 'concluido'
                              ? 'bg-emerald-100 dark:bg-emerald-900/40 text-emerald-800 dark:text-emerald-300'
                              : 'bg-blue-100 dark:bg-blue-900/40 text-blue-800 dark:text-blue-300'
                          }`}
                        >
                          {est.status === 'concluido' ? 'CONCLUÍDO' : 'EM CURSO'}
                        </span>
                      </td>
                      <td className="p-3 text-center font-bold">
                        {typeof est.finalGrade === 'number' ? (
                          <span className="text-emerald-600 dark:text-emerald-400 font-bold">{est.finalGrade} val</span>
                        ) : (
                          <span className="text-slate-400 text-xs italic">Pendente</span>
                        )}
                      </td>
                      <td className="p-3 text-right">
                        {isManagement && (
                          <button
                            onClick={() => {
                              setEditingEstagio(est);
                              setShowEstagioModal(true);
                            }}
                            className="p-1.5 text-slate-500 hover:text-blue-600 rounded-lg"
                          >
                            <span className="material-symbols-outlined text-sm">edit</span>
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            <TablePagination total={estagios.length} page={pgEstagios} onPageChange={setPgEstagios} />
          </div>
        </div>
      )}

      {/* TAB 5: MONOGRAFIAS & TCC */}
      {activeTab === 'monografias' && (
        <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-sm overflow-hidden">
          <div className="p-4 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between">
            <div>
              <h2 className="text-lg font-bold text-slate-900 dark:text-white">
                Trabalhos de Conclusão de Curso (TCC) & Monografias
              </h2>
              <p className="text-xs text-slate-500">
                Registo de temas, orientadores docentes, agendamento de defesa pública perante júri oficial e notas finais.
              </p>
            </div>
            {isManagement && (
              <button
                onClick={() => {
                  setEditingTCC({
                    status: 'proposta',
                    academicYear: db.settings?.currentAcademicYear || '2026/2027'
                  });
                  setShowTCCModal(true);
                }}
                className="px-3.5 py-2 bg-blue-600 hover:bg-blue-500 text-white font-medium rounded-xl text-xs flex items-center gap-1.5 transition"
              >
                <span className="material-symbols-outlined text-sm">add</span>
                Registar TCC
              </button>
            )}
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="bg-slate-50 dark:bg-slate-800/60 border-b border-slate-200 dark:border-slate-800 text-xs text-slate-600 dark:text-slate-300 font-semibold">
                  <th className="p-3">Código</th>
                  <th className="p-3">Estudante & Curso</th>
                  <th className="p-3">Tema da Investigação</th>
                  <th className="p-3">Corpo Docente (Orientador & Júri)</th>
                  <th className="p-3 text-center">Defesa Pública</th>
                  <th className="p-3 text-center">Estado</th>
                  <th className="p-3 text-center">Nota & Menção</th>
                  <th className="p-3 text-right">Ações</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {visibleMonografias.map((tcc) => (
                  <tr key={tcc.id} className="hover:bg-slate-50/70 dark:hover:bg-slate-800/40">
                    <td className="p-3 font-mono font-bold text-xs text-blue-600 dark:text-blue-400">
                      {tcc.code}
                    </td>
                    <td className="p-3">
                      <div className="font-semibold text-slate-900 dark:text-white">{tcc.studentName}</div>
                      <div className="text-xs text-slate-500">{tcc.courseName}</div>
                    </td>
                    <td className="p-3 max-w-xs text-xs">
                      <div className="font-bold text-slate-800 dark:text-slate-200 line-clamp-2">{tcc.theme}</div>
                      {tcc.lineOfResearch && <div className="text-slate-400">Linha: {tcc.lineOfResearch}</div>}
                    </td>
                    <td className="p-3 text-xs text-slate-600 dark:text-slate-400">
                      <div><strong>Orientador:</strong> {tcc.advisorName}</div>
                      {tcc.juryPresident && <div className="text-slate-400">Júri: {tcc.juryPresident} (Pres.)</div>}
                    </td>
                    <td className="p-3 text-center text-xs">
                      {tcc.defenseDate ? (
                        <div>
                          <div className="font-semibold text-slate-800 dark:text-slate-200">{tcc.defenseDate}</div>
                          <div className="text-slate-400">{tcc.defenseTime || '10:00'} | {tcc.defenseRoom || 'Auditório'}</div>
                        </div>
                      ) : (
                        <span className="text-slate-400 italic">Por agendar</span>
                      )}
                    </td>
                    <td className="p-3 text-center">
                      <span
                        className={`px-2 py-0.5 rounded text-xs font-semibold ${
                          tcc.status === 'defendido'
                            ? 'bg-emerald-100 dark:bg-emerald-900/40 text-emerald-800 dark:text-emerald-300'
                            : tcc.status === 'defesa_agendada'
                            ? 'bg-amber-100 dark:bg-amber-900/40 text-amber-800 dark:text-amber-300'
                            : 'bg-blue-100 dark:bg-blue-900/40 text-blue-800 dark:text-blue-300'
                        }`}
                      >
                        {tcc.status.replace('_', ' ').toUpperCase()}
                      </span>
                    </td>
                    <td className="p-3 text-center">
                      {typeof tcc.defenseGrade === 'number' ? (
                        <div>
                          <span className="font-bold text-emerald-600 dark:text-emerald-400">
                            {tcc.defenseGrade} val
                          </span>
                          {tcc.finalMention && (
                            <div className="text-[11px] font-semibold text-slate-500">{tcc.finalMention}</div>
                          )}
                        </div>
                      ) : (
                        <span className="text-slate-400 text-xs italic">—</span>
                      )}
                    </td>
                    <td className="p-3 text-right">
                      {isManagement && (
                        <div className="flex items-center justify-end gap-1">
                          <button
                            onClick={() => {
                              setEditingTCC(tcc);
                              setShowTCCModal(true);
                            }}
                            className="p-1.5 text-slate-500 hover:text-blue-600 rounded-lg"
                            title="Editar TCC"
                          >
                            <span className="material-symbols-outlined text-sm">edit</span>
                          </button>
                          {tcc.status === 'defendido' && (
                            <button
                              onClick={() => handleIssueDiploma(tcc.studentId)}
                              className="p-1.5 text-amber-600 hover:bg-amber-50 rounded-lg"
                              title="Emitir Diploma"
                            >
                              <span className="material-symbols-outlined text-sm">workspace_premium</span>
                            </button>
                          )}
                        </div>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <TablePagination total={monografias.length} page={pgMonografias} onPageChange={setPgMonografias} />
          </div>
        </div>
      )}

      {/* TAB 6: DIPLOMAS & SUPLEMENTO AO DIPLOMA */}
      {activeTab === 'diplomas' && (
        <div className="space-y-6">
          <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-sm overflow-hidden">
            <div className="p-4 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between">
              <div>
                <h2 className="text-lg font-bold text-slate-900 dark:text-white">
                  Livro de Registo de Diplomas & Suplemento ao Diploma (MESCTI)
                </h2>
                <p className="text-xs text-slate-500">
                  Emissão oficial com média final ponderada (75% UCs curriculares + 25% TCC) e classificação qualitativa oficial de Bolonha / MESCTI.
                </p>
              </div>
              <span className="text-xs font-semibold px-2.5 py-1 bg-blue-100 dark:bg-blue-900/40 text-blue-800 dark:text-blue-300 rounded-lg">
                {diplomas.length} diploma(s) registados
              </span>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead>
                  <tr className="bg-slate-50 dark:bg-slate-800/60 border-b border-slate-200 dark:border-slate-800 text-xs text-slate-600 dark:text-slate-300 font-semibold">
                    <th className="p-3">N.º Registo</th>
                    <th className="p-3">Diplomado(a)</th>
                    <th className="p-3">Grau & Curso</th>
                    <th className="p-3 text-center">ECTS Cumpridos</th>
                    <th className="p-3 text-center">Média Curricular</th>
                    <th className="p-3 text-center">Nota TCC</th>
                    <th className="p-3 text-center">Classificação Final</th>
                    <th className="p-3 text-center">Menção Qualitativa</th>
                    <th className="p-3 text-right">Ações</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                  {visibleDiplomas.map((dip) => (
                    <tr key={dip.id} className="hover:bg-slate-50/70 dark:hover:bg-slate-800/40">
                      <td className="p-3 font-mono font-bold text-blue-600 dark:text-blue-400 text-xs">
                        {dip.code}
                        <div className="text-[11px] text-slate-400 font-normal">
                          {dip.registryBook || 'Livro por preencher'}, Fls. {dip.registryPage || '—'}
                        </div>
                      </td>
                      <td className="p-3">
                        <div className="font-semibold text-slate-900 dark:text-white">{dip.studentName}</div>
                        <div className="text-xs text-slate-400 font-mono">Proc: {dip.studentProcNumber}</div>
                      </td>
                      <td className="p-3 text-xs">
                        <div className="font-bold text-slate-800 dark:text-slate-200">{dip.degreeTitle}</div>
                        <div className="text-slate-500">Concluído em: {dip.academicYearConcluded}</div>
                      </td>
                      <td className="p-3 text-center font-bold text-xs text-slate-700 dark:text-slate-300">
                        {dip.totalCreditsECTS} ECTS
                      </td>
                      <td className="p-3 text-center text-xs font-semibold">
                        {dip.finalGradeCurricular} val
                      </td>
                      <td className="p-3 text-center text-xs font-semibold">
                        {dip.tccGrade ? `${dip.tccGrade} val` : '—'}
                      </td>
                      <td className="p-3 text-center">
                        <span className="text-base font-extrabold text-blue-600 dark:text-blue-400">
                          {dip.finalCourseGrade}
                        </span>
                        <span className="text-xs text-slate-400"> /20</span>
                      </td>
                      <td className="p-3 text-center">
                        <span
                          className={`px-2 py-0.5 rounded text-xs font-bold ${
                            dip.finalCourseGrade >= 16
                              ? 'bg-purple-100 text-purple-800 dark:bg-purple-900/40 dark:text-purple-300'
                              : dip.finalCourseGrade >= 14
                              ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300'
                              : 'bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-300'
                          }`}
                        >
                          {dip.finalMention}
                        </span>
                      </td>
                      <td className="p-3 text-right">
                        <button
                          onClick={() => setSelectedDiplomaForPrint(dip)}
                          className="px-3 py-1.5 bg-amber-600 hover:bg-amber-500 text-white rounded-lg text-xs font-medium inline-flex items-center gap-1 transition shadow-sm"
                        >
                          <span className="material-symbols-outlined text-xs">print</span>
                          Ver & Imprimir
                        </button>
                          <button
                            onClick={() => setSupplementDiploma(dip)}
                            className="ml-2 px-2.5 py-1 border border-slate-300 dark:border-slate-600 text-xs font-semibold rounded-lg hover:bg-slate-50 dark:hover:bg-slate-800"
                          >
                            Suplemento
                          </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <TablePagination total={diplomas.length} page={pgDiplomas} onPageChange={setPgDiplomas} />
            </div>
          </div>
        </div>
      )}

      {/* TAB 7: PROPINAS POR ECTS & BOLSAS DE ESTUDO */}
      {activeTab === 'propinas_bolsas' && (
        <div className="space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
            <div className="bg-white dark:bg-slate-900 p-5 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-sm md:col-span-2">
              <div className="flex items-center justify-between mb-4">
                <div>
                  <h3 className="font-bold text-slate-900 dark:text-white">Bolsas de Estudo Universitárias Ativas</h3>
                  <p className="text-xs text-slate-500">Gestão de acordos INAGBE, Mérito Académico, Sonangol e Fundo Social.</p>
                </div>
                {isManagement && (
                  <button
                    onClick={() => {
                      setEditingBolsa({
                        type: 'INAGBE',
                        sponsorName: 'INAGBE - Governo de Angola',
                        coverageType: 'integral_100',
                        discountPercent: 100,
                        status: 'ativa',
                        startDate: new Date().toISOString().split('T')[0]
                      });
                      setShowBolsaModal(true);
                    }}
                    className="px-3 py-1.5 bg-purple-600 hover:bg-purple-500 text-white text-xs font-medium rounded-lg flex items-center gap-1 shadow-sm"
                  >
                    <span className="material-symbols-outlined text-sm">add</span>
                    Registar Bolsa
                  </button>
                )}
              </div>

              <div className="overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <thead>
                    <tr className="bg-slate-50 dark:bg-slate-800/60 border-b border-slate-200 dark:border-slate-800 text-xs text-slate-600 dark:text-slate-300 font-semibold">
                      <th className="p-2.5">Código</th>
                      <th className="p-2.5">Bolseiro(a)</th>
                      <th className="p-2.5">Entidade Patrocinadora</th>
                      <th className="p-2.5 text-center">Comparticipação</th>
                      <th className="p-2.5 text-center">Estado</th>
                      <th className="p-2.5 text-right">Ações</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                    {visibleBolsas.map((b) => (
                      <tr key={b.id} className="hover:bg-slate-50/70 dark:hover:bg-slate-800/40">
                        <td className="p-2.5 font-mono text-xs font-bold text-purple-600 dark:text-purple-400">
                          {b.code}
                        </td>
                        <td className="p-2.5">
                          <div className="font-semibold text-slate-900 dark:text-white">{b.studentName}</div>
                          <div className="text-xs text-slate-500">{b.courseName}</div>
                        </td>
                        <td className="p-2.5 text-xs text-slate-700 dark:text-slate-300">
                          {b.sponsorName}
                        </td>
                        <td className="p-2.5 text-center">
                          <span className="px-2 py-0.5 rounded text-xs font-bold bg-purple-100 dark:bg-purple-900/40 text-purple-800 dark:text-purple-300">
                            {b.coverageType === 'integral_100'
                              ? '100% (Integral)'
                              : b.coverageType === 'montante_fixo'
                              ? `${b.fixedMonthlyAmountKz?.toLocaleString('pt-PT')} Kz`
                              : `${b.discountPercent}% Parcial`}
                          </span>
                        </td>
                        <td className="p-2.5 text-center">
                          <span
                            className={`px-2 py-0.5 rounded text-xs font-semibold ${
                              b.status === 'ativa'
                                ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300'
                                : 'bg-rose-100 text-rose-800 dark:bg-rose-900/40 dark:text-rose-300'
                            }`}
                          >
                            {b.status.toUpperCase()}
                          </span>
                        </td>
                        <td className="p-2.5 text-right">
                          {isManagement && (
                            <button
                              onClick={() => {
                                setEditingBolsa(b);
                                setShowBolsaModal(true);
                              }}
                              className="p-1 text-slate-400 hover:text-blue-600"
                            >
                              <span className="material-symbols-outlined text-sm">edit</span>
                            </button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <TablePagination total={bolsas.length} page={pgBolsas} onPageChange={setPgBolsas} />
              </div>
            </div>

            {/* Propina por ECTS (cálculo real + fatura na Tesouraria) */}
            <div className="bg-gradient-to-br from-slate-900 to-indigo-950 text-white p-5 rounded-2xl border border-indigo-700/40 shadow-sm flex flex-col justify-between">
              {(() => {
                const t = computeTuition();
                const field = 'w-full mt-1 px-2 py-1.5 rounded-lg bg-slate-800 border border-slate-600 text-white text-xs';
                return (
                  <div>
                    <h3 className="font-bold text-base flex items-center gap-1.5 mb-1">
                      <span className="material-symbols-outlined text-amber-400">calculate</span>
                      Propina por ECTS
                    </h3>
                    <p className="text-xs text-slate-300 mb-3">
                      Calculada com as UCs inscritas no semestre e a bolsa activa do estudante.
                    </p>
                    <div className="space-y-2 text-xs">
                      <label className="block text-slate-400">Estudante
                        <select className={field} value={tuitionStudentId} onChange={(e) => setTuitionStudentId(e.target.value)}>
                          <option value="">— escolher —</option>
                          {students.map((st) => (<option key={st.id} value={st.id}>{st.name}</option>))}
                        </select>
                      </label>
                      <div className="grid grid-cols-3 gap-2">
                        <label className="block text-slate-400">Semestre
                          <select className={field} value={tuitionSemester} onChange={(e) => setTuitionSemester(Number(e.target.value) as 1 | 2)}>
                            <option value={1}>1.º</option>
                            <option value={2}>2.º</option>
                          </select>
                        </label>
                        <label className="block text-slate-400">Kz / ECTS
                          <input className={field} inputMode="decimal" value={tuitionPrice} onChange={(e) => setTuitionPrice(e.target.value)} />
                        </label>
                        <label className="block text-slate-400">Meses
                          <input className={field} inputMode="numeric" value={tuitionMonths} onChange={(e) => setTuitionMonths(e.target.value)} />
                        </label>
                      </div>
                    </div>
                    {t && (
                      <div className="pt-3 mt-3 border-t border-slate-700 text-xs">
                        <div className="flex justify-between text-slate-300"><span>ECTS inscritos:</span><span className="font-bold">{t.enrolledECTS}</span></div>
                        <div className="flex justify-between text-slate-300 mt-1"><span>Propina bruta:</span><span className="font-bold">{t.calc.grossAmountKz.toLocaleString('pt-PT')} Kz</span></div>
                        {t.calc.discountAmountKz > 0 && (
                          <div className="flex justify-between text-emerald-400 mt-1"><span>Bolsa:</span><span className="font-bold">- {t.calc.discountAmountKz.toLocaleString('pt-PT')} Kz</span></div>
                        )}
                        {t.bolsaWarning.length > 0 && (
                          <div className="mt-2 p-2 rounded-lg bg-amber-900/40 border border-amber-600/40 text-amber-200">
                            Bolsa não aplicada (critérios de manutenção): {t.bolsaWarning.join(' ')}
                          </div>
                        )}
                        <div className="flex justify-between text-base font-extrabold text-white mt-2 pt-2 border-t border-slate-700">
                          <span>Líquido a pagar:</span>
                          <span className="text-emerald-400">{t.calc.netAmountKz.toLocaleString('pt-PT')} Kz</span>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })()}

              {canBill && (
                <button
                  onClick={handleGenerateTuition}
                  className="mt-4 px-4 py-2 bg-amber-600 hover:bg-amber-500 text-white text-xs font-semibold rounded-xl"
                >
                  Gerar fatura na Tesouraria
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ======================================================== */}
      {/* MODAL: NOVA / EDITAR UNIDADE CURRICULAR                  */}
      {/* ======================================================== */}
      {showUCModal && editingUC && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white dark:bg-slate-900 rounded-2xl max-w-2xl w-full p-6 shadow-2xl border border-slate-200 dark:border-slate-800 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between pb-3 border-b border-slate-200 dark:border-slate-800">
              <h3 className="text-lg font-bold text-slate-900 dark:text-white">
                {editingUC.id ? 'Editar Unidade Curricular' : 'Nova Unidade Curricular (UC)'}
              </h3>
              <button onClick={() => setShowUCModal(false)} className="text-slate-400 hover:text-slate-600">
                <span className="material-symbols-outlined">close</span>
              </button>
            </div>

            <form onSubmit={handleSaveUC} className="mt-4 space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                    Código Oficial *
                  </label>
                  <input
                    type="text"
                    required
                    value={editingUC.code || ''}
                    onChange={(e) => setEditingUC({ ...editingUC, code: e.target.value.toUpperCase() })}
                    placeholder="ex: INF101"
                    className="w-full text-xs font-mono font-bold p-2 bg-slate-50 dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-lg"
                  />
                </div>

                <div className="sm:col-span-2">
                  <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                    Nome da Cadeira *
                  </label>
                  <input
                    type="text"
                    required
                    value={editingUC.name || ''}
                    onChange={(e) => setEditingUC({ ...editingUC, name: e.target.value })}
                    placeholder="ex: Algoritmos e Estruturas de Dados"
                    className="w-full text-xs p-2 bg-slate-50 dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-lg"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                    Curso *
                  </label>
                  <select
                    required
                    value={editingUC.courseId || ''}
                    onChange={(e) => setEditingUC({ ...editingUC, courseId: e.target.value })}
                    className="w-full text-xs p-2 bg-slate-50 dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-lg"
                  >
                    <option value="">Selecione o Curso...</option>
                    {courses.map((c) => (
                      <option key={c.id} value={c.id}>{c.name}</option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                    Ano Curricular *
                  </label>
                  <select
                    value={editingUC.year || 1}
                    onChange={(e) => setEditingUC({ ...editingUC, year: parseInt(e.target.value, 10) })}
                    className="w-full text-xs p-2 bg-slate-50 dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-lg"
                  >
                    <option value="1">1.º Ano</option>
                    <option value="2">2.º Ano</option>
                    <option value="3">3.º Ano</option>
                    <option value="4">4.º Ano</option>
                    <option value="5">5.º Ano</option>
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                    Regime Semestral *
                  </label>
                  <select
                    value={editingUC.semester || 1}
                    onChange={(e) => setEditingUC({ ...editingUC, semester: e.target.value === 'anual' ? 'anual' : (parseInt(e.target.value, 10) as 1 | 2) })}
                    className="w-full text-xs p-2 bg-slate-50 dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-lg"
                  >
                    <option value="1">1.º Semestre</option>
                    <option value="2">2.º Semestre</option>
                    <option value="anual">Anual</option>
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                    Créditos ECTS *
                  </label>
                  <input
                    type="number"
                    min="1"
                    max="30"
                    required
                    value={editingUC.creditsECTS || 6}
                    onChange={(e) => setEditingUC({ ...editingUC, creditsECTS: parseInt(e.target.value, 10) || 6 })}
                    className="w-full text-xs p-2 bg-slate-50 dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-lg font-bold text-center"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                    Horas Totais *
                  </label>
                  <input
                    type="number"
                    min="1"
                    value={editingUC.totalHours || 90}
                    onChange={(e) => setEditingUC({ ...editingUC, totalHours: parseInt(e.target.value, 10) || 90 })}
                    className="w-full text-xs p-2 bg-slate-50 dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-lg text-center"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                    Horas Teóricas (T)
                  </label>
                  <input
                    type="number"
                    min="0"
                    value={editingUC.contactHours?.teorica || 30}
                    onChange={(e) =>
                      setEditingUC({
                        ...editingUC,
                        contactHours: {
                          teorica: parseInt(e.target.value, 10) || 0,
                          pratica: editingUC.contactHours?.pratica || 0,
                          teoricoPratica: editingUC.contactHours?.teoricoPratica || 0,
                          laboratorial: editingUC.contactHours?.laboratorial || 0
                        }
                      })
                    }
                    className="w-full text-xs p-2 bg-slate-50 dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-lg text-center"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                    Laboratório (PL)
                  </label>
                  <input
                    type="number"
                    min="0"
                    value={editingUC.contactHours?.laboratorial || 0}
                    onChange={(e) =>
                      setEditingUC({
                        ...editingUC,
                        contactHours: {
                          teorica: editingUC.contactHours?.teorica || 0,
                          pratica: editingUC.contactHours?.pratica || 0,
                          teoricoPratica: editingUC.contactHours?.teoricoPratica || 0,
                          laboratorial: parseInt(e.target.value, 10) || 0
                        }
                      })
                    }
                    className="w-full text-xs p-2 bg-slate-50 dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-lg text-center"
                  />
                </div>
              </div>

              {/* Precedências */}
              <div>
                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                  Precedências Obrigatórias (Cadeiras que o aluno deve aprovar antes)
                </label>
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 max-h-36 overflow-y-auto p-2 bg-slate-50 dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-lg">
                  {ucs
                    .filter((u) => u.id !== editingUC.id)
                    .map((otherUC) => {
                      const isChecked = (editingUC.prerequisites || []).includes(otherUC.id);
                      return (
                        <label key={otherUC.id} className="flex items-center gap-1.5 text-xs cursor-pointer">
                          <input
                            type="checkbox"
                            checked={isChecked}
                            onChange={(e) => {
                              const current = editingUC.prerequisites || [];
                              const updated = e.target.checked
                                ? [...current, otherUC.id]
                                : current.filter((x) => x !== otherUC.id);
                              setEditingUC({ ...editingUC, prerequisites: updated });
                            }}
                            className="rounded text-blue-600"
                          />
                          <span className="font-mono font-bold text-slate-700 dark:text-slate-300">{otherUC.code}</span>
                          <span className="truncate text-slate-500 text-[11px]">{otherUC.name}</span>
                        </label>
                      );
                    })}
                </div>
              </div>

              <div className="flex justify-end gap-2 pt-3 border-t border-slate-200 dark:border-slate-800">
                <button
                  type="button"
                  onClick={() => setShowUCModal(false)}
                  className="px-4 py-2 text-xs font-medium text-slate-600 hover:text-slate-800 rounded-lg"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 text-xs font-medium bg-blue-600 hover:bg-blue-500 text-white rounded-lg shadow-sm"
                >
                  Guardar UC
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ======================================================== */}
      {/* MODAL: NOVA INSCRIÇÃO COM VALIDAÇÃO DE PRECEDÊNCIAS       */}
      {/* ======================================================== */}
      {showInscricaoModal && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white dark:bg-slate-900 rounded-2xl max-w-lg w-full p-6 shadow-2xl border border-slate-200 dark:border-slate-800">
            <div className="flex items-center justify-between pb-3 border-b border-slate-200 dark:border-slate-800">
              <h3 className="text-lg font-bold text-slate-900 dark:text-white flex items-center gap-2">
                <span className="material-symbols-outlined text-amber-500">how_to_reg</span>
                Inscrição Semestral em UC
              </h3>
              <button onClick={() => setShowInscricaoModal(false)} className="text-slate-400 hover:text-slate-600">
                <span className="material-symbols-outlined">close</span>
              </button>
            </div>

            <form onSubmit={handleCreateInscricao} className="mt-4 space-y-4">
              <div>
                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                  Estudante *
                </label>
                <select
                  required
                  value={newInscricao.studentId}
                  onChange={(e) => setNewInscricao({ ...newInscricao, studentId: e.target.value })}
                  className="w-full text-xs p-2.5 bg-slate-50 dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-lg"
                >
                  <option value="">Selecione o Estudante...</option>
                  {students.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name} ({s.procNumber || 'S/N'}) — {s.courseName || (s as any).course || 'Superior'}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                  Unidade Curricular (UC) *
                </label>
                <select
                  required
                  value={newInscricao.ucId}
                  onChange={(e) => setNewInscricao({ ...newInscricao, ucId: e.target.value })}
                  className="w-full text-xs p-2.5 bg-slate-50 dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-lg"
                >
                  <option value="">Selecione a UC...</option>
                  {ucs.map((u) => (
                    <option key={u.id} value={u.id}>
                      {u.code} — {u.name} ({u.year}.º Ano, {u.creditsECTS} ECTS)
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                  Ano Letivo da Inscrição *
                </label>
                <input
                  type="text"
                  required
                  value={newInscricao.academicYear}
                  onChange={(e) => setNewInscricao({ ...newInscricao, academicYear: e.target.value })}
                  className="w-full text-xs p-2.5 bg-slate-50 dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-lg font-bold"
                />
              </div>

              <Notice tone="warn">
                <strong>Verificação Automática:</strong> O sistema confere se o estudante tem as precedências cumpridas e se está dentro do limite regulamentar de transição (máx. 2 cadeiras em atraso).
              </Notice>

              <div className="flex justify-end gap-2 pt-3 border-t border-slate-200 dark:border-slate-800">
                <button
                  type="button"
                  onClick={() => setShowInscricaoModal(false)}
                  className="px-4 py-2 text-xs font-medium text-slate-600 hover:text-slate-800"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 text-xs font-medium bg-amber-600 hover:bg-amber-500 text-white rounded-lg shadow-sm"
                >
                  Validar & Inscrever
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL: EQUIVALÊNCIA / TRANSFERÊNCIA */}
      {showEquivModal && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white dark:bg-slate-900 rounded-2xl max-w-lg w-full p-6 shadow-2xl border border-slate-200 dark:border-slate-800">
            <div className="flex items-center justify-between pb-3 border-b border-slate-200 dark:border-slate-800">
              <h3 className="text-lg font-bold text-slate-900 dark:text-white flex items-center gap-2">
                <span className="material-symbols-outlined text-emerald-600">swap_horiz</span>
                Equivalência / Transferência
              </h3>
              <button onClick={() => setShowEquivModal(false)} className="text-slate-400 hover:text-slate-600">
                <span className="material-symbols-outlined">close</span>
              </button>
            </div>
            <form onSubmit={handleCreateEquivalencia} className="mt-4 space-y-4">
              <div>
                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">Estudante *</label>
                <select required value={equivForm.studentId} onChange={(e) => setEquivForm({ ...equivForm, studentId: e.target.value })} className="w-full text-xs p-2.5 bg-slate-50 dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-lg">
                  <option value="">Selecione o Estudante...</option>
                  {students.map((s) => (
                    <option key={s.id} value={s.id}>{s.name} ({s.procNumber || 'S/N'})</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">UC reconhecida *</label>
                <select required value={equivForm.ucId} onChange={(e) => setEquivForm({ ...equivForm, ucId: e.target.value })} className="w-full text-xs p-2.5 bg-slate-50 dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-lg">
                  <option value="">Selecione a UC...</option>
                  {ucs.map((u) => (
                    <option key={u.id} value={u.id}>{u.code} — {u.name} ({u.year}.º Ano, {u.creditsECTS} ECTS)</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">Instituição / curso de origem *</label>
                <input required value={equivForm.instituicaoOrigem} onChange={(e) => setEquivForm({ ...equivForm, instituicaoOrigem: e.target.value })} className="w-full text-xs p-2.5 bg-slate-50 dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-lg" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">Nota de origem (0-20)</label>
                  <input inputMode="decimal" value={equivForm.notaOrigem} onChange={(e) => setEquivForm({ ...equivForm, notaOrigem: e.target.value })} className="w-full text-xs p-2.5 bg-slate-50 dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-lg" />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">Despacho / deliberação</label>
                  <input value={equivForm.despacho} onChange={(e) => setEquivForm({ ...equivForm, despacho: e.target.value })} className="w-full text-xs p-2.5 bg-slate-50 dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-lg" />
                </div>
              </div>
              <label className="flex items-center gap-2 text-xs text-slate-700 dark:text-slate-300">
                <input type="checkbox" checked={equivForm.contaParaMedia} onChange={(e) => setEquivForm({ ...equivForm, contaParaMedia: e.target.checked })} />
                A nota conta para a média (exige nota de origem)
              </label>
              <div className="flex justify-end gap-2 pt-3 border-t border-slate-200 dark:border-slate-800">
                <button type="button" onClick={() => setShowEquivModal(false)} className="px-4 py-2 text-xs font-medium text-slate-600 hover:text-slate-800">Cancelar</button>
                <button type="submit" className="px-4 py-2 text-xs font-medium bg-emerald-700 hover:bg-emerald-600 text-white rounded-lg shadow-sm">Reconhecer equivalência</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ======================================================== */}
      {/* MODAL: REGISTAR / EDITAR MONOGRAFIA OU TCC               */}
      {/* ======================================================== */}
      {showTCCModal && editingTCC && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white dark:bg-slate-900 rounded-2xl max-w-xl w-full p-6 shadow-2xl border border-slate-200 dark:border-slate-800 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between pb-3 border-b border-slate-200 dark:border-slate-800">
              <h3 className="text-lg font-bold text-slate-900 dark:text-white">
                {editingTCC.id ? 'Atualizar TCC / Monografia' : 'Novo Trabalho de Conclusão de Curso (TCC)'}
              </h3>
              <button onClick={() => setShowTCCModal(false)} className="text-slate-400 hover:text-slate-600">
                <span className="material-symbols-outlined">close</span>
              </button>
            </div>

            <form onSubmit={handleSaveTCC} className="mt-4 space-y-4 text-xs">
              <div>
                <label className="block font-semibold mb-1">Estudante Finalista *</label>
                <select
                  required
                  value={editingTCC.studentId || ''}
                  onChange={(e) => setEditingTCC({ ...editingTCC, studentId: e.target.value })}
                  className="w-full p-2.5 bg-slate-50 dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-lg"
                >
                  <option value="">Selecione o Estudante...</option>
                  {students.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name} ({s.courseName || (s as any).course || 'Superior'})
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block font-semibold mb-1">Tema / Título da Monografia *</label>
                <input
                  type="text"
                  required
                  value={editingTCC.theme || ''}
                  onChange={(e) => setEditingTCC({ ...editingTCC, theme: e.target.value })}
                  placeholder="ex: Sistema Inteligente de Apoio à Gestão Hospitalar em Luanda"
                  className="w-full p-2.5 bg-slate-50 dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-lg"
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block font-semibold mb-1">Docente Orientador *</label>
                  <input
                    type="text"
                    required
                    value={editingTCC.advisorName || ''}
                    onChange={(e) => setEditingTCC({ ...editingTCC, advisorName: e.target.value })}
                    placeholder="ex: Prof. Doutor Garcia Alberto"
                    className="w-full p-2.5 bg-slate-50 dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-lg"
                  />
                </div>

                <div>
                  <label className="block font-semibold mb-1">Linha de Investigação</label>
                  <input
                    type="text"
                    value={editingTCC.lineOfResearch || ''}
                    onChange={(e) => setEditingTCC({ ...editingTCC, lineOfResearch: e.target.value })}
                    placeholder="ex: Inteligência Artificial & Saúde"
                    className="w-full p-2.5 bg-slate-50 dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-lg"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div>
                  <label className="block font-semibold mb-1">Presidente do Júri</label>
                  <input
                    type="text"
                    value={editingTCC.juryPresident || ''}
                    onChange={(e) => setEditingTCC({ ...editingTCC, juryPresident: e.target.value })}
                    placeholder="ex: Doutor Manuel Santos"
                    className="w-full p-2 bg-slate-50 dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-lg"
                  />
                </div>

                <div>
                  <label className="block font-semibold mb-1">Vogal Arguente</label>
                  <input
                    type="text"
                    value={editingTCC.juryArguente || ''}
                    onChange={(e) => setEditingTCC({ ...editingTCC, juryArguente: e.target.value })}
                    placeholder="ex: Mestre André Baptista"
                    className="w-full p-2 bg-slate-50 dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-lg"
                  />
                </div>

                <div>
                  <label className="block font-semibold mb-1">2.º Vogal</label>
                  <input
                    type="text"
                    value={editingTCC.juryVogal || ''}
                    onChange={(e) => setEditingTCC({ ...editingTCC, juryVogal: e.target.value })}
                    placeholder="ex: Dra. Teresa Vunge"
                    className="w-full p-2 bg-slate-50 dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-lg"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div>
                  <label className="block font-semibold mb-1">Estado</label>
                  <select
                    value={editingTCC.status || 'proposta'}
                    onChange={(e) => setEditingTCC({ ...editingTCC, status: e.target.value as any })}
                    className="w-full p-2 bg-slate-50 dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-lg"
                  >
                    <option value="proposta">Proposta</option>
                    <option value="em_elaboracao">Em Elaboração</option>
                    <option value="depositado">Depositado</option>
                    <option value="defesa_agendada">Defesa Agendada</option>
                    <option value="defendido">Defendido</option>
                    <option value="reprovado">Reprovado</option>
                  </select>
                </div>

                <div>
                  <label className="block font-semibold mb-1">Data da Defesa</label>
                  <input
                    type="date"
                    value={editingTCC.defenseDate || ''}
                    onChange={(e) => setEditingTCC({ ...editingTCC, defenseDate: e.target.value })}
                    className="w-full p-2 bg-slate-50 dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-lg"
                  />
                </div>

                <div>
                  <label className="block font-semibold mb-1">Nota da Defesa (0-20)</label>
                  <input
                    type="number"
                    min="0"
                    max="20"
                    step="0.1"
                    value={editingTCC.defenseGrade ?? ''}
                    onChange={(e) => {
                      const grade = e.target.value === '' ? undefined : parseFloat(e.target.value);
                      const mention =
                        grade !== undefined
                          ? grade >= 18
                            ? 'Aprovado com Distinção e Louvor'
                            : grade >= 16
                            ? 'Aprovado com Distinção'
                            : grade >= 10
                            ? 'Aprovado'
                            : 'Não Aprovado'
                          : undefined;
                      setEditingTCC({ ...editingTCC, defenseGrade: grade, finalMention: mention });
                    }}
                    placeholder="0-20"
                    className="w-full p-2 bg-slate-50 dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-lg font-bold text-center"
                  />
                </div>
              </div>

              <div className="flex justify-end gap-2 pt-3 border-t border-slate-200 dark:border-slate-800">
                <button
                  type="button"
                  onClick={() => setShowTCCModal(false)}
                  className="px-4 py-2 font-medium text-slate-600 hover:text-slate-800"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 font-medium bg-blue-600 hover:bg-blue-500 text-white rounded-lg shadow-sm"
                >
                  Guardar TCC
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ======================================================== */}
      {/* MODAL: IMPRESSÃO OFICIAL DE DIPLOMA & CERTIFICADO        */}
      {/* ======================================================== */}
      {supplement && supplementDiploma && (
        <div className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-4 print:static print:bg-white print:p-0">
          <div className="bg-white text-slate-900 rounded-2xl max-w-3xl w-full p-8 shadow-2xl max-h-[90vh] overflow-y-auto print:max-h-none print:shadow-none">
            <div className="flex justify-between items-center pb-4 border-b border-slate-200 print:hidden">
              <span className="text-xs font-bold text-amber-700 uppercase tracking-wider">Suplemento ao Diploma</span>
              <div className="flex items-center gap-2">
                <button onClick={() => window.print()} className="px-3 py-1.5 bg-blue-600 text-white font-medium text-xs rounded-lg">Imprimir</button>
                <button onClick={() => setSupplementDiploma(null)} className="text-slate-400 hover:text-slate-600">Fechar</button>
              </div>
            </div>
            <div className="mt-4 text-sm space-y-4">
              <div className="text-center">
                <h2 className="text-xl font-extrabold uppercase tracking-wide">Suplemento ao Diploma</h2>
                <p className="text-xs text-slate-500">Diploma {supplement.diplomaCode} — Registo n.º {supplement.registerNumber}</p>
              </div>
              <div className="grid grid-cols-2 gap-2 text-xs">
                <div><strong>Diplomado(a):</strong> {supplement.studentName}</div>
                <div><strong>Processo:</strong> {supplement.studentProcNumber}</div>
                <div className="col-span-2"><strong>Grau:</strong> {supplement.degreeTitle}</div>
              </div>
              {supplement.years.length === 0 && <p className="text-xs text-slate-500">Sem unidades curriculares aprovadas registadas.</p>}
              {supplement.years.map((y) => (
                <div key={y.year}>
                  <div className="font-bold text-xs bg-slate-100 px-2 py-1">{y.year}.º Ano — {y.totalECTS} ECTS</div>
                  <table className="w-full text-xs">
                    <tbody>
                      {y.rows.map((r) => (
                        <tr key={r.ucId} className="border-b border-slate-100">
                          <td className="py-1 pr-2 font-mono">{r.code}</td>
                          <td className="py-1 pr-2">{r.name}</td>
                          <td className="py-1 pr-2 text-center">{r.semester}.º sem.</td>
                          <td className="py-1 pr-2 text-center">{r.creditsECTS} ECTS</td>
                          <td className="py-1 pr-2 text-center">{typeof r.grade === 'number' ? `${r.grade} (${r.mention})` : '—'}</td>
                          <td className="py-1 text-slate-500">{r.origem}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ))}
              {supplement.estagios.length > 0 && (
                <div className="text-xs">
                  <strong>Estágios:</strong>{' '}
                  {supplement.estagios.map((e) => `${e.code} — ${e.local} (${e.hours}h${typeof e.grade === 'number' ? `, ${e.grade} val` : ''})`).join('; ')}
                </div>
              )}
              {supplement.tcc && (
                <div className="text-xs">
                  <strong>TCC:</strong> {supplement.tcc.theme} — orientador: {supplement.tcc.advisor}
                  {typeof supplement.tcc.grade === 'number' ? `, defesa ${supplement.tcc.grade} val` : ''}
                </div>
              )}
              <div className="border-t border-slate-200 pt-3 text-xs">
                <strong>Total:</strong> {supplement.totalECTS} ECTS · <strong>Média curricular:</strong> {supplement.finalGradeCurricular} · <strong>Classificação final:</strong> {supplement.finalCourseGrade} ({supplement.finalMention})
              </div>
            </div>
          </div>
        </div>
      )}

      {selectedDiplomaForPrint && (
        <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white text-slate-900 rounded-2xl max-w-3xl w-full p-8 shadow-2xl border-4 border-amber-500/40 max-h-[90vh] overflow-y-auto">
            <div className="flex justify-between items-center pb-4 border-b border-slate-200 print:hidden">
              <span className="text-xs font-bold text-amber-700 uppercase tracking-wider">
                Visualização Oficial de Diploma — MESCTI
              </span>
              <div className="flex items-center gap-2">
                <div className="flex rounded-lg border border-slate-300 overflow-hidden text-xs">
                  {(['diploma', 'suplemento'] as const).map((m) => (
                    <button
                      key={m}
                      onClick={() => setPrintMode(m)}
                      className={`px-3 py-1.5 font-medium ${printMode === m ? 'bg-slate-900 text-white' : 'bg-white text-slate-600'}`}
                    >
                      {m === 'diploma' ? 'Diploma' : 'Suplemento'}
                    </button>
                  ))}
                </div>
                <button
                  onClick={() => window.print()}
                  className="px-3 py-1.5 bg-blue-600 text-white font-medium text-xs rounded-lg flex items-center gap-1"
                >
                  <span className="material-symbols-outlined text-sm">print</span>
                  {printMode === 'diploma' ? 'Imprimir Diploma' : 'Imprimir Suplemento'}
                </button>
                <button
                  onClick={() => { setSelectedDiplomaForPrint(null); setPrintMode('diploma'); }}
                  className="text-slate-400 hover:text-slate-600"
                >
                  <span className="material-symbols-outlined">close</span>
                </button>
              </div>
            </div>

            {/* Certificado Oficial A4 */}
            {isManagement && (
              <div className="mt-4 grid grid-cols-2 gap-2 text-xs print:hidden">
                {([
                  ['registryBook', 'Livro de registo'],
                  ['registryPage', 'Folha'],
                  ['rectorName', 'Reitor(a)'],
                  ['academicDirectorName', 'Diretor(a) Académico(a)']
                ] as const).map(([field, label]) => (
                  <label key={field} className="flex flex-col gap-1 text-slate-600 dark:text-slate-300">
                    {label}
                    <input
                      className="px-2 py-1.5 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800"
                      value={(selectedDiplomaForPrint as any)[field] || ''}
                      onChange={(e) => {
                        const updated = dbService.saveDiplomaSuperior({ ...selectedDiplomaForPrint, [field]: e.target.value });
                        setSelectedDiplomaForPrint(updated);
                      }}
                    />
                  </label>
                ))}
              </div>
            )}

            {printMode === 'suplemento' && (() => {
              const sup = buildDiplomaSupplement({
                diploma: selectedDiplomaForPrint,
                inscricoes,
                ucs,
                estagios,
                tcc: monografias.find((m) => m.studentId === selectedDiplomaForPrint.studentId)
              });
              return (
                <div className="mt-6 space-y-4 font-sans text-slate-800 text-xs">
                  <div className="text-center">
                    <div className="text-lg font-black uppercase">Suplemento ao Diploma</div>
                    <div className="text-slate-500">Registo N.º {sup.registerNumber} · {sup.degreeTitle}</div>
                  </div>
                  <div className="grid grid-cols-2 gap-2 border border-slate-200 rounded-lg p-3">
                    <div><span className="text-slate-500">Diplomado(a):</span> <strong>{sup.studentName}</strong></div>
                    <div><span className="text-slate-500">Processo:</span> <strong>{sup.studentProcNumber}</strong></div>
                    <div className="col-span-2"><span className="text-slate-500">Curso:</span> <strong>{sup.courseName}</strong></div>
                  </div>
                  {sup.years.map((y) => (
                    <div key={y.year}>
                      <div className="font-bold mb-1">{y.year}.º Ano — {y.totalECTS} ECTS</div>
                      <table className="w-full text-left border border-slate-200">
                        <thead className="bg-slate-50">
                          <tr>
                            <th className="p-1.5">Código</th><th className="p-1.5">Unidade Curricular</th>
                            <th className="p-1.5 text-center">Sem.</th><th className="p-1.5 text-center">ECTS</th>
                            <th className="p-1.5 text-center">Nota</th><th className="p-1.5">Origem</th>
                          </tr>
                        </thead>
                        <tbody>
                          {y.rows.map((r) => (
                            <tr key={r.ucId} className="border-t border-slate-100">
                              <td className="p-1.5 font-mono">{r.code}</td>
                              <td className="p-1.5">{r.name}</td>
                              <td className="p-1.5 text-center">{r.semester}</td>
                              <td className="p-1.5 text-center">{r.creditsECTS}</td>
                              <td className="p-1.5 text-center">{typeof r.grade === 'number' ? r.grade : '—'}</td>
                              <td className="p-1.5 text-slate-500">{r.origem}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  ))}
                  {sup.estagios.length > 0 && (
                    <div>
                      <div className="font-bold mb-1">Estágios</div>
                      {sup.estagios.map((e) => (
                        <div key={e.code}>{e.code} — {e.local} · {e.hours}h{typeof e.grade === 'number' ? ` · nota ${e.grade}` : ''}</div>
                      ))}
                    </div>
                  )}
                  {sup.tcc && (
                    <div>
                      <div className="font-bold mb-1">Trabalho de Conclusão de Curso</div>
                      <div>{sup.tcc.theme} — orientador: {sup.tcc.advisor}{typeof sup.tcc.grade === 'number' ? ` · nota ${sup.tcc.grade}` : ''}</div>
                    </div>
                  )}
                  <div className="border-t border-slate-300 pt-2 grid grid-cols-3 gap-2 font-semibold">
                    <div>Total: {sup.totalECTS} ECTS</div>
                    <div>Média curricular: {sup.finalGradeCurricular}</div>
                    <div>Final: {sup.finalCourseGrade} ({sup.finalMention})</div>
                  </div>
                </div>
              );
            })()}

            {printMode === 'diploma' && (
            <div className="mt-6 text-center space-y-4 font-serif">
              <div className="text-xs uppercase tracking-widest text-slate-500 font-sans">
                REPÚBLICA DE ANGOLA
              </div>
              <div className="text-sm font-bold uppercase tracking-wider text-slate-700 font-sans">
                MINISTÉRIO DO ENSINO SUPERIOR, CIÊNCIA, TECNOLOGIA E INOVAÇÃO
              </div>
              <div className="text-2xl font-black text-slate-900 uppercase pt-2">
                DIPLOMA DE GRAU ACADÉMICO
              </div>

              <p className="text-sm text-slate-700 max-w-xl mx-auto pt-4 leading-relaxed font-sans">
                O Magnífico Reitor e os Órgãos Científicos da Instituição de Ensino Superior, no uso das competências atribuídas por lei, conferem a:
              </p>

              <div className="text-3xl font-extrabold text-indigo-950 uppercase tracking-tight py-2 border-b-2 border-amber-600/40 inline-block px-8">
                {selectedDiplomaForPrint.studentName}
              </div>

              <p className="text-sm text-slate-700 max-w-xl mx-auto leading-relaxed font-sans">
                portador(a) do Processo n.º <strong>{selectedDiplomaForPrint.studentProcNumber}</strong>, o grau académico de:
              </p>

              <div className="text-2xl font-black text-amber-700 uppercase">
                {selectedDiplomaForPrint.degreeTitle}
              </div>

              <p className="text-xs text-slate-600 max-w-xl mx-auto font-sans">
                por haver cumprido integralmente o plano de estudos oficial com <strong>{selectedDiplomaForPrint.totalCreditsECTS} créditos ECTS</strong>, tendo concluído com a Classificação Final de:
              </p>

              <div className="text-2xl font-black text-slate-900">
                {selectedDiplomaForPrint.finalCourseGrade} Valores — Menção de &ldquo;{selectedDiplomaForPrint.finalMention}&rdquo;
              </div>

              <div className="pt-8 grid grid-cols-2 gap-8 text-xs font-sans text-slate-700">
                <div className="border-t border-slate-400 pt-2">
                  <div className="font-bold">{selectedDiplomaForPrint.rectorName || '____________________'}</div>
                  <div className="text-slate-500">O Reitor</div>
                </div>
                <div className="border-t border-slate-400 pt-2">
                  <div className="font-bold">{selectedDiplomaForPrint.academicDirectorName || '____________________'}</div>
                  <div className="text-slate-500">Diretor(a) dos Assuntos Académicos</div>
                </div>
              </div>

              <div className="text-[11px] text-slate-500 font-sans pt-4 border-t border-slate-200 flex justify-between">
                <span>Registo: N.º {selectedDiplomaForPrint.registerNumber} ({selectedDiplomaForPrint.code})</span>
                <span>{selectedDiplomaForPrint.registryBook || '__________'}, Fls. {selectedDiplomaForPrint.registryPage || '____'}</span>
                <span>Data de Emissão: {selectedDiplomaForPrint.issueDate}</span>
              </div>
            </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};
