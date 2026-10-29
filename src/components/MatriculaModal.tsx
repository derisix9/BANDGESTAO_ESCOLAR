import React, { useMemo, useState } from 'react';
import { SchoolDatabase, Student, Matricula, MatriculaTipo, MatriculaEstado, MatriculaTipoAluno, SituacaoFinanceira } from '../types';
import { SITUACAO_FINANCEIRA_OPTIONS, SITUACAO_FINANCEIRA_LABEL, legacyEstadoFinanceiro, resolveFinancialSituation } from '../utils/financialSituation';
import { dbService } from '../services/db';
import { findTuitionRowForGrade } from '../utils/educationSubsystems';
import { buildAcademicYearList } from '../utils/academicYear';
import { Notice } from './Notice';

interface MatriculaModalProps {
  db: SchoolDatabase;
  student: Student;
  /** Se existir, o modal edita esta matrícula em vez de criar uma nova. */
  matricula?: Matricula;
  onClose: () => void;
  onSaved?: (matricula: Matricula) => void;
  /** Matrícula por transferência: abre já com o tipo "Transferência" e grava escola de origem e nº da guia. */
  transfer?: { schoolName: string; guideNumber: string };
}

const TIPO_OPTIONS: { value: MatriculaTipo; label: string }[] = [
  { value: 'nova', label: 'Nova Matrícula' },
  { value: 'renovacao', label: 'Renovação' },
  { value: 'transferencia', label: 'Transferência' },
  { value: 'reingresso', label: 'Reingresso' }
];

const ESTADO_OPTIONS: { value: MatriculaEstado; label: string }[] = [
  { value: 'pendente', label: 'Pendente' },
  { value: 'matriculado', label: 'Matriculado' },
  { value: 'confirmada', label: 'Confirmada' },
  { value: 'cancelada', label: 'Cancelada' },
  { value: 'transferida', label: 'Transferida' },
  { value: 'concluida', label: 'Concluída' }
];

const TIPO_ALUNO_OPTIONS: { value: MatriculaTipoAluno; label: string }[] = [
  { value: 'interno', label: 'Interno' },
  { value: 'externo', label: 'Externo' },
  { value: 'bolseiro', label: 'Bolseiro' },
  { value: 'isento', label: 'Isento' }
];

const FORMA_PAGAMENTO_OPTIONS = [
  { value: 'numerario', label: 'Numerário' },
  { value: 'mcx', label: 'Multicaixa Express' },
  { value: 'tpa', label: 'TPA Multicaixa' },
  { value: 'debito', label: 'Transferência Bancária' }
];

const inputCls =
  'w-full h-9 px-3 rounded-none bg-white border border-slate-300 text-slate-800 focus:border-[#0b1f3a] focus:ring-1 focus:ring-[#0b1f3a] focus:outline-none';
const labelCls = 'block uppercase font-bold text-slate-700 mb-1 text-[10px]';

/**
 * Modal de Matrícula — secção "Matrículas" (diferente da ficha de Cadastro do
 * Aluno). Um aluno já cadastrado pode ter várias matrículas ao longo dos anos
 * lectivos que estuda nesta instituição. Ao gravar, chama
 * `dbService.confirmMatricula`, que liga a Turma e gera as obrigações
 * financeiras (matrícula + propinas) a partir da Tabela Financeira real.
 */
