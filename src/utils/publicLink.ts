/**
 * Link público de consulta gravado nos códigos QR dos cartões e crachás.
 * Ao ler o QR com qualquer leitor, abre-se uma página só de consulta (sem login):
 *  - aluno: situação financeira (regular / com dívida), ficha e histórico académico;
 *  - professor/funcionário: ficha e histórico de folha de pagamento.
 */
import { personToken } from './publicToken';

export type PublicKind = 'student' | 'staff';

export interface PublicLinkOpts {
  /** Instituição (multi-escola). */
  inst?: string;
  /** Nº e código do documento emitido (rastreio; não dão acesso a nada). */
  doc?: string;
  code?: string;
  /** Endereço base; por omissão o da própria aplicação. */
  origin?: string;
  /** `historico`: ao ler o QR descarrega o PDF do histórico académico. */
  dl?: 'historico';
}

let defaultInst = '';
let publicSecret = '';
/** Segredo da instituição (settings.publicVerifySecret): com ele os links levam o token público da pessoa. */
export const setPublicSecret = (s: string) => { publicSecret = s || ''; };
/** Chave da pessoa: "s:<id>" aluno; docentes/funcionários já vêm como "t:<id>" / "f:<id>". */
export const publicKeyOf = (kind: PublicKind, id: string): string => (/^[stf]:/.test(id) ? id : kind === 'student' ? `s:${id}` : id);
/** Token público da pessoa ('' se a instituição ainda não tem segredo). */
export const publicTokenOf = (key: string): string => personToken(publicSecret, key);
/** Instituição activa (definida uma vez pela aplicação; entra em todos os links gerados). */
export const setPublicInstitution = (id: string) => { defaultInst = id || ''; };

const baseOrigin = (): string => {
  if (typeof window === 'undefined' || !window.location) return '';
  return `${window.location.origin}${window.location.pathname}`;
};

/** Endereço base da aplicação para os links gravados nos códigos QR. */
export const publicBase = (): string => baseOrigin();

/** Instituição activa que entra nos links públicos (definida com `setPublicInstitution`). */
export const getPublicInstitution = (): string => defaultInst;

export function buildPublicLink(kind: PublicKind, id: string, o: PublicLinkOpts = {}): string {
  const p = new URLSearchParams();
  p.set('public_verify', 'true');
  p.set('type', kind);
  p.set('id', id);
  const inst = o.inst ?? defaultInst;
  if (inst) p.set('inst', inst);
  if (o.doc) p.set('doc', o.doc);
  if (o.code && o.code !== 'PENDENTE') p.set('c', o.code);
  const k = publicTokenOf(publicKeyOf(kind, id));
  if (k) p.set('k', k);
  if (o.dl) p.set('dl', o.dl);
  return `${o.origin ?? baseOrigin()}?${p.toString()}`;
}

/** Lê os parâmetros do link público (o inverso de `buildPublicLink`). */
export function parsePublicLink(search: string): { kind: PublicKind; id: string; inst: string; doc: string; code: string; k: string; dl: string } {
  const q = new URLSearchParams(search);
  return {
    kind: q.get('type') === 'staff' ? 'staff' : 'student',
    id: q.get('id') || '',
    inst: q.get('inst') || '',
    doc: q.get('doc') || '',
    code: q.get('c') || '',
    k: q.get('k') || '',
    dl: q.get('dl') || ''
  };
}

/**
 * Valor gravado nos códigos de barras dos cartões (Code 128 curto, legível em 20 mm):
 * "P" + token = ficha pública da pessoa; "T" + token = passe de transporte.
 * O leitor da aplicação (?scan=1) e o leitor de código de barras USB abrem a mesma página que o QR.
 */
export function barOf(verifyValue: string): string {
  try {
    const q = new URLSearchParams(verifyValue.slice(verifyValue.indexOf('?') + 1));
    const k = q.get('k');
    if (k) return (q.get('type') === 'transport' ? 'T' : 'P') + k;
  } catch { /* valor não é um link */ }
  return (verifyValue || 'BANDGEST').replace(/[^\x20-\x7e]/g, '').slice(0, 18);
}

/** Converte o texto lido de um código de barras ("Pxxxxxxxxxx" / "Txxxxxxxxxx") no link da página pública. */
export function linkFromBarcode(text: string, base: string = baseOrigin()): string | null {
  const m = /^([PT])([0-9a-z]{10})$/.exec((text || '').trim());
  if (!m) return null;
  return `${base}?pv=${m[2]}${m[1] === 'T' ? '&t=1' : ''}`;
}
