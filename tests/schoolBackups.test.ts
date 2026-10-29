import { describe, it, expect } from 'vitest';
import { BackupError, SchoolBackups, BACKUP_RETENTION_YEARS, effectiveSchedule, isAutoBackupDue, lastOccurrence, parseBackupId } from '../server/schoolBackups';
import { decryptBackup, deriveServerPassword, encryptBackup, readBackupHeader } from '../server/backupCrypto';
import { FakeDb, MemStore } from './backupFakes';

const SECRET = 'x'.repeat(48);
const PW = 'palavra-passe do admin';
const ADMIN = '00000000-0000-0000-0000-00000000e001';
const T0 = Date.parse('2026-10-11T10:00:00Z');

function setup(opts: { minManual?: number } = {}) {
  const db = new FakeDb(); const store = new MemStore();
  const clock = { t: T0 };
  db.seed('esc_a', { records: { s1: 'Ana', s2: 'Bruno' }, settings: { v: 1 } });
  db.seed('esc_b', { records: { s9: 'Outro' }, settings: { v: 9 } });
  const svc = new SchoolBackups({ rpc: db, store, masterSecret: SECRET, now: () => new Date(clock.t), minManualIntervalMs: opts.minManual ?? 0 });
  return { db, store, clock, svc };
}
const code = async (p: Promise<unknown>) => { try { await p; return 'ok'; } catch (e: any) { return e instanceof BackupError ? e.code : 'other:' + e.message; } };

describe('identificadores', () => {
  it('parseBackupId lê data, tipo e modo', () => {
    const p = parseBackupId('20261011T101500Z_auto_s_abcdef');
    expect(p.kind).toBe('auto'); expect(p.mode).toBe('server'); expect(p.at.toISOString()).toBe('2026-10-11T10:15:00.000Z');
    expect(parseBackupId('20261011T101500Z_manual_p_abcdef').mode).toBe('password');
  });
  it('recusa ids com fugas de pasta', () => {
    for (const bad of ['../x', '20261011T101500Z_auto_s_abcdef/../..', 'x', '', '20261011T101500Z_manual_p_ABCDEF']) expect(() => parseBackupId(bad)).toThrow(BackupError);
  });
});

describe('backup manual', () => {
  it('cria, cifra com a palavra-passe e lista', async () => {
    const { svc, store } = setup();
    const b = await svc.createManual('esc_a', ADMIN, PW);
    expect(b.kind).toBe('manual'); expect(b.mode).toBe('password');
    const key = `schools/esc_a/${b.id}.bmbak`;
    const file = store.files.get(key)!;
    expect(file.includes(Buffer.from('Ana'))).toBe(false);
    expect(JSON.parse(decryptBackup(file, PW).toString()).institution_id).toBe('esc_a');
    expect((await svc.list('esc_a')).map((x) => x.id)).toEqual([b.id]);
  });
  it('palavra-passe fraca é recusada e nada é guardado', async () => {
    const { svc, store } = setup();
    expect(await code(svc.createManual('esc_a', ADMIN, 'curta'))).toBe('weak-password');
    expect(store.files.size).toBe(0);
  });
  it('falha ao guardar → erro, e não fica lixo', async () => {
    const { svc, store } = setup(); store.failPut = () => true;
    expect(await code(svc.createManual('esc_a', ADMIN, PW))).toBe('storage');
    expect(store.files.size).toBe(0);
  });
  it('ficheiro gravado truncado é detectado (leitura de volta) e apagado', async () => {
    const { svc, store } = setup(); store.truncateOnGet = true;
    expect(await code(svc.createManual('esc_a', ADMIN, PW))).toBe('storage');
    expect(store.files.size).toBe(0);
  });
  it('falha ao exportar → erro de base de dados e nada é guardado', async () => {
    const { svc, store, db } = setup(); db.failExportFor.add('esc_a');
    expect(await code(svc.createManual('esc_a', ADMIN, PW))).toBe('database');
    expect(store.files.size).toBe(0);
  });
  it('intervalo mínimo entre backups manuais da mesma escola', async () => {
    const { svc, clock } = setup({ minManual: 30_000 });
    await svc.createManual('esc_a', ADMIN, PW);
    expect(await code(svc.createManual('esc_a', ADMIN, PW))).toBe('rate-limited');
    expect(await code(svc.createManual('esc_b', ADMIN, PW))).toBe('ok');   // outra escola não é afectada
    clock.t += 31_000;
    expect(await code(svc.createManual('esc_a', ADMIN, PW))).toBe('ok');
  });
  it('escola inválida é recusada', async () => {
    const { svc } = setup();
    for (const bad of ['', '../x', 'A B', 'x']) expect(await code(svc.createManual(bad, ADMIN, PW))).toBe('bad-request');
  });
});

