import {
  BloodType,
  DisciplinaryIncident,
  IncidentCategory,
  IncidentSeverity,
  IncidentStatus,
  MedicalAllergy,
  MedicalOccurrenceType,
  PickupAuthorization,
  PickupAuthorizationKind,
  PickupAuthorizationStatus,
  PickupPersonRelation,
  PickupReason,
  Student,
  StudentMedicalRecord,
  VaccinationStatus
} from '../types';

/**
 * SAÚDE & SEGURANÇA — regras de negócio (sem React nem Firebase).
 *
 * 1. Ficha Médica do Aluno — dado de saúde CONFIDENCIAL. Uma ficha por aluno.
 *    O acesso é controlado por duas regras distintas: `saude.ficha_medica.view`
 *    (ver) e `saude.ficha_medica.manage` (criar/editar/eliminar/registar
 *    ocorrências). Cada visualização e alteração fica na trilha de auditoria.
 * 2. Incidentes Disciplinares — ocorrência com um ou mais alunos envolvidos
 *    (autor, vítima, testemunha), evolução por seguimentos e uma medida final.
 * 3. Autorizações de Recolha — quem pode (ou está proibido de) levar cada
 *    aluno à saída, e o registo das saídas efetivamente confirmadas à porta.
 */

// =============================================================
// 1. Ficha Médica do Aluno
// =============================================================

export const BLOOD_TYPE_LABELS: Record<BloodType, string> = {
  'A+': 'A+',
  'A-': 'A-',
  'B+': 'B+',
  'B-': 'B-',
  'AB+': 'AB+',
  'AB-': 'AB-',
  'O+': 'O+',
  'O-': 'O-',
  desconhecido: 'Desconhecido'
};

export const BLOOD_TYPES: BloodType[] = ['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-', 'desconhecido'];

export const VACCINATION_STATUS_LABELS: Record<VaccinationStatus, string> = {
  em_dia: 'Em dia',
  incompleto: 'Incompleto',
  desconhecido: 'Desconhecido'
};

export const ALLERGY_SEVERITY_META: Record<MedicalAllergy['severity'], { label: string; badge: string }> = {
  ligeira: { label: 'Ligeira', badge: 'bg-slate-100 text-slate-700' },
  moderada: { label: 'Moderada', badge: 'bg-amber-100 text-amber-800' },
  grave: { label: 'Grave', badge: 'bg-red-100 text-red-800' }
};

export const MEDICAL_OCCURRENCE_TYPE_LABELS: Record<MedicalOccurrenceType, string> = {
  doenca: 'Mal-estar / Doença',
  acidente: 'Acidente / Queda',
  medicacao: 'Administração de Medicação',
  consulta: 'Encaminhamento para Consulta',
  outro: 'Outro'
};

export interface MedicalRecordFieldsInput {
  studentId: string;
  bloodType: BloodType;
  allergies: MedicalAllergy[];
  conditions: { name: string; notes?: string }[];
  medications: { name: string; dosage?: string; schedule?: string; administeredAtSchool: boolean }[];
  vaccinationStatus: VaccinationStatus;
  vaccinationNotes?: string;
  emergencyContacts: { name: string; relation: string; phone: string }[];
  physicianName?: string;
  physicianPhone?: string;
  preferredHealthUnit?: string;
  healthInsurance?: string;
  healthInsurancePolicy?: string;
  emergencyTreatmentConsent: boolean;
  consentGivenBy?: string;
  notes?: string;
}

/** Normaliza os campos livres de texto (aparar espaços, remover linhas vazias). */
export function normalizeMedicalRecordFields(input: MedicalRecordFieldsInput): MedicalRecordFieldsInput {
  return {
    ...input,
    allergies: input.allergies
      .filter((a) => a.substance.trim())
      .map((a) => ({ ...a, substance: a.substance.trim(), reaction: a.reaction?.trim() || undefined })),
    conditions: input.conditions
      .filter((c) => c.name.trim())
      .map((c) => ({ name: c.name.trim(), notes: c.notes?.trim() || undefined })),
    medications: input.medications
      .filter((m) => m.name.trim())
      .map((m) => ({
        name: m.name.trim(),
        dosage: m.dosage?.trim() || undefined,
        schedule: m.schedule?.trim() || undefined,
        administeredAtSchool: m.administeredAtSchool
      })),
    emergencyContacts: input.emergencyContacts
      .filter((c) => c.name.trim() && c.phone.trim())
      .map((c) => ({ name: c.name.trim(), relation: c.relation.trim(), phone: c.phone.trim() })),
    vaccinationNotes: input.vaccinationNotes?.trim() || undefined,
    physicianName: input.physicianName?.trim() || undefined,
    physicianPhone: input.physicianPhone?.trim() || undefined,
    preferredHealthUnit: input.preferredHealthUnit?.trim() || undefined,
    healthInsurance: input.healthInsurance?.trim() || undefined,
    healthInsurancePolicy: input.healthInsurancePolicy?.trim() || undefined,
    consentGivenBy: input.consentGivenBy?.trim() || undefined,
    notes: input.notes?.trim() || undefined
  };
}

