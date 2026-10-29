/**
 * Pré-Matrícula Online: regras puras da Consulta pública e do envio por fases.
 *
 * A Consulta lê um registo publicado em `public_admission_status/{inst}/{statusKey}`. A chave do
 * registo é aleatória; para o encontrar o candidato usa um índice `ix_<hash>` calculado a partir de
 * (instituição + nº de B.I., nº de Pré-Matrícula ou código + DATA DE NASCIMENTO). Sem a data de
 * nascimento não se consegue calcular o índice, por isso os códigos sequenciais (PRE-…-0001) não
 * permitem percorrer as candidaturas de outras pessoas.
 */
import type { Admission, AdmissionStatus, PublicAdmissionStatus } from '../types';

/** Tamanho de cada fase na importação das candidaturas online. */
export const IMPORT_PHASE_SIZE = 50;

/** Fotografia só é publicada se for imagem pequena (limite do registo público). */
export const MAX_PUBLIC_PHOTO_CHARS = 300_000;

const REF_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

const randomChars = (alphabet: string, n: number): string => {
  const out: string[] = [];
  const buf = new Uint32Array(n);
  if (typeof crypto !== 'undefined' && crypto.getRandomValues) crypto.getRandomValues(buf);
  else for (let i = 0; i < n; i++) buf[i] = Math.floor(Math.random() * 4294967296);
  for (let i = 0; i < n; i++) out.push(alphabet[buf[i] % alphabet.length]);
  return out.join('');
};

/** Nº de Pré-Matrícula entregue ao candidato, ex.: PM-7K3Q9XAB. */
export const newPublicRef = (): string => `PM-${randomChars(REF_ALPHABET, 8)}`;

/** Chave aleatória (não adivinhável) do registo público. */
export const newStatusKey = (): string => `rk_${randomChars('abcdefghijklmnopqrstuvwxyz0123456789', 20)}`;

/** B.I., PM-… e PRE-… comparam-se sem espaços, hífenes, barras nem maiúsculas. */
export const normalizeLookupId = (s?: string): string => String(s ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '');

async function sha256Hex(text: string): Promise<string> {
  if (typeof crypto !== 'undefined' && crypto.subtle) {
    const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
    return Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, '0')).join('');
  }
  // Contextos sem crypto.subtle (http local): hash simples, só para desenvolvimento.
  let h1 = 0xdeadbeef, h2 = 0x41c6ce57;
  for (let i = 0; i < text.length; i++) {
    const ch = text.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  return ((h1 >>> 0).toString(16).padStart(8, '0') + (h2 >>> 0).toString(16).padStart(8, '0')).repeat(4);
}

/** Chave do índice de consulta: `ix_` + 40 hex. Depende do identificador E da data de nascimento. */
export async function lookupIndexKey(inst: string, id: string, birthDate: string): Promise<string> {
  const norm = normalizeLookupId(id);
  if (!norm || !/^\d{4}-\d{2}-\d{2}$/.test(birthDate || '')) return '';
  return `ix_${(await sha256Hex(`${inst}|${norm}|${birthDate}`)).slice(0, 40)}`;
}

/** Identificadores que dão acesso ao registo: B.I., nº de Pré-Matrícula e código sequencial. */
export const lookupIdsOf = (a: Pick<Admission, 'biNumber' | 'publicRef' | 'code'>): string[] =>
  [a.biNumber, a.publicRef, a.code].map((x) => (x || '').trim()).filter((x) => normalizeLookupId(x).length >= 4);

export function pickPhoto(a: Pick<Admission, 'documents'>): string | undefined {
  const doc = (a.documents || []).find((d) => d.key === 'fotografias');
  const url = doc?.attachment?.dataUrl || '';
  return url.startsWith('data:image/') && url.length <= MAX_PUBLIC_PHOTO_CHARS ? url : undefined;
}

const strip = <T extends Record<string, any>>(o: T): T => {
  const out: Record<string, any> = {};
  Object.keys(o).forEach((k) => { if (o[k] !== undefined && o[k] !== null && o[k] !== '') out[k] = o[k]; });
  return out as T;
};

