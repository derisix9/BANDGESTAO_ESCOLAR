/**
 * Transferências, equivalências e disciplinas em atraso — regras puras (sem acesso à base de dados),
 * para poderem ser testadas e reutilizadas na interface.
 */
import type { StudentTrimesterRecord } from '../types';
import type {
  StudentDependency,
  SubjectEquivalence,
  TransferPackage,
  TransferredSubjectGrades
} from '../types/processos';

const esc = (s: unknown) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string));

/** Normaliza nomes de disciplinas para comparar ("Língua Portuguesa" = "lingua  portuguesa"). */
export const normSubject = (s?: string) =>
  String(s ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

// ---------------------------------------------------------------------------
// Deteção automática de disciplinas equivalentes entre escolas do mesmo sistema
// ---------------------------------------------------------------------------

const CONNECTIVES = new Set(['de', 'da', 'do', 'das', 'dos', 'e', 'em', 'a', 'o', 'as', 'os', 'com', 'para', 'por', 'ao', 'aos', 'no', 'na', 'nos', 'nas']);

/**
 * Forma canónica de uma disciplina: sem acentos, maiúsculas, pontuação, partículas de ligação
 * ("de", "da", "e"...) nem plurais simples. "LÍNGUA PORTUGUESA", "Lingua  Portuguesa" e
 * "Língua de Portuguesa" dão todas "lingua portugues".
 */
export const canonSubject = (s?: string) =>
  normSubject(s)
    .split(' ')
    .filter((w) => w && !CONNECTIVES.has(w))
    .map((w) => (w.length > 3 && w.endsWith('s') ? w.slice(0, -1) : w))
    .join(' ');

/** Semelhança 0–1 (coeficiente de Dice sobre bigramas) entre duas disciplinas já canónicas. */
function similarity(a: string, b: string): number {
  if (!a || !b) return 0;
  if (a === b) return 1;
  const grams = (x: string) => {
    const m = new Map<string, number>();
    for (let i = 0; i < x.length - 1; i++) { const g = x.slice(i, i + 2); m.set(g, (m.get(g) || 0) + 1); }
    return m;
  };
  const ga = grams(a), gb = grams(b);
  let inter = 0;
  ga.forEach((n, g) => { inter += Math.min(n, gb.get(g) || 0); });
  const total = Math.max(1, a.length - 1) + Math.max(1, b.length - 1);
  return (2 * inter) / total;
}

export interface DestSubjectRef { id?: string; name: string; code?: string }

/**
 * exact     → mesma disciplina (ignorando maiúsculas, acentos, "de/da/e", plural): aplica-se sozinha
 * rule      → já há uma equivalência guardada na tabela de equivalências: aplica-se sozinha
 * suggested → nome parecido: só uma sugestão, a secretaria tem de confirmar
 * none      → nada encontrado: decisão manual
 */
export type SubjectMatchKind = 'exact' | 'rule' | 'suggested' | 'none';

export interface SubjectMatch {
  origin: string;
  kind: SubjectMatchKind;
  dest?: DestSubjectRef;
  score?: number;
}

/** Limiar mínimo para sugerir (nunca para aplicar automaticamente). */
export const SUGGEST_THRESHOLD = 0.72;

export function matchSubjectsToDestination(
  originNames: string[],
  destSubjects: DestSubjectRef[],
  rules: SubjectEquivalence[] = []
): SubjectMatch[] {
  const byCanon = new Map<string, DestSubjectRef>();
  destSubjects.forEach((d) => { const k = canonSubject(d.name); if (k && !byCanon.has(k)) byCanon.set(k, d); });
  const byCode = new Map<string, DestSubjectRef>();
  destSubjects.forEach((d) => { const k = normSubject(d.code); if (k && !byCode.has(k)) byCode.set(k, d); });
  const ruleByOrigin = new Map<string, SubjectEquivalence>();
  rules.forEach((r) => { const k = canonSubject(r.originSubject); if (k && !ruleByOrigin.has(k)) ruleByOrigin.set(k, r); });

  return originNames.map((origin): SubjectMatch => {
    const key = canonSubject(origin);
    const exact = byCanon.get(key) || (normSubject(origin).length <= 6 ? byCode.get(normSubject(origin)) : undefined);
    if (exact) return { origin, kind: 'exact', dest: exact, score: 1 };
    const rule = ruleByOrigin.get(key);
    if (rule) {
      const d = destSubjects.find((x) => (rule.destSubjectId && String(x.id) === String(rule.destSubjectId)) || canonSubject(x.name) === canonSubject(rule.destSubject));
      if (d) return { origin, kind: 'rule', dest: d, score: 1 };
    }
    let best: DestSubjectRef | undefined;
    let bestScore = 0;
    destSubjects.forEach((d) => {
      const sc = similarity(key, canonSubject(d.name));
      if (sc > bestScore) { best = d; bestScore = sc; }
    });
    if (best && bestScore >= SUGGEST_THRESHOLD) return { origin, kind: 'suggested', dest: best, score: bestScore };
    return { origin, kind: 'none' };
  });
}

/** Há disciplinas que o sistema não conseguiu resolver sozinho? Então abre-se a decisão manual. */
export const needsManualEquivalence = (matches: SubjectMatch[]) => matches.some((m) => m.kind === 'suggested' || m.kind === 'none');

/** Decisão manual por disciplina de origem: disciplina de destino escolhida, ou `null` = sem equivalência. */
export type SubjectDecisions = Record<string, DestSubjectRef | null>;

/**
 * Reescreve as notas recebidas com o nome (e id) da disciplina desta escola.
 * Disciplinas sem equivalência mantêm o nome de origem. Se duas disciplinas de origem
 * caírem na mesma de destino, as notas juntam-se (prevalece a primeira nota preenchida de cada trimestre).
 */
export function applySubjectMapping(
  grades: TransferredSubjectGrades[],
  matches: SubjectMatch[],
  decisions: SubjectDecisions = {}
): TransferredSubjectGrades[] {
  const mapOf = new Map<string, DestSubjectRef | null>();
  matches.forEach((m) => {
    const decided = Object.prototype.hasOwnProperty.call(decisions, m.origin) ? decisions[m.origin] : undefined;
    if (decided !== undefined) mapOf.set(canonSubject(m.origin), decided);
    else if (m.kind === 'exact' || m.kind === 'rule') mapOf.set(canonSubject(m.origin), m.dest || null);
    else mapOf.set(canonSubject(m.origin), null);
  });
  const out: TransferredSubjectGrades[] = [];
  const index = new Map<string, number>();
  grades.forEach((g) => {
    if (!g.subjectName?.trim()) return;
    const dest = mapOf.get(canonSubject(g.subjectName)) || null;
    const name = dest ? dest.name : g.subjectName.trim();
    const row: TransferredSubjectGrades = {
      ...g,
      subjectName: name,
      destSubjectId: dest?.id ? String(dest.id) : undefined,
      originSubjectName: dest && g.subjectName.trim() !== dest.name ? g.subjectName.trim() : undefined
    };
    const k = normSubject(name);
    const at = index.get(k);
    if (at === undefined) { index.set(k, out.length); out.push(row); return; }
    const cur = out[at];
    (['mt1', 'mt2', 'mt3'] as const).forEach((t) => { if (!hasValue(cur[t]) && hasValue(row[t])) cur[t] = row[t]; });
  });
  return out;
}

// ---------------------------------------------------------------------------
// Validação da saída: sem propinas/taxas em atraso
// ---------------------------------------------------------------------------

export interface InvoiceLike {
  id: string | number;
  studentId: string;
  status: string;
  dueDate?: string;
  description?: string;
  totalAmountKz: number;
  totalPaidKz?: number;
  invoiceNumber?: string;
}

const toISO = (v?: string) => {
  if (!v) return '';
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(v.trim());
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  const d = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})/.exec(v.trim());
  return d ? `${d[3]}-${d[2].padStart(2, '0')}-${d[1].padStart(2, '0')}` : '';
};

