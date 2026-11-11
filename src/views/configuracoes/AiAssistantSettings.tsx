import React, { useState } from 'react';
import { AiProviders } from './AiProviders';
import { AiDocumentsPanel, WhatsappLinkPanel } from './WhatsappAiLink';

type Tab = 'chaves' | 'ligacao' | 'documentos';
const STAFF = new Set(['admin', 'director', 'secretaria', 'professor', 'financeiro', 'funcionario']);

/** Configurações → Integrações → BANDGESTÃO AI: tudo do assistente num só sítio (chaves, ligação do número e documentos). */
export const AiAssistantSettings: React.FC<{ role?: string }> = ({ role }) => {
  const isAdmin = role === 'admin';
  const [tab, setTab] = useState<Tab>(isAdmin ? 'chaves' : 'ligacao');
  if (!role || !STAFF.has(role)) {
    return <section className="bg-white p-6 rounded-2xl border border-slate-200 text-sm text-slate-600">O assistente BANDGESTÃO AI está disponível apenas para a equipa da instituição.</section>;
  }
  const tabs: Array<{ id: Tab; label: string; icon: string; show: boolean }> = [
    { id: 'chaves', label: 'Chaves de IA', icon: 'psychology', show: true },
    { id: 'ligacao', label: 'Ligação do WhatsApp', icon: 'link', show: true },
    { id: 'documentos', label: 'Documentos', icon: 'folder_open', show: true }
  ];
  return (
    <div className="flex flex-col gap-4">
      <nav className="flex flex-wrap gap-2" role="tablist">
        {tabs.filter((t) => t.show).map((t) => (
          <button key={t.id} type="button" role="tab" aria-selected={tab === t.id} onClick={() => setTab(t.id)}
            className={`flex items-center gap-1.5 px-4 py-2.5 text-xs font-extrabold border rounded-xl ${tab === t.id ? 'bg-[#0b1f3a] text-white border-[#0b1f3a]' : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50'}`}>
            <span className="material-symbols-outlined text-[18px]">{t.icon}</span>{t.label}
          </button>
        ))}
      </nav>
      {tab === 'chaves' && <AiProviders isAdmin={isAdmin} />}
      {tab === 'ligacao' && <WhatsappLinkPanel isAdmin={isAdmin} onGoToKeys={() => setTab('chaves')} />}
      {tab === 'documentos' && <AiDocumentsPanel />}
    </div>
  );
};
