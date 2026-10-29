import React, { useMemo, useState } from 'react';
import { SchoolDatabase, Supplier, SupplierCategory, UserRole } from '../types';
import { dbService } from '../services/db';
import { runGlobalOperation } from '../context/OperationContext';
import { useAccessControl } from '../hooks/useAccessControl';
import { FormModalHeader } from '../components/FormModalHeader';
import { SearchableSelect } from '../components/SearchableSelect';
import { ANGOLA_PROVINCE_NAMES, getMunicipalitiesForProvince } from '../data/angolaDivisions';
import { TablePagination, usePagedList } from '../components/TablePagination';
import { Notice } from '../components/Notice';

interface FornecedoresViewProps {
  db: SchoolDatabase;
  currentUserRole: UserRole;
}

export const SUPPLIER_CATEGORY_LABELS: Record<SupplierCategory, string> = {
  material_didatico: 'Material Didático & Livros',
  material_escritorio: 'Material de Escritório',
  limpeza_higiene: 'Limpeza & Higiene',
  alimentacao: 'Alimentação / Refeitório',
  manutencao: 'Manutenção & Obras',
  tecnologia: 'Tecnologia & Equipamentos',
  uniformes: 'Uniformes & Fardamento',
  transporte: 'Transporte Escolar',
  seguranca: 'Segurança',
  servicos: 'Serviços Gerais',
  outro: 'Outro'
};

type SupplierForm = Omit<Supplier, 'id' | 'code' | 'createdAt'>;

const emptyForm = (): SupplierForm => ({
  name: '',
  nif: '',
  category: 'material_didatico',
  contactPerson: '',
  phone: '',
  email: '',
  province: '',
  municipality: '',
  address: '',
  paymentTerms: '',
  bankName: '',
  iban: '',
  notes: '',
  status: 'ativo'
});

const inputCls =
  'w-full h-9 px-3 bg-white border border-slate-300 text-slate-800 focus:border-[#0b1f3a] focus:outline-none text-xs';
const labelCls = 'block uppercase font-bold text-slate-700 mb-1 text-[11px]';

const SectionTitle: React.FC<{ icon: string; children: React.ReactNode }> = ({ icon, children }) => (
  <div className="flex items-center gap-2 pb-1.5 border-b border-slate-200">
    <span className="material-symbols-outlined text-[16px] text-[#0b1f3a]">{icon}</span>
    <span className="font-bold text-slate-800 text-[11px] uppercase tracking-wide">{children}</span>
  </div>
);

