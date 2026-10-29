import React from 'react';
import type { Funcionario, InstitutionSettings } from '../types';
import { CARGO_LABELS } from './FuncionarioFormModal';

export const FUNC_STATUS_LABEL: Record<Funcionario['status'], string> = {
  ativo: 'Ativo no Quadro',
  licenca: 'Em Licença / Afastamento',
  inativo: 'Inativo'
};

interface Props {
  funcionario: Funcionario;
  onClose: () => void;
  settings?: InstitutionSettings;
  /** Mostra a remuneração e dados bancários (só para quem gere funcionários). */
  canSeePay?: boolean;
}

const kz = (n?: number) => (typeof n === 'number' ? `${n.toLocaleString('pt-PT')} Kz` : '—');

const Field: React.FC<{ label: string; value?: React.ReactNode; mono?: boolean }> = ({ label, value, mono }) => (
  <div>
    <span className="block uppercase font-bold text-[10px] text-slate-400">{label}</span>
    <span className={`font-bold text-slate-900 break-words ${mono ? 'font-mono' : ''}`}>{value || '—'}</span>
  </div>
);

const Section: React.FC<{ icon: string; title: string; children: React.ReactNode }> = ({ icon, title, children }) => (
  <section className="border border-slate-300 print-break-avoid">
    <div className="px-3 py-1.5 bg-slate-100 border-b border-slate-300 flex items-center gap-2">
      <span className="material-symbols-outlined text-[16px] text-[#0b1f3a]">{icon}</span>
      <h4 className="text-[11px] font-extrabold uppercase tracking-wide text-[#0b1f3a]">{title}</h4>
    </div>
    <div className="p-3 grid grid-cols-1 sm:grid-cols-3 gap-x-4 gap-y-3 text-xs">{children}</div>
  </section>
);

