// create-user — versão num só ficheiro, para colar no editor do painel do Supabase.
// Cria uma conta (professor, aluno, encarregado, ...) NA ESCOLA DO ADMINISTRADOR que faz o pedido.
// O cliente nunca escolhe a escola: vem do perfil de quem chama. Só 'admin' pode criar contas.
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
// ---- CORS e utilitários (antes em _shared/cors.ts) ----
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

const ROLES = ['admin', 'director', 'secretaria', 'professor', 'financeiro', 'funcionario', 'aluno', 'encarregado'];
const MIN_PASSWORD = 10;
function passwordProblem(p: string): string | null {
  if (typeof p !== 'string' || p.length < MIN_PASSWORD) return `A palavra-passe deve ter pelo menos ${MIN_PASSWORD} caracteres.`;
  if (!/[a-z]/.test(p) || !/[A-Z]/.test(p) || !/\d/.test(p)) return 'Use maiúsculas, minúsculas e números.';
  return null;
}

/** Avatar: só URL https ou imagem pequena. */
const MAX_AVATAR = 20000;
function cleanAvatar(v: unknown): string | null {
  const s = String(v ?? '');
  if (!s || s.length > MAX_AVATAR) return null;
  return /^(https:\/\/|data:image\/(png|jpeg|webp);base64,)/i.test(s) ? s : null;
}

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
