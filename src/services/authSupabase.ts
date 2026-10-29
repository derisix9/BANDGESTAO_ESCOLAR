/**
 * Autenticação Supabase — substituto de src/services/auth.ts (Firebase).
 * O perfil (escola, papel) vem SEMPRE da tabela `profiles`, protegida por RLS;
 * o cliente nunca decide o seu próprio papel.
 */
import type { Session } from '@supabase/supabase-js';
import { createClient } from '@supabase/supabase-js';
import { supabase, supabaseUrl, supabaseAnonKey, clearRecoveryPending, isServerCoolingDown, noteServerFailure, noteServerOk, isTransientFailure } from './supabase';
import type { User, UserRole } from '../types';
import { unregisterPushDevice } from './pushDevice';

export interface SignInResult {
  success: boolean; error?: string;
  /** Motivo técnico da recusa, para a interface oferecer a ação certa (ex.: reenviar o link de confirmação). */
  code?: 'email_not_confirmed';
  /** true quando a conta tem 2FA activo e falta introduzir o código (nível aal2). */
  needsMfa?: boolean; factorId?: string; session?: Session | null;
}

/** Erro de início de sessão que leva o código do motivo (a mensagem continua a ser a que se mostra ao utilizador). */
export class SignInError extends Error {
  constructor(message: string, public readonly code?: SignInResult['code']) { super(message); this.name = 'SignInError'; }
}

const isEmailNotConfirmed = (e: { message?: string; code?: string } | null | undefined) =>
  !!e && (e.code === 'email_not_confirmed' || /email not confirmed/i.test(e.message || ''));

function translate(msg: string | undefined): string {
  const m = (msg || '').toLowerCase();
  if (m.includes('invalid login') || m.includes('invalid credentials')) return 'E-mail ou palavra-passe incorretos.';
  if (m.includes('email not confirmed')) return 'O e-mail ainda não foi confirmado. Abra o link que enviámos para a sua caixa de entrada (veja também o spam) ou peça um novo link.';
  if (m.includes('captcha')) return 'Verificação de captcha falhou ou expirou. Tente novamente.';
  // Bloqueio decidido pelo servidor (hook 0042): mostra a mensagem original, que já traz os minutos restantes.
  if (m.includes('temporariamente bloqueada') && msg) return msg;
  if (m.includes('rate limit') || m.includes('too many')) return 'Demasiadas tentativas. Tente novamente dentro de alguns minutos.';
  if (m.includes('failed to fetch') || m.includes('network')) return 'Sem ligação à internet. Verifique a rede.';
  if (m.includes('database error saving new user') || m.includes('temporários')) return 'Não são aceites e-mails temporários. Use o e-mail institucional da escola.';
  if (m.includes('signups not allowed') || m.includes('signup is disabled')) return 'O registo de novas escolas está temporariamente desativado.';
  if (m.includes('password') && (m.includes('weak') || m.includes('should contain') || m.includes('at least'))) return 'Palavra-passe demasiado fraca: mínimo 10 caracteres, com maiúsculas, minúsculas e números.';
  if (m.includes('invalid') && m.includes('email')) return 'E-mail inválido.';
  if (m.includes('banned') || m.includes('disabled')) return 'Esta conta foi desativada. Contacte o administrador.';
  return 'Não foi possível autenticar. Tente novamente.';
}

/**
 * ======================  INTERRUPTOR GLOBAL DO MFA / 2FA  ======================
 * false = verificação em dois passos DESLIGADA (login e criação de conta entram direto).
 * true  = volta a exigir o 2FA (TOTP) aos perfis em MFA_REQUIRED_ROLES.
 * É o ÚNICO sítio a alterar para ativar/desativar o 2FA em todo o sistema.
 */
export const MFA_ENABLED = false;

