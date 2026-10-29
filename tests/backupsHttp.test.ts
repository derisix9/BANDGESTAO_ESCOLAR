import { describe, it, expect } from 'vitest';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { SchoolBackups } from '../server/schoolBackups';
import { createBackupHandler, supabaseAuthenticator } from '../server/backupsHttp';
import { FakeDb, MemStore } from './backupFakes';

const SECRET = 'y'.repeat(48);
const PW = 'palavra-passe do admin';
const TOK_A = 'token-admin-a', TOK_B = 'token-admin-b';

async function boot(opts: { origin?: string; maxUpload?: number } = {}) {
  const db = new FakeDb(); const store = new MemStore();
  const clock = { t: Date.parse('2026-10-11T10:00:00Z') };
  db.seed('esc_a', { records: { s1: 'Ana' }, settings: { v: 1 } });
  db.seed('esc_b', { records: { s9: 'Outro' }, settings: { v: 9 } });
  const svc = new SchoolBackups({ rpc: db, store, masterSecret: SECRET, now: () => new Date(clock.t), minManualIntervalMs: 0 });
  const handle = createBackupHandler({
    svc, now: () => clock.t, allowedOrigin: opts.origin, maxUploadBytes: opts.maxUpload,
    authenticate: async (t) => t === TOK_A ? { userId: 'ua', institutionId: 'esc_a' } : t === TOK_B ? { userId: 'ub', institutionId: 'esc_b' } : null
  });
  const server: Server = createServer((req, res) => { void handle(req, res).then((d) => { if (!d) { res.statusCode = 404; res.end('x'); } }); });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const call = async (method: string, path: string, o: { token?: string | null; body?: unknown; raw?: Buffer; headers?: Record<string, string> } = {}) => {
    const headers: Record<string, string> = { ...(o.headers ?? {}) };
    if (o.token !== null) headers.Authorization = `Bearer ${o.token ?? TOK_A}`;
    let body: any;
    if (o.raw) body = o.raw; else if (o.body !== undefined) { body = JSON.stringify(o.body); headers['Content-Type'] = 'application/json'; }
    const res = await fetch(base + path, { method, headers, body });
    const buf = Buffer.from(await res.arrayBuffer());
    let j: any = null; try { j = JSON.parse(buf.toString()); } catch { /* binário */ }
    return { status: res.status, json: j, buf, headers: res.headers };
  };
  return { db, store, clock, svc, call, close: () => new Promise<void>((r) => server.close(() => r())) };
}

