/**
 * Dados da escola guardados NO DISPOSITIVO (passo 8 da auditoria).
 * Antes, terminar a sessão só apagava `bandmed_session_user`: a base de dados inteira (alunos, notas, finanças)
 * ficava em localStorage e IndexedDB em texto simples, à vista do próximo utilizador do computador (sala de informática, cibercafé).
 * Agora, ao SAIR (botão, inatividade, sessão expirada) ou ao abrir a app sem sessão, apaga-se tudo o que é da escola.
 * Excepção: se existirem alterações por sincronizar (trabalho offline), NADA é apagado, para não perder trabalho;
 * apaga-se assim que a sincronização terminar e a pessoa sair.
 * Quem continua com a sessão aberta (Lembrar-me) mantém os dados no aparelho para trabalhar sem internet, como antes.
 */
export interface KeyValueStore {
  readonly length: number;
  key(i: number): string | null;
  getItem(k: string): string | null;
  removeItem(k: string): void;
}

/** Chaves exactas e prefixos de localStorage que contêm dados da escola ou da pessoa. */
export const LOCAL_EXACT_KEYS = ['bandmed_escola_db_v1', 'bandmed_session_user', 'escola_active_institution_id', 'escola_institutions_index', 'bandgest.i18n.en.v1', 'bm_offline_lease', 'bm_vault_salt', 'bm_vault_salt_data', 'bm_vault_check'];
export const LOCAL_PREFIXES = ['escola_inst_', 'escola_access_map_', 'escola_pending_'];

/** Há alterações feitas sem rede que ainda não chegaram ao servidor? (marca escola_pending_<escola> = '1') */
export function hasUnsyncedLocalChanges(store: KeyValueStore): boolean {
  for (let i = 0; i < store.length; i++) {
    const k = store.key(i);
    if (k && k.startsWith('escola_pending_') && store.getItem(k) === '1') return true;
  }
  return false;
}

/**
 * Apaga os dados da escola deste dispositivo. Devolve false (e não apaga nada) se houver alterações por sincronizar.
 * `clearIndexedDb` limpa a base IndexedDB (injectada para poder testar sem navegador).
 */
export function purgeLocalSchoolData(store: KeyValueStore, clearIndexedDb: () => unknown): boolean {
  if (hasUnsyncedLocalChanges(store)) return false;
  const doomed: string[] = [];
  for (let i = 0; i < store.length; i++) {
    const k = store.key(i);
    if (k && (LOCAL_EXACT_KEYS.includes(k) || LOCAL_PREFIXES.some((p) => k.startsWith(p)))) doomed.push(k);
  }
  doomed.forEach((k) => { try { store.removeItem(k); } catch { /* quota/bloqueado: segue */ } });
  try { void clearIndexedDb(); } catch { /* sem IndexedDB */ }
  return true;
}