/** Com o captcha activo no Supabase (Authentication → Attack Protection), o token do Turnstile é obrigatório. */
export async function signIn(email: string, password: string, captchaToken?: string | null): Promise<SignInResult> {
  const { data, error } = await supabase.auth.signInWithPassword({
    email: email.trim().toLowerCase(), password, options: captchaToken ? { captchaToken } : undefined
  });
  if (error) return { success: false, error: translate(error.message), code: isEmailNotConfirmed(error) ? 'email_not_confirmed' : undefined };
  if (!MFA_ENABLED) return { success: true, session: data.session };   // 2FA desligado
  // Há 2FA inscrito mas a sessão ainda é aal1? Então falta o segundo factor.
  const { data: aal } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
  if (aal && aal.nextLevel === 'aal2' && aal.currentLevel !== 'aal2') {
    const { data: f } = await supabase.auth.mfa.listFactors();
    const totp = f?.totp?.[0];
    return { success: true, needsMfa: true, factorId: totp?.id, session: data.session };
  }
  return { success: true, session: data.session };
}

export async function verifyMfa(factorId: string, code: string): Promise<{ success: boolean; error?: string }> {
  const { data: ch, error: ce } = await supabase.auth.mfa.challenge({ factorId });
  if (ce || !ch) return { success: false, error: 'Não foi possível iniciar a verificação.' };
  const { error } = await supabase.auth.mfa.verify({ factorId, challengeId: ch.id, code: code.trim() });
  return error ? { success: false, error: 'Código incorreto ou expirado.' } : { success: true };
}

/** Inscreve o 2FA (TOTP): devolve o QR (data URI/SVG) e o segredo para a app autenticadora. */
export async function enrollTotp(): Promise<{ factorId: string; qr: string; secret: string }> {
  const { data, error } = await supabase.auth.mfa.enroll({ factorType: 'totp', friendlyName: 'BandMed ' + Date.now() });
  if (error || !data) throw new Error('Não foi possível activar o 2FA: ' + (error?.message ?? ''));
  return { factorId: data.id, qr: data.totp.qr_code, secret: data.totp.secret };
}

/**
 * Reenvia o link de confirmação do e-mail (conta criada mas ainda não confirmada). Exige captcha novo quando o captcha
 * está activo no Supabase. Resposta igual exista ou não a conta, para não revelar quem está registado; só falhas
 * técnicas (limite de envios, rede, captcha) são mostradas. O Supabase limita a 1 pedido por minuto por e-mail.
 */
export async function resendConfirmationEmail(email: string, captchaToken?: string | null): Promise<{ success: boolean; error?: string }> {
  const { error } = await supabase.auth.resend({
    type: 'signup',
    email: email.trim().toLowerCase(),
    options: {
      captchaToken: captchaToken || undefined,
      emailRedirectTo: typeof window !== 'undefined' ? window.location.origin + '/' : undefined
    }
  });
  if (!error) return { success: true };
  if (/rate limit|too many|only request this after|security purposes/i.test(error.message)) {
    return { success: false, error: 'Já enviámos um link há instantes. Aguarde cerca de 1 minuto antes de pedir outro.' };
  }
  if (/fetch|network|captcha/i.test(error.message)) return { success: false, error: translate(error.message) };
  return { success: true };
}

export async function signOutUser(): Promise<void> { await unregisterPushDevice(); await supabase.auth.signOut(); }

export async function sendPasswordReset(email: string, captchaToken?: string | null): Promise<{ success: boolean; error?: string }> {
  const { error } = await supabase.auth.resetPasswordForEmail(email.trim().toLowerCase(), {
    captchaToken: captchaToken || undefined,
    redirectTo: typeof window !== 'undefined' ? window.location.origin + '/' : undefined
  });
  // Só falhas técnicas são mostradas; "e-mail inexistente" nunca é revelado (evita descobrir quem tem conta).
  return error && /rate limit|too many|fetch|network|captcha/i.test(error.message)
    ? { success: false, error: translate(error.message) } : { success: true };
}

export async function updateOwnPassword(newPassword: string): Promise<{ success: boolean; error?: string }> {
  if (newPassword.length < 10 || !/[a-z]/.test(newPassword) || !/[A-Z]/.test(newPassword) || !/\d/.test(newPassword)) {
    return { success: false, error: 'Mínimo 10 caracteres, com maiúsculas, minúsculas e números.' };
  }
  const { error } = await supabase.auth.updateUser({ password: newPassword });
  if (error) {
    const m = error.message.toLowerCase();
    return { success: false, error: m.includes('same') ? 'A nova palavra-passe tem de ser diferente da anterior.'
      : m.includes('session') ? 'O link expirou. Peça um novo link de recuperação.' : translate(error.message) };
  }
  clearRecoveryPending();
  return { success: true };
}

