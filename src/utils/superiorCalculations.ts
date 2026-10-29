/**
 * REGRAS DE CÁLCULO E VALIDAÇÃO — ENSINO SUPERIOR (MESCTI)
 * =======================================================
 * Implementa a lógica regulamentar do Ensino Superior em Angola:
 * - Verificação de precedências estritas na inscrição em UCs;
 * - Cadeiras em atraso e condições de transição de ano curricular;
 * - Média ponderada por créditos ECTS;
 * - Épocas de exame (Frequência, Normal, Recurso, Especial);
 * - Média final de curso e menção qualitativa oficial;
 * - Propinas proporcionais a ECTS e deduções de bolsas de estudo.
 */

import {
  BolsaEstudo,
  DiplomaSuperior,
  EpocaExame,
  EquivalenciaUC,
  EstagioCurricular,
  InscricaoUC,
  MonografiaTCC,
  UnidadeCurricular
} from '../types/superior';

/** Nota mínima de aprovação (escala 0-20). */
export const NOTA_APROVACAO = 10;
/** Nota de frequência a partir da qual o estudante fica dispensado de exame. */
export const NOTA_DISPENSA = 14;

const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const clamp20 = (v: number) => Math.min(20, Math.max(0, v));

function isApproved(i: InscricaoUC): boolean {
  if (i.status === 'anulado') return false;
  return i.status === 'aprovado' || (isNum(i.notaFinal) && i.notaFinal >= NOTA_APROVACAO);
}

/**
 * 0. RESULTADO DE UMA INSCRIÇÃO (ÉPOCAS DE EXAME)
 * - Frequência >= 14: dispensa de exame, nota final = nota de frequência.
 * - Caso contrário contam as épocas realizadas (normal, recurso, especial): o estudante fica
 *   aprovado se tiver >= 10 em qualquer uma, com a MAIOR nota obtida (melhoria de nota).
 *   Uma época posterior mais baixa nunca anula uma aprovação anterior.
 * - Sem aprovação: reprovado, com a nota da última época realizada.
 * - Sem nenhuma época lançada: continua apenas inscrito.
 * Valores fora de 0-20 são limitados; valores não numéricos são ignorados.
 */
export function resolveInscricaoResult(
  notas: { notaFrequencia?: number | null; notaExameNormal?: number | null; notaRecurso?: number | null; notaEspecial?: number | null },
  notaDispensa: number = NOTA_DISPENSA
): { notaFinal?: number; epocaAprovacao?: EpocaExame | 'dispensa'; status: 'inscrito' | 'aprovado' | 'reprovado' } {
  const freq = isNum(notas.notaFrequencia) ? clamp20(notas.notaFrequencia) : undefined;
  if (freq !== undefined && freq >= notaDispensa) {
    return { notaFinal: Math.round(freq * 10) / 10, epocaAprovacao: 'dispensa', status: 'aprovado' };
  }

  const exames: Array<{ epoca: EpocaExame; nota: number }> = [];
  if (isNum(notas.notaExameNormal)) exames.push({ epoca: 'normal', nota: clamp20(notas.notaExameNormal) });
  if (isNum(notas.notaRecurso)) exames.push({ epoca: 'recurso', nota: clamp20(notas.notaRecurso) });
  if (isNum(notas.notaEspecial)) exames.push({ epoca: 'especial', nota: clamp20(notas.notaEspecial) });

  if (exames.length === 0) return { status: 'inscrito' };

  const aprovados = exames.filter((e) => e.nota >= NOTA_APROVACAO);
  if (aprovados.length > 0) {
    const melhor = aprovados.reduce((a, b) => (b.nota > a.nota ? b : a));
    return { notaFinal: Math.round(melhor.nota * 10) / 10, epocaAprovacao: melhor.epoca, status: 'aprovado' };
  }
  const ultimo = exames[exames.length - 1];
  return { notaFinal: Math.round(ultimo.nota * 10) / 10, epocaAprovacao: undefined, status: 'reprovado' };
}

/**
 * 0b. RESULTADO ACTUAL POR UC
 * Um estudante pode ter várias inscrições na mesma UC (reprovou e repetiu). Para atrasos, média e
 * diploma conta UMA por UC: a melhor aprovação (maior nota) ou, sem aprovação, a mais recente.
 * Inscrições anuladas ignoram-se.
 */
