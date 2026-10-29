import { classAllowsRecurso, hasThirdTrimesterGrade } from './recursoRules';
import { sortByName } from './alphabetical';
import { Student, ClassRoom, Subject } from '../types';
import { StudentMiniPautaItem, StudentPautaGeralItem, StudentSubjectDisciplineGrades } from '../types/pauta';
import { isKeySubjectFor } from './keySubjects';

/**
 * Calculates birth year and current age from various birthDate string formats
 */
export function calculateBirthYearAndAge(
  birthDateStr?: string,
  // Ano de referência para o cálculo da idade: por omissão o ano civil corrente, nunca
  // um ano fixo no código (estava 2025, o que envelhecia mal a cada ano letivo novo).
  referenceYear = new Date().getFullYear()
): { birthYear: number | string; age: number | string } {
  if (!birthDateStr) return { birthYear: '-', age: '-' };

  let year: number | null = null;
  const trimmed = birthDateStr.trim();

  // Try DD/MM/YYYY or DD-MM-YYYY
  if (trimmed.includes('/') || trimmed.includes('-')) {
    const delimiter = trimmed.includes('/') ? '/' : '-';
    const parts = trimmed.split(delimiter);
    if (parts.length === 3) {
      if (parts[2].length === 4) {
        year = parseInt(parts[2], 10);
      } else if (parts[0].length === 4) {
        year = parseInt(parts[0], 10);
      }
    }
  }

  // Fallback to match 4 consecutive digits (e.g. 2007)
  if (!year || isNaN(year)) {
    const match = trimmed.match(/(19\d\d|20\d\d)/);
    if (match) {
      year = parseInt(match[1], 10);
    }
  }

  if (year && !isNaN(year) && year > 1920 && year <= referenceYear) {
    return {
      birthYear: year,
      age: Math.max(0, referenceYear - year)
    };
  }

  return { birthYear: '-', age: '-' };
}

/**
 * Normalizes gender to standard 'M' or 'F'
 */
export function normalizeGender(gender?: string, studentName?: string): 'M' | 'F' {
  if (gender) {
    const g = gender.trim().toUpperCase();
    if (g.startsWith('F') || g === 'FEMININO' || g === 'MULHER') return 'F';
    if (g.startsWith('M') || g === 'MASCULINO' || g === 'HOMEM') return 'M';
  }

  // Common Portuguese/Angolan feminine first names heuristic if gender is not specified
  if (studentName) {
    const firstName = studentName.trim().split(' ')[0].toLowerCase();
    const feminineEndings = ['a', 'ia', 'ina', 'da', 'ete', 'ice'];
    const feminineNames = ['maria', 'ana', 'beatriz', 'adelaide', 'albertina', 'amelia', 'anastacia', 'arelinha', 'arminda', 'teresa', 'claudia', 'eunice', 'nair'];
    if (feminineNames.includes(firstName) || feminineEndings.some(e => firstName.endsWith(e))) {
      return 'F';
    }
  }

  return 'M';
}

/**
 * Regras de Notas & Escala configuráveis em Configurações > Regras & Escala de Notas
 * (aba TabRegrasNotas). Isto é o "contrato" entre essa aba e todos os locais do
 * sistema que fazem cálculos de notas (Pautas, Mini-Pautas, Boletim). Antes, os
 * pesos e limiares estavam fixos no código (30/30/40, >=10, >=7, >=14...) e a aba
 * de configurações não tinha qualquer efeito real fora de si própria.
 */
export interface GradeRules {
  /** Peso da Avaliação Contínua (MAC), em percentagem 0-100 */
  macWeight: number;
  /** Peso da Prova Parcelar (NPP/PP), em percentagem 0-100 */
  ppWeight: number;
  /** Peso da Prova Trimestral (NPT/PT), em percentagem 0-100 */
  ptWeight: number;
  /** Nota mínima (0-20) para Transição Direta / Aprovação sem exame */
  passingGrade: number;
  /** Nota mínima (0-20) para ser elegível a Exame de Recurso (abaixo disto é reprovação direta) */
  recursoMinGrade: number;
  /** Classificação Anual Provisória (CAP) mínima para dispensa de Exame Final */
  examWaiverGrade: number;
  /** Aceita apenas notas com 1 casa decimal (ex: 14.5) */
  strictDecimal: boolean;
  /** Arredondamento oficial: médias com centésimas >= 0.50 arredondam para cima */
  roundHalfUp: boolean;
  /** 6.ª e 9.ª classes: máximo de negativas (excepto disciplinas chave) para ainda ter direito a Recurso */
  maxNegativasRecurso6e9: number;
  /** 12.ª e 13.ª classes: máximo de negativas (excepto disciplinas chave do curso) para ainda ter direito a Recurso */
  maxNegativasRecurso12e13: number;
  /** Percentagem máxima de faltas injustificadas antes de reprovar por faltas (conselho de turma). */
  maxAbsencePercent: number;
}

export const DEFAULT_GRADE_RULES: GradeRules = {
  macWeight: 30,
  ppWeight: 30,
  ptWeight: 40,
  passingGrade: 10.0,
  recursoMinGrade: 7.0,
  examWaiverGrade: 14.0,
  strictDecimal: true,
  roundHalfUp: true,
  maxNegativasRecurso6e9: 2,
  maxNegativasRecurso12e13: 4,
  maxAbsencePercent: 25
};

/**
 * Normaliza o objeto `settings.gradeRules` (que pode ter nomes de campos legados,
 * ver o `[key: string]: any` em InstitutionSettings) para o formato de `GradeRules`
 * usado pelas funções de cálculo, preenchendo com a norma oficial MED quando um
 * campo não foi configurado.
 */
export function normalizeGradeRules(raw?: Partial<GradeRules> & Record<string, any> | null): GradeRules {
  if (!raw) return { ...DEFAULT_GRADE_RULES };
  return {
    macWeight: typeof raw.macWeight === 'number' ? raw.macWeight : DEFAULT_GRADE_RULES.macWeight,
    ppWeight: typeof raw.ppWeight === 'number' ? raw.ppWeight : DEFAULT_GRADE_RULES.ppWeight,
    ptWeight: typeof raw.ptWeight === 'number' ? raw.ptWeight : DEFAULT_GRADE_RULES.ptWeight,
    passingGrade: typeof raw.passingGrade === 'number' ? raw.passingGrade : DEFAULT_GRADE_RULES.passingGrade,
    recursoMinGrade: typeof raw.recursoMinGrade === 'number' ? raw.recursoMinGrade : DEFAULT_GRADE_RULES.recursoMinGrade,
    examWaiverGrade: typeof raw.examWaiverGrade === 'number' ? raw.examWaiverGrade : DEFAULT_GRADE_RULES.examWaiverGrade,
    strictDecimal: typeof raw.strictDecimal === 'boolean' ? raw.strictDecimal : (raw.strictDecimals ?? DEFAULT_GRADE_RULES.strictDecimal),
    roundHalfUp: typeof raw.roundHalfUp === 'boolean' ? raw.roundHalfUp : (raw.roundRuleHalfUp ?? DEFAULT_GRADE_RULES.roundHalfUp),
    maxNegativasRecurso6e9:
      typeof raw.maxNegativasRecurso6e9 === 'number' ? raw.maxNegativasRecurso6e9 : DEFAULT_GRADE_RULES.maxNegativasRecurso6e9,
    maxNegativasRecurso12e13:
      typeof raw.maxNegativasRecurso12e13 === 'number' ? raw.maxNegativasRecurso12e13 : DEFAULT_GRADE_RULES.maxNegativasRecurso12e13,
    maxAbsencePercent:
      typeof raw.maxAbsencePercent === 'number' && raw.maxAbsencePercent > 0 && raw.maxAbsencePercent <= 100
        ? raw.maxAbsencePercent
        : DEFAULT_GRADE_RULES.maxAbsencePercent
  };
}

