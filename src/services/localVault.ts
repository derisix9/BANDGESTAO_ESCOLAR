/**
 * Cofre local: cifra a cópia da base de dados que fica no dispositivo (passo 8, "próximo passo").
 *
 *  • A chave AES-GCM de 256 bits é derivada da PALAVRA-PASSE no login (PBKDF2-SHA256, 600 000 iterações, sal próprio).
 *  • A chave fica só em `sessionStorage` (desaparece ao fechar o navegador) e em memória. Nunca vai para `localStorage`.
 *  • Em `localStorage` fica apenas o sal e uma "prova" cifrada (`bm_vault_check`) que serve para saber se a palavra-passe
 *    escrita desbloqueia o cofre; não contém dados da escola.
 *  • Cada gravação usa um IV aleatório novo. A autenticação do AES-GCM detecta alterações ao ficheiro.
 *  • Sem a chave, a cópia local é ilegível: a app volta a buscar tudo ao servidor (online) ou pede a palavra-passe (offline).
 *
 * Não protege contra quem tenha acesso ao navegador ENQUANTO a sessão está aberta (a chave está em memória), nem contra
 * malware no computador. Protege o disco: computador roubado, sala de informática partilhada, perfil copiado.
 */
export interface VaultStore {
  getItem(k: string): string | null;
  setItem(k: string, v: string): void;
  removeItem(k: string): void;
}

export const VAULT_SALT_KEY = 'bm_vault_salt_data';
export const VAULT_CHECK_KEY = 'bm_vault_check';
export const VAULT_SESSION_KEY = 'bm_vault_key';
export const VAULT_ITERATIONS = 600_000;
const CHECK_TEXT = 'bandmed-vault-v1';
const AAD = new TextEncoder().encode('bandmed-local-db');

/** Registo cifrado tal como fica no IndexedDB (binário; o IndexedDB guarda Uint8Array sem conversões). */
export interface EncryptedBox { __enc: 1; iv: Uint8Array<ArrayBuffer>; ct: Uint8Array<ArrayBuffer> }
export const isEncryptedBox = (x: unknown): x is EncryptedBox =>
  !!x && typeof x === 'object' && (x as any).__enc === 1 && (x as any).iv instanceof Uint8Array && (x as any).ct instanceof Uint8Array;

const enc = new TextEncoder();
const dec = new TextDecoder();
const b64 = (u: Uint8Array) => { let s = ''; for (let i = 0; i < u.length; i++) s += String.fromCharCode(u[i]); return btoa(s); };
const unb64 = (s: string): Uint8Array<ArrayBuffer> => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

export type SetupResult = 'created' | 'unlocked' | 'reset';

export class LocalVault {
  private key: CryptoKey | null = null;
  private restoring: Promise<void> | null = null;

  constructor(
    private readonly persistent: VaultStore,      // localStorage: sal + prova
    private readonly session: VaultStore,         // sessionStorage: chave bruta
    private readonly iterations = VAULT_ITERATIONS
  ) {
    this.restoreFromSession();
  }

  /** Há cofre configurado neste aparelho (sal + prova)? */
  hasVault(): boolean { return !!this.persistent.getItem(VAULT_SALT_KEY) && !!this.persistent.getItem(VAULT_CHECK_KEY); }
  isLocked(): boolean { return this.key === null; }

  /** Reabre a chave guardada no separador (recarregar a página não pede a palavra-passe outra vez). */
  private restoreFromSession(): void {
    const raw = this.session.getItem(VAULT_SESSION_KEY);
    if (!raw) return;
    this.restoring = crypto.subtle.importKey('raw', unb64(raw), 'AES-GCM', true, ['encrypt', 'decrypt'])
      .then((k) => { this.key = k; })
      .catch(() => { try { this.session.removeItem(VAULT_SESSION_KEY); } catch { /* ignore */ } })
      .finally(() => { this.restoring = null; });
  }

  /** Espera que a chave do separador esteja carregada (chamar antes de decidir se o cofre está bloqueado). */
  async ready(): Promise<void> { if (this.restoring) await this.restoring; }

  private async derive(password: string, salt: Uint8Array<ArrayBuffer>, iterations = this.iterations): Promise<CryptoKey> {
    const base = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveKey']);
    return crypto.subtle.deriveKey({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations }, base, { name: 'AES-GCM', length: 256 }, true, ['encrypt', 'decrypt']);
  }

  private async adopt(key: CryptoKey): Promise<void> {
    this.key = key;
    try { this.session.setItem(VAULT_SESSION_KEY, b64(new Uint8Array(await crypto.subtle.exportKey('raw', key)))); } catch { /* sem sessionStorage: só em memória */ }
  }

