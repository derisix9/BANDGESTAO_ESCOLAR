/** Regras puras (sem rede, sem Deno): validação do que o administrador escreve, nome dos ficheiros e retenção. */
export class ConfigError extends Error { constructor(message: string) { super(message); this.name = 'ConfigError'; } }

export const PROVIDERS = ['s3', 'gdrive'] as const;
export type Provider = (typeof PROVIDERS)[number];
export const isProvider = (v: unknown): v is Provider => (PROVIDERS as readonly string[]).includes(v as string);

/** 0 = nunca apagar. */
export const RETENTION_OPTIONS = [0, 7, 14, 30, 60, 90, 180, 365] as const;
export const SCHOOL_TZ_OFFSET_MIN = 60;   // Angola (WAT) = UTC+1

export function cleanSchedule(runHour: unknown, retentionDays: unknown): { runHour: number; retentionDays: number } {
  const h = Number(runHour);
  if (!Number.isInteger(h) || h < 0 || h > 23) throw new ConfigError('Hora inválida (0 a 23).');
  const r = Number(retentionDays);
  if (!(RETENTION_OPTIONS as readonly number[]).includes(r)) throw new ConfigError('Período de retenção inválido.');
  return { runHour: h, retentionDays: r };
}

const IPV4 = /^\d{1,3}(\.\d{1,3}){3}$/;
const BLOCKED_SUFFIX = ['.local', '.localhost', '.internal', '.localdomain', '.lan', '.home.arpa', '.intranet', '.corp', '.cluster.local'];

/** Só HTTPS num nome de domínio público (anti-SSRF): nada de IPs, localhost, portas ou nomes internos. */
export function checkS3Endpoint(raw: unknown): string {
  let u: URL;
  try { u = new URL(String(raw ?? '').trim()); } catch { throw new ConfigError('Endereço (endpoint) inválido. Exemplo: https://s3.us-west-004.backblazeb2.com'); }
  if (u.protocol !== 'https:') throw new ConfigError('O endereço tem de começar por https://');
  if (u.username || u.password) throw new ConfigError('O endereço não pode conter utilizador/palavra-passe.');
  if (u.port && u.port !== '443') throw new ConfigError('Só é permitida a porta 443 (HTTPS normal).');
  if (u.pathname !== '/' && u.pathname !== '') throw new ConfigError('O endereço deve ser só o domínio, sem caminho (o bucket indica-se à parte).');
  if (u.search || u.hash) throw new ConfigError('O endereço não pode ter parâmetros.');
  const h = u.hostname.toLowerCase();
  if (!h.includes('.') || h.startsWith('[') || h.includes(':') || IPV4.test(h) || h === 'localhost' || BLOCKED_SUFFIX.some((s) => h.endsWith(s))) {
    throw new ConfigError('O endereço tem de ser um nome de domínio público (não IPs nem endereços internos).');
  }
  if (!/^[a-z0-9.-]+$/.test(h)) throw new ConfigError('Nome de domínio inválido.');
  return `https://${h}`;
}

export interface S3Config { endpoint: string; region: string; bucket: string; prefix: string }
export interface S3Secret { accessKeyId: string; secretAccessKey: string }

export function cleanS3Config(c: any): S3Config {
  const endpoint = checkS3Endpoint(c?.endpoint);
  const region = String(c?.region ?? '').trim().toLowerCase();
  if (!/^[a-z0-9-]{2,40}$/.test(region)) throw new ConfigError('Região inválida (ex.: us-west-004, eu-central-2, auto).');
  const bucket = String(c?.bucket ?? '').trim();
  if (!/^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/.test(bucket)) throw new ConfigError('Nome do bucket inválido (3 a 63 caracteres: minúsculas, números, ponto e hífen).');
  const prefix = String(c?.prefix ?? '').trim().replace(/^\/+|\/+$/g, '');
  if (prefix && (prefix.length > 100 || prefix.includes('..') || prefix.includes('//') || !/^[A-Za-z0-9_.\-/]+$/.test(prefix))) {
    throw new ConfigError('Pasta inválida (letras, números, _ - . e /; sem "..").');
  }
  return { endpoint, region, bucket, prefix };
}

export function cleanS3Secret(s: any): S3Secret {
  const accessKeyId = String(s?.accessKeyId ?? '').trim();
  const secretAccessKey = String(s?.secretAccessKey ?? '').trim();
  if (!/^[A-Za-z0-9/+=_-]{8,128}$/.test(accessKeyId)) throw new ConfigError('Chave de acesso (Access Key ID) inválida.');
  if (secretAccessKey.length < 8 || secretAccessKey.length > 256 || /\s/.test(secretAccessKey)) throw new ConfigError('Chave secreta (Secret Access Key) inválida.');
  return { accessKeyId, secretAccessKey };
}

export const slugify = (s: string): string =>
  (s || 'escola').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-+|-+$/g, '').toLowerCase().slice(0, 40) || 'escola';

/** `bandmed_<escola>_2026-10-13_2300.json` na hora de Angola (igual ao "Baixar backup" da app). */
export function backupFileName(schoolName: string, when: Date = new Date()): string {
  const l = new Date(when.getTime() + SCHOOL_TZ_OFFSET_MIN * 60_000);
  const p = (n: number) => String(n).padStart(2, '0');
  return `bandmed_${slugify(schoolName)}_${l.getUTCFullYear()}-${p(l.getUTCMonth() + 1)}-${p(l.getUTCDate())}_${p(l.getUTCHours())}${p(l.getUTCMinutes())}.json`;
}

export function backupFileDate(name: string, schoolName: string): number | null {
  const m = new RegExp(`^bandmed_${slugify(schoolName).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}_(\\d{4})-(\\d{2})-(\\d{2})_\\d{4}\\.json$`).exec(name);
  if (!m) return null;
  const t = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return Number.isFinite(t) ? t : null;
}

/** Só ficheiros com o nome exacto dos backups desta escola e mais antigos que `keepDays`; 0 = nunca; as `minKeep` mais recentes ficam sempre. */
export function selectExpired(names: string[], schoolName: string, keepDays: number, now: number = Date.now(), minKeep = 3): string[] {
  if (!keepDays || keepDays <= 0) return [];
  const dated = names.map((n) => ({ n, t: backupFileDate(n, schoolName) })).filter((x): x is { n: string; t: number } => x.t !== null)
    .sort((a, b) => b.t - a.t || (a.n < b.n ? 1 : -1));
  const cutoff = now - keepDays * 86_400_000;
  return dated.slice(minKeep).filter((x) => x.t < cutoff).map((x) => x.n);
}

export function safeError(e: unknown): string {
  const m = e instanceof Error ? e.message : String(e ?? 'Erro desconhecido');
  return m.replace(/\s+/g, ' ').slice(0, 300);
}
