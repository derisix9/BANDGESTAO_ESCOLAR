// school-backups — cópia de segurança DIÁRIA de cada escola para a nuvem DA ESCOLA (Google Drive, Backblaze B2, Wasabi, R2, S3…).
//
// Chamadores (verify_jwt = false; a função valida ela própria):
//   • o ADMINISTRADOR da escola (Authorization: Bearer <jwt>), body { action: save | test | run-now | disconnect | gdrive-start }
//   • o AGENDADOR (pg_cron / GitHub Actions) com x-cron-secret = BACKUP_CRON_SECRET → corre os backups devidos
//   • o Google, no regresso do consentimento: GET .../school-backups/gdrive-callback?code=...&state=...
// A escola vem SEMPRE do perfil verificado (ou da linha do destino no agendador), nunca do pedido.
// Segredos: BACKUP_SECRETS_KEY (≥32), BACKUP_CRON_SECRET, GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, opcional ALLOWED_ORIGIN / APP_URL.
import { createClient, type SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4';
import { decryptSecret, encryptSecret, safeEqual, signState, verifyState, SecretsError } from './secrets.ts';
import { S3Client } from './s3.ts';
import * as drive from './drive.ts';
import {
  ConfigError, backupFileName, cleanS3Config, cleanS3Secret, cleanSchedule, isProvider, safeError, selectExpired,
  type Provider, type S3Config, type S3Secret
} from './validate.ts';

// ---- Lista de IPs autorizados (inline: o editor do painel do Supabase não leva a pasta _shared; migração 0043) ----
function requestIp(req: Request): string | null {
  const v = (req.headers.get('cf-connecting-ip') ?? req.headers.get('x-real-ip') ?? '').trim();
  return v && v.length <= 45 ? v : null;
}
async function ipAllowed(admin: SupabaseClient, uid: string, req: Request): Promise<boolean> {
  const { data, error } = await admin.rpc('edge_ip_allowed', { p_uid: uid, p_ip: requestIp(req) });
  if (error) { console.error('ipGuard', error.message); return false; }
  return data === true;
}
const IP_DENIED_MESSAGE = 'Acesso recusado: rede não autorizada ou palavra-passe por renovar. Inicie sessão novamente.';

const env = (k: string) => Deno.env.get(k) ?? '';
const MAX_BACKUP_BYTES = 100 * 1024 * 1024;
const RUN_BUDGET_MS = 110_000;

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
const cors = {
  'Access-Control-Allow-Origin': allowedOrigin(),
  'Vary': 'Origin',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-api-version',
  'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
  'Access-Control-Max-Age': '86400'
};
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });
const fail = (status: number, message: string) => json({ error: message }, status);

const service = (): SupabaseClient => createClient(env('SUPABASE_URL'), env('SUPABASE_SERVICE_ROLE_KEY'), { auth: { persistSession: false } });
const googleApp = (): drive.GoogleApp | null => env('GOOGLE_CLIENT_ID') && env('GOOGLE_CLIENT_SECRET') ? { clientId: env('GOOGLE_CLIENT_ID'), clientSecret: env('GOOGLE_CLIENT_SECRET') } : null;
const redirectUri = () => `${env('SUPABASE_URL').replace(/\/+$/, '')}/functions/v1/school-backups/gdrive-callback`;

interface Row { inst: string; prov: Provider; cfg: any; secret: string; keep_days: number; school: string }
interface Target { put(name: string, body: Uint8Array, mime: string): Promise<void>; list(): Promise<Array<{ name: string; remove: () => Promise<void> }>> }

async function openTarget(admin: SupabaseClient, r: Row): Promise<Target> {
  const secret = await decryptSecret<any>(env('BACKUP_SECRETS_KEY'), r.inst, r.secret);
  if (r.prov === 's3') {
    const s3 = new S3Client(r.cfg as S3Config, secret as S3Secret);
    return { put: (name, body) => s3.put(name, body), list: async () => (await s3.list()).map((name) => ({ name, remove: () => s3.delete(name) })) };
  }
  const app = googleApp();
  if (!app) throw new ConfigError('O servidor ainda não tem a aplicação Google configurada (GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET).');
  const token = await drive.accessToken(app, String(secret.refreshToken));
  const folderId = await drive.ensureFolder(token, r.cfg?.folderId);
  if (folderId !== r.cfg?.folderId) await admin.from('school_backup_destinations').update({ config: { ...r.cfg, folderId } }).eq('institution_id', r.inst);
  return {
    put: async (name, body, mime) => { await drive.uploadFile(token, folderId, name, body, mime); },
    list: async () => (await drive.listFiles(token, folderId)).map((f) => ({ name: f.name, remove: () => drive.deleteFile(token, f.id) }))
  };
}