export function buildStatusRecord(
  a: Admission,
  opts: { statusKey: string; matriculaNumber?: string; schoolName?: string }
): PublicAdmissionStatus {
  return strip({
    rk: opts.statusKey,
    ref: a.publicRef || '',
    code: a.code,
    academicYear: a.academicYear,
    status: a.status as AdmissionStatus,
    schoolName: opts.schoolName,
    name: a.name,
    gender: a.gender,
    birthDate: a.birthDate,
    nationality: a.nationality,
    birthPlace: a.birthPlace,
    biNumber: a.biNumber,
    address: a.address,
    phone: a.phone,
    email: a.email,
    desiredGrade: a.desiredGrade,
    desiredCourse: a.desiredCourse,
    desiredShift: a.desiredShift,
    previousSchool: a.previousSchool,
    lastCompletedGrade: a.lastCompletedGrade,
    guardianName: a.guardianName,
    guardianRelation: a.guardianRelation,
    guardianPhone: a.guardianPhone,
    assessmentType: a.assessmentType,
    assessmentDate: a.assessmentDate,
    assessmentTime: a.assessmentTime,
    assessmentNotes: a.assessmentNotes,
    // O motivo só é publicado quando a candidatura foi rejeitada (nunca notas internas de outros estados).
    decisionNotes: a.status === 'rejeitada' ? a.decisionNotes : undefined,
    assessmentScore: typeof a.assessmentScore === 'number' ? a.assessmentScore : undefined,
    matriculaNumber: opts.matriculaNumber,
    photo: pickPhoto(a),
    submittedAt: a.createdAt,
    updatedAt: a.updatedAt || a.createdAt
  }) as PublicAdmissionStatus;
}

/** Assinatura do que é publicado (a foto entra só pelo tamanho): se não mudar, não se reescreve. */
export function statusSignature(rec: PublicAdmissionStatus): string {
  const { photo, updatedAt, ...rest } = rec;
  return JSON.stringify({ ...rest, photoLen: photo ? photo.length : 0 });
}

/** Divide uma lista em fases (por omissão de 50). */
export function chunkPhases<T>(items: T[], size = IMPORT_PHASE_SIZE): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

/** Pode reclamar quem foi rejeitado ou tem nota negativa (0 a 9). */
export const canComplain = (rec: Pick<PublicAdmissionStatus, 'status' | 'assessmentScore'>): boolean =>
  rec.status === 'rejeitada' || (typeof rec.assessmentScore === 'number' && rec.assessmentScore >= 0 && rec.assessmentScore < 10);

export const PUBLIC_STATUS_TEXT: Record<AdmissionStatus, { label: string; tone: 'neutral' | 'info' | 'ok' | 'warn' | 'bad'; message: string }> = {
  recebida: { label: 'Recebida', tone: 'neutral', message: 'A sua candidatura foi recebida e aguarda análise da Secretaria.' },
  em_analise: { label: 'Em análise', tone: 'info', message: 'A Secretaria está a analisar a candidatura.' },
  avaliacao_agendada: { label: 'Avaliação agendada', tone: 'info', message: 'Foi marcada uma avaliação de admissão. Veja a data abaixo.' },
  aprovada: { label: 'Aceite', tone: 'ok', message: 'Candidatura aceite. Dirija-se à Secretaria para formalizar a matrícula.' },
  lista_espera: { label: 'Lista de espera', tone: 'warn', message: 'Candidatura em lista de espera. A Secretaria contacta se surgir vaga.' },
  rejeitada: { label: 'Rejeitada', tone: 'bad', message: 'A candidatura não foi aceite.' },
  convertida: { label: 'Matriculado(a)', tone: 'ok', message: 'O candidato foi matriculado. Veja o número de matrícula abaixo.' },
  desistiu: { label: 'Desistência', tone: 'neutral', message: 'A candidatura foi dada como desistida.' }
};

// ---------------------------------------------------------------------------
// Ficha de inscrição (impressão a partir da Consulta pública)
// ---------------------------------------------------------------------------

const esc = (s: unknown) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string));
const fmtDate = (iso?: string) => (iso && /^\d{4}-\d{2}-\d{2}/.test(iso) ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}` : iso || '—');

export function buildInscriptionSheetHtml(rec: PublicAdmissionStatus, school: { name: string; logo?: string }): string {
  const meta = PUBLIC_STATUS_TEXT[rec.status] || PUBLIC_STATUS_TEXT.recebida;
  const row = (k: string, v?: string | number) => `<tr><th>${esc(k)}</th><td>${esc(v === undefined || v === '' ? '—' : v)}</td></tr>`;
  const score = typeof rec.assessmentScore === 'number' ? `${rec.assessmentScore} / 20` : 'Ainda não atribuída';
  return `<!doctype html><html lang="pt"><head><meta charset="utf-8"><title>Ficha de Inscrição ${esc(rec.code || rec.ref)}</title>
