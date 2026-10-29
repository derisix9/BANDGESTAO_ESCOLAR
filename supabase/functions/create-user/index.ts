// Cria uma conta (professor, aluno, encarregado, ...) NA ESCOLA DO ADMINISTRADOR que faz o pedido.
// O cliente nunca escolhe a escola: vem do perfil de quem chama. Só 'admin' pode criar contas.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4';
import { preflight, json, ROLES, passwordProblem, cleanAvatar } from '../_shared/cors.ts';
import { ipAllowed, IP_DENIED_MESSAGE } from '../_shared/ipGuard.ts';

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
  if (!me || !me.active || me.role !== 'admin') return json({ error: 'Só o administrador cria contas' }, 403);
  if (!(await ipAllowed(admin, u.user.id, req))) return json({ error: IP_DENIED_MESSAGE }, 403);
  // Escola ativa do administrador (mãe ou uma das suas filiais — migração 0024). Nunca vem do cliente.
  const { data: activeInst } = await admin.rpc('resolve_institution', { p_uid: u.user.id });
  const instId: string = (typeof activeInst === 'string' && activeInst) ? activeInst : me.institution_id;

  const b = await req.json().catch(() => ({}));
  const email = String(b.email ?? '').trim().toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return json({ error: 'E-mail inválido' }, 400);
  if (!ROLES.includes(b.role)) return json({ error: 'Perfil inválido' }, 400);
  const pw = passwordProblem(b.password);
  if (pw) return json({ error: pw }, 400);
  if (!String(b.name ?? '').trim() || String(b.name).length > 200) return json({ error: 'Nome obrigatório (até 200 caracteres)' }, 400);

  const { data: created, error } = await admin.auth.admin.createUser({
    email, password: b.password, email_confirm: true, user_metadata: { name: b.name }
  });
  if (error || !created.user) return json({ error: error?.message ?? 'Falha ao criar conta' }, 400);

  const { error: pe } = await admin.from('profiles').insert({
    id: created.user.id, institution_id: instId, role: b.role, name: String(b.name).trim(), email,
    must_change_password: true,   // a palavra-passe definida pelo administrador é temporária (migração 0045)
    phone: b.phone ?? null, linked_student_id: b.linkedStudentId ?? null,
    linked_teacher_id: b.linkedTeacherId ?? null, linked_funcionario_id: b.linkedFuncionarioId ?? null,
    data: {
      ...(b.username ? { username: String(b.username).trim().toLowerCase() } : {}),
      ...(b.processNumber ? { processNumber: String(b.processNumber).trim() } : {}),
      ...(cleanAvatar(b.avatar) ? { avatar: cleanAvatar(b.avatar) } : {}),
      ...(b.roleTitle ? { roleTitle: String(b.roleTitle) } : {})
    }
  });
  if (pe) { await admin.auth.admin.deleteUser(created.user.id); return json({ error: pe.message }, 400); }

  await admin.rpc('write_audit_service', { p_inst: instId, p_actor: u.user.id, p_entity_id: created.user.id, p_role: b.role });
  return json({ id: created.user.id, institutionId: instId });
});