/**
 * Faturas do aluno que impedem a transferência: em atraso, ou pendentes com vencimento já passado.
 * Faturas pagas, isentas ou ainda dentro do prazo não bloqueiam.
 */
export function outstandingInvoices<T extends InvoiceLike>(invoices: T[], studentId: string, todayISO: string): T[] {
  return invoices.filter((i) => {
    if (String(i.studentId) !== String(studentId)) return false;
    if (i.status === 'pago' || i.status === 'isento') return false;
    if (i.status === 'atraso') return true;
    const due = toISO(i.dueDate);
    return i.status === 'pendente' && !!due && due < todayISO;
  });
}

export const sumOutstanding = (list: InvoiceLike[]) =>
  list.reduce((s, i) => s + Math.max(0, (i.totalAmountKz || 0) - (i.totalPaidKz || 0)), 0);

// ---------------------------------------------------------------------------
// Guia de Transferência e pacote de dados
// ---------------------------------------------------------------------------

export function formatGuideNumber(year: number, seq: number): string {
  return `GT-${year}-${String(seq).padStart(4, '0')}`;
}

/** Próximo número da guia do ano, nunca repetindo os já emitidos. */
export function nextGuideSeq(existing: Array<string | undefined>, year: number): number {
  const re = new RegExp(`^GT-${year}-(\\d+)$`);
  return existing.reduce((max, g) => {
    const m = g ? re.exec(g) : null;
    return m ? Math.max(max, Number(m[1])) : max;
  }, 0) + 1;
}

