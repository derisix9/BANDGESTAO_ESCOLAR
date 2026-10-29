import React, { useMemo, useState } from 'react';
import { SchoolDatabase, Student, Matricula } from '../types';
import {
  getStudentYearFinancialReport,
  getStudentYearAcademicReport,
  FinancialLine
} from '../utils/studentYearReport';
import { INCIDENT_CATEGORY_LABELS, INCIDENT_SEVERITY_META, INCIDENT_STATUS_META } from '../utils/healthSafety';

interface StudentYearRecordModalProps {
  db: SchoolDatabase;
  student: Student;
  matricula: Matricula;
  onClose: () => void;
}

const formatKz = (v: number) =>
  `${(v || 0).toLocaleString('pt-AO', { minimumFractionDigits: 0 })} Kz`;

const SITUACAO_STYLES: Record<string, string> = {
  Aprovado: 'bg-emerald-50 text-emerald-800 border-emerald-300',
  'Não Aprovado': 'bg-red-50 text-red-800 border-red-300',
  'Exame de Recurso': 'bg-amber-50 text-amber-800 border-amber-300',
  'Em Curso': 'bg-blue-50 text-blue-800 border-blue-300',
  'Sem Notas': 'bg-slate-100 text-slate-500 border-slate-300'
};

const SectionTitle: React.FC<{ icon: string; children: React.ReactNode }> = ({ icon, children }) => (
  <div className="flex items-center gap-2 mb-2">
    <span className="material-symbols-outlined text-[16px] text-[#0b1f3a]">{icon}</span>
    <h4 className="font-bold text-[11px] uppercase tracking-wide text-[#0b1f3a]">{children}</h4>
  </div>
);

const LineList: React.FC<{ lines: FinancialLine[]; emptyLabel: string }> = ({ lines, emptyLabel }) => {
  if (lines.length === 0) {
    return <div className="text-[11px] text-slate-400 italic py-1">{emptyLabel}</div>;
  }
  return (
    <div className="divide-y divide-slate-100 border border-slate-200">
      {lines.map((l, i) => (
        <div key={i} className="flex items-center justify-between px-2.5 py-1.5 text-[11px]">
          <span className="text-slate-700 truncate pr-2">{l.label}</span>
          <span className="font-mono text-slate-800 shrink-0">{formatKz(l.totalKz)}</span>
        </div>
      ))}
    </div>
  );
};

