import { describe, it, expect, beforeAll } from 'vitest';

// IndexedDB mínimo em memória: só o que SchoolIndexedDB usa (open/onupgradeneeded, transaction, put/get/clear/openCursor).
const data = new Map<string, any>();
const mkReq = (fn: () => any) => { const r: any = {}; queueMicrotask(() => { try { r.result = fn(); r.onsuccess?.(); } catch (e) { r.onerror?.(e); } }); return r; };
const store = {
  put: (v: any, k: string) => mkReq(() => { data.set(k, v); }),
  get: (k: string) => mkReq(() => data.get(k)),
  clear: () => mkReq(() => { data.clear(); }),
  openCursor: () => { const r: any = {}; const keys = [...data.keys()]; let i = 0;
    const step = () => { const key = keys[i]; r.result = key === undefined ? null : { value: data.get(key), delete: () => data.delete(key), continue: () => { i++; queueMicrotask(step); } }; r.onsuccess?.(); };
    queueMicrotask(step); return r; }
};
const mkTx = () => { const tx: any = { objectStore: () => store }; setTimeout(() => tx.oncomplete?.(), 5); return tx; };
const dbObj: any = { transaction: mkTx, objectStoreNames: { contains: () => true }, createObjectStore: () => {} };
(globalThis as any).indexedDB = { open: () => { const r: any = {}; queueMicrotask(() => { r.result = dbObj; r.onsuccess?.(); }); return r; } };
class Mem { m = new Map<string, string>(); getItem(k: string) { return this.m.get(k) ?? null; } setItem(k: string, v: string) { this.m.set(k, v); } removeItem(k: string) { this.m.delete(k); } }
(globalThis as any).localStorage = new Mem(); (globalThis as any).sessionStorage = new Mem();
(globalThis as any).window = globalThis;
// `window` aqui é só o globalThis do Node: faltam os ouvintes de eventos e o `document` que o serviço regista ao arrancar.
(globalThis as any).addEventListener ??= () => {};
(globalThis as any).removeEventListener ??= () => {};
(globalThis as any).document ??= { addEventListener: () => {}, removeEventListener: () => {}, visibilityState: 'visible' };


let idbService: any, getVault: any, isEncryptedBox: any;
const DB: any = { settings: { institutionId: 'inst_x' }, students: [{ name: 'Rui Silva' }], users: [] };

describe('IndexedDB da escola: só cifrado (cofre local)', () => {
  beforeAll(async () => {
    ({ idbService } = await import('../src/services/db'));
    ({ getVault, isEncryptedBox } = await import('../src/services/localVault'));
  });
  it('sem chave não grava em claro', async () => { expect(await idbService.save(DB)).toBe(false); expect(data.size).toBe(0); });
  it('com cofre grava só cifrado e volta a ler', async () => {
    await getVault().setup('Segredo#12345', () => {});
    expect(await idbService.save(DB)).toBe(true);
    expect([...data.values()].every(isEncryptedBox)).toBe(true);
    expect(data.has('inst_x')).toBe(true);
    expect(await idbService.load('inst_x')).toEqual(DB);
  });
  it('bloqueado: a cópia cifrada não abre', async () => { getVault().lock(); expect(await idbService.load('inst_x')).toBeNull(); });
  it('scrubPlaintext apaga restos em claro e mantém o cifrado', async () => {
    await getVault().unlockOrCreate('Segredo#12345'); data.set('inst_old', { students: [{ name: 'claro' }] });
    await idbService.scrubPlaintext();
    expect(data.has('inst_old')).toBe(false); expect(data.has('inst_x')).toBe(true);
  });
  it('registo em claro antigo ainda lê (migração) e é apagado à primeira gravação cifrada', async () => {
    data.clear(); data.set('inst_x', DB); data.set('current_db', DB);
    expect(await idbService.load('inst_x')).toEqual(DB);
    await idbService.save(DB); await idbService.scrubPlaintext();
    expect([...data.values()].every(isEncryptedBox)).toBe(true);
  });
});
