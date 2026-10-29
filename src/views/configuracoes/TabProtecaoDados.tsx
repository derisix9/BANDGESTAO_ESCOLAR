import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  DataSubjectRequestStatus,
  DataSubjectRequestType,
  InstitutionSettings,
  UserRole
} from '../../types';
import { dbService } from '../../services/db';
import { runGlobalOperation, showOperationSuccess } from '../../context/OperationContext';

import {
  REQUEST_STATUS_META,
  REQUEST_TYPE_LABELS,
  REQUESTER_RELATION_LABELS,
  defaultDataProtectionPolicy
} from '../../utils/dataProtection';
import { TablePagination, usePagedList } from '../../components/TablePagination';
import { Notice } from '../../components/Notice';

interface TabProtecaoDadosProps {
  settings: InstitutionSettings;
  currentUserRole?: UserRole;
  onUpdateSettings?: (newSettings: Partial<InstitutionSettings>) => void;
  onSaveAll: (options?: { loadingMessage?: string; successMessage?: string; requiredRule?: string }) => void;
  registerCommit?: (commit: (() => Partial<InstitutionSettings>) | null) => void;
}

type RelationKey = 'encarregado' | 'professor' | 'funcionario' | 'aluno' | 'outro';

const emptyRequestForm = {
  requesterName: '',
  requesterRelation: 'encarregado' as RelationKey,
  studentId: '',
  type: 'acesso' as DataSubjectRequestType,
  description: ''
};

/**
 * Configurações > 10. Política de Proteção de Dados Pessoais.
 *
 * Alinhada com a Lei n.º 22/11 (Proteção de Dados Pessoais de Angola): texto
 * da política, prazos de retenção por categoria de titular, contacto do
 * Encarregado de Proteção de Dados (EPD/DPO) e o registo dos pedidos de
 * titulares de dados (acesso, retificação, apagamento, portabilidade e
 * oposição). Distinta da secção 7 (Segurança & Backups), que trata da
 * segurança técnica dos dados, não dos direitos dos seus titulares.
 */
