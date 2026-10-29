// Conclui o registo de uma escola DEPOIS de o e-mail ter sido confirmado (link recebido por e-mail).
// Exige a sessão da própria pessoa (Authorization: Bearer) e e-mail confirmado. Só então cria institutions + profiles.
// Idempotente: se a escola já foi criada, devolve-a sem repetir.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4';
import { cors, json } from '../_shared/cors.ts';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return json({ error: 'Método não permitido' }, 405);
  const token = (req.headers.get('authorization') ?? '').replace(/^Bearer\s+/i, '');
  if (!token) return json({ error: 'Sem sessão' }, 401);

  const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
  const { data: who, error: ue } = await admin.auth.getUser(token);
  const user = who?.user;
  if (ue || !user) return json({ error: 'Sessão inválida' }, 401);
  if (!user.email_confirmed_at) return json({ error: 'Confirme primeiro o e-mail pelo link que enviámos.' }, 403);

  // Já concluído antes?
  const { data: existing } = await admin.from('profiles').select('institution_id').eq('id', user.id).maybeSingle();
  if (existing) return json({ done: true, institutionId: existing.institution_id, created: false });

  const { data: p } = await admin.from('pending_registrations').select('*').eq('user_id', user.id).maybeSingle();
  if (!p) return json({ error: 'Não há registo pendente para esta conta.' }, 404);
  if (new Date(p.expires_at).getTime() < Date.now()) return json({ error: 'O pedido de registo expirou. Faça um novo registo.' }, 410);

  const slug = 'inst_' + String(p.school_name).toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '').slice(0, 40) + '_' + crypto.randomUUID().slice(0, 6);

  const { error: ie } = await admin.from('institutions').insert({
    id: slug, name: p.school_name, nif: p.nif ?? null,
    plan_status: 'trial', trial_ends_at: new Date(Date.now() + 30 * 86400000).toISOString(),
    terms_version: p.terms_version, terms_accepted_at: p.terms_accepted_at
  });
  if (ie) return json({ error: 'Não foi possível criar a escola.' }, 400);
  const { error: pe } = await admin.from('profiles').insert({
    id: user.id, institution_id: slug, role: 'admin', is_founder: true, name: p.admin_name, email: p.email,
    data: { roleTitle: 'Administrador Geral', ...(p.username ? { username: p.username } : {}) }
  });
  if (pe) { await admin.from('institutions').delete().eq('id', slug); return json({ error: 'Não foi possível criar o administrador.' }, 400); }

  // Histórico de aceitação dos termos (só acrescenta). Se falhar, a aceitação já ficou na própria escola.
  await admin.from('institution_terms_acceptances').insert({
    institution_id: slug, user_id: user.id, version: p.terms_version, accepted_at: p.terms_accepted_at, ip: p.ip, user_agent: p.user_agent
  });
  await admin.from('pending_registrations').delete().eq('user_id', user.id);
  return json({
    done: true, created: true, institutionId: slug, schoolName: p.school_name, nif: p.nif, adminName: p.admin_name,
    username: p.username, email: p.email, settings: p.settings ?? {}
  });
});
