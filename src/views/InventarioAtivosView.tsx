import React, { useMemo, useState } from 'react';
import { Asset, AssetCategory, AssetCondition, AssetStatus, SchoolDatabase, UserRole } from '../types';
import { dbService } from '../services/db';
import { useAccessControl } from '../hooks/useAccessControl';
import { SearchableSelect } from '../components/SearchableSelect';
import {
  LogisticsBadge,
  LogisticsDeleteModal,
  LogisticsFormFooter,
  LogisticsIconButton,
  LogisticsKpiGrid,
  LogisticsModal,
  LogisticsPageHeader,
  LogisticsPrimaryButton,
  LogisticsSearchBar,
  LogisticsSectionTitle,
  LogisticsTableCard,
  cleanText,
  formatDatePt,
  formatKz,
  logisticsInputCls as inputCls,
  logisticsLabelCls as labelCls,
  logisticsSelectCls,
  logisticsThCls,
  runGlobalOperation
} from '../components/LogisticsUi';
import { TablePagination, usePagedList } from '../components/TablePagination';

interface InventarioAtivosViewProps {
  db: SchoolDatabase;
  currentUserRole: UserRole;
}

const RULE = 'patrimonio.ativos.manage';

export const ASSET_CATEGORY_LABELS: Record<AssetCategory, string> = {
  mobiliario: 'Mobiliário',
  informatica: 'Informática',
  eletrodomesticos: 'Eletrodomésticos',
  equipamento_didatico: 'Equipamento Didático',
  equipamento_desportivo: 'Equipamento Desportivo',
  equipamento_laboratorial: 'Equipamento Laboratorial',
  outro: 'Outro'
};

export const ASSET_CONDITION_LABELS: Record<AssetCondition, string> = {
  novo: 'Novo',
  bom: 'Bom',
  razoavel: 'Razoável',
  mau: 'Mau'
};

export const ASSET_STATUS_LABELS: Record<AssetStatus, string> = {
  ativo: 'Em uso',
  em_manutencao: 'Em manutenção',
  emprestado: 'Emprestado',
  abatido: 'Abatido'
};

const statusTone = (s: AssetStatus): 'green' | 'amber' | 'blue' | 'slate' =>
  s === 'ativo' ? 'green' : s === 'em_manutencao' ? 'amber' : s === 'emprestado' ? 'blue' : 'slate';

const conditionTone = (c: AssetCondition): 'green' | 'blue' | 'amber' | 'red' =>
  c === 'novo' ? 'green' : c === 'bom' ? 'blue' : c === 'razoavel' ? 'amber' : 'red';

type AssetForm = Omit<Asset, 'id' | 'code' | 'createdAt' | 'updatedAt' | 'supplierName'>;

const emptyForm = (): AssetForm => ({
  name: '',
  category: 'mobiliario',
  categoryOtherDescricao: '',
  description: '',
  location: '',
  department: '',
  serialNumber: '',
  supplierId: '',
  acquisitionDate: '',
  acquisitionValueKz: undefined,
  condition: 'novo',
  status: 'ativo',
  responsibleName: '',
  notes: ''
});