type Trigger = 'agendado' | 'manual' | 'teste';

/** Faz UM backup (ou o teste) e regista o resultado. Nunca lança. */
async function runOne(admin: SupabaseClient, r: Row, trigger: Trigger): Promise<{ ok: boolean; file?: string; size?: number; deleted?: number; error?: string }> {
  let file: string | undefined, size: number | undefined, deleted = 0;
  try {
    const target = await openTarget(admin, r);
    if (trigger === 'teste') {
      file = `bandmed_teste_${Date.now()}.txt`;
      const body = new TextEncoder().encode('Teste de ligação do BandMed. Pode apagar este ficheiro.');
      await target.put(file, body, 'text/plain');
      for (const f of await target.list()) if (f.name === file) await f.remove();
      size = body.byteLength;
    } else {
      const { data, error } = await admin.rpc('school_backup_export_service', { p_inst: r.inst });
      if (error) throw new Error(`Base de dados: ${error.message}`);
      // Escola sem registos: não se envia e NÃO se apagam backups antigos (protege-os).
      if (!data || !(data.counts?.records > 0)) throw new Error('A escola não tem registos neste momento: nada foi copiado (os backups anteriores ficam intactos).');
      const body = new TextEncoder().encode(JSON.stringify(data));
      if (body.byteLength > MAX_BACKUP_BYTES) throw new Error(`O backup tem ${(body.byteLength / 1048576).toFixed(0)} MB, acima do limite desta função (${MAX_BACKUP_BYTES / 1048576} MB). Peça apoio técnico.`);
      const school = r.school || String(data.schoolName || '');
      file = backupFileName(school, new Date());
      await target.put(file, body, 'application/json');
      size = body.byteLength;
      try {   // retenção: erros aqui não invalidam o backup já feito
        const all = await target.list();
        const old = new Set(selectExpired(all.map((f) => f.name), school, r.keep_days));
        for (const f of all) if (old.has(f.name) && f.name !== file) { await f.remove(); deleted++; }
      } catch (e) { console.error('retenção falhou', r.inst, safeError(e)); }
    }
    await admin.rpc('backup_finish', { p_inst: r.inst, p_trigger: trigger, p_ok: true, p_provider: r.prov, p_file: file, p_size: size, p_error: null });
    return { ok: true, file, size, deleted };
  } catch (e) {
    const msg = e instanceof SecretsError || e instanceof ConfigError ? e.message : safeError(e);
    await admin.rpc('backup_finish', { p_inst: r.inst, p_trigger: trigger, p_ok: false, p_provider: r.prov, p_file: file ?? null, p_size: null, p_error: msg });
    return { ok: false, error: msg };
  }
}

async function scheduled(): Promise<Response> {
  const admin = service();
  const started = Date.now();
  const results: Array<{ inst: string; ok: boolean }> = [];
  while (Date.now() - started < RUN_BUDGET_MS) {
    const { data, error } = await admin.rpc('backup_claim_due', { p_limit: 1 });
    if (error) return fail(500, `claim: ${error.message}`);
    const r = (data as Row[] | null)?.[0];
    if (!r) break;
    results.push({ inst: r.inst, ok: (await runOne(admin, r, 'agendado')).ok });
  }
  return json({ ran: results.length, ok: results.filter((x) => x.ok).length, failed: results.filter((x) => !x.ok).map((x) => x.inst) });
}

async function authAdmin(req: Request, admin: SupabaseClient): Promise<{ uid: string; inst: string } | Response> {
  const caller = createClient(env('SUPABASE_URL'), env('SUPABASE_ANON_KEY'), { global: { headers: { Authorization: req.headers.get('Authorization') ?? '' } } });
  const { data: u } = await caller.auth.getUser();
  if (!u?.user) return fail(401, 'Sessão inválida');
  const { data: me } = await admin.from('profiles').select('institution_id, role, active').eq('id', u.user.id).single();
  if (!me || !me.active || me.role !== 'admin') return fail(403, 'Só o administrador da escola gere a cópia para a nuvem.');
  if (!(await ipAllowed(admin, u.user.id, req))) return fail(403, IP_DENIED_MESSAGE);
  // Escola ativa (mãe ou filial — migração 0024): a cópia é sempre da escola em que o administrador está a trabalhar.
  const { data: activeInst } = await admin.rpc('resolve_institution', { p_uid: u.user.id });
  const inst: string = (typeof activeInst === 'string' && activeInst) ? activeInst : me.institution_id;
  // Área avançada controlada pelo Super Admin (Admin Master, migração 0023): só o modo 'gravacao' permite configurar.
  const { data: fm } = await admin.from('school_feature_modes').select('mode').eq('institution_id', inst).eq('feature_key', 'backup_automatico').maybeSingle();
  if ((fm?.mode ?? 'oculto') !== 'gravacao') return fail(403, 'A cópia diária para a nuvem está em modo somente leitura (ou desativada) para esta escola. Contacte o suporte BandMed.');
  return { uid: u.user.id, inst };
}

