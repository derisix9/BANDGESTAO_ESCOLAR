import React, { useEffect, useState } from 'react';
import { SchoolServiceItem } from '../types';
import { dbService } from '../services/db';
import { runGlobalOperation } from '../context/OperationContext';
import { TablePagination, usePagedList } from './TablePagination';
import { Notice } from './Notice';

interface ServicesCatalogModalProps {
  onClose: () => void;
}

export const ServicesCatalogModal: React.FC<ServicesCatalogModalProps> = ({ onClose }) => {
  const [services, setServices] = useState<SchoolServiceItem[]>(() => dbService.getServices());
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<string>('all');
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [editingService, setEditingService] = useState<SchoolServiceItem | null>(null);
  const [serviceToDelete, setServiceToDelete] = useState<SchoolServiceItem | null>(null);

  // O catálogo acompanha em tempo real a Tabela Financeira (e qualquer outra alteração de serviços).
  useEffect(() => dbService.subscribe(() => setServices(dbService.getServices())), []);

  // Form state for creating/editing service
  const [formData, setFormData] = useState({
    code: '',
    name: '',
    description: '',
    category: 'geral' as SchoolServiceItem['category'],
    defaultPriceKz: 5000,
    taxRegime: 'Isento (Art. 12 CIVA)',
    active: true
  });

  const categories = [
    { id: 'all', label: 'Todos os Serviços' },
    { id: 'propinas', label: 'Propinas & Mensalidades' },
    { id: 'matricula', label: 'Matrículas & Inscrições' },
    { id: 'declaracao', label: 'Declarações & Certificados' },
    { id: 'uniforme', label: 'Uniformes & Fardamento' },
    { id: 'cartao', label: 'Cartões & Documentação' },
    { id: 'geral', label: 'Outros Emolumentos' },
  ];

  const filteredServices = services.filter((s) => {
    const matchesSearch =
      s.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
      s.code.toLowerCase().includes(searchTerm.toLowerCase()) ||
      (s.description && s.description.toLowerCase().includes(searchTerm.toLowerCase()));
    const matchesCategory = selectedCategory === 'all' || s.category === selectedCategory;
    return matchesSearch && matchesCategory;
  });
  const { page: pgFilteredServices, setPage: setPgFilteredServices, pageItems: visibleFilteredServices } = usePagedList(filteredServices, [filteredServices.length]);

  const handleOpenAdd = () => {
    setEditingService(null);
    const count = services.length + 1;
    setFormData({
      code: `EMOL-${String(count).padStart(2, '0')}`,
      name: '',
      description: '',
      category: 'geral',
      defaultPriceKz: 5000,
      taxRegime: 'Isento (Art. 12 CIVA)',
      active: true
    });
    setIsFormOpen(true);
  };

  const handleOpenEdit = (service: SchoolServiceItem) => {
    setEditingService(service);
    setFormData({
      code: service.code,
      name: service.name,
      description: service.description || '',
      category: service.category,
      defaultPriceKz: service.defaultPriceKz,
      taxRegime: service.taxRegime || 'Isento (Art. 12 CIVA)',
      active: service.active
    });
    setIsFormOpen(true);
  };

  const handleConfirmDelete = async () => {
    if (!serviceToDelete) return;
    const targetService = serviceToDelete;
    setServiceToDelete(null);

    await runGlobalOperation(
      async () => {
        dbService.deleteService(targetService.id);
        setServices(dbService.getServices());
      },
      {
        loadingMessage: `A eliminar o serviço "${targetService.name}"...`,
        successMessage: 'Operação feita com sucesso!'
      }
    );
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.name.trim()) return;

    await runGlobalOperation(
      async () => {
        if (editingService?.source) {
          // Preço, nome e código vêm da Tabela Financeira — aqui só se ajusta o regime fiscal.
          dbService.updateService(editingService.id, { taxRegime: formData.taxRegime });
        } else if (editingService) {
          dbService.updateService(editingService.id, {
            code: formData.code.toUpperCase().trim(),
            name: formData.name.trim(),
            description: formData.description.trim(),
            category: formData.category,
            defaultPriceKz: Number(formData.defaultPriceKz),
            taxRegime: formData.taxRegime,
            active: formData.active
          });
        } else {
          dbService.addService({
            code: formData.code.toUpperCase().trim() || `EMOL-${Date.now().toString().slice(-4)}`,
            name: formData.name.trim(),
            description: formData.description.trim(),
            category: formData.category,
            defaultPriceKz: Number(formData.defaultPriceKz),
            taxRegime: formData.taxRegime,
            active: formData.active
          });
        }

        setServices(dbService.getServices());
        setIsFormOpen(false);
      },
      {
        loadingMessage: editingService ? 'A atualizar serviço...' : 'A adicionar novo serviço...',
        successMessage: 'Operação feita com sucesso!'
      }
    );
  };

  return (
    <div
      className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-3 sm:p-6 animate-fade-in"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="bg-white rounded-none max-w-4xl w-full shadow-2xl border border-slate-400 overflow-hidden flex flex-col max-h-[92vh]">
        {/* Modal Header */}
        <div className="px-6 py-4 bg-[#0b1f3a] text-white flex items-center justify-between border-b border-slate-700 shrink-0">
          <div className="flex items-center gap-2.5">
            <span className="material-symbols-outlined text-[22px] text-amber-300">receipt_long</span>
            <div>
              <h3 className="font-bold text-sm uppercase tracking-wider">
                Catálogo de Serviços & Emolumentos Escolares
              </h3>
              <p className="text-[11px] text-blue-200">
                Gestão dos preços tabelados para propinas, declarações, certificados e fardamento
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-slate-300 hover:text-white hover:bg-white/10 p-1 cursor-pointer transition-colors"
          >
            <span className="material-symbols-outlined text-[20px]">close</span>
          </button>
        </div>

        {/* Action Controls & Filters */}
        <div className="p-4 bg-slate-50 border-b border-slate-200 flex flex-wrap items-center justify-between gap-3 shrink-0">
          <div className="flex flex-wrap items-center gap-2 flex-1 min-w-[280px]">
            <div className="relative flex items-center flex-1 min-w-[200px] max-w-sm border border-slate-400/30 bg-slate-50/60 rounded-none focus-within:border-slate-400/70 focus-within:bg-white transition-colors">
              <span className="material-symbols-outlined ml-2.5 text-slate-400 text-[18px] shrink-0">
                search
              </span>
              <input
                type="text"
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                placeholder="Pesquisar por código, serviço..."
                className="w-full h-8 pl-2 pr-3 text-xs bg-transparent border-0 border-none outline-none focus:ring-0 text-slate-800 placeholder:text-slate-400"
              />
            </div>

            <select
              value={selectedCategory}
              onChange={(e) => setSelectedCategory(e.target.value)}
              className="h-8 px-2.5 text-xs bg-white border border-slate-300 text-slate-700 font-medium focus:border-[#0b1f3a] focus:outline-none"
            >
              {categories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.label}
                </option>
              ))}
            </select>
          </div>

          <button
            type="button"
            onClick={handleOpenAdd}
            className="px-3.5 py-1.5 bg-[#0b1f3a] hover:bg-[#7a0c0c] text-white font-bold text-xs flex items-center gap-1.5 cursor-pointer transition-colors border border-[#0b1f3a]"
          >
            <span className="material-symbols-outlined text-[16px]">add_circle</span>
            <span>Cadastrar Serviço</span>
          </button>
        </div>

        {/* Services Table */}
        <div className="flex-1 overflow-y-auto px-4 pb-4 bg-white">
          <table className="w-full text-left text-xs border-separate border-spacing-0">
            <thead>
              <tr className="text-white font-bold">
                <th className="sticky top-0 z-10 bg-[#12498a] text-white border-y border-[#12498a] p-2.5 w-24">Código</th>
                <th className="sticky top-0 z-10 bg-[#12498a] text-white border-y border-[#12498a] p-2.5">Nome do Serviço / Emolumento</th>
                <th className="sticky top-0 z-10 bg-[#12498a] text-white border-y border-[#12498a] p-2.5 w-32">Categoria</th>
                <th className="sticky top-0 z-10 bg-[#12498a] text-white border-y border-[#12498a] p-2.5 w-36 text-right">Preço</th>
                <th className="sticky top-0 z-10 bg-[#12498a] text-white border-y border-[#12498a] p-2.5 w-28 text-center">Regime Fiscal</th>
                <th className="sticky top-0 z-10 bg-[#12498a] text-white border-y border-[#12498a] p-2.5 w-24 text-center">Ações</th>
              </tr>
            </thead>
            <tbody>
              {filteredServices.length === 0 ? (
                <tr>
                  <td colSpan={6} className="p-8 text-center text-slate-500 italic">
                    Nenhum serviço ou emolumento encontrado com os filtros aplicados.
                  </td>
                </tr>
              ) : (
                visibleFilteredServices.map((service) => (
                  <tr key={service.id} className="hover:bg-slate-50/80 [&>td]:border-b [&>td]:border-slate-200">
                    <td className="p-2.5 font-mono font-bold text-[#0b1f3a]">{service.code}</td>
                    <td className="p-2.5">
                      <div className="font-bold text-slate-900 flex items-center gap-1.5 flex-wrap">
                        <span>{service.name}</span>
                        {service.source && (
                          <span
                            className="inline-flex items-center gap-0.5 px-1.5 py-0.5 text-[9px] font-bold uppercase bg-blue-100 text-blue-800 border border-blue-200"
                            title="Valor definido na Tabela Financeira (Configurações → Financeiro). Atualiza automaticamente."
                          >
                            <span className="material-symbols-outlined text-[11px]">sync</span>
                            Tabela Financeira
                          </span>
                        )}
                      </div>
                      {service.description && (
                        <div className="text-[11px] text-slate-500 truncate max-w-md">{service.description}</div>
                      )}
                    </td>
                    <td className="p-2.5">
                      <span className="inline-block px-2 py-0.5 text-[10px] font-bold uppercase bg-slate-200 text-slate-700 rounded-none">
                        {service.category}
                      </span>
                    </td>
                    <td className="p-2.5 text-right font-mono font-bold text-slate-900">
                      {service.defaultPriceKz.toLocaleString('pt-PT', { minimumFractionDigits: 2 })} Kz
                    </td>
                    <td className="p-2.5 text-center text-[10px] text-slate-600">
                      {service.taxRegime || 'Isento (Art. 12 CIVA)'}
                    </td>
                    <td className="p-2.5 text-center">
                      <div className="flex items-center justify-center gap-1">
                        <button
                          type="button"
                          onClick={() => handleOpenEdit(service)}
                          className="p-1 text-slate-600 hover:text-[#0b1f3a] hover:bg-slate-200 cursor-pointer"
                          title="Editar Serviço"
                        >
                          <span className="material-symbols-outlined text-[16px]">edit</span>
                        </button>
                        {service.source ? (
                          <span
                            className="p-1 text-slate-300 cursor-not-allowed"
                            title="Serviço gerido pela Tabela Financeira — remova a classe na Tabela para o retirar"
                          >
                            <span className="material-symbols-outlined text-[16px]">lock</span>
                          </span>
                        ) : (
                          <button
                            type="button"
                            onClick={() => setServiceToDelete(service)}
                            className="p-1 text-slate-600 hover:text-red-700 hover:bg-red-50 cursor-pointer"
                            title="Eliminar Serviço"
                          >
                            <span className="material-symbols-outlined text-[16px]">delete</span>
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
          <TablePagination total={filteredServices.length} page={pgFilteredServices} onPageChange={setPgFilteredServices} />
        </div>

        {/* Footer */}
        <div className="px-6 py-3 bg-slate-100 border-t border-slate-300 flex items-center justify-between text-xs text-slate-600 shrink-0">
          <span>
            Total de serviços cadastrados: <strong>{services.length}</strong>
          </span>
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-1.5 bg-slate-200 hover:bg-slate-300 text-slate-800 font-bold text-xs cursor-pointer border border-slate-300"
          >
            Fechar
          </button>
        </div>
      </div>

      {/* Sub-modal: Create/Edit Service */}
      {isFormOpen && (
        <div className="fixed inset-0 bg-black/50 z-60 flex items-center justify-center p-4">
          <div className="bg-white max-w-md w-full shadow-2xl border border-slate-400 flex flex-col animate-fade-in">
            <div className="px-4 py-3 bg-[#0b1f3a] text-white flex items-center justify-between">
              <h4 className="font-bold text-xs uppercase tracking-wider">
                {editingService ? 'Editar Serviço / Emolumento' : 'Novo Serviço Escolar'}
              </h4>
              <button
                type="button"
                onClick={() => setIsFormOpen(false)}
                className="text-slate-300 hover:text-white"
              >
                <span className="material-symbols-outlined text-[18px]">close</span>
              </button>
            </div>

            <form onSubmit={handleSubmit} className="p-4 space-y-3 text-xs">
              {editingService?.source && (
                <Notice tone="info">
                  Este serviço vem da <strong>Tabela Financeira</strong>. Para alterar o preço, edite a classe em
                  Configurações → Financeiro → Tabela; o catálogo atualiza-se sozinho.
                </Notice>
              )}
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="block uppercase font-bold text-slate-700 mb-1 text-[11px]">Código *</label>
                  <input
                    type="text"
                    required
                    value={formData.code}
                    onChange={(e) => setFormData({ ...formData, code: e.target.value })}
                    placeholder="PROP-01"
                    readOnly={!!editingService?.source}
                    className="w-full h-8 px-2 bg-white border border-slate-300 font-mono text-slate-800 font-bold focus:border-[#0b1f3a] focus:outline-none"
                  />
                </div>
                <div>
                  <label className="block uppercase font-bold text-slate-700 mb-1 text-[11px]">Categoria *</label>
                  <select
                    value={formData.category}
                    onChange={(e) => setFormData({ ...formData, category: e.target.value as any })}
                    className="w-full h-8 px-2 bg-white border border-slate-300 text-slate-800 focus:border-[#0b1f3a] focus:outline-none"
                  >
                    <option value="propinas">Propinas</option>
                    <option value="matricula">Matrícula</option>
                    <option value="declaracao">Declarações</option>
                    <option value="uniforme">Uniformes</option>
                    <option value="cartao">Cartões</option>
                    <option value="geral">Geral / Outros</option>
                  </select>
                </div>
              </div>

              <div>
                <label className="block uppercase font-bold text-slate-700 mb-1 text-[11px]">
                  Nome do Serviço / Emolumento *
                </label>
                <input
                  type="text"
                  required
                  value={formData.name}
                  onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                  placeholder="Ex: Certificado de Habilitações com Notas"
                  readOnly={!!editingService?.source}
                  className="w-full h-8 px-2 bg-white border border-slate-300 font-semibold text-slate-800 focus:border-[#0b1f3a] focus:outline-none"
                />
              </div>

              <div>
                <label className="block uppercase font-bold text-slate-700 mb-1 text-[11px]">
                  Preço Oficial em Kwanzas (Kz) *
                </label>
                <input
                  type="number"
                  required
                  min={0}
                  step="any"
                  value={formData.defaultPriceKz}
                  readOnly={!!editingService?.source}
                  onChange={(e) => setFormData({ ...formData, defaultPriceKz: Number(e.target.value) })}
                  className="w-full h-8 px-2 bg-white border border-slate-300 font-mono text-slate-800 font-bold focus:border-[#0b1f3a] focus:outline-none"
                />
              </div>

              <div>
                <label className="block uppercase font-bold text-slate-700 mb-1 text-[11px]">
                  Regime Fiscal de IVA
                </label>
                <input
                  type="text"
                  value={formData.taxRegime}
                  onChange={(e) => setFormData({ ...formData, taxRegime: e.target.value })}
                  className="w-full h-8 px-2 bg-white border border-slate-300 text-slate-700 focus:border-[#0b1f3a] focus:outline-none"
                />
              </div>

              <div>
                <label className="block uppercase font-bold text-slate-700 mb-1 text-[11px]">Descrição Detalhada</label>
                <textarea
                  rows={2}
                  value={formData.description}
                  onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                  placeholder="Finalidade e especificações do serviço..."
                  className="w-full p-2 bg-white border border-slate-300 text-slate-800 focus:border-[#0b1f3a] focus:outline-none text-xs"
                />
              </div>

              <div className="pt-2 flex items-center justify-end gap-2 border-t border-slate-200">
                <button
                  type="button"
                  onClick={() => setIsFormOpen(false)}
                  className="px-3 py-1.5 bg-slate-200 hover:bg-slate-300 text-slate-800 font-bold text-xs cursor-pointer"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  className="px-4 py-1.5 bg-[#0b1f3a] hover:bg-[#7a0c0c] text-white font-bold text-xs cursor-pointer transition-colors"
                >
                  {editingService ? 'SALVAR ALTERAÇÕES' : 'CADASTRAR'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL DE CONFIRMAÇÃO DE ELIMINAÇÃO DE SERVIÇO */}
      {serviceToDelete && (
        <div className="fixed inset-0 bg-black/60 z-[60] flex items-center justify-center p-4">
          <div className="bg-white rounded-none max-w-md w-full shadow-2xl border border-slate-400 overflow-hidden animate-fade-in">
            {/* Cabeçalho institucional azul */}
            <div className="px-5 py-3.5 bg-[#0b1f3a] text-white flex items-center justify-between border-b border-slate-700">
              <div className="flex items-center gap-2">
                <span className="material-symbols-outlined text-[20px] text-red-400">warning</span>
                <h3 className="font-bold text-xs tracking-wider uppercase text-white">
                  Confirmar Eliminação de Serviço
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setServiceToDelete(null)}
                className="text-slate-300 hover:text-white p-1 cursor-pointer"
              >
                <span className="material-symbols-outlined text-[20px]">close</span>
              </button>
            </div>

            <div className="p-6 bg-white text-center">
              <div className="w-12 h-12 bg-red-100 text-[#ac332b] flex items-center justify-center mx-auto mb-4 border border-red-200">
                <span className="material-symbols-outlined text-[28px]">delete_forever</span>
              </div>
              <h4 className="font-headline text-base font-bold text-slate-900">
                Eliminar Serviço do Catálogo?
              </h4>
              <p className="text-xs text-slate-600 mt-2 leading-relaxed">
                Tem a certeza de que deseja eliminar o serviço <strong className="text-slate-900">"{serviceToDelete.name}"</strong> ({serviceToDelete.code}) com valor de <strong className="text-slate-900">{serviceToDelete.defaultPriceKz.toLocaleString('pt-PT')} Kz</strong> da base de dados escolar?
              </p>
              <div className="mt-2 text-[11px] text-amber-700 bg-amber-50 border border-amber-200 p-2 text-left">
                <strong>Atenção:</strong> O serviço deixará de estar disponível para emissão de novos emolumentos e faturas.
              </div>

              <div className="mt-6 flex items-center justify-center gap-3">
                <button
                  type="button"
                  onClick={() => setServiceToDelete(null)}
                  className="px-5 py-2 bg-slate-200 hover:bg-slate-300 text-slate-800 font-bold text-xs cursor-pointer border border-slate-300 transition-colors"
                >
                  Cancelar
                </button>
                <button
                  type="button"
                  onClick={handleConfirmDelete}
                  className="px-5 py-2 bg-[#ac332b] hover:bg-[#8e241c] text-white font-bold text-xs cursor-pointer border border-[#ac332b] transition-colors shadow-xs flex items-center gap-1.5"
                >
                  <span className="material-symbols-outlined text-[16px]">delete</span>
                  <span>Sim, Eliminar Serviço</span>
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
