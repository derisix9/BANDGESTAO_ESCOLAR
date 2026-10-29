import React from 'react';
import { FormModalHeader } from './FormModalHeader';
import { Notice } from './Notice';

export const logisticsInputCls =
  'w-full h-9 px-3 bg-white border border-slate-300 text-slate-800 focus:border-[#0b1f3a] focus:outline-none text-xs';
export const logisticsLabelCls = 'block uppercase font-bold text-slate-700 mb-1 text-[11px]';

export const LogisticsSectionTitle: React.FC<{ icon: string; children: React.ReactNode }> = ({ icon, children }) => (
  <div className="flex items-center gap-2 pb-1.5 border-b border-slate-200">
    <span className="material-symbols-outlined text-[16px] text-[#0b1f3a]">{icon}</span>
    <span className="font-bold text-slate-800 text-[11px] uppercase tracking-wide">{children}</span>
  </div>
);

export const LogisticsPageHeader: React.FC<{
  subsection: string;
  title: string;
  description: string;
  actions?: React.ReactNode;
}> = ({ subsection, title, description, actions }) => (
  <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
    <div>
      <div className="flex items-center gap-2 mb-1">
        <span className="text-[11px] font-bold uppercase tracking-widest text-slate-500">LOGÍSTICA</span>
        <span className="w-1.5 h-1.5 rounded-full bg-[#0b1f3a]" />
        <span className="text-xs font-semibold text-[#0b1f3a]">{subsection}</span>
      </div>
      <h1 className="font-headline text-2xl lg:text-3xl font-extrabold text-[#0b1f3a] tracking-tight">{title}</h1>
      <p className="text-xs text-slate-500 mt-0.5">{description}</p>
    </div>
    {actions && <div className="flex items-center gap-2 shrink-0 flex-wrap">{actions}</div>}
  </div>
);

export const LogisticsPrimaryButton: React.FC<{
  icon: string;
  label: string;
  onClick: () => void;
  variant?: 'primary' | 'secondary' | 'success' | 'danger';
}> = ({ icon, label, onClick, variant = 'primary' }) => (
  <button
    type="button"
    onClick={onClick}
    className={
      variant === 'primary'
        ? 'flex items-center gap-2 px-4 py-2.5 rounded-xl bg-[#0b1f3a] hover:bg-[#7a0c0c] active:scale-[0.98] transition-all duration-200 text-white font-bold text-xs shadow-sm shrink-0 cursor-pointer'
        : variant === 'success'
        ? 'flex items-center gap-2 px-4 py-2.5 rounded-xl bg-emerald-700 hover:bg-emerald-800 border border-emerald-700 active:scale-[0.98] transition-all duration-200 text-white font-bold text-xs shadow-sm shrink-0 cursor-pointer'
        : variant === 'danger'
        ? 'flex items-center gap-2 px-4 py-2.5 rounded-xl bg-red-700 hover:bg-red-800 border border-red-700 active:scale-[0.98] transition-all duration-200 text-white font-bold text-xs shadow-sm shrink-0 cursor-pointer'
        : 'flex items-center gap-2 px-4 py-2.5 rounded-xl bg-white border border-slate-300 hover:border-[#0b1f3a] text-[#0b1f3a] active:scale-[0.98] transition-all duration-200 font-bold text-xs shrink-0 cursor-pointer'
    }
  >
    <span className="material-symbols-outlined text-[18px]">{icon}</span>
    <span>{label}</span>
  </button>
);

