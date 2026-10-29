import React, { useMemo, useState } from 'react';
import { SchoolDatabase, StockItem, StockMovement, StockMovementType, StockUnit, UserRole } from '../types';
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
  logisticsInputCls as inputCls,
  logisticsLabelCls as labelCls,
  logisticsSelectCls,
  logisticsThCls,
  runGlobalOperation
} from '../components/LogisticsUi';
import { TablePagination, usePagedList } from '../components/TablePagination';

interface ControloEstoqueViewProps {
  db: SchoolDatabase;
  currentUserRole: UserRole;
}

const RULE = 'patrimonio.estoque.manage';

export const STOCK_UNIT_LABELS: Record<StockUnit, string> = {
  unidade: 'Unidade(s)',
  caixa: 'Caixa(s)',
  pacote: 'Pacote(s)',
  litro: 'Litro(s)',
  kg: 'Quilograma(s)',
  resma: 'Resma(s)',
  par: 'Par(es)',
  outro: 'Outro'
};

const unitLabel = (item: Pick<StockItem, 'unit' | 'unitOtherDescricao'>) =>
  item.unit === 'outro' && item.unitOtherDescricao ? item.unitOtherDescricao : STOCK_UNIT_LABELS[item.unit];

type StockLevel = 'zero' | 'baixo' | 'ok';
const levelOf = (i: StockItem): StockLevel =>
  i.currentQuantity <= 0 ? 'zero' : i.currentQuantity <= i.minQuantity ? 'baixo' : 'ok';

type ItemForm = {
  name: string;
  category: string;
  unit: StockUnit;
  unitOtherDescricao: string;
  currentQuantity: string;
  minQuantity: string;
  location: string;
  supplierId: string;
  notes: string;
};

const emptyItemForm = (): ItemForm => ({
  name: '',
  category: '',
  unit: 'unidade',
  unitOtherDescricao: '',
  currentQuantity: '0',
  minQuantity: '0',
  location: '',
  supplierId: '',
  notes: ''
});

type MovementForm = {
  itemId: string;
  type: StockMovementType;
  quantity: string;
  date: string;
  reason: string;
  relatedDocument: string;
};

const today = () => new Date().toISOString().slice(0, 10);

const parseQty = (v: string): number => Number(v.trim().replace(',', '.'));

