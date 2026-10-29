import { ClassRoom, InstitutionSettings, Subject } from '../types';
import { PautaRegime } from './pautaCalculations';
import { getFallbackAcademicYear } from './academicYear';

/**
 * Cabeçalho OFICIAL das pautas — uma única fonte de verdade usada tanto pela
 * IMPRESSÃO (componente PautaOfficialHeader) como pela EXPORTAÇÃO EM EXCEL, para
 * que os dois documentos sejam sempre iguais (legenda, cabeçalho, descrição, rodapé).
 */
export const ANGOLA_INSIGNIA_URL = '/pauta/insignia_angola.png';
export const EJA_LOGO_URL = '/pauta/logo_eja.png';

export interface PautaHeaderModel {
  /** Legenda das siglas (canto superior esquerdo). */
  legend: string[];
  /** República / Governo Provincial / Gabinete Provincial de Educação / Escola (última linha). */
  titleLines: string[];
  /** Faixa de título: "MINI-PAUTA - I CICLO", "MINI-PAUTA - EJA 1º ANO"... */
  banner: string;
  bannerTone: 'blue' | 'green';
  /** Descrição em pares rótulo/valor; os valores saem a vermelho. */
  description: Array<{ label: string; value: string }>;
  insigniaUrl: string;
  /** Logótipo do EJA (só nas pautas do EJA), à esquerda junto à legenda. */
  ejaLogoUrl?: string;
  /** Local e data de emissão: "Malanje, aos 18 de Novembro de 2025". */
  placeAndDate: string;
  documentSubtitle?: string;
}

export type PautaDocumentKind = 'minipauta' | 'pauta';

const MONTHS = ['Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho', 'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'];

export function formatLongDatePt(d: Date = new Date()): string {
  return `${d.getDate()} de ${MONTHS[d.getMonth()]} de ${d.getFullYear()}`;
}

const titleCase = (s: string) =>
  s.toLowerCase().replace(/(^|\s|-)(\p{L})/gu, (_m, sep, ch) => `${sep}${ch.toUpperCase()}`).replace(/\b(De|Da|Do|Das|Dos)\b/g, (m) => m.toLowerCase());

/** "7.ª Classe" -> "7ª"; "I Ano EJA (Módulos 1-2)" -> "1º Ano / EJA". */
export function shortClassLabel(grade?: string | null): string {
  if (!grade) return '—';
  if (/\beja\b/i.test(grade)) return /\bII\b|\b2\b/i.test(grade) ? '2º Ano / EJA' : '1º Ano / EJA';
  const mod = String(grade).match(/m[óo]dulo\s*(\d+)/i);
  if (mod) return `M${mod[1]}`;
  const m = String(grade).match(/(\d+)/);
  return m ? `${m[1]}ª` : grade;
}

function levelLabel(grade?: string | null, regime?: PautaRegime): string {
  if (regime === 'eja') return `EJA ${/\bII\b|\b2\b/i.test(grade || '') ? '2º' : '1º'} ANO`;
  if (/^\s*m[óo]dulo\s*3\b/i.test(grade || '')) return 'ENSINO PRIMÁRIO';
  const m = String(grade || '').match(/(\d+)/);
  const n = m ? parseInt(m[1], 10) : 0;
  if (n >= 1 && n <= 6) return 'ENSINO PRIMÁRIO';
  if (n >= 7 && n <= 9) return 'I CICLO';
  if (n >= 10 && n <= 13) return 'II CICLO';
  return String(grade || '').toUpperCase();
}

export function buildPautaHeader(params: {
  kind: PautaDocumentKind;
  settings: InstitutionSettings;
  activeClass?: ClassRoom;
  subject?: Subject;
  teacherName?: string;
  regime: PautaRegime;
  totalStudents?: number;
  /** Colunas opcionais visíveis, para a legenda só explicar o que aparece. */
  parts?: { npp?: boolean; pg?: boolean };
  date?: Date;
}): PautaHeaderModel {
  const { kind, settings, activeClass, subject, teacherName, regime, parts, date } = params;
  const province = (settings.province || '').trim();

  const legend = ['MAC = Média das Avaliações Contínuas'];
  if (regime !== 'eja' && parts?.npp) legend.push('NPP = Nota da Prova Parcelar');
  legend.push('NPT = Nota da Prova do Trimestre', 'MT = Média do Trimestre', 'MFD = Média Final da Disciplina');
  if (regime === 'transicao' && parts?.pg) legend.push('PG = Prova Global');
  if (regime === 'eja') legend.push('AAV = Auto-Avaliação', 'PCP = Participação');
  if (regime === 'exame') {
    legend.push('NEO = Nota de Exame Oral', 'NEE = Nota de Exame Escrito', 'MF = Média Final', 'NER = Nota de Exame de Recurso');
  }

  const titleLines = [
    'REPÚBLICA DE ANGOLA',
    `GOVERNO PROVINCIAL DE ${province ? province.toUpperCase() : '________'}`,
    'GABINETE PROVINCIAL DE EDUCAÇÃO',
    (settings.schoolName || 'Instituição de Ensino').toUpperCase()
  ];

  const year = activeClass?.academicYear || settings.currentAcademicYear || getFallbackAcademicYear();
  const description: Array<{ label: string; value: string }> = [];
  if (kind === 'minipauta') description.push({ label: 'Disciplina', value: subject?.name || '—' });
  description.push(
    { label: 'Classe', value: shortClassLabel(activeClass?.grade) },
    { label: 'Turma', value: activeClass?.section || activeClass?.name || 'Única' },
    { label: 'Sala', value: activeClass?.room || '—' },
    // Período de estudo (Manhã / Tarde / Noite), e não o trimestre.
    { label: 'Período', value: activeClass?.shift || '—' },
    { label: 'Ano Lectivo', value: year }
  );
  if (activeClass?.area && (activeClass.grade || '').match(/1[0-3]/)) {
    description.splice(1, 0, { label: 'Curso', value: activeClass.area });
  }
  if (kind === 'minipauta') description.push({ label: 'Professor/a', value: teacherName || subject?.coordinatorName || '—' });

  return {
    legend,
    titleLines,
    banner: `${kind === 'minipauta' ? 'MINI-PAUTA' : 'PAUTA FINAL'} - ${levelLabel(activeClass?.grade, regime)}`,
    bannerTone: regime === 'eja' ? 'green' : 'blue',
    description,
    insigniaUrl: ANGOLA_INSIGNIA_URL,
    ejaLogoUrl: regime === 'eja' ? EJA_LOGO_URL : undefined,
    placeAndDate: `${province ? titleCase(province) : '________'}, aos ${formatLongDatePt(date)}`,
    documentSubtitle: regime === 'exame' ? 'Classe de Exame' : undefined
  };
}
