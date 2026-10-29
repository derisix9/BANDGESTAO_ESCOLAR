import { describe, expect, it } from 'vitest';
import { buildMedExportData } from '../src/utils/medExport';

// ---------------------------------------------------------------------------
// Exportação para o MED/GEPE — as 4 folhas oficiais.
// ---------------------------------------------------------------------------

const cls = (id: string, name: string, grade: string, shift = 'Manhã', area?: string) =>
  ({ id, name, grade, shift, area, section: 'A', cycle: '', room: '', studentCount: 0, maxCapacity: 40, headTeacherId: '', headTeacherName: '', academicYear: '2026/2027' } as any);

const st = (id: string, gender: string, birthDate: string, classId: string, grades: any[] = [], status = 'active') =>
  ({ id, name: `Aluno ${id}`, procNumber: id, gender, birthDate, classId, className: '', status, trimesterGrades: grades } as any);

const rec = (subjectId: string, mac: number | '', npp: number | '', npt: number | '') => ({
  subjectId, subjectName: subjectId.toUpperCase(),
  mac1: mac, npp1: npp, npt1: npt, mt1: 0,
  mac2: '', npp2: '', npt2: '', mt2: 0,
  mac3: '', npp3: '', npt3: '', mt3: 0,
  mfd: 0, ca: 0, situation: 'Aprovado'
});

const teacher = (id: string, name: string, gender: string, degree: string, department: string, status = 'ativo', category = '', allocatedClasses: any[] = []) =>
  ({ id, name, gender, degree, department, status, category, agentNumber: `AG-${id}`, allocatedClasses, weeklyHours: 20, rating: 5, evaluationsCount: 0 } as any);

const baseDb = (over: Record<string, any> = {}): any => ({
  settings: {
    schoolName: 'Escola Primária e Secundária Nº 1024',
    medCode: 'ESC-40291',
    schoolNature: 'Pública',
    province: 'Luanda',
    municipality: 'Belas',
    commune: 'Kilamba',
    bairro: 'Quarteirão B',
    decreeAuthorization: 'Dec. Executivo nº 45/22',
    directorGeral: 'António Manuel João',
    phone: '923000000',
    email: 'escola1024.med@gmail.com',
    currentAcademicYear: '2026/2027',
    selectedSubsystems: ['primario', 'secundario_1', 'secundario_2']
  },
  classes: [],
  students: [],
  teachers: [],
  timetable: [],
  subjectAssignments: [],
  ...over
});

describe('Exportação MED — Folha 1: Identificação da Escola', () => {
  it('preenche os 12 campos oficiais a partir das configurações da instituição', () => {
    const data = buildMedExportData(baseDb(), 'anual');
    expect(data.identificacao).toHaveLength(12);
    const by = Object.fromEntries(data.identificacao.map((r) => [r.campo, r.valor]));
    expect(by.codigo_med).toBe('ESC-40291');
    expect(by.nome_instituicao).toBe('Escola Primária e Secundária Nº 1024');
    expect(by.provincia).toBe('Luanda');
    expect(by.municipio).toBe('Belas');
    expect(by.comuna).toBe('Kilamba');
    expect(by.bairro_localidade).toBe('Quarteirão B');
    expect(by.natureza_escola).toBe('Pública');
    expect(by.decreto_criacao).toBe('Dec. Executivo nº 45/22');
    expect(by.diretor_geral).toBe('António Manuel João');
    expect(by.telefone_contacto).toBe('923000000');
    expect(by.email_contacto).toBe('escola1024.med@gmail.com');
    expect(by.sub_sistema_ensino).toContain('Ensino Primário');
  });

  it('deixa vazio (para a UI avisar) o que não estiver configurado', () => {
    const data = buildMedExportData(baseDb({ settings: { schoolName: 'X', currentAcademicYear: '2026/2027' } }), 'anual');
    const by = Object.fromEntries(data.identificacao.map((r) => [r.campo, r.valor]));
    expect(by.codigo_med).toBe('');
    expect(by.natureza_escola).toBe('');
  });
});

