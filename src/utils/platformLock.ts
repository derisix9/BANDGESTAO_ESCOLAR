/**
 * BLOQUEIO DA PLATAFORMA (Admin Master)
 * =====================================
 * A equipa BandMed pode desativar subsistemas (módulos do menu) e secções
 * por escola. A lista de bloqueios vive no SERVIDOR
 * (public.school_feature_overrides, criada pela migração 0019) e é lida
 * aqui através da RPC pública my_feature_overrides().
 *
 * O bloqueio dos DADOS é garantido no servidor (app.can_access, migração
 * 0019) — este ficheiro trata da INTERFACE: esconder entradas do menu e
 * impedir a abertura de vistas bloqueadas.
 *
 * INSTALAÇÃO NA APP DA ESCOLA (2 passos):
 *
 * 1) Copie este ficheiro para  src/utils/platformLock.ts
 *
 * 2) Em src/utils/userAccess.ts, dentro de canViewSection(...), adicione
 *    como PRIMEIRA linha da função:
 *
 *        if (isPlatformSectionBlocked(sectionId)) return false;
 *
 *    (e importe: import { isPlatformSectionBlocked } from './platformLock';)
 *
 * 3) Em src/App.tsx, depois de o utilizador iniciar sessão, chame:
 *
 *        void initPlatformLock();
 *
 *    (ex.: dentro do useEffect que reage a isAuthenticated).
 */

import { supabase } from '../services/supabase';

interface PlatformOverrides {
  blockedModules: Record<string, boolean>;
  blockedSections: Record<string, boolean>;
  /** Subsistemas de ENSINO (pre_escolar, primario, secundario_1, secundario_2, superior) desligados pelo Admin Master. */
  blockedSubsystems: Record<string, boolean>;
}

let overrides: PlatformOverrides = { blockedModules: {}, blockedSections: {}, blockedSubsystems: {} };
let loaded = false;
const listeners = new Set<() => void>();

/** Avisa quando os bloqueios mudam (para a UI se redesenhar). Devolve a função de cancelar. */
export function onPlatformLockChange(fn: () => void): () => void {
  listeners.add(fn);
  return () => { listeners.delete(fn); };
}

/** Mapa secção → subsistema (chave do grupo do menu). Preenchido no arranque. */
let moduleOfSection: Record<string, string> = {};

/** Chame uma vez no arranque da app (App.tsx) para registar o mapa do menu. */
export function registerPlatformLockMap(navGroups: { key: string; items: { view?: string }[] }[]) {
  moduleOfSection = {};
  for (const g of navGroups) {
    for (const it of g.items) {
      if (it.view) moduleOfSection[it.view] = g.key;
    }
  }
}

/** Carrega os bloqueios desta escola (depois do login). */
export async function initPlatformLock(): Promise<void> {
  await loadPlatformOverrides();
}

async function loadPlatformOverrides(): Promise<void> {
  try {
    const { data, error } = await supabase.rpc('my_feature_overrides');
    if (!error && data) {
      overrides = {
        blockedModules: data.blockedModules ?? {},
        blockedSections: data.blockedSections ?? {},
        blockedSubsystems: data.blockedSubsystems ?? {}
      };
      loaded = true;
      listeners.forEach((fn) => fn());
    }
  } catch {
    /* sem rede: mantém o último estado conhecido */
  }
}

/** A secção está bloqueada pela plataforma para esta escola? */
export function isPlatformSectionBlocked(sectionId: string): boolean {
  if (!loaded) return false;                       // fail-open na UI; o SERVIDOR bloqueia os dados
  const mod = moduleOfSection[sectionId];
  // Painel Principal e Configurações nunca são bloqueados (a escola precisa deles para regularizar a conta).
  if (mod === 'geral' || mod === 'configuracoes' || sectionId === 'dashboard' || sectionId.startsWith('configuracoes')) return false;
  if (overrides.blockedSections[sectionId]) return true;
  return !!(mod && overrides.blockedModules[mod]);
}

/** Para ecrãs de aviso: o subsistema inteiro está bloqueado? */
export function isPlatformModuleBlocked(moduleKey: string): boolean {
  return !!overrides.blockedModules[moduleKey];
}

/**
 * A caixa tem de estar aberta para registar pagamentos?
 * Só quando a escola tem a secção "Fluxo de Caixa" (contabilidade) ativa. Se o Admin Master a desativou
 * para esta escola, não existe forma de abrir caixa — por isso o bloqueio "sem caixa aberta não há
 * pagamentos" não se aplica. Enquanto os bloqueios não carregam, mantém-se a exigência (lado seguro).
 */
export function isCashRegisterRequired(): boolean {
  return !isPlatformSectionBlocked('contabilidade');
}

/**
 * O subsistema de ENSINO (Pré-Escolar, Primário, I Ciclo, II Ciclo/Médio, Superior) foi
 * desligado pelo Admin Master para esta escola? Se sim, a escola não o vê em
 * Configurações → Instituição nem nas classes/áreas que dele dependem.
 */
export function isEducationSubsystemBlocked(subsystemId: string): boolean {
  return !!overrides.blockedSubsystems[subsystemId];
}
