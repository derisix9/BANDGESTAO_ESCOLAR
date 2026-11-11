import React, { useCallback, useEffect, useState } from 'react';
import { aiApi } from './aiApi';

type LinkStatus = {
  configured: boolean; linked: boolean; phone: string | null; businessPhone: string | null;
  aiProviders?: number; pairedAt?: string | null; lastMessageAt?: string | null;
};
type AiDocument = { id: string; type: string; title: string; filename: string; format?: 'pdf' | 'xlsx'; createdAt: string; url: string | null };

/** Integrações → BANDGESTÃO AI → Ligação do WhatsApp: associa o número do utilizador à sua conta por código. */
export const WhatsappLinkPanel: React.FC<{ onGoToKeys: () => void; isAdmin: boolean }> = ({ onGoToKeys, isAdmin }) => {
  const [status, setStatus] = useState<LinkStatus | null>(null);
  const [phone, setPhone] = useState('');
  const [code, setCode] = useState('');
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true); setError('');
    try { setStatus(await aiApi('/api/whatsapp/link')); }
    catch (e) { setError(e instanceof Error ? e.message : 'Não foi possível carregar o estado da ligação.'); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  const generate = async () => {
    setLoading(true); setError(''); setMessage(''); setCode('');
    try {
      const r = await aiApi('/api/whatsapp/link', { method: 'POST', body: JSON.stringify({ action: 'generate', phone }) });
      setCode(String(r.code || ''));
      setStatus((s) => s ? { ...s, configured: true, businessPhone: r.businessPhone || s.businessPhone } : s);
      setMessage('Código criado. Envie a mensagem indicada pelo WhatsApp que pretende associar.');
    } catch (e) { setError(e instanceof Error ? e.message : 'Não foi possível gerar o código.'); }
    finally { setLoading(false); }
  };

  const unlink = async () => {
    setLoading(true); setError('');
    try {
      await aiApi('/api/whatsapp/link', { method: 'POST', body: JSON.stringify({ action: 'unlink' }) });
      setCode(''); setMessage('O número foi desligado desta conta.');
      await load();
    } catch (e) { setError(e instanceof Error ? e.message : 'Não foi possível desligar o número.'); }
    finally { setLoading(false); }
  };

  return (
    <section className="bg-white p-6 rounded-2xl border border-slate-200 shadow-xs flex flex-col gap-4">
      {error && <div className="p-3 border border-red-200 bg-red-50 text-red-800 text-sm rounded-xl" role="alert">{error}</div>}
      {message && <div className="p-3 border border-emerald-200 bg-emerald-50 text-emerald-800 text-sm rounded-xl" role="status">{message}</div>}
      {loading && !status && <p className="text-sm text-slate-500">A consultar a configuração segura...</p>}

      {status && !status.configured && (
        <div className="p-4 border border-amber-200 bg-amber-50 text-amber-900 text-sm rounded-xl">
          <strong className="block mb-1">Canal WhatsApp ainda não configurado no servidor</strong>
          O responsável técnico deve configurar as credenciais da Meta (WhatsApp) e do Supabase nas variáveis do Vercel e aplicar as migrações 0048 e 0049.
        </div>
      )}

      {status?.configured && status.aiProviders === 0 && (
        <div className="p-4 border border-amber-200 bg-amber-50 text-amber-900 text-sm rounded-xl">
          <strong className="block mb-1">Falta uma chave de inteligência artificial</strong>
          {isAdmin
            ? <>Adicione uma chave no separador <button type="button" className="underline font-bold" onClick={onGoToKeys}>Chaves de IA</button>. Há opções gratuitas, como o Google Gemini.</>
            : 'Peça ao Administrador para adicionar uma chave em Integrações → BANDGESTÃO AI → Chaves de IA.'}
        </div>
      )}

      {status?.configured && status.linked && (
        <div className="p-4 border border-emerald-200 bg-emerald-50 rounded-xl flex flex-col sm:flex-row sm:items-center gap-3">
          <span className="material-symbols-outlined text-emerald-700 text-3xl">verified</span>
          <div className="flex-1">
            <strong className="block text-emerald-900">WhatsApp associado</strong>
            <span className="text-sm text-emerald-800">Número: {status.phone}</span>
            {status.lastMessageAt && <span className="block text-[11px] text-emerald-700">Última mensagem: {new Date(status.lastMessageAt).toLocaleString('pt-PT')}</span>}
          </div>
          <button type="button" disabled={loading} onClick={unlink} className="px-3 py-2 bg-red-600 hover:bg-red-700 text-white text-xs font-extrabold disabled:opacity-50">DESLIGAR NÚMERO</button>
        </div>
      )}

      {status?.configured && !status.linked && (
        <div className="flex flex-col gap-3">
          <div>
            <h3 className="font-bold text-slate-900">1. Indique o seu número WhatsApp</h3>
            <p className="text-xs text-slate-500 mt-1">Formato internacional, com indicativo do país. Exemplo: +244923000000.</p>
          </div>
          <input type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="+244923000000" autoComplete="tel"
            className="w-full border border-slate-300 rounded px-3 py-3 text-sm font-mono text-slate-900 outline-none focus:border-blue-600" />
          <button type="button" disabled={loading || phone.replace(/\D/g, '').length < 8} onClick={generate}
            className="self-start px-4 py-3 bg-[#0b1f3a] hover:bg-[#12345f] text-white font-extrabold text-xs disabled:opacity-50">
            {loading ? 'A GERAR CÓDIGO...' : 'GERAR CÓDIGO DE LIGAÇÃO'}
          </button>
          {code && (
            <div className="p-4 bg-blue-50 border border-blue-200 rounded-xl flex flex-col gap-2">
              <span className="text-xs font-bold text-blue-900">2. Envie esta mensagem do seu WhatsApp:</span>
              <div className="bg-white border border-blue-200 p-3 flex items-center justify-between gap-3">
                <code className="text-xl sm:text-2xl font-extrabold tracking-widest text-blue-900">LIGAR {code}</code>
                <button type="button" onClick={() => { void navigator.clipboard?.writeText(`LIGAR ${code}`); }} className="px-3 py-2 bg-blue-700 text-white text-[10px] font-bold">COPIAR</button>
              </div>
              <p className="text-xs text-blue-800">Envie para o número oficial {status.businessPhone || 'do BANDGESTÃO AI'} dentro de 10 minutos. A ligação só fica activa depois de recebermos a mensagem do mesmo número que indicou.</p>
            </div>
          )}
        </div>
      )}

      <div className="p-3 bg-slate-50 border border-slate-200 rounded-xl text-[11px] text-slate-600 leading-relaxed">
        <strong>O que pode pedir:</strong> totais e estatísticas de alunos e turmas, resumo financeiro, alunos com propinas em atraso, despesas, pesquisa de registos e relatórios em PDF ou Excel. Escreva <strong>AJUDA</strong> no WhatsApp para ver exemplos.<br />
        <strong>Segurança:</strong> o assistente respeita as permissões do seu perfil e a escola activa. Consulta dados e emite relatórios; não altera registos nem regista pagamentos.
      </div>
    </section>
  );
};

