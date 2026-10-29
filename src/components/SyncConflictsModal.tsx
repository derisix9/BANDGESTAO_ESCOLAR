import React, { useEffect, useState } from 'react';
import { dbService } from '../services/db';
import { describeValue, type SyncConflict } from '../utils/syncConflicts';

/** Nome legível da colecção para o utilizador (as chaves técnicas não dizem nada a quem usa a app). */
const COLLECTION_LABELS: Record<string, string> = {
  students: 'Aluno', teachers: 'Professor', classes: 'Turma', subjects: 'Disciplina', invoices: 'Fatura / propina',
  enrollments: 'Matrícula', attendanceSheets: 'Caderneta de presenças', employees: 'Funcionário', books: 'Livro',
  notices: 'Aviso', expenses: 'Despesa', timetable: 'Horário'
};
export const collectionLabel = (c: string): string => COLLECTION_LABELS[c] || c;

/** Hook: lista de conflitos de edição por resolver (actualiza sozinha). */
export function useSyncConflicts(): SyncConflict[] {
  const [list, setList] = useState<SyncConflict[]>(() => dbService.getSyncConflicts());
  useEffect(() => dbService.subscribeSyncConflicts(setList), []);
  return list;
}

const Side: React.FC<{ title: string; hint: string; value: unknown; tone: 'mine' | 'theirs' }> = ({ title, hint, value, tone }) => (
  <div className={`rounded-xl border p-3 ${tone === 'mine' ? 'border-amber-300 bg-amber-50' : 'border-sky-300 bg-sky-50'}`}>
    <div className="text-[10px] font-bold uppercase tracking-wider text-slate-500">{title}</div>
    <div className="text-[11px] text-slate-500 mb-1">{hint}</div>
    <div className="text-sm font-semibold text-slate-900 break-words whitespace-pre-wrap">{describeValue(value, 300)}</div>
  </div>
);

/**
 * Resolução dos conflitos de edição: duas pessoas (uma delas sem rede) mudaram o mesmo campo do mesmo registo.
 * Nada é sobrescrito sem o utilizador escolher.
 */
export const SyncConflictsModal: React.FC<{ onClose: () => void }> = ({ onClose }) => {
  const conflicts = useSyncConflicts();

  useEffect(() => { if (conflicts.length === 0) onClose(); }, [conflicts.length, onClose]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  if (conflicts.length === 0) return null;

  return (
    <div data-acl-ignore className="fixed inset-0 z-[10000] flex items-center justify-center p-4 bg-slate-900/60" role="dialog" aria-modal="true" aria-label="Conflitos de edição">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-3xl max-h-[90vh] flex flex-col">
        <div className="p-5 border-b border-slate-200">
          <h2 className="font-headline text-lg font-bold text-slate-900">Conflitos de edição ({conflicts.length})</h2>
          <p className="text-sm text-slate-600 mt-1">
            Enquanto trabalhava sem ligação (ou antes de sincronizar), outra pessoa alterou os mesmos dados. Nada foi sobrescrito:
            escolha, para cada campo, que versão fica.
          </p>
        </div>

        <div className="p-5 overflow-y-auto flex flex-col gap-4">
          {conflicts.map((c) => (
            <div key={c.id} className="rounded-xl border border-slate-200 p-4">
              <div className="flex flex-wrap items-baseline gap-x-2 mb-3">
                <span className="text-[11px] font-bold uppercase tracking-wider text-[#ac332b]">{collectionLabel(c.collection)}</span>
                <span className="font-semibold text-slate-900">{c.recordLabel}</span>
                <span className="text-xs text-slate-500">· campo «{c.field}»</span>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <Side title="A sua versão" hint="o que escreveu neste aparelho" value={c.mine} tone="mine" />
                <Side title="Versão no servidor" hint="o que outra pessoa gravou" value={c.theirs} tone="theirs" />
              </div>
              <div className="flex flex-wrap gap-2 mt-3">
                <button type="button" onClick={() => dbService.resolveSyncConflict(c.id, 'mine')}
                  className="px-3 py-2 rounded-lg bg-[#0b1f3a] text-white text-xs font-bold hover:bg-[#7a0c0c]">Manter a minha</button>
                <button type="button" onClick={() => dbService.resolveSyncConflict(c.id, 'theirs')}
                  className="px-3 py-2 rounded-lg bg-slate-100 text-slate-800 text-xs font-bold hover:bg-slate-200">Usar a do servidor</button>
              </div>
            </div>
          ))}
        </div>

        <div className="p-4 border-t border-slate-200 flex flex-wrap items-center justify-between gap-2">
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={() => dbService.resolveAllSyncConflicts('mine')}
              className="px-3 py-2 rounded-lg border border-slate-300 text-xs font-bold text-slate-800 hover:bg-slate-50">Manter todas as minhas</button>
            <button type="button" onClick={() => dbService.resolveAllSyncConflicts('theirs')}
              className="px-3 py-2 rounded-lg border border-slate-300 text-xs font-bold text-slate-800 hover:bg-slate-50">Usar todas do servidor</button>
          </div>
          <button type="button" onClick={onClose} className="px-3 py-2 rounded-lg text-xs font-bold text-slate-600 hover:bg-slate-100">Decidir depois</button>
        </div>
      </div>
    </div>
  );
};