export const FornecedoresView: React.FC<FornecedoresViewProps> = ({ db, currentUserRole }) => {
  const acl = useAccessControl(currentUserRole);

  const [searchTerm, setSearchTerm] = useState('');
  const [categoryFilter, setCategoryFilter] = useState<'all' | SupplierCategory>('all');
  const [statusFilter, setStatusFilter] = useState<'all' | 'ativo' | 'inativo'>('all');
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editing, setEditing] = useState<Supplier | null>(null);
  const [form, setForm] = useState<SupplierForm>(emptyForm());
  const [formError, setFormError] = useState('');
  const [deleting, setDeleting] = useState<Supplier | null>(null);
  const [viewing, setViewing] = useState<Supplier | null>(null);

  const suppliers = db.suppliers || [];

  const filtered = useMemo(() => {
    const q = searchTerm.trim().toLowerCase();
    return suppliers
      .filter((s) => categoryFilter === 'all' || s.category === categoryFilter)
      .filter((s) => statusFilter === 'all' || s.status === statusFilter)
      .filter(
        (s) =>
          !q ||
          s.name.toLowerCase().includes(q) ||
          s.code.toLowerCase().includes(q) ||
          (s.nif || '').toLowerCase().includes(q) ||
          (s.contactPerson || '').toLowerCase().includes(q) ||
          (s.phone || '').toLowerCase().includes(q)
      )
      .sort((a, b) => a.name.localeCompare(b.name, 'pt'));
  }, [suppliers, searchTerm, categoryFilter, statusFilter]);
  const { page: pgFiltered, setPage: setPgFiltered, pageItems: visibleFiltered } = usePagedList(filtered, [filtered.length]);

  const activeCount = suppliers.filter((s) => s.status === 'ativo').length;

  const provinceOptions = useMemo(() => ANGOLA_PROVINCE_NAMES.map((n) => ({ value: n, label: n })), []);
  const municipalityOptions = useMemo(
    () => getMunicipalitiesForProvince(form.province || '').map((m) => ({ value: m.name, label: m.name })),
    [form.province]
  );

  const clean = (v?: string) => (v && v.trim() ? v.trim() : undefined);

  const run = async (action: () => void, loadingMessage: string): Promise<{ ok: boolean; error?: string }> => {
    try {
      await runGlobalOperation(action, {
        loadingMessage,
        requiredRule: 'fornecedores.manage',
        userRole: currentUserRole
      });
      return { ok: true };
    } catch (err: any) {
      return { ok: false, error: err?.message };
    }
  };

  const openAdd = () => {
    setEditing(null);
    setForm(emptyForm());
    setFormError('');
    setIsModalOpen(true);
  };

  const openEdit = (s: Supplier) => {
    setEditing(s);
    setForm({
      name: s.name,
      nif: s.nif || '',
      category: s.category,
      contactPerson: s.contactPerson || '',
      phone: s.phone || '',
      email: s.email || '',
      province: s.province || '',
      municipality: s.municipality || '',
      address: s.address || '',
      paymentTerms: s.paymentTerms || '',
      bankName: s.bankName || '',
      iban: s.iban || '',
      notes: s.notes || '',
      status: s.status
    });
    setFormError('');
    setIsModalOpen(true);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!acl.can('fornecedores.manage')) {
      acl.guard('fornecedores.manage', () => undefined);
      return;
    }
    if (!form.name.trim()) {
      setFormError('Indique o nome do fornecedor.');
      return;
    }
    if (form.email && !/^\S+@\S+\.\S+$/.test(form.email.trim())) {
      setFormError('O e-mail indicado não é válido.');
      return;
    }

    const payload: SupplierForm = {
      ...form,
      name: form.name.trim(),
      nif: clean(form.nif),
      contactPerson: clean(form.contactPerson),
      phone: clean(form.phone),
      email: clean(form.email),
      province: clean(form.province),
      municipality: clean(form.municipality),
      address: clean(form.address),
      paymentTerms: clean(form.paymentTerms),
      bankName: clean(form.bankName),
      iban: clean(form.iban)?.toUpperCase().replace(/\s+/g, ' '),
      notes: clean(form.notes)
    };

    let failure = '';
    const result = await run(
      () => {
        const r = editing ? dbService.updateSupplier(editing.id, payload) : dbService.addSupplier(payload);
        if (!r.success) {
          failure = r.error;
          throw new Error(r.error);
        }
      },
      editing ? 'A guardar alterações do fornecedor...' : 'A cadastrar fornecedor...'
    );

    if (result.ok) setIsModalOpen(false);
    else setFormError(failure || result.error || 'Não foi possível guardar o fornecedor.');
  };

  const handleDelete = async () => {
    if (!deleting) return;
    const target = deleting;
    setDeleting(null);
    await run(() => {
      dbService.deleteSupplier(target.id);
    }, `A eliminar fornecedor ${target.name}...`);
  };

  return (
    <div className="flex flex-col w-full gap-6 pb-12">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <span className="text-[11px] font-bold uppercase tracking-widest text-slate-500">LOGÍSTICA</span>
            <span className="w-1.5 h-1.5 rounded-full bg-[#0b1f3a]" />
            <span className="text-xs font-semibold text-[#0b1f3a]">CADASTRO DE FORNECEDORES</span>
          </div>
          <h1 className="font-headline text-2xl lg:text-3xl font-extrabold text-[#0b1f3a] tracking-tight">
            GESTÃO DE FORNECEDORES
          </h1>
          <p className="text-xs text-slate-500 mt-0.5">
            Empresas e prestadores de serviço que abastecem a escola com seus serviços e meios
          </p>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          {acl.can('fornecedores.manage') && (
            <button
              onClick={openAdd}
              className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-[#0b1f3a] hover:bg-[#7a0c0c] active:scale-[0.98] transition-all duration-200 text-white font-bold text-xs shadow-sm shrink-0"
            >
              <span className="material-symbols-outlined text-[18px]">add_business</span>
              <span>CADASTRAR</span>
            </button>
          )}
        </div>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        {[
          { label: 'Fornecedores', value: suppliers.length, icon: 'local_shipping' },
          { label: 'Ativos', value: activeCount, icon: 'check_circle' },
          { label: 'Inativos', value: suppliers.length - activeCount, icon: 'pause_circle' }
        ].map((k) => (
          <div key={k.label} className="bg-white border border-slate-200 rounded-2xl p-4 flex items-center gap-3">
            <div className="w-10 h-10 bg-slate-100 text-[#0b1f3a] flex items-center justify-center rounded-lg">
              <span className="material-symbols-outlined text-[22px]">{k.icon}</span>
            </div>
            <div>
              <div className="font-mono text-xl font-extrabold text-[#0b1f3a] leading-none">{k.value}</div>
              <div className="text-[11px] text-slate-500 font-semibold mt-1">{k.label}</div>
            </div>
          </div>
        ))}
      </div>

      {/* Filter Bar */}
      <div className="bg-white p-4 rounded-2xl border border-slate-200 shadow-xs flex flex-col md:flex-row items-center justify-between gap-3">
        <div className="relative flex items-center w-full md:w-96 border border-slate-400/30 bg-slate-50/60 focus-within:border-slate-400/70 focus-within:bg-white transition-colors">
          <span className="material-symbols-outlined ml-3 text-slate-400 text-[18px] shrink-0">search</span>
          <input
            type="text"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            placeholder="Pesquisar por nome, código, NIF, contacto ou telefone..."
            className="w-full h-9 pl-2 pr-3 bg-transparent border-0 outline-none focus:ring-0 text-xs text-slate-800 placeholder:text-slate-400"
          />
        </div>

        <div className="flex flex-wrap items-center gap-3 w-full md:w-auto">
          <select
            value={categoryFilter}
            onChange={(e) => setCategoryFilter(e.target.value as 'all' | SupplierCategory)}
            className="h-9 px-3 rounded-lg bg-slate-100 text-xs font-semibold text-slate-700 border-0 focus:ring-1 focus:ring-[#0b1f3a]"
          >
            <option value="all">Todas as Categorias</option>
            {Object.entries(SUPPLIER_CATEGORY_LABELS).map(([key, label]) => (
              <option key={key} value={key}>
                {label}
              </option>
            ))}
          </select>
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value as 'all' | 'ativo' | 'inativo')}
            className="h-9 px-3 rounded-lg bg-slate-100 text-xs font-semibold text-slate-700 border-0 focus:ring-1 focus:ring-[#0b1f3a]"
          >
            <option value="all">Todos os Estados</option>
            <option value="ativo">Ativos</option>
            <option value="inativo">Inativos</option>
          </select>
          <span className="text-xs text-slate-400 font-mono">
            {filtered.length} {filtered.length === 1 ? 'fornecedor' : 'fornecedores'}
          </span>
        </div>
      </div>

      {/* Tabela */}
      <div className="bg-white rounded-2xl border border-slate-200 shadow-xs overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead>
              <tr className="bg-[#0b1f3a] text-white font-bold uppercase text-[10px] tracking-wider border-b border-slate-800">
                <th className="py-3.5 px-4 text-white">Fornecedor & Código</th>
                <th className="py-3.5 px-3 text-white">Categoria</th>
                <th className="py-3.5 px-3 text-white">Contacto</th>
                <th className="py-3.5 px-3 text-white">Localização</th>
                <th className="py-3.5 px-3 text-white">Estado</th>
                <th className="py-3.5 px-4 text-right text-white">Ações</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {filtered.length === 0 ? (
                <tr>
                  <td colSpan={6} className="py-12 text-center text-slate-400 text-xs">
                    Nenhum fornecedor cadastrado ou encontrado. Clique em "CADASTRAR" para adicionar o primeiro.
                  </td>
                </tr>
              ) : (
                visibleFiltered.map((s) => (
                  <tr key={s.id} className="hover:bg-slate-50 transition-colors">
                    <td className="py-3.5 px-4">
                      <div className="font-bold text-[#0b1f3a]">{s.name}</div>
                      <div className="flex items-center gap-2 mt-0.5 text-[11px] text-slate-500 font-mono">
                        <span>{s.code}</span>
                        {s.nif && <span>· NIF {s.nif}</span>}
                      </div>
                    </td>
                    <td className="py-3.5 px-3 text-slate-700">{SUPPLIER_CATEGORY_LABELS[s.category]}</td>
                    <td className="py-3.5 px-3">
                      {s.contactPerson && <div className="text-slate-800 font-semibold">{s.contactPerson}</div>}
                      {s.phone && (
                        <a
                          href={`tel:${s.phone}`}
                          className="text-slate-700 hover:text-[#0b1f3a] font-mono text-[11px] flex items-center gap-1"
                        >
                          <span className="material-symbols-outlined text-[14px]">call</span>
                          <span>{s.phone}</span>
                        </a>
                      )}
                      {s.email && (
                        <span className="text-[10px] text-slate-400 block truncate max-w-[180px]">{s.email}</span>
                      )}
                      {!s.contactPerson && !s.phone && !s.email && <span className="text-slate-400">—</span>}
                    </td>
                    <td className="py-3.5 px-3 text-slate-600">
                      {s.municipality || s.province ? (
                        <>
                          <div>{s.municipality || s.province}</div>
                          {s.municipality && s.province && (
                            <span className="text-[11px] text-slate-400">{s.province}</span>
                          )}
                        </>
                      ) : (
                        <span className="text-slate-400">—</span>
                      )}
                    </td>
                    <td className="py-3.5 px-3">
                      <span
                        className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                          s.status === 'ativo' ? 'bg-emerald-100 text-emerald-800' : 'bg-slate-200 text-slate-600'
                        }`}
                      >
                        {s.status === 'ativo' ? 'Ativo' : 'Inativo'}
                      </span>
                    </td>
                    <td className="py-3.5 px-4 text-right">
                      <div className="flex items-center justify-end gap-1">
                        <button
                          onClick={() => setViewing(s)}
                          className="p-1.5 rounded-lg text-slate-500 hover:text-[#0b1f3a] hover:bg-slate-100 active:scale-[0.98] transition-all cursor-pointer"
                          title="Ver ficha do fornecedor"
                        >
                          <span className="material-symbols-outlined text-[18px]">visibility</span>
                        </button>
                        {acl.can('fornecedores.manage') && (
                          <>
                            <button
                              onClick={() => openEdit(s)}
                              className="p-1.5 rounded-lg text-slate-500 hover:text-blue-700 hover:bg-slate-100 active:scale-[0.98] transition-all cursor-pointer"
                              title="Editar fornecedor"
                            >
                              <span className="material-symbols-outlined text-[18px]">edit</span>
                            </button>
                            <button
                              onClick={() => setDeleting(s)}
                              className="p-1.5 rounded-lg text-slate-400 hover:text-red-700 hover:bg-red-50 active:scale-[0.98] transition-all cursor-pointer"
                              title="Eliminar fornecedor"
                            >
                              <span className="material-symbols-outlined text-[18px]">delete</span>
                            </button>
                          </>
                        )}
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
          <TablePagination total={filtered.length} page={pgFiltered} onPageChange={setPgFiltered} />
        </div>
      </div>

      {/* Modal: Ficha (leitura) */}
      {viewing && (
        <div
          className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-3 sm:p-6"
          onClick={(e) => {
            if (e.target === e.currentTarget) setViewing(null);
          }}
        >
          <div className="bg-white max-w-xl w-full shadow-2xl border border-slate-400 overflow-hidden flex flex-col max-h-[94vh]">
            <FormModalHeader
              title={viewing.name}
              subtitle={`${viewing.code} · ${SUPPLIER_CATEGORY_LABELS[viewing.category]}`}
              icon="local_shipping"
              badge={viewing.status === 'ativo' ? 'Ativo' : 'Inativo'}
              onClose={() => setViewing(null)}
            />
            <div className="flex-1 overflow-y-auto p-6 text-xs space-y-4">
              {(
                [
                  ['NIF', viewing.nif],
                  ['Pessoa de Contacto', viewing.contactPerson],
                  ['Telefone', viewing.phone],
                  ['E-mail', viewing.email],
                  ['Província', viewing.province],
                  ['Município', viewing.municipality],
                  ['Morada', viewing.address],
                  ['Condições de Pagamento', viewing.paymentTerms],
                  ['Banco', viewing.bankName],
                  ['IBAN', viewing.iban]
                ] as Array<[string, string | undefined]>
              )
                .filter(([, v]) => !!v)
                .map(([k, v]) => (
                  <div key={k} className="flex flex-col sm:flex-row sm:gap-4 border-b border-slate-100 pb-2">
                    <span className="sm:w-44 shrink-0 uppercase font-bold text-[10px] tracking-wide text-slate-500">
                      {k}
                    </span>
                    <span className={`text-slate-800 break-words ${k === 'IBAN' || k === 'NIF' ? 'font-mono' : ''}`}>{v}</span>
                  </div>
                ))}
              {viewing.notes && (
                <div className="border-t border-slate-100 pt-3">
                  <span className="block text-[10px] uppercase font-bold text-slate-500 mb-1">Observações</span>
                  <p className="text-slate-700 whitespace-pre-wrap break-words">{viewing.notes}</p>
                </div>
              )}
              <p className="text-[10px] text-slate-400">
                Registado em {new Date(viewing.createdAt).toLocaleDateString('pt-PT')}
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Modal: Cadastrar / Editar */}
      {isModalOpen && (
        <div
          className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-3 sm:p-6"
          onClick={(e) => {
            if (e.target === e.currentTarget) setIsModalOpen(false);
          }}
        >
          <div className="bg-white max-w-2xl w-full shadow-2xl border border-slate-400 overflow-hidden flex flex-col max-h-[94vh]">
            <FormModalHeader
              title={editing ? 'Editar Fornecedor' : 'Novo Fornecedor'}
              subtitle={editing ? editing.code : 'Logística · Fornecedores da instituição'}
              icon="add_business"
              onClose={() => setIsModalOpen(false)}
            />
            <form onSubmit={handleSubmit} className="flex-1 overflow-y-auto p-6 text-xs space-y-5">
              <div className="space-y-3">
                <SectionTitle icon="badge">Identificação</SectionTitle>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div className="sm:col-span-2">
                    <label className={labelCls}>Nome / Razão Social *</label>
                    <input
                      type="text"
                      required
                      autoFocus
                      value={form.name}
                      onChange={(e) => setForm({ ...form, name: e.target.value })}
                      className={inputCls}
                    />
                  </div>
                  <div>
                    <label className={labelCls}>NIF</label>
                    <input
                      type="text"
                      value={form.nif || ''}
                      onChange={(e) => setForm({ ...form, nif: e.target.value })}
                      className={`${inputCls} font-mono`}
                    />
                  </div>
                  <div>
                    <label className={labelCls}>Categoria *</label>
                    <select
                      value={form.category}
                      onChange={(e) => setForm({ ...form, category: e.target.value as SupplierCategory })}
                      className={inputCls}
                    >
                      {Object.entries(SUPPLIER_CATEGORY_LABELS).map(([key, label]) => (
                        <option key={key} value={key}>
                          {label}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
              </div>

              <div className="space-y-3">
                <SectionTitle icon="call">Contactos & Localização</SectionTitle>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label className={labelCls}>Pessoa de Contacto</label>
                    <input
                      type="text"
                      value={form.contactPerson || ''}
                      onChange={(e) => setForm({ ...form, contactPerson: e.target.value })}
                      className={inputCls}
                    />
                  </div>
                  <div>
                    <label className={labelCls}>Telefone</label>
                    <input
                      type="text"
                      value={form.phone || ''}
                      onChange={(e) => setForm({ ...form, phone: e.target.value })}
                      placeholder="+244 9XX XXX XXX"
                      className={`${inputCls} font-mono`}
                    />
                  </div>
                  <div className="sm:col-span-2">
                    <label className={labelCls}>E-mail</label>
                    <input
                      type="email"
                      value={form.email || ''}
                      onChange={(e) => setForm({ ...form, email: e.target.value })}
                      className={inputCls}
                    />
                  </div>
                  <SearchableSelect
                    label="Província"
                    options={provinceOptions}
                    value={form.province || ''}
                    onChange={(v) => setForm({ ...form, province: v, municipality: '' })}
                    placeholder="Selecione a província"
                  />
                  <SearchableSelect
                    label="Município"
                    options={municipalityOptions}
                    value={form.municipality || ''}
                    onChange={(v) => setForm({ ...form, municipality: v })}
                    placeholder="Selecione o município"
                    disabled={!form.province}
                  />
                  <div className="sm:col-span-2">
                    <label className={labelCls}>Morada</label>
                    <input
                      type="text"
                      value={form.address || ''}
                      onChange={(e) => setForm({ ...form, address: e.target.value })}
                      placeholder="Bairro, rua, edifício..."
                      className={inputCls}
                    />
                  </div>
                </div>
              </div>

              <div className="space-y-3">
                <SectionTitle icon="account_balance">Condições Comerciais</SectionTitle>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div className="sm:col-span-2">
                    <label className={labelCls}>Condições de Pagamento</label>
                    <input
                      type="text"
                      value={form.paymentTerms || ''}
                      onChange={(e) => setForm({ ...form, paymentTerms: e.target.value })}
                      placeholder="Ex: 30 dias após fatura, pronto pagamento"
                      className={inputCls}
                    />
                  </div>
                  <div>
                    <label className={labelCls}>Banco</label>
                    <input
                      type="text"
                      value={form.bankName || ''}
                      onChange={(e) => setForm({ ...form, bankName: e.target.value })}
                      className={inputCls}
                    />
                  </div>
                  <div>
                    <label className={labelCls}>IBAN</label>
                    <input
                      type="text"
                      value={form.iban || ''}
                      onChange={(e) => setForm({ ...form, iban: e.target.value })}
                      placeholder="AO06 ..."
                      className={`${inputCls} font-mono`}
                    />
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <div className="sm:col-span-2">
                  <label className={labelCls}>Observações</label>
                  <textarea
                    rows={2}
                    value={form.notes || ''}
                    onChange={(e) => setForm({ ...form, notes: e.target.value })}
                    className="w-full px-3 py-2 bg-white border border-slate-300 text-slate-800 focus:border-[#0b1f3a] focus:outline-none text-xs resize-none"
                  />
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
            <FormModalHeader title="Eliminar Fornecedor" icon="warning" onClose={() => setDeleting(null)} />
            <div className="p-6">
              <h3 className="font-headline text-lg font-bold text-slate-900 text-center">
                Eliminar "{deleting.name}"?
              </h3>
              <p className="text-xs text-slate-600 text-center mt-2 leading-relaxed">
                O fornecedor <span className="font-mono font-bold">{deleting.code}</span> será removido da base de
                dados. Se apenas deixou de trabalhar com ele, prefira marcá-lo como Inativo.
              </p>
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
                className="px-5 py-2.5 bg-[#b91c1c] hover:bg-[#7a0c0c] text-white font-bold text-xs flex items-center gap-2 cursor-pointer transition-colors border-none"
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