export function latestResultPerUC(inscricoes: InscricaoUC[]): InscricaoUC[] {
  const byUC = new Map<string, InscricaoUC[]>();
  for (const i of inscricoes) {
    if (i.status === 'anulado') continue;
    const key = String(i.ucId);
    byUC.set(key, [...(byUC.get(key) || []), i]);
  }
  const recency = (i: InscricaoUC) => `${i.academicYear || ''}|${i.inscribedAt || ''}`;
  const out: InscricaoUC[] = [];
  for (const list of byUC.values()) {
    const approved = list.filter(isApproved);
    if (approved.length > 0) {
      out.push(approved.reduce((a, b) => ((b.notaFinal ?? 0) > (a.notaFinal ?? 0) ? b : a)));
    } else {
      out.push([...list].sort((a, b) => recency(a).localeCompare(recency(b))).pop() as InscricaoUC);
    }
  }
  return out;
}

/**
 * 1. PRECEDÊNCIAS
 * Verifica se o estudante cumpre todos os pré-requisitos para se inscrever numa UC.
 * No Ensino Superior, o estudante só se pode inscrever na UC se tiver obtido aprovação
 * (notaFinal >= 10 ou status === 'aprovado') em TODAS as UCs que constam de `uc.prerequisites`.
 */
export function checkPrerequisites(
  uc: UnidadeCurricular,
  studentInscricoes: InscricaoUC[],
  allUCs: UnidadeCurricular[] = []
): {
  allowed: boolean;
  missingPrerequisites: Array<{ id: string; code: string; name: string }>;
} {
  if (!uc.prerequisites || uc.prerequisites.length === 0) {
    return { allowed: true, missingPrerequisites: [] };
  }

  const approvedUCIds = new Set(
    studentInscricoes.filter(isApproved).map((i) => String(i.ucId))
  );

  const missing: Array<{ id: string; code: string; name: string }> = [];

  for (const prereqId of uc.prerequisites) {
    if (!approvedUCIds.has(String(prereqId))) {
      const prereqUC = allUCs.find((u) => String(u.id) === String(prereqId));
      missing.push({
        id: String(prereqId),
        code: prereqUC?.code || 'UC',
        name: prereqUC?.name || `Pré-requisito (${prereqId})`
      });
    }
  }

  return {
    allowed: missing.length === 0,
    missingPrerequisites: missing
  };
}

/**
 * 2. CADEIRAS EM ATRASO
 * Identifica as UCs de anos curriculares anteriores em que o estudante não obteve aprovação.
 */
export function calculateCadeirasEmAtraso(
  studentInscricoes: InscricaoUC[],
  currentCurricularYear: number
): InscricaoUC[] {
  // Uma UC já recuperada (aprovada numa inscrição posterior) deixa de estar em atraso.
  return latestResultPerUC(studentInscricoes).filter((i) => {
    if (i.year >= currentCurricularYear) return false;
    return !isApproved(i);
  });
}

export interface CadeiraEmFalta {
  ucId: string;
  code: string;
  name: string;
  year: number;
  creditsECTS: number;
  /** 'reprovada' = inscreveu-se e não aprovou; 'nunca_inscrita' = nunca se inscreveu. */
  motivo: 'reprovada' | 'nunca_inscrita';
}

/**
 * 2b. CADEIRAS EM ATRASO COM CATÁLOGO
 * Além das reprovadas, conta as UCs obrigatórias activas de anos anteriores a que o estudante nunca
 * se inscreveu (sem o catálogo do curso estas nunca apareciam como atraso).
 * Optativas e UCs inactivas não entram: não são exigidas a todos os estudantes.
 */
