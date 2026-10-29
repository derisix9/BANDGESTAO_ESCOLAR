import { describe, it, expect } from 'vitest';
import { LocalVault, isEncryptedBox, VAULT_CHECK_KEY, VAULT_SALT_KEY, VAULT_SESSION_KEY } from '../src/services/localVault';

class Mem { m = new Map<string, string>();
  getItem(k: string) { return this.m.get(k) ?? null; } setItem(k: string, v: string) { this.m.set(k, v); } removeItem(k: string) { this.m.delete(k); } }
const IT = 1000;   // poucas iterações só nos testes (rápido)
const mk = () => { const local = new Mem(), session = new Mem(); return { local, session, v: new LocalVault(local, session, IT) }; };
const DB = { users: [{ id: 'u1', name: 'Ana' }], students: [{ id: 's1', name: 'Rui Silva' }] };

describe('cofre local (cifra da cópia no aparelho)', () => {
  it('cifra e decifra; o texto cifrado não contém dados legíveis', async () => {
    const { v } = mk(); await v.setup('Segredo#12345', () => {});
    const box = await v.encrypt(DB);
    expect(isEncryptedBox(box)).toBe(true);
    expect(new TextDecoder().decode(box!.ct).includes('Rui Silva')).toBe(false);
    expect(await v.decrypt(box!)).toEqual(DB);
  });
  it('cada gravação usa um IV novo', async () => {
    const { v } = mk(); await v.setup('Segredo#12345', () => {});
    const a = await v.encrypt(DB), b = await v.encrypt(DB);
    expect(Buffer.from(a!.iv).equals(Buffer.from(b!.iv))).toBe(false);
  });
  it('bloqueado: não grava nem lê', async () => {
    const { v } = mk(); await v.setup('Segredo#12345', () => {});
    const box = await v.encrypt(DB); v.lock();
    expect(v.isLocked()).toBe(true);
    expect(await v.encrypt(DB)).toBeNull();
    expect(await v.decrypt(box!)).toBeNull();
  });
  it('só a chave certa abre: palavra-passe errada recusada, certa aceite', async () => {
    const { v } = mk(); await v.setup('Segredo#12345', () => {}); const box = await v.encrypt(DB); v.lock();
    expect(await v.unlock('errada')).toBe(false); expect(v.isLocked()).toBe(true);
    expect(await v.unlock('Segredo#12345')).toBe(true);
    expect(await v.decrypt(box!)).toEqual(DB);
  });
  it('detecta alteração do registo cifrado', async () => {
    const { v } = mk(); await v.setup('Segredo#12345', () => {});
    const box = await v.encrypt(DB); box!.ct[0] ^= 1;
    expect(await v.decrypt(box!)).toBeNull();
  });
  it('a chave NÃO vai para o armazenamento persistente (só sessão)', async () => {
    const { v, local, session } = mk(); await v.setup('Segredo#12345', () => {});
    expect(session.getItem(VAULT_SESSION_KEY)).toBeTruthy();
    expect([...local.m.keys()].sort()).toEqual([VAULT_CHECK_KEY, VAULT_SALT_KEY].sort());
    expect([...local.m.values()].join('').includes(session.getItem(VAULT_SESSION_KEY)!)).toBe(false);
  });
  it('recarregar a página (novo objecto, mesma sessão) mantém o cofre aberto; fechar o navegador não', async () => {
    const { v, local, session } = mk(); await v.setup('Segredo#12345', () => {}); const box = await v.encrypt(DB);
    const reload = new LocalVault(local, session, IT); await reload.ready();
    expect(reload.isLocked()).toBe(false); expect(await reload.decrypt(box!)).toEqual(DB);
    const reopened = new LocalVault(local, new Mem(), IT); await reopened.ready();   // sessionStorage vazio
    expect(reopened.isLocked()).toBe(true); expect(await reopened.decrypt(box!)).toBeNull();
  });
  it('novo login com a mesma palavra-passe reabre a cópia ("unlocked"); com outra, apaga a cópia antiga ("reset")', async () => {
    const { v, local, session } = mk(); expect(await v.setup('Segredo#12345', () => {})).toBe('created');
    const box = await v.encrypt(DB); v.lock();
    let cleared = 0;
    const again = new LocalVault(local, new Mem(), IT);
    expect(await again.setup('Segredo#12345', () => { cleared++; })).toBe('unlocked');
    expect(cleared).toBe(0); expect(await again.decrypt(box!)).toEqual(DB);
    const other = new LocalVault(local, new Mem(), IT);
    expect(await other.setup('Outra#98765', () => { cleared++; })).toBe('reset');
    expect(cleared).toBe(1); expect(await other.decrypt(box!)).toBeNull();
    void session;
  });
  it('unlockOrCreate: com cofre exige a palavra-passe; sem cofre cria um novo', async () => {
    const a = mk(); expect(await a.v.unlockOrCreate('x')).toBe(true);
    const b = mk(); await b.v.setup('Segredo#12345', () => {}); b.v.lock();
    expect(await b.v.unlockOrCreate('errada')).toBe(false);
    expect(await b.v.unlockOrCreate('Segredo#12345')).toBe(true);
  });
  it('prova de palavra-passe alterada é recusada', async () => {
    const { v, local } = mk(); await v.setup('Segredo#12345', () => {}); v.lock();
    const c = JSON.parse(local.getItem(VAULT_CHECK_KEY)!); c.ct = c.ct.slice(0, -4) + 'AAAA'; local.setItem(VAULT_CHECK_KEY, JSON.stringify(c));
    expect(await v.unlock('Segredo#12345')).toBe(false);
  });
  it('destroy apaga sal e prova', async () => {
    const { v, local } = mk(); await v.setup('Segredo#12345', () => {}); v.destroy();
    expect(v.hasVault()).toBe(false); expect(local.m.size).toBe(0);
  });
});