export const LogisticsKpiGrid: React.FC<{
  items: Array<{ label: string; value: React.ReactNode; icon: string; tone?: 'default' | 'warn' | 'danger' }>;
}> = ({ items }) => (
  <div className={`grid grid-cols-2 ${items.length >= 4 ? 'lg:grid-cols-4' : 'sm:grid-cols-3'} gap-3`}>
    {items.map((k) => {
      const tone =
        k.tone === 'danger'
          ? 'bg-red-50 text-red-700'
          : k.tone === 'warn'
            ? 'bg-amber-50 text-amber-700'
            : 'bg-slate-100 text-[#0b1f3a]';
      return (
        <div key={k.label} className="bg-white border border-slate-200 rounded-2xl p-4 flex items-center gap-3">
          <div className={`w-10 h-10 flex items-center justify-center rounded-lg shrink-0 ${tone}`}>
            <span className="material-symbols-outlined text-[22px]">{k.icon}</span>
          </div>
          <div className="min-w-0">
            <div className="font-mono text-xl font-extrabold text-[#0b1f3a] leading-none truncate">{k.value}</div>
            <div className="text-[11px] text-slate-500 font-semibold mt-1">{k.label}</div>
          </div>
        </div>
      );
    })}
  </div>
);

export const LogisticsSearchBar: React.FC<{
  value: string;
  onChange: (v: string) => void;
  placeholder: string;
  children?: React.ReactNode;
}> = ({ value, onChange, placeholder, children }) => (
  <div className="bg-white p-4 rounded-2xl border border-slate-200 shadow-xs flex flex-col md:flex-row items-center justify-between gap-3">
    <div className="relative flex items-center w-full md:w-96 border border-slate-400/30 bg-slate-50/60 focus-within:border-slate-400/70 focus-within:bg-white transition-colors">
      <span className="material-symbols-outlined ml-3 text-slate-400 text-[18px] shrink-0">search</span>
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="w-full h-9 pl-2 pr-3 bg-transparent border-0 outline-none focus:ring-0 text-xs text-slate-800 placeholder:text-slate-400"
      />
    </div>
    <div className="flex flex-wrap items-center gap-3 w-full md:w-auto">{children}</div>
  </div>
);

export const logisticsSelectCls =
  'h-9 px-3 rounded-lg bg-slate-100 text-xs font-semibold text-slate-700 border-0 focus:ring-1 focus:ring-[#0b1f3a]';

export const LogisticsBadge: React.FC<{
  tone: 'green' | 'amber' | 'red' | 'slate' | 'blue';
  children: React.ReactNode;
}> = ({ tone, children }) => {
  const map = {
    green: 'bg-emerald-100 text-emerald-800',
    amber: 'bg-amber-100 text-amber-800',
    red: 'bg-red-100 text-red-800',
    slate: 'bg-slate-200 text-slate-600',
    blue: 'bg-blue-100 text-blue-800'
  } as const;
  return <span className={`px-2 py-0.5 rounded text-[10px] font-bold whitespace-nowrap ${map[tone]}`}>{children}</span>;
};

export const LogisticsIconButton: React.FC<{
  icon: string;
  title: string;
  onClick: () => void;
  hover?: 'default' | 'blue' | 'red' | 'green';
  /** Cor permanente (não só ao passar o rato): verde = entrada, vermelho = saída. */
  tone?: 'green' | 'red';
}> = ({ icon, title, onClick, hover = 'default', tone }) => {
  const hoverCls = {
    default: 'text-slate-500 hover:text-[#0b1f3a] hover:bg-slate-100',
    blue: 'text-slate-500 hover:text-blue-700 hover:bg-slate-100',
    green: 'text-slate-500 hover:text-emerald-700 hover:bg-emerald-50',
    red: 'text-slate-400 hover:text-red-700 hover:bg-red-50'
  }[hover];
  const toneCls = tone === 'green'
    ? 'text-emerald-700 bg-emerald-50 border border-emerald-200 hover:bg-emerald-100'
    : tone === 'red'
    ? 'text-red-700 bg-red-50 border border-red-200 hover:bg-red-100'
    : '';
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      className={`p-1.5 rounded-lg active:scale-[0.98] transition-all cursor-pointer ${toneCls || hoverCls}`}
    >
      <span className="material-symbols-outlined text-[18px]">{icon}</span>
    </button>
  );
};

export const LogisticsTableCard: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <div className="bg-white rounded-2xl border border-slate-200 shadow-xs overflow-hidden">
    <div className="overflow-x-auto">{children}</div>
  </div>
);

export const logisticsThCls = 'py-3.5 px-3 text-white';

