import { describe, it, expect } from 'vitest';
import { mkdtempSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { FsBackupStore, S3BackupStore, assertSafeKey } from '../server/backupStore';
import { sha256Hex, signV4 } from '../server/sigv4';

describe('chaves seguras', () => {
  it('aceita caminhos normais e recusa fugas', () => {
    expect(() => assertSafeKey('schools/esc_a/20261011T000000Z_auto_s_abcdef.bmbak')).not.toThrow();
    for (const bad of ['../x', 'schools/../x', '/abs', 'a//b', 'a b', 'a\\b', '', 'pasta/', 'x\0y']) {
      expect(() => assertSafeKey(bad)).toThrow();
    }
  });
});

describe('FsBackupStore', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'bm-store-'));
  const s = new FsBackupStore(dir);

  it('guarda, lê, lista e apaga', async () => {
    await s.put('schools/esc_a/a.bmbak', Buffer.from('um'));
    await s.put('schools/esc_a/b.bmbak', Buffer.from('dois'));
    await s.put('schools/esc_b/c.bmbak', Buffer.from('tres'));
    expect((await s.get('schools/esc_a/a.bmbak'))?.toString()).toBe('um');
    expect((await s.list('schools/esc_a/')).map((o) => o.key)).toEqual(['schools/esc_a/a.bmbak', 'schools/esc_a/b.bmbak']);
    expect((await s.list('schools/esc_a/'))[1].size).toBe(4);
    await s.delete('schools/esc_a/a.bmbak');
    expect(await s.get('schools/esc_a/a.bmbak')).toBeNull();
    await s.delete('schools/esc_a/a.bmbak');   // apagar o que não existe não falha
  });

  it('prefixo de uma escola não apanha outra', async () => {
    expect((await s.list('schools/esc_b/')).map((o) => o.key)).toEqual(['schools/esc_b/c.bmbak']);
    expect(await s.list('schools/esc_nao_existe/')).toEqual([]);
  });

  it('escrita atómica: não ficam ficheiros temporários e sobrescrever funciona', async () => {
    await s.put('schools/esc_c/x.bmbak', Buffer.from('v1'));
    await s.put('schools/esc_c/x.bmbak', Buffer.from('v2'));
    expect((await s.get('schools/esc_c/x.bmbak'))?.toString()).toBe('v2');
    expect(readdirSync(path.join(dir, 'schools/esc_c'))).toEqual(['x.bmbak']);
  });

  it('recusa chaves fora da pasta', async () => {
    await expect(s.get('../fora.txt')).rejects.toThrow();
    await expect(s.put('/etc/passwd', Buffer.from('x'))).rejects.toThrow();
  });
});

// ---------------------------------------------------------------------------
// Assinatura V4: exemplos OFICIAIS da AWS (docs "Signature Calculations for the Authorization Header")
// ---------------------------------------------------------------------------
const AK = 'AKIAIOSFODNN7EXAMPLE', SK = 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY';
const D = new Date('2013-05-24T00:00:00Z');
const sigOf = (h: Record<string, string>) => /Signature=([0-9a-f]{64})/.exec(h.authorization)![1];