export async function getCurrentAuthUid(): Promise<string | null> {
  const { data } = await supabase.auth.getSession();
  return data.session?.user.id ?? null;
}

export function watchAuthState(cb: (session: Session | null) => void): () => void {
  const { data } = supabase.auth.onAuthStateChange((_e, s) => cb(s));
  return () => data.subscription.unsubscribe();
}

export interface SchoolRegistrationInput {
  schoolName: string; adminName: string; email: string; password: string; captchaToken?: string | null; nif?: string;
  termsVersion: string; username?: string; settings?: Record<string, string | undefined>;
}

/**
 * Registo de uma escola pelo Supabase Auth NATIVO: signUp() com os dados da escola em user_metadata.
 * Com "Confirm email" ligado o Supabase envia o e-mail de confirmação e a conta fica sem acesso até o link ser aberto.
 * A escola e o administrador só são criados depois, em completeSchoolRegistration() (função SQL complete_registration, migração 0046).
 * E-mails temporários são recusados pela trigger da base de dados; a palavra-passe nunca sai do hash do Auth.
 */
export async function signUpSchool(a: SchoolRegistrationInput): Promise<{ success: boolean; error?: string }> {
  const settings = Object.fromEntries(Object.entries(a.settings ?? {}).filter(([, v]) => typeof v === 'string' && v.trim()));
  const { error } = await supabase.auth.signUp({
    email: a.email.trim().toLowerCase(),
    password: a.password,
    options: {
      captchaToken: a.captchaToken || undefined,
      emailRedirectTo: typeof window !== 'undefined' ? window.location.origin + '/' : undefined,
      data: {
        registration: 'school', school_name: a.schoolName.trim(), admin_name: a.adminName.trim(), terms_version: a.termsVersion,
        terms_accepted_at: new Date().toISOString(), nif: a.nif?.trim() || undefined, username: a.username?.trim() || undefined, settings
      }
    }
  });
  // Um e-mail que já tem conta não devolve erro (o Supabase não revela se existe): a resposta é igual para todos.
  return error ? { success: false, error: translate(error.message) } : { success: true };
}

export interface CompletedSchool { schoolName: string; email: string; created: boolean }

/**
 * Depois de o e-mail ser confirmado (sessão aberta pelo link): cria a escola e o administrador no servidor e monta a base
 * inicial. Idempotente. null = não há registo pendente nesta conta (ou o e-mail ainda não foi confirmado).
 */
export async function completeSchoolRegistration(): Promise<CompletedSchool | null> {
  const uid = await getCurrentAuthUid();
  if (!uid) return null;
  const { data, error } = await supabase.rpc('complete_registration');
  if (error) {
    if (isTransientFailure(undefined, error)) throw new ProfileUnavailableError(error);
    return null;
  }
  const d = data as any;
  if (!d?.done || !d.institutionId) return null;
  if (d.created) {
    const { dbService } = await import('./db');
    await dbService.finishConfirmedRegistration({
      institutionId: d.institutionId, userId: uid, schoolName: d.schoolName || 'Nova Instituição', nif: d.nif,
      adminName: d.adminName || 'Administrador', email: d.email || '', username: d.username, settings: d.settings
    });
  }
  return { schoolName: d.schoolName || '', email: d.email || '', created: !!d.created };
}

/** O servidor não respondeu (504, timeout, rede): NÃO significa que a conta não tem perfil. */
export class ProfileUnavailableError extends Error {
  constructor(public readonly cause?: unknown) {
    super('Servidor temporariamente indisponível. Tente novamente dentro de instantes.');
    this.name = 'ProfileUnavailableError';
  }
}

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Carrega o perfil e converte para o tipo `User` que a app já usa.
 * Devolve `null` SÓ quando a conta realmente não tem perfil activo. Falhas transitórias do servidor
 * (504 Gateway Timeout, rede) são repetidas com espera e, se persistirem, lançam `ProfileUnavailableError`
 * — antes eram tratadas como "conta sem perfil", o que impedia o acesso a todas as contas.
 */
