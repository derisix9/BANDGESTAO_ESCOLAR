/**
 * Ano letivo corrente calculado a partir da data do sistema (Setembro marca o início de
 * um novo ano letivo em Angola). Serve apenas de recurso quando as Configurações ainda
 * não têm "Ano Letivo Ativo" definido — nunca um ano fixo no código como "2024/2025",
 * que envelhece e passa a mostrar anos errados no cabeçalho dos documentos oficiais.
 */
export function getFallbackAcademicYear(reference: Date = new Date()): string {
  const start = reference.getMonth() >= 8 ? reference.getFullYear() : reference.getFullYear() - 1;
  return `${start}/${start + 1}`;
}

/** Lista de anos letivos sugeridos (anterior, corrente e seguinte) para seletores. */
export function getFallbackAcademicYearOptions(reference: Date = new Date()): string[] {
  const start = reference.getMonth() >= 8 ? reference.getFullYear() : reference.getFullYear() - 1;
  return [`${start}/${start + 1}`, `${start - 1}/${start}`, `${start + 1}/${start + 2}`];
}

/** Ano de início de um Ano Lectivo "2026/2027" → 2026 (NaN se o formato for inválido). */
export function academicYearStart(year?: string | null): number {
  return parseInt(String(year || '').split('/')[0], 10);
}

/** Ordena Anos Lectivos do mais recente para o mais antigo. */
export function compareAcademicYearsDesc(a: string, b: string): number {
  return (academicYearStart(b) || 0) - (academicYearStart(a) || 0);
}

/**
 * Lista de Anos Lectivos construída SÓ com anos que existem na base de dados: o ano ativo,
 * os anos configurados/arquivados em Configurações > Ano Letivo e os que o chamador
 * acrescentar (ex.: anos em que o aluno tem matrícula ou notas). Nunca inventa anos.
 */
export function buildAcademicYearList(
  settings: { currentAcademicYear?: string; availableAcademicYears?: string[]; academicYearHistory?: Array<{ academicYear: string }> } | undefined,
  extra: Array<string | undefined | null> = [],
  options: { includeInstitutionYears?: boolean } = {}
): string[] {
  const includeInstitution = options.includeInstitutionYears !== false;
  const set = new Set<string>();
  const add = (y?: string | null) => {
    if (y && /^\d{4}\/\d{4}$/.test(y.trim())) set.add(y.trim());
  };
  add(settings?.currentAcademicYear);
  if (includeInstitution) {
    (settings?.availableAcademicYears || []).forEach(add);
    (settings?.academicYearHistory || []).forEach((h) => add(h.academicYear));
  }
  extra.forEach(add);
  return Array.from(set).sort(compareAcademicYearsDesc);
}

export type AcademicYearStatus = 'corrente' | 'historico' | 'proximo';

/** Relação de um Ano Lectivo com o Ano Lectivo Ativo: corrente, já passado ou futuro. */
export function getAcademicYearStatus(year: string, currentYear: string): AcademicYearStatus {
  if (year === currentYear) return 'corrente';
  const y = academicYearStart(year);
  const c = academicYearStart(currentYear);
  if (Number.isNaN(y) || Number.isNaN(c)) return 'historico';
  return y > c ? 'proximo' : 'historico';
}

export function academicYearStatusLabel(status: AcademicYearStatus): string {
  return status === 'corrente' ? 'Ano Corrente' : status === 'proximo' ? 'Próximo Ano' : 'Histórico';
}

const PT_MONTHS: Record<string, number> = {
  jan: 0, fev: 1, mar: 2, abr: 3, mai: 4, jun: 5,
  jul: 6, ago: 7, set: 8, out: 9, nov: 10, dez: 11
};

/**
 * Interpreta datas no formato usado em Configurações > Ano Letivo ("13 Dez 2024",
 * "02 Set 2024"). Devolve null se o texto não corresponder a esse formato — nunca
 * lança exceção, para que um valor mal formatado apenas deixe de ser aplicado em vez
 * de rebentar o ecrã.
 */
