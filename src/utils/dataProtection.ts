import { DataProtectionPolicy, DataSubjectRequestStatus, DataSubjectRequestType } from '../types';

/**
 * PROTEÇÃO DE DADOS PESSOAIS — regras de negócio (sem React nem Firebase).
 *
 * Alinhado com a Lei n.º 22/11, de 17 de Junho (Lei da Proteção de Dados
 * Pessoais de Angola): direitos dos titulares, prazos de retenção por
 * categoria e registo dos pedidos recebidos.
 */

export const REQUEST_TYPE_LABELS: Record<DataSubjectRequestType, string> = {
  acesso: 'Direito de Acesso',
  retificacao: 'Direito de Retificação',
  eliminacao: 'Direito ao Apagamento',
  portabilidade: 'Direito à Portabilidade',
  oposicao: 'Direito de Oposição'
};

export const REQUEST_STATUS_META: Record<DataSubjectRequestStatus, { label: string; badge: string }> = {
  pendente: { label: 'Pendente', badge: 'bg-amber-100 text-amber-800' },
  em_analise: { label: 'Em Análise', badge: 'bg-blue-100 text-blue-800' },
  concluido: { label: 'Concluído', badge: 'bg-emerald-100 text-emerald-800' },
  rejeitado: { label: 'Rejeitado', badge: 'bg-red-100 text-red-800' }
};

export const REQUESTER_RELATION_LABELS: Record<string, string> = {
  encarregado: 'Encarregado de Educação',
  professor: 'Professor',
  funcionario: 'Funcionário',
  aluno: 'Aluno',
  outro: 'Outro'
};

export function defaultDataProtectionPolicy(): DataProtectionPolicy {
  return {
    policyText:
      'A instituição recolhe e trata dados pessoais de alunos, encarregados de educação, professores e ' +
      'funcionários exclusivamente para fins de gestão escolar, administrativa e financeira, em conformidade ' +
      'com a Lei n.º 22/11 (Proteção de Dados Pessoais). Os dados não são cedidos a terceiros sem consentimento ' +
      'ou obrigação legal, e são conservados apenas pelo tempo necessário aos fins que motivaram a sua recolha.',
    dpoName: '',
    dpoEmail: '',
    dpoPhone: '',
    retentionYearsStudents: 10,
    retentionYearsStaff: 10,
    retentionYearsFinancial: 5,
    guardianConsentRequiredForPhotos: true,
    marketingOptInDefault: false
  };
}

export interface DataSubjectRequestFieldsInput {
  requesterName: string;
  requesterRelation: 'encarregado' | 'professor' | 'funcionario' | 'aluno' | 'outro';
  studentId?: string;
  type: DataSubjectRequestType;
  description?: string;
}

export function validateDataSubjectRequest(fields: DataSubjectRequestFieldsInput): string[] {
  const errors: string[] = [];
  if (!fields.requesterName.trim()) errors.push('Indique o nome do titular/requerente.');
  if (!fields.type) errors.push('Selecione o tipo de pedido.');
  return errors;
}
