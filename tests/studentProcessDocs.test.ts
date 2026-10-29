import { describe, expect, it } from 'vitest';
import { collectStudentProcessDocs } from '../src/utils/studentProcessDocs';

const student: any = {
  id: 's1', docBiFile: { id: 'a', name: 'bi.pdf', size: 10, type: 'application/pdf', dataUrl: 'data:application/pdf;base64,AAAA' },
  additionalDocs: [{ id: 'b', name: 'foto.jpg', size: 5, type: 'image/jpeg', dataUrl: 'data:image/jpeg;base64,BBBB' }]
};
const admission: any = {
  id: 'ad1', studentId: 's1', createdAt: '2026-01-01',
  documents: [
    { key: 'bi_candidato', label: 'BI do candidato', delivered: true, attachment: { fileName: 'bi.pdf', mimeType: 'application/pdf', size: 10, dataUrl: 'data:application/pdf;base64,AAAA' } },
    { key: 'certificado', label: 'Certificado', delivered: true, attachment: { fileName: 'cert.pdf', mimeType: 'application/pdf', size: 20, dataUrl: '' } },
    { key: 'foto', label: 'Foto', delivered: false }
  ]
};

describe('processo do aluno', () => {
  it('junta ficha e inscrição, sem repetir o mesmo ficheiro', () => {
    const docs = collectStudentProcessDocs(student, [admission]);
    expect(docs.map((d) => d.fileName)).toEqual(['bi.pdf', 'foto.jpg', 'cert.pdf']);
    expect(docs[2].origin).toBe('inscricao');
  });
  it('ignora inscrições de outros alunos', () => {
    expect(collectStudentProcessDocs(student, [{ ...admission, studentId: 's2' }])).toHaveLength(2);
  });
});
