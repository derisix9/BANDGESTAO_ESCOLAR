// Elimina de verdade uma conta (Auth + perfil). Só o administrador, e só contas da SUA escola.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4';
import { ipAllowed, IP_DENIED_MESSAGE } from '../_shared/ipGuard.ts';
import { preflight, json } from '../_shared/cors.ts';

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

  // Escola ativa do administrador (mãe ou filial — migração 0024): só apaga contas da escola em que está a trabalhar.
  const { data: activeInst } = await admin.rpc('resolve_institution', { p_uid: u.user.id });
  const instId: string = (typeof activeInst === 'string' && activeInst) ? activeInst : me.institution_id;

  const b = await req.json().catch(() => ({}));
  const id = String(b.id ?? '');
  if (!/^[0-9a-f-]{36}$/i.test(id)) return json({ error: 'Conta inválida' }, 400);
  if (id === u.user.id) return json({ error: 'Não pode eliminar a sua própria conta' }, 400);

  const { data: target } = await admin.from('profiles').select('institution_id, is_founder').eq('id', id).maybeSingle();
  if (!target || target.institution_id !== instId) return json({ error: 'Conta não encontrada nesta escola' }, 404);
  if (target.is_founder) return json({ error: 'Não é possível eliminar o administrador fundador da instituição (o primeiro administrador criado). Só é possível se a escola for eliminada do sistema.' }, 403);

  await admin.from('user_access').delete().eq('institution_id', instId).eq('user_id', id);
  await admin.from('user_projections').delete().eq('institution_id', instId).eq('user_id', id);
  const { error } = await admin.auth.admin.deleteUser(id);   // o perfil sai por "on delete cascade"
  if (error) return json({ error: error.message }, 400);
  return json({ ok: true });
});