export const TabProtecaoDados: React.FC<TabProtecaoDadosProps> = ({
  settings,
  currentUserRole,
  onSaveAll,
  registerCommit
}) => {
  const initial = settings.dataProtectionPolicy || defaultDataProtectionPolicy();

  const [policyText, setPolicyText] = useState(initial.policyText || '');
  const [dpoName, setDpoName] = useState(initial.dpoName || '');
  const [dpoEmail, setDpoEmail] = useState(initial.dpoEmail || '');
  const [dpoPhone, setDpoPhone] = useState(initial.dpoPhone || '');
  const [retentionYearsStudents, setRetentionYearsStudents] = useState(String(initial.retentionYearsStudents ?? 10));
  const [retentionYearsStaff, setRetentionYearsStaff] = useState(String(initial.retentionYearsStaff ?? 10));
  const [retentionYearsFinancial, setRetentionYearsFinancial] = useState(String(initial.retentionYearsFinancial ?? 5));
  const [guardianConsentRequiredForPhotos, setGuardianConsentRequiredForPhotos] = useState(
    initial.guardianConsentRequiredForPhotos ?? true
  );
  const [marketingOptInDefault, setMarketingOptInDefault] = useState(initial.marketingOptInDefault ?? false);

  const [requests, setRequests] = useState(dbService.getDataSubjectRequests());
  const [showNewRequestModal, setShowNewRequestModal] = useState(false);
  const [form, setForm] = useState(emptyRequestForm);
  const [formErrors, setFormErrors] = useState<string[]>([]);
  const [statusFilter, setStatusFilter] = useState<'todos' | DataSubjectRequestStatus>('todos');

  const refreshRequests = () => setRequests(dbService.getDataSubjectRequests());

  const filteredRequests = useMemo(
    () => requests.filter((r) => statusFilter === 'todos' || r.status === statusFilter),
    [requests, statusFilter]
  );
  const { page: pgFilteredRequests, setPage: setPgFilteredRequests, pageItems: visibleFilteredRequests } = usePagedList(filteredRequests, [filteredRequests.length]);

  const pendingCount = requests.filter((r) => r.status === 'pendente').length;

  // ---------------------------------------------------------------------
  // Bloco 1: texto da política & prazos — segue o mecanismo de gravação
  // única do módulo (botão "Guardar Alterações" no topo).
  // ---------------------------------------------------------------------
  const buildPendingSettings = useCallback(
    (): Partial<InstitutionSettings> => ({
      dataProtectionPolicy: {
        ...initial,
        policyText,
        dpoName: dpoName.trim(),
        dpoEmail: dpoEmail.trim(),
        dpoPhone: dpoPhone.trim(),
        retentionYearsStudents: Number(retentionYearsStudents) || 0,
        retentionYearsStaff: Number(retentionYearsStaff) || 0,
        retentionYearsFinancial: Number(retentionYearsFinancial) || 0,
        guardianConsentRequiredForPhotos,
        marketingOptInDefault,
        lastReviewedIso: new Date().toISOString()
      }
    }),
    [
      initial,
      policyText,
      dpoName,
      dpoEmail,
      dpoPhone,
      retentionYearsStudents,
      retentionYearsStaff,
      retentionYearsFinancial,
      guardianConsentRequiredForPhotos,
      marketingOptInDefault
    ]
  );

  useEffect(() => {
    const commit = () => {
      dbService.addAuditLog({
        userName: '',
        userRole: 'Administrador Geral',
        action: 'Atualização da Política de Proteção de Dados',
        details: 'A política de proteção de dados pessoais e os prazos de retenção foram revistos.',
        module: 'sistema',
        timestamp: '',
        badgeColor: '#0b1f3a'
      });
      return buildPendingSettings();
    };
    registerCommit?.(commit);
    return () => registerCommit?.(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [registerCommit, buildPendingSettings]);

  // ---------------------------------------------------------------------
  // Bloco 2: pedidos de titulares de dados — lista viva, gravada de
  // imediato (mesmo padrão usado no Chat Encarregado ↔ Escola).
  // ---------------------------------------------------------------------
  const handleCreateRequest = () => {
    const result = dbService.createDataSubjectRequest({
      requesterName: form.requesterName,
      requesterRelation: form.requesterRelation,
      studentId: form.studentId.trim() || undefined,
      type: form.type,
      description: form.description
    });
    if (!result.success) {
      setFormErrors(result.errors || [result.error || 'Não foi possível registar o pedido.']);
      return;
    }
    setShowNewRequestModal(false);
    setForm(emptyRequestForm);
    setFormErrors([]);
    refreshRequests();
    void showOperationSuccess('Pedido registado com sucesso!', { details: `Pedido ${result.request?.code} registado.` });
  };

  const handleChangeStatus = async (id: string, status: DataSubjectRequestStatus) => {
    await runGlobalOperation(
      async () => {
        dbService.updateDataSubjectRequestStatus(id, status);
        refreshRequests();
      },
      {
        requiredRule: 'config.institution',
        userRole: currentUserRole,
        loadingMessage: 'A atualizar estado do pedido...',
        successMessage: 'Operação feita com sucesso!'
      }
    );
  };

  const handleDeleteRequest = async (id: string, code: string) => {
    const ok = window.confirm(`Eliminar definitivamente o registo do pedido ${code}?`);
    if (!ok) return;
    await runGlobalOperation(
      async () => {
        dbService.deleteDataSubjectRequest(id);
        refreshRequests();
      },
      {
        requiredRule: 'config.institution',
        userRole: currentUserRole,
        loadingMessage: 'A eliminar registo do pedido...',
        successMessage: 'Operação feita com sucesso!'
      }
    );
  };

  return (
    <div className="flex flex-col gap-6">
      {/* Header */}
      <div className="p-6 rounded-2xl bg-white border border-slate-200 shadow-xs flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="w-11 h-11 rounded-xl bg-slate-100 flex items-center justify-center text-[#0b1f3a] shrink-0">
            <span className="material-symbols-outlined text-[26px]">policy</span>
          </div>
          <div>
            <div className="flex items-center gap-2">
              <span className="text-[11px] uppercase tracking-wider text-[#ac332b] font-bold">Módulo 10</span>
              <span className="w-1 h-1 rounded-full bg-slate-300" />
              <span className="text-[11px] text-slate-500 font-medium">LEI Nº 22/11, PROTEÇÃO DE DADOS PESSOAIS</span>
            </div>
            <h2 className="font-headline text-lg lg:text-xl font-bold text-slate-900">
              POLÍTICAS DE PROTEÇÃO DE DADOS
            </h2>
          </div>
        </div>
        {pendingCount > 0 && (
          <span className="px-2.5 py-1 rounded-lg bg-amber-50 text-amber-800 border border-amber-200 font-mono text-[11px] font-bold">
            {pendingCount} PEDIDO(S) PENDENTE(S)
          </span>
        )}
      </div>

      {/* Bloco 1: Política & Retenção */}
      <section className="bg-white p-6 rounded-2xl border border-slate-200 shadow-xs flex flex-col gap-5">
        <div className="pb-3 border-b border-slate-100">
          <h3 className="font-headline text-base lg:text-lg font-bold text-slate-900">
            1. Texto da Política & Contacto do Encarregado de Proteção de Dados
          </h3>
          <p className="text-xs text-slate-500">
            Apresentável a encarregados, professores e funcionários; alinhado com a Lei n.º 22/11 de Angola.
          </p>
        </div>

        <div className="flex flex-col gap-1.5 text-xs">
          <label className="font-bold text-slate-900">Texto da Política</label>
          <textarea
            value={policyText}
            onChange={(e) => setPolicyText(e.target.value)}
            rows={5}
            className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-lg text-slate-800 leading-relaxed"
          />
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-xs">
          <div className="flex flex-col gap-1.5">
            <label className="font-bold text-slate-900">Nome do Encarregado de Proteção de Dados</label>
            <input
              value={dpoName}
              onChange={(e) => setDpoName(e.target.value)}
              className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-lg font-semibold text-slate-800"
              placeholder="Ex.: Dra. Ana Kiala"
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <label className="font-bold text-slate-900">E-mail de Contacto</label>
            <input
              value={dpoEmail}
              onChange={(e) => setDpoEmail(e.target.value)}
              className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-lg font-semibold text-slate-800"
              placeholder="dpo@instituicao.co.ao"
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <label className="font-bold text-slate-900">Telefone de Contacto</label>
            <input
              value={dpoPhone}
              onChange={(e) => setDpoPhone(e.target.value)}
              className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-lg font-semibold text-slate-800"
              placeholder="+244 9XX XXX XXX"
            />
          </div>
        </div>
      </section>

      {/* Bloco 2: Prazos de Retenção */}
      <section className="bg-white p-6 rounded-2xl border border-slate-200 shadow-xs flex flex-col gap-5">
        <div className="pb-3 border-b border-slate-100">
          <h3 className="font-headline text-base lg:text-lg font-bold text-slate-900">
            2. Prazos de Retenção por Categoria
          </h3>
          <p className="text-xs text-slate-500">Em anos, a partir do fim do vínculo com a instituição.</p>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 text-xs">
          <div className="flex flex-col gap-1.5">
            <label className="font-bold text-slate-900">Alunos</label>
            <input
              type="number"
              min={0}
              value={retentionYearsStudents}
              onChange={(e) => setRetentionYearsStudents(e.target.value)}
              className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-lg font-semibold text-slate-800"
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <label className="font-bold text-slate-900">Professores & Funcionários</label>
            <input
              type="number"
              min={0}
              value={retentionYearsStaff}
              onChange={(e) => setRetentionYearsStaff(e.target.value)}
              className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-lg font-semibold text-slate-800"
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <label className="font-bold text-slate-900">Registos Financeiros</label>
            <input
              type="number"
              min={0}
              value={retentionYearsFinancial}
              onChange={(e) => setRetentionYearsFinancial(e.target.value)}
              className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-lg font-semibold text-slate-800"
            />
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-xs">
          <div className="p-4 rounded-xl bg-slate-50 border border-slate-100 flex items-center justify-between gap-3">
            <div>
              <span className="font-bold text-slate-900 block">Consentimento do Encarregado p/ Imagem</span>
              <span className="text-[11px] text-slate-500">Exigir consentimento explícito para fotos/vídeos do aluno.</span>
            </div>
            <button
              type="button"
              onClick={() => setGuardianConsentRequiredForPhotos(!guardianConsentRequiredForPhotos)}
              className={`w-9 h-5 rounded-full transition-colors relative cursor-pointer shrink-0 ${
                guardianConsentRequiredForPhotos ? 'bg-[#0b1f3a]' : 'bg-slate-300'
              }`}
            >
              <div
                className={`w-3.5 h-3.5 rounded-full bg-white transition-transform absolute top-0.5 ${
                  guardianConsentRequiredForPhotos ? 'right-0.5' : 'left-0.5'
                }`}
              />
            </button>
          </div>
          <div className="p-4 rounded-xl bg-slate-50 border border-slate-100 flex items-center justify-between gap-3">
            <div>
              <span className="font-bold text-slate-900 block">Comunicações Não Essenciais por Omissão</span>
              <span className="text-[11px] text-slate-500">Ativar por padrão avisos de marketing/eventos.</span>
            </div>
            <button
              type="button"
              onClick={() => setMarketingOptInDefault(!marketingOptInDefault)}
              className={`w-9 h-5 rounded-full transition-colors relative cursor-pointer shrink-0 ${
                marketingOptInDefault ? 'bg-[#0b1f3a]' : 'bg-slate-300'
              }`}
            >
              <div
                className={`w-3.5 h-3.5 rounded-full bg-white transition-transform absolute top-0.5 ${
                  marketingOptInDefault ? 'right-0.5' : 'left-0.5'
                }`}
              />
            </button>
          </div>
        </div>
      </section>

      {/* Bloco 3: Pedidos de Titulares de Dados */}
      <section className="bg-white p-6 rounded-2xl border border-slate-200 shadow-xs flex flex-col gap-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-slate-100">
          <div>
            <h3 className="font-headline text-base lg:text-lg font-bold text-slate-900">
              3. Pedidos de Titulares de Dados
            </h3>
            <p className="text-xs text-slate-500">
              Direitos de acesso, retificação, apagamento, portabilidade e oposição, recebidos de encarregados,
              professores, funcionários ou alunos.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value as any)}
              className="px-3 py-1.5 bg-slate-50 border border-slate-200 rounded-xl text-xs font-semibold text-slate-700 outline-none"
            >
              <option value="todos">Todos os Estados</option>
              {(Object.keys(REQUEST_STATUS_META) as DataSubjectRequestStatus[]).map((s) => (
                <option key={s} value={s}>
                  {REQUEST_STATUS_META[s].label}
                </option>
              ))}
            </select>
            <button
              type="button"
              onClick={() => setShowNewRequestModal(true)}
              className="px-3.5 py-2 rounded-xl bg-[#0b1f3a] text-white hover:bg-[#7a0c0c] font-bold text-xs flex items-center gap-1.5 transition-colors shadow-xs cursor-pointer"
            >
              <span className="material-symbols-outlined text-[16px]">add</span>
              <span>Registar Pedido</span>
            </button>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead>
              <tr className="bg-[#0b1f3a] text-white uppercase tracking-wider font-bold text-[10px] border-b border-slate-800">
                <th className="py-2.5 px-3 rounded-l-lg text-white">Código</th>
                <th className="py-2.5 px-3 text-white">Requerente</th>
                <th className="py-2.5 px-3 text-white">Tipo de Pedido</th>
                <th className="py-2.5 px-3 text-white">Data</th>
                <th className="py-2.5 px-3 text-white">Estado</th>
                <th className="py-2.5 px-3 text-right rounded-r-lg text-white">Ações</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 text-slate-700">
              {filteredRequests.length === 0 ? (
                <tr>
                  <td colSpan={6} className="py-6 text-center text-slate-400">
                    Nenhum pedido de titular de dados registado.
                  </td>
                </tr>
              ) : (
                visibleFilteredRequests.map((r) => (
                  <tr key={r.id} className="hover:bg-slate-50/80 transition-colors">
                    <td className="py-3 px-3 font-mono font-semibold text-slate-900">{r.code}</td>
                    <td className="py-3 px-3">
                      <div className="font-semibold text-slate-900">{r.requesterName}</div>
                      <div className="text-[10px] text-slate-500">
                        {REQUESTER_RELATION_LABELS[r.requesterRelation] || r.requesterRelation}
                        {r.studentName ? ` · ${r.studentName}` : ''}
                      </div>
                    </td>
                    <td className="py-3 px-3 font-semibold text-slate-800">{REQUEST_TYPE_LABELS[r.type]}</td>
                    <td className="py-3 px-3 text-slate-600">{new Date(r.requestedAt).toLocaleDateString('pt-PT')}</td>
                    <td className="py-3 px-3">
                      <select
                        value={r.status}
                        onChange={(e) => handleChangeStatus(r.id, e.target.value as DataSubjectRequestStatus)}
                        className={`px-2 py-1 rounded text-[10px] font-bold border-0 outline-none cursor-pointer ${REQUEST_STATUS_META[r.status].badge}`}
                      >
                        {(Object.keys(REQUEST_STATUS_META) as DataSubjectRequestStatus[]).map((s) => (
                          <option key={s} value={s}>
                            {REQUEST_STATUS_META[s].label}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td className="py-3 px-3 text-right">
                      <button
                        type="button"
                        onClick={() => handleDeleteRequest(r.id, r.code)}
                        className="p-1 text-slate-400 hover:text-red-600 rounded-lg hover:bg-red-50 cursor-pointer"
                        title="Eliminar registo do pedido"
                      >
                        <span className="material-symbols-outlined text-[16px]">delete</span>
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
          <TablePagination total={filteredRequests.length} page={pgFilteredRequests} onPageChange={setPgFilteredRequests} />
        </div>
      </section>

      {/* Modal: Novo Pedido */}
      {showNewRequestModal && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-xs z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-lg w-full p-6 border border-slate-200 shadow-2xl flex flex-col gap-4">
            <h3 className="font-headline text-lg font-bold text-slate-900">Registar Pedido de Titular de Dados</h3>

            {formErrors.length > 0 && (
              <Notice tone="error">
                {formErrors.map((err) => (
                  <div key={err}>{err}</div>
                ))}
              </Notice>
            )}

            <div className="flex flex-col gap-1.5 text-xs">
              <label className="font-bold text-slate-900">Nome do Requerente</label>
              <input
                value={form.requesterName}
                onChange={(e) => setForm((f) => ({ ...f, requesterName: e.target.value }))}
                className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-lg font-semibold text-slate-800"
              />
            </div>

            <div className="grid grid-cols-2 gap-3 text-xs">
              <div className="flex flex-col gap-1.5">
                <label className="font-bold text-slate-900">Relação com a Instituição</label>
                <select
                  value={form.requesterRelation}
                  onChange={(e) => setForm((f) => ({ ...f, requesterRelation: e.target.value as RelationKey }))}
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-lg font-semibold text-slate-800"
                >
                  {Object.keys(REQUESTER_RELATION_LABELS).map((key) => (
                    <option key={key} value={key}>
                      {REQUESTER_RELATION_LABELS[key]}
                    </option>
                  ))}
                </select>
              </div>
              <div className="flex flex-col gap-1.5">
                <label className="font-bold text-slate-900">Tipo de Pedido</label>
                <select
                  value={form.type}
                  onChange={(e) => setForm((f) => ({ ...f, type: e.target.value as DataSubjectRequestType }))}
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-lg font-semibold text-slate-800"
                >
                  {(Object.keys(REQUEST_TYPE_LABELS) as DataSubjectRequestType[]).map((t) => (
                    <option key={t} value={t}>
                      {REQUEST_TYPE_LABELS[t]}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div className="flex flex-col gap-1.5 text-xs">
              <label className="font-bold text-slate-900">ID do Aluno (opcional, se o pedido for sobre um aluno)</label>
              <input
                value={form.studentId}
                onChange={(e) => setForm((f) => ({ ...f, studentId: e.target.value }))}
                className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-lg font-semibold text-slate-800"
                placeholder="Nº de processo ou ID interno do aluno"
              />
            </div>

            <div className="flex flex-col gap-1.5 text-xs">
              <label className="font-bold text-slate-900">Descrição (opcional)</label>
              <textarea
                value={form.description}
                onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
                rows={3}
                className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-lg text-slate-800"
              />
            </div>

            <div className="flex items-center justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => {
                  setShowNewRequestModal(false);
                  setForm(emptyRequestForm);
                  setFormErrors([]);
                }}
                className="px-4 py-2 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-800 font-bold text-xs transition-colors cursor-pointer"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={handleCreateRequest}
                className="px-5 py-2 rounded-xl bg-[#0b1f3a] hover:bg-[#7a0c0c] text-white font-bold text-xs flex items-center gap-1.5 transition-colors shadow-xs cursor-pointer"
              >
                <span className="material-symbols-outlined text-[16px]">save</span>
                <span>Registar Pedido</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
