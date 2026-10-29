import { describe, it, expect } from 'vitest';
import { checkS3Endpoint, cleanS3Config, cleanS3Secret, cleanSchedule, backupFileName, backupFileDate, selectExpired, slugify, ConfigError } from '../supabase/functions/school-backups/validate';
import { decryptSecret, encryptSecret, signState, verifyState, safeEqual } from '../supabase/functions/school-backups/secrets';
import { signV4 } from '../supabase/functions/school-backups/sigv4';
import { S3Client } from '../supabase/functions/school-backups/s3';
import * as drive from '../supabase/functions/school-backups/drive';
import { S3_PRESETS, presetForEndpoint, describeTarget, formatSize, friendlyExternalError, createExternalBackupApi } from '../src/utils/externalBackupApi';

const KEY = 'k'.repeat(40);

describe('endereço S3 (anti-SSRF)', () => {
  it('aceita domínios públicos https', () => {
    expect(checkS3Endpoint('https://s3.us-west-004.backblazeb2.com')).toBe('https://s3.us-west-004.backblazeb2.com');
    expect(checkS3Endpoint(' https://ABC.r2.cloudflarestorage.com/ ')).toBe('https://abc.r2.cloudflarestorage.com');
  });
  it('recusa http, IPs, localhost, nomes internos, portas, caminhos e credenciais', () => {
    for (const bad of ['http://s3.example.com', 'https://127.0.0.1', 'https://10.0.0.5', 'https://169.254.169.254', 'https://localhost', 'https://[::1]',
      'https://db.internal', 'https://x.local', 'https://intranet', 'https://s3.example.com:9000', 'https://s3.example.com/bucket', 'https://u:p@s3.example.com',
      'https://s3.example.com/?a=1', 'ftp://s3.example.com', 'não é url', '']) {
      expect(() => checkS3Endpoint(bad), bad).toThrow(ConfigError);
    }
  });
});