describe('isolamento entre escolas', () => {
  it('a lista de A nunca mostra backups de B', async () => {
    const { svc } = setup();
    const a = await svc.createManual('esc_a', ADMIN, PW); const b = await svc.createManual('esc_b', ADMIN, PW);
    expect((await svc.list('esc_a')).map((x) => x.id)).toEqual([a.id]);
    expect((await svc.list('esc_b')).map((x) => x.id)).toEqual([b.id]);
  });
  it('A não consegue descarregar, restaurar nem apagar um id de B', async () => {
    const { svc } = setup();
    const b = await svc.createManual('esc_b', ADMIN, PW);
    expect(await code(svc.download('esc_a', b.id))).toBe('not-found');
    expect(await code(svc.restore('esc_a', b.id, ADMIN, { password: PW }))).toBe('not-found');
    expect(await code(svc.delete('esc_a', b.id))).toBe('not-found');
  });
  it('um ficheiro de B copiado para a pasta de A é recusado no restauro', async () => {
    const { svc, store, db } = setup();
    const b = await svc.createManual('esc_b', ADMIN, PW);
    store.files.set(`schools/esc_a/${b.id}.bmbak`, store.files.get(`schools/esc_b/${b.id}.bmbak`)!);
    expect(await code(svc.restore('esc_a', b.id, ADMIN, { password: PW }))).toBe('wrong-school');
    expect(db.restoreCalls).toHaveLength(0);
  });
  it('um ficheiro com cabeçalho adulterado para A é recusado (corrompido)', async () => {
    const { svc, store, db } = setup();
    const b = await svc.createManual('esc_b', ADMIN, PW);
    const f = store.files.get(`schools/esc_b/${b.id}.bmbak`)!;
    store.files.set(`schools/esc_a/${b.id}.bmbak`, Buffer.from(f.toString('latin1').replace('esc_b', 'esc_a'), 'latin1'));
    expect(await code(svc.restore('esc_a', b.id, ADMIN, { password: PW }))).toBe('corrupt');
    expect(db.restoreCalls).toHaveLength(0);
  });
});

