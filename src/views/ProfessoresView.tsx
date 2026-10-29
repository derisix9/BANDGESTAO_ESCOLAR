import React, { useMemo, useState } from 'react';
import { SchoolDatabase, Teacher, UserRole } from '../types';
import { dbService } from '../services/db';
import { AsyncButton } from '../components/AsyncButton';
import { runGlobalOperation } from '../context/OperationContext';
import { TeacherProfileModal } from '../components/TeacherProfileModal';
import { TeacherFormModal } from '../components/TeacherFormModal';
import { useAccessControl } from '../hooks/useAccessControl';
import { sortByName } from '../utils/alphabetical';
import { TablePagination, usePagedList } from '../components/TablePagination';

interface ProfessoresViewProps {
  db: SchoolDatabase;
  currentUserRole: UserRole;
}

export const ProfessoresView: React.FC<ProfessoresViewProps> = ({ db, currentUserRole }) => {
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedDept, setSelectedDept] = useState<string>('all');
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingTeacher, setEditingTeacher] = useState<Teacher | null>(null);
  const [viewingTeacher, setViewingTeacher] = useState<Teacher | null>(null);
  const [teacherDocMode, setTeacherDocMode] = useState<'ficha' | 'passe'>('ficha');
  const [deletingTeacher, setDeletingTeacher] = useState<Teacher | null>(null);

  const teacherList = db.teachers || [];
  const classList = db.classes || [];

  // Opções do filtro = departamentos curriculares cadastrados (Cadastro →
  // Departamentos) + qualquer valor antigo ainda em uso por algum professor
  // (para que ninguém fique sem poder ser filtrado).
  const deptFilterOptions = useMemo(() => {
    const registered = (db.departments || []).filter((d) => d.kind === 'curricular').map((d) => d.name);
    const known = new Set(registered.map((n) => n.trim().toLowerCase()));
    const legacy: string[] = [];
    teacherList.forEach((t) => {
      const name = (t.department || '').trim();
      if (name && !known.has(name.toLowerCase())) {
        known.add(name.toLowerCase());
        legacy.push(name);
      }
    });
    return [...registered, ...legacy].sort((a, b) => a.localeCompare(b, 'pt'));
  }, [db.departments, teacherList]);

  // Ordem alfabética (A–Z) pelo nome do professor.
  const filteredTeachers = sortByName(teacherList, (t) => t.name).filter((t) => {
    const matchesSearch =
      t.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
      (t.agentNumber && t.agentNumber.toLowerCase().includes(searchTerm.toLowerCase())) ||
      (t.department && t.department.toLowerCase().includes(searchTerm.toLowerCase()));
    const matchesDept = selectedDept === 'all' || t.department === selectedDept;
    return matchesSearch && matchesDept;
  });
  const { page, setPage, pageItems: visibleTeachers } = usePagedList(filteredTeachers, [searchTerm, selectedDept]);

  const handleOpenAdd = () => {
    setEditingTeacher(null);
    setIsModalOpen(true);
  };

  // Matriz ACL (Configurações → Perfis & Permissões): cadastrar, editar e
  // eliminar professores passa a depender de professores.manage — que, por
  // omissão, já inclui a Direção Pedagógica, como a sua própria descrição de
  // perfil promete ("gestão do corpo docente"), e não apenas o Administrador.
  const acl = useAccessControl(currentUserRole);

  const handleOpenEdit = (t: Teacher) => {
    setEditingTeacher(t);
    setIsModalOpen(true);
  };

  const handleDeleteTeacher = (id: string, name: string) => {
    if (confirm(`Tem a certeza de que deseja eliminar o docente "${name}" da base de dados?`)) {
      dbService.deleteTeacher(id);
    }
  };

  return (
    <div className="flex flex-col w-full gap-6 pb-12">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <span className="text-[11px] font-bold uppercase tracking-widest text-slate-500">
              PROFESSORES
            </span>
            <span className="w-1.5 h-1.5 rounded-full bg-[#0b1f3a]" />
            <span className="text-xs font-semibold text-[#0b1f3a]">CADASTRO DE PROFESSORES</span>
          </div>
          <h1 className="font-headline text-2xl lg:text-3xl font-extrabold text-[#0b1f3a] tracking-tight">
            GESTÃO DE PROFESSORES
          </h1>
          <p className="text-xs text-slate-500 mt-0.5">
          </p>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          {acl.can('professores.manage') && (
            <button
              onClick={() => acl.guard('professores.manage', () => handleOpenAdd())}
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
            placeholder="Pesquisar por nome, n.º de agente ou departamento..."
            className="w-full h-9 pl-2 pr-3 bg-transparent border-0 border-none outline-none focus:ring-0 text-xs text-slate-800 placeholder:text-slate-400"
          />
        </div>

        <div className="flex flex-wrap items-center gap-3 w-full md:w-auto">
          <select
            value={selectedDept}
            onChange={(e) => setSelectedDept(e.target.value)}
            className="h-9 px-3 rounded-lg bg-slate-100 text-xs font-semibold text-slate-700 border-0 focus:ring-1 focus:ring-[#0b1f3a]"
          >
            <option value="all">Todos os Departamentos</option>
            {deptFilterOptions.map((name) => (
              <option key={name} value={name}>
                {name}
              </option>
            ))}
          </select>

          <span className="text-xs text-slate-400 font-mono">
            {filteredTeachers.length} {filteredTeachers.length === 1 ? 'docente' : 'docentes'}
          </span>
        </div>
      </div>

      {/* Content: Table View Only */}
      <div className="bg-white rounded-2xl border border-slate-200 shadow-xs overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead>
                <tr className="bg-[#0b1f3a] text-white font-bold uppercase text-[10px] tracking-wider border-b border-slate-800">
                  <th className="py-3.5 px-4 text-white">Professor & N.º Agente</th>
                  <th className="py-3.5 px-3 text-white">Departamento & Grau</th>
                  <th className="py-3.5 px-3 text-white">Turmas / Direção</th>
                  <th className="py-3.5 px-3 text-center text-white">Carga Horária</th>
                  <th className="py-3.5 px-3 text-white">Contacto</th>
                  <th className="py-3.5 px-3 text-white">Estado</th>
                  <th className="py-3.5 px-4 text-right text-white">Ações</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filteredTeachers.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="py-12 text-center text-slate-400 text-xs">
                      Nenhum docente cadastrado ou encontrado. Clique em "+ Contratar Docente" para adicionar professores reais.
                    </td>
                  </tr>
                ) : (
                  visibleTeachers.map((teacher) => {
                    const teacherClasses = classList.filter((c) => c.headTeacherId === teacher.id);
                    return (
                      <tr key={teacher.id} className="hover:bg-slate-50 transition-colors">
                        <td className="py-3.5 px-4">
                          <div className="flex items-center gap-3">
                            <div className="w-9 h-9 rounded-lg bg-slate-100 border border-slate-200 flex items-center justify-center text-[#0b1f3a] font-extrabold text-xs shrink-0 overflow-hidden">
                              {teacher.avatar ? (
                                <img
                                  src={teacher.avatar}
                                  alt={teacher.name}
                                  className="w-full h-full object-cover object-center"
                                  referrerPolicy="no-referrer"
                                />
                              ) : (
                                teacher.name.substring(0, 2).toUpperCase()
                              )}
                            </div>
                            <div>
                              <div className="font-bold text-[#0b1f3a]">{teacher.name}</div>
                              <span className="text-[11px] text-slate-500 font-mono">
                                Agente: {teacher.agentNumber}
                              </span>
                            </div>
                          </div>
                        </td>
                        <td className="py-3.5 px-3">
                          <div className="font-semibold text-slate-800">{teacher.department}</div>
                          <span className="text-[11px] text-slate-500">{teacher.degree}</span>
                        </td>
                        <td className="py-3.5 px-3">
                          <div className="flex flex-wrap gap-1">
                            {teacherClasses.length > 0 ? (
                              teacherClasses.map((c) => (
                                <span
                                  key={c.id}
                                  className="px-2 py-0.5 rounded bg-blue-50 text-[#0b1f3a] font-bold text-[10px]"
                                >
                                  DT: {c.name}
                                </span>
                              ))
                            ) : (
                              <span className="text-slate-400 italic text-[11px]">Docente Regente</span>
                            )}
                          </div>
                        </td>
                        <td className="py-3.5 px-3 text-center">
                          <span className="font-mono font-bold text-slate-800 bg-slate-100 px-2.5 py-1 rounded-md text-xs">
                            {teacher.weeklyHours}h / sem
                          </span>
                        </td>
                        <td className="py-3.5 px-3">
                          <a
                            href={`tel:${teacher.phone}`}
                            className="text-slate-700 hover:text-[#0b1f3a] font-mono text-[11px] flex items-center gap-1"
                          >
                            <span className="material-symbols-outlined text-[14px]">call</span>
                            <span>{teacher.phone}</span>
                          </a>
                          <span className="text-[10px] text-slate-400 block truncate max-w-[140px]">{teacher.email}</span>
                        </td>
                        <td className="py-3.5 px-3">
                          <span
                            className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                              teacher.status === 'ativo'
                                ? 'bg-emerald-100 text-emerald-800'
                                : 'bg-amber-100 text-amber-800'
                            }`}
                          >
                            {teacher.status === 'ativo' ? 'Ativo' : 'Licença'}
                          </span>
                        </td>
                        <td className="py-3.5 px-4 text-right">
                          <div className="flex items-center justify-end gap-1">
                            {/* Consultar Perfil */}
                            <button
                              onClick={() => setViewingTeacher(teacher)}
                              className="p-1.5 rounded-lg text-slate-500 hover:text-[#0b1f3a] hover:bg-slate-100 active:scale-[0.98] transition-all duration-200 cursor-pointer"
                              title="Consultar perfil do docente"
                            >
                              <span className="material-symbols-outlined text-[18px]">account_box</span>
                            </button>

                            {acl.can('professores.manage') && (
                              <>
                                <button
                                  onClick={() => acl.guard('professores.manage', () => handleOpenEdit(teacher))}
                                  className="p-1.5 rounded-lg text-slate-500 hover:text-blue-700 hover:bg-slate-100 active:scale-[0.98] transition-all duration-200 cursor-pointer"
                                  title="Editar docente"
                                >
                                  <span className="material-symbols-outlined text-[18px]">edit</span>
                                </button>
                                <button
                                  onClick={() => setDeletingTeacher(teacher)}
                                  className="p-1.5 rounded-lg text-slate-400 hover:text-red-700 hover:bg-red-50 active:scale-[0.98] transition-all duration-200 cursor-pointer"
                                  title="Eliminar docente da base de dados"
                                >
                                  <span className="material-symbols-outlined text-[18px]">delete</span>
                                </button>
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
            <TablePagination total={filteredTeachers.length} page={page} onPageChange={setPage} />
          </div>
        </div>

      {/* Add / Edit Teacher Modal with all profile fields */}
      {isModalOpen && (
        <TeacherFormModal
          db={db}
          editingTeacher={editingTeacher}
          onClose={() => setIsModalOpen(false)}
          onSuccess={() => setIsModalOpen(false)}
        />
      )}

      {/* Modal: Ficha de Perfil do Professor (Imagens 3 e 4) */}
      {viewingTeacher && (
        <TeacherProfileModal
          teacher={viewingTeacher}
          classList={classList}
          onClose={() => setViewingTeacher(null)}
          settings={db.settings}
        />
      )}

      {/* Modal: Eliminação de Docente */}
      {deletingTeacher && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-xs z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-none max-w-md w-full shadow-2xl overflow-hidden border border-slate-300">
            <div className="px-6 py-4 bg-[#0b1f3a] text-white flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="material-symbols-outlined text-[20px] text-red-400">warning</span>
                <h3 className="font-bold text-base">Eliminar Docente</h3>
              </div>
              <button
                onClick={() => setDeletingTeacher(null)}
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
                Eliminar Docente da Base de Dados?
              </h3>
              <p className="text-xs text-slate-600 text-center mt-2 leading-relaxed">
                Pretende eliminar o docente <strong className="text-slate-900">{deletingTeacher.name}</strong> (Agente nº{' '}
                <span className="font-mono font-bold">{deletingTeacher.agentNumber}</span>)? Esta operação removerá o professor da base de dados institucional.
              </p>
            </div>
            <div className="px-6 py-4 bg-slate-50 border-t border-slate-300 flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={() => setDeletingTeacher(null)}
                className="px-4 py-2.5 rounded-none bg-slate-200 hover:bg-slate-300 text-slate-700 font-bold text-xs cursor-pointer border border-slate-300"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={async () => {
                  const teacher = deletingTeacher;
                  setDeletingTeacher(null);
                  await runGlobalOperation(
                    async () => {
                      dbService.deleteTeacher(teacher.id);
                    },
                    {
                      loadingMessage: `A eliminar docente ${teacher.name}...`,
                      successMessage: 'Operação feita com sucesso!',
                      requiredRule: 'professores.manage',
                      userRole: currentUserRole
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
