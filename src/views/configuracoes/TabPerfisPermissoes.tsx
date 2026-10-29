import React, { useState, useEffect } from 'react';
import { InstitutionSettings, UserRole } from '../../types';
import { dbService } from '../../services/db';
import { RoleKey, RoleDefinition, mergeRolesWithDefaults } from '../../utils/permissions';

import { showOperationSuccess, showOperationError } from '../../context/OperationContext';
import { Notice } from '../../components/Notice';

interface TabPerfisPermissoesProps {
  settings: InstitutionSettings;
  currentUserRole?: UserRole;
  onUpdateSettings?: (newSettings: Partial<InstitutionSettings>) => void;
  onSaveAll: (options?: { loadingMessage?: string; successMessage?: string; requiredRule?: string }) => void;
  /** Estes separadores propagam as alterações em tempo real; nada há a recolher. */
  registerCommit?: (commit: (() => Partial<InstitutionSettings>) | null) => void;
}


export const TabPerfisPermissoes: React.FC<TabPerfisPermissoesProps> = ({
  settings,
  currentUserRole,
  onUpdateSettings,
  onSaveAll
}) => {
  const [selectedRoleKey, setSelectedRoleKey] = useState<RoleKey>('admin');
  const [dbData, setDbData] = useState(() => dbService.getDatabase());
  const [rolesState, setRolesState] = useState<Record<RoleKey, RoleDefinition>>(() =>
    mergeRolesWithDefaults(settings.rolePermissions as any)
  );

  // Subscribe to real-time database updates for live user & teacher counts
  useEffect(() => {
    const unsub = dbService.subscribe((newDb) => {
      setDbData(newDb);
    });
    return () => unsub();
  }, []);

  // Compute the real number of active users assigned to each role directly from database
  const getUserCountForRole = (rKey: RoleKey): number => {
    const usersList = dbData.users || [];
    if (rKey === 'professor') {
      const userProfs = usersList.filter((u) => u.role === 'professor');
      const teachers = dbData.teachers || [];
      const distinctDocentes = new Set([
        ...userProfs.map((u) => u.email?.toLowerCase().trim() || u.id),
        ...teachers.map((t) => t.email?.toLowerCase().trim() || t.id)
      ]);
      return distinctDocentes.size;
    }
    return usersList.filter((u) => u.role === rKey).length;
  };

  const currentRole = rolesState[selectedRoleKey];
  const currentRoleUsersCount = getUserCountForRole(selectedRoleKey);

  const canEditPermissions = currentUserRole === 'admin';

  const togglePermission = (index: number) => {
    if (!canEditPermissions) {
      void showOperationError('A Área Pedagógica não pode alterar permissões. Apenas o Administrador Geral possui este privilégio.');
      return;
    }

    // IMPORTANTE: nunca mutar o array/objetos existentes diretamente — eles podem
    // ser a mesma referência partilhada com `defaultRoles` (na primeira alteração
    // de sempre) ou com o estado anterior. Construímos sempre um array e um item
    // novos, para que o React (e qualquer outra parte da app que tenha guardado
    // uma referência antiga) veja sempre o valor correto e atualizado.
    const updatedPermissions = currentRole.permissions.map((p, i) =>
      i === index ? { ...p, allowed: !p.allowed } : p
    );
    const updatedRole = { ...currentRole, permissions: updatedPermissions };
    const newRolesState = {
      ...rolesState,
      [selectedRoleKey]: updatedRole
    };
    setRolesState(newRolesState);
    if (onUpdateSettings) {
      onUpdateSettings({ rolePermissions: newRolesState });
    }
    dbService.updateSettings({ rolePermissions: newRolesState });
    void showOperationSuccess('Permissão atualizada com sucesso!', { minDuration: 350, successDuration: 800 });
  };

  return (
    <div className="flex flex-col gap-6">
      {/* Como esta matriz se liga ao acesso por utilizador */}
      <Notice tone="info" icon="info">
        <p className="leading-relaxed">
          Estas permissões é o <strong>modelo padrão de cada perfil</strong>: o que um utilizador recebe enquanto não for personalizado. Para personalizar as permissões dos perfis usa a seção utilizadores.
        </p>
      </Notice>

      {/* Top Header */}
      <div className="p-6 rounded-2xl bg-white border border-slate-200 shadow-xs flex flex-col gap-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="w-11 h-11 rounded-xl bg-slate-100 flex items-center justify-center text-[#0b1f3a] shrink-0">
              <span className="material-symbols-outlined text-[26px]">admin_panel_settings</span>
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="text-[11px] uppercase tracking-wider text-[#ac332b] font-bold">Módulo 05</span>
                <span className="w-1 h-1 rounded-full bg-slate-300" />
                <span className="text-[11px] text-slate-500 font-medium">PERFIL E PERMISSÕES</span>
              </div>
              <h2 className="font-headline text-lg lg:text-xl font-bold text-slate-900">
                PERFIL E PERMISSÕES PADRÃO DO SISTEMA
              </h2>
            </div>
          </div>

        </div>

        {/* Horizontal Sub-tabs / Role Pills */}
        <div className="flex items-center gap-2 overflow-x-auto pb-1 pt-1 border-t border-slate-100">
          {(Object.keys(rolesState) as RoleKey[]).map((rKey) => {
            const role = rolesState[rKey];
            const isSelected = selectedRoleKey === rKey;
            const dynamicUsersCount = getUserCountForRole(rKey);
            return (
              <button
                key={rKey}
                type="button"
                onClick={() => setSelectedRoleKey(rKey)}
                className={`px-3.5 py-2 rounded-xl text-xs font-bold transition-all whitespace-nowrap flex items-center gap-2 shrink-0 cursor-pointer ${
                  isSelected
                    ? 'bg-[#0b1f3a] text-white shadow-sm'
                    : 'bg-slate-100 hover:bg-slate-200 text-slate-700'
                }`}
              >
                <span>{role.name}</span>
                <span
                  className={`px-1.5 py-0.5 rounded text-[10px] font-mono ${
                    isSelected ? 'bg-white/20 text-white' : 'bg-white text-slate-600'
                  }`}
                >
                  {dynamicUsersCount}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Perfil Active Detail Banner */}
      <div className="p-5 rounded-2xl bg-white border border-slate-200 shadow-xs flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <span className="px-2 py-0.5 rounded bg-blue-50 text-[#0b1f3a] font-mono text-[11px] font-bold">
              {currentRole.code}
            </span>
            <span className="px-2 py-0.5 rounded bg-slate-100 text-slate-700 text-[11px] font-semibold">
              {currentRole.level}
            </span>
          </div>
          <h3 className="font-headline text-lg font-bold text-slate-900">{currentRole.name}</h3>
          <p className="text-xs text-slate-500 max-w-2xl mt-0.5">{currentRole.desc}</p>
        </div>

        <div className="flex items-center gap-3 self-start sm:self-center">
          <div className="text-right hidden sm:block">
            <div className="text-xs font-bold text-slate-900">
              {currentRoleUsersCount} {currentRoleUsersCount === 1 ? 'Utilizador' : 'Utilizadores'}
            </div>
            <div className="text-[11px] text-slate-500">Com esta credencial</div>
          </div>
          <div className="w-10 h-10 rounded-xl bg-slate-100 border border-slate-200 flex items-center justify-center font-headline font-bold text-slate-800">
            {currentRoleUsersCount}
          </div>
        </div>
      </div>

      {/* Warning Notice if not Admin */}
      {!canEditPermissions && (
        <Notice tone="warn" icon="lock">
          <span>
            <strong>Apenas Leitura:</strong> A Área Pedagógica não tem permissão para alterar permissões do sistema. Apenas o Administrador Geral pode modificar a matriz de permissões.
          </span>
        </Notice>
      )}

      {/* Granular Permission Table */}
      <section className="bg-white p-6 rounded-2xl border border-slate-200 shadow-xs flex flex-col gap-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 pb-3 border-b border-slate-100">
          <div>
            <h3 className="font-headline text-base lg:text-lg font-bold text-slate-900">
              Permissões do Perfil: {currentRole.name}
            </h3>
            <p className="text-xs text-slate-500">
              Ative ou desative cada operação de sistema. As alterações têm efeito imediato nas sessões dos utilizadores.
            </p>
          </div>
          <span className="font-mono text-xs text-slate-500 self-start">
            {currentRole.permissions.filter((p) => p.allowed).length} de {currentRole.permissions.length} Ações Autorizadas
          </span>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead>
              <tr className="bg-[#0b1f3a] text-white uppercase tracking-wider font-bold border-b border-slate-800 text-[11px]">
                <th className="py-3 px-4 rounded-l-lg">Módulo Operacional</th>
                <th className="py-3 px-4">Operação / Capacidade</th>
                <th className="py-3 px-4">Regra de Segurança</th>
                <th className="py-3 px-4 text-center">Acesso</th>
                <th className="py-3 px-4 text-right rounded-r-lg">Alternar</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 text-slate-700">
              {currentRole.permissions.map((perm, idx) => (
                <tr key={idx} className="hover:bg-slate-50/80 transition-colors">
                  <td className="py-3 px-4 font-bold text-slate-800">{perm.module}</td>
                  <td className="py-3 px-4 text-slate-900">{perm.action}</td>
                  <td className="py-3 px-4 text-slate-500 text-[11px] font-mono">{perm.rule}</td>
                  <td className="py-3 px-4 text-center">
                    <span
                      className={`px-2.5 py-1 rounded-full text-[10px] font-bold ${
                        perm.allowed
                          ? 'bg-emerald-50 text-emerald-800 border border-emerald-200'
                          : 'bg-red-50 text-red-800 border border-red-200'
                      }`}
                    >
                      {perm.allowed ? 'AUTORIZADO' : 'BLOQUEADO'}
                    </span>
                  </td>
                  <td className="py-3 px-4 text-right">
                    <button
                      type="button"
                      disabled={!canEditPermissions}
                      onClick={() => togglePermission(idx)}
                      className={`w-9 h-5 rounded-full transition-colors relative ml-auto ${
                        !canEditPermissions ? 'opacity-40 cursor-not-allowed' : 'cursor-pointer'
                      } ${perm.allowed ? 'bg-[#0b1f3a]' : 'bg-slate-300'}`}
                      title={!canEditPermissions ? 'Apenas o Administrador pode alterar permissões' : perm.allowed ? 'Clique para bloquear' : 'Clique para autorizar'}
                    >
                      <div
                        className={`w-3.5 h-3.5 rounded-full bg-white transition-transform absolute top-0.5 ${
                          perm.allowed ? 'right-0.5' : 'left-0.5'
                        }`}
                      />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {/* Informative Footer */}
      <div className="flex items-center gap-2 p-4 bg-white rounded-2xl border border-slate-200 shadow-xs text-slate-500 text-xs">
        <span className="material-symbols-outlined text-slate-400">shield</span>
        <span>Alterações de permissões são sincronizadas em tempo real e aplicadas a todas as contas associadas.</span>
      </div>
    </div>
  );
};
