import { EducationLevelId, EducationSubsystem, Subject, TuitionRow } from '../types';
import { isEducationSubsystemBlocked } from './platformLock';

export type { EducationLevelId, EducationSubsystem };

export const ALL_EDUCATION_SUBSYSTEMS: EducationSubsystem[] = [
  {
    id: 'pre_escolar',
    name: 'Educação Pré-Escolar',
    shortName: 'Pré-Escolar',
    fullName: 'Educação Pré-Escolar (Creche, Jardim de Infância e Iniciação)',
    description: 'Atendimento integral à primeira infância, desde a creche e jardim até à classe de iniciação preparatória.',
    grades: [
      'Creche (Berçário / Maternal)',
      'Jardim de Infância (3 a 4 anos)',
      'Iniciação (5 anos)'
    ],
    defaultAreas: [
      'Desenvolvimento Infantil & Psicomotricidade'
    ],
    coursesOrAreas: [
      'Desenvolvimento Infantil & Psicomotricidade'
    ],
    regime: 'Monodocência / Educador de Infância',
    icon: 'child_care'
  },
  {
    id: 'primario',
    name: 'Ensino Primário',
    shortName: 'Primário',
    fullName: 'Ensino Primário (1.ª à 6.ª classe e Módulo 3, monodocência até à 4.ª)',
    description: 'Ensino primário universal com regime de monodocência obrigatória da 1.ª à 4.ª classe e pluridocência na 5.ª e 6.ª classe.',
    grades: [
      '1.ª Classe',
      '2.ª Classe',
      '3.ª Classe',
      '4.ª Classe',
      '5.ª Classe',
      '6.ª Classe',
      'Módulo 3'
    ],
    defaultAreas: [
      'Ensino Primário Geral'
    ],
    coursesOrAreas: [
      'Ensino Primário Geral'
    ],
    regime: 'Monodocência até à 4.ª classe / Pluridocência na 5.ª e 6.ª',
    icon: 'school'
  },
  {
    id: 'secundario_1',
    name: 'I Ciclo do Ensino Secundário',
    shortName: 'I Ciclo',
    fullName: 'I Ciclo do Ensino Secundário (7.ª à 9.ª classe, I e II Ano do EJA)',
    description: 'Ensino secundário básico por disciplinas e Educação de Jovens e Adultos (EJA), com regime de pluridocência.',
    grades: [
      '7.ª Classe',
      '8.ª Classe',
      '9.ª Classe',
      'I Ano EJA (Módulos 1-2)',
      'II Ano EJA (Módulos 3-4)'
    ],
    defaultAreas: [
      'Ensino Geral Unificado',
      'Educação de Jovens e Adultos (EJA)'
    ],
    coursesOrAreas: [
      'Ensino Geral Unificado',
      'Educação de Jovens e Adultos (EJA)'
    ],
    regime: 'Pluridocência por Disciplinas Curriculares',
    icon: 'menu_book'
  },
  {
    id: 'secundario_2',
    name: 'II Ciclo / Ensino Médio',
    shortName: 'II Ciclo / Médio',
    fullName: 'II Ciclo / Ensino Médio — 10.ª à 13.ª Classe (Geral & Técnico)',
    description: 'Ensino secundário pré-universitário e institutos médios técnicos/politécnicos com estágio curricular e projeto PAP.',
    grades: [
      '10.ª Classe',
      '11.ª Classe',
      '12.ª Classe',
      '13.ª Classe (Técnico-Profissional)'
    ],
    defaultAreas: [
      'Ciências Físicas e Biológicas',
      'Ciências Económicas e Jurídicas',
      'Ciências Humanas e Sociais',
      'Artes Visuais & Multimédia',
      'Técnico de Enfermagem Geral',
      'Técnico de Análises Clínicas',
      'Informática de Gestão & Redes',
      'Contabilidade e Gestão',
      'Eletrotecnia e Instalações Elétricas',
      'Construção Civil'
    ],
    coursesOrAreas: [
      'Ciências Físicas e Biológicas',
      'Ciências Económicas e Jurídicas',
      'Ciências Humanas e Sociais',
      'Artes Visuais & Multimédia',
      'Técnico de Enfermagem Geral',
      'Técnico de Análises Clínicas',
      'Informática de Gestão & Redes',
      'Contabilidade e Gestão',
      'Eletrotecnia e Instalações Elétricas',
      'Construção Civil'
    ],
    regime: 'Pluridocência Especializada & Estágio Profissional',
    icon: 'biotech'
  },
  {
    id: 'superior',
    name: 'Ensino Superior',
    shortName: 'Superior',
    fullName: 'Ensino Superior (Bacharelato, Licenciatura, Mestrado)',
    description: 'Graus académicos superiores com regime semestral por créditos ECTS, cadeiras curriculares e exame de recurso.',
    grades: [
      '1.º Ano (Licenciatura)',
      '2.º Ano (Licenciatura)',
      '3.º Ano (Licenciatura)',
      '4.º Ano (Licenciatura)',
      '5.º Ano (Licenciatura/Especialidade)',
      '1.º Ano (Bacharelato)',
      '2.º Ano (Bacharelato)',
      '3.º Ano (Bacharelato)',
      '1.º Ano (Mestrado)',
      '2.º Ano (Mestrado)'
    ],
    defaultAreas: [
      'Medicina Geral',
      'Direito & Ciências Jurídicas',
      'Engenharia Informática & Telecomunicações',
      'Gestão de Empresas & Finanças',
      'Economia',
      'Psicologia Clínica',
      'Ciências Farmacêuticas',
      'Arquitetura e Urbanismo',
      'Engenharia Civil'
    ],
    coursesOrAreas: [
      'Medicina Geral',
      'Direito & Ciências Jurídicas',
      'Engenharia Informática & Telecomunicações',
      'Gestão de Empresas & Finanças',
      'Economia',
      'Psicologia Clínica',
      'Ciências Farmacêuticas',
      'Arquitetura e Urbanismo',
      'Engenharia Civil'
    ],
    regime: 'Semestral / Créditos ECTS / Cadeiras Curriculares',
    icon: 'history_edu'
  }
];

