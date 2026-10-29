import { loadXlsx, saveXlsx, XlsxLimitError } from './xlsxSafe';
import { Student } from '../types';
import { StudentMiniPautaItem } from '../types/pauta';
import {
  DEFAULT_GRADE_RULES,
  GradeRules,
  PautaRegime,
  calculateCA,
  calculateMFD,
  calculateBirthYearAndAge,
  calculateEjaMT,
  calculateMT,
  normalizeGender,
  recomputeTrimesterRecord
} from './pautaCalculations';

/**
 * Importação de notas a partir de ficheiros .xlsx, .csv e .txt.
 *
 * Os ficheiros são lidos de verdade (SheetJS para Excel; leitor próprio para CSV/TXT com
 * deteção do separador) e cada linha é confrontada com os alunos matriculados na turma.
 *
 * REGRA DE OURO: uma nota só é lançada quando, NA MESMA LINHA, coincidem os três
 * identificadores do aluno naquela turma — Nº na pauta, Nº de processo e Nome completo.
 * Se algum não coincidir, a linha é rejeitada (nunca se "adivinha"), para que a nota
 * de um aluno nunca vá parar a outro.
 */

export const ACCEPTED_EXTENSIONS = ['xlsx', 'csv', 'txt'] as const;
export const ACCEPT_ATTRIBUTE = '.xlsx,.csv,.txt';

export type IdentityKey = 'num' | 'proc' | 'name';
export type GradeKey = 'mac' | 'npp' | 'npt' | 'aav' | 'pcp' | 'nee' | 'neo' | 'ner';
export type FieldKey = IdentityKey | 'gender' | GradeKey;

export interface FieldDefinition {
  key: FieldKey;
  label: string;
  required: boolean;
  /** Sinónimos aceites no cabeçalho, já normalizados (sem acentos, maiúsculas). */
  aliases: string[];
  /** Só aceita correspondência exata do cabeçalho (evita falsos positivos em siglas curtas). */
  exactOnly?: boolean;
}

export const REGIME_LABEL: Record<PautaRegime, string> = {
  exame: 'Classe de exame',
  transicao: 'Classe de transição',
  eja: 'Ensino de Adultos (EJA)'
};

export const REGIME_HELP: Record<PautaRegime, string> = {
  transicao: 'Notas do trimestre: MAC, NPP e NPT (0 a 20). A MT é calculada automaticamente.',
  exame:
    'Notas do trimestre: MAC, NPP e NPT (0 a 20) e, se existirem, as notas de exame NEE (escrito), NEO (oral) e NER (recurso), que não dependem do trimestre.',
  eja: 'Notas do trimestre: MAC (0 a 14), NPT (0 a 14), AAV (0 a 2) e PCP (0 a 4). A MT = (MAC+NPT)/2 + AAV + PCP.'
};

/** Colunas de nota (por regime). */
export const GRADE_FIELDS_BY_REGIME: Record<PautaRegime, GradeKey[]> = {
  transicao: ['mac', 'npp', 'npt'],
  exame: ['mac', 'npp', 'npt', 'nee', 'neo', 'ner'],
  eja: ['mac', 'npt', 'aav', 'pcp']
};

/** Notas de exame: valem para o ano inteiro, não para um trimestre. */
export const EXAM_GRADE_KEYS: GradeKey[] = ['nee', 'neo', 'ner'];

const gradeMax = (key: GradeKey, regime: PautaRegime): number => {
  if (regime !== 'eja') return 20;
  return key === 'aav' ? 2 : key === 'pcp' ? 4 : 14;
};

