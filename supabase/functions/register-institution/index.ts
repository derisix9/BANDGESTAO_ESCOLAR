// Pedido de registo de uma escola nova, COM verificação de e-mail.
// Este passo NÃO cria a escola nem o administrador: cria só uma conta de acesso por confirmar (sem e-mail confirmado),
// guarda os dados em pending_registrations e faz o Supabase enviar o link de ativação para o e-mail.
// A escola e o administrador só nascem em complete-registration, depois de o link ser aberto.
// Protecções: captcha (Turnstile), campo-isco, limite por IP e por e-mail, resposta igual exista ou não o e-mail (sem enumeração).
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4';
import { cors, json, passwordProblem, safeEqual } from '../_shared/cors.ts';

const MAX_PER_IP_HOUR = 5;       // pedidos por IP e por hora
const RESEND_COOLDOWN_SEC = 60;  // mesmo e-mail: um novo pedido só após 60 s

// Palavras-passe óbvias (a regra mínima de tamanho/maiúsculas/números está em passwordProblem).
function weakPassword(p: string): string | null {
  const l = p.toLowerCase();
  const seq = 'abcdefghijklmnopqrstuvwxyz0123456789', rev = seq.split('').reverse().join('');
  const hasSeq = [...Array(Math.max(0, l.length - 3)).keys()].some((i) => seq.includes(l.slice(i, i + 4)) || rev.includes(l.slice(i, i + 4)));
  const common = ['password', 'palavra', 'senha', 'qwerty', 'abcdef', '123456', 'admin', 'bandmed', 'letmein', 'welcome'];
  if (/(.)\1{2,}/.test(p) || hasSeq || common.some((w) => l.includes(w)))
    return 'Palavra-passe demasiado fraca: evite sequências, repetições e palavras comuns.';
  return null;
}

// Captcha Cloudflare Turnstile (secret TURNSTILE_SECRET_KEY). Sem secret configurado, recusa (fecha por defeito).
async function captchaOk(token: unknown, ip: string | null): Promise<boolean> {
  const secret = Deno.env.get('TURNSTILE_SECRET_KEY');
  if (!secret || typeof token !== 'string' || !token || token.length > 2048) return false;
  const form = new URLSearchParams({ secret, response: token });
  if (ip) form.set('remoteip', ip);
  try {
    const r = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', { method: 'POST', body: form });
    const d = await r.json();
    return d?.success === true;
  } catch { return false; }
}

const str = (v: unknown, max: number) => (typeof v === 'string' ? v.trim().slice(0, max) : '');