export function calculateCadeirasEmFalta(
  ucsDoCurso: UnidadeCurricular[],
  studentInscricoes: InscricaoUC[],
  currentCurricularYear: number
): CadeiraEmFalta[] {
  const resultados = latestResultPerUC(studentInscricoes);
  const aprovadas = new Set(resultados.filter(isApproved).map((i) => String(i.ucId)));
  const reprovadas = new Set(resultados.filter((i) => !isApproved(i)).map((i) => String(i.ucId)));

  const out: CadeiraEmFalta[] = [];
  const seen = new Set<string>();
  for (const uc of ucsDoCurso) {
    if (uc.status !== 'ativo' || uc.type !== 'obrigatoria') continue;
    if (uc.year >= currentCurricularYear) continue;
    const id = String(uc.id);
    if (aprovadas.has(id) || seen.has(id)) continue;
    seen.add(id);
    out.push({
      ucId: id,
      code: uc.code,
      name: uc.name,
      year: uc.year,
      creditsECTS: uc.creditsECTS,
      motivo: reprovadas.has(id) ? 'reprovada' : 'nunca_inscrita'
    });
  }
  // Reprovadas em UCs que já não constam do catálogo (ou optativas) continuam em atraso.
  for (const i of calculateCadeirasEmAtraso(studentInscricoes, currentCurricularYear)) {
    const id = String(i.ucId);
    if (seen.has(id)) continue;
    seen.add(id);
    out.push({ ucId: id, code: i.ucCode, name: i.ucName, year: i.year, creditsECTS: i.creditsECTS || 0, motivo: 'reprovada' });
  }
  return out;
}

export interface TransitionCheckResult {
  eligible: boolean;
  arrearsCount: number;
  arrearsECTS: number;
  reason?: string;
}

/**
 * 3. TRANSIÇÃO DE ANO CURRICULAR (CADEIRAS DE TRANSIÇÃO)
 * Em Angola (Regulamentos do MESCTI), um estudante do Ensino Superior pode transitar
 * para o ano seguinte com "Cadeiras de Transição" desde que não exceda o limite
 * regulamentar (por defeito: máximo 2 UCs em atraso OU 12 créditos ECTS em atraso).
 */
export function checkYearTransitionEligibility(
  studentInscricoes: InscricaoUC[],
  targetCurricularYear: number,
  maxArrearsAllowed = 2,
  maxECTSArrearsAllowed = 12,
  /** Catálogo de UCs do curso: quando indicado, UCs obrigatórias nunca inscritas também contam como atraso. */
  ucsDoCurso?: UnidadeCurricular[]
): TransitionCheckResult {
  if (targetCurricularYear <= 1) {
    return { eligible: true, arrearsCount: 0, arrearsECTS: 0 };
  }

  // UCs de todos os anos anteriores ao ano pretendido
  const arrears: Array<{ creditsECTS?: number }> = ucsDoCurso
    ? calculateCadeirasEmFalta(ucsDoCurso, studentInscricoes, targetCurricularYear)
    : calculateCadeirasEmAtraso(studentInscricoes, targetCurricularYear);
  const arrearsCount = arrears.length;
  const arrearsECTS = arrears.reduce((sum, item) => sum + (item.creditsECTS || 0), 0);

  if (arrearsCount > maxArrearsAllowed) {
    return {
      eligible: false,
      arrearsCount,
      arrearsECTS,
      reason: `Excede o limite máximo de ${maxArrearsAllowed} cadeiras em atraso (tem ${arrearsCount} em atraso). Fica retido no ano curricular anterior.`
    };
  }

  if (arrearsECTS > maxECTSArrearsAllowed) {
    return {
      eligible: false,
      arrearsCount,
      arrearsECTS,
      reason: `Excede o limite de ${maxECTSArrearsAllowed} ECTS em atraso (tem ${arrearsECTS} ECTS acumulados).`
    };
  }

  return {
    eligible: true,
    arrearsCount,
    arrearsECTS,
    reason: arrearsCount > 0 ? `Transita com ${arrearsCount} cadeira(s) de transição (${arrearsECTS} ECTS).` : undefined
  };
}

/**
 * 4. MÉDIA PONDERADA POR CRÉDITOS ECTS
 * Fórmula oficial: Σ (Nota_i × ECTS_i) / Σ (ECTS_i)
 */
export function calculateWeightedAverageECTS(
  grades: Array<{ grade?: number | null; creditsECTS: number }>
): { average: number; totalECTS: number } {
  let weightedSum = 0;
  let totalECTS = 0;

  for (const item of grades) {
    if (typeof item.grade === 'number' && !Number.isNaN(item.grade) && item.creditsECTS > 0) {
      weightedSum += item.grade * item.creditsECTS;
      totalECTS += item.creditsECTS;
    }
  }

  if (totalECTS === 0) return { average: 0, totalECTS: 0 };
  const avg = Math.round((weightedSum / totalECTS) * 100) / 100;
  return { average: avg, totalECTS };
}