export const MatriculaModal: React.FC<MatriculaModalProps> = ({ db, student, matricula, onClose, onSaved, transfer }) => {
  const historico = useMemo(() => dbService.getMatriculasByStudent(student.id), [db.matriculas, student.id]);
  const editing = Boolean(matricula);
  const lastMatricula = historico[0];
  // Em edição parte-se da própria matrícula; ao criar, da última matrícula do aluno.
  const base = matricula ?? lastMatricula;

  const [academicYear, setAcademicYear] = useState(matricula?.academicYear || db.settings?.currentAcademicYear || '');
  const [classId, setClassId] = useState<string>(String(base?.classId || student.classId || ''));
  const [tipo, setTipo] = useState<MatriculaTipo>(matricula ? matricula.tipo : transfer ? 'transferencia' : historico.length === 0 ? 'nova' : 'renovacao');
  // Matrícula por transferência de ENTRADA nunca fica "transferida": o aluno é um aluno normal da escola
  // e a situação final (aprovado/reprovado) é calculada com as notas dos trimestres. "Transferido" é só para quem sai.
  const [estado, setEstadoRaw] = useState<MatriculaEstado>(matricula ? matricula.estado : 'matriculado');
  const setEstado = (v: MatriculaEstado) => setEstadoRaw(transfer && v === 'transferida' ? 'matriculado' : v);
  const [tipoAluno, setTipoAluno] = useState<MatriculaTipoAluno>(base?.tipoAluno || 'interno');
  // Situação financeira (substitui o antigo "Regime"). Em edição mostra a situação REAL (muda com os pagamentos);
  // ao criar parte de "pendente" (ou "isento" se o aluno é bolseiro/isento).
  const [situacaoFinanceira, setSituacaoFinanceira] = useState<SituacaoFinanceira>(() =>
    matricula
      ? resolveFinancialSituation(matricula, (db.invoices || []).filter((i) => String(i.studentId) === String(student.id)))
      : base?.tipoAluno === 'bolseiro' || base?.tipoAluno === 'isento' ? 'isento' : 'pendente'
  );
  const isExemptType = (t: MatriculaTipoAluno) => t === 'bolseiro' || t === 'isento';
  const changeTipoAluno = (t: MatriculaTipoAluno) => {
    setTipoAluno(t);
    if (editing) return;
    if (isExemptType(t)) setSituacaoFinanceira('isento');
    else if (situacaoFinanceira === 'isento') setSituacaoFinanceira('pendente');
  };
  const changeSituacao = (v: SituacaoFinanceira) => {
    setSituacaoFinanceira(v);
    if (v === 'isento' && !isExemptType(tipoAluno)) setTipoAluno('bolseiro');
    else if (v !== 'isento' && isExemptType(tipoAluno)) setTipoAluno('interno');
  };
  const [descontoPercent, setDescontoPercent] = useState<number>(base?.descontoPercent || 0);
  const [diaVencimento, setDiaVencimento] = useState<number>(base?.diaVencimento || db.settings?.financialRules?.paymentDueDay || 10);
  const [formaPagamento, setFormaPagamento] = useState(base?.formaPagamento || 'numerario');
  const [responsavelFinanceiroNome, setResponsavelFinanceiroNome] = useState(
    base?.responsavelFinanceiroNome ||
      (student.filiation?.financialResponsibleIsDifferent
        ? student.filiation?.financialResponsible?.name
        : student.guardianName) ||
      ''
  );
  const [responsavelFinanceiroTelefone, setResponsavelFinanceiroTelefone] = useState(
    base?.responsavelFinanceiroTelefone ||
      (student.filiation?.financialResponsibleIsDifferent
        ? student.filiation?.financialResponsible?.phone
        : student.guardianPhone) ||
      ''
  );
  const [numeroParcelas, setNumeroParcelas] = useState<number>(base?.numeroParcelas ?? 10);
  const [observacoes, setObservacoes] = useState(matricula?.observacoes || '');
  const [submitStatus, setSubmitStatus] = useState<'idle' | 'loading' | 'success' | 'error'>('idle');
  const [errorMsg, setErrorMsg] = useState('');

  const selectedClass = useMemo(() => db.classes.find((c) => String(c.id) === String(classId)), [db.classes, classId]);

  const tuitionRow = useMemo(
    () => (selectedClass ? findTuitionRowForGrade(db.settings?.tuitionRows, selectedClass.grade) : undefined),
    [selectedClass, db.settings?.tuitionRows]
  );
  // Em edição os montantes ficam os da matrícula gravada (as faturas já foram geradas com eles).
  const valorMatriculaKz = matricula ? matricula.valorMatriculaKz : tuitionRow?.matriculaKz ?? 0;
  const valorPropinaKz = matricula ? matricula.valorPropinaKz : tuitionRow?.monthlyTuitionKz ?? 0;

  // Só anos que já existem na instituição (Configurações > Ano Letivo) e os das suas turmas.
  const matriculaYears = useMemo(
    () => buildAcademicYearList(db.settings, [academicYear, ...(db.classes || []).map((c) => c.academicYear)]),
    [db.settings, db.classes, academicYear]
  );

  const numeroPreview = matricula ? matricula.numeroMatricula : dbService.generateMatriculaNumber(academicYear);

  // Um aluno não pode ser matriculado duas vezes no mesmo ano lectivo.
  const duplicateInYear = useMemo(
    () => (!editing && academicYear ? dbService.findMatriculaInAcademicYear(student.id, academicYear) : undefined),
    [db.matriculas, student.id, academicYear, editing]
  );

  const availableClasses = useMemo(
    () => db.classes.filter((c) => !academicYear || c.academicYear === academicYear),
    [db.classes, academicYear]
  );

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (submitStatus === 'loading') return;
    if (!academicYear.trim()) {
      setErrorMsg('Indique o Ano Lectivo.');
      return;
    }
    if (duplicateInYear) {
      setErrorMsg(
        `Este aluno já tem matrícula no ano lectivo ${academicYear} (${duplicateInYear.numeroMatricula} — ${duplicateInYear.grade}). Não é possível matricular duas vezes no mesmo ano.`
      );
      return;
    }
    if (!selectedClass) {
      setErrorMsg('Seleccione a Turma desta matrícula.');
      return;
    }
    if (matricula) {
      setErrorMsg('');
      setSubmitStatus('loading');
      const res = dbService.editMatricula(matricula.id, {
        classId: String(selectedClass.id),
        tipo,
        estado,
        tipoAluno,
        descontoPercent,
        diaVencimento,
        formaPagamento,
        responsavelFinanceiroNome,
        responsavelFinanceiroTelefone,
        observacoes
      });
      if (!res.success || !res.matricula) {
        setSubmitStatus('error');
        setErrorMsg(res.error || 'Não foi possível guardar as alterações da matrícula.');
        return;
      }
      setSubmitStatus('success');
      const saved = res.matricula;
      setTimeout(() => {
        onSaved?.(saved);
        onClose();
      }, 900);
      return;
    }
    if (!tuitionRow) {
      setErrorMsg(
        `Não existe Tabela Financeira configurada para a classe "${selectedClass.grade}". Configure-a em Configurações → Financeiro antes de matricular (nunca inventamos valores).`
      );
      return;
    }
    setErrorMsg('');
    setSubmitStatus('loading');

    try {
      const matricula = dbService.confirmMatricula({
        academicYear: academicYear.trim(),
        studentId: student.id,
        previousGrade: lastMatricula?.grade,
        previousResult: lastMatricula?.estado,
        grade: selectedClass.grade,
        courseName: selectedClass.area || student.courseName,
        classId: String(selectedClass.id),
        className: selectedClass.name,
        shift: selectedClass.shift,
        classroomRoom: selectedClass.room,
        dataMatricula: new Date().toISOString().slice(0, 10),
        tipo,
        estado,
        tipoAluno,
        valorMatriculaKz,
        valorPropinaKz,
        descontoPercent,
        diaVencimento,
        formaPagamento,
        responsavelFinanceiroNome,
        responsavelFinanceiroTelefone,
        numeroParcelas,
        situacaoFinanceira,
        estadoFinanceiro: legacyEstadoFinanceiro(situacaoFinanceira),
        observacoes: observacoes || undefined,
        ...(transfer ? { escolaOrigem: transfer.schoolName, guiaTransferenciaNumero: transfer.guideNumber } : {})
      });
      setSubmitStatus('success');
      setTimeout(() => {
        onSaved?.(matricula);
        onClose();
      }, 900);
    } catch (err: any) {
      setSubmitStatus('error');
      setErrorMsg(err?.message || 'Não foi possível gravar a matrícula.');
    }
  };

  return (
    <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-3 sm:p-4">
      <div className="bg-white rounded-none max-w-3xl w-full shadow-2xl border border-slate-400 overflow-hidden flex flex-col max-h-[94vh]">
        <div className="px-6 py-4 bg-[#0b1f3a] text-white flex items-center justify-between border-b border-slate-700">
          <div className="flex items-center gap-2">
            <span className="material-symbols-outlined text-[22px]">assignment_turned_in</span>
            <div>
              <h3 className="font-bold text-sm tracking-wide uppercase leading-tight">{editing ? 'Editar Matrícula' : 'Nova Matrícula'}</h3>
              <p className="text-[11px] text-slate-300 leading-tight">
                {student.name} · Proc. {student.procNumber || '—'} · Nº {numeroPreview}
              </p>
            </div>
          </div>
          <button onClick={onClose} type="button" className="text-slate-400 hover:text-white p-1 cursor-pointer">
            <span className="material-symbols-outlined text-[20px]">close</span>
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 overflow-y-auto space-y-6 text-xs bg-white">
          {/* Aluno — dados vindos da ficha de cadastro, apenas leitura */}
          <div className="border border-slate-300 p-4 bg-slate-50/50 flex items-center gap-4">
            <img
              src={student.docPassPhoto || student.avatar}
              alt={student.name}
              className="w-12 h-14 object-cover border border-slate-300 shrink-0"
            />
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-x-4 gap-y-1 flex-1">
              <div>
                <div className={labelCls}>Nº de Processo</div>
                <div className="font-bold text-slate-800">{student.procNumber || '—'}</div>
              </div>
              <div>
                <div className={labelCls}>Sexo</div>
                <div className="font-semibold text-slate-800">{student.gender || '—'}</div>
              </div>
              <div>
                <div className={labelCls}>Data de Nascimento</div>
                <div className="font-semibold text-slate-800">{student.birthDate || '—'}</div>
              </div>
              <div>
                <div className={labelCls}>Classe Anterior (nesta instituição)</div>
                <div className="font-semibold text-slate-800">
                  {editing
                    ? matricula?.previousGrade || 'Primeira Matrícula'
                    : lastMatricula
                    ? `${lastMatricula.grade} — ${lastMatricula.estado}`
                    : 'Primeira Matrícula'}
                </div>
              </div>
            </div>
          </div>

          {/* 6. Dados da Matrícula */}
          <div className="border border-slate-300 p-4 bg-slate-50/50">
            <div className="flex items-center gap-2 pb-2 mb-3 border-b border-slate-200">
              <span className="material-symbols-outlined text-[18px] text-[#0b1f3a]">school</span>
              <h4 className="font-bold text-slate-900 text-xs uppercase tracking-wider">6. Dados da Matrícula</h4>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <div>
                <label className={labelCls}>Ano Lectivo *</label>
                <select
                  value={academicYear}
                  onChange={(e) => setAcademicYear(e.target.value)}
                  className={`${inputCls} font-mono`}
                  disabled={editing}
                  required
                >
                  <option value="">Seleccionar ano lectivo…</option>
                  {matriculaYears.map((yr) => (
                    <option key={yr} value={yr}>
                      {yr}
                    </option>
                  ))}
                </select>
              </div>
              <div className="sm:col-span-2">
                <label className={labelCls}>Turma * (define Classe, Curso, Turno e Sala)</label>
                <select value={classId} onChange={(e) => setClassId(e.target.value)} className={`${inputCls} font-semibold`} required>
                  <option value="">Seleccione a turma</option>
                  {availableClasses.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.grade} — {c.name} · {c.shift} · Sala {c.room}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className={labelCls}>Situação Financeira</label>
                <select
                  value={situacaoFinanceira}
                  onChange={(e) => changeSituacao(e.target.value as SituacaoFinanceira)}
                  disabled={editing}
                  title={editing ? 'Situação real, calculada a partir dos pagamentos do aluno.' : undefined}
                  className={`${inputCls} font-semibold ${editing ? 'bg-slate-100 text-slate-600' : ''}`}
                >
                  {SITUACAO_FINANCEIRA_OPTIONS.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className={labelCls}>Tipo de Matrícula</label>
                <select value={tipo} onChange={(e) => setTipo(e.target.value as MatriculaTipo)} className={`${inputCls} font-semibold`}>
                  {TIPO_OPTIONS.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className={labelCls}>Estado</label>
                <select value={estado} onChange={(e) => setEstado(e.target.value as MatriculaEstado)} className={`${inputCls} font-semibold`}>
                  {ESTADO_OPTIONS.filter((o) => !(transfer && o.value === 'transferida')).map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </select>
              </div>
            </div>
          </div>

          {/* 8. Situação Financeira da Matrícula */}
          <div className="border border-slate-300 p-4 bg-slate-50/50">
            <div className="flex items-center gap-2 pb-2 mb-3 border-b border-slate-200">
              <span className="material-symbols-outlined text-[18px] text-[#0b1f3a]">payments</span>
              <h4 className="font-bold text-slate-900 text-xs uppercase tracking-wider">8. Situação Financeira da Matrícula</h4>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <div>
                <label className={labelCls}>Tipo de Aluno</label>
                <select value={tipoAluno} onChange={(e) => changeTipoAluno(e.target.value as MatriculaTipoAluno)} className={`${inputCls} font-semibold`}>
                  {TIPO_ALUNO_OPTIONS.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className={labelCls}>Valor da Matrícula (Kz)</label>
                <div className={`${inputCls} font-mono flex items-center bg-slate-100 text-slate-700`}>
                  {valorMatriculaKz.toLocaleString('pt-AO')} Kz
                </div>
              </div>
              <div>
                <label className={labelCls}>Valor da Propina (Kz)</label>
                <div className={`${inputCls} font-mono flex items-center bg-slate-100 text-slate-700`}>
                  {valorPropinaKz.toLocaleString('pt-AO')} Kz
                </div>
              </div>
              <div>
                <label className={labelCls}>Desconto (%)</label>
                <input
                  type="number"
                  min={0}
                  max={100}
                  value={descontoPercent}
                  onChange={(e) => setDescontoPercent(Number(e.target.value))}
                  className={`${inputCls} font-mono`}
                />
              </div>
              <div>
                <label className={labelCls}>Dia de Vencimento</label>
                <input
                  type="number"
                  min={1}
                  max={28}
                  value={diaVencimento}
                  onChange={(e) => setDiaVencimento(Number(e.target.value))}
                  className={`${inputCls} font-mono`}
                />
              </div>
              <div>
                <label className={labelCls}>Forma de Pagamento</label>
                <select value={formaPagamento} onChange={(e) => setFormaPagamento(e.target.value)} className={inputCls}>
                  {FORMA_PAGAMENTO_OPTIONS.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className={labelCls}>Responsável Financeiro</label>
                <input
                  type="text"
                  value={responsavelFinanceiroNome}
                  onChange={(e) => setResponsavelFinanceiroNome(e.target.value)}
                  className={inputCls}
                />
              </div>
              <div>
                <label className={labelCls}>Telefone do Responsável</label>
                <input
                  type="text"
                  value={responsavelFinanceiroTelefone}
                  onChange={(e) => setResponsavelFinanceiroTelefone(e.target.value)}
                  className={`${inputCls} font-mono`}
                />
              </div>
              <div>
                <label className={labelCls}>Nº de Parcelas (mensalidades)</label>
                <input
                  type="number"
                  min={0}
                  max={12}
                  value={numeroParcelas}
                  onChange={(e) => setNumeroParcelas(Number(e.target.value))}
                  className={`${inputCls} font-mono`}
                />
              </div>
              {!editing && (
                <div className="sm:col-span-3 p-3 border border-slate-200 bg-white text-[11px] text-slate-600 leading-relaxed" data-testid="situacao-financeira-nota">
                  <b className="text-slate-800">{SITUACAO_FINANCEIRA_LABEL[situacaoFinanceira]}:</b>{' '}
                  {situacaoFinanceira === 'regular' && 'a taxa de matrícula e as parcelas definidas ficam registadas como PAGAS em Pagamentos, e a caixa é aberta automaticamente se estiver fechada.'}
                  {situacaoFinanceira === 'pendente' && 'a taxa de matrícula e as parcelas definidas ficam registadas como PENDENTES.'}
                  {situacaoFinanceira === 'mora' && 'as parcelas cujo mês de vencimento já passou ficam EM MORA; as que ainda não venceram ficam como pendentes.'}
                  {situacaoFinanceira === 'isento' && 'aluno isento/bolseiro: não são geradas propinas neste ano lectivo; só são cobrados outros serviços (ex.: taxa de matrícula).'}
                </div>
              )}
              <div className="sm:col-span-3">
                <label className={labelCls}>Observações</label>
                <textarea
                  value={observacoes}
                  onChange={(e) => setObservacoes(e.target.value)}
                  rows={2}
                  className="w-full px-3 py-2 rounded-none bg-white border border-slate-300 text-slate-800 focus:border-[#0b1f3a] focus:ring-1 focus:ring-[#0b1f3a] focus:outline-none"
                />
              </div>
            </div>
          </div>

          {duplicateInYear && (
            <Notice tone="warn" icon="block">
              <span>
                <strong>Matrícula duplicada:</strong> este aluno já está matriculado no ano lectivo {academicYear} (
                {duplicateInYear.numeroMatricula} — {duplicateInYear.grade}, {duplicateInYear.className}). Escolha outro ano
                lectivo ou cancele a matrícula existente.
              </span>
            </Notice>
          )}

          {estado === 'cancelada' && (
            <Notice tone="warn" icon="info">
              <span>Com a matrícula <strong>Cancelada</strong>, o aluno passa a <strong>Inactivo</strong> em Alunos e sai das pautas.</span>
            </Notice>
          )}

          {errorMsg && (
            <Notice tone="error" icon="error">
              {errorMsg}
            </Notice>
          )}

          <div className="flex justify-end gap-2 pt-2 border-t border-slate-200">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 bg-white hover:bg-slate-100 text-slate-700 font-bold text-[11px] uppercase tracking-wide cursor-pointer border border-slate-300"
            >
              Cancelar
            </button>
            <button
              type="submit"
              disabled={submitStatus === 'loading' || submitStatus === 'success' || !!duplicateInYear}
              className="px-5 py-2 bg-[#0b1f3a] hover:bg-[#7a0c0c] text-white font-bold text-[11px] uppercase tracking-wide cursor-pointer border border-[#0b1f3a] disabled:opacity-60"
            >
              {submitStatus === 'loading'
                ? 'A gravar...'
                : submitStatus === 'success'
                ? editing
                  ? 'Matrícula Atualizada ✓'
                  : 'Matrícula Confirmada ✓'
                : editing
                ? 'Guardar Alterações'
                : 'Confirmar Matrícula'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