function roundGrade(value: number, rules: GradeRules): number {
  // Arredondamento oficial MED: centésimas >= 0.50 sobem ao valor inteiro acima.
  // Quando desligado nas Configurações, simplesmente trunca a parte decimal.
  return rules.roundHalfUp ? Math.round(value) : Math.trunc(value);
}

/**
 * Quais avaliações (MAC, NPP, NPT) estão activas (marcadas) na Mini-Pauta.
 * Uma avaliação desmarcada significa que o professor não realizou essa prova,
 * por isso não conta para a média do trimestre.
 */
export interface EnabledEvaluations {
  MAC: boolean;
  NPP: boolean;
  NPT: boolean;
}

/**
 * Calculates Trimester Average (MT) from MAC, NPP, NPT.
 *
 * Regra: MT = (soma das avaliações que contam) / (quantidade de avaliações que contam).
 *  - MAC + NPP + NPT lançadas  -> (MAC+NPP+NPT)/3
 *  - falta uma (ex.: MAC)       -> (NPP+NPT)/2
 *  - faltam duas (ex.: MAC,NPP) -> NPT/1
 * Uma avaliação NÃO conta quando está vazia (sem nota de 0 a 20) ou quando está
 * desmarcada (parâmetro `enabled`). A nota 0 lançada é uma nota válida e conta.
 * O parâmetro `rules` mantém-se apenas para o arredondamento.
 */
export function calculateMT(
  mac: number | '',
  npp: number | '',
  npt: number | '',
  rules: GradeRules = DEFAULT_GRADE_RULES,
  enabled?: Partial<EnabledEvaluations>
): number | '' {
  const values: number[] = [];
  if (enabled?.MAC !== false && typeof mac === 'number' && !isNaN(mac)) values.push(mac);
  if (enabled?.NPP !== false && typeof npp === 'number' && !isNaN(npp)) values.push(npp);
  if (enabled?.NPT !== false && typeof npt === 'number' && !isNaN(npt)) values.push(npt);

  if (values.length === 0) return '';

  const avg = values.reduce((acc, v) => acc + v, 0) / values.length;
  return Math.max(0, Math.min(20, roundGrade(avg, rules)));
}

/**
 * Calculates Final Discipline Average (MFD) from MT1, MT2, MT3 (and optionally PG)
 */
export function calculateMFD(
  mt1: number | '',
  mt2: number | '',
  mt3: number | '',
  pg?: number | '',
  rules: GradeRules = DEFAULT_GRADE_RULES
): number | '' {
  const grades = [mt1, mt2, mt3].filter((g): g is number => typeof g === 'number');
  if (grades.length === 0) return '';

  const avgContinuos = grades.reduce((acc, curr) => acc + curr, 0) / grades.length;

  if (typeof pg === 'number' && pg >= 0) {
    // With Global Exam: 60% continuous + 40% PG
    return Math.max(0, Math.min(20, roundGrade((avgContinuos * 0.6) + (pg * 0.4), rules)));
  }

  return Math.max(0, Math.min(20, roundGrade(avgContinuos, rules)));
}

/**
 * Calculates Annual Classification (CA)
 * Scale typically 1 to 5 or qualitative level matching Angolan technical high school
 */
export function calculateCA(mfd: number | ''): number | '' {
  if (typeof mfd !== 'number') return '';
  if (mfd >= 17) return 5;
  if (mfd >= 14) return 4;
  if (mfd >= 10) return 3;
  if (mfd >= 7) return 2;
  return 1;
}

/**
 * Regime de avaliação de uma classe:
 *  - 'exame'     : 6.ª, 9.ª, 12.ª e 13.ª classes (têm NEE/NEO e Exame de Recurso);
 *  - 'eja'       : Educação de Jovens e Adultos (MAC/NPT/Subtotal/AAV/PCP);
 *  - 'transicao' : todas as restantes (transição directa, sem exame nem recurso).
 */
export type PautaRegime = 'transicao' | 'exame' | 'eja';

const EXAM_CLASS_NUMBERS = new Set([6, 9, 12, 13]);

/** EJA: reconhecido pelo texto da classe, da turma ou do curso/área ("I Ano EJA", "EJA"...). */
export function isEJAClass(...labels: Array<string | null | undefined>): boolean {
  return labels.some((l) => !!l && /\beja\b|jovens\s+e\s+adultos/i.test(String(l)));
}

/** Classes de exame do sistema angolano: 6.ª, 9.ª, 12.ª e 13.ª (nunca o EJA). */
export function isExamClass(gradeOrClassLabel?: string | null): boolean {
  if (!gradeOrClassLabel) return false;
  const label = String(gradeOrClassLabel);
  if (isEJAClass(label)) return false;
  if (!/classe/i.test(label)) return false;
  const m = label.match(/(\d+)/);
  return !!m && EXAM_CLASS_NUMBERS.has(parseInt(m[1], 10));
}

export function getPautaRegime(
  grade?: string | null,
  ...otherLabels: Array<string | null | undefined>
): PautaRegime {
  if (isEJAClass(grade, ...otherLabels)) return 'eja';
  return isExamClass(grade) ? 'exame' : 'transicao';
}

export type PautaSituation = 'PENDENTE' | 'APROVADO' | 'REPROVADO' | 'DESISTIDO' | 'RECURSO' | 'TRANSFERIDO';

/**
 * Situação do aluno numa disciplina (Mini-Pauta) ou numa nota única:
 *  - Sem qualquer nota lançada ainda -> PENDENTE (nunca "Apto" por omissão).
 *  - Transferido (saiu por transferência; mantém as notas lançadas até aí) -> TRANSFERIDO.
 *  - Desistente -> DESISTIDO.
 *  - Classe de exame com NER (Exame de Recurso) lançado -> NER >= passingGrade APROVADO, senão REPROVADO.
 *  - Nota >= passingGrade (norma MED: 10.0) -> APROVADO.
 *  - Nota entre recursoMinGrade e passingGrade (norma MED: 7.0 a 9.9) -> RECURSO, mas APENAS nas
 *    classes de exame (6.ª, 9.ª, 12.ª, 13.ª) e APENAS em disciplinas que NÃO são chave.
 *  - Qualquer outro caso abaixo de passingGrade -> REPROVADO. As classes de transição nunca têm recurso.
 */
