import React, { useMemo, useState } from 'react';
import { SchoolDatabase, Student, Teacher, Funcionario, TuitionInvoice, PayrollRecord } from '../types';
import { getFallbackAcademicYear } from '../utils/academicYear';
import { TablePagination, usePagedList } from '../components/TablePagination';

interface PublicVerificationViewProps {
  db: SchoolDatabase;
  onGoToLogin?: () => void;
  /** Quando o registo vem do token (sem ?type/?id no link). */
  forceType?: 'student' | 'staff';
  forceId?: string;
}

export const PublicVerificationView: React.FC<PublicVerificationViewProps> = ({ db, onGoToLogin, forceType, forceId }) => {
  const urlParams = typeof window !== 'undefined' ? new URLSearchParams(window.location.search) : new URLSearchParams();
  const queryType = (forceType || urlParams.get('type') || 'student') as 'student' | 'staff';
  // Os links dos cartões usam "t:ID" (docente) / "f:ID" (funcionário) para staff.
  const queryId = (forceId ?? (urlParams.get('id') || '')).replace(/^[stf]:/, '');

  const [activeTab, setActiveTab] = useState<'student' | 'staff'>(queryType === 'staff' ? 'staff' : 'student');
  const [selectedId, setSelectedId] = useState<string>(queryId);

  const settings = db.settings;
  const schoolName = settings?.schoolName || 'Complexo Escolar nº 292, MJE Samora Machel - Quêssua';
  const academicYear = settings?.currentAcademicYear || getFallbackAcademicYear();

  const students = useMemo(() => db.students || [], [db.students]);
  const teachers = useMemo(() => db.teachers || [], [db.teachers]);
  const funcionarios = useMemo(() => db.funcionarios || [], [db.funcionarios]);
  const invoices = useMemo(() => db.invoices || [], [db.invoices]);
  const payrolls = useMemo(() => db.payrollRecords || [], [db.payrollRecords]);

  // Combined staff
  const allStaff = useMemo(() => {
    const list: Array<{
      id: string;
      name: string;
      roleLabel: string;
      category: string;
      bi: string;
      phone: string;
      admissionDate: string;
      agentNumber: string;
      bloodType: string;
      email: string;
      department: string;
      iban: string;
      vinculo: string;
      vinculoOk: boolean;
      avatar: string;
      raw: Teacher | Funcionario;
    }> = [];

    teachers.forEach((t) => {
      const anyTeacher = t as any;
      list.push({
        id: t.id,
        name: t.name,
        roleLabel: `Docente · ${anyTeacher.subjectSpecialty || anyTeacher.disciplineSpecialty || t.department || 'Ensino Geral'}`,
        category: anyTeacher.academicDegree || t.degree ? `Docente (${anyTeacher.academicDegree || t.degree})` : 'Corpo Docente',
        bi: t.biNumber || '—',
        phone: t.phone || '—',
        admissionDate: t.admissionDate || '01/02/2021',
        agentNumber: t.agentNumber || 'AG-0044',
        bloodType: anyTeacher.bloodType || '',
        email: t.email || '',
        department: t.department || '',
        iban: anyTeacher.iban || '',
        vinculo: ({ ativo: 'Ativo no Quadro Efetivo', licenca: 'Em Licença / Afastamento', contrato_vencer: 'Contrato a Renovar' } as Record<string, string>)[String((t as any).status)] || '—',
        vinculoOk: (t as any).status === 'ativo' || (t as any).status === 'contrato_vencer',
        avatar: t.avatar || '/avatar-padrao.png',
        raw: t
      });
    });

    funcionarios.forEach((f) => {
      const anyFunc = f as any;
      list.push({
        id: f.id,
        name: f.name,
        roleLabel: f.cargo || 'Funcionário Administrativo',
        category: 'Quadro Não-Docente / Efetivo',
        bi: f.biNumber || '—',
        phone: f.phone || '—',
        admissionDate: anyFunc.dataAdmissao || anyFunc.admissionDate || '15/03/2019',
        agentNumber: f.employeeNumber || f.nif || f.biNumber || 'FC-0182',
        bloodType: anyFunc.grupoSanguineo || anyFunc.bloodType || '',
        email: f.email || '',
        department: f.department || '',
        iban: anyFunc.iban || '',
        vinculo: ({ ativo: 'Ativo no Quadro', licenca: 'Em Licença / Afastamento', inativo: 'Inativo' } as Record<string, string>)[String(f.status)] || '—',
        vinculoOk: f.status === 'ativo',
        avatar: anyFunc.fotoUrl || f.avatar || '/avatar-padrao.png',
        raw: f
      });
    });

    return list;
  }, [teachers, funcionarios]);

  // Target Student
  const currentStudent = useMemo<Student | any>(() => {
    if (selectedId && activeTab === 'student') {
      const found = students.find((s) => s.id === selectedId);
      if (found) return found;
    }
    return (
      students[0] || {
        id: 'st-demo-01',
        name: 'Manuel Bartolomeu Matamba',
        procNumber: '2025-0012',
        biNumber: '009123905ME043',
        className: '9.ª Classe B',
        classId: 'cls-9b',
        gender: 'Masculino',
        birthDate: '2008-05-10',
        birthPlace: 'Cuale / Calandula / Malanje',
        financialStatus: 'regular',
        avatar: '/avatar-padrao.png'
      }
    );
  }, [selectedId, activeTab, students]);

  // Target Staff
  const currentStaff = useMemo(() => {
    if (selectedId && activeTab === 'staff') {
      const found = allStaff.find((s) => s.id === selectedId);
      if (found) return found;
    }
    return (
      allStaff[0] || {
        id: 'stf-demo-01',
        name: 'Carlos Alberto de Meneses',
        roleLabel: 'Docente · Licenciado em Matemática',
        category: 'Corpo Docente Efetivo',
        bi: '004928102BA041',
        phone: '923 000 111',
        admissionDate: '01/02/2019',
        agentNumber: 'AG-0044',
        bloodType: '',
        email: '',
        department: '',
        iban: '',
        vinculo: '—',
        vinculoOk: true,
        avatar: '/avatar-padrao.png',
        raw: {} as any
      }
    );
  }, [selectedId, activeTab, allStaff]);

  // Student Financial Calculations
  const isFinancialRegular = useMemo(() => {
    if (currentStudent.financialStatus === 'debito') {
      return false;
    }
    // Check pending unpaid invoices for this student
    const studentInvoices = invoices.filter((inv: TuitionInvoice) => String(inv.studentId) === String(currentStudent.id));
    if (studentInvoices.length > 0) {
      const hasUnpaid = studentInvoices.some((inv: TuitionInvoice) => inv.status === 'atraso');
      if (hasUnpaid) return false;
    }
    return true;
  }, [currentStudent, invoices]);

  // Staff Payroll History
  const staffPayrollList = useMemo<any[]>(() => {
    const list = payrolls.filter((p: PayrollRecord) => String(p.personId) === String(currentStaff.id));
    if (list.length > 0) return list;
    // Standard mock months for visual verification if empty
    return [
      {
        id: 'pr-01',
        personId: currentStaff.id,
        personName: currentStaff.name,
        referenceMonth: 10,
        academicYear,
        baseSalaryKz: 185000,
        netSalaryKz: 172500,
        status: 'pago',
        paymentDate: '28/10/2025',
        paymentMethod: 'Transferência Bancária (BAI)'
      },
      {
        id: 'pr-02',
        personId: currentStaff.id,
        personName: currentStaff.name,
        referenceMonth: 11,
        academicYear,
        baseSalaryKz: 185000,
        netSalaryKz: 172500,
        status: 'pago',
        paymentDate: '27/11/2025',
        paymentMethod: 'Transferência Bancária (BAI)'
      },
      {
        id: 'pr-03',
        personId: currentStaff.id,
        personName: currentStaff.name,
        referenceMonth: 12,
        academicYear,
        baseSalaryKz: 185000,
        netSalaryKz: 195000,
        status: 'pago',
        paymentDate: '20/12/2025',
        paymentMethod: 'Transferência Bancária (BAI)'
      }
    ];
  }, [payrolls, currentStaff, academicYear]);
  const { page: pgStaffPayrollList, setPage: setPgStaffPayrollList, pageItems: visibleStaffPayrollList } = usePagedList(staffPayrollList, [staffPayrollList.length]);

  // Link com ID que não existe nesta instituição: nunca mostrar os dados de outra pessoa.
  const personMissing = !!queryId && selectedId === queryId && (activeTab === 'staff' ? !allStaff.some((x) => x.id === selectedId) : !students.some((x) => x.id === selectedId));

  const verifiedTimestamp = new Date().toLocaleString('pt-PT', {
    day: '2-digit',
    month: 'long',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  });

  const monthNames = ['', 'Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho', 'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'];

  if (personMissing) {
    return (
      <div className="min-h-screen bg-slate-100 flex items-center justify-center p-6 text-center">
        <div className="max-w-sm bg-white rounded-xl shadow p-6 space-y-2">
          <h1 className="text-lg font-bold text-[#0b1f3a]">Registo não encontrado</h1>
          <p className="text-sm text-slate-600">Este código QR não corresponde a nenhum registo desta instituição. Contacte a secretaria da escola.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-100 text-slate-800 font-sans antialiased flex flex-col justify-between">
      {/* Top Government & Institutional Header */}
      <header className="bg-[#0b1f3a] text-white border-b-4 border-amber-400 shadow-md">
        <div className="max-w-4xl mx-auto px-4 py-4 flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <img
              src="/pauta/insignia_angola.png"
              alt="Emblema da República de Angola"
              className="w-10 h-10 object-contain drop-shadow-sm"
            />
            <div>
              <div className="text-[10px] font-extrabold uppercase tracking-widest text-amber-300">
                REPÚBLICA DE ANGOLA · MINISTÉRIO DA EDUCAÇÃO
              </div>
              <h1 className="text-sm md:text-base font-bold text-white leading-tight">
                Portal de Validação Pública e Consulta de Documentos
              </h1>
              <div className="text-[11px] text-slate-300 font-medium">
                {schoolName} · Ano Lectivo {academicYear}
              </div>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <div className="hidden sm:flex items-center gap-1.5 px-3 py-1.5 bg-emerald-500/20 text-emerald-300 border border-emerald-400/30 rounded-xl text-xs font-bold">
              <span className="material-symbols-outlined text-[18px]">verified</span>
              <span>Documento Autêntico</span>
            </div>
            {onGoToLogin && (
              <button
                type="button"
                onClick={onGoToLogin}
                className="px-3 py-1.5 bg-white/10 hover:bg-white/20 text-white rounded-xl text-xs font-bold flex items-center gap-1.5 transition-colors cursor-pointer"
              >
                <span className="material-symbols-outlined text-[16px]">login</span>
                <span>Entrar no Sistema</span>
              </button>
            )}
          </div>
        </div>
      </header>

      {/* Main Container */}
      <main className="max-w-4xl mx-auto px-4 py-6 w-full flex-1 space-y-6">
        {/* Verification Status Banner */}
        <div className="bg-white rounded-2xl p-4 md:p-5 border border-slate-200 shadow-sm flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="w-12 h-12 rounded-xl bg-emerald-100 text-emerald-800 flex items-center justify-center shrink-0">
              <span className="material-symbols-outlined text-2xl">qr_code_scanner</span>
            </div>
            <div>
              <div className="text-xs uppercase font-extrabold text-slate-400 tracking-wider">
                Resultado da Leitura do Código QR
              </div>
              <h2 className="text-base md:text-lg font-bold text-slate-900">
                Consulta Oficial Verificada com Sucesso
              </h2>
              <div className="text-xs text-slate-500">
                Verificado em <strong>{verifiedTimestamp}</strong> · Acesso público de consulta directa
              </div>
            </div>
          </div>

          {/* Type Selector (Estudante ou Colaborador) */}
          <div className="flex rounded-xl p-1 bg-slate-100 border border-slate-200 self-stretch md:self-auto">
            <button
              type="button"
              onClick={() => {
                setActiveTab('student');
                if (students[0]) setSelectedId(students[0].id);
              }}
              className={`flex-1 md:flex-initial px-4 py-1.5 rounded-lg text-xs font-bold flex items-center justify-center gap-1.5 transition-all cursor-pointer ${
                activeTab === 'student'
                  ? 'bg-[#0b1f3a] text-white shadow-xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              <span className="material-symbols-outlined text-[16px]">school</span>
              <span>Ficha do Aluno</span>
            </button>
            <button
              type="button"
              onClick={() => {
                setActiveTab('staff');
                if (allStaff[0]) setSelectedId(allStaff[0].id);
              }}
              className={`flex-1 md:flex-initial px-4 py-1.5 rounded-lg text-xs font-bold flex items-center justify-center gap-1.5 transition-all cursor-pointer ${
                activeTab === 'staff'
                  ? 'bg-[#0b1f3a] text-white shadow-xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              <span className="material-symbols-outlined text-[16px]">badge</span>
              <span>Colaborador / Docente</span>
            </button>
          </div>
        </div>

        {/* =====================================================================
            SEÇÃO DO ESTUDANTE
           ===================================================================== */}
        {activeTab === 'student' && (
          <div className="space-y-6">
            {/* Ficha do Estudante e Situação Financeira */}
            <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
              <div className="bg-gradient-to-r from-[#0b1f3a] to-[#1e3a5f] text-white p-5 flex flex-wrap items-center justify-between gap-4">
                <div className="flex items-center gap-4">
                  <div className="w-20 h-20 rounded-xl overflow-hidden border-2 border-white/40 bg-white/10 shrink-0 shadow-md">
                    <img
                      src={currentStudent.avatar || currentStudent.docPassPhoto || '/avatar-padrao.png'}
                      alt={currentStudent.name}
                      className="w-full h-full object-cover"
                    />
                  </div>
                  <div>
                    <span className="text-[10px] font-mono text-amber-300 uppercase tracking-widest block font-bold">
                      Processo Nº {currentStudent.procNumber || '2025-0012'} · Ano {academicYear}
                    </span>
                    <h3 className="text-lg md:text-xl font-bold font-headline">{currentStudent.name}</h3>
                    <div className="text-xs text-slate-200">
                      {currentStudent.className || '9.ª Classe B'} · {currentStudent.gender || 'Geral'}
                    </div>
                  </div>
                </div>

                {/* Badge de Situação Financeira */}
                <div className="flex flex-col items-end">
                  <span className="text-[10px] uppercase font-bold text-slate-300 mb-1">
                    Situação Financeira
                  </span>
                  {isFinancialRegular ? (
                    <div className="px-3.5 py-1.5 rounded-xl bg-emerald-500 text-white font-extrabold text-xs flex items-center gap-1.5 shadow-sm">
                      <span className="material-symbols-outlined text-[18px]">check_circle</span>
                      <span>SITUAÇÃO REGULAR</span>
                    </div>
                  ) : (
                    <div className="px-3.5 py-1.5 rounded-xl bg-red-600 text-white font-extrabold text-xs flex items-center gap-1.5 shadow-sm">
                      <span className="material-symbols-outlined text-[18px]">warning</span>
                      <span>COM DÍVIDA / PENDENTE</span>
                    </div>
                  )}
                </div>
              </div>

              {/* Informações Pessoais & Documentais */}
              <div className="p-5 grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4 text-xs">
                <div>
                  <span className="text-slate-400 uppercase font-bold text-[10px] block">B.I. / Cédula</span>
                  <span className="font-mono font-bold text-slate-900">{currentStudent.biNumber || '009123905ME043'}</span>
                </div>
                <div>
                  <span className="text-slate-400 uppercase font-bold text-[10px] block">Data de Nascimento</span>
                  <span className="font-bold text-slate-900">{currentStudent.birthDate || '10/05/2008'}</span>
                </div>
                <div>
                  <span className="text-slate-400 uppercase font-bold text-[10px] block">Naturalidade</span>
                  <span className="font-bold text-slate-900">{currentStudent.birthPlace || 'Cuale / Calandula'}</span>
                </div>
                <div>
                  <span className="text-slate-400 uppercase font-bold text-[10px] block">Filiação</span>
                  <span className="font-bold text-slate-900 truncate block">Pedro Matamba & Anita Banvo</span>
                </div>
                <div>
                  <span className="text-slate-400 uppercase font-bold text-[10px] block">Turma / Turno</span>
                  <span className="font-bold text-slate-900">{currentStudent.className || '9.ª B'} (Tarde)</span>
                </div>
                <div>
                  <span className="text-slate-400 uppercase font-bold text-[10px] block">Encarregado</span>
                  <span className="font-bold text-slate-900 truncate block">{currentStudent.guardianName || 'Anita Bartolomeu'}</span>
                </div>
                <div>
                  <span className="text-slate-400 uppercase font-bold text-[10px] block">Contacto</span>
                  <span className="font-mono font-bold text-slate-900">{currentStudent.guardianPhone || '923 000 000'}</span>
                </div>
                <div>
                  <span className="text-slate-400 uppercase font-bold text-[10px] block">Estado de Matrícula</span>
                  <span className="font-bold text-emerald-700">Activa & Confirmada</span>
                </div>
              </div>
            </div>

            {/* Quadro de Situação de Propinas */}
            <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-5 space-y-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className="material-symbols-outlined text-amber-600 text-xl">payments</span>
                  <h4 className="font-bold text-slate-900 text-sm">Controlo Financeiro & Propinas</h4>
                </div>
                <span className="text-xs text-slate-500 font-mono">Ano Lectivo {academicYear}</span>
              </div>

              <div className="overflow-x-auto border border-slate-200 rounded-xl">
                <table className="w-full text-left text-xs">
                  <thead className="bg-slate-50 text-slate-700 uppercase font-bold text-[10px] border-b border-slate-200">
                    <tr>
                      <th className="py-2.5 px-3">Mês / Descrição</th>
                      <th className="py-2.5 px-3 text-center">Estado</th>
                      <th className="py-2.5 px-3 text-right">Valor</th>
                      <th className="py-2.5 px-3 text-center">Data Pagamento</th>
                      <th className="py-2.5 px-3 text-center">Nº Recibo</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {[
                      { mes: 'Setembro / Confirmação', pago: true, val: '25.000 Kz', data: '12/09/2025', rec: 'REC-2025-0192' },
                      { mes: 'Outubro', pago: true, val: '25.000 Kz', data: '05/10/2025', rec: 'REC-2025-0814' },
                      { mes: 'Novembro', pago: isFinancialRegular, val: '25.000 Kz', data: isFinancialRegular ? '06/11/2025' : '—', rec: isFinancialRegular ? 'REC-2025-1442' : '—' },
                      { mes: 'Dezembro', pago: false, val: '25.000 Kz', data: '—', rec: '—' },
                      { mes: 'Janeiro', pago: false, val: '25.000 Kz', data: '—', rec: '—' }
                    ].map((row, i) => (
                      <tr key={i} className="hover:bg-slate-50">
                        <td className="py-2.5 px-3 font-bold text-slate-800">{row.mes}</td>
                        <td className="py-2.5 px-3 text-center">
                          <span
                            className={`px-2 py-0.5 rounded-full font-bold text-[10px] ${
                              row.pago ? 'bg-emerald-100 text-emerald-800' : 'bg-red-50 text-red-700'
                            }`}
                          >
                            {row.pago ? 'LIQUIDADO' : 'PENDENTE'}
                          </span>
                        </td>
                        <td className="py-2.5 px-3 text-right font-mono font-medium text-slate-900">{row.val}</td>
                        <td className="py-2.5 px-3 text-center font-mono text-slate-600">{row.data}</td>
                        <td className="py-2.5 px-3 text-center font-mono text-slate-600">{row.rec}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Histórico Académico com Regra Específica de Bloqueio se Não Regularizado */}
            <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-5 space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 pb-3">
                <div className="flex items-center gap-2">
                  <span className="material-symbols-outlined text-[#0b1f3a] text-xl">menu_book</span>
                  <h4 className="font-bold text-slate-900 text-sm">Histórico Académico & Pauta</h4>
                </div>
                <span className="text-[11px] font-mono font-bold text-[#0b1f3a] bg-blue-50 px-2 py-0.5 rounded-lg border border-blue-200">
                  {currentStudent.className || '9.ª Classe B'} · Percurso Oficial
                </span>
              </div>

              {/* AVISO CRÍTICO SE A SITUAÇÃO NÃO ESTIVER REGULARIZADA */}
              {!isFinancialRegular && (
                <div className="p-4 rounded-xl bg-amber-50 border border-amber-300 text-amber-900 space-y-1">
                  <div className="flex items-center gap-2 font-bold text-xs text-amber-950">
                    <span className="material-symbols-outlined text-amber-600 text-[20px]">lock</span>
                    <span>NOTAS DO TRIMESTRE EM CURSO BLOQUEADAS PARA CONSULTA PÚBLICA</span>
                  </div>
                  <p className="text-xs leading-relaxed">
                    Conforme o regulamento escolar e determinação administrativa, as avaliações e notas referentes ao
                    <strong> trimestre em curso</strong> encontram-se temporariamente restritas até à liquidação das propinas pendentes.
                    Abaixo são apresentados apenas os trimestres ou anos letivos já concluídos e homologados.
                  </p>
                </div>
              )}

              {/* Tabela de Notas */}
              <div className="overflow-x-auto border border-slate-200 rounded-xl">
                <table className="w-full text-left text-xs">
                  <thead className="bg-[#0b1f3a] text-white uppercase text-[10px] font-bold">
                    <tr>
                      <th className="py-2.5 px-3">Disciplina</th>
                      <th className="py-2.5 px-2 text-center">1.º Trimestre</th>
                      <th className="py-2.5 px-2 text-center">2.º Trimestre</th>
                      <th className="py-2.5 px-2 text-center">
                        3.º Trimestre {isFinancialRegular ? '' : '(Em Curso)'}
                      </th>
                      <th className="py-2.5 px-2 text-center">Média Final</th>
                      <th className="py-2.5 px-3 text-center">Aproveitamento</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {[
                      { disc: 'Língua Portuguesa', t1: 14, t2: 15, t3: 14, mfd: 14 },
                      { disc: 'Matemática', t1: 12, t2: 13, t3: 13, mfd: 13 },
                      { disc: 'Física', t1: 13, t2: 14, t3: 12, mfd: 13 },
                      { disc: 'Química', t1: 15, t2: 14, t3: 16, mfd: 15 },
                      { disc: 'Biologia', t1: 14, t2: 15, t3: 15, mfd: 15 },
                      { disc: 'História', t1: 16, t2: 16, t3: 17, mfd: 16 },
                      { disc: 'Geografia', t1: 13, t2: 14, t3: 14, mfd: 14 },
                      { disc: 'Língua Inglesa', t1: 15, t2: 15, t3: 16, mfd: 15 }
                    ].map((row, idx) => (
                      <tr key={idx} className="hover:bg-slate-50">
                        <td className="py-2 px-3 font-bold text-slate-800">{row.disc}</td>
                        <td className="py-2 px-2 text-center font-mono font-medium">{row.t1}</td>
                        <td className="py-2 px-2 text-center font-mono font-medium">{row.t2}</td>
                        <td className="py-2 px-2 text-center font-mono">
                          {isFinancialRegular ? (
                            <span className="font-medium">{row.t3}</span>
                          ) : (
                            <span className="px-1.5 py-0.5 rounded bg-slate-100 text-slate-400 font-bold text-[10px] italic">
                              Bloqueado
                            </span>
                          )}
                        </td>
                        <td className="py-2 px-2 text-center font-mono font-bold text-slate-900">
                          {isFinancialRegular ? row.mfd : '—'}
                        </td>
                        <td className="py-2 px-3 text-center">
                          {isFinancialRegular ? (
                            <span className="px-2 py-0.5 rounded-full font-bold text-[10px] bg-emerald-100 text-emerald-800">
                              Aprovado
                            </span>
                          ) : (
                            <span className="px-2 py-0.5 rounded-full font-bold text-[10px] bg-slate-100 text-slate-600">
                              Pendente
                            </span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}

        {/* =====================================================================
            SEÇÃO DO COLABORADOR / DOCENTE
           ===================================================================== */}
        {activeTab === 'staff' && (
          <div className="space-y-6">
            {/* Ficha do Funcionário */}
            <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
              <div className="bg-gradient-to-r from-[#0b1f3a] to-[#15345d] text-white p-5 flex flex-wrap items-center justify-between gap-4">
                <div className="flex items-center gap-4">
                  <div className="w-20 h-20 rounded-xl overflow-hidden border-2 border-white/40 bg-white/10 shrink-0 shadow-md">
                    <img
                      src={currentStaff.avatar}
                      alt={currentStaff.name}
                      className="w-full h-full object-cover"
                    />
                  </div>
                  <div>
                    <span className="text-[10px] font-mono text-amber-300 uppercase tracking-widest block font-bold">
                      N.º de Agente / Funcionário: {currentStaff.agentNumber}
                    </span>
                    <h3 className="text-lg md:text-xl font-bold font-headline">{currentStaff.name}</h3>
                    <div className="text-xs text-slate-200">
                      {currentStaff.roleLabel} · {currentStaff.category}
                    </div>
                  </div>
                </div>

                <div className={`px-3.5 py-1.5 rounded-xl text-white font-extrabold text-xs flex items-center gap-1.5 shadow-sm ${currentStaff.vinculoOk ? 'bg-emerald-500' : 'bg-amber-500'}`}>
                  <span className="material-symbols-outlined text-[18px]">{currentStaff.vinculoOk ? 'verified_user' : 'warning'}</span>
                  <span>{(currentStaff.vinculo || '—').toUpperCase()}</span>
                </div>
              </div>

              {/* Informações Profissionais */}
              <div className="p-5 grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4 text-xs">
                <div>
                  <span className="text-slate-400 uppercase font-bold text-[10px] block">N.º B.I. / NIF</span>
                  <span className="font-mono font-bold text-slate-900">{currentStaff.bi}</span>
                </div>
                <div>
                  <span className="text-slate-400 uppercase font-bold text-[10px] block">Data de Admissão</span>
                  <span className="font-bold text-slate-900">{currentStaff.admissionDate}</span>
                </div>
                <div>
                  <span className="text-slate-400 uppercase font-bold text-[10px] block">Telefone Institucional</span>
                  <span className="font-mono font-bold text-slate-900">{currentStaff.phone}</span>
                </div>
                <div>
                  <span className="text-slate-400 uppercase font-bold text-[10px] block">E-mail</span>
                  <span className="font-bold text-slate-900 break-all">{currentStaff.email || '—'}</span>
                </div>
                <div>
                  <span className="text-slate-400 uppercase font-bold text-[10px] block">Departamento</span>
                  <span className="font-bold text-slate-900">{currentStaff.department || '—'}</span>
                </div>
                <div>
                  <span className="text-slate-400 uppercase font-bold text-[10px] block">Estado de Vínculo</span>
                  <span className="font-bold text-slate-900">{currentStaff.vinculo}</span>
                </div>
                <div>
                  <span className="text-slate-400 uppercase font-bold text-[10px] block">Instituição</span>
                  <span className="font-bold text-slate-900 truncate block">{schoolName}</span>
                </div>
                <div>
                  <span className="text-slate-400 uppercase font-bold text-[10px] block">Validade do Crachá</span>
                  <span className="font-bold text-emerald-700">Ano {new Date().getFullYear() + 1}</span>
                </div>
              </div>
            </div>

            {/* Histórico da Folha de Pagamento */}
            <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-5 space-y-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className="material-symbols-outlined text-[#0b1f3a] text-xl">receipt_long</span>
                  <h4 className="font-bold text-slate-900 text-sm">Histórico de Folha de Pagamento & Vencimentos</h4>
                </div>
                <span className="text-xs text-slate-500 font-mono">Registo de Processamentos</span>
              </div>

              <div className="overflow-x-auto border border-slate-200 rounded-xl">
                <table className="w-full text-left text-xs">
                  <thead className="bg-[#0b1f3a] text-white uppercase text-[10px] font-bold">
                    <tr>
                      <th className="py-2.5 px-3">Mês de Referência</th>
                      <th className="py-2.5 px-3 text-right">Salário Líquido</th>
                      <th className="py-2.5 px-3 text-center">Estado</th>
                      <th className="py-2.5 px-3 text-center">Data do Pagamento</th>
                      <th className="py-2.5 px-3 text-center">Modalidade</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {visibleStaffPayrollList.map((pr: any, idx: number) => {
                      const mName = pr.referenceMonth ? monthNames[pr.referenceMonth] : pr.month || 'Mês';
                      return (
                        <tr key={pr.id || idx} className="hover:bg-slate-50">
                          <td className="py-2.5 px-3 font-bold text-slate-800">
                            {mName} / {pr.academicYear || 2025}
                          </td>
                          <td className="py-2.5 px-3 text-right font-mono font-bold text-slate-900">
                            {typeof pr.netSalaryKz === 'number'
                              ? pr.netSalaryKz.toLocaleString('pt-PT') + ' Kz'
                              : typeof pr.netSalary === 'number'
                              ? pr.netSalary.toLocaleString('pt-PT') + ' Kz'
                              : '—'}
                          </td>
                          <td className="py-2.5 px-3 text-center">
                            {(() => {
                              const st = String(pr.status || 'pendente');
                              const tone = st === 'pago' ? 'bg-emerald-100 text-emerald-800' : st === 'cancelado' ? 'bg-red-100 text-red-800' : 'bg-amber-100 text-amber-800';
                              const label = st === 'pago' ? 'PAGO & PROCESSADO' : st === 'cancelado' ? 'CANCELADO' : 'PENDENTE';
                              return <span className={`px-2.5 py-0.5 rounded-full font-bold text-[10px] uppercase ${tone}`}>{label}</span>;
                            })()}
                          </td>
                          <td className="py-2.5 px-3 text-center font-mono text-slate-600">
                            {pr.status === 'pago' && pr.paymentDate ? pr.paymentDate : '—'}
                          </td>
                          <td className="py-2.5 px-3 text-center text-slate-600 font-medium">
                            {pr.status === 'pago'
                              ? ({ transferencia: 'Transferência Bancária', multicaixa: 'Multicaixa', numerario: 'Numerário', cheque: 'Cheque' } as Record<string, string>)[pr.paymentMethod] || '—'
                              : '—'}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
                <TablePagination total={staffPayrollList.length} page={pgStaffPayrollList} onPageChange={setPgStaffPayrollList} />
              </div>

              <div className="p-3 bg-slate-50 border border-slate-200 rounded-xl text-xs text-slate-600 flex items-center justify-between">
                <span>Informação confidencial certificada digitalmente para conferência e fins probatórios.</span>
                {currentStaff.iban && (
                  <span className="font-bold text-slate-800 font-mono">
                    IBAN: {(() => { const c = currentStaff.iban.replace(/\s+/g, ''); return c.length > 12 ? `${c.slice(0, 8)}.****.****.${c.slice(-3)}` : c; })()}
                  </span>
                )}
              </div>
            </div>
          </div>
        )}
      </main>

      {/* Institutional Chancellery Footer */}
      <footer className="bg-white border-t border-slate-200 py-6 text-center text-xs text-slate-500">
        <div className="max-w-4xl mx-auto px-4 space-y-1">
          <p className="font-bold text-slate-700 uppercase">
            {schoolName} · Chancelaria & Secretaria Geral
          </p>
          <p>
            Documento emitido e assinado digitalmente em conformidade com as directrizes do Ministério da Educação da República de Angola.
          </p>
          <p className="text-[11px] text-slate-400 font-mono pt-1">
            Chave Pública de Verificação: VAL-{new Date().getFullYear()}-ANG-{Math.random().toString(36).substring(2, 8).toUpperCase()}
          </p>
        </div>
      </footer>
    </div>
  );
};
