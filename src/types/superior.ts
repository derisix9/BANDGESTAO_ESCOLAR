/**
 * MODELO DE DADOS — ENSINO SUPERIOR (MESCTI / Créditos ECTS / Regime Semestral)
 * ===========================================================================
 * Define as estruturas formais para instituições de Ensino Superior em Angola:
 * - Unidades Curriculares (UCs) semestrais com créditos ECTS e carga horária;
 * - Precedências obrigatórias, cadeiras em atraso e transição de ano;
 * - 4 Épocas de Exame (Frequência/Dispensa, Normal, Recurso, Especial);
 * - Média ponderada por ECTS e média final de curso;
 * - Estágios curriculares, Monografias/TCC com orientador e defesa pública;
 * - Emissão de Diplomas e Suplemento ao Diploma (padrão MESCTI / Bolonha);
 * - Propinas por ECTS/semestre e gestão de Bolsas de Estudo (INAGBE, Mérito).
 */

export type GrauAcademicoSuperior =
  | 'Bacharelato'
  | 'Licenciatura'
  | 'Mestrado'
  | 'Doutoramento'
  | 'PosGraduacao';

export type RegimeSemestral = 1 | 2 | 'anual';

export type EpocaExame = 'frequencia' | 'normal' | 'recurso' | 'especial';

/** Reconhecimento de UC feita noutra instituição / curso (equivalência ou transferência). */
export interface EquivalenciaUC {
  /** Instituição ou curso de origem. */
  instituicaoOrigem: string;
  /** Nota obtida na origem (0-20), quando existe. */
  notaOrigem?: number;
  /** Se a nota entra na média ponderada. Sem nota, nunca entra. */
  contaParaMedia: boolean;
  /** Referência do despacho / deliberação que reconheceu a equivalência. */
  despacho?: string;
}

export type TipoUnidadeCurricular =
  | 'obrigatoria'
  | 'optativa'
  | 'estagio'
  | 'monografia'
  | 'seminario';

export interface CargaHorariaContacto {
  /** Horas Teóricas (T) */
  teorica: number;
  /** Horas Práticas (P) */
  pratica: number;
  /** Horas Teórico-Práticas (TP) */
  teoricoPratica: number;
  /** Horas Práticas Laboratoriais (PL) */
  laboratorial: number;
  /** Horas de Campo ou Estágio Clínico/Técnico */
  campoEstagio?: number;
}

/** Unidade Curricular (UC / Cadeira) de Ensino Superior */
export interface UnidadeCurricular {
  id: string;
  code: string;                     // ex: INF101, DIR201, MED302
  name: string;                     // ex: Algoritmos e Estruturas de Dados
  shortName?: string;
  courseId: string;                 // Ligação ao Course (Licenciatura em ...)
  courseName: string;
  year: number;                     // 1.º Ano, 2.º Ano, 3.º Ano, 4.º Ano, 5.º Ano
  semester: RegimeSemestral;        // 1.º Semestre ou 2.º Semestre
  creditsECTS: number;              // Créditos ECTS (tipicamente 4 a 8, totalizando 30 ECTS/semestre)
  totalHours: number;               // Carga horária total (ex: 60h, 90h, 120h)
  contactHours: CargaHorariaContacto;
  autonomousHours: number;          // Horas de estudo e trabalho autónomo
  type: TipoUnidadeCurricular;
  prerequisites: string[];          // IDs de outras UCs que são precedência obrigatória
  prerequisiteNames?: string[];     // Rótulos para visualização rápida
  department?: string;
  syllabus?: string;                // Programa curricular e competências
  academicYear: string;
  status: 'ativo' | 'inativo';
}

/** Inscrição Semestral do Estudante numa Unidade Curricular */
export interface InscricaoUC {
  id: string;
  studentId: string;
  studentName: string;
  studentProcNumber: string;
  courseId: string;
  courseName: string;
  ucId: string;
  ucCode: string;
  ucName: string;
  academicYear: string;
  year: number;                     // Ano curricular da cadeira
  semester: 1 | 2;
  creditsECTS: number;
  isCadeiraAtraso: boolean;          // true se é cadeira de ano anterior em atraso
  status: 'inscrito' | 'aprovado' | 'reprovado' | 'anulado';
  // Avaliação e Épocas de Exame
  notaFrequencia?: number;          // Média das Provas Parcelares / Frequências (0-20)
  notaExameNormal?: number;         // 1.ª Época (0-20)
  notaRecurso?: number;             // 2.ª Época (0-20)
  notaEspecial?: number;            // Época Especial (0-20)
  notaFinal?: number;               // Classificação final atribuída (0-20)
  epocaAprovacao?: EpocaExame | 'dispensa' | 'equivalencia';
  /** Presente quando a aprovação vem de uma equivalência e não de avaliação nesta instituição. */
  equivalencia?: EquivalenciaUC;
  inscribedAt: string;
  observations?: string;
}