/**
 * 5. MENÇÃO QUALITATIVA OFICIAL (MESCTI)
 * Escala de 0 a 20 valores:
 * 10 – 13: Suficiente
 * 14 – 15: Bom
 * 16 – 17: Muito Bom
 * 18 – 19: Excelente / Distinção
 * 20: Distinção e Louvor
 */
export function qualitativeMentionMESCTI(
  grade: number
): 'Suficiente' | 'Bom' | 'Muito Bom' | 'Excelente' | 'Com Distinção' | 'Distinção e Louvor' {
  const rounded = Math.round(grade);
  if (rounded >= 20) return 'Distinção e Louvor';
  if (rounded >= 18) return 'Excelente';
  if (rounded >= 16) return 'Muito Bom';
  if (rounded >= 14) return 'Bom';
  return 'Suficiente';
}

/**
 * 6. MÉDIA FINAL DO CURSO (Conclusão de Licenciatura / Mestrado)
 * Ponderação entre a Componente Curricular das UCs (geralmente 75% ou 80%)
 * e a Defesa da Monografia / TCC / Estágio (geralmente 25% ou 20%).
 */
export function calculateCourseFinalGrade(
  curricularWeightedAverage: number,
  tccGrade?: number | null,
  curricularWeight = 0.75,
  tccWeight = 0.25,
  tccRequired = false
): {
  finalGrade: number;
  finalMention: 'Suficiente' | 'Bom' | 'Muito Bom' | 'Excelente' | 'Com Distinção' | 'Distinção e Louvor';
  approved: boolean;
  reason?: string;
} {
  const hasTcc = isNum(tccGrade);
  let finalGrade = curricularWeightedAverage;
  let approved = curricularWeightedAverage >= NOTA_APROVACAO;
  let reason: string | undefined;

  if (hasTcc) {
    const tcc = clamp20(tccGrade as number);
    if (tcc < NOTA_APROVACAO) {
      approved = false;
      reason = `TCC reprovado (${tcc} valores): o curso não pode ser concluído.`;
    } else {
      finalGrade = curricularWeightedAverage * curricularWeight + tcc * tccWeight;
    }
  } else if (tccRequired) {
    approved = false;
    reason = 'Falta a defesa do TCC.';
  }
  if (approved === false && !reason) reason = 'Média curricular inferior a 10 valores.';

  const rounded = Math.round(finalGrade * 10) / 10;
  return { finalGrade: rounded, finalMention: qualitativeMentionMESCTI(rounded), approved, reason };
}

/**
 * 6b. ELEGIBILIDADE PARA EMITIR DIPLOMA
 * Só se emite diploma com: todas as UCs obrigatórias activas do curso aprovadas, o total de ECTS exigido
 * (quando indicado), estágios concluídos e aprovados, e o TCC defendido com nota >= 10 (se existir registo).
 */
export function checkDiplomaEligibility(input: {
  ucsDoCurso: UnidadeCurricular[];
  inscricoes: InscricaoUC[];
  tcc?: MonografiaTCC | null;
  estagios?: EstagioCurricular[];
  requiredECTS?: number;
  tccRequired?: boolean;
}): { eligible: boolean; reasons: string[]; missingUCs: UnidadeCurricular[]; totalECTS: number } {
  const resultados = latestResultPerUC(input.inscricoes);
  const aprovadas = new Set(resultados.filter(isApproved).map((i) => String(i.ucId)));
  const totalECTS = resultados.filter(isApproved).reduce((sum, i) => sum + (i.creditsECTS || 0), 0);

  const obrigatorias = input.ucsDoCurso.filter((u) => u.status === 'ativo' && u.type === 'obrigatoria');
  const missingUCs = obrigatorias.filter((u) => !aprovadas.has(String(u.id)));
  const reasons: string[] = [];

  if (obrigatorias.length === 0) reasons.push('O curso não tem UCs obrigatórias registadas.');
  if (missingUCs.length > 0) {
    reasons.push(`Faltam ${missingUCs.length} UC(s) obrigatória(s): ${missingUCs.map((u) => u.code).join(', ')}.`);
  }
  if (isNum(input.requiredECTS) && totalECTS < input.requiredECTS) {
    reasons.push(`ECTS insuficientes: ${totalECTS} de ${input.requiredECTS}.`);
  }
  for (const e of input.estagios || []) {
    if (e.status !== 'concluido') reasons.push(`Estágio ${e.code} não está concluído.`);
    else if (isNum(e.finalGrade) && e.finalGrade < NOTA_APROVACAO) reasons.push(`Estágio ${e.code} com nota inferior a 10.`);
    else if (e.completedHours < e.totalRequiredHours) reasons.push(`Estágio ${e.code}: ${e.completedHours}h de ${e.totalRequiredHours}h.`);
  }
  if (input.tcc) {
    if (input.tcc.status !== 'defendido') reasons.push('O TCC ainda não foi defendido.');
    else if (!isNum(input.tcc.defenseGrade) || input.tcc.defenseGrade < NOTA_APROVACAO) reasons.push('TCC sem nota de defesa aprovada.');
  } else if (input.tccRequired) {
    reasons.push('Falta registo do TCC.');
  }
  return { eligible: reasons.length === 0, reasons, missingUCs, totalECTS };
}

