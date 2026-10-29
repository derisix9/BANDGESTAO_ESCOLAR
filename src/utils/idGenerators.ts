/**
 * Geração de números de processo/agente automáticos e aleatórios.
 *
 * Aluno: <ano lectivo inicial>-<aleatório de 4 a 6 dígitos>   Ex.: 2026-81457
 * Professor: AG-<aleatório de 4 dígitos>                       Ex.: AG-0044
 *
 * Em ambos os casos o número é sorteado e verificado contra os números já
 * existentes para nunca gerar uma duplicação (colisão), voltando a sortear
 * até encontrar um valor livre.
 */

import { getFallbackAcademicYear } from './academicYear';

/** Extrai o ano inicial de uma string de ano lectivo (ex.: "2026/2027" -> "2026"). */
function getInitialYear(academicYear?: string): string {
  const source = academicYear && academicYear.trim() ? academicYear.trim() : getFallbackAcademicYear();
  const match = source.match(/\d{4}/);
  return match ? match[0] : String(new Date().getFullYear());
}

function randomDigits(digitCount: number): string {
  const min = Math.pow(10, digitCount - 1);
  const max = Math.pow(10, digitCount) - 1;
  const value = Math.floor(min + Math.random() * (max - min + 1));
  return String(value);
}

/**
 * Gera o número de processo de um novo aluno: ANO-ALEATÓRIO(4 a 6 dígitos).
 * `existingProcNumbers` deve conter todos os números já atribuídos, para
 * garantir que o novo número nunca se repete.
 */
export function generateStudentProcNumber(
  existingProcNumbers: (string | undefined)[] = [],
  academicYear?: string
): string {
  const year = getInitialYear(academicYear);
  const taken = new Set(
    existingProcNumbers.filter((p): p is string => !!p).map((p) => p.trim().toUpperCase())
  );

  let candidate = '';
  let attempts = 0;
  do {
    const digitCount = 4 + Math.floor(Math.random() * 3); // 4, 5 ou 6 dígitos
    candidate = `${year}-${randomDigits(digitCount)}`;
    attempts++;
  } while (taken.has(candidate.toUpperCase()) && attempts < 100);

  return candidate;
}

/**
 * Gera o número de agente de um novo professor: AG-ALEATÓRIO(4 dígitos).
 * `existingAgentNumbers` deve conter todos os números já atribuídos, para
 * garantir que o novo número nunca se repete.
 */
export function generateTeacherAgentNumber(existingAgentNumbers: (string | undefined)[] = []): string {
  const taken = new Set(
    existingAgentNumbers.filter((a): a is string => !!a).map((a) => a.trim().toUpperCase())
  );

  let candidate = '';
  let attempts = 0;
  do {
    candidate = `AG-${randomDigits(4)}`;
    attempts++;
  } while (taken.has(candidate.toUpperCase()) && attempts < 100);

  return candidate;
}

/**
 * Gera o número interno de um novo funcionário: FUNC-ALEATÓRIO(4 dígitos).
 * Ex.: FUNC-0231. Nunca repete face aos números já atribuídos.
 */
export function generateFuncionarioNumber(existingNumbers: (string | undefined)[] = []): string {
  const taken = new Set(
    existingNumbers.filter((a): a is string => !!a).map((a) => a.trim().toUpperCase())
  );

  let candidate = '';
  let attempts = 0;
  do {
    candidate = `FUNC-${randomDigits(4)}`;
    attempts++;
  } while (taken.has(candidate.toUpperCase()) && attempts < 100);

  return candidate;
}

/**
 * Gera o código interno de um novo fornecedor: FORN-ALEATÓRIO(4 dígitos).
 * Ex.: FORN-0731. Nunca repete face aos códigos já atribuídos.
 */
export function generateSupplierCode(existingCodes: (string | undefined)[] = []): string {
  const taken = new Set(
    existingCodes.filter((a): a is string => !!a).map((a) => a.trim().toUpperCase())
  );

  let candidate = '';
  let attempts = 0;
  do {
    candidate = `FORN-${randomDigits(4)}`;
    attempts++;
  } while (taken.has(candidate.toUpperCase()) && attempts < 100);

  return candidate;
}

/**
 * Gera o número de uma nova Matrícula: MAT-<ano lectivo>-<aleatório de 4 a 6
 * dígitos>. Ex.: MAT-2026/2027-08421. Nunca repete face às já atribuídas.
 */
export function generateMatriculaNumber(
  academicYear: string,
  existingNumbers: (string | undefined)[] = []
): string {
  const year = academicYear && academicYear.trim() ? academicYear.trim() : getFallbackAcademicYear();
  const taken = new Set(
    existingNumbers.filter((n): n is string => !!n).map((n) => n.trim().toUpperCase())
  );

  let candidate = '';
  let attempts = 0;
  do {
    const digitCount = 4 + Math.floor(Math.random() * 3); // 4, 5 ou 6 dígitos
    candidate = `MAT-${year}-${randomDigits(digitCount)}`;
    attempts++;
  } while (taken.has(candidate.toUpperCase()) && attempts < 100);

  return candidate;
}