export const InventarioAtivosView: React.FC<InventarioAtivosViewProps> = ({ db, currentUserRole }) => {
  const acl = useAccessControl(currentUserRole);

  const [searchTerm, setSearchTerm] = useState('');
  const [categoryFilter, setCategoryFilter] = useState<'all' | AssetCategory>('all');
  const [statusFilter, setStatusFilter] = useState<'all' | AssetStatus>('all');
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editing, setEditing] = useState<Asset | null>(null);
  const [form, setForm] = useState<AssetForm>(emptyForm());
  const [valueInput, setValueInput] = useState('');
  const [formError, setFormError] = useState('');
  const [deleting, setDeleting] = useState<Asset | null>(null);
  const [viewing, setViewing] = useState<Asset | null>(null);

  const assets = db.assets || [];
  const suppliers = db.suppliers || [];

  const filtered = useMemo(() => {
    const q = searchTerm.trim().toLowerCase();
    return assets
      .filter((a) => categoryFilter === 'all' || a.category === categoryFilter)
      .filter((a) => statusFilter === 'all' || a.status === statusFilter)
      .filter(
        (a) =>
          !q ||
          a.name.toLowerCase().includes(q) ||
          a.code.toLowerCase().includes(q) ||
          (a.serialNumber || '').toLowerCase().includes(q) ||
          (a.location || '').toLowerCase().includes(q) ||
          (a.department || '').toLowerCase().includes(q) ||
          (a.responsibleName || '').toLowerCase().includes(q)
      )
      .sort((a, b) => a.name.localeCompare(b.name, 'pt'));
  }, [assets, searchTerm, categoryFilter, statusFilter]);
  const { page: pgFiltered, setPage: setPgFiltered, pageItems: visibleFiltered } = usePagedList(filtered, [filtered.length]);

  const kpis = useMemo(() => {
    const live = assets.filter((a) => a.status !== 'abatido');
    return {
      total: assets.length,
      value: live.reduce((sum, a) => sum + (a.acquisitionValueKz || 0), 0),
      maintenance: assets.filter((a) => a.status === 'em_manutencao').length,
      retired: assets.filter((a) => a.status === 'abatido').length
    };
  }, [assets]);

  const supplierOptions = useMemo(
    () => suppliers.map((s) => ({ value: s.id, label: `${s.name} (${s.code})` })),
    [suppliers]
  );
  const departmentOptions = useMemo(
    () => (db.departments || []).map((d: any) => ({ value: d.name, label: d.name })),
    [db.departments]
  );

  const run = async (action: () => void, loadingMessage: string): Promise<{ ok: boolean; error?: string }> => {
    try {
      await runGlobalOperation(action, { loadingMessage, requiredRule: RULE, userRole: currentUserRole });
      return { ok: true };
    } catch (err: any) {
      return { ok: false, error: err?.message };
    }
  };

  const openAdd = () => {
    setEditing(null);
    setForm(emptyForm());
    setValueInput('');
    setFormError('');
    setIsModalOpen(true);
  };

  const openEdit = (a: Asset) => {
    setEditing(a);
    setForm({
      name: a.name,
      category: a.category,
      categoryOtherDescricao: a.categoryOtherDescricao || '',
      description: a.description || '',
      location: a.location || '',
      department: a.department || '',
      serialNumber: a.serialNumber || '',
      supplierId: a.supplierId || '',
      acquisitionDate: a.acquisitionDate || '',
      acquisitionValueKz: a.acquisitionValueKz,
      condition: a.condition,
      status: a.status,
      responsibleName: a.responsibleName || '',
      notes: a.notes || ''
    });
    setValueInput(a.acquisitionValueKz !== undefined ? String(a.acquisitionValueKz) : '');
    setFormError('');
    setIsModalOpen(true);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!acl.can(RULE)) {
      acl.guard(RULE, () => undefined);
      return;
    }
    if (!form.name.trim()) {
      setFormError('Indique o nome do ativo.');
      return;
    }
    if (form.category === 'outro' && !(form.categoryOtherDescricao || '').trim()) {
      setFormError('Descreva a categoria quando selecionar "Outro".');
      return;
    }
    const parsedValue = valueInput.trim() === '' ? undefined : Number(valueInput.replace(',', '.'));
    if (parsedValue !== undefined && (!Number.isFinite(parsedValue) || parsedValue < 0)) {
      setFormError('O valor de aquisição tem de ser um número igual ou superior a zero.');
      return;
    }

    const payload: AssetForm = {
      ...form,
      name: form.name.trim(),
      categoryOtherDescricao: form.category === 'outro' ? cleanText(form.categoryOtherDescricao) : undefined,
      description: cleanText(form.description),
      location: cleanText(form.location),
      department: cleanText(form.department),
      serialNumber: cleanText(form.serialNumber),
      supplierId: cleanText(form.supplierId),
      acquisitionDate: cleanText(form.acquisitionDate),
      acquisitionValueKz: parsedValue,
      responsibleName: cleanText(form.responsibleName),
      notes: cleanText(form.notes)
    };

    let failure = '';
    const result = await run(
      () => {
        const r = editing ? dbService.updateAsset(editing.id, payload) : dbService.addAsset(payload);
        if (!r.success) {
          failure = r.error || '';
          throw new Error(r.error);
        }
      },
      editing ? 'A guardar alterações do ativo...' : 'A registar ativo...'
    );

    if (result.ok) setIsModalOpen(false);
    else setFormError(failure || result.error || 'Não foi possível guardar o ativo.');
  };

  const handleDelete = async () => {
    if (!deleting) return;
    const target = deleting;
    setDeleting(null);
    await run(() => {
      dbService.deleteAsset(target.id);
    }, `A eliminar ativo ${target.name}...`);
  };

  const exportCsv = () => {
    const esc = (v: unknown) => `"${String(v ?? '').replace(/"/g, '""')}"`;
    const header = ['Código', 'Nome', 'Categoria', 'Localização', 'Departamento', 'Nº Série', 'Valor (Kz)', 'Estado de Conservação', 'Situação', 'Responsável'];
    const rows = filtered.map((a) => [
      a.code,
      a.name,
      a.category === 'outro' && a.categoryOtherDescricao ? a.categoryOtherDescricao : ASSET_CATEGORY_LABELS[a.category],
      a.location,
      a.department,
      a.serialNumber,
      a.acquisitionValueKz,
      ASSET_CONDITION_LABELS[a.condition],
      ASSET_STATUS_LABELS[a.status],
      a.responsibleName
    ]);
    const csv = '\uFEFF' + [header, ...rows].map((r) => r.map(esc).join(';')).join('\r\n');
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = `inventario-ativos-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const categoryLabel = (a: Asset) =>
    a.category === 'outro' && a.categoryOtherDescricao ? a.categoryOtherDescricao : ASSET_CATEGORY_LABELS[a.category];

  return (
    <div className="flex flex-col w-full gap-6 pb-12">
      <LogisticsPageHeader
        subsection="REGISTO DE ATIVOS"
        title="INVENTÁRIOS DE ATIVOS"
        description="Património da escola: mobiliário, informática, equipamentos e outros bens, com localização, responsável, valor e estado de conservação."
        actions={
          <>
            <LogisticsPrimaryButton icon="download" label="EXPORTAR CSV" onClick={exportCsv} variant="secondary" />
            {acl.can(RULE) && <LogisticsPrimaryButton icon="add_box" label="REGISTAR ATIVO" onClick={openAdd} />}
          </>
        }
      />

      <LogisticsKpiGrid
        items={[
          { label: 'Ativos registados', value: kpis.total, icon: 'inventory_2' },
          { label: 'Valor patrimonial', value: formatKz(kpis.value), icon: 'payments' },
          { label: 'Em manutenção', value: kpis.maintenance, icon: 'build', tone: kpis.maintenance ? 'warn' : 'default' },
          { label: 'Abatidos', value: kpis.retired, icon: 'archive' }
        ]}
      />

      <LogisticsSearchBar
        value={searchTerm}
        onChange={setSearchTerm}
        placeholder="Pesquisar por nome, código, nº de série, local ou responsável..."
      >
        <select
          value={categoryFilter}
          onChange={(e) => setCategoryFilter(e.target.value as 'all' | AssetCategory)}
          className={logisticsSelectCls}
        >
          <option value="all">Todas as Categorias</option>
          {Object.entries(ASSET_CATEGORY_LABELS).map(([k, l]) => (
            <option key={k} value={k}>
              {l}
            </option>
          ))}
        </select>
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value as 'all' | AssetStatus)}
          className={logisticsSelectCls}
        >
          <option value="all">Todas as Situações</option>
          {Object.entries(ASSET_STATUS_LABELS).map(([k, l]) => (
            <option key={k} value={k}>
              {l}
            </option>
          ))}
        </select>
        <span className="text-xs text-slate-400 font-mono">
          {filtered.length} {filtered.length === 1 ? 'ativo' : 'ativos'}
        </span>
      </LogisticsSearchBar>

      <LogisticsTableCard>
        <table className="w-full text-left text-xs">
          <thead>
            <tr className="bg-[#0b1f3a] text-white font-bold uppercase text-[10px] tracking-wider border-b border-slate-800">
              <th className="py-3.5 px-4 text-white">Ativo & Código</th>
              <th className={logisticsThCls}>Categoria</th>
              <th className={logisticsThCls}>Localização</th>
              <th className={logisticsThCls}>Valor</th>
              <th className={logisticsThCls}>Conservação</th>
              <th className={logisticsThCls}>Situação</th>
              <th className="py-3.5 px-4 text-right text-white">Ações</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {filtered.length === 0 ? (
              <tr>
                <td colSpan={7} className="py-12 text-center text-slate-400 text-xs">
                  Nenhum ativo registado ou encontrado. Clique em "REGISTAR ATIVO" para adicionar o primeiro.
                </td>
              </tr>
            ) : (
              visibleFiltered.map((a) => (
                <tr key={a.id} className={`hover:bg-slate-50 transition-colors ${a.status === 'abatido' ? 'opacity-60' : ''}`}>
                  <td className="py-3.5 px-4">
                    <div className="font-bold text-[#0b1f3a]">{a.name}</div>
                    <div className="flex items-center gap-2 mt-0.5 text-[11px] text-slate-500 font-mono">
                      <span>{a.code}</span>
                      {a.serialNumber && <span>· S/N {a.serialNumber}</span>}
                    </div>
                  </td>
                  <td className="py-3.5 px-3 text-slate-700">{categoryLabel(a)}</td>
                  <td className="py-3.5 px-3 text-slate-600">
                    {a.location || a.department ? (
                      <>
                        <div>{a.location || a.department}</div>
                        {a.location && a.department && <span className="text-[11px] text-slate-400">{a.department}</span>}
                      </>
                    ) : (
                      <span className="text-slate-400">—</span>
                    )}
                  </td>
                  <td className="py-3.5 px-3 font-mono text-slate-700 whitespace-nowrap">{formatKz(a.acquisitionValueKz)}</td>
                  <td className="py-3.5 px-3">
                    <LogisticsBadge tone={conditionTone(a.condition)}>{ASSET_CONDITION_LABELS[a.condition]}</LogisticsBadge>
                  </td>
                  <td className="py-3.5 px-3">
                    <LogisticsBadge tone={statusTone(a.status)}>{ASSET_STATUS_LABELS[a.status]}</LogisticsBadge>
                  </td>
                  <td className="py-3.5 px-4 text-right">
                    <div className="flex items-center justify-end gap-1">
                      <LogisticsIconButton icon="visibility" title="Ver ficha do ativo" onClick={() => setViewing(a)} />
                      {acl.can(RULE) && (
                        <>
                          <LogisticsIconButton icon="edit" title="Editar ativo" hover="blue" onClick={() => openEdit(a)} />
                          <LogisticsIconButton icon="delete" title="Eliminar ativo" hover="red" onClick={() => setDeleting(a)} />
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
      </LogisticsTableCard>

      {viewing && (
        <LogisticsModal
          title={viewing.name}
          subtitle={`${viewing.code} · ${categoryLabel(viewing)}`}
          icon="inventory_2"
          badge={ASSET_STATUS_LABELS[viewing.status]}
          onClose={() => setViewing(null)}
          widthCls="max-w-xl"
        >
          <div className="flex-1 overflow-y-auto p-6 text-xs space-y-4">
            {(
              [
                ['Localização', viewing.location],
                ['Departamento', viewing.department],
                ['Responsável', viewing.responsibleName],
                ['Nº de Série', viewing.serialNumber],
                ['Fornecedor', viewing.supplierName],
                ['Data de Aquisição', viewing.acquisitionDate ? formatDatePt(viewing.acquisitionDate) : undefined],
                ['Valor de Aquisição', viewing.acquisitionValueKz !== undefined ? formatKz(viewing.acquisitionValueKz) : undefined],
                ['Estado de Conservação', ASSET_CONDITION_LABELS[viewing.condition]]
              ] as Array<[string, string | undefined]>
            )
              .filter(([, v]) => !!v)
              .map(([k, v]) => (
                <div key={k} className="flex flex-col sm:flex-row sm:gap-4 border-b border-slate-100 pb-2">
                  <span className="sm:w-44 shrink-0 uppercase font-bold text-[10px] tracking-wide text-slate-500">{k}</span>
                  <span className={`text-slate-800 break-words ${k === 'Nº de Série' ? 'font-mono' : ''}`}>{v}</span>
                </div>
              ))}
            {viewing.description && (
              <div className="border-t border-slate-100 pt-3">
                <span className="block text-[10px] uppercase font-bold text-slate-500 mb-1">Descrição</span>
                <p className="text-slate-700 whitespace-pre-wrap break-words">{viewing.description}</p>
              </div>
            )}
            {viewing.notes && (
              <div className="border-t border-slate-100 pt-3">
                <span className="block text-[10px] uppercase font-bold text-slate-500 mb-1">Observações</span>
                <p className="text-slate-700 whitespace-pre-wrap break-words">{viewing.notes}</p>
              </div>
            )}
            <p className="text-[10px] text-slate-400">Registado em {formatDatePt(viewing.createdAt)}</p>
          </div>
        </LogisticsModal>
      )}

      {isModalOpen && (
        <LogisticsModal
          title={editing ? 'Editar Ativo' : 'Novo Ativo'}
          subtitle={editing ? editing.code : 'Logística · Inventário de Ativos'}
          icon="add_box"
          onClose={() => setIsModalOpen(false)}
        >
          <form onSubmit={handleSubmit} className="flex-1 overflow-y-auto p-6 text-xs space-y-5">
            <div className="space-y-3">
              <LogisticsSectionTitle icon="badge">Identificação</LogisticsSectionTitle>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="sm:col-span-2">
                  <label className={labelCls}>Nome do Ativo *</label>
                  <input
                    type="text"
                    required
                    autoFocus
                    value={form.name}
                    onChange={(e) => setForm({ ...form, name: e.target.value })}
                    placeholder="Ex.: Projetor Epson EB-X49"
                    className={inputCls}
                  />
                </div>
                <div>
                  <label className={labelCls}>Categoria *</label>
                  <select
                    value={form.category}
                    onChange={(e) => setForm({ ...form, category: e.target.value as AssetCategory })}
                    className={inputCls}
                  >
                    {Object.entries(ASSET_CATEGORY_LABELS).map(([k, l]) => (
                      <option key={k} value={k}>
                        {l}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className={labelCls}>Nº de Série</label>
                  <input
                    type="text"
                    value={form.serialNumber || ''}
                    onChange={(e) => setForm({ ...form, serialNumber: e.target.value })}
                    className={`${inputCls} font-mono`}
                  />
                </div>
                {form.category === 'outro' && (
                  <div className="sm:col-span-2">
                    <label className={labelCls}>Descreva a Categoria *</label>
                    <input
                      type="text"
                      value={form.categoryOtherDescricao || ''}
                      onChange={(e) => setForm({ ...form, categoryOtherDescricao: e.target.value })}
                      className={inputCls}
                    />
                  </div>
                )}
                <div className="sm:col-span-2">
                  <label className={labelCls}>Descrição</label>
                  <input
                    type="text"
                    value={form.description || ''}
                    onChange={(e) => setForm({ ...form, description: e.target.value })}
                    className={inputCls}
                  />
                </div>
              </div>
            </div>

            <div className="space-y-3">
              <LogisticsSectionTitle icon="location_on">Localização & Responsável</LogisticsSectionTitle>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className={labelCls}>Localização (sala / edifício)</label>
                  <input
                    type="text"
                    value={form.location || ''}
                    onChange={(e) => setForm({ ...form, location: e.target.value })}
                    className={inputCls}
                  />
                </div>
                <div>
                  <SearchableSelect
                    label="Departamento"
                    options={departmentOptions}
                    value={form.department || ''}
                    onChange={(v) => setForm({ ...form, department: v })}
                    allowCustom
                    placeholder="Selecione ou escreva..."
                  />
                </div>
                <div className="sm:col-span-2">
                  <label className={labelCls}>Responsável</label>
                  <input
                    type="text"
                    value={form.responsibleName || ''}
                    onChange={(e) => setForm({ ...form, responsibleName: e.target.value })}
                    className={inputCls}
                  />
                </div>
              </div>
            </div>

            <div className="space-y-3">
              <LogisticsSectionTitle icon="receipt_long">Aquisição</LogisticsSectionTitle>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="sm:col-span-2">
                  <SearchableSelect
                    label="Fornecedor"
                    options={supplierOptions}
                    value={form.supplierId || ''}
                    onChange={(v) => setForm({ ...form, supplierId: v })}
                    placeholder="Selecione um fornecedor (opcional)..."
                    emptyMessage="Nenhum fornecedor cadastrado"
                  />
                </div>
                <div>
                  <label className={labelCls}>Data de Aquisição</label>
                  <input
                    type="date"
                    value={form.acquisitionDate || ''}
                    max={new Date().toISOString().slice(0, 10)}
                    onChange={(e) => setForm({ ...form, acquisitionDate: e.target.value })}
                    className={inputCls}
                  />
                </div>
                <div>
                  <label className={labelCls}>Valor de Aquisição (Kz)</label>
                  <input
                    type="text"
                    inputMode="decimal"
                    value={valueInput}
                    onChange={(e) => setValueInput(e.target.value)}
                    placeholder="0"
                    className={`${inputCls} font-mono`}
                  />
                </div>
              </div>
            </div>

            <div className="space-y-3">
              <LogisticsSectionTitle icon="fact_check">Estado</LogisticsSectionTitle>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className={labelCls}>Estado de Conservação</label>
                  <select
                    value={form.condition}
                    onChange={(e) => setForm({ ...form, condition: e.target.value as AssetCondition })}
                    className={inputCls}
                  >
                    {Object.entries(ASSET_CONDITION_LABELS).map(([k, l]) => (
                      <option key={k} value={k}>
                        {l}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className={labelCls}>Situação</label>
                  <select
                    value={form.status}
                    onChange={(e) => setForm({ ...form, status: e.target.value as AssetStatus })}
                    className={inputCls}
                  >
                    {Object.entries(ASSET_STATUS_LABELS).map(([k, l]) => (
                      <option key={k} value={k}>
                        {l}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="sm:col-span-2">
                  <label className={labelCls}>Observações</label>
                  <textarea
                    rows={2}
                    value={form.notes || ''}
                    onChange={(e) => setForm({ ...form, notes: e.target.value })}
                    className="w-full px-3 py-2 bg-white border border-slate-300 text-slate-800 focus:border-[#0b1f3a] focus:outline-none text-xs"
                  />
                </div>
              </div>
            </div>

            <LogisticsFormFooter
              error={formError}
              onCancel={() => setIsModalOpen(false)}
              submitLabel={editing ? 'Guardar Alterações' : 'Registar Ativo'}
            />
          </form>
        </LogisticsModal>
      )}

      {deleting && (
        <LogisticsDeleteModal
          title="Eliminar Ativo"
          name={deleting.name}
          code={deleting.code}
          extra="Se o bem deixou de existir mas quer manter o histórico, prefira marcá-lo como Abatido."
          onCancel={() => setDeleting(null)}
          onConfirm={handleDelete}
        />
      )}
    </div>
  );
};
