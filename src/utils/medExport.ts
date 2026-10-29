/**
 * EXPORTAÇÃO PARA O MED (Ministério da Educação / GEPE) — Angola
 * ==============================================================
 * Gera o ficheiro Excel (.xlsx) com as QUATRO folhas exigidas pelo Gabinete de
 * Estudos, Planeamento e Estatística (GEPE), no formato do modelo oficial:
 *
 *   1. Identificação da Escola  — metadados da instituição (Configurações →
 *      Dados da Instituição: nome, código MED, natureza, província, município,
 *      comuna, bairro, decreto, diretor, contactos).
 *   2. Matrícula Inicial        — inscritos agregados (COUNT) por ano letivo,
 *      nível de ensino, classe, turno, idade e género (a "distorção
 *      idade-classe" que o MED monitoriza).
 *   3. Aproveitamento Trimestral — por classe/curso/turno, separado por género:
 *      Avaliados, Aprovados, Reprovados e Desistentes. Reutiliza a MESMA lógica
 *      dos Relatórios de Aproveitamento (`computeClassStats`), apenas agrupada
 *      (GROUP BY) por classe + curso/área + turno.
 *   4. Corpo Docente            — relação nominativa: nº de agente, nome,
 *      género, habilitações, especialidade, vínculo, nº de turmas e estatuto.
 *
 * A coluna "Total Alunos" da folha 2 sai como FÓRMULA do Excel (=SUM(F:G)),
 * tal como no modelo, para o GEPE poder continuar a trabalhar no ficheiro.
 */

import { ClassRoom, SchoolDatabase, Student, Teacher } from '../types';
import { ALL_EDUCATION_SUBSYSTEMS, getSubsystemForGrade } from './educationSubsystems';
import { isEducationSubsystemBlocked } from './platformLock';
import { ageOn } from './admissions';
import { academicYearStart, getFallbackAcademicYear } from './academicYear';
import { computeClassStats, GenderCount, TrimesterFilter } from './aproveitamentoStats';
import { normalizeGender, normalizeGradeRules } from './pautaCalculations';
import { getTeacherCurricularDistribution } from './teacherSubjects';

type ExcelJSType = typeof import('exceljs');

export type MedPeriod = '1' | '2' | '3' | 'anual';

// ---------------------------------------------------------------------------
// Modelos de dados das quatro folhas
// ---------------------------------------------------------------------------

export interface MedIdentificacaoRow {
  campo: string;
  tipo: string;
  descricao: string;
  valor: string;
}

export interface MedMatriculaRow {
  anoLetivo: string;
  nivelEnsino: string;
  classe: string;
  turno: string;
  idade: string;
  inscritosM: number;
  inscritosF: number;
}

export interface MedAproveitamentoRow {
  classe: string;
  curso: string;
  turno: string;
  avalM: number;
  avalF: number;
  aprovM: number;
  aprovF: number;
  reprovM: number;
  reprovF: number;
  desistM: number;
  desistF: number;
}

export interface MedDocenteRow {
  numAgente: string;
  nome: string;
  genero: string;
  habilitacoes: string;
  especialidade: string;
  vinculo: string;
  numTurmas: number;
  estatuto: string;
}

