import React from 'react';
import { dbService } from '../services/db';
import { hasPermission, defaultRoles } from '../utils/permissions';
import { showAppAlert } from '../context/OperationContext';
import { UserRole } from '../types';

/**
 * CONTROLO DE ACESSO (RBAC) EM TODA A APLICAÇÃO
 * =============================================
 *
 * A matriz definida em Configurações → 5. Perfis & Permissões (ACL / RBAC) é
 * gravada em `settings.rolePermissions`. Este módulo é a porta única pela qual
 * os ecrãs operacionais (Alunos, Pautas, Propinas, Assiduidade, Turmas...)
 * consultam essa matriz — por isso desligar um interruptor na matriz tem efeito
 * imediato:
 *
 *   • o botão correspondente fica desativado, com o motivo em tooltip;
 *   • se a ação for na mesma invocada, é recusada e registada na auditoria.
 *
 * As permissões são lidas da base de dados a cada render: como a matriz é
 * sincronizada em tempo real, uma alteração feita pelo Administrador chega às
 * sessões abertas sem ninguém ter de voltar a entrar.
 */

export interface AccessControl {
  role: UserRole | string;
  roleLabel: string;
  /** Verdadeiro quando o perfil tem a regra autorizada na matriz. */
  can: (rule: string) => boolean;
  /** Mensagem normalizada de recusa, pronta a mostrar ao utilizador. */
  denyMessage: (rule: string) => string;
  /**
   * Executa `action` apenas se a regra estiver autorizada. Caso contrário
   * mostra o aviso do sistema, regista a tentativa na auditoria e devolve
   * `false` sem executar nada.
   */
  guard: <T>(rule: string, action: () => T) => T | false;
  /** Propriedades prontas a espalhar num botão: `{...acl.buttonProps('x')}`. */
  buttonProps: (rule: string) => { disabled: boolean; title?: string };
}

function resolveRole(explicit?: UserRole | string): UserRole | string {
  if (explicit) return explicit;
  try {
    return dbService.getDatabase()?.currentUser?.role || 'admin';
  } catch {
    return 'admin';
  }
}

function ruleLabel(rule: string): string {
  const found = Object.values(defaultRoles)[0]?.permissions?.find((p) => p.rule === rule);
  return found?.action || rule;
}

function roleLabelOf(role: string): string {
  const def = (defaultRoles as any)[role];
  return def?.name || role;
}

export function createAccessControl(explicitRole?: UserRole | string): AccessControl {
  const role = resolveRole(explicitRole);

  const can = (rule: string) => hasPermission(role, rule);

  const denyMessage = (rule: string) =>
    `Operação não autorizada: a permissão «${ruleLabel(rule)}» (${rule}) está desativada para o perfil ` +
    `${roleLabelOf(String(role))} na Matriz de Perfis & Permissões. Contacte o Administrador Geral.`;

  const guard = <T,>(rule: string, action: () => T): T | false => {
    if (can(rule)) return action();

    showAppAlert(denyMessage(rule), { title: 'Acesso Bloqueado', variant: 'error' });
    try {
      const current = dbService.getDatabase()?.currentUser;
      dbService.addAuditLog({
        userName: current?.name || 'Utilizador',
        userRole: current?.roleTitle || roleLabelOf(String(role)),
        action: 'Tentativa de Operação Não Autorizada',
        details: `Acesso negado à operação [${rule}] — regra desativada na matriz ACL para o perfil ${roleLabelOf(String(role))}.`,
        module: 'sistema',
        timestamp: new Date().toLocaleString('pt-PT'),
        badgeColor: '#b91c1c'
      } as any);
    } catch {
      // auditoria best-effort
    }
    return false;
  };

  const buttonProps = (rule: string) =>
    can(rule) ? { disabled: false } : { disabled: true, title: denyMessage(rule) };

  return { role, roleLabel: roleLabelOf(String(role)), can, denyMessage, guard, buttonProps };
}

/** Versão para componentes React. */
export function useAccessControl(explicitRole?: UserRole | string): AccessControl {
  // Sem memoização deliberadamente: a matriz pode mudar em tempo real e o
  // cálculo é apenas uma leitura de objeto já em memória.
  return createAccessControl(explicitRole);
}

/**
 * Esconde (ou substitui) um bloco da interface quando o perfil não tem a regra.
 * Exemplo: <Can rule="propinas.cancel"><button …/></Can>
 */
export const Can: React.FC<{
  rule: string;
  role?: UserRole | string;
  /** Mostrar desativado em vez de esconder. */
  fallback?: React.ReactNode;
  children: React.ReactNode;
}> = ({ rule, role, fallback = null, children }) => {
  const acl = useAccessControl(role);
  if (!acl.can(rule)) return <>{fallback}</>;
  return <>{children}</>;
};
