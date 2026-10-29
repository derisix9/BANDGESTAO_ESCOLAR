import { describe, expect, it } from 'vitest';
import { validateMedData, groupIssuesByEntity, medIssuesToCsv, isValidBi, isValidAngolanPhone, expectedAgeForGrade } from '../src/utils/medValidator';

const emptyData: any = { identificacao: [], matriculaInicial: [], aproveitamento: [], corpoDocente: [] };
const cls = (id: string, name: string, grade: string, shift = 'Manhã') =>
  ({ id, name, grade, shift, section: 'A', cycle: '', room: '', studentCount: 0, maxCapacity: 2, headTeacherId: '', headTeacherName: '', academicYear: '2026/2027' } as any);
const st = (id: string, name: string, over: Record<string, any> = {}) =>
  ({ id, name, procNumber: `P${id}`, gender: 'M', birthDate: '2019-05-01', classId: 'c1', className: '', status: 'active', ...over } as any);
const school = {
  schoolName: 'Escola Teste', medCode: 'ESC-1', schoolNature: 'Privada', province: 'Luanda', municipality: 'Belas',
  commune: 'Benfica', bairro: 'X', decreeAuthorization: 'Dec 1', directorGeral: 'A B', phone: '923000000',
  email: 'a@b.ao', currentAcademicYear: '2026/2027'
};
const mk = (over: Record<string, any> = {}): any => ({ settings: school, classes: [cls('c1', '1A', '1.ª Classe')], students: [], teachers: [], ...over });

describe('formatos', () => {
  it('BI e telefone angolanos', () => {
    expect(isValidBi('004567890LA041')).toBe(true);
    expect(isValidBi('1234')).toBe(false);
    expect(isValidAngolanPhone('+244 923 000 000')).toBe(true);
    expect(isValidAngolanPhone('823000000')).toBe(false);
    expect(expectedAgeForGrade('1.ª Classe')).toBe(6);
  });
});

describe('validateMedData', () => {
  it('escola completa e sem alunos: só falha por folha de matrícula vazia', () => {
    const r = validateMedData(mk(), 'anual', emptyData);
    expect(r.issues.map((i) => i.code)).toEqual(['MATRICULA_VAZIA']);
  });
  it('comuna fora do município é só aviso', () => {
    const r = validateMedData(mk({ settings: { ...school, commune: 'Kilamba' } }), 'anual', emptyData);
    const i = r.issues.find((x) => x.code === 'ESC_COMUNA');
    expect(i?.severity).toBe('aviso');
  });
  it('aponta campos da escola em falta, província e natureza inválidas', () => {
    const r = validateMedData(mk({ settings: { ...school, medCode: '', province: 'Atlantida', schoolNature: 'Mista' } }), 'anual', emptyData);
    const codes = r.issues.map((i) => i.code);
    expect(codes).toContain('ESC_CAMPO_EM_FALTA');
    expect(codes).toContain('ESC_PROVINCIA');
    expect(codes).toContain('ESC_NATUREZA');
    expect(r.ok).toBe(false);
  });
  it('município que não pertence à província', () => {
    const r = validateMedData(mk({ settings: { ...school, municipality: 'Lobito' } }), 'anual', emptyData);
    expect(r.issues.some((i) => i.code === 'ESC_MUNICIPIO')).toBe(true);
  });
  it('alunos: nascimento, duplicados, género, distorção, sem turma, lotação', () => {
    const db = mk({
      students: [
        st('1', 'Ana Maria Silva', { birthDate: '' }),
        st('2', 'Bruno Costa Neto', { birthDate: '2019-02-30' }),
        st('3', 'Carlos Dias Lopes', { procNumber: 'P1' }),
        st('4', 'Dina Pereira Gomes', { gender: '' }),
        st('5', 'Eva Santos Lima', { birthDate: '2008-01-01' }),
        st('6', 'Sem Turma Aluno', { classId: 'x' })
      ]
    });
    const r = validateMedData(db, 'anual', emptyData);
    const by = (code: string) => r.issues.filter((i) => i.code === code).map((i) => i.entityId);
    expect(by('ALUNO_NASC_EM_FALTA')).toEqual(['1']);
    expect(by('ALUNO_NASC_INVALIDA')).toEqual(['2']);
    expect(by('ALUNO_PROC_DUPLICADO')).toEqual(['3']);
    expect(by('ALUNO_GENERO')).toEqual(['4']);
    expect(by('ALUNO_DISTORCAO')).toEqual(['5']);
    expect(by('ALUNO_SEM_TURMA')).toEqual(['6']);
    expect(by('TURMA_LOTACAO')).toEqual(['c1']);
  });
  it('docentes e totais da folha 3', () => {
    const db = mk({ teachers: [
      { id: 't1', name: 'Prof Um', agentNumber: 'A1', gender: 'M', degree: '', department: 'Mat', status: 'ativo' },
      { id: 't2', name: 'Prof Dois', agentNumber: 'A1', gender: 'F', degree: 'Lic', department: 'Port', status: 'ativo' }
    ] });
    const data: any = { ...emptyData,
      matriculaInicial: [{ classe: '1.ª Classe', inscritosM: 2, inscritosF: 0 }],
      aproveitamento: [{ classe: '1.ª Classe', curso: 'Geral', turno: 'Manhã', avalM: 2, avalF: 0, aprovM: 2, aprovF: 1, reprovM: 1, reprovF: 0, desistM: 0, desistF: 0 }] };
    const codes = validateMedData(db, 'anual', data).issues.map((i) => i.code);
    expect(codes).toContain('DOC_HABILITACOES');
    expect(codes).toContain('DOC_AGENTE_DUPLICADO');
    expect(codes).toContain('APROV_SOMA');
  });
  it('agrupa por entidade, erros primeiro, e gera CSV', () => {
    const r = validateMedData(mk({ students: [st('1', 'Ana Silva', { birthDate: '' })] }), 'anual', emptyData);
    expect(groupIssuesByEntity(r.issues)[0].errors).toBeGreaterThan(0);
    expect(medIssuesToCsv(r.issues).split('\r\n')[0]).toContain('Gravidade');
  });
});