describe('API de backups', () => {
  it('exige sessão válida de administrador', async () => {
    const h = await boot();
    expect((await h.call('GET', '/backups', { token: null })).status).toBe(401);
    expect((await h.call('GET', '/backups', { token: 'falso' })).status).toBe(401);
    expect((await h.call('POST', '/backups', { token: 'falso', body: { password: PW } })).status).toBe(401);
    expect(h.store.files.size).toBe(0);
    await h.close();
  });

  it('cria, lista, descarrega e apaga (ciclo completo)', async () => {
    const h = await boot();
    const c = await h.call('POST', '/backups', { body: { password: PW } });
    expect(c.status).toBe(201); const id = c.json.backup.id;
    const l = await h.call('GET', '/backups'); expect(l.json.backups.map((b: any) => b.id)).toEqual([id]);
    const d = await h.call('GET', `/backups/${id}/download`);
    expect(d.status).toBe(200); expect(d.headers.get('content-disposition')).toMatch(/\.bmbak/); expect(d.buf.subarray(0, 6).toString()).toBe('BMBAK1');
    expect((await h.call('DELETE', `/backups/${id}`)).status).toBe(200);
    expect((await h.call('GET', '/backups')).json.backups).toEqual([]);
    await h.close();
  });

  it('a escola vem da sessão: B não vê, não descarrega e não restaura os backups de A', async () => {
    const h = await boot();
    const id = (await h.call('POST', '/backups', { body: { password: PW } })).json.backup.id;
    expect((await h.call('GET', '/backups', { token: TOK_B })).json.backups).toEqual([]);
    expect((await h.call('GET', `/backups/${id}/download`, { token: TOK_B })).status).toBe(404);
    expect((await h.call('POST', `/backups/${id}/restore`, { token: TOK_B, body: { password: PW, confirm: 'RESTAURAR' } })).status).toBe(404);
    expect((await h.call('DELETE', `/backups/${id}`, { token: TOK_B })).status).toBe(404);
    expect(h.db.restoreCalls).toHaveLength(0);
    await h.close();
  });

  it('restauro exige confirmação "RESTAURAR"', async () => {
    const h = await boot();
    const id = (await h.call('POST', '/backups', { body: { password: PW } })).json.backup.id;
    expect((await h.call('POST', `/backups/${id}/restore`, { body: { password: PW } })).status).toBe(400);
    expect((await h.call('POST', `/backups/${id}/restore`, { body: { password: PW, confirm: 'sim' } })).status).toBe(400);
    expect(h.db.restoreCalls).toHaveLength(0);
    h.db.seed('esc_a', { records: {}, settings: {} });
    const r = await h.call('POST', `/backups/${id}/restore`, { body: { password: PW, confirm: 'RESTAURAR' } });
    expect(r.status).toBe(200); expect(r.json.safetyId).toMatch(/_safety_/);
    expect(h.db.schools.get('esc_a')).toEqual({ records: { s1: 'Ana' }, settings: { v: 1 } });
    await h.close();
  });

  it('palavra-passe errada: 403 e, após 5 tentativas, 429 (trava de força bruta); a janela expira', async () => {
    const h = await boot();
    const id = (await h.call('POST', '/backups', { body: { password: PW } })).json.backup.id;
    const bad = () => h.call('POST', `/backups/${id}/restore`, { body: { password: 'errada errada', confirm: 'RESTAURAR' } });
    for (let i = 0; i < 5; i++) expect((await bad()).status).toBe(403);
    expect((await bad()).status).toBe(429);
    expect((await h.call('POST', `/backups/${id}/restore`, { body: { password: PW, confirm: 'RESTAURAR' } })).status).toBe(429);   // nem a certa, durante o bloqueio
    expect((await h.call('POST', `/backups/${id}/restore`, { token: TOK_B, body: { password: PW, confirm: 'RESTAURAR' } })).status).toBe(404);   // outra escola não é afectada
    h.clock.t += 11 * 60_000;
    expect((await h.call('POST', `/backups/${id}/restore`, { body: { password: PW, confirm: 'RESTAURAR' } })).status).toBe(200);
    await h.close();
  });

  it('palavra-passe fraca → 400', async () => {
    const h = await boot();
    expect((await h.call('POST', '/backups', { body: { password: 'curta' } })).status).toBe(400);
    expect((await h.call('POST', '/backups', { body: {} })).status).toBe(400);
    await h.close();
  });

  it('JSON inválido → 400; corpo enorme → 413', async () => {
    const h = await boot();
    expect((await h.call('POST', '/backups', { raw: Buffer.from('{nao json'), headers: { 'Content-Type': 'application/json' } })).status).toBe(400);
    expect((await h.call('POST', '/backups', { raw: Buffer.alloc(20_000, 97), headers: { 'Content-Type': 'application/json' } })).status).toBe(413);
    await h.close();
  });

  it('run-auto cria backup automático e tem intervalo mínimo', async () => {
    const h = await boot();
    const r = await h.call('POST', '/backups/run-auto'); expect(r.status).toBe(201); expect(r.json.backup.kind).toBe('auto');
    expect((await h.call('POST', '/backups/run-auto')).status).toBe(429);
    h.clock.t += 61_000;
    expect((await h.call('POST', '/backups/run-auto')).status).toBe(201);
    await h.close();
  });

  it('importar: ficheiro descarregado volta à lista; de outra escola ou com palavra-passe errada é recusado', async () => {
    const h = await boot();
    const id = (await h.call('POST', '/backups', { body: { password: PW } })).json.backup.id;
    const file = (await h.call('GET', `/backups/${id}/download`)).buf;
    h.store.files.clear(); h.clock.t += 1000;
    expect((await h.call('POST', '/backups/import', { raw: file, headers: { 'x-backup-password': PW } })).status).toBe(201);
    expect((await h.call('GET', '/backups')).json.backups).toHaveLength(1);
    expect((await h.call('POST', '/backups/import', { token: TOK_B, raw: file, headers: { 'x-backup-password': PW } })).status).toBe(403);
    expect((await h.call('POST', '/backups/import', { raw: file, headers: { 'x-backup-password': 'errada errada' } })).status).toBe(403);
    await h.close();
  });

  it('importar: ficheiro maior que o limite → 413', async () => {
    const h = await boot({ maxUpload: 1000 });
    expect((await h.call('POST', '/backups/import', { raw: Buffer.alloc(5000), headers: { 'x-backup-password': PW } })).status).toBe(413);
    await h.close();
  });

  it('ids com fugas de pasta e rotas desconhecidas', async () => {
    const h = await boot();
    expect((await h.call('GET', '/backups/..%2F..%2Fx/download')).status).toBe(400);
    expect((await h.call('GET', '/backups/20261011T100000Z_manual_p_abcdef/download')).status).toBe(404);
    expect((await h.call('PUT', '/backups')).status).toBe(404);
    expect((await h.call('GET', '/outra-coisa', { token: null })).status).toBe(404);
    await h.close();
  });

  it('CORS só com a origem configurada; OPTIONS responde sem sessão', async () => {
    const h = await boot({ origin: 'https://escola.exemplo.ao' });
    const o = await h.call('OPTIONS', '/backups', { token: null });
    expect(o.status).toBe(204); expect(o.headers.get('access-control-allow-origin')).toBe('https://escola.exemplo.ao');
    await h.close();
    const h2 = await boot();
    expect((await h2.call('GET', '/backups')).headers.get('access-control-allow-origin')).toBeNull();
    await h2.close();
  });

  it('erro interno não vaza detalhes', async () => {
    const h = await boot(); h.db.failExportFor.add('esc_a');
    const r = await h.call('POST', '/backups', { body: { password: PW } });
    expect(r.status).toBe(502); expect(JSON.stringify(r.json)).not.toMatch(/stack|at /);
    await h.close();
  });
});

describe('supabaseAuthenticator', () => {
  const mk = (user: any, profile: any) => supabaseAuthenticator({ url: 'https://p.supabase.co/', anonKey: 'anon', fetch: (async (u: any) => {
    const s = String(u);
    if (s.includes('/auth/v1/user')) return user ? new Response(JSON.stringify(user), { status: 200 }) : new Response('no', { status: 401 });
    return new Response(JSON.stringify(profile), { status: 200 });
  }) as typeof fetch });
  it('aceita só administrador activo', async () => {
    expect(await mk({ id: 'u1' }, [{ institution_id: 'esc_a', role: 'admin', active: true }])('t')).toEqual({ userId: 'u1', institutionId: 'esc_a' });
    expect(await mk({ id: 'u1' }, [{ institution_id: 'esc_a', role: 'director', active: true }])('t')).toBeNull();
    expect(await mk({ id: 'u1' }, [{ institution_id: 'esc_a', role: 'admin', active: false }])('t')).toBeNull();
    expect(await mk({ id: 'u1' }, [])('t')).toBeNull();
    expect(await mk(null, [])('t')).toBeNull();
  });
});
