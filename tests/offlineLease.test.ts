import { describe, it, expect } from 'vitest';
import { writeOfflineLease, openOfflineLease, LEASE_KEY, markOfflineUnlocked, isOfflineUnlocked } from '../src/services/offlineLease';

class Mem { m = new Map<string, string>();
  get length() { return this.m.size; } key(i: number) { return [...this.m.keys()][i] ?? null; }
  getItem(k: string) { return this.m.get(k) ?? null; } setItem(k: string, v: string) { this.m.set(k, v); } removeItem(k: string) { this.m.delete(k); } }
const IT = 1000;           // poucas iterações só nos testes (rápido)
const DAY = 86_400_000;

describe('entrada offline com 2FA (lease cifrado)', () => {
  it('abre com a palavra-passe certa', async () => {
    const s = new Mem(); await writeOfflineLease(s, 'Segredo#12345', { uid: 'u1', role: 'admin', mfa: true }, IT);
    const r = await openOfflineLease(s, 'Segredo#12345', 'u1', { requireMfa: true });
    expect(r.ok).toBe(true);
  });
  it('recusa palavra-passe errada', async () => {
    const s = new Mem(); await writeOfflineLease(s, 'Segredo#12345', { uid: 'u1', role: 'admin', mfa: true }, IT);
    expect(await openOfflineLease(s, 'errada', 'u1')).toEqual({ ok: false, reason: 'palavra-passe' });
  });
  it('recusa outra conta', async () => {
    const s = new Mem(); await writeOfflineLease(s, 'Segredo#12345', { uid: 'u1', role: 'admin', mfa: true }, IT);
    expect(await openOfflineLease(s, 'Segredo#12345', 'u2')).toEqual({ ok: false, reason: 'outra-conta' });
  });
  it('recusa lease antigo (> 7 dias) e relógio atrasado', async () => {
    const s = new Mem(); const t0 = 1_800_000_000_000; await writeOfflineLease(s, 'Segredo#12345', { uid: 'u1', role: 'admin', mfa: true }, IT, t0);
    expect(await openOfflineLease(s, 'Segredo#12345', 'u1', { now: t0 + 6 * DAY })).toMatchObject({ ok: true });
    expect(await openOfflineLease(s, 'Segredo#12345', 'u1', { now: t0 + 8 * DAY })).toEqual({ ok: false, reason: 'expirado' });
    expect(await openOfflineLease(s, 'Segredo#12345', 'u1', { now: t0 - 3 * DAY })).toEqual({ ok: false, reason: 'expirado' });
  });
  it('exige que o último login tenha tido 2FA', async () => {
    const s = new Mem(); await writeOfflineLease(s, 'Segredo#12345', { uid: 'u1', role: 'admin', mfa: false }, IT);
    expect(await openOfflineLease(s, 'Segredo#12345', 'u1', { requireMfa: true })).toEqual({ ok: false, reason: 'sem-2fa' });
    expect((await openOfflineLease(s, 'Segredo#12345', 'u1', { requireMfa: false })).ok).toBe(true);
  });
  it('detecta alteração do ficheiro (não dá para forjar mfa:true)', async () => {
    const s = new Mem(); await writeOfflineLease(s, 'Segredo#12345', { uid: 'u1', role: 'admin', mfa: false }, IT);
    const box = JSON.parse(s.getItem(LEASE_KEY)!); const bytes = Uint8Array.from(atob(box.ct), (c) => c.charCodeAt(0)); bytes[0] ^= 1;
    box.ct = btoa(String.fromCharCode(...bytes)); s.setItem(LEASE_KEY, JSON.stringify(box));
    expect(await openOfflineLease(s, 'Segredo#12345', 'u1')).toEqual({ ok: false, reason: 'palavra-passe' });
  });
  it('não tem lease → pede login online', async () => {
    expect(await openOfflineLease(new Mem(), 'x', 'u1')).toEqual({ ok: false, reason: 'sem-lease' });
  });
  it('a palavra-passe não aparece em claro no armazenamento', async () => {
    const s = new Mem(); await writeOfflineLease(s, 'Segredo#12345', { uid: 'u1', role: 'admin', mfa: true }, IT);
    expect(JSON.stringify([...s.m.entries()])).not.toContain('Segredo');
    expect(JSON.stringify([...s.m.entries()])).not.toContain('"admin"');
  });
  it('marca de desbloqueio por separador', () => {
    const ss = new Mem(); markOfflineUnlocked(ss, 'u1');
    expect(isOfflineUnlocked(ss, 'u1')).toBe(true); expect(isOfflineUnlocked(ss, 'u2')).toBe(false);
  });
});
