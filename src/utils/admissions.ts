import {
  Admission,
  AdmissionDocument,
  AdmissionStatus,
  ClassRoom,
  Student
} from '../types';
import { normalizeGradeKey } from './educationSubsystems';
import { blobFromDataUrl } from './safeFiles';

/**
 * PRÉ-MATRÍCULA / ADMISSÕES — regras de negócio (sem React nem Firebase).
 *
 * Fluxo: Recebida → Em Análise → Avaliação Agendada → (Aprovada | Lista de
 * Espera | Rejeitada) → Convertida em Aluno. A conversão cria a ficha do Aluno
 * (estado "pendente") e encaminha para Matrículas, onde nascem a turma e o
 * plano financeiro — a admissão nunca inventa valores nem turmas.
 */

export interface AdmissionStatusMeta {
  label: string;
  icon: string;
  /** Classes Tailwind do "badge". */
  badge: string;
  /** Estados em que a candidatura ainda ocupa/disputa uma vaga. */
  open: boolean;
}

export const ADMISSION_STATUS_META: Record<AdmissionStatus, AdmissionStatusMeta> = {
  recebida: { label: 'Recebida', icon: 'inbox', badge: 'bg-slate-200 text-slate-700', open: true },
  em_analise: { label: 'Em Análise', icon: 'manage_search', badge: 'bg-blue-100 text-blue-800', open: true },
  avaliacao_agendada: {
    label: 'Avaliação Agendada',
    icon: 'event',
    badge: 'bg-violet-100 text-violet-800',
    open: true
  },
  aprovada: { label: 'Aprovada', icon: 'check_circle', badge: 'bg-emerald-100 text-emerald-800', open: true },
  lista_espera: { label: 'Lista de Espera', icon: 'hourglass_top', badge: 'bg-amber-100 text-amber-800', open: true },
  rejeitada: { label: 'Rejeitada', icon: 'cancel', badge: 'bg-red-100 text-red-800', open: false },
  convertida: { label: 'Convertida em Aluno', icon: 'how_to_reg', badge: 'bg-[#0b1f3a] text-white', open: false },
  desistiu: { label: 'Desistiu', icon: 'person_off', badge: 'bg-slate-100 text-slate-500', open: false }
};

export const ADMISSION_STATUS_ORDER: AdmissionStatus[] = [
  'recebida',
  'em_analise',
  'avaliacao_agendada',
  'aprovada',
  'lista_espera',
  'rejeitada',
  'convertida',
  'desistiu'
];

export const ADMISSION_SOURCE_LABELS = {
  presencial: 'Presencial (Secretaria)',
  telefone: 'Telefone',
  online: 'Online / Redes Sociais',
  indicacao: 'Indicação'
} as const;

export const ADMISSION_ASSESSMENT_LABELS = {
  teste: 'Teste de Admissão',
  entrevista: 'Entrevista',
  teste_entrevista: 'Teste + Entrevista'
} as const;

const TRANSITIONS: Record<AdmissionStatus, AdmissionStatus[]> = {
  recebida: ['em_analise', 'avaliacao_agendada', 'aprovada', 'lista_espera', 'rejeitada', 'desistiu'],
  em_analise: ['avaliacao_agendada', 'aprovada', 'lista_espera', 'rejeitada', 'desistiu'],
  avaliacao_agendada: ['em_analise', 'aprovada', 'lista_espera', 'rejeitada', 'desistiu'],
  aprovada: ['convertida', 'lista_espera', 'rejeitada', 'desistiu'],
  lista_espera: ['em_analise', 'aprovada', 'rejeitada', 'desistiu'],
  rejeitada: ['em_analise'],
  desistiu: ['em_analise'],
  // Terminal: a partir daqui a vida do aluno acontece em Alunos/Matrículas.
  convertida: []
};

export function allowedTransitions(from: AdmissionStatus): AdmissionStatus[] {
  return TRANSITIONS[from] || [];
}

export function canTransition(from: AdmissionStatus, to: AdmissionStatus): boolean {
  return allowedTransitions(from).includes(to);
}

/** Estados que exigem uma decisão registada (quem decidiu / quando / porquê). */
export const DECISION_STATUSES: AdmissionStatus[] = ['aprovada', 'lista_espera', 'rejeitada'];