export interface MedExportData {
  identificacao: MedIdentificacaoRow[];
  matriculaInicial: MedMatriculaRow[];
  aproveitamento: MedAproveitamentoRow[];
  corpoDocente: MedDocenteRow[];
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Turma do aluno: por id ou, em registos antigos, pelo nome da turma. */
function classOfStudent(classes: ClassRoom[], s: Student): ClassRoom | undefined {
  return (
    classes.find((c) => String(c.id) === String(s.classId)) ||
    classes.find((c) => c.name && c.name === s.className)
  );
}

/** Nível de ensino oficial (Ensino Primário, I Ciclo, II Ciclo...) da turma. */
function nivelEnsinoOf(cls?: ClassRoom): string {
  const sub = cls ? getSubsystemForGrade(cls.grade) : undefined;
  return sub?.name || 'Por Classificar';
}

const TURNO_ORDER = ['Manhã', 'Tarde', 'Noite', 'Pós-Laboral', 'Integral'];

function gradeSortKey(grade: string): number {
  const m = String(grade || '').match(/(\d+)/);
  return m ? parseInt(m[1], 10) : 0;
}

function subsystemOrder(nivelEnsino: string): number {
  const idx = ALL_EDUCATION_SUBSYSTEMS.findIndex((s) => s.name === nivelEnsino);
  return idx >= 0 ? idx : ALL_EDUCATION_SUBSYSTEMS.length;
}

// ---------------------------------------------------------------------------
// Folha 1 — Identificação da Escola
// ---------------------------------------------------------------------------

function buildIdentificacao(db: SchoolDatabase): MedIdentificacaoRow[] {
  const st = db.settings || ({} as SchoolDatabase['settings']);
  const activeNames = ALL_EDUCATION_SUBSYSTEMS.filter((s) =>
    !isEducationSubsystemBlocked(s.id) &&
    (st.selectedSubsystems && st.selectedSubsystems.length > 0 ? st.selectedSubsystems : ['primario', 'secundario_1', 'secundario_2']).includes(s.id)
  ).map((s) => s.name);

  return [
    { campo: 'codigo_med', tipo: 'Texto / Alfanumérico', descricao: 'Código oficial atribuído pelo MED/GEPE', valor: st.medCode || '' },
    { campo: 'nome_instituicao', tipo: 'Texto', descricao: 'Nome completo da escola (sem abreviações)', valor: st.schoolName || '' },
    { campo: 'provincia', tipo: 'Texto', descricao: 'Província onde a escola está localizada', valor: st.province || '' },
    { campo: 'municipio', tipo: 'Texto', descricao: 'Município da localização', valor: st.municipality || '' },
    { campo: 'comuna', tipo: 'Texto', descricao: 'Comuna / Distrito Urbano', valor: st.commune || '' },
    { campo: 'bairro_localidade', tipo: 'Texto', descricao: 'Bairro ou localidade específica', valor: st.bairro || st.address || '' },
    { campo: 'natureza_escola', tipo: 'Opção (Lista)', descricao: 'Pública / Privada / Comparticipada', valor: st.schoolNature || '' },
    { campo: 'sub_sistema_ensino', tipo: 'Texto', descricao: 'Geral / Técnico-Profissional / Adultos', valor: activeNames.join(' / ') },
    { campo: 'decreto_criacao', tipo: 'Texto', descricao: 'Número do Diário da República ou Decreto de criação', valor: st.decreeAuthorization || '' },
    { campo: 'diretor_geral', tipo: 'Texto', descricao: 'Nome completo do Diretor da Instituição', valor: st.directorGeral || '' },
    { campo: 'telefone_contacto', tipo: 'Texto', descricao: 'Contacto telefónico principal da escola', valor: st.phone || '' },
    { campo: 'email_contacto', tipo: 'Texto', descricao: 'Correio eletrónico institucional', valor: st.email || '' }
  ];
}

// ---------------------------------------------------------------------------
// Folha 2 — Matrícula Inicial (Alunos por Idade, Classe e Género)
// ---------------------------------------------------------------------------

function buildMatriculaInicial(db: SchoolDatabase, academicYear: string): MedMatriculaRow[] {
  const classes = db.classes || [];
  // Idade de referência do censo: idade completada até 31 de dezembro do ano
  // civil em que o ano letivo começou (ex.: 2026 para o ano letivo 2026/2027).
  const startYear = academicYearStart(academicYear);
  const reference = Number.isFinite(startYear) ? new Date(startYear, 11, 31) : new Date();

  const groups = new Map<string, MedMatriculaRow & { _nivelOrdem: number; _classeOrdem: number; _idadeOrdem: number }>();

  (db.students || []).forEach((s) => {
    const cls = classOfStudent(classes, s);
    if (!cls) return; // aluno sem turma atribuída não entra no censo de matrícula

    const nivel = nivelEnsinoOf(cls);
    const classe = cls.grade || s.grade || '—';
    const turno = cls.shift || s.shift || '—';
    const age = ageOn(s.birthDate, reference);
    const idadeLabel = age === null ? 'Idade Desconhecida' : age >= 18 ? '18+ Anos' : `${age} Anos`;
    const idadeOrdem = age === null ? 999 : age;

    const key = `${nivel}|${classe}|${turno}|${idadeLabel}`;
    let row = groups.get(key);
    if (!row) {
      row = {
        anoLetivo: academicYear,
        nivelEnsino: nivel,
        classe,
        turno,
        idade: idadeLabel,
        inscritosM: 0,
        inscritosF: 0,
        _nivelOrdem: subsystemOrder(nivel),
        _classeOrdem: gradeSortKey(classe),
        _idadeOrdem: idadeOrdem
      };
      groups.set(key, row);
    }
    if (normalizeGender(s.gender, s.name) === 'M') row.inscritosM += 1;
    else row.inscritosF += 1;
  });

  return Array.from(groups.values())
    .sort(
      (a, b) =>
        a._nivelOrdem - b._nivelOrdem ||
        a._classeOrdem - b._classeOrdem ||
        TURNO_ORDER.indexOf(a.turno) - TURNO_ORDER.indexOf(b.turno) ||
        a._idadeOrdem - b._idadeOrdem
    )
    .map(({ _nivelOrdem, _classeOrdem, _idadeOrdem, ...row }) => row);
}

// ---------------------------------------------------------------------------
// Folha 3 — Aproveitamento Escolar (Mapas de Rendimento por género)
// ---------------------------------------------------------------------------

function buildAproveitamento(db: SchoolDatabase, period: MedPeriod): MedAproveitamentoRow[] {
  const classes = db.classes || [];
  const trimester: TrimesterFilter = period === 'anual' ? 'todos' : period;
  const rules = normalizeGradeRules(db.settings?.gradeRules);
  const currentTrimester = db.settings?.currentTrimester;

  const groups = new Map<string, { classe: string; curso: string; turno: string; aval: GenderCount; aprov: GenderCount; reprov: GenderCount; desist: GenderCount }>();

  classes.forEach((cls) => {
    const classStudents = (db.students || []).filter(
      (s) => String(s.classId) === String(cls.id) || (cls.name && s.className === cls.name)
    );
    const stats = computeClassStats(classStudents, { trimester, rules, currentTrimester });

    const curso = cls.area || 'Geral';
    const key = `${cls.grade}|${curso}|${cls.shift}`;
    let g = groups.get(key);
    if (!g) {
      g = {
        classe: cls.grade || cls.name,
        curso,
        turno: cls.shift || '—',
        aval: { M: 0, F: 0, MF: 0 },
        aprov: { M: 0, F: 0, MF: 0 },
        reprov: { M: 0, F: 0, MF: 0 },
        desist: { M: 0, F: 0, MF: 0 }
      };
      groups.set(key, g);
    }
    g.aval.M += stats.avaliados.M; g.aval.F += stats.avaliados.F;
    g.aprov.M += stats.aprovados.M; g.aprov.F += stats.aprovados.F;
    g.reprov.M += stats.reprovados.M; g.reprov.F += stats.reprovados.F;
    g.desist.M += stats.desistidos.M; g.desist.F += stats.desistidos.F;
  });

  return Array.from(groups.values())
    .sort((a, b) => gradeSortKey(a.classe) - gradeSortKey(b.classe) || a.curso.localeCompare(b.curso) || TURNO_ORDER.indexOf(a.turno) - TURNO_ORDER.indexOf(b.turno))
    .map((g) => ({
      classe: g.classe,
      curso: g.curso,
      turno: g.turno,
      avalM: g.aval.M,
      avalF: g.aval.F,
      aprovM: g.aprov.M,
      aprovF: g.aprov.F,
      reprovM: g.reprov.M,
      reprovF: g.reprov.F,
      desistM: g.desist.M,
      desistF: g.desist.F
    }));
}

// ---------------------------------------------------------------------------
// Folha 4 — Corpo Docente (relação nominativa)
// ---------------------------------------------------------------------------

function teacherVinculo(t: Teacher): string {
  const category = (t.category || '').toLowerCase();
  if (/efetiv|quadro/.test(category)) return 'Efetivo (Quadro)';
  if (/contrat/.test(category)) return 'Contratado';
  return t.status === 'contrato_vencer' ? 'Contratado' : 'Efetivo (Quadro)';
}

function teacherEstatuto(t: Teacher): string {
  switch (t.status) {
    case 'licenca':
      return 'Licença Médica';
    case 'contrato_vencer':
      return 'Contrato a Terminar';
    default:
      return 'Ativo';
  }
}

function buildCorpoDocente(db: SchoolDatabase): MedDocenteRow[] {
  return (db.teachers || []).map((t) => {
    const distribution = getTeacherCurricularDistribution(db, t);
    const classIds = new Set<string>([
      ...distribution.map((a) => String(a.classId)),
      ...(t.allocatedClasses || []).map((a) => String(a.classId))
    ]);
    return {
      numAgente: t.agentNumber || t.id,
      nome: t.name,
      genero: normalizeGender(t.gender, t.name),
      habilitacoes: t.degree || '',
      especialidade: t.department || '',
      vinculo: teacherVinculo(t),
      numTurmas: classIds.size,
      estatuto: teacherEstatuto(t)
    };
  });
}

// ---------------------------------------------------------------------------
// Ponto de entrada: agregação completa
// ---------------------------------------------------------------------------

export function buildMedExportData(db: SchoolDatabase, period: MedPeriod): MedExportData {
  const academicYear = db.settings?.currentAcademicYear || getFallbackAcademicYear();
  return {
    identificacao: buildIdentificacao(db),
    matriculaInicial: buildMatriculaInicial(db, academicYear),
    aproveitamento: buildAproveitamento(db, period),
    corpoDocente: buildCorpoDocente(db)
  };
}

export function medPeriodLabel(period: MedPeriod): string {
  return period === 'anual' ? 'Anual' : `${period}.º Trimestre`;
}

export function medFileCode(academicYear: string, period: MedPeriod): string {
  return `MED-${academicYear.replace(/\//g, '-')}-${period.toUpperCase()}-${Date.now().toString().slice(-5)}`;
}

// ---------------------------------------------------------------------------
// Geração do ficheiro Excel (.xlsx) no formato do modelo oficial do MED/GEPE
// ---------------------------------------------------------------------------

const HEADER_FILL = 'FF0B1F3A';
const TITLE_FILL = 'FFEDF2F9';
const MED_BORDER = { top: { style: 'thin' }, left: { style: 'thin' }, bottom: { style: 'thin' }, right: { style: 'thin' } } as const;

function styleTitle(ws: import('exceljs').Worksheet, lastCol: string, lines: string[]) {
  lines.forEach((text, i) => {
    const row = ws.getRow(i + 1);
    row.getCell(1).value = text;
    row.getCell(1).font = { bold: true, size: i === 0 ? 12 : 11, color: { argb: HEADER_FILL } };
    row.getCell(1).alignment = { horizontal: 'left', vertical: 'middle' };
    if (i === 0) row.getCell(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: TITLE_FILL } };
    row.height = i === 0 ? 22 : 18;
    ws.mergeCells(`A${i + 1}:${lastCol}${i + 1}`);
  });
}