let profileInFlight: Promise<User | null> | null = null;

/**
 * `force: true` (clique manual em "Entrar") ignora a pausa do disjuntor. Chamadas simultâneas partilham o MESMO pedido
 * (o onAuthStateChange dispara várias vezes seguidas: INITIAL_SESSION, SIGNED_IN, TOKEN_REFRESHED).
 */
export function loadProfile(opts?: { force?: boolean }): Promise<User | null> {
  if (profileInFlight) return profileInFlight;
  if (!opts?.force && isServerCoolingDown()) return Promise.reject(new ProfileUnavailableError('circuit-open'));
  profileInFlight = fetchProfile().finally(() => { profileInFlight = null; });
  return profileInFlight;
}

async function fetchProfile(): Promise<User | null> {
  const uid = await getCurrentAuthUid();
  if (!uid) return null;
  let p: any = null;
  let lastError: unknown = null;
  for (let attempt = 0; attempt < 3; attempt++) {
    if (attempt > 0) await wait(1000 * 2 ** (attempt - 1));   // 1 s, 2 s
    try {
      const res = await supabase.from('profiles').select('*').eq('id', uid).maybeSingle();
      if (!res.error) { p = res.data; lastError = null; noteServerOk(); break; }
      lastError = res.error;
      if (!isTransientFailure(res.status, res.error)) break;   // erro "a sério" (RLS, 4xx): repetir não adianta
    } catch (e) { lastError = e; }
  }
  if (lastError) { noteServerFailure(); throw new ProfileUnavailableError(lastError); }
  if (!p) {
    // Conta sem perfil: pode ser um registo de escola cujo e-mail acabou de ser confirmado e que ainda não foi concluído
    // (ex.: o separador fechou antes). Só com e-mail confirmado o servidor cria a escola e o administrador.
    if (!(await completeSchoolRegistration())) return null;
    const again = await supabase.from('profiles').select('*').eq('id', uid).maybeSingle();
    p = again.data;
  }
  if (!p || !p.active) return null;
  const { data: ua } = await supabase.from('user_access').select('sections').eq('user_id', uid).maybeSingle();
  const d = (p.data ?? {}) as Record<string, any>;
  return {
    id: p.id, name: p.name, email: p.email, role: p.role as UserRole,
    roleTitle: d.roleTitle ?? p.role, avatar: d.avatar ?? '', phone: p.phone ?? undefined,
    institutionId: p.role === 'admin' && p.active_institution_id ? p.active_institution_id : p.institution_id,
    homeInstitutionId: p.institution_id,
    linkedStudentId: p.linked_student_id ?? undefined, linkedTeacherId: p.linked_teacher_id ?? undefined,
    linkedFuncionarioId: p.linked_funcionario_id ?? undefined,
    passwordUpdatedAt: p.password_changed_at ?? undefined,
    access: ua?.sections ? ({ sections: ua.sections } as any) : undefined
  } as User;
}

/** Perfis que DEVEM ter 2FA (aal2) para operar. */
export const MFA_REQUIRED_ROLES: UserRole[] = ['admin', 'director', 'financeiro'];
export async function mfaSatisfied(role: UserRole): Promise<boolean> {
  if (!MFA_ENABLED) return true;   // 2FA desligado: nunca bloqueia o acesso
  if (!MFA_REQUIRED_ROLES.includes(role)) return true;
  const { data } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
  return data?.currentLevel === 'aal2';
}

/** Há um segundo factor (TOTP) já verificado nesta conta? */
export async function hasVerifiedTotp(): Promise<boolean> {
  const { data } = await supabase.auth.mfa.listFactors();
  return (data?.totp?.length ?? 0) > 0;   // `totp` só lista factores já verificados
}

/**
 * Reconfirma a identidade da sessão actual com a palavra-passe (assinatura de homologações, operações sensíveis).
 * A verificação usa um cliente ISOLADO, sem guardar sessão: a sessão da aplicação (incluindo o nível 2FA / aal2)
 * não é tocada nem rebaixada, e nenhuma sessão extra fica activa.
 */
