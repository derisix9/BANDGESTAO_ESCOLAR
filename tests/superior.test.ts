import { describe, it, expect } from 'vitest';
import {
  checkPrerequisites,
  calculateCadeirasEmAtraso,
  checkYearTransitionEligibility,
  calculateWeightedAverageECTS,
  calculateCourseFinalGrade,
  calculateSuperiorTuition,
  qualitativeMentionMESCTI
} from '../src/utils/superiorCalculations';
import {
  UnidadeCurricular,
  InscricaoUC,
  BolsaEstudo
} from '../src/types/superior';
import { SHARD_KEYS } from '../src/utils/shardSync';
import { buildProjectionForAluno, buildProjectionForEncarregado } from '../src/utils/userProjections';
import { SchoolDatabase, User, Student, GuardianStudentLink } from '../src/types';

describe('Ensino Superior — Regras Académicas & MESCTI', () => {
  const dummyUC1: UnidadeCurricular = {
    id: 'uc-calc-1',
    code: 'MAT101',
    name: 'Análise Matemática I',
    courseId: 'cur-inf',
    courseName: 'Engenharia Informática',
    year: 1,
    semester: 1,
    creditsECTS: 6,
    totalHours: 90,
    contactHours: { teorica: 45, pratica: 45, teoricoPratica: 0, laboratorial: 0 },
    autonomousHours: 60,
    type: 'obrigatoria',
    prerequisites: [],
    academicYear: '2026/2027',
    status: 'ativo'
  };

  const dummyUC2: UnidadeCurricular = {
    id: 'uc-calc-2',
    code: 'MAT102',
    name: 'Análise Matemática II',
    courseId: 'cur-inf',
    courseName: 'Engenharia Informática',
    year: 1,
    semester: 2,
    creditsECTS: 6,
    totalHours: 90,
    contactHours: { teorica: 45, pratica: 45, teoricoPratica: 0, laboratorial: 0 },
    autonomousHours: 60,
    type: 'obrigatoria',
    prerequisites: ['uc-calc-1'],
    academicYear: '2026/2027',
    status: 'ativo'
  };

  const allUCs = [dummyUC1, dummyUC2];

  describe('1. Precedências Obrigatórias', () => {
    it('permite inscrição se a cadeira não tiver pré-requisitos', () => {
      const res = checkPrerequisites(dummyUC1, [], allUCs);
      expect(res.allowed).toBe(true);
      expect(res.missingPrerequisites).toHaveLength(0);
    });

    it('bloqueia inscrição se o estudante não tiver aprovação no pré-requisito', () => {
      const studentInscricoes: InscricaoUC[] = [
        {
          id: 'i-1',
          studentId: 'st-1',
          studentName: 'João Silva',
          studentProcNumber: '2026-001',
          courseId: 'cur-inf',
          courseName: 'Engenharia Informática',
          ucId: 'uc-calc-1',
          ucCode: 'MAT101',
          ucName: 'Análise Matemática I',
          academicYear: '2026/2027',
          year: 1,
          semester: 1,
          creditsECTS: 6,
          isCadeiraAtraso: false,
          status: 'reprovado',
          notaFinal: 7,
          inscribedAt: '2026-03-01'
        }
      ];

      const res = checkPrerequisites(dummyUC2, studentInscricoes, allUCs);
      expect(res.allowed).toBe(false);
      expect(res.missingPrerequisites).toHaveLength(1);
      expect(res.missingPrerequisites[0].code).toBe('MAT101');
    });

    it('autoriza inscrição quando o pré-requisito foi aprovado com nota >= 10', () => {
      const studentInscricoes: InscricaoUC[] = [
        {
          id: 'i-1',
          studentId: 'st-1',
          studentName: 'João Silva',
          studentProcNumber: '2026-001',
          courseId: 'cur-inf',
          courseName: 'Engenharia Informática',
          ucId: 'uc-calc-1',
          ucCode: 'MAT101',
          ucName: 'Análise Matemática I',
          academicYear: '2026/2027',
          year: 1,
          semester: 1,
          creditsECTS: 6,
          isCadeiraAtraso: false,
          status: 'aprovado',
          notaFinal: 14,
          inscribedAt: '2026-03-01'
        }
      ];

      const res = checkPrerequisites(dummyUC2, studentInscricoes, allUCs);
      expect(res.allowed).toBe(true);
      expect(res.missingPrerequisites).toHaveLength(0);
    });
  });

  describe('2. Cadeiras em Atraso e Transição de Ano Curricular', () => {
    it('identifica corretamente cadeiras não aprovadas de anos curriculares anteriores', () => {
      const inscs: InscricaoUC[] = [
        {
          id: 'i-1',
          studentId: 'st-1',
          studentName: 'Maria',
          studentProcNumber: '2025-010',
          courseId: 'cur-inf',
          courseName: 'Engenharia Informática',
          ucId: 'uc-calc-1',
          ucCode: 'MAT101',
          ucName: 'Análise Matemática I',
          academicYear: '2025/2026',
          year: 1,
          semester: 1,
          creditsECTS: 6,
          isCadeiraAtraso: false,
          status: 'reprovado',
          notaFinal: 8,
          inscribedAt: '2025-03-01'
        },
        {
          id: 'i-2',
          studentId: 'st-1',
          studentName: 'Maria',
          studentProcNumber: '2025-010',
          courseId: 'cur-inf',
          courseName: 'Engenharia Informática',
          ucId: 'uc-inf-101',
          ucCode: 'INF101',
          ucName: 'Introdução à Programação',
          academicYear: '2025/2026',
          year: 1,
          semester: 1,
          creditsECTS: 6,
          isCadeiraAtraso: false,
          status: 'aprovado',
          notaFinal: 15,
          inscribedAt: '2025-03-01'
        }
      ];

      const atrasos = calculateCadeirasEmAtraso(inscs, 2);
      expect(atrasos).toHaveLength(1);
      expect(atrasos[0].ucCode).toBe('MAT101');
    });

    it('permite transição para 2.º ano com até 2 cadeiras de transição', () => {
      const inscs: InscricaoUC[] = [
        {
          id: 'i-1',
          studentId: 'st-1',
          studentName: 'Maria',
          studentProcNumber: '2025-010',
          courseId: 'cur-inf',
          courseName: 'Engenharia Informática',
          ucId: 'uc-1',
          ucCode: 'UC1',
          ucName: 'Cadeira 1',
          academicYear: '2025/2026',
          year: 1,
          semester: 1,
          creditsECTS: 6,
          isCadeiraAtraso: false,
          status: 'reprovado',
          inscribedAt: '2025-03-01'
        }
      ];

      const trans = checkYearTransitionEligibility(inscs, 2, 2, 12);
      expect(trans.eligible).toBe(true);
      expect(trans.arrearsCount).toBe(1);
      expect(trans.arrearsECTS).toBe(6);
    });

    it('reprova/retém estudante que exceda 2 cadeiras em atraso', () => {
      const inscs: InscricaoUC[] = [
        {
          id: 'i-1',
          studentId: 'st-1',
          studentName: 'Maria',
          studentProcNumber: '2025-010',
          courseId: 'cur-inf',
          courseName: 'Engenharia Informática',
          ucId: 'uc-1',
          ucCode: 'UC1',
          ucName: 'Cadeira 1',
          academicYear: '2025/2026',
          year: 1,
          semester: 1,
          creditsECTS: 6,
          isCadeiraAtraso: false,
          status: 'reprovado',
          inscribedAt: '2025-03-01'
        },
        {
          id: 'i-2',
          studentId: 'st-1',
          studentName: 'Maria',
          studentProcNumber: '2025-010',
          courseId: 'cur-inf',
          courseName: 'Engenharia Informática',
          ucId: 'uc-2',
          ucCode: 'UC2',
          ucName: 'Cadeira 2',
          academicYear: '2025/2026',
          year: 1,
          semester: 1,
          creditsECTS: 6,
          isCadeiraAtraso: false,
          status: 'reprovado',
          inscribedAt: '2025-03-01'
        },
        {
          id: 'i-3',
          studentId: 'st-1',
          studentName: 'Maria',
          studentProcNumber: '2025-010',
          courseId: 'cur-inf',
          courseName: 'Engenharia Informática',
          ucId: 'uc-3',
          ucCode: 'UC3',
          ucName: 'Cadeira 3',
          academicYear: '2025/2026',
          year: 1,
          semester: 2,
          creditsECTS: 6,
          isCadeiraAtraso: false,
          status: 'reprovado',
          inscribedAt: '2025-03-01'
        }
      ];

      const trans = checkYearTransitionEligibility(inscs, 2, 2, 12);
      expect(trans.eligible).toBe(false);
      expect(trans.arrearsCount).toBe(3);
      expect(trans.reason).toContain('Excede o limite máximo de 2 cadeiras em atraso');
    });
  });

  describe('3. Média Ponderada por Créditos ECTS', () => {
    it('calcula corretamente a média ponderada Σ(nota * ECTS) / Σ(ECTS)', () => {
      // UC A: 16 val, 6 ECTS -> 96
      // UC B: 12 val, 4 ECTS -> 48
      // UC C: 14 val, 6 ECTS -> 84
      // Total ponderado: 228 / 16 ECTS = 14.25
      const grades = [
        { grade: 16, creditsECTS: 6 },
        { grade: 12, creditsECTS: 4 },
        { grade: 14, creditsECTS: 6 }
      ];

      const res = calculateWeightedAverageECTS(grades);
      expect(res.average).toBe(14.25);
      expect(res.totalECTS).toBe(16);
    });

    it('retorna 0 quando não existem notas válidas', () => {
      const res = calculateWeightedAverageECTS([]);
      expect(res.average).toBe(0);
      expect(res.totalECTS).toBe(0);
    });
  });

  describe('4. Média Final de Curso & Menção MESCTI', () => {
    it('aplica ponderação oficial de 75% curricular + 25% defesa do TCC', () => {
      // Curricular: 14.0 * 0.75 = 10.5
      // TCC: 18.0 * 0.25 = 4.5
      // Final: 15.0 -> 'Bom'
      const res = calculateCourseFinalGrade(14.0, 18.0, 0.75, 0.25);
      expect(res.finalGrade).toBe(15.0);
      expect(res.finalMention).toBe('Bom');
    });

    it('atribui menções qualitativas oficiais da escala 0-20 do MESCTI', () => {
      expect(qualitativeMentionMESCTI(11)).toBe('Suficiente');
      expect(qualitativeMentionMESCTI(14)).toBe('Bom');
      expect(qualitativeMentionMESCTI(16.5)).toBe('Muito Bom');
      expect(qualitativeMentionMESCTI(18.2)).toBe('Excelente');
      expect(qualitativeMentionMESCTI(20)).toBe('Distinção e Louvor');
    });
  });

  describe('5. Propinas por ECTS & Bolsas de Estudo', () => {
    it('calcula valor bruto por ECTS (ex: 30 ECTS * 2.500 Kz = 75.000 Kz)', () => {
      const res = calculateSuperiorTuition(30, 2500, null);
      expect(res.grossAmountKz).toBe(75000);
      expect(res.discountAmountKz).toBe(0);
      expect(res.netAmountKz).toBe(75000);
    });

    it('aplica isenção integral de 100% para Bolseiros INAGBE', () => {
      const bolsa: BolsaEstudo = {
        id: 'b-1',
        code: 'BOL-001',
        studentId: 'st-1',
        studentName: 'Amílcar',
        studentProcNumber: '2026-001',
        courseId: 'cur-inf',
        courseName: 'Engenharia Informática',
        academicYear: '2026/2027',
        type: 'INAGBE',
        sponsorName: 'INAGBE - Governo de Angola',
        coverageType: 'integral_100',
        discountPercent: 100,
        status: 'ativa',
        startDate: '2026-01-01',
        minAverageRequired: 12.0,
        maxArrearsAllowed: 1
      };

      const res = calculateSuperiorTuition(30, 2500, bolsa);
      expect(res.grossAmountKz).toBe(75000);
      expect(res.discountAmountKz).toBe(75000);
      expect(res.netAmountKz).toBe(0);
      expect(res.notes[0]).toContain('Bolsa 100% (INAGBE - Governo de Angola): isenção total');
    });

    it('aplica desconto parcial de bolsa de mérito (ex: 50%)', () => {
      const bolsa: BolsaEstudo = {
        id: 'b-2',
        code: 'BOL-002',
        studentId: 'st-2',
        studentName: 'Helena',
        studentProcNumber: '2026-002',
        courseId: 'cur-inf',
        courseName: 'Engenharia Informática',
        academicYear: '2026/2027',
        type: 'merito',
        sponsorName: 'Fundo Social',
        coverageType: 'parcial_50',
        discountPercent: 50,
        status: 'ativa',
        startDate: '2026-01-01',
        minAverageRequired: 14.0,
        maxArrearsAllowed: 1
      };

      const res = calculateSuperiorTuition(30, 2500, bolsa);
      expect(res.grossAmountKz).toBe(75000);
      expect(res.discountAmountKz).toBe(37500);
      expect(res.netAmountKz).toBe(37500);
    });
  });

  describe('6. Integração com Coleções Sharded e Projeções de Utilizador', () => {
    it('todas as coleções de Ensino Superior constam de SHARD_KEYS', () => {
      const superiorKeys = [
        'unidadesCurriculares',
        'inscricoesUC',
        'monografiasTCC',
        'estagiosCurriculares',
        'bolsasEstudo',
        'diplomasSuperior'
      ];

      for (const k of superiorKeys) {
        expect(SHARD_KEYS).toContain(k);
      }
    });

    it('gera projeção isolada de Ensino Superior para Aluno', () => {
      const student: Student = {
        id: 'st-sup-1',
        name: 'Carlos Alberto',
        procNumber: 'SUP-2026',
        course: 'Engenharia Informática'
      } as any;

      const user: User = {
        id: 'usr-student-1',
        name: 'Carlos Alberto',
        email: 'carlos@escola.ao',
        role: 'aluno',
        linkedStudentId: 'st-sup-1',
        institutionId: 'inst_test'
      } as any;

      const fakeDb: SchoolDatabase = {
        students: [
          student,
          { id: 'st-sup-other', name: 'Outro Aluno', procNumber: 'SUP-9999' } as any
        ],
        inscricoesUC: [
          { id: 'insc-carlos', studentId: 'st-sup-1', ucCode: 'INF101' } as any,
          { id: 'insc-other', studentId: 'st-sup-other', ucCode: 'DIR101' } as any
        ],
        monografiasTCC: [
          { id: 'tcc-carlos', studentId: 'st-sup-1', theme: 'TCC Carlos' } as any
        ],
        estagiosCurriculares: [
          { id: 'est-carlos', studentId: 'st-sup-1', institutionOrCompany: 'Sonangol' } as any
        ],
        bolsasEstudo: [
          { id: 'bol-carlos', studentId: 'st-sup-1', sponsorName: 'INAGBE' } as any
        ],
        diplomasSuperior: [
          { id: 'dip-carlos', studentId: 'st-sup-1', finalCourseGrade: 16 } as any
        ]
      } as any;

      const proj = buildProjectionForAluno(user, fakeDb);
      expect(proj.userId).toBe('usr-student-1');
      expect(proj.students).toHaveLength(1);
      expect(proj.students[0].name).toBe('Carlos Alberto');
      expect(proj.inscricoesUC).toHaveLength(1);
      expect(proj.inscricoesUC?.[0].ucCode).toBe('INF101');
      expect(proj.monografiasTCC).toHaveLength(1);
      expect(proj.estagiosCurriculares).toHaveLength(1);
      expect(proj.bolsasEstudo).toHaveLength(1);
      expect(proj.diplomasSuperior).toHaveLength(1);
    });
  });
});
