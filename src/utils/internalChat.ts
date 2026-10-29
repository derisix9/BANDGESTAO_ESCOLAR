import { InternalChatParticipant, User, UserRole } from '../types';
import { hasPermission } from './permissions';

/**
 * CHAT INTERNO — regras de quem pode falar com quem.
 * =====================================================
 *
 * - A "Escola" (qualquer conta com a permissão `comunicacao.chat.manage` na
 *   Matriz de Perfis — por padrão Administrador, Direção Geral/Pedagógica e
 *   Secretaria) pode iniciar conversa com qualquer outro utilizador: Professor,
 *   Aluno, Funcionário, Encarregado de Educação (apenas os que já têm conta de
 *   utilizador criada — só entram nesta lista por já existirem em `db.users`)
 *   e restante pessoal da Escola.
 * - Quem NÃO é "Escola" (Professor, Aluno, Funcionário, Encarregado) só pode
 *   falar com a Escola — nunca diretamente uns com os outros.
 *
 * Cada conversa, uma vez criada, é privada entre os seus dois participantes
 * (ver `InternalChatThread.participantIds`), tal como no Facebook Messenger.
 */

export const ROLE_LABELS: Record<UserRole, string> = {
  admin: 'Administrador',
  director: 'Direção',
  secretaria: 'Secretaria',
  professor: 'Professor',
  financeiro: 'Financeiro',
  aluno: 'Aluno',
  encarregado: 'Encarregado de Educação',
  funcionario: 'Funcionário'
};

/** Grupos usados para agrupar a lista de contactos no widget de Chat Interno. */
export const CONTACT_GROUP_ORDER: { key: UserRole | 'escola'; label: string; icon: string }[] = [
  { key: 'escola', label: 'Direção & Secretaria', icon: 'account_balance' },
  { key: 'professor', label: 'Professores', icon: 'school' },
  { key: 'aluno', label: 'Alunos', icon: 'backpack' },
  { key: 'funcionario', label: 'Funcionários', icon: 'badge' },
  { key: 'encarregado', label: 'Encarregados de Educação', icon: 'family_restroom' },
  { key: 'financeiro', label: 'Financeiro', icon: 'payments' }
];

/** Verdadeiro para as contas da "Escola": quem gere o Chat Interno na Matriz de Perfis. */
export function isSchoolChatManager(role: string | UserRole | undefined): boolean {
  return hasPermission(role, 'comunicacao.chat.manage');
}

export function toInternalChatParticipant(user: User): InternalChatParticipant {
  return {
    id: user.id,
    name: user.name,
    role: user.role,
    roleTitle: user.roleTitle,
    avatar: user.avatar
  };
}

/**
 * Lista de utilizadores com quem `currentUser` tem permissão de abrir uma
 * conversa de Chat Interno, já filtrada pelas regras acima.
 */
export function getInternalChatContacts(currentUser: User, allUsers: User[]): User[] {
  const others = allUsers.filter((u) => u.id !== currentUser.id);
  if (isSchoolChatManager(currentUser.role)) return others;
  return others.filter((u) => isSchoolChatManager(u.role));
}

/** Agrupa os contactos elegíveis por perfil, para exibição no widget (estilo Messenger). */
export function groupContactsByRole(contacts: User[]): { key: string; label: string; icon: string; users: User[] }[] {
  const groups = CONTACT_GROUP_ORDER.map((g) => ({ ...g, users: [] as User[] }));
  contacts.forEach((u) => {
    const groupKey = isSchoolChatManager(u.role) ? 'escola' : u.role;
    const group = groups.find((g) => g.key === groupKey) || groups.find((g) => g.key === u.role);
    if (group) group.users.push(u);
  });
  return groups.filter((g) => g.users.length > 0);
}
