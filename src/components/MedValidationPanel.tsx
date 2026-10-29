import React, { useMemo, useState } from 'react';
import { groupIssuesByEntity, medIssuesToCsv, type MedEntityType, type MedValidationResult } from '../utils/medValidator';
import { TablePagination, usePagedList } from './TablePagination';
import { Notice, NoticeButton } from './Notice';

const TYPE_LABEL: Record<MedEntityType, string> = { escola: 'Escola', turma: 'Turma', aluno: 'Aluno', docente: 'Docente', folha: 'Folha' };
const TYPE_ICON: Record<MedEntityType, string> = { escola: 'apartment', turma: 'class', aluno: 'person', docente: 'co_present', folha: 'table_chart' };

interface Props { result: MedValidationResult; fileLabel: string }

/** Lista de problemas antes de exportar, agrupada por aluno / turma / docente. */
export const MedValidationPanel: React.FC<Props> = ({ result, fileLabel }) => {
  const [open, setOpen] = useState(false);
  const [type, setType] = useState<'todos' | MedEntityType>('todos');
  const [onlyErrors, setOnlyErrors] = useState(false);
  const [q, setQ] = useState('');

  const groups = useMemo(() => {
    const term = q.trim().toLowerCase();
    const filtered = result.issues
      .filter((i) => (type === 'todos' || i.entityType === type) && (!onlyErrors || i.severity === 'erro'))
      .filter((i) => !term || i.entityName.toLowerCase().includes(term) || (i.context || '').toLowerCase().includes(term));
    return groupIssuesByEntity(filtered);
  }, [result.issues, type, onlyErrors, q]);
  const { page, setPage, pageItems } = usePagedList(groups, [groups.length, type, onlyErrors, q]);

  const downloadCsv = () => {
    const blob = new Blob([medIssuesToCsv(result.issues)], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = `MED-validacao-${fileLabel}.csv`;
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const clean = result.issues.length === 0;
  const tone = result.errors > 0 ? 'error' : result.warnings > 0 ? 'warn' : 'success';
  const icon = result.errors > 0 ? 'error' : result.warnings > 0 ? 'warning' : 'verified';

  return (
    <>
      <Notice
        tone={tone}
        icon={icon}
        title={clean ? 'Dados prontos para exportar' : `${result.errors} erro(s) e ${result.warnings} aviso(s) antes de exportar`}
        resetKey={`${result.errors}/${result.warnings}`}
        actions={!clean ? (
          <>
            <NoticeButton onClick={downloadCsv}>
              <span className="material-symbols-outlined text-[14px]">download</span>CSV
            </NoticeButton>
            <NoticeButton onClick={() => setOpen((o) => !o)}>{open ? 'Esconder lista' : 'Ver lista'}</NoticeButton>
          </>
        ) : undefined}
      >
        Verificados {result.checked.alunos} alunos, {result.checked.turmas} turmas e {result.checked.docentes} docentes.
        Isto confere a consistência dos seus dados; o MED não publica um esquema oficial, por isso não garante a aceitação pelo GEPE.
      </Notice>

      {open && !clean && (
        <div className="bg-white text-slate-700 border border-slate-200 rounded-2xl overflow-hidden">
          <div className="p-3 flex flex-wrap items-center gap-2 border-b border-slate-100">
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Procurar aluno, turma ou docente…" className="h-8 px-3 border border-slate-300 text-xs w-60" />
            <select value={type} onChange={(e) => setType(e.target.value as any)} className="h-8 px-2 border border-slate-300 text-xs">
              <option value="todos">Todos os tipos</option>
              {(Object.keys(TYPE_LABEL) as MedEntityType[]).map((t) => <option key={t} value={t}>{TYPE_LABEL[t]}</option>)}
            </select>
            <label className="text-[11px] font-semibold flex items-center gap-1.5">
              <input type="checkbox" checked={onlyErrors} onChange={(e) => setOnlyErrors(e.target.checked)} />Só erros
            </label>
            <span className="text-[11px] text-slate-400 ml-auto">{groups.length} registo(s) com problemas</span>
          </div>
          <div className="max-h-[420px] overflow-y-auto divide-y divide-slate-100">
            {pageItems.map((g) => (
              <div key={g.key} className="px-4 py-3">
                <div className="flex items-center gap-2 mb-1">
                  <span className="material-symbols-outlined text-[16px] text-slate-500">{TYPE_ICON[g.entityType]}</span>
                  <span className="font-bold text-xs text-slate-900">{g.entityName}</span>
                  <span className="text-[10px] uppercase font-bold text-slate-400">{TYPE_LABEL[g.entityType]}</span>
                  {g.context && <span className="text-[10px] text-slate-500">· {g.context}</span>}
                </div>
                <ul className="space-y-0.5">
                  {g.issues.map((i, k) => (
                    <li key={k} className="text-[11px] flex items-start gap-2">
                      <span className={`mt-0.5 px-1.5 rounded text-[9px] font-bold ${i.severity === 'erro' ? 'bg-red-50 text-red-700' : 'bg-amber-50 text-amber-700'}`}>{i.severity.toUpperCase()}</span>
                      <span>{i.message} <span className="text-slate-400">(folha {i.sheet} · {i.field})</span></span>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
          <TablePagination total={groups.length} page={page} onPageChange={setPage} />
        </div>
      )}
    </>
  );
};
