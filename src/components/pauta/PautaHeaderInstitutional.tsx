import React from 'react';
import { ClassRoom, Subject, InstitutionSettings } from '../../types';
import { dbService } from '../../services/db';

interface PautaHeaderInstitutionalProps {
  title: string;
  subtitle: string;
  activeClass?: ClassRoom;
  activeSubject?: Subject;
  academicYear?: string;
  hideDebtorGrades: boolean;
  debtorCount: number;
  totalStudents: number;
  settings?: InstitutionSettings;
}

export const PautaHeaderInstitutional: React.FC<PautaHeaderInstitutionalProps> = ({
  title,
  subtitle,
  activeClass,
  activeSubject,
  academicYear,
  hideDebtorGrades,
  debtorCount,
  totalStudents,
  settings
}) => {
  // Sempre reflete os Dados da Instituição definidos em Configurações
  const institution = settings || dbService.getSettings();
  const resolvedAcademicYear = academicYear || institution.currentAcademicYear;
  return (
    <div className="w-full bg-white border border-slate-300 p-4 lg:p-6 mb-4 shadow-2xs print:border-black print:p-2 print:mb-2 print:shadow-none">
      {/* Official Government & School Header */}
      <div className="flex flex-col items-center text-center pb-4 border-b border-slate-200 print:border-black print:pb-2">
        <div className="flex items-center justify-center gap-3 mb-1">
          <div className="w-10 h-10 rounded-full bg-[#0b1f3a] overflow-hidden text-amber-400 flex items-center justify-center font-bold text-base shadow-xs print:w-8 print:h-8 print:text-xs">
            <img
              src={institution.logoUrl || '/school_emblem.png'}
              alt={institution.schoolName}
              className="w-full h-full object-cover"
              referrerPolicy="no-referrer"
            />
          </div>
          <div>
            <h2 className="text-[11px] lg:text-xs font-bold uppercase tracking-widest text-slate-700 print:text-[10px] print:text-black">
              REPÚBLICA DE ANGOLA • {(institution.province || 'LUANDA').toUpperCase()}
            </h2>
            <h1 className="text-sm lg:text-base font-extrabold uppercase text-[#0b1f3a] tracking-tight print:text-xs print:text-black">
              {institution.schoolName}
            </h1>
          </div>
        </div>
        <p className="text-[10px] text-slate-500 uppercase font-semibold print:text-[9px] print:text-black">
          {institution.subTitle || 'Diário Oficial Pedagógico'}
        </p>
      </div>

      {/* Document Title Banner */}
      <div className="py-3 text-center bg-slate-50 border-b border-slate-200 print:bg-white print:border-black print:py-1.5">
        <h3 className="text-base lg:text-lg font-black uppercase text-[#7a0c0c] tracking-wide print:text-sm print:text-black">
          {title}
        </h3>
        <p className="text-xs text-slate-600 font-medium print:text-[10px] print:text-black">
          {subtitle}
        </p>
      </div>

      {/* Meta Grid */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 pt-3 text-xs text-slate-700 print:text-[9px] print:pt-1.5 print:gap-1">
        <div className="p-2 bg-slate-50 border border-slate-200 rounded-none print:border-black print:p-1 print:bg-white">
          <span className="font-bold text-slate-400 uppercase text-[9px] block print:text-black">Turma / Secção</span>
          <span className="font-bold text-slate-900 print:text-black">{activeClass?.name || 'Turma Geral'}</span>
        </div>
        <div className="p-2 bg-slate-50 border border-slate-200 rounded-none print:border-black print:p-1 print:bg-white">
          <span className="font-bold text-slate-400 uppercase text-[9px] block print:text-black">Curso / Área</span>
          <span className="font-bold text-slate-900 print:text-black">{activeClass?.area || 'Saúde & Tecnologias'}</span>
        </div>
        <div className="p-2 bg-slate-50 border border-slate-200 rounded-none print:border-black print:p-1 print:bg-white">
          <span className="font-bold text-slate-400 uppercase text-[9px] block print:text-black">Ano Lectivo / Turno</span>
          <span className="font-bold text-slate-900 print:text-black">{resolvedAcademicYear} • {activeClass?.shift || 'Manhã'}</span>
        </div>
        <div className="p-2 bg-slate-50 border border-slate-200 rounded-none print:border-black print:p-1 print:bg-white">
          <span className="font-bold text-slate-400 uppercase text-[9px] block print:text-black">
            {activeSubject ? 'Disciplina Lencionada' : 'Total de Estudantes'}
          </span>
          <span className="font-bold text-[#0b1f3a] print:text-black">
            {activeSubject ? `${activeSubject.name} (${activeSubject.code})` : `${totalStudents} Alunos Matriculados`}
          </span>
        </div>
      </div>

      {/* Financial Compliance / Debtor Notice */}
      {hideDebtorGrades && (
        <div className="mt-3 p-2 bg-amber-50 border border-amber-300 text-amber-900 text-[11px] flex items-center justify-between print:border-black print:p-1 print:text-[9px] print:bg-white print:text-black">
          <div className="flex items-center gap-1.5">
            <span className="material-symbols-outlined text-[16px] text-amber-700 print:hidden">lock</span>
            <span className="font-bold uppercase tracking-wider">Regulamento de Propinas Ativo:</span>
            <span>Notas de {debtorCount} alunos com propinas pendentes estão assinaladas como retidas ([-] RETIDO).</span>
          </div>
          <span className="font-mono font-bold text-[10px] px-1.5 py-0.5 bg-amber-200/80 text-amber-900 print:bg-transparent print:border print:border-black">
            Art. 24º R.I.
          </span>
        </div>
      )}
    </div>
  );
};