/** Monografia / Trabalho de Conclusão de Curso (TCC) */
export interface MonografiaTCC {
  id: string;
  code: string;                     // ex: TCC-2026-001
  studentId: string;
  studentName: string;
  studentProcNumber: string;
  courseId: string;
  courseName: string;
  academicYear: string;
  theme: string;                    // Título / Tema aprovado
  abstract?: string;                // Resumo do trabalho
  advisorName: string;              // Professor Orientador
  advisorEmail?: string;
  coAdvisorName?: string;           // Co-orientador (se aplicável)
  lineOfResearch?: string;          // Linha de Investigação Científica
  status: 'proposta' | 'em_elaboracao' | 'depositado' | 'defesa_agendada' | 'defendido' | 'reprovado';
  submissionDate?: string;
  defenseDate?: string;
  defenseTime?: string;
  defenseRoom?: string;
  juryPresident?: string;           // Presidente do Júri
  juryArguente?: string;            // Vogal Arguente
  juryVogal?: string;               // 2.º Vogal
  defenseGrade?: number;            // Nota da Defesa Pública (0-20)
  finalMention?: 'Aprovado' | 'Aprovado com Distinção' | 'Aprovado com Distinção e Louvor' | 'Não Aprovado';
  depositUrl?: string;              // Referência do documento em PDF
  createdAt: string;
  updatedAt: string;
}

/** Estágio Curricular / Profissional */
export interface EstagioCurricular {
  id: string;
  code: string;                     // ex: EST-2026-001
  studentId: string;
  studentName: string;
  studentProcNumber: string;
  courseId: string;
  courseName: string;
  academicYear: string;
  institutionOrCompany: string;     // Local de acolhimento (Hospital, Tribunal, Empresa, Ministério...)
  sector?: string;                  // Departamento / Serviço
  supervisorName: string;           // Supervisor na entidade de acolhimento
  supervisorContact?: string;
  tutorTeacherName: string;         // Tutor docente na faculdade
  totalRequiredHours: number;       // Horas totais obrigatórias (ex: 300h)
  completedHours: number;
  startDate: string;
  endDate: string;
  status: 'em_curso' | 'concluido' | 'interrompido';
  reportGrade?: number;             // Nota do Relatório de Estágio (0-20)
  supervisorGrade?: number;         // Nota da Entidade Externa (0-20)
  finalGrade?: number;              // Nota Final Ponderada (0-20)
  notes?: string;
}

/** Bolsa de Estudo de Ensino Superior */
export interface BolsaEstudo {
  id: string;
  code: string;                     // ex: BOL-2026-001
  studentId: string;
  studentName: string;
  studentProcNumber: string;
  courseId: string;
  courseName: string;
  academicYear: string;
  type: 'INAGBE' | 'merito' | 'social_carencia' | 'institucional_colaborador' | 'empresa_parceira';
  sponsorName: string;              // ex: "INAGBE - Governo de Angola", "Sonangol E.P.", "Fundo Social"
  coverageType: 'integral_100' | 'parcial_50' | 'parcial_75' | 'parcial_25' | 'montante_fixo';
  fixedMonthlyAmountKz?: number;    // Para tipo montante_fixo
  discountPercent: number;          // Percentual aplicado na propina (100, 75, 50, 25)
  status: 'ativa' | 'suspensa' | 'cancelada' | 'concluida';
  startDate: string;
  endDate?: string;
  minAverageRequired: number;       // Média mínima para manutenção (ex: 12.0 ou 14.0 valores)
  maxArrearsAllowed: number;        // Máximo de UCs em atraso permitidas (ex: 1)
  suspensionReason?: string;
  notes?: string;
}

/** Registo Oficial de Diploma e Suplemento ao Diploma (MESCTI) */
export interface DiplomaSuperior {
  id: string;
  code: string;                     // ex: DIP-2026-0045
  studentId: string;
  studentName: string;
  studentProcNumber: string;
  courseId: string;
  courseName: string;
  degreeGranted: GrauAcademicoSuperior; // ex: 'Licenciatura'
  degreeTitle: string;              // ex: "Licenciado em Engenharia Informática"
  academicYearConcluded: string;    // ex: "2025/2026"
  completionDate: string;           // Data da última prova / defesa
  finalGradeCurricular: number;     // Média ponderada ECTS das UCs (0-20)
  tccGrade?: number;                // Nota do TCC / Defesa (0-20)
  finalCourseGrade: number;         // Classificação Final do Curso (0-20)
  finalMention: 'Suficiente' | 'Bom' | 'Muito Bom' | 'Excelente' | 'Com Distinção' | 'Distinção e Louvor';
  totalCreditsECTS: number;         // Total de ECTS cumpridos (ex: 240 ECTS para 4 anos)
  // Registo Notarial / Secretaria Geral
  registerNumber: string;           // Número de Registo
  registryBook: string;             // Livro de Registo de Diplomas
  registryPage: string;             // Folha / Página do Livro
  issueDate: string;
  dispatchNumber?: string;          // Despacho de Homologação da Reitoria/Direção Geral
  rectorName: string;
  academicDirectorName: string;
  status: 'emitido' | 'entregue' | 'anulado';
}
