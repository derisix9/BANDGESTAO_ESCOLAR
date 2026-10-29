import React, { useState, useMemo } from 'react';
import { loadIpPolicy, saveIpPolicy } from '../../services/securityPolicy';
import { getPasswordGate, savePasswordPolicy } from '../../services/authSupabase';
import { InstitutionSettings, UserRole } from '../../types';
import { dbService } from '../../services/db';
import { SchoolRestorePoints } from './SchoolRestorePoints';
import { ExternalBackup } from './ExternalBackup';
import { DangerZone } from './DangerZone';
import { useFeatureMode } from '../../utils/featureModes';
import { FeatureReadOnly } from '../../components/FeatureReadOnly';
import { TablePagination, usePagedList } from '../../components/TablePagination';

interface TabSegurancaBackupsProps {
  settings: InstitutionSettings;
  currentUserRole?: UserRole;
  onUpdateSettings?: (newSettings: Partial<InstitutionSettings>) => void;
  onSaveAll: (options?: { loadingMessage?: string; successMessage?: string; requiredRule?: string }) => void;
  registerCommit?: (commit: (() => Partial<InstitutionSettings>) | null) => void;
}

/**
 * Configurações → 7. Segurança, Backup e Logs.
 *
 *   1. Políticas de Cibersegurança — produzem efeito real (ver services/securityPolicy.ts):
 *      inatividade termina a sessão, tentativas falhadas bloqueiam o login, a
 *      validade da senha é verificada e o 2FA é exigido aos perfis críticos.
 *   2. Cópias de Segurança & Restauro — SchoolRestorePoints: "Baixar backup" (ficheiro .json com todos os dados da
 *      escola) e "Carregar backup" (o mesmo ficheiro restaura, tudo ou nada, com ponto de segurança prévio).
 *   3. Cópia diária para a nuvem da escola — ExternalBackup (migração 0018 + Edge Function school-backups).
 *   4. Registo de Logs — trilha de auditoria em tempo real.
 *
 * O antigo sistema paralelo (exportar/restaurar ficheiros JSON no navegador,
 * histórico local e agendamento configurável no cliente) foi REMOVIDO: as
 * cópias de segurança são agora o ficheiro baixado/carregado (funções SQL da migração 0012).
 */