function styleHeaderRow(ws: import('exceljs').Worksheet, rowIndex: number, headers: string[]) {
  const row = ws.getRow(rowIndex);
  row.values = headers;
  row.height = 24;
  row.eachCell((cell) => {
    cell.font = { bold: true, color: { argb: 'FFFFFFFF' }, size: 10 };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: HEADER_FILL } };
    cell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
    cell.border = MED_BORDER;
  });
}

function styleDataCell(cell: import('exceljs').Cell, numeric = false) {
  cell.border = MED_BORDER;
  cell.font = { size: 10 };
  cell.alignment = { horizontal: numeric ? 'center' : 'left', vertical: 'middle' };
}

function downloadXlsx(buffer: ArrayBuffer, filename: string) {
  const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

/**
 * Constrói o workbook das 4 folhas do MED (sem descarregar). Separado do
 * download para poder ser testado em Node e reutilizado noutros fluxos.
 */
export function buildMedWorkbook(ExcelJS: ExcelJSType, data: MedExportData): import('exceljs').Workbook {
  const wb = new ExcelJS.Workbook();
  wb.creator = data.identificacao.find((r) => r.campo === 'nome_instituicao')?.valor || 'Escola';
  wb.created = new Date();

  // ---- Folha 1: Identificação da Escola ----------------------------------
  const ws1 = wb.addWorksheet('1. Identificação da Escola');
  ws1.columns = [{ width: 24 }, { width: 20 }, { width: 52 }, { width: 44 }];
  styleTitle(ws1, 'D', [
    'MINISTÉRIO DA EDUCAÇÃO (MED) - ANGOLA',
    'GABINETE DE ESTUDOS, PLANEAMENTO E ESTATÍSTICA (GEPE)',
    'FORMULÁRIO DE CADASTRO E IDENTIFICAÇÃO DA INSTITUIÇÃO'
  ]);
  styleHeaderRow(ws1, 5, ['Nome do Campo / Coluna', 'Tipo de Dado', 'Descrição / Formato', 'Valor da Instituição']);
  data.identificacao.forEach((r, i) => {
    const row = ws1.getRow(6 + i);
    row.values = [r.campo, r.tipo, r.descricao, r.valor];
    row.eachCell((cell, col) => styleDataCell(cell, false));
    row.getCell(1).font = { size: 10, bold: true };
    row.getCell(4).font = { size: 10, bold: true, color: { argb: HEADER_FILL } };
  });

  // ---- Folha 2: Matrícula Inicial ----------------------------------------
  const ws2 = wb.addWorksheet('2. Matrícula Inicial (Alunos)');
  ws2.columns = [{ width: 12 }, { width: 30 }, { width: 14 }, { width: 12 }, { width: 14 }, { width: 20 }, { width: 20 }, { width: 12 }];
  styleTitle(ws2, 'H', ['ESTATÍSTICA DE MATRÍCULA INICIAL POR IDADE, CLASSE E GÉNERO']);
  styleHeaderRow(ws2, 3, ['Ano Letivo', 'Nível de Ensino', 'Classe', 'Turno', 'Idade', 'Inscritos Masculinos', 'Inscritos Femininos', 'Total Alunos']);
  data.matriculaInicial.forEach((r, i) => {
    const rowIndex = 4 + i;
    const row = ws2.getRow(rowIndex);
    row.values = [r.anoLetivo, r.nivelEnsino, r.classe, r.turno, r.idade, r.inscritosM, r.inscritosF, { formula: `SUM(F${rowIndex}:G${rowIndex})`, result: r.inscritosM + r.inscritosF }];
    row.eachCell((cell, col) => styleDataCell(cell, col >= 6));
  });
  ws2.views = [{ state: 'frozen', ySplit: 3 }];

  // ---- Folha 3: Aproveitamento Trimestral ---------------------------------
  const ws3 = wb.addWorksheet('3. Aproveitamento Trimestral');
  ws3.columns = [{ width: 14 }, { width: 22 }, { width: 12 }, { width: 9 }, { width: 9 }, { width: 10 }, { width: 10 }, { width: 10 }, { width: 10 }, { width: 10 }, { width: 10 }];
  styleTitle(ws3, 'K', ['MAPA DE APROVEITAMENTO E CRUZE DE RESULTADOS ESCOLARES']);
  styleHeaderRow(ws3, 3, ['Classe', 'Curso / Área', 'Turno', 'Aval_M', 'Aval_F', 'Aprov_M', 'Aprov_F', 'Reprov_M', 'Reprov_F', 'Desist_M', 'Desist_F']);
  data.aproveitamento.forEach((r, i) => {
    const row = ws3.getRow(4 + i);
    row.values = [r.classe, r.curso, r.turno, r.avalM, r.avalF, r.aprovM, r.aprovF, r.reprovM, r.reprovF, r.desistM, r.desistF];
    row.eachCell((cell, col) => styleDataCell(cell, col >= 4));
  });
  ws3.views = [{ state: 'frozen', ySplit: 3 }];

  // ---- Folha 4: Corpo Docente ---------------------------------------------
  const ws4 = wb.addWorksheet('4. Corpo Docente');
  ws4.columns = [{ width: 16 }, { width: 34 }, { width: 9 }, { width: 26 }, { width: 22 }, { width: 18 }, { width: 12 }, { width: 20 }];
  styleTitle(ws4, 'H', ['RELAÇÃO NOMINATIVA E ESTATÍSTICA DO CORPO DOCENTE']);
  styleHeaderRow(ws4, 3, ['Nº Agente / ID', 'Nome do Professor', 'Género', 'Habilitações Literárias', 'Especialidade', 'Vínculo', 'Nº de Turmas', 'Estatuto']);
  data.corpoDocente.forEach((r, i) => {
    const row = ws4.getRow(4 + i);
    row.values = [r.numAgente, r.nome, r.genero, r.habilitacoes, r.especialidade, r.vinculo, r.numTurmas, r.estatuto];
    row.eachCell((cell, col) => styleDataCell(cell, col === 3 || col === 7));
  });
  ws4.views = [{ state: 'frozen', ySplit: 3 }];

  return wb;
}

/**
 * Gera e transfere o workbook das 4 folhas do MED. O exceljs é carregado sob
 * pedido (dynamic import), como nas pautas, para não pesar o bundle inicial.
 */
export async function exportMedWorkbookXlsx(data: MedExportData, fileName: string): Promise<void> {
  const ExcelJS = (await import('exceljs')).default as unknown as ExcelJSType;
  const wb = buildMedWorkbook(ExcelJS, data);
  const buffer = await wb.xlsx.writeBuffer();
  downloadXlsx(buffer as ArrayBuffer, fileName);
}
