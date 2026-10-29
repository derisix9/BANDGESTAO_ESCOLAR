import React from 'react';
import { Notice } from './Notice';

export const inputCls = 'w-full h-9 px-3 bg-white border border-slate-300 text-slate-800 focus:border-[#0b1f3a] focus:outline-none text-xs';
export const areaCls = 'w-full px-3 py-2 bg-white border border-slate-300 text-slate-800 focus:border-[#0b1f3a] focus:outline-none text-xs';
export const labelCls = 'block uppercase font-bold text-slate-700 mb-1 text-[11px]';
export const THEAD = 'bg-[#0b1f3a] text-white font-bold uppercase text-[10px] tracking-wider';
export const TH = 'py-2.5 px-3 text-white whitespace-nowrap';
export const TD = 'py-2.5 px-3 text-slate-700';
export const btnPrimary = 'h-9 px-4 bg-[#0b1f3a] text-white text-xs font-bold uppercase tracking-wide rounded-lg flex items-center gap-2 hover:bg-[#132a4d] disabled:opacity-50';
export const btnGhost = 'px-3 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold text-[11px] rounded-lg';

export const fmtDate = (iso?: string) => (iso ? new Date(`${iso}T00:00:00`).toLocaleDateString('pt-PT') : '—');
export const todayIso = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
export const fmtKz = (n: number) => `${Math.round(n).toLocaleString('pt-PT')} Kz`;

export const PageHeader: React.FC<{ kicker: string; title: string; subtitle?: string; right?: React.ReactNode }> = ({ kicker, title, subtitle, right }) => (
  <div className="flex flex-col md:flex-row md:items-start justify-between gap-4">
    <div>
      <div className="flex items-center gap-2 mb-1">
        <span className="text-[11px] font-bold uppercase tracking-widest text-slate-500">{kicker}</span>
        <span className="w-1.5 h-1.5 rounded-full bg-[#0b1f3a]" />
      </div>
      <h1 className="font-headline text-2xl lg:text-3xl font-extrabold text-[#0b1f3a] tracking-tight uppercase">{title}</h1>
      {subtitle && <p className="text-xs text-slate-500 mt-0.5 max-w-3xl">{subtitle}</p>}
    </div>
    {right && <div className="flex items-center gap-2">{right}</div>}
  </div>
);

export const Kpis: React.FC<{ items: Array<{ label: string; value: React.ReactNode; icon: string; tone?: string }> }> = ({ items }) => (
  <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
    {items.map((k) => (
      <div key={k.label} className="bg-white border border-slate-200 rounded-2xl p-4 flex items-center gap-3">
        <div className={`w-10 h-10 flex items-center justify-center rounded-lg shrink-0 ${k.tone || 'bg-slate-100 text-[#0b1f3a]'}`}>
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

export const Badge: React.FC<{ tone: string; children: React.ReactNode }> = ({ tone, children }) => (
  <span className={`px-2 py-0.5 rounded text-[10px] font-bold whitespace-nowrap ${tone}`}>{children}</span>
);

/** Aviso/informação/erro: aparece como caixa de diálogo no topo (ver Notice.tsx), com botão de fechar. */
export const Banner: React.FC<{ tone?: 'info' | 'warn' | 'error'; icon?: string; children: React.ReactNode }> = ({ tone = 'info', icon, children }) => (
  <Notice tone={tone} icon={icon}>{children}</Notice>
);

export const ModalShell: React.FC<{ children: React.ReactNode; wide?: boolean }> = ({ children, wide }) => (
  <div className="fixed inset-0 z-[100] bg-black/50 flex items-center justify-center p-4">
    <div className={`bg-white rounded-2xl w-full ${wide ? 'max-w-3xl' : 'max-w-lg'} flex flex-col max-h-[90vh]`}>{children}</div>
  </div>
);

export const ErrorLine: React.FC<{ message: string | null }> = ({ message }) => <Notice tone="error">{message}</Notice>;
