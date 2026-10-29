import React, { useState } from 'react';
import { UserRole } from '../types';
import { runGlobalOperation } from '../context/OperationContext';
import { Notice } from './Notice';

/** Peças de interface partilhadas pelos ecrãs novos (biblioteca, trabalhos online, portais). */

export const inputCls =
  'w-full h-10 px-3 bg-white border border-slate-300 text-slate-800 focus:border-[#0b1f3a] focus:outline-none text-xs rounded-lg';
export const textareaCls =
  'w-full px-3 py-2 bg-white border border-slate-300 text-slate-800 focus:border-[#0b1f3a] focus:outline-none text-xs rounded-lg';
export const labelCls = 'block text-[11px] font-bold text-slate-600 mb-1';
export const btnPrimary =
  'h-10 px-4 bg-[#0b1f3a] text-white text-xs font-bold rounded-lg hover:bg-[#12315c] disabled:opacity-40 disabled:cursor-not-allowed';
export const btnGhost =
  'h-8 px-3 border border-slate-300 text-slate-700 text-[11px] font-bold rounded-lg hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed';
export const btnDanger =
  'h-8 px-3 border border-red-300 text-red-700 text-[11px] font-bold rounded-lg hover:bg-red-50 disabled:opacity-40 disabled:cursor-not-allowed';

export type OpResult = { success: boolean; error?: string };
export type UiMessage = { ok: boolean; text: string } | null;

/**
 * Executa uma operação do `dbService` pelo mesmo caminho do resto da aplicação
 * (permissão por regra + modal de carregamento/sucesso/erro). Se a operação devolver
 * `success: false`, lança o motivo real — nunca se mostra "sucesso" por cima de uma falha.
 */
export function useOperation(role: UserRole) {
  const [message, setMessage] = useState<UiMessage>(null);
  const run = async (fn: () => OpResult, loading: string, rule: string | undefined, okText: string): Promise<boolean> => {
    try {
      await runGlobalOperation(
        () => {
          const result = fn();
          if (!result.success) throw new Error(result.error || 'Não foi possível concluir a operação.');
        },
        { loadingMessage: loading, successMessage: okText, requiredRule: rule, userRole: role }
      );
      // O sucesso é confirmado pelo diálogo global (carregamento → visto animado): sem faixa verde por cima.
      setMessage(null);
      return true;
    } catch (err: any) {
      setMessage({ ok: false, text: err?.message || 'Sem permissão para esta operação.' });
      return false;
    }
  };
  return { message, setMessage, run };
}

export function Banner({ message }: { message: UiMessage }) {
  if (!message) return null;
  return <Notice tone={message.ok ? 'success' : 'error'}>{message.text}</Notice>;
}

export function Empty({ text }: { text: string }) {
  return <p className="text-xs text-slate-400 font-semibold py-10 text-center">{text}</p>;
}

export function PageHeader({ eyebrow, title, description, actions }: { eyebrow?: string; title: string; description?: string; actions?: React.ReactNode }) {
  return (
    <div className="flex flex-col md:flex-row md:items-end justify-between gap-3">
      <div>
        {eyebrow && <span className="text-[11px] font-bold text-[#ac332b] tracking-wide">{eyebrow}</span>}
        <h2 className="font-headline text-xl font-bold text-slate-900">{title}</h2>
        {description && <p className="text-xs text-slate-500 mt-1 max-w-3xl">{description}</p>}
      </div>
      {actions && <div className="flex items-center gap-2">{actions}</div>}
    </div>
  );
}

export function Badge({ tone, children }: { tone: string; children: React.ReactNode }) {
  return <span className={`inline-flex items-center px-2 py-0.5 rounded text-[10px] font-bold ${tone}`}>{children}</span>;
}

export function Kpis({ items }: { items: Array<{ label: string; value: React.ReactNode; tone?: 'default' | 'warn' | 'danger' }> }) {
  const toneCls = { default: 'text-slate-900', warn: 'text-amber-700', danger: 'text-red-700' };
  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
      {items.map((k) => (
        <div key={k.label} className="bg-white border border-slate-200 rounded-xl p-3">
          <p className="text-[10px] font-bold text-slate-500 uppercase tracking-wide">{k.label}</p>
          <p className={`text-xl font-extrabold mt-1 ${toneCls[k.tone || 'default']}`}>{k.value}</p>
        </div>
      ))}
    </div>
  );
}

export interface TabDef<T extends string> { id: T; label: string; icon: string }

export function TabBar<T extends string>({ tabs, active, onChange }: { tabs: Array<TabDef<T>>; active: T; onChange: (id: T) => void }) {
  return (
    <div className="flex flex-wrap gap-1 border-b border-slate-200" role="tablist">
      {tabs.map((t) => (
        <button
          key={t.id}
          type="button"
          role="tab"
          aria-selected={active === t.id}
          onClick={() => onChange(t.id)}
          className={`px-3 py-2 text-xs font-bold flex items-center gap-1.5 border-b-2 -mb-px cursor-pointer ${
            active === t.id ? 'border-[#0b1f3a] text-[#0b1f3a]' : 'border-transparent text-slate-500 hover:text-slate-800'
          }`}
        >
          <span className="material-symbols-outlined text-[16px]">{t.icon}</span>
          {t.label}
        </button>
      ))}
    </div>
  );
}

/** Data AAAA-MM-DD ou ISO completa → DD/MM/AAAA (sem fuso: usa só a parte da data). */
export function fmtDate(value?: string): string {
  if (!value) return '—';
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(value);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : value;
}

/** AAAA-MM-DDTHH:mm → DD/MM/AAAA HH:mm */
export function fmtDateTime(value?: string): string {
  if (!value) return '—';
  const m = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})/.exec(value);
  return m ? `${m[3]}/${m[2]}/${m[1]} ${m[4]}:${m[5]}` : fmtDate(value);
}

export function kz(value: number): string {
  return `${Math.round(value).toLocaleString('pt-PT')} Kz`;
}
