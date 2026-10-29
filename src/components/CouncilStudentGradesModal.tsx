import React, { useMemo, useState } from 'react';
import type { Student } from '../types';
import type { StudentMiniPautaItem } from '../types/pauta';
import { FormModalHeader } from './FormModalHeader';
import { calculateSituation, PautaSituation } from '../utils/pautaCalculations';
import { classAllowsRecurso, hasThirdTrimesterGrade } from '../utils/recursoRules';
import {
  CouncilContext,
  buildCouncilStudentSummary,
  diffGradeRows,
  fieldMax,
  recalcCouncilRow,
  sanitizeGradeInput,
  trimesterPrefixesFor
} from '../utils/councilGrades';
import { Notice } from './Notice';

interface Props {
  student: Student;
  ctx: CouncilContext;
  /** miniPautasStore[classId]: Mini-Pautas já guardadas desta turma. */
  miniStore?: Record<string, StudentMiniPautaItem[]>;
  /** Conselho homologado ou sem permissão: o boletim só se consulta. */
  readOnly: boolean;
  readOnlyReason?: string;
  onClose: () => void;
  /** Recebe só as disciplinas alteradas. Devolve `true` se gravou. */
  onSave: (rows: Record<string, StudentMiniPautaItem>, reason: string) => Promise<boolean> | boolean;
}

const SIT_LABEL: Record<PautaSituation, { text: string; cls: string }> = {
  APROVADO: { text: 'Aprovado', cls: 'text-emerald-700' },
  RECURSO: { text: 'Recurso', cls: 'text-amber-700' },
  REPROVADO: { text: 'Reprovado', cls: 'text-red-700' },
  PENDENTE: { text: 'Pendente', cls: 'text-slate-400' },
  DESISTIDO: { text: 'Desistido', cls: 'text-slate-500' },
  TRANSFERIDO: { text: 'Transferido', cls: 'text-violet-700' }
};

const DECISION_TEXT = { aprovado: 'Aprovado', reprovado: 'Reprovado', condicional: 'Condicional (recurso)' } as const;
const TRIM_ROMAN = ['I', 'II', 'III'];