const hasValue = (v: unknown) => v !== '' && v !== undefined && v !== null && Number.isFinite(Number(v)) && Number(v) > 0;

/** Só os trimestres já avaliados (média > 0) viajam com o aluno; os por lançar ficam de fora. */
export function completedTrimesterGrades(records: StudentTrimesterRecord[] | undefined): TransferredSubjectGrades[] {
  return (records || [])
    .map((r) => ({
      subjectName: r.subjectName,
      mt1: hasValue(r.mt1) ? Number(r.mt1) : '' as const,
      mt2: hasValue(r.mt2) ? Number(r.mt2) : '' as const,
      mt3: hasValue(r.mt3) ? Number(r.mt3) : '' as const
    }))
    .filter((g) => hasValue(g.mt1) || hasValue(g.mt2) || hasValue(g.mt3));
}

/** Notas recebidas/introduzidas → registos de trimestre marcados como vindos de outra escola. */
export function transferredGradesToRecords(grades: TransferredSubjectGrades[], fromSchool: string): StudentTrimesterRecord[] {
  return grades
    .filter((g) => g.subjectName.trim())
    .map((g, i) => {
      const mt = (v: number | '' | undefined) => (hasValue(v) ? Number(v) : 0);
      const done = [mt(g.mt1), mt(g.mt2), mt(g.mt3)].filter((n) => n > 0);
      return {
        subjectId: g.destSubjectId || `transf-${i}-${normSubject(g.subjectName).replace(/ /g, '-')}`,
        subjectName: g.subjectName.trim(),
        mac1: '', npp1: '', npt1: '', mt1: mt(g.mt1),
        mac2: '', npp2: '', npt2: '', mt2: mt(g.mt2),
        mac3: '', npp3: '', npt3: '', mt3: mt(g.mt3),
        // Média parcial só com os trimestres que existem; a MFD final é recalculada quando os restantes forem lançados.
        mfd: done.length ? Math.round((done.reduce((a, b) => a + b, 0) / done.length) * 10) / 10 : 0,
        ca: 0,
        situation: 'Aprovado',
        origemNota: 'Transferência',
        origemDetalhe: g.originSubjectName ? `${fromSchool} (disciplina de origem: ${g.originSubjectName})` : fromSchool
      } as StudentTrimesterRecord;
    });
}

/** Valida o pacote antes de enviar/guardar; devolve mensagens para o utilizador. */
export function validateTransferPackage(p: Pick<TransferPackage, 'student' | 'grade' | 'guideNumber'>): string[] {
  const errors: string[] = [];
  if (!p.student?.name?.trim()) errors.push('Falta o nome do aluno.');
  if (!p.student?.birthDate) errors.push('Falta a data de nascimento do aluno.');
  if (!p.grade?.trim()) errors.push('Falta a classe do aluno.');
  if (!p.guideNumber?.trim()) errors.push('Falta o número da Guia de Transferência.');
  return errors;
}