export const FuncionarioProfileModal: React.FC<Props> = ({ funcionario: f, onClose, settings, canSeePay }) => {
  const cargo = f.cargo === 'outro' ? f.cargoOutroDescricao || 'Outro' : CARGO_LABELS[f.cargo] || f.cargo;
  const initials = f.name.split(' ').filter(Boolean).slice(0, 2).map((p) => p[0]).join('').toUpperCase();
  const statusTone = f.status === 'ativo' ? 'bg-emerald-50 text-emerald-700 border-emerald-300' : f.status === 'licenca' ? 'bg-amber-50 text-amber-800 border-amber-300' : 'bg-slate-100 text-slate-600 border-slate-300';

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-xs z-50 flex items-start justify-center p-3 sm:p-4 printable-modal-overlay overflow-y-auto print:p-0 print:m-0 print:block">
      <style>{`@media print { @page { size: A4 portrait !important; margin: 8mm 8mm !important; } }`}</style>
      <div className="printable-document printable-portrait bg-white max-w-4xl w-full shadow-2xl border border-slate-400 overflow-hidden flex flex-col my-4 print:my-0 print:border-none">
        <div className="px-6 py-3 bg-[#0b1f3a] text-white flex items-center justify-between gap-3 border-b border-slate-700 no-print">
          <div className="flex items-center gap-2">
            <span className="material-symbols-outlined text-[20px] text-amber-400">badge</span>
            <h3 className="font-bold text-sm sm:text-base tracking-wide uppercase">Ficha de Perfil do Funcionário</h3>
          </div>
          <div className="flex items-center gap-2">
            <button type="button" onClick={() => window.print()} className="px-3 py-1 text-xs font-bold bg-white/10 hover:bg-white/20 border border-white/30 cursor-pointer flex items-center gap-1" title="Imprimir ficha">
              <span className="material-symbols-outlined text-[16px]">print</span> Imprimir
            </button>
            <button type="button" onClick={onClose} className="text-slate-300 hover:text-white p-1 cursor-pointer" title="Fechar Janela" aria-label="Fechar Janela">
              <span className="material-symbols-outlined text-[22px]">close</span>
            </button>
          </div>
        </div>

        <div className="p-5 space-y-4 text-slate-800">
          <div className="text-center border-b border-slate-300 pb-3">
            <p className="text-[10px] font-bold uppercase tracking-widest text-slate-500">República de Angola · Ministério da Educação</p>
            <p className="text-sm font-black uppercase text-[#0b1f3a]">{settings?.schoolName || 'Instituição de Ensino'}</p>
            <p className="text-xs font-extrabold uppercase text-slate-700 mt-1">Ficha de Cadastro do Funcionário</p>
          </div>

          <div className="p-3.5 bg-slate-50 border border-slate-300 flex items-center gap-3.5 print-break-avoid">
            <div className="w-16 h-20 bg-[#0b1f3a] border-2 border-[#0b1f3a] overflow-hidden shrink-0 relative flex items-center justify-center text-white font-extrabold text-lg">
              {initials}
              {f.avatar && <img src={f.avatar} alt={f.name} className="absolute inset-0 w-full h-full object-cover" onError={(e) => { (e.target as HTMLElement).style.display = 'none'; }} />}
            </div>
            <div className="flex-1">
              <h2 className="text-base sm:text-lg font-black text-[#0b1f3a]">{f.name}</h2>
              <p className="text-xs font-semibold text-slate-600">{cargo}{f.department ? ` · ${f.department}` : ''}</p>
              <div className="mt-1 flex flex-wrap items-center gap-2">
                <span className="px-2 py-0.5 bg-white border border-slate-300 font-mono text-[11px] font-bold">{f.employeeNumber}</span>
                <span className={`px-2 py-0.5 text-[10px] font-bold uppercase border ${statusTone}`}>{FUNC_STATUS_LABEL[f.status]}</span>
              </div>
            </div>
          </div>

          <Section icon="work" title="Vínculo e Função">
            <Field label="Cargo / Função" value={cargo} />
            <Field label="Departamento" value={f.department} />
            <Field label="Estado de Vínculo" value={FUNC_STATUS_LABEL[f.status]} />
            <Field label="Data de Admissão" value={f.admissionDate} />
            <Field label="N.º de Funcionário" value={f.employeeNumber} mono />
            <Field label="N.º INSS" value={f.inssNumber} mono />
          </Section>

          <Section icon="person" title="Dados Pessoais">
            <Field label="B.I." value={f.biNumber} mono />
            <Field label="NIF" value={f.nif} mono />
            <Field label="Género" value={f.gender} />
            <Field label="Data de Nascimento" value={f.birthDate} />
            <Field label="Naturalidade" value={f.birthPlace} />
            <Field label="Estado Civil" value={f.maritalStatus} />
            <Field label="Nacionalidade" value={f.nationality} />
          </Section>

          <Section icon="contact_phone" title="Contactos e Morada">
            <Field label="Telefone" value={f.phone} mono />
            <Field label="E-mail" value={f.email} />
            <Field label="Morada" value={f.address} />
            <Field label="Contacto de Emergência" value={f.emergencyContactName} />
            <Field label="Telefone de Emergência" value={f.emergencyContactPhone} mono />
          </Section>

          {canSeePay && (
            <Section icon="payments" title="Remuneração e Dados Bancários">
              <Field label="Salário Base" value={kz(f.baseSalaryKz)} mono />
              <Field label="Subsídios" value={kz(f.allowancesKz)} mono />
              <Field label="Retenção (IRT)" value={kz(f.retentionTaxKz)} mono />
              <Field label="Banco" value={f.bankName} />
              <Field label="IBAN" value={f.iban} mono />
            </Section>
          )}

          {f.bio && (
            <section className="border border-slate-300 p-3 text-xs">
              <span className="block uppercase font-bold text-[10px] text-slate-400 mb-1">Observações</span>
              <p className="text-slate-700 whitespace-pre-line">{f.bio}</p>
            </section>
          )}
        </div>
      </div>
    </div>
  );
};