export function parsePtDate(text?: string | null): Date | null {
  if (!text) return null;
  const match = text.trim().match(/^(\d{1,2})\s+([A-Za-zçÇ]{3,})\.?\s+(\d{4})$/);
  if (!match) return null;
  const day = parseInt(match[1], 10);
  const monthKey = match[2]
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .slice(0, 3);
  const month = PT_MONTHS[monthKey];
  const year = parseInt(match[3], 10);
  if (month === undefined || Number.isNaN(day) || Number.isNaN(year)) return null;
  const parsed = new Date(year, month, day);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

/** Soma N dias úteis (segunda a sexta) a uma data, ignorando fins de semana. */
export function addBusinessDays(start: Date, businessDays: number): Date {
  const result = new Date(start);
  let remaining = Math.max(0, Math.floor(businessDays));
  while (remaining > 0) {
    result.setDate(result.getDate() + 1);
    const day = result.getDay();
    if (day !== 0 && day !== 6) remaining -= 1;
  }
  return result;
}

/** Resultado de uma verificação de trancamento: se a ação está bloqueada e, se sim, porquê
 * (motivo pronto a mostrar ao utilizador em Assiduidade, Pautas ou Homologação). */
export interface AcademicLockInfo {
  locked: boolean;
  reason?: string;
}

type MinimalTrimesterSettings = {
  trimesterSchedules?: {
    t1?: { startDate?: string; endDate?: string; closed?: boolean };
    t2?: { startDate?: string; endDate?: string; closed?: boolean };
    t3?: { startDate?: string; endDate?: string; closed?: boolean };
  };
  academicLockingRules?: {
    bloqueioSumarios?: boolean;
    toleranciaSumariosHoras?: number;
    toleranciaNotas?: boolean;
    janelaLancamentoNotasDias?: number;
    chaveFecho?: boolean;
  };
};

/** Identifica em que Trimestre (1, 2 ou 3) cai uma determinada data, com base nas datas de
 * início/término definidas em Configurações > Ano Letivo > Estrutura Curricular. Devolve null
 * se a data não cair dentro de nenhum trimestre configurado (ou se nada foi definido ainda). */
export function findTrimesterKeyForDate(
  settings: MinimalTrimesterSettings | undefined,
  dateStr?: string | null
): '1' | '2' | '3' | null {
  if (!settings?.trimesterSchedules || !dateStr) return null;
  const target = new Date(dateStr);
  if (Number.isNaN(target.getTime())) return null;

  const pairs: Array<['1' | '2' | '3', 't1' | 't2' | 't3']> = [
    ['1', 't1'],
    ['2', 't2'],
    ['3', 't3']
  ];
  for (const [num, key] of pairs) {
    const sched = settings.trimesterSchedules[key];
    const start = parsePtDate(sched?.startDate);
    const end = parsePtDate(sched?.endDate);
    if (start && end && target.getTime() >= start.getTime() && target.getTime() <= end.getTime()) {
      return num;
    }
  }
  return null;
}

/**
 * Verifica se um sumário de aula com a data indicada ainda pode ser editado, segundo as
 * Regras de Trancamento definidas em Configurações > Ano Letivo:
 *  1. Se o Trimestre a que a data pertence já foi Encerrado ("Encerrar"), fica sempre bloqueado.
 *  2. Caso contrário, se o "Bloqueio Automático de Sumários" estiver ativo, bloqueia depois de
 *     decorridas as horas de tolerância configuradas (48h por omissão) desde o fim do dia da aula.
 * Usado pela Assiduidade Diária para impedir professores de editar aulas fora de prazo — a
 * Direção Pedagógica e a Administração continuam a poder editar sempre (ver canBypassScheduleLock).
 */
export function getSummaryLockInfo(
  settings: MinimalTrimesterSettings | undefined,
  lessonDateStr?: string | null
): AcademicLockInfo {
  if (!settings || !lessonDateStr) return { locked: false };

  const trimKey = findTrimesterKeyForDate(settings, lessonDateStr);
  if (trimKey) {
    const schedKey = ('t' + trimKey) as 't1' | 't2' | 't3';
    if (settings.trimesterSchedules?.[schedKey]?.closed) {
      return {
        locked: true,
        reason: `O ${trimKey}.º Trimestre foi oficialmente encerrado pela Direção Pedagógica — já não é possível editar sumários com data dentro deste período.`
      };
    }
  }

  const rules = settings.academicLockingRules;
  if (rules?.bloqueioSumarios) {
    const toleranceHours = rules.toleranciaSumariosHoras ?? 48;
    const lessonDate = new Date(lessonDateStr);
    if (!Number.isNaN(lessonDate.getTime())) {
      const deadline = new Date(lessonDate);
      deadline.setHours(23, 59, 59, 999);
      deadline.setTime(deadline.getTime() + toleranceHours * 60 * 60 * 1000);
      if (Date.now() > deadline.getTime()) {
        return {
          locked: true,
          reason: `Prazo de tolerância de ${toleranceHours}h para editar o sumário desta aula já expirou.`
        };
      }
    }
  }

  return { locked: false };
}

/**
 * Verifica se o lançamento de notas (MAC/NPP/NPT) do Trimestre indicado ainda está dentro do
 * prazo, segundo as Regras de Trancamento definidas em Configurações > Ano Letivo:
 *  1. Se o Trimestre já foi Encerrado, o lançamento fica sempre bloqueado.
 *  2. Caso contrário, se o "Prazo de Lançamento de Provas" estiver ativo, bloqueia depois de
 *     decorrida a janela de dias úteis configurada (5 dias por omissão) a partir do Término
 *     Letivo desse trimestre.
 * Usado pelas Pautas/Mini-Pautas e pela Homologação para impedir lançamentos fora de prazo.
 */
export function getGradeLaunchLockInfo(
  settings: MinimalTrimesterSettings | undefined,
  trimester?: '1' | '2' | '3' | null
): AcademicLockInfo {
  if (!settings || !trimester) return { locked: false };

  const schedKey = ('t' + trimester) as 't1' | 't2' | 't3';
  const sched = settings.trimesterSchedules?.[schedKey];
  if (sched?.closed) {
    return {
      locked: true,
      reason: `O ${trimester}.º Trimestre foi encerrado e trancado pela Direção Pedagógica — o lançamento de notas está bloqueado.`
    };
  }

  const rules = settings.academicLockingRules;
  if (rules?.toleranciaNotas) {
    const windowDays = rules.janelaLancamentoNotasDias ?? 5;
    const baseDate = parsePtDate(sched?.endDate);
    if (baseDate) {
      const deadline = addBusinessDays(baseDate, windowDays);
      deadline.setHours(23, 59, 59, 999);
      if (Date.now() > deadline.getTime()) {
        return {
          locked: true,
          reason: `A janela de ${windowDays} dias úteis para lançar notas do ${trimester}.º Trimestre já expirou.`
        };
      }
    }
  }

  return { locked: false };
}

/**
 * Feriados Oficiais fixos da República de Angola, com datas reais posicionadas dentro
 * do Ano Letivo indicado (Setembro do 1.º ano a Agosto do 2.º ano) — usados para
 * inicializar/sincronizar Configurações > Ano Letivo > Feriados Oficiais quando a
 * instituição ainda não os tem registados na base de dados.
 */
export function getDefaultAngolaHolidays(academicYear: string): { date: string; name: string; trimestre: string }[] {
  const [y1Str, y2Str] = (academicYear || '').split('/');
  const y1 = parseInt(y1Str, 10) || new Date().getFullYear();
  const y2 = parseInt(y2Str, 10) || y1 + 1;

  const iso = (year: number, month: number, day: number) =>
    `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;

  return [
    { year: y1, month: 8, day: 17, name: 'Dia do Herói Nacional', trimestre: '1.º Trimestre' },
    { year: y1, month: 10, day: 2, name: 'Dia dos Finados', trimestre: '1.º Trimestre' },
    { year: y1, month: 10, day: 11, name: 'Dia da Independência Nacional', trimestre: '1.º Trimestre' },
    { year: y1, month: 11, day: 25, name: 'Natal', trimestre: '1.º Trimestre' },
    { year: y2, month: 0, day: 1, name: 'Ano Novo', trimestre: '2.º Trimestre' },
    { year: y2, month: 1, day: 4, name: 'Início da Luta Armada de Libertação Nacional', trimestre: '2.º Trimestre' },
    { year: y2, month: 2, day: 8, name: 'Dia Internacional da Mulher', trimestre: '2.º Trimestre' },
    { year: y2, month: 3, day: 4, name: 'Dia da Paz e Reconciliação Nacional', trimestre: '2.º Trimestre' },
    { year: y2, month: 4, day: 1, name: 'Dia do Trabalhador', trimestre: '3.º Trimestre' },
    { year: y2, month: 4, day: 25, name: 'Dia de África', trimestre: '3.º Trimestre' },
    { year: y2, month: 5, day: 1, name: 'Dia Internacional da Criança', trimestre: '3.º Trimestre' }
  ].map(({ year, month, day, name, trimestre }) => ({ date: iso(year, month, day), name, trimestre }));
}

/**
 * Anos Lectivos para seletores de uma instituição: só os que estão cadastrados (ano ativo,
 * anos configurados/arquivados) mais os que o chamador acrescentar a partir de registos
 * existentes. Só se a instituição ainda não tiver nenhum é que usa o ano calculado pela data.
 */
export function institutionAcademicYears(
  settings: Parameters<typeof buildAcademicYearList>[0],
  extra: Array<string | undefined | null> = []
): string[] {
  const list = buildAcademicYearList(settings, extra);
  return list.length > 0 ? list : [getFallbackAcademicYear()];
}
