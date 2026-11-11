import React, { useCallback, useEffect, useState } from 'react';
import { supabase } from '../../services/supabase';

/**
 * Configurações → Integrações → BANDGESTÃO AI.
 * Cada escola cola as SUAS chaves de IA (OpenAI, Gemini, Claude, Groq, OpenRouter; pagas ou gratuitas).
 * As chaves ficam cifradas no servidor e nunca regressam ao navegador (só os últimos 4 caracteres).
 */
type CatalogItem = { id: string; label: string; defaultModel: string; free: boolean; note: string; helpUrl: string; serverKey?: boolean };
type StoredProvider = {
  provider: string; model: string; keyHint: string; priority: number; enabled: boolean;
  lastStatus: 'untested' | 'ok' | 'error'; lastError: string | null; lastUsedAt: string | null;
};
type State = { canManage: boolean; available: number; catalog: CatalogItem[]; providers: StoredProvider[] };

async function api(init: RequestInit = {}) {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw new Error('A sessão expirou. Entre novamente no BANDGESTÃO.');
  const response = await fetch('/api/whatsapp/providers', {
    ...init,
    headers: { ...(init.headers || {}), Authorization: `Bearer ${token}`, ...(init.body ? { 'Content-Type': 'application/json' } : {}) }
  });
  let body: any = {};
  try { body = await response.json(); } catch { /* sem JSON */ }
  if (!response.ok || body?.ok === false) throw new Error(String(body?.error || 'Não foi possível concluir o pedido.'));
  return body;
}

/** Estado resumido para o cartão do hub (nº de chaves activas). */
export async function aiProvidersAvailable(): Promise<number> {
  const r = await api();
  return Number(r.available || 0);
}