describe('restauro', () => {
  it('restaura o estado do backup e cria um ponto de segurança do estado anterior', async () => {
    const { svc, db, store, clock } = setup();
    const b = await svc.createManual('esc_a', ADMIN, PW);
    db.seed('esc_a', { records: { x: 'estragado' }, settings: { v: 2 } });
    clock.t += 60_000;
    const r = await svc.restore('esc_a', b.id, ADMIN, { password: PW });
    expect(db.schools.get('esc_a')).toEqual({ records: { s1: 'Ana', s2: 'Bruno' }, settings: { v: 1 } });
    expect(r.safetyId).toMatch(/_safety_s_/);
    expect(db.restoreCalls[0].actor).toBe(ADMIN);
    // o ponto de segurança tem o estado ESTRAGADO e abre sem palavra-passe
    const saf = JSON.parse(decryptBackup(store.files.get(`schools/esc_a/${r.safetyId}.bmbak`)!, deriveServerPassword(SECRET, 'esc_a')).toString());
    expect(saf.data.settings).toEqual({ v: 2 });
  });
  it('desfazer: restaurar o ponto de segurança devolve o estado anterior ao restauro', async () => {
    const { svc, db, clock } = setup();
    const b = await svc.createManual('esc_a', ADMIN, PW);
    db.seed('esc_a', { records: { x: 'estragado' }, settings: { v: 2 } });
    clock.t += 60_000;
    const r = await svc.restore('esc_a', b.id, ADMIN, { password: PW });
    clock.t += 60_000;
    await svc.restore('esc_a', r.safetyId, ADMIN);
    expect(db.schools.get('esc_a')).toEqual({ records: { x: 'estragado' }, settings: { v: 2 } });
  });
  it('palavra-passe errada: nada é tocado e não se cria ponto de segurança', async () => {
    const { svc, db, store } = setup();
    const b = await svc.createManual('esc_a', ADMIN, PW);
    const n = store.files.size;
    expect(await code(svc.restore('esc_a', b.id, ADMIN, { password: 'outra palavra-passe' }))).toBe('wrong-password');
    expect(await code(svc.restore('esc_a', b.id, ADMIN, {}))).toBe('wrong-password');
    expect(db.restoreCalls).toHaveLength(0); expect(store.files.size).toBe(n);
  });
  it('ficheiro corrompido: recusado sem tocar na base', async () => {
    const { svc, db, store } = setup();
    const b = await svc.createManual('esc_a', ADMIN, PW);
    const k = `schools/esc_a/${b.id}.bmbak`; const f = Buffer.from(store.files.get(k)!); f[f.length - 30] ^= 1; store.files.set(k, f);
    expect(await code(svc.restore('esc_a', b.id, ADMIN, { password: PW }))).toBe('corrupt');
    expect(db.restoreCalls).toHaveLength(0);
  });
  it('conteúdo que não é um backup BandMed é recusado', async () => {
    const { svc, db, store } = setup();
    const id = '20261011T100000Z_manual_p_aaaaaa';
    store.files.set(`schools/esc_a/${id}.bmbak`, encryptBackup('{"ola":1}', PW, { institutionId: 'esc_a', mode: 'password', kind: 'manual' }));
    expect(await code(svc.restore('esc_a', id, ADMIN, { password: PW }))).toBe('invalid-backup');
    expect(db.restoreCalls).toHaveLength(0);
  });
  it('a base recusa o restauro → erro claro, base como estava, ponto de segurança guardado', async () => {
    const { svc, db, store } = setup();
    const b = await svc.createManual('esc_a', ADMIN, PW);
    db.restoreError = new Error('HTTP 500: falhou a meio');
    expect(await code(svc.restore('esc_a', b.id, ADMIN, { password: PW }))).toBe('database');
    expect(db.schools.get('esc_a')).toEqual({ records: { s1: 'Ana', s2: 'Bruno' }, settings: { v: 1 } });
    expect([...store.files.keys()].some((k) => k.includes('_safety_'))).toBe(true);
  });
  it('não falha o restauro se o ponto de segurança não puder ser guardado (recusa antes de tocar na base)', async () => {
    const { svc, db, store } = setup();
    const b = await svc.createManual('esc_a', ADMIN, PW);
    store.failPut = (k) => k.includes('_safety_');
    expect(await code(svc.restore('esc_a', b.id, ADMIN, { password: PW }))).toBe('storage');
    expect(db.restoreCalls).toHaveLength(0);
  });
  it('só um restauro de cada vez por escola (busy); outra escola não é afectada', async () => {
    const { svc, db } = setup();
    const b = await svc.createManual('esc_a', ADMIN, PW);
    let release!: () => void; db.restoreDelay = new Promise<void>((r) => { release = r; });
    const first = svc.restore('esc_a', b.id, ADMIN, { password: PW });
    await new Promise((r) => setTimeout(r, 50));
    expect(await code(svc.restore('esc_a', b.id, ADMIN, { password: PW }))).toBe('busy');
    expect(await code(svc.createManual('esc_a', ADMIN, PW))).toBe('busy');
    release(); await first;
    expect(await code(svc.createManual('esc_a', ADMIN, PW))).toBe('ok');
  });
});