export function calculateSituation(params: {
  finalGrade: number | '';
  hasAnyGrade: boolean;
  isDesistente: boolean;
  /** Saiu por transferência: a situação é TRANSFERIDO, sem apurar aprovação. */
  isTransferido?: boolean;
  classGrade?: string | null;
  rules?: GradeRules;
  /** Disciplina chave (do subsistema/curso): não tem direito a Recurso. */
  isKeySubject?: boolean;
  /** Nota do Exame de Recurso, se já lançada. */
  ner?: number | '';
  /**
   * Há direito a Recurso? (false => negativa = REPROVADO). Falso quando o III Trimestre ainda não
   * tem nota (negativa só nos I/II) ou quando a duração do curso não prevê Recurso nesta classe
   * (curso de 4 anos: só 13.ª; curso de 3 anos: só 12.ª). Por omissão: true.
   */
  recursoAllowed?: boolean;
}): PautaSituation {
  const { finalGrade, hasAnyGrade, isDesistente, isTransferido = false, classGrade, rules = DEFAULT_GRADE_RULES, isKeySubject = false, ner = '', recursoAllowed = true } = params;

  if (isTransferido) return 'TRANSFERIDO';
  if (isDesistente) return 'DESISTIDO';
  if (!hasAnyGrade || typeof finalGrade !== 'number') return 'PENDENTE';

  const exam = isExamClass(classGrade);

  if (finalGrade >= rules.passingGrade) return 'APROVADO';

  if (exam && recursoAllowed && !isKeySubject && finalGrade >= rules.recursoMinGrade) {
    if (typeof ner === 'number') return ner >= rules.passingGrade ? 'APROVADO' : 'REPROVADO';
    return 'RECURSO';
  }

  return 'REPROVADO';
}

/** Máximo de negativas (fora disciplinas chave) que ainda dão direito a Recurso nesta classe de exame. */
export function getMaxNegativasRecurso(classGrade: string | null | undefined, rules: GradeRules): number {
  const m = String(classGrade || '').match(/(\d+)/);
  const n = m ? parseInt(m[1], 10) : 0;
  return n === 12 || n === 13 ? rules.maxNegativasRecurso12e13 : rules.maxNegativasRecurso6e9;
}

export interface ExamPautaSubjectInput {
  /** Nota decisiva da disciplina: MF se houver exame lançado, senão MFD. */
  grade: number | '';
  isKey: boolean;
  ner?: number | '';
  /** MT3 da disciplina: sem nota no III Trimestre, a negativa não dá Recurso (REPROVADO). */
  mt3?: number | '';
}

/**
 * Situação do aluno na PAUTA FINAL de uma classe de exame (6.ª, 9.ª, 12.ª, 13.ª):
 *  - disciplina chave negativa -> REPROVADO (chave não tem recurso);
 *  - disciplina não chave abaixo do mínimo de recurso -> REPROVADO;
 *  - negativas não chave dentro do intervalo de recurso: até ao limite (6.ª/9.ª: 2; 12.ª/13.ª: 4) -> RECURSO;
 *    acima do limite -> REPROVADO;
 *  - com NER lançado em cada disciplina em recurso, passa a APROVADO (todas >= nota de aprovação) ou REPROVADO.
 */
export function calculateExamPautaSituation(params: {
  subjects: ExamPautaSubjectInput[];
  isDesistente: boolean;
  isTransferido?: boolean;
  classGrade?: string | null;
  rules?: GradeRules;
  /** Duração do curso (anos): 4 => Recurso só na 13.ª; 3 => só na 12.ª. */
  courseDurationYears?: number;
}): PautaSituation {
  const { subjects, isDesistente, isTransferido = false, classGrade, rules = DEFAULT_GRADE_RULES, courseDurationYears } = params;
  const classAllows = classAllowsRecurso(classGrade, courseDurationYears);
  if (isTransferido) return 'TRANSFERIDO';
  if (isDesistente) return 'DESISTIDO';
  const graded = subjects.filter((s) => typeof s.grade === 'number');
  if (graded.length === 0) return 'PENDENTE';

  const limit = getMaxNegativasRecurso(classGrade, rules);
  let recursoEligible = 0; // negativas não chave dentro do intervalo de recurso
  let unresolved = 0;

  for (const s of graded) {
    const g = s.grade as number;
    if (g >= rules.passingGrade) continue;
    if (s.isKey) return 'REPROVADO';
    if (g < rules.recursoMinGrade) return 'REPROVADO';
    // Recurso só com negativa no III Trimestre e só na classe prevista pela duração do curso.
    if (!classAllows || !hasThirdTrimesterGrade(s.mt3)) return 'REPROVADO';
    recursoEligible += 1;
    if (typeof s.ner === 'number') {
      if (s.ner < rules.passingGrade) return 'REPROVADO';
    } else {
      unresolved += 1;
    }
  }

  if (recursoEligible > limit) return 'REPROVADO';
  return unresolved > 0 ? 'RECURSO' : 'APROVADO';
}

// -----------------------------------------------------------------------------------
// CLASSES DE EXAME: NEE (exame escrito), NEO (exame oral), NER (exame de recurso)
// -----------------------------------------------------------------------------------

export interface EnabledExamParts {
  NEE: boolean;
  NEO: boolean;
}

/** Peso da média contínua (MFD) e do exame na nota final de uma classe de exame. */
export const EXAM_MFD_WEIGHT = 0.6;
export const EXAM_PART_WEIGHT = 0.4;

/**
 * Parte do exame = média das componentes do exame que contam (NEE e NEO). Uma componente
 * vazia ou desmarcada não conta — a mesma regra aplicada na MT.
 */
export function calculateExamPart(
  nee: number | '',
  neo: number | '',
  enabled?: Partial<EnabledExamParts>
): number | '' {
  const values: number[] = [];
  if (enabled?.NEE !== false && typeof nee === 'number' && !isNaN(nee)) values.push(nee);
  if (enabled?.NEO !== false && typeof neo === 'number' && !isNaN(neo)) values.push(neo);
  if (values.length === 0) return '';
  return values.reduce((a, b) => a + b, 0) / values.length;
}

/**
 * Nota final da disciplina numa classe de exame: MF = MFD×60% + Exame×40%.
 * Sem nenhuma componente de exame lançada/marcada, MF fica vazio (ainda só existe a MFD).
 */
export function calculateExamMF(
  mfd: number | '',
  nee: number | '',
  neo: number | '',
  rules: GradeRules = DEFAULT_GRADE_RULES,
  enabled?: Partial<EnabledExamParts>
): number | '' {
  if (typeof mfd !== 'number') return '';
  const exam = calculateExamPart(nee, neo, enabled);
  if (typeof exam !== 'number') return '';
  return Math.max(0, Math.min(20, roundGrade(mfd * EXAM_MFD_WEIGHT + exam * EXAM_PART_WEIGHT, rules)));
}

// -----------------------------------------------------------------------------------
// EJA: MAC (0-14), NPT (0-14), Subtotal, AAV (0-2), PCP (0-4), MT = Subtotal + AAV + PCP
// -----------------------------------------------------------------------------------

export const EJA_LIMITS = { MAC: 14, NPT: 14, AAV: 2, PCP: 4 } as const;

export interface EnabledEjaParts {
  MAC: boolean;
  NPT: boolean;
  AAV: boolean;
  PCP: boolean;
}

function clampTo(value: number, max: number): number {
  return Math.max(0, Math.min(max, value));
}

