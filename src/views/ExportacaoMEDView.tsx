import React, { useMemo, useState } from 'react';
import { SchoolDatabase, UserRole } from '../types';
import { getFallbackAcademicYear } from '../utils/academicYear';
import { dbService } from '../services/db';
import {
  MedPeriod,
  buildMedExportData,
  exportMedWorkbookXlsx,
  medFileCode,
  medPeriodLabel
} from '../utils/medExport';
import { TablePagination, usePagedList } from '../components/TablePagination';
import { MedValidationPanel } from '../components/MedValidationPanel';
import { AppConfirmModal } from '../components/AppConfirmModal';
import { validateMedData } from '../utils/medValidator';

interface ExportacaoMEDViewProps {
  db: SchoolDatabase;
  currentUserRole: UserRole;
}

interface SubmissionRecord {
  id: string;
  code: string;
  period: string;
  academicYear: string;
  generatedAt: string;
  status: 'gerado' | 'enviado';
}

type SheetId = 'identificacao' | 'matricula' | 'aproveitamento' | 'docentes';

const SHEETS: Array<{ id: SheetId; label: string; icon: string }> = [
  { id: 'identificacao', label: 'Planilha 1', icon: 'apartment' },
  { id: 'matricula', label: 'Planilha 2', icon: 'groups' },
  { id: 'aproveitamento', label: 'Planilha 3', icon: 'insights' },
  { id: 'docentes', label: 'Planilha 4', icon: 'co_present' }
];

function Badge({ tone, children }: { tone: string; children: React.ReactNode }) {
  return <span className={`px-2 py-0.5 rounded text-[10px] font-bold whitespace-nowrap ${tone}`}>{children}</span>;
}

function KpiGrid({ items }: { items: Array<{ label: string; value: React.ReactNode; icon: string }> }) {
  return (
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
      {items.map((k) => (
        <div key={k.label} className="bg-white border border-slate-200 rounded-2xl p-4 flex items-center gap-3">
          <div className="w-10 h-10 flex items-center justify-center rounded-lg shrink-0 bg-slate-100 text-[#0b1f3a]">
            <span className="material-symbols-outlined text-[22px]">{k.icon}</span>
          </div>
          <div className="min-w-0">
            <div className="font-mono text-xl font-extrabold text-[#0b1f3a] leading-none truncate">{k.value}</div>
            <div className="text-[11px] text-slate-500 font-semibold mt-1">{k.label}</div>
          </div>
        </div>
      ))}
    </div>
  );
}

const TH = 'py-2.5 px-3 text-white whitespace-nowrap';
const TD = 'py-2.5 px-3 text-slate-700 whitespace-nowrap';
const TD_NUM = 'py-2.5 px-3 font-mono text-slate-700 text-center';
const THEAD = 'bg-[#0b1f3a] text-white font-bold uppercase text-[10px] tracking-wider border-b border-slate-800';

