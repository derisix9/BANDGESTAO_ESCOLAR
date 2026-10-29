import { describe, it, expect } from 'vitest';
import { purgeLocalSchoolData, hasUnsyncedLocalChanges } from '../src/services/localDataPolicy';

class Mem { m = new Map<string, string>();
  get length() { return this.m.size; } key(i: number) { return [...this.m.keys()][i] ?? null; }
  getItem(k: string) { return this.m.get(k) ?? null; } setItem(k: string, v: string) { this.m.set(k, v); } removeItem(k: string) { this.m.delete(k); } }

const seed = (pending?: boolean) => {
  const s = new Mem();
  s.setItem('escola_inst_esc_a', '{"students":[1]}'); s.setItem('bandmed_escola_db_v1', '{}'); s.setItem('bandmed_session_user', '{"id":"u1"}');
  s.setItem('escola_access_map_esc_a', '{}'); s.setItem('escola_active_institution_id', 'esc_a'); s.setItem('escola_institutions_index', '[]');
  s.setItem('bandgest.i18n.en.v1', '[["Maria","Mary"]]'); s.setItem('bm_offline_lease', '{}'); s.setItem('bm_vault_salt', 'x'); s.setItem('bm_vault_salt_data', 'x'); s.setItem('bm_vault_check', '{}');
  s.setItem('bandmed:color-mode', 'dark'); s.setItem('bandmed:cookie-consent', '1');     // preferências: NÃO se apagam
  if (pending !== undefined) s.setItem('escola_pending_esc_a', pending ? '1' : '0');
  return s;
};

describe('limpeza de dados locais ao sair', () => {
  it('apaga os dados da escola e mantém as preferências', () => {
    const s = seed(false); let idb = 0;
    expect(purgeLocalSchoolData(s, () => { idb++; })).toBe(true);
    expect([...s.m.keys()].sort()).toEqual(['bandmed:color-mode', 'bandmed:cookie-consent']);
    expect(idb).toBe(1);
  });
  it('não apaga NADA se houver alterações por sincronizar (não perde trabalho offline)', () => {
    const s = seed(true); let idb = 0;
    expect(hasUnsyncedLocalChanges(s)).toBe(true);
    expect(purgeLocalSchoolData(s, () => { idb++; })).toBe(false);
    expect(s.getItem('escola_inst_esc_a')).not.toBeNull();
    expect(idb).toBe(0);
  });
  it('sem marca de pendente, apaga; uma falha no IndexedDB não impede o resto', () => {
    const s = seed();
    expect(purgeLocalSchoolData(s, () => { throw new Error('sem idb'); })).toBe(true);
    expect(s.getItem('escola_inst_esc_a')).toBeNull();
  });
});