/**
 * Subtotal = (MAC + NPT) / 2, só com as avaliações lançadas e marcadas (a mesma regra
 * da MT: vazia ou desmarcada não conta). Máximo 14.
 */
export function calculateEjaSubtotal(
  mac: number | '',
  npt: number | '',
  enabled?: Partial<EnabledEjaParts>
): number | '' {
  const values: number[] = [];
  if (enabled?.MAC !== false && typeof mac === 'number' && !isNaN(mac)) values.push(clampTo(mac, EJA_LIMITS.MAC));
  if (enabled?.NPT !== false && typeof npt === 'number' && !isNaN(npt)) values.push(clampTo(npt, EJA_LIMITS.NPT));
  if (values.length === 0) return '';
  return values.reduce((a, b) => a + b, 0) / values.length;
}

/** MT do EJA = Subtotal + AAV + PCP (máximo 14 + 2 + 4 = 20), sem arredondar. */
export function calculateEjaMT(
  mac: number | '',
  npt: number | '',
  aav: number | '',
  pcp: number | '',
  rules: GradeRules = DEFAULT_GRADE_RULES,
  enabled?: Partial<EnabledEjaParts>
): number | '' {
  const subtotal = calculateEjaSubtotal(mac, npt, enabled);
  const parts: number[] = [];
  if (typeof subtotal === 'number') parts.push(subtotal);
  if (enabled?.AAV !== false && typeof aav === 'number' && !isNaN(aav)) parts.push(clampTo(aav, EJA_LIMITS.AAV));
  if (enabled?.PCP !== false && typeof pcp === 'number' && !isNaN(pcp)) parts.push(clampTo(pcp, EJA_LIMITS.PCP));
  if (parts.length === 0) return '';
  // A MT do EJA mantém as centésimas (ex.: 13,50; 17,25); só a MFD é arredondada.
  return Math.max(0, Math.min(20, Math.round(parts.reduce((a, b) => a + b, 0) * 100) / 100));
}

/**
 * Recalcula MT1/MT2/MT3/MFD (e, nas classes de exame, MF) de um registo guardado de
 * notas de disciplina, respeitando a estrutura do EJA (que não usa NPP).
 */
export function recomputeTrimesterRecord(
  rec: {
    mac1?: number | ''; npp1?: number | ''; npt1?: number | ''; aav1?: number | ''; pcp1?: number | '';
    mac2?: number | ''; npp2?: number | ''; npt2?: number | ''; aav2?: number | ''; pcp2?: number | '';
    mac3?: number | ''; npp3?: number | ''; npt3?: number | ''; aav3?: number | ''; pcp3?: number | '';
    pg?: number | ''; nee?: number | ''; neo?: number | ''; isEJA?: boolean;
    origemNota?: string; mt1?: number | ''; mt2?: number | ''; mt3?: number | ''; mfd?: number | '';
  },
  rules: GradeRules = DEFAULT_GRADE_RULES
): { mt1: number | ''; mt2: number | ''; mt3: number | ''; mfd: number | ''; mf: number | '' } {
  const imp = isImportedGradeRecord(rec);
  const keep = (computed: number | '', stored: unknown): number | '' =>
    computed === '' && imp && isImportedPositive(stored) ? (stored as number) : computed;
  const mt = (mac: any, npp: any, npt: any, aav: any, pcp: any) =>
    rec.isEJA ? calculateEjaMT(mac ?? '', npt ?? '', aav ?? '', pcp ?? '', rules) : calculateMT(mac ?? '', npp ?? '', npt ?? '', rules);
  const mt1 = keep(mt(rec.mac1, rec.npp1, rec.npt1, rec.aav1, rec.pcp1), rec.mt1);
  const mt2 = keep(mt(rec.mac2, rec.npp2, rec.npt2, rec.aav2, rec.pcp2), rec.mt2);
  const mt3 = keep(mt(rec.mac3, rec.npp3, rec.npt3, rec.aav3, rec.pcp3), rec.mt3);
  const mfd = keep(calculateMFD(mt1, mt2, mt3, rec.pg ?? '', rules), rec.mfd);
  const mf = calculateExamMF(mfd, rec.nee ?? '', rec.neo ?? '', rules);
  return { mt1, mt2, mt3, mfd, mf };
}

/**
 * Standard authentic student dataset matching Image 2
 */
export const IMAGE_2_STUDENTS_SEED: Array<Partial<StudentMiniPautaItem>> = [
  {
    num: 1,
    name: 'Abel Capusso Vissapa Sabino',
    gender: 'M',
    mac1: 9, npp1: 12, npt1: 10, mt1: 10,
    mac2: 8, npp2: 12, npt2: 9, mt2: 10,
    mac3: 5, npp3: 9, npt3: 12, mt3: 9,
    mfd: 10, pg: '', ca: 4, obs: ''
  },
  {
    num: 2,
    name: 'Adelaide Evalina Cafeca',
    gender: 'F',
    mac1: 5, npp1: 5, npt1: 4, mt1: 5,
    mac2: 10, npp2: 5, npt2: 6, mt2: 7,
    mac3: 8, npp3: 10, npt3: 8, mt3: 9,
    mfd: 7, pg: '', ca: 3, obs: ''
  },
  {
    num: 3,
    name: 'Albertina Nanguelo Syei',
    gender: 'F',
    mac1: 7, npp1: 10, npt1: 3, mt1: 7,
    mac2: 10, npp2: 10, npt2: 9, mt2: 10,
    mac3: 18, npp3: 10, npt3: 9, mt3: 12,
    mfd: 10, pg: '', ca: 4, obs: ''
  },
  {
    num: 4,
    name: 'Amelia Namilitali Furtoso',
    gender: 'F',
    isDesistente: true,
    mac1: '', npp1: '', npt1: '', mt1: '',
    mac2: '', npp2: '', npt2: '', mt2: '',
    mac3: '', npp3: '', npt3: '', mt3: '',
    mfd: '', pg: '', ca: '', obs: 'Desistente'
  },
  {
    num: 5,
    name: 'Anastácia Maria Nachilombo',
    gender: 'F',
    isDesistente: true,
    mac1: '', npp1: '', npt1: '', mt1: '',
    mac2: '', npp2: '', npt2: '', mt2: '',
    mac3: '', npp3: '', npt3: '', mt3: '',
    mfd: '', pg: '', ca: '', obs: 'Desistente'
  },
  {
    num: 6,
    name: 'André Samanjata Nandala',
    gender: 'M',
    mac1: 8, npp1: 11, npt1: 6, mt1: 8,
    mac2: 11, npp2: 12, npt2: 6, mt2: 10,
    mac3: 10, npp3: 12, npt3: 10, mt3: 11,
    mfd: 10, pg: '', ca: 4, obs: ''
  },
  {
    num: 7,
    name: 'Apolo Kassicote Chapopia',
    gender: 'M',
    mac1: 5, npp1: 6, npt1: 3, mt1: 5,
    mac2: 5, npp2: 8, npt2: 5, mt2: 6,
    mac3: 8, npp3: 10, npt3: 8, mt3: 9,
    mfd: 6, pg: '', ca: 3, obs: ''
  },
  {
    num: 8,
    name: 'Arelinha Sitati Baptista Lucas',
    gender: 'F',
    mac1: 5, npp1: 5, npt1: 5, mt1: 5,
    mac2: 5, npp2: 6, npt2: 7, mt2: 6,
    mac3: 5, npp3: 8, npt3: 6, mt3: 6,
    mfd: 6, pg: '', ca: 2, obs: ''
  },
  {
    num: 9,
    name: 'Arminda Ng. C. Siliveli',
    gender: 'F',
    mac1: 7, npp1: 10, npt1: 5, mt1: 7,
    mac2: 10, npp2: 15, npt2: 10, mt2: 12,
    mac3: 5, npp3: 12, npt3: 12, mt3: 10,
    mfd: 10, pg: '', ca: 4, obs: ''
  },
  {
    num: 10,
    name: 'Aurélio Sambulungo Felix',
    gender: 'M',
    mac1: 5, npp1: 5, npt1: 6, mt1: 5,
    mac2: 10, npp2: 6, npt2: 9, mt2: 8,
    mac3: 18, npp3: 13, npt3: 9, mt3: 13,
    mfd: 9, pg: '', ca: 4, obs: ''
  }
];

