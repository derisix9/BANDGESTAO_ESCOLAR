import React, { useMemo, useState } from 'react';
import { SchoolDatabase, SchoolDepartment, DepartmentKind, UserRole } from '../types';
import { dbService } from '../services/db';
import { runGlobalOperation } from '../context/OperationContext';
import { useAccessControl } from '../hooks/useAccessControl';
import { FormModalHeader } from '../components/FormModalHeader';
import { Notice } from '../components/Notice';

interface DepartamentosViewProps {
  db: SchoolDatabase;
  currentUserRole: UserRole;
}

const KIND_META: Record<
  DepartmentKind,
  { label: string; short: string; who: string; whoSingular: string; icon: string; helper: string }
> = {
  curricular: {
    label: 'Departamentos Curriculares',
    short: 'Curriculares',
    who: 'professores',
    whoSingular: 'professor',
    icon: 'menu_book',
    helper: ''
  },
  profissional: {
    label: 'Departamentos Profissionais',
    short: 'Profissionais',
    who: 'funcionários',
    whoSingular: 'funcionário',
    icon: 'badge',
    helper: ''
  }
};

interface FormState {
  kind: DepartmentKind;
  name: string;
  code: string;
  headId: string;
  description: string;
  status: 'ativo' | 'inativo';
}

const emptyForm = (kind: DepartmentKind): FormState => ({
  kind,
  name: '',
  code: '',
  headId: '',
  description: '',
  status: 'ativo'
});

const inputCls =
  'w-full h-9 px-3 bg-white border border-slate-300 text-slate-800 focus:border-[#0b1f3a] focus:outline-none text-xs';
const labelCls = 'block uppercase font-bold text-slate-700 mb-1 text-[11px]';