  private async makeCheck(key: CryptoKey): Promise<string> {
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: AAD }, key, enc.encode(CHECK_TEXT)));
    return JSON.stringify({ v: 1, it: this.iterations, iv: b64(iv), ct: b64(ct) });
  }

  private async createNew(password: string): Promise<void> {
    const salt = crypto.getRandomValues(new Uint8Array(16));
    const key = await this.derive(password, salt);
    this.persistent.setItem(VAULT_SALT_KEY, b64(salt));
    this.persistent.setItem(VAULT_CHECK_KEY, await this.makeCheck(key));
    await this.adopt(key);
  }

  /** Tenta abrir o cofre existente com a palavra-passe. false = palavra-passe errada (ou prova alterada). */
  async unlock(password: string): Promise<boolean> {
    const salt = this.persistent.getItem(VAULT_SALT_KEY);
    const check = this.persistent.getItem(VAULT_CHECK_KEY);
    if (!salt || !check) return false;
    try {
      const box = JSON.parse(check) as { it?: number; iv: string; ct: string };
      const key = await this.derive(password, unb64(salt), box.it || this.iterations);
      const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64(box.iv), additionalData: AAD }, key, unb64(box.ct));
      if (dec.decode(pt) !== CHECK_TEXT) return false;
      await this.adopt(key);
      return true;
    } catch { return false; }
  }

  /**
   * Chamado logo a seguir a um login online com palavra-passe confirmada pelo servidor.
   *  • sem cofre → cria-o ('created');
   *  • com cofre e a palavra-passe abre-o → 'unlocked';
   *  • com cofre mas a palavra-passe já não o abre (foi alterada noutro lado) → a cópia local antiga é ilegível:
   *    apaga-a (`clearOld`) e cria um cofre novo ('reset'). Os dados voltam a vir do servidor.
   */
  async setup(password: string, clearOld: () => unknown): Promise<SetupResult> {
    await this.ready();
    if (this.hasVault()) {
      if (await this.unlock(password)) return 'unlocked';
      this.lock();
      try { await clearOld(); } catch { /* ignore */ }
      await this.createNew(password);
      return 'reset';
    }
    // Sem cofre mas pode haver cópia local ANTIGA em claro (versão anterior): fica; é apagada à primeira gravação cifrada.
    await this.createNew(password);
    return 'created';
  }

  /** Desbloqueio offline: abre o cofre; se ainda não existir (nada cifrado para ler) cria um novo. */
  async unlockOrCreate(password: string): Promise<boolean> {
    await this.ready();
    if (this.hasVault()) return this.unlock(password);
    await this.createNew(password);
    return true;
  }

  /** Esquece a chave (sair, inatividade). A cópia cifrada fica no disco mas ilegível. */
  lock(): void {
    this.key = null;
    try { this.session.removeItem(VAULT_SESSION_KEY); } catch { /* ignore */ }
  }

  /** Apaga sal e prova (usado quando a cópia local é apagada: o cofre deixa de ter razão de existir). */
  destroy(): void {
    this.lock();
    try { this.persistent.removeItem(VAULT_SALT_KEY); this.persistent.removeItem(VAULT_CHECK_KEY); } catch { /* ignore */ }
  }

  async encrypt(data: unknown): Promise<EncryptedBox | null> {
    await this.ready();   // a chave do separador pode ainda estar a ser reaberta logo após recarregar a página
    const key = this.key;
    if (!key) return null;
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: AAD }, key, enc.encode(JSON.stringify(data))));
    return { __enc: 1, iv, ct };
  }

  /** null = bloqueado, registo alterado ou chave errada. */
  async decrypt<T = unknown>(box: EncryptedBox): Promise<T | null> {
    await this.ready();
    const key = this.key;
    if (!key) return null;
    try {
      const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: box.iv, additionalData: AAD }, key, box.ct);
      return JSON.parse(dec.decode(pt)) as T;
    } catch { return null; }
  }
}

// ---------------------------------------------------------------------------------------------------------------------
// Instância da aplicação (navegador). Nos testes cria-se `new LocalVault(...)` com armazenamento em memória.
// ---------------------------------------------------------------------------------------------------------------------
let shared: LocalVault | null = null;
export function getVault(): LocalVault | null {
  if (shared) return shared;
  try {
    if (typeof localStorage === 'undefined' || typeof sessionStorage === 'undefined' || typeof crypto === 'undefined' || !crypto.subtle) return null;
    shared = new LocalVault(localStorage, sessionStorage);
  } catch { return null; }
  return shared;
}

/** Enquanto o login corre (em memória), o arranque da app não deve tratar o evento de sessão como "navegador reaberto". */
let loginBusy = 0;
export const markLoginBusy = (on: boolean) => { loginBusy = Math.max(0, loginBusy + (on ? 1 : -1)); };
export const isLoginBusy = () => loginBusy > 0;

/** "Continuar sem guardar no aparelho" (só online e sem alterações por sincronizar): vale para este separador. */
export const VAULT_SKIP_KEY = 'bm_vault_skip';
