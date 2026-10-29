// Lista de IPs autorizados nas Edge Functions (migração 0043). Mesmo critério da RLS: a decisão está na base de dados
// (public.edge_ip_allowed), o IP vem do cabeçalho que o Cloudflare/Supabase acrescenta (o cliente não o forja).
// NÃO se usa o início de x-forwarded-for: pode ser escrito pelo cliente.
import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4';

export function requestIp(req: Request): string | null {
  const v = (req.headers.get('cf-connecting-ip') ?? req.headers.get('x-real-ip') ?? '').trim();
  return v && v.length <= 45 ? v : null;
}

/** true = pode continuar. Falha FECHADA: se a verificação der erro, recusa. */
export async function ipAllowed(admin: SupabaseClient, uid: string, req: Request): Promise<boolean> {
  const { data, error } = await admin.rpc('edge_ip_allowed', { p_uid: uid, p_ip: requestIp(req) });
  if (error) { console.error('ipGuard', error.message); return false; }
  return data === true;
}

export const IP_DENIED_MESSAGE = 'Acesso recusado: rede não autorizada ou palavra-passe por renovar. Inicie sessão novamente.';