const audit = (admin: SupabaseClient, inst: string, uid: string, action: string, detail: Record<string, unknown>) =>
  admin.rpc('write_audit_event_service', { p_inst: inst, p_actor: uid, p_action: action, p_entity: 'school', p_entity_id: inst, p_detail: detail });

async function claimOne(admin: SupabaseClient, inst: string): Promise<Row | null> {
  const { data } = await admin.rpc('backup_claim_one', { p_inst: inst });
  return (data as Row[] | null)?.[0] ?? null;
}

async function handleAdmin(req: Request): Promise<Response> {
  const admin = service();
  const who = await authAdmin(req, admin);
  if (who instanceof Response) return who;
  const b: any = await req.json().catch(() => ({}));

  switch (b.action) {
    case 'save': {
      let sched;
      try { sched = cleanSchedule(b.runHour, b.retentionDays); } catch (e) { return fail(400, (e as Error).message); }
      if (!isProvider(b.provider)) return fail(400, 'Escolha o serviço de destino.');
      const provider: Provider = b.provider;
      const { data: cur } = await admin.from('school_backup_destinations').select('*').eq('institution_id', who.inst).maybeSingle();
      const sameProvider = cur?.provider === provider;
      let config = sameProvider ? cur.config : {};
      let secret_enc: string | null = sameProvider ? cur.secret_enc : null;
      try {
        if (provider === 's3') {
          config = cleanS3Config(b.config);
          if (b.secret && (b.secret.accessKeyId || b.secret.secretAccessKey)) secret_enc = await encryptSecret(env('BACKUP_SECRETS_KEY'), who.inst, cleanS3Secret(b.secret));
          else if (!secret_enc) throw new ConfigError('Indique a chave de acesso e a chave secreta.');
        } else if (!secret_enc) {
          throw new ConfigError('Ligue primeiro a conta Google Drive (botão "Ligar Google Drive").');
        }
      } catch (e) {
        return fail(e instanceof ConfigError || e instanceof SecretsError ? 400 : 500, (e as Error).message);
      }
      if (b.enabled && !secret_enc) return fail(400, 'Ligue o destino antes de activar o backup diário.');
      if (cur && !sameProvider && cur.provider === 'gdrive' && cur.secret_enc) {
        try { await drive.revoke(String((await decryptSecret<any>(env('BACKUP_SECRETS_KEY'), who.inst, cur.secret_enc)).refreshToken)); } catch { /* melhor esforço */ }
      }
      const changedTarget = !cur || !sameProvider || secret_enc !== cur.secret_enc || JSON.stringify(config) !== JSON.stringify(cur.config);
      const { error } = await admin.from('school_backup_destinations').upsert({
        institution_id: who.inst, provider, enabled: !!b.enabled, run_hour: sched.runHour, retention_days: sched.retentionDays,
        config, secret_enc, updated_at: new Date().toISOString(),
        ...(changedTarget ? { last_status: null, last_error: null } : {})
      });
      if (error) return fail(500, error.message);
      await audit(admin, who.inst, who.uid, 'RPC:school_backup_destination_save', { provider, enabled: !!b.enabled, runHour: sched.runHour, retentionDays: sched.retentionDays, changedTarget, target: provider === 's3' ? { endpoint: (config as S3Config).endpoint, bucket: (config as S3Config).bucket } : { account: config?.account } });
      return json({ ok: true });
    }

    case 'test':
    case 'run-now': {
      const r = await claimOne(admin, who.inst);
      if (!r) return fail(409, 'Não há destino configurado, ou já há uma cópia em curso/muito recente. Aguarde um minuto e tente de novo.');
      return json(await runOne(admin, r, b.action === 'test' ? 'teste' : 'manual'));   // 200 mesmo com falha do destino: o erro legível vai no corpo
    }

    case 'disconnect': {
      const { data: cur } = await admin.from('school_backup_destinations').select('provider, secret_enc').eq('institution_id', who.inst).maybeSingle();
      if (cur?.provider === 'gdrive' && cur.secret_enc) {
        try { await drive.revoke(String((await decryptSecret<any>(env('BACKUP_SECRETS_KEY'), who.inst, cur.secret_enc)).refreshToken)); } catch { /* melhor esforço */ }
      }
      const { error } = await admin.from('school_backup_destinations').delete().eq('institution_id', who.inst);
      if (error) return fail(500, error.message);
      await audit(admin, who.inst, who.uid, 'RPC:school_backup_destination_disconnect', { provider: cur?.provider ?? null });
      return json({ ok: true });
    }

    case 'gdrive-start': {
      const app = googleApp();
      if (!app) return fail(501, 'O Google Drive ainda não está configurado neste servidor (GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET). Use um serviço S3 (Backblaze B2, Wasabi…) ou peça ao responsável técnico.');
      let returnTo = '';
      try { const u = new URL(String(b.returnTo || '')); if (/^https?:$/.test(u.protocol)) returnTo = u.origin; } catch { /* sem retorno */ }
      const allowed = env('APP_URL') || (env('ALLOWED_ORIGIN') !== '*' ? env('ALLOWED_ORIGIN') : '');
      if (allowed && returnTo && new URL(allowed).origin !== returnTo) returnTo = new URL(allowed).origin;
      const state = await signState(env('BACKUP_SECRETS_KEY'), { inst: who.inst, uid: who.uid, returnTo });
      return json({ url: drive.authUrl(app, redirectUri(), state) });
    }

    default:
      return fail(400, 'Acção desconhecida.');
  }
}