export const ExportacaoMEDView: React.FC<ExportacaoMEDViewProps> = ({ db }) => {
  const academicYear = db.settings?.currentAcademicYear || getFallbackAcademicYear();
  const [period, setPeriod] = useState<MedPeriod>('anual');
  const [activeSheet, setActiveSheet] = useState<SheetId>('identificacao');
  const [history, setHistory] = useState<SubmissionRecord[]>([]);
  const { page: pgHistory, setPage: setPgHistory, pageItems: visibleHistory } = usePagedList(history, [history.length]);
  const [exporting, setExporting] = useState(false);
  const [confirmForce, setConfirmForce] = useState(false);

  // ---------------------------------------------------------------------
  // Dados das QUATRO folhas do modelo oficial do MED/GEPE, calculados a partir
  // da mesma base de dados dos Relatórios de Aproveitamento (a folha 3 usa a
  // mesma função `computeClassStats`), apenas agregados no layout de submissão
  // oficial: COUNT por classe/idade/género e GROUP BY classe/curso/turno.
  // ---------------------------------------------------------------------
  const medData = useMemo(() => buildMedExportData(db, period), [db, period]);
  const { page: pgIdentificacao, setPage: setPgIdentificacao, pageItems: visibleIdentificacao } = usePagedList(medData.identificacao, [medData.identificacao.length]);
  const { page: pgMatriculaInicial, setPage: setPgMatriculaInicial, pageItems: visibleMatriculaInicial } = usePagedList(medData.matriculaInicial, [medData.matriculaInicial.length]);
  const { page: pgAproveitamento, setPage: setPgAproveitamento, pageItems: visibleAproveitamento } = usePagedList(medData.aproveitamento, [medData.aproveitamento.length]);
  const { page: pgCorpoDocente, setPage: setPgCorpoDocente, pageItems: visibleCorpoDocente } = usePagedList(medData.corpoDocente, [medData.corpoDocente.length]);

  const totals = useMemo(() => {
    const matriculados = medData.matriculaInicial.reduce((acc, r) => acc + r.inscritosM + r.inscritosF, 0);
    const avaliados = medData.aproveitamento.reduce((acc, r) => acc + r.avalM + r.avalF, 0);
    const aprovados = medData.aproveitamento.reduce((acc, r) => acc + r.aprovM + r.aprovF, 0);
    const taxa = avaliados > 0 ? Math.round((aprovados / avaliados) * 1000) / 10 : null;
    return { matriculados, docentes: medData.corpoDocente.length, taxa };
  }, [medData]);

  const missingFields = useMemo(
    () => medData.identificacao.filter((r) => !r.valor).map((r) => r.campo),
    [medData]
  );

  const periodLabel = medPeriodLabel(period);

  // Validação ANTES de exportar (utils/medValidator.ts).
  const validation = useMemo(() => validateMedData(db, period, medData), [db, period, medData]);

  const handleExportClick = () => {
    if (validation.errors > 0) setConfirmForce(true);
    else void handleGerarMapa();
  };

  const handleGerarMapa = async () => {
    setConfirmForce(false);
    setExporting(true);
    try {
      const code = medFileCode(academicYear, period);
      await exportMedWorkbookXlsx(medData, `${code}.xlsx`);

      dbService.addAuditLog({
        userName: dbService.getDatabase().currentUser?.name || 'Utilizador',
        userRole: dbService.getDatabase().currentUser?.roleTitle || '—',
        action: 'Exportação de Estatísticas ao MED (GEPE)',
        details: `Ficheiro ${code}.xlsx gerado com as 4 folhas oficiais (Identificação, Matrícula Inicial, Aproveitamento ${periodLabel}, Corpo Docente).`,
        module: 'sistema',
        timestamp: 'Agora mesmo',
        badgeColor: '#0b1f3a'
      });

      setHistory((prev) => [
        { id: code, code, period: periodLabel, academicYear, generatedAt: new Date().toISOString(), status: 'gerado' },
        ...prev
      ]);
    } finally {
      setExporting(false);
    }
  };

  const handleMarkSent = (id: string) => {
    setHistory((prev) => prev.map((h) => (h.id === id ? { ...h, status: 'enviado' } : h)));
  };

  return (
    <div className="flex flex-col w-full gap-6 pb-12">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <span className="text-[11px] font-bold uppercase tracking-widest text-slate-500">RELATÓRIOS</span>
            <span className="w-1.5 h-1.5 rounded-full bg-[#0b1f3a]" />
            <span className="text-xs font-semibold text-[#0b1f3a]">AUDITORIA ESCOLAR</span>
          </div>
          <h1 className="font-headline text-2xl lg:text-3xl font-extrabold text-[#0b1f3a] tracking-tight">EXPORTAÇÃO DE ESTATÍSTICA PARA O MED</h1>
        </div>
        <div className="flex items-center gap-2">
          <select
            value={period}
            onChange={(e) => setPeriod(e.target.value as MedPeriod)}
            className="h-10 px-3 bg-white border border-slate-300 text-slate-800 text-xs rounded-lg focus:border-[#0b1f3a] focus:outline-none"
          >
            <option value="1">1.º Trimestre</option>
            <option value="2">2.º Trimestre</option>
            <option value="3">3.º Trimestre</option>
            <option value="anual">Fim do Ano Letivo</option>
          </select>
          <button
            onClick={handleExportClick}
            disabled={exporting}
            className="h-10 px-4 bg-[#0b1f3a] text-white text-xs font-bold uppercase tracking-wide rounded-lg flex items-center gap-2 hover:bg-[#132a4d] disabled:opacity-60"
          >
            <span className="material-symbols-outlined text-[18px]">file_download</span>
            {exporting ? 'A Exportar...' : 'EXPORTAR'}
          </button>
        </div>
      </div>

      {missingFields.length > 0 && (
        <div className="bg-red-50 border border-red-200 rounded-xl p-3 flex items-start gap-2 text-red-800">
          <span className="material-symbols-outlined text-[18px] mt-0.5">warning</span>
          <p className="text-[11px] leading-relaxed">
            <strong>Identificação incompleta para o GEPE:</strong> faltam os campos{' '}
            <span className="font-mono">{missingFields.join(', ')}</span>. Preencha-os em{' '}
            <strong>Configurações → 1. Dados da Instituição</strong> antes de submeter ao MED.
          </p>
        </div>
      )}

      <MedValidationPanel result={validation} fileLabel={`${academicYear.replace(/\//g, '-')}-${period}`} />

      <KpiGrid
        items={[
          { label: 'Ano Letivo', value: academicYear, icon: 'calendar_today' },
          { label: 'Alunos Inscritos (Folha 2)', value: totals.matriculados, icon: 'groups' },
          { label: 'Docentes (Folha 4)', value: totals.docentes, icon: 'co_present' },
          { label: 'Taxa de Aproveitamento', value: totals.taxa !== null ? `${totals.taxa}%` : '—', icon: 'insights' }
        ]}
      />

      {/* Pré-visualização das 4 folhas do ficheiro */}
      <div className="bg-white border border-slate-200 rounded-2xl overflow-hidden">
        <div className="p-4 border-b border-slate-100 flex flex-col lg:flex-row lg:items-center justify-between gap-3">
          <div>
            <h3 className="font-headline text-sm font-bold text-[#0b1f3a]">Pré-visualização - {periodLabel}</h3>
          </div>
          <div className="flex flex-wrap items-center gap-1.5">
            {SHEETS.map((s) => (
              <button
                key={s.id}
                type="button"
                onClick={() => setActiveSheet(s.id)}
                className={`px-3 py-1.5 rounded-lg text-[11px] font-bold flex items-center gap-1.5 transition-colors cursor-pointer ${
                  activeSheet === s.id ? 'bg-[#0b1f3a] text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                }`}
              >
                <span className="material-symbols-outlined text-[14px]">{s.icon}</span>
                {s.label}
              </button>
            ))}
          </div>
        </div>

        <div className="overflow-x-auto max-h-[480px] overflow-y-auto">
          {activeSheet === 'identificacao' && (
            <><table className="w-full text-left text-xs">
              <thead className="sticky top-0 z-10">
                <tr className={THEAD}>
                  <th className={TH}>Nome do Campo / Coluna</th>
                  <th className={TH}>Tipo de Dado</th>
                  <th className={TH}>Descrição / Formato</th>
                  <th className={TH}>Valor da Instituição</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {visibleIdentificacao.map((r) => (
                  <tr key={r.campo} className="hover:bg-slate-50 transition-colors">
                    <td className={`${TD} font-mono font-bold text-[#0b1f3a]`}>{r.campo}</td>
                    <td className={TD}>{r.tipo}</td>
                    <td className={`${TD} whitespace-normal`}>{r.descricao}</td>
                    <td className={TD}>
                      {r.valor ? (
                        <span className="font-semibold text-slate-900">{r.valor}</span>
                      ) : (
                        <Badge tone="bg-red-50 text-red-700">Em falta</Badge>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table><TablePagination total={medData.identificacao.length} page={pgIdentificacao} onPageChange={setPgIdentificacao} /></>
          )}

          {activeSheet === 'matricula' && (
            <><table className="w-full text-left text-xs">
              <thead className="sticky top-0 z-10">
                <tr className={THEAD}>
                  <th className={TH}>Ano Letivo</th>
                  <th className={TH}>Nível de Ensino</th>
                  <th className={TH}>Classe</th>
                  <th className={TH}>Turno</th>
                  <th className={TH}>Idade</th>
                  <th className={`${TH} text-center`}>Inscritos Masculinos</th>
                  <th className={`${TH} text-center`}>Inscritos Femininos</th>
                  <th className={`${TH} text-center`}>Total Alunos</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {medData.matriculaInicial.length === 0 && (
                  <tr>
                    <td colSpan={8} className="py-10 text-center text-slate-400 text-xs">
                      Nenhum aluno com turma atribuída neste ano letivo.
                    </td>
                  </tr>
                )}
                {visibleMatriculaInicial.map((r, i) => (
                  <tr key={i} className="hover:bg-slate-50 transition-colors">
                    <td className={TD}>{r.anoLetivo}</td>
                    <td className={TD}>{r.nivelEnsino}</td>
                    <td className={`${TD} font-semibold text-slate-900`}>{r.classe}</td>
                    <td className={TD}>{r.turno}</td>
                    <td className={TD}>{r.idade}</td>
                    <td className={TD_NUM}>{r.inscritosM}</td>
                    <td className={TD_NUM}>{r.inscritosF}</td>
                    <td className={`${TD_NUM} font-bold text-slate-900`}>{r.inscritosM + r.inscritosF}</td>
                  </tr>
                ))}
              </tbody>
            </table><TablePagination total={medData.matriculaInicial.length} page={pgMatriculaInicial} onPageChange={setPgMatriculaInicial} /></>
          )}

          {activeSheet === 'aproveitamento' && (
            <><table className="w-full text-left text-xs">
              <thead className="sticky top-0 z-10">
                <tr className={THEAD}>
                  <th className={TH}>Classe</th>
                  <th className={TH}>Curso / Área</th>
                  <th className={TH}>Turno</th>
                  <th className={`${TH} text-center`}>Aval_M</th>
                  <th className={`${TH} text-center`}>Aval_F</th>
                  <th className={`${TH} text-center`}>Aprov_M</th>
                  <th className={`${TH} text-center`}>Aprov_F</th>
                  <th className={`${TH} text-center`}>Reprov_M</th>
                  <th className={`${TH} text-center`}>Reprov_F</th>
                  <th className={`${TH} text-center`}>Desist_M</th>
                  <th className={`${TH} text-center`}>Desist_F</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {medData.aproveitamento.length === 0 && (
                  <tr>
                    <td colSpan={11} className="py-10 text-center text-slate-400 text-xs">
                      Nenhuma turma registada neste ano letivo.
                    </td>
                  </tr>
                )}
                {visibleAproveitamento.map((r, i) => (
                  <tr key={i} className="hover:bg-slate-50 transition-colors">
                    <td className={`${TD} font-semibold text-slate-900`}>{r.classe}</td>
                    <td className={TD}>{r.curso}</td>
                    <td className={TD}>{r.turno}</td>
                    <td className={TD_NUM}>{r.avalM}</td>
                    <td className={TD_NUM}>{r.avalF}</td>
                    <td className={`${TD_NUM} text-emerald-700 font-bold`}>{r.aprovM}</td>
                    <td className={`${TD_NUM} text-emerald-700 font-bold`}>{r.aprovF}</td>
                    <td className={`${TD_NUM} text-red-700`}>{r.reprovM}</td>
                    <td className={`${TD_NUM} text-red-700`}>{r.reprovF}</td>
                    <td className={`${TD_NUM} text-amber-700`}>{r.desistM}</td>
                    <td className={`${TD_NUM} text-amber-700`}>{r.desistF}</td>
                  </tr>
                ))}
              </tbody>
            </table><TablePagination total={medData.aproveitamento.length} page={pgAproveitamento} onPageChange={setPgAproveitamento} /></>
          )}

          {activeSheet === 'docentes' && (
            <><table className="w-full text-left text-xs">
              <thead className="sticky top-0 z-10">
                <tr className={THEAD}>
                  <th className={TH}>Nº Agente / ID</th>
                  <th className={TH}>Nome do Professor</th>
                  <th className={`${TH} text-center`}>Género</th>
                  <th className={TH}>Habilitações Literárias</th>
                  <th className={TH}>Especialidade</th>
                  <th className={TH}>Vínculo</th>
                  <th className={`${TH} text-center`}>Nº de Turmas</th>
                  <th className={TH}>Estatuto</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {medData.corpoDocente.length === 0 && (
                  <tr>
                    <td colSpan={8} className="py-10 text-center text-slate-400 text-xs">
                      Nenhum docente registado.
                    </td>
                  </tr>
                )}
                {visibleCorpoDocente.map((r, i) => (
                  <tr key={i} className="hover:bg-slate-50 transition-colors">
                    <td className={`${TD} font-mono`}>{r.numAgente}</td>
                    <td className={`${TD} font-semibold text-slate-900`}>{r.nome}</td>
                    <td className={TD_NUM}>{r.genero}</td>
                    <td className={TD}>{r.habilitacoes || '—'}</td>
                    <td className={TD}>{r.especialidade || '—'}</td>
                    <td className={TD}>{r.vinculo}</td>
                    <td className={TD_NUM}>{r.numTurmas}</td>
                    <td className={TD}>
                      <Badge tone={r.estatuto === 'Ativo' ? 'bg-emerald-50 text-emerald-700' : 'bg-amber-50 text-amber-700'}>
                        {r.estatuto}
                      </Badge>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table><TablePagination total={medData.corpoDocente.length} page={pgCorpoDocente} onPageChange={setPgCorpoDocente} /></>
          )}
        </div>
      </div>

      <div className="bg-white border border-slate-200 rounded-2xl overflow-hidden">
        <div className="p-4 border-b border-slate-100">
          <h3 className="font-headline text-sm font-bold text-[#0b1f3a]">Histórico de Submissões ao MED</h3>
          <p className="text-[11px] text-slate-500 mt-0.5">Ficheiros gerados nesta sessão, com estado de envio ao Ministério da Educação.</p>
        </div>
        {history.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12 text-slate-400 gap-2">
            <span className="material-symbols-outlined text-[36px]">history</span>
            <p className="text-xs font-semibold">Ainda nenhum ficheiro foi gerado.</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead>
                <tr className={THEAD}>
                  <th className={TH}>Código</th>
                  <th className={TH}>Período</th>
                  <th className={TH}>Ano Letivo</th>
                  <th className={TH}>Gerado em</th>
                  <th className={TH}>Estado</th>
                  <th className={`${TH} text-right`}>Ações</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {visibleHistory.map((h) => (
                  <tr key={h.id} className="hover:bg-slate-50 transition-colors">
                    <td className="py-3 px-3 font-mono text-slate-500">{h.code}</td>
                    <td className={TD}>{h.period}</td>
                    <td className={TD}>{h.academicYear}</td>
                    <td className={TD}>{new Date(h.generatedAt).toLocaleString('pt-PT')}</td>
                    <td className="py-2.5 px-3">
                      <Badge tone={h.status === 'enviado' ? 'bg-emerald-50 text-emerald-700' : 'bg-amber-50 text-amber-700'}>
                        {h.status === 'enviado' ? 'Enviado ao MED' : 'Gerado'}
                      </Badge>
                    </td>
                    <td className="py-2.5 px-3 text-right">
                      {h.status !== 'enviado' && (
                        <button
                          onClick={() => handleMarkSent(h.id)}
                          className="px-3 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold text-[11px] rounded-lg"
                        >
                          Marcar como Enviado
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <TablePagination total={history.length} page={pgHistory} onPageChange={setPgHistory} />
          </div>
        )}
      </div>

      <AppConfirmModal
        isOpen={confirmForce}
        title="Exportar com erros?"
        message={`Há ${validation.errors} erro(s) nos dados. O GEPE pode recusar o ficheiro. Corrija-os primeiro, ou exporte mesmo assim.`}
        variant="warning"
        confirmLabel="Exportar mesmo assim"
        onConfirm={() => void handleGerarMapa()}
        onCancel={() => setConfirmForce(false)}
      />
    </div>
  );
};