export const TabSegurancaBackups: React.FC<TabSegurancaBackupsProps> = ({
  settings,
  currentUserRole,
  registerCommit
}) => {
  const backupMode = useFeatureMode('backup_automatico');
  const initialSec = settings.securityPolicies || {};

  const [twoFactorActive, setTwoFactorActive] = useState(initialSec.twoFactorActive ?? true);
  const [sessionTimeout, setSessionTimeout] = useState(initialSec.sessionTimeout || '20');
  const [maxFailedAttempts, setMaxFailedAttempts] = useState(initialSec.maxFailedAttempts || '5');
  const [passwordExpirationDays, setPasswordExpirationDays] = useState(initialSec.passwordExpirationDays || '90');
  // A validade da palavra-passe é aplicada pelo SERVIDOR (migração 0045): lê-se e grava-se por funções próprias.
  const [pwMsg, setPwMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [pwSaving, setPwSaving] = useState(false);
  React.useEffect(() => {
    let alive = true;
    void getPasswordGate().then((g) => { if (alive) setPasswordExpirationDays(String(g.maxAge || 0)); });
    return () => { alive = false; };
  }, []);
  // Lista de IPs: vive no SERVIDOR (migração 0043). Carrega-se e grava-se por funções próprias, não pelas "settings".
  const [ipRangesText, setIpRangesText] = useState('');
  const [ipRoles, setIpRoles] = useState<string[]>(['admin', 'director', 'secretaria', 'financeiro']);
  const [myIp, setMyIp] = useState<string | null>(null);
  const [ipMsg, setIpMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [ipSaving, setIpSaving] = useState(false);
  const IP_ROLE_OPTIONS: [string, string][] = [['director', 'Direcção'], ['secretaria', 'Secretaria'], ['financeiro', 'Financeiro'], ['professor', 'Professores'], ['funcionario', 'Funcionários']];
  React.useEffect(() => {
    let alive = true;
    void loadIpPolicy().then((p) => {
      if (!alive || !p) return;
      setIpRangesText(p.ranges.join('\n')); setIpRoles(p.roles); setMyIp(p.ip);
    });
    return () => { alive = false; };
  }, []);

  const [searchTerm, setSearchTerm] = useState('');
  const [moduleFilter, setModuleFilter] = useState('todos');

  const parsedIpRanges = useMemo(
    () => ipRangesText.split('\n').map((l) => l.trim()).filter(Boolean),
    [ipRangesText]
  );

  // Get live audit logs directly from database
  const liveLogs = useMemo(() => {
    const raw = dbService.getDatabase().auditLogs || [];
    return raw.map((l) => ({
      id: l.id,
      horario: l.timestamp,
      usuario: l.userName,
      cargo: l.userRole,
      acao: l.action,
      detalhes: l.details,
      modulo: l.module,
      // O IP de origem só pode ser determinado no servidor; o cliente não o
      // conhece. Antes era fabricado um IP fixo igual para todos os registos.
      ip: (l as any).ip || '—',
      status: 'Sucesso'
    }));
  }, [dbService.getDatabase().auditLogs]);

  const filteredLogs = useMemo(() => {
    return liveLogs.filter((log) => {
      const matchSearch =
        log.usuario.toLowerCase().includes(searchTerm.toLowerCase()) ||
        log.acao.toLowerCase().includes(searchTerm.toLowerCase()) ||
        (log.detalhes && log.detalhes.toLowerCase().includes(searchTerm.toLowerCase()));
      const matchModule = moduleFilter === 'todos' || log.modulo === moduleFilter;
      return matchSearch && matchModule;
    });
  }, [liveLogs, searchTerm, moduleFilter]);
  const { page: pgFilteredLogs, setPage: setPgFilteredLogs, pageItems: visibleFilteredLogs } = usePagedList(filteredLogs, [filteredLogs.length]);

  // Alterações pendentes, recolhidas pelo botão principal "Guardar Alterações".
  const buildPendingSettings = React.useCallback(
    (): Partial<InstitutionSettings> => ({
      securityPolicies: {
        twoFactorActive,
        sessionTimeout,
        maxFailedAttempts,
        passwordExpirationDays
      }
    }),
    [twoFactorActive, sessionTimeout, maxFailedAttempts, passwordExpirationDays]
  );

  React.useEffect(() => {
    const commit = () => {
      dbService.addAuditLog({
        userName: '',
        userRole: 'Administrador Geral',
        action: 'Atualização de Políticas de Cibersegurança',
        details: `2FA: ${twoFactorActive ? 'Ativado' : 'Desativado'}, Sessão: ${sessionTimeout}m, Limite Tentativas: ${maxFailedAttempts}, Validade Senha: ${passwordExpirationDays}d, IPs autorizados: ${parsedIpRanges.length}.`,
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

  return (
    <div className="flex flex-col gap-6">
      {/* Top Header */}
      <div className="p-6 rounded-2xl bg-white border border-slate-200 shadow-xs flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="w-11 h-11 rounded-xl bg-slate-100 flex items-center justify-center text-[#0b1f3a] shrink-0">
            <span className="material-symbols-outlined text-[26px]">security</span>
          </div>
          <div>
            <div className="flex items-center gap-2">
              <span className="text-[11px] uppercase tracking-wider text-[#ac332b] font-bold">Módulo 07</span>
              <span className="w-1 h-1 rounded-full bg-slate-300" />
              <span className="text-[11px] text-slate-500 font-medium">BACKUP E AUDITORIA</span>
            </div>
            <h2 className="font-headline text-lg lg:text-xl font-bold text-slate-900">
              SEGURANÇA, BACKUP E LOGS
            </h2>
          </div>
        </div>
      </div>

      {/* Bloco 1: Políticas de Acesso & Cibersegurança */}
      <section className="bg-white p-6 rounded-2xl border border-slate-200 shadow-xs flex flex-col gap-4">
        <div className="pb-3 border-b border-slate-100">
          <h3 className="font-headline text-base lg:text-lg font-bold text-slate-900">
            1. Segurança do Sistema
          </h3>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 text-xs">
          {/* 2FA */}
          <div className="p-4 rounded-xl bg-slate-50 border border-slate-100 flex flex-col justify-between gap-3">
            <div className="flex items-center justify-between">
              <span className="font-bold text-slate-900">Autenticação 2FA</span>
              <button
                type="button"
                onClick={() => setTwoFactorActive(!twoFactorActive)}
                className={`w-9 h-5 rounded-full transition-colors relative cursor-pointer ${
                  twoFactorActive ? 'bg-[#0b1f3a]' : 'bg-slate-300'
                }`}
              >
                <div
                  className={`w-3.5 h-3.5 rounded-full bg-white transition-transform absolute top-0.5 ${
                    twoFactorActive ? 'right-0.5' : 'left-0.5'
                  }`}
                />
              </button>
            </div>
            <span className="text-[10px] font-mono text-emerald-800 font-bold">
              {twoFactorActive ? 'ATIVADO (Código OTP)' : 'DESATIVADO'}
            </span>
          </div>

          {/* Expiração de Senhas */}
          <div className="p-4 rounded-xl bg-slate-50 border border-slate-100 flex flex-col justify-between gap-2">
            <span className="font-bold text-slate-900">Validade da Senha</span>
            <select
              value={passwordExpirationDays}
              onChange={(e) => setPasswordExpirationDays(e.target.value)}
              className="w-full px-2.5 py-1.5 bg-white border border-slate-300 rounded-lg font-semibold text-slate-800"
            >
              <option value="0">Nunca expira</option>
              <option value="60">60 Dias</option>
              <option value="90">90 Dias (Recomendado)</option>
              <option value="180">180 Dias</option>
              <option value="365">1 Ano</option>
            </select>
            <button type="button" disabled={pwSaving || currentUserRole !== 'admin'}
              className="px-3 py-1.5 rounded-lg bg-[#0b1f3a] text-white font-bold cursor-pointer disabled:opacity-50"
              onClick={async () => {
                setPwSaving(true); setPwMsg(null);
                const r = await savePasswordPolicy(Number(passwordExpirationDays));
                setPwSaving(false);
                setPwMsg(r.success ? { ok: true, text: 'Aplicado no servidor.' } : { ok: false, text: r.error || 'Não foi possível gravar.' });
              }}>
              {pwSaving ? 'A gravar…' : 'Aplicar no servidor'}
            </button>
            {pwMsg && <span className={pwMsg.ok ? 'text-emerald-700 font-semibold' : 'text-red-700 font-semibold'}>{pwMsg.text}</span>}
            <span className="text-slate-500">Alunos e encarregados não expiram por idade. Contas novas pedem sempre uma palavra-passe própria no primeiro acesso.</span>
          </div>

          {/* Bloqueio por Tentativas */}
          <div className="p-4 rounded-xl bg-slate-50 border border-slate-100 flex flex-col justify-between gap-2">
            <span className="font-bold text-slate-900">Tentativas Falhadas</span>
            <select
              value={maxFailedAttempts}
              onChange={(e) => setMaxFailedAttempts(e.target.value)}
              className="w-full px-2.5 py-1.5 bg-white border border-slate-300 rounded-lg font-semibold text-slate-800"
            >
              <option value="3">3 Tentativas</option>
              <option value="5">5 Tentativas (Padrão)</option>
              <option value="10">10 Tentativas</option>
            </select>
          </div>

          {/* Timeout de Sessão */}
          <div className="p-4 rounded-xl bg-slate-50 border border-slate-100 flex flex-col justify-between gap-2">
            <span className="font-bold text-slate-900">Inatividade de Sessão</span>
            <select
              value={sessionTimeout}
              onChange={(e) => setSessionTimeout(e.target.value)}
              className="w-full px-2.5 py-1.5 bg-white border border-slate-300 rounded-lg font-semibold text-slate-800"
            >
              <option value="15">15 Minutos</option>
              <option value="20">20 Minutos (Padrão)</option>
              <option value="30">30 Minutos</option>
              <option value="60">60 Minutos</option>
            </select>
          </div>
        </div>

        {/* Sub-redes autorizadas: gravadas e APLICADAS NO SERVIDOR (migração 0043). */}
        <div className="p-4 bg-slate-50 rounded-xl border border-slate-100 flex flex-col gap-2 text-xs">
          <div>
            <span className="font-bold text-slate-900 block">Sub-redes Autorizadas da Secretaria (IP Whitelist)</span>
          </div>
          <p className="text-slate-500">
            Um IP, uma rede (<code>197.218.10.0/24</code>), um intervalo (<code>10.20.30.1-10.20.30.60</code>) ou um prefixo (<code>197.218.10.</code>), um por linha.
            Deixe vazio para não restringir. Aplicado no servidor: quem estiver fora da lista não vê dados.
          </p>
          <textarea
            value={ipRangesText}
            onChange={(e) => setIpRangesText(e.target.value)}
            rows={Math.min(6, Math.max(2, ipRangesText.split('\n').length))}
            placeholder={'197.218.10.0/24\n10.20.30.1-10.20.30.60'}
            spellCheck={false}
            className="w-full px-3 py-2 bg-white border border-slate-300 rounded-lg font-mono text-xs text-slate-800 outline-none focus:ring-1 focus:ring-[#0b1f3a]"
          />
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-slate-600">O seu IP agora (visto pelo servidor): <b className="font-mono">{myIp || 'desconhecido'}</b></span>
            {myIp && !parsedIpRanges.includes(myIp) && (
              <button type="button" className="px-2 py-1 rounded-md border border-slate-300 bg-white font-semibold cursor-pointer"
                onClick={() => setIpRangesText((t) => (t.trim() ? t.trim() + '\n' : '') + myIp)}>Adicionar o meu IP</button>
            )}
          </div>
          <div className="flex flex-wrap gap-3">
            <span className="font-semibold text-slate-700">Perfis restringidos:</span>
            <span className="text-slate-500">Administração (sempre)</span>
            {IP_ROLE_OPTIONS.map(([key, label]) => (
              <label key={key} className="flex items-center gap-1 cursor-pointer">
                <input type="checkbox" checked={ipRoles.includes(key)}
                  onChange={(e) => setIpRoles((r) => (e.target.checked ? [...r, key] : r.filter((x) => x !== key)))} />
                {label}
              </label>
            ))}
          </div>
          <p className="text-amber-700">Atenção: IPs de dados móveis mudam e partilham-se entre clientes. Use esta lista só para redes fixas da escola. Alunos e encarregados nunca são restringidos.</p>
          {ipMsg && <p className={ipMsg.ok ? 'text-emerald-700 font-semibold' : 'text-red-700 font-semibold'}>{ipMsg.text}</p>}
          <div>
            <button type="button" disabled={ipSaving || currentUserRole !== 'admin'}
              className="px-3 py-1.5 rounded-lg bg-[#0b1f3a] text-white font-bold cursor-pointer disabled:opacity-50"
              onClick={async () => {
                setIpSaving(true); setIpMsg(null);
                const r = await saveIpPolicy(parsedIpRanges, ipRoles);
                setIpSaving(false);
                if (r.success && r.policy) { setIpRangesText(r.policy.ranges.join('\n')); setIpRoles(r.policy.roles); setIpMsg({ ok: true, text: 'Lista aplicada no servidor.' }); }
                else setIpMsg({ ok: false, text: r.error || 'Não foi possível gravar a lista.' });
              }}>
              {ipSaving ? 'A gravar…' : 'Aplicar lista de IPs'}
            </button>
          </div>
        </div>
      </section>

      {/* Bloco 2: Cópias de Segurança & Restauro (baixar / carregar ficheiro) */}
      <SchoolRestorePoints
        isAdmin={currentUserRole === 'admin'}
      />

      {/* Bloco 3: Cópia diária agendada para a nuvem da escola (Google Drive, Backblaze B2, Wasabi, R2, S3…) */}
      {/* Área avançada: o Super Admin define por escola — oculto / leitura / gravação. */}
      {!backupMode.hidden && (
        <FeatureReadOnly readOnly={backupMode.readOnly}>
          <ExternalBackup isAdmin={currentUserRole === 'admin'} />
        </FeatureReadOnly>
      )}

      {/* Bloco 4: Registo de Auditoria de Acessos Recentes (Dados em Tempo Real) */}
      <section className="bg-white p-6 rounded-2xl border border-slate-200 shadow-xs flex flex-col gap-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-slate-100">
          <div>
            <h3 className="font-headline text-base lg:text-lg font-bold text-slate-900">
              4. Registo de Logs
            </h3>
            <p className="text-xs text-slate-500">
              Ações sensíveis realizadas em tempo real com identificação de utilizador, perfil e detalhes.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <input
              type="text"
              placeholder="Filtrar por utilizador ou ação..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="px-3 py-1.5 bg-slate-50 border border-slate-200 rounded-xl text-xs outline-none focus:ring-1 focus:ring-[#0b1f3a] w-48 sm:w-56"
            />
            <select
              value={moduleFilter}
              onChange={(e) => setModuleFilter(e.target.value)}
              className="px-3 py-1.5 bg-slate-50 border border-slate-200 rounded-xl text-xs font-semibold text-slate-700 outline-none"
            >
              <option value="todos">Todos os Módulos</option>
              <option value="pautas">Pautas & Notas</option>
              <option value="propinas">Propinas & Finanças</option>
              <option value="assiduidade">Assiduidade</option>
              <option value="sistema">Sistema & Segurança</option>
            </select>
          </div>
        </div>

        <div className="overflow-x-auto max-h-96 overflow-y-auto">
          <table className="w-full text-left text-xs">
            <thead className="sticky top-0 z-10">
              <tr className="bg-[#0b1f3a] text-white uppercase tracking-wider font-bold border-b border-slate-800 text-[11px]">
                <th className="py-2.5 px-3 rounded-l-lg">Data / Hora</th>
                <th className="py-2.5 px-3">Utilizador / Cargo</th>
                <th className="py-2.5 px-3">Operação Registada</th>
                <th className="py-2.5 px-3">Detalhes</th>
                <th className="py-2.5 px-3 text-right rounded-r-lg">Resultado</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 text-slate-700">
              {filteredLogs.length === 0 ? (
                <tr>
                  <td colSpan={5} className="py-6 text-center text-slate-400">
                    Nenhum registo de auditoria encontrado com os filtros selecionados.
                  </td>
                </tr>
              ) : (
                visibleFilteredLogs.map((log) => (
                  <tr key={log.id} className="hover:bg-slate-50/80 transition-colors">
                    <td className="py-3 px-3 text-slate-500 font-mono text-[11px] whitespace-nowrap">
                      {log.horario}
                    </td>
                    <td className="py-3 px-3">
                      <div className="font-semibold text-slate-900">{log.usuario}</div>
                      <div className="text-[10px] text-slate-500">{log.cargo}</div>
                    </td>
                    <td className="py-3 px-3 font-semibold text-slate-800">{log.acao}</td>
                    <td className="py-3 px-3 text-slate-600 text-[11px] max-w-xs truncate">
                      {log.detalhes || 'Operação realizada com sucesso.'}
                    </td>
                    <td className="py-3 px-3 text-right">
                      <span
                        className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                          log.status === 'Sucesso'
                            ? 'bg-emerald-50 text-emerald-800'
                            : 'bg-red-50 text-red-800'
                        }`}
                      >
                        {log.status}
                      </span>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
          <TablePagination total={filteredLogs.length} page={pgFilteredLogs} onPageChange={setPgFilteredLogs} />
        </div>
      </section>

      {/* Bloco 5: Zona de Perigo (eliminar os dados da escola do administrador) */}
      <DangerZone isAdmin={currentUserRole === 'admin'} />
    </div>
  );
};