export const DEFAULT_SELECTED_SUBSYSTEMS: EducationLevelId[] = [
  'primario',
  'secundario_1',
  'secundario_2'
];

/**
 * Retorna os subsistemas ativos na configuração da instituição.
 * Se nenhum estiver selecionado, retorna os subsistemas padrão.
 */
export function getActiveSubsystems(selectedIds?: EducationLevelId[]): EducationSubsystem[] {
  // Subsistemas desligados pelo Admin Master para esta escola nunca ficam ativos.
  const allowed = (s: EducationSubsystem) => !isEducationSubsystemBlocked(s.id);
  if (!selectedIds || selectedIds.length === 0) {
    return ALL_EDUCATION_SUBSYSTEMS.filter((s) => DEFAULT_SELECTED_SUBSYSTEMS.includes(s.id) && allowed(s));
  }
  return ALL_EDUCATION_SUBSYSTEMS.filter((s) => selectedIds.includes(s.id) && allowed(s));
}

/**
 * Retorna todas as classes/anos disponíveis com base nos subsistemas ativos.
 */
export function getAvailableGrades(selectedIds?: EducationLevelId[]): string[] {
  const active = getActiveSubsystems(selectedIds);
  const grades: string[] = [];
  active.forEach((sub) => {
    grades.push(...sub.grades);
  });
  return grades;
}

/**
 * Retorna todas as áreas/cursos disponíveis com base nos subsistemas ativos.
 * Opcionalmente filtra de acordo com a classe selecionada.
 */
/**
 * Normaliza o texto de uma classe para facilitar comparações precisas (remove pontos, ordinais e espaços extras).
 */