describe('apagar, descarregar e importar', () => {
  it('só se apagam backups manuais', async () => {
    const { svc, store } = setup();
    const m = await svc.createManual('esc_a', ADMIN, PW);
    const a = await svc.runAutoNow('esc_a');
    expect(await code(svc.delete('esc_a', a.backup.id))).toBe('forbidden');
    await svc.delete('esc_a', m.id);
    expect(store.files.has(`schools/esc_a/${m.id}.bmbak`)).toBe(false);
    expect(await code(svc.delete('esc_a', m.id))).toBe('not-found');
  });
  it('download devolve o ficheiro cifrado tal como guardado', async () => {
    const { svc, store } = setup();
    const m = await svc.createManual('esc_a', ADMIN, PW);
    expect((await svc.download('esc_a', m.id)).equals(store.files.get(`schools/esc_a/${m.id}.bmbak`)!)).toBe(true);
  });
  it('importar: ficheiro descarregado volta à lista (recuperação de desastre) e depois restaura-se', async () => {
    const { svc, db, store, clock } = setup();
    const m = await svc.createManual('esc_a', ADMIN, PW);
    const file = await svc.download('esc_a', m.id);
    store.files.clear();                                     // "perdeu-se o armazenamento"
    clock.t += 5000;
    const imp = await svc.importFile('esc_a', file, PW);
    expect(imp.kind).toBe('manual');
    db.seed('esc_a', { records: {}, settings: {} });
    await svc.restore('esc_a', imp.id, ADMIN, { password: PW });
    expect(db.schools.get('esc_a')).toEqual({ records: { s1: 'Ana', s2: 'Bruno' }, settings: { v: 1 } });
  });
  it('importar recusa: outra escola, palavra-passe errada, lixo, backup automático', async () => {
    const { svc, store } = setup();
    const b = await svc.createManual('esc_b', ADMIN, PW); const file = await svc.download('esc_b', b.id);
    expect(await code(svc.importFile('esc_a', file, PW))).toBe('wrong-school');
    const a = await svc.createManual('esc_a', ADMIN, PW); const fa = await svc.download('esc_a', a.id);
    expect(await code(svc.importFile('esc_a', fa, 'errada errada'))).toBe('wrong-password');
    expect(await code(svc.importFile('esc_a', Buffer.from('lixo lixo lixo lixo lixo lixo lixo lixo'), PW))).toBe('corrupt');
    const auto = await svc.runAutoNow('esc_a');
    expect(await code(svc.importFile('esc_a', await svc.download('esc_a', auto.backup.id), PW))).toBe('forbidden');
    expect([...store.files.keys()].filter((k) => k.startsWith('schools/esc_a/') && k.endsWith('.bmbak')).length).toBe(2);
  });
});

describe('retenção (10 anos, fixa)', () => {
  it('RETENTION: a retenção legal é de 10 anos', () => {
    expect(BACKUP_RETENTION_YEARS).toBe(10);
  });
  it('cópias automáticas com menos de 10 anos mantêm-se TODAS; mais velhas são descartadas', async () => {
    const { svc, clock } = setup();
    for (let i = 0; i < 6; i++) { clock.t += 86_400_000; await svc.runAutoNow('esc_a'); }
    expect((await svc.list('esc_a')).filter((b) => b.kind === 'auto')).toHaveLength(6);   // 6 dias: nada se apaga
    clock.t += 11 * 365.25 * 86_400_000;                                                 // salta 11 anos
    await svc.runAutoNow('esc_a');
    const l = (await svc.list('esc_a')).filter((b) => b.kind === 'auto');
    expect(l).toHaveLength(1);                                                           // só a cópia nova
  });
  it('manuais nunca se apagam sozinhos, mesmo com mais de 10 anos', async () => {
    const { svc, clock } = setup();
    const m = await svc.createManual('esc_a', ADMIN, PW);
    clock.t += 12 * 365.25 * 86_400_000;
    await svc.runAutoNow('esc_a');
    const l = await svc.list('esc_a');
    expect(l.some((b) => b.id === m.id)).toBe(true);
  });
  it('pontos de segurança: só os 5 mais recentes', async () => {
    const { svc, db, clock } = setup();
    const b = await svc.createManual('esc_a', ADMIN, PW);
    for (let i = 0; i < 8; i++) { clock.t += 60_000; db.seed('esc_a', { records: { n: i }, settings: {} }); await svc.restore('esc_a', b.id, ADMIN, { password: PW }); }
    expect((await svc.list('esc_a')).filter((x) => x.kind === 'safety')).toHaveLength(5);
  });
});