// Mesma resposta para qualquer e-mail: não revela se já existe conta.
const OK = { pending: true, message: 'Enviámos um link de ativação para o seu e-mail. A escola só é criada depois de o abrir (válido 48 horas).' };

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return json({ error: 'Método não permitido' }, 405);
  const b = await req.json().catch(() => ({}));
  const ip = req.headers.get('cf-connecting-ip') ?? req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? null;

  if (b.website) return json({ error: 'Pedido inválido' }, 400);   // campo-isco anti-robôs
  if (!(await captchaOk(b.captchaToken, ip))) return json({ error: 'Captcha inválido ou expirado. Tente novamente.' }, 400);

  // Código de convite: só exigido se o segredo REGISTRATION_INVITE_CODES existir (um ou vários, separados por vírgula).
  // Sem segredo = registo livre. Comparação em tempo constante.
  const codes = (Deno.env.get('REGISTRATION_INVITE_CODES') ?? '').split(',').map((c) => c.trim()).filter(Boolean);
  if (codes.length) {
    const given = str(b.inviteCode, 100);
    if (!given || !codes.some((c) => safeEqual(c, given))) return json({ error: 'Código de convite inválido ou em falta.', code: 'invite_required' }, 400);
  }

  const email = str(b.adminEmail, 254).toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return json({ error: 'E-mail inválido' }, 400);
  const pw = passwordProblem(b.password);
  if (pw) return json({ error: pw }, 400);
  const weak = weakPassword(b.password);
  if (weak) return json({ error: weak }, 400);
  const termsVersion = str(b.termsVersion, 12);
  if (b.termsAccepted !== true || !/^[0-9]{1,3}(\.[0-9]{1,3}){0,2}$/.test(termsVersion))
    return json({ error: 'Tem de aceitar os Termos de Utilização e a Política de Privacidade.' }, 400);
  const name = str(b.schoolName, 200);
  if (name.length < 3) return json({ error: 'Nome da escola obrigatório (3 a 200 caracteres)' }, 400);
  const adminName = str(b.adminName, 120) || name;
  const redirectTo = (() => {
    const o = str(b.redirectTo, 300);
    const allowed = (Deno.env.get('ALLOWED_ORIGIN') ?? '').trim().replace(/\/+$/, '');
    // Sem ALLOWED_ORIGIN não há destino de confiança: o Supabase usa o Site URL.
    try { const u = new URL(o); return allowed && (allowed === '*' || u.origin === allowed) ? u.origin + '/' : undefined; } catch { return undefined; }
  })();

  const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);

  // Limite por IP (pedidos pendentes na última hora).
  if (ip) {
    const since = new Date(Date.now() - 3600_000).toISOString();
    const { count } = await admin.from('pending_registrations').select('user_id', { count: 'exact', head: true }).eq('ip', ip).gte('created_at', since);
    if ((count ?? 0) >= MAX_PER_IP_HOUR) return json({ error: 'Demasiados pedidos deste endereço. Tente mais tarde.' }, 429);
  }

  // Já há um pedido por confirmar para este e-mail? Dentro do intervalo mínimo: resposta igual, sem novo envio.
  // Passado o intervalo: apaga o pedido antigo (e a conta por confirmar) e refaz tudo, com a palavra-passe nova.
  const { data: old } = await admin.from('pending_registrations').select('user_id, created_at').ilike('email', email).maybeSingle();
  if (old) {
    if (Date.now() - new Date(old.created_at).getTime() < RESEND_COOLDOWN_SEC * 1000) return json(OK);
    const { data: ou } = await admin.auth.admin.getUserById(old.user_id);
    if (ou?.user && !ou.user.email_confirmed_at) await admin.auth.admin.deleteUser(old.user_id);
    await admin.from('pending_registrations').delete().eq('user_id', old.user_id);
  }

  // Convite: cria a conta SEM confirmar e o Supabase envia o e-mail com o link. Se o e-mail já tem conta confirmada, falha e
  // respondemos igual (não revelamos que existe).
  const { data: inv, error: ie } = await admin.auth.admin.inviteUserByEmail(email, { redirectTo });
  if (ie || !inv?.user) return json(OK);
  const uid = inv.user.id;
  // Palavra-passe escolhida agora; fica na conta (hash no Auth), nunca em pending_registrations.
  const { error: pe } = await admin.auth.admin.updateUserById(uid, { password: b.password });
  if (pe) { await admin.auth.admin.deleteUser(uid); return json({ error: 'Não foi possível criar a conta. Tente novamente.' }, 400); }

  const s = (b.settings && typeof b.settings === 'object') ? b.settings : {};
  const settings: Record<string, string> = {};
  for (const k of ['province', 'municipality', 'address', 'phone', 'email', 'currentAcademicYear']) if (typeof s[k] === 'string') settings[k] = s[k].slice(0, 200);

  const { error: re } = await admin.from('pending_registrations').insert({
    user_id: uid, email, school_name: name, nif: str(b.nif, 40) || null, admin_name: adminName,
    username: str(b.username, 60).toLowerCase() || null, settings,
    terms_version: termsVersion, ip, user_agent: (req.headers.get('user-agent') ?? '').slice(0, 300) || null
  });
  if (re) { await admin.auth.admin.deleteUser(uid); return json({ error: 'Não foi possível registar o pedido. Tente novamente.' }, 400); }
  return json(OK);
});