/** Quais componentes de nota estão marcadas (contam) na Mini-Pauta, em qualquer regime. */
export interface EnabledGradeParts {
  MAC: boolean; NPP: boolean; NPT: boolean;
  NEE: boolean; NEO: boolean; NER: boolean;
  AAV: boolean; PCP: boolean;
}

export const ALL_PARTS_ENABLED: EnabledGradeParts = {
  MAC: true, NPP: true, NPT: true, NEE: true, NEO: true, NER: true, AAV: true, PCP: true
};

export interface MiniPautaCalcContext {
  regime: PautaRegime;
  classGrade?: string | null;
  /** A disciplina é chave para esta classe/curso? (sem direito a Recurso) */
  isKeySubject?: boolean;
  rules: GradeRules;
  enabled?: Partial<EnabledGradeParts>;
  /** Duração do curso (anos) da turma: 4 => Recurso só na 13.ª; 3 => só na 12.ª. */
  courseDurationYears?: number;
}

// ---------------------------------------------------------------------------
// SITUAÇÃO DO ALUNO NAS PAUTAS (Desistente / Transferido)
//  - Transferido: matrícula transferida (aluno Inactivo, status 'transferred'). Fica na pauta com
//    as notas lançadas até ao momento e situação TRANSFERIDO.
//  - Desistente:
//      · aluno Inactivo com matrícula CANCELADA (status 'suspended') SEM nota nos campos
//        habilitados para o professor lançar; ou
//      · aluno sem nota no I e no II trimestres (regra só activa quando o III trimestre está em
//        curso/lançado, para não marcar toda a turma no início do ano).
//  A fonte é sempre a ficha do aluno (status) + as notas reais: nunca um sinalizador gravado.
// ---------------------------------------------------------------------------
export type StudentExitKind = 'transferido' | 'cancelado' | null;

export function studentExitKind(st: { status?: string }): StudentExitKind {
  if (st.status === 'transferred') return 'transferido';
  if (st.status === 'suspended') return 'cancelado';
  return null;
}

export interface GradeEvidence {
  /** Há nota lançada em algum campo habilitado (qualquer trimestre/exame/PG). */
  any: boolean;
  /** Há nota no I ou no II trimestre. */
  t12: boolean;
  /** Há nota no III trimestre. */
  t3: boolean;
}

const isGradeNum = (v: unknown): boolean => typeof v === 'number' && Number.isFinite(v);