const ALL_FIELDS: Record<FieldKey, FieldDefinition> = {
  num: {
    key: 'num', label: 'N.º na Pauta', required: true, exactOnly: true,
    aliases: ['N', 'NO', 'NUM', 'N ORDEM', 'NUMERO', 'N PAUTA', 'N DA PAUTA', 'NO PAUTA', 'NUMERO PAUTA', 'NUMERO NA PAUTA', 'NUMERO DE ORDEM', 'ORDEM', 'N ORD', 'NR']
  },
  proc: {
    key: 'proc', label: 'N.º de Processo', required: true,
    aliases: ['PROC', 'PROC ID', 'PROCESSO', 'N PROCESSO', 'NO PROCESSO', 'NUM PROCESSO', 'NUMERO PROCESSO', 'NUMERO DE PROCESSO', 'MATRICULA']
  },
  name: {
    key: 'name', label: 'Nome Completo', required: true,
    aliases: ['NOME', 'NOME ALUNO', 'NOME DO ALUNO', 'ALUNO', 'ESTUDANTE', 'NOME COMPLETO', 'NOME ESTUDANTE']
  },
  gender: { key: 'gender', label: 'Género', required: false, aliases: ['SEXO', 'GENERO', 'M F'] },
  mac: { key: 'mac', label: 'MAC', required: false, aliases: ['MAC', 'NOTA MAC', 'AVALIACAO CONTINUA', 'MEDIA AVALIACAO CONTINUA'] },
  npp: { key: 'npp', label: 'NPP', required: false, aliases: ['NPP', 'NOTA NPP', 'PROVA PARCIAL', 'NOTA PROVA PARCIAL'] },
  npt: { key: 'npt', label: 'NPT', required: false, aliases: ['NPT', 'NOTA NPT', 'PROVA TRIMESTRAL', 'NOTA PROVA TRIMESTRAL'] },
  aav: { key: 'aav', label: 'AAV', required: false, aliases: ['AAV', 'NOTA AAV', 'AUTO AVALIACAO'] },
  pcp: { key: 'pcp', label: 'PCP', required: false, aliases: ['PCP', 'NOTA PCP', 'PARTICIPACAO'] },
  nee: { key: 'nee', label: 'NEE (Exame Escrito)', required: false, aliases: ['NEE', 'NOTA NEE', 'EXAME ESCRITO'] },
  neo: { key: 'neo', label: 'NEO (Exame Oral)', required: false, aliases: ['NEO', 'NOTA NEO', 'EXAME ORAL'] },
  ner: { key: 'ner', label: 'NER (Exame de Recurso)', required: false, aliases: ['NER', 'NOTA NER', 'EXAME RECURSO', 'EXAME DE RECURSO'] }
};

export const fieldDef = (key: FieldKey, regime: PautaRegime): FieldDefinition => {
  const def = ALL_FIELDS[key];
  if (def.key === 'gender' || (['num', 'proc', 'name'] as FieldKey[]).includes(key)) return def;
  const max = gradeMax(key as GradeKey, regime);
  return { ...def, label: regime === 'eja' ? `${def.label} (0–${max})` : def.label };
};

/** Campos que o ficheiro pode trazer para esta classe, pela ordem em que aparecem. */
export function fieldsForRegime(regime: PautaRegime): FieldDefinition[] {
  const keys: FieldKey[] = ['num', 'proc', 'name', 'gender', ...GRADE_FIELDS_BY_REGIME[regime]];
  return keys.map((k) => fieldDef(k, regime));
}

export type ColumnMapping = Partial<Record<FieldKey, number>>;

export interface RawSheet {
  name: string;
  matrix: unknown[][];
}

export interface ParsedSheet {
  name: string;
  /** Cabeçalhos tal como aparecem no ficheiro. */
  headers: string[];
  /** Linhas de dados (já sem o cabeçalho). */
  rows: unknown[][];
  /** Índice (0-based) da linha do ficheiro onde o cabeçalho foi encontrado. */
  headerRowIndex: number;
}

export interface ParsedWorkbook {
  fileName: string;
  fileSizeLabel: string;
  extension: string;
  sheets: RawSheet[];
}

export type RowStatus = 'valid' | 'warning' | 'error';

export interface ImportRow {
  /** Número da linha no ficheiro original (1-based). */
  excelRow: number;
  rawNum: string;
  rawProc: string;
  rawName: string;
  grades: Partial<Record<GradeKey, number | ''>>;
  /** Pré-visualização da Média Trimestral (só informativa; o cálculo oficial é refeito ao gravar). */
  mt: number | '';
  matchedStudentId: string | null;
  matchedStudentName: string | null;
  status: RowStatus;
  messages: string[];
}