export const DEFAULT_ADMISSION_DOCUMENTS: Array<Omit<AdmissionDocument, 'delivered'>> = [
  { key: 'bi_candidato', label: 'Cópia do B.I. / Cédula do candidato' },
  { key: 'certificado', label: 'Certificado ou declaração de habilitações' },
  { key: 'fotografias', label: 'Fotografias tipo passe' },
  { key: 'bi_encarregado', label: 'Cópia do B.I. do Encarregado de Educação' },
  { key: 'saude', label: 'Cartão de vacinas / atestado médico' },
  { key: 'transferencia', label: 'Guia de transferência (se vier de outra escola)' }
];

/** Documentos obrigatórios na candidatura online (B.I. e certificado); os restantes são opcionais. */
export const REQUIRED_ADMISSION_DOCS: string[] = ['bi_candidato', 'certificado'];

export function emptyDocuments(): AdmissionDocument[] {
  return DEFAULT_ADMISSION_DOCUMENTS.map((d) => ({ ...d, delivered: false }));
}

export function documentsProgress(a: Pick<Admission, 'documents'>): { delivered: number; total: number } {
  const docs = a.documents || [];
  return { delivered: docs.filter((d) => d.delivered).length, total: docs.length };
}

export function pendingDocuments(a: Pick<Admission, 'documents'>): AdmissionDocument[] {
  return (a.documents || []).filter((d) => !d.delivered);
}

/** Código sequencial por ano letivo: PRE-2027/2028-0001. Nunca repete. */
export function generateAdmissionCode(academicYear: string, existingCodes: Array<string | undefined> = []): string {
  const prefix = `PRE-${academicYear}-`;
  let max = 0;
  for (const code of existingCodes) {
    if (!code || !code.startsWith(prefix)) continue;
    const n = parseInt(code.slice(prefix.length), 10);
    if (Number.isFinite(n) && n > max) max = n;
  }
  return `${prefix}${String(max + 1).padStart(4, '0')}`;
}

/** Idade completa, em anos, numa data de referência (por omissão hoje). */
export function ageOn(birthDateIso?: string | null, reference: Date = new Date()): number | null {
  if (!birthDateIso || !/^\d{4}-\d{2}-\d{2}$/.test(birthDateIso)) return null;
  const [y, m, d] = birthDateIso.split('-').map(Number);
  const birth = new Date(y, m - 1, d);
  if (Number.isNaN(birth.getTime()) || birth.getMonth() !== m - 1) return null;
  let age = reference.getFullYear() - y;
  const hadBirthday =
    reference.getMonth() > m - 1 || (reference.getMonth() === m - 1 && reference.getDate() >= d);
  if (!hadBirthday) age -= 1;
  return age;
}