describe('responsável pela cópia', () => {
  it('guarda o nome de quem criou e devolve-o na listagem', async () => {
    const { svc, db } = setup();
    db.profiles[ADMIN] = 'Despasiano Bande';
    const b = await svc.createManual('esc_a', ADMIN, PW);
    expect(b.createdBy).toBe('Despasiano Bande');
    expect((await svc.list('esc_a'))[0].createdBy).toBe('Despasiano Bande');
  });
  it('cópias automáticas da rotina ficam sem responsável (Sistema)', async () => {
    const { svc } = setup();
    const r = await svc.runAutoNow('esc_a');
    expect(r.backup.createdBy).toBeNull();
    expect((await svc.list('esc_a'))[0].createdBy).toBeNull();
  });
  it('o responsável é apagado do índice quando a cópia é eliminada', async () => {
    const { svc, db } = setup();
    db.profiles[ADMIN] = 'Despasiano Bande';
    const b = await svc.createManual('esc_a', ADMIN, PW);
    await svc.delete('esc_a', b.id);
    expect((await svc.list('esc_a'))).toHaveLength(0);
  });
});

describe('agendamento (effectiveSchedule / isAutoBackupDue)', () => {
  it('sem agendamento guardado → diário ligado às 23:00', () => {
    expect(effectiveSchedule(undefined)).toEqual({ enabled: true, frequency: 'diario', time: '23:00', weekday: 0, dayOfMonth: 1 });
  });
  it('enabled:false explícito desliga', () => { expect(effectiveSchedule({ enabled: false }).enabled).toBe(false); });
  it('valores inválidos usam omissões seguras', () => {
    expect(effectiveSchedule({ enabled: true, frequency: 'x', time: '99:99', weekday: 9, dayOfMonth: 40 })).toMatchObject({ enabled: true, frequency: 'diario', time: '23:00', weekday: 0, dayOfMonth: 1 });
    // a retenção NÃO vem do agendamento: é fixa (10 anos) — campos antigos são ignorados
    expect(effectiveSchedule({ retentionCount: 3 })).not.toHaveProperty('retentionCount');
  });
  const S = (o: any) => effectiveSchedule({ enabled: true, ...o });
  it('diário: depois da hora (WAT) e sem backup hoje → devido; com backup depois da hora → não', () => {
    const now = new Date('2026-10-11T22:30:00Z');            // 23:30 WAT
    expect(isAutoBackupDue(S({ time: '23:00' }), null, now)).toBe(true);
    expect(isAutoBackupDue(S({ time: '23:00' }), new Date('2026-10-10T22:05:00Z'), now)).toBe(true);    // o de ontem já é antigo
    expect(isAutoBackupDue(S({ time: '23:00' }), new Date('2026-10-11T22:05:00Z'), now)).toBe(false);   // 23:05 WAT de hoje
  });
  it('diário: antes da hora, vale o de ontem', () => {
    const now = new Date('2026-10-11T10:00:00Z');            // 11:00 WAT
    expect(isAutoBackupDue(S({ time: '23:00' }), new Date('2026-10-10T22:05:00Z'), now)).toBe(false);
    expect(isAutoBackupDue(S({ time: '23:00' }), new Date('2026-10-09T22:05:00Z'), now)).toBe(true);
  });
  it('semanal: dia da semana certo (0 = domingo) e hora', () => {
    const s = S({ frequency: 'semanal', weekday: 1, time: '02:00' });      // segundas às 02:00 WAT
    expect(lastOccurrence(s, new Date('2026-10-11T10:00:00Z')).toISOString()).toBe('2026-10-12T01:00:00.000Z'.replace('12', '05'));   // segunda 5/10
    expect(isAutoBackupDue(s, new Date('2026-10-05T01:30:00Z'), new Date('2026-10-11T10:00:00Z'))).toBe(false);
    expect(isAutoBackupDue(s, new Date('2026-10-05T01:30:00Z'), new Date('2026-10-12T10:00:00Z'))).toBe(true);
  });
  it('mensal: dia 31 num mês curto cai no último dia', () => {
    const s = S({ frequency: 'mensal', dayOfMonth: 31, time: '03:00' });
    expect(lastOccurrence(s, new Date('2026-11-30T12:00:00Z')).toISOString()).toBe('2026-11-30T02:00:00.000Z');
    expect(lastOccurrence(s, new Date('2026-11-10T12:00:00Z')).toISOString()).toBe('2026-10-31T02:00:00.000Z');
  });
  it('desligado nunca é devido', () => { expect(isAutoBackupDue(effectiveSchedule({ enabled: false }), null, new Date())).toBe(false); });
});

