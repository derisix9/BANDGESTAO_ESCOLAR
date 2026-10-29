/**
 * Teste de PONTA A PONTA com Postgres real: SchoolBackups + armazenamento em pasta + funções SQL da migração 0012.
 * Não faz parte do `npm test` (precisa de um Postgres). Corre com:   npm run test:e2e-backup
 * (scripts/e2e-backup.sh cria uma base descartável, aplica as migrações e chama este ficheiro com E2E_DB.)
 * Fala com o Postgres por `psql` (sem dependências npm).
 */
import { execFileSync } from 'node:child_process';
import { writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, readdirSync, rmSync, existsSync, statSync } from 'node:fs';
import { SchoolBackups, type BackupRpc } from '../../server/schoolBackups.ts';
import type { BackupStore, StoredObject } from '../../server/backupStore.ts';

/** Armazenamento em pasta SÓ para este teste (em produção é o Supabase Storage; a pasta imita o bucket). */
class FsBackupStore implements BackupStore {
  constructor(private root: string) {}
  private f(k: string) { return path.join(this.root, k); }
  async put(k: string, b: Buffer, o?: { overwrite?: boolean }) { const f = this.f(k); if (!o?.overwrite && existsSync(f)) throw new Error('já existe'); mkdirSync(path.dirname(f), { recursive: true }); writeFileSync(f, b); }
  async get(k: string) { const f = this.f(k); return existsSync(f) ? readFileSync(f) : null; }
  async list(prefix: string): Promise<StoredObject[]> {
    const dir = this.f(prefix.replace(/\/$/, '')); if (!existsSync(dir)) return [];
    return readdirSync(dir).filter((n) => statSync(path.join(dir, n)).isFile()).sort().map((n) => ({ key: prefix + n, size: statSync(path.join(dir, n)).size, lastModified: '' }));
  }
  async delete(k: string) { rmSync(this.f(k), { force: true }); }
}

const URL_ = process.env.E2E_DB!;
const dir = mkdtempSync(path.join(tmpdir(), 'e2e-'));
const psql = (sql: string): string => {
  const f = path.join(dir, 'q.sql'); writeFileSync(f, sql);
  return execFileSync('psql', [URL_, '-X', '-q', '-tA', '-v', 'ON_ERROR_STOP=1', '-f', f], { maxBuffer: 1 << 30 }).toString().trim();
};
const lit = (v: unknown) => v === null || v === undefined ? 'null' : typeof v === 'string' ? `'${v.replace(/'/g, "''")}'` : typeof v === 'object' ? `$bm$${JSON.stringify(v)}$bm$::jsonb` : String(v);
const rpc: BackupRpc = {
  async call(fn, args) {
    try { const out = psql(`select public.${fn}(${Object.values(args).map(lit).join(',')})::text;`); return out ? JSON.parse(out) : null; }
    catch (e: any) { throw Object.assign(new Error('HTTP 400: ' + String(e.stderr || e.message).split('\n')[0]), { status: 400 }); }
  },
  async select(p) {
    if (p.startsWith('institutions')) return JSON.parse(psql(`select coalesce(json_agg(json_build_object('id',id) order by id),'[]') from institutions where status='active'`));
    return JSON.parse(psql(`select coalesce(json_agg(json_build_object('institution_id',institution_id,'schedule',data->'automaticBackupSchedule')),'[]') from institution_docs where key='settings'`));
  }
};
const q = (sql: string) => psql(sql);
const svc = new SchoolBackups({ rpc, store: new FsBackupStore(path.join(dir, 'store')), masterSecret: 'm'.repeat(40), minManualIntervalMs: 0 });
const sig = (inst: string) => q(`select md5(coalesce((select jsonb_agg(to_jsonb(r) - 'created_at' - 'updated_at' order by collection,id)::text from records r where institution_id='${inst}'),'') || coalesce((select jsonb_agg(data order by key)::text from institution_docs where institution_id='${inst}'),''))`);
const PW = 'palavra-passe de teste';
const ADMIN = '00000000-0000-0000-0000-00000000e001';

q(`insert into auth.users(id,email) values ('${ADMIN}','a@a.ao'),('00000000-0000-0000-0000-00000000e0b1','b@b.ao');
   insert into institutions(id,name) values ('bk_a','A'),('bk_b','B');
   insert into profiles(id,institution_id,role,name,email) values ('${ADMIN}','bk_a','admin','Admin','a@a.ao'),('00000000-0000-0000-0000-00000000e0b1','bk_b','admin','AdminB','b@b.ao');
   insert into records(institution_id,collection,id,data) values ('bk_a','students','s1','{"id":"s1","name":"Ana"}'),('bk_a','students','s2','{"id":"s2","name":"João çãõ"}'),('bk_a','invoices','f1','{"id":"f1","status":"pendente","totalAmountKz":1000}'),('bk_b','students','s9','{"id":"s9","name":"Outro"}');
   insert into institution_docs(institution_id,key,data) values ('bk_a','settings','{"name":"A"}'),('bk_b','settings','{"name":"B","automaticBackupSchedule":{"enabled":false}}');`);

console.log('1) backup manual de bk_a');
const b = await svc.createManual('bk_a', ADMIN, PW);
const before = sig('bk_a'), beforeB = sig('bk_b');

console.log('2) estrago: apaga alunos, altera, cria registo novo, muda settings');
q(`delete from records where institution_id='bk_a' and collection='students'; insert into records(institution_id,collection,id,data) values ('bk_a','students','novo','{"id":"novo"}');
   update institution_docs set data='{"name":"estragado"}' where institution_id='bk_a' and key='settings';`);
const damaged = sig('bk_a');

console.log('3) restauro com palavra-passe ERRADA não toca em nada');
await assert.rejects(svc.restore('bk_a', b.id, ADMIN, { password: 'errada errada errada' }), /Palavra-passe errada/);
assert.equal(sig('bk_a'), damaged, 'palavra-passe errada não pode alterar dados');

console.log('4) restauro correcto');
const r = await svc.restore('bk_a', b.id, ADMIN, { password: PW });
console.log('   resumo:', JSON.stringify(r.summary), '| ponto de segurança:', r.safetyId);
assert.equal(sig('bk_a'), before, 'dados de bk_a devem ficar IDÊNTICOS ao momento do backup');
assert.equal(sig('bk_b'), beforeB, 'a escola B não pode mudar');
assert.equal(q(`select count(*) from audit_log where institution_id='bk_a' and action like 'RPC:backup_%'`), '3');   // exportar (manual) + exportar (segurança) + restaurar
assert.equal(q(`select app.verify_audit_chain('bk_a') is null`), 't');

console.log('5) desfazer: restaurar o ponto de segurança devolve o estado estragado (sem palavra-passe)');
await svc.restore('bk_a', r.safetyId, ADMIN);
assert.equal(sig('bk_a'), damaged);

console.log('6) rotina agendada: bk_a devida; bk_b desligada (enabled:false) é saltada');
const rep = await svc.runScheduled();
console.log('  ', JSON.stringify(rep.map((x) => [x.institutionId, x.status])));
assert.equal(rep.find((x) => x.institutionId === 'bk_a')?.status, 'ok');
assert.equal(rep.find((x) => x.institutionId === 'bk_b')?.status, 'skipped');

console.log('7) ficheiro de B restaurado em A é recusado');
const bb = await svc.createManual('bk_b', '00000000-0000-0000-0000-00000000e0b1', PW);
const fileB = await svc.download('bk_b', bb.id);
await assert.rejects(svc.importFile('bk_a', fileB, PW), /outra escola/);

console.log('\nE2E OK');
