import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { buildMiniPautaWorkbook, buildPautaFinalWorkbook, LoadedImage } from '../src/utils/pautaExcelExport';
import { buildPautaHeader } from '../src/utils/pautaHeader';
import { buildPautaGradeTypes } from '../src/utils/pautaView';
import type { GradeTypeKey, StudentMiniPautaItem, StudentPautaGeralItem } from '../src/types/pauta';

const load = async (url?: string): Promise<LoadedImage | null> => {
  if (!url) return null;
  const buf = fs.readFileSync(path.join(__dirname, '..', 'public', url));
  return { base64: buf.toString('base64'), ext: 'png', width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
};

const settings: any = { province: 'Malanje', schoolName: 'Escola do Ensino Geral Bandmed', currentAcademicYear: '2026/2027' };
const classOf = (grade: string): any => ({ grade, name: grade, section: 'A', room: '01', shift: 'Manhã', academicYear: '2026/2027' });

const miniRow = (): StudentMiniPautaItem => ({
  id: '1', studentId: '1', num: 1, name: 'Aluno Teste', gender: 'M', birthYear: '', age: '', isDebtor: false, isDesistente: false, obs: '',
  mac1: 12, npp1: '', npt1: 10, mt1: 11, mac2: '', npp2: '', npt2: '', mt2: '', mac3: '', npp3: '', npt3: '', mt3: '', mfd: 11, pg: '', ca: ''
});

async function mini(grade: string, regime: 'transicao' | 'exame' | 'eja', types: GradeTypeKey[], rows: StudentMiniPautaItem[] = [miniRow()]) {
  const activeClass = classOf(grade);
  const header = buildPautaHeader({ kind: 'minipauta', settings, activeClass, subject: { name: 'LINGUA PORTUGUESA' } as any, teacherName: 'Prof. Teste', regime, date: new Date(2026, 9, 4) });
  const { wb } = await buildMiniPautaWorkbook(
    { rows, header, regime, selectedGradeTypes: new Set(types), passingGrade: 10, recursoMinGrade: 7, hideDebtorGrades: true,
      signatures: { teacher: 'Prof. Teste', classHead: '', pedagogicDirector: 'Dir. Teste' } },
    load
  );
  return wb.getWorksheet('Mini-Pauta');
}

const EMU = 9525;
const colPx = (w: number) => Math.round(w * 7 + 5);

describe('Exportação Excel da Mini-Pauta — formatação do modelo', () => {
  it('usa Arial Narrow 12 (legenda a 10) e as alturas de linha do modelo', async () => {
    const ws = await mini('7.ª Classe', 'transicao', ['MAC', 'NPT', 'MT1', 'MT2', 'MT3', 'MFD']);
    expect(ws.getCell('A1').font).toMatchObject({ name: 'Arial Narrow', size: 10, bold: true });
    expect(ws.getCell('A5').font).toMatchObject({ name: 'Arial Narrow', size: 12 });
    expect(ws.getCell('A8').font).toMatchObject({ name: 'Arial Narrow', size: 12, bold: true, underline: true });
    expect(ws.getCell('A10').font).toMatchObject({ name: 'Arial Narrow', size: 12, bold: true });
    expect(ws.getCell('B12').font).toMatchObject({ name: 'Arial Narrow', size: 12, bold: true });
    expect(ws.getCell('B14').font).toMatchObject({ name: 'Arial Narrow', size: 12 });
    for (let r = 1; r <= 8; r++) expect(ws.getRow(r).height).toBe(15.95);
    expect(ws.getRow(10).height).toBe(18);
    expect(ws.getRow(11).height).toBe(18);
    expect(ws.getRow(13).height).toBe(20.1);
  });

  it('cabeçalho das notas: EJA 32,1 pt e classes de exame 28,5 pt', async () => {
    const eja = await mini('II Ano EJA (Módulos 3-4)', 'eja', ['MAC', 'NPT', 'SUB', 'AAV', 'PCP', 'MT1', 'MT2', 'MT3', 'MFD']);
    expect(eja.getRow(13).height).toBe(32.1);
    expect(eja.getCell('D13').value).toBe('MAC\n(0–14)');
    const ex = await mini('9.ª Classe', 'exame', ['MAC', 'NPT', 'MT1', 'MT2', 'MT3', 'MFD', 'NEE', 'NEO', 'NER', 'MF']);
    expect(ex.getRow(13).height).toBe(28.5);
  });

  it('o título é centrado e a insígnia fica centrada sobre ele, com a base na base da linha 4', async () => {
    for (const [grade, regime, types] of [
      ['7.ª Classe', 'transicao', ['MAC', 'NPT', 'MT1', 'MT2', 'MT3', 'MFD']],
      ['9.ª Classe', 'exame', ['MAC', 'NPT', 'MT1', 'MT2', 'MT3', 'MFD', 'NEE', 'NEO', 'NER', 'MF']],
      ['II Ano EJA (Módulos 3-4)', 'eja', ['MAC', 'NPT', 'SUB', 'AAV', 'PCP', 'MT1', 'MT2', 'MT3', 'MFD']]
    ] as const) {
      const ws = await mini(grade, regime, [...types]);
      expect(ws.getCell('A5').alignment?.horizontal === 'center' || ws.getCell('D5').alignment?.horizontal === 'center').toBe(true);
      // eixo do título = centro do intervalo fundido da linha 5
      const m = (ws as any)._merges ? Object.values((ws as any)._merges as Record<string, any>).map((x: any) => x.model).find((x: any) => x.top === 5) : null;
      expect(m).toBeTruthy();
      const px = (c: number) => colPx(ws.getColumn(c).width as number);
      const left = (c: number) => { let s = 0; for (let i = 1; i < c; i++) s += px(i); return s; };
      const axis = (left(m.left) + left(m.right + 1)) / 2;
      const imgs = ws.getImages();
      const insignia = imgs[0];
      const tl: any = insignia.range.tl;
      const ext: any = insignia.range.ext;
      const x = left(tl.nativeCol + 1) + tl.nativeColOff / EMU;
      expect(Math.abs(x + ext.width / 2 - axis)).toBeLessThan(1.5);
      const row = 15.95 * 96 / 72;
      expect(Math.abs((tl.nativeRow * row + tl.nativeRowOff / EMU + ext.height) - 4 * row)).toBeLessThan(1.5);
      // proporção original 84×68
      expect(Math.abs(ext.width / ext.height - 84 / 68)).toBeLessThan(0.02);
    }
  });

  it('o logótipo do EJA só existe nas pautas do EJA', async () => {
    const eja = await mini('II Ano EJA (Módulos 3-4)', 'eja', ['MAC', 'NPT', 'SUB', 'AAV', 'PCP', 'MT1', 'MT2', 'MT3', 'MFD']);
    const t = await mini('7.ª Classe', 'transicao', ['MAC', 'NPT', 'MT1', 'MT2', 'MT3', 'MFD']);
    expect(eja.getImages().length).toBe(2);
    expect(t.getImages().length).toBe(1);
  });

  it('rodapé: O/A Professor/a e O/A Subdirector/a Pedagógico/a', async () => {
    const ws = await mini('7.ª Classe', 'transicao', ['MAC', 'NPT', 'MT1', 'MT2', 'MT3', 'MFD']);
    expect(ws.getCell('A20').value).toBe('O/A Professor/a');
    expect(ws.getCell('A20').font).toMatchObject({ name: 'Arial Narrow', size: 12, bold: true });
  });

  it('MT1, MT2, MT3 e MFD têm sempre fórmula', async () => {
    const ws = await mini('7.ª Classe', 'transicao', ['MAC', 'NPT', 'MT1', 'MT2', 'MT3', 'MFD']);
    ['F14', 'I14', 'L14', 'M14'].forEach((a) => expect(typeof (ws.getCell(a).value as any).formula).toBe('string'));
  });
});

describe('Exportação Excel da Pauta Final — nomes das disciplinas', () => {
  const subjects: any[] = [
    { id: 'a', name: 'LINGUA PORTUGUESA' },
    { id: 'b', name: 'MATEMATICA' },
    { id: 'c', name: 'EDUCAÇÃO MORAL E CÍVICA' }
  ];
  const row = (): StudentPautaGeralItem => ({
    id: '1', studentId: '1', num: 1, name: 'Aluno Teste', gender: 'F', birthYear: '', age: '', isDebtor: false, isDesistente: false, mf: 11, situation: 'APROVADO',
    subjectGrades: Object.fromEntries(subjects.map((s) => [s.id, { mt1: 10, mt2: 11, mt3: 12, mfd: 11 }]))
  });
  async function pauta(visible: Array<'MT1' | 'MT2' | 'MT3'>, regime: 'transicao' | 'exame' = 'transicao') {
    const activeClass = classOf('7.ª Classe');
    const header = buildPautaHeader({ kind: 'pauta', settings, activeClass, regime, date: new Date(2026, 9, 4) });
    const { wb } = await buildPautaFinalWorkbook(
      { rows: [row()], subjects, header, regime, selectedGradeTypes: buildPautaGradeTypes(visible, regime), isKey: () => false, passingGrade: 10, hideDebtorGrades: true,
        signatures: { classHead: '', pedagogicDirector: 'Dir', generalDirector: '' } },
      load
    );
    return wb.getWorksheet('Pauta Final');
  }
  const groupHeaders = (ws: any) => {
    const out: string[] = [];
    ws.getRow(12).eachCell((c: any) => { if (typeof c.value === 'string') out.push(c.value); });
    return out;
  };

  it('com MT visíveis usa siglas', async () => {
    const ws = await pauta(['MT1', 'MT2', 'MT3']);
    const h = groupHeaders(ws);
    expect(h).toContain('MAT');
    expect(h).not.toContain('MATEMATICA');
    expect(h).not.toContain('LINGUA PORTUGUESA');
  });

  it('só com MFD e MF usa o nome completo', async () => {
    const ws = await pauta([]);
    const h = groupHeaders(ws);
    expect(h).toContain('LINGUA PORTUGUESA');
    expect(h).toContain('MATEMATICA');
    expect(h).toContain('EDUCAÇÃO MORAL E CÍVICA');
    // o cabeçalho cresce para mostrar o nome inteiro
    expect(ws.getRow(12).height).toBeGreaterThan(15.75);
  });

  it('ocultar MT só esconde colunas: MFD e MF mantêm os mesmos valores/fórmulas', async () => {
    const all = await pauta(['MT1', 'MT2', 'MT3']);
    const none = await pauta([]);
    const mfOf = (ws: any) => { let v: any; ws.getRow(14).eachCell((c: any) => { if (c.value && (c.value as any).formula) v = c.value; }); return v; };
    expect((mfOf(none) as any).result).toBe((mfOf(all) as any).result);
    expect(all.getRow(13).values).not.toEqual(none.getRow(13).values); // menos sub-colunas
  });

  it('usa Arial Narrow na Pauta Final', async () => {
    const ws = await pauta(['MT1']);
    expect(ws.getCell('A1').font?.name).toBe('Arial Narrow');
    expect(ws.getCell('B14').font).toMatchObject({ name: 'Arial Narrow', size: 12 });
  });
});


describe('Exportação Excel da Pauta Final — cabeçalho fixo', () => {
  const mk = (n: number): any[] => Array.from({ length: n }, (_, i) => ({ id: `s${i}`, name: ['LINGUA PORTUGUESA', 'MATEMATICA', 'FISICA', 'QUIMICA', 'BIOLOGIA', 'HISTORIA', 'GEOGRAFIA', 'INFORMATICA', 'EDUCACAO FISICA', 'EDUCACAO VISUAL', 'INGLES', 'FRANCES'][i] }));
  async function build(n: number, visible: Array<'MT1' | 'MT2' | 'MT3'>, grade = '7.ª Classe', regime: 'transicao' | 'eja' = 'transicao') {
    const subjects = mk(n);
    const header = buildPautaHeader({ kind: 'pauta', settings, activeClass: classOf(grade), regime, date: new Date(2026, 9, 4) });
    const row: StudentPautaGeralItem = {
      id: '1', studentId: '1', num: 1, name: 'Aluno Teste', gender: 'F', birthYear: '', age: '', isDebtor: false, isDesistente: false, mf: 11, situation: 'APROVADO',
      subjectGrades: Object.fromEntries(subjects.map((s) => [s.id, { mt1: 10, mt2: 11, mt3: 12, mfd: 11 }]))
    };
    const { wb } = await buildPautaFinalWorkbook(
      { rows: [row], subjects, header, regime: regime as any, selectedGradeTypes: buildPautaGradeTypes(visible, regime as any), isKey: () => false, passingGrade: 10, hideDebtorGrades: true,
        signatures: { classHead: '', pedagogicDirector: 'Dir', generalDirector: '' } },
      load
    );
    return wb.getWorksheet('Pauta Final');
  }
  const snapshot = (ws: any) => {
    const merges = Object.values((ws as any)._merges as Record<string, any>).map((x: any) => x.model).filter((m: any) => m.top <= 11);
    const rowsOf = (r: number) => merges.filter((m: any) => m.top === r).map((m: any) => `${m.left}-${m.right}`);
    const px = (c: number) => colPx(ws.getColumn(c).width ?? 9);
    const left = (c: number) => { let t = 0; for (let i = 1; i < c; i++) t += px(i); return t; };
    const imgs = ws.getImages().map((im: any) => {
      const tl = im.range.tl;
      return { x: Math.round(left(tl.nativeCol + 1) + tl.nativeColOff / EMU), y: Math.round(tl.nativeRow * 15.95 * 96 / 72 + tl.nativeRowOff / EMU), w: Math.round(im.range.ext.width), h: Math.round(im.range.ext.height) };
    });
    return { titles: [5, 6, 7, 8].map(rowsOf), banner: rowsOf(10), desc: rowsOf(11), imgs, left };
  };

  it('a insígnia, os títulos, a faixa e a descrição não se movem quando se juntam disciplinas', async () => {
    for (const grade of ['7.ª Classe']) {
      const base = snapshot(await build(2, ['MT1', 'MT2', 'MT3'], grade));
      for (const n of [3, 6, 12]) {
        const s = snapshot(await build(n, ['MT1', 'MT2', 'MT3'], grade));
        expect(s.titles).toEqual(base.titles);
        expect(s.banner).toEqual(base.banner);
        expect(s.desc).toEqual(base.desc);
        expect(s.imgs).toEqual(base.imgs);
      }
    }
  });

  it('o mesmo vale com nomes completos (MT ocultas) ao acrescentar disciplinas no fim', async () => {
    const base = snapshot(await build(8, []));
    const more = snapshot(await build(12, []));
    expect(more.imgs).toEqual(base.imgs);
    expect(more.titles).toEqual(base.titles);
  });

  it('a faixa colorida continua até ao fim da tabela e o EJA mantém o logótipo fixo', async () => {
    const ws = await build(12, ['MT1', 'MT2', 'MT3'], 'II Ano EJA (Módulos 3-4)', 'eja');
    const lastCol = ws.columnCount;
    expect((ws.getCell(10, lastCol).fill as any)?.fgColor?.argb).toBeTruthy();
    const a = snapshot(await build(2, ['MT1', 'MT2', 'MT3'], 'II Ano EJA (Módulos 3-4)', 'eja'));
    const b = snapshot(ws);
    expect(b.imgs).toEqual(a.imgs);
    expect(b.imgs.length).toBe(2);
  });
});

describe('Mini-Pauta Excel — mapa estatístico com Transferidos', () => {
  it('traz o grupo TRANSFERIDOS (M, F, MF) só com os que saíram por transferência', async () => {
    const out = (id: string, gender: 'M' | 'F'): StudentMiniPautaItem => ({
      ...miniRow(), id, studentId: id, gender, isDesistente: true, isTransferido: true, obs: 'Transferido',
      mac1: '', npt1: '', mt1: '', mfd: ''
    });
    const dropped: StudentMiniPautaItem = { ...miniRow(), id: '9', studentId: '9', isDesistente: true, obs: 'Desistente', mac1: '', npt1: '', mt1: '', mfd: '' };
    const ws = await mini('7.ª Classe', 'transicao', ['MT1', 'MT2', 'MT3'], [miniRow(), out('2', 'M'), out('3', 'F'), out('4', 'F'), dropped]);

    let header: { row: number; col: number } | null = null;
    let desistidos: { row: number; col: number } | null = null;
    let transferidoCells = 0;
    ws.eachRow((row: any, r: number) => row.eachCell((cell: any, c: number) => {
      if (cell.value === 'TRANSFERIDOS' && !header) header = { row: r, col: c };
      if (cell.value === 'DESISTIDOS' && !desistidos) desistidos = { row: r, col: c };
      if (cell.value === 'Transferido') transferidoCells += 1;
    }));
    expect(header).not.toBeNull();
    expect(transferidoCells).toBe(3);
    const h = header as unknown as { row: number; col: number };
    const d = desistidos as unknown as { row: number; col: number };
    const dataRow = h.row + 2; // cabeçalho do grupo -> M/F/MF -> dados
    const val = (r: number, c: number) => (ws.getCell(r, c).value as any)?.result;
    expect([val(dataRow, h.col), val(dataRow, h.col + 1), val(dataRow, h.col + 2)]).toEqual([1, 2, 3]);
    // Desistidos (os que NÃO saíram por transferência) fica à parte.
    expect(val(dataRow, d.col + 2)).toBe(1);
    // As fórmulas de Excel contam pelo resultado "Transferido".
    expect(String((ws.getCell(dataRow, h.col).value as any).formula)).toContain('Transferido');
  });
});