export const LogisticsModal: React.FC<{
  title: string;
  subtitle?: string;
  icon: string;
  badge?: string;
  onClose: () => void;
  widthCls?: string;
  children: React.ReactNode;
}> = ({ title, subtitle, icon, badge, onClose, widthCls = 'max-w-2xl', children }) => (
  <div
    className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-3 sm:p-6"
    onClick={(e) => {
      if (e.target === e.currentTarget) onClose();
    }}
  >
    <div className={`bg-white ${widthCls} w-full shadow-2xl border border-slate-400 overflow-hidden flex flex-col max-h-[94vh]`}>
      <FormModalHeader title={title} subtitle={subtitle} icon={icon} badge={badge} onClose={onClose} />
      {children}
    </div>
  </div>
);

export const LogisticsFormFooter: React.FC<{
  error?: string;
  onCancel: () => void;
  submitLabel: string;
  submitIcon?: string;
}> = ({ error, onCancel, submitLabel, submitIcon = 'save' }) => (
  <>
    {error && (
      <Notice tone="error">{error}</Notice>
    )}
    <div className="pt-3 flex items-center justify-end gap-2 border-t border-slate-200">
      <button
        type="button"
        onClick={onCancel}
        className="px-4 py-2.5 bg-slate-200 hover:bg-slate-300 text-slate-700 font-bold text-xs cursor-pointer border border-slate-300"
      >
        Cancelar
      </button>
      <button
        type="submit"
        className="px-5 py-2.5 bg-[#0b1f3a] hover:bg-[#7a0c0c] text-white font-bold text-xs flex items-center gap-2 cursor-pointer transition-colors border-none"
      >
        <span className="material-symbols-outlined text-[16px]">{submitIcon}</span>
        <span>{submitLabel}</span>
      </button>
    </div>
  </>
);

export const LogisticsDeleteModal: React.FC<{
  title: string;
  name: string;
  code: string;
  extra?: string;
  onCancel: () => void;
  onConfirm: () => void;
}> = ({ title, name, code, extra, onCancel, onConfirm }) => (
  <div data-no-resize className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4">
    <div className="bg-white max-w-md w-full shadow-2xl overflow-hidden border border-slate-300">
      <FormModalHeader title={title} icon="warning" onClose={onCancel} />
      <div className="p-6">
        <h3 className="font-headline text-lg font-bold text-slate-900 text-center">Eliminar "{name}"?</h3>
        <p className="text-xs text-slate-600 text-center mt-2 leading-relaxed">
          O registo <span className="font-mono font-bold">{code}</span> será removido da base de dados. {extra}
        </p>
      </div>
      <div className="px-6 py-4 bg-slate-50 border-t border-slate-300 flex items-center justify-end gap-2">
        <button
          type="button"
          onClick={onCancel}
          className="px-4 py-2.5 bg-slate-200 hover:bg-slate-300 text-slate-700 font-bold text-xs cursor-pointer border border-slate-300"
        >
          Cancelar
        </button>
        <button
          type="button"
          onClick={onConfirm}
          className="px-5 py-2.5 bg-[#b91c1c] hover:bg-[#7a0c0c] text-white font-bold text-xs flex items-center gap-2 cursor-pointer transition-colors border-none"
        >
          <span className="material-symbols-outlined text-[16px]">delete</span>
          <span>Eliminar</span>
        </button>
      </div>
    </div>
  </div>
);

export const formatKz = (v?: number): string =>
  v === undefined || v === null || Number.isNaN(v)
    ? '—'
    : `${new Intl.NumberFormat('pt-PT', { maximumFractionDigits: 2 }).format(v)} Kz`;

export const formatDatePt = (iso?: string): string => {
  if (!iso) return '—';
  const d = new Date(iso.length === 10 ? `${iso}T00:00:00` : iso);
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleDateString('pt-PT');
};

export const cleanText = (v?: string): string | undefined => (v && v.trim() ? v.trim() : undefined);

/** Executa uma operação de escrita através do indicador global + verificação RBAC. */
export { runGlobalOperation } from '../context/OperationContext';
