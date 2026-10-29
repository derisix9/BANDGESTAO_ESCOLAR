import { describe, it, expect } from 'vitest';
import JSZip from 'jszip';
import { assembleStudio } from '../src/studio/assemble';
import { initialState } from '../src/studio/state';
import { buildDocxBatch } from '../src/studio/exportDocx';
import { buildHistoricoPdfBatch } from '../src/studio/exportPdf';

const student = (id: string, name: string) => ({
  id, name, classId: 'c1', grade: '9.ª Classe', className: '9.ª A', procNumber: `P-${id}`, gender: 'M',
  trimesterGradesYear: '2025/2026',
  trimesterGrades: [
    { subjectId: 'lp', subjectName: 'Língua Portuguesa', mt1: 12, mt2: 13, mt3: 14, mfd: 13, situation: 'Aprovado' },
    { subjectId: 'mat', subjectName: 'Matemática', mt1: 11, mt2: 12, mt3: 12, mfd: 12, situation: 'Aprovado' }
  ]
});

const db: any = {
  settings: { schoolName: 'Escola Teste', currentAcademicYear: '2025/2026', municipality: 'Malanje', directorGeral: 'O Director' },
  classes: [{ id: 'c1', name: '9.ª A' }],
  students: [student('s1', 'Aluno Um'), student('s2', 'Aluna Dois'), student('s3', 'Aluno Três')],
  academicDocuments: []
};

const batchState = (tab: any) => ({ ...initialState('2025/2026'), tab, scope: 'turma' as const, classId: 'c1' });

describe('estúdio · turma inteira — documentos', () => {
  it('certificados por turma: um FlowDoc por aluno num único Word', async () => {
    const v = assembleStudio(db, batchState('certificado'));
    expect(v.isBatch).toBe(true);
    expect(v.batchFlowDocs.length).toBe(3);
    expect(v.flowDoc).toBe(v.batchFlowDocs[0]); // pré-visualização = 1.º aluno
    expect(v.batchFlowDocs.some((d) => d.blocks.some((b) => b.t === 'para' && b.html.toLowerCase().includes('aluna dois')))).toBe(true);
    const bytes = await buildDocxBatch(v.batchFlowDocs, {});
    expect(bytes.length).toBeGreaterThan(1000);
    const zip = await JSZip.loadAsync(bytes);
    const xml = await zip.file('word/document.xml')!.async('string');
    expect((xml.match(/w:br w:type="page"/g) || []).length).toBe(2); // quebra entre alunos
    expect(xml.toLowerCase()).toContain('aluno um');
    expect(xml.toLowerCase()).toContain('aluno três');
  });

  it('declarações por turma também entram em modo lote', () => {
    const v = assembleStudio(db, batchState('declaracao'));
    expect(v.isBatch).toBe(true);
    expect(v.batchFlowDocs.length).toBe(3);
  });

  it('histórico por turma: dados de todos os alunos e PDF único com uma secção por aluno', async () => {
    const v = assembleStudio(db, batchState('historico'));
    expect(v.isBatch).toBe(true);
    expect(v.batchData.length).toBe(3);
    const bytes = await buildHistoricoPdfBatch(v.batchData.map((d, i) => ({ data: d, docNumber: `HIST-2026-${i + 1}`, verifyCode: 'XPTO' })));
    expect(bytes.length).toBeGreaterThan(1000);
    // PDF válido (cabeçalho %PDF)
    expect(String.fromCharCode(...bytes.slice(0, 5))).toBe('%PDF-');
  });

  it('diplomas por turma geram uma cena A4 por aluno', () => {
    const v = assembleStudio(db, batchState('diploma'));
    expect(v.isBatch).toBe(true);
    expect(v.cardItems.length).toBe(3);
    expect(v.cardItems[0].front.w).toBe(297);
  });
});
