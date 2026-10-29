import { TablePagination, usePagedList } from '../../components/TablePagination';
import React, { useEffect, useRef, useState } from 'react';
import { InstitutionSettings, SchoolDatabase, User, UserAccess, UserRole } from '../../types';
import { UserAccessEditor } from './UserAccessEditor';
import { dbService } from '../../services/db';
import { runGlobalOperation } from '../../context/OperationContext';
import { compressImageFile } from '../../utils/imageCompressor';
import { defaultRoles, RoleKey } from '../../utils/permissions';
import { CARGO_LABELS } from '../../components/FuncionarioFormModal';
import { SearchableSelect } from '../../components/SearchableSelect';
import { Notice } from '../../components/Notice';

interface TabUsuariosProps {
  db: SchoolDatabase;
  settings: InstitutionSettings;
  currentUserRole?: UserRole;
  onUpdateSettings?: (newSettings: Partial<InstitutionSettings>) => void;
  onSaveAll: (options?: { loadingMessage?: string; successMessage?: string; requiredRule?: string }) => void;
  /** Estes separadores propagam as alterações em tempo real; nada há a recolher. */
  registerCommit?: (commit: (() => Partial<InstitutionSettings>) | null) => void;
}

/** Tipo de vínculo escolhido ao criar um novo utilizador: define se a conta é
 * associada (e pré-preenchida) a partir de um registo já existente de
 * Professor, Aluno ou Funcionário, ou criada manualmente sem vínculo. */
type LinkType = 'manual' | 'professor' | 'aluno' | 'funcionario';

const DEFAULT_AVATARS = [
  '/avatar-padrao.png',
  '/avatar-padrao.png',
  '/avatar-padrao.png',
  '/avatar-padrao.png'
];

const ROLE_LABELS: Record<UserRole, string> = {
  admin: 'Administrador Geral',
  director: 'Direção Pedagógica',
  secretaria: 'Secretaria Escolar',
  professor: 'Corpo Docente',
  financeiro: 'Tesouraria & Finanças',
  aluno: 'Estudante',
  encarregado: 'Encarregado de Educação',
  funcionario: 'Funcionário da Escola'
};

const ROLE_ORDER: UserRole[] = [
  'admin',
  'director',
  'secretaria',
  'professor',
  'funcionario',
  'financeiro',
  'aluno',
  'encarregado'
];

interface UserFormState {
  id: string | null;
  name: string;
  email: string;
  username: string;
  password: string;
  phone: string;
  role: UserRole;
  avatar: string;
  /** Vínculo de origem escolhido (apenas relevante ao criar um novo utilizador). */
  linkType: LinkType;
  /** id do Professor / Aluno / Funcionário selecionado como origem dos dados. */
  sourceId: string;
  /** Palavra-passe opcional para a conta do Encarregado de Educação, criada
   * automaticamente quando o vínculo escolhido é "Aluno". Se vazia, o sistema
   * gera uma palavra-passe temporária. */
  guardianPassword: string;
  /** Ao vincular um Aluno, o administrador escolhe primeiro o que criar:
   * 'both' = aluno + encarregado · 'student' = só o aluno · '' = ainda por escolher. */
  accountScope: '' | 'both' | 'student';
}

const emptyForm = (): UserFormState => ({
  id: null,
  name: '',
  email: '',
  username: '',
  password: '',
  phone: '',
  role: 'director',
  avatar: DEFAULT_AVATARS[0],
  linkType: 'manual',
  sourceId: '',
  guardianPassword: '',
  accountScope: ''
});