describe('validação da configuração', () => {
  const ok = { endpoint: 'https://s3.eu-central-1.wasabisys.com', region: 'eu-central-1', bucket: 'escola-backups', prefix: '/bandmed/escola/' };
  it('normaliza a configuração válida', () => {
    expect(cleanS3Config(ok)).toEqual({ endpoint: 'https://s3.eu-central-1.wasabisys.com', region: 'eu-central-1', bucket: 'escola-backups', prefix: 'bandmed/escola' });
    expect(cleanS3Config({ ...ok, region: 'auto', prefix: '' }).region).toBe('auto');
  });
  it('recusa região, bucket e pasta inválidos', () => {
    expect(() => cleanS3Config({ ...ok, region: 'Europa Central' })).toThrow(ConfigError);
    expect(() => cleanS3Config({ ...ok, bucket: 'A_B' })).toThrow(ConfigError);
    expect(() => cleanS3Config({ ...ok, prefix: '../outra' })).toThrow(ConfigError);
    expect(() => cleanS3Config({ ...ok, prefix: 'a b' })).toThrow(ConfigError);
  });
  it('chaves', () => {
    expect(cleanS3Secret({ accessKeyId: ' AKIAIOSFODNN7EXAMPLE ', secretAccessKey: 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY' }).accessKeyId).toBe('AKIAIOSFODNN7EXAMPLE');
    expect(() => cleanS3Secret({ accessKeyId: 'x', secretAccessKey: 'y' })).toThrow(ConfigError);
    expect(() => cleanS3Secret({ accessKeyId: 'AKIAIOSFODNN7EXAMPLE', secretAccessKey: 'tem espaço dentro da chave' })).toThrow(ConfigError);
  });
  it('agendamento: hora 0-23 e retenção só das opções permitidas', () => {
    expect(cleanSchedule(23, 30)).toEqual({ runHour: 23, retentionDays: 30 });
    expect(cleanSchedule('0', '0')).toEqual({ runHour: 0, retentionDays: 0 });
    expect(() => cleanSchedule(24, 30)).toThrow(ConfigError);
    expect(() => cleanSchedule(1.5, 30)).toThrow(ConfigError);
    expect(() => cleanSchedule(3, 5)).toThrow(ConfigError);
  });
});

describe('nome dos ficheiros e retenção', () => {
  it('slug e nome na hora de Angola (UTC+1)', () => {
    expect(slugify('Colégio São José, nº 3')).toBe('colegio-sao-jose-n-3');
    expect(backupFileName('Escola Nº 1', new Date('2026-10-13T22:30:00Z'))).toBe('bandmed_escola-n-1_2026-10-13_2330.json');
    expect(backupFileName('Escola', new Date('2026-10-13T23:30:00Z'))).toBe('bandmed_escola_2026-10-14_0030.json');
  });
  it('só reconhece o nome exacto dos backups da própria escola', () => {
    expect(backupFileDate('bandmed_escola_2026-10-14_0030.json', 'Escola')).toBe(Date.UTC(2026, 9, 14));
    expect(backupFileDate('bandmed_outra_2026-10-14_0030.json', 'Escola')).toBeNull();
    expect(backupFileDate('bandmed_escola_2026-10-14_0030.json.bak', 'Escola')).toBeNull();
    expect(backupFileDate('foto.png', 'Escola')).toBeNull();
  });
  const now = Date.UTC(2026, 9, 30);
  const mk = (d: string) => `bandmed_escola_${d}_2300.json`;
  const files = [mk('2026-08-01'), mk('2026-09-01'), mk('2026-09-25'), mk('2026-10-10'), mk('2026-10-29'), 'minhas-fotos.zip', 'bandmed_outra_2020-01-01_2300.json'];
  it('apaga só as mais antigas que o prazo e nunca outros ficheiros', () => {
    expect(selectExpired(files, 'Escola', 30, now).sort()).toEqual([mk('2026-08-01'), mk('2026-09-01')]);
    expect(selectExpired(files, 'Escola', 7, now, 1).sort()).toEqual([mk('2026-08-01'), mk('2026-09-01'), mk('2026-09-25'), mk('2026-10-10')].sort());
  });
  it('0 dias = nunca apagar; guarda sempre as 3 mais recentes', () => {
    expect(selectExpired(files, 'Escola', 0, now)).toEqual([]);
    expect(selectExpired([mk('2020-01-01'), mk('2020-01-02'), mk('2020-01-03')], 'Escola', 7, now)).toEqual([]);
  });
});

describe('cifra das credenciais e state OAuth', () => {
  it('cifra e decifra; texto cifrado nunca contém o segredo', async () => {
    const t = await encryptSecret(KEY, 'inst_a', { accessKeyId: 'AK', secretAccessKey: 'SEGREDO-123' });
    expect(t.startsWith('v1.')).toBe(true);
    expect(t.includes('SEGREDO')).toBe(false);
    expect(await decryptSecret(KEY, 'inst_a', t)).toEqual({ accessKeyId: 'AK', secretAccessKey: 'SEGREDO-123' });
  });
  it('não abre noutra escola, com outra chave ou adulterado', async () => {
    const t = await encryptSecret(KEY, 'inst_a', { a: 1 });
    await expect(decryptSecret(KEY, 'inst_b', t)).rejects.toThrow();
    await expect(decryptSecret('z'.repeat(40), 'inst_a', t)).rejects.toThrow();
    const parts = t.split('.'); parts[2] = parts[2].slice(0, -2) + (parts[2].endsWith('AA') ? 'BB' : 'AA');
    await expect(decryptSecret(KEY, 'inst_a', parts.join('.'))).rejects.toThrow();
    await expect(decryptSecret(KEY, 'inst_a', 'lixo')).rejects.toThrow();
  });
  it('recusa chave mestra curta', async () => {
    await expect(encryptSecret('curta', 'i', {})).rejects.toThrow();
  });
  it('state: assina, expira e detecta adulteração', async () => {
    const t0 = 1_000_000;
    const st = await signState(KEY, { inst: 'inst_a', uid: 'u1' }, t0);
    expect((await verifyState<any>(KEY, st, t0 + 1000))?.inst).toBe('inst_a');
    expect(await verifyState(KEY, st, t0 + 11 * 60_000)).toBeNull();
    expect(await verifyState('z'.repeat(40), st, t0 + 1000)).toBeNull();
    const [body, sig] = st.split('.');
    const forged = btoa(JSON.stringify({ inst: 'inst_b', uid: 'u1', exp: t0 + 99999999 })).replace(/=+$/, '');
    expect(await verifyState(KEY, `${forged}.${sig}`, t0 + 1000)).toBeNull();
    expect(await verifyState(KEY, body, t0)).toBeNull();
  });
  it('comparação em tempo constante', () => {
    expect(safeEqual('abc', 'abc')).toBe(true);
    expect(safeEqual('abc', 'abd')).toBe(false);
    expect(safeEqual('abc', 'abcd')).toBe(false);
  });
});

describe('SigV4 (cópia da Edge Function) — exemplo oficial da AWS', () => {
  it('GET Object', () => {
    const h = signV4({ method: 'GET', url: 'https://examplebucket.s3.amazonaws.com/test.txt', headers: { Range: 'bytes=0-9' }, region: 'us-east-1',
      accessKeyId: 'AKIAIOSFODNN7EXAMPLE', secretAccessKey: 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY', date: new Date('2013-05-24T00:00:00Z') });
    expect(/Signature=([0-9a-f]{64})/.exec(h.authorization)![1]).toBe('f0e8bdb87c964420e857bd35b5d6ed310bd44f0170aba48dd91039c6036bdb41');
  });
});

type Call = { url: string; method: string; headers: Record<string, string>; body?: any };
function fakeFetch(handler: (c: Call) => { status?: number; body?: string; headers?: Record<string, string> }) {
  const calls: Call[] = [];
  const f = (async (url: any, init: any = {}) => {
    const c: Call = { url: String(url), method: init.method || 'GET', headers: init.headers || {}, body: init.body };
    calls.push(c);
    const r = handler(c);
    const st = r.status ?? 200;
    return new Response(st === 204 || st === 205 || st === 304 ? null : (r.body ?? ''), { status: st, headers: r.headers });
  }) as unknown as typeof fetch;
  return { f, calls };
}
const S3CFG = { endpoint: 'https://s3.example.com', region: 'eu-test', bucket: 'bkt', prefix: 'bandmed/escola' };
const S3SEC = { accessKeyId: 'AKIAEXAMPLE1234', secretAccessKey: 'secret-secret-secret' };

describe('cliente S3', () => {
  it('PUT assinado, path-style, dentro da pasta, sem segredo em claro', async () => {
    const { f, calls } = fakeFetch(() => ({ status: 200 }));
    await new S3Client(S3CFG, S3SEC, { fetch: f }).put('bandmed_x_2026-10-13_2300.json', new TextEncoder().encode('{"a":1}'));
    expect(calls[0].method).toBe('PUT');
    expect(calls[0].url).toBe('https://s3.example.com/bkt/bandmed/escola/bandmed_x_2026-10-13_2300.json');
    expect(calls[0].headers.authorization).toMatch(/^AWS4-HMAC-SHA256 Credential=AKIAEXAMPLE1234\/\d{8}\/eu-test\/s3\/aws4_request/);
    expect(JSON.stringify(calls[0].headers)).not.toContain('secret-secret');
  });
  it('lista com paginação e devolve só os nomes dentro da pasta', async () => {
    let n = 0;
    const { f, calls } = fakeFetch(() => (n++ === 0
      ? { body: '<R><IsTruncated>true</IsTruncated><NextContinuationToken>T1</NextContinuationToken><Contents><Key>bandmed/escola/a.json</Key></Contents></R>' }
      : { body: '<R><IsTruncated>false</IsTruncated><Contents><Key>bandmed/escola/b&amp;c.json</Key></Contents><Contents><Key>bandmed/escola/</Key></Contents></R>' }));
    expect(await new S3Client(S3CFG, S3SEC, { fetch: f }).list()).toEqual(['a.json', 'b&c.json']);
    expect(calls[0].url).toContain('prefix=bandmed%2Fescola%2F');
    expect(calls[1].url).toContain('continuation-token=T1');
  });
  it('apagar aceita 204/404', async () => {
    const { f, calls } = fakeFetch(() => ({ status: 204 }));
    await new S3Client(S3CFG, S3SEC, { fetch: f }).delete('a.json');
    expect(calls[0].method).toBe('DELETE');
  });
  it('erro 403 dá pista útil e não repete; 500 repete', async () => {
    const a = fakeFetch(() => ({ status: 403, body: '<Error><Code>SignatureDoesNotMatch</Code></Error>' }));
    await expect(new S3Client(S3CFG, S3SEC, { fetch: a.f }).put('x', new Uint8Array([1]))).rejects.toThrow(/chave de acesso/);
    expect(a.calls.length).toBe(1);
    let k = 0;
    const b = fakeFetch(() => ({ status: k++ < 1 ? 500 : 200 }));
    await new S3Client(S3CFG, S3SEC, { fetch: b.f, retryDelayMs: 1 }).put('x', new Uint8Array([1]));
    expect(b.calls.length).toBe(2);
  });
});

const APP = { clientId: 'cid', clientSecret: 'csec' };
describe('Google Drive', () => {
  it('URL de autorização: âmbito mínimo drive.file, offline, state', () => {
    const u = new URL(drive.authUrl(APP, 'https://x.supabase.co/functions/v1/school-backups/gdrive-callback', 'ST'));
    expect(u.searchParams.get('scope')).toContain('https://www.googleapis.com/auth/drive.file');
    expect(u.searchParams.get('scope')).not.toContain('auth/drive ');
    expect(u.searchParams.get('access_type')).toBe('offline');
    expect(u.searchParams.get('state')).toBe('ST');
  });
  it('troca o código: devolve refresh token e e-mail; sem refresh token é erro claro', async () => {
    const idt = 'x.' + btoa(JSON.stringify({ email: 'escola@gmail.com' })) + '.y';
    const ok = fakeFetch(() => ({ body: JSON.stringify({ refresh_token: 'RT', id_token: idt, access_token: 'AT' }) }));
    expect(await drive.exchangeCode(APP, 'r', 'code', ok.f)).toEqual({ refreshToken: 'RT', email: 'escola@gmail.com' });
    const no = fakeFetch(() => ({ body: JSON.stringify({ access_token: 'AT' }) }));
    await expect(drive.exchangeCode(APP, 'r', 'code', no.f)).rejects.toThrow(/permissions/);
  });
  it('pasta: reutiliza a conhecida, senão procura, senão cria', async () => {
    const known = fakeFetch(() => ({ body: JSON.stringify({ id: 'F1', trashed: false }) }));
    expect(await drive.ensureFolder('t', 'F1', known.f)).toBe('F1');
    let step = 0;
    const create = fakeFetch(() => (step++ === 0 ? { status: 404, body: '{}' } : step === 2 ? { body: JSON.stringify({ files: [] }) } : { body: JSON.stringify({ id: 'NEW' }) }));
    expect(await drive.ensureFolder('t', 'GONE', create.f)).toBe('NEW');
    expect(create.calls[2].method).toBe('POST');
  });
  it('envio resumable em 2 passos para a pasta certa', async () => {
    const { f, calls } = fakeFetch((c) => (c.url.includes('uploadType=resumable') ? { headers: { location: 'https://www.googleapis.com/upload/drive/v3/files?upload_id=U1' } } : { body: JSON.stringify({ id: 'FILE1' }) }));
    expect(await drive.uploadFile('tok', 'FOLDER', 'a.json', new Uint8Array([1, 2, 3]), 'application/json', f)).toBe('FILE1');
    expect(JSON.parse(calls[0].body)).toEqual({ name: 'a.json', parents: ['FOLDER'] });
    expect(calls[1].method).toBe('PUT');
  });
  it('recusa um destino de envio que não seja do Google', async () => {
    const { f } = fakeFetch(() => ({ headers: { location: 'https://evil.example.com/steal' } }));
    await expect(drive.uploadFile('tok', 'F', 'a.json', new Uint8Array([1]), 'application/json', f)).rejects.toThrow(/inesperada/);
  });
  it('lista com paginação e erro 401 sugere religar', async () => {
    let n = 0;
    const { f } = fakeFetch(() => (n++ === 0 ? { body: JSON.stringify({ files: [{ id: '1', name: 'a' }], nextPageToken: 'P' }) } : { body: JSON.stringify({ files: [{ id: '2', name: 'b' }] }) }));
    expect(await drive.listFiles('t', 'F', f)).toEqual([{ id: '1', name: 'a' }, { id: '2', name: 'b' }]);
    const bad = fakeFetch(() => ({ status: 401, body: JSON.stringify({ error: { message: 'Invalid Credentials' } }) }));
    await expect(drive.accessToken(APP, 'RT', bad.f)).rejects.toThrow(/volte a ligar/);
  });
});

describe('utilitários da app', () => {
  it('predefinições e endereços', () => {
    expect(S3_PRESETS.find((p) => p.id === 'b2')!.endpoint('us-west-004')).toBe('https://s3.us-west-004.backblazeb2.com');
    expect(presetForEndpoint('https://s3.eu-central-1.wasabisys.com').id).toBe('wasabi');
    expect(presetForEndpoint('https://abc.r2.cloudflarestorage.com').id).toBe('r2');
    expect(presetForEndpoint('https://spaces.exemplo.com').id).toBe('custom');
  });
  it('descrição do destino e tamanhos', () => {
    expect(describeTarget({ provider: 'gdrive', config: { account: 'a@b.com' } })).toBe('Google Drive · a@b.com');
    expect(describeTarget({ provider: 's3', config: { endpoint: 'https://s3.x.backblazeb2.com', bucket: 'bk', prefix: 'p' } })).toBe('Backblaze B2 · bk/p');
    expect(describeTarget({ provider: null, config: {} })).toBe('Nenhum destino ligado');
    expect(formatSize(1536)).toBe('1.5 KB');
    expect(formatSize(null)).toBe('—');
  });
  it('erros amigáveis', () => {
    expect(friendlyExternalError(Object.assign(new Error('x'), { code: 'PGRST202' }))).toMatch(/0018/);
    expect(friendlyExternalError(new Error('Failed to fetch'))).toMatch(/servidor de backups/);
  });
  it('API: estado por RPC, acções por função e erro propagado', async () => {
    const calls: any[] = [];
    const api = createExternalBackupApi(
      async (fn) => ({ data: fn === 'school_backup_destination_status' ? { configured: false, runs: [] } : null, error: null }),
      async (body) => { calls.push(body); return body.action === 'test' ? { data: null, error: 'falhou' } : { data: { ok: true, url: 'https://accounts.google.com/x' }, error: null }; }
    );
    expect((await api.status()).configured).toBe(false);
    await api.save({ provider: 's3', enabled: true, runHour: 23, retentionDays: 30, config: { bucket: 'b' } });
    expect(calls[0]).toMatchObject({ action: 'save', provider: 's3', runHour: 23 });
    expect(await api.gdriveUrl('https://app.example')).toBe('https://accounts.google.com/x');
    await expect(api.test()).rejects.toThrow('falhou');
  });
});