async function handleCallback(url: URL): Promise<Response> {
  const st = await verifyState<{ inst: string; uid: string; returnTo: string }>(env('BACKUP_SECRETS_KEY'), url.searchParams.get('state') || '');
  const text = (s: string, status = 200) => new Response(s, { status, headers: { ...cors, 'Content-Type': 'text/plain; charset=utf-8' } });
  if (!st) return text('Pedido inválido ou expirado. Volte ao BandMed e tente ligar outra vez.', 400);
  const back = (result: string, msg = '') => {
    if (!st.returnTo) return text(result === 'ok' ? 'Google Drive ligado. Pode fechar esta janela e voltar ao BandMed.' : `Não foi possível ligar: ${msg}`);
    const target = new URL('/', st.returnTo);
    target.searchParams.set('backup-drive', result);
    if (msg) target.searchParams.set('msg', msg.slice(0, 120));
    return new Response(null, { status: 302, headers: { Location: target.toString() } });
  };
  if (url.searchParams.get('error')) return back('erro', 'Autorização recusada no Google.');
  const app = googleApp();
  const code = url.searchParams.get('code');
  if (!app || !code) return back('erro', 'Resposta do Google incompleta.');
  try {
    const admin = service();
    const { refreshToken, email } = await drive.exchangeCode(app, redirectUri(), code);
    const { data: cur } = await admin.from('school_backup_destinations').select('*').eq('institution_id', st.inst).maybeSingle();
    if (cur?.provider === 'gdrive' && cur.secret_enc) {
      try { await drive.revoke(String((await decryptSecret<any>(env('BACKUP_SECRETS_KEY'), st.inst, cur.secret_enc)).refreshToken)); } catch { /* melhor esforço */ }
    }
    const keep = cur?.provider === 'gdrive';
    const { error } = await admin.from('school_backup_destinations').upsert({
      institution_id: st.inst, provider: 'gdrive', enabled: keep ? cur.enabled : false,
      run_hour: keep ? cur.run_hour : 23, retention_days: keep ? cur.retention_days : 30,
      config: { account: email, folderId: null }, secret_enc: await encryptSecret(env('BACKUP_SECRETS_KEY'), st.inst, { refreshToken }),
      last_status: null, last_error: null, updated_at: new Date().toISOString()
    });
    if (error) throw new Error(error.message);
    await audit(admin, st.inst, st.uid, 'RPC:school_backup_destination_save', { provider: 'gdrive', account: email, connected: true });
    return back('ok');
  } catch (e) {
    return back('erro', e instanceof Error ? e.message : 'Erro desconhecido');
  }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
  try {
    const url = new URL(req.url);
    if (req.method === 'GET' && url.pathname.endsWith('/gdrive-callback')) return await handleCallback(url);
    if (req.method !== 'POST') return fail(405, 'Método não permitido');
    const cron = req.headers.get('x-cron-secret');
    if (cron !== null) {
      const expected = env('BACKUP_CRON_SECRET');
      if (expected.length < 24 || !safeEqual(cron, expected)) return fail(401, 'Segredo do agendador inválido');
      return await scheduled();
    }
    return await handleAdmin(req);
  } catch (e) {
    console.error('school-backups', e);
    return fail(500, e instanceof SecretsError ? e.message : 'Erro interno. Veja os registos da função.');
  }
});