describe('Exportação MED — Folha 2: Matrícula Inicial por idade, classe e género', () => {
  const db = baseDb({
    classes: [cls('c1', '1A', '1.ª Classe', 'Manhã'), cls('c2', '7A', '7.ª Classe', 'Tarde')],
    students: [
      st('1', 'M', '2020-03-10', 'c1'), // 6 anos em 31/12/2026
      st('2', 'F', '2020-08-01', 'c1'), // 6 anos
      st('3', 'F', '2019-01-15', 'c1'), // 7 anos
      st('4', 'M', '2013-05-20', 'c2'), // 13 anos
      st('5', 'F', '2005-02-10', 'c2')  // 21 anos → "18+ Anos"
    ]
  });

  it('agrupa (COUNT) por nível, classe, turno e idade, separando géneros', () => {
    const rows = buildMedExportData(db, 'anual').matriculaInicial;
    const key = (r: any) => `${r.nivelEnsino}|${r.classe}|${r.turno}|${r.idade}`;
    const map = new Map(rows.map((r) => [key(r), r]));

    const p6 = map.get('Ensino Primário|1.ª Classe|Manhã|6 Anos');
    expect(p6).toMatchObject({ anoLetivo: '2026/2027', inscritosM: 1, inscritosF: 1 });

    const p7 = map.get('Ensino Primário|1.ª Classe|Manhã|7 Anos');
    expect(p7).toMatchObject({ inscritosM: 0, inscritosF: 1 });

    const s13 = map.get('I Ciclo do Ensino Secundário|7.ª Classe|Tarde|13 Anos');
    expect(s13).toMatchObject({ inscritosM: 1, inscritosF: 0 });

    // adultos saem agregados como "18+ Anos", como pede a instrução do MED
    const adultos = map.get('I Ciclo do Ensino Secundário|7.ª Classe|Tarde|18+ Anos');
    expect(adultos).toMatchObject({ inscritosM: 0, inscritosF: 1 });
  });

  it('ignora alunos sem turma atribuída', () => {
    const semTurma = baseDb({ classes: [cls('c1', '1A', '1.ª Classe')], students: [st('9', 'M', '2020-01-01', 'inexistente')] });
    expect(buildMedExportData(semTurma, 'anual').matriculaInicial).toHaveLength(0);
  });
});

describe('Exportação MED — Folha 3: Aproveitamento por género', () => {
  const db = baseDb({
    classes: [
      cls('c1', '7A', '7.ª Classe', 'Manhã'),
      cls('c2', '7B', '7.ª Classe', 'Manhã'),
      cls('c3', '10I', '10.ª Classe', 'Tarde', 'Informática')
    ],
    students: [
      st('1', 'M', '2013-01-01', 'c1', [rec('mat', 14, 12, 16)]), // aprovado T1
      st('2', 'F', '2013-06-01', 'c1', [rec('mat', 5, 6, 7)]),    // reprovado T1
      st('3', 'F', '2013-03-01', 'c2', [rec('mat', 11, 11, 11)]), // aprovado T1
      st('4', 'M', '2013-04-01', 'c2', [], 'suspended'),          // desistente
      st('5', 'M', '2010-01-01', 'c3', [rec('mat', 12, 12, 12)])
    ]
  });

  it('faz GROUP BY classe/curso/turno somando as turmas com a mesma chave', () => {
    const rows = buildMedExportData(db, '1').aproveitamento;
    const geral = rows.find((r) => r.classe === '7.ª Classe');
    expect(geral).toMatchObject({ curso: 'Geral', turno: 'Manhã', avalM: 1, avalF: 2, aprovM: 1, aprovF: 1, reprovM: 0, reprovF: 1, desistM: 1, desistF: 0 });
    const info = rows.find((r) => r.classe === '10.ª Classe');
    expect(info).toMatchObject({ curso: 'Informática', turno: 'Tarde', avalM: 1, avalF: 0 });
  });

  it('sem notas lançadas no período, não há avaliados', () => {
    const rows = buildMedExportData(db, '2').aproveitamento;
    const geral = rows.find((r) => r.classe === '7.ª Classe');
    expect(geral).toMatchObject({ avalM: 0, avalF: 0, aprovM: 0, aprovF: 0 });
  });
});

describe('Exportação MED — Folha 4: Corpo Docente', () => {
  const db = baseDb({
    teachers: [
      teacher('1', 'Manuel Domingos Faustino', 'M', 'Licenciatura', 'Matemática', 'ativo', '', [{ classId: 'c1', className: '7A', subject: 'Mat', hoursWeekly: 4 }, { classId: 'c2', className: '7B', subject: 'Mat', hoursWeekly: 4 }]),
      teacher('2', 'Maria da Conceição Neto', 'F', 'Ensino Médio Pedagógico', 'Língua Portuguesa', 'ativo', 'Contratado'),
      teacher('3', 'Ana Paula de Sousa', 'F', 'Licenciatura', 'Química', 'licenca')
    ]
  });

  it('lista nominativa com vínculo, estatuto e nº de turmas', () => {
    const rows = buildMedExportData(db, 'anual').corpoDocente;
    expect(rows).toHaveLength(3);
    expect(rows[0]).toMatchObject({ numAgente: 'AG-1', nome: 'Manuel Domingos Faustino', genero: 'M', habilitacoes: 'Licenciatura', especialidade: 'Matemática', vinculo: 'Efetivo (Quadro)', numTurmas: 2, estatuto: 'Ativo' });
    expect(rows[1]).toMatchObject({ vinculo: 'Contratado', estatuto: 'Ativo', numTurmas: 0 });
    expect(rows[2]).toMatchObject({ estatuto: 'Licença Médica' });
  });

  it('contrato a vencer sem categoria explícita sai como Contratado', () => {
    const d = baseDb({ teachers: [teacher('9', 'José Pedro Kiala', 'M', 'Mestrado', 'Física', 'contrato_vencer')] });
    expect(buildMedExportData(d, 'anual').corpoDocente[0]).toMatchObject({ vinculo: 'Contratado', estatuto: 'Contrato a Terminar' });
  });
});

