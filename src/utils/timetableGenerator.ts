import { SchoolDatabase, ClassRoom, Subject, TimetableEntry } from '../types';
import { resolveTeacherForSubject } from './subjectTeacherResolver';

/**
 * Gerador Automático de Horários Escolares.
 *
 * Distribui as disciplinas de uma turma pelos tempos lectivos de Segunda a
 * Sexta-feira respeitando:
 *   1. A quantidade de aulas de cada disciplina = exactamente a sua carga
 *      horária semanal (Subject.weeklyHours) — nunca a mais, nunca a menos.
 *   2. Distribuição semi-aleatória e equilibrada ao longo da semana (evita
 *      concentrar a mesma disciplina no mesmo dia, evita aulas consecutivas
 *      da mesma disciplina, evita fixar sempre o 1º ou o último tempo, e
 *      procura equilibrar o uso de todos os tempos disponíveis).
 *   3. Apenas os tempos lectivos já configurados para a turma (nunca inventa
 *      tempos novos).
 *   4. Conflitos de professor: nunca aloca um docente que já esteja a dar
 *      aula a outra turma no mesmo dia/tempo lectivo (verifica a Grelha
 *      Horária global antes de confirmar) — quando o tempo preferido está
 *      ocupado pelo docente, a aula é deslocada para outro tempo livre.
 */

export interface TimetableSlot {
  start: string;
  end: string;
}

export interface GeneratedTimetableResult {
  /** Novas entradas prontas a gravar com dbService.setTimetableForClass(...) */
  entries: Omit<TimetableEntry, 'id' | 'classId'>[];
  /** Avisos (ex.: carga horária a mais para os tempos disponíveis, docente
   * indisponível em todos os tempos livres, etc.) para mostrar ao utilizador. */
  warnings: string[];
}

const DIAS: TimetableEntry['dayOfWeek'][] = [
  'Segunda-feira',
  'Terça-feira',
  'Quarta-feira',
  'Quinta-feira',
  'Sexta-feira'
];

