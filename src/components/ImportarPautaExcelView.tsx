import React, { useMemo, useRef, useState } from 'react';
import { SchoolDatabase, UserRole } from '../types';
import { StudentMiniPautaItem } from '../types/pauta';
import { dbService } from '../services/db';
import { getStudentsForClass } from '../utils/classStudentsRoster';
import {
  FIELD_DEFINITIONS,
  autoDetectMapping,
  buildImportRows,
  downloadTemplateForClass,
  downloadValidationReport,
  findMissingStudents,
  mergeImportIntoMiniPauta,
  missingRequiredFields,
  readSpreadsheet,
  type ColumnMapping,
  type FieldKey,
  type ImportRow,
  type ParsedWorkbook,
  type TrimesterKey
} from '../utils/pautaExcelImport';
import { TablePagination, usePagedList } from './TablePagination';
import { Notice } from './Notice';

interface ImportarPautaExcelViewProps {
  db: SchoolDatabase;
  currentUserRole: UserRole;
  onBackToPautas: () => void;
  onNavigateToHomologacao?: () => void;
}

type FilterKey = 'all' | 'valid' | 'warning' | 'error';

const CAN_IMPORT: UserRole[] = ['admin', 'director', 'secretaria', 'professor'];

export const ImportarPautaExcelView: React.FC<ImportarPautaExcelViewProps> = ({
  db,
  currentUserRole,
  onBackToPautas,
  onNavigateToHomologacao
}) => {
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const [selectedClassId, setSelectedClassId] = useState<string>('');
  const [selectedSubjectId, setSelectedSubjectId] = useState<string>('');
  const [trimester, setTrimester] = useState<TrimesterKey>(1);

  const [workbook, setWorkbook] = useState<ParsedWorkbook | null>(null);
  const [sheetIndex, setSheetIndex] = useState<number>(0);
  const [mapping, setMapping] = useState<ColumnMapping>({});
  const [parseError, setParseError] = useState<string | null>(null);
  const [isParsing, setIsParsing] = useState(false);

  const [activeFilter, setActiveFilter] = useState<FilterKey>('all');
  const [isLegalConfirmed, setIsLegalConfirmed] = useState(false);
  const [commitResult, setCommitResult] = useState<string | null>(null);
  const [isCommitting, setIsCommitting] = useState(false);

  const canImport = CAN_IMPORT.includes(currentUserRole);

  const classes = db.classes || [];
  const subjects = db.subjects || [];

  const activeClass = classes.find((c) => String(c.id) === String(selectedClassId));
  const activeSubject = subjects.find((s) => String(s.id) === String(selectedSubjectId));

  const classStudents = useMemo(
    () => (selectedClassId ? getStudentsForClass(selectedClassId, db.students || [], activeClass?.name) : []),
    [selectedClassId, db.students, activeClass?.name]
  );

  const sheet = workbook?.sheets[sheetIndex] || null;

  const rows: ImportRow[] = useMemo(() => {
    if (!sheet || classStudents.length === 0) return [];
    if (missingRequiredFields(mapping).length > 0) return [];
    return buildImportRows(sheet, mapping, classStudents);
  }, [sheet, mapping, classStudents]);

  const missingStudents = useMemo(
    () => (rows.length > 0 ? findMissingStudents(rows, classStudents) : []),
    [rows, classStudents]
  );

  const counts = useMemo(
    () => ({
      total: rows.length,
      valid: rows.filter((r) => r.status === 'valid').length,
      warning: rows.filter((r) => r.status === 'warning').length,
      error: rows.filter((r) => r.status === 'error').length
    }),
    [rows]
  );

  const filteredRows = rows.filter((r) => (activeFilter === 'all' ? true : r.status === activeFilter));
  const { page: pgFilteredRows, setPage: setPgFilteredRows, pageItems: visibleFilteredRows } = usePagedList(filteredRows, [filteredRows.length]);
  const requiredMissing = missingRequiredFields(mapping);
  const importableCount = counts.valid + counts.warning;

  const readyToCommit =
    canImport &&
    !!selectedClassId &&
    !!selectedSubjectId &&
    importableCount > 0 &&
    requiredMissing.length === 0 &&
    isLegalConfirmed;

  // -------------------------------------------------------------------------
  // Handlers
  // -------------------------------------------------------------------------

  const handleFileChosen = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setParseError(null);
    setCommitResult(null);
    setIsParsing(true);

    try {
      const parsed = await readSpreadsheet(file);
      if (parsed.sheets.length === 0) {
        setParseError('O ficheiro não contém nenhuma folha de cálculo legível.');
        setWorkbook(null);
        return;
      }
      const firstWithData = parsed.sheets.findIndex((s) => s.rows.length > 0);
      const index = firstWithData >= 0 ? firstWithData : 0;

      setWorkbook(parsed);
      setSheetIndex(index);
      setMapping(autoDetectMapping(parsed.sheets[index].headers));
      setIsLegalConfirmed(false);
    } catch (err: any) {
      console.error('Erro ao ler o ficheiro:', err);
      setParseError(
        'Não foi possível ler este ficheiro. Confirme que é um .xlsx, .xls ou .csv válido e que não está protegido por palavra-passe.'
      );
      setWorkbook(null);
    } finally {
      setIsParsing(false);
      // permite voltar a escolher o mesmo ficheiro depois de corrigido
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const handleSheetChange = (index: number) => {
    if (!workbook) return;
    setSheetIndex(index);
    setMapping(autoDetectMapping(workbook.sheets[index].headers));
    setIsLegalConfirmed(false);
  };

  const handleMappingChange = (field: FieldKey, value: string) => {
    setMapping((prev) => {
      const next = { ...prev };
      if (value === '') delete next[field];
      else next[field] = Number(value);
      return next;
    });
    setIsLegalConfirmed(false);
  };

  const handleCommit = async () => {
    if (!readyToCommit || !activeSubject) return;
    setIsCommitting(true);
    try {
      const existing = (dbService.getMiniPautaRows(selectedClassId, selectedSubjectId) ||
        []) as StudentMiniPautaItem[];

      const { rows: merged, applied } = mergeImportIntoMiniPauta(
        existing,
        classStudents,
        selectedSubjectId,
        rows,
        trimester
      );

      dbService.saveMiniPautaRows(
        selectedClassId,
        selectedSubjectId,
        merged,
        dbService.getCurrentUser()?.name
      );

      dbService.addAuditLog({
        userName: dbService.getCurrentUser()?.name || 'Utilizador',
        userRole: currentUserRole,
        action: 'Importação de Pauta',
        details:
          `Importadas ${applied} notas do ${trimester}.º trimestre para ${activeSubject.name} / ` +
          `${activeClass?.name || 'turma'} a partir do ficheiro "${workbook?.fileName}" ` +
          `(${counts.error} linhas rejeitadas).`,
        module: 'pedagogico',
        timestamp: 'Agora mesmo',
        badgeColor: '#0b1f3a'
      });

      setCommitResult(
        `${applied} ${applied === 1 ? 'nota lançada' : 'notas lançadas'} no ${trimester}.º trimestre. ` +
          (counts.error > 0 ? `${counts.error} linhas foram rejeitadas e não foram gravadas.` : '')
      );
    } catch (err: any) {
      console.error(err);
      setParseError('Ocorreu um erro ao gravar as notas: ' + (err?.message || 'erro desconhecido'));
    } finally {
      setIsCommitting(false);
    }
  };

  // -------------------------------------------------------------------------
  // Render
  // -------------------------------------------------------------------------

  const statusPill = (status: ImportRow['status']) => {
    const map = {
      valid: 'bg-emerald-50 text-emerald-700 border-emerald-200',
      warning: 'bg-amber-50 text-amber-800 border-amber-200',
      error: 'bg-red-50 text-red-700 border-red-200'
    } as const;
    const label = { valid: 'Válido', warning: 'Aviso', error: 'Erro' } as const;
    return (
      <span className={`inline-block px-2 py-0.5 rounded border text-[10px] font-bold ${map[status]}`}>
        {label[status]}
      </span>
    );
  };

  return (
    <div className="flex flex-col w-full gap-6 pb-12">
      {/* Cabeçalho */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2">
        <div className="flex items-center gap-1 text-xs font-semibold text-slate-400 uppercase tracking-wider flex-wrap">
          <button onClick={onBackToPautas} className="hover:underline text-slate-500">
            AVALIAÇÃO &amp; EXAMES
          </button>
          <span className="material-symbols-outlined text-[14px]">chevron_right</span>
          <span className="text-[#0b1f3a] font-bold">IMPORTAR PAUTA (EXCEL/CSV)</span>
        </div>
        <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded bg-slate-100 text-slate-600 text-xs">
          <span className="material-symbols-outlined text-[14px]">description</span>
          .xlsx • .xls • .csv
        </span>
      </div>

      <div className="bg-white rounded-2xl p-6 shadow-xs border border-slate-200">
        <div className="flex items-center gap-3">
          <div className="w-11 h-11 rounded-xl bg-[#0b1f3a] text-white flex items-center justify-center shrink-0">
            <span className="material-symbols-outlined text-[24px]">upload_file</span>
          </div>
          <div>
            <h1 className="font-headline text-2xl font-bold text-slate-900 tracking-tight">
              Importação de Notas a partir de Ficheiro
            </h1>
            <p className="text-xs text-slate-500 mt-0.5">
              O ficheiro é lido e validado linha a linha contra os alunos realmente matriculados na turma.
              A Média Trimestral é calculada com os coeficientes MAC 30% · NPP 30% · NPT 40%.
            </p>
          </div>
        </div>
      </div>

      {!canImport && (
        <Notice tone="warn">
          O seu perfil não tem permissão para importar pautas. Pode consultar o resultado da validação, mas
          não gravar notas.
        </Notice>
      )}

      {/* Passo 1 — turma, disciplina e trimestre */}
      <div className="bg-white rounded-xl p-5 shadow-xs border border-slate-200">
        <h2 className="font-headline text-sm font-bold text-slate-900 mb-3">
          1. Destino das notas
        </h2>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div>
            <label className="block text-[11px] uppercase font-bold tracking-wider text-slate-600 mb-1">Turma</label>
            <select
              value={selectedClassId}
              onChange={(e) => {
                setSelectedClassId(e.target.value);
                setIsLegalConfirmed(false);
              }}
              className="w-full px-3 py-2 rounded-lg bg-slate-100 text-sm focus:bg-white focus:ring-2 focus:ring-[#0b1f3a] outline-none"
            >
              <option value="">Selecione a turma...</option>
              {classes.map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
            {classes.length === 0 && (
              <p className="text-[11px] text-amber-700 mt-1">Ainda não existem turmas criadas.</p>
            )}
          </div>

          <div>
            <label className="block text-[11px] uppercase font-bold tracking-wider text-slate-600 mb-1">Disciplina</label>
            <select
              value={selectedSubjectId}
              onChange={(e) => {
                setSelectedSubjectId(e.target.value);
                setIsLegalConfirmed(false);
              }}
              className="w-full px-3 py-2 rounded-lg bg-slate-100 text-sm focus:bg-white focus:ring-2 focus:ring-[#0b1f3a] outline-none"
            >
              <option value="">Selecione a disciplina...</option>
              {subjects.map((s) => (
                <option key={s.id} value={s.id}>{s.name}</option>
              ))}
            </select>
            {subjects.length === 0 && (
              <p className="text-[11px] text-amber-700 mt-1">Ainda não existem disciplinas configuradas.</p>
            )}
          </div>

          <div>
            <label className="block text-[11px] uppercase font-bold tracking-wider text-slate-600 mb-1">Trimestre</label>
            <select
              value={trimester}
              onChange={(e) => {
                setTrimester(Number(e.target.value) as TrimesterKey);
                setIsLegalConfirmed(false);
              }}
              className="w-full px-3 py-2 rounded-lg bg-slate-100 text-sm focus:bg-white focus:ring-2 focus:ring-[#0b1f3a] outline-none"
            >
              <option value={1}>I Trimestre</option>
              <option value={2}>II Trimestre</option>
              <option value={3}>III Trimestre</option>
            </select>
          </div>
        </div>

        {selectedClassId && (
          <p className="text-[11px] text-slate-500 mt-3">
            {classStudents.length === 0
              ? 'Esta turma ainda não tem alunos matriculados — matricule os alunos antes de importar notas.'
              : `${classStudents.length} ${classStudents.length === 1 ? 'aluno matriculado' : 'alunos matriculados'} nesta turma.`}
          </p>
        )}

        {selectedClassId && classStudents.length > 0 && (
          <button
            type="button"
            onClick={() =>
              void downloadTemplateForClass(classStudents, activeClass?.name || 'Turma', activeSubject?.name || 'Disciplina')
            }
            className="mt-3 inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold text-xs"
          >
            <span className="material-symbols-outlined text-[16px]">table_view</span>
            Descarregar modelo com os alunos desta turma
          </button>
        )}
      </div>

      {/* Passo 2 — ficheiro */}
      <div className="bg-white rounded-xl p-5 shadow-xs border border-slate-200">
        <h2 className="font-headline text-sm font-bold text-slate-900 mb-3">2. Ficheiro de notas</h2>

        <input
          ref={fileInputRef}
          type="file"
          accept=".xlsx,.xls,.csv"
          onChange={handleFileChosen}
          className="hidden"
        />

        <button
          type="button"
          disabled={!selectedClassId || classStudents.length === 0 || isParsing}
          onClick={() => fileInputRef.current?.click()}
          className="w-full border-2 border-dashed border-slate-300 rounded-xl p-8 text-center hover:border-[#0b1f3a] hover:bg-slate-50 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        >
          <span className="material-symbols-outlined text-[32px] text-slate-400 block">cloud_upload</span>
          <span className="block mt-2 text-sm font-bold text-slate-700">
            {isParsing ? 'A ler o ficheiro...' : 'Escolher ficheiro .xlsx, .xls ou .csv'}
          </span>
          <span className="block mt-1 text-[11px] text-slate-500">
            {!selectedClassId
              ? 'Selecione primeiro a turma de destino.'
              : classStudents.length === 0
              ? 'A turma selecionada não tem alunos matriculados.'
              : 'O ficheiro é processado no seu navegador; nada é enviado para servidores externos.'}
          </span>
        </button>

        {parseError && (
          <Notice tone="error">
            {parseError}
          </Notice>
        )}

        {workbook && sheet && (
          <div className="mt-4 flex flex-wrap items-center gap-3 text-xs">
            <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-emerald-50 border border-emerald-200 text-emerald-800 font-bold">
              <span className="material-symbols-outlined text-[16px]">description</span>
              {workbook.fileName} ({workbook.fileSizeLabel})
            </span>
            {workbook.sheets.length > 1 && (
              <label className="flex items-center gap-2 text-slate-600">
                Folha:
                <select
                  value={sheetIndex}
                  onChange={(e) => handleSheetChange(Number(e.target.value))}
                  className="px-2 py-1.5 rounded-lg bg-slate-100 text-xs"
                >
                  {workbook.sheets.map((s, i) => (
                    <option key={s.name} value={i}>
                      {s.name} ({s.rows.length} linhas)
                    </option>
                  ))}
                </select>
              </label>
            )}
            <span className="text-slate-500">
              Cabeçalho detetado na linha {sheet.headerRowIndex + 1} · {sheet.rows.length} linhas de dados
            </span>
          </div>
        )}
      </div>

      {/* Passo 3 — mapeamento */}
      {sheet && (
        <div className="bg-white rounded-xl p-5 shadow-xs border border-slate-200">
          <h2 className="font-headline text-sm font-bold text-slate-900 mb-1">3. Mapeamento de colunas</h2>
          <p className="text-[11px] text-slate-500 mb-3">
            As colunas foram associadas automaticamente a partir dos cabeçalhos do seu ficheiro. Corrija
            qualquer associação que esteja errada.
          </p>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {FIELD_DEFINITIONS.map((field) => (
              <div key={field.key}>
                <label className="block text-[11px] uppercase font-bold tracking-wider text-slate-600 mb-1">
                  {field.label}
                  {field.required && <span className="text-red-600 ml-1">*</span>}
                </label>
                <select
                  value={mapping[field.key] ?? ''}
                  onChange={(e) => handleMappingChange(field.key, e.target.value)}
                  className={`w-full px-3 py-2 rounded-lg text-sm outline-none ${
                    field.required && mapping[field.key] === undefined
                      ? 'bg-red-50 ring-1 ring-red-300'
                      : 'bg-slate-100'
                  }`}
                >
                  <option value="">— não usar —</option>
                  {sheet.headers.map((h, i) => (
                    <option key={`${h}-${i}`} value={i}>
                      {h || `Coluna ${i + 1}`}
                    </option>
                  ))}
                </select>
              </div>
            ))}
          </div>

          {requiredMissing.length > 0 && (
            <Notice tone="warn">
              Faltam campos obrigatórios: {requiredMissing.map((f) => f.label).join(', ')}. A pré-visualização
              só aparece depois de todos estarem associados.
            </Notice>
          )}
        </div>
      )}

      {/* Passo 4 — validação */}
      {rows.length > 0 && (
        <div className="bg-white rounded-xl shadow-xs border border-slate-200 overflow-hidden">
          <div className="p-5 border-b border-slate-200">
            <h2 className="font-headline text-sm font-bold text-slate-900 mb-3">4. Validação</h2>
            <div className="flex flex-wrap gap-2">
              {([
                ['all', `Todas (${counts.total})`],
                ['valid', `Válidas (${counts.valid})`],
                ['warning', `Avisos (${counts.warning})`],
                ['error', `Erros (${counts.error})`]
              ] as const).map(([key, label]) => (
                <button
                  key={key}
                  type="button"
                  onClick={() => setActiveFilter(key)}
                  className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-colors ${
                    activeFilter === key ? 'bg-[#0b1f3a] text-white' : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
                  }`}
                >
                  {label}
                </button>
              ))}
              <button
                type="button"
                onClick={() => void downloadValidationReport(rows, workbook?.fileName || 'pauta')}
                className="ml-auto px-3 py-1.5 rounded-lg text-xs font-bold bg-slate-100 text-slate-700 hover:bg-slate-200 inline-flex items-center gap-1.5"
              >
                <span className="material-symbols-outlined text-[16px]">download</span>
                Relatório de validação
              </button>
            </div>

            {missingStudents.length > 0 && (
              <Notice tone="warn">
                <span className="font-bold block mb-1">
                  {missingStudents.length} {missingStudents.length === 1 ? 'aluno da turma não vem' : 'alunos da turma não vêm'} no ficheiro:
                </span>
                {missingStudents.map((s) => s.name).join(' · ')}
                <span className="block mt-1">As notas destes alunos ficam como estão, não são apagadas.</span>
              </Notice>
            )}
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead className="bg-slate-50 text-slate-600 uppercase text-[10px] tracking-wider">
                <tr>
                  <th className="px-3 py-2.5 text-left font-bold">Linha</th>
                  <th className="px-3 py-2.5 text-left font-bold">Nome no ficheiro</th>
                  <th className="px-3 py-2.5 text-left font-bold">Aluno emparelhado</th>
                  <th className="px-3 py-2.5 text-right font-bold">MAC</th>
                  <th className="px-3 py-2.5 text-right font-bold">NPP</th>
                  <th className="px-3 py-2.5 text-right font-bold">NPT</th>
                  <th className="px-3 py-2.5 text-right font-bold">MT</th>
                  <th className="px-3 py-2.5 text-left font-bold">Estado</th>
                  <th className="px-3 py-2.5 text-left font-bold">Observações</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {visibleFilteredRows.map((r) => (
                  <tr key={r.excelRow} className={r.status === 'error' ? 'bg-red-50/40' : ''}>
                    <td className="px-3 py-2.5 font-mono text-slate-500">{r.excelRow}</td>
                    <td className="px-3 py-2.5 text-slate-800">{r.rawName || <em className="text-slate-400">vazio</em>}</td>
                    <td className="px-3 py-2.5 text-slate-600">
                      {r.matchedStudentName || <span className="text-red-600 font-semibold">—</span>}
                    </td>
                    <td className="px-3 py-2.5 text-right font-mono">{r.mac === '' ? '—' : r.mac}</td>
                    <td className="px-3 py-2.5 text-right font-mono">{r.npp === '' ? '—' : r.npp}</td>
                    <td className="px-3 py-2.5 text-right font-mono">{r.npt === '' ? '—' : r.npt}</td>
                    <td className="px-3 py-2.5 text-right font-mono font-bold text-[#0b1f3a]">
                      {r.mt === '' ? '—' : r.mt}
                    </td>
                    <td className="px-3 py-2.5">{statusPill(r.status)}</td>
                    <td className="px-3 py-2.5 text-slate-500">{r.messages.join('; ')}</td>
                  </tr>
                ))}
                {filteredRows.length === 0 && (
                  <tr>
                    <td colSpan={9} className="px-3 py-8 text-center text-slate-400">
                      Nenhuma linha neste filtro.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
            <TablePagination total={filteredRows.length} page={pgFilteredRows} onPageChange={setPgFilteredRows} />
          </div>
        </div>
      )}

      {/* Passo 5 — confirmação */}
      {rows.length > 0 && (
        <div className="bg-white rounded-xl p-5 shadow-xs border border-slate-200">
          <h2 className="font-headline text-sm font-bold text-slate-900 mb-3">5. Confirmação e lançamento</h2>

          <label className="flex items-start gap-2.5 text-xs text-slate-700 cursor-pointer">
            <input
              type="checkbox"
              checked={isLegalConfirmed}
              onChange={(e) => setIsLegalConfirmed(e.target.checked)}
              className="mt-0.5 shrink-0"
            />
            <span>
              Declaro que verifiquei as {importableCount} linhas a importar e que correspondem às notas
              efetivamente atribuídas em <strong>{activeSubject?.name || 'disciplina'}</strong> —{' '}
              <strong>{activeClass?.name || 'turma'}</strong>, {trimester}.º trimestre.
              {counts.error > 0 && ` As ${counts.error} linhas com erro não serão gravadas.`}
            </span>
          </label>

          <div className="mt-4 flex flex-wrap items-center gap-3">
            <button
              type="button"
              disabled={!readyToCommit || isCommitting}
              onClick={handleCommit}
              className="inline-flex items-center gap-1.5 px-5 py-2.5 rounded-xl bg-[#0b1f3a] hover:bg-[#7a0c0c] text-white font-bold text-xs transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
            >
              <span className="material-symbols-outlined text-[16px]">save</span>
              {isCommitting ? 'A gravar...' : `Lançar ${importableCount} notas na mini-pauta`}
            </button>
            <button
              type="button"
              onClick={onBackToPautas}
              className="px-4 py-2.5 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold text-xs"
            >
              Cancelar
            </button>
          </div>

          {commitResult && (
            <div className="mt-4 p-4 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-900 text-xs">
              <span className="font-bold block">{commitResult}</span>
              <div className="mt-2 flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={onBackToPautas}
                  className="px-3 py-1.5 rounded-lg bg-white border border-emerald-300 font-bold"
                >
                  Ver a mini-pauta
                </button>
                {onNavigateToHomologacao && (
                  <button
                    type="button"
                    onClick={onNavigateToHomologacao}
                    className="px-3 py-1.5 rounded-lg bg-[#0b1f3a] text-white font-bold"
                  >
                    Seguir para a homologação
                  </button>
                )}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
};