/**
 * Normaliza um nome para uso na parte local de um e-mail gerado automaticamente:
 * remove acentuação, espaços e qualquer caractere que não seja letra ou número.
 */
function slugifyNameForEmail(name: string): string {
  return (name || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '') // remove acentos
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '')
    .trim() || 'utilizador';
}

/**
 * Gera automaticamente o e-mail do Encarregado de Educação quando este não foi
 * indicado no cadastro do aluno: nomedoencarregado@encarregadoed.com
 */
export function generateGuardianAutoEmail(guardianName: string): string {
  return `${slugifyNameForEmail(guardianName)}@encarregadoed.com`;
}

/**
 * Gera automaticamente o e-mail do Aluno quando este não foi indicado no seu
 * cadastro: nomedoaluno+numerodeprocesso@gmail.com
 */
export function generateStudentAutoEmail(studentName: string, procNumber: string): string {
  const proc = (procNumber || '').trim().replace(/[^a-zA-Z0-9]/g, '');
  return `${slugifyNameForEmail(studentName)}+${proc || randomDigits(5)}@gmail.com`;
}

/**
 * Gera uma palavra-passe temporária aleatória, usada quando é necessário criar
 * automaticamente uma conta (ex.: conta do Encarregado de Educação) sem que o
 * administrador tenha definido uma palavra-passe manualmente. Deve ser
 * comunicada ao titular da conta, que poderá alterá-la depois através do
 * link de redefinição de palavra-passe.
 */
export function generateTempPassword(): string {
  const upper = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
  const lower = 'abcdefghijkmnpqrstuvwxyz';
  const digits = '23456789';
  const all = upper + lower + digits;
  const rand = (n: number): number => {
    // crypto quando existe (navegador/Node 20+); Math.random só como último recurso.
    const c = (globalThis as any).crypto;
    if (c?.getRandomValues) {
      const buf = new Uint32Array(1);
      c.getRandomValues(buf);
      return buf[0] % n;
    }
    return Math.floor(Math.random() * n);
  };
  // Garante pelo menos 1 maiúscula, 1 minúscula e 1 número (exigido no registo e na criação de contas).
  const chars = [upper[rand(upper.length)], lower[rand(lower.length)], digits[rand(digits.length)]];
  while (chars.length < 10) chars.push(all[rand(all.length)]);
  for (let i = chars.length - 1; i > 0; i--) {
    const j = rand(i + 1);
    [chars[i], chars[j]] = [chars[j], chars[i]];
  }
  return chars.join('');
}

function generateCodeWithPrefix(prefix: string, existingCodes: (string | undefined)[] = []): string {
  const taken = new Set(
    existingCodes.filter((a): a is string => !!a).map((a) => a.trim().toUpperCase())
  );
  let candidate = '';
  let attempts = 0;
  do {
    candidate = `${prefix}-${randomDigits(4)}`;
    attempts++;
  } while (taken.has(candidate.toUpperCase()) && attempts < 100);
  return candidate;
}

/** Código interno de um novo ativo patrimonial: ATIVO-0000. */
export function generateAssetCode(existingCodes: (string | undefined)[] = []): string {
  return generateCodeWithPrefix('ATIVO', existingCodes);
}

/** Código interno de um novo item de estoque: STK-0000. */
export function generateStockItemCode(existingCodes: (string | undefined)[] = []): string {
  return generateCodeWithPrefix('STK', existingCodes);
}

/** Código interno de uma nova viatura: VEIC-0000. */
export function generateVehicleCode(existingCodes: (string | undefined)[] = []): string {
  return generateCodeWithPrefix('VEIC', existingCodes);
}

/** Código interno de uma nova rota de transporte: ROTA-0000. */
export function generateRouteCode(existingCodes: (string | undefined)[] = []): string {
  return generateCodeWithPrefix('ROTA', existingCodes);
}

/** Código interno de uma nova ficha médica: FMED-0000. */
export function generateMedicalRecordCode(existingCodes: (string | undefined)[] = []): string {
  return generateCodeWithPrefix('FMED', existingCodes);
}

/** Código interno de um novo incidente disciplinar: INC-0000. */
export function generateIncidentCode(existingCodes: (string | undefined)[] = []): string {
  return generateCodeWithPrefix('INC', existingCodes);
}

/** Código interno de uma nova autorização/restrição de recolha: REC-0000. */
export function generatePickupAuthorizationCode(existingCodes: (string | undefined)[] = []): string {
  return generateCodeWithPrefix('REC', existingCodes);
}

/** Código interno de uma nova notificação SMS/WhatsApp: NOTIF-0000. */
export function generateNotificationCode(existingCodes: (string | undefined)[] = []): string {
  return generateCodeWithPrefix('NOTIF', existingCodes);
}

/** Código interno de uma nova reunião pais-professores: REU-0000. */
export function generateMeetingCode(existingCodes: (string | undefined)[] = []): string {
  return generateCodeWithPrefix('REU', existingCodes);
}

/** Código interno de um novo pedido de titular de dados: DSR-0000. */
export function generateDataSubjectRequestCode(existingCodes: (string | undefined)[] = []): string {
  return generateCodeWithPrefix('DSR', existingCodes);
}