function norm(text: string): string {
  return (text || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim();
}

/** Fisher-Yates — baralha uma cópia do array, nunca o original. */
function shuffle<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export function generateClassTimetable(
  db: SchoolDatabase,
  cls: ClassRoom,
  subjectsForClass: Subject[],
  slots: TimetableSlot[]
): GeneratedTimetableResult {
  const warnings: string[] = [];
  const numPeriods = slots.length;
  const totalWeeklySlots = numPeriods * DIAS.length;

  // Só entram no gerador disciplinas com carga horária semanal real definida.
  const activeSubjects = subjectsForClass.filter((s) => (s.weeklyHours || 0) > 0);
  if (activeSubjects.length === 0 || numPeriods === 0) {
    return {
      entries: [],
      warnings: ['Não existem disciplinas com carga horária semanal definida para esta turma.']
    };
  }

  const totalNeeded = activeSubjects.reduce((sum, s) => sum + (s.weeklyHours || 0), 0);
  if (totalNeeded > totalWeeklySlots) {
    warnings.push(
      `A soma da carga horária semanal das disciplinas desta turma (${totalNeeded} tempos) ` +
        `excede os ${totalWeeklySlots} tempos lectivos disponíveis na semana. Nem todas as aulas ` +
        `couberam na grelha — ajuste a carga horária das disciplinas ou os tempos da turma.`
    );
  }

  // Docente responsável por cada disciplina (mesma resolução usada em toda a
  // aplicação: grelha existente → alocação do docente → coordenador → área).
  const teacherOf = new Map<string, string>();
  activeSubjects.forEach((s) => teacherOf.set(s.id, resolveTeacherForSubject(db, s, cls.id) || ''));

  // Grelha desta turma: grid[dia][tempo] = id da disciplina ou null (livre).
  const grid: (string | null)[][] = DIAS.map(() => new Array(numPeriods).fill(null));

  // Tempos já ocupados por cada docente NOUTRAS turmas — nunca colocar o
  // mesmo professor em dois sítios ao mesmo tempo.
  const otherEntries = (db.timetable || []).filter((t) => String(t.classId) !== String(cls.id));
  const teacherBusy = (dayIndex: number, periodIndex: number, teacherName: string): boolean => {
    if (!teacherName) return false;
    const slot = slots[periodIndex];
    const day = DIAS[dayIndex];
    return otherEntries.some(
      (e) => e.dayOfWeek === day && e.timeStart === slot.start && norm(e.teacherName) === norm(teacherName)
    );
  };

  // Disciplinas com maior carga horária primeiro — são as mais difíceis de
  // encaixar sem concentrar ou entrar em conflito, por isso ganham prioridade
  // enquanto a grelha ainda está mais livre.
  const ordered = [...activeSubjects].sort((a, b) => (b.weeklyHours || 0) - (a.weeklyHours || 0));

  for (const subject of ordered) {
    const teacherName = teacherOf.get(subject.id) || '';
    let remaining = subject.weeklyHours || 0;
    if (remaining <= 0) continue;

    // Máximo de aulas desta disciplina por dia, para nunca concentrar tudo no
    // mesmo dia (ex.: 5 tempos/semana → no máx. 1 por dia; 8 tempos/semana →
    // no máx. 2 por dia).
    const maxPerDay = Math.max(1, Math.ceil(remaining / DIAS.length));

    const perDayCount = new Array(DIAS.length).fill(0);
    // Tempos (períodos) já usados por esta disciplina nesta semana — para não
    // ficar sempre presa ao mesmo tempo (ex.: sempre no 1º tempo).
    const usedPeriods = new Set<number>();

    let attempts = 0;
    const maxAttempts = (remaining + 1) * DIAS.length * numPeriods * 3;

    while (remaining > 0 && attempts < maxAttempts) {
      attempts++;
      // Dias candidatos: os menos carregados por esta disciplina primeiro
      // (equilibra a distribuição), com uma ordem aleatória para desempatar,
      // para que a mesma disciplina não caia sempre nos mesmos dias da semana.
      const dayOrder = shuffle(DIAS.map((_, i) => i)).sort((a, b) => perDayCount[a] - perDayCount[b]);

      let placed = false;
      for (const dayIndex of dayOrder) {
        if (perDayCount[dayIndex] >= maxPerDay) continue;

        // Tempos livres nesse dia, preferindo os que esta disciplina ainda não
        // usou nenhuma vez na semana e evitando o 1º/último tempo do dia
        // quando há alternativa.
        const periodCandidates = shuffle(
          Array.from({ length: numPeriods }, (_, i) => i).filter((p) => grid[dayIndex][p] === null)
        ).sort((a, b) => {
          const aUsed = usedPeriods.has(a) ? 1 : 0;
          const bUsed = usedPeriods.has(b) ? 1 : 0;
          if (aUsed !== bUsed) return aUsed - bUsed;
          const aIsEdge = a === 0 || a === numPeriods - 1 ? 1 : 0;
          const bIsEdge = b === 0 || b === numPeriods - 1 ? 1 : 0;
          return aIsEdge - bIsEdge;
        });

        for (const periodIndex of periodCandidates) {
          // Nunca duas aulas seguidas da mesma disciplina no mesmo dia.
          const prevSame = periodIndex > 0 && grid[dayIndex][periodIndex - 1] === subject.id;
          const nextSame = periodIndex < numPeriods - 1 && grid[dayIndex][periodIndex + 1] === subject.id;
          if (prevSame || nextSame) continue;

          // Conflito de professor com outra turma no mesmo dia/tempo.
          if (teacherBusy(dayIndex, periodIndex, teacherName)) continue;

          grid[dayIndex][periodIndex] = subject.id;
          perDayCount[dayIndex]++;
          usedPeriods.add(periodIndex);
          remaining--;
          placed = true;
          break;
        }
        if (placed) break;
      }

      if (!placed) {
        // As regras "suaves" (dia menos carregado, sem consecutivas, sem
        // extremos) não encontraram tempo — tenta apenas com a regra
        // inegociável (sem conflito de professor) antes de desistir desta aula.
        let relaxedPlaced = false;
        for (let dayIndex = 0; dayIndex < DIAS.length && !relaxedPlaced; dayIndex++) {
          for (let periodIndex = 0; periodIndex < numPeriods; periodIndex++) {
            if (grid[dayIndex][periodIndex] !== null) continue;
            if (teacherBusy(dayIndex, periodIndex, teacherName)) continue;
            grid[dayIndex][periodIndex] = subject.id;
            perDayCount[dayIndex]++;
            usedPeriods.add(periodIndex);
            remaining--;
            relaxedPlaced = true;
            break;
          }
        }
        if (!relaxedPlaced) break; // não há mesmo nenhum tempo livre e sem conflito
      }
    }

    if (remaining > 0) {
      warnings.push(
        `Não foi possível alocar ${remaining} de ${subject.weeklyHours} tempo(s) de "${subject.name}"` +
          (teacherName ? ` — o docente ${teacherName} já está ocupado noutra turma nos tempos livres restantes.` : ' — faltam tempos livres na grelha.')
      );
    }
  }

  const entries: Omit<TimetableEntry, 'id' | 'classId'>[] = [];
  DIAS.forEach((day, dayIndex) => {
    slots.forEach((slot, periodIndex) => {
      const subjectId = grid[dayIndex][periodIndex];
      if (!subjectId) return;
      const subject = activeSubjects.find((s) => s.id === subjectId);
      if (!subject) return;
      entries.push({
        dayOfWeek: day,
        timeStart: slot.start,
        timeEnd: slot.end,
        subject: subject.name,
        teacherName: teacherOf.get(subject.id) || '',
        room: cls.room || ''
      });
    });
  });

  return { entries, warnings };
}