<style>
@page{size:A4;margin:14mm}*{box-sizing:border-box}body{font-family:Arial,Helvetica,sans-serif;color:#1e293b;font-size:12px;margin:0}
.head{display:flex;align-items:center;gap:12px;border-bottom:2px solid #0b1f3a;padding-bottom:10px}
.head img{width:54px;height:54px;object-fit:contain}.head h1{font-size:15px;margin:0;color:#0b1f3a;text-transform:uppercase}
.title{display:flex;justify-content:space-between;align-items:flex-end;margin:14px 0 10px}.title h2{margin:0;font-size:16px;text-transform:uppercase}
.code{text-align:right}.code small{display:block;font-size:9px;text-transform:uppercase;color:#64748b;font-weight:700}.code b{font-family:monospace;font-size:15px;color:#0b1f3a}
.grid{display:flex;gap:14px}.photo{width:96px;height:128px;border:1px solid #cbd5e1;display:flex;align-items:center;justify-content:center;color:#94a3b8;font-size:10px;text-align:center;flex-shrink:0}
.photo img{width:100%;height:100%;object-fit:cover}.col{flex:1}
table{width:100%;border-collapse:collapse;margin-bottom:10px}th,td{border:1px solid #cbd5e1;padding:5px 8px;text-align:left}
th{background:#f1f5f9;width:34%;font-size:10px;text-transform:uppercase;color:#475569}h3{font-size:11px;text-transform:uppercase;color:#0b1f3a;margin:12px 0 4px}
.status{display:inline-block;padding:3px 10px;border:1px solid #0b1f3a;font-weight:700;text-transform:uppercase;font-size:11px}
.note{font-size:10.5px;color:#475569;border-top:1px solid #e2e8f0;padding-top:8px;margin-top:10px}
.sign{display:flex;gap:40px;margin-top:40px}.sign div{flex:1;border-top:1px solid #64748b;text-align:center;padding-top:4px;font-size:10px;text-transform:uppercase;font-weight:700;color:#475569}
</style></head><body>
<div class="head">${school.logo ? `<img src="${esc(school.logo)}" alt="">` : ''}<div><h1>${esc(rec.schoolName || school.name)}</h1><div style="font-size:11px;color:#64748b">Ficha de Inscrição · Candidaturas Online</div></div></div>
<div class="title"><div><small style="font-size:10px;font-weight:700;color:#0369a1;text-transform:uppercase">Ano letivo ${esc(rec.academicYear)}</small><h2>Ficha de Inscrição</h2></div>
<div class="code"><small>${rec.code ? 'Código' : 'Nº de Pré-Matrícula'}</small><b>${esc(rec.code || rec.ref)}</b>${rec.code && rec.ref ? `<small style="margin-top:3px">Nº Pré-Matrícula ${esc(rec.ref)}</small>` : ''}</div></div>
<div class="grid"><div class="photo">${rec.photo ? `<img src="${esc(rec.photo)}" alt="Fotografia">` : 'Fotografia'}</div><div class="col">
<h3>Dados pessoais</h3><table>${row('Nome completo', rec.name)}${row('Data de nascimento', fmtDate(rec.birthDate))}${row('Género', rec.gender)}${row('Nacionalidade', rec.nationality)}${row('Naturalidade', rec.birthPlace)}${row('Nº do B.I.', rec.biNumber)}${row('Endereço', rec.address)}${row('Telefone', rec.phone)}${row('E-mail', rec.email)}</table></div></div>
<h3>Candidatura</h3><table>${row('Classe pretendida', rec.desiredGrade)}${row('Curso / Área', rec.desiredCourse)}${row('Turno', rec.desiredShift)}${row('Escola anterior', rec.previousSchool)}${row('Última classe concluída', rec.lastCompletedGrade)}${row('Encarregado de Educação', `${rec.guardianName}${rec.guardianRelation ? ` (${rec.guardianRelation})` : ''}`)}${row('Contacto do Encarregado', rec.guardianPhone)}</table>
<h3>Estado</h3><table><tr><th>Estado da candidatura</th><td><span class="status">${esc(meta.label)}</span></td></tr>${row('Nota de admissão', score)}${rec.assessmentDate ? row('Avaliação agendada', `${fmtDate(rec.assessmentDate)}${rec.assessmentTime ? ' às ' + rec.assessmentTime : ''}`) : ''}${rec.assessmentNotes ? row('Observações da avaliação', rec.assessmentNotes) : ''}${rec.status === 'rejeitada' && rec.decisionNotes ? row('Motivo', rec.decisionNotes) : ''}${rec.matriculaNumber ? row('Nº de matrícula', rec.matriculaNumber) : ''}</table>
<p class="note">Esta ficha atesta a receção da candidatura. <b>Não garante a atribuição de vaga</b>: a matrícula só se considera efetuada após a aprovação e a formalização na Secretaria. Impressa em ${new Date().toLocaleDateString('pt-PT')}.</p>
<div class="sign"><div>A Secretaria</div><div>O Encarregado de Educação</div></div></body></html>`;
}
