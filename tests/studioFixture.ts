import type { StudioData } from '../src/studio/data';
import { buildRows } from '../src/studio/data';

const rec = (name: string, mf: number) => ({ subjectId: name, subjectName: name, mac1: '', npp1: '', npt1: '', mt1: mf, mac2: '', npp2: '', npt2: '', mt2: mf, mac3: '', npp3: '', npt3: '', mt3: mf, mfd: mf, ca: mf, situation: 'Aprovado' } as any);
const subj = ['Língua Portuguesa', 'Língua Inglesa', 'Matemática', 'Biologia', 'Física', 'Química', 'Geografia', 'História', 'Educação Física', 'Educação Moral e Cívica', 'Educação Visual Plástica', 'Educação Laboral'];
const mk = (year: string, grade: string, base: number) => ({ year, grade, classNum: Number(grade.split('.')[0]), className: grade + ' B', records: subj.map((s, i) => rec(s, base + (i % 4))), finalAverage: base + 1, result: 'Aprovado' });

export function fixtureData(): StudioData {
  const history = [mk('2019/2020', '7.ª Classe', 10), mk('2020/2021', '8.ª Classe', 11), mk('2021/2022', '9.ª Classe', 12)];
  const { rows, averageByClass } = buildRows(history as any, { grade: '9.ª Classe', disciplineGrades: [] } as any);
  return {
    school: { name: 'Complexo Escolar nº 292, MJE Samora Machel - Quêssua', subTitle: '', decree: 'nº 6474/2025 de 16/07', province: 'Malanje', municipality: 'Malanje', address: 'Malanje', phone: '923 000 000', email: '', logoUrl: '', city: 'Malanje', directorName: 'Branca Francisco Andrade', directorPedagogicoName: 'António César Paulino Dambi', secretariaName: 'João Manuel José', currentYear: '2025/2026' },
    person: { id: '1', name: 'Manuel Bartolomeu Matamba', father: 'Pedro Neves Matamba', mother: 'Anita Bartolomeu Banvo', gender: 'M', birthDateIso: '2000-01-04', birthDate: '04/01/2000', birthDateExt: '04 de Janeiro de 2000', naturalidade: 'Cuale', municipio: 'Calandula', provincia: 'Malanje', bi: '009123905ME043', biIssueDate: '13/12/2022', procNumber: '2025-0012', photo: '', phone: '923111222' },
    enrollment: { year: '2025/2026', grade: '9.ª Classe', classNum: 9, turma: 'B', numero: '31', periodo: 'Tarde', curso: '', cursoDescricao: '', cursoCodigo: '', matricula: '031-2025/2026', sala: '' },
    history: history as any, rows, averageByClass, generatedAt: new Date().toISOString()
  };
}