/** Guia de Transferência em HTML pronto a imprimir/guardar como PDF (diálogo de impressão do navegador). */
export function buildTransferGuideHtml(pkg: TransferPackage, school: { name: string; address?: string; nif?: string; phone?: string }, destination: string, brasaoUrl?: string): string {
  const s = pkg.student;
  const fmtDate = (d?: string) => (d ? new Date(d).toLocaleDateString('pt-PT') : '—');
  const row = (a: string, b?: string) => `<tr><th>${esc(a)}</th><td>${esc(b || '—')}</td></tr>`;
  const grades = pkg.trimesterGrades.length
    ? pkg.trimesterGrades.map((g) => `<tr><td>${esc(g.subjectName)}</td><td>${esc(g.mt1 || '—')}</td><td>${esc(g.mt2 || '—')}</td><td>${esc(g.mt3 || '—')}</td></tr>`).join('')
    : '<tr><td colspan="4" style="text-align:center;color:#64748b">Sem avaliações trimestrais concluídas à data.</td></tr>';
  return `<!doctype html><html lang="pt"><head><meta charset="utf-8"><title>Guia de Transferência ${esc(pkg.guideNumber)}</title>
<style>body{font-family:Arial,sans-serif;color:#0b1f3a;padding:32px;font-size:12px;max-width:800px;margin:auto}
h1{font-size:18px;text-align:center;margin:0}h2{font-size:12px;text-transform:uppercase;border-bottom:2px solid #0b1f3a;padding-bottom:4px;margin:18px 0 8px}
.top{text-align:center;margin-bottom:12px;color:#475569}.top img{display:block;margin:0 auto 6px;height:72px;width:auto}.no{text-align:center;font-weight:bold;margin:8px 0 14px}
table{width:100%;border-collapse:collapse}th{text-align:left;width:32%;color:#475569;font-weight:600}td,th{padding:4px 6px;border-bottom:1px solid #e2e8f0}
.g th{background:#f1f5f9;width:auto;text-transform:uppercase;font-size:10px}.sig{display:flex;justify-content:space-around;margin-top:60px}
.sig div{border-top:1px solid #0b1f3a;width:38%;text-align:center;padding-top:4px}</style></head><body>
<div class="top">${brasaoUrl ? `<img src="${esc(brasaoUrl)}" alt="Insígnia da República de Angola">` : ''}<b>REPÚBLICA DE ANGOLA</b><br>Ministério da Educação<br><b>${esc(school.name)}</b>${school.address ? `<br>${esc(school.address)}` : ''}${school.nif ? ` · NIF ${esc(school.nif)}` : ''}</div>
<h1>GUIA DE TRANSFERÊNCIA</h1><div class="no">N.º ${esc(pkg.guideNumber)} · Ano lectivo ${esc(pkg.academicYear)}</div>
<h2>Dados do aluno</h2><table>${row('Nome completo', s.name)}${row('Nº de processo', s.procNumber)}${row('Data de nascimento', fmtDate(s.birthDate))}${row('Sexo', s.gender)}${row('Nacionalidade', s.nationality)}${row('Naturalidade', s.birthPlace)}${row('BI / Cédula', s.biNumber)}${row('NIF', s.nif)}${row('Morada', s.address)}</table>
<h2>Encarregado de educação</h2><table>${row('Nome', s.guardianName)}${row('Parentesco', s.guardianRelation)}${row('Telefone', s.guardianPhone)}${row('E-mail', s.guardianEmail)}</table>
<h2>Situação escolar à data</h2><table>${row('Classe', pkg.grade)}${row('Curso', pkg.courseName)}${row('Turma', pkg.className)}${row('Escola de destino', destination)}${row('Data da transferência', fmtDate(pkg.date))}${row('Motivo', pkg.reason)}</table>
<h2>Avaliações dos trimestres concluídos</h2><table class="g"><thead><tr><th>Disciplina</th><th>1.º Trim.</th><th>2.º Trim.</th><th>3.º Trim.</th></tr></thead><tbody>${grades}</tbody></table>
<p style="margin-top:14px;color:#475569">Declara-se que o aluno não tem dívidas de propinas ou taxas à data da emissão desta guia. O processo individual segue em anexo.</p>
<div class="sig"><div>A Secretaria</div><div>O Director</div></div></body></html>`;
}