// ---------------------------------------------------------------------------
// Normalização
// ---------------------------------------------------------------------------

export function normalizeHeader(value: unknown): string {
  return String(value ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-zA-Z0-9]+/g, ' ')
    .trim()
    .toUpperCase();
}

/** Nome para comparação: sem acentos, sem diferença de maiúsculas e espaços repetidos. */
export function normalizeName(value: unknown): string {
  return String(value ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

/** Nº de processo para comparação: sem espaços; "0123" e "123" contam como iguais se forem só dígitos. */
export function normalizeProc(value: unknown): string {
  const s = String(value ?? '').replace(/\s+/g, '').toLowerCase();
  if (s === '—' || s === '-') return '';
  return /^\d+$/.test(s) ? String(parseInt(s, 10)) : s;
}

function formatSize(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

export const fileExtension = (name: string): string => (name.split('.').pop() || '').toLowerCase();

// ---------------------------------------------------------------------------
// Leitura de ficheiros (.xlsx / .csv / .txt)
// ---------------------------------------------------------------------------

/** Leitor de texto delimitado (CSV/TXT): deteta ; , tab ou | e respeita aspas. */
export function parseDelimitedText(text: string): string[][] {
  const clean = text.replace(/^﻿/, '').replace(/\r\n?/g, '\n');
  const sample = clean.split('\n').filter((l) => l.trim() !== '').slice(0, 15);
  const candidates = [';', '\t', ',', '|'];
  let delimiter = ';';
  let best = -1;
  for (const d of candidates) {
    const counts = sample.map((l) => l.split(d).length - 1);
    const total = counts.reduce((a, b) => a + b, 0);
    if (total > best) {
      best = total;
      delimiter = d;
    }
  }

  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let inQuotes = false;
  for (let i = 0; i < clean.length; i++) {
    const ch = clean[i];
    if (inQuotes) {
      if (ch === '"') {
        if (clean[i + 1] === '"') {
          cell += '"';
          i++;
        } else inQuotes = false;
      } else cell += ch;
    } else if (ch === '"') inQuotes = true;
    else if (ch === delimiter) {
      row.push(cell);
      cell = '';
    } else if (ch === '\n') {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = '';
    } else cell += ch;
  }
  row.push(cell);
  rows.push(row);
  return rows.filter((r) => r.some((c) => c.trim() !== ''));
}

function decodeText(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    // Ficheiros guardados pelo Bloco de Notas/Excel antigo em ANSI.
    return new TextDecoder('windows-1252').decode(bytes);
  }
}

export async function readSpreadsheet(file: File): Promise<ParsedWorkbook> {
  const extension = fileExtension(file.name);
  if (!(ACCEPTED_EXTENSIONS as readonly string[]).includes(extension)) {
    throw new Error('Formato não suportado. Use um ficheiro .xlsx, .csv ou .txt.');
  }
  const buffer = await file.arrayBuffer();

  let sheets: RawSheet[];
  if (extension === 'xlsx') {
    try {
      const lib = await loadXlsx();
      sheets = (await lib.read(buffer, { skipBlankRows: true })).map((sh) => ({ name: sh.name, matrix: sh.rows }));
    } catch (e) {
      if (e instanceof XlsxLimitError) throw new Error(e.message);
      throw new Error('Não foi possível abrir o ficheiro Excel (está corrompido, protegido por palavra-passe ou não é .xlsx).');
    }
  } else {
    sheets = [{ name: extension.toUpperCase(), matrix: parseDelimitedText(decodeText(buffer)) }];
  }

  return { fileName: file.name, fileSizeLabel: formatSize(file.size), extension, sheets };
}

/**
 * Encontra a linha de cabeçalho (ficheiros oficiais trazem títulos antes da tabela):
 * procura, nas primeiras 25 linhas, a que contenha mais campos conhecidos da classe.
 */
function detectHeaderRow(matrix: unknown[][], regime: PautaRegime): number {
  const fields = fieldsForRegime(regime);
  let bestIndex = 0;
  let bestScore = -1;
  const limit = Math.min(matrix.length, 25);
  for (let i = 0; i < limit; i++) {
    let score = 0;
    for (const cell of matrix[i] || []) {
      const norm = normalizeHeader(cell);
      if (norm && fields.some((f) => f.aliases.includes(norm))) score++;
    }
    if (score > bestScore) {
      bestScore = score;
      bestIndex = i;
    }
  }
  return bestScore > 0 ? bestIndex : 0;
}

export function viewSheet(raw: RawSheet, regime: PautaRegime): ParsedSheet {
  const headerRowIndex = detectHeaderRow(raw.matrix, regime);
  const headers = (raw.matrix[headerRowIndex] || []).map((h) => String(h ?? '').trim());
  const rows = raw.matrix
    .slice(headerRowIndex + 1)
    .filter((r) => (r || []).some((c) => String(c ?? '').trim() !== ''));
  return { name: raw.name, headers, rows, headerRowIndex };
}

// ---------------------------------------------------------------------------
// Mapeamento de colunas
// ---------------------------------------------------------------------------

export function autoDetectMapping(headers: string[], regime: PautaRegime): ColumnMapping {
  const normalized = headers.map(normalizeHeader);
  const fields = fieldsForRegime(regime);
  const mapping: ColumnMapping = {};
  const used = new Set<number>();

  // 1ª passagem: correspondência exata com um sinónimo conhecido.
  for (const field of fields) {
    const index = normalized.findIndex((h, i) => h && !used.has(i) && field.aliases.includes(h));
    if (index !== -1) {
      mapping[field.key] = index;
      used.add(index);
    }
  }
  // 2ª passagem: o cabeçalho contém o sinónimo (ex.: "NOTA MAC 30%"), só para siglas longas.
  for (const field of fields) {
    if (mapping[field.key] !== undefined || field.exactOnly) continue;
    const index = normalized.findIndex(
      (h, i) => h && !used.has(i) && field.aliases.some((a) => a.length >= 3 && h.includes(a))
    );
    if (index !== -1) {
      mapping[field.key] = index;
      used.add(index);
    }
  }
  return mapping;
}

export function missingRequiredFields(mapping: ColumnMapping, regime: PautaRegime): FieldDefinition[] {
  return fieldsForRegime(regime).filter((f) => f.required && mapping[f.key] === undefined);
}

export function hasAnyGradeColumn(mapping: ColumnMapping, regime: PautaRegime): boolean {
  return GRADE_FIELDS_BY_REGIME[regime].some((k) => mapping[k] !== undefined);
}

// ---------------------------------------------------------------------------
// Validação das linhas contra os alunos reais
// ---------------------------------------------------------------------------

function parseGrade(raw: unknown, max: number): { value: number | ''; error?: string } {
  const text = String(raw ?? '').trim();
  if (!text) return { value: '' };
  const num = Number(text.replace(/\s/g, '').replace(',', '.'));
  if (!Number.isFinite(num)) return { value: '', error: `valor "${text}" não é numérico` };
  if (num < 0 || num > max) return { value: '', error: `nota ${num} fora do intervalo permitido (0 a ${max})` };
  return { value: Math.round(num * 100) / 100 };
}

/** Nº do aluno na pauta = posição na lista alfabética da turma. */
export const pautaNumberOf = (classStudents: Student[], studentId: string): number =>
  classStudents.findIndex((s) => String(s.id) === String(studentId)) + 1;

export function buildImportRows(
  sheet: ParsedSheet,
  mapping: ColumnMapping,
  classStudents: Student[],
  regime: PautaRegime
): ImportRow[] {
  const byName = new Map<string, Student[]>();
  for (const st of classStudents) {
    const key = normalizeName(st.name);
    if (!key) continue;
    byName.set(key, [...(byName.get(key) || []), st]);
  }
  const gradeKeys = GRADE_FIELDS_BY_REGIME[regime].filter((k) => mapping[k] !== undefined);

  const rows: ImportRow[] = sheet.rows.map((cells, idx) => {
    const excelRow = sheet.headerRowIndex + 2 + idx;
    const get = (key: FieldKey): unknown => (mapping[key] !== undefined ? cells[mapping[key] as number] : '');

    const rawNum = String(get('num') ?? '').trim();
    const rawProc = String(get('proc') ?? '').trim();
    const rawName = String(get('name') ?? '').trim();

    const messages: string[] = [];
    let status = 'valid' as RowStatus;
    const fail = (msg: string) => {
      status = 'error';
      messages.push(msg);
    };

    // --- Notas
    const grades: ImportRow['grades'] = {};
    for (const key of gradeKeys) {
      const parsed = parseGrade(get(key), gradeMax(key, regime));
      if (parsed.error) fail(`${key.toUpperCase()}: ${parsed.error}`);
      grades[key] = parsed.value;
    }

    // --- Identidade: nome completo, Nº na pauta e Nº de processo têm de bater com o MESMO aluno.
    let matched: Student | undefined;
    if (!rawName) {
      fail('nome completo em falta');
    } else {
      const candidates = byName.get(normalizeName(rawName)) || [];
      if (candidates.length === 0) {
        const byNumber = rawNum ? classStudents[parseInt(rawNum, 10) - 1] : undefined;
        fail(
          'nome completo não existe nesta turma (tem de ser igual ao registo)' +
            (byNumber ? ` — o Nº ${rawNum} da pauta é "${byNumber.name}"` : '')
        );
      } else if (candidates.length === 1) {
        matched = candidates[0];
      } else {
        // Homónimos na turma: só o Nº de processo os distingue.
        const procMatches = candidates.filter((c) => normalizeProc(c.procNumber) === normalizeProc(rawProc));
        if (rawProc && procMatches.length === 1) matched = procMatches[0];
        else fail('existem alunos com o mesmo nome nesta turma e o n.º de processo não os distingue');
      }
    }

    if (matched) {
      const expectedNum = pautaNumberOf(classStudents, matched.id);
      if (!rawNum) fail('N.º na pauta em falta');
      else if (!/^\d+$/.test(rawNum.replace(/\.0+$/, '')) || parseInt(rawNum, 10) !== expectedNum) {
        fail(`N.º na pauta "${rawNum}" não coincide — "${matched.name}" é o Nº ${expectedNum} da pauta`);
      }

      const expectedProc = normalizeProc(matched.procNumber);
      if (normalizeProc(rawProc) !== expectedProc) {
        fail(
          rawProc
            ? `N.º de processo "${rawProc}" não coincide com o do aluno (${matched.procNumber || 'sem processo no registo'})`
            : `N.º de processo em falta (o do aluno é ${matched.procNumber})`
        );
      } else if (!expectedProc) {
        status = status === 'error' ? status : 'warning';
        messages.push('aluno sem n.º de processo no registo — confirmado só por nome e n.º na pauta');
      }
    }

    if (gradeKeys.length > 0 && gradeKeys.every((k) => grades[k] === '') && status !== 'error') {
      status = 'warning';
      messages.push('linha sem nenhuma nota — nada será alterado');
    }

    const g = (k: GradeKey) => grades[k] ?? '';
    const hasAny = gradeKeys.some((k) => !EXAM_GRADE_KEYS.includes(k) && grades[k] !== '');
    const mt = !hasAny
      ? ''
      : regime === 'eja'
      ? calculateEjaMT(g('mac'), g('npt'), g('aav'), g('pcp'))
      : calculateMT(g('mac'), g('npp'), g('npt'));

    return {
      excelRow,
      rawNum,
      rawProc,
      rawName,
      grades,
      mt,
      matchedStudentId: matched?.id ?? null,
      matchedStudentName: matched?.name ?? null,
      status,
      messages: messages.length > 0 ? messages : ['validado']
    };
  });

  // Aluno repetido no ficheiro: ambiguidade → todas as ocorrências são rejeitadas.
  const count = new Map<string, number>();
  rows.forEach((r) => r.matchedStudentId && count.set(r.matchedStudentId, (count.get(r.matchedStudentId) || 0) + 1));
  rows.forEach((r) => {
    if (r.matchedStudentId && (count.get(r.matchedStudentId) || 0) > 1) {
      r.status = 'error';
      r.messages = [...r.messages.filter((m) => m !== 'validado'), 'aluno aparece repetido no ficheiro'];
    }
  });

  return rows;
}

/** Alunos da turma que não aparecem no ficheiro — o docente deve saber disto. */
export function findMissingStudents(rows: ImportRow[], classStudents: Student[]): Student[] {
  const present = new Set(rows.map((r) => r.matchedStudentId).filter(Boolean) as string[]);
  return classStudents.filter((s) => !present.has(s.id));
}

// ---------------------------------------------------------------------------
// Fusão com a mini-pauta
// ---------------------------------------------------------------------------

export type TrimesterKey = 1 | 2 | 3;

/**
 * Escreve as notas importadas no trimestre escolhido (e as de exame, que valem para o ano),
 * apenas para linhas sem erro. Células vazias NÃO apagam notas já lançadas. As notas dos
 * outros trimestres são preservadas. MT/MFD/MF/CA são recalculados com as regras da classe.
 */
export function mergeImportIntoMiniPauta(
  existingRows: StudentMiniPautaItem[],
  classStudents: Student[],
  subjectId: string,
  importRows: ImportRow[],
  trimester: TrimesterKey,
  regime: PautaRegime,
  rules: GradeRules = DEFAULT_GRADE_RULES
): { rows: StudentMiniPautaItem[]; applied: number } {
  const existingById = new Map(existingRows.map((r) => [String(r.studentId), r]));
  const importByStudent = new Map(
    importRows.filter((r) => r.status !== 'error' && r.matchedStudentId).map((r) => [r.matchedStudentId as string, r])
  );

  let applied = 0;

  const rows = classStudents.map((st, idx) => {
    const previous = existingById.get(String(st.id));
    const { birthYear, age } = calculateBirthYearAndAge(st.birthDate);

    const base: StudentMiniPautaItem =
      previous ?? {
        id: `${st.id}-${subjectId}`,
        studentId: st.id,
        num: idx + 1,
        name: st.name || '',
        gender: normalizeGender(st.gender, st.name),
        birthYear,
        age,
        isDebtor: st.financialStatus === 'debito' || !st.isTuitionPaidCurrentMonth,
        isDesistente: false,
        isTransferido: st.status === 'transferred',
        mac1: '', npp1: '', npt1: '', mt1: '',
        mac2: '', npp2: '', npt2: '', mt2: '',
        mac3: '', npp3: '', npt3: '', mt3: '',
        mfd: '', pg: '', ca: '', obs: ''
      };

    const incoming = importByStudent.get(String(st.id));
    if (!incoming) return { ...base, num: idx + 1 };

    const updated: StudentMiniPautaItem = { ...base, num: idx + 1 };
    let touched = false;
    for (const [key, value] of Object.entries(incoming.grades) as [GradeKey, number | ''][]) {
      // Célula vazia (ou só espaços) = "sem nota": ignorada, para nunca apagar nem sobrescrever
      // uma nota já lançada. Só o zero escrito de propósito (0) é uma nota válida.
      if (typeof value !== 'number' || Number.isNaN(value)) continue;
      touched = true;
      if (EXAM_GRADE_KEYS.includes(key)) (updated as any)[key] = value;
      else (updated as any)[`${key}${trimester}`] = value; // só o trimestre escolhido
    }
    if (!touched) return updated;
    applied++;
    // Quem recebe notas reais não fica marcado como desistente por sinalizadores antigos.
    if (updated.isDesistente && st.status !== 'transferred' && st.status !== 'suspended') {
      updated.isDesistente = false;
      if (updated.obs === 'Desistente') updated.obs = '';
    }

    const calc = recomputeTrimesterRecord({ ...(updated as any), isEJA: regime === 'eja' }, rules);
    // Só a média do trimestre escolhido é atualizada; os outros trimestres ficam exatamente como estavam.
    (updated as any)[`mt${trimester}`] = (calc as any)[`mt${trimester}`];
    const mfd = calculateMFD(updated.mt1 as any, updated.mt2 as any, updated.mt3 as any, (updated as any).pg ?? '', rules);
    updated.mfd = mfd;
    updated.ca = mfd === '' ? '' : calculateCA(mfd);
    if (regime === 'exame') updated.mf = recomputeTrimesterRecord({ ...(updated as any), isEJA: false }, rules).mf;
    return updated;
  });

  return { rows, applied };
}

// ---------------------------------------------------------------------------
// Modelos para download (xlsx / csv / txt)
// ---------------------------------------------------------------------------

export type TemplateFormat = 'xlsx' | 'csv' | 'txt';

const safeName = (s: string) => s.replace(/[^\w\-]+/g, '_').slice(0, 40);

function templateMatrix(classStudents: Student[], regime: PautaRegime): (string | number)[][] {
  const gradeKeys = GRADE_FIELDS_BY_REGIME[regime];
  const header = ['N_PAUTA', 'N_PROCESSO', 'NOME_COMPLETO', 'SEXO', ...gradeKeys.map((k) => k.toUpperCase())];
  const body = classStudents.map((st, i) => [
    i + 1,
    st.procNumber || '',
    st.name || '',
    normalizeGender(st.gender, st.name),
    ...gradeKeys.map(() => '')
  ]);
  return [header, ...body];
}

function saveBlob(content: string, mime: string, fileName: string) {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

const csvCell = (v: string | number): string => {
  const s = String(v ?? '');
  return /[;"\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

/** Gera e descarrega o modelo da turma (alunos reais, por ordem alfabética = ordem da pauta). */
export async function downloadTemplateForClass(
  classStudents: Student[],
  className: string,
  subjectName: string,
  regime: PautaRegime,
  format: TemplateFormat
): Promise<void> {
  const matrix = templateMatrix(classStudents, regime);
  const base = `Modelo_Pauta_${safeName(className)}_${safeName(subjectName)}`;

  if (format === 'xlsx') {
    const lib = await loadXlsx();
    const bytes = await lib.write([{ name: 'Pauta', rows: matrix, colWidths: matrix[0].map((_, i) => (i === 2 ? 40 : i === 1 ? 14 : 10)) }]);
    saveXlsx(bytes, `${base}.xlsx`);
  } else if (format === 'csv') {
    // ';' + BOM: abre direito no Excel em português.
    saveBlob('﻿' + matrix.map((r) => r.map(csvCell).join(';')).join('\r\n'), 'text/csv;charset=utf-8', `${base}.csv`);
  } else {
    saveBlob('﻿' + matrix.map((r) => r.join('\t')).join('\r\n'), 'text/plain;charset=utf-8', `${base}.txt`);
  }
}

/** Exporta o relatório de validação da importação. */
export async function downloadValidationReport(rows: ImportRow[], fileName: string, regime: PautaRegime): Promise<void> {
  const gradeKeys = GRADE_FIELDS_BY_REGIME[regime];
  const header = [
    'Linha', 'N_Pauta_Ficheiro', 'Processo_Ficheiro', 'Nome_Ficheiro', 'Aluno_Emparelhado',
    ...gradeKeys.map((k) => k.toUpperCase()), 'MT', 'Estado', 'Observacoes'
  ];
  const body = rows.map((r) => [
    r.excelRow, r.rawNum, r.rawProc, r.rawName, r.matchedStudentName || '',
    ...gradeKeys.map((k) => r.grades[k] ?? ''),
    r.mt,
    r.status === 'valid' ? 'Válido' : r.status === 'warning' ? 'Aviso' : 'Erro',
    r.messages.join(' | ')
  ]);
  const lib = await loadXlsx();
  const bytes = await lib.write([{ name: 'Validacao', rows: [header, ...body] }]);
  saveXlsx(bytes, `Auditoria_${fileName.replace(/\.[^.]+$/, '')}.xlsx`);
}