export function normalizeGradeKey(grade: string): string {
  if (!grade) return '';
  return grade
    .toLowerCase()
    .replace(/[.\-–—ºª°]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Verifica se a classe pertence ao Ensino Médio / II Ciclo (a partir da 10.ª classe) ou ao Ensino Superior.
 */
export function isUpperLevelGrade(grade: string): boolean {
  if (!grade) return false;
  const norm = normalizeGradeKey(grade);
  const numMatch = grade.match(/(\d+)/);
  if (numMatch) {
    const num = parseInt(numMatch[1], 10);
    if (num >= 10) return true;
  }
  return (
    norm.includes('licenciatura') ||
    norm.includes('bacharelato') ||
    norm.includes('mestrado') ||
    norm.includes('superior') ||
    norm.includes('10') ||
    norm.includes('11') ||
    norm.includes('12') ||
    norm.includes('13')
  );
}

/**
 * Retorna todas as áreas/cursos disponíveis com base nos subsistemas ativos.
 * Opcionalmente filtra de acordo com a classe selecionada.
 */
export function getAvailableAreas(selectedIds?: EducationLevelId[], targetGrade?: string): string[] {
  if (targetGrade) {
    const sub = getSubsystemForGrade(targetGrade);
    if (sub && sub.defaultAreas && sub.defaultAreas.length > 0) {
      return sub.defaultAreas;
    }
  }

  const active = getActiveSubsystems(selectedIds);
  const areas: string[] = [];
  active.forEach((sub) => {
    sub.defaultAreas.forEach((area) => {
      if (!areas.includes(area)) {
        areas.push(area);
      }
    });
  });
  return areas.length > 0 ? areas : ['Geral'];
}

/**
 * Encontra a qual subsistema uma classe pertence de forma rigorosa e confiável.
 */
/**
 * Valores-base sugeridos por subsistema (apenas ponto de partida editável pela instituição —
 * cada classe individual pode depois ser ajustada na Tabela Financeira, em Configurações).
 */
const SUBSYSTEM_BASELINE_PRICING: Record<EducationLevelId, { matriculaKz: number; confirmacaoKz: number; monthlyTuitionKz: number }> = {
  pre_escolar: { matriculaKz: 20000, confirmacaoKz: 12000, monthlyTuitionKz: 25000 },
  primario: { matriculaKz: 28000, confirmacaoKz: 18000, monthlyTuitionKz: 32000 },
  secundario_1: { matriculaKz: 32000, confirmacaoKz: 20000, monthlyTuitionKz: 36500 },
  secundario_2: { matriculaKz: 38000, confirmacaoKz: 24000, monthlyTuitionKz: 42000 },
  superior: { matriculaKz: 50000, confirmacaoKz: 30000, monthlyTuitionKz: 65000 }
};

/**
 * Gera a Tabela Financeira (Propina/Matrícula/Confirmação) com UMA LINHA POR CLASSE,
 * restrita apenas às classes dos subsistemas de ensino ativos na instituição — nunca
 * um valor único "por nível inteiro". Preserva quaisquer valores já configurados pela
 * instituição (casados pela classe), e usa um valor-base apenas para classes novas
 * que ainda não tenham uma linha guardada.
 */
export function buildTuitionRowsForActiveSubsystems(
  selectedIds: EducationLevelId[] | undefined,
  existingRows: TuitionRow[] | undefined
): TuitionRow[] {
  const activeSubsystems = getActiveSubsystems(selectedIds);
  const existingByGrade = new Map<string, TuitionRow>();
  (existingRows || []).forEach((row) => {
    if (row && row.grade) {
      existingByGrade.set(normalizeGradeKey(row.grade), row);
    }
  });

  const rows: TuitionRow[] = [];
  activeSubsystems.forEach((sub) => {
    const baseline = SUBSYSTEM_BASELINE_PRICING[sub.id] || { matriculaKz: 0, confirmacaoKz: 0, monthlyTuitionKz: 0 };
    sub.grades.forEach((grade) => {
      const key = normalizeGradeKey(grade);
      const existing = existingByGrade.get(key);
      rows.push({
        id: existing?.id || `tuition-${sub.id}-${key.replace(/\s+/g, '-')}`,
        grade,
        subsystemId: sub.id,
        levelName: sub.shortName,
        cycle: sub.fullName,
        matriculaKz: existing?.matriculaKz ?? baseline.matriculaKz,
        confirmacaoKz: existing?.confirmacaoKz ?? baseline.confirmacaoKz,
        monthlyTuitionKz: existing?.monthlyTuitionKz ?? baseline.monthlyTuitionKz,
        lateFeeLimitDays: existing?.lateFeeLimitDays ?? 10
      });
    });
  });

  return rows;
}

/**
 * Procura a linha da Tabela Financeira (propina/matrícula/confirmação) configurada para
 * uma classe específica. Usado para preencher automaticamente os valores financeiros ao
 * matricular um aluno numa turma — nunca um valor fixo/inventado.
 */
export function findTuitionRowForGrade(tuitionRows: TuitionRow[] | undefined, grade: string | undefined): TuitionRow | undefined {
  if (!tuitionRows || !grade) return undefined;
  const key = normalizeGradeKey(grade);
  return tuitionRows.find((row) => normalizeGradeKey(row.grade) === key);
}

export function getSubsystemForGrade(grade: string): EducationSubsystem | undefined {
  if (!grade) return undefined;
  const normGrade = normalizeGradeKey(grade);

  // 1. Verificação por comparação direta normalizada
  for (const sub of ALL_EDUCATION_SUBSYSTEMS) {
    if (sub.grades.some((g) => normalizeGradeKey(g) === normGrade)) {
      return sub;
    }
  }

  // 2. Verificação numérica para classes de ensino geral e técnico
  const numMatch = grade.match(/(\d+)/);
  if (numMatch) {
    const num = parseInt(numMatch[1], 10);
    if (num >= 1 && num <= 6) {
      return ALL_EDUCATION_SUBSYSTEMS.find((s) => s.id === 'primario');
    }
    if (num >= 7 && num <= 9) {
      return ALL_EDUCATION_SUBSYSTEMS.find((s) => s.id === 'secundario_1');
    }
    if (num >= 10 && num <= 13) {
      return ALL_EDUCATION_SUBSYSTEMS.find((s) => s.id === 'secundario_2');
    }
  }

  // 3. Verificação para Ensino Superior
  const lower = grade.toLowerCase();
  if (
    lower.includes('licenciatura') ||
    lower.includes('bacharelato') ||
    lower.includes('mestrado') ||
    lower.includes('superior')
  ) {
    return ALL_EDUCATION_SUBSYSTEMS.find((s) => s.id === 'superior');
  }

  // 4. Verificação para Pré-Escolar
  if (
    lower.includes('creche') ||
    lower.includes('jardim') ||
    lower.includes('iniciação') ||
    lower.includes('iniciacao')
  ) {
    return ALL_EDUCATION_SUBSYSTEMS.find((s) => s.id === 'pre_escolar');
  }

  return undefined;
}

/**
 * Retorna o nome formal do ciclo/nível para uma dada classe.
 */
export function getCycleForGrade(grade: string): string {
  const sub = getSubsystemForGrade(grade);
  if (sub) {
    return sub.fullName;
  }
  if (grade.includes('Classe')) {
    const num = parseInt(grade.replace(/\D/g, ''), 10);
    if (num >= 1 && num <= 6) return 'Ensino Primário';
    if (num >= 7 && num <= 9) return 'I Ciclo do Ensino Secundário';
    if (num >= 10 && num <= 13) return 'II Ciclo / Ensino Médio';
  }
  if (/^\s*m[óo]dulo\s*3\b/i.test(grade)) return 'Ensino Primário';
  if (grade.includes('Licenciatura') || grade.includes('Mestrado') || grade.includes('Bacharelato')) {
    return 'Ensino Superior';
  }
  return 'Ensino Geral';
}

/**
 * Gera automaticamente uma sugestão de nome para a turma com base na classe, secção e área.
 */
export function generateSuggestedClassName(grade: string, section: string, area?: string): string {
  if (!grade) return '';
  const cleanSection = section ? section.trim().toUpperCase() : 'A';

  if (grade.includes('Creche') || grade.includes('Jardim') || grade.includes('Iniciação')) {
    return `${grade} • Turma ${cleanSection}`;
  }

  if (grade.includes('Licenciatura') || grade.includes('Bacharelato') || grade.includes('Mestrado')) {
    const areaShort = area ? ` - ${area.split('&')[0].trim()}` : '';
    return `${grade}${areaShort} • Turma ${cleanSection}`;
  }

  if (
    grade.includes('10') ||
    grade.includes('11') ||
    grade.includes('12') ||
    grade.includes('13')
  ) {
    const areaTag = area && !area.includes('Geral') ? ` (${area.split(' ')[0]})` : '';
    return `${grade}${areaTag} • Turma ${cleanSection}`;
  }

  return `${grade} • Turma ${cleanSection}`;
}

/**
 * Gera automaticamente o código de uma disciplina com base no nome e disciplinas já cadastradas.
 * Exemplo: 'Matemática' -> 'MAT01'. Se o código já existir -> sequência seguinte.
 * Avisa se já existir uma disciplina com o mesmo nome.
 */
export function generateSubjectCode(
  name: string,
  existingSubjects: Subject[]
): { code: string; isDuplicateInSameCycle: boolean; sequence: number } {
  if (!name || name.trim().length === 0) {
    return { code: '', isDuplicateInSameCycle: false, sequence: 1 };
  }

  // Remove acentos e caracteres especiais para gerar prefixo limpo
  const clean = name
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9\s]/g, '')
    .trim();

  const words = clean.split(/\s+/).filter(Boolean);
  let prefix = '';

  if (words.length === 1) {
    prefix = words[0].slice(0, 3).toUpperCase();
  } else if (words.length === 2) {
    prefix = (words[0].slice(0, 2) + words[1].slice(0, 1)).toUpperCase();
  } else {
    // 3 palavras ou mais
    const meaningfulWords = words.filter(
      (w) => !['de', 'da', 'do', 'e', 'em', 'para', 'com'].includes(w.toLowerCase())
    );
    if (meaningfulWords.length >= 3) {
      prefix = meaningfulWords.slice(0, 3).map((w) => w[0]).join('').toUpperCase();
    } else {
      prefix = (words[0].slice(0, 2) + words[1].slice(0, 1)).toUpperCase();
    }
  }

  if (prefix.length < 3) {
    prefix = (prefix + 'DIS').slice(0, 3).toUpperCase();
  }

  // Verifica disciplinas existentes com o mesmo prefixo
  const matchingPrefix = existingSubjects.filter((s) => {
    const c = (s.code || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
    return c.startsWith(prefix);
  });

  // Verifica se a mesma disciplina com o mesmo nome já existe no mesmo ciclo/subsistema
  const cleanNormName = clean.toLowerCase();
  // Disciplinas não pertencem a um ciclo: basta o mesmo nome para ser duplicada.
  const isDuplicateInSameCycle = existingSubjects.some((s) => {
    const sNormName = (s.name || '')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .trim();
    return sNormName === cleanNormName;
  });

  // Calcula o maior número sequencial já usado para este prefixo
  let maxSeq = 0;
  matchingPrefix.forEach((s) => {
    const raw = (s.code || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
    const numPart = raw.slice(prefix.length);
    const parsed = parseInt(numPart, 10);
    if (!isNaN(parsed) && parsed > maxSeq) {
      maxSeq = parsed;
    }
  });

  const nextSeq = maxSeq + 1;
  const seqStr = String(nextSeq).padStart(2, '0');
  const code = `${prefix}${seqStr}`;

  return { code, isDuplicateInSameCycle, sequence: nextSeq };
}

/**
 * Indica se uma turma pertence a um sub-sistema de ensino.
 *
 * A classe (ex.: "11.ª Classe") é a fonte de verdade, através de getSubsystemForGrade.
 * Só quando a classe não permite identificar o sub-sistema se recorre ao texto do ciclo,
 * com correspondências exactas — nunca "contém", que confundia "11.ª" com "1.ª"
 * e "II Ciclo" com "I Ciclo", trazendo turmas do Ensino Médio para o Primário/I Ciclo.
 */
export function classBelongsToSubsystem(
  cls: { grade?: string; cycle?: string; area?: string },
  subsystemId: string
): boolean {
  const detected = getSubsystemForGrade(cls.grade || '');
  if (detected) return detected.id === subsystemId;

  const text = `${cls.cycle || ''} ${cls.area || ''}`.toLowerCase();
  switch (subsystemId) {
    case 'pre_escolar':
      return /pré|pre-escolar|iniciação|iniciacao|creche|jardim/.test(text);
    case 'primario':
      return /prim[áa]rio/.test(text);
    case 'secundario_1':
      return /(?<!i)i ciclo/.test(text);
    case 'secundario_2':
      return /ii ciclo|m[ée]dio|t[ée]cnico/.test(text);
    case 'superior':
      return /superior|gradua[çc][ãa]o|licenciatura|mestrado|bacharelato/.test(text);
    default:
      return false;
  }
}
