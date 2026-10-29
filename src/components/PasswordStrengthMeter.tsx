import React from 'react';
import { passwordStrength } from '../utils/passwordStrength';

/** Barra de força em 4 segmentos com cor e etiqueta (Baixo / Normal / Forte / Muito forte) + lista de requisitos. */
export const PasswordStrengthMeter: React.FC<{ password: string; showDetails?: boolean }> = ({ password, showDetails = true }) => {
  const s = passwordStrength(password);
  if (!password) return null;
  return (
    <div className="mt-2" aria-live="polite">
      <div className="flex items-center gap-1.5">
        <div className="flex-1 grid grid-cols-4 gap-1" role="progressbar" aria-valuemin={0} aria-valuemax={4} aria-valuenow={s.level} aria-label="Força da palavra-passe">
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="h-1.5 rounded-full transition-all duration-300" style={{ background: i <= s.level ? s.color : '#e2e8f0' }} />
          ))}
        </div>
        <span className="text-[11px] font-bold w-[78px] text-right" style={{ color: s.textColor }}>{s.label}</span>
      </div>
      {showDetails && (
      <ul className="mt-1.5 space-y-0.5">
        {s.checks.map((c) => (
          <li key={c.text} className={`text-[10.5px] flex items-center gap-1 ${c.ok ? 'text-emerald-700' : 'text-slate-500'}`}>
            <span className="material-symbols-outlined text-[13px]">{c.ok ? 'check_circle' : 'radio_button_unchecked'}</span>
            {c.text}
          </li>
        ))}
      </ul>
      )}
    </div>
  );
};