/** Integrações → BANDGESTÃO AI → Documentos: arquivo dos PDF/Excel emitidos pelo assistente. */
export const AiDocumentsPanel: React.FC = () => {
  const [docs, setDocs] = useState<AiDocument[]>([]);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const load = useCallback(async () => {
    setLoading(true); setError('');
    try { const r = await aiApi('/api/whatsapp/documents'); setDocs(Array.isArray(r.documents) ? r.documents : []); }
    catch (e) { setError(e instanceof Error ? e.message : 'Não foi possível carregar os documentos.'); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  return (
    <section className="bg-white p-6 rounded-2xl border border-slate-200 shadow-xs flex flex-col gap-3">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h3 className="font-bold text-slate-900">Documentos emitidos pelo assistente</h3>
          <p className="text-xs text-slate-500">Os PDF e Excel ficam arquivados na instituição e podem ser abertos novamente.</p>
        </div>
        <button type="button" onClick={() => void load()} className="px-3 py-2 border border-slate-300 text-slate-700 text-[10px] font-bold hover:bg-slate-50">{loading ? 'A CARREGAR...' : 'ACTUALIZAR'}</button>
      </div>
      {error && <div className="p-3 border border-red-200 bg-red-50 text-red-800 text-sm rounded-xl" role="alert">{error}</div>}
      {!error && docs.length === 0 && !loading && <p className="text-xs text-slate-500 py-2">Ainda não existem documentos emitidos pelo BANDGESTÃO AI nesta conta.</p>}
      {docs.length > 0 && (
        <div className="divide-y divide-slate-100 border border-slate-200 rounded-xl overflow-hidden">
          {docs.map((d) => (
            <div key={d.id} className="flex items-center gap-3 p-3">
              <span className={`material-symbols-outlined text-2xl ${d.format === 'xlsx' ? 'text-emerald-700' : 'text-red-600'}`}>{d.format === 'xlsx' ? 'table_chart' : 'picture_as_pdf'}</span>
              <div className="flex-1 min-w-0">
                <strong className="block text-xs text-slate-800 truncate">{d.title}</strong>
                <span className="block text-[10px] text-slate-500">{d.filename} · {new Date(d.createdAt).toLocaleDateString('pt-PT')}</span>
              </div>
              {d.url && <a href={d.url} target="_blank" rel="noreferrer" className="px-3 py-2 bg-[#0b1f3a] text-white text-[10px] font-bold">{d.format === 'xlsx' ? 'DESCARREGAR' : 'ABRIR PDF'}</a>}
            </div>
          ))}
        </div>
      )}
    </section>
  );
};