export function validateMedicalRecord(
  fields: MedicalRecordFieldsInput,
  student: Student | undefined,
  existing: StudentMedicalRecord[],
  ignoreId?: string
): string[] {
  const errors: string[] = [];
  if (!student) errors.push('Aluno não encontrado.');
  if (fields.emergencyContacts.length === 0) {
    errors.push('Indique pelo menos um contacto de emergência (nome, parentesco e telefone).');
  }
  if (
    existing.some((r) => r.id !== ignoreId && r.studentId === fields.studentId)
  ) {
    errors.push('Este aluno já possui uma ficha médica registada. Edite a ficha existente.');
  }
  return errors;
}

/** Indicador rápido para listagens: verdadeiro quando a ficha tem pelo menos uma alergia grave. */
export function hasSevereAllergy(record: Pick<StudentMedicalRecord, 'allergies'>): boolean {
  return record.allergies.some((a) => a.severity === 'grave');
}

// =============================================================
// 2. Incidentes Disciplinares
// =============================================================

export const INCIDENT_CATEGORY_LABELS: Record<IncidentCategory, string> = {
  indisciplina_sala: 'Indisciplina na Sala de Aula',
  falta_respeito: 'Falta de Respeito (Docente/Funcionário)',
  agressao_verbal: 'Agressão Verbal',
  agressao_fisica: 'Agressão Física',
  bullying: 'Bullying / Assédio entre Alunos',
  furto: 'Furto',
  danos_patrimonio: 'Danos ao Património',
  objeto_proibido: 'Posse de Objeto Proibido',
  substancias: 'Posse/Consumo de Substâncias',
  uso_telemovel: 'Uso Indevido de Telemóvel',
  fuga_escola: 'Fuga da Escola',
  outro: 'Outro'
};

export const INCIDENT_SEVERITY_META: Record<IncidentSeverity, { label: string; badge: string }> = {
  leve: { label: 'Leve', badge: 'bg-slate-100 text-slate-700' },
  grave: { label: 'Grave', badge: 'bg-amber-100 text-amber-800' },
  muito_grave: { label: 'Muito Grave', badge: 'bg-red-100 text-red-800' }
};

export const INCIDENT_STATUS_META: Record<IncidentStatus, { label: string; badge: string }> = {
  aberto: { label: 'Aberto', badge: 'bg-blue-100 text-blue-800' },
  em_analise: { label: 'Em Análise', badge: 'bg-amber-100 text-amber-800' },
  decidido: { label: 'Decidido', badge: 'bg-emerald-100 text-emerald-800' },
  arquivado: { label: 'Arquivado', badge: 'bg-slate-200 text-slate-600' }
};

export const DISCIPLINARY_MEASURE_LABELS: Record<string, string> = {
  nenhuma: 'Sem Medida (Arquivado sem Sanção)',
  advertencia_oral: 'Advertência Oral',
  advertencia_escrita: 'Advertência Escrita',
  tarefa_educativa: 'Tarefa Educativa / Comunitária',
  reparacao_dano: 'Reparação do Dano Causado',
  acompanhamento_psicopedagogico: 'Acompanhamento Psicopedagógico',
  suspensao: 'Suspensão',
  transferencia: 'Transferência de Turma/Escola'
};

export interface IncidentFieldsInput {
  academicYear: string;
  date: string;
  time?: string;
  location?: string;
  category: IncidentCategory;
  categoryOther?: string;
  severity: IncidentSeverity;
  description: string;
  reportedBy: string;
  participants: { studentId: string; role: 'autor' | 'vitima' | 'testemunha' }[];
  guardianNotification: { notified: boolean; date?: string; channel?: string; notes?: string };
}

export function validateIncident(fields: IncidentFieldsInput): string[] {
  const errors: string[] = [];
  if (!fields.date) errors.push('Indique a data da ocorrência.');
  if (fields.category === 'outro' && !(fields.categoryOther || '').trim()) {
    errors.push('Descreva a categoria quando escolher "Outro".');
  }
  if (!fields.description.trim()) errors.push('Descreva o sucedido.');
  if (!fields.reportedBy.trim()) errors.push('Indique quem comunicou a ocorrência.');
  if (fields.participants.length === 0) {
    errors.push('Indique pelo menos um aluno envolvido na ocorrência.');
  }
  if (fields.guardianNotification.notified && !fields.guardianNotification.date) {
    errors.push('Indique a data em que o encarregado foi notificado.');
  }
  return errors;
}