export const DepartamentosView: React.FC<DepartamentosViewProps> = ({ db, currentUserRole }) => {
  const acl = useAccessControl(currentUserRole);

  const [activeKind, setActiveKind] = useState<DepartmentKind>('curricular');
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'ativo' | 'inativo'>('all');
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editing, setEditing] = useState<SchoolDepartment | null>(null);
  const [form, setForm] = useState<FormState>(emptyForm('curricular'));
  const [formError, setFormError] = useState('');
  const [deleting, setDeleting] = useState<SchoolDepartment | null>(null);

  const departments = db.departments || [];
  const teachers = db.teachers || [];
  const funcionarios = db.funcionarios || [];

  const countByKind = (kind: DepartmentKind) => departments.filter((d) => d.kind === kind).length;

  const membersOf = (d: SchoolDepartment) => {
    const target = d.name.trim().toLowerCase();
    const list: Array<{ department?: string }> = d.kind === 'curricular' ? teachers : funcionarios;
    return list.filter((p) => (p.department || '').trim().toLowerCase() === target).length;
  };

  const headNameOf = (d: SchoolDepartment) => {
    if (!d.headId) return '';
    const pool: Array<{ id: string; name: string }> = d.kind === 'curricular' ? teachers : funcionarios;
    return pool.find((p) => p.id === d.headId)?.name || '';
  };

  const visible = useMemo(() => {
    const q = searchTerm.trim().toLowerCase();
    return departments
      .filter((d) => d.kind === activeKind)
      .filter((d) => statusFilter === 'all' || d.status === statusFilter)
      .filter(
        (d) =>
          !q ||
          d.name.toLowerCase().includes(q) ||
          (d.code || '').toLowerCase().includes(q) ||
          (d.description || '').toLowerCase().includes(q)
      )
      .sort((a, b) => a.name.localeCompare(b.name, 'pt'));
  }, [departments, activeKind, searchTerm, statusFilter]);

  // Valores de "departamento" já usados por professores/funcionários mas que
  // ainda não foram cadastrados aqui (dados anteriores a esta secção).
  const legacyNames = useMemo(() => {
    const registered = new Set(
      departments.filter((d) => d.kind === activeKind).map((d) => d.name.trim().toLowerCase())
    );
    const pool: Array<{ department?: string }> = activeKind === 'curricular' ? teachers : funcionarios;
    const seen = new Map<string, string>();
    pool.forEach((p) => {
      const raw = (p.department || '').trim();
      if (raw && !registered.has(raw.toLowerCase()) && !seen.has(raw.toLowerCase())) {
        seen.set(raw.toLowerCase(), raw);
      }
    });
    return Array.from(seen.values());
  }, [departments, teachers, funcionarios, activeKind]);

  const headCandidates = useMemo(
    () =>
      (form.kind === 'curricular' ? teachers : funcionarios)
        .map((p) => ({ id: p.id, name: p.name }))
        .sort((a, b) => a.name.localeCompare(b.name, 'pt')),
    [form.kind, teachers, funcionarios]
  );

  const run = async (
    action: () => void,
    loadingMessage: string
  ): Promise<{ ok: boolean; error?: string }> => {
    try {
      await runGlobalOperation(action, {
        loadingMessage,
        requiredRule: 'departamentos.manage',
        userRole: currentUserRole
      });
      return { ok: true };
    } catch (err: any) {
      return { ok: false, error: err?.message };
    }
  };

  const openAdd = () => {
    setEditing(null);
    setForm(emptyForm(activeKind));
    setFormError('');
    setIsModalOpen(true);
  };

  const openEdit = (d: SchoolDepartment) => {
    setEditing(d);
    setForm({
      kind: d.kind,
      name: d.name,
      code: d.code || '',
      headId: d.headId || '',
      description: d.description || '',
      status: d.status
    });
    setFormError('');
    setIsModalOpen(true);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!acl.can('departamentos.manage')) {
      acl.guard('departamentos.manage', () => undefined);
      return;
    }
    if (!form.name.trim()) {
      setFormError('Indique o nome do departamento.');
      return;
    }

    // Validação feita antes da operação global, para o erro aparecer no próprio formulário.
    let failure = '';
    const payload = {
      kind: form.kind,
      name: form.name,
      code: form.code.trim() || undefined,
      headId: form.headId || undefined,
      description: form.description.trim() || undefined,
      status: form.status
    };

    const result = await run(
      () => {
        const r = editing ? dbService.updateDepartment(editing.id, payload) : dbService.addDepartment(payload);
        if (!r.success) {
          failure = r.error;
          throw new Error(r.error);
        }
      },
      editing ? 'A guardar alterações do departamento...' : 'A cadastrar departamento...'
    );

    if (result.ok) {
      setIsModalOpen(false);
      setActiveKind(form.kind);
    } else {
      setFormError(failure || result.error || 'Não foi possível guardar o departamento.');
    }
  };

  const handleDelete = async () => {
    if (!deleting) return;
    const target = deleting;
    setDeleting(null);
    await run(() => {
      const r = dbService.deleteDepartment(target.id);
      if (!r.success) throw new Error(r.error);
    }, `A eliminar departamento ${target.name}...`);
  };

  const registerLegacy = async (names: string[]) => {
    await run(() => {
      names.forEach((name) => {
        dbService.addDepartment({ kind: activeKind, name, status: 'ativo' });
      });
    }, names.length === 1 ? `A registar "${names[0]}"...` : 'A registar departamentos existentes...');
  };

  const meta = KIND_META[activeKind];

  return (
    <div className="flex flex-col w-full gap-6 pb-12">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <span className="text-[11px] font-bold uppercase tracking-widest text-slate-500">DEPARTAMENTOS</span>
            <span className="w-1.5 h-1.5 rounded-full bg-[#0b1f3a]" />
            <span className="text-xs font-semibold text-[#0b1f3a]">ESTRUTURA ORGÂNICA</span>
          </div>
          <h1 className="font-headline text-2xl lg:text-3xl font-extrabold text-[#0b1f3a] tracking-tight">
            GESTÃO DE DEPARTAMENTOS
          </h1>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          {acl.can('departamentos.manage') && (
            <button
              onClick={openAdd}
              className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-[#0b1f3a] hover:bg-[#7a0c0c] active:scale-[0.98] transition-all duration-200 text-white font-bold text-xs shadow-sm shrink-0"
            >
              <span className="material-symbols-outlined text-[18px]">add_circle</span>
              <span>CADASTRAR</span>
            </button>
          )}
        </div>
      </div>

      {/* Tabs por categoria */}
      <div className="flex flex-wrap gap-2">
        {(Object.keys(KIND_META) as DepartmentKind[]).map((kind) => {
          const active = activeKind === kind;
          return (
            <button
              key={kind}
              onClick={() => setActiveKind(kind)}
              className={`flex items-center gap-2 px-4 py-2.5 rounded-xl border text-xs font-bold transition-colors cursor-pointer ${
                active
                  ? 'bg-[##0968b0] text-white border-[#0b1f3a]'
                  : 'bg-white text-slate-700 border-slate-200 hover:bg-slate-50'
              }`}
            >
              <span className="material-symbols-outlined text-[18px]">{KIND_META[kind].icon}</span>
              <span>{KIND_META[kind].label}</span>
              <span
                className={`px-1.5 py-0.5 rounded font-mono text-[10px] ${
                  active ? 'bg-white/20 text-white' : 'bg-slate-100 text-slate-600'
                }`}
              >
                {countByKind(kind)}
              </span>
            </button>
          );
        })}
      </div>

      <p className="text-[11px] text-slate-500 -mt-3">{meta.helper}</p>

      {/* Valores antigos ainda não cadastrados */}
      {legacyNames.length > 0 && acl.can('departamentos.manage') && (
        <div className="bg-amber-50 border border-amber-200 rounded-2xl p-4 flex flex-col md:flex-row md:items-center gap-3">
          <span className="material-symbols-outlined text-amber-700 text-[22px] shrink-0">info</span>
          <div className="flex-1 min-w-0">
            <p className="text-xs font-bold text-amber-900">
              {legacyNames.length === 1
                ? `Há 1 departamento em uso por ${meta.who} que ainda não está cadastrado.`
                : `Há ${legacyNames.length} departamentos em uso por ${meta.who} que ainda não estão cadastrados.`}
            </p>
            <div className="flex flex-wrap gap-1.5 mt-2">
              {legacyNames.map((name) => (
                <button
                  key={name}
                  onClick={() => registerLegacy([name])}
                  title="Registar este departamento"
                  className="px-2 py-1 bg-white border border-amber-300 text-amber-900 text-[11px] font-semibold hover:bg-amber-100 cursor-pointer flex items-center gap-1"
                >
                  <span className="material-symbols-outlined text-[14px]">add</span>
                  {name}
                </button>
              ))}
            </div>
          </div>
          {legacyNames.length > 1 && (
            <button
              onClick={() => registerLegacy(legacyNames)}
              className="px-3 py-2 bg-amber-700 hover:bg-amber-800 text-white text-xs font-bold cursor-pointer shrink-0"
            >
              Registar todos
            </button>
          )}
        </div>
      )}

      {/* Filter Bar */}
      <div className="bg-white p-4 rounded-2xl border border-slate-200 shadow-xs flex flex-col md:flex-row items-center justify-between gap-3">
        <div className="relative flex items-center w-full md:w-80 border border-slate-400/30 bg-slate-50/60 focus-within:border-slate-400/70 focus-within:bg-white transition-colors">
          <span className="material-symbols-outlined ml-3 text-slate-400 text-[18px] shrink-0">search</span>
          <input
            type="text"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            placeholder="Pesquisar por nome, sigla ou descrição..."
            className="w-full h-9 pl-2 pr-3 bg-transparent border-0 outline-none focus:ring-0 text-xs text-slate-800 placeholder:text-slate-400"
          />
        </div>

        <div className="flex flex-wrap items-center gap-3 w-full md:w-auto">
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value as 'all' | 'ativo' | 'inativo')}
            className="h-9 px-3 rounded-lg bg-slate-100 text-xs font-semibold text-slate-700 border-0 focus:ring-1 focus:ring-[#0b1f3a]"
          >
            <option value="all">Todos os Estados</option>
            <option value="ativo">Ativos</option>
            <option value="inativo">Inativos</option>
          </select>
         
        </div>
      </div>

      {/* Tabela */}
      <div className="bg-white rounded-2xl border border-slate-200 shadow-xs overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead>
              <tr className="bg-[#0b1f3a] text-white font-bold uppercase text-[10px] tracking-wider border-b border-slate-800">
                <th className="py-3.5 px-4 text-white">Departamento</th>
                <th className="py-3.5 px-3 text-white">Responsável</th>
                <th className="py-3.5 px-3 text-center text-white capitalize">{meta.who}</th>
                <th className="py-3.5 px-3 text-white">Estado</th>
                <th className="py-3.5 px-4 text-right text-white">Ações</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {visible.length === 0 ? (
                <tr>
                  <td colSpan={5} className="py-12 text-center text-slate-400 text-xs">
                    Nenhum departamento {activeKind === 'curricular' ? 'curricular' : 'profissional'} cadastrado ou
                    encontrado. Clique em "CADASTRAR" para adicionar.
                  </td>
                </tr>
              ) : (
                visible.map((d) => {
                  const members = membersOf(d);
                  const head = headNameOf(d);
                  return (
                    <tr key={d.id} className="hover:bg-slate-50 transition-colors">
                      <td className="py-3.5 px-4">
                        <div className="font-bold text-[#0b1f3a]">{d.name}</div>
                        <div className="flex items-center gap-2 mt-0.5">
                          {d.code && (
                            <span className="font-mono text-[10px] px-1.5 py-0.5 bg-slate-100 text-slate-600">
                              {d.code}
                            </span>
                          )}
                          {d.description && (
                            <span className="text-[11px] text-slate-500 truncate max-w-[280px]">{d.description}</span>
                          )}
                        </div>
                      </td>
                      <td className="py-3.5 px-3 text-slate-700">
                        {head || <span className="text-slate-400 italic">Não definido</span>}
                      </td>
                      <td className="py-3.5 px-3 text-center">
                        <span className="font-mono font-bold text-slate-800 bg-slate-100 px-2.5 py-1 rounded-md text-xs">
                          {members}
                        </span>
                      </td>
                      <td className="py-3.5 px-3">
                        <span
                          className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                            d.status === 'ativo' ? 'bg-emerald-100 text-emerald-800' : 'bg-slate-200 text-slate-600'
                          }`}
                        >
                          {d.status === 'ativo' ? 'Ativo' : 'Inativo'}
                        </span>
                      </td>
                      <td className="py-3.5 px-4 text-right">
                        {acl.can('departamentos.manage') && (
                          <div className="flex items-center justify-end gap-1">
                            <button
                              onClick={() => openEdit(d)}
                              className="p-1.5 rounded-lg text-slate-500 hover:text-blue-700 hover:bg-slate-100 active:scale-[0.98] transition-all cursor-pointer"
                              title="Editar departamento"
                            >
                              <span className="material-symbols-outlined text-[18px]">edit</span>
                            </button>
                            <button
                              onClick={() => setDeleting(d)}
                              className="p-1.5 rounded-lg text-slate-400 hover:text-red-700 hover:bg-red-50 active:scale-[0.98] transition-all cursor-pointer"
                              title="Eliminar departamento"
                            >
                              <span className="material-symbols-outlined text-[18px]">delete</span>
                            </button>
                          </div>
                        )}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Modal: Cadastrar / Editar */}
      {isModalOpen && (
        <div
          className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-3 sm:p-6"
          onClick={(e) => {
            if (e.target === e.currentTarget) setIsModalOpen(false);
          }}
        >
          <div className="bg-white max-w-xl w-full shadow-2xl border border-slate-400 overflow-hidden flex flex-col max-h-[94vh]">
            <FormModalHeader
              title={editing ? 'Editar Departamento' : 'Novo Departamento'}
              subtitle="Estrutura orgânica da escola"
              icon="account_tree"
              onClose={() => setIsModalOpen(false)}
            />
            <form onSubmit={handleSubmit} className="flex-1 overflow-y-auto p-6 text-xs space-y-4">
              <div>
                <label className={labelCls}>Categoria *</label>
                <div className="grid grid-cols-2 gap-2">
                  {(Object.keys(KIND_META) as DepartmentKind[]).map((kind) => {
                    const selected = form.kind === kind;
                    return (
                      <button
                        key={kind}
                        type="button"
                        onClick={() => setForm({ ...form, kind, headId: '' })}
                        className={`flex items-center gap-2 px-3 py-2.5 border text-left cursor-pointer transition-colors ${
                          selected
                            ? 'border-[#0b1f3a] bg-[#0b1f3a]/5 text-[#0b1f3a]'
                            : 'border-slate-300 bg-white text-slate-600 hover:bg-slate-50'
                        }`}
                      >
                        <span className="material-symbols-outlined text-[20px]">{KIND_META[kind].icon}</span>
                        <span>
                          <span className="block font-bold text-xs">{KIND_META[kind].short}</span>
                          <span className="block text-[10px] text-slate-500">
                            Para {KIND_META[kind].who}
                          </span>
                        </span>
                      </button>
                    );
                  })}
                </div>
                {editing && editing.kind !== form.kind && (
                  <p className="text-[10px] text-amber-700 mt-1">
                    A categoria só pode ser alterada se não houver {KIND_META[editing.kind].who} associados.
                  </p>
                )}
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <div className="sm:col-span-2">
                  <label className={labelCls}>Nome do Departamento *</label>
                  <input
                    type="text"
                    required
                    autoFocus
                    value={form.name}
                    onChange={(e) => setForm({ ...form, name: e.target.value })}
                    placeholder={
                      form.kind === 'curricular' ? 'Ex: Ciências Exatas' : 'Ex: Secretaria Geral, Tesouraria'
                    }
                    className={inputCls}
                  />
                </div>
                <div>
                  <label className={labelCls}>Sigla</label>
                  <input
                    type="text"
                    value={form.code}
                    onChange={(e) => setForm({ ...form, code: e.target.value.toUpperCase() })}
                    placeholder="Ex: DCE"
                    maxLength={10}
                    className={`${inputCls} font-mono`}
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className={labelCls}>
                    {form.kind === 'curricular' ? 'Chefe de Departamento' : 'Responsável do Setor'}
                  </label>
                  <select
                    value={form.headId}
                    onChange={(e) => setForm({ ...form, headId: e.target.value })}
                    className={inputCls}
                  >
                    <option value="">Não definido</option>
                    {headCandidates.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className={labelCls}>Estado</label>
                  <select
                    value={form.status}
                    onChange={(e) => setForm({ ...form, status: e.target.value as 'ativo' | 'inativo' })}
                    className={inputCls}
                  >
                    <option value="ativo">Ativo</option>
                    <option value="inativo">Inativo</option>
                  </select>
                </div>
              </div>

              <div>
                <label className={labelCls}>Descrição</label>
                <textarea
                  rows={3}
                  value={form.description}
                  onChange={(e) => setForm({ ...form, description: e.target.value })}
                  placeholder="Áreas, disciplinas ou funções que este departamento agrupa..."
                  className="w-full px-3 py-2 bg-white border border-slate-300 text-slate-800 focus:border-[#0b1f3a] focus:outline-none text-xs resize-none"
                />
              </div>

              {formError && (
                <Notice tone="error" icon="error">
                  <span>{formError}</span>
                </Notice>
              )}

              <div className="pt-4 flex items-center justify-end gap-2 border-t border-slate-300">
                <button
                  type="button"
                  onClick={() => setIsModalOpen(false)}
                  className="px-4 py-2 bg-slate-200 hover:bg-slate-300 text-slate-800 font-bold text-xs cursor-pointer border border-slate-300"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  className="px-5 py-2 bg-[#0b1f3a] hover:bg-[#7a0c0c] text-white font-bold text-xs cursor-pointer transition-colors border border-[#0b1f3a] flex items-center gap-1.5"
                >
                  <span className="material-symbols-outlined text-[16px]">save</span>
                  <span>{editing ? 'SALVAR ALTERAÇÕES' : 'CADASTRAR'}</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal: Eliminar */}
      {deleting && (
        <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4">
          <div className="bg-white max-w-md w-full shadow-2xl overflow-hidden border border-slate-300">
            <FormModalHeader
              title="Eliminar Departamento"
              icon="warning"
              onClose={() => setDeleting(null)}
            />
            <div className="p-6">
              <h3 className="font-headline text-lg font-bold text-slate-900 text-center">
                Eliminar "{deleting.name}"?
              </h3>
              {membersOf(deleting) > 0 ? (
                <p className="text-xs text-red-700 text-center mt-2 leading-relaxed">
                  Este departamento tem {membersOf(deleting)} {KIND_META[deleting.kind].who} associados e não pode ser
                  eliminado. Reatribua-os a outro departamento ou marque este como Inativo.
                </p>
              ) : (
                <p className="text-xs text-slate-600 text-center mt-2 leading-relaxed">
                  O departamento deixará de aparecer nos seletores de registo de {KIND_META[deleting.kind].who}.
                </p>
              )}
            </div>
            <div className="px-6 py-4 bg-slate-50 border-t border-slate-300 flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={() => setDeleting(null)}
                className="px-4 py-2.5 bg-slate-200 hover:bg-slate-300 text-slate-700 font-bold text-xs cursor-pointer border border-slate-300"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={handleDelete}
                disabled={membersOf(deleting) > 0}
                className="px-5 py-2.5 bg-[#b91c1c] hover:bg-[#7a0c0c] disabled:opacity-40 disabled:cursor-not-allowed text-white font-bold text-xs flex items-center gap-2 cursor-pointer transition-colors border-none"
              >
                <span className="material-symbols-outlined text-[16px]">delete</span>
                <span>Eliminar</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