export const StudentYearRecordModal: React.FC<StudentYearRecordModalProps> = ({
  db,
  student,
  matricula,
  onClose
}) => {
  const [tab, setTab] = useState<'financeiro' | 'academico'>('financeiro');

  const financeiro = useMemo(
    () => getStudentYearFinancialReport(db, student.id, matricula),
    [db, student.id, matricula]
  );
  const academico = useMemo(
    () => getStudentYearAcademicReport(db, student, matricula),
    [db, student, matricula]
  );

  return (
    <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-3 sm:p-4">
      <div className="bg-white rounded-none max-w-3xl w-full shadow-2xl border border-slate-400 overflow-hidden flex flex-col max-h-[92vh]">
        <div className="px-6 py-4 bg-[#0b1f3a] text-white flex items-center justify-between border-b border-slate-700">
          <div className="flex items-center gap-2 min-w-0">
            <span className="material-symbols-outlined text-[22px]">visibility</span>
            <div className="min-w-0">
              <h3 className="font-bold text-sm tracking-wide uppercase leading-tight truncate">
                {student.name}
              </h3>
              <p className="text-[11px] text-slate-300 leading-tight">
                {matricula.academicYear} · {matricula.grade} — {matricula.className} · {matricula.numeroMatricula}
              </p>
            </div>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-white p-1 cursor-pointer shrink-0">
            <span className="material-symbols-outlined text-[20px]">close</span>
          </button>
        </div>

        <div className="flex border-b border-slate-200 bg-slate-50">
          {(
            [
              { key: 'financeiro', label: 'Relatório Financeiro', icon: 'payments' },
              { key: 'academico', label: 'Relatório Académico', icon: 'school' }
            ] as const
          ).map((t) => (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              className={`flex items-center gap-1.5 px-4 py-2.5 text-[11px] font-bold uppercase tracking-wide cursor-pointer border-b-2 ${
                tab === t.key
                  ? 'border-[#7a0c0c] text-[#0b1f3a]'
                  : 'border-transparent text-slate-500 hover:text-slate-700'
              }`}
            >
              <span className="material-symbols-outlined text-[16px]">{t.icon}</span>
              {t.label}
            </button>
          ))}
        </div>

        <div className="p-6 overflow-y-auto text-xs bg-white space-y-5">
          {tab === 'financeiro' && (
            <>
              {financeiro.taxaMatricula && (
                <div>
                  <SectionTitle icon="how_to_reg">Taxa de Matrícula</SectionTitle>
                  <div className="flex items-center justify-between px-2.5 py-1.5 text-[11px] border border-slate-200">
                    <span className="text-slate-700">{financeiro.taxaMatricula.label}</span>
                    <div className="flex items-center gap-2 shrink-0">
                      <span
                        className={`px-1.5 py-0.5 border text-[9px] font-bold uppercase ${
                          financeiro.taxaMatricula.paga
                            ? 'bg-emerald-50 text-emerald-800 border-emerald-300'
                            : 'bg-amber-50 text-amber-800 border-amber-300'
                        }`}
                      >
                        {financeiro.taxaMatricula.paga ? 'Paga' : 'Por Pagar'}
                      </span>
                      <span className="font-mono text-slate-800">{formatKz(financeiro.taxaMatricula.totalKz)}</span>
                    </div>
                  </div>
                </div>
              )}

              <div className="grid sm:grid-cols-2 gap-4">
                <div>
                  <SectionTitle icon="check_circle">
                    Meses Pagos ({financeiro.mesesPagos.length}) — {formatKz(financeiro.totalMesesPagosKz)}
                  </SectionTitle>
                  <LineList lines={financeiro.mesesPagos} emptyLabel="Nenhum mês de propina pago registado." />
                </div>
                <div>
                  <SectionTitle icon="pending">
                    Não Pagos ({financeiro.mesesNaoPagos.length}) — {formatKz(financeiro.totalMesesNaoPagosKz)}
                  </SectionTitle>
                  <LineList lines={financeiro.mesesNaoPagos} emptyLabel="Nenhum mês de propina em aberto." />
                </div>
              </div>

              <div className="grid sm:grid-cols-2 gap-4">
                <div>
                  <SectionTitle icon="check_circle">
                    Multas Pagas ({financeiro.multasPagas.length}) — {formatKz(financeiro.totalMultasPagasKz)}
                  </SectionTitle>
                  <LineList lines={financeiro.multasPagas} emptyLabel="Nenhuma multa paga registada." />
                </div>
                <div>
                  <SectionTitle icon="pending">
                    Não Pagas ({financeiro.multasNaoPagas.length}) — {formatKz(financeiro.totalMultasNaoPagasKz)}
                  </SectionTitle>
                  <LineList lines={financeiro.multasNaoPagas} emptyLabel="Nenhuma multa em aberto." />
                </div>
              </div>

              <div className="grid sm:grid-cols-2 gap-4">
                <div>
                  <SectionTitle icon="check_circle">
                    Serviços Pagos ({financeiro.outrosPagos.length}) — {formatKz(financeiro.totalOutrosPagosKz)}
                  </SectionTitle>
                  <LineList lines={financeiro.outrosPagos} emptyLabel="Nenhum outro serviço/emolumento pago registado." />
                </div>
                <div>
                  <SectionTitle icon="pending">
                    Não Pagos ({financeiro.outrosNaoPagos.length}) — {formatKz(financeiro.totalOutrosNaoPagosKz)}
                  </SectionTitle>
                  <LineList lines={financeiro.outrosNaoPagos} emptyLabel="Nenhum outro serviço/emolumento em aberto." />
                </div>
              </div>

              <div className="border-t border-slate-200 pt-3 text-[11px] text-slate-500">
                {financeiro.numeroFaturasEmitidas} {financeiro.numeroFaturasEmitidas === 1 ? 'fatura emitida' : 'faturas emitidas'} neste ano lectivo.
              </div>
            </>
          )}

          {tab === 'academico' && (
            <>
              <div className="flex items-center justify-between border border-slate-200 px-3 py-2">
                <span className="text-[11px] font-bold uppercase tracking-wide text-slate-600">Situação Geral do Ano</span>
                <span
                  className={`px-2 py-0.5 border text-[10px] font-bold uppercase ${
                    SITUACAO_STYLES[academico.situacaoGeral] || 'bg-slate-100 text-slate-600 border-slate-300'
                  }`}
                >
                  {academico.situacaoGeral}
                </span>
              </div>

              <div>
                <SectionTitle icon="menu_book">Disciplinas e Notas por Trimestre</SectionTitle>
                {academico.disciplinas.length === 0 ? (
                  <div className="text-[11px] text-slate-400 italic py-1">Nenhuma nota lançada para este aluno neste ano.</div>
                ) : (
                  <div className="overflow-x-auto border border-slate-200">
                    <table className="w-full text-[10px]">
                      <thead className="bg-slate-50 text-slate-500 uppercase">
                        <tr>
                          <th className="text-left px-2 py-1.5">Disciplina</th>
                          <th className="text-center px-1 py-1.5">MT1</th>
                          <th className="text-center px-1 py-1.5">MT2</th>
                          <th className="text-center px-1 py-1.5">MT3</th>
                          <th className="text-center px-1 py-1.5">MFD</th>
                          <th className="text-left px-2 py-1.5">Situação</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {academico.disciplinas.map((d, i) => (
                          <tr key={i}>
                            <td className="px-2 py-1.5 text-slate-800">{d.subjectName}</td>
                            <td className="text-center px-1 py-1.5 font-mono">{d.mt1}</td>
                            <td className="text-center px-1 py-1.5 font-mono">{d.mt2}</td>
                            <td className="text-center px-1 py-1.5 font-mono">{d.mt3}</td>
                            <td className="text-center px-1 py-1.5 font-mono font-bold">{d.mfd}</td>
                            <td className="px-2 py-1.5">
                              <span
                                className={`px-1.5 py-0.5 border text-[9px] font-bold uppercase ${
                                  SITUACAO_STYLES[d.situation] || 'bg-slate-100 text-slate-600 border-slate-300'
                                }`}
                              >
                                {d.situation}
                              </span>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>

              <div>
                <SectionTitle icon="fact_check">Assiduidade por Disciplina</SectionTitle>
                {academico.assiduidade.length === 0 ? (
                  <div className="text-[11px] text-slate-400 italic py-1">Nenhuma caderneta de presenças registada para esta turma.</div>
                ) : (
                  <div className="overflow-x-auto border border-slate-200">
                    <table className="w-full text-[10px]">
                      <thead className="bg-slate-50 text-slate-500 uppercase">
                        <tr>
                          <th className="text-left px-2 py-1.5">Disciplina</th>
                          <th className="text-left px-2 py-1.5">Professor</th>
                          <th className="text-center px-1 py-1.5">Presenças</th>
                          <th className="text-center px-1 py-1.5">F. Justif.</th>
                          <th className="text-center px-1 py-1.5">F. Injustif.</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {academico.assiduidade.map((a) => (
                          <tr key={a.subjectId}>
                            <td className="px-2 py-1.5 text-slate-800">{a.subjectName}</td>
                            <td className="px-2 py-1.5 text-slate-600">{a.teacherName || '—'}</td>
                            <td className="text-center px-1 py-1.5 font-mono">{a.presencas}</td>
                            <td className="text-center px-1 py-1.5 font-mono text-amber-700">{a.faltasJustificadas}</td>
                            <td className="text-center px-1 py-1.5 font-mono text-red-700">{a.faltasInjustificadas}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>

              <div>
                <SectionTitle icon="gpp_maybe">Incidentes Disciplinares</SectionTitle>
                {academico.incidentes.length === 0 ? (
                  <div className="text-[11px] text-slate-400 italic py-1">Nenhum incidente disciplinar registado neste ano.</div>
                ) : (
                  <div className="border border-slate-200 divide-y divide-slate-100">
                    {academico.incidentes.map((inc) => (
                      <div key={inc.id} className="px-2.5 py-2 flex items-start justify-between gap-2 text-[11px]">
                        <div className="min-w-0">
                          <div className="font-semibold text-slate-800">
                            {inc.category === 'outro' ? inc.categoryOther || 'Outro' : INCIDENT_CATEGORY_LABELS[inc.category]}
                          </div>
                          <div className="text-[10px] text-slate-500">{inc.code} · {inc.date}</div>
                        </div>
                        <div className="flex items-center gap-1.5 shrink-0">
                          <span className={`px-1.5 py-0.5 text-[9px] font-bold uppercase rounded-sm ${INCIDENT_SEVERITY_META[inc.severity].badge}`}>
                            {INCIDENT_SEVERITY_META[inc.severity].label}
                          </span>
                          <span className={`px-1.5 py-0.5 text-[9px] font-bold uppercase rounded-sm ${INCIDENT_STATUS_META[inc.status].badge}`}>
                            {INCIDENT_STATUS_META[inc.status].label}
                          </span>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <div className="border-t border-slate-200 pt-3 text-[11px] text-slate-500">
                {academico.numeroFaturasEmitidas} {academico.numeroFaturasEmitidas === 1 ? 'fatura emitida' : 'faturas emitidas'} neste ano lectivo.
              </div>
            </>
          )}
        </div>

        <div className="px-6 py-3 bg-slate-50 border-t border-slate-200 flex justify-end">
          <button
            onClick={onClose}
            className="px-4 py-2 bg-white hover:bg-slate-100 text-slate-700 font-bold text-[11px] uppercase tracking-wide cursor-pointer border border-slate-300"
          >
            Fechar
          </button>
        </div>
      </div>
    </div>
  );
};