describe('AWS Signature V4', () => {
  it('GET Object (exemplo oficial)', () => {
    const h = signV4({ method: 'GET', url: 'https://examplebucket.s3.amazonaws.com/test.txt', headers: { Range: 'bytes=0-9' }, region: 'us-east-1', accessKeyId: AK, secretAccessKey: SK, date: D });
    expect(sigOf(h)).toBe('f0e8bdb87c964420e857bd35b5d6ed310bd44f0170aba48dd91039c6036bdb41');
  });
  it('GET Bucket (List Objects) com parâmetros (exemplo oficial)', () => {
    const h = signV4({ method: 'GET', url: 'https://examplebucket.s3.amazonaws.com/?max-keys=2&prefix=J', region: 'us-east-1', accessKeyId: AK, secretAccessKey: SK, date: D });
    expect(sigOf(h)).toBe('34b48302e7b5fa45bde8084f4b7868a86f0a534bc59db6670ed5711ef69dc6f7');
  });
  it('GET Bucket Lifecycle (exemplo oficial, parâmetro sem valor)', () => {
    const h = signV4({ method: 'GET', url: 'https://examplebucket.s3.amazonaws.com/?lifecycle', region: 'us-east-1', accessKeyId: AK, secretAccessKey: SK, date: D });
    expect(sigOf(h)).toBe('fea454ca298b7da1c68078a5d1bdbfbbe0d65c699e0f91ac7a200a0136783543');
  });
  it('PUT Object (exemplo oficial, com corpo e cabeçalhos extra)', () => {
    const h = signV4({ method: 'PUT', url: 'https://examplebucket.s3.amazonaws.com/test%24file.text', headers: { Date: 'Fri, 24 May 2013 00:00:00 GMT', 'x-amz-storage-class': 'REDUCED_REDUNDANCY' },
      body: 'Welcome to Amazon S3.', region: 'us-east-1', accessKeyId: AK, secretAccessKey: SK, date: D });
    expect(sigOf(h)).toBe('98ad721746da40c64f1a55b78f14c238d841ea1380cd77a1b5971af0ece108bd');
  });
  it('o corpo entra na assinatura', () => {
    const a = signV4({ method: 'PUT', url: 'https://h.example/b/k', body: 'um', region: 'r', accessKeyId: AK, secretAccessKey: SK, date: D });
    const b = signV4({ method: 'PUT', url: 'https://h.example/b/k', body: 'dois', region: 'r', accessKeyId: AK, secretAccessKey: SK, date: D });
    expect(sigOf(a)).not.toBe(sigOf(b));
  });
  it('parâmetros ordenados e codificados', () => {
    const a = signV4({ method: 'GET', url: 'https://h.example/b?z=1&a=2%20x', region: 'r', accessKeyId: AK, secretAccessKey: SK, date: D });
    const b = signV4({ method: 'GET', url: 'https://h.example/b?a=2%20x&z=1', region: 'r', accessKeyId: AK, secretAccessKey: SK, date: D });
    expect(sigOf(a)).toBe(sigOf(b));
  });
});

// ---------------------------------------------------------------------------
// S3 simulado: confere a assinatura de CADA pedido recalculando-a com o segredo
// ---------------------------------------------------------------------------
function fakeS3(opts: { pageSize?: number; failFirst?: number; badSecret?: boolean } = {}) {
  const objs = new Map<string, Buffer>();
  const seen: string[] = [];
  let fails = opts.failFirst ?? 0;
  const f = (async (input: any, init: any = {}) => {
    const url = new URL(String(input)); const method = init.method ?? 'GET';
    const h: Record<string, string> = {}; for (const [k, v] of Object.entries(init.headers ?? {})) h[k.toLowerCase()] = String(v);
    seen.push(`${method} ${url.pathname}${url.search}`);
    if (fails > 0) { fails--; return new Response('SlowDown', { status: 503 }); }
    const body = init.body ? Buffer.from(init.body) : undefined;
    const re = signV4({ method, url: String(input), body, region: 'eu-test', accessKeyId: 'KID', secretAccessKey: 'SECRET', date: new Date(h['x-amz-date'].replace(/^(\d{4})(\d\d)(\d\d)T(\d\d)(\d\d)(\d\d)Z$/, '$1-$2-$3T$4:$5:$6Z')) });
    if (opts.badSecret || re.authorization !== h.authorization) return new Response('<Error><Code>SignatureDoesNotMatch</Code></Error>', { status: 403 });
    if (h['x-amz-content-sha256'] !== sha256Hex(body ?? '')) return new Response('bad hash', { status: 400 });
    const key = decodeURIComponent(url.pathname.replace(/^\/bkt\/?/, ''));
    if (method === 'PUT') { objs.set(key, body ?? Buffer.alloc(0)); return new Response(null, { status: 200 }); }
    if (method === 'DELETE') { objs.delete(key); return new Response(null, { status: 204 }); }
    if (method === 'GET' && url.searchParams.get('list-type') === '2') {
      const prefix = url.searchParams.get('prefix') ?? '';
      const all = [...objs.keys()].filter((k) => k.startsWith(prefix)).sort();
      const start = Number(url.searchParams.get('continuation-token') ?? 0);
      const size = opts.pageSize ?? 1000; const page = all.slice(start, start + size);
      const more = start + size < all.length;
      return new Response(`<ListBucketResult><IsTruncated>${more}</IsTruncated>${more ? `<NextContinuationToken>${start + size}</NextContinuationToken>` : ''}` +
        page.map((k) => `<Contents><Key>${k}</Key><LastModified>2026-10-11T00:00:00.000Z</LastModified><Size>${objs.get(k)!.length}</Size></Contents>`).join('') + '</ListBucketResult>', { status: 200 });
    }
    if (method === 'GET') { const o = objs.get(key); return o ? new Response(o, { status: 200 }) : new Response('<Error><Code>NoSuchKey</Code></Error>', { status: 404 }); }
    return new Response('?', { status: 400 });
  }) as typeof fetch;
  return { f, objs, seen };
}
const cfg = (f: typeof fetch, extra: object = {}) => ({ endpoint: 'https://s3.exemplo.test', bucket: 'bkt', region: 'eu-test', accessKeyId: 'KID', secretAccessKey: 'SECRET', fetch: f, retryDelayMs: 1, ...extra });

