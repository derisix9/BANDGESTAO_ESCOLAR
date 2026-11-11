import React, { useCallback, useEffect, useState } from 'react';
import type { User } from '../types';
import { supabase } from '../services/supabase';

type LinkStatus = {
  configured: boolean;
  linked: boolean;
  phone: string | null;
  businessPhone: string | null;
  aiProviders?: number;
  pairedAt?: string | null;
  lastMessageAt?: string | null;
};

type AiDocument = {
  id: string;
  type: string;
  title: string;
  filename: string;
  format?: 'pdf' | 'xlsx';
  createdAt: string;
  url: string | null;
};


interface Props {
  isOpen: boolean;
  currentUser: User;
  onClose: () => void;
}

const STAFF_ROLES = new Set(['admin', 'director', 'secretaria', 'professor', 'financeiro', 'funcionario']);

async function requestWithSession(path: string, init: RequestInit = {}) {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw new Error('A sessão expirou. Entre novamente no BANDGESTÃO.');
  const response = await fetch(path, {
    ...init,
    headers: {
      ...(init.headers || {}),
      Authorization: `Bearer ${token}`,
      ...(init.body ? { 'Content-Type': 'application/json' } : {})
    }
  });
  let body: any = {};
  try { body = await response.json(); } catch { /* erro sem JSON */ }
  if (!response.ok || body?.ok === false) throw new Error(String(body?.error || 'Não foi possível concluir o pedido.'));
  return body;
}

type Tab = 'ligacao' | 'documentos';