/**
 * 6c. MANUTENÇÃO DE BOLSA
 * Uma bolsa só se mantém se a média ponderada for >= `minAverageRequired` e as cadeiras em atraso
 * não excederem `maxArrearsAllowed`.
 */
export function checkScholarshipMaintenance(
  bolsa: Pick<BolsaEstudo, 'minAverageRequired' | 'maxArrearsAllowed'>,
  weightedAverage: number,
  arrearsCount: number
): { maintained: boolean; reasons: string[] } {
  const reasons: string[] = [];
  if (weightedAverage < bolsa.minAverageRequired) {
    reasons.push(`Média ${weightedAverage} inferior ao mínimo exigido (${bolsa.minAverageRequired}).`);
  }
  if (arrearsCount > bolsa.maxArrearsAllowed) {
    reasons.push(`${arrearsCount} cadeira(s) em atraso; o máximo permitido é ${bolsa.maxArrearsAllowed}.`);
  }
  return { maintained: reasons.length === 0, reasons };
}

/** Média ponderada por ECTS do histórico do estudante (1 resultado por UC, só aprovadas). */
export function calculateCurricularAverage(inscricoes: InscricaoUC[]): { average: number; totalECTS: number } {
  const aprovadas = latestResultPerUC(inscricoes).filter(isApproved);
  return calculateWeightedAverageECTS(aprovadas.map((i) => ({ grade: i.notaFinal, creditsECTS: i.creditsECTS })));
}

/**
 * 7. PROPINAS POR ECTS E BOLSAS DE ESTUDO
 * Calcula a propina líquida com base nos créditos inscritos e na comparticipação da bolsa.
 */
export function calculateSuperiorTuition(
  enrolledECTS: number,
  pricePerECTS: number,
  scholarship?: BolsaEstudo | null,
  fixedSemesterBaseKz = 0,
  /** Meses que a propina cobre. A bolsa de montante fixo é mensal, por isso multiplica-se por este valor. */
  monthsCovered = 1
): {
  grossAmountKz: number;
  discountAmountKz: number;
  netAmountKz: number;
  scholarshipName?: string;
  notes: string[];
} {
  const ectsTotal = Math.max(0, enrolledECTS) * Math.max(0, pricePerECTS);
  const grossAmountKz = fixedSemesterBaseKz > 0 ? fixedSemesterBaseKz + ectsTotal : ectsTotal;
  let discountAmountKz = 0;
  const notes: string[] = [];

  if (scholarship && scholarship.status === 'ativa') {
    if (scholarship.coverageType === 'integral_100') {
      discountAmountKz = grossAmountKz;
      notes.push(`Bolsa 100% (${scholarship.sponsorName}): isenção total`);
    } else if (scholarship.coverageType === 'montante_fixo' && scholarship.fixedMonthlyAmountKz) {
      discountAmountKz = Math.min(grossAmountKz, scholarship.fixedMonthlyAmountKz * Math.max(1, monthsCovered));
      notes.push(`Bolsa Montante Fixo: dedução de ${discountAmountKz.toLocaleString('pt-PT')} Kz`);
    } else {
      const pct = scholarship.discountPercent || 50;
      discountAmountKz = Math.round((grossAmountKz * pct) / 100);
      notes.push(`Bolsa Parcial ${pct}% (${scholarship.sponsorName}): dedução de ${discountAmountKz.toLocaleString('pt-PT')} Kz`);
    }
  }

  const netAmountKz = Math.max(0, grossAmountKz - discountAmountKz);

  return {
    grossAmountKz,
    discountAmountKz,
    netAmountKz,
    scholarshipName: scholarship?.sponsorName,
    notes
  };
}

