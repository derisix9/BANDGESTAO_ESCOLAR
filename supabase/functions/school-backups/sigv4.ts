/**
 * AWS Signature V4 mínima (sem dependências) para falar com qualquer armazenamento compatível com S3
 * (AWS S3, Backblaze B2, Wasabi, Cloudflare R2, MinIO…). Verificada contra os exemplos oficiais da AWS (tests/backupStore.test.ts).
 */
import { createHash, createHmac } from 'node:crypto';
import { Buffer } from 'node:buffer';

export const sha256Hex = (data: string | Buffer): string => createHash('sha256').update(data).digest('hex');
const hmac = (key: Buffer | string, data: string): Buffer => createHmac('sha256', key).update(data, 'utf8').digest();

/** Codificação da AWS: tudo excepto A-Z a-z 0-9 - _ . ~ ; a "/" só se mantém no caminho. */
const enc = (s: string, keepSlash = false): string =>
  encodeURIComponent(s).replace(/[!'()*]/g, (c) => '%' + c.charCodeAt(0).toString(16).toUpperCase()).replace(/%2F/g, keepSlash ? '/' : '%2F');

export interface SignInput {
  method: string;
  url: string;
  headers?: Record<string, string>;
  body?: Buffer | string;
  region: string;
  service?: string;
  accessKeyId: string;
  secretAccessKey: string;
  /** só para testes */
  date?: Date;
}

/** Devolve os cabeçalhos a enviar (incluindo Authorization, x-amz-date, x-amz-content-sha256, host). */
export function signV4(i: SignInput): Record<string, string> {
  const u = new URL(i.url);
  const d = (i.date ?? new Date()).toISOString().replace(/[:-]|\.\d{3}/g, '');   // 20130524T000000Z
  const day = d.slice(0, 8);
  const service = i.service ?? 's3';
  const payloadHash = sha256Hex(i.body ?? '');

  const all: Record<string, string> = { ...(i.headers ?? {}), host: u.host, 'x-amz-date': d, 'x-amz-content-sha256': payloadHash };
  const norm: Record<string, string> = {};
  for (const [k, v] of Object.entries(all)) norm[k.toLowerCase()] = String(v).trim().replace(/\s+/g, ' ');
  const names = Object.keys(norm).sort();
  const canonHeaders = names.map((n) => `${n}:${norm[n]}\n`).join('');
  const signedHeaders = names.join(';');

  const q: Array<[string, string]> = [];
  u.searchParams.forEach((v, k) => q.push([enc(k), enc(v)]));
  q.sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : a[1] < b[1] ? -1 : a[1] > b[1] ? 1 : 0));
  const canonQuery = q.map(([k, v]) => `${k}=${v}`).join('&');
  const canonPath = u.pathname.split('/').map((seg) => enc(decodeURIComponent(seg))).join('/') || '/';

  const canonical = [i.method.toUpperCase(), canonPath, canonQuery, canonHeaders, signedHeaders, payloadHash].join('\n');
  const scope = `${day}/${i.region}/${service}/aws4_request`;
  const toSign = ['AWS4-HMAC-SHA256', d, scope, sha256Hex(canonical)].join('\n');
  const kSigning = hmac(hmac(hmac(hmac('AWS4' + i.secretAccessKey, day), i.region), service), 'aws4_request');
  const signature = createHmac('sha256', kSigning).update(toSign, 'utf8').digest('hex');

  const out: Record<string, string> = { ...norm };
  delete out.host;   // o fetch define o Host sozinho
  out.authorization = `AWS4-HMAC-SHA256 Credential=${i.accessKeyId}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;
  return out;
}