export const CouncilStudentGradesModal: React.FC<Props> = ({ student, ctx, miniStore, readOnly, readOnlyReason, onClose, onSave }) => {
  const { cls, subjects, rules } = ctx;

  // Estado inicial: linhas actuais (Mini-Pauta guardada ou notas do aluno) de cada disciplina.
  const initial = useMemo(() => {
    const s = buildCouncilStudentSummary({ student, ctx, miniStore });
    const map: Record<string, StudentMiniPautaItem> = {};
    s.lines.forEach((l) => { map[l.subjectId] = l.row; });
    return map;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [student.id]);

  const [drafts, setDrafts] = useState<Record<string, StudentMiniPautaItem>>(initial);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);

  const summary = useMemo(() => buildCouncilStudentSummary({ student, ctx, miniStore, overrides: drafts }), [student, ctx, miniStore, drafts]);
  const regime = summary.regime;
  const prefixes = trimesterPrefixesFor(regime);

  const changedRows = useMemo(() => {
    const out: Record<string, StudentMiniPautaItem> = {};
    subjects.forEach((sub) => {
      const id = String(sub.id);
      if (drafts[id] && diffGradeRows(initial[id], drafts[id], regime).length > 0) out[id] = drafts[id];
    });
    return out;
  }, [drafts, initial, subjects, regime]);
  const changedCount = Object.keys(changedRows).length;

  const setCell = (subjectId: string, field: string, raw: string) => {
    if (readOnly) return;
    const subject = subjects.find((s) => String(s.id) === subjectId);
    if (!subject) return;
    const value = sanitizeGradeInput(raw, fieldMax(field, regime));
    setDrafts((prev) => ({ ...prev, [subjectId]: recalcCouncilRow({ ...prev[subjectId], [field]: value } as StudentMiniPautaItem, subject, ctx) }));
  };

  const cell = (subjectId: string, row: StudentMiniPautaItem, field: string) => {
    const max = fieldMax(field, regime);
    const v = (row as any)[field];
    const negative = typeof v === 'number' && v < (rules.passingGrade * max) / 20;
    return (
      <input
        type="number"
        inputMode="decimal"
        min={0}
        max={max}
        step={regime === 'eja' ? 0.5 : 1}
        disabled={readOnly}
        aria-label={`${field.toUpperCase()} ${subjects.find((s) => String(s.id) === subjectId)?.name || ''}`}
        value={typeof v === 'number' ? v : ''}
        onChange={(e) => setCell(subjectId, field, e.target.value)}
        className={`w-11 h-7 text-center rounded border font-mono text-xs font-bold disabled:bg-slate-100 disabled:text-slate-500 ${
          negative ? 'bg-rose-50 border-rose-200 text-rose-600' : 'bg-slate-50 border-slate-200 text-slate-800 focus:bg-white focus:border-[#0b1f3a]'
        }`}
      />
    );
  };

  const calc = (v: number | '', negativeBelow = rules.passingGrade) => (
    <span className={`font-mono font-bold text-xs ${typeof v === 'number' && v < negativeBelow ? 'text-red-600' : 'text-slate-800'}`}>{v === '' ? '—' : Number.isInteger(v) ? v : v.toFixed(2)}</span>
  );

  const save = async () => {
    setBusy(true);
    try {
      const ok = await onSave(changedRows, reason);
      if (ok) onClose();
    } finally {
      setBusy(false);
    }
  };

  const th = 'px-1.5 py-1 text-[10px] font-bold uppercase text-center border-l border-white/10';
  const showPG = regime === 'transicao';
  const showExam = regime === 'exame';

  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/50 p-3" role="dialog" aria-modal="true" aria-label={`Boletim de notas de ${student.name}`}>
      <div className="bg-white w-full max-w-[1200px] max-h-[94vh] flex flex-col shadow-2xl">
        <FormModalHeader
          title={`Boletim de notas — ${student.name}`}
          subtitle={`${cls.name} · ${regime === 'exame' ? 'Classe de exame' : regime === 'eja' ? 'EJA' : 'Classe de transição'} · nota mínima de aprovação ${rules.passingGrade}`}
          icon="assignment_ind"
          onClose={onClose}
          badge={readOnly ? 'Só leitura' : undefined}
        />
        <div className="overflow-auto p-4 space-y-4 flex-1">
          {readOnly && readOnlyReason && <Notice tone="warn">{readOnlyReason}</Notice>}

          <div className="overflow-x-auto border border-slate-200">
            <table className="w-full text-xs border-collapse">
              <thead className="bg-[#0b1f3a] text-white">
                <tr>
                  <th rowSpan={2} className="px-2 py-1 text-left text-[10px] font-bold uppercase min-w-[160px]">Disciplina</th>
                  {[1, 2, 3].map((t) => (
                    <th key={t} colSpan={prefixes.length + 1} className={th}>{TRIM_ROMAN[t - 1]} Trimestre</th>
                  ))}
                  <th rowSpan={2} className={th}>MFD</th>
                  {showPG && <th rowSpan={2} className={th}>PG</th>}
                  {showExam && <><th rowSpan={2} className={th}>NEE</th><th rowSpan={2} className={th}>NEO</th><th rowSpan={2} className={th}>MF</th><th rowSpan={2} className={th}>NER</th></>}
                  <th rowSpan={2} className={th}>Situação</th>
                </tr>
                <tr>
                  {[1, 2, 3].map((t) => (
                    <React.Fragment key={t}>
                      {prefixes.map((p) => <th key={p} className={th}>{p.toUpperCase()}</th>)}
                      <th className={th}>MT{t}</th>
                    </React.Fragment>
                  ))}
                </tr>
              </thead>
              <tbody>
                {summary.lines.map((l) => {
                  const row = l.row;
                  const sit = summary.isDesistente
                    ? 'DESISTIDO'
                    : summary.isTransferido
                    ? 'TRANSFERIDO'
                    : calculateSituation({
                        finalGrade: l.decisive,
                        hasAnyGrade: typeof l.decisive === 'number',
                        isDesistente: false,
                        classGrade: cls.grade,
                        rules,
                        isKeySubject: l.isKey,
                        ner: regime === 'exame' ? row.ner ?? '' : '',
                        recursoAllowed: classAllowsRecurso(cls.grade, ctx.courseDurationYears) && hasThirdTrimesterGrade(row.mt3)
                      });
                  return (
                    <tr key={l.subjectId} className={`border-t border-slate-100 ${l.negative ? 'bg-rose-50/40' : ''}`}>
                      <td className="px-2 py-1.5 font-semibold text-slate-800">
                        {l.subjectName}
                        {l.isKey && <span className="ml-1.5 px-1 py-0.5 text-[9px] font-bold bg-[#7a0c0c] text-white align-middle" title="Disciplina chave: negativa não dá direito a recurso">CHAVE</span>}
                      </td>
                      {[1, 2, 3].map((t) => (
                        <React.Fragment key={t}>
                          {prefixes.map((p) => <td key={p} className="px-1 py-1 text-center border-l border-slate-100">{cell(l.subjectId, row, `${p}${t}`)}</td>)}
                          <td className="px-1 py-1 text-center border-l border-slate-100 bg-slate-50">{calc((row as any)[`mt${t}`])}</td>
                        </React.Fragment>
                      ))}
                      <td className="px-1 py-1 text-center border-l border-slate-100 bg-slate-50">{calc(row.mfd)}</td>
                      {showPG && <td className="px-1 py-1 text-center border-l border-slate-100">{cell(l.subjectId, row, 'pg')}</td>}
                      {showExam && (
                        <>
                          <td className="px-1 py-1 text-center border-l border-slate-100">{cell(l.subjectId, row, 'nee')}</td>
                          <td className="px-1 py-1 text-center border-l border-slate-100">{cell(l.subjectId, row, 'neo')}</td>
                          <td className="px-1 py-1 text-center border-l border-slate-100 bg-slate-50">{calc(row.mf ?? '')}</td>
                          <td className="px-1 py-1 text-center border-l border-slate-100">{cell(l.subjectId, row, 'ner')}</td>
                        </>
                      )}
                      <td className={`px-2 py-1 text-center border-l border-slate-100 font-bold text-[11px] ${SIT_LABEL[sit].cls}`}>{SIT_LABEL[sit].text}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <div className="grid md:grid-cols-2 gap-3">
            <div className="border border-slate-200 p-3 space-y-1.5">
              <p className="text-[10px] font-bold uppercase text-slate-500">Negativas no ano lectivo</p>
              <p className={`text-2xl font-extrabold ${summary.negativeCount > 0 ? 'text-red-700' : 'text-emerald-700'}`}>{summary.negativeCount}</p>
              {summary.negatives.length === 0 ? (
                <p className="text-xs text-slate-500">Nenhuma disciplina negativa.</p>
              ) : (
                <ul className="text-xs text-slate-700 space-y-0.5">
                  {summary.negatives.map((n) => (
                    <li key={n.subjectId}>
                      {n.subjectName} <span className="font-mono font-bold text-red-600">({n.grade})</span>
                      {n.isKey && <span className="ml-1 text-[10px] font-bold text-[#7a0c0c]">· chave</span>}
                      {n.recovered && <span className="ml-1 text-[10px] font-bold text-emerald-700">· recuperada em recurso</span>}
                    </li>
                  ))}
                </ul>
              )}
              {summary.maxNegativasRecurso !== null && (
                <p className="text-[10px] text-slate-400">Limite configurado de negativas com direito a recurso (fora das disciplinas chave): {summary.maxNegativasRecurso}.</p>
              )}
            </div>
            <div className="border border-slate-200 p-3 space-y-1.5">
              <p className="text-[10px] font-bold uppercase text-slate-500">Resultado segundo as regras das pautas</p>
              <p className="text-sm font-bold text-slate-900">
                {summary.isDesistente ? 'Desistente' : summary.isTransferido ? 'Transferido' : DECISION_TEXT[summary.proposed]}
                {typeof summary.mf === 'number' && <span className="ml-2 text-xs font-mono text-slate-500">MF {summary.mf}</span>}
              </p>
              <ul className="text-[11px] text-slate-600 list-disc pl-4 space-y-0.5">
                {summary.reasons.map((r, i) => <li key={i}>{r}</li>)}
              </ul>
            </div>
          </div>

          {!readOnly && (
            <div>
              <label className="block text-[11px] font-bold text-slate-600 mb-1" htmlFor="council-grade-reason">Motivo da atribuição/alteração (fica registado no conselho)</label>
              <input id="council-grade-reason" className="w-full h-10 px-3 bg-white border border-slate-300 text-xs rounded-lg focus:border-[#0b1f3a] focus:outline-none" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Opcional" />
            </div>
          )}
        </div>
        <div className="px-4 py-3 border-t border-slate-200 flex items-center justify-between gap-2 bg-slate-50">
          <span className="text-[11px] text-slate-500">{readOnly ? '' : changedCount > 0 ? `${changedCount} disciplina(s) alterada(s). Ao gravar, a Mini-Pauta e a Pauta Final são atualizadas.` : 'Sem alterações por gravar.'}</span>
          <div className="flex gap-2">
            <button type="button" onClick={onClose} className="h-9 px-4 border border-slate-300 text-slate-700 text-xs font-bold rounded-lg hover:bg-white">Fechar</button>
            {!readOnly && (
              <button type="button" disabled={busy || changedCount === 0} onClick={save} className="h-9 px-4 bg-[#0b1f3a] text-white text-xs font-bold rounded-lg hover:bg-[#12315c] disabled:opacity-40 disabled:cursor-not-allowed">
                Gravar notas no conselho
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