function norm(value?: string | null): string {
  return (value || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function normDoc(value?: string | null): string {
  return (value || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
}

export interface AdmissionValidationInput {
  name: string;
  birthDate: string;
  desiredGrade: string;
  guardianName: string;
  guardianPhone: string;
  email?: string;
  guardianEmail?: string;
  assessmentScore?: number | null;
}

/** Devolve a lista de erros (vazia = válido). */
export function validateAdmission(input: AdmissionValidationInput, reference: Date = new Date()): string[] {
  const errors: string[] = [];
  if (!input.name.trim()) errors.push('Indique o nome completo do candidato.');
  else if (input.name.trim().split(/\s+/).length < 2) errors.push('Indique o nome completo (nome e apelido) do candidato.');

  if (!input.birthDate) {
    errors.push('Indique a data de nascimento do candidato.');
  } else {
    const age = ageOn(input.birthDate, reference);
    if (age === null) errors.push('A data de nascimento não é válida.');
    else if (age < 0) errors.push('A data de nascimento não pode estar no futuro.');
    else if (age > 60) errors.push('A data de nascimento indicada resulta numa idade superior a 60 anos — confirme-a.');
  }

  if (!input.desiredGrade.trim()) errors.push('Escolha a classe pretendida.');
  if (!input.guardianName.trim()) errors.push('Indique o nome do Encarregado de Educação.');
  if (!input.guardianPhone.trim()) errors.push('Indique um telefone de contacto do Encarregado.');

  const emailRe = /^\S+@\S+\.\S+$/;
  if (input.email && input.email.trim() && !emailRe.test(input.email.trim())) {
    errors.push('O e-mail do candidato não é válido.');
  }
  if (input.guardianEmail && input.guardianEmail.trim() && !emailRe.test(input.guardianEmail.trim())) {
    errors.push('O e-mail do Encarregado não é válido.');
  }

  if (input.assessmentScore !== undefined && input.assessmentScore !== null) {
    if (!Number.isFinite(input.assessmentScore) || input.assessmentScore < 0 || input.assessmentScore > 20) {
      errors.push('A nota da avaliação de admissão deve estar entre 0 e 20 valores.');
    }
  }
  return errors;
}

/** Já existe um aluno com o mesmo B.I. ou com o mesmo nome e data de nascimento? */
export function findDuplicateStudent(
  students: Student[],
  candidate: Pick<Admission, 'name' | 'birthDate' | 'biNumber'>
): Student | undefined {
  const bi = normDoc(candidate.biNumber);
  const name = norm(candidate.name);
  return students.find((s) => {
    if (bi && (normDoc(s.biNumber) === bi || normDoc(s.citizenCard) === bi)) return true;
    return !!name && norm(s.name) === name && !!candidate.birthDate && s.birthDate === candidate.birthDate;
  });
}

/** Já existe outra candidatura viva (mesmo ano letivo) para a mesma pessoa? */
export function findDuplicateAdmission(
  admissions: Admission[],
  candidate: Pick<Admission, 'name' | 'birthDate' | 'biNumber' | 'academicYear'>,
  excludeId?: string
): Admission | undefined {
  const bi = normDoc(candidate.biNumber);
  const name = norm(candidate.name);
  return admissions.find((a) => {
    if (a.id === excludeId) return false;
    if (a.academicYear !== candidate.academicYear) return false;
    if (a.status === 'rejeitada' || a.status === 'desistiu') return false;
    if (bi && normDoc(a.biNumber) === bi) return true;
    return !!name && norm(a.name) === name && !!candidate.birthDate && a.birthDate === candidate.birthDate;
  });
}

export interface VacancyInfo {
  /** Nº de turmas dessa classe já criadas para o ano letivo. */
  classesCount: number;
  capacity: number;
  enrolled: number;
  /** Vagas livres nas turmas (capacidade − alunos). */
  free: number;
  /** Candidaturas aprovadas ainda não convertidas — vagas já prometidas. */
  reserved: number;
  /** Vagas realmente disponíveis = livres − prometidas (nunca negativo). */
  available: number;
}

/**
 * Vagas reais da classe pretendida, calculadas das turmas existentes
 * (capacidade máxima − alunos) e das candidaturas já aprovadas. Se ainda não
 * há turmas criadas para o ano letivo, `classesCount` é 0 e a decisão fica
 * a cargo da Direção — nada é inventado.
 */
export function computeVacancies(
  classes: ClassRoom[],
  admissions: Admission[],
  grade: string,
  academicYear: string,
  excludeAdmissionId?: string
): VacancyInfo {
  const key = normalizeGradeKey(grade);
  const matching = classes.filter(
    (c) => normalizeGradeKey(c.grade) === key && (!c.academicYear || c.academicYear === academicYear)
  );
  const capacity = matching.reduce((sum, c) => sum + (Number(c.maxCapacity) || 0), 0);
  const enrolled = matching.reduce((sum, c) => sum + (Number(c.studentCount) || 0), 0);
  const free = matching.reduce(
    (sum, c) => sum + Math.max(0, (Number(c.maxCapacity) || 0) - (Number(c.studentCount) || 0)),
    0
  );
  const reserved = admissions.filter(
    (a) =>
      a.id !== excludeAdmissionId &&
      a.status === 'aprovada' &&
      a.academicYear === academicYear &&
      normalizeGradeKey(a.desiredGrade) === key
  ).length;
  return {
    classesCount: matching.length,
    capacity,
    enrolled,
    free,
    reserved,
    available: Math.max(0, free - reserved)
  };
}

const RESULT_TO_SITUATION: Record<string, string> = {
  Aprovado: 'Transitado',
  Reprovado: 'Reprovado',
  Transferido: 'Transferido',
  Desistente: 'Desistente',
  'Primeira Matrícula': 'Primeira Matrícula'
};

/**
 * Dados da ficha do Aluno criada a partir da candidatura. Turma, curso, propina
 * e situação financeira ficam vazios de propósito: pertencem à Matrícula.
 */
export function admissionToStudentPayload(a: Admission) {
  return {
    name: a.name.trim(),
    gender: a.gender,
    birthDate: a.birthDate,
    nationality: a.nationality || 'Angolana',
    birthPlace: a.birthPlace || '',
    biNumber: a.biNumber || '',
    citizenCard: a.biNumber || '',
    address: a.address || '',
    studentPhone: a.phone || '',
    email: a.email || '',
    nif: '',
    guardianName: a.guardianName,
    guardianPhone: a.guardianPhone,
    guardianEmail: a.guardianEmail || '',
    guardianNif: a.guardianNif || '',
    guardianRelation: a.guardianRelation || '',
    previousSchool: a.previousSchool || '',
    lastCompletedGrade: a.lastCompletedGrade || '',
    academicSituation: a.previousResult ? RESULT_TO_SITUATION[a.previousResult] : undefined
  };
}

const CSV_HEADERS = [
  'Código',
  'Ano Letivo',
  'Estado',
  'Candidato',
  'Género',
  'Data de Nascimento',
  'Classe Pretendida',
  'Escola de Proveniência',
  'Encarregado',
  'Telefone do Encarregado',
  'Documentos Entregues',
  'Nota da Avaliação',
  'Data de Registo'
];

function csvCell(value: unknown): string {
  const text = value === undefined || value === null ? '' : String(value);
  // Neutraliza fórmulas em folhas de cálculo (= + - @) e escapa aspas.
  const safe = /^[=+\-@]/.test(text) ? `'${text}` : text;
  return `"${safe.replace(/"/g, '""')}"`;
}

export function admissionsToCsv(list: Admission[]): string {
  const rows = list.map((a) => {
    const p = documentsProgress(a);
    return [
      a.code,
      a.academicYear,
      ADMISSION_STATUS_META[a.status].label,
      a.name,
      a.gender,
      a.birthDate,
      a.desiredGrade,
      a.previousSchool || '',
      a.guardianName,
      a.guardianPhone,
      `${p.delivered}/${p.total}`,
      a.assessmentScore ?? '',
      a.createdAt.slice(0, 10)
    ]
      .map(csvCell)
      .join(';');
  });
  // BOM para o Excel abrir corretamente a acentuação.
  return '\uFEFF' + [CSV_HEADERS.map(csvCell).join(';'), ...rows].join('\r\n');
}

// ---------------------------------------------------------------------------
// Anexos enviados na Pré-Matrícula Online
// ---------------------------------------------------------------------------

/** Limites (dimensionados para o anexo caber no documento da escola sem o inchar). */
export const ATTACHMENT_LIMITS = {
  /** Imagens são comprimidas no browser antes do envio. */
  imageMaxSide: 1000,
  imageQuality: 0.6,
  /** PDFs não se comprimem: tamanho máximo do ficheiro original. */
  pdfMaxBytes: 500 * 1024,
  /** Tamanho máximo do ficheiro original de imagem (antes de comprimir). */
  imageMaxInputBytes: 15 * 1024 * 1024,
  /** Máximo de caracteres do data URL por anexo (também imposto na função public_admission_submit). */
  maxDataUrlChars: 1_200_000,
  /** Máximo de caracteres somados de todos os anexos de uma candidatura. */
  maxTotalChars: 4_500_000
} as const;

export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 KB';
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** Abre/descarrega um anexo (data URL → Blob). Só PDF e imagens abrem no navegador; o resto é sempre descarregado (evita HTML/SVG a correr na origem da app). */
export function openAttachment(att: { dataUrl?: string; fileName?: string; mimeType?: string }, download = false): boolean {
  const r = blobFromDataUrl(att.dataUrl, att.mimeType);
  if (!r) return false;
  const url = URL.createObjectURL(r.blob);
  if (download || !r.viewable) {
    const a = document.createElement('a');
    a.href = url;
    a.download = att.fileName || 'documento';
    document.body.appendChild(a);
    a.click();
    a.remove();
  } else {
    window.open(url, '_blank', 'noopener');
  }
  window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
  return true;
}