export const WhatsappAiLinkModal: React.FC<Props> = ({ isOpen, currentUser, onClose }) => {
  const [tab, setTab] = useState<Tab>('ligacao');
  const [status, setStatus] = useState<LinkStatus | null>(null);
  const [documents, setDocuments] = useState<AiDocument[]>([]);
  const [phone, setPhone] = useState(currentUser.phone || '');
  const [pairingCode, setPairingCode] = useState('');
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [unlinking, setUnlinking] = useState(false);

  const isAdmin = currentUser.role === 'admin';

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const [s, d] = await Promise.all([
        requestWithSession('/api/whatsapp/link'),
        requestWithSession('/api/whatsapp/documents').catch(() => ({ documents: [] }))
      ]);
      setStatus(s);
      setDocuments(Array.isArray(d.documents) ? d.documents : []);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Não foi possível carregar o estado do assistente.');
    } finally { setLoading(false); }
  }, []);

  useEffect(() => {
    if (isOpen) {
      setTab('ligacao');
      setPhone(currentUser.phone || '');
      setPairingCode('');
      setMessage('');
      void load();
    }
  }, [isOpen, currentUser.phone, load]);

  if (!isOpen || !STAFF_ROLES.has(currentUser.role)) return null;

  const generateCode = async () => {
    setLoading(true); setError(''); setMessage(''); setPairingCode('');
    try {
      const result = await requestWithSession('/api/whatsapp/link', {
        method: 'POST', body: JSON.stringify({ action: 'generate', phone })
      });
      setPairingCode(String(result.code || ''));
      setStatus((s) => s ? { ...s, configured: true, businessPhone: result.businessPhone || s.businessPhone } : s);
      setMessage('Código criado. Envie a mensagem indicada pelo WhatsApp que pretende associar.');
    } catch (e) { setError(e instanceof Error ? e.message : 'Não foi possível gerar o código.'); }
    finally { setLoading(false); }
  };

  const unlink = async () => {
    setUnlinking(true); setError('');
    try {
      await requestWithSession('/api/whatsapp/link', { method: 'POST', body: JSON.stringify({ action: 'unlink' }) });
      setPairingCode(''); setMessage('O número foi desligado desta conta.');
      await load();
    } catch (e) { setError(e instanceof Error ? e.message : 'Não foi possível desligar o número.'); }
    finally { setUnlinking(false); }
  };

  const tabs: Array<{ id: Tab; label: string; icon: string; show: boolean }> = [
    { id: 'ligacao', label: 'Ligação', icon: 'link', show: true },
    { id: 'documentos', label: 'Documentos', icon: 'folder_open', show: true }
  ];

  return (
    <div className="fixed inset-0 z-[120] flex items-center justify-center bg-slate-950/65 p-3 sm:p-6" role="presentation" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <section className="w-full max-w-2xl max-h-[92vh] overflow-y-auto bg-white border border-slate-200 shadow-2xl rounded-xl" role="dialog" aria-modal="true" aria-labelledby="whatsapp-ai-title">
        <header className="sticky top-0 z-10 flex items-center gap-3 p-5 bg-[#0b1f3a] text-white">
          <div className="w-11 h-11 flex items-center justify-center bg-white/15 border border-white/20 rounded-lg">
            <span className="material-symbols-outlined text-[26px]">smart_toy</span>
          </div>
          <div className="flex-1 min-w-0">
            <h2 id="whatsapp-ai-title" className="font-headline font-extrabold text-lg">BANDGESTÃO AI</h2>
            <p className="text-xs text-blue-100">Assistente de gestão pelo WhatsApp</p>
          </div>
          <button type="button" onClick={onClose} className="w-9 h-9 flex items-center justify-center bg-white/10 hover:bg-white/20 rounded-lg" aria-label="Fechar">
            <span className="material-symbols-outlined">close</span>
          </button>
        </header>

        <nav className="flex border-b border-slate-200 bg-slate-50 overflow-x-auto" role="tablist">
          {tabs.filter((t) => t.show).map((t) => (
            <button key={t.id} type="button" role="tab" aria-selected={tab === t.id} onClick={() => setTab(t.id)}
              className={`flex items-center gap-1.5 px-4 py-3 text-xs font-extrabold whitespace-nowrap border-b-2 ${tab === t.id ? 'border-[#0b1f3a] text-[#0b1f3a] bg-white' : 'border-transparent text-slate-500 hover:text-slate-800'}`}>
              <span className="material-symbols-outlined text-[18px]">{t.icon}</span>{t.label}
            </button>
          ))}
        </nav>

        <div className="p-5 flex flex-col gap-5">
          {error && <div className="p-3 border border-red-200 bg-red-50 text-red-800 text-sm" role="alert">{error}</div>}
          {message && <div className="p-3 border border-emerald-200 bg-emerald-50 text-emerald-800 text-sm" role="status">{message}</div>}
          {loading && !status && <div className="py-8 text-center text-sm text-slate-500">A consultar a configuração segura...</div>}

          {tab === 'ligacao' && (
            <>
              {status && !status.configured && (
                <div className="p-4 border border-amber-200 bg-amber-50 text-amber-900 text-sm flex gap-3">
                  <span className="material-symbols-outlined text-[22px]">settings</span>
                  <div>
                    <strong className="block mb-1">Canal WhatsApp ainda não configurado no servidor</strong>
                    O responsável técnico deve configurar as credenciais da Meta (WhatsApp) e do Supabase nas variáveis do Vercel e aplicar as migrações da base de dados.
                  </div>
                </div>
              )}

              {status?.configured && status.aiProviders === 0 && (
                <div className="p-4 border border-amber-200 bg-amber-50 text-amber-900 text-sm flex gap-3">
                  <span className="material-symbols-outlined text-[22px]">psychology</span>
                  <div>
                    <strong className="block mb-1">Falta uma chave de inteligência artificial</strong>
                    {isAdmin
                      ? 'Abra Configurações → Integrações → BANDGESTÃO AI e cole uma chave. Há opções gratuitas, como o Google Gemini.'
                      : 'Peça ao Administrador para adicionar uma chave em Configurações → Integrações → BANDGESTÃO AI.'}
                  </div>
                </div>
              )}

              {status?.configured && status.linked && (
                <div className="p-4 border border-emerald-200 bg-emerald-50 flex flex-col sm:flex-row sm:items-center gap-3">
                  <span className="material-symbols-outlined text-emerald-700 text-3xl">verified</span>
                  <div className="flex-1">
                    <strong className="block text-emerald-900">WhatsApp associado</strong>
                    <span className="text-sm text-emerald-800">Número: {status.phone}</span>
                    {status.lastMessageAt && <span className="block text-[11px] text-emerald-700">Última mensagem: {new Date(status.lastMessageAt).toLocaleString('pt-PT')}</span>}
                  </div>
                  <button type="button" disabled={unlinking} onClick={unlink} className="px-3 py-2 bg-red-600 hover:bg-red-700 text-white text-xs font-extrabold disabled:opacity-50">
                    {unlinking ? 'A DESLIGAR...' : 'DESLIGAR NÚMERO'}
                  </button>
                </div>
              )}

              {status?.configured && !status.linked && (
                <div className="flex flex-col gap-3">
                  <div>
                    <h3 className="font-bold text-slate-900">1. Indique o seu número WhatsApp</h3>
                    <p className="text-xs text-slate-500 mt-1">Use o formato internacional, com indicativo do país. Exemplo: +244923000000.</p>
                  </div>
                  <input type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="+244923000000" autoComplete="tel" className="w-full border border-slate-300 px-3 py-3 text-sm font-mono text-slate-900 outline-none focus:border-blue-600 focus:ring-2 focus:ring-blue-100" />
                  <button type="button" disabled={loading || phone.replace(/\D/g, '').length < 8} onClick={generateCode} className="self-start px-4 py-3 bg-[#0b1f3a] hover:bg-[#12345f] text-white font-extrabold text-xs disabled:opacity-50">
                    {loading ? 'A GERAR CÓDIGO...' : 'GERAR CÓDIGO DE LIGAÇÃO'}
                  </button>
                  {pairingCode && (
                    <div className="p-4 bg-blue-50 border border-blue-200 flex flex-col gap-2">
                      <span className="text-xs font-bold text-blue-900">2. Envie esta mensagem do seu WhatsApp:</span>
                      <div className="bg-white border border-blue-200 p-3 flex items-center justify-between gap-3">
                        <code className="text-xl sm:text-2xl font-extrabold tracking-widest text-blue-900">LIGAR {pairingCode}</code>
                        <button type="button" onClick={() => { void navigator.clipboard?.writeText(`LIGAR ${pairingCode}`); }} className="px-3 py-2 bg-blue-700 text-white text-[10px] font-bold">COPIAR</button>
                      </div>
                      <p className="text-xs text-blue-800">Envie para o número oficial {status.businessPhone || 'do BANDGESTÃO AI'} dentro de 10 minutos. A ligação só fica activa depois de recebermos a mensagem do mesmo número que indicou.</p>
                    </div>
                  )}
                </div>
              )}

              <div className="p-3 bg-slate-50 border border-slate-200 text-[11px] text-slate-600 leading-relaxed">
                <strong>O que pode pedir:</strong> totais e estatísticas de alunos e turmas, resumo financeiro, alunos com propinas em atraso, despesas, pesquisa de registos e relatórios em PDF ou Excel. Escreva <strong>AJUDA</strong> no WhatsApp para ver exemplos.<br />
                <strong>Segurança:</strong> o assistente respeita as permissões do seu perfil e a escola activa. Consulta dados e emite relatórios; não altera registos nem regista pagamentos.
              </div>
            </>
          )}

          {tab === 'documentos' && (
            <div>
              <div className="flex items-center justify-between gap-3 mb-2">
                <div>
                  <h3 className="font-bold text-slate-900">Documentos emitidos pelo assistente</h3>
                  <p className="text-xs text-slate-500">Os PDFs e Excel ficam arquivados na instituição e podem ser abertos novamente.</p>
                </div>
                <button type="button" onClick={() => void load()} className="px-3 py-2 border border-slate-300 text-slate-700 text-[10px] font-bold hover:bg-slate-50">ACTUALIZAR</button>
              </div>
              {documents.length === 0 ? (
                <p className="text-xs text-slate-500 py-3">Ainda não existem documentos emitidos pelo BANDGESTÃO AI nesta conta.</p>
              ) : (
                <div className="divide-y divide-slate-100 border border-slate-200">
                  {documents.map((doc) => (
                    <div key={doc.id} className="flex items-center gap-3 p-3">
                      <span className={`material-symbols-outlined text-2xl ${doc.format === 'xlsx' ? 'text-emerald-700' : 'text-red-600'}`}>{doc.format === 'xlsx' ? 'table_chart' : 'picture_as_pdf'}</span>
                      <div className="flex-1 min-w-0">
                        <strong className="block text-xs text-slate-800 truncate">{doc.title}</strong>
                        <span className="block text-[10px] text-slate-500">{doc.filename} · {new Date(doc.createdAt).toLocaleDateString('pt-PT')}</span>
                      </div>
                      {doc.url && <a href={doc.url} target="_blank" rel="noreferrer" className="px-3 py-2 bg-[#0b1f3a] text-white text-[10px] font-bold">{doc.format === 'xlsx' ? 'DESCARREGAR' : 'ABRIR PDF'}</a>}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      </section>
    </div>
  );
};