export const ControloEstoqueView: React.FC<ControloEstoqueViewProps> = ({ db, currentUserRole }) => {
  const acl = useAccessControl(currentUserRole);

  const [tab, setTab] = useState<'itens' | 'movimentos'>('itens');
  const [searchTerm, setSearchTerm] = useState('');
  const [levelFilter, setLevelFilter] = useState<'all' | 'alerta'>('all');
  const [movementTypeFilter, setMovementTypeFilter] = useState<'all' | StockMovementType>('all');

  const [itemModalOpen, setItemModalOpen] = useState(false);
  const [editing, setEditing] = useState<StockItem | null>(null);
  const [itemForm, setItemForm] = useState<ItemForm>(emptyItemForm());
  const [itemError, setItemError] = useState('');
  const [deleting, setDeleting] = useState<StockItem | null>(null);

  const [movementModalOpen, setMovementModalOpen] = useState(false);
  const [movementForm, setMovementForm] = useState<MovementForm | null>(null);
  const [movementError, setMovementError] = useState('');

  const items = db.stockItems || [];
  const movements: StockMovement[] = db.stockMovements || [];
  const suppliers = db.suppliers || [];

  const supplierOptions = useMemo(
    () => suppliers.map((s) => ({ value: s.id, label: `${s.name} (${s.code})` })),
    [suppliers]
  );

  const filteredItems = useMemo(() => {
    const q = searchTerm.trim().toLowerCase();
    return items
      .filter((i) => levelFilter === 'all' || levelOf(i) !== 'ok')
      .filter(
        (i) =>
          !q ||
          i.name.toLowerCase().includes(q) ||
          i.code.toLowerCase().includes(q) ||
          (i.category || '').toLowerCase().includes(q) ||
          (i.location || '').toLowerCase().includes(q)
      )
      .sort((a, b) => a.name.localeCompare(b.name, 'pt'));
  }, [items, searchTerm, levelFilter]);
  const { page: pgFilteredItems, setPage: setPgFilteredItems, pageItems: visibleFilteredItems } = usePagedList(filteredItems, [filteredItems.length]);

  const filteredMovements = useMemo(() => {
    const q = searchTerm.trim().toLowerCase();
    return movements
      .filter((m) => movementTypeFilter === 'all' || m.type === movementTypeFilter)
      .filter(
        (m) =>
          !q ||
          m.itemName.toLowerCase().includes(q) ||
          (m.reason || '').toLowerCase().includes(q) ||
          (m.relatedDocument || '').toLowerCase().includes(q) ||
          m.performedByName.toLowerCase().includes(q)
      )
      .sort((a, b) => b.date.localeCompare(a.date) || b.createdAt.localeCompare(a.createdAt));
  }, [movements, searchTerm, movementTypeFilter]);
  const { page: pgFilteredMovements, setPage: setPgFilteredMovements, pageItems: visibleFilteredMovements } = usePagedList(filteredMovements, [filteredMovements.length]);

  const lowCount = items.filter((i) => levelOf(i) === 'baixo').length;
  const zeroCount = items.filter((i) => levelOf(i) === 'zero').length;
  const monthPrefix = today().slice(0, 7);
  const monthMovements = movements.filter((m) => m.date.startsWith(monthPrefix)).length;

  const run = async (action: () => void, loadingMessage: string): Promise<{ ok: boolean; error?: string }> => {
    try {
      await runGlobalOperation(action, { loadingMessage, requiredRule: RULE, userRole: currentUserRole });
      return { ok: true };
    } catch (err: any) {
      return { ok: false, error: err?.message };
    }
  };

  // ---------- Itens ----------
  const openAddItem = () => {
    setEditing(null);
    setItemForm(emptyItemForm());
    setItemError('');
    setItemModalOpen(true);
  };

  const openEditItem = (i: StockItem) => {
    setEditing(i);
    setItemForm({
      name: i.name,
      category: i.category || '',
      unit: i.unit,
      unitOtherDescricao: i.unitOtherDescricao || '',
      currentQuantity: String(i.currentQuantity),
      minQuantity: String(i.minQuantity),
      location: i.location || '',
      supplierId: i.supplierId || '',
      notes: i.notes || ''
    });
    setItemError('');
    setItemModalOpen(true);
  };

  const handleItemSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!acl.can(RULE)) {
      acl.guard(RULE, () => undefined);
      return;
    }
    if (!itemForm.name.trim()) {
      setItemError('Indique o nome do item.');
      return;
    }
    if (itemForm.unit === 'outro' && !itemForm.unitOtherDescricao.trim()) {
      setItemError('Descreva a unidade de medida quando selecionar "Outro".');
      return;
    }
    const min = itemForm.minQuantity.trim() === '' ? 0 : parseQty(itemForm.minQuantity);
    const initial = itemForm.currentQuantity.trim() === '' ? 0 : parseQty(itemForm.currentQuantity);
    if (!Number.isFinite(min) || min < 0) {
      setItemError('O estoque mínimo tem de ser um número igual ou superior a zero.');
      return;
    }
    if (!editing && (!Number.isFinite(initial) || initial < 0)) {
      setItemError('A quantidade inicial tem de ser um número igual ou superior a zero.');
      return;
    }

    const common = {
      name: itemForm.name.trim(),
      category: cleanText(itemForm.category),
      unit: itemForm.unit,
      unitOtherDescricao: itemForm.unit === 'outro' ? cleanText(itemForm.unitOtherDescricao) : undefined,
      minQuantity: min,
      location: cleanText(itemForm.location),
      supplierId: cleanText(itemForm.supplierId),
      notes: cleanText(itemForm.notes)
    };

    let failure = '';
    const result = await run(
      () => {
        const r = editing
          ? dbService.updateStockItem(editing.id, common)
          : dbService.addStockItem({ ...common, currentQuantity: initial });
        if (!r.success) {
          failure = r.error || '';
          throw new Error(r.error);
        }
      },
      editing ? 'A guardar alterações do item...' : 'A cadastrar item de estoque...'
    );

    if (result.ok) setItemModalOpen(false);
    else setItemError(failure || result.error || 'Não foi possível guardar o item.');
  };

  const handleDeleteItem = async () => {
    if (!deleting) return;
    const target = deleting;
    setDeleting(null);
    await run(() => {
      dbService.deleteStockItem(target.id);
    }, `A eliminar item ${target.name}...`);
  };

  // ---------- Movimentos ----------
  const openMovement = (type: StockMovementType, itemId?: string) => {
    setMovementForm({
      itemId: itemId || '',
      type,
      quantity: '',
      date: today(),
      reason: '',
      relatedDocument: ''
    });
    setMovementError('');
    setMovementModalOpen(true);
  };

  const selectedMovementItem = movementForm ? items.find((i) => i.id === movementForm.itemId) : undefined;

  const handleMovementSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!movementForm) return;
    if (!acl.can(RULE)) {
      acl.guard(RULE, () => undefined);
      return;
    }
    if (!movementForm.itemId) {
      setMovementError('Selecione o item de estoque.');
      return;
    }
    const qty = parseQty(movementForm.quantity);
    if (!Number.isFinite(qty) || qty <= 0) {
      setMovementError('A quantidade tem de ser maior que zero.');
      return;
    }
    if (movementForm.date > today()) {
      setMovementError('A data do movimento não pode ser futura.');
      return;
    }
    if (movementForm.type === 'saida' && !movementForm.reason.trim()) {
      setMovementError('Indique o motivo ou destino da saída (ex.: Secretaria, Sala 12).');
      return;
    }

    let failure = '';
    const result = await run(
      () => {
        const r = dbService.registerStockMovement({
          itemId: movementForm.itemId,
          type: movementForm.type,
          quantity: qty,
          date: movementForm.date,
          reason: movementForm.reason,
          relatedDocument: movementForm.relatedDocument
        });
        if (!r.success) {
          failure = r.error || '';
          throw new Error(r.error);
        }
      },
      movementForm.type === 'entrada' ? 'A registar entrada de estoque...' : 'A registar saída de estoque...'
    );

    if (result.ok) setMovementModalOpen(false);
    else setMovementError(failure || result.error || 'Não foi possível registar o movimento.');
  };

  const itemOptions = useMemo(
    () => items.map((i) => ({ value: i.id, label: `${i.name} (${i.code}) — ${i.currentQuantity} em estoque` })),
    [items]
  );

  const tabBtn = (key: 'itens' | 'movimentos', label: string, icon: string, count: number) => (
    <button
      type="button"
      onClick={() => {
        setTab(key);
        setSearchTerm('');
      }}
      className={`flex items-center gap-2 px-4 py-2.5 text-xs font-bold border-b-2 transition-colors cursor-pointer ${
        tab === key ? 'border-[#0b1f3a] text-[#0b1f3a]' : 'border-transparent text-slate-500 hover:text-[#0b1f3a]'
      }`}
    >
      <span className="material-symbols-outlined text-[18px]">{icon}</span>
      <span>{label}</span>
      <span className="font-mono text-[10px] bg-slate-100 px-1.5 py-0.5 rounded">{count}</span>
    </button>
  );

  return (
    <div className="flex flex-col w-full gap-6 pb-12">
      <LogisticsPageHeader
        subsection="ENTRADA E SAÍDA"
        title="CONTROLO DE STOCK"
        description="Consumíveis e materiais da escola: níveis atuais, alertas de estoque mínimo e histórico de entradas e saídas."
        actions={
          acl.can(RULE) ? (
            <>
              <LogisticsPrimaryButton icon="south_west" label="ENTRADA" onClick={() => openMovement('entrada')} variant="success" />
              <LogisticsPrimaryButton icon="north_east" label="SAÍDA" onClick={() => openMovement('saida')} variant="danger" />
              <LogisticsPrimaryButton icon="add" label="NOVO ITEM" onClick={openAddItem} />
            </>
          ) : undefined
        }
      />

      <LogisticsKpiGrid
        items={[
          { label: 'Itens em estoque', value: items.length, icon: 'warehouse' },
          { label: 'Abaixo do mínimo', value: lowCount, icon: 'warning', tone: lowCount ? 'warn' : 'default' },
          { label: 'Esgotados', value: zeroCount, icon: 'production_quantity_limits', tone: zeroCount ? 'danger' : 'default' },
          { label: 'Movimentos este mês', value: monthMovements, icon: 'swap_vert' }
        ]}
      />

      <div className="flex border-b border-slate-200">
        {tabBtn('itens', 'Itens', 'inventory', items.length)}
        {tabBtn('movimentos', 'Movimentos', 'history', movements.length)}
      </div>

      <LogisticsSearchBar
        value={searchTerm}
        onChange={setSearchTerm}
        placeholder={
          tab === 'itens'
            ? 'Pesquisar por nome, código, categoria ou local...'
            : 'Pesquisar por item, motivo, documento ou responsável...'
        }
      >
        {tab === 'itens' ? (
          <select
            value={levelFilter}
            onChange={(e) => setLevelFilter(e.target.value as 'all' | 'alerta')}
            className={logisticsSelectCls}
          >
            <option value="all">Todos os Itens</option>
            <option value="alerta">Só em alerta (baixo ou esgotado)</option>
          </select>
        ) : (
          <select
            value={movementTypeFilter}
            onChange={(e) => setMovementTypeFilter(e.target.value as 'all' | StockMovementType)}
            className={logisticsSelectCls}
          >
            <option value="all">Entradas e Saídas</option>
            <option value="entrada">Só Entradas</option>
            <option value="saida">Só Saídas</option>
          </select>
        )}
        <span className="text-xs text-slate-400 font-mono">
          {tab === 'itens' ? filteredItems.length : filteredMovements.length} registos
        </span>
      </LogisticsSearchBar>

      {tab === 'itens' ? (
        <LogisticsTableCard>
          <table className="w-full text-left text-xs">
            <thead>
              <tr className="bg-[#0b1f3a] text-white font-bold uppercase text-[10px] tracking-wider border-b border-slate-800">
                <th className="py-3.5 px-4 text-white">Item & Código</th>
                <th className={logisticsThCls}>Categoria</th>
                <th className={logisticsThCls}>Em Estoque</th>
                <th className={logisticsThCls}>Mínimo</th>
                <th className={logisticsThCls}>Nível</th>
                <th className={logisticsThCls}>Local</th>
                <th className="py-3.5 px-4 text-right text-white">Ações</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {filteredItems.length === 0 ? (
                <tr>
                  <td colSpan={7} className="py-12 text-center text-slate-400 text-xs">
                    {items.length === 0
                      ? 'Nenhum item cadastrado. Clique em "NOVO ITEM" para adicionar o primeiro.'
                      : 'Nenhum item corresponde ao filtro.'}
                  </td>
                </tr>
              ) : (
                visibleFilteredItems.map((i) => {
                  const level = levelOf(i);
                  return (
                    <tr key={i.id} className="hover:bg-slate-50 transition-colors">
                      <td className="py-3.5 px-4">
                        <div className="font-bold text-[#0b1f3a]">{i.name}</div>
                        <div className="mt-0.5 text-[11px] text-slate-500 font-mono">{i.code}</div>
                      </td>
                      <td className="py-3.5 px-3 text-slate-700">{i.category || <span className="text-slate-400">—</span>}</td>
                      <td className="py-3.5 px-3 whitespace-nowrap">
                        <span className="font-mono font-bold text-slate-800">{i.currentQuantity}</span>{' '}
                        <span className="text-[11px] text-slate-500">{unitLabel(i)}</span>
                      </td>
                      <td className="py-3.5 px-3 font-mono text-slate-600">{i.minQuantity}</td>
                      <td className="py-3.5 px-3">
                        {level === 'zero' ? (
                          <LogisticsBadge tone="red">Esgotado</LogisticsBadge>
                        ) : level === 'baixo' ? (
                          <LogisticsBadge tone="amber">Estoque baixo</LogisticsBadge>
                        ) : (
                          <LogisticsBadge tone="green">Normal</LogisticsBadge>
                        )}
                      </td>
                      <td className="py-3.5 px-3 text-slate-600">{i.location || <span className="text-slate-400">—</span>}</td>
                      <td className="py-3.5 px-4 text-right">
                        <div className="flex items-center justify-end gap-1">
                          {acl.can(RULE) && (
                            <>
                              <LogisticsIconButton icon="south_west" title="Registar entrada" hover="green" tone="green" onClick={() => openMovement('entrada', i.id)} />
                              <LogisticsIconButton icon="north_east" title="Registar saída" hover="red" tone="red" onClick={() => openMovement('saida', i.id)} />
                              <LogisticsIconButton icon="edit" title="Editar item" hover="blue" onClick={() => openEditItem(i)} />
                              <LogisticsIconButton icon="delete" title="Eliminar item" hover="red" onClick={() => setDeleting(i)} />
                            </>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
          <TablePagination total={filteredItems.length} page={pgFilteredItems} onPageChange={setPgFilteredItems} />
        </LogisticsTableCard>
      ) : (
        <LogisticsTableCard>
          <table className="w-full text-left text-xs">
            <thead>
              <tr className="bg-[#0b1f3a] text-white font-bold uppercase text-[10px] tracking-wider border-b border-slate-800">
                <th className="py-3.5 px-4 text-white">Data</th>
                <th className={logisticsThCls}>Item</th>
                <th className={logisticsThCls}>Tipo</th>
                <th className={logisticsThCls}>Quantidade</th>
                <th className={logisticsThCls}>Motivo / Destino</th>
                <th className={logisticsThCls}>Documento</th>
                <th className="py-3.5 px-4 text-white">Registado por</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {filteredMovements.length === 0 ? (
                <tr>
                  <td colSpan={7} className="py-12 text-center text-slate-400 text-xs">
                    Nenhum movimento registado ou encontrado.
                  </td>
                </tr>
              ) : (
                visibleFilteredMovements.map((m) => (
                  <tr key={m.id} className="hover:bg-slate-50 transition-colors">
                    <td className="py-3 px-4 font-mono text-slate-600 whitespace-nowrap">{formatDatePt(m.date)}</td>
                    <td className="py-3 px-3 font-semibold text-[#0b1f3a]">{m.itemName}</td>
                    <td className="py-3 px-3">
                      <LogisticsBadge tone={m.type === 'entrada' ? 'green' : 'red'}>
                        {m.type === 'entrada' ? 'Entrada' : 'Saída'}
                      </LogisticsBadge>
                    </td>
                    <td className="py-3 px-3 font-mono font-bold text-slate-800">
                      {m.type === 'entrada' ? '+' : '−'}
                      {m.quantity}
                    </td>
                    <td className="py-3 px-3 text-slate-600">{m.reason || <span className="text-slate-400">—</span>}</td>
                    <td className="py-3 px-3 font-mono text-slate-500">{m.relatedDocument || <span className="text-slate-400">—</span>}</td>
                    <td className="py-3 px-4 text-slate-600">{m.performedByName}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
          <TablePagination total={filteredMovements.length} page={pgFilteredMovements} onPageChange={setPgFilteredMovements} />
        </LogisticsTableCard>
      )}

      {itemModalOpen && (
        <LogisticsModal
          title={editing ? 'Editar Item de Estoque' : 'Novo Item de Estoque'}
          subtitle={editing ? editing.code : 'Logística · Controlo de Estoque'}
          icon="inventory"
          onClose={() => setItemModalOpen(false)}
        >
          <form onSubmit={handleItemSubmit} className="flex-1 overflow-y-auto p-6 text-xs space-y-5">
            <div className="space-y-3">
              <LogisticsSectionTitle icon="badge">Identificação</LogisticsSectionTitle>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="sm:col-span-2">
                  <label className={labelCls}>Nome do Item *</label>
                  <input
                    type="text"
                    required
                    autoFocus
                    value={itemForm.name}
                    onChange={(e) => setItemForm({ ...itemForm, name: e.target.value })}
                    placeholder="Ex.: Papel A4 (resma 500 folhas)"
                    className={inputCls}
                  />
                </div>
                <div>
                  <label className={labelCls}>Categoria</label>
                  <input
                    type="text"
                    value={itemForm.category}
                    onChange={(e) => setItemForm({ ...itemForm, category: e.target.value })}
                    placeholder="Ex.: Material de escritório"
                    className={inputCls}
                    list="stock-category-suggestions"
                  />
                  <datalist id="stock-category-suggestions">
                    {Array.from(new Set(items.map((i) => i.category).filter(Boolean) as string[])).map((c) => (
                      <option key={c} value={c} />
                    ))}
                  </datalist>
                </div>
                <div>
                  <label className={labelCls}>Local de Armazenamento</label>
                  <input
                    type="text"
                    value={itemForm.location}
                    onChange={(e) => setItemForm({ ...itemForm, location: e.target.value })}
                    className={inputCls}
                  />
                </div>
              </div>
            </div>

            <div className="space-y-3">
              <LogisticsSectionTitle icon="straighten">Quantidades</LogisticsSectionTitle>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <div>
                  <label className={labelCls}>Unidade *</label>
                  <select
                    value={itemForm.unit}
                    onChange={(e) => setItemForm({ ...itemForm, unit: e.target.value as StockUnit })}
                    className={inputCls}
                  >
                    {Object.entries(STOCK_UNIT_LABELS).map(([k, l]) => (
                      <option key={k} value={k}>
                        {l}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className={labelCls}>{editing ? 'Quantidade Atual' : 'Quantidade Inicial'}</label>
                  <input
                    type="text"
                    inputMode="decimal"
                    value={itemForm.currentQuantity}
                    disabled={!!editing}
                    onChange={(e) => setItemForm({ ...itemForm, currentQuantity: e.target.value })}
                    className={`${inputCls} font-mono disabled:bg-slate-100 disabled:text-slate-500`}
                  />
                  {editing && (
                    <p className="text-[10px] text-slate-400 mt-1">Altere através de Entrada / Saída.</p>
                  )}
                </div>
                <div>
                  <label className={labelCls}>Estoque Mínimo</label>
                  <input
                    type="text"
                    inputMode="decimal"
                    value={itemForm.minQuantity}
                    onChange={(e) => setItemForm({ ...itemForm, minQuantity: e.target.value })}
                    className={`${inputCls} font-mono`}
                  />
                </div>
                {itemForm.unit === 'outro' && (
                  <div className="sm:col-span-3">
                    <label className={labelCls}>Descreva a Unidade *</label>
                    <input
                      type="text"
                      value={itemForm.unitOtherDescricao}
                      onChange={(e) => setItemForm({ ...itemForm, unitOtherDescricao: e.target.value })}
                      className={inputCls}
                    />
                  </div>
                )}
              </div>
            </div>

            <div className="space-y-3">
              <LogisticsSectionTitle icon="local_shipping">Abastecimento</LogisticsSectionTitle>
              <SearchableSelect
                label="Fornecedor habitual"
                options={supplierOptions}
                value={itemForm.supplierId}
                onChange={(v) => setItemForm({ ...itemForm, supplierId: v })}
                placeholder="Selecione um fornecedor (opcional)..."
                emptyMessage="Nenhum fornecedor cadastrado"
              />
              <div>
                <label className={labelCls}>Observações</label>
                <textarea
                  rows={2}
                  value={itemForm.notes}
                  onChange={(e) => setItemForm({ ...itemForm, notes: e.target.value })}
                  className="w-full px-3 py-2 bg-white border border-slate-300 text-slate-800 focus:border-[#0b1f3a] focus:outline-none text-xs"
                />
              </div>
            </div>

            <LogisticsFormFooter
              error={itemError}
              onCancel={() => setItemModalOpen(false)}
              submitLabel={editing ? 'Guardar Alterações' : 'Cadastrar Item'}
            />
          </form>
        </LogisticsModal>
      )}

      {movementModalOpen && movementForm && (
        <LogisticsModal
          title={movementForm.type === 'entrada' ? 'Registar Entrada' : 'Registar Saída'}
          subtitle="Logística · Controlo de Estoque"
          icon={movementForm.type === 'entrada' ? 'south_west' : 'north_east'}
          onClose={() => setMovementModalOpen(false)}
          widthCls="max-w-lg"
        >
          <form onSubmit={handleMovementSubmit} className="flex-1 overflow-y-auto p-6 text-xs space-y-4">
            <div className="grid grid-cols-2 gap-2">
              {(['entrada', 'saida'] as StockMovementType[]).map((t) => (
                <button
                  key={t}
                  type="button"
                  onClick={() => setMovementForm({ ...movementForm, type: t })}
                  className={`h-9 text-xs font-bold border cursor-pointer transition-colors ${
                    movementForm.type === t
                      ? t === 'entrada'
                        ? 'bg-emerald-700 text-white border-emerald-700'
                        : 'bg-red-700 text-white border-red-700'
                      : t === 'entrada'
                        ? 'bg-white text-emerald-700 border-emerald-300 hover:bg-emerald-50'
                        : 'bg-white text-red-700 border-red-300 hover:bg-red-50'
                  }`}
                >
                  {t === 'entrada' ? 'Entrada' : 'Saída'}
                </button>
              ))}
            </div>

            <SearchableSelect
              label="Item *"
              options={itemOptions}
              value={movementForm.itemId}
              onChange={(v) => setMovementForm({ ...movementForm, itemId: v })}
              placeholder="Pesquise o item..."
              emptyMessage="Nenhum item cadastrado"
            />

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className={labelCls}>
                  Quantidade *{selectedMovementItem ? ` (${unitLabel(selectedMovementItem)})` : ''}
                </label>
                <input
                  type="text"
                  inputMode="decimal"
                  value={movementForm.quantity}
                  onChange={(e) => setMovementForm({ ...movementForm, quantity: e.target.value })}
                  className={`${inputCls} font-mono`}
                />
                {selectedMovementItem && movementForm.type === 'saida' && (
                  <p className="text-[10px] text-slate-400 mt-1">Disponível: {selectedMovementItem.currentQuantity}</p>
                )}
              </div>
              <div>
                <label className={labelCls}>Data *</label>
                <input
                  type="date"
                  value={movementForm.date}
                  max={today()}
                  onChange={(e) => setMovementForm({ ...movementForm, date: e.target.value })}
                  className={inputCls}
                />
              </div>
              <div className="sm:col-span-2">
                <label className={labelCls}>
                  {movementForm.type === 'entrada' ? 'Motivo / Origem' : 'Motivo / Destino *'}
                </label>
                <input
                  type="text"
                  value={movementForm.reason}
                  onChange={(e) => setMovementForm({ ...movementForm, reason: e.target.value })}
                  placeholder={movementForm.type === 'entrada' ? 'Ex.: Compra mensal' : 'Ex.: Secretaria, Sala 12'}
                  className={inputCls}
                />
              </div>
              <div className="sm:col-span-2">
                <label className={labelCls}>Documento Associado</label>
                <input
                  type="text"
                  value={movementForm.relatedDocument}
                  onChange={(e) => setMovementForm({ ...movementForm, relatedDocument: e.target.value })}
                  placeholder="Nº da fatura / guia de remessa (opcional)"
                  className={`${inputCls} font-mono`}
                />
              </div>
            </div>

            <LogisticsFormFooter
              error={movementError}
              onCancel={() => setMovementModalOpen(false)}
              submitLabel="Registar Movimento"
              submitIcon="check"
            />
          </form>
        </LogisticsModal>
      )}

      {deleting && (
        <LogisticsDeleteModal
          title="Eliminar Item de Estoque"
          name={deleting.name}
          code={deleting.code}
          extra="O histórico de movimentos deste item também será eliminado."
          onCancel={() => setDeleting(null)}
          onConfirm={handleDeleteItem}
        />
      )}
    </div>
  );
};
