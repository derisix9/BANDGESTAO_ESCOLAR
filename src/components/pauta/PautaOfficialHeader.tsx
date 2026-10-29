import React from 'react';
import { PautaHeaderModel } from '../../utils/pautaHeader';

/**
 * Cabeçalho oficial da pauta (impressão). Renderiza o MESMO modelo
 * (`buildPautaHeader`) que a exportação em Excel usa.
 */
export const PautaOfficialHeader: React.FC<{ header: PautaHeaderModel }> = ({ header }) => {
  const hideOnError = (e: React.SyntheticEvent<HTMLImageElement>) => {
    (e.currentTarget as HTMLImageElement).style.visibility = 'hidden';
  };
  const school = header.titleLines[header.titleLines.length - 1];
  const gov = header.titleLines.slice(0, -1);
  return (
    <div className="hidden print:block px-3 pt-2 pb-1 text-black">
      <div className="grid grid-cols-[1fr_auto_1fr] items-start gap-2">
        <div className="flex items-start gap-2">
          <div className="text-[8px] leading-tight font-semibold">
            {header.legend.map((l) => (
              <div key={l}>{l}</div>
            ))}
          </div>
          {header.ejaLogoUrl && (
            <img src={header.ejaLogoUrl} alt="EJA Angola" className="w-14 h-14 object-contain" onError={hideOnError} />
          )}
        </div>
        <img src={header.insigniaUrl} alt="Insígnia de Angola" className="w-14 h-12 object-contain mx-auto" onError={hideOnError} />
        <div />
      </div>

      <div className="text-center mt-0.5 text-[10px] leading-snug">
        {gov.map((l) => (
          <div key={l}>{l}</div>
        ))}
        <div className="font-bold underline">{school}</div>
      </div>

      <div
        className={`mt-1.5 text-center text-[11px] font-black tracking-wide py-0.5 ${
          header.bannerTone === 'green' ? 'bg-[#c6e0b4] text-black' : 'bg-[#2f5f8a] text-white'
        }`}
        style={{ WebkitPrintColorAdjust: 'exact', printColorAdjust: 'exact' } as React.CSSProperties}
      >
        {header.banner}
      </div>

      <div className="mt-1 flex flex-wrap items-center justify-center gap-x-4 gap-y-0.5 text-[9px] font-bold border-b border-black pb-1">
        {header.description.map((d) => (
          <span key={d.label}>
            {d.label}: <span style={{ color: '#c00000' }}>{d.value}</span>
          </span>
        ))}
      </div>
    </div>
  );
};