// ---------------------------------------------------------------------------
// Equivalências por disciplina e regime de dependência
// ---------------------------------------------------------------------------

export interface OriginSubjectGrade { subjectName: string; grade?: number }

export interface EquivalenceOutcome {
  /** Disciplinas de origem reconhecidas: a nota passa para a disciplina de destino. */
  recognized: Array<{ originSubject: string; destSubject: string; grade?: number; rule: SubjectEquivalence }>;
  /** Disciplinas de origem sem regra de equivalência (nada é copiado). */
  unmapped: OriginSubjectGrade[];
  /** Disciplinas do plano novo (classes anteriores) que o aluno nunca fez → dependência. */
  missingForDependency: string[];
}

/**
 * Aplica a tabela de equivalências às disciplinas feitas na origem.
 * `destPlanSubjects` são as disciplinas que o plano de destino exige nas classes já concluídas;
 * as que ficarem sem equivalente tornam-se disciplinas em atraso.
 */
export function applyEquivalences(
  origin: OriginSubjectGrade[],
  rules: SubjectEquivalence[],
  destPlanSubjects: string[] = []
): EquivalenceOutcome {
  const byOrigin = new Map<string, SubjectEquivalence>();
  rules.forEach((r) => { if (!byOrigin.has(normSubject(r.originSubject))) byOrigin.set(normSubject(r.originSubject), r); });
  const recognized: EquivalenceOutcome['recognized'] = [];
  const unmapped: OriginSubjectGrade[] = [];
  origin.forEach((o) => {
    const rule = byOrigin.get(normSubject(o.subjectName));
    if (rule) recognized.push({ originSubject: o.subjectName, destSubject: rule.destSubject, grade: o.grade, rule });
    else unmapped.push(o);
  });
  const covered = new Set(recognized.map((r) => normSubject(r.destSubject)));
  // Disciplina com o mesmo nome nos dois planos conta como coberta (ex.: Língua Portuguesa).
  origin.forEach((o) => covered.add(normSubject(o.subjectName)));
  const missingForDependency = destPlanSubjects.filter((d) => !covered.has(normSubject(d)));
  return { recognized, unmapped, missingForDependency };
}

/** Nota equivalente → registo da disciplina de destino, com origem_nota = Equivalência. */
export function equivalenceToRecord(destSubject: string, grade: number | undefined, originLabel: string, destSubjectId?: string): StudentTrimesterRecord {
  const g = Number.isFinite(Number(grade)) ? Number(grade) : 0;
  return {
    subjectId: destSubjectId || `equiv-${normSubject(destSubject).replace(/ /g, '-')}`,
    subjectName: destSubject,
    mac1: '', npp1: '', npt1: '', mt1: 0,
    mac2: '', npp2: '', npt2: '', mt2: 0,
    mac3: '', npp3: '', npt3: '', mt3: 0,
    mfd: g,
    ca: g,
    situation: 'Aprovado',
    origemNota: 'Equivalência',
    origemDetalhe: originLabel
  } as StudentTrimesterRecord;
}

/**
 * Limite legal de reprovações/dependências: acima dele a transição é bloqueada.
 * O limite é configurável (omissão: 2 disciplinas em atraso, como o conselho de turma admite) —
 * mas nunca se bloqueia por disciplinas *não equivalentes* enquanto o limite for respeitado.
 */
export function dependencyLimitCheck(
  pendingBefore: number,
  newlyMissing: number,
  maxDependencies = 2
): { allowed: boolean; total: number; message?: string } {
  const total = pendingBefore + newlyMissing;
  if (total <= maxDependencies) return { allowed: true, total };
  return {
    allowed: false,
    total,
    message: `O aluno ficaria com ${total} disciplinas em atraso; o limite é ${maxDependencies}. Reveja as equivalências ou decida em conselho de turma.`
  };
}

export function pendingDependencies(deps: StudentDependency[] | undefined, studentId: string): StudentDependency[] {
  return (deps || []).filter((d) => String(d.studentId) === String(studentId) && d.status === 'pendente');
}
