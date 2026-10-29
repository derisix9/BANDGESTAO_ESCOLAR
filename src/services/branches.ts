/**
 * Gestão de filiais — lado da escola.
 * O servidor decide a que escolas o utilizador tem acesso (my_schools) e valida a troca (switch_institution).
 * O administrador da escola mãe vê a mãe e as filiais; qualquer outro perfil só vê a sua escola.
 */
import { supabase } from './supabase';

export interface MySchool {
  id: string;
  name: string;
  nif: string | null;
  status: 'active' | 'suspended' | 'archived';
  isMother: boolean;
  parentId: string | null;
  isCurrent: boolean;
  studentsCount: number;
  usersCount: number;
}

export async function listMySchools(): Promise<MySchool[]> {
  const { data, error } = await supabase.rpc('my_schools');
  if (error) throw new Error(error.message);
  return (Array.isArray(data) ? data : []) as MySchool[];
}

const CHOSEN_KEY = 'bandmed_school_chosen';

/** O painel de escolha aparece uma vez por sessão do navegador (depois pode ser reaberto pelo botão "Trocar de escola"). */
export function isSchoolChosen(uid: string): boolean {
  try { return sessionStorage.getItem(CHOSEN_KEY) === uid; } catch { return false; }
}
export function markSchoolChosen(uid: string): void {
  try { sessionStorage.setItem(CHOSEN_KEY, uid); } catch { /* ignore */ }
}
export function clearSchoolChosen(): void {
  try { sessionStorage.removeItem(CHOSEN_KEY); } catch { /* ignore */ }
}

/**
 * Muda a escola ativa no servidor e prepara o navegador para arrancar limpo na nova escola
 * (sessão em cache, escola local ativa). Quem chama deve recarregar a página a seguir.
 */
export async function switchSchool(schoolId: string): Promise<void> {
  const { error } = await supabase.rpc('switch_institution', { p_inst: schoolId });
  if (error) throw new Error(error.message);
  try {
    localStorage.removeItem('bandmed_session_user');
    localStorage.setItem('escola_active_institution_id', schoolId);
  } catch { /* ignore */ }
}

// ---------------------------------------------------------------------------
// Painel agregado do grupo (migração 0025): os números de cada escola, para o cliente somar e filtrar.
// ---------------------------------------------------------------------------
export interface GroupSchoolStats {
  id: string;
  name: string;
  nif: string | null;
  status: 'active' | 'suspended' | 'archived';
  isMother: boolean;
  /** Logótipo da escola (https ou imagem pequena em base64); null se não definido. */
  logoUrl?: string | null;
  students: { total: number; regular: number; debt: number; attendanceSum: number; absences: number };
  teachers: number;
  departments: string[];
  classes: number;
  invoices: { invoiced: number; collected: number; pending: number; entradas: number };
  expenses: { paid: number; paidCount: number; payables: number };
  payroll: { paid: number; paidCount: number };
  assets: { value: number; count: number };
  /** Consumo contado pelo plano (alunos ativos, equipa, armazenamento). */
  usage: { students: number; users: number; storageBytes: number };
}

export interface GroupOverview {
  rootId: string;
  planName: string | null;
  /** null = ilimitado */
  limits: { students: number | null; users: number | null; storageBytes: number | null };
  usage: { students: number; users: number; storageBytes: number };
  schools: GroupSchoolStats[];
  serverTime: string;
}

export async function getGroupOverview(): Promise<GroupOverview | null> {
  const { data, error } = await supabase.rpc('my_group_overview');
  if (error || !data) return null;
  return data as GroupOverview;
}

// ---------------------------------------------------------------------------
// Planos públicos (página principal, sem login) — função public.public_plans() (migração 0027)
// ---------------------------------------------------------------------------
export interface PublicPlan {
  id: string; name: string; cycle: 'Mensal' | 'Trimestral' | 'Semestral' | 'Anual';
  priceKz: number; maxStudents: number | null; maxUsers: number | null; storageGb: number | null;
  trialDays: number; description: string | null;
}
export async function fetchPublicPlans(): Promise<PublicPlan[]> {
  const { data, error } = await supabase.rpc('public_plans');
  if (error) throw new Error(error.message);
  return Array.isArray(data) ? (data as PublicPlan[]) : [];
}

// ---------------------------------------------------------------------------
// Escolas registadas (carrossel da página principal, sem login) — função public.public_schools() (migração 0028)
// ---------------------------------------------------------------------------
export interface PublicSchool {
  id: string; name: string; nif: string | null; admin: string | null; province: string | null; logoUrl: string | null;
}
export async function fetchPublicSchools(): Promise<PublicSchool[]> {
  const { data, error } = await supabase.rpc('public_schools');
  if (error) throw new Error(error.message);
  return Array.isArray(data) ? (data as PublicSchool[]) : [];
}