const Card: React.FC<{
  item: CatalogItem; stored?: StoredProvider; busy: boolean;
  onSave: (p: { apiKey?: string; model?: string; priority?: number; enabled?: boolean }) => Promise<void>;
  onTest: () => Promise<void>; onDelete: () => Promise<void>;
}> = ({ item, stored, busy, onSave, onTest, onDelete }) => {
  const [apiKey, setApiKey] = useState('');
  const [model, setModel] = useState(stored?.model || '');
  const [priority, setPriority] = useState(stored?.priority ?? 10);
  const [open, setOpen] = useState(!stored);
  useEffect(() => { setModel(stored?.model || ''); setPriority(stored?.priority ?? 10); }, [stored?.model, stored?.priority]);

  const chip = stored
    ? stored.lastStatus === 'ok' ? <span className="px-2 py-0.5 text-[10px] font-extrabold bg-emerald-100 text-emerald-800">FUNCIONA</span>
      : stored.lastStatus === 'error' ? <span className="px-2 py-0.5 text-[10px] font-extrabold bg-red-100 text-red-800">COM ERRO</span>
      : <span className="px-2 py-0.5 text-[10px] font-extrabold bg-slate-200 text-slate-700">NÃO TESTADA</span>
    : item.serverKey ? <span className="px-2 py-0.5 text-[10px] font-extrabold bg-sky-100 text-sky-800">CHAVE GLOBAL ACTIVA</span> : null;

  return (
    <div className={`border rounded-xl bg-white ${stored?.enabled === false ? 'border-slate-200 opacity-70' : 'border-slate-300'}`}>
      <button type="button" onClick={() => setOpen((o) => !o)} className="w-full flex items-center gap-3 p-3 text-left hover:bg-slate-50 rounded-xl">
        <span className="material-symbols-outlined text-[#0b1f3a] text-2xl">{item.free ? 'redeem' : 'key'}</span>
        <div className="flex-1 min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <strong className="text-sm text-slate-900">{item.label}</strong>
            {item.free && <span className="px-2 py-0.5 text-[10px] font-extrabold bg-amber-100 text-amber-800">CHAVE GRATUITA</span>}
            {chip}
          </div>
          <span className="block text-[11px] text-slate-500 truncate">
            {stored ? `Chave ${stored.keyHint} · modelo ${stored.model} · prioridade ${stored.priority}` : item.note}
          </span>
        </div>
        <span className="material-symbols-outlined text-slate-400">{open ? 'expand_less' : 'expand_more'}</span>
      </button>
      {open && (
        <div className="p-3 pt-0 flex flex-col gap-3 border-t border-slate-100">
          <p className="text-[11px] text-slate-600 pt-3">
            {item.note} <a href={item.helpUrl} target="_blank" rel="noreferrer" className="text-blue-700 font-bold underline">Obter chave</a>
          </p>
          {stored?.lastError && <div className="p-2 text-[11px] border border-red-200 bg-red-50 text-red-800 rounded">{stored.lastError}</div>}
          <label className="flex flex-col gap-1">
            <span className="text-[11px] font-bold text-slate-700">{stored ? 'Substituir chave (deixe vazio para manter)' : 'Chave de API'}</span>
            <input type="password" autoComplete="off" spellCheck={false} value={apiKey} onChange={(e) => setApiKey(e.target.value)}
              placeholder={stored ? stored.keyHint : 'Cole aqui a chave'}
              className="w-full border border-slate-300 rounded px-3 py-2 text-sm font-mono text-slate-900 outline-none focus:border-blue-600" />
          </label>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <label className="flex flex-col gap-1 sm:col-span-2">
              <span className="text-[11px] font-bold text-slate-700">Modelo</span>
              <input type="text" value={model} onChange={(e) => setModel(e.target.value)} placeholder={item.defaultModel}
                className="w-full border border-slate-300 rounded px-3 py-2 text-sm font-mono text-slate-900 outline-none focus:border-blue-600" />
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-[11px] font-bold text-slate-700">Prioridade (1 = primeira)</span>
              <input type="number" min={1} max={99} value={priority} onChange={(e) => setPriority(Number(e.target.value))}
                className="w-full border border-slate-300 rounded px-3 py-2 text-sm text-slate-900 outline-none focus:border-blue-600" />
            </label>
          </div>
          <div className="flex flex-wrap gap-2">
            <button type="button" disabled={busy || (!stored && apiKey.trim().length < 20)}
              onClick={async () => { await onSave({ apiKey: apiKey.trim() || undefined, model: model.trim() || undefined, priority }); setApiKey(''); }}
              className="px-3 py-2 bg-[#0b1f3a] hover:bg-[#12345f] text-white text-[11px] font-extrabold disabled:opacity-50">
              {busy ? 'A PROCESSAR...' : apiKey.trim() ? 'GUARDAR E TESTAR' : 'GUARDAR ALTERAÇÕES'}
            </button>
            {stored && (
              <>
                <button type="button" disabled={busy} onClick={() => void onTest()} className="px-3 py-2 border border-slate-300 text-slate-700 text-[11px] font-bold hover:bg-slate-50 disabled:opacity-50">TESTAR</button>
                <button type="button" disabled={busy} onClick={() => void onSave({ enabled: !stored.enabled })} className="px-3 py-2 border border-slate-300 text-slate-700 text-[11px] font-bold hover:bg-slate-50 disabled:opacity-50">
                  {stored.enabled ? 'DESACTIVAR' : 'ACTIVAR'}
                </button>
                <button type="button" disabled={busy} onClick={() => { if (window.confirm(`Remover a chave de ${item.label}?`)) void onDelete(); }} className="px-3 py-2 border border-red-300 text-red-700 text-[11px] font-bold hover:bg-red-50 disabled:opacity-50">REMOVER</button>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

export const AiProviders: React.FC<{ isAdmin: boolean }> = ({ isAdmin }) => {
  const [state, setState] = useState<State | null>(null);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState('');

  const load = useCallback(async () => {
    try {
      const r = await api();
      setState({ canManage: !!r.canManage, available: Number(r.available || 0), catalog: r.catalog || [], providers: r.providers || [] });
    } catch (e) { setError(e instanceof Error ? e.message : 'Não foi possível carregar os fornecedores.'); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  const call = async (provider: string, payload: Record<string, unknown>) => {
    setBusy(provider); setError(''); setMessage('');
    try {
      const r = await api({ method: 'POST', body: JSON.stringify({ provider, ...payload }) });
      setState((cur) => cur ? { ...cur, providers: r.providers || cur.providers, available: (r.providers || []).filter((x: StoredProvider) => x.enabled).length } : cur);
      if (r.test) {
        if (r.test.ok) setMessage(`Ligação confirmada em ${(r.test.ms / 1000).toFixed(1)} s. O assistente já pode usar este fornecedor.`);
        else setError(`Chave guardada, mas o teste falhou: ${r.test.message}`);
      } else setMessage('Alterações guardadas.');
    } catch (e) { setError(e instanceof Error ? e.message : 'Não foi possível concluir o pedido.'); }
    finally { setBusy(''); }
  };

  return (
    <section className="bg-white p-6 rounded-2xl border border-slate-200 shadow-xs flex flex-col gap-3">
      <div className="p-3 bg-blue-50 border border-blue-200 rounded-xl text-[12px] text-blue-900 leading-relaxed">
        <strong>Inteligência artificial do assistente BANDGESTÃO AI (WhatsApp).</strong> Cole a chave desta escola de OpenAI, Google Gemini,
        Anthropic Claude, Groq ou OpenRouter — pagas ou <strong>gratuitas</strong>. Com várias chaves, o assistente usa a de prioridade 1 e passa
        automaticamente à seguinte se esta falhar ou esgotar a quota.
        <span className="block mt-1 text-blue-800">As chaves são cifradas no servidor e nunca voltam a ser mostradas. Em planos gratuitos, o fornecedor pode usar os dados enviados para melhorar os seus modelos: confirme os termos antes de usar dados reais de alunos.</span>
      </div>
      {error && <div className="p-3 border border-red-200 bg-red-50 text-red-800 text-sm rounded-xl" role="alert">{error}</div>}
      {message && <div className="p-3 border border-emerald-200 bg-emerald-50 text-emerald-800 text-sm rounded-xl" role="status">{message}</div>}
      {!state && !error && <p className="text-xs text-slate-500">A carregar fornecedores...</p>}
      {state && !isAdmin && <p className="text-sm text-slate-600">Só o Administrador pode alterar as chaves de IA. Fornecedores activos nesta escola: <strong>{state.available}</strong>.</p>}
      {state && isAdmin && state.canManage && state.catalog.map((item) => (
        <Card key={item.id} item={item} stored={state.providers.find((p) => p.provider === item.id)} busy={busy === item.id}
          onSave={(p) => call(item.id, { action: 'save', ...p })}
          onTest={() => call(item.id, { action: 'test' })}
          onDelete={() => call(item.id, { action: 'delete' })} />
      ))}
    </section>
  );
};