export function validateMeasure(type: string, details: string | undefined, suspensionDays?: number): string | null {
  if ((type === 'nenhuma' || type === 'transferencia') && !(details || '').trim()) {
    return 'Fundamente a decisão (obrigatório para "Sem Medida" e "Transferência").';
  }
  if (type === 'suspensao' && (!suspensionDays || suspensionDays < 1)) {
    return 'Indique o número de dias de suspensão (mínimo 1).';
  }
  return null;
}

// =============================================================
// 3. Autorizações de Recolha
// =============================================================

export const PICKUP_RELATION_LABELS: Record<PickupPersonRelation, string> = {
  pai: 'Pai',
  mae: 'Mãe',
  encarregado: 'Encarregado de Educação',
  avo: 'Avô / Avó',
  tio: 'Tio / Tia',
  irmao: 'Irmão / Irmã',
  motorista: 'Motorista / Transporte Contratado',
  vizinho: 'Vizinho / Conhecido da Família',
  outro: 'Outro'
};

export const PICKUP_AUTH_KIND_META: Record<PickupAuthorizationKind, { label: string; badge: string }> = {
  autorizada: { label: 'Autorizada', badge: 'bg-emerald-100 text-emerald-800' },
  proibida: { label: 'Recolha Proibida', badge: 'bg-red-100 text-red-800' }
};

export const PICKUP_AUTH_STATUS_META: Record<PickupAuthorizationStatus, { label: string; badge: string }> = {
  ativa: { label: 'Ativa', badge: 'bg-emerald-100 text-emerald-800' },
  suspensa: { label: 'Suspensa', badge: 'bg-amber-100 text-amber-800' },
  revogada: { label: 'Revogada', badge: 'bg-slate-200 text-slate-600' }
};

export const PICKUP_REASON_LABELS: Record<PickupReason, string> = {
  recolha_normal: 'Recolha Normal (Fim das Aulas)',
  consulta_medica: 'Consulta Médica',
  doenca: 'Mal-estar / Doença',
  assunto_familiar: 'Assunto Familiar',
  outro: 'Outro'
};

export interface PickupAuthorizationFieldsInput {
  studentId: string;
  kind: PickupAuthorizationKind;
  personName: string;
  relation: PickupPersonRelation;
  relationOther?: string;
  phone: string;
  documentNumber: string;
  grantedBy: string;
  grantedVia: string;
  validFrom: string;
  validUntil?: string;
  notes?: string;
}

export function validatePickupAuthorization(fields: PickupAuthorizationFieldsInput): string[] {
  const errors: string[] = [];
  if (!fields.personName.trim()) errors.push('Indique o nome da pessoa.');
  if (fields.relation === 'outro' && !(fields.relationOther || '').trim()) {
    errors.push('Descreva o parentesco/relação quando escolher "Outro".');
  }
  if (!fields.phone.trim()) errors.push('Indique o telefone de contacto.');
  if (!fields.documentNumber.trim()) errors.push('Indique o número do documento de identificação.');
  if (!fields.grantedBy.trim()) {
    errors.push('Indique quem concedeu a autorização (ou pediu a restrição).');
  }
  if (!fields.validFrom) errors.push('Indique a data de início da validade.');
  if (fields.validUntil && fields.validUntil < fields.validFrom) {
    errors.push('A data de fim não pode ser anterior à data de início.');
  }
  return errors;
}

/** Autorizações ativas e dentro da validade para um aluno, num dado dia (AAAA-MM-DD). */
export function activeAuthorizationsForStudent(
  authorizations: PickupAuthorization[],
  studentId: string,
  onDate: string
): PickupAuthorization[] {
  return authorizations.filter(
    (a) =>
      a.studentId === studentId &&
      a.status === 'ativa' &&
      a.validFrom <= onDate &&
      (!a.validUntil || a.validUntil >= onDate)
  );
}

/** Verdadeiro quando existe, para o aluno e pessoa indicados, uma restrição ativa (kind = 'proibida'). */
export function isPersonForbiddenForStudent(
  authorizations: PickupAuthorization[],
  studentId: string,
  documentNumber: string,
  onDate: string
): PickupAuthorization | undefined {
  const doc = documentNumber.trim().toUpperCase();
  return activeAuthorizationsForStudent(authorizations, studentId, onDate).find(
    (a) => a.kind === 'proibida' && a.documentNumber.trim().toUpperCase() === doc
  );
}