// ---------------------------------------------------------------------------
// Estrutura do workbook .xlsx — tem de espelhar o modelo oficial do MED/GEPE.
// ---------------------------------------------------------------------------
describe('Exportação MED — Workbook Excel conforme o modelo oficial', () => {
  async function buildWb(db: any) {
    const ExcelJS = (await import('exceljs')).default;
    const { buildMedWorkbook } = await import('../src/utils/medExport');
    return buildMedWorkbook(ExcelJS as any, buildMedExportData(db, 'anual'));
  }

  const db = baseDb({
    classes: [cls('c1', '1A', '1.ª Classe', 'Manhã')],
    students: [st('1', 'M', '2020-03-10', 'c1'), st('2', 'F', '2019-06-01', 'c1')],
    teachers: [teacher('1', 'Manuel Faustino', 'M', 'Licenciatura', 'Matemática')]
  });

  it('tem exatamente as 4 folhas do modelo, com os nomes oficiais', async () => {
    const wb = await buildWb(db);
    expect(wb.worksheets.map((w: any) => w.name)).toEqual([
      '1. Identificação da Escola',
      '2. Matrícula Inicial (Alunos)',
      '3. Aproveitamento Trimestral',
      '4. Corpo Docente'
    ]);
  });

  it('folha 2: cabeçalhos oficiais e Total como fórmula =SUM(F:G), como no modelo', async () => {
    const wb = await buildWb(db);
    const ws = wb.getWorksheet('2. Matrícula Inicial (Alunos)') as any;
    expect(ws.getCell('A1').value).toBe('ESTATÍSTICA DE MATRÍCULA INICIAL POR IDADE, CLASSE E GÉNERO');
    const header = [1, 2, 3, 4, 5, 6, 7, 8].map((c) => ws.getRow(3).getCell(c).value);
    expect(header).toEqual(['Ano Letivo', 'Nível de Ensino', 'Classe', 'Turno', 'Idade', 'Inscritos Masculinos', 'Inscritos Femininos', 'Total Alunos']);
    // 2 linhas de dados (6 Anos e 7 Anos), cada uma com fórmula de soma
    expect(ws.getRow(4).getCell(8).value).toMatchObject({ formula: 'SUM(F4:G4)' });
    expect(ws.getRow(5).getCell(8).value).toMatchObject({ formula: 'SUM(F5:G5)' });
  });

  it('folha 3: colunas por género exigidas pela instrução (Aval/Aprov/Reprov/Desist × M/F)', async () => {
    const wb = await buildWb(db);
    const ws = wb.getWorksheet('3. Aproveitamento Trimestral') as any;
    const header = Array.from({ length: 11 }, (_, i) => ws.getRow(3).getCell(i + 1).value);
    expect(header).toEqual(['Classe', 'Curso / Área', 'Turno', 'Aval_M', 'Aval_F', 'Aprov_M', 'Aprov_F', 'Reprov_M', 'Reprov_F', 'Desist_M', 'Desist_F']);
  });

  it('folha 4: colunas da relação nominativa do corpo docente', async () => {
    const wb = await buildWb(db);
    const ws = wb.getWorksheet('4. Corpo Docente') as any;
    const header = Array.from({ length: 8 }, (_, i) => ws.getRow(3).getCell(i + 1).value);
    expect(header).toEqual(['Nº Agente / ID', 'Nome do Professor', 'Género', 'Habilitações Literárias', 'Especialidade', 'Vínculo', 'Nº de Turmas', 'Estatuto']);
    expect(ws.getRow(4).getCell(1).value).toBe('AG-1');
  });

  it('folha 1: metadados com os campos oficiais e valores da instituição', async () => {
    const wb = await buildWb(db);
    const ws = wb.getWorksheet('1. Identificação da Escola') as any;
    expect(ws.getCell('A1').value).toBe('MINISTÉRIO DA EDUCAÇÃO (MED) - ANGOLA');
    expect(ws.getCell('A6').value).toBe('codigo_med');
    expect(ws.getCell('D6').value).toBe('ESC-40291');
    expect(ws.getCell('A7').value).toBe('nome_instituicao');
    expect(ws.getCell('D7').value).toBe('Escola Primária e Secundária Nº 1024');
  });
});