export const TabUsuarios: React.FC<TabUsuariosProps> = ({ db, settings, currentUserRole }) => {
  const [users, setUsers] = useState<User[]>(dbService.getUsers());
  const { page: pgUsers, setPage: setPgUsers, pageItems: visibleUsers } = usePagedList(users, [users.length]);
  const [showModal, setShowModal] = useState(false);
  const [form, setForm] = useState<UserFormState>(emptyForm());
  const [userToDelete, setUserToDelete] = useState<User | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [accountsCreatedInfo, setAccountsCreatedInfo] = useState<{
    studentEmail: string;
    guardianCreated: boolean;
    guardianEmail?: string;
    guardianPassword?: string;
  } | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  // Editor de acessos (secções → modo → botões) do utilizador escolhido.
  const [accessUser, setAccessUser] = useState<User | null>(null);

  const canManageUsers = currentUserRole === 'admin';

  useEffect(() => {
    const unsubscribe = dbService.subscribe((updatedDb) => {
      setUsers(updatedDb.users || []);
    });
    return () => unsubscribe();
  }, []);

  // Registos de origem já vinculados a uma conta de utilizador não voltam a
  // aparecer na lista de seleção, para impedir a criação de contas duplicadas.
  const linkedTeacherIds = new Set(users.filter((u) => u.linkedTeacherId).map((u) => u.linkedTeacherId));
  const linkedStudentIds = new Set(
    users.filter((u) => u.role === 'aluno' && u.linkedStudentId).map((u) => u.linkedStudentId)
  );
  const linkedFuncionarioIds = new Set(users.filter((u) => u.linkedFuncionarioId).map((u) => u.linkedFuncionarioId));

  const availableTeachers = (db.teachers || []).filter((t) => !linkedTeacherIds.has(t.id));
  const availableStudents = (db.students || []).filter((s) => !linkedStudentIds.has(s.id));
  const availableFuncionarios = (db.funcionarios || []).filter((f) => !linkedFuncionarioIds.has(f.id));

  const handleChangeLinkType = (linkType: LinkType) => {
    setForm((prev) => ({
      ...emptyForm(),
      linkType,
      role: linkType === 'professor' ? 'professor' : linkType === 'funcionario' ? 'funcionario' : linkType === 'aluno' ? 'aluno' : prev.role
    }));
  };

  const handleSelectSource = (sourceId: string) => {
    if (form.linkType === 'professor') {
      const teacher = availableTeachers.find((t) => t.id === sourceId);
      setForm((prev) => ({
        ...prev,
        sourceId,
        name: teacher?.name || '',
        email: teacher?.email || '',
        phone: teacher?.phone || '',
        avatar: teacher?.avatar || DEFAULT_AVATARS[0]
      }));
    } else if (form.linkType === 'funcionario') {
      const funcionario = availableFuncionarios.find((f) => f.id === sourceId);
      setForm((prev) => ({
        ...prev,
        sourceId,
        name: funcionario?.name || '',
        email: funcionario?.email || '',
        phone: funcionario?.phone || '',
        avatar: funcionario?.avatar || DEFAULT_AVATARS[0]
      }));
    } else if (form.linkType === 'aluno') {
      const student = availableStudents.find((s) => s.id === sourceId);
      setForm((prev) => ({
        ...prev,
        sourceId,
        name: student?.name || '',
        email: student?.email || '',
        phone: student?.studentPhone || '',
        avatar: student?.avatar || DEFAULT_AVATARS[0]
      }));
    } else {
      setForm((prev) => ({ ...prev, sourceId }));
    }
  };

  const roleDefFor = (role: UserRole) => {
    const rolesStore = { ...defaultRoles, ...(settings.rolePermissions || {}) } as Record<string, any>;
    return rolesStore[role as RoleKey];
  };

  const openAddModal = () => {
    setForm(emptyForm());
    setErrorMessage(null);
    setShowModal(true);
  };

  const openEditModal = (user: User) => {
    setForm({
      id: user.id,
      name: user.name,
      email: user.email,
      username: user.username || '',
      password: '',
      phone: user.phone || '',
      role: user.role,
      avatar: user.avatar || DEFAULT_AVATARS[0],
      linkType: 'manual',
      sourceId: '',
      guardianPassword: '',
      accountScope: ''
    });
    setErrorMessage(null);
    setShowModal(true);
  };

  const handleAvatarUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 10 * 1024 * 1024) {
      setErrorMessage('A fotografia excede o limite de 10MB.');
      return;
    }
    try {
      const compressed = await compressImageFile(file, 300, 300, 0.82);
      setForm((prev) => ({ ...prev, avatar: compressed }));
    } catch {
      const reader = new FileReader();
      reader.onloadend = () => {
        if (typeof reader.result === 'string') {
          setForm((prev) => ({ ...prev, avatar: reader.result as string }));
        }
      };
      reader.readAsDataURL(file);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMessage(null);

    const isEditing = !!form.id;
    const isAlunoLink = !isEditing && form.linkType === 'aluno';

    if ((form.linkType === 'professor' || form.linkType === 'funcionario' || form.linkType === 'aluno') && !isEditing && !form.sourceId) {
      setErrorMessage('Selecione o registo de origem (Professor, Aluno ou Funcionário) para vincular a esta conta.');
      return;
    }

    if (isAlunoLink && !form.accountScope) {
      setErrorMessage('Escolha o que criar: a conta do aluno com a do encarregado, ou apenas a conta do aluno.');
      return;
    }
    if (isAlunoLink && form.accountScope === 'both') {
      const st = (db.students || []).find((s) => s.id === form.sourceId);
      if (!st?.guardianName?.trim()) {
        setErrorMessage('Este aluno não tem Encarregado de Educação na ficha. Preencha-o na ficha do aluno ou escolha "Apenas o aluno".');
        return;
      }
    }

    // Na conta do Aluno o nome/e-mail vêm da ficha do aluno (podem ser gerados
    // automaticamente se não existir e-mail cadastrado), pelo que a validação
    // de nome/e-mail não se aplica da mesma forma.
    if (!isAlunoLink && (!form.name.trim() || !form.email.trim())) {
      setErrorMessage('Por favor, preencha pelo menos o nome e o e-mail do utilizador.');
      return;
    }
    if (!form.id && (!form.password || form.password.trim().length < 4)) {
      setErrorMessage('Defina uma palavra-passe com pelo menos 4 caracteres para o novo utilizador.');
      return;
    }

    try {
      await runGlobalOperation(
        async () => {
          if (isEditing && form.id) {
            const updates: Partial<User> = {
              name: form.name.trim(),
              email: form.email.trim().toLowerCase(),
              username: form.username.trim() || undefined,
              phone: form.phone.trim(),
              role: form.role,
              roleTitle: ROLE_LABELS[form.role],
              avatar: form.avatar
            };
            await dbService.updateUserRemote(form.id, updates);
          } else if (isAlunoLink) {
            // Cria, num único passo, a conta do Aluno e (automaticamente) a
            // conta do respetivo Encarregado de Educação.
            const result = await dbService.createStudentAndGuardianAccounts({
              studentId: form.sourceId,
              studentPassword: form.password.trim(),
              createGuardian: form.accountScope === 'both',
              guardianPassword: form.accountScope === 'both' ? form.guardianPassword.trim() || undefined : undefined
            });
            setAccountsCreatedInfo({
              studentEmail: result.studentUser.email,
              guardianCreated: result.guardianCreated,
              guardianEmail: result.guardianUser?.email,
              guardianPassword: result.guardianPassword
            });
          } else {
            await dbService.addUser({
              name: form.name.trim(),
              email: form.email.trim().toLowerCase(),
              username: form.username.trim() || undefined,
              role: form.role,
              roleTitle: ROLE_LABELS[form.role],
              avatar: form.avatar,
              phone: form.phone.trim(),
              password: form.password.trim(),
              linkedTeacherId: form.linkType === 'professor' ? form.sourceId : undefined,
              linkedFuncionarioId: form.linkType === 'funcionario' ? form.sourceId : undefined
            });
          }
        },
        {
          requiredRule: 'config.permissions',
          userRole: currentUserRole,
          loadingMessage: isEditing
            ? 'A atualizar dados do utilizador no sistema...'
            : isAlunoLink
            ? 'A criar conta do aluno e, automaticamente, do encarregado de educação...'
            : 'A criar novo utilizador e a atribuir perfil de acesso...',
          successMessage: 'Operação feita com sucesso!'
        }
      );
      setShowModal(false);
      setForm(emptyForm());
    } catch {
      // Erro já apresentado pelo modal global de operação (ex: permissão negada)
    }
  };

  const handleSaveAccess = async (access: UserAccess) => {
    if (!accessUser) return;
    const target = accessUser;
    try {
      await runGlobalOperation(
        async () => {
          const saved = await dbService.saveUserAccess(target.id, access);
          if (!saved.success) throw new Error(saved.error || 'Não foi possível guardar os acessos.');
          const n = Object.keys(access.sections || {}).length;
          dbService.addAuditLog({
            userName: dbService.getDatabase()?.currentUser?.name || 'Administrador',
            userRole: 'Administrador',
            action: 'Alteração de Acessos do Utilizador',
            details: `Acessos de "${target.name}" atualizados (${n} secção(ões) personalizada(s); as restantes herdam o perfil).`,
            module: 'sistema',
            timestamp: new Date().toLocaleString('pt-PT'),
            badgeColor: '#0b1f3a'
          } as any);
        },
        {
          requiredRule: 'config.permissions',
          userRole: currentUserRole,
          loadingMessage: 'A guardar os acessos do utilizador...',
          successMessage: 'Acessos atualizados! O utilizador vê as mudanças de imediato.'
        }
      );
      setAccessUser(null);
    } catch {
      // Erro já apresentado pelo modal global de operação
    }
  };

  const handleConfirmDelete = async () => {
    if (!userToDelete) return;
    const target = userToDelete;
    setUserToDelete(null);

    try {
      await runGlobalOperation(
        async () => {
          const result = await dbService.deleteUserRemote(target.id);
          if (!result.success) {
            throw new Error(result.error || 'Não foi possível eliminar o utilizador.');
          }
        },
        {
          requiredRule: 'config.permissions',
          userRole: currentUserRole,
          loadingMessage: `A eliminar o utilizador ${target.name}...`,
          successMessage: 'Operação feita com sucesso!'
        }
      );
    } catch {
      // Erro já apresentado pelo modal global de operação
    }
  };

  return (
    <div className="flex flex-col gap-6">
      {/* Top Header */}
      <div className="p-6 rounded-2xl bg-white border border-slate-200 shadow-xs flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="w-11 h-11 rounded-xl bg-slate-100 flex items-center justify-center text-[#0b1f3a] shrink-0">
            <span className="material-symbols-outlined text-[26px]">group_add</span>
          </div>
          <div>
            <div className="flex items-center gap-2">
              <span className="text-[11px] uppercase tracking-wider text-[#ac332b] font-bold">Módulo 08</span>
              <span className="w-1 h-1 rounded-full bg-slate-300" />
              <span className="text-[11px] text-slate-500 font-medium">CRIAÇÃO DE UTILIZADORES E PERFIL</span>
            </div>
            <h2 className="font-headline text-lg lg:text-xl font-bold text-slate-900">
              UTILIZADORES E PERFIL DE ACESSO
            </h2>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <span className="px-3 py-1.5 bg-blue-50 text-[#0b1f3a] font-mono text-xs font-bold rounded-xl border border-blue-100 flex items-center gap-1.5">
            <span className="material-symbols-outlined text-[16px]">groups</span>
            <span>{users.length} Utilizador(es) Registado(s)</span>
          </span>
          {canManageUsers ? (
            <button
              type="button"
              onClick={openAddModal}
              className="px-3.5 py-2 rounded-xl bg-[#0b1f3a] hover:bg-[#7a0c0c] text-white font-bold text-xs flex items-center gap-1.5 transition-colors shadow-xs cursor-pointer"
            >
              <span className="material-symbols-outlined text-[16px]">add</span>
              <span>CADASTRAR</span>
            </button>
          ) : (
            <span className="px-3 py-1.5 bg-amber-50 border border-amber-200 text-amber-800 text-xs font-semibold rounded-xl flex items-center gap-1.5">
              <span className="material-symbols-outlined text-[16px] text-amber-600">lock</span>
              <span>Apenas Administrador pode criar e gerir contas</span>
            </span>
          )}
        </div>
      </div>

      {/* Users Table */}
      <section className="bg-white p-6 rounded-2xl border border-slate-200 shadow-xs flex flex-col gap-4">
        <div className="pb-3 border-b border-slate-100">
          <h3 className="font-headline text-base lg:text-lg font-bold text-slate-900">
            Cadastro de Utilizadores
          </h3>
          <p className="text-xs text-slate-500">
            Crie as contas de acesso da instituição e um perfil a cada utilizador.
          </p>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead>
              <tr className="bg-[#0b1f3a] text-white uppercase tracking-wider font-bold border-b border-slate-800 text-[11px]">
                <th className="py-3 px-4 rounded-l-lg">Utilizador</th>
                <th className="py-3 px-4">E-mail / Utilizador</th>
                <th className="py-3 px-4">Perfil Atribuído</th>
                <th className="py-3 px-4">Contacto</th>
                <th className="py-3 px-4 text-right rounded-r-lg">Ações</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 text-slate-700">
              {users.length === 0 && (
                <tr>
                  <td colSpan={5} className="py-8 px-4 text-center text-slate-400">
                    Nenhum utilizador registado ainda. Clique em "Criar Novo Utilizador" para começar.
                  </td>
                </tr>
              )}
              {visibleUsers.map((user) => {
                return (
                  <tr key={user.id} className="hover:bg-slate-50/80 transition-colors">
                    <td className="py-3 px-4">
                      <div className="flex items-center gap-2.5">
                        <img
                          src={user.avatar || DEFAULT_AVATARS[0]}
                          alt={user.name}
                          className="w-8 h-8 rounded-full object-cover border border-slate-200 shrink-0"
                        />
                        <div className="min-w-0">
                          <div className="font-semibold text-slate-900 truncate">{user.name}</div>
                          <div className="text-[10px] text-slate-400">{user.roleTitle}</div>
                        </div>
                      </div>
                    </td>
                    <td className="py-3 px-4">
                      <div className="text-slate-700">{user.email}</div>
                      {user.username && <div className="text-[10px] text-slate-400 font-mono">@{user.username}</div>}
                    </td>
                    <td className="py-3 px-4">
                      <span className="px-2 py-0.5 rounded bg-slate-100 font-bold text-slate-700 text-[11px]">
                        {ROLE_LABELS[user.role] || user.roleTitle || user.role}
                      </span>
                      {user.isFounder && (
                        <span className="ml-1.5 px-1.5 py-0.5 rounded bg-emerald-50 text-emerald-800 border border-emerald-200 text-[9px] font-bold uppercase" title="Primeiro administrador da instituição: não pode ser eliminado">
                          Fundador
                        </span>
                      )}
                      {user.access && Object.keys(user.access.sections || {}).length > 0 && (
                        <span className="ml-1.5 px-1.5 py-0.5 rounded bg-amber-50 text-amber-800 border border-amber-200 text-[9px] font-bold uppercase">
                          Acesso personalizado
                        </span>
                      )}
                    </td>
                    <td className="py-3 px-4 text-slate-500">{user.phone || '—'}</td>
                    <td className="py-3 px-4 text-right">
                      {canManageUsers ? (
                        <div className="flex items-center justify-end gap-1.5">
                          {user.role !== 'admin' && (
                            <button
                              type="button"
                              data-acl-ignore
                              onClick={() => setAccessUser(user)}
                              className="text-[#0b1f3a] hover:text-[#ac332b] font-bold p-1 cursor-pointer"
                              title="Acessos: secções, leitura/gravação e botões"
                            >
                              <span className="material-symbols-outlined text-[17px]">tune</span>
                            </button>
                          )}
                          <button
                            type="button"
                            onClick={() => openEditModal(user)}
                            className="text-[#0b1f3a] hover:text-[#ac332b] font-bold p-1 cursor-pointer"
                            title="Editar utilizador"
                          >
                            <span className="material-symbols-outlined text-[17px]">edit</span>
                          </button>
                          {user.isFounder ? (
                            <span
                              className="text-slate-300 p-1 cursor-not-allowed"
                              title="Administrador fundador: só pode ser removido eliminando a escola do sistema"
                            >
                              <span className="material-symbols-outlined text-[17px]">lock</span>
                            </span>
                          ) : (
                            <button
                              type="button"
                              onClick={() => setUserToDelete(user)}
                              className="text-slate-400 hover:text-red-600 font-bold p-1 cursor-pointer"
                              title="Eliminar utilizador"
                            >
                              <span className="material-symbols-outlined text-[17px]">delete</span>
                            </button>
                          )}
                        </div>
                      ) : (
                        <span className="text-[11px] text-slate-400 font-medium">Apenas Leitura</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
            <TablePagination total={users.length} page={pgUsers} onPageChange={setPgUsers} />
        </div>
      </section>

      {/* Editor de acessos por utilizador */}
      {accessUser && (
        <UserAccessEditor
          user={accessUser}
          registry={db.settings?.accessRegistry || settings?.accessRegistry}
          onClose={() => setAccessUser(null)}
          onSave={handleSaveAccess}
        />
      )}

      {/* Modal Novo / Editar Utilizador */}
      {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs animate-in fade-in">
          <div className="bg-white rounded-2xl p-6 max-w-md w-full border border-slate-200 shadow-2xl max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100">
              <h3 className="font-headline font-bold text-slate-900 text-sm lg:text-base">
                {form.id ? 'Editar Utilizador' : 'Criar Novo Utilizador'}
              </h3>
              <button
                type="button"
                onClick={() => setShowModal(false)}
                className="p-1 text-slate-400 hover:text-slate-600 rounded-lg"
              >
                <span className="material-symbols-outlined text-[20px]">close</span>
              </button>
            </div>

            {errorMessage && (
              <Notice tone="error">
                {errorMessage}
              </Notice>
            )}

            <form onSubmit={handleSubmit} className="mt-4 space-y-3.5 text-xs">
              {!form.id && (
                <div>
                  <label className="block font-bold text-slate-700 mb-1.5">Tipo de Vínculo</label>
                  <div className="grid grid-cols-4 gap-1.5">
                    {([
                      { key: 'manual', label: 'Manual', icon: 'edit_note' },
                      { key: 'professor', label: 'Professor', icon: 'badge' },
                      { key: 'aluno', label: 'Aluno', icon: 'school' },
                      { key: 'funcionario', label: 'Funcionário', icon: 'groups' }
                    ] as { key: LinkType; label: string; icon: string }[]).map((opt) => (
                      <button
                        key={opt.key}
                        type="button"
                        onClick={() => handleChangeLinkType(opt.key)}
                        className={`flex flex-col items-center gap-1 py-2 rounded-xl border text-[10px] font-bold transition-colors cursor-pointer ${
                          form.linkType === opt.key
                            ? 'bg-[#0b1f3a] border-[#0b1f3a] text-white'
                            : 'bg-slate-50 border-slate-200 text-slate-600 hover:bg-slate-100'
                        }`}
                      >
                        <span className="material-symbols-outlined text-[16px]">{opt.icon}</span>
                        <span>{opt.label}</span>
                      </button>
                    ))}
                  </div>

                  {form.linkType !== 'manual' && (
                    <div className="mt-2.5">
                      <label className="block font-bold text-slate-700 mb-1">
                        {form.linkType === 'professor' && 'Selecionar Professor Já Cadastrado'}
                        {form.linkType === 'aluno' && 'Selecionar Aluno Já Cadastrado'}
                        {form.linkType === 'funcionario' && 'Selecionar Funcionário Já Cadastrado'}
                      </label>
                      <SearchableSelect
                        required
                        value={form.sourceId}
                        onChange={(v) => handleSelectSource(v)}
                        placeholder="Pesquise pelo nome ou n.º..."
                        emptyMessage="Nenhum registo encontrado"
                        options={
                          form.linkType === 'professor'
                            ? availableTeachers.map((t) => ({ value: String(t.id), label: t.name, sublabel: t.agentNumber ? `N.º ${t.agentNumber}` : undefined }))
                            : form.linkType === 'aluno'
                            ? availableStudents.map((st) => ({ value: String(st.id), label: st.name, sublabel: st.procNumber ? `Processo ${st.procNumber}` : undefined }))
                            : availableFuncionarios.map((f) => ({
                                value: String(f.id),
                                label: f.name,
                                sublabel: f.cargo === 'outro' ? f.cargoOutroDescricao || 'Outro' : CARGO_LABELS[f.cargo]
                              }))
                        }
                      />
                      {form.linkType === 'professor' && availableTeachers.length === 0 && (
                        <p className="text-[10px] text-amber-600 mt-1">
                          Todos os professores já possuem conta de utilizador, ou nenhum professor está cadastrado.
                        </p>
                      )}
                      {form.linkType === 'aluno' && availableStudents.length === 0 && (
                        <p className="text-[10px] text-amber-600 mt-1">
                          Todos os alunos já possuem conta de utilizador, ou nenhum aluno está cadastrado.
                        </p>
                      )}
                      {form.linkType === 'funcionario' && availableFuncionarios.length === 0 && (
                        <p className="text-[10px] text-amber-600 mt-1">
                          Todos os funcionários já possuem conta de utilizador, ou nenhum funcionário está cadastrado.
                        </p>
                      )}
                    </div>
                  )}

                  {form.linkType === 'aluno' && form.sourceId && (
                    <div className="mt-2.5 p-2.5 rounded-lg bg-blue-50 border border-blue-200 text-blue-900 text-[11px]">
                      <div className="font-bold mb-1.5 flex items-center gap-1.5">
                        <span className="material-symbols-outlined text-[16px] text-blue-700">help</span>
                        <span>O que deseja criar?</span>
                      </div>
                      <div className="flex flex-col gap-1.5">
                        <label className="flex items-start gap-2 cursor-pointer">
                          <input
                            type="radio"
                            name="accountScope"
                            checked={form.accountScope === 'both'}
                            onChange={() => setForm((prev) => ({ ...prev, accountScope: 'both' }))}
                            className="mt-0.5"
                          />
                          <span><b>Aluno e Encarregado de Educação</b> — cria as duas contas (e-mail do encarregado da ficha, ou gerado automaticamente).</span>
                        </label>
                        <label className="flex items-start gap-2 cursor-pointer">
                          <input
                            type="radio"
                            name="accountScope"
                            checked={form.accountScope === 'student'}
                            onChange={() => setForm((prev) => ({ ...prev, accountScope: 'student', guardianPassword: '' }))}
                            className="mt-0.5"
                          />
                          <span><b>Apenas o Aluno</b> — cria só a conta do estudante.</span>
                        </label>
                      </div>
                    </div>
                  )}
                </div>
              )}

              <div className="flex items-center gap-3">
                <div className="w-16 h-16 rounded-full overflow-hidden border-2 border-slate-200 shrink-0 bg-slate-100">
                  <img src={form.avatar} alt="Avatar" className="w-full h-full object-cover" />
                </div>
                <div className="flex-1">
                  <label className="block font-bold text-slate-700 mb-1">Fotografia de Perfil</label>
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept="image/*"
                    onChange={handleAvatarUpload}
                    className="hidden"
                    id="user-avatar-upload"
                  />
                  <button
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                    className="px-3 py-1.5 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold text-[11px] flex items-center gap-1.5 cursor-pointer"
                  >
                    <span className="material-symbols-outlined text-[14px]">upload</span>
                    <span>Carregar Foto</span>
                  </button>
                </div>
              </div>

              <div>
                <label className="block font-bold text-slate-700 mb-1">Nome Completo</label>
                <input
                  type="text"
                  required={form.linkType !== 'aluno'}
                  readOnly={form.linkType === 'professor' || form.linkType === 'funcionario' || form.linkType === 'aluno'}
                  placeholder="ex: Ana Paula dos Santos"
                  value={form.name}
                  onChange={(e) => setForm((prev) => ({ ...prev, name: e.target.value }))}
                  className={`w-full px-3 py-2 border border-slate-200 rounded-xl outline-none focus:ring-1 focus:ring-[#0b1f3a] ${
                    form.linkType === 'professor' || form.linkType === 'funcionario' || form.linkType === 'aluno'
                      ? 'bg-slate-100 text-slate-500'
                      : 'bg-slate-50'
                  }`}
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-bold text-slate-700 mb-1">
                    E-mail Institucional {form.linkType === 'aluno' && '(opcional — gerado automaticamente se vazio)'}
                  </label>
                  <input
                    type="email"
                    required={form.linkType !== 'aluno'}
                    readOnly={form.linkType === 'professor' || form.linkType === 'funcionario'}
                    placeholder="ex: ana.santos@escola.pt"
                    value={form.email}
                    onChange={(e) => setForm((prev) => ({ ...prev, email: e.target.value }))}
                    className={`w-full px-3 py-2 border border-slate-200 rounded-xl outline-none focus:ring-1 focus:ring-[#0b1f3a] ${
                      form.linkType === 'professor' || form.linkType === 'funcionario' ? 'bg-slate-100 text-slate-500' : 'bg-slate-50'
                    }`}
                  />
                </div>
                <div>
                  <label className="block font-bold text-slate-700 mb-1">Nome de Utilizador</label>
                  <input
                    type="text"
                    placeholder="ex: ana.santos"
                    value={form.username}
                    onChange={(e) => setForm((prev) => ({ ...prev, username: e.target.value }))}
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl outline-none focus:ring-1 focus:ring-[#0b1f3a]"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                {!form.id ? (
                  <div>
                    <label className="block font-bold text-slate-700 mb-1">
                      {form.linkType === 'aluno' ? 'Palavra-passe do Aluno' : 'Palavra-passe'}
                    </label>
                    <input
                      type="password"
                      placeholder="••••••••"
                      value={form.password}
                      onChange={(e) => setForm((prev) => ({ ...prev, password: e.target.value }))}
                      className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl outline-none focus:ring-1 focus:ring-[#0b1f3a]"
                    />
                  </div>
                ) : (
                  <div>
                    <label className="block font-bold text-slate-700 mb-1">Palavra-passe</label>
                    <button
                      type="button"
                      onClick={async () => {
                        if (!form.email.trim()) return;
                        try {
                          await runGlobalOperation(
                            async () => {
                              const res = await dbService.resetUserPassword(form.email.trim());
                              if (!res.success) throw new Error(res.error || 'Não foi possível enviar o e-mail de redefinição.');
                            },
                            {
                              loadingMessage: 'A enviar e-mail de redefinição de palavra-passe...',
                              successMessage: 'E-mail de redefinição enviado com sucesso!'
                            }
                          );
                        } catch {
                          // erro já apresentado pelo modal global de operação
                        }
                      }}
                      className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-slate-700 font-bold hover:bg-slate-100 transition-colors"
                    >
                      Enviar link de redefinição
                    </button>
                  </div>
                )}
                <div>
                  <label className="block font-bold text-slate-700 mb-1">Telefone</label>
                  <input
                    type="text"
                    placeholder="+244 900 000 000"
                    value={form.phone}
                    onChange={(e) => setForm((prev) => ({ ...prev, phone: e.target.value }))}
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl outline-none focus:ring-1 focus:ring-[#0b1f3a]"
                  />
                </div>
              </div>

              {!form.id && form.linkType === 'aluno' && form.accountScope === 'both' && (
                <div>
                  <label className="block font-bold text-slate-700 mb-1">
                    Palavra-passe do Encarregado de Educação (opcional)
                  </label>
                  <input
                    type="password"
                    placeholder="Deixe vazio para gerar uma palavra-passe temporária"
                    value={form.guardianPassword}
                    onChange={(e) => setForm((prev) => ({ ...prev, guardianPassword: e.target.value }))}
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl outline-none focus:ring-1 focus:ring-[#0b1f3a]"
                  />
                </div>
              )}

              <div>
                <label className="block font-bold text-slate-700 mb-1">Perfil de Acesso (Permissões)</label>
                <SearchableSelect
                  value={form.role}
                  disabled={form.linkType !== 'manual' || !!(form.id && users.find((u) => u.id === form.id)?.isFounder)}
                  onChange={(v) => v && setForm((prev) => ({ ...prev, role: v as UserRole }))}
                  placeholder="Pesquise o perfil..."
                  options={ROLE_ORDER.map((role) => ({ value: role, label: ROLE_LABELS[role] }))}
                />
                <span className="text-[10px] text-slate-400 mt-1 block">
                  {form.id && users.find((u) => u.id === form.id)?.isFounder
                    ? 'Administrador fundador: o perfil não pode ser alterado.'
                    : form.linkType === 'manual'
                    ? 'O perfil selecionado define quais módulos e ações o utilizador poderá aceder (ver aba "Perfis & Permissões").'
                    : 'O perfil é definido automaticamente pelo tipo de vínculo escolhido.'}
                </span>
              </div>

              <div className="flex justify-end gap-2 pt-3 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setShowModal(false)}
                  className="px-3.5 py-2 rounded-xl bg-slate-100 text-slate-700 font-bold hover:bg-slate-200 cursor-pointer"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 rounded-xl bg-[#0b1f3a] text-white font-bold hover:bg-[#7a0c0c] transition-colors cursor-pointer"
                >
                  {form.id ? 'Salvar Alterações' : 'Criar Utilizador'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal Eliminar Utilizador */}
      {userToDelete && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-xs z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-none max-w-md w-full p-6 border border-slate-300 shadow-2xl">
            <div className="w-12 h-12 rounded-none bg-red-100 text-red-700 flex items-center justify-center mx-auto mb-4 border border-red-300">
              <span className="material-symbols-outlined text-[28px]">delete_forever</span>
            </div>
            <h3 className="font-headline text-lg font-bold text-slate-900 text-center">
              Eliminar Utilizador da Base de Dados?
            </h3>
            <p className="text-xs text-slate-600 text-center mt-2 leading-relaxed">
              Tem a certeza de que deseja eliminar o utilizador <strong>{userToDelete.name}</strong> ({ROLE_LABELS[userToDelete.role]})? Esta ação é definitiva na base de dados.
            </p>
            <div className="mt-6 flex items-center justify-end gap-2">
              <button
                onClick={() => setUserToDelete(null)}
                className="px-4 py-2 rounded-none bg-slate-200 hover:bg-slate-300 text-slate-700 font-bold text-xs border border-slate-300 cursor-pointer transition-colors"
                type="button"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={handleConfirmDelete}
                className="px-5 py-2.5 rounded-none bg-[#b91c1c] hover:bg-[#7a0c0c] text-white font-bold text-xs flex items-center gap-2 cursor-pointer transition-colors shadow-none border-none"
              >
                <span className="material-symbols-outlined text-[16px]">delete</span>
                <span>Eliminar</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal: Resumo das Contas Criadas (Aluno + Encarregado automático) */}
      {accountsCreatedInfo && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-xs z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-md w-full shadow-2xl overflow-hidden border border-slate-200">
            <div className="px-6 py-4 bg-emerald-700 text-white flex items-center gap-2">
              <span className="material-symbols-outlined text-[22px]">check_circle</span>
              <h3 className="font-bold text-sm">Contas Criadas com Sucesso</h3>
            </div>
            <div className="p-6 space-y-3 text-xs">
              <div className="p-3 rounded-xl bg-slate-50 border border-slate-200">
                <span className="block font-bold text-slate-700 mb-1">Conta do Aluno</span>
                <span className="font-mono text-slate-600">{accountsCreatedInfo.studentEmail}</span>
              </div>

              {accountsCreatedInfo.guardianCreated ? (
                <div className="p-3 rounded-xl bg-blue-50 border border-blue-200">
                  <span className="block font-bold text-blue-900 mb-1">
                    Conta do Encarregado de Educação (criada automaticamente)
                  </span>
                  <div className="text-blue-800">
                    <div>
                      E-mail: <span className="font-mono">{accountsCreatedInfo.guardianEmail}</span>
                    </div>
                    {accountsCreatedInfo.guardianPassword && (
                      <div>
                        Palavra-passe temporária: <span className="font-mono font-bold">{accountsCreatedInfo.guardianPassword}</span>
                      </div>
                    )}
                  </div>
                  <p className="text-[10px] text-blue-700 mt-1.5">
                    Comunique estes dados ao Encarregado de Educação. Este poderá depois redefinir a palavra-passe através do link de redefinição.
                  </p>
                </div>
              ) : (
                <div className="p-3 rounded-xl bg-slate-50 border border-slate-200 text-slate-500">
                  Este aluno já possuía (ou não tem) Encarregado de Educação com conta associada — nenhuma conta adicional foi criada.
                </div>
              )}
            </div>
            <div className="px-6 py-4 bg-slate-50 border-t border-slate-200 flex justify-end">
              <button
                type="button"
                onClick={() => setAccountsCreatedInfo(null)}
                className="px-4 py-2 rounded-xl bg-[#0b1f3a] text-white font-bold text-xs hover:bg-[#7a0c0c] transition-colors cursor-pointer"
              >
                Fechar
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
