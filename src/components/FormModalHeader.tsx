import React from 'react';

export interface FormModalHeaderProps {
  title: string;
  subtitle?: string;
  icon?: string;
  onClose: () => void;
  badge?: string;
}

export const FormModalHeader: React.FC<FormModalHeaderProps> = ({
  title,
  subtitle,
  icon = 'edit_note',
  onClose,
  badge
}) => {
  return (
    <div className="px-6 py-4 bg-[#0b1f3a] text-white flex items-center justify-between border-b border-[#0b1f3a] shrink-0">
      <div className="flex items-center gap-3 min-w-0 flex-1">
        <div className="w-9 h-9 rounded-none bg-white/10 flex items-center justify-center text-white shrink-0">
          <span className="material-symbols-outlined text-[22px]">{icon}</span>
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 min-w-0">
            <h3 className="font-bold text-base text-white tracking-tight truncate min-w-0">{title}</h3>
            {badge && (
              <span className="px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider bg-[#7a0c0c] text-white rounded-none shrink-0">
                {badge}
              </span>
            )}
          </div>
          {subtitle && <p className="text-xs text-blue-200 truncate mt-0.5">{subtitle}</p>}
        </div>
      </div>
      <button
        type="button"
        onClick={onClose}
        className="text-slate-300 hover:text-white p-1 hover:bg-white/10 transition-colors cursor-pointer rounded-none ml-2 shrink-0"
        title="Fechar"
      >
        <span className="material-symbols-outlined text-[20px]">close</span>
      </button>
    </div>
  );
};
