import React, { useMemo, useState } from 'react';
import type { SchoolDatabase } from '../types';
import { dbService } from '../services/db';
import { canViewSection } from '../utils/userAccess';
import { exportReportExcel, XlsxCol, XlsxReportSpec } from '../utils/relatoriosExcelExport';
import {
  LISTAGENS, LISTAGEM_GROUPS, ListDef, Cell, visibleListagens, fmtCell, filterRows, totalsRow, todayLocalISO,
} from '../utils/listagemCatalog';
import { notify } from './Notice';

/**
 * Relatórios → Listagem: imprime (ou exporta para Excel) uma lista de cada secção do sistema.
 * As definições vivem em utils/listagemCatalog.ts; aqui só se desenha, pesquisa, imprime e exporta.
 */
interface Props {
  db: SchoolDatabase;
  /** Regra extra da Matriz de Permissões (ex.: 'propinas.reports'). */
  canRule: (rule: string) => boolean;
}

export const ListagemPanel: React.FC<Props> = ({ db, canRule }) => {
  const user = db.currentUser;
  const available = useMemo(
    () => visibleListagens((sec) => canViewSection(user, sec), canRule),
    [user, canRule]
  );
  const [selectedId, setSelectedId] = useState<string>('');
  const [query, setQuery] = useState('');
  const [printOpen, setPrintOpen] = useState(false);

  const def: ListDef | undefined = available.find((l) => l.id === selectedId) || available[0];

  // Linhas "cruas" (números como números, para somar) e em texto (para pesquisar / mostrar).
  const { raw, text } = useMemo(() => {
    if (!def) return { raw: [] as Cell[][], text: [] as string[][] };
    let source: any[] = [];
    try {
      source = def.rows(db) || [];
    } catch (e) {
      console.error('Listagem: falha ao ler os dados de', def.id, e);
    }
    const rawRows = source.map((row) => def.cols.map((c) => {
      try { return c.get(row, db); } catch { return ''; }
    }));
    return { raw: rawRows, text: rawRows.map((r) => r.map((v, i) => fmtCell(v, def.cols[i]))) };
  }, [def, db]);

  const shownIdx = useMemo(() => filterRows(text, query), [text, query]);
  const shownRaw = useMemo(() => shownIdx.map((i) => raw[i]), [shownIdx, raw]);
  const shownText = useMemo(() => shownIdx.map((i) => text[i]), [shownIdx, text]);
  const totals = useMemo(() => (def ? totalsRow(def.cols, shownRaw) : null), [def, shownRaw]);
  const totalsText = totals && def ? totals.map((v, i) => (v === '' ? '' : fmtCell(v, def.cols[i]))) : null;

  const schoolName = db.settings?.schoolName || 'Instituto Médio Politécnico BandMed';
  const academicYear = db.settings?.currentAcademicYear || '';
  const emitted = new Date().toLocaleDateString('pt-PT', { day: '2-digit', month: 'long', year: 'numeric' });

  const audit = (action: string) => {
    if (!def) return;
    try {
      dbService.addAuditLog({
        userName: user?.name || 'Sistema',
        userRole: user?.roleTitle || String(user?.role || ''),
        action,
        details: `Listagem "${def.label}" (${shownIdx.length} registos).`,
        module: 'sistema',
        timestamp: 'Agora mesmo',
        badgeColor: '#0b1f3a',
      } as any);
    } catch {
      /* a auditoria nunca deve impedir a listagem */
    }
  };

  const exportExcel = async () => {
    if (!def) return;
    const columns: XlsxCol[] = def.cols.map((c, i) => {
      const longest = Math.max(c.h.length, ...shownText.slice(0, 200).map((r) => (r[i] || '').length));
      return {
        header: c.h,
        width: Math.min(46, Math.max(9, Math.round(longest * 0.95) + 2)),
        align: c.align,
        numFmt: c.kz ? '#,##0" Kz"' : undefined,
        totFill: '0B1F3A',
        totColor: 'FFFFFF',
      };
    });
    const spec: XlsxReportSpec = {
      fileName: `Listagem_${def.id}_${todayLocalISO()}.xlsx`,
      sheetName: def.label.replace(/[\\/?*[\]:]/g, ' ').slice(0, 31),
      schoolName,
      logoUrl: db.settings?.logoUrl,
      title: `Listagem — ${def.label}`,
      meta: [
        { label: 'Ano Letivo:', value: academicYear || '—' },
        { label: 'Registos:', value: String(shownIdx.length) },
        { label: 'NIF & Alvará:', value: db.settings?.nif || '5000389124' },
        { label: 'Data de Emissão:', value: emitted },
      ],
      columns,
      rows: shownRaw.map((r) => r.map((v) => (v === undefined || v === null || v === '' ? '—' : v))),
      total: totals ? totals.map((v) => (v === '' ? '—' : v)) : undefined,
      emptyMessage: 'Sem registos nesta listagem.',
      signatures: ['O Diretor Pedagógico', 'A Secretaria', 'A Direcção Geral'],
    };
    try {
      await exportReportExcel(spec);
      audit('Exportação de Listagem (Excel)');
    } catch (e) {
      console.error('Falha ao exportar Excel', e);
      notify.error('Não foi possível gerar o ficheiro Excel. Tente novamente.');
    }
  };

  if (!def) {
    return (
      <div className="bg-white rounded-2xl border border-slate-200 p-8 text-center text-sm text-slate-500">
        Não tem acesso a nenhuma secção com listagens disponíveis.
      </div>
    );
  }

  const landscape = def.cols.length > 6;

  const renderTable = (print?: boolean) => (
    <table
      data-no-pagination=""
      data-no-row-select=""
      className={`w-full text-left border-collapse ${print ? 'text-[8px] border border-slate-500' : 'text-xs'}`}
    >
      <thead>
        <tr className="bg-[#0b1f3a] text-white uppercase font-bold tracking-wide text-[10px]">
          <th className="py-2 px-2 border border-slate-600 text-center w-8">N.º</th>
          {def.cols.map((c) => (
            <th key={c.h} className={`py-2 px-2 border border-slate-600 ${c.align === 'right' ? 'text-right' : c.align === 'center' ? 'text-center' : ''}`}>
              {c.h}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {shownText.length === 0 && (
          <tr>
            <td colSpan={def.cols.length + 1} className="py-8 text-center text-slate-500 border border-slate-300">
              Sem registos nesta listagem.
            </td>
          </tr>
        )}
        {shownText.map((r, ri) => (
          <tr key={ri} className={ri % 2 ? 'bg-slate-50' : 'bg-white'}>
            <td className="py-1.5 px-2 border border-slate-300 text-center font-mono text-slate-500">{ri + 1}</td>
            {r.map((v, ci) => (
              <td
                key={ci}
                className={`py-1.5 px-2 border border-slate-300 text-slate-800 align-top ${
                  def.cols[ci].align === 'right' ? 'text-right font-mono' : def.cols[ci].align === 'center' ? 'text-center' : ''
                }`}
              >
                {v}
              </td>
            ))}
          </tr>
        ))}
        {totalsText && (
          <tr className="bg-[#0b1f3a] text-white font-bold">
            <td className="py-2 px-2 border border-slate-600" />
            {totalsText.map((v, ci) => (
              <td key={ci} className={`py-2 px-2 border border-slate-600 ${def.cols[ci].align === 'right' ? 'text-right font-mono' : def.cols[ci].align === 'center' ? 'text-center' : ''}`}>
                {v}
              </td>
            ))}
          </tr>
        )}
      </tbody>
    </table>
  );

  const OfficialHeader = (
    <div className="text-center pb-3 mb-4 border-b-2 border-slate-900">
      <img
        src={db.settings?.logoUrl || '/school_emblem.png'}
        alt={schoolName}
        className="w-14 h-14 object-contain mx-auto mb-2"
        referrerPolicy="no-referrer"
      />
      <div className="text-[11px] font-bold uppercase tracking-widest text-slate-700">República de Angola • Ministério da Educação</div>
      <h1 className="text-xl font-bold uppercase tracking-wider text-slate-900 mt-1">{schoolName}</h1>
      <p className="text-xs font-semibold text-slate-800 mt-1">Listagem — {def.label}</p>
      <div className="flex flex-wrap justify-center items-center gap-x-4 gap-y-1 text-[10px] text-slate-600 mt-2 font-mono">
        <span>NIF: {db.settings?.nif || '5000389124'}</span>
        {academicYear && <><span>•</span><span>Ano Letivo: {academicYear}</span></>}
        <span>•</span>
        <span>Registos: {shownIdx.length}</span>
        <span>•</span>
        <span>Emitido em: {emitted}</span>
      </div>
    </div>
  );

  return (
    <div className="flex flex-col gap-4">
      {/* Seletor da listagem (agrupado por secção) */}
      <div className="bg-white rounded-2xl border border-slate-200 shadow-xs p-3 sm:p-4 flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-4 print:hidden">
        <label htmlFor="listagem-select" className="flex items-center gap-2 text-[11px] font-extrabold uppercase tracking-widest text-slate-500 shrink-0">
          <span className="material-symbols-outlined text-[18px] text-[#0b1f3a]">{def.icon}</span>
          Listagem
        </label>
        <select
          id="listagem-select"
          value={def.id}
          onChange={(e) => { setSelectedId(e.target.value); setQuery(''); }}
          className="w-full sm:max-w-md px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-sm font-semibold text-slate-800 outline-none focus:ring-1 focus:ring-[#0b1f3a] cursor-pointer"
        >
          {LISTAGEM_GROUPS.map((g) => {
            const items = available.filter((l) => l.group === g);
            if (!items.length) return null;
            return (
              <optgroup key={g} label={g}>
                {items.map((l) => (
                  <option key={l.id} value={l.id}>{l.label}</option>
                ))}
              </optgroup>
            );
          })}
        </select>
        {available.length < LISTAGENS.length && (
          <p className="text-[10px] text-slate-400 sm:ml-auto">
            Só aparecem as listagens das secções a que tem acesso.
          </p>
        )}
      </div>

      {/* Tabela */}
      <section className="bg-white rounded-2xl border border-slate-200 shadow-xs p-4 sm:p-6 min-w-0">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-4 mb-4 border-b border-slate-200">
          <div>
            <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400 block">{def.group}</span>
            <h2 className="font-headline text-lg lg:text-xl font-bold text-[#0b1f3a]">{def.label}</h2>
            <span className="text-xs text-slate-500">{shownIdx.length} de {raw.length} registos • Atualizado em tempo real</span>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative">
              <input
                type="text"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Pesquisar na listagem..."
                className="w-56 pl-8 pr-3 py-1.5 bg-slate-50 border border-slate-200 rounded-lg text-xs text-slate-800 outline-none focus:ring-1 focus:ring-[#0b1f3a]"
              />
              <span className="material-symbols-outlined text-[16px] text-slate-400 absolute left-2.5 top-2">search</span>
            </div>
            <button
              type="button"
              onClick={exportExcel}
              className="px-3 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-bold rounded-lg border border-slate-200 flex items-center gap-1 transition-colors cursor-pointer"
            >
              <span className="material-symbols-outlined text-[16px]">file_download</span>
              <span>Exportar Excel</span>
            </button>
            <button
              type="button"
              onClick={() => setPrintOpen(true)}
              className="px-3.5 py-1.5 bg-[#0b1f3a] hover:bg-[#15345d] text-white text-xs font-bold rounded-lg flex items-center gap-1.5 shadow-xs transition-colors cursor-pointer"
            >
              <span className="material-symbols-outlined text-[16px]">print</span>
              <span>Imprimir</span>
            </button>
          </div>
        </div>
        <div className="overflow-x-auto">
          {renderTable()}
        </div>
      </section>

      {/* Pré-visualização e impressão */}
      {printOpen && (
        <div className="printable-modal-overlay fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-2 sm:p-4 overflow-y-auto print:p-0 print:m-0 print:block">
          <style>{`
            @media print {
              @page { size: A4 ${landscape ? 'landscape' : 'portrait'} !important; margin: 5mm !important; }
              table { width: 100% !important; border-collapse: collapse !important; page-break-inside: auto !important; }
              tr { page-break-inside: avoid !important; }
              thead { display: table-header-group !important; }
            }
          `}</style>
          <div className="bg-white rounded-2xl w-full max-w-6xl shadow-2xl border border-slate-300 my-auto flex flex-col max-h-[92vh] print:m-0 print:border-none print:shadow-none print:max-h-none print:w-full">
            <div className="flex items-center justify-between px-6 py-3.5 border-b border-slate-200 bg-slate-50 rounded-t-2xl print:hidden">
              <div className="flex items-center gap-2">
                <span className="material-symbols-outlined text-[#0b1f3a] text-2xl">print</span>
                <h3 className="font-bold text-sm text-slate-900">Pré-Visualização de Impressão — {def.label}</h3>
              </div>
              <button type="button" onClick={() => setPrintOpen(false)} className="p-1.5 text-slate-400 hover:text-slate-700 rounded-lg hover:bg-slate-200 cursor-pointer" title="Fechar">
                <span className="material-symbols-outlined text-xl">close</span>
              </button>
            </div>
            <div className="printable-document printable-page printable-report overflow-y-auto p-6 sm:p-8 bg-white text-slate-900 print:p-0 print:m-0 print:overflow-visible">
              {OfficialHeader}
              <div className="overflow-x-auto print:overflow-visible">
                {renderTable(true)}
              </div>
              <div className="grid grid-cols-3 gap-8 mt-10 pt-5 border-t-2 border-slate-900 text-center text-xs">
                {['O Diretor Pedagógico', 'A Secretaria', 'A Direcção Geral'].map((s) => (
                  <div key={s}>
                    <div className="border-b border-slate-500 pb-8 mb-2" />
                    <span className="font-bold text-slate-900 block uppercase text-[10.5px]">{s}</span>
                  </div>
                ))}
              </div>
            </div>
            <div className="flex items-center justify-end gap-2 px-6 py-3 border-t border-slate-200 bg-slate-50 rounded-b-2xl print:hidden">
              <button type="button" onClick={() => setPrintOpen(false)} className="px-4 py-1.5 rounded-xl border border-slate-300 bg-white hover:bg-slate-100 text-slate-700 text-xs font-bold cursor-pointer">
                Fechar
              </button>
              <button
                type="button"
                onClick={() => { audit('Impressão de Listagem'); window.print(); }}
                className="px-5 py-1.5 rounded-xl bg-[#0b1f3a] hover:bg-[#15345d] text-white text-xs font-bold flex items-center gap-1.5 shadow-sm cursor-pointer"
              >
                <span className="material-symbols-outlined text-[16px]">print</span>
                <span>Imprimir</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
