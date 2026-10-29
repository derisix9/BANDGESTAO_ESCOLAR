// delete-user — versão num só ficheiro, para colar no editor do painel do Supabase.
// Elimina de verdade uma conta (Auth + perfil). Só o administrador, e só contas da SUA escola.
// Deixe "Enforce JWT Verification" LIGADO nesta função.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4';

// ---- Lista de IPs autorizados (antes em _shared/ipGuard.ts; migração 0043) ----
function requestIp(req: Request): string | null {
  const v = (req.headers.get('cf-connecting-ip') ?? req.headers.get('x-real-ip') ?? '').trim();
  return v && v.length <= 45 ? v : null;
}
async function ipAllowed(admin: any, uid: string, req: Request): Promise<boolean> {
  const { data, error } = await admin.rpc('edge_ip_allowed', { p_uid: uid, p_ip: requestIp(req) });
  if (error) { console.error('ipGuard', error.message); return false; }
  return data === true;
}
const IP_DENIED_MESSAGE = 'Acesso recusado: rede não autorizada ou palavra-passe por renovar. Inicie sessão novamente.';


// CORS fechado por omissão: só a origem definida em ALLOWED_ORIGIN (ex.: supabase secrets set ALLOWED_ORIGIN=https://bandgestao.vercel.app).
// "*" só se for pedido de forma explícita (ALLOWED_ORIGIN=*) ou em desenvolvimento local. Sem o segredo em produção, o navegador bloqueia (origem "null").
function allowedOrigin(): string {
  const o = (Deno.env.get('ALLOWED_ORIGIN') ?? '').trim();
  if (o === '*') return '*';
  if (o) return o.replace(/\/+$/, '');
  if (/^https?:\/\/(127\.0\.0\.1|localhost|kong)\b/.test(Deno.env.get('SUPABASE_URL') ?? '')) return '*';
  console.warn('ALLOWED_ORIGIN não definido: pedidos do navegador serão bloqueados. Defina o segredo ALLOWED_ORIGIN.');
  return 'null';
}
// ---- CORS (antes em _shared/cors.ts) ----
const cors = {
  'Access-Control-Allow-Origin': allowedOrigin(),
  'Vary': 'Origin',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-api-version',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Max-Age': '86400'
};
const preflight = () => new Response(null, { status: 204, headers: cors });
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });

// ---- Função ----
Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return preflight();
  if (req.method !== 'POST') return json({ error: 'Método não permitido' }, 405);

  const url = Deno.env.get('SUPABASE_URL')!;
  const caller = createClient(url, Deno.env.get('SUPABASE_ANON_KEY')!, {
    global: { headers: { Authorization: req.headers.get('Authorization') ?? '' } }
  });
  const { data: u } = await caller.auth.getUser();
  if (!u?.user) return json({ error: 'Sessão inválida' }, 401);

  const admin = createClient(url, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
  const { data: me } = await admin.from('profiles').select('institution_id, role, active').eq('id', u.user.id).single();
  if (!me || !me.active || me.role !== 'admin') return json({ error: 'Só o administrador elimina contas' }, 403);
  if (!(await ipAllowed(admin, u.user.id, req))) return json({ error: IP_DENIED_MESSAGE }, 403);

  // Escola ativa do administrador (mãe ou filial — migração 0024).
  const { data: activeInst } = await admin.rpc('resolve_institution', { p_uid: u.user.id });
  const instId: string = (typeof activeInst === 'string' && activeInst) ? activeInst : me.institution_id;

  const b = await req.json().catch(() => ({}));
  const id = String(b.id ?? '');
  if (!/^[0-9a-f-]{36}$/i.test(id)) return json({ error: 'Conta inválida' }, 400);
  if (id === u.user.id) return json({ error: 'Não pode eliminar a sua própria conta' }, 400);

  const { data: target } = await admin.from('profiles').select('institution_id').eq('id', id).maybeSingle();
  if (!target || target.institution_id !== instId) return json({ error: 'Conta não encontrada nesta escola' }, 404);

  await admin.from('user_access').delete().eq('institution_id', instId).eq('user_id', id);
  await admin.from('user_projections').delete().eq('institution_id', instId).eq('user_id', id);
  const { error } = await admin.auth.admin.deleteUser(id);   // o perfil sai por "on delete cascade"
  if (error) return json({ error: error.message }, 400);
  return json({ ok: true });
});