describe('S3BackupStore', () => {
  it('PUT / GET / LIST / DELETE com pedidos correctamente assinados', async () => {
    const { f, objs } = fakeS3(); const s = new S3BackupStore(cfg(f));
    await s.put('schools/esc_a/a.bmbak', Buffer.from('conteúdo'));
    expect(objs.has('schools/esc_a/a.bmbak')).toBe(true);
    expect((await s.get('schools/esc_a/a.bmbak'))?.toString()).toBe('conteúdo');
    expect(await s.get('schools/esc_a/nao.bmbak')).toBeNull();
    const l = await s.list('schools/esc_a/');
    expect(l).toHaveLength(1); expect(l[0]).toMatchObject({ key: 'schools/esc_a/a.bmbak', size: Buffer.byteLength('conteúdo') });
    await s.delete('schools/esc_a/a.bmbak');
    expect(await s.get('schools/esc_a/a.bmbak')).toBeNull();
  });
  it('prefixo de pasta no bucket é aplicado e removido na listagem', async () => {
    const { f, objs } = fakeS3(); const s = new S3BackupStore(cfg(f, { prefix: '/prod/' }));
    await s.put('schools/esc_a/a.bmbak', Buffer.from('x'));
    expect([...objs.keys()]).toEqual(['prod/schools/esc_a/a.bmbak']);
    expect((await s.list('schools/esc_a/')).map((o) => o.key)).toEqual(['schools/esc_a/a.bmbak']);
  });
  it('lista paginada (IsTruncated + continuation-token)', async () => {
    const { f } = fakeS3({ pageSize: 2 }); const s = new S3BackupStore(cfg(f));
    for (let i = 0; i < 5; i++) await s.put(`schools/esc_a/${i}.bmbak`, Buffer.from('x'));
    expect(await s.list('schools/esc_a/')).toHaveLength(5);
  });
  it('repete em erro 5xx e acaba por conseguir', async () => {
    const { f, seen } = fakeS3({ failFirst: 2 }); const s = new S3BackupStore(cfg(f));
    await s.put('schools/esc_a/a.bmbak', Buffer.from('x'));
    expect(seen.length).toBe(3);
  });
  it('credenciais erradas → erro claro (não finge que guardou)', async () => {
    const { f, objs } = fakeS3({ badSecret: true }); const s = new S3BackupStore(cfg(f));
    await expect(s.put('schools/esc_a/a.bmbak', Buffer.from('x'))).rejects.toThrow(/recusou/);
    expect(objs.size).toBe(0);
  });
  it('indisponível de forma persistente → erro depois das tentativas', async () => {
    const { f } = fakeS3({ failFirst: 99 }); const s = new S3BackupStore(cfg(f, { retries: 2 }));
    await expect(s.get('schools/esc_a/a.bmbak')).rejects.toThrow(/indisponível/);
  });
});
