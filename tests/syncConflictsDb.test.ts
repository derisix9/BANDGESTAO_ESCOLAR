// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({ calls: [] as any[], serverPhone: '900' }));
vi.mock('../src/services/shardBackendSupabase', async (orig) => ({
  ...(await orig<any>()),
  // Servidor simulado: o campo "phone" do aluno s1 já foi mudado por outra pessoa para h.serverPhone.
  sbPush: vi.fn(async (_name: string, batch: Record<string, any>, opts: any = {}) => {
    h.calls.push({ batch, opts });
    const mine = batch['s1/phone'];
    if (mine !== undefined && !opts.forced?.has('s1/phone') && opts.bases?.['s1/phone'] !== undefined) {
      const { hashValue } = await import('../src/utils/syncConflicts');
      if (hashValue(h.serverPhone) !== opts.bases['s1/phone'] && h.serverPhone !== mine) {
        opts.onConflict?.({ recordId: 's1', field: 'phone', mine, theirs: h.serverPhone, record: { name: 'Ana Silva' } });
      }
    }
  })
}));
import { dbService } from '../src/services/db';
import { hashValue } from '../src/utils/syncConflicts';

const D: any = dbService;
const BASES_KEY = () => 'escola_edit_bases_' + D.activeInstitutionId;

function setup() {
  h.calls = []; h.serverPhone = '900';
  localStorage.clear();
  D.editBasesCache = null;
  D.syncConflicts = []; D.forcedConflictPaths = new Set();
  D.db.currentUser = { ...(D.db.currentUser || {}), role: 'admin', name: 'Admin' };
  D.db.students = [{ id: 's1', name: 'Ana Silva', phone: '923' }];
  D.shardBaseline = { students: { s1: { id: 's1', name: 'Ana Silva', phone: '911' } } };   // o que o utilizador viu: 911
  D.shardSafe = new Set();
  D.pushUserProjections = async () => {};
  D.refreshPortalProjectionsForScope = async () => {};
  D.scheduleSync = vi.fn();
}

describe('conflitos de edição no db (orquestração do envio)', () => {
  beforeEach(setup);

  it('detecta o conflito, não perde a edição local e deixa o servidor como "último estado conhecido"', async () => {
    await D.pushShards();
    expect(h.calls[0].opts.bases['s1/phone']).toBe(hashValue('911'));      // impressão do valor original
    const c = D.getSyncConflicts();
    expect(c).toHaveLength(1);
    expect(c[0]).toMatchObject({ collection: 'students', recordId: 's1', field: 'phone', recordLabel: 'Ana Silva', mine: '923', theirs: '900' });
    expect(D.db.students[0].phone).toBe('923');                            // a edição local continua cá
    expect(D.shardBaseline.students.s1.phone).toBe('900');                 // baseline = servidor
    expect(D.getPendingSummary().collections).toBeDefined();
    expect(JSON.parse(localStorage.getItem(BASES_KEY())!).students['s1/phone']).toBe(hashValue('911'));   // sobrevive a recarregar
  });

  it('o mesmo conflito num novo envio não duplica', async () => {
    await D.pushShards();
    await D.pushShards();
    expect(D.getSyncConflicts()).toHaveLength(1);
  });

  it('"usar a do servidor": a lista local fica com o valor do servidor e nada fica pendente', async () => {
    await D.pushShards();
    dbService.resolveSyncConflict('students/s1/phone', 'theirs');
    expect(D.getSyncConflicts()).toHaveLength(0);
    expect(D.db.students[0].phone).toBe('900');
    expect(localStorage.getItem(BASES_KEY())).toBeNull();
    h.calls = [];
    await D.pushShards();
    expect(h.calls.every((c: any) => Object.keys(c.batch).length === 0) || h.calls.length === 0).toBe(true);
    expect(D.getSyncConflicts()).toHaveLength(0);
  });

  it('"manter a minha": volta a enviar, desta vez sem conflito, e fica gravado', async () => {
    await D.pushShards();
    dbService.resolveSyncConflict('students/s1/phone', 'mine');
    expect(D.getSyncConflicts()).toHaveLength(0);
    expect(D.db.students[0].phone).toBe('923');
    h.calls = [];
    await D.pushShards();
    expect(h.calls[0].opts.forced.has('s1/phone')).toBe(true);
    expect(D.getSyncConflicts()).toHaveLength(0);
    expect(D.shardBaseline.students.s1.phone).toBe('923');
    expect(D.forcedConflictPaths.size).toBe(0);
    expect(localStorage.getItem(BASES_KEY())).toBeNull();
  });

  it('sem conflito: o envio normal limpa a impressão guardada', async () => {
    h.serverPhone = '911';   // ninguém mexeu
    await D.pushShards();
    expect(D.getSyncConflicts()).toHaveLength(0);
    expect(D.shardBaseline.students.s1.phone).toBe('923');
    expect(localStorage.getItem(BASES_KEY())).toBeNull();
  });

  it('se o utilizador desfizer a edição, a impressão antiga é esquecida (sem falsos conflitos depois)', async () => {
    h.serverPhone = '911';
    D.db.students = [{ id: 's1', name: 'Ana Silva', phone: '911' }];   // igual ao baseline: nada a enviar
    D.getEditBases().students = { 's1/phone': hashValue('antigo') };
    await D.pushShards();
    expect(D.getEditBases().students?.['s1/phone']).toBeUndefined();
  });

  it('depois de recarregar a app (baseline já é o do servidor), a impressão guardada no aparelho ainda detecta o conflito', async () => {
    // Antes de recarregar, o utilizador tinha visto 911 e editou para 923; a impressão ficou no aparelho.
    localStorage.setItem(BASES_KEY(), JSON.stringify({ students: { 's1/phone': hashValue('911') } }));
    D.editBasesCache = null;
    D.shardBaseline = { students: { s1: { id: 's1', name: 'Ana Silva', phone: '900' } } };   // a nuvem lida no arranque
    D.shardSafe = new Set(['students']);                                                       // há edições locais por enviar
    await D.pushShards();
    expect(D.getSyncConflicts()).toHaveLength(1);
    expect(D.db.students[0].phone).toBe('923');                                                // a edição local não foi substituída
    expect(D.shardSafe.has('students')).toBe(false);
  });
});