export async function reauthenticate(password: string, captchaToken?: string | null): Promise<{ success: boolean; error?: string }> {
  const { data } = await supabase.auth.getSession();
  const email = data.session?.user.email;
  if (!email) return { success: false, error: 'Sessão expirada. Inicie sessão novamente.' };
  if (!password) return { success: false, error: 'Introduza a sua palavra-passe.' };
  const probe = createClient(supabaseUrl, supabaseAnonKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false }
  });
  try {
    const { data: r, error } = await probe.auth.signInWithPassword({ email, password, options: captchaToken ? { captchaToken } : undefined });
    // Tem de ser a mesma conta que tem a sessão aberta.
    if (error || !r.user || r.user.id !== data.session?.user.id) {
      return { success: false, error: error && /rate limit|too many|captcha/i.test(error.message) ? translate(error.message) : 'Palavra-passe incorreta.' };
    }
    return { success: true };
  } catch {
    return { success: false, error: 'Sem ligação ao servidor. Tente novamente.' };
  } finally {
    try { await probe.auth.signOut({ scope: 'local' }); } catch { /* cliente descartável */ }
  }
}

/** Abre sessão com o token de uso único devolvido pela Edge Function de registo (já validou o captcha). */
export async function signInWithTokenHash(tokenHash: string): Promise<SignInResult> {
  const { data, error } = await supabase.auth.verifyOtp({ token_hash: tokenHash, type: 'magiclink' });
  if (error || !data.session) return { success: false, error: translate(error?.message) };
  return { success: true, session: data.session };
}


/** Marca o erro como "bloqueio do servidor" (a interface não deve somar tentativas locais por cima). */
export const isServerLockMessage = (msg?: string) => /temporariamente bloqueada/i.test(msg || '');

/** Admin da escola: utilizadores actualmente bloqueados por tentativas falhadas (migração 0042). */
export async function listLockedUsers(): Promise<{ userId: string; lockedUntil: string }[]> {
  const { data, error } = await supabase.rpc('locked_users');
  if (error) return [];
  return (data ?? []).map((r: any) => ({ userId: r.user_id, lockedUntil: r.locked_until }));
}

/** Admin da escola: desbloqueia um utilizador da sua escola. */
export async function unlockUser(userId: string): Promise<{ success: boolean; error?: string }> {
  const { error } = await supabase.rpc('admin_unlock_user', { p_user: userId });
  return error ? { success: false, error: 'Não foi possível desbloquear.' } : { success: true };
}


// ---------------------------------------------------------------------------------------------
// Palavra-passe temporária e validade: decididas no SERVIDOR (migração 0045).
// ---------------------------------------------------------------------------------------------
export interface PasswordGate { mustChange: boolean; expired: boolean; daysLeft: number | null; maxAge: number }

/** Estado da palavra-passe da conta com sessão. Se o servidor não responder, não bloqueia (a RLS continua a decidir). */
export async function getPasswordGate(): Promise<PasswordGate> {
  try {
    const { data, error } = await supabase.rpc('password_status');
    if (error || !data) return { mustChange: false, expired: false, daysLeft: null, maxAge: 0 };
    return { mustChange: data.must_change === true, expired: data.expired === true, daysLeft: typeof data.days_left === 'number' ? data.days_left : null, maxAge: Number(data.max_age) || 0 };
  } catch {
    return { mustChange: false, expired: false, daysLeft: null, maxAge: 0 };
  }
}
export const passwordGateBlocks = (g: PasswordGate) => g.mustChange || g.expired;

/** Administrador: validade da palavra-passe da escola (0 = nunca; senão 30 a 365 dias). */
export async function savePasswordPolicy(days: number): Promise<{ success: boolean; error?: string }> {
  const { error } = await supabase.rpc('set_password_policy', { p_days: days });
  return error ? { success: false, error: error.message } : { success: true };
}

/** Administrador: obriga uma conta da sua escola a definir nova palavra-passe no próximo acesso. */
export async function forcePasswordChange(userId: string): Promise<{ success: boolean; error?: string }> {
  const { error } = await supabase.rpc('admin_force_password_change', { p_user: userId });
  return error ? { success: false, error: error.message } : { success: true };
}