/**
 * 8. NUMERAÇÃO DE DIPLOMAS
 * Próximo número de registo do ano = maior número já usado nesse ano + 1 (não depende de quantos
 * registos existem, por isso não repete depois de apagar). Anulados contam: o número de um diploma
 * anulado não se reutiliza.
 */
export function nextDiplomaSequence(diplomas: Array<Pick<DiplomaSuperior, 'registerNumber'>>, year: number): number {
  const used = diplomas
    .filter((d) => (d.registerNumber || '').endsWith(`/${year}`))
    .map((d) => parseInt(d.registerNumber, 10) || 0);
  return (used.length ? Math.max(...used) : 0) + 1;
}

/** Número de registo `N/AAAA` livre; se o pedido já existir, devolve o próximo livre. */
export function allocateRegisterNumber(
  diplomas: Array<Pick<DiplomaSuperior, 'registerNumber'>>,
  year: number,
  requested?: string
): string {
  const taken = new Set(diplomas.map((d) => d.registerNumber));
  if (requested && !taken.has(requested)) return requested;
  return `${nextDiplomaSequence(diplomas, year)}/${year}`;
}

/**
 * 9. EQUIVALÊNCIAS E TRANSFERÊNCIAS
 * Reconhece como aprovada uma UC feita noutra instituição ou curso. A UC passa a contar para
 * precedências, atrasos, ECTS e diploma. A nota só entra na média se `contaParaMedia` e existir nota;
 * sem nota a UC conta ECTS mas não altera a média.
 */
export function buildEquivalencia(input: {
  uc: UnidadeCurricular;
  student: { id: string; name: string; procNumber?: string };
  academicYear: string;
  equivalencia: EquivalenciaUC;
  existing: InscricaoUC[];
}): { ok: true; inscricao: Omit<InscricaoUC, 'id'> } | { ok: false; error: string } {
  const { uc, student, equivalencia } = input;
  if (!equivalencia.instituicaoOrigem || !equivalencia.instituicaoOrigem.trim()) {
    return { ok: false, error: 'Indique a instituição ou curso de origem.' };
  }
  const hasNota = equivalencia.notaOrigem !== undefined && equivalencia.notaOrigem !== null;
  if (hasNota && (!isNum(equivalencia.notaOrigem) || equivalencia.notaOrigem < 0 || equivalencia.notaOrigem > 20)) {
    return { ok: false, error: 'A nota de origem tem de estar entre 0 e 20.' };
  }
  if (hasNota && (equivalencia.notaOrigem as number) < NOTA_APROVACAO) {
    return { ok: false, error: 'Só se reconhece equivalência a UCs aprovadas (nota de origem >= 10).' };
  }
  if (equivalencia.contaParaMedia && !hasNota) {
    return { ok: false, error: 'Para contar na média é preciso indicar a nota de origem.' };
  }
  const jaAprovada = input.existing.some(
    (i) => String(i.studentId) === String(student.id) && String(i.ucId) === String(uc.id) && isApproved(i)
  );
  if (jaAprovada) {
    return { ok: false, error: `O estudante já tem aprovação na UC ${uc.code}.` };
  }
  const entraNaMedia = !!equivalencia.contaParaMedia && hasNota;
  return {
    ok: true,
    inscricao: {
      studentId: student.id,
      studentName: student.name,
      studentProcNumber: student.procNumber || 'S/N',
      courseId: uc.courseId,
      courseName: uc.courseName,
      ucId: uc.id,
      ucCode: uc.code,
      ucName: uc.name,
      academicYear: input.academicYear,
      year: uc.year,
      semester: uc.semester === 'anual' ? 1 : uc.semester,
      creditsECTS: uc.creditsECTS,
      isCadeiraAtraso: false,
      status: 'aprovado',
      notaFinal: entraNaMedia ? Math.round((equivalencia.notaOrigem as number) * 10) / 10 : undefined,
      epocaAprovacao: 'equivalencia',
      equivalencia: { ...equivalencia, instituicaoOrigem: equivalencia.instituicaoOrigem.trim(), contaParaMedia: entraNaMedia },
      inscribedAt: new Date().toISOString(),
      observations: `Equivalência — ${equivalencia.instituicaoOrigem.trim()}${equivalencia.despacho ? ` (${equivalencia.despacho})` : ''}`
    }
  };
}
