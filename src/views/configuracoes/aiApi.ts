import { supabase } from '../../services/supabase';

/** Chamada autenticada às rotas /api/whatsapp/* (sessão do Supabase no cabeçalho Authorization). */
export async function aiApi(path: string, init: RequestInit = {}) {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw new Error('A sessão expirou. Entre novamente no BANDGESTÃO.');
  let response: Response;
  try {
    response = await fetch(path, {
      ...init,
      headers: { ...(init.headers || {}), Authorization: `Bearer ${token}`, ...(init.body ? { 'Content-Type': 'application/json' } : {}) }
    });
  } catch {
    throw new Error('Sem ligação ao servidor. Verifique a internet e tente novamente.');
  }
  let body: any = {};
  try { body = await response.json(); } catch { /* resposta sem JSON (ex.: página 404 do Vercel) */ }
  if (!response.ok || body?.ok === false) {
    if (body?.error) throw new Error(String(body.error));
    if (response.status === 404) {
      throw new Error('O serviço do assistente não foi encontrado no servidor (HTTP 404). A pasta api/whatsapp ainda não foi publicada no Vercel: confirme que os ficheiros foram enviados para o repositório e que o último deploy terminou sem erros.');
    }
    throw new Error(`Não foi possível concluir o pedido (HTTP ${response.status}).`);
  }
  return body;
}
