// Duplos de teste partilhados (armazenamento em memória e "base de dados" que imita as funções SQL).
import type { BackupRpc } from '../server/schoolBackups';
import type { BackupStore, StoredObject } from '../server/backupStore';

export class MemStore implements BackupStore {
  files = new Map<string, Buffer>();
  failPut: ((key: string) => boolean) | null = null;
  truncateOnGet = false;
  async put(key: string, body: Buffer) { if (this.failPut?.(key)) throw new Error('disco cheio'); this.files.set(key, Buffer.from(body)); }
  async get(key: string) { const f = this.files.get(key); return f ? (this.truncateOnGet ? f.subarray(0, f.length - 1) : Buffer.from(f)) : null; }
  async list(prefix: string): Promise<StoredObject[]> { return [...this.files].filter(([k]) => k.startsWith(prefix)).map(([key, b]) => ({ key, size: b.length, lastModified: '' })); }
  async delete(key: string) { this.files.delete(key); }
}

/** "Base de dados": cada escola tem os seus dados; export/restore imitam as funções SQL. */
export class FakeDb implements BackupRpc {
  schools = new Map<string, Record<string, any>>();
  schedules: Record<string, any> = {};
  /** userId → nome visível (imita a tabela `profiles`). */
  profiles: Record<string, string> = {};
  restoreCalls: Array<{ inst: string; payload: any; actor: any }> = [];
  audits: any[] = [];
  failExportFor = new Set<string>();
  restoreError: any = null;
  restoreDelay: Promise<void> | null = null;
  listError: any = null;
  seed(inst: string, data: Record<string, any>) { this.schools.set(inst, structuredClone(data)); }

  async call(fn: string, args: Record<string, any>): Promise<any> {
    if (fn === 'school_backup_export') {
      const inst = args.p_inst as string;
      if (this.failExportFor.has(inst)) throw new Error('HTTP 500: export falhou');
      if (!this.schools.has(inst)) throw new Error('HTTP 400: Escola inexistente');
      this.audits.push({ inst, action: 'RPC:backup_export', actor: args.p_actor });
      return { format: 'bandmed-school-backup', version: 1, institution_id: inst, exported_at: '2026-10-11T00:00:00Z', data: structuredClone(this.schools.get(inst)) };
    }
    if (fn === 'school_backup_restore') {
      this.restoreCalls.push({ inst: args.p_inst, payload: args.p_payload, actor: args.p_actor });
      if (this.restoreDelay) await this.restoreDelay;
      if (this.restoreError) throw this.restoreError;
      if (args.p_payload.institution_id !== args.p_inst) throw new Error('HTTP 403: outra escola');
      this.schools.set(args.p_inst, structuredClone(args.p_payload.data));
      this.audits.push({ inst: args.p_inst, action: 'RPC:backup_restore', actor: args.p_actor });
      return { records: Object.keys(args.p_payload.data.records ?? {}).length };
    }
    throw new Error('função desconhecida ' + fn);
  }
  async select(path: string): Promise<any[]> {
    if (this.listError) throw this.listError;
    if (path.startsWith('institutions')) return [...this.schools.keys()].sort().map((id) => ({ id }));
    if (path.startsWith('profiles')) {
      const m = /id=eq\.([^&]+)/.exec(path);
      const name = m ? this.profiles[decodeURIComponent(m[1])] : undefined;
      return name ? [{ full_name: name }] : [];
    }
    const m = /institution_id=eq\.([^&]+)/.exec(path);
    if (m) { const id = decodeURIComponent(m[1]); return id in this.schedules ? [{ institution_id: id, schedule: this.schedules[id] }] : []; }
    return Object.entries(this.schedules).map(([institution_id, schedule]) => ({ institution_id, schedule }));
  }
}
