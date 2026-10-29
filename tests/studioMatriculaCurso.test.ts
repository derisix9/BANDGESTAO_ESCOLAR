import { describe, expect, it } from 'vitest';
import { buildEnrollment, formatMatriculaCartao } from '../src/studio/data';
import { assembleStudio } from '../src/studio/assemble';
import { initialState } from '../src/studio/state';

const mk = (id: string, name: string, extra: any = {}) => ({ id, name, classId: 'c1', className: '10.ª A', grade: '10.ª Classe', section: 'A', shift: 'Manhã', ...extra });
const db: any = {
  settings: { currentAcademicYear: '2026/2027', schoolName: 'Escola X' },
  students: [mk('s3', 'Carlos Zeca'), mk('s1', 'Ana Bela', { courseName: 'Ciências Físicas e Biológicas' }), mk('s2', 'Bruno Cruz'), mk('s9', 'Outro', { classId: 'c2', grade: '5.ª Classe' })],
  matriculas: [], classes: [{ id: 'c1', name: '10.ª A', area: 'Informática' }, { id: 'c2', name: '5.ª A' }],
  courses: [
    { id: 'k1', code: 'CFB', name: 'Ciências Físicas e Biológicas', description: 'Curso de preparação para o ensino superior.', status: 'ativo' },
    { id: 'k2', code: 'INF', name: 'Informática', description: 'Sistemas informáticos.', status: 'ativo', linkedClassIds: ['c1'] }
  ]
};

describe('número da pauta, matrícula e curso', () => {
  it('formata a matrícula com 3 dígitos + ano lectivo', () => {
    expect(formatMatriculaCartao(12, '2026/2027')).toBe('012-2026/2027');
    expect(formatMatriculaCartao('', '2026/2027')).toBe('');
  });
  it('número = posição alfabética na turma (igual à pauta)', () => {
    expect(buildEnrollment(db, db.students[1]).numero).toBe('1');
    expect(buildEnrollment(db, db.students[2]).numero).toBe('2');
    expect(buildEnrollment(db, db.students[0]).numero).toBe('3');
    expect(buildEnrollment(db, db.students[0]).matricula).toBe('003-2026/2027');
  });
  it('curso do aluno com descrição; sem curso usa a área da turma', () => {
    const a = buildEnrollment(db, db.students[1]);
    expect(a.curso).toBe('Ciências Físicas e Biológicas');
    expect(a.cursoDescricao).toContain('ensino superior');
    const b = buildEnrollment(db, db.students[2]);
    expect(b.curso).toBe('Informática');
    expect(b.cursoDescricao).toBe('Sistemas informáticos.');
  });
  it('cartão oficial do Ensino Médio mostra Curso e Nº de matrícula (sem a descrição do curso); primário não', () => {
    const s = { ...initialState('2026/2027'), studentId: 's1', modelId: 'est-oficial-iiciclo' };
    const v = assembleStudio(db, s);
    const txt = v.cardItems[0].front.prims.filter((p: any) => p.k === 'text').map((p: any) => p.text);
    expect(txt).toContain('CARTÃO DE ESTUDANTE Nº 001-2026/2027');
    expect(txt).toContain('Curso:');
    expect(txt).toContain('Ciências Físicas e Biológicas');
    expect(txt.some((t: string) => t.includes('ensino superior'))).toBe(false);
    const v2 = assembleStudio(db, { ...initialState('2026/2027'), studentId: 's9', modelId: 'est-oficial-primario' });
    const t2 = v2.cardItems[0].front.prims.filter((p: any) => p.k === 'text').map((p: any) => p.text);
    expect(t2).toContain('Período:');
    expect(t2).not.toContain('Curso:');
  });
  it('turma inteira: cada aluno com o seu número e curso', () => {
    const v = assembleStudio(db, { ...initialState('2026/2027'), scope: 'turma', classId: 'c1', modelId: 'est-oficial-iiciclo' });
    const titles = v.cardItems.map((i: any) => i.front.prims.find((p: any) => p.id === 'titulo').text);
    expect(titles).toEqual(['CARTÃO DE ESTUDANTE Nº 001-2026/2027', 'CARTÃO DE ESTUDANTE Nº 002-2026/2027', 'CARTÃO DE ESTUDANTE Nº 003-2026/2027']);
  });
  it('arredondamento: 0 = quadrado, N = raio nos cantos', () => {
    const base = { ...initialState('2026/2027'), studentId: 's1', modelId: 'est-oficial-iiciclo' };
    const sq = assembleStudio(db, { ...base, radius: 0 }).cardItems[0].front;
    expect(sq.radius).toBe(0);
    expect((sq.prims.find((p: any) => p.k === 'rect' && p.stroke) as any).r).toBeUndefined();
    const rd = assembleStudio(db, { ...base, radius: 8 }).cardItems[0].front;
    expect(rd.radius).toBe(8);
    expect((rd.prims.find((p: any) => p.k === 'rect' && p.stroke) as any).r).toBe(8);
    expect(assembleStudio(db, base).cardItems[0].front.radius).toBeUndefined();
  });
});
