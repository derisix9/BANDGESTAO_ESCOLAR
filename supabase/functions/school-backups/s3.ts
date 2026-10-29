/** Cliente S3 mínimo (path-style) para AWS S3, Backblaze B2, Wasabi, Cloudflare R2, MinIO… */
import { Buffer } from 'node:buffer';
import { signV4 } from './sigv4.ts';
import type { S3Config, S3Secret } from './validate.ts';

const xmlText = (s: string, tag: string): string[] =>
  [...s.matchAll(new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`, 'g'))].map((m) =>
    m[1].replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&'));

export interface S3Options { fetch?: typeof fetch; retries?: number; retryDelayMs?: number; timeoutMs?: number }

export class S3Client {
  private pre: string;
  private f: typeof fetch;
  constructor(private cfg: S3Config, private secret: S3Secret, private opt: S3Options = {}) {
    this.pre = cfg.prefix ? cfg.prefix.replace(/^\/+|\/+$/g, '') + '/' : '';
    this.f = opt.fetch ?? fetch;
  }
  private url(key: string, query = ''): string {
    return `${this.cfg.endpoint}/${this.cfg.bucket}/${key.split('/').map(encodeURIComponent).join('/')}${query}`;
  }
  private async call(method: string, key: string, query = '', body?: Uint8Array, ok: number[] = [200]): Promise<Response> {
    const url = this.url(key, query);
    const attempts = (this.opt.retries ?? 2) + 1;
    let last = 'sem resposta';
    for (let a = 0; a < attempts; a++) {
      try {
        const headers = signV4({ method, url, body: body ? Buffer.from(body) : undefined, region: this.cfg.region, accessKeyId: this.secret.accessKeyId, secretAccessKey: this.secret.secretAccessKey });
        const res = await this.f(url, { method, headers, body: body as any, signal: AbortSignal.timeout(this.opt.timeoutMs ?? 120_000), redirect: 'error' });
        if (ok.includes(res.status)) return res;
        const txt = (await res.text().catch(() => '')).replace(/\s+/g, ' ').slice(0, 200);
        last = `HTTP ${res.status} ${txt}`;
        if (res.status < 500 && res.status !== 429) throw Object.assign(new Error(last), { final: true });
      } catch (e: any) {
        if (e?.final) throw new Error(`O armazenamento recusou o pedido: ${hint(e.message)}`);
        last = e instanceof Error ? e.message : String(e);
      }
      if (a < attempts - 1) await new Promise((r) => setTimeout(r, (this.opt.retryDelayMs ?? 500) * 2 ** a));
    }
    throw new Error(`O armazenamento está indisponível: ${last}`);
  }
  async put(name: string, body: Uint8Array): Promise<void> { await this.call('PUT', this.pre + name, '', body, [200]); }
  async delete(name: string): Promise<void> { await this.call('DELETE', this.pre + name, '', undefined, [200, 204, 404]); }
  async list(): Promise<string[]> {
    const out: string[] = [];
    let token = '';
    for (let page = 0; page < 200; page++) {
      const q = `?list-type=2&prefix=${encodeURIComponent(this.pre)}&delimiter=%2F` + (token ? `&continuation-token=${encodeURIComponent(token)}` : '');
      const xml = await (await this.call('GET', '', q, undefined, [200])).text();
      for (const k of xmlText(xml, 'Key')) if (k.startsWith(this.pre) && k.length > this.pre.length) out.push(k.slice(this.pre.length));
      const next = xmlText(xml, 'NextContinuationToken')[0];
      if (xmlText(xml, 'IsTruncated')[0] === 'true' && next) token = next; else break;
    }
    return out;
  }
}

function hint(msg: string): string {
  if (/403|SignatureDoesNotMatch|InvalidAccessKeyId/i.test(msg)) return `${msg} — confirme a chave de acesso, a chave secreta e a região.`;
  if (/NoSuchBucket|404/i.test(msg)) return `${msg} — o bucket não existe nesse endereço/região.`;
  if (/AccessDenied/i.test(msg)) return `${msg} — a chave não tem permissão de escrita/listagem/apagar neste bucket.`;
  return msg;
}