describe('rotina agendada', () => {
  it('cria backups em todas as escolas devidas; uma falha não trava as outras', async () => {
    const { svc, db, store } = setup();
    db.failExportFor.add('esc_a');
    const rep = await svc.runScheduled();
    expect(rep.find((r) => r.institutionId === 'esc_a')).toMatchObject({ status: 'error' });
    expect(rep.find((r) => r.institutionId === 'esc_b')).toMatchObject({ status: 'ok' });
    expect([...store.files.keys()].filter((k) => k.startsWith('schools/esc_b/') && k.endsWith('.bmbak'))).toHaveLength(1);
  });
  it('segunda execução no mesmo dia não duplica', async () => {
    const { svc } = setup();
    await svc.runScheduled();
    const rep = await svc.runScheduled();
    expect(rep.every((r) => r.status === 'skipped')).toBe(true);
  });
  it('escola com agendamento desligado é saltada', async () => {
    const { svc, db } = setup(); db.schedules.esc_a = { enabled: false };
    const rep = await svc.runScheduled();
    expect(rep.find((r) => r.institutionId === 'esc_a')?.status).toBe('skipped');
    expect(rep.find((r) => r.institutionId === 'esc_b')?.status).toBe('ok');
  });
  it('falha a listar escolas → relatório de erro, sem lançar', async () => {
    const { svc, db } = setup(); db.listError = new Error('HTTP 503');
    const rep = await svc.runScheduled();
    expect(rep).toHaveLength(1);
    expect(rep[0]).toMatchObject({ institutionId: '*', status: 'error' });
    expect(rep[0].error).toMatch(/503/);
  });
  it('os backups automáticos abrem com a chave do servidor e leem-se sem palavra-passe', async () => {
    const { svc, store } = setup();
    await svc.runScheduled();
    const [k, f] = [...store.files].find(([k]) => k.startsWith('schools/esc_a/'))!;
    expect(readBackupHeader(f)).toMatchObject({ mode: 'server', kind: 'auto', institutionId: 'esc_a' });
    expect(JSON.parse(decryptBackup(f, deriveServerPassword(SECRET, 'esc_a')).toString()).institution_id).toBe('esc_a');
    expect(() => decryptBackup(f, deriveServerPassword(SECRET, 'esc_b'))).toThrow();   // a chave de B não abre A
  });
});

describe('arranque', () => {
  it('segredo mestre fraco impede o arranque', () => {
    expect(() => new SchoolBackups({ rpc: new FakeDb(), store: new MemStore(), masterSecret: 'curto' })).toThrow(/32/);
  });
});
