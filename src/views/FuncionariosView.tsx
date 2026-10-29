import React, { useState } from 'react';
import { SchoolDatabase, Funcionario, UserRole } from '../types';
import { dbService } from '../services/db';
import { runGlobalOperation } from '../context/OperationContext';
import { FuncionarioFormModal, CARGO_LABELS } from '../components/FuncionarioFormModal';
import { FuncionarioProfileModal } from '../components/FuncionarioProfileModal';
import { useAccessControl } from '../hooks/useAccessControl';
import { sortByName } from '../utils/alphabetical';
import { TablePagination, usePagedList } from '../components/TablePagination';

interface FuncionariosViewProps {
  db: SchoolDatabase;
  currentUserRole: UserRole;
}

export const FuncionariosView: React.FC<FuncionariosViewProps> = ({ db, currentUserRole }) => {
  // Matriz ACL: cadastrar, editar e eliminar funcionários passa a depender de
  // funcionarios.manage — por omissão, tal como antes, Admin e Direção.
  const acl = useAccessControl(currentUserRole);
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedCargo, setSelectedCargo] = useState<string>('all');
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingFuncionario, setEditingFuncionario] = useState<Funcionario | null>(null);
  const [viewingFuncionario, setViewingFuncionario] = useState<Funcionario | null>(null);
  const [deletingFuncionario, setDeletingFuncionario] = useState<Funcionario | null>(null);

  const funcionarioList = db.funcionarios || [];

  const cargoLabelFor = (f: Funcionario) => (f.cargo === 'outro' ? (f.cargoOutroDescricao || 'Outro') : CARGO_LABELS[f.cargo]);

  // Ordem alfabética (A–Z) pelo nome do funcionário.
  const filteredFuncionarios = sortByName(funcionarioList, (f) => f.name).filter((f) => {
    const matchesSearch =
      f.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
      (f.employeeNumber && f.employeeNumber.toLowerCase().includes(searchTerm.toLowerCase())) ||
      (f.department && f.department.toLowerCase().includes(searchTerm.toLowerCase()));
    const matchesCargo = selectedCargo === 'all' || f.cargo === selectedCargo;
    return matchesSearch && matchesCargo;
  });
  const { page, setPage, pageItems: visibleFuncionarios } = usePagedList(filteredFuncionarios, [searchTerm, selectedCargo]);

  const handleOpenAdd = () => {
    setEditingFuncionario(null);
    setIsModalOpen(true);
  };

  const handleOpenEdit = (f: Funcionario) => {
    setEditingFuncionario(f);
    setIsModalOpen(true);
  };

  return (
    <div className="flex flex-col w-full gap-6 pb-12">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <span className="text-[11px] font-bold uppercase tracking-widest text-slate-500">
              FUNCIONÁRIOS
            </span>
            <span className="w-1.5 h-1.5 rounded-full bg-[#0b1f3a]" />
            <span className="text-xs font-semibold text-[#0b1f3a]">CADASTRO DE FUNCIONÁRIOS</span>
          </div>
          <h1 className="font-headline text-2xl lg:text-3xl font-extrabold text-[#0b1f3a] tracking-tight">
            GESTÃO DE FUNCIONÁRIOS
          </h1>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          {acl.can('funcionarios.manage') && (
            <button
              onClick={() => acl.guard('funcionarios.manage', () => handleOpenAdd())}
              className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-[#0b1f3a] hover:bg-[#7a0c0c] active:scale-[0.98] transition-all duration-200 text-white font-bold text-xs shadow-sm shrink-0"
            >
              <span className="material-symbols-outlined text-[18px]">person_add</span>
              <span>CADASTRAR</span>
            </button>
          )}
        </div>
      </div>

      {/* Filter Bar */}
      <div className="bg-white p-4 rounded-2xl border border-slate-200 shadow-xs flex flex-col md:flex-row items-center justify-between gap-3">
        <div className="relative flex items-center w-full md:w-80 border border-slate-400/30 bg-slate-50/60 rounded-none focus-within:border-slate-400/70 focus-within:bg-white transition-colors">
          <span className="material-symbols-outlined ml-3 text-slate-400 text-[18px] shrink-0">
            search
          </span>
          <input
            type="text"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            placeholder="Pesquisar por nome, n.º de funcionário ou departamento..."
            className="w-full h-9 pl-2 pr-3 bg-transparent border-0 border-none outline-none focus:ring-0 text-xs text-slate-800 placeholder:text-slate-400"
          />
        </div>

        <div className="flex flex-wrap items-center gap-3 w-full md:w-auto">
          <select
            value={selectedCargo}
            onChange={(e) => setSelectedCargo(e.target.value)}
            className="h-9 px-3 rounded-lg bg-slate-100 text-xs font-semibold text-slate-700 border-0 focus:ring-1 focus:ring-[#0b1f3a]"
          >
            <option value="all">Todos os Cargos</option>
            {Object.entries(CARGO_LABELS).map(([key, label]) => (
              <option key={key} value={key}>{label}</option>
            ))}
          </select>

          <span className="text-xs text-slate-400 font-mono">
            {filteredFuncionarios.length} {filteredFuncionarios.length === 1 ? 'funcionário' : 'funcionários'}
          </span>
        </div>
      </div>

      {/* Content: Table View */}
      <div className="bg-white rounded-2xl border border-slate-200 shadow-xs overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead>
              <tr className="bg-[#0b1f3a] text-white font-bold uppercase text-[10px] tracking-wider border-b border-slate-800">
                <th className="py-3.5 px-4 text-white">Funcionário & N.º Interno</th>
                <th className="py-3.5 px-3 text-white">Cargo / Função</th>
                <th className="py-3.5 px-3 text-white">Departamento</th>
                <th className="py-3.5 px-3 text-white">Contacto</th>
                <th className="py-3.5 px-3 text-white">Estado</th>
                <th className="py-3.5 px-4 text-right text-white">Ações</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {filteredFuncionarios.length === 0 ? (
                <tr>
                  <td colSpan={6} className="py-12 text-center text-slate-400 text-xs">
                    Nenhum funcionário cadastrado ou encontrado. Clique em "CADASTRAR" para adicionar um funcionário.
                  </td>
                </tr>
              ) : (
                visibleFuncionarios.map((funcionario) => (
                  <tr key={funcionario.id} className="hover:bg-slate-50 transition-colors">
                    <td className="py-3.5 px-4">
                      <div className="flex items-center gap-3">
                        <div className="w-9 h-9 rounded-lg bg-slate-100 border border-slate-200 flex items-center justify-center text-[#0b1f3a] font-extrabold text-xs shrink-0 overflow-hidden">
                          {funcionario.avatar ? (
                            <img
                              src={funcionario.avatar}
                              alt={funcionario.name}
                              className="w-full h-full object-cover object-center"
                              referrerPolicy="no-referrer"
                            />
                          ) : (
                            funcionario.name.substring(0, 2).toUpperCase()
                          )}
                        </div>
                        <div>
                          <div className="font-bold text-[#0b1f3a]">{funcionario.name}</div>
                          <span className="text-[11px] text-slate-500 font-mono">
                            {funcionario.employeeNumber}
                          </span>
                        </div>
                      </div>
                    </td>
                    <td className="py-3.5 px-3">
                      <span className="px-2 py-0.5 rounded bg-blue-50 text-[#0b1f3a] font-bold text-[11px]">
                        {cargoLabelFor(funcionario)}
                      </span>
                    </td>
                    <td className="py-3.5 px-3 text-slate-600">{funcionario.department || '—'}</td>
                    <td className="py-3.5 px-3">
                      {funcionario.phone && (
                        <a
                          href={`tel:${funcionario.phone}`}
                          className="text-slate-700 hover:text-[#0b1f3a] font-mono text-[11px] flex items-center gap-1"
                        >
                          <span className="material-symbols-outlined text-[14px]">call</span>
                          <span>{funcionario.phone}</span>
                        </a>
                      )}
                      <span className="text-[10px] text-slate-400 block truncate max-w-[140px]">{funcionario.email}</span>
                    </td>
                    <td className="py-3.5 px-3">
                      <span
                        className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                          funcionario.status === 'ativo'
                            ? 'bg-emerald-100 text-emerald-800'
                            : funcionario.status === 'licenca'
                            ? 'bg-amber-100 text-amber-800'
                            : 'bg-slate-200 text-slate-600'
                        }`}
                      >
                        {funcionario.status === 'ativo' ? 'Ativo' : funcionario.status === 'licenca' ? 'Licença' : 'Inativo'}
                      </span>
                    </td>
                    <td className="py-3.5 px-4 text-right">
                      <div className="flex items-center justify-end gap-1">
                        {/* Consultar Perfil (igual ao dos docentes) */}
                        <button
                          onClick={() => setViewingFuncionario(funcionario)}
                          className="p-1.5 rounded-lg text-slate-500 hover:text-[#0b1f3a] hover:bg-slate-100 active:scale-[0.98] transition-all duration-200 cursor-pointer"
                          title="Consultar perfil do funcionário"
                        >
                          <span className="material-symbols-outlined text-[18px]">account_box</span>
                        </button>
                        {acl.can('funcionarios.manage') && (
                          <>
                            <button
                              onClick={() => acl.guard('funcionarios.manage', () => handleOpenEdit(funcionario))}
                              className="p-1.5 rounded-lg text-slate-500 hover:text-blue-700 hover:bg-slate-100 active:scale-[0.98] transition-all duration-200 cursor-pointer"
                              title="Editar funcionário"
                            >
                              <span className="material-symbols-outlined text-[18px]">edit</span>
                            </button>
                            <button
                              onClick={() => setDeletingFuncionario(funcionario)}
                              className="p-1.5 rounded-lg text-slate-400 hover:text-red-700 hover:bg-red-50 active:scale-[0.98] transition-all duration-200 cursor-pointer"
                              title="Eliminar funcionário da base de dados"
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
          <TablePagination total={filteredFuncionarios.length} page={page} onPageChange={setPage} />
        </div>
      </div>

      {viewingFuncionario && (
        <FuncionarioProfileModal
          funcionario={viewingFuncionario}
          settings={db.settings}
          canSeePay={acl.can('funcionarios.manage')}
          onClose={() => setViewingFuncionario(null)}
        />
      )}

      {/* Add / Edit Funcionario Modal */}
      {isModalOpen && (
        <FuncionarioFormModal
          departments={db.departments || []}
          editingFuncionario={editingFuncionario}
          onClose={() => setIsModalOpen(false)}
          onSuccess={() => setIsModalOpen(false)}
        />
      )}

      {/* Modal: Eliminação de Funcionário */}
      {deletingFuncionario && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-xs z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-none max-w-md w-full shadow-2xl overflow-hidden border border-slate-300">
            <div className="px-6 py-4 bg-[#0b1f3a] text-white flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="material-symbols-outlined text-[20px] text-red-400">warning</span>
                <h3 className="font-bold text-base">Eliminar Funcionário</h3>
              </div>
              <button
                onClick={() => setDeletingFuncionario(null)}
                className="text-slate-300 hover:text-white p-1 hover:bg-white/10 transition-colors cursor-pointer"
              >
                <span className="material-symbols-outlined text-[20px]">close</span>
              </button>
            </div>

            <div className="p-6">
              <div className="w-12 h-12 rounded-none bg-red-100 text-[#ac332b] flex items-center justify-center mx-auto mb-4 border border-red-200">
                <span className="material-symbols-outlined text-[28px]">delete_forever</span>
              </div>
              <h3 className="font-headline text-lg font-bold text-slate-900 text-center">
                Eliminar Funcionário da Base de Dados?
              </h3>
              <p className="text-xs text-slate-600 text-center mt-2 leading-relaxed">
                Pretende eliminar o funcionário <strong className="text-slate-900">{deletingFuncionario.name}</strong> (
                <span className="font-mono font-bold">{deletingFuncionario.employeeNumber}</span>)? Esta operação removerá o
                registo da base de dados institucional.
              </p>
            </div>
            <div className="px-6 py-4 bg-slate-50 border-t border-slate-300 flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={() => setDeletingFuncionario(null)}
                className="px-4 py-2.5 rounded-none bg-slate-200 hover:bg-slate-300 text-slate-700 font-bold text-xs cursor-pointer border border-slate-300"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={async () => {
                  const funcionario = deletingFuncionario;
                  setDeletingFuncionario(null);
                  await runGlobalOperation(
                    async () => {
                      dbService.deleteFuncionario(funcionario.id);
                    },
                    {
                      requiredRule: 'funcionarios.manage',
                      userRole: currentUserRole,
                      loadingMessage: `A eliminar funcionário ${funcionario.name}...`,
                      successMessage: 'Operação feita com sucesso!'
                    }
                  );
                }}
                className="px-5 py-2.5 rounded-none bg-[#b91c1c] hover:bg-[#7a0c0c] text-white font-bold text-xs flex items-center gap-2 cursor-pointer transition-colors shadow-none border-none"
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
