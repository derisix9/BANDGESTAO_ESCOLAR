import { describe, it, expect } from 'vitest';
import { BackupCryptoError, checkBackupPassword, decryptBackup, deriveServerPassword, encryptBackup, readBackupHeader } from '../server/backupCrypto';

const META = { institutionId: 'esc_a', mode: 'password' as const, kind: 'manual' as const };
const PW = 'uma palavra-passe longa';

describe('cifra dos backups', () => {
  it('cifra e decifra (ida e volta)', () => {
    const json = JSON.stringify({ alunos: ['Ana', 'João', 'çãõ é à'], n: 1 });
    const f = encryptBackup(json, PW, META);
    expect(decryptBackup(f, PW).toString('utf8')).toBe(json);
  });

  it('o ficheiro não contém o texto em claro', () => {
    const f = encryptBackup('SEGREDO-DO-ALUNO-12345 '.repeat(50), PW, META);
    expect(f.includes(Buffer.from('SEGREDO'))).toBe(false);
  });

  it('palavra-passe errada falha com wrong-password', () => {
    const f = encryptBackup('x', PW, META);
    expect(() => decryptBackup(f, 'outra palavra-passe')).toThrow(BackupCryptoError);
    try { decryptBackup(f, 'outra palavra-passe'); } catch (e: any) { expect(e.code).toBe('wrong-password'); }
  });

  it('cada cifra é diferente (sal e IV aleatórios)', () => {
    expect(encryptBackup('x', PW, META).equals(encryptBackup('x', PW, META))).toBe(false);
  });

  it('qualquer byte alterado é detectado (corpo, etiqueta e cabeçalho)', () => {
    const f = encryptBackup('conteúdo '.repeat(100), PW, META);
    for (const pos of [f.length - 1, f.length - 20, 30, 8, 12]) {
      const g = Buffer.from(f); g[pos] ^= 0x01;
      expect(() => decryptBackup(g, PW)).toThrow();
    }
  });

  it('trocar a escola no cabeçalho invalida o ficheiro (o cabeçalho é autenticado)', () => {
    const f = encryptBackup('x', PW, META);
    const forged = Buffer.from(f.toString('latin1').replace('esc_a', 'esc_b'), 'latin1');
    expect(readBackupHeader(forged).institutionId).toBe('esc_b');
    expect(() => decryptBackup(forged, PW)).toThrow(BackupCryptoError);
    try { decryptBackup(forged, PW); } catch (e: any) { expect(e.code).toBe('corrupt'); }
  });

  it('lê o cabeçalho sem palavra-passe', () => {
    const h = readBackupHeader(encryptBackup('x', PW, { institutionId: 'esc_z', mode: 'server', kind: 'auto' }));
    expect(h).toMatchObject({ institutionId: 'esc_z', mode: 'server', kind: 'auto', alg: 'aes-256-gcm' });
  });

  it('recusa ficheiros que não são backups e cabeçalhos com custo forjado', () => {
    expect(() => readBackupHeader(Buffer.from('isto não é um backup, mesmo comprido o suficiente'))).toThrow(/backup/);
    const f = encryptBackup('x', PW, META);
    const hl = f.readUInt32BE(6);
    const header = JSON.parse(f.subarray(10, 10 + hl).toString('utf8'));
    const forgeWith = (patch: object) => {
      const hb = Buffer.from(JSON.stringify({ ...header, ...patch }), 'utf8');
      const len = Buffer.alloc(4); len.writeUInt32BE(hb.length);
      return Buffer.concat([f.subarray(0, 6), len, hb, f.subarray(10 + hl)]);
    };
    expect(() => decryptBackup(forgeWith({ N: 1073741824 }), PW)).toThrow(/suportados/);   // custo absurdo (DoS)
    expect(() => decryptBackup(forgeWith({ N: 1000 }), PW)).toThrow(/suportados/);
    expect(() => decryptBackup(forgeWith({ alg: 'aes-128-cbc' }), PW)).toThrow(/suportados/);
    expect(() => decryptBackup(forgeWith({ mode: 'nenhum' }), PW)).toThrow(/suportados/);
  });

  it('ficheiro truncado é recusado', () => {
    const f = encryptBackup('x'.repeat(1000), PW, META);
    expect(() => decryptBackup(f.subarray(0, f.length - 5), PW)).toThrow();
    expect(() => decryptBackup(f.subarray(0, 8), PW)).toThrow();
  });

  it('palavra-passe: mínimo 10 caracteres', () => {
    expect(() => encryptBackup('x', 'curta', META)).toThrow(/10/);
    expect(() => checkBackupPassword('123456789')).toThrow();
    expect(() => checkBackupPassword(undefined)).toThrow();
    expect(() => checkBackupPassword('1234567890')).not.toThrow();
  });

  it('chave do servidor: determinística, diferente por escola, exige segredo forte', () => {
    const s = 's'.repeat(40);
    expect(deriveServerPassword(s, 'a')).toBe(deriveServerPassword(s, 'a'));
    expect(deriveServerPassword(s, 'a')).not.toBe(deriveServerPassword(s, 'b'));
    expect(() => deriveServerPassword('curto', 'a')).toThrow(/32/);
  });
});
