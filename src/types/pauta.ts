export type GradeTypeKey =
  | 'MAC' | 'NPP' | 'NPT' | 'MT1' | 'MT2' | 'MT3' | 'MFD' | 'PG' | 'CA' | 'MF'
  // Classes de exame (6.ª, 9.ª, 12.ª, 13.ª)
  | 'NEE' | 'NEO' | 'NER'
  // EJA
  | 'SUB' | 'AAV' | 'PCP';

export interface GradeTypeConfig {
  key: GradeTypeKey;
  label: string;
  shortLabel: string;
  description: string;
  category: 'evaluation' | 'trimester_average' | 'final';
}

export const ALL_GRADE_TYPES: GradeTypeConfig[] = [
  { key: 'MAC', label: 'MAC', shortLabel: 'MAC', description: 'Média de Avaliação Contínua', category: 'evaluation' },
  { key: 'NPP', label: 'NPP', shortLabel: 'NPP', description: 'Nota de Prova Parcial', category: 'evaluation' },
  { key: 'NPT', label: 'NPT', shortLabel: 'NPT', description: 'Nota de Prova Trimestral', category: 'evaluation' },
  { key: 'MT1', label: 'MT1', shortLabel: 'MT1', description: 'Média do 1º Trimestre', category: 'trimester_average' },
  { key: 'MT2', label: 'MT2', shortLabel: 'MT2', description: 'Média do 2º Trimestre', category: 'trimester_average' },
  { key: 'MT3', label: 'MT3', shortLabel: 'MT3', description: 'Média do 3º Trimestre', category: 'trimester_average' },
  { key: 'MFD', label: 'MFD', shortLabel: 'MFD', description: 'Média Final da Disciplina', category: 'final' },
  { key: 'PG', label: 'PG', shortLabel: 'PG', description: 'Prova Global / Exame', category: 'evaluation' },
  { key: 'CA', label: 'CA', shortLabel: 'CA', description: 'Classificação Anual', category: 'final' },
  { key: 'MF', label: 'MF', shortLabel: 'MF', description: 'Média Final Geral', category: 'final' },
  { key: 'NEE', label: 'NEE', shortLabel: 'NEE', description: 'Nota do Exame Escrito (40% da nota final)', category: 'evaluation' },
  { key: 'NEO', label: 'NEO', shortLabel: 'NEO', description: 'Nota do Exame Oral (entra na parte do exame, 40%)', category: 'evaluation' },
  { key: 'NER', label: 'NER', shortLabel: 'NER', description: 'Nota do Exame de Recurso', category: 'evaluation' },
  { key: 'SUB', label: 'Subtotal', shortLabel: 'SUB', description: 'Subtotal do EJA = (MAC + NPT) / 2', category: 'trimester_average' },
  { key: 'AAV', label: 'AAV', shortLabel: 'AAV', description: 'Auto-Avaliação (0 a 2 valores)', category: 'evaluation' },
  { key: 'PCP', label: 'PCP', shortLabel: 'PCP', description: 'Participação (0 a 4 valores)', category: 'evaluation' },
];

import type { PautaRegime } from '../utils/pautaCalculations';

/** Tipos de nota que existem (e podem ser marcados/desmarcados) em cada regime de avaliação. */
export const GRADE_TYPES_BY_REGIME: Record<PautaRegime, GradeTypeKey[]> = {
  transicao: ['MAC', 'NPP', 'NPT', 'MT1', 'MT2', 'MT3', 'MFD', 'PG', 'CA', 'MF'],
  exame: ['MAC', 'NPP', 'NPT', 'MT1', 'MT2', 'MT3', 'MFD', 'NEE', 'NEO', 'NER', 'MF'],
  eja: ['MAC', 'NPT', 'SUB', 'AAV', 'PCP', 'MT1', 'MT2', 'MT3', 'MFD', 'MF']
};

export interface StudentMiniPautaItem {
  id: string;
  studentId: string;
  num: number;
  name: string;
  gender: 'M' | 'F';
  birthYear: number | string;
  age: number | string;
  isDebtor: boolean;
  isDesistente: boolean;
  /** Saiu por transferência: mantém as notas já lançadas e a situação é TRANSFERIDO (não é desistente). */
  isTransferido?: boolean;
  /** Médias MT1/MT2/MT3 trazidas de outra escola: valem enquanto o trimestre não tiver avaliações próprias. */
  importedMt?: [number | '', number | '', number | ''];
  /** Média final trazida por equivalência. */
  importedMfd?: number | '';
  // I Trimestre
  mac1: number | '';
  npp1: number | '';
  npt1: number | '';
  mt1: number | '';
  // II Trimestre
  mac2: number | '';
  npp2: number | '';
  npt2: number | '';
  mt2: number | '';
  // III Trimestre
  mac3: number | '';
  npp3: number | '';
  npt3: number | '';
  mt3: number | '';
  // Classificação Final
  mfd: number | '';
  pg: number | '';
  ca: number | '';
  obs: string;
  // Classes de exame (6.ª, 9.ª, 12.ª, 13.ª): exame escrito, oral, de recurso e nota final da disciplina
  nee?: number | '';
  neo?: number | '';
  ner?: number | '';
  mf?: number | '';
  // EJA: auto-avaliação (0-2) e participação (0-4) por trimestre
  aav1?: number | '';
  pcp1?: number | '';
  aav2?: number | '';
  pcp2?: number | '';
  aav3?: number | '';
  pcp3?: number | '';
}

export interface StudentSubjectDisciplineGrades {
  mt1: number | '';
  mt2: number | '';
  mt3: number | '';
  mfd: number | '';
  /** Classes de exame: nota final da disciplina (MFD×60% + exame×40%) e nota do exame de recurso. */
  mf?: number | '';
  ner?: number | '';
}

export interface StudentPautaGeralItem {
  id: string;
  studentId: string;
  num: number;
  name: string;
  gender: 'M' | 'F';
  birthYear: number | string;
  age: number | string;
  isDebtor: boolean;
  isDesistente: boolean;
  /** Saiu por transferência: mostra as notas já lançadas e situação TRANSFERIDO. */
  isTransferido?: boolean;
  subjectGrades: Record<string, StudentSubjectDisciplineGrades>;
  mf: number | '';
  /**
   * Situação real, calculada a partir das notas (ver utils/pautaCalculations.ts
   * -> calculateSituation): PENDENTE enquanto não houver nenhuma nota lançada,
   * DESISTIDO para alunos desistentes, TRANSFERIDO para os transferidos, e para os restantes o cálculo oficial
   * (APROVADO / RECURSO nas classes de exame / REPROVADO).
   */
  situation: 'PENDENTE' | 'APROVADO' | 'REPROVADO' | 'DESISTIDO' | 'RECURSO' | 'TRANSFERIDO';
}