// NOTAS IMPORTADAS (transferência de outra escola / equivalência): só trazem médias (MT1/MT2/MT3 ou MFD),
// sem MAC/NPP/NPT. Valem até o professor lançar avaliações próprias no trimestre.
export function isImportedGradeRecord(rec: unknown): boolean {
  const o = (rec as { origemNota?: string } | null | undefined)?.origemNota;
  return o === 'Transferência' || o === 'Equivalência';
}
export const isImportedPositive = (v: unknown): boolean => typeof v === 'number' && Number.isFinite(v) && v > 0;
const normSubjectName = (s?: string): string =>
  String(s ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

/** Registo trimestral do aluno para uma disciplina: por id e, se falhar, pelo nome (sem acentos/maiúsculas). */
export function findStudentSubjectRecord<T extends { subjectId?: string; subjectName?: string }>(
  st: { trimesterGrades?: T[] }, subjectId: string, subjectName?: string
): T | undefined {
  const recs = st.trimesterGrades || [];
  const byId = recs.find((tg) => String(tg.subjectId) === String(subjectId));
  if (byId) return byId;
  const key = normSubjectName(subjectName);
  return key ? recs.find((tg) => normSubjectName(tg.subjectName) === key) : undefined;
}

/** Médias importadas de um registo (ou null se não for importado / sem médias). */
export function importedAveragesOf(rec: any): { mts: [number | '', number | '', number | '']; mfd: number | '' } | null {
  if (!isImportedGradeRecord(rec)) return null;
  const pick = (v: unknown): number | '' => (isImportedPositive(v) ? (v as number) : '');
  const mts: [number | '', number | '', number | ''] = [pick(rec.mt1), pick(rec.mt2), pick(rec.mt3)];
  const mfd = pick(rec.mfd);
  if (mts.every((m) => m === '') && mfd === '') return null;
  return { mts, mfd };
}

/** A linha tem avaliações próprias (MAC/NPP/NPT/AAV/PCP) no trimestre t? */
export function rowHasOwnTrimesterGrades(row: Record<string, any>, t: 1 | 2 | 3): boolean {
  return ['mac', 'npp', 'npt', 'aav', 'pcp'].some((p) => isGradeNum(row?.[`${p}${t}`]));
}

/**
 * Procura notas LANÇADAS (MAC/NPP/NPT/AAV/PCP por trimestre; NEE/NEO/NER/PG no final) nos campos
 * habilitados. Só olha para as componentes lançadas — nunca para MT/MFD, que podem ter valores
 * por omissão gravados.
 */
export function gradeEvidenceOf(
  records: Array<Record<string, any> | null | undefined>,
  enabled?: Partial<EnabledGradeParts>
): GradeEvidence {
  const en = { ...ALL_PARTS_ENABLED, ...(enabled || {}) };
  const parts: Array<[string, boolean]> = [
    ['mac', en.MAC], ['npp', en.NPP], ['npt', en.NPT], ['aav', en.AAV], ['pcp', en.PCP]
  ];
  const finals: Array<[string, boolean]> = [['nee', en.NEE], ['neo', en.NEO], ['ner', en.NER], ['pg', true]];
  const out: GradeEvidence = { any: false, t12: false, t3: false };
  for (const rec of records) {
    if (!rec) continue;
    for (const t of [1, 2, 3] as const) {
      for (const [prefix, on] of parts) {
        if (on && isGradeNum(rec[`${prefix}${t}`])) {
          out.any = true;
          // Um 0 no III trimestre não prova que ele foi lançado (registos antigos foram gravados com
          // zeros automáticos): só notas > 0 ativam a regra "sem notas no I e II trimestres".
          if (t === 3) { if (rec[`${prefix}${t}`] > 0) out.t3 = true; }
          else out.t12 = true;
        }
      }
    }
    for (const [f, on] of finals) if (on && isGradeNum(rec[f])) out.any = true;
    const imp = importedAveragesOf(rec);
    if (imp) {
      if (imp.mts[0] !== '' || imp.mts[1] !== '') { out.any = true; out.t12 = true; }
      if (imp.mts[2] !== '') { out.any = true; out.t3 = true; }
      if (imp.mfd !== '' && rec.origemNota === 'Equivalência') { out.any = true; out.t12 = true; out.t3 = true; }
    }
  }
  return out;
}

/** Evidência de notas de UM aluno: todas as disciplinas já gravadas + linhas ainda em edição. */
export function studentGradeEvidence(
  st: { trimesterGrades?: Array<Record<string, any>> },
  extraRows?: Array<Record<string, any> | null | undefined>,
  enabled?: Partial<EnabledGradeParts>
): GradeEvidence {
  return gradeEvidenceOf([...(st.trimesterGrades || []), ...(extraRows || [])], enabled);
}

/** A regra "sem notas no I e II trimestres" só vale com o III trimestre em curso ou já lançado. */
export function isNoTrimestersRuleActive(currentTrimester: string | undefined, classHasThirdTrimesterGrades: boolean): boolean {
  return currentTrimester === '3' || classHasThirdTrimesterGrades;
}

export function resolveStudentStanding(
  exit: StudentExitKind,
  evidence: GradeEvidence,
  noTrimestersRuleActive: boolean
): { isDesistente: boolean; isTransferido: boolean } {
  if (exit === 'transferido') return { isDesistente: false, isTransferido: true };
  if (exit === 'cancelado') return { isDesistente: !evidence.any, isTransferido: false };
  return { isDesistente: noTrimestersRuleActive && !evidence.t12, isTransferido: false };
}

/**
 * ÚNICO sítio onde uma linha da Mini-Pauta é recalculada (MT1-3, MFD, MF, CA e situação),
 * para qualquer regime:
 *  - transição: MT = média(MAC,NPP,NPT); MFD = média das MT (+ PG, se existir); CA.
 *  - exame (6.ª/9.ª/12.ª/13.ª): MFD = média das MT; MF = MFD×60% + exame(NEE,NEO)×40%;
 *    situação sobre a MF (ou MFD se ainda não há exame), com Recurso só em disciplinas
 *    não-chave e NER a decidir.
 *  - EJA: MT = (MAC+NPT)/2 + AAV + PCP; MFD = média das MT.
 */
export function recalcMiniPautaRow(row: StudentMiniPautaItem, ctx: MiniPautaCalcContext): StudentMiniPautaItem {
  if (row.isDesistente) return row;
  const { regime, classGrade, isKeySubject = false, rules } = ctx;
  const en = { ...ALL_PARTS_ENABLED, ...(ctx.enabled || {}) };

  const mtFor = (t: 1 | 2 | 3): number | '' => {
    const mac = (row as any)[`mac${t}`] ?? '';
    const npt = (row as any)[`npt${t}`] ?? '';
    const computed: number | '' = regime === 'eja'
      ? calculateEjaMT(mac, npt, (row as any)[`aav${t}`] ?? '', (row as any)[`pcp${t}`] ?? '', rules, en)
      : calculateMT(mac, (row as any)[`npp${t}`] ?? '', npt, rules, en);
    if (computed === '' && !rowHasOwnTrimesterGrades(row, t)) {
      const imp = row.importedMt?.[t - 1];
      if (isImportedPositive(imp)) return imp as number;
    }
    return computed;
  };
  const mt1 = mtFor(1);
  const mt2 = mtFor(2);
  const mt3 = mtFor(3);
  const usesPG = regime === 'transicao';
  let mfd = calculateMFD(mt1, mt2, mt3, usesPG ? row.pg : '', rules);
  if (mfd === '' && isImportedPositive(row.importedMfd)) mfd = row.importedMfd as number;
  const ca = typeof mfd === 'number' ? (calculateCA(mfd) as number) : '';

  let mf: number | '' = '';
  let decisive: number | '' = mfd;
  let ner: number | '' = '';
  if (regime === 'exame') {
    mf = calculateExamMF(mfd, row.nee ?? '', row.neo ?? '', rules, en);
    if (typeof mf === 'number') decisive = mf;
    ner = en.NER && typeof row.ner === 'number' ? row.ner : '';
  }

  const obs = calculateSituation({
    finalGrade: decisive,
    hasAnyGrade: typeof decisive === 'number',
    isDesistente: false,
    isTransferido: Boolean(row.isTransferido),
    classGrade,
    rules,
    isKeySubject,
    ner,
    recursoAllowed: classAllowsRecurso(classGrade, ctx.courseDurationYears) && hasThirdTrimesterGrade(mt3)
  });

  return { ...row, mt1, mt2, mt3, mfd, ca, mf, obs };
}

function emptyMiniRow(
  st: Student,
  idx: number,
  subjectId: string,
  base: { birthYear: number | string; age: number | string; gender: 'M' | 'F'; isDebtor: boolean; isDesistente: boolean; isTransferido?: boolean }
): StudentMiniPautaItem {
  return {
    id: `${st.id}-${subjectId}`,
    studentId: st.id,
    num: idx + 1,
    name: st.name || '',
    ...base,
    mac1: '', npp1: '', npt1: '', mt1: '',
    mac2: '', npp2: '', npt2: '', mt2: '',
    mac3: '', npp3: '', npt3: '', mt3: '',
    mfd: '', pg: '', ca: '',
    obs: base.isTransferido ? 'TRANSFERIDO' : base.isDesistente ? 'Desistente' : '',
    nee: '', neo: '', ner: '', mf: '',
    aav1: '', pcp1: '', aav2: '', pcp2: '', aav3: '', pcp3: ''
  };
}

/** Contexto de classe usado para decidir o regime de avaliação e a disciplina chave. */
export interface PautaClassContext {
  /** Nome da turma / curso, usados para reconhecer o EJA e a disciplina chave do curso. */
  labels?: Array<string | null | undefined>;
  courseName?: string | null;
  /** Componentes de nota habilitadas para o professor lançar (decide quem é "sem notas"). */
  enabled?: Partial<EnabledGradeParts>;
  /** Trimestre em curso ('1' | '2' | '3'); a regra "sem notas no I e II" só vale no III. */
  currentTrimester?: string;
  /** Duração do curso (anos) da turma: 4 => Recurso só na 13.ª; 3 => só na 12.ª. */
  courseDurationYears?: number;
}

/**
 * Initializes Mini-Pauta records combining class students with subject-specific grades
 */
/**
 * Aluno que SAIU da escola por transferência (processo "Transferência de saída" em
 * Transferências, Equivalências e Anulações → estado do aluno "transferred").
 * Quem entrou por transferência é um aluno normal e não conta aqui.
 */
export function isStudentTransferredOut(st: { status?: string }): boolean {
  return st.status === 'transferred';
}

export function buildMiniPautaRows(
  classStudents: Student[],
  subjectId: string,
  allStudents: Student[],
  savedGradesMap?: Record<string, StudentMiniPautaItem>,
  rawRules?: Partial<GradeRules> | null,
  calc?: {
    regime: PautaRegime;
    classGrade?: string | null;
    isKeySubject?: boolean;
    /** Componentes de nota habilitadas para o professor lançar. */
    enabled?: Partial<EnabledGradeParts>;
    /** Trimestre em curso ('1' | '2' | '3'). */
    currentTrimester?: string;
    /** Nome da disciplina: acha notas importadas cujo id de origem não coincide com o desta escola. */
    subjectName?: string;
  }
): StudentMiniPautaItem[] {
  const rules = normalizeGradeRules(rawRules);
  // Apenas os alunos REALMENTE matriculados na turma. Nunca "os primeiros 10 da
  // escola": mostrar alunos de outras turmas numa mini-pauta é um erro pedagógico
  // e uma fuga de dados entre turmas.
  void allStudents;
  const sourceList = sortByName(classStudents, (st) => st.name);
  const ctx: MiniPautaCalcContext = {
    regime: calc?.regime ?? 'transicao',
    classGrade: calc?.classGrade,
    isKeySubject: calc?.isKeySubject,
    rules,
    enabled: calc?.enabled
  };

  // Notas lançadas por aluno (todas as disciplinas já gravadas + a linha em edição desta).
  const evidences = sourceList.map((st) => studentGradeEvidence(st, [savedGradesMap?.[st.id]], calc?.enabled));
  const ruleActive = isNoTrimestersRuleActive(calc?.currentTrimester, evidences.some((e) => e.t3));

  return sourceList.map((st, idx) => {
    const { birthYear, age } = calculateBirthYearAndAge(st.birthDate);
    const gender = normalizeGender(st.gender, st.name);
    const isDebtor = st.financialStatus === 'debito' || !st.isTuitionPaidCurrentMonth;
    const { isDesistente, isTransferido } = resolveStudentStanding(studentExitKind(st), evidences[idx], ruleActive);
    const name = st.name || '';
    const base = { birthYear, age, gender, isDebtor, isDesistente, isTransferido };

    // Desistente: linha vazia (as notas não contam nem se mostram).
    if (isDesistente) return emptyMiniRow(st, idx, subjectId, base);

    const realTrimester = findStudentSubjectRecord(st, subjectId, calc?.subjectName);
    const imported = importedAveragesOf(realTrimester);

    // 1. Notas editadas/guardadas nesta sessão para esta disciplina.
    if (savedGradesMap && savedGradesMap[st.id]) {
      const saved = savedGradesMap[st.id];
      const savedHasOwn = ([1, 2, 3] as const).some((t) => rowHasOwnTrimesterGrades(saved as any, t)) ||
        [saved.mt1, saved.mt2, saved.mt3, saved.mfd].some(isImportedPositive);
      if (!(imported && !savedHasOwn)) {
        return recalcMiniPautaRow(
          {
            ...saved, num: idx + 1, name: st.name || saved.name, gender, isDebtor, isDesistente, isTransferido,
            ...(imported ? { importedMt: saved.importedMt ?? imported.mts, importedMfd: saved.importedMfd ?? imported.mfd } : {})
          },
          ctx
        );
      }
    }

    // 2. Notas trimestrais realmente lançadas na base de dados.
    if (realTrimester) {
      // Recalcula tudo a partir das avaliações gravadas (e não do mt1/mfd persistido):
      // registos antigos tinham médias "presas" em 0 mesmo com MAC/NPP/NPT lançados.
      const row: StudentMiniPautaItem = {
        id: `${st.id}-${subjectId}`,
        studentId: st.id,
        num: idx + 1,
        name,
        ...base,
        mac1: realTrimester.mac1, npp1: realTrimester.npp1, npt1: realTrimester.npt1, mt1: '',
        mac2: realTrimester.mac2, npp2: realTrimester.npp2, npt2: realTrimester.npt2, mt2: '',
        mac3: realTrimester.mac3, npp3: realTrimester.npp3, npt3: realTrimester.npt3, mt3: '',
        mfd: '',
        pg: realTrimester.pg ?? '',
        ca: '',
        obs: '',
        nee: realTrimester.nee ?? '',
        neo: realTrimester.neo ?? '',
        ner: realTrimester.ner ?? '',
        mf: '',
        aav1: realTrimester.aav1 ?? '', pcp1: realTrimester.pcp1 ?? '',
        aav2: realTrimester.aav2 ?? '', pcp2: realTrimester.pcp2 ?? '',
        aav3: realTrimester.aav3 ?? '', pcp3: realTrimester.pcp3 ?? '',
        ...(imported ? { importedMt: imported.mts, importedMfd: imported.mfd } : {})
      };
      return recalcMiniPautaRow(row, ctx);
    }

    // 3. Sem notas lançadas: a linha fica VAZIA, pronta para o docente preencher.
    //    Nunca se inventam notas.
    return emptyMiniRow(st, idx, subjectId, base);
  });
}

/**
 * Completa uma Mini-Pauta JÁ GUARDADA: alunos que entraram depois (matrícula/transferência) ganham a sua linha,
 * e quem traz notas de outra escola passa a transportá-las. Nunca remove linhas nem altera avaliações lançadas.
 */
export function syncStoredMiniPautaRows(
  stored: StudentMiniPautaItem[],
  classStudents: Student[],
  subjectId: string,
  allStudents: Student[],
  rawRules?: Partial<GradeRules> | null,
  calc?: Parameters<typeof buildMiniPautaRows>[5]
): StudentMiniPautaItem[] {
  const byStudent = new Map(stored.map((r) => [String(r.studentId), r]));
  const missing = classStudents.filter((st) => !byStudent.has(String(st.id)));
  const extra = missing.length ? buildMiniPautaRows(missing, subjectId, allStudents, undefined, rawRules, calc) : [];
  const stById = new Map(classStudents.map((s) => [String(s.id), s]));
  const enriched = stored.map((row) => {
    const st = stById.get(String(row.studentId));
    if (!st) return row;
    const imported = importedAveragesOf(findStudentSubjectRecord(st, subjectId, calc?.subjectName));
    if (!imported) return row;
    return { ...row, importedMt: row.importedMt ?? imported.mts, importedMfd: row.importedMfd ?? imported.mfd };
  });
  return [...enriched, ...extra];
}

/**
 * Actualiza a situação (Desistente / Transferido) de linhas de Mini-Pauta JÁ GUARDADAS, a partir
 * da ficha actual dos alunos e das notas reais. Os sinalizadores gravados nas linhas são
 * ignorados: foram calculados com regras antigas (por ex. o transferido aparecia sem notas).
 */
export function refreshMiniPautaStanding(
  rows: StudentMiniPautaItem[],
  students: Student[],
  ctx: MiniPautaCalcContext & { currentTrimester?: string }
): StudentMiniPautaItem[] {
  const byId = new Map(students.map((s) => [String(s.id), s]));
  const evidences = rows.map((r) => {
    const st = byId.get(String(r.studentId));
    return st ? studentGradeEvidence(st, [r], ctx.enabled) : gradeEvidenceOf([r], ctx.enabled);
  });
  const ruleActive = isNoTrimestersRuleActive(ctx.currentTrimester, evidences.some((e) => e.t3));
  return rows.map((r, i) => {
    const st = byId.get(String(r.studentId));
    if (!st) return r;
    const { isDesistente, isTransferido } = resolveStudentStanding(studentExitKind(st), evidences[i], ruleActive);
    const next: StudentMiniPautaItem = { ...r, isDesistente, isTransferido };
    if (isDesistente) return { ...next, obs: 'Desistente' };
    // Deixa de ser desistente/transferido: o recálculo repõe a situação pelas notas.
    return recalcMiniPautaRow({ ...next, obs: '' }, ctx);
  });
}

export function buildPautaGeralRows(
  classStudents: Student[],
  subjects: Subject[],
  allStudents: Student[],
  allDisciplineGradesMap?: Record<string, Record<string, StudentMiniPautaItem>>,
  classGrade?: string | null,
  rawRules?: Partial<GradeRules> | null,
  classCtx?: PautaClassContext
): StudentPautaGeralItem[] {
  const rules = normalizeGradeRules(rawRules);
  // Apenas os alunos REALMENTE matriculados na turma — nunca um "top 10" de alunos
  // de outras turmas da instituição (fuga de dados entre turmas).
  void allStudents;
  const sourceList = sortByName(classStudents, (st) => st.name);
  const regime = getPautaRegime(classGrade, ...(classCtx?.labels || []));
  const keyOf = (subj: Subject) => isKeySubjectFor(subj, classGrade, classCtx?.courseName);

  // Notas lançadas por aluno (todas as disciplinas já gravadas + as linhas ainda em edição).
  const evidences = sourceList.map((st) =>
    studentGradeEvidence(st, subjects.map((subj) => allDisciplineGradesMap?.[subj.id]?.[st.id]), classCtx?.enabled)
  );
  const ruleActive = isNoTrimestersRuleActive(classCtx?.currentTrimester, evidences.some((e) => e.t3));

  return sourceList.map((st, idx) => {
    const { birthYear, age } = calculateBirthYearAndAge(st.birthDate);
    const gender = normalizeGender(st.gender, st.name);
    const isDebtor = st.financialStatus === 'debito' || !st.isTuitionPaidCurrentMonth;
    const { isDesistente, isTransferido } = resolveStudentStanding(studentExitKind(st), evidences[idx], ruleActive);
    const name = st.name || `Aluno ${idx + 1}`;

    const subjectGrades: Record<string, StudentSubjectDisciplineGrades> = {};
    const emptyGrades = (): StudentSubjectDisciplineGrades => ({ mt1: '', mt2: '', mt3: '', mfd: '', mf: '', ner: '' });

    subjects.forEach((subj) => {
      if (isDesistente) {
        subjectGrades[subj.id] = emptyGrades();
        return;
      }

      // 1. Notas guardadas/editadas na Mini-Pauta para esta disciplina e aluno.
      const savedRow = allDisciplineGradesMap?.[subj.id]?.[st.id];
      if (savedRow) {
        subjectGrades[subj.id] = {
          mt1: savedRow.mt1, mt2: savedRow.mt2, mt3: savedRow.mt3, mfd: savedRow.mfd,
          mf: regime === 'exame' ? (savedRow.mf ?? '') : '',
          ner: regime === 'exame' ? (savedRow.ner ?? '') : ''
        };
        return;
      }

      // 2. Notas trimestrais reais na base de dados, sempre recalculadas das avaliações.
      const realTrimester = findStudentSubjectRecord(st, String(subj.id), subj.name);
      if (realTrimester) {
        const r = recomputeTrimesterRecord(realTrimester, rules);
        subjectGrades[subj.id] = {
          mt1: r.mt1, mt2: r.mt2, mt3: r.mt3, mfd: r.mfd,
          mf: regime === 'exame' ? r.mf : '',
          ner: regime === 'exame' ? (realTrimester.ner ?? '') : ''
        };
        return;
      }

      // 3. Nota de disciplina simples registada na base de dados.
      const realDisc = st.disciplineGrades?.find(
        (dg) => dg.subject.toLowerCase() === subj.name.toLowerCase()
      );
      if (realDisc && typeof realDisc.score === 'number') {
        const sc = Math.round(realDisc.score);
        subjectGrades[subj.id] = { mt1: sc, mt2: sc, mt3: sc, mfd: sc, mf: '', ner: '' };
        return;
      }

      // 4. Sem notas lançadas em qualquer fonte real: a célula fica VAZIA (nunca se inventam notas).
      subjectGrades[subj.id] = emptyGrades();
    });

    return summarizePautaGeralRow(
      {
        id: `pauta-geral-${st.id || idx}`,
        studentId: st.id || `stu-${idx + 1}`,
        num: idx + 1,
        name,
        gender,
        birthYear,
        age,
        isDebtor,
        isDesistente,
        isTransferido,
        subjectGrades
      },
      subjects,
      classGrade,
      rules,
      regime,
      classCtx
    );
  });
}

/** Nota decisiva de uma disciplina na pauta: MF (se houver exame lançado) senão MFD. */
export function decisiveSubjectGrade(g: StudentSubjectDisciplineGrades | undefined, regime: PautaRegime): number | '' {
  if (!g) return '';
  if (regime === 'exame' && typeof g.mf === 'number') return g.mf;
  return typeof g.mfd === 'number' ? g.mfd : '';
}

/**
 * Calcula MF (média das notas decisivas) e a SITUAÇÃO final de uma linha da Pauta Final.
 *  - Classes de exame: regra de Recurso por disciplina chave / nº de negativas.
 *  - Restantes (transição e EJA): aprovado se MF >= nota de aprovação, senão reprovado (sem recurso).
 */
export function summarizePautaGeralRow(
  row: Omit<StudentPautaGeralItem, 'mf' | 'situation'>,
  subjects: Subject[],
  classGrade: string | null | undefined,
  rules: GradeRules,
  regime: PautaRegime,
  classCtx?: PautaClassContext
): StudentPautaGeralItem {
  const decisive = subjects
    .map((subj) => ({ subj, g: decisiveSubjectGrade(row.subjectGrades[subj.id], regime) }))
    .filter((x): x is { subj: Subject; g: number } => typeof x.g === 'number');

  const mf: number | '' =
    decisive.length > 0 ? roundGrade(decisive.reduce((a, b) => a + b.g, 0) / decisive.length, rules) : '';

  let situation: PautaSituation;
  if (regime === 'exame') {
    situation = calculateExamPautaSituation({
      subjects: subjects.map((subj) => ({
        grade: decisiveSubjectGrade(row.subjectGrades[subj.id], regime),
        isKey: isKeySubjectFor(subj, classGrade, classCtx?.courseName),
        ner: row.subjectGrades[subj.id]?.ner,
        mt3: row.subjectGrades[subj.id]?.mt3
      })),
      isDesistente: row.isDesistente,
      isTransferido: Boolean(row.isTransferido),
      classGrade,
      rules,
      courseDurationYears: classCtx?.courseDurationYears
    });
  } else {
    situation = calculateSituation({
      finalGrade: mf,
      hasAnyGrade: decisive.length > 0,
      isDesistente: row.isDesistente,
      isTransferido: Boolean(row.isTransferido),
      classGrade,
      rules
    });
  }
  return { ...row, mf, situation };
}
